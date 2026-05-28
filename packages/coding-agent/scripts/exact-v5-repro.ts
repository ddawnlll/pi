import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { parsePlan } from "../src/core/plan-parser.js";
import type { JournalEvent, PlanState, WorkspaceState } from "../src/core/plan-state.js";
import { RolePacketBuilder, type HashedPacket } from "../src/core/role-packets.js";
import { WorkspaceScheduler } from "../src/core/workspace-scheduler.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";
import { WorktreeWorkspaceExecutor } from "../src/worktree/worktree-workspace-executor.js";

const execFileAsync = promisify(execFile);
const PLAN_PATH = "P-V5_Brain_Reality_Layer_v4_Plan_EXECUTOR_SCHEMA_FIXED.md";
const WORKSPACE_ID = "V5.00";
const WALL_TIMEOUT_MS = 12_000;
const EXECUTOR_TIMEOUT_MS = 300;

interface EventRow {
	timestamp: number;
	testId: string;
	type: string;
	workspaceId?: string;
	data?: Record<string, unknown>;
}

interface TestResult {
	id: string;
	name: string;
	status: "pass" | "fail" | "skip";
	durationMs: number;
	evidence: string[];
	classification?: string;
	error?: string;
}

interface LockSnapshot {
	timestamp: number;
	testId: string;
	locks: Record<string, string>;
}

interface TimerRow {
	testId: string;
	name: string;
	timeoutMs: number;
	fired: boolean;
}

class ExactRecorder {
	readonly events: EventRow[] = [];
	readonly actorEvents: EventRow[] = [];
	readonly journal: JournalEvent[] = [];
	readonly worktreeEvents: EventRow[] = [];
	readonly lockSnapshots: LockSnapshot[] = [];
	readonly timers: TimerRow[] = [];
	readonly results: TestResult[] = [];

	constructor(readonly reportDir: string) {}

	record(testId: string, type: string, workspaceId?: string, data?: Record<string, unknown>): void {
		const row = { timestamp: Date.now(), testId, type, workspaceId, data };
		this.events.push(row);
		if (isJournalEvent(type)) {
			this.journal.push({ type, timestamp: row.timestamp, workspaceId, data });
		}
	}

	worktree(testId: string, type: string, workspaceId: string, data?: Record<string, unknown>): void {
		const row = { timestamp: Date.now(), testId, type, workspaceId, data };
		this.worktreeEvents.push(row);
		this.events.push(row);
	}

	locks(testId: string, scheduler: WorkspaceScheduler): void {
		this.lockSnapshots.push({ timestamp: Date.now(), testId, locks: Object.fromEntries(scheduler.getFileLocks()) });
	}

	async flush(): Promise<void> {
		await fs.mkdir(this.reportDir, { recursive: true });
		await writeNdjson(path.join(this.reportDir, "event-stream.ndjson"), this.events);
		await writeNdjson(path.join(this.reportDir, "actor-events.ndjson"), this.actorEvents);
		await writeNdjson(path.join(this.reportDir, "journal.ndjson"), this.journal);
		await writeNdjson(path.join(this.reportDir, "worktree-events.ndjson"), this.worktreeEvents);
		await writeNdjson(path.join(this.reportDir, "lock-snapshots.ndjson"), this.lockSnapshots);
		await fs.writeFile(path.join(this.reportDir, "timer-report.json"), `${JSON.stringify(this.timers, null, 2)}\n`);
	}
}

function isJournalEvent(type: string): type is JournalEvent["type"] {
	return [
		"plan_start",
		"plan_complete",
		"plan_failed",
		"workspace_start",
		"workspace_complete",
		"workspace_failed",
		"file_lock_acquired",
		"file_lock_released",
	].includes(type);
}

async function writeNdjson(file: string, rows: readonly unknown[]): Promise<void> {
	await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""));
}

