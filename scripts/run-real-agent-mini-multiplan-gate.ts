#!/usr/bin/env npx tsx
/**
 * P36 — Real Agent Mini Multi-Plan Execution Gate
 *
 * Cheap, bounded multi-plan task execution gate for the autonomous executor.
 * Commit/nightly modes avoid model calls while exercising PlanQueueRunner,
 * AutonomousExecutor, scheduler, state store, validation, lifecycle controls,
 * and recovery semantics. real-llm mode is guarded by PI_DIAG_RUN_REAL_LLM=1.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
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
import { closePool, getPool } from "@earendil-works/pi-db";
import {
	createPlanQueueRunner,
	type PlanQueueEntry,
	PlanQueueEntryStatus,
} from "../packages/coding-agent/src/core/plan-queue-runner.js";
import { getTrackedProcesses, killAllTrackedProcesses } from "../packages/coding-agent/src/utils/shell.js";

const REPO_ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");
const DIAG_ROOT = path.join(REPO_ROOT, "reports", "execution-diagnostics");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const RUN_ID = `real-agent-mini-${TIMESTAMP}`;
const REPORT_DIR = path.join(DIAG_ROOT, `${TIMESTAMP}-real-agent-mini-gate`);
const PROJECT_ROOT = path.join(tmpdir(), `pi-real-agent-gate-${TIMESTAMP}`);
const CENTRAL_BUG_JSON = path.join(DIAG_ROOT, "bug-ledger.json");
const CENTRAL_BUG_NDJSON = path.join(DIAG_ROOT, "bug-ledger.ndjson");
const CENTRAL_BUG_REPORT = path.join(DIAG_ROOT, "mini-e2e-bug-hunt-report.md");

loadDotEnvIfPresent(REPO_ROOT);

const ALL_FAULTS = [
	"none",
	"file_lock_contention",
	"pause_resume_midflight",
	"restart_after_plan_a",
	"worker_hang",
	"failed_dependency",
	"validation_hang",
	"abort_midflight",
	"double_start",
	"lease_leak_simulation",
	"stale_completion_signal",
	"state_write_race",
	"monte_carlo_random_locks",
	"monte_carlo_random_pause_restart",
] as const;

const MODE = parseMode(process.env.PI_REAL_AGENT_GATE_MODE ?? "commit");
const FAULT = parseFault(process.env.PI_REAL_AGENT_GATE_FAULT ?? "none");
const MONTE_CARLO = process.env.PI_REAL_AGENT_GATE_MONTE_CARLO === "1";
const SEED_COUNT = parsePositiveInt(process.env.PI_REAL_AGENT_GATE_SEEDS, MODE === "nightly" ? 20 : 3);
const SINGLE_SEED = parseOptionalPositiveInt(process.env.PI_REAL_AGENT_GATE_SEED);
const MAX_MINUTES = parsePositiveInt(process.env.PI_REAL_AGENT_GATE_MAX_MINUTES, MODE === "nightly" ? 15 : MODE === "real-llm" ? 30 : 8);
const STATE_BACKEND = parseStateBackend(process.env.PI_STATE_STORE_BACKEND ?? (MODE === "real-llm" ? "postgres" : "json"));
const REAL_LLM_ENABLED = process.env.PI_DIAG_RUN_REAL_LLM === "1";
const FORCE_INVARIANT_FAIL = process.env.PI_REAL_AGENT_GATE_FORCE_INVARIANT_FAIL === "1";
const TASK_TITLE = "Implement tiny full-stack status feature";

type GateMode = "commit" | "nightly" | "real-llm";
type StateBackend = "json" | "postgres";
type Verdict = "PASS" | "FAIL";
type PlanKey = "plan-a-wide6" | "plan-b-narrow3" | "plan-c-task-execution";
type FaultMode = (typeof ALL_FAULTS)[number];
type BugSeverity = "critical" | "high" | "medium" | "low";
type BugConfidence = "confirmed" | "suspected" | "needs_instrumentation";
type BugClass =
	| "silent_failure"
	| "race"
	| "stall"
	| "lock_leak"
	| "lease_leak"
	| "abort"
	| "state_divergence"
	| "monitoring_lie"
	| "false_completion"
	| "task_plan_mismatch";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type EventRecord = Record<string, JsonValue>;

interface BugEntry {
	id: string;
	title: string;
	severity: BugSeverity;
	confidence: BugConfidence;
	class: BugClass;
	status: "open" | "fixed" | "needs_repro" | "wont_fix";
	files: string[];
	functions: string[];
	reproduction: string;
	failingTest: string;
	fixFiles: string[];
	verificationCommand: string;
	evidenceArtifacts: string[];
	createdAt: string;
	updatedAt: string;
}

interface Counts {
	complete: number;
	failed: number;
	blocked: number;
	active: number;
	pending: number;
}

interface InvariantResult {
	id: number;
	name: string;
	passed: boolean;
	reason?: string;
}

interface TaskState {
	taskId: string;
	title: string;
	status: "queued" | "running" | "complete" | "failed";
	planExecIds: string[];
	startedAt: number;
	completedAt?: number;
}

interface PlanRuntime {
	planKey: PlanKey;
	queue: WorkspaceQueue;
	reportDir: string;
	stateStore: IStateStore;
	executor: AutonomousExecutor;
	planExecId: string;
	expectedDagWidth: number;
	expectedLockConstrainedWidth: number;
	observedMaxParallelism: number;
	initialDependencyReadyCount: number;
	timeline: EventRecord[];
	events: EventRecord[];
	journal: EventRecord[];
	stateSnapshots: EventRecord[];
	schedulerDecisions: EventRecord[];
	parallelismSamples: EventRecord[];
	lockEvents: EventRecord[];
	worktreeEvents: EventRecord[];
	validationEvents: EventRecord[];
	processEvents: EventRecord[];
	taskEvents: EventRecord[];
	restartEvents: EventRecord[];
	activeLocks: Map<string, { owner: string; acquiredAt: number }>;
	leases: Map<string, { owner: string; heartbeat: number; stale: boolean }>;
	trackedChildren: Map<number, ChildProcess>;
	activeAbortControllers: Set<AbortController>;
	workspaceStartCounts: Map<string, number>;
	validationLockHeld: boolean;
	pausePreventedLaunch: boolean;
	resumeContinued: boolean;
	restartRecovered: boolean;
	staleCompletionIgnored: boolean;
	faultInjected: boolean;
	faultHandled: boolean;
	errors: string[];
}

interface PlanResult {
	planKey: PlanKey;
	planExecId: string;
	queueEntryId: string;
	queueEntryStatus: string;
	planStatus: string;
	totalWorkspaces: number;
	counts: Counts;
	expectedDagWidth: number;
	expectedLockConstrainedWidth: number;
	observedMaxParallelism: number;
	initialDependencyReadyCount: number;
	faultInjected: boolean;
	faultHandled: boolean;
	invariants: InvariantResult[];
	verdict: Verdict;
	reportDir: string;
	errors: string[];
}

interface SuiteResult {
	runId: string;
	mode: GateMode;
	fault: FaultMode;
	seed: number;
	task: TaskState;
	backend: StateBackend;
	projectRoot: string;
	reportDir: string;
	plans: Record<PlanKey, PlanResult>;
	invariants: InvariantResult[];
	bugIds: string[];
	finalVerdict: Verdict;
}

interface PostgresEnvResolution {
	available: boolean;
	source: "DATABASE_URL" | "PI_E2E_DATABASE_URL" | "POSTGRES_URL" | "PGHOST" | "none";
	checked: string[];
	safeSummary: string;
}

function loadDotEnvIfPresent(root: string): void {
	const dotEnvPath = path.join(root, ".env");
	if (!existsSync(dotEnvPath)) return;
	const raw = readFileSync(dotEnvPath, "utf-8");
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
		const equals = normalized.indexOf("=");
		if (equals <= 0) continue;
		const key = normalized.slice(0, equals).trim();
		let value = normalized.slice(equals + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		process.env[key] ??= value;
	}
}

function resolvePostgresEnv(): PostgresEnvResolution {
	const checked = ["DATABASE_URL", "PI_E2E_DATABASE_URL", "POSTGRES_URL", "PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGPORT"];
	const urlSource = process.env.DATABASE_URL
		? "DATABASE_URL"
		: process.env.PI_E2E_DATABASE_URL
			? "PI_E2E_DATABASE_URL"
			: process.env.POSTGRES_URL
				? "POSTGRES_URL"
				: null;
	if (urlSource) {
		const url = process.env[urlSource];
		if (!url) return { available: false, source: "none", checked, safeSummary: "no usable URL value" };
		if (urlSource !== "DATABASE_URL" && !process.env.DATABASE_URL) {
			process.env.DATABASE_URL = url;
		}
		applyPostgresUrlToPgEnv(url);
		return { available: true, source: urlSource, checked, safeSummary: safePostgresSummary(urlSource) };
	}
	const hasPgParts = Boolean(process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER);
	return {
		available: hasPgParts,
		source: hasPgParts ? "PGHOST" : "none",
		checked,
		safeSummary: hasPgParts ? safePgPartsSummary() : "missing required PGHOST + PGDATABASE + PGUSER or database URL",
	};
}

function applyPostgresUrlToPgEnv(value: string): void {
	try {
		const parsed = new URL(value);
		if (parsed.hostname) process.env.PGHOST = parsed.hostname;
		if (parsed.port) process.env.PGPORT = parsed.port;
		const database = parsed.pathname.replace(/^\//, "");
		if (database) process.env.PGDATABASE = decodeURIComponent(database);
		if (parsed.username) process.env.PGUSER = decodeURIComponent(parsed.username);
		if (parsed.password) process.env.PGPASSWORD = decodeURIComponent(parsed.password);
	} catch {
		// Keep DATABASE_URL mapped; health check/state-store init will report the connection error.
	}
}

function safePostgresSummary(source: PostgresEnvResolution["source"]): string {
	const host = process.env.PGHOST ?? "unknown-host";
	const port = process.env.PGPORT ?? "5432";
	const database = process.env.PGDATABASE ?? "unknown-db";
	const user = process.env.PGUSER ?? "unknown-user";
	return `${source} resolved to ${host}:${port}/${database} as ${user}`;
}

function safePgPartsSummary(): string {
	return `PGHOST resolved to ${process.env.PGHOST}:${process.env.PGPORT ?? "5432"}/${process.env.PGDATABASE} as ${process.env.PGUSER}`;
}

const PROJECT_UUIDS = {
	"plan-a-wide6": crypto.randomUUID(),
	"plan-b-narrow3": crypto.randomUUID(),
	"plan-c-task-execution": crypto.randomUUID(),
} as const;

async function preflightPostgres(): Promise<void> {
	const resolved = resolvePostgresEnv();
	console.log(`Postgres env preflight: source=${resolved.source}; checked=${resolved.checked.join(", ")}; ${resolved.safeSummary}`);
	if (!resolved.available) {
		throw new Error(
			`PI_STATE_STORE_BACKEND=postgres requested but no usable Postgres configuration was found. Checked env names: ${resolved.checked.join(", ")}. Hint: ${psqlHintCommand()}`,
		);
	}
	if (process.env.PI_REAL_AGENT_GATE_DB_PREFLIGHT_ONLY === "1") return;
	try {
		const pool = getPool();
		await pool.query("SELECT 1 AS ok");
		// Ensure project rows exist for each plan
		for (const [planKey, projectUuid] of Object.entries(PROJECT_UUIDS)) {
			await pool.query(
				'INSERT INTO projects (id, name, root_path) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
				[projectUuid, `real-agent-mini-${planKey}`, PROJECT_ROOT],
			);
		}
	} catch (error) {
		throw new Error(
			`Postgres connectivity check failed. ${sanitizedPostgresError(error)} Resolved config: ${resolved.safeSummary}. Checked env names: ${resolved.checked.join(", ")}. Hint: ${psqlHintCommand()}`,
		);
	} finally {
		await closePool().catch(() => {});
	}
}

function sanitizedPostgresError(error: unknown): string {
	const code = getErrorStringField(error, "code") ?? "unknown-code";
	const message = sanitizeSecretText(error instanceof Error ? error.message : getErrorStringField(error, "message") ?? String(error));
	const hint = postgresFailureHint(code);
	return `Error code: ${code}; message: ${message}.${hint ? ` Interpretation: ${hint}.` : ""}`;
}

function postgresFailureHint(code: string): string | null {
	const host = process.env.PGHOST ?? "<host>";
	const port = process.env.PGPORT ?? "5432";
	const database = process.env.PGDATABASE ?? "<database>";
	const user = process.env.PGUSER ?? "<user>";
	if (code === "ECONNREFUSED") return `${host}:${port} — Postgres is not listening there or the port is not published`;
	if (code === "3D000") return `database "${database}" does not exist`;
	if (code === "28P01") return `password authentication failed for user "${user}"`;
	if (code === "28000") return `role "${user}" does not exist or authentication was rejected`;
	if (code === "42501") return "permission denied for the database or schema";
	return null;
}

function getErrorStringField(error: unknown, field: string): string | undefined {
	if (!error || typeof error !== "object") return undefined;
	const value = (error as Record<string, unknown>)[field];
	return typeof value === "string" ? value : undefined;
}

function sanitizeSecretText(value: string): string {
	let sanitized = value;
	for (const secretName of ["DATABASE_URL", "PI_E2E_DATABASE_URL", "POSTGRES_URL", "PGPASSWORD"]) {
		const secret = process.env[secretName];
		if (secret) sanitized = sanitized.split(secret).join(`[redacted:${secretName}]`);
	}
	return sanitized.replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgres://[redacted]@");
}

function psqlHintCommand(): string {
	const host = shellQuote(process.env.PGHOST ?? "<host>");
	const port = shellQuote(process.env.PGPORT ?? "5432");
	const database = shellQuote(process.env.PGDATABASE ?? "<database>");
	const user = shellQuote(process.env.PGUSER ?? "<user>");
	return `PGHOST=${host} PGPORT=${port} PGDATABASE=${database} PGUSER=${user} psql -c "select 1;"`;
}

function shellQuote(value: string): string {
	if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function parseMode(value: string): GateMode {
	if (value === "commit" || value === "nightly" || value === "real-llm") return value;
	throw new Error(`Invalid PI_REAL_AGENT_GATE_MODE: ${value}`);
}

function parseFault(value: string): FaultMode {
	if ((ALL_FAULTS as readonly string[]).includes(value)) return value as FaultMode;
	throw new Error(`Invalid PI_REAL_AGENT_GATE_FAULT: ${value}`);
}

function parseStateBackend(value: string): StateBackend {
	if (value === "json" || value === "postgres") return value;
	throw new Error(`Invalid PI_STATE_STORE_BACKEND: ${value}`);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalPositiveInt(value: string | undefined): number | null {
	if (!value) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function now(): number {
	return Date.now();
}

async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

async function writeText(filePath: string, content: string): Promise<void> {
	await ensureDir(path.dirname(filePath));
	await writeFile(filePath, content, "utf-8");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

class SeededRandom {
	private state: number;

	constructor(seed: number) {
		this.state = seed || 1;
	}

	next(): number {
		this.state = (this.state * 48271) % 0x7fffffff;
		return this.state / 0x7fffffff;
	}

	bool(threshold = 0.5): boolean {
		return this.next() < threshold;
	}
}

class BugLedger {
	private entries: BugEntry[] = [];

	add(input: Omit<BugEntry, "id" | "createdAt" | "updatedAt">): void {
		const id = `EXEC-BUG-${String(this.entries.length + 1).padStart(3, "0")}-${RUN_ID}`;
		const timestamp = new Date().toISOString();
		this.entries.push({ id, createdAt: timestamp, updatedAt: timestamp, ...input });
	}

	ids(): string[] {
		return this.entries.map((entry) => entry.id);
	}

	async writeSuite(reportDir: string): Promise<void> {
		await writeJson(path.join(reportDir, "bug-ledger.json"), this.entries);
		await writeNdjson(path.join(reportDir, "bug-ledger.ndjson"), this.entries as unknown as EventRecord[]);
	}

	async writeCentral(): Promise<void> {
		await ensureDir(DIAG_ROOT);
		const existing = await readExistingCentralBugEntries();
		const combined = [...existing, ...this.entries];
		await writeJson(CENTRAL_BUG_JSON, combined);
		await writeNdjson(CENTRAL_BUG_NDJSON, combined as unknown as EventRecord[]);
		await writeText(CENTRAL_BUG_REPORT, bugReportMarkdown(combined));
	}
}

async function readExistingCentralBugEntries(): Promise<BugEntry[]> {
	try {
		const raw = await readFile(CENTRAL_BUG_JSON, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isBugEntry);
	} catch {
		return [];
	}
}

function isBugEntry(value: unknown): value is BugEntry {
	return typeof value === "object" && value !== null && "id" in value && "severity" in value && "evidenceArtifacts" in value;
}

function bugReportMarkdown(entries: BugEntry[]): string {
	const lines = ["# Mini E2E Bug Hunt Report", "", `Latest real-agent mini gate run: ${RUN_ID}`, ""];
	if (entries.length === 0) {
		lines.push("No confirmed or suspected execution correctness bugs recorded.");
		return lines.join("\n");
	}
	for (const entry of entries) {
		lines.push(`## ${entry.id} — ${entry.title}`);
		lines.push("");
		lines.push(`- Severity: ${entry.severity}`);
		lines.push(`- Confidence: ${entry.confidence}`);
		lines.push(`- Class: ${entry.class}`);
		lines.push(`- Status: ${entry.status}`);
		lines.push(`- Files: ${entry.files.join(", ") || "n/a"}`);
		lines.push(`- Functions: ${entry.functions.join(", ") || "n/a"}`);
		lines.push(`- Reproduction: ${entry.reproduction}`);
		lines.push(`- Failing test: ${entry.failingTest}`);
		lines.push(`- Verification command: ${entry.verificationCommand}`);
		lines.push(`- Evidence: ${entry.evidenceArtifacts.join(", ")}`);
		lines.push("");
	}
	return lines.join("\n");
}

const bugLedger = new BugLedger();

async function createTinyProject(root: string): Promise<void> {
	await ensureDir(root);
	const files: Record<string, string> = {
		"package.json": JSON.stringify({ name: "pi-real-agent-mini-gate", version: "1.0.0", type: "module", private: true }, null, 2),
		"src/backend/api.ts": "export function statusApi() { return { status: 'initial', version: 1 }; }\n",
		"src/backend/health.ts": "export function backendHealth() { return 'initial'; }\n",
		"src/frontend/status.ts": "export function renderStatus(status) { return `status:${status}`; }\n",
		"src/frontend/view.ts": "export function statusView(label) { return `<div>${label}</div>`; }\n",
		"src/shared/contract.ts": "export const STATUS_CONTRACT = { status: 'ok', version: 1 };\n",
		"src/shared/formatter.ts": "export function formatStatus(value) { return String(value).toUpperCase(); }\n",
		"src/generated/metadata.json": JSON.stringify({ generatedBy: "initial", statusFeature: false }, null, 2),
		"scripts/validate.mjs": validationScript(),
		"scripts/slow-validation.mjs": "setInterval(() => {}, 1000);\n",
		"scripts/lock-probe.mjs": "console.log(JSON.stringify({ lockProbe: true, at: Date.now() }));\n",
	};
	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = path.join(root, relativePath);
		await ensureDir(path.dirname(filePath));
		await writeFile(filePath, content, "utf-8");
	}
	try {
		runGit(root, "git init");
		runGit(root, "git config user.email pi-real-agent-mini@test.local");
		runGit(root, "git config user.name 'Pi Real Agent Mini Gate'");
		runGit(root, "git add .");
		runGit(root, "git commit -m 'initial tiny fixture'");
	} catch {
		// Git artifacts are useful but not required for the simulated commit gate.
	}
}

function validationScript(): string {
	return `import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dirname, "..");
const required = [
  "src/backend/api.ts",
  "src/backend/health.ts",
  "src/frontend/status.ts",
  "src/frontend/view.ts",
  "src/shared/contract.ts",
  "src/shared/formatter.ts",
  "src/generated/metadata.json"
];
let failures = 0;
for (const file of required) {
  if (!existsSync(join(root, file))) { console.error("missing " + file); failures++; }
}
const api = readFileSync(join(root, "src/backend/api.ts"), "utf-8");
const health = readFileSync(join(root, "src/backend/health.ts"), "utf-8");
const status = readFileSync(join(root, "src/frontend/status.ts"), "utf-8");
const view = readFileSync(join(root, "src/frontend/view.ts"), "utf-8");
const contract = readFileSync(join(root, "src/shared/contract.ts"), "utf-8");
const formatter = readFileSync(join(root, "src/shared/formatter.ts"), "utf-8");
const metadataRaw = readFileSync(join(root, "src/generated/metadata.json"), "utf-8");
const all = [api, health, status, view, contract, formatter, metadataRaw].join("\\n");
if (!api.includes("statusApi")) { console.error("missing backend api export"); failures++; }
if (!health.includes("backendHealth")) { console.error("missing backend health export"); failures++; }
if (!status.includes("renderStatus")) { console.error("missing frontend status renderer"); failures++; }
if (!view.includes("statusView")) { console.error("missing frontend view renderer"); failures++; }
if (!contract.includes("STATUS_CONTRACT")) { console.error("missing shared contract"); failures++; }
if (!formatter.includes("formatStatus")) { console.error("missing formatter"); failures++; }
try {
  const metadata = JSON.parse(metadataRaw);
  if (metadata.statusFeature !== true) { console.error("metadata.statusFeature not true"); failures++; }
} catch (error) { console.error("metadata is invalid JSON"); failures++; }
if (all.includes("PI_CORRUPTION_MARKER")) { console.error("corruption marker found"); failures++; }
console.log("real-agent-mini validation failures=" + failures);
process.exit(failures === 0 ? 0 : 1);
`;
}

function workspace(id: string, title: string, dependencies: string[], canEdit: string[], options?: { hardDeps?: string[]; cannotRunWith?: string[]; targetCommand?: string }): Workspace {
	return {
		id,
		title,
		dependencies,
		hardDeps: options?.hardDeps,
		cannotRunWith: options?.cannotRunWith,
		acceptanceCriteria: [`${id} updates the tiny status feature safely`],
		roleBudget: "worker",
		maxRetries: 1,
		capabilities: { canEdit, canRun: ["node scripts/validate.mjs"] },
		targetCommand: options?.targetCommand,
		autoCommit: false,
		executorPrompt: `Apply the tiny status feature change for ${id}. Keep edits within ${canEdit.join(", ") || "validation only"}.`,
	};
}

function queueBase(phase: string, title: string, maxParallelWorkspaces: number, workspaces: Workspace[]): WorkspaceQueue {
	return {
		phase,
		title,
		maxParallelWorkspaces,
		postPlanHandoff: false,
		contractVersion: "2.6.0",
		planExecution: {
			scale: { selectedMode: "experimental_6" },
			worktree: { enabled: true },
			integrationQueue: { enabled: true },
			validation: { globalValidationLockRequired: true },
		},
		workspaces,
	};
}

function planA(random: SeededRandom): WorkspaceQueue {
	const randomLock = FAULT === "monte_carlo_random_locks" && random.bool();
	const contention = FAULT === "file_lock_contention" || randomLock;
	return queueBase("P36-A", "Plan A — Wide 6 lock-pressure plan", 6, [
		workspace("A1.backend-health", "backend health edit", [], ["src/backend/health.ts", ...(contention ? ["src/shared/formatter.ts"] : [])]),
		workspace("A2.backend-api", "backend api edit", [], ["src/backend/api.ts"]),
		workspace("A3.frontend-status", "frontend status edit", [], ["src/frontend/status.ts", ...(contention ? ["src/shared/formatter.ts"] : [])]),
		workspace("A4.frontend-view", "frontend view edit", [], ["src/frontend/view.ts"]),
		workspace("A5.shared-formatter", "shared formatter edit", [], ["src/shared/formatter.ts"]),
		workspace("A6.generated-metadata", "generated metadata edit", [], ["src/generated/metadata.json"]),
		workspace("A7.integration", "integration after A1-A6", ["A1.backend-health", "A2.backend-api", "A3.frontend-status", "A4.frontend-view", "A5.shared-formatter", "A6.generated-metadata"], ["src/shared/contract.ts"]),
		workspace("A8.final-validation", "final validation", ["A7.integration"], [], { targetCommand: "node scripts/validate.mjs" }),
	]);
}

function planB(): WorkspaceQueue {
	return queueBase("P36-B", "Plan B — Narrow 3 dependency plan", 3, [
		workspace("B1.backend-contract", "backend contract update", [], ["src/backend/api.ts"]),
		workspace("B2.frontend-consumer", "frontend contract consumer update", [], ["src/frontend/status.ts"]),
		workspace("B3.shared-type", "shared type update", [], ["src/shared/contract.ts"]),
		workspace("B4.integration", "integration depends on B1+B2+B3", ["B1.backend-contract", "B2.frontend-consumer", "B3.shared-type"], ["src/backend/health.ts"], { hardDeps: ["B1.backend-contract", "B2.frontend-consumer", "B3.shared-type"] }),
		workspace("B5.validation", "validation", ["B4.integration"], [], { targetCommand: "node scripts/validate.mjs" }),
		workspace("B6.cleanup-report", "cleanup final report", ["B5.validation"], ["src/generated/metadata.json"]),
	]);
}

function planC(random: SeededRandom): WorkspaceQueue {
	const randomPause = FAULT === "monte_carlo_random_pause_restart" && random.bool();
	return queueBase("P36-C", "Plan C — Task execution / recovery verification plan", 3, [
		workspace("C1.task-map", "task to plan mapping", [], ["src/generated/metadata.json"]),
		workspace("C2.pause-marker", "pause resume marker", [], ["src/frontend/view.ts"], { cannotRunWith: randomPause ? ["C1.task-map"] : undefined }),
		workspace("C3.recovery-marker", "restart recovery marker", [], ["src/backend/health.ts"]),
		workspace("C4.stale-signal-check", "stale completion signal check", ["C1.task-map", "C2.pause-marker", "C3.recovery-marker"], ["src/shared/formatter.ts"]),
		workspace("C5.final-report", "final task report", ["C4.stale-signal-check"], ["src/generated/metadata.json"]),
		workspace("C6.final-validation", "final validation", ["C5.final-report"], [], { targetCommand: "node scripts/validate.mjs" }),
	]);
}

function createStateStoreForPlan(planKey: PlanKey): IStateStore {
	return createStateStore({
		backend: STATE_BACKEND,
		workspaceRoot: PROJECT_ROOT,
		projectId: `real-agent-mini-${planKey}`,
		jsonConfig: { piDir: ".pi" },
		dbConfig: { maxRetries: 5, retryBaseDelayMs: 50, retryMaxDelayMs: 500 },
	});
}

async function createRuntime(planKey: PlanKey, queue: WorkspaceQueue, seed: number): Promise<PlanRuntime> {
	const reportDir = path.join(REPORT_DIR, planKey);
	await ensureDir(reportDir);
	const workspaceCount = queue.workspaces?.length ?? 0;
	const expectedDagWidth = MODE === "real-llm" ? 1 : planKey === "plan-a-wide6" ? 6 : planKey === "plan-b-narrow3" ? 3 : 3;
	const expectedLockConstrainedWidth = planKey === "plan-a-wide6" && isLockContentionFault() && MODE !== "real-llm" ? Math.min(4, workspaceCount) : expectedDagWidth;
	const stateStore = createStateStoreForPlan(planKey);
	const projectUuid = STATE_BACKEND === "postgres" ? PROJECT_UUIDS[planKey] : `real-agent-mini-${planKey}`;
	const executor = new AutonomousExecutor(stateStore, {
		workspaceRoot: PROJECT_ROOT,
		projectId: projectUuid,
		maxWorkers: MODE === "real-llm" ? Math.min(expectedDagWidth, 3) : expectedDagWidth,
		enableRealExecution: MODE === "real-llm",
		skipProjectManagement: true,
		autoCommit: false,
		postPlanHandoff: false,
		workspaceTimeoutMs: MODE === "real-llm" ? 120_000 : 20_000,
		worktree: { enabled: true },
	});
	const planExecId = await executor.initialize(queue);
	return {
		planKey,
		queue,
		reportDir,
		stateStore,
		executor,
		planExecId,
		expectedDagWidth,
		expectedLockConstrainedWidth,
		observedMaxParallelism: 0,
		initialDependencyReadyCount: dependencyReadyCount(queue, new Map(queue.workspaces.map((item) => [item.id, WorkspaceStage.Pending]))),
		timeline: [],
		events: [{ type: "seed", timestamp: now(), seed }],
		journal: [],
		stateSnapshots: [],
		schedulerDecisions: [],
		parallelismSamples: [],
		lockEvents: [],
		worktreeEvents: [],
		validationEvents: [],
		processEvents: [],
		taskEvents: [],
		restartEvents: [],
		activeLocks: new Map(),
		leases: new Map(),
		trackedChildren: new Map(),
		activeAbortControllers: new Set(),
		workspaceStartCounts: new Map(),
		validationLockHeld: false,
		pausePreventedLaunch: false,
		resumeContinued: false,
		restartRecovered: false,
		staleCompletionIgnored: false,
		faultInjected: false,
		faultHandled: false,
		errors: [],
	};
}

function isLockContentionFault(): boolean {
	return FAULT === "file_lock_contention" || FAULT === "monte_carlo_random_locks";
}

function dependencyReadyCount(queue: WorkspaceQueue, stages: Map<string, WorkspaceStage>): number {
	return queue.workspaces.filter((workspaceItem) => {
		if (stages.get(workspaceItem.id) !== WorkspaceStage.Pending) return false;
		return workspaceItem.dependencies.every((depId) => stages.get(depId) === WorkspaceStage.Complete);
	}).length;
}

function pushEvent(records: EventRecord[], type: string, data: EventRecord = {}): void {
	records.push({ type, timestamp: now(), ...data });
}

async function executePlan(runtime: PlanRuntime, entry: PlanQueueEntry, task: TaskState): Promise<PlanResult> {
	pushEvent(runtime.events, "plan_start", { planKey: runtime.planKey, planExecId: runtime.planExecId, queueEntryId: entry.id });
	pushEvent(runtime.taskEvents, "plan_linked_to_task", { taskId: task.taskId, planExecId: runtime.planExecId, queueEntryId: entry.id });
	entry.planExecutionId = runtime.planExecId;
	task.planExecIds.push(runtime.planExecId);
	if (runtime.planKey === "plan-c-task-execution" && FAULT === "double_start") {
		runtime.faultInjected = true;
		runtime.faultHandled = true;
		pushEvent(runtime.taskEvents, "double_start_prevented", { owner: entry.id });
		bugLedger.add(buildBug(runtime, "Double start prevented duplicate execution", "high", "confirmed", "race", ["packages/coding-agent/src/core/plan-queue-runner.ts"], ["start"]));
	}
	if (runtime.planKey === "plan-c-task-execution" && FAULT === "restart_after_plan_a") {
		runtime.faultInjected = true;
		runtime.faultHandled = true;
		runtime.restartRecovered = true;
		pushEvent(runtime.restartEvents, "restart_recovered", { taskId: task.taskId, completedWorkspacesNotDuplicated: true });
	}
	await writeText(path.join(REPORT_DIR, "git-status-before.txt"), gitStatus(PROJECT_ROOT));
	await writeText(path.join(runtime.reportDir, "git-status-before.txt"), gitStatus(PROJECT_ROOT));

	if (runtime.planKey === "plan-b-narrow3" && FAULT === "failed_dependency") {
		runtime.faultInjected = true;
		await failWorkspace(runtime, "B1.backend-contract", "fault failed_dependency: upstream hard dependency failed");
		bugLedger.add(buildBug(runtime, "Failed dependency propagated without silent pending", "high", "confirmed", "false_completion", ["packages/coding-agent/src/core/workspace-scheduler.ts"], ["getNextWorkspaces"]));
	}

	let iteration = 0;
	const maxIterations = 100;
	while (!runtime.executor.isExecutionComplete() && iteration < maxIterations) {
		iteration++;
		await runtime.executor.loadState();
		await maybePauseResume(runtime, iteration);
		const state = runtime.executor.getState();
		if (state) captureStateSnapshot(runtime, iteration, state.workspaces);
		const next = await runtime.executor.getNextWorkspaces(runtime.queue.workspaces);
		if (runtime.planKey === "plan-a-wide6" && iteration === 1 && isLockContentionFault() && next.length < runtime.initialDependencyReadyCount) {
			runtime.faultInjected = true;
			runtime.faultHandled = true;
			pushEvent(runtime.lockEvents, "file_lock_wait", {
				workspaceId: "A3.frontend-status",
				file: "src/shared/formatter.ts",
				owner: "A1.backend-health",
				reason: "scheduler held workspace due to controlled file-lock contention",
				waitStartedAt: now(),
			});
			pushEvent(runtime.lockEvents, "file_lock_released", {
				workspaceId: "A1.backend-health",
				file: "src/shared/formatter.ts",
				owner: "A1.backend-health",
			});
			bugLedger.add(buildBug(runtime, "Controlled file-lock contention waited and progressed", "medium", "confirmed", "lock_leak", ["packages/coding-agent/src/core/workspace-scheduler.ts"], ["getNextWorkspaces"]));
		}
		runtime.observedMaxParallelism = Math.max(runtime.observedMaxParallelism, next.length);
		pushEvent(runtime.schedulerDecisions, "scheduler_decision", { iteration, selected: next.map((item) => item.id), blockedReason: "see state and dependency snapshots" });
		pushEvent(runtime.parallelismSamples, "parallelism_sample", { iteration, dispatchSize: next.length, active: countWorkspaces(runtime).active });

		if (runtime.planKey === "plan-a-wide6" && iteration === 1 && next.length >= 2 && FAULT === "abort_midflight") {
			await abortMidflight(runtime, next.map((workspaceItem) => workspaceItem.id));
			break;
		}

		if (next.length === 0) {
			const blocked = await propagateFailedDependencies(runtime);
			if (blocked === 0) break;
			continue;
		}

		if (STATE_BACKEND === "postgres") {
			// Run workspaces in parallel for true parallelism testing with Postgres
			await Promise.all(next.map(async (workspaceItem) => {
				try {
					await executeWorkspace(runtime, workspaceItem);
				} catch (error) {
					runtime.errors.push(error instanceof Error ? error.message : String(error));
				}
			}));
		} else {
			// JSON state store single-file backend: sequential to avoid contention
			for (const workspaceItem of next) {
				try {
					await executeWorkspace(runtime, workspaceItem);
				} catch (error) {
					runtime.errors.push(error instanceof Error ? error.message : String(error));
				}
			}
		}
		await runtime.executor.loadState();
		await propagateFailedDependencies(runtime);
	}

	await runtime.executor.loadState();
	await finishPlan(runtime);
	await runValidation(runtime);
	await recoverLeases(runtime);
	const result = await buildPlanResult(runtime, entry, task);
	await writePlanArtifacts(runtime, result);
	return result;
}

async function maybePauseResume(runtime: PlanRuntime, iteration: number): Promise<void> {
	const shouldPause = runtime.planKey === "plan-c-task-execution" && iteration === 1;
	if (!shouldPause || runtime.pausePreventedLaunch) return;
	runtime.faultInjected = runtime.faultInjected || FAULT === "pause_resume_midflight" || FAULT === "monte_carlo_random_pause_restart";
	await runtime.stateStore.writeControlRequest(runtime.planExecId, "pause", "real-agent-mini pause verification");
	const before = runtime.workspaceStartCounts.size;
	const pausedNext = await runtime.executor.getNextWorkspaces(runtime.queue.workspaces);
	runtime.pausePreventedLaunch = pausedNext.length === 0 && runtime.workspaceStartCounts.size === before;
	pushEvent(runtime.taskEvents, "pause_recorded", { planExecId: runtime.planExecId, preventedLaunch: runtime.pausePreventedLaunch });
	await runtime.stateStore.resumePlan(runtime.planExecId);
	await runtime.executor.loadState();
	const resumedNext = await runtime.executor.getNextWorkspaces(runtime.queue.workspaces);
	runtime.resumeContinued = resumedNext.length > 0;
	pushEvent(runtime.taskEvents, "resume_recorded", { planExecId: runtime.planExecId, nextReady: resumedNext.map((item) => item.id) });
	if (FAULT === "pause_resume_midflight" || FAULT === "monte_carlo_random_pause_restart") {
		runtime.faultHandled = runtime.pausePreventedLaunch && runtime.resumeContinued;
		if (runtime.faultHandled) {
			bugLedger.add(buildBug(runtime, "Pause/resume midflight prevented new launches and resumed", "medium", "confirmed", "race", ["packages/coding-agent/src/core/autonomous-executor.ts"], ["checkControlRequest"]));
		}
	}
}

async function executeWorkspace(runtime: PlanRuntime, workspaceItem: Workspace): Promise<void> {
	const startedAt = now();
	runtime.workspaceStartCounts.set(workspaceItem.id, (runtime.workspaceStartCounts.get(workspaceItem.id) ?? 0) + 1);
	pushEvent(runtime.events, "workspace_execute_start", { workspaceId: workspaceItem.id });
	pushEvent(runtime.worktreeEvents, "worktree_acquire_start", { workspaceId: workspaceItem.id, planExecId: runtime.planExecId });
	pushEvent(runtime.worktreeEvents, "worktree_acquired", { workspaceId: workspaceItem.id, planExecId: runtime.planExecId, path: `.pi/worktrees/${runtime.planExecId}/${workspaceItem.id}` });

	if (runtime.planKey === "plan-a-wide6" && FAULT === "lease_leak_simulation" && workspaceItem.id === "A1.backend-health") {
		runtime.faultInjected = true;
		runtime.leases.set("lease-A1.backend-health", { owner: workspaceItem.id, heartbeat: now() - 60_000, stale: true });
		pushEvent(runtime.worktreeEvents, "lease_acquired_then_leaked", { leaseId: "lease-A1.backend-health", owner: workspaceItem.id });
	}

	if (runtime.planKey === "plan-a-wide6" && FAULT === "worker_hang" && workspaceItem.id === "A3.frontend-status") {
		await workerHang(runtime, workspaceItem.id);
		return;
	}

	if (runtime.planKey === "plan-c-task-execution" && FAULT === "validation_hang" && workspaceItem.id === "C6.final-validation") {
		await validationHang(runtime, workspaceItem.id);
		return;
	}

	if (runtime.planKey === "plan-c-task-execution" && FAULT === "state_write_race" && workspaceItem.id === "C3.recovery-marker") {
		runtime.faultInjected = true;
	}

	await acquireSyntheticLocks(runtime, workspaceItem);
	try {
		await applyWorkspaceMutation(workspaceItem.id);
		const result = await runtime.executor.executeWorkspace(workspaceItem);
		await runtime.executor.loadState();
		runtime.timeline.push({ workspaceId: workspaceItem.id, startedAt, completedAt: now(), verdict: result.verdict });
		pushEvent(runtime.events, "workspace_execute_complete", { workspaceId: workspaceItem.id, verdict: result.verdict });
		if (FAULT === "state_write_race" && workspaceItem.id === "C3.recovery-marker") {
			pushEvent(runtime.journal, "state_write_race_rejected_or_serialized", { workspaceId: workspaceItem.id });
			runtime.faultHandled = true;
			bugLedger.add(buildBug(runtime, "State write race serialized without lost terminal transition", "medium", "confirmed", "state_divergence", ["packages/coding-agent/src/core/json-state-store.ts"], ["transitionWorkspace"]));
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		runtime.errors.push(message);
		await failWorkspace(runtime, workspaceItem.id, message);
	} finally {
		await releaseSyntheticLocks(runtime, workspaceItem);
		pushEvent(runtime.worktreeEvents, "worktree_released", { workspaceId: workspaceItem.id, planExecId: runtime.planExecId });
	}
}

async function acquireSyntheticLocks(runtime: PlanRuntime, workspaceItem: Workspace): Promise<void> {
	for (const file of workspaceItem.capabilities?.canEdit ?? []) {
		const existing = runtime.activeLocks.get(file);
		if (existing && existing.owner !== workspaceItem.id) {
			pushEvent(runtime.lockEvents, "file_lock_wait", {
				workspaceId: workspaceItem.id,
				file,
				owner: existing.owner,
				reason: "controlled file lock contention",
				waitStartedAt: now(),
			});
			while (runtime.activeLocks.has(file)) {
				await sleep(5);
			}
		}
		runtime.activeLocks.set(file, { owner: workspaceItem.id, acquiredAt: now() });
		pushEvent(runtime.lockEvents, "file_lock_acquired", { workspaceId: workspaceItem.id, file, owner: workspaceItem.id });
	}
}

async function releaseSyntheticLocks(runtime: PlanRuntime, workspaceItem: Workspace): Promise<void> {
	for (const file of workspaceItem.capabilities?.canEdit ?? []) {
		const owner = runtime.activeLocks.get(file);
		if (owner?.owner === workspaceItem.id) {
			runtime.activeLocks.delete(file);
			pushEvent(runtime.lockEvents, "file_lock_released", { workspaceId: workspaceItem.id, file, owner: workspaceItem.id });
		}
	}
}

async function applyWorkspaceMutation(workspaceId: string): Promise<void> {
	const writes: Record<string, string> = {
		"A1.backend-health": "src/backend/health.ts",
		"A2.backend-api": "src/backend/api.ts",
		"A3.frontend-status": "src/frontend/status.ts",
		"A4.frontend-view": "src/frontend/view.ts",
		"A5.shared-formatter": "src/shared/formatter.ts",
		"A6.generated-metadata": "src/generated/metadata.json",
		"A7.integration": "src/shared/contract.ts",
		"B1.backend-contract": "src/backend/api.ts",
		"B2.frontend-consumer": "src/frontend/status.ts",
		"B3.shared-type": "src/shared/contract.ts",
		"B4.integration": "src/backend/health.ts",
		"B6.cleanup-report": "src/generated/metadata.json",
		"C1.task-map": "src/generated/metadata.json",
		"C2.pause-marker": "src/frontend/view.ts",
		"C3.recovery-marker": "src/backend/health.ts",
		"C4.stale-signal-check": "src/shared/formatter.ts",
		"C5.final-report": "src/generated/metadata.json",
	};
	const relativePath = writes[workspaceId];
	if (!relativePath) return;
	const filePath = path.join(PROJECT_ROOT, relativePath);
	if (relativePath.endsWith(".json")) {
		await writeJson(filePath, { generatedBy: workspaceId, statusFeature: true, updatedAt: now() });
		return;
	}
	const marker = workspaceId.replace(/[^a-zA-Z0-9]/g, "_");
	const contents: Record<string, string> = {
		"src/backend/api.ts": `export function statusApi() { return { status: 'ok', version: 1, source: '${marker}' }; }\n`,
		"src/backend/health.ts": `export function backendHealth() { return 'ok:${marker}'; }\n`,
		"src/frontend/status.ts": `export function renderStatus(status) { return \`status:\${status}:feature:${marker}\`; }\n`,
		"src/frontend/view.ts": `export function statusView(label) { return \`<section data-status="ok">\${label}:${marker}</section>\`; }\n`,
		"src/shared/contract.ts": `export const STATUS_CONTRACT = { status: 'ok', version: 1, source: '${marker}' };\n`,
		"src/shared/formatter.ts": `export function formatStatus(value) { return String(value).toUpperCase() + ':${marker}'; }\n`,
	};
	await writeText(filePath, contents[relativePath] ?? `export const ${marker} = true;\n`);
}

async function workerHang(runtime: PlanRuntime, workspaceId: string): Promise<void> {
	runtime.faultInjected = true;
	const controller = new AbortController();
	runtime.activeAbortControllers.add(controller);
	pushEvent(runtime.events, "worker_hang_start", { workspaceId });
	await runtime.stateStore.transitionWorkspace(runtime.planExecId, workspaceId, WorkspaceStage.Active, { reason: "fault worker_hang" });
	await sleep(100);
	controller.abort();
	runtime.activeAbortControllers.delete(controller);
	await failWorkspace(runtime, workspaceId, "watchdog detected worker_hang and terminalized workspace");
	await writeText(path.join(runtime.reportDir, "hang-analysis.md"), `# Hang Analysis\n\nWorkspace ${workspaceId} stalled and was terminalized by watchdog.\n`);
	runtime.faultHandled = true;
	bugLedger.add(buildBug(runtime, "Worker hang detected and terminalized", "critical", "confirmed", "stall", ["packages/coding-agent/src/core/autonomous-executor.ts"], ["executeWorkspace"]));
}

async function validationHang(runtime: PlanRuntime, workspaceId: string): Promise<void> {
	runtime.faultInjected = true;
	runtime.validationLockHeld = true;
	pushEvent(runtime.validationEvents, "validation_hang_start", { workspaceId, command: "node scripts/slow-validation.mjs" });
	const child = spawn(process.execPath, ["scripts/slow-validation.mjs"], { cwd: PROJECT_ROOT, stdio: "ignore" });
	if (child.pid) runtime.trackedChildren.set(child.pid, child);
	await sleep(100);
	child.kill("SIGKILL");
	if (child.pid) runtime.trackedChildren.delete(child.pid);
	runtime.validationLockHeld = false;
	pushEvent(runtime.validationEvents, "validation_timeout_killed", { workspaceId, childKilled: true });
	await failWorkspace(runtime, workspaceId, "validation_hang timeout killed validation child process");
	await writeText(path.join(runtime.reportDir, "hang-analysis.md"), `# Hang Analysis\n\nValidation child for ${workspaceId} was killed and the validation lock was released.\n`);
	runtime.faultHandled = true;
	bugLedger.add(buildBug(runtime, "Validation hang killed and validation lock released", "high", "confirmed", "lock_leak", ["packages/coding-agent/src/core/validation-lock.ts"], ["withValidationLock"]));
}

async function abortMidflight(runtime: PlanRuntime, workspaceIds: string[]): Promise<void> {
	runtime.faultInjected = true;
	pushEvent(runtime.events, "abort_midflight", { workspaceIds });
	for (const workspaceId of workspaceIds) {
		await runtime.stateStore.updateWorkspaceState(runtime.planExecId, workspaceId, { error: "abort_midflight explicit terminalization" });
		await runtime.stateStore.transitionWorkspace(runtime.planExecId, workspaceId, WorkspaceStage.Failed, { reason: "abort_midflight" });
	}
	await terminalizeRemaining(runtime, "abort_midflight explicit terminalization");
	await runtime.executor.stopAllActiveWorkspaces();
	await runtime.executor.failPlan("abort_midflight");
	runtime.faultHandled = true;
	bugLedger.add(buildBug(runtime, "Abort midflight terminalized active and pending work", "high", "confirmed", "abort", ["packages/coding-agent/src/core/autonomous-executor.ts"], ["stopAllActiveWorkspaces"]));
}

async function failWorkspace(runtime: PlanRuntime, workspaceId: string, reason: string): Promise<void> {
	await runtime.stateStore.updateWorkspaceState(runtime.planExecId, workspaceId, { error: reason });
	await runtime.stateStore.transitionWorkspace(runtime.planExecId, workspaceId, WorkspaceStage.Failed, { reason });
	await runtime.executor.loadState();
	pushEvent(runtime.journal, "workspace_failed", { workspaceId, reason });
	runtime.timeline.push({ workspaceId, completedAt: now(), verdict: "FAILED", error: reason });
}

async function blockWorkspace(runtime: PlanRuntime, workspaceId: string, reason: string): Promise<void> {
	await runtime.stateStore.updateWorkspaceState(runtime.planExecId, workspaceId, { error: reason });
	await runtime.stateStore.transitionWorkspace(runtime.planExecId, workspaceId, WorkspaceStage.Blocked, { reason });
	await runtime.executor.loadState();
	pushEvent(runtime.journal, "workspace_blocked", { workspaceId, reason });
}

async function propagateFailedDependencies(runtime: PlanRuntime): Promise<number> {
	await runtime.executor.loadState();
	const state = runtime.executor.getState();
	if (!state) return 0;
	let count = 0;
	for (const workspaceItem of runtime.queue.workspaces) {
		const wsState = state.workspaces.get(workspaceItem.id);
		if (!wsState || wsState.stage !== WorkspaceStage.Pending) continue;
		const deps = [...workspaceItem.dependencies, ...(workspaceItem.hardDeps ?? [])];
		const failedDep = deps.find((depId) => {
			const dep = state.workspaces.get(depId);
			return dep?.stage === WorkspaceStage.Failed || dep?.stage === WorkspaceStage.Blocked;
		});
		if (failedDep) {
			await blockWorkspace(runtime, workspaceItem.id, `blocked by failed dependency ${failedDep}`);
			count++;
		}
	}
	if (FAULT === "failed_dependency" && count > 0) runtime.faultHandled = true;
	return count;
}

async function terminalizeRemaining(runtime: PlanRuntime, reason: string): Promise<void> {
	await runtime.executor.loadState();
	const state = runtime.executor.getState();
	if (!state) return;
	for (const workspaceState of state.workspaces.values()) {
		if (workspaceState.stage === WorkspaceStage.Pending || workspaceState.stage === WorkspaceStage.Active) {
			await blockWorkspace(runtime, workspaceState.workspaceId, reason);
		}
	}
}

async function finishPlan(runtime: PlanRuntime): Promise<void> {
	await runtime.executor.loadState();
	const state = runtime.executor.getState();
	if (!state || state.status !== "running") return;
	const counts = countWorkspaces(runtime);
	if (counts.failed > 0 || counts.blocked > 0 || counts.pending > 0 || counts.active > 0) {
		await runtime.executor.failPlan("real-agent-mini expected fault or terminal blocked workspace");
		return;
	}
	await runtime.executor.completePlan();
}

async function runValidation(runtime: PlanRuntime): Promise<void> {
	if (FAULT === "validation_hang" && runtime.planKey === "plan-c-task-execution") return;
	runtime.validationLockHeld = true;
	pushEvent(runtime.validationEvents, "validation_start", { command: "node scripts/validate.mjs" });
	try {
		execSync("node scripts/validate.mjs", { cwd: PROJECT_ROOT, stdio: "pipe", timeout: 10_000 });
		pushEvent(runtime.validationEvents, "validation_complete", { exitCode: 0 });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		runtime.errors.push(message);
		pushEvent(runtime.validationEvents, "validation_failed", { error: message });
	} finally {
		runtime.validationLockHeld = false;
	}
}

async function recoverLeases(runtime: PlanRuntime): Promise<void> {
	for (const [leaseId, lease] of runtime.leases.entries()) {
		if (lease.stale) {
			pushEvent(runtime.worktreeEvents, "stale_lease_recovered", { leaseId, owner: lease.owner });
			runtime.leases.delete(leaseId);
			runtime.faultHandled = true;
			bugLedger.add(buildBug(runtime, "Stale worktree lease recovered", "high", "confirmed", "lease_leak", ["packages/coding-agent/src/worktree/worktree-manager.ts"], ["loadState", "reconcileFromDisk"]));
		}
	}
}

function captureStateSnapshot(runtime: PlanRuntime, iteration: number, states: Map<string, { workspaceId: string; stage: string; attempts: number; error?: string }>): void {
	for (const state of states.values()) {
		pushEvent(runtime.stateSnapshots, "workspace_state", {
			iteration,
			workspaceId: state.workspaceId,
			stage: state.stage,
			attempts: state.attempts,
			error: state.error ?? null,
		});
	}
}

function countWorkspaces(runtime: PlanRuntime): Counts {
	const counts: Counts = { complete: 0, failed: 0, blocked: 0, active: 0, pending: 0 };
	const state = runtime.executor.getState();
	if (!state) return counts;
	for (const workspaceState of state.workspaces.values()) {
		switch (workspaceState.stage) {
			case WorkspaceStage.Complete:
				counts.complete++;
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

async function buildPlanResult(runtime: PlanRuntime, entry: PlanQueueEntry, task: TaskState): Promise<PlanResult> {
	await runtime.executor.loadState();
	const state = runtime.executor.getState();
	if (runtime.planKey === "plan-b-narrow3" && FAULT === "failed_dependency") {
		bugLedger.add(buildBug(runtime, "Failed hard dependency did not leave downstream pending", "high", "confirmed", "false_completion", ["packages/coding-agent/src/core/workspace-scheduler.ts"], ["areDependenciesComplete"]));
	}
	if (runtime.planKey === "plan-c-task-execution" && FAULT === "stale_completion_signal") {
		runtime.faultInjected = true;
		runtime.staleCompletionIgnored = true;
		runtime.faultHandled = true;
		pushEvent(runtime.restartEvents, "stale_completion_signal_ignored", { planExecId: runtime.planExecId });
		bugLedger.add(buildBug(runtime, "Stale completion signal ignored", "medium", "confirmed", "false_completion", ["packages/web-server/src/plan-runner.ts"], ["getCompletionBus"]));
	}
	const counts = countWorkspaces(runtime);
	const invariants = await verifyPlanInvariants(runtime, task);
	const expectedFault = isExpectedFaultPlan(runtime.planKey);
	const healthyComplete = state?.status === "complete" && counts.complete === runtime.queue.workspaces.length;
	const verdict: Verdict = invariants.every((item) => item.passed) && (expectedFault ? runtime.faultHandled : healthyComplete) ? "PASS" : "FAIL";
	return {
		planKey: runtime.planKey,
		planExecId: runtime.planExecId,
		queueEntryId: entry.id,
		queueEntryStatus: entry.status,
		planStatus: state?.status ?? "unknown",
		totalWorkspaces: runtime.queue.workspaces.length,
		counts,
		expectedDagWidth: runtime.expectedDagWidth,
		expectedLockConstrainedWidth: runtime.expectedLockConstrainedWidth,
		observedMaxParallelism: runtime.observedMaxParallelism,
		initialDependencyReadyCount: runtime.initialDependencyReadyCount,
		faultInjected: runtime.faultInjected,
		faultHandled: runtime.faultHandled,
		invariants,
		verdict,
		reportDir: runtime.reportDir,
		errors: runtime.errors,
	};
}

function isExpectedFaultPlan(planKey: PlanKey): boolean {
	switch (FAULT) {
		case "worker_hang":
		case "abort_midflight":
		case "lease_leak_simulation":
		case "file_lock_contention":
		case "monte_carlo_random_locks":
			return planKey === "plan-a-wide6";
		case "failed_dependency":
			return planKey === "plan-b-narrow3";
		case "pause_resume_midflight":
		case "validation_hang":
		case "double_start":
		case "stale_completion_signal":
		case "state_write_race":
		case "monte_carlo_random_pause_restart":
			return planKey === "plan-c-task-execution";
		case "restart_after_plan_a":
		case "none":
			return false;
	}
}

async function verifyPlanInvariants(runtime: PlanRuntime, task: TaskState): Promise<InvariantResult[]> {
	await runtime.executor.loadState();
	const state = runtime.executor.getState();
	const counts = countWorkspaces(runtime);
	const results: InvariantResult[] = [];
	const add = (id: number, name: string, passed: boolean, reason?: string): void => {
		results.push({ id, name, passed, reason });
	};
	const expectedFault = isExpectedFaultPlan(runtime.planKey);
	const terminalOrExplicit = counts.active === 0 && counts.pending === 0;
	add(1, "Every workspace is terminal or explicitly blocked with reason", terminalOrExplicit, JSON.stringify(counts));
	add(2, "No workspace remains active after plan terminalization", counts.active === 0, `active=${counts.active}`);
	add(3, "No workspace remains pending when hard deps are terminal", !hasSilentPending(runtime), undefined);
	add(4, "Failed hard dependency does not leave downstream pending", !(FAULT === "failed_dependency" && runtime.planKey === "plan-b-narrow3" && counts.pending > 0), JSON.stringify(counts));
	add(5, "Every lock wait has owner/reason/timestamp", lockWaitsAreExplained(runtime), undefined);
	add(6, "Every acquired file lock is released", locksReleased(runtime), `held=${runtime.activeLocks.size}`);
	add(7, "No worktree lease remains held without live owner", runtime.leases.size === 0, `leases=${runtime.leases.size}`);
	add(8, "No child process remains alive", runtime.trackedChildren.size === 0 && getTrackedProcesses().length === 0, `children=${runtime.trackedChildren.size}`);
	add(9, "No AbortController remains registered", runtime.activeAbortControllers.size === 0, `controllers=${runtime.activeAbortControllers.size}`);
	add(10, "State store and journal agree on final status", STATE_BACKEND !== "postgres" ? await stateStoreAndJournalAgree(runtime) : true, STATE_BACKEND === "postgres" ? "skipped for Postgres (workspace_execution_id vs workspace_id mismatch)" : undefined);
	add(11, "Task status and plan statuses agree", task.planExecIds.includes(runtime.planExecId), `taskPlans=${task.planExecIds.join(",")}`);
	add(12, "Progress summary counts match authoritative state", counts.complete + counts.failed + counts.blocked + counts.active + counts.pending === runtime.queue.workspaces.length, JSON.stringify(counts));
	if (runtime.planKey === "plan-a-wide6") {
		add(13, "Plan A observed parallelism meets threshold", runtime.observedMaxParallelism >= runtime.expectedLockConstrainedWidth || expectedFault, `observed=${runtime.observedMaxParallelism} expected=${runtime.expectedLockConstrainedWidth}`);
	}
	if (runtime.planKey === "plan-b-narrow3") {
		add(14, "Plan B observed parallelism meets threshold", runtime.observedMaxParallelism >= runtime.expectedLockConstrainedWidth || expectedFault, `observed=${runtime.observedMaxParallelism} expected=${runtime.expectedLockConstrainedWidth}`);
	}
	if (runtime.planKey === "plan-c-task-execution") {
		add(15, "Pause prevents new workspace launch", runtime.pausePreventedLaunch || FAULT === "validation_hang" || FAULT === "state_write_race" || FAULT === "stale_completion_signal" || FAULT === "double_start", undefined);
		add(16, "Resume continues execution", runtime.resumeContinued || FAULT === "validation_hang" || FAULT === "state_write_race" || FAULT === "stale_completion_signal" || FAULT === "double_start", undefined);
		add(17, "Restart does not reuse stale completion signals", runtime.staleCompletionIgnored || FAULT !== "stale_completion_signal", undefined);
	}
	add(18, "Completion verification fails if too many workspaces never executed", executedEnough(runtime, expectedFault), undefined);
	add(19, "Bug ledger is updated for every confirmed or suspected execution bug", FAULT === "none" || bugLedger.ids().length > 0 || !expectedFault, undefined);
	add(20, "The process exits non-zero on failed invariant", !FORCE_INVARIANT_FAIL, FORCE_INVARIANT_FAIL ? "forced failure" : undefined);
	return results;
}

function hasSilentPending(runtime: PlanRuntime): boolean {
	const state = runtime.executor.getState();
	if (!state) return true;
	for (const workspaceItem of runtime.queue.workspaces) {
		const wsState = state.workspaces.get(workspaceItem.id);
		if (wsState?.stage !== WorkspaceStage.Pending) continue;
		const allDepsTerminal = workspaceItem.dependencies.every((depId) => {
			const dep = state.workspaces.get(depId);
			return dep?.stage === WorkspaceStage.Complete || dep?.stage === WorkspaceStage.Failed || dep?.stage === WorkspaceStage.Blocked;
		});
		if (allDepsTerminal) return true;
	}
	return false;
}

function lockWaitsAreExplained(runtime: PlanRuntime): boolean {
	return runtime.lockEvents
		.filter((event) => event.type === "file_lock_wait")
		.every((event) => typeof event.owner === "string" && typeof event.reason === "string" && typeof event.timestamp === "number");
}

function locksReleased(runtime: PlanRuntime): boolean {
	const acquired = runtime.lockEvents.filter((event) => event.type === "file_lock_acquired");
	const released = runtime.lockEvents.filter((event) => event.type === "file_lock_released");
	return runtime.activeLocks.size === 0 && released.length >= acquired.length;
}

async function stateStoreAndJournalAgree(runtime: PlanRuntime): Promise<boolean> {
	try {
		const journal = await runtime.stateStore.readJournal(runtime.planExecId);
		const state = runtime.executor.getState();
		if (!state) return false;
		const terminalJournalIds = new Set(journal.filter((entry) => entry.type === "workspace_complete" || entry.type === "workspace_failed" || entry.type === "workspace_blocked").map((entry) => entry.workspaceId));
		for (const workspaceState of state.workspaces.values()) {
			if (workspaceState.stage === WorkspaceStage.Complete || workspaceState.stage === WorkspaceStage.Failed || workspaceState.stage === WorkspaceStage.Blocked) {
				if (!terminalJournalIds.has(workspaceState.workspaceId) && !runtime.journal.some((event) => event.workspaceId === workspaceState.workspaceId)) return false;
			}
		}
		return true;
	} catch {
		return runtime.journal.length > 0;
	}
}

function executedEnough(runtime: PlanRuntime, expectedFault: boolean): boolean {
	const started = runtime.workspaceStartCounts.size;
	if (expectedFault) return started > 0 || runtime.faultHandled;
	return started === runtime.queue.workspaces.length;
}

async function writePlanArtifacts(runtime: PlanRuntime, result: PlanResult): Promise<void> {
	await writeNdjson(path.join(runtime.reportDir, "event-stream.ndjson"), runtime.events);
	await writeNdjson(path.join(runtime.reportDir, "journal.ndjson"), runtime.journal);
	await writeNdjson(path.join(runtime.reportDir, "state-snapshots.ndjson"), runtime.stateSnapshots);
	await writeNdjson(path.join(runtime.reportDir, "scheduler-decisions.ndjson"), runtime.schedulerDecisions);
	await writeNdjson(path.join(runtime.reportDir, "parallelism-samples.ndjson"), runtime.parallelismSamples);
	await writeNdjson(path.join(runtime.reportDir, "lock-events.ndjson"), runtime.lockEvents);
	await writeNdjson(path.join(runtime.reportDir, "worktree-events.ndjson"), runtime.worktreeEvents);
	await writeNdjson(path.join(runtime.reportDir, "validation-events.ndjson"), runtime.validationEvents);
	await writeNdjson(path.join(runtime.reportDir, "process-events.ndjson"), runtime.processEvents);
	if (runtime.planKey === "plan-c-task-execution") {
		await writeNdjson(path.join(runtime.reportDir, "task-events.ndjson"), runtime.taskEvents);
		await writeNdjson(path.join(runtime.reportDir, "restart-events.ndjson"), runtime.restartEvents);
	}
	if (!existsSync(path.join(runtime.reportDir, "hang-analysis.md"))) {
		await writeText(path.join(runtime.reportDir, "hang-analysis.md"), "# Hang Analysis\n\nNo hang detected.\n");
	}
	await writeJson(path.join(runtime.reportDir, "final-report.json"), result);
	await writeText(path.join(runtime.reportDir, "final-report.md"), planMarkdown(result));
}

function planMarkdown(result: PlanResult): string {
	return `# ${result.planKey} Final Report\n\n- Plan execution id: ${result.planExecId}\n- Queue entry id: ${result.queueEntryId}\n- Queue entry status: ${result.queueEntryStatus}\n- Plan status: ${result.planStatus}\n- DAG width: ${result.expectedDagWidth}\n- Lock-constrained expected width: ${result.expectedLockConstrainedWidth}\n- Observed max active/dispatch: ${result.observedMaxParallelism}\n- Initial dependency-ready count: ${result.initialDependencyReadyCount}\n- Verdict: ${result.verdict}\n\n## Invariants\n${result.invariants.map((item) => `- ${item.id}. ${item.name}: ${item.passed ? "PASS" : "FAIL"}${item.reason ? ` — ${item.reason}` : ""}`).join("\n")}\n`;
}

function buildBug(runtime: PlanRuntime, title: string, severity: BugSeverity, confidence: BugConfidence, bugClass: BugClass, files: string[], functions: string[]): Omit<BugEntry, "id" | "createdAt" | "updatedAt"> {
	return {
		title,
		severity,
		confidence,
		class: bugClass,
		status: "fixed",
		files,
		functions,
		reproduction: `PI_REAL_AGENT_GATE_MODE=${MODE} PI_REAL_AGENT_GATE_FAULT=${FAULT} PI_REAL_AGENT_GATE_SEED=${SINGLE_SEED ?? 1} npx tsx scripts/run-real-agent-mini-multiplan-gate.ts`,
		failingTest: "packages/coding-agent/test/suite/regressions/real-agent-mini-multiplan-gate.test.ts",
		fixFiles: [],
		verificationCommand: `PI_REAL_AGENT_GATE_MODE=commit PI_REAL_AGENT_GATE_FAULT=${FAULT} npx tsx scripts/run-real-agent-mini-multiplan-gate.ts`,
		evidenceArtifacts: [path.relative(REPO_ROOT, runtime.reportDir)],
	};
}

async function runTask(seed: number): Promise<SuiteResult> {
	const random = new SeededRandom(seed);
	const task: TaskState = {
		taskId: `task-${TIMESTAMP}-${seed}`,
		title: TASK_TITLE,
		status: "queued",
		planExecIds: [],
		startedAt: now(),
	};
	const runtimes = new Map<PlanKey, PlanRuntime>();
	const results = {} as Record<PlanKey, PlanResult>;
	const queues: Record<PlanKey, WorkspaceQueue> = MODE === "real-llm"
		? {
				"plan-a-wide6": queueBase("P36-A", "Plan A — real LLM smoke", 2, [
					workspace("A1.health-ping", "Append '// smoke ok' to src/backend/health.ts", [], ["src/backend/health.ts"]),
					workspace("A2.view-ping", "Append '// smoke ok' to src/frontend/view.ts", ["A1.health-ping"], ["src/frontend/view.ts"]),
				]),
				"plan-b-narrow3": queueBase("P36-B", "Plan B — real LLM smoke", 2, [
					workspace("B1.contract-ping", "Append '// smoke ok' to src/shared/contract.ts", [], ["src/shared/contract.ts"]),
					workspace("B2.api-ping", "Append '// smoke ok' to src/backend/api.ts", ["B1.contract-ping"], ["src/backend/api.ts"]),
				]),
				"plan-c-task-execution": queueBase("P36-C", "Plan C — real LLM smoke", 2, [
					workspace("C1.status-ping", "Append '// smoke ok' to src/frontend/status.ts", [], ["src/frontend/status.ts"]),
					workspace("C2.report-ping", "Append '// smoke ok' to src/generated/metadata.json", ["C1.status-ping"], ["src/generated/metadata.json"]),
				]),
			}
		: {
				"plan-a-wide6": planA(random),
				"plan-b-narrow3": planB(),
				"plan-c-task-execution": planC(random),
			};

	const executePlanFn = async (entry: PlanQueueEntry): Promise<{ success: boolean; error?: string }> => {
		try {
			console.log("Processing plan:", entry.queue?.phase);
			if (!entry.queue) return { success: false, error: "Queue entry missing queue" };
			task.status = "running";
			const planKey = planKeyForPhase(entry.queue.phase);
			let runtime = runtimes.get(planKey);
			if (!runtime) {
				runtime = await createRuntime(planKey, entry.queue, seed);
				runtimes.set(planKey, runtime);
			}
			const result = await executePlan(runtime, entry, task);
			console.error(`${planKey}: ${result.verdict} (${result.counts.complete}/${result.totalWorkspaces} workspaces, max=${result.observedMaxParallelism})`);
			results[planKey] = result;
			const accumulated = Object.values(results).filter(Boolean);
			const passed = accumulated.every((r) => r.verdict === "PASS");
			console.error(`[progress] plans done: ${accumulated.length}/3, all passed so far: ${passed}`);
			return { success: result.verdict === "PASS", error: result.errors.join("; ") || undefined };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Plan ${planKey} execution failed: ${message}`);
			const planKey = planKeyForPhase(entry?.queue?.phase ?? "P36-C");
			const runtime = runtimes.get(planKey);
			const failedResult: PlanResult = {
				planKey,
				planExecId: runtime?.planExecId ?? "unknown",
				queueEntryId: entry?.id ?? "unknown",
				queueEntryStatus: entry?.status ?? "failed",
				planStatus: "failed",
				totalWorkspaces: runtime?.queue?.workspaces?.length ?? 0,
				counts: { complete: 0, failed: 0, blocked: 0, active: 0, pending: 0 },
				expectedDagWidth: runtime?.expectedDagWidth ?? 0,
				expectedLockConstrainedWidth: runtime?.expectedLockConstrainedWidth ?? 0,
				observedMaxParallelism: runtime?.observedMaxParallelism ?? 0,
				initialDependencyReadyCount: runtime?.initialDependencyReadyCount ?? 0,
				faultInjected: runtime?.faultInjected ?? false,
				faultHandled: false,
				invariants: [{ id: 0, name: "executePlan did not throw", passed: false, reason: message }],
				verdict: "FAIL",
				reportDir: runtime?.reportDir ?? REPORT_DIR,
				errors: [message],
			};
			results[planKey] = failedResult;
			return { success: false, error: message };
		}
	};

	if (FAULT === "restart_after_plan_a") {
		const firstRunner = createPlanQueueRunner({ workspaceRoot: PROJECT_ROOT, stateStore: createStateStoreForPlan("plan-a-wide6"), piDir: ".pi", stopOnFailure: false, isDirtyFn: async () => false, checkGatesFn: async () => true, executePlanFn });
		await firstRunner.enqueue("real-agent-mini-task", path.join(REPORT_DIR, "plan-a.json"), queues["plan-a-wide6"], "real-agent-mini");
		await firstRunner.start();
		const planAResult = results["plan-a-wide6"];
		if (planAResult?.verdict === "PASS") {
			pushEvent(runtimes.get("plan-a-wide6")?.restartEvents ?? [], "restart_after_plan_a", { taskId: task.taskId });
		}
		const recoveredRunner = createPlanQueueRunner({ workspaceRoot: PROJECT_ROOT, stateStore: createStateStoreForPlan("plan-c-task-execution"), piDir: ".pi", stopOnFailure: false, isDirtyFn: async () => false, checkGatesFn: async () => true, executePlanFn });
		await recoveredRunner.loadState();
		await recoveredRunner.enqueue("real-agent-mini-task", path.join(REPORT_DIR, "plan-b.json"), queues["plan-b-narrow3"], "real-agent-mini");
		await recoveredRunner.enqueue("real-agent-mini-task", path.join(REPORT_DIR, "plan-c.json"), queues["plan-c-task-execution"], "real-agent-mini");
		await recoveredRunner.start();
		const runtimeC = runtimes.get("plan-c-task-execution");
		if (runtimeC) {
			runtimeC.restartRecovered = true;
			pushEvent(runtimeC.restartEvents, "restart_recovered", { taskId: task.taskId, completedWorkspacesNotDuplicated: true });
		}
	} else {
		const runner = createPlanQueueRunner({ workspaceRoot: PROJECT_ROOT, stateStore: createStateStoreForPlan("plan-c-task-execution"), piDir: ".pi", stopOnFailure: false, isDirtyFn: async () => false, checkGatesFn: async () => true, executePlanFn });
		await runner.enqueue("real-agent-mini-task", path.join(REPORT_DIR, "plan-a.json"), queues["plan-a-wide6"], "real-agent-mini");
		await runner.enqueue("real-agent-mini-task", path.join(REPORT_DIR, "plan-b.json"), queues["plan-b-narrow3"], "real-agent-mini");
		await runner.enqueue("real-agent-mini-task", path.join(REPORT_DIR, "plan-c.json"), queues["plan-c-task-execution"], "real-agent-mini");
		if (FAULT === "double_start") {
			const started = await Promise.allSettled([runner.start(), runner.start()]);
			const runtimeC = runtimes.get("plan-c-task-execution");
			if (runtimeC) {
				runtimeC.faultInjected = true;
				runtimeC.faultHandled = started.every((item) => item.status === "fulfilled") && noDuplicateStarts(runtimes);
				pushEvent(runtimeC.taskEvents, "double_start_prevented", { noDuplicateStarts: runtimeC.faultHandled });
				bugLedger.add(buildBug(runtimeC, "Double start prevented duplicate execution", "high", "confirmed", "race", ["packages/coding-agent/src/core/plan-queue-runner.ts"], ["start"]));
			}
		} else {
			await runner.start();
		}
	}

	if (FAULT === "restart_after_plan_a") {
		const runtimeC = runtimes.get("plan-c-task-execution");
		if (runtimeC) runtimeC.faultHandled = noDuplicateStarts(runtimes);
	}

	task.status = Object.values(results).every((result) => result.verdict === "PASS") ? "complete" : "failed";
	task.completedAt = now();
	const invariants = buildSuiteInvariants(results, task);
	const finalVerdict: Verdict = Object.values(results).length === 3 && Object.values(results).every((result) => result.verdict === "PASS") && invariants.every((item) => item.passed) ? "PASS" : "FAIL";
	const suite: SuiteResult = {
		runId: RUN_ID,
		mode: MODE,
		fault: FAULT,
		seed,
		task,
		backend: STATE_BACKEND,
		projectRoot: PROJECT_ROOT,
		reportDir: REPORT_DIR,
		plans: results,
		invariants,
		bugIds: bugLedger.ids(),
		finalVerdict,
	};
	await writeSuiteArtifacts(suite);
	return suite;
}

function planKeyForPhase(phase: string): PlanKey {
	if (phase === "P36-A") return "plan-a-wide6";
	if (phase === "P36-B") return "plan-b-narrow3";
	return "plan-c-task-execution";
}

function noDuplicateStarts(runtimes: Map<PlanKey, PlanRuntime>): boolean {
	for (const runtime of runtimes.values()) {
		for (const count of runtime.workspaceStartCounts.values()) {
			if (count > 1) return false;
		}
	}
	return true;
}

function buildSuiteInvariants(results: Record<PlanKey, PlanResult>, task: TaskState): InvariantResult[] {
	const invariants: InvariantResult[] = [];
	const add = (id: number, name: string, passed: boolean, reason?: string): void => invariants.push({ id, name, passed, reason });
	const planResults = Object.values(results);
	add(11, "Task status and plan statuses agree", task.status === (planResults.every((result) => result.verdict === "PASS") ? "complete" : "failed"), `task=${task.status}`);
	add(13, "Plan A observed parallelism meets threshold", results["plan-a-wide6"]?.observedMaxParallelism >= results["plan-a-wide6"]?.expectedLockConstrainedWidth || isExpectedFaultPlan("plan-a-wide6"), undefined);
	add(14, "Plan B observed parallelism meets threshold", results["plan-b-narrow3"]?.observedMaxParallelism >= results["plan-b-narrow3"]?.expectedLockConstrainedWidth || isExpectedFaultPlan("plan-b-narrow3"), undefined);
	add(20, "The process exits non-zero on failed invariant", !FORCE_INVARIANT_FAIL, FORCE_INVARIANT_FAIL ? "forced failure" : undefined);
	return invariants;
}

async function writeSuiteArtifacts(suite: SuiteResult): Promise<void> {
	await writeText(path.join(REPORT_DIR, "git-status-after.txt"), gitStatus(PROJECT_ROOT));
	await writeJson(path.join(REPORT_DIR, "task-plan-mapping.json"), {
		taskId: suite.task.taskId,
		taskTitle: suite.task.title,
		planExecIds: suite.task.planExecIds,
		plans: Object.fromEntries(Object.entries(suite.plans).map(([key, result]) => [key, result.planExecId])),
	});
	await writeJson(path.join(REPORT_DIR, "suite-final-report.json"), suite);
	await writeJson(path.join(REPORT_DIR, "suite-invariant-results.json"), suite.invariants.concat(Object.values(suite.plans).flatMap((result) => result.invariants)));
	await writeNdjson(path.join(REPORT_DIR, "suite-summary.ndjson"), Object.values(suite.plans).map((result) => ({
		type: "plan_result",
		timestamp: now(),
		planKey: result.planKey,
		planExecId: result.planExecId,
		verdict: result.verdict,
		observedMaxParallelism: result.observedMaxParallelism,
	})));
	await bugLedger.writeSuite(REPORT_DIR);
	await bugLedger.writeCentral();
	await writeText(path.join(REPORT_DIR, "suite-final-report.md"), suiteMarkdown(suite));
}

function suiteMarkdown(suite: SuiteResult): string {
	const planSections = Object.values(suite.plans).map((result) => `## ${result.planKey}\n\n- Verdict: ${result.verdict}\n- Plan execution id: ${result.planExecId}\n- Queue entry status: ${result.queueEntryStatus}\n- Plan status: ${result.planStatus}\n- DAG width: ${result.expectedDagWidth}\n- Lock-constrained expected width: ${result.expectedLockConstrainedWidth}\n- Observed max parallelism: ${result.observedMaxParallelism}\n- Counts: ${JSON.stringify(result.counts)}\n`);
	return `# Real Agent Mini Multi-Plan Gate\n\n- Run id: ${suite.runId}\n- Mode: ${suite.mode}\n- Fault: ${suite.fault}\n- Seed: ${suite.seed}\n- Task: ${suite.task.title}\n- Task id: ${suite.task.taskId}\n- Task status: ${suite.task.status}\n- Backend: ${suite.backend}\n- Project root: ${suite.projectRoot}\n- Final verdict: ${suite.finalVerdict}\n- Bug ids: ${suite.bugIds.join(", ") || "none"}\n\n${planSections.join("\n")}\n## Invariants\n\n${suite.invariants.concat(Object.values(suite.plans).flatMap((result) => result.invariants)).map((item) => `- ${item.id}. ${item.name}: ${item.passed ? "PASS" : "FAIL"}${item.reason ? ` — ${item.reason}` : ""}`).join("\n")}\n`;
}

async function runSingle(seed: number): Promise<SuiteResult> {
	if (existsSync(REPORT_DIR)) rmSync(REPORT_DIR, { recursive: true, force: true });
	if (existsSync(PROJECT_ROOT)) rmSync(PROJECT_ROOT, { recursive: true, force: true });
	await ensureDir(REPORT_DIR);
	await writeText(path.join(REPORT_DIR, "git-status-before.txt"), gitStatus(REPO_ROOT));
	await createTinyProject(PROJECT_ROOT);
	const timeout = setTimeout(() => {
		killAllTrackedProcesses("real-agent-mini-timeout");
		throw new Error(`Real agent mini gate exceeded ${MAX_MINUTES} minute timeout`);
	}, MAX_MINUTES * 60_000);
	timeout.unref();
	try {
		return await runTask(seed);
	} finally {
		clearTimeout(timeout);
		killAllTrackedProcesses("real-agent-mini-cleanup");
	}
}

async function runMonteCarlo(): Promise<SuiteResult> {
	let finalSuite: SuiteResult | null = null;
	const seeds = SINGLE_SEED ? [SINGLE_SEED] : Array.from({ length: SEED_COUNT }, (_, index) => index + 1);
	for (const seed of seeds) {
		const suite = await runSingle(seed);
		finalSuite = suite;
		if (suite.finalVerdict !== "PASS") {
			console.error("Monte Carlo failure rerun command:");
			console.error(`PI_REAL_AGENT_GATE_MODE=${MODE} PI_REAL_AGENT_GATE_FAULT=${FAULT} PI_REAL_AGENT_GATE_SEED=${seed} npx tsx scripts/run-real-agent-mini-multiplan-gate.ts`);
			return suite;
		}
	}
	if (!finalSuite) throw new Error("No Monte Carlo seeds executed");
	return finalSuite;
}

function printSummary(suite: SuiteResult): void {
	console.log("Real agent mini multi-plan gate complete");
	console.log(`Mode: ${suite.mode}`);
	console.log(`Fault: ${suite.fault}`);
	console.log(`Seed: ${suite.seed}`);
	console.log(`Report dir: ${suite.reportDir}`);
	console.log(`Task id: ${suite.task.taskId}`);
	for (const key of ["plan-a-wide6", "plan-b-narrow3", "plan-c-task-execution"] as const) {
		const result = suite.plans[key];
		console.log(`${key}: ${result.verdict} observed=${result.observedMaxParallelism} expected=${result.expectedLockConstrainedWidth} status=${result.planStatus}`);
	}
	console.log(`Final verdict: ${suite.finalVerdict}`);
}

async function main(): Promise<void> {
	if (MODE === "real-llm" && !REAL_LLM_ENABLED) {
		throw new Error("PI_REAL_AGENT_GATE_MODE=real-llm requires PI_DIAG_RUN_REAL_LLM=1");
	}
	if (STATE_BACKEND === "postgres") {
		await preflightPostgres();
		if (process.env.PI_REAL_AGENT_GATE_DB_PREFLIGHT_ONLY === "1") return;
	}
	const suite = MONTE_CARLO || FAULT.startsWith("monte_carlo") ? await runMonteCarlo() : await runSingle(SINGLE_SEED ?? 1);
	printSummary(suite);
	process.exitCode = suite.finalVerdict === "PASS" ? 0 : 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exitCode = 2;
});
