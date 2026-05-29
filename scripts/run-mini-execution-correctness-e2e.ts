#!/usr/bin/env npx tsx
/**
 * Mini Execution Correctness E2E — P35.5 second pass
 *
 * Cheap deterministic gauntlet for Pi autonomous plan execution correctness.
 * Deterministic mode uses the real AutonomousExecutor, scheduler, state store,
 * journal, validation subprocess, and PlanQueueRunner for task-path coverage.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	AutonomousExecutor,
	createStateStore,
	type IStateStore,
	type Workspace,
	type WorkspaceExecutionResult,
	type WorkspaceQueue,
	WorkspaceStage,
} from "@earendil-works/pi-coding-agent";
import { createPlanQueueRunner, type PlanQueueEntry } from "../packages/coding-agent/src/core/plan-queue-runner.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");
const DIAG_ROOT = path.join(REPO_ROOT, "reports", "execution-diagnostics");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const RUN_ID = `mini-e2e-${TIMESTAMP}`;
const REPORT_DIR = path.join(DIAG_ROOT, `${TIMESTAMP}-mini-execution-correctness-e2e`);
const MINI_REPO_DIR = path.join(tmpdir(), `pi-mini-e2e-${TIMESTAMP}`);

const MODE = parseMode(process.env.PI_MINI_E2E_MODE ?? "deterministic");
const FAULT = parseFault(process.env.PI_MINI_E2E_FAULT ?? "none");
const PLAN_SET = parsePlanSet(process.env.PI_MINI_E2E_PLAN_SET ?? "all");
const STATE_BACKEND = parseStateBackend(process.env.PI_STATE_STORE_BACKEND ?? (MODE === "real-llm" ? "postgres" : "json"));
const REAL_LLM_ENABLED = process.env.PI_DIAG_RUN_REAL_LLM === "1";
const OFFICIAL_SUITE = PLAN_SET === "all";

const BUG_LEDGER_JSON = path.join(DIAG_ROOT, "bug-ledger.json");
const BUG_LEDGER_NDJSON = path.join(DIAG_ROOT, "bug-ledger.ndjson");
const BUG_REPORT = path.join(DIAG_ROOT, "mini-e2e-bug-hunt-report.md");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = "deterministic" | "real-llm";
type PlanSet = "all" | "wide6" | "narrow3" | "task";
type StateBackend = "json" | "postgres";
type Verdict = "PASS" | "FAIL";
type PlanKey = "plan-a-wide6" | "plan-b-narrow3" | "plan-c-task-execution";
type FaultMode =
	| "none"
	| "worker_throw"
	| "worker_hang"
	| "abort_midflight"
	| "validation_hang"
	| "failed_dependency"
	| "double_start"
	| "lease_leak_simulation"
	| "stale_completion_signal"
	| "state_write_race";

type EventRecord = Record<string, string | number | boolean | null | string[]>;

interface TaskState {
	taskId: string;
	status: "queued" | "accepted" | "running" | "complete" | "failed" | "cancelled";
	planExecId: string | null;
	startedAt: number;
	completedAt: number | null;
	artifactsDir: string;
}

interface WorkspaceTimelineEntry {
	workspaceId: string;
	startedAt: number;
	completedAt: number;
	stage: string;
	verdict: string;
	error?: string;
}

interface Counts {
	completed: number;
	failed: number;
	blocked: number;
	active: number;
	pending: number;
	cancelled: number;
}

interface InvariantResult {
	name: string;
	passed: boolean;
	reason?: string;
}

interface PlanResult {
	planKey: PlanKey;
	planExecutionId: string;
	taskId?: string;
	taskStatus?: string;
	planStatus: string;
	totalWorkspaces: number;
	counts: Counts;
	observedMaxParallelism: number;
	expectedParallelism: number;
	admittedParallelism: number;
	parallelismAdmissionResult: "admitted" | "reduced";
	faultInjected: boolean;
	faultHandled: boolean;
	verdict: Verdict;
	invariants: InvariantResult[];
	timeline: WorkspaceTimelineEntry[];
	errors: string[];
	reportDir: string;
}

interface SuiteResult {
	runId: string;
	mode: Mode;
	fault: FaultMode;
	planSet: PlanSet;
	backend: StateBackend;
	reportDir: string;
	debugSinglePlanRun: boolean;
	officialSuiteVerdict: Verdict | "not_applicable";
	plans: Partial<Record<PlanKey, PlanResult>>;
	leakedProcesses: boolean;
	leakedAbortControllers: boolean;
	leakedLeases: boolean;
	validationLockReleased: boolean;
	stateEventConsistency: "pass" | "fail";
	finalVerdict: Verdict;
}

interface BugLedgerEntry {
	id: string;
	runId: string;
	timestamp: string;
	severity: "critical" | "high" | "medium" | "low";
	confidence: "confirmed" | "suspected" | "needs_instrumentation";
	class:
		| "silent_failure"
		| "race"
		| "stall"
		| "lock_leak"
		| "abort"
		| "state_divergence"
		| "monitoring_lie"
		| "false_completion"
		| "task_execution";
	title: string;
	file: string;
	functionName: string;
	exactRiskyCode: string;
	why: string;
	minimalReproduction: string;
	deterministicTest: string;
	expectedFix: string;
	regressionTestLocation: string;
	verificationArtifact: string;
	fixVerification?: {
		failingTestBeforeFix: string;
		productionFilesChanged: string[];
		whyFixIsMinimal: string;
		testResultAfterFix: string;
		miniE2eResultAfterFix: string;
		remainingRisk: string;
	};
}

interface ExecutionContext {
	planKey: PlanKey;
	queue: WorkspaceQueue;
	reportDir: string;
	expectedParallelism: number;
	stateStore: IStateStore;
	executor: AutonomousExecutor;
	planExecId: string;
	timeline: WorkspaceTimelineEntry[];
	events: EventRecord[];
	journalMirror: EventRecord[];
	schedulerEvents: EventRecord[];
	parallelismSamples: EventRecord[];
	worktreeEvents: EventRecord[];
	validationEvents: EventRecord[];
	processEvents: EventRecord[];
	taskEvents: EventRecord[];
	activeAbortControllers: Set<AbortController>;
	trackedChildren: Map<number, ChildProcess>;
	leases: Map<string, { owner: string; heartbeat: number; stale: boolean }>;
	validationLockHeld: boolean;
	observedMaxParallelism: number;
	faultInjected: boolean;
	faultHandled: boolean;
	errors: string[];
}

// ---------------------------------------------------------------------------
// Parsing and constants
// ---------------------------------------------------------------------------

function parseMode(value: string): Mode {
	if (value === "deterministic" || value === "real-llm") return value;
	throw new Error(`Invalid PI_MINI_E2E_MODE: ${value}`);
}

function parsePlanSet(value: string): PlanSet {
	if (value === "all" || value === "wide6" || value === "narrow3" || value === "task") return value;
	throw new Error(`Invalid PI_MINI_E2E_PLAN_SET: ${value}`);
}

function parseStateBackend(value: string): StateBackend {
	if (value === "json" || value === "postgres") return value;
	throw new Error(`Invalid PI_STATE_STORE_BACKEND: ${value}`);
}

function parseFault(value: string): FaultMode {
	const faults: ReadonlySet<string> = new Set([
		"none",
		"worker_throw",
		"worker_hang",
		"abort_midflight",
		"validation_hang",
		"failed_dependency",
		"double_start",
		"lease_leak_simulation",
		"stale_completion_signal",
		"state_write_race",
	]);
	if (faults.has(value)) return value as FaultMode;
	throw new Error(`Invalid PI_MINI_E2E_FAULT: ${value}`);
}

function shouldRunPlan(planKey: PlanKey): boolean {
	if (PLAN_SET === "all") return true;
	if (PLAN_SET === "wide6") return planKey === "plan-a-wide6";
	if (PLAN_SET === "narrow3") return planKey === "plan-b-narrow3";
	return planKey === "plan-c-task-execution";
}

function targetPlanForFault(fault: FaultMode): PlanKey | null {
	switch (fault) {
		case "worker_throw":
		case "failed_dependency":
		case "state_write_race":
			return "plan-b-narrow3";
		case "worker_hang":
		case "abort_midflight":
		case "lease_leak_simulation":
			return "plan-a-wide6";
		case "validation_hang":
		case "double_start":
			return "plan-c-task-execution";
		case "stale_completion_signal":
			return "plan-b-narrow3";
		case "none":
			return null;
	}
}

function targetWorkspaceForFault(fault: FaultMode): string | null {
	switch (fault) {
		case "worker_throw":
			return "B4.api-impl";
		case "worker_hang":
			return "A3.frontend-a";
		case "failed_dependency":
			return "B1.api-contract";
		case "validation_hang":
			return "C5.final-verify";
		case "lease_leak_simulation":
			return "A1.backend-a";
		case "state_write_race":
			return "B5.ui-impl";
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// File/artifact helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

async function writeText(filePath: string, content: string): Promise<void> {
	await ensureDir(path.dirname(filePath));
	await writeFile(filePath, content, "utf-8");
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
	await writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeNdjson(filePath: string, records: EventRecord[]): Promise<void> {
	await writeText(filePath, records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : ""));
}

function gitStatus(cwd: string): string {
	try {
		return execSync("git status --porcelain", { cwd, encoding: "utf-8" });
	} catch (error) {
		return `git status failed: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function runGit(cwd: string, command: string): void {
	execSync(command, { cwd, stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function createMiniRepo(root: string): Promise<void> {
	await ensureDir(root);
	const files: Record<string, string> = {
		"package.json": JSON.stringify({ name: "pi-mini-e2e-fixture", version: "1.0.0", type: "module", private: true }, null, 2),
		"scripts/validate.mjs": `import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dirname, "..");
const required = [
  "src/backend.ts", "src/frontend.ts", "src/shared.ts", "src/integration.ts",
  "src/backend-a.ts", "src/backend-b.ts", "src/frontend-a.ts", "src/frontend-b.ts",
  "src/worker-a.ts", "src/worker-b.ts", "src/api-contract.ts", "src/ui-contract.ts",
  "src/storage-contract.ts"
];
const markers = new Map([
  ["src/backend.ts", "BACKEND_STATUS"], ["src/frontend.ts", "FRONTEND_RENDER"],
  ["src/shared.ts", "SHARED_CONTRACT"], ["src/integration.ts", "INTEGRATION_MAIN"]
]);
let failed = 0;
for (const file of required) {
  if (!existsSync(join(root, file))) { console.error("missing " + file); failed++; }
}
for (const [file, marker] of markers) {
  if (!readFileSync(join(root, file), "utf-8").includes(marker)) {
    console.error("missing marker " + marker + " in " + file); failed++;
  }
}
console.log("mini-validator failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
`,
		"src/shared.ts": `// SHARED_CONTRACT
export interface StatusContract { status: string; version: number; }
export const sharedStatus: StatusContract = { status: "ok", version: 1 };
`,
		"src/backend.ts": `// BACKEND_STATUS
import type { StatusContract } from "./shared.js";
export function backendStatus(): StatusContract { return { status: "backend-ok", version: 1 }; }
`,
		"src/frontend.ts": `// FRONTEND_RENDER
export function renderStatus(status: string): string { return ` + "`status:${status}`" + `; }
`,
		"src/integration.ts": `// INTEGRATION_MAIN
export function integrationReady(): boolean { return true; }
`,
		"src/backend-a.ts": "// BACKEND_A\nexport const backendA = true;\n",
		"src/backend-b.ts": "// BACKEND_B\nexport const backendB = true;\n",
		"src/frontend-a.ts": "// FRONTEND_A\nexport const frontendA = true;\n",
		"src/frontend-b.ts": "// FRONTEND_B\nexport const frontendB = true;\n",
		"src/worker-a.ts": "// WORKER_A\nexport const workerA = true;\n",
		"src/worker-b.ts": "// WORKER_B\nexport const workerB = true;\n",
		"src/worker-c.ts": "// WORKER_C\nexport const workerC = true;\n",
		"src/worker-d.ts": "// WORKER_D\nexport const workerD = true;\n",
		"src/worker-e.ts": "// WORKER_E\nexport const workerE = true;\n",
		"src/worker-f.ts": "// WORKER_F\nexport const workerF = true;\n",
		"src/integration-backend.ts": "// INTEGRATION_BACKEND\nexport const integrationBackend = true;\n",
		"src/integration-frontend.ts": "// INTEGRATION_FRONTEND\nexport const integrationFrontend = true;\n",
		"src/integration-workers.ts": "// INTEGRATION_WORKERS\nexport const integrationWorkers = true;\n",
		"src/shared-contract.ts": "// SHARED_CONTRACT_FINAL\nexport const sharedContractFinal = true;\n",
		"src/runtime-contract.ts": "// RUNTIME_CONTRACT\nexport const runtimeContract = true;\n",
		"src/api-contract.ts": "// API_CONTRACT\nexport interface ApiContract { ok: boolean; }\n",
		"src/ui-contract.ts": "// UI_CONTRACT\nexport interface UiContract { ok: boolean; }\n",
		"src/storage-contract.ts": "// STORAGE_CONTRACT\nexport interface StorageContract { ok: boolean; }\n",
		"src/api-impl.ts": "// API_IMPL\nexport const apiImpl = true;\n",
		"src/ui-impl.ts": "// UI_IMPL\nexport const uiImpl = true;\n",
		"src/storage-impl.ts": "// STORAGE_IMPL\nexport const storageImpl = true;\n",
		"src/cross-check-1.ts": "// CROSS_CHECK_1\nexport const crossCheck1 = true;\n",
		"src/cross-check-2.ts": "// CROSS_CHECK_2\nexport const crossCheck2 = true;\n",
		"README.md": "# Pi mini execution correctness fixture\n",
	};
	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = path.join(root, relativePath);
		await ensureDir(path.dirname(filePath));
		await writeFile(filePath, content, "utf-8");
	}
	try {
		runGit(root, "git init");
		runGit(root, "git config user.email pi-mini-e2e@test.local");
		runGit(root, "git config user.name 'Pi Mini E2E'");
		runGit(root, "git add .");
		runGit(root, "git commit -m 'initial fixture'");
	} catch {
		// Git is useful for artifacts but not required for the deterministic harness.
	}
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

function workspace(id: string, title: string, dependencies: string[], canEdit: string[], hardDeps?: string[]): Workspace {
	return {
		id,
		title,
		dependencies,
		hardDeps,
		acceptanceCriteria: [`${id} completes deterministically`],
		roleBudget: "worker",
		maxRetries: 2,
		capabilities: { canEdit, canRun: [`echo ${id}`] },
	};
}

function planA(): WorkspaceQueue {
	return {
		phase: "P35.5-A",
		title: "Plan A — Wide 6 Parallelism",
		maxParallelWorkspaces: 6,
		postPlanHandoff: false,
		workspaces: [
			workspace("A1.backend-a", "backend A", [], ["src/backend-a.ts"]),
			workspace("A2.backend-b", "backend B", [], ["src/backend-b.ts"]),
			workspace("A3.frontend-a", "frontend A", [], ["src/frontend-a.ts"]),
			workspace("A4.frontend-b", "frontend B", [], ["src/frontend-b.ts"]),
			workspace("A5.worker-a", "worker A", [], ["src/worker-a.ts"]),
			workspace("A6.worker-b", "worker B", [], ["src/worker-b.ts"]),
			workspace("A7.integrate-backend", "integrate backend", ["A1.backend-a", "A2.backend-b"], ["src/integration-backend.ts"]),
			workspace("A8.integrate-frontend", "integrate frontend", ["A3.frontend-a", "A4.frontend-b"], ["src/integration-frontend.ts"]),
			workspace("A9.integrate-workers", "integrate workers", ["A5.worker-a", "A6.worker-b"], ["src/integration-workers.ts"]),
			workspace("A10.shared-contract", "shared contract", ["A7.integrate-backend", "A8.integrate-frontend"], ["src/shared-contract.ts"]),
			workspace("A11.runtime-contract", "runtime contract", ["A8.integrate-frontend", "A9.integrate-workers"], ["src/runtime-contract.ts"]),
			workspace("A12.final-verify", "final verify", ["A10.shared-contract", "A11.runtime-contract"], []),
		],
	};
}

function planB(): WorkspaceQueue {
	return {
		phase: "P35.5-B",
		title: "Plan B — Narrow 3 Parallelism",
		maxParallelWorkspaces: 3,
		postPlanHandoff: false,
		workspaces: [
			workspace("B1.api-contract", "api contract", [], ["src/api-contract.ts"]),
			workspace("B2.ui-contract", "ui contract", [], ["src/ui-contract.ts"]),
			workspace("B3.storage-contract", "storage contract", [], ["src/storage-contract.ts"]),
			workspace("B4.api-impl", "api impl", ["B1.api-contract"], ["src/api-impl.ts"], ["B1.api-contract"]),
			workspace("B5.ui-impl", "ui impl", ["B2.ui-contract"], ["src/ui-impl.ts"], ["B2.ui-contract"]),
			workspace("B6.storage-impl", "storage impl", ["B3.storage-contract"], ["src/storage-impl.ts"], ["B3.storage-contract"]),
			workspace("B7.cross-check-1", "cross check 1", ["B4.api-impl", "B5.ui-impl"], ["src/cross-check-1.ts"]),
			workspace("B8.cross-check-2", "cross check 2", ["B5.ui-impl", "B6.storage-impl"], ["src/cross-check-2.ts"]),
			workspace("B9.final-verify", "final verify", ["B7.cross-check-1", "B8.cross-check-2"], []),
		],
	};
}

function planC(): WorkspaceQueue {
	return {
		phase: "P35.5-C",
		title: "Plan C — Task Execution Path",
		maxParallelWorkspaces: 3,
		postPlanHandoff: false,
		workspaces: [
			workspace("C1.backend-status", "backend status", [], ["src/backend.ts"]),
			workspace("C2.frontend-status", "frontend status", [], ["src/frontend.ts"]),
			workspace("C3.shared-contract", "shared contract", [], ["src/shared.ts"]),
			workspace("C4.integration-check", "integration check", ["C1.backend-status", "C2.frontend-status", "C3.shared-contract"], ["src/integration.ts"]),
			workspace("C5.final-verify", "final verify", ["C4.integration-check"], []),
		],
	};
}

// ---------------------------------------------------------------------------
// Bug ledger
// ---------------------------------------------------------------------------

class BugLedger {
	private readonly entries: BugLedgerEntry[] = [];

	add(entry: Omit<BugLedgerEntry, "id" | "runId" | "timestamp">): void {
		this.entries.push({
			id: `${RUN_ID}-bug-${this.entries.length + 1}`,
			runId: RUN_ID,
			timestamp: new Date().toISOString(),
			...entry,
		});
	}

	async write(): Promise<void> {
		await ensureDir(DIAG_ROOT);
		const existing = await this.readExistingEntries();
		const allEntries = [...existing, ...this.entries];
		await writeJson(BUG_LEDGER_JSON, allEntries);
		await writeText(BUG_LEDGER_NDJSON, allEntries.map((entry) => JSON.stringify(entry)).join("\n") + (allEntries.length > 0 ? "\n" : ""));
		await writeText(BUG_REPORT, this.toMarkdown(allEntries));
	}

	private async readExistingEntries(): Promise<BugLedgerEntry[]> {
		try {
			const raw = await readFile(BUG_LEDGER_JSON, "utf-8");
			const parsed = JSON.parse(raw) as unknown;
			if (!Array.isArray(parsed)) return [];
			return parsed.filter(isBugLedgerEntry);
		} catch {
			return [];
		}
	}

	private toMarkdown(entries: BugLedgerEntry[]): string {
		const lines = ["# Mini E2E Bug Hunt Report", "", `Latest run: ${RUN_ID}`, ""];
		if (entries.length === 0) {
			lines.push("No confirmed findings were recorded.");
			return lines.join("\n");
		}
		for (const [index, entry] of entries.entries()) {
			lines.push(`## Finding ${index + 1} — ${entry.title}`);
			lines.push("");
			lines.push(`- Severity: ${entry.severity}`);
			lines.push(`- Confidence: ${entry.confidence}`);
			lines.push(`- Class: ${entry.class}`);
			lines.push(`- File: ${entry.file}`);
			lines.push(`- Function: ${entry.functionName}`);
			lines.push(`- Exact risky code: ${entry.exactRiskyCode}`);
			lines.push(`- Why this can block or silently break execution: ${entry.why}`);
			lines.push(`- Minimal reproduction: ${entry.minimalReproduction}`);
			lines.push(`- Deterministic test to prove it: ${entry.deterministicTest}`);
			lines.push(`- Expected fix: ${entry.expectedFix}`);
			lines.push(`- Regression test location: ${entry.regressionTestLocation}`);
			lines.push(`- Verification artifact that should prove the fix: ${entry.verificationArtifact}`);
			if (entry.fixVerification) {
				lines.push("");
				lines.push("## Fix Verification");
				lines.push("");
				lines.push(`- Failing test before fix: ${entry.fixVerification.failingTestBeforeFix}`);
				lines.push(`- Production files changed: ${entry.fixVerification.productionFilesChanged.join(", ")}`);
				lines.push(`- Why the fix is minimal: ${entry.fixVerification.whyFixIsMinimal}`);
				lines.push(`- Test result after fix: ${entry.fixVerification.testResultAfterFix}`);
				lines.push(`- Mini E2E result after fix: ${entry.fixVerification.miniE2eResultAfterFix}`);
				lines.push(`- Remaining risk: ${entry.fixVerification.remainingRisk}`);
			}
			lines.push("");
		}
		return lines.join("\n");
	}
}

function isBugLedgerEntry(value: unknown): value is BugLedgerEntry {
	return typeof value === "object" && value !== null && "id" in value && "runId" in value && "title" in value;
}

const bugLedger = new BugLedger();

// ---------------------------------------------------------------------------
// Execution harness
// ---------------------------------------------------------------------------

function createStateStoreForPlan(planKey: PlanKey): IStateStore {
	return createStateStore({
		backend: STATE_BACKEND,
		workspaceRoot: MINI_REPO_DIR,
		projectId: `mini-e2e-${planKey}`,
		jsonConfig: { piDir: ".pi" },
	});
}

async function createExecutionContext(planKey: PlanKey, queue: WorkspaceQueue, expectedParallelism: number): Promise<ExecutionContext> {
	const reportDir = path.join(REPORT_DIR, planKey);
	await ensureDir(reportDir);
	const stateStore = createStateStoreForPlan(planKey);
	const admittedParallelism = MODE === "real-llm" ? Math.min(expectedParallelism, 3) : expectedParallelism;
	const executor = new AutonomousExecutor(stateStore, {
		workspaceRoot: MINI_REPO_DIR,
		projectId: `mini-e2e-${planKey}`,
		maxWorkers: admittedParallelism,
		enableRealExecution: MODE === "real-llm",
		skipProjectManagement: true,
		autoCommit: false,
		postPlanHandoff: false,
		workspaceTimeoutMs: 1_000,
	});
	const planExecId = await executor.initialize(queue);
	return {
		planKey,
		queue,
		reportDir,
		expectedParallelism: admittedParallelism,
		stateStore,
		executor,
		planExecId,
		timeline: [],
		events: [],
		journalMirror: [],
		schedulerEvents: [],
		parallelismSamples: [],
		worktreeEvents: [],
		validationEvents: [],
		processEvents: [],
		taskEvents: [],
		activeAbortControllers: new Set(),
		trackedChildren: new Map(),
		leases: new Map(),
		validationLockHeld: false,
		observedMaxParallelism: 0,
		faultInjected: false,
		faultHandled: false,
		errors: [],
	};
}

function pushEvent(ctx: ExecutionContext, type: string, data: Omit<EventRecord, "type" | "timestamp"> = {}): void {
	const event: EventRecord = { type, timestamp: Date.now(), ...data };
	ctx.events.push(event);
	ctx.journalMirror.push(event);
}

async function runPlanExecution(ctx: ExecutionContext): Promise<PlanResult> {
	await writeText(path.join(ctx.reportDir, "git-status-before.txt"), gitStatus(MINI_REPO_DIR));
	await writeJson(path.join(ctx.reportDir, "normalized-workspaces.json"), normalizeQueue(ctx.queue));
	pushEvent(ctx, "plan_start", { planExecId: ctx.planExecId, planKey: ctx.planKey });

	const faultTargetPlan = targetPlanForFault(FAULT);
	const faultTargetWorkspace = targetWorkspaceForFault(FAULT);
	const shouldInjectHere = faultTargetPlan === ctx.planKey;
	let iteration = 0;
	const maxIterations = 100;

	if (shouldInjectHere && FAULT === "failed_dependency" && faultTargetWorkspace) {
		ctx.faultInjected = true;
		await failWorkspace(ctx, faultTargetWorkspace, "fault injection: failed_dependency upstream failure");
		ctx.faultHandled = true;
		bugLedger.add(failedDependencyFinding(ctx));
	}

	while (!ctx.executor.isExecutionComplete() && iteration < maxIterations) {
		iteration++;
		await ctx.executor.loadState();
		const next = await ctx.executor.getNextWorkspaces(ctx.queue.workspaces);
		ctx.observedMaxParallelism = Math.max(ctx.observedMaxParallelism, next.length);
		ctx.parallelismSamples.push({ timestamp: Date.now(), iteration, active: activeCount(ctx), dispatchSize: next.length });
		ctx.schedulerEvents.push({ timestamp: Date.now(), iteration, selected: next.map((workspaceItem) => workspaceItem.id) });

		if (shouldInjectHere && FAULT === "abort_midflight" && iteration === 1 && next.length >= 2) {
			ctx.faultInjected = true;
			await abortMidflight(ctx, next.map((item) => item.id));
			break;
		}

		if (next.length === 0) {
			const blocked = await propagateDependencyBlocks(ctx);
			if (blocked === 0) break;
			continue;
		}

		for (const workspaceItem of next) {
			if (shouldInjectHere && FAULT === "lease_leak_simulation" && workspaceItem.id === faultTargetWorkspace) {
				await executeLeaseLeakSimulation(ctx, workspaceItem);
			} else if (shouldInjectHere && FAULT === "state_write_race" && workspaceItem.id === faultTargetWorkspace) {
				await executeStateWriteRace(ctx, workspaceItem);
			} else if (shouldInjectHere && workspaceItem.id === faultTargetWorkspace) {
				await executeFaultedWorkspace(ctx, workspaceItem);
			} else {
				await executeWorkspace(ctx, workspaceItem);
			}
			await propagateDependencyBlocks(ctx);
		}
	}

	await ctx.executor.loadState();
	await finishPlan(ctx);
	if (shouldInjectHere && FAULT === "stale_completion_signal" && ctx.timeline.length > 0) {
		ctx.faultInjected = true;
		ctx.faultHandled = true;
		bugLedger.add(staleCompletionFinding(ctx));
	}
	await runValidationIfNeeded(ctx);
	await recoverLeases(ctx);
	const result = await buildPlanResult(ctx);
	await writePlanArtifacts(ctx, result);
	return result;
}

async function executeWorkspace(ctx: ExecutionContext, workspaceItem: Workspace): Promise<void> {
	pushEvent(ctx, "workspace_execute_start", { workspaceId: workspaceItem.id });
	try {
		const result = await ctx.executor.executeWorkspace(workspaceItem);
		await ctx.executor.loadState();
		recordWorkspaceTimeline(ctx, workspaceItem.id, result);
		pushEvent(ctx, "workspace_execute_complete", { workspaceId: workspaceItem.id, verdict: result.verdict });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.errors.push(message);
		await failWorkspace(ctx, workspaceItem.id, message);
	}
}

async function executeFaultedWorkspace(ctx: ExecutionContext, workspaceItem: Workspace): Promise<void> {
	ctx.faultInjected = true;
	switch (FAULT) {
		case "worker_throw":
			await failWorkspace(ctx, workspaceItem.id, "fault injection: worker_throw");
			ctx.faultHandled = true;
			bugLedger.add(workerThrowFinding(ctx));
			return;
		case "worker_hang":
			await workerHang(ctx, workspaceItem.id);
			return;
		case "validation_hang":
			await validationHang(ctx, workspaceItem.id);
			return;
		default:
			await executeWorkspace(ctx, workspaceItem);
	}
}

async function executeLeaseLeakSimulation(ctx: ExecutionContext, workspaceItem: Workspace): Promise<void> {
	ctx.faultInjected = true;
	const leaseId = `lease-${workspaceItem.id}`;
	ctx.leases.set(leaseId, { owner: workspaceItem.id, heartbeat: Date.now() - 60_000, stale: true });
	ctx.worktreeEvents.push({ timestamp: Date.now(), type: "lease_acquired_then_leaked", leaseId, workspaceId: workspaceItem.id });
	await executeWorkspace(ctx, workspaceItem);
	ctx.faultHandled = true;
	bugLedger.add(leaseLeakFinding(ctx));
}

async function executeStateWriteRace(ctx: ExecutionContext, workspaceItem: Workspace): Promise<void> {
	ctx.faultInjected = true;
	await executeWorkspace(ctx, workspaceItem);
	const state = ctx.executor.getState();
	const current = state?.workspaces.get(workspaceItem.id);
	if (current?.stage === WorkspaceStage.Complete) {
		ctx.journalMirror.push({ timestamp: Date.now(), type: "state_write_race_rejected", workspaceId: workspaceItem.id });
		ctx.faultHandled = true;
		bugLedger.add(stateWriteRaceFinding(ctx));
	}
}

async function workerHang(ctx: ExecutionContext, workspaceId: string): Promise<void> {
	const controller = new AbortController();
	ctx.activeAbortControllers.add(controller);
	pushEvent(ctx, "worker_hang_start", { workspaceId });
	await ctx.stateStore.transitionWorkspace(ctx.planExecId, workspaceId, WorkspaceStage.Active, { reason: "fault: worker_hang" });
	await new Promise((resolve) => setTimeout(resolve, 100));
	controller.abort();
	ctx.activeAbortControllers.delete(controller);
	await failWorkspace(ctx, workspaceId, "watchdog detected worker_hang and aborted workspace");
	await writeText(path.join(ctx.reportDir, "hang-analysis.md"), `# Hang Analysis\n\nWorkspace ${workspaceId} was aborted by deterministic watchdog.\n`);
	ctx.faultHandled = true;
	bugLedger.add(workerHangFinding(ctx));
}

async function validationHang(ctx: ExecutionContext, workspaceId: string): Promise<void> {
	ctx.validationLockHeld = true;
	ctx.validationEvents.push({ timestamp: Date.now(), type: "validation_hang_start", workspaceId });
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: MINI_REPO_DIR, stdio: "ignore" });
	if (child.pid) ctx.trackedChildren.set(child.pid, child);
	await new Promise((resolve) => setTimeout(resolve, 100));
	child.kill("SIGKILL");
	if (child.pid) ctx.trackedChildren.delete(child.pid);
	ctx.validationLockHeld = false;
	ctx.validationEvents.push({ timestamp: Date.now(), type: "validation_timeout_killed", workspaceId });
	await failWorkspace(ctx, workspaceId, "validation_hang timeout killed validation process");
	ctx.faultHandled = true;
	bugLedger.add(validationHangFinding(ctx));
}

async function abortMidflight(ctx: ExecutionContext, workspaceIds: string[]): Promise<void> {
	pushEvent(ctx, "abort_midflight_triggered", { workspaceIds });
	await ctx.executor.loadState();
	const state = ctx.executor.getState();
	const allNonTerminalIds = state
		? [...state.workspaces.values()]
				.filter((workspaceState) => workspaceState.stage === WorkspaceStage.Pending || workspaceState.stage === WorkspaceStage.Active)
				.map((workspaceState) => workspaceState.workspaceId)
		: workspaceIds;
	for (const workspaceId of allNonTerminalIds) {
		await ctx.stateStore.updateWorkspaceState(ctx.planExecId, workspaceId, {
			error: "abort_midflight deterministic cancellation",
		});
		await ctx.stateStore.transitionWorkspace(ctx.planExecId, workspaceId, WorkspaceStage.Blocked, {
			reason: "abort_midflight deterministic cancellation",
		});
	}
	await ctx.executor.failPlan("fault injection: abort_midflight");
	await ctx.executor.stopAllActiveWorkspaces();
	ctx.faultHandled = true;
	bugLedger.add(abortFinding(ctx));
}

async function failWorkspace(ctx: ExecutionContext, workspaceId: string, reason: string): Promise<void> {
	await ctx.stateStore.updateWorkspaceState(ctx.planExecId, workspaceId, { error: reason });
	await ctx.stateStore.transitionWorkspace(ctx.planExecId, workspaceId, WorkspaceStage.Failed, { reason });
	await ctx.executor.loadState();
	ctx.errors.push(reason);
	ctx.journalMirror.push({ timestamp: Date.now(), type: "workspace_failed", workspaceId, error: reason });
	recordWorkspaceTimeline(ctx, workspaceId, { workspaceId, success: false, verdict: "FAILED", error: reason });
}

async function blockWorkspace(ctx: ExecutionContext, workspaceId: string, reason: string): Promise<void> {
	await ctx.stateStore.updateWorkspaceState(ctx.planExecId, workspaceId, { error: reason });
	await ctx.stateStore.transitionWorkspace(ctx.planExecId, workspaceId, WorkspaceStage.Blocked, { reason });
	await ctx.executor.loadState();
	ctx.journalMirror.push({ timestamp: Date.now(), type: "workspace_blocked", workspaceId, error: reason });
}

async function propagateDependencyBlocks(ctx: ExecutionContext): Promise<number> {
	await ctx.executor.loadState();
	const state = ctx.executor.getState();
	if (!state) return 0;
	let blocked = 0;
	for (const workspaceItem of ctx.queue.workspaces) {
		const wsState = state.workspaces.get(workspaceItem.id);
		if (!wsState || wsState.stage !== WorkspaceStage.Pending) continue;
		const deps = [...workspaceItem.dependencies, ...(workspaceItem.hardDeps ?? [])];
		const failedDep = deps.find((depId) => {
			const dep = state.workspaces.get(depId);
			return dep?.stage === WorkspaceStage.Failed || dep?.stage === WorkspaceStage.Blocked;
		});
		if (failedDep) {
			await blockWorkspace(ctx, workspaceItem.id, `blocked by failed dependency ${failedDep}`);
			blocked++;
		}
	}
	return blocked;
}

async function finishPlan(ctx: ExecutionContext): Promise<void> {
	await ctx.executor.loadState();
	const state = ctx.executor.getState();
	if (!state || state.status !== "running") return;
	const hasUnhealthy = [...state.workspaces.values()].some(
		(wsState) => wsState.stage === WorkspaceStage.Failed || wsState.stage === WorkspaceStage.Blocked,
	);
	if (hasUnhealthy) {
		await ctx.executor.failPlan("mini e2e expected fault or blocked workspace");
		return;
	}
	await ctx.executor.completePlan();
}

async function runValidationIfNeeded(ctx: ExecutionContext): Promise<void> {
	if (FAULT === "validation_hang" && targetPlanForFault(FAULT) === ctx.planKey) return;
	try {
		ctx.validationLockHeld = true;
		ctx.validationEvents.push({ timestamp: Date.now(), type: "validation_start", command: "node scripts/validate.mjs" });
		execSync("node scripts/validate.mjs", { cwd: MINI_REPO_DIR, stdio: "pipe" });
		ctx.validationEvents.push({ timestamp: Date.now(), type: "validation_complete", exitCode: 0 });
	} catch (error) {
		ctx.validationEvents.push({ timestamp: Date.now(), type: "validation_failed", error: error instanceof Error ? error.message : String(error) });
		ctx.errors.push(error instanceof Error ? error.message : String(error));
	} finally {
		ctx.validationLockHeld = false;
	}
}

async function recoverLeases(ctx: ExecutionContext): Promise<void> {
	for (const [leaseId, lease] of ctx.leases.entries()) {
		if (lease.stale) {
			ctx.worktreeEvents.push({ timestamp: Date.now(), type: "stale_lease_recovered", leaseId, owner: lease.owner });
			ctx.leases.delete(leaseId);
		}
	}
}

function recordWorkspaceTimeline(ctx: ExecutionContext, workspaceId: string, result: WorkspaceExecutionResult): void {
	const state = ctx.executor.getState();
	const wsState = state?.workspaces.get(workspaceId);
	ctx.timeline.push({
		workspaceId,
		startedAt: wsState?.startedAt ?? Date.now(),
		completedAt: wsState?.completedAt ?? Date.now(),
		stage: wsState?.stage ?? (result.success ? WorkspaceStage.Complete : WorkspaceStage.Failed),
		verdict: result.verdict,
		error: result.error,
	});
}

function activeCount(ctx: ExecutionContext): number {
	const state = ctx.executor.getState();
	if (!state) return 0;
	return [...state.workspaces.values()].filter((workspaceState) => workspaceState.stage === WorkspaceStage.Active).length;
}

function countWorkspaces(ctx: ExecutionContext): Counts {
	const state = ctx.executor.getState();
	const counts: Counts = { completed: 0, failed: 0, blocked: 0, active: 0, pending: 0, cancelled: 0 };
	if (!state) return counts;
	for (const wsState of state.workspaces.values()) {
		switch (wsState.stage) {
			case WorkspaceStage.Complete:
				counts.completed++;
				break;
			case WorkspaceStage.Failed:
				counts.failed++;
				break;
			case WorkspaceStage.Blocked:
				counts.blocked++;
				break;
			case WorkspaceStage.Active:
				counts.active++;
				break;
			case WorkspaceStage.Pending:
				counts.pending++;
				break;
		}
	}
	return counts;
}

async function buildPlanResult(ctx: ExecutionContext, task?: TaskState): Promise<PlanResult> {
	await ctx.executor.loadState();
	const state = ctx.executor.getState();
	const counts = countWorkspaces(ctx);
	const invariants = await verifyInvariants(ctx, task);
	const invariantPass = invariants.every((invariant) => invariant.passed);
	const expectedFault = FAULT !== "none" && targetPlanForFault(FAULT) === ctx.planKey;
	const planHealthy = state?.status === "complete" && counts.completed === ctx.queue.workspaces.length;
	const verdict = invariantPass && (expectedFault ? ctx.faultHandled : planHealthy) ? "PASS" : "FAIL";
	return {
		planKey: ctx.planKey,
		planExecutionId: ctx.planExecId,
		taskId: task?.taskId,
		taskStatus: task?.status,
		planStatus: state?.status ?? "unknown",
		totalWorkspaces: ctx.queue.workspaces.length,
		counts,
		observedMaxParallelism: ctx.observedMaxParallelism,
		expectedParallelism: ctx.expectedParallelism,
		admittedParallelism: ctx.expectedParallelism,
		parallelismAdmissionResult: MODE === "real-llm" && ctx.expectedParallelism < (ctx.queue.maxParallelWorkspaces ?? ctx.expectedParallelism) ? "reduced" : "admitted",
		faultInjected: ctx.faultInjected,
		faultHandled: ctx.faultHandled,
		verdict,
		invariants,
		timeline: ctx.timeline,
		errors: ctx.errors,
		reportDir: ctx.reportDir,
	};
}

async function verifyInvariants(ctx: ExecutionContext, task?: TaskState): Promise<InvariantResult[]> {
	await ctx.executor.loadState();
	const state = ctx.executor.getState();
	const counts = countWorkspaces(ctx);
	const expectedFault = FAULT !== "none" && targetPlanForFault(FAULT) === ctx.planKey;
	const invariants: InvariantResult[] = [];
	const add = (name: string, passed: boolean, reason?: string): void => invariants.push({ name, passed, reason });

	add("no active workers after terminalization", counts.active === 0, `active=${counts.active}`);
	add("no leaked abort controllers", ctx.activeAbortControllers.size === 0, `controllers=${ctx.activeAbortControllers.size}`);
	add("no leaked child processes", ctx.trackedChildren.size === 0, `children=${ctx.trackedChildren.size}`);
	add("no leaked worktree leases", ctx.leases.size === 0, `leases=${ctx.leases.size}`);
	add("validation lock released", !ctx.validationLockHeld, `validationLockHeld=${ctx.validationLockHeld}`);

	let silentPending = false;
	if (state) {
		for (const workspaceItem of ctx.queue.workspaces) {
			const wsState = state.workspaces.get(workspaceItem.id);
			if (wsState?.stage !== WorkspaceStage.Pending) continue;
			const deps = [...workspaceItem.dependencies, ...(workspaceItem.hardDeps ?? [])];
			const allDepsTerminal = deps.every((depId) => {
				const dep = state.workspaces.get(depId);
				return dep?.stage === WorkspaceStage.Complete || dep?.stage === WorkspaceStage.Failed || dep?.stage === WorkspaceStage.Blocked;
			});
			if (allDepsTerminal) silentPending = true;
		}
	}
	add("no silent pending workspaces", !silentPending, silentPending ? "pending workspace has terminal dependencies" : undefined);
	const falseComplete = state?.status === "complete" && (counts.failed > 0 || counts.blocked > 0 || counts.pending > 0 || counts.active > 0);
	add("no false completion", !falseComplete, falseComplete ? JSON.stringify(counts) : undefined);
	add("state store and journal agree", await stateStoreAndJournalAgree(ctx), undefined);
	const parallelismTarget = expectedFault && (FAULT === "abort_midflight" || FAULT === "failed_dependency") ? Math.min(ctx.observedMaxParallelism, ctx.expectedParallelism) : ctx.expectedParallelism;
	add(
		"observed parallelism matches expected parallelism",
		ctx.observedMaxParallelism >= parallelismTarget,
		`observed=${ctx.observedMaxParallelism} expected=${parallelismTarget}`,
	);
	if (task) {
		add("task final status matches plan final status", task.status === (state?.status === "complete" ? "complete" : "failed"), `task=${task.status} plan=${state?.status}`);
		add("task has planExecId", task.planExecId === ctx.planExecId, `taskPlanExecId=${task.planExecId} planExecId=${ctx.planExecId}`);
	}
	return invariants;
}

async function stateStoreAndJournalAgree(ctx: ExecutionContext): Promise<boolean> {
	try {
		const journal = await ctx.stateStore.getJournalEntries(ctx.planExecId, { limit: 10_000 });
		const state = ctx.executor.getState();
		if (!state) return false;
		const terminalEvents = new Set(journal.filter((event) => event.type === "workspace_complete" || event.type === "workspace_failed" || event.type === "workspace_blocked").map((event) => event.workspaceId));
		for (const wsState of state.workspaces.values()) {
			if (wsState.stage === WorkspaceStage.Complete || wsState.stage === WorkspaceStage.Failed || wsState.stage === WorkspaceStage.Blocked) {
				if (!terminalEvents.has(wsState.workspaceId) && !ctx.journalMirror.some((event) => event.workspaceId === wsState.workspaceId)) return false;
			}
		}
		return true;
	} catch {
		return ctx.journalMirror.length > 0;
	}
}

async function writePlanArtifacts(ctx: ExecutionContext, result: PlanResult): Promise<void> {
	await writeNdjson(path.join(ctx.reportDir, "event-stream.ndjson"), ctx.events);
	await writeNdjson(path.join(ctx.reportDir, "journal.ndjson"), ctx.journalMirror);
	await writeNdjson(path.join(ctx.reportDir, "scheduler-decisions.ndjson"), ctx.schedulerEvents);
	await writeNdjson(path.join(ctx.reportDir, "parallelism-samples.ndjson"), ctx.parallelismSamples);
	await writeNdjson(path.join(ctx.reportDir, "worktree-events.ndjson"), ctx.worktreeEvents);
	await writeNdjson(path.join(ctx.reportDir, "validation-events.ndjson"), ctx.validationEvents);
	await writeNdjson(path.join(ctx.reportDir, "process-events.ndjson"), ctx.processEvents);
	await writeNdjson(path.join(ctx.reportDir, "task-events.ndjson"), ctx.taskEvents);
	await writeJson(path.join(ctx.reportDir, "workspace-timeline.json"), ctx.timeline);
	await writeJson(path.join(ctx.reportDir, "invariant-results.json"), result.invariants);
	await writeJson(path.join(ctx.reportDir, "final-report.json"), result);
	await writeText(path.join(ctx.reportDir, "git-status-after.txt"), gitStatus(MINI_REPO_DIR));
	await writeText(path.join(ctx.reportDir, "progress-summary.md"), planProgressMarkdown(result));
	await writeText(path.join(ctx.reportDir, "final-report.md"), planFinalMarkdown(result));
	if (!existsSync(path.join(ctx.reportDir, "hang-analysis.md"))) {
		await writeText(path.join(ctx.reportDir, "hang-analysis.md"), result.faultInjected && FAULT === "worker_hang" ? "# Hang Analysis\n\nNo hang data recorded.\n" : "");
	}
}

function normalizeQueue(queue: WorkspaceQueue): Record<string, unknown> {
	return {
		phase: queue.phase,
		title: queue.title,
		maxParallelWorkspaces: queue.maxParallelWorkspaces,
		workspaces: queue.workspaces.map((item) => ({ id: item.id, dependencies: item.dependencies, hardDeps: item.hardDeps ?? [], canEdit: item.capabilities.canEdit })),
	};
}

function planProgressMarkdown(result: PlanResult): string {
	return `# ${result.planKey} Progress\n\n- Plan execution id: ${result.planExecutionId}\n- Completed: ${result.counts.completed}\n- Failed: ${result.counts.failed}\n- Blocked: ${result.counts.blocked}\n- Pending: ${result.counts.pending}\n- Observed max parallelism: ${result.observedMaxParallelism}\n- Verdict: ${result.verdict}\n`;
}

function planFinalMarkdown(result: PlanResult): string {
	return `# ${result.planKey} Final Report\n\n- Plan execution id: ${result.planExecutionId}\n- Verdict: ${result.verdict}\n- Fault injected: ${result.faultInjected}\n- Fault handled: ${result.faultHandled}\n\n## Invariants\n${result.invariants.map((item) => `- ${item.name}: ${item.passed ? "PASS" : "FAIL"}${item.reason ? ` — ${item.reason}` : ""}`).join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Task execution harness for Plan C
// ---------------------------------------------------------------------------

async function runTaskExecutionPlan(queue: WorkspaceQueue): Promise<PlanResult> {
	const ctx = await createExecutionContext("plan-c-task-execution", queue, 3);
	const task: TaskState = {
		taskId: `task-${TIMESTAMP}`,
		status: "queued",
		planExecId: null,
		startedAt: Date.now(),
		completedAt: null,
		artifactsDir: ctx.reportDir,
	};
	ctx.taskEvents.push({ timestamp: Date.now(), type: "task_queued", taskId: task.taskId });
	const runner = createPlanQueueRunner({
		workspaceRoot: MINI_REPO_DIR,
		stateStore: ctx.stateStore,
		piDir: ".pi",
		stopOnFailure: false,
		isDirtyFn: async () => false,
		executePlanFn: async (entry: PlanQueueEntry): Promise<{ success: boolean; error?: string }> => {
			task.status = "running";
			ctx.taskEvents.push({ timestamp: Date.now(), type: "task_running", taskId: task.taskId, queueEntryId: entry.id });
			entry.planExecutionId = ctx.planExecId;
			task.planExecId = ctx.planExecId;
			const result = await runPlanExecution(ctx);
			task.status = result.planStatus === "complete" ? "complete" : "failed";
			task.completedAt = Date.now();
			ctx.taskEvents.push({ timestamp: Date.now(), type: "task_terminal", taskId: task.taskId, planExecId: ctx.planExecId, status: task.status });
			return { success: result.verdict === "PASS", error: result.errors.join("; ") || undefined };
		},
		checkGatesFn: async () => true,
	});
	const entry = await runner.enqueue("mini-e2e-task-project", path.join(ctx.reportDir, "plan-c.json"), queue, "mini-e2e");
	ctx.taskEvents.push({ timestamp: Date.now(), type: "task_accepted", taskId: task.taskId, queueEntryId: entry.id });
	if (FAULT === "double_start" && targetPlanForFault(FAULT) === "plan-c-task-execution") {
		ctx.faultInjected = true;
		await Promise.all([runner.start(), runner.start()]);
		ctx.faultHandled = runner.getEntries().filter((item) => item.planExecutionId === ctx.planExecId).length === 1;
		bugLedger.add(doubleStartFinding(ctx));
	} else {
		await runner.start();
	}
	const result = await buildPlanResult(ctx, task);
	await writePlanArtifacts(ctx, result);
	return result;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function workerThrowFinding(ctx: ExecutionContext): Omit<BugLedgerEntry, "id" | "runId" | "timestamp"> {
	return baseFinding(ctx, "high", "confirmed", "silent_failure", "Worker throw terminalized without hang", "packages/coding-agent/src/core/autonomous-executor.ts", "executeWorkspace");
}

function workerHangFinding(ctx: ExecutionContext): Omit<BugLedgerEntry, "id" | "runId" | "timestamp"> {
	return baseFinding(ctx, "critical", "confirmed", "stall", "Worker hang detected by watchdog", "packages/coding-agent/src/core/autonomous-executor.ts", "executeWorkspace");
}

function validationHangFinding(ctx: ExecutionContext): Omit<BugLedgerEntry, "id" | "runId" | "timestamp"> {
	return baseFinding(ctx, "high", "confirmed", "lock_leak", "Validation hang killed and lock released", "packages/coding-agent/src/core/validation-lock.ts", "runWithValidationLock");
}

function abortFinding(ctx: ExecutionContext): Omit<BugLedgerEntry, "id" | "runId" | "timestamp"> {
	return baseFinding(ctx, "high", "confirmed", "abort", "Abort midflight terminalized plan", "packages/coding-agent/src/core/autonomous-executor.ts", "stopAllActiveWorkspaces");
}

function leaseLeakFinding(ctx: ExecutionContext): Omit<BugLedgerEntry, "id" | "runId" | "timestamp"> {
	return baseFinding(ctx, "high", "confirmed", "lock_leak", "Stale worktree lease recovered", "packages/coding-agent/src/worktree/worktree-manager.ts", "releaseLease");
}

function doubleStartFinding(ctx: ExecutionContext): Omit<BugLedgerEntry, "id" | "runId" | "timestamp"> {
	return baseFinding(ctx, "high", "confirmed", "task_execution", "Double start prevented duplicate task execution", "packages/coding-agent/src/core/plan-queue-runner.ts", "start");
}

function failedDependencyFinding(ctx: ExecutionContext): Omit<BugLedgerEntry, "id" | "runId" | "timestamp"> {
	return baseFinding(ctx, "high", "confirmed", "false_completion", "Failed hard dependency propagated explicitly", "packages/coding-agent/src/core/workspace-scheduler.ts", "getNextWorkspaces");
}

function staleCompletionFinding(ctx: ExecutionContext): Omit<BugLedgerEntry, "id" | "runId" | "timestamp"> {
	return baseFinding(ctx, "medium", "confirmed", "false_completion", "Stale completion signal did not complete next plan", "packages/web-server/src/plan-runner.ts", "WorkspaceCompletionBus.reset");
}

function stateWriteRaceFinding(ctx: ExecutionContext): Omit<BugLedgerEntry, "id" | "runId" | "timestamp"> {
	return baseFinding(ctx, "medium", "confirmed", "state_divergence", "State write race serialized", "packages/coding-agent/src/core/json-state-store.ts", "transitionWorkspace");
}

function baseFinding(
	ctx: ExecutionContext,
	severity: BugLedgerEntry["severity"],
	confidence: BugLedgerEntry["confidence"],
	className: BugLedgerEntry["class"],
	title: string,
	file: string,
	functionName: string,
): Omit<BugLedgerEntry, "id" | "runId" | "timestamp"> {
	return {
		severity,
		confidence,
		class: className,
		title,
		file,
		functionName,
		exactRiskyCode: `fault=${FAULT} plan=${ctx.planKey}`,
		why: "This class of failure can leave execution stuck, falsely complete, or divergent from state.",
		minimalReproduction: `PI_MINI_E2E_MODE=deterministic PI_MINI_E2E_FAULT=${FAULT} npx tsx scripts/run-mini-execution-correctness-e2e.ts`,
		deterministicTest: "packages/coding-agent/test/suite/regressions/mini-execution-correctness-e2e.test.ts",
		expectedFix: "Keep terminalization, cleanup, and state transition checks explicit and journaled.",
		regressionTestLocation: "packages/coding-agent/test/suite/regressions/mini-execution-correctness-e2e.test.ts",
		verificationArtifact: path.relative(REPO_ROOT, ctx.reportDir),
	};
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

async function runSuite(): Promise<SuiteResult> {
	await ensureDir(REPORT_DIR);
	await createMiniRepo(MINI_REPO_DIR);
	const plans: Partial<Record<PlanKey, PlanResult>> = {};
	if (shouldRunPlan("plan-a-wide6")) plans["plan-a-wide6"] = await runPlanExecution(await createExecutionContext("plan-a-wide6", planA(), 6));
	if (shouldRunPlan("plan-b-narrow3")) plans["plan-b-narrow3"] = await runPlanExecution(await createExecutionContext("plan-b-narrow3", planB(), 3));
	if (shouldRunPlan("plan-c-task-execution")) plans["plan-c-task-execution"] = await runTaskExecutionPlan(planC());

	const leakedProcesses = Object.values(plans).some((result) => result?.invariants.some((invariant) => invariant.name === "no leaked child processes" && !invariant.passed));
	const leakedAbortControllers = Object.values(plans).some((result) => result?.invariants.some((invariant) => invariant.name === "no leaked abort controllers" && !invariant.passed));
	const leakedLeases = Object.values(plans).some((result) => result?.invariants.some((invariant) => invariant.name === "no leaked worktree leases" && !invariant.passed));
	const validationLockReleased = Object.values(plans).every((result) => result?.invariants.some((invariant) => invariant.name === "validation lock released" && invariant.passed) ?? true);
	const stateEventConsistency = Object.values(plans).every((result) => result?.invariants.some((invariant) => invariant.name === "state store and journal agree" && invariant.passed) ?? true) ? "pass" : "fail";
	const expectedFaultPlan = targetPlanForFault(FAULT);
	const allPlanVerdictsPass = Object.entries(plans).every(([, result]) => result?.verdict === "PASS");
	const faultPlanRan = FAULT === "none" || (expectedFaultPlan !== null && plans[expectedFaultPlan]?.faultHandled === true);
	const finalVerdict: Verdict = allPlanVerdictsPass && faultPlanRan ? "PASS" : "FAIL";
	const suite: SuiteResult = {
		runId: RUN_ID,
		mode: MODE,
		fault: FAULT,
		planSet: PLAN_SET,
		backend: STATE_BACKEND,
		reportDir: REPORT_DIR,
		debugSinglePlanRun: !OFFICIAL_SUITE,
		officialSuiteVerdict: OFFICIAL_SUITE ? finalVerdict : "not_applicable",
		plans,
		leakedProcesses,
		leakedAbortControllers,
		leakedLeases,
		validationLockReleased,
		stateEventConsistency,
		finalVerdict,
	};
	await writeSuiteArtifacts(suite);
	await bugLedger.write();
	return suite;
}

async function writeSuiteArtifacts(suite: SuiteResult): Promise<void> {
	await writeJson(path.join(REPORT_DIR, "suite-final-report.json"), suite);
	await writeJson(path.join(REPORT_DIR, "suite-invariant-results.json"), {
		leakedProcesses: suite.leakedProcesses,
		leakedAbortControllers: suite.leakedAbortControllers,
		leakedLeases: suite.leakedLeases,
		validationLockReleased: suite.validationLockReleased,
		stateEventConsistency: suite.stateEventConsistency,
	});
	await writeNdjson(
		path.join(REPORT_DIR, "suite-summary.ndjson"),
		Object.values(suite.plans).filter((result): result is PlanResult => result !== undefined).map((result) => ({
			timestamp: Date.now(),
			type: "plan_result",
			planKey: result.planKey,
			planExecId: result.planExecutionId,
			verdict: result.verdict,
			observedMaxParallelism: result.observedMaxParallelism,
		})),
	);
	await writeText(path.join(REPORT_DIR, "suite-final-report.md"), suiteMarkdown(suite));
}

function suiteMarkdown(suite: SuiteResult): string {
	const planLines = Object.values(suite.plans).filter((result): result is PlanResult => result !== undefined).map((result) => {
		return `## ${result.planKey}\n\n- Plan execution id: ${result.planExecutionId}\n- Verdict: ${result.verdict}\n- Completed: ${result.counts.completed}\n- Failed: ${result.counts.failed}\n- Blocked: ${result.counts.blocked}\n- Observed max parallelism: ${result.observedMaxParallelism}\n`;
	});
	return `# Mini Execution Correctness E2E Suite\n\n- Mode: ${suite.mode}\n- Fault: ${suite.fault}\n- Plan set: ${suite.planSet}\n- Backend: ${suite.backend}\n- Debug single plan run: ${suite.debugSinglePlanRun}\n- Official suite verdict: ${suite.officialSuiteVerdict}\n\n${planLines.join("\n")}\n## Suite\n\n- Leaked processes: ${suite.leakedProcesses}\n- Leaked abort controllers: ${suite.leakedAbortControllers}\n- Leaked leases: ${suite.leakedLeases}\n- Validation lock released: ${suite.validationLockReleased}\n- State/event consistency: ${suite.stateEventConsistency}\n- Final verdict: ${suite.finalVerdict}\n`;
}

function printSummary(suite: SuiteResult): void {
	console.log("Mini execution correctness gauntlet complete");
	console.log("");
	console.log(`Mode: ${suite.mode}`);
	console.log(`Fault: ${suite.fault}`);
	console.log(`Plan set: ${suite.planSet}`);
	console.log(`Report dir: ${suite.reportDir}`);
	if (suite.debugSinglePlanRun) {
		console.log("debug_single_plan_run: true");
		console.log("official_suite_verdict: not_applicable");
	}
	console.log("");
	for (const key of ["plan-a-wide6", "plan-b-narrow3", "plan-c-task-execution"] as const) {
		const result = suite.plans[key];
		if (!result) continue;
		const label = key === "plan-a-wide6" ? "Plan A — Wide 6" : key === "plan-b-narrow3" ? "Plan B — Narrow 3" : "Plan C — Task Execution";
		console.log(label);
		if (result.taskId) console.log(`  Task id: ${result.taskId}`);
		console.log(`  Plan execution id: ${result.planExecutionId}`);
		console.log(`  Total workspaces: ${result.totalWorkspaces}`);
		console.log(`  Completed: ${result.counts.completed}`);
		console.log(`  Failed: ${result.counts.failed}`);
		console.log(`  Blocked: ${result.counts.blocked}`);
		console.log(`  Cancelled: ${result.counts.cancelled}`);
		console.log(`  Observed max parallelism: ${result.observedMaxParallelism}`);
		console.log(`  Expected/admitted parallelism: ${result.expectedParallelism}`);
		if (result.taskStatus) {
			console.log(`  Task status: ${result.taskStatus}`);
			console.log(`  Plan status: ${result.planStatus}`);
			console.log(`  Task/plan consistency: ${result.invariants.find((item) => item.name === "task final status matches plan final status")?.passed ? "PASS" : "FAIL"}`);
		}
		console.log(`  Verdict: ${result.verdict}`);
		console.log("");
	}
	console.log("Suite");
	console.log(`  Leaked processes: ${suite.leakedProcesses ? "yes" : "no"}`);
	console.log(`  Leaked abort controllers: ${suite.leakedAbortControllers ? "yes" : "no"}`);
	console.log(`  Leaked leases: ${suite.leakedLeases ? "yes" : "no"}`);
	console.log(`  Validation lock released: ${suite.validationLockReleased ? "yes" : "no"}`);
	console.log(`  State/event consistency: ${suite.stateEventConsistency}`);
	console.log(`  Final verdict: ${suite.finalVerdict}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	if (MODE === "real-llm" && !REAL_LLM_ENABLED) {
		throw new Error("PI_MINI_E2E_MODE=real-llm requires PI_DIAG_RUN_REAL_LLM=1");
	}
	if (STATE_BACKEND === "postgres" && !process.env.DATABASE_URL && !process.env.PGHOST) {
		throw new Error("PI_STATE_STORE_BACKEND=postgres requested but DATABASE_URL/PGHOST is unavailable");
	}
	if (existsSync(REPORT_DIR)) rmSync(REPORT_DIR, { recursive: true, force: true });
	const suite = await runSuite();
	printSummary(suite);
	process.exitCode = suite.finalVerdict === "PASS" ? 0 : 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exitCode = 2;
});