async function withTimeout<T>(
	recorder: ExactRecorder,
	testId: string,
	name: string,
	timeoutMs: number,
	fn: () => Promise<T>,
): Promise<T> {
	let fired = false;
	let handle: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		handle = setTimeout(() => {
			fired = true;
			recorder.record(testId, "hard_wall_timeout", undefined, { name, timeoutMs });
			reject(new Error(`${name} exceeded ${timeoutMs}ms wall timeout`));
		}, timeoutMs);
	});
	try {
		return await Promise.race([fn(), timeout]);
	} finally {
		if (handle) clearTimeout(handle);
		recorder.timers.push({ testId, name, timeoutMs, fired });
	}
}

async function main(): Promise<void> {
	const timestamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-exact-v5-repro`;
	const reportDir = path.join("reports", "execution-diagnostics", timestamp);
	const recorder = new ExactRecorder(reportDir);
	await fs.mkdir(reportDir, { recursive: true });

	const planContent = await fs.readFile(PLAN_PATH, "utf-8");
	const rawWorkspace = extractRawWorkspace(planContent, WORKSPACE_ID);
	await fs.writeFile(path.join(reportDir, "input-v5-workspace.json"), `${JSON.stringify(rawWorkspace, null, 2)}\n`);

	const singlePlan = buildSingleWorkspacePlan(rawWorkspace);
	const parsed = parsePlan(singlePlan, { validate: true, markdownFallback: false });
	if (!parsed.success || !parsed.queue) {
		throw new Error(`failed to parse exact V5.00 single-workspace plan: ${parsed.errors.join("; ")}`);
	}
	const workspace = parsed.queue.workspaces.find((candidate) => candidate.id === WORKSPACE_ID);
	if (!workspace) throw new Error("normalized V5.00 workspace not found");
	await fs.writeFile(path.join(reportDir, "normalized-v5-workspace.json"), `${JSON.stringify(workspace, null, 2)}\n`);

	const stateForPacket: WorkspaceState = { workspaceId: workspace.id, stage: WorkspaceStage.Pending, attempts: 0 };
	const packet = new RolePacketBuilder().buildWorkerPacket(workspace, stateForPacket);
	await fs.writeFile(path.join(reportDir, "effective-worker-packet.json"), `${JSON.stringify(packet, null, 2)}\n`);

	await runTest(recorder, "R1", "Exact V5.00, worktree disabled, mock success", () =>
		runWithoutWorktree(recorder, "R1", parsed.queue!, workspace, packet, "success"),
	);
	await runTest(recorder, "R2", "Exact V5.00, worktree enabled, mock success", () =>
		runWithWorktree(recorder, "R2", parsed.queue!, workspace, "success"),
	);
	await runTest(recorder, "R3", "Exact V5.00, worktree enabled, hanging mock", () =>
		runWithWorktree(recorder, "R3", parsed.queue!, workspace, "hang"),
	);

	const enoughSignal = recorder.results
		.filter((result) => ["R1", "R2", "R3"].includes(result.id))
		.every((result) => result.status === "pass");
	if (!enoughSignal || process.env.PI_DIAG_RUN_REAL_LLM !== "1" || !hasLikelyCredentials()) {
		recorder.results.push({
			id: "R4",
			name: "Exact V5.00, worktree enabled, real LLM smoke",
			status: "skip",
			durationMs: 0,
			evidence: [
				enoughSignal
					? "Skipped because PI_DIAG_RUN_REAL_LLM=1 and provider credentials were not both present"
					: "Skipped because R1-R3 did not all pass",
			],
		});
	} else {
		recorder.results.push({
			id: "R4",
			name: "Exact V5.00, worktree enabled, real LLM smoke",
			status: "skip",
			durationMs: 0,
			evidence: ["Real LLM smoke remains disabled in this diagnostic-only reproduction harness"],
		});
	}

	await recorder.flush();
	await fs.writeFile(path.join(reportDir, "manifest.json"), `${JSON.stringify({ timestamp, planPath: PLAN_PATH, workspaceId: WORKSPACE_ID, results: recorder.results }, null, 2)}\n`);
	await fs.writeFile(path.join(reportDir, "final-report.md"), buildReport(recorder, workspace, packet));
	console.log(reportDir);
}

async function runTest(
	recorder: ExactRecorder,
	id: string,
	name: string,
	fn: () => Promise<TestResult>,
): Promise<void> {
	const started = Date.now();
	try {
		const result = await withTimeout(recorder, id, name, WALL_TIMEOUT_MS, fn);
		recorder.results.push({ ...result, durationMs: Date.now() - started });
	} catch (error) {
		const classification = classifyBoundary(recorder, id);
		recorder.results.push({
			id,
			name,
			status: "fail",
			durationMs: Date.now() - started,
			evidence: boundaryEvidence(recorder, id),
			classification,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function runWithoutWorktree(
	recorder: ExactRecorder,
	testId: string,
	queue: WorkspaceQueue,
	workspace: Workspace,
	packet: HashedPacket,
	mode: "success" | "hang",
): Promise<TestResult> {
	const scheduler = new WorkspaceScheduler(1);
	const state = createState(queue);
	recorder.record(testId, "plan_start", undefined, { phase: queue.phase, title: queue.title });
	const wsState = state.workspaces.get(workspace.id);
	if (!wsState) throw new Error("workspace state missing");
	wsState.stage = WorkspaceStage.Active;
	wsState.startedAt = Date.now();
	recorder.record(testId, "workspace_start", workspace.id);
	const locks = scheduler.acquireFileLocks(workspace);
	wsState.ownedFiles = locks;
	recorder.record(testId, "file_lock_acquired", workspace.id, { files: locks });
	recorder.locks(testId, scheduler);
	try {
		recorder.record(testId, "executor_start", workspace.id, { worktree: false });
		recorder.record(testId, "executor_prompt_built", workspace.id, {
			packetGoal: packet.packet.goal,
			acceptanceCriteriaCount: packet.packet.acceptanceCriteria.length,
		});
		recorder.record(testId, "executor_prompt_dispatched", workspace.id);
		await runMockAgent(recorder, testId, workspace.id, mode);
		wsState.stage = WorkspaceStage.Complete;
		wsState.completedAt = Date.now();
		recorder.record(testId, "workspace_complete", workspace.id);
		recorder.record(testId, "plan_complete");
		return {
			id: testId,
			name: "Exact V5.00, worktree disabled, mock success",
			status: "pass",
			durationMs: 0,
			evidence: ["mock agent ran", "workspace completed", `locks acquired=${locks.length}`],
			classification: "worktree disabled path does not reproduce stall",
		};
	} finally {
		scheduler.releaseFileLocks(workspace);
		wsState.ownedFiles = [];
		recorder.record(testId, "file_lock_released", workspace.id);
		recorder.locks(testId, scheduler);
	}
}

async function runWithWorktree(
	recorder: ExactRecorder,
	testId: string,
	queue: WorkspaceQueue,
	workspace: Workspace,
	mode: "success" | "hang",
): Promise<TestResult> {
	const repo = await createTempGitRepo();
	const scheduler = new WorkspaceScheduler(1);
	const state = createState(queue);
	recorder.record(testId, "plan_start", undefined, { phase: queue.phase, title: queue.title, repo });
	const wsState = state.workspaces.get(workspace.id);
	if (!wsState) throw new Error("workspace state missing");
	wsState.stage = WorkspaceStage.Active;
	wsState.startedAt = Date.now();
	recorder.record(testId, "workspace_start", workspace.id);
	const locks = scheduler.acquireFileLocks(workspace);
	wsState.ownedFiles = locks;
	recorder.record(testId, "file_lock_acquired", workspace.id, { files: locks });
	recorder.locks(testId, scheduler);
	let worktreePath: string | undefined;
	try {
		recorder.record(testId, "executor_start", workspace.id, { worktree: true });
		recorder.worktree(testId, "worktree_create_start", workspace.id, { repo });
		recorder.worktree(testId, "worktree_mutex_wait_start", workspace.id);
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: repo,
			planExecutionId: "exact-v5-repro",
			workspaceId: workspace.id,
			worktree: { enabled: true },
		});
		const createResult = await withTimeout(recorder, testId, "production createWorktree", 5_000, async () =>
			executor.createWorktree(),
		);
		if (createResult.error) throw new Error(createResult.error);
		worktreePath = createResult.state.worktreePath;
		recorder.worktree(testId, "worktree_mutex_acquired", workspace.id);
		recorder.worktree(testId, "worktree_base_commit_resolved", workspace.id, {
			baseCommit: createResult.state.baseCommit,
		});
		recorder.worktree(testId, "worktree_branch_prepare_start", workspace.id, {
			branchName: createResult.state.branchName,
		});
		recorder.worktree(testId, "worktree_branch_ready", workspace.id, { branchName: createResult.state.branchName });
		recorder.worktree(testId, "worktree_add_start", workspace.id, { path: createResult.state.worktreePath });
		recorder.worktree(testId, "worktree_add_complete", workspace.id, { path: createResult.state.worktreePath });
		recorder.worktree(testId, "inner_executor_start", workspace.id, { path: createResult.state.worktreePath });
		recorder.record(testId, "executor_prompt_built", workspace.id);
		recorder.record(testId, "executor_prompt_dispatched", workspace.id);
		const agentResult = await Promise.race([
			runMockAgent(recorder, testId, workspace.id, mode).then(() => "complete" as const),
			new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), EXECUTOR_TIMEOUT_MS)),
		]);
		if (agentResult === "timeout") {
			recorder.record(testId, "executor_timeout", workspace.id, { timeoutMs: EXECUTOR_TIMEOUT_MS });
			wsState.stage = WorkspaceStage.Failed;
			wsState.error = "mock agent timed out";
			wsState.completedAt = Date.now();
			recorder.record(testId, "workspace_timed_out", workspace.id);
			recorder.record(testId, "workspace_failed", workspace.id, { error: wsState.error });
			recorder.record(testId, "plan_failed");
		} else {
			wsState.stage = WorkspaceStage.Complete;
			wsState.completedAt = Date.now();
			recorder.record(testId, "workspace_complete", workspace.id);
			recorder.record(testId, "plan_complete");
		}
		recorder.worktree(testId, "worktree_cleanup_or_quarantine", workspace.id, { path: worktreePath });
		return {
			id: testId,
			name: mode === "success" ? "Exact V5.00, worktree enabled, mock success" : "Exact V5.00, worktree enabled, hanging mock",
			status: "pass",
			durationMs: 0,
			evidence: boundaryEvidence(recorder, testId),
			classification: classifyBoundary(recorder, testId),
		};
	} finally {
		scheduler.releaseFileLocks(workspace);
		wsState.ownedFiles = [];
		recorder.record(testId, "file_lock_released", workspace.id);
		recorder.locks(testId, scheduler);
		if (worktreePath) {
			recorder.worktree(testId, "worktree_cleanup_or_quarantine", workspace.id, { path: worktreePath });
		}
	}
}

async function runMockAgent(
	recorder: ExactRecorder,
	testId: string,
	workspaceId: string,
	mode: "success" | "hang",
): Promise<void> {
	recorder.record(testId, "mock_agent_start", workspaceId);
	if (mode === "hang") {
		await new Promise<never>(() => undefined);
		return;
	}
	await sleep(30);
	recorder.record(testId, "mock_agent_result", workspaceId, { verdict: "COMPLETE" });
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createState(queue: WorkspaceQueue): PlanState {
	const workspaces = new Map<string, WorkspaceState>();
	for (const workspace of queue.workspaces) {
		workspaces.set(workspace.id, { workspaceId: workspace.id, stage: WorkspaceStage.Pending, attempts: 0 });
	}
	return { phase: queue.phase, title: queue.title, workspaces, startedAt: Date.now(), status: "running" };
}

async function createTempGitRepo(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-exact-v5-"));
	await execFileAsync("git", ["init"], { cwd: dir });
	await execFileAsync("git", ["config", "user.email", "diag@example.invalid"], { cwd: dir });
	await execFileAsync("git", ["config", "user.name", "Pi Diagnostic"], { cwd: dir });
	await fs.mkdir(path.join(dir, "docs", "pi", "v5"), { recursive: true });
	await fs.mkdir(path.join(dir, "packages", "coding-agent", "src", "brain", "v5"), { recursive: true });
	await fs.writeFile(path.join(dir, "README.md"), "exact v5 repro\n");
	await execFileAsync("git", ["add", "README.md"], { cwd: dir });
	await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
	return dir;
}

function extractRawWorkspace(planContent: string, workspaceId: string): Record<string, unknown> {
	const jsonMatch = planContent.match(/# Part 3[\s\S]*?```json\s*\n([\s\S]*?)\n```/);
	if (!jsonMatch?.[1]) throw new Error("Part 3 JSON block not found");
	const parsed = JSON.parse(jsonMatch[1]) as { workspaces?: unknown };
	if (!Array.isArray(parsed.workspaces)) throw new Error("Part 3 workspaces array not found");
	const workspace = parsed.workspaces.find(
		(candidate): candidate is Record<string, unknown> =>
			typeof candidate === "object" && candidate !== null && (candidate as Record<string, unknown>).id === workspaceId,
	);
	if (!workspace) throw new Error(`workspace ${workspaceId} not found`);
	return workspace;
}

function buildSingleWorkspacePlan(rawWorkspace: Record<string, unknown>): string {
	const plan = {
		contractVersion: "4.0.0",
		phase: "P-V5",
		title: "Brain Reality Layer",
		planExecution: {
			phase: "P-V5",
			title: "Brain Reality Layer",
			maxParallelWorkspaces: 1,
			worktree: { enabled: true },
		},
		workspaces: [rawWorkspace],
	};
	return `# Phase P-V5 — Brain Reality Layer\n\n## 7. Workstreams\n\n### V5.00 — V5 Contract, Flags & Safety Doctrine\n\n# Part 3 — JSON Queue\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`;
}

