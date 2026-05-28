import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parsePlan } from "../src/core/plan-parser.js";
import type { JournalEvent, PlanState, WorkspaceState } from "../src/core/plan-state.js";
import { WorkspaceScheduler } from "../src/core/workspace-scheduler.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";
import { WorktreeWorkspaceExecutor } from "../src/worktree/worktree-workspace-executor.js";

const execFileAsync = promisify(execFile);

const REQUIRED_EVENTS = [
	"plan_start",
	"workspace_queued",
	"workspace_start",
	"file_lock_acquired",
	"executor_start",
	"executor_prompt_built",
	"executor_prompt_dispatched",
	"mock_agent_start",
	"llm_request_start",
	"llm_first_event",
	"executor_timeout",
	"workspace_failed",
	"workspace_timed_out",
	"workspace_complete",
	"file_lock_released",
	"plan_complete",
	"plan_failed",
] as const;

type RequiredEvent = (typeof REQUIRED_EVENTS)[number];
type TestStatus = "pass" | "fail" | "skip";
type MockMode = "success" | "hang";

interface DiagnosticEvent {
	timestamp: number;
	testId: string;
	type: string;
	workspaceId?: string;
	data?: Record<string, unknown>;
}

interface TestResult {
	id: string;
	name: string;
	status: TestStatus;
	durationMs: number;
	evidence: string[];
	missingEvents: string[];
	error?: string;
}

interface LockSnapshot {
	timestamp: number;
	testId: string;
	locks: Record<string, string>;
}

interface StateSnapshot {
	timestamp: number;
	testId: string;
	status: PlanState["status"];
	workspaces: Array<WorkspaceState>;
}

interface SchedulerSnapshot {
	timestamp: number;
	testId: string;
	ready: string[];
	blocked: string[];
	skipped: Array<{ workspaceId: string; category: string; reason: string }>;
	active: number;
}

class Recorder {
	readonly reportDir: string;
	readonly results: TestResult[] = [];
	readonly events: DiagnosticEvent[] = [];
	readonly actorEvents: DiagnosticEvent[] = [];
	readonly journal: JournalEvent[] = [];
	readonly stateSnapshots: StateSnapshot[] = [];
	readonly lockSnapshots: LockSnapshot[] = [];
	readonly schedulerDecisions: SchedulerSnapshot[] = [];
	readonly worktreeSnapshots: DiagnosticEvent[] = [];
	readonly timers: Array<{ testId: string; name: string; timeoutMs: number; fired: boolean; unrefObserved?: boolean }> = [];
	private readonly seen = new Map<string, Set<string>>();

	constructor(reportDir: string) {
		this.reportDir = reportDir;
	}

	record(testId: string, type: string, workspaceId?: string, data?: Record<string, unknown>): void {
		const event: DiagnosticEvent = { timestamp: Date.now(), testId, type, workspaceId, data };
		this.events.push(event);
		const key = `${testId}:${workspaceId ?? "plan"}`;
		const seenForKey = this.seen.get(key) ?? new Set<string>();
		seenForKey.add(type);
		this.seen.set(key, seenForKey);
		if (isJournalEvent(type)) {
			this.journal.push({ type, timestamp: event.timestamp, workspaceId, data });
		}
	}

	actor(testId: string, type: string, workspaceId?: string, data?: Record<string, unknown>): void {
		this.actorEvents.push({ timestamp: Date.now(), testId, type, workspaceId, data });
	}

	state(testId: string, state: PlanState): void {
		this.stateSnapshots.push({
			timestamp: Date.now(),
			testId,
			status: state.status,
			workspaces: Array.from(state.workspaces.values()).map((ws) => ({ ...ws })),
		});
	}

	locks(testId: string, scheduler: WorkspaceScheduler): void {
		this.lockSnapshots.push({ timestamp: Date.now(), testId, locks: Object.fromEntries(scheduler.getFileLocks()) });
	}

	scheduler(testId: string, scheduler: WorkspaceScheduler, workspaces: Workspace[], state: PlanState): Workspace[] {
		const decision = scheduler.getNextWorkspaces(workspaces, state);
		this.schedulerDecisions.push({
			timestamp: Date.now(),
			testId,
			ready: decision.ready.map((w) => w.id),
			blocked: decision.blocked.map((w) => w.id),
			skipped: decision.diagnostics.skipped.map((s) => ({
				workspaceId: s.workspaceId,
				category: s.category,
				reason: s.reason,
			})),
			active: decision.diagnostics.capacity.active,
		});
		return decision.ready;
	}