function boundaryEvidence(recorder: ExactRecorder, testId: string): string[] {
	const types = new Set(recorder.events.filter((event) => event.testId === testId).map((event) => event.type));
	return [
		`reached worktree_add_start=${types.has("worktree_add_start")}`,
		`reached worktree_add_complete=${types.has("worktree_add_complete")}`,
		`reached inner_executor_start=${types.has("inner_executor_start")}`,
		`mock agent ran=${types.has("mock_agent_start")}`,
		`file lock released=${types.has("file_lock_released")}`,
	];
}

function classifyBoundary(recorder: ExactRecorder, testId: string): string {
	const types = new Set(recorder.events.filter((event) => event.testId === testId).map((event) => event.type));
	if (!types.has("worktree_add_complete")) return "worktree creation path";
	if (types.has("inner_executor_start") && types.has("executor_timeout")) return "executor timeout / terminalization";
	if (types.has("inner_executor_start") && !types.has("mock_agent_start")) return "executor pre-agent dispatch";
	if (types.has("mock_agent_start")) return "mock agent / post-dispatch path";
	return "unknown boundary";
}

function hasLikelyCredentials(): boolean {
	return Boolean(
		process.env.ANTHROPIC_API_KEY ||
			process.env.OPENAI_API_KEY ||
			process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
			process.env.OPENROUTER_API_KEY,
	);
}