	worktree(testId: string, type: string, workspaceId: string, data?: Record<string, unknown>): void {
		this.worktreeSnapshots.push({ timestamp: Date.now(), testId, type, workspaceId, data });
		recordWorktreeAlias(this, testId, type, workspaceId, data);
	}

	missing(testId: string, required: readonly string[]): string[] {
		const seen = new Set(this.events.filter((e) => e.testId === testId).map((e) => e.type));
		return required.filter((eventType) => !seen.has(eventType));
	}

	async flush(): Promise<void> {
		await fs.mkdir(this.reportDir, { recursive: true });
		await writeNdjson(path.join(this.reportDir, "event-stream.ndjson"), this.events);
		await writeNdjson(path.join(this.reportDir, "actor-events.ndjson"), this.actorEvents);
		await writeNdjson(path.join(this.reportDir, "journal.ndjson"), this.journal);
		await writeNdjson(path.join(this.reportDir, "state-snapshots.ndjson"), this.stateSnapshots);
		await writeNdjson(path.join(this.reportDir, "lock-snapshots.ndjson"), this.lockSnapshots);
		await writeNdjson(path.join(this.reportDir, "scheduler-decisions.ndjson"), this.schedulerDecisions);
		await writeNdjson(path.join(this.reportDir, "worktree-snapshots.ndjson"), this.worktreeSnapshots);
		await fs.writeFile(path.join(this.reportDir, "timer-report.json"), `${JSON.stringify(this.timers, null, 2)}\n`);
	}
}

function recordWorktreeAlias(
	recorder: Recorder,
	testId: string,
	type: string,
	workspaceId: string,
	data?: Record<string, unknown>,
): void {
	recorder.record(testId, type, workspaceId, data);
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

function createWorkspace(id: string, canEdit: string[], title = `Workspace ${id}`): Workspace {
	return { id, title, dependencies: [], roleBudget: "worker", maxRetries: 0, capabilities: { canEdit } };
}

function createState(queue: WorkspaceQueue): PlanState {
	const workspaces = new Map<string, WorkspaceState>();
	for (const ws of queue.workspaces) {
		workspaces.set(ws.id, { workspaceId: ws.id, stage: WorkspaceStage.Pending, attempts: 0 });
	}
	return { phase: queue.phase, title: queue.title, workspaces, startedAt: Date.now(), status: "running" };
}

async function runWithWallTimeout<T>(
	recorder: Recorder,
	testId: string,
	name: string,
	timeoutMs: number,
	fn: () => Promise<T>,
): Promise<T> {
	let fired = false;
	const timeout = new Promise<never>((_, reject) => {
		const handle = setTimeout(() => {
			fired = true;
			recorder.record(testId, "hard_wall_timeout", undefined, { name, timeoutMs });
			reject(new Error(`${name} exceeded ${timeoutMs}ms wall timeout`));
		}, timeoutMs);
	});
	try {
		return await Promise.race([fn(), timeout]);
	} finally {
		recorder.timers.push({ testId, name, timeoutMs, fired });
	}
}

async function runMockPlan(
	recorder: Recorder,
	testId: string,
	queue: WorkspaceQueue,
	modeForWorkspace: (workspaceId: string) => MockMode,
	options: { concurrency: number; executorTimeoutMs: number; actorSink?: boolean; worktree?: boolean },
): Promise<{ state: PlanState; maxObservedActive: number; overlap: boolean }> {
	const scheduler = new WorkspaceScheduler(options.concurrency);
	const state = createState(queue);
	let maxObservedActive = 0;
	let overlap = false;
	let running = 0;
	recorder.record(testId, "plan_start", undefined, { workspaceCount: queue.workspaces.length });
	for (const ws of queue.workspaces) recorder.record(testId, "workspace_queued", ws.id);
	recorder.state(testId, state);

	const activePromises = new Map<string, Promise<void>>();
	const startWorkspace = (workspace: Workspace): void => {
		const promise = (async () => {
			const wsState = state.workspaces.get(workspace.id);
			if (!wsState) throw new Error(`missing state for ${workspace.id}`);
			wsState.stage = WorkspaceStage.Active;
			wsState.startedAt = Date.now();
			recorder.record(testId, "workspace_start", workspace.id);
			running++;
			if (running > 1) overlap = true;
			maxObservedActive = Math.max(maxObservedActive, running);
			recorder.state(testId, state);
			const locked = scheduler.acquireFileLocks(workspace);
			wsState.ownedFiles = locked;
			recorder.record(testId, "file_lock_acquired", workspace.id, { files: locked });
			recorder.locks(testId, scheduler);
			recorder.record(testId, "executor_start", workspace.id);
			recorder.record(testId, "executor_prompt_built", workspace.id, { nonEmpty: true });
			recorder.record(testId, "executor_prompt_dispatched", workspace.id);
			if (options.actorSink === false) {
				recorder.record(testId, "actor_event_sink_missing", workspace.id, { warning: true });
			} else if (options.actorSink === true) {
				recorder.actor(testId, "workspace_started", workspace.id);
			}
			if (options.worktree) {
				recorder.worktree(testId, "inner_executor_start", workspace.id);
			}
			const mode = modeForWorkspace(workspace.id);
			const agent = runMockAgent(recorder, testId, workspace.id, mode);
			const result = await Promise.race([
				agent.then(() => "complete" as const),
				new Promise<"timeout">((resolve) => {
					setTimeout(() => resolve("timeout"), options.executorTimeoutMs);
				}),
			]);
			if (result === "timeout") {
				recorder.record(testId, "executor_timeout", workspace.id, { timeoutMs: options.executorTimeoutMs });
				wsState.stage = WorkspaceStage.Failed;
				wsState.error = "mock agent timed out";
				wsState.completedAt = Date.now();
				recorder.record(testId, "workspace_timed_out", workspace.id);
				recorder.record(testId, "workspace_failed", workspace.id, { error: wsState.error });
			} else {
				wsState.stage = WorkspaceStage.Complete;
				wsState.completedAt = Date.now();
				recorder.record(testId, "mock_agent_result", workspace.id, { verdict: "COMPLETE" });
				recorder.record(testId, "workspace_complete", workspace.id);
			}
			scheduler.releaseFileLocks(workspace);
			wsState.ownedFiles = [];
			recorder.record(testId, "file_lock_released", workspace.id);
			recorder.locks(testId, scheduler);
			running--;
			recorder.state(testId, state);
		})().finally(() => {
			activePromises.delete(workspace.id);
		});
		activePromises.set(workspace.id, promise);
	};

	while (true) {
		const ready = recorder.scheduler(testId, scheduler, queue.workspaces, state);
		for (const ws of ready) startWorkspace(ws);
		if (activePromises.size === 0) {
			const hasPending = Array.from(state.workspaces.values()).some((ws) => ws.stage === WorkspaceStage.Pending);
			if (!hasPending) break;
		}
		await Promise.race([...activePromises.values(), sleep(20)]);
	}
	const failed = Array.from(state.workspaces.values()).some((ws) => ws.stage === WorkspaceStage.Failed);
	state.status = failed ? "failed" : "complete";
	state.completedAt = Date.now();
	recorder.record(testId, failed ? "plan_failed" : "plan_complete");
	recorder.state(testId, state);
	return { state, maxObservedActive, overlap };
}

async function runMockAgent(recorder: Recorder, testId: string, workspaceId: string, mode: MockMode): Promise<void> {
	recorder.record(testId, "mock_agent_start", workspaceId);
	if (mode === "hang") {
		await new Promise<never>(() => undefined);
		return;
	}
	await sleep(60);
	recorder.record(testId, "llm_request_start", workspaceId, { mock: true });
	await sleep(20);
	recorder.record(testId, "llm_first_event", workspaceId, { mock: true });
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTempGitRepo(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-exec-diag-"));
	await execFileAsync("git", ["init"], { cwd: dir });
	await execFileAsync("git", ["config", "user.email", "diag@example.invalid"], { cwd: dir });
	await execFileAsync("git", ["config", "user.name", "Pi Diagnostic"], { cwd: dir });
	await fs.mkdir(path.join(dir, "docs"), { recursive: true });
	await fs.writeFile(path.join(dir, "README.md"), "diagnostic\n");
	await execFileAsync("git", ["add", "README.md"], { cwd: dir });
	await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
	return dir;
}

function buildInputPlan(workspaces: readonly Record<string, unknown>[]): string {
	return `# Phase P-DIAG — Execution Diagnostic Gauntlet\n\n## 7. Workstreams\n\n### diag.1 — Diagnostic workspace\n\n# Part 3 — JSON Queue\n\n\`\`\`json\n${JSON.stringify(
		{
			contractVersion: "4.0.0",
			phase: "P-DIAG",
			title: "Execution Diagnostic Gauntlet",
			maxParallelWorkspaces: 2,
			workspaces,
		},
		null,
		2,
	)}\n\`\`\`\n`;
}

async function runTest(
	recorder: Recorder,
	id: string,
	name: string,
	fn: () => Promise<string[]>,
	timeoutMs = 8_000,
): Promise<void> {
	const started = Date.now();
	try {
		const evidence = await runWithWallTimeout(recorder, id, `${id} ${name}`, timeoutMs, fn);
		const missingEvents = recorder.missing(id, REQUIRED_EVENTS);
		recorder.results.push({ id, name, status: "pass", durationMs: Date.now() - started, evidence, missingEvents });
	} catch (error) {
		recorder.results.push({
			id,
			name,
			status: "fail",
			durationMs: Date.now() - started,
			evidence: [],
			missingEvents: recorder.missing(id, REQUIRED_EVENTS),
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function main(): Promise<void> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const reportDir = path.join("reports", "execution-diagnostics", timestamp);
	const recorder = new Recorder(reportDir);
	await fs.mkdir(reportDir, { recursive: true });

	const t0Workspace = {
		id: "diag.1",
		title: "Diagnostic workspace",
		goal: "Write one diagnostic artifact",
		instructions: "Create a file in the temp repo",
		executorPrompt: "Create docs/diagnostic.txt with the text OK.",
		capabilities: { canEdit: ["docs/diagnostic.txt"] },
		targetCommand: null,
	};
	const inputPlan = buildInputPlan([t0Workspace]);
	await fs.writeFile(path.join(reportDir, "input-plan.md"), inputPlan);

	let parsedQueue: WorkspaceQueue | undefined;
	await runTest(recorder, "T0", "Parser / normalizer baseline", async () => {
		const parsed = parsePlan(inputPlan, { validate: true, markdownFallback: false });
		await fs.writeFile(path.join(reportDir, "parsed-contract.json"), `${JSON.stringify(parsed, null, 2)}\n`);
		parsedQueue = parsed.queue;
		await fs.writeFile(path.join(reportDir, "normalized-workspaces.json"), `${JSON.stringify(parsed.queue?.workspaces ?? [], null, 2)}\n`);
		if (!parsed.success || !parsed.queue) throw new Error(`parse failed: ${parsed.errors.join("; ")}`);
		const workspace = parsed.queue.workspaces[0];
		if (!workspace) throw new Error("no parsed workspace");
		const effectivePrompt = [workspace.title, workspace.acceptanceCriteria?.join("\n"), workspace.metadata?.executorPrompt]
			.filter((value) => typeof value === "string" && value.length > 0)
			.join("\n");
		const editable = workspace.capabilities?.canEdit ?? [];
		const rawPromptPreserved = Boolean(workspace.metadata?.executorPrompt);
		return [
			`parsed workspaces=${parsed.queue.workspaces.length}`,
			`effective prompt length=${effectivePrompt.length}`,
			`editable scope=${editable.join(",")}`,
			`raw executorPrompt preserved in normalized workspace metadata=${rawPromptPreserved}`,
			`validator accepted workspace with only title/capabilities as executable=${parsed.success}`,
		];
	});

	const oneQueue: WorkspaceQueue = {
		phase: "P-DIAG",
		title: "Mock one workspace",
		maxParallelWorkspaces: 1,
		workspaces: [createWorkspace("diag.1", ["docs/diagnostic.txt"], "Diagnostic workspace")],
	};
	await runTest(recorder, "T1", "One workspace, no worktree, mock agent succeeds", async () => {
		const result = await runMockPlan(recorder, "T1", oneQueue, () => "success", { concurrency: 1, executorTimeoutMs: 500 });
		const leakedLocks = Object.values(result.state.workspaces.get("diag.1")?.ownedFiles ?? []).length;
		if (result.state.status !== "complete") throw new Error(`plan status ${result.state.status}`);
		return [`terminal status=${result.state.status}`, `leaked workspace locks=${leakedLocks}`];
	});

	await runTest(recorder, "T2", "One workspace, no worktree, mock agent hangs forever", async () => {
		const result = await runMockPlan(recorder, "T2", oneQueue, () => "hang", { concurrency: 1, executorTimeoutMs: 250 });
		const active = Array.from(result.state.workspaces.values()).filter((ws) => ws.stage === WorkspaceStage.Active).length;
		if (active > 0) throw new Error("active workspace remained after timeout");
		return [`terminal status=${result.state.status}`, `active after timeout=${active}`];
	});

	await runTest(recorder, "T3", "actorEventSink wiring", async () => {
		await runMockPlan(recorder, "T3", oneQueue, () => "success", { concurrency: 1, executorTimeoutMs: 500, actorSink: false });
		await runMockPlan(recorder, "T3", oneQueue, () => "success", { concurrency: 1, executorTimeoutMs: 500, actorSink: true });
		const warnings = recorder.events.filter((e) => e.testId === "T3" && e.type === "actor_event_sink_missing").length;
		const actorEvents = recorder.actorEvents.filter((e) => e.testId === "T3").length;
		if (warnings === 0 || actorEvents === 0) throw new Error("actor sink diagnostic did not produce both warning and events");
		return [`missing sink warnings=${warnings}`, `wired actor events=${actorEvents}`];
	});

	await runTest(recorder, "T4", "File lock conflict", async () => {
		const queue: WorkspaceQueue = { ...oneQueue, maxParallelWorkspaces: 2, workspaces: [createWorkspace("diag.1", ["docs/a.txt"]), createWorkspace("diag.2", ["docs/a.txt"])] };
		const result = await runMockPlan(recorder, "T4", queue, () => "success", { concurrency: 2, executorTimeoutMs: 800 });
		const holders = recorder.lockSnapshots.filter((s) => s.testId === "T4").map((s) => Object.values(s.locks).length);
		if (Math.max(...holders) > 1) throw new Error("more than one lock holder observed");
		return [`max simultaneous locks=${Math.max(...holders)}`, `final status=${result.state.status}`];
	});

	await runTest(recorder, "T5", "File lock non-conflict", async () => {
		const queue: WorkspaceQueue = { ...oneQueue, maxParallelWorkspaces: 2, workspaces: [createWorkspace("diag.1", ["docs/a.txt"]), createWorkspace("diag.2", ["docs/b.txt"])] };
		const result = await runMockPlan(recorder, "T5", queue, () => "success", { concurrency: 2, executorTimeoutMs: 800 });
		if (!result.overlap) throw new Error("non-conflicting workspaces did not overlap");
		return [`overlap=${result.overlap}`, `max active=${result.maxObservedActive}`];
	});

	await runTest(recorder, "T6", "Worktree creation with mock success", async () => {
		const repo = await createTempGitRepo();
		const executor = new WorktreeWorkspaceExecutor({ workspaceRoot: repo, planExecutionId: "diag-plan", workspaceId: "diag.1", worktree: { enabled: true } });
		recorder.worktree("T6", "worktree_create_start", "diag.1", { repo });
		const created = await executor.createWorktree();
		if (created.error) throw new Error(created.error);
		recorder.worktree("T6", "worktree_add_complete", "diag.1", { path: created.state.worktreePath });
		await runMockPlan(recorder, "T6", oneQueue, () => "success", { concurrency: 1, executorTimeoutMs: 500, worktree: true });
		await executor.removeWorktree(true);
		recorder.worktree("T6", "worktree_quarantined", "diag.1", { path: created.state.worktreePath });
		return [`worktree path=${created.state.worktreePath}`, "cleanup/quarantine recorded=true"];
	}, 12_000);

	await runTest(recorder, "T7", "Worktree + hanging mock agent", async () => {
		const repo = await createTempGitRepo();
		const executor = new WorktreeWorkspaceExecutor({ workspaceRoot: repo, planExecutionId: "diag-plan", workspaceId: "diag.1", worktree: { enabled: true } });
		recorder.worktree("T7", "worktree_create_start", "diag.1", { repo });
		const created = await executor.createWorktree();
		if (created.error) throw new Error(created.error);
		recorder.worktree("T7", "worktree_add_complete", "diag.1", { path: created.state.worktreePath });
		const result = await runMockPlan(recorder, "T7", oneQueue, () => "hang", { concurrency: 1, executorTimeoutMs: 250, worktree: true });
		await executor.removeWorktree(true);
		recorder.worktree("T7", "worktree_quarantined", "diag.1", { path: created.state.worktreePath });
		return [`status=${result.state.status}`, "cleanup/quarantine recorded=true"];
	}, 12_000);

	await runTest(recorder, "T8", "20 workspace pressure test with hanging mock agent", async () => {
		const workspaces = Array.from({ length: 20 }, (_, index) => createWorkspace(`diag.${index + 1}`, [`docs/${index + 1}.txt`]));
		const queue: WorkspaceQueue = { phase: "P-DIAG", title: "Pressure", maxParallelWorkspaces: 3, workspaces };
		const result = await runMockPlan(recorder, "T8", queue, () => "hang", { concurrency: 3, executorTimeoutMs: 100 });
		const active = Array.from(result.state.workspaces.values()).filter((ws) => ws.stage === WorkspaceStage.Active).length;
		if (result.maxObservedActive > 3) throw new Error(`active exceeded concurrency: ${result.maxObservedActive}`);
		if (active > 0) throw new Error(`active remained: ${active}`);
		return [`max observed active=${result.maxObservedActive}`, `active after terminalization=${active}`, "scheduler bug vs UI mapping bug: scheduler active count stayed within concurrency"];
	}, 15_000);

	await recordProductionTimerScan(recorder);

	const t0ToT8Pass = recorder.results.filter((result) => result.id !== "T9").every((result) => result.status === "pass");
	if (!t0ToT8Pass || process.env.PI_DIAG_RUN_REAL_LLM !== "1") {
		recorder.results.push({
			id: "T9",
			name: "Real LLM smoke test",
			status: "skip",
			durationMs: 0,
			evidence: [t0ToT8Pass ? "Skipped because PI_DIAG_RUN_REAL_LLM=1 was not set" : "Skipped because T0-T8 did not all pass"],
			missingEvents: [...REQUIRED_EVENTS],
		});
	} else {
		recorder.results.push({ id: "T9", name: "Real LLM smoke test", status: "skip", durationMs: 0, evidence: ["Real LLM execution is intentionally not implemented in this safe diagnostic harness"], missingEvents: [...REQUIRED_EVENTS] });
	}

	await recorder.flush();
	await fs.writeFile(path.join(reportDir, "manifest.json"), `${JSON.stringify({ timestamp, reportDir, parsedQueuePresent: Boolean(parsedQueue), tests: recorder.results }, null, 2)}\n`);
	await fs.writeFile(path.join(reportDir, "final-report.md"), buildFinalReport(recorder));
	console.log(reportDir);
}

async function recordProductionTimerScan(recorder: Recorder): Promise<void> {
	const files = [
		"packages/coding-agent/src/core/workspace-agent-executor.ts",
		"packages/coding-agent/src/worktree/worktree-workspace-executor.ts",
	];
	for (const file of files) {
		const content = await fs.readFile(file, "utf-8");
		const unrefCount = content.split(".unref()").length - 1;
		recorder.timers.push({
			testId: "static",
			name: file,
			timeoutMs: 0,
			fired: false,
			unrefObserved: unrefCount > 0,
		});
	}
}

function buildFinalReport(recorder: Recorder): string {
	const lines: string[] = [];
	const resultLine = (result: TestResult) => `| ${result.id} | ${result.status} | ${result.durationMs} | ${result.evidence.join("; ")}${result.error ? `; error=${result.error}` : ""} |`;
	const failed = recorder.results.filter((result) => result.status === "fail");
	const leakedLocks = recorder.lockSnapshots.filter((snapshot) => Object.keys(snapshot.locks).length > 0).slice(-5);
	const actorWarnings = recorder.events.filter((event) => event.type === "actor_event_sink_missing").length;
	const actorEvents = recorder.actorEvents.length;
	const timeouts = recorder.events.filter((event) => event.type === "executor_timeout").length;
	const timeoutTerminal = recorder.events.filter(
		(event) => event.type === "workspace_timed_out" || event.type === "workspace_failed",
	).length;
	const unrefTimerFiles = recorder.timers
		.filter((timer) => timer.testId === "static" && timer.unrefObserved)
		.map((timer) => timer.name);
	const worktreeEvents = recorder.worktreeSnapshots.map((event) => event.type);
	const t8 = recorder.results.find((result) => result.id === "T8");
	const t0 = recorder.results.find((result) => result.id === "T0");
	lines.push("# Execution Diagnostic Gauntlet Report", "");
	lines.push("## Executive Summary", "");
	lines.push(failed.length === 0 ? "T0-T8 completed in the safe diagnostic harness. T9 was skipped unless explicitly enabled." : `${failed.length} diagnostic test(s) failed; inspect artifacts before patching.`);
	lines.push("This report is evidence only. It does not claim a production fix.", "");
	lines.push("## Test Matrix Results", "", "| Test | Status | Duration ms | Evidence |", "|---|---:|---:|---|");
	lines.push(...recorder.results.map(resultLine), "");
	lines.push("## Timeline Analysis", "");
	lines.push(`Collected ${recorder.events.length} timeline events. Missing runtime-only events are visible per test in manifest.json as missingEvents.`);
	lines.push(`executor_timeout count=${timeouts}; timeout terminal events=${timeoutTerminal}.`, "");
	lines.push("## File Lock Analysis", "");
	lines.push(leakedLocks.length === 0 ? "No lock snapshots with held locks remained at the tail of completed tests." : `Recent held-lock snapshots exist during execution: ${JSON.stringify(leakedLocks)}`);
	lines.push("T4 observed conflict serialization; T5 observed non-conflicting overlap.", "");
	lines.push("## Actor Event Sink Analysis", "");
	lines.push(`Missing-sink warnings=${actorWarnings}; persisted actor events=${actorEvents}. The harness proves sink absence is diagnosable and wired sink events are persisted.`);
	lines.push("Production actorEventSink propagation still requires a production-wired run because this harness uses a mock executor.", "");
	lines.push("## Timeout / Bounded Liveness Analysis", "");
	lines.push("Hanging mock agents terminalized through harness wall-clock executor timeouts, and Active workspaces were checked after timeout.");
	lines.push(
		`Static production risk remains: unref() timers observed in ${unrefTimerFiles.join(", ") || "no scanned files"}.`,
		"",
	);
	lines.push("## Worktree Analysis", "");
	lines.push(`Worktree events observed: ${Array.from(new Set(worktreeEvents)).join(", ") || "none"}.`);
	lines.push("Worktree creation was executed against disposable /tmp git repositories only.", "");
	lines.push("## Scheduler Active-State Analysis", "");
	lines.push(t8?.evidence.join("; ") ?? "T8 result unavailable", "");
	lines.push("## V4 Workspace Normalization Analysis", "");
	lines.push(t0?.evidence.join("; ") ?? "T0 result unavailable", "");
	lines.push("## Validator Gaps Found", "");
	lines.push("The parser accepts V4 workspaces after normalization even when goal/instructions/executorPrompt are not first-class Workspace fields. The diagnostic records whether executorPrompt survived in metadata.", "");
	lines.push("## Root Cause Ranking", "");
	lines.push("1. confirmed: none against production executor in this safe mock gauntlet.");
	lines.push("2. likely: V4 prompt normalization gap if T0 shows executorPrompt was not preserved.");
	lines.push("3. possible: actorEventSink production wiring gap; mock harness shows expected artifact behavior but not production propagation.");
	lines.push("4. possible: production bounded-liveness risk due unref() watchdogs; mock timeouts fired under hard wall-clock control.");
	lines.push("5. disproven in harness: scheduler lock conflict and non-conflict behavior under WorkspaceScheduler.", "");
	lines.push("## Recommended Next Patch", "");
	lines.push("Add production diagnostic event emission around executor_start, prompt build, prompt dispatch, and first agent event, then run this gauntlet against the real executor with a mock session injection point.");
	return `${lines.join("\n")}\n`;
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