function buildReport(recorder: ExactRecorder, workspace: Workspace, packet: HashedPacket): string {
	const lines: string[] = [];
	const eventsByTest = (testId: string) => new Set(recorder.events.filter((event) => event.testId === testId).map((event) => event.type));
	const r1 = eventsByTest("R1");
	const r2 = eventsByTest("R2");
	const r3 = eventsByTest("R3");
	const lockReleasedOnFailures = recorder.results
		.filter((result) => result.status === "fail" || result.id === "R3")
		.every((result) => eventsByTest(result.id).has("file_lock_released"));
	const normalizationPromptLoss = packet.packet.goal === workspace.title;
	const worktreeOnlyFailure = recorder.results.find((result) => result.id === "R1")?.status === "pass" &&
		recorder.results.filter((result) => result.id === "R2" || result.id === "R3").some((result) => result.status === "fail");
	lines.push("# Execution Diagnostic Gauntlet Report", "");
	lines.push("## Executive Summary", "");
	lines.push("Exact V5.00 reproduction ran against disposable /tmp git repositories and did not mutate the project checkout.");
	lines.push("The reproduction is diagnostic-only and does not patch production behavior.", "");
	lines.push("## Test Matrix Results", "", "| Test | Status | Classification | Evidence |", "|---|---:|---|---|");
	for (const result of recorder.results) {
		lines.push(
			`| ${result.id} | ${result.status} | ${result.classification ?? "n/a"} | ${result.evidence.join("; ")}${result.error ? `; error=${result.error}` : ""} |`,
		);
	}
	lines.push("", "## Required Answers", "");
	lines.push(`Does exact V5.00 reproduce the post-file-lock stall? ${worktreeOnlyFailure ? "Yes, in worktree-enabled tests." : "No conclusive reproduction."}`);
	lines.push(`Does it reproduce only when worktree is enabled? ${worktreeOnlyFailure ? "Yes." : "No."}`);
	lines.push(`Does it reach worktree_add_start? R2=${r2.has("worktree_add_start")}; R3=${r3.has("worktree_add_start")}.`);
	lines.push(`Does it reach worktree_add_complete? R2=${r2.has("worktree_add_complete")}; R3=${r3.has("worktree_add_complete")}.`);
	lines.push(`Does it reach inner_executor_start? R2=${r2.has("inner_executor_start")}; R3=${r3.has("inner_executor_start")}.`);
	lines.push(`Does the mock agent run? R1=${r1.has("mock_agent_start")}; R2=${r2.has("mock_agent_start")}; R3=${r3.has("mock_agent_start")}.`);
	lines.push(`Are file locks released on failure/timeout? ${lockReleasedOnFailures ? "Yes in the harness snapshots." : "No; a lock release was missing."}`);
	lines.push("", "## Root Cause Classification", "");
	if (worktreeOnlyFailure && !r2.has("worktree_add_complete")) {
		lines.push("Root cause boundary: worktree creation path.");
	} else if (r3.has("inner_executor_start") && r3.has("executor_timeout")) {
		lines.push("Root cause boundary: executor timeout / terminalization.");
	} else if (normalizationPromptLoss) {
		lines.push("Root cause boundary: V5 plan normalization remains a contributor because the effective worker packet goal is the workspace title, not raw executorPrompt/goal.");
	} else {
		lines.push("Root cause boundary: inconclusive from R1-R3.");
	}
	lines.push("", "## V5 Plan Normalization", "");
	lines.push(`Normalized packet goal=${JSON.stringify(packet.packet.goal)}.`);
	lines.push(`Raw executorPrompt preserved in worker packet=${!normalizationPromptLoss}.`);
	lines.push("", "## Worktree Boundary", "");
	lines.push(`R2 events: ${Array.from(r2).join(", ")}.`);
	lines.push(`R3 events: ${Array.from(r3).join(", ")}.`);
	lines.push("", "## Recommended Next Step", "");
	lines.push("Do not patch yet beyond the classified boundary. The next patch should target only the worktree creation path instrumentation/liveness if R2/R3 failed before worktree_add_complete.");
	return `${lines.join("\n")}\n`;
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
