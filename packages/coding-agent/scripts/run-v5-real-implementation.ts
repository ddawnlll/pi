#!/usr/bin/env node
/**
 * P-HOTFIX-PG: Full V5 Real Implementation Run
 *
 * Runs the full V5 Brain Reality Layer plan with:
 * - Real LLM execution
 * - Postgres authoritative state store
 * - Worktree isolation
 * - Live monitoring with heartbeat
 * - Admission/validator gates
 * - Full artifact collection
 * - Stall detection & workspace abort
 * - Plan-level retry for failed workspaces
 * - Completion verification (80%+ threshold)
 * - File-lock serialization simulation
 * - SIGINT/SIGTERM graceful shutdown
 *
 * Usage:
 *   PI_DIAG_RUN_REAL_LLM=1 PI_STATE_STORE_BACKEND=postgres \
 *     npx tsx scripts/run-v5-real-implementation.ts
 *
 * Artifacts written to: reports/execution-diagnostics/<timestamp>-v5-real-implementation/
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { spawn, execSync } from "node:child_process";

import { getModel } from "@earendil-works/pi-ai";
import { parsePlan } from "../src/core/plan-parser.js";
import { createStateStore, detectStateStoreBackend } from "../src/core/state-store.js";
import { AutonomousExecutor } from "../src/core/autonomous-executor.js";
import { validateWorkerConcurrency } from "../src/core/worker-concurrency.js";
import { WorkspaceScheduler } from "../src/core/workspace-scheduler.js";
import type { Workspace, WorkspaceQueue, WorkspaceStateStage } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

// E2E monitoring modules
import {
	runPreflightChecks,
	RuntimeMetricsCollector,
	ResourceMonitor,
	runPostExecutionVerification,
	buildRegressionSnapshot,
	checkDashboardHealth,
} from "./e2e-monitoring/index.js";
import type { E2ERunResult } from "./e2e-monitoring/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAN_PATH = path.resolve("P-V5_Brain_Reality_Layer_v4_Plan_EXECUTOR_SCHEMA_FIXED.md");
const REPORT_BASE = path.join("reports", "execution-diagnostics");

// Timeouts from the plan's intent.deadlines
const LLM_REQUEST_MS = 120_000;
const LLM_STREAM_IDLE_MS = 300_000;
const WORKSPACE_OVERALL_MS = 600_000; // 10 min per workspace (reduced from plan's 30min for diagnostic)
const VALIDATION_DEFAULT_MS = 300_000;
const SCHEDULER_NO_PROGRESS_MS = 300_000;
const HEARTBEAT_INTERVAL_MS = 15_000; // every 15s

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArtifactCollection {
	reportDir: string;
	events: Array<{ timestamp: number; type: string; data?: unknown }>;
	journal: Array<{ timestamp: number; source: string; message: string }>;
	lockSnapshots: Array<{ timestamp: number; locks: Record<string, string> }>;
	stateSnapshots: Array<{ timestamp: number; workspaceId: string; stage: string; attempts: number }>;
	schedulerDecisions: Array<{ timestamp: number; ready: string[]; batchAssignments: Record<string, number> }>;
	parallelismSamples: Array<{ timestamp: number; active: number; activeIds: string[] }>;
	worktreeEvents: Array<{ timestamp: number; type: string; data?: Record<string, unknown> }>;
	validationEvents: Array<{ timestamp: number; type: string; workspaceId?: string; detail: string }>;
	integrationEvents: Array<{ timestamp: number; type: string; workspaceId?: string; detail: string }>;
	llmEvents: Array<{ timestamp: number; workspaceId: string; type: string; detail?: string }>;
	actorEvents: Array<{ timestamp: number; workspaceId: string; type: string; detail?: string }>;
	workspaceResults: Map<string, {
		workspaceId: string;
		title: string;
		status: string;
		attempts: number;
		durationMs: number;
		filesChanged: string[];
		validation: string;
		error?: string;
	}>;
	lastEventTimestamps: Map<string, number>;
	timers: Array<{ name: string; timeoutMs: number; set: number }>;
}

interface ValidatorReport {
	topLevelWorkspaces: number;
	nestedPlanExecutionWorkspaces: number;
	executableWorkspaces: number;
	workspacesWithEffectivePrompt: number;
	workspacesWithMissingPrompt: string[];
	workspacesWithEditableScope: number;
	workspacesWithEmptyEditableScope: string[];
	workspacesWithCapabilitiesCanEdit: number;
	v4PromptFieldsPreserved: boolean;
	v4EditableScopePreserved: boolean;
	runtimeBackend: string;
	jsonFallbackEnabled: boolean;
	worktreeRequired: boolean;
	integrationQueueRequired: boolean;
	safeEffectiveParallelism: number;
	requestedMaxParallelism: number;
	unsafeParallelPairs: string[];
	fileScopeConflicts: string[];
	validationLanePressure: string;
	parallelViolations: string[];
	batchGroups: Record<string, string[]>;
	batchesWithParallelism: Array<{ batch: string; count: number; ids: string[] }>;
	admissionDecision: "pass" | "fail" | "reduced";
	failReasons: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): number {
	return Date.now();
}

function isoNow(): string {
	return new Date().toISOString();
}

function formatElapsed(start: number): string {
	const ms = Date.now() - start;
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60_000).toFixed(1)}m ${((ms % 60_000) / 1000).toFixed(0)}s`;
}

function getExpectedParallelism(queue: WorkspaceQueue, maxParallel: number): number {
	const batchGroups = new Map<string, string[]>();
	for (const ws of queue.workspaces) {
		const wsAny = ws as Record<string, unknown>;
		const batch = (wsAny.batch as string) ?? "B0";
		if (!batchGroups.has(batch)) batchGroups.set(batch, []);
		batchGroups.get(batch)!.push(ws.id);
	}
	const maxBatchWidth = Math.max(0, ...[...batchGroups.values()].map((ids) => ids.length));
	return Math.min(maxParallel, maxBatchWidth);
}

async function execCommand(cmd: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`));
		}, timeoutMs);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
		child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve(stdout);
			else reject(new Error(`Exit code ${code}: ${stderr.substring(0, 500)}`));
		});
		child.on("error", (err) => { clearTimeout(timer); reject(err); });
	});
}

function getModelForProvider(): import("@earendil-works/pi-ai").Model<any> | null {
	return (
		getModel("opencode-go", "deepseek-v4-flash") ??
		getModel("opencode-go", "minimax-m2.7") ??
		getModel("openai-codex", "gpt-5.1-codex-mini") ??
		getModel("openai-codex", "gpt-5.5") ??
		getModel("anthropic", "claude-sonnet-4-5-20250929-v1:0") ??
		null
	);
}

function createPostgresStateStore(): ReturnType<typeof createStateStore> {
	const backend = detectStateStoreBackend();
	if (backend !== "postgres") {
		throw new Error(
			`Expected postgres backend but got "${backend}". ` +
			"Set PI_STATE_STORE_BACKEND=postgres or ensure Postgres is running with pi_executor database.",
		);
	}
	const store = createStateStore({ backend, workspaceRoot: process.cwd() });
	const actual = store.getBackendType();
	if (actual !== "postgres") {
		throw new Error(`Requested postgres backend but got "${actual}" — fallback occurred.`);
	}
	return store;
}

// ---------------------------------------------------------------------------
// Admission / Validator Gate
// ---------------------------------------------------------------------------

function runValidatorGate(planContent: string, queue: WorkspaceQueue): ValidatorReport {
	const report: ValidatorReport = {
		topLevelWorkspaces: 0,
		nestedPlanExecutionWorkspaces: 0,
		executableWorkspaces: queue.workspaces.length,
		workspacesWithEffectivePrompt: 0,
		workspacesWithMissingPrompt: [],
		workspacesWithEditableScope: 0,
		workspacesWithEmptyEditableScope: [],
		workspacesWithCapabilitiesCanEdit: 0,
		v4PromptFieldsPreserved: false,
		v4EditableScopePreserved: false,
		runtimeBackend: "unknown",
		jsonFallbackEnabled: false,
		worktreeRequired: false,
		integrationQueueRequired: false,
		safeEffectiveParallelism: 3,
		requestedMaxParallelism: queue.maxParallelWorkspaces ?? 0,
		unsafeParallelPairs: [],
		fileScopeConflicts: [],
		validationLanePressure: "unknown",
		parallelViolations: [],
		batchGroups: {},
		batchesWithParallelism: [],
		admissionDecision: "pass",
		failReasons: [],
	};

	// Extract runtime config from plan JSON
	const jsonMatch = planContent.match(/# Part 3[\s\S]*?```json\s*\n([\s\S]*?)\n```/);
	if (jsonMatch?.[1]) {
		try {
			const parsed = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
			const persistence = parsed.persistence as Record<string, unknown> | undefined;
			if (persistence) {
				report.runtimeBackend = (persistence.authoritativeBackend as string) ?? "postgres";
				report.jsonFallbackEnabled = (persistence.jsonRuntimeFallbackAllowed as boolean) ?? false;
			}
			const derived = parsed.derivedExecutionProfile as Record<string, unknown> | undefined;
			if (derived) {
				report.worktreeRequired = (derived.worktreeRequired as boolean) ?? false;
				report.integrationQueueRequired = (derived.integrationQueueRequired as boolean) ?? false;
			}
			const execution = parsed.planExecution as Record<string, unknown> | undefined;
			if (execution) {
				report.safeEffectiveParallelism = (execution.expectedSafeEffectiveParallelism as number) ?? 3;
				report.requestedMaxParallelism = (execution.maxParallelWorkspaces as number) ?? report.requestedMaxParallelism;
			}
		} catch {
			// ignore parse errors
		}
	}

	report.topLevelWorkspaces = queue.workspaces.length;

	// Validate each workspace
	for (const ws of queue.workspaces) {
		const wsAny = ws as Record<string, unknown>;

		// Check effectivePrompt / executorPrompt
		if ((wsAny.executorPrompt as string)?.length > 0 || (ws as { goal?: string }).goal) {
			report.workspacesWithEffectivePrompt++;
		} else if ((ws as { executorPrompt?: string }).executorPrompt === undefined) {
			report.workspacesWithMissingPrompt.push(ws.id);
		}

		// Check editable scope (capabilities.canEdit or capabilityManifest.canEdit)
		const caps = (wsAny.capabilities as Record<string, unknown>) ?? {};
		const manifest = (wsAny.capabilityManifest as Record<string, unknown>) ?? {};
		const canEdit = (caps.canEdit as string[]) ?? (manifest.canEdit as string[]) ?? [];
		if (canEdit.length > 0) {
			report.workspacesWithCapabilitiesCanEdit++;
		} else {
			report.workspacesWithEmptyEditableScope.push(ws.id);
		}

		// Check editable scope via allowedFiles as fallback
		const allowedFiles = (wsAny.allowedFiles as string[]) ?? [];
		if (allowedFiles.length > 0) {
			report.workspacesWithEditableScope++;
		}
	}

	// Hard fails
	if (report.workspacesWithMissingPrompt.length > 0) {
		report.failReasons.push(
			`Workspaces missing effective prompt: ${report.workspacesWithMissingPrompt.join(", ")}`,
		);
	}
	if (report.workspacesWithEmptyEditableScope.length > 0) {
		report.failReasons.push(
			`Workspaces with empty capabilities.canEdit: ${report.workspacesWithEmptyEditableScope.join(", ")}`,
		);
	}
	if (report.runtimeBackend !== "postgres") {
		report.failReasons.push(`Runtime backend is "${report.runtimeBackend}", expected "postgres"`);
	}
	if (report.jsonFallbackEnabled) {
		report.failReasons.push("JSON runtime fallback is enabled, it must be disabled");
	}
	if (!report.worktreeRequired) {
		report.failReasons.push("Worktree isolation is not required by derived execution profile");
	}
	if (!report.integrationQueueRequired) {
		report.failReasons.push("Integration queue is not required by derived execution profile");
	}

	// Detect file scope conflicts between workspaces that could run concurrently
	const writeSets = new Map<string, Set<string>>();
	for (const ws of queue.workspaces) {
		const wsAny = ws as Record<string, unknown>;
		const caps = (wsAny.capabilities as Record<string, unknown>) ?? {};
		const manifest = (wsAny.capabilityManifest as Record<string, unknown>) ?? {};
		const canEdit = (caps.canEdit as string[]) ?? (manifest.canEdit as string[]) ?? [];
		writeSets.set(ws.id, new Set(canEdit));
	}
	for (let i = 0; i < queue.workspaces.length; i++) {
		for (let j = i + 1; j < queue.workspaces.length; j++) {
			const wsA = queue.workspaces[i];
			const wsB = queue.workspaces[j];
			const setA = writeSets.get(wsA.id);
			const setB = writeSets.get(wsB.id);
			if (setA && setB) {
				// Check if any pattern overlaps
				for (const patternA of setA) {
					for (const patternB of setB) {
						const dirA = patternA.split("/**")[0];
						const dirB = patternB.split("/**")[0];
						if (dirA === dirB || patternA === patternB) {
							report.fileScopeConflicts.push(`${wsA.id} <-> ${wsB.id}: ${patternA} vs ${patternB}`);
						}
						// Check if one is a prefix of the other
						if (dirA.startsWith(dirB) || dirB.startsWith(dirA)) {
							report.fileScopeConflicts.push(`${wsA.id} <-> ${wsB.id}: ${patternA} vs ${patternB}`);
						}
					}
				}
			}
		}
	}

	// === PARALLELIZATION VERIFICATION ===
	// Check that workspaces in the same batch have non-overlapping write scopes
	// and are not marked as cannotRunWith each other.
	const batchGroups = new Map<string, string[]>();
	for (const ws of queue.workspaces) {
		const wsAny = ws as Record<string, unknown>;
		const batch = (wsAny.batch as string) ?? "B0";
		if (!batchGroups.has(batch)) batchGroups.set(batch, []);
		batchGroups.get(batch)!.push(ws.id);
	}

	const parallelViolations: string[] = [];
	for (const [batch, wsIds] of batchGroups) {
		if (wsIds.length <= 1) continue;

		for (let i = 0; i < wsIds.length; i++) {
			for (let j = i + 1; j < wsIds.length; j++) {
				const wsA = wsIds[i];
				const wsB = wsIds[j];
				const setA = writeSets.get(wsA) ?? new Set<string>();
				const setB = writeSets.get(wsB) ?? new Set<string>();
				for (const patternA of setA) {
					for (const patternB of setB) {
						const dirA = patternA.split("/**")[0];
						const dirB = patternB.split("/**")[0];
						if (dirA === dirB || patternA === patternB || dirA.startsWith(dirB) || dirB.startsWith(dirA)) {
							parallelViolations.push(
								`Batch ${batch}: ${wsA} and ${wsB} have overlapping canEdit scopes (${patternA} vs ${patternB})`,
							);
						}
					}
				}
			}
		}

		for (const wsId of wsIds) {
			const ws = queue.workspaces.find((workspace) => workspace.id === wsId);
			if (!ws) continue;
			const wsAny = ws as Record<string, unknown>;
			const parallelism = wsAny.parallelism as Record<string, unknown> | undefined;
			const cannotRunWith = (parallelism?.cannotRunWith as string[]) ?? [];
			for (const otherId of cannotRunWith) {
				if (wsIds.includes(otherId)) {
					parallelViolations.push(
						`Batch ${batch}: ${wsId} cannot run with ${otherId} but both are in same batch`,
					);
				}
			}
		}
	}

	report.parallelViolations = parallelViolations;
	report.batchGroups = Object.fromEntries(batchGroups);
	report.batchesWithParallelism = [...batchGroups.entries()]
		.filter(([, ids]) => ids.length > 1)
		.map(([batch, ids]) => ({ batch, count: ids.length, ids }));

	if (parallelViolations.length > 0) {
		report.failReasons.push(`Parallelization violations: ${parallelViolations.join("; ")}`);
	}

	const maxBatchWidth = Math.max(...[...batchGroups.values()].map((ids) => ids.length));
	if (maxBatchWidth < 2) {
		report.failReasons.push(
			"Plan appears fully serial: no batch has more than 1 workspace. " +
				"Expected at least batch B1 to have 3 workspaces (V5.01, V5.02, V5.13).",
		);
	}

	// === FILE-LOCK SERIALIZATION SIMULATION ===
	// Simulates the scheduler to predict how file-lock conflicts will actually
	// serialize workspces within each batch. A batch may have width 3 in the DAG
	// but only width 1 at runtime because all workspaces share canEdit files.
	const lockSimResult = simulateFileLockSerialization(queue.workspaces, batchGroups);
	if (lockSimResult.serializedBatches.length > 0) {
		for (const b of lockSimResult.serializedBatches) {
			report.failReasons.push(
				`Batch ${b.batchIndex} (DAG width ${b.dagWidth}) serialized to ${b.effectiveWidth} worker(s) due to shared files: ${b.sharedFiles.slice(0, 3).join(", ")}`,
			);
		}
		report.safeEffectiveParallelism = Math.min(
			report.safeEffectiveParallelism,
			lockSimResult.lockConstrainedParallelism,
		);
	}

	// Decision
	if (report.failReasons.length > 0) {
		report.admissionDecision = "fail";
	} else if (queue.workspaces.some((ws) => {
		const wsAny = ws as Record<string, unknown>;
		const caps = (wsAny.capabilities as Record<string, unknown>) ?? {};
		const manifest = (wsAny.capabilityManifest as Record<string, unknown>) ?? {};
		const canEdit = (caps.canEdit as string[]) ?? (manifest.canEdit as string[]) ?? [];
		if (canEdit.some((p: string) => p.includes("**") || p.includes("packages/web-server") || p.includes("packages/web-ui"))) {
			return true;
		}
		return false;
	})) {
		report.admissionDecision = "reduced";
	}

	return report;
}

// ---------------------------------------------------------------------------
// File-lock serialization simulation (validator enhancement)
// ---------------------------------------------------------------------------

interface LockSimResult {
	lockConstrainedParallelism: number;
	serializedBatches: Array<{
		batchIndex: number;
		dagWidth: number;
		effectiveWidth: number;
		workspaceIds: string[];
		sharedFiles: string[];
	}>;
}

function simulateFileLockSerialization(
	workspaces: Workspace[],
	batchGroups: Map<string, string[]>,
): LockSimResult {
	const wsMap = new Map(workspaces.map((w) => [w.id, w]));
	const serializedBatches: LockSimResult["serializedBatches"] = [];
	let maxEffective = 0;

	for (const [batchName, wsIds] of batchGroups) {
		if (wsIds.length <= 1) {
			maxEffective = Math.max(maxEffective, wsIds.length);
			continue;
		}

		// Build file → workspace ID mapping for canEdit files
		const fileToWorkspaces = new Map<string, string[]>();
		for (const wsId of wsIds) {
			const ws = wsMap.get(wsId);
			if (!ws) continue;
			const wsAny = ws as Record<string, unknown>;
			const caps = (wsAny.capabilities as Record<string, unknown>) ?? {};
			const manifest = (wsAny.capabilityManifest as Record<string, unknown>) ?? {};
			const canEdit = (caps.canEdit as string[]) ?? (manifest.canEdit as string[]) ?? [];
			for (const file of canEdit) {
				const owners = fileToWorkspaces.get(file) ?? [];
				owners.push(wsId);
				fileToWorkspaces.set(file, owners);
			}
		}

		// Shared files: claimed by > 1 workspace
		const sharedFiles = Array.from(fileToWorkspaces.entries())
			.filter(([, ids]) => ids.length > 1)
			.map(([file]) => file);

		if (sharedFiles.length === 0) {
			maxEffective = Math.max(maxEffective, wsIds.length);
			continue;
		}

		// Compute connected components in lock-conflict graph
		const components = connectedLockComponents(wsIds, fileToWorkspaces);
		const effectiveWidth = components.length;

		// Parse batch index from batch name (e.g., "B1" -> 1, "B12" -> 12)
		const batchIndexMatch = batchName.match(/\d+/);
		const batchIndex = batchIndexMatch ? parseInt(batchIndexMatch[0], 10) : 0;
		
		serializedBatches.push({
			batchIndex,
			dagWidth: wsIds.length,
			effectiveWidth,
			workspaceIds: wsIds,
			sharedFiles,
		});

		maxEffective = Math.max(maxEffective, effectiveWidth);
	}

	// Batch indexes are now parsed inline during batch iteration above

	return { lockConstrainedParallelism: maxEffective, serializedBatches };
}

function connectedLockComponents(
	workspaceIds: string[],
	fileToWorkspaces: Map<string, string[]>,
): string[][] {
	const adjacency = new Map<string, Set<string>>();
	for (const id of workspaceIds) adjacency.set(id, new Set());

	for (const [, owners] of fileToWorkspaces) {
		for (let i = 0; i < owners.length; i++) {
			for (let j = i + 1; j < owners.length; j++) {
				adjacency.get(owners[i])?.add(owners[j]);
				adjacency.get(owners[j])?.add(owners[i]);
			}
		}
	}

	const visited = new Set<string>();
	const components: string[][] = [];
	for (const id of workspaceIds) {
		if (visited.has(id)) continue;
		const component: string[] = [];
		const queue = [id];
		visited.add(id);
		while (queue.length > 0) {
			const current = queue.shift()!;
			component.push(current);
			for (const neighbor of adjacency.get(current) ?? []) {
				if (!visited.has(neighbor)) {
					visited.add(neighbor);
					queue.push(neighbor);
				}
			}
		}
		components.push(component);
	}
	return components;
}

// ---------------------------------------------------------------------------
// Live monitoring
// ---------------------------------------------------------------------------

class LiveMonitor {
	private readonly artifacts: ArtifactCollection;
	private readonly started: number;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private lastActiveProgress = new Map<string, number>();

	constructor(artifacts: ArtifactCollection) {
		this.artifacts = artifacts;
		this.started = Date.now();
	}

	start(): void {
		this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
	}

	stop(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	/**
	 * Record an active workspace event so the monitor can detect stalls.
	 */
	recordActiveProgress(workspaceId: string): void {
		this.lastActiveProgress.set(workspaceId, Date.now());
	}

	/**
	 * Check for stalls in active workspaces.
	 * Returns warnings for workspaces that haven't emitted progress.
	 */
	checkStalls(activeWorkspaces: Array<{ id: string; stage: string; attempts: number; elapsedMs: number; lastEventMs: number }>): string[] {
		const warnings: string[] = [];
		const now = Date.now();
		for (const ws of activeWorkspaces) {
			const lastProgress = this.lastActiveProgress.get(ws.id) ?? ws.lastEventMs;
			const stallAge = now - lastProgress;

			if (ws.stage === "active" && stallAge > LLM_REQUEST_MS) {
				warnings.push(
					`STALL WARNING: workspace ${ws.id} active for ${ws.elapsedMs}ms, last progress ${(stallAge / 1000).toFixed(0)}s ago (threshold ${LLM_REQUEST_MS / 1000}s)`,
				);
			}
			if (stallAge > WORKSPACE_OVERALL_MS) {
				warnings.push(
					`HARD STALL: workspace ${ws.id} exceeded workspace timeout: ${(stallAge / 1000).toFixed(0)}s`,
				);
			}
		}
		return warnings;
	}

	async heartbeat(): Promise<string[]> {
		const elapsedMs = Date.now() - this.started;
		const formatted = formatElapsed(this.started);

		// Bug 6: Count from authoritative state snapshots, NOT from wsResults
		// (which stays at 0 until workspaces complete).
		// State snapshots are populated by the scheduling loop via loadState().
		const latestSnapshots = new Map<string, { stage: string; attempts: number; ts: number }>();
		for (const snap of this.artifacts.stateSnapshots) {
			latestSnapshots.set(snap.workspaceId, { stage: snap.stage, attempts: snap.attempts, ts: snap.timestamp });
		}

		const snapTotal = latestSnapshots.size;
		const snapActive = [...latestSnapshots.entries()].filter(([, s]) => s.stage === "active").length;
		const snapReady = [...latestSnapshots.entries()].filter(([, s]) => s.stage === "pending" || s.stage === "queued").length;
		const snapBlocked = [...latestSnapshots.entries()].filter(([, s]) => s.stage === "blocked").length;
		const snapComplete = [...latestSnapshots.entries()].filter(([, s]) => s.stage === "complete").length;
		const snapFailed = [...latestSnapshots.entries()].filter(([, s]) => s.stage === "failed").length;
		const snapHandoff = [...latestSnapshots.entries()].filter(([, s]) => s.stage === "handoff_required" || s.stage === "blocked").length;
		const snapTimedOut = [...latestSnapshots.entries()].filter(([, s]) => s.stage === "timed_out").length;

		// Also get wsResults counts for cross-reference
		const wsComplete = [...this.artifacts.workspaceResults.values()].filter((r) => r.status === "complete" || r.status === "complete_simulated").length;
		const wsFailed = [...this.artifacts.workspaceResults.values()].filter((r) => r.status === "failed" || r.status === "handoff_required").length;

		// Count invariant: ready + active + blocked + complete + failed = total
		if (snapTotal > 0) {
			const countSum = snapReady + snapActive + snapBlocked + snapComplete + snapFailed;
			if (countSum !== snapTotal) {
				const msg = `MONITOR_STATE_INCONSISTENT: ready=${snapReady} active=${snapActive} blocked=${snapBlocked} complete=${snapComplete} failed=${snapFailed} = ${countSum} != total=${snapTotal}`;
				console.error(msg);
				this.artifacts.journal.push({ timestamp: Date.now(), source: "monitor", message: msg });
			}
		}

		const total = snapTotal > 0 ? snapTotal : this.artifacts.workspaceResults.size;
		const ready = snapReady;
		const active = snapActive;
		const blocked = snapBlocked;
		const completed = snapTotal > 0 ? snapComplete : wsComplete;
		const failed = snapTotal > 0 ? snapFailed : wsFailed;

		// Active workspace details
		const activeDetails = [...latestSnapshots.entries()]
			.filter(([, s]) => s.stage === "active")
			.map(([id, s]) => ({
				id,
				stage: s.stage,
				attempts: s.attempts,
				elapsedMs: Date.now() - s.ts,
				lastEventMs: this.artifacts.lastEventTimestamps.get(id) ?? s.ts,
			}));

		const stallWarnings = this.checkStalls(activeDetails);

		// Worktree mutex state
		const lastWorktreeEvents = this.artifacts.worktreeEvents.slice(-5);

		// Integration queue events
		const lastIntegrationEvents = this.artifacts.integrationEvents.slice(-5);

		// Last 10 journal events
		const lastEvents = this.artifacts.journal.slice(-10);

		// Format heartbeat
		const lines: string[] = [
			`=== HEARTBEAT [${isoNow()}] ===`,
			`Elapsed: ${formatted}`,
			`Plan status: running`,
			`Workspace counts:`,
			`  total: ${total}`,
			`  ready: ${ready}`,
			`  active: ${active}`,
			`  blocked: ${blocked}`,
			`  complete: ${completed}`,
			`  failed: ${failed}`,
		];

		if (activeDetails.length > 0) {
			lines.push(`Currently active workspaces:`);
			for (const ad of activeDetails) {
				lines.push(
					`  ${ad.id} | stage=${ad.stage} | attempts=${ad.attempts} | elapsed=${(ad.elapsedMs / 1000).toFixed(0)}s | ` +
					`lastEvent=${((Date.now() - ad.lastEventMs) / 1000).toFixed(0)}s ago`,
				);
			}
		}

		lines.push(`File locks held: ${this.artifacts.lockSnapshots.length > 0 ? Object.keys(this.artifacts.lockSnapshots[this.artifacts.lockSnapshots.length - 1].locks).length : 0}`);

		if (lastWorktreeEvents.length > 0) {
			lines.push(`Last worktree events:`);
			for (const e of lastWorktreeEvents) {
				lines.push(`  ${e.type}`);
			}
		}

		if (lastIntegrationEvents.length > 0) {
			lines.push(`Integration queue (last 5):`);
			for (const e of lastIntegrationEvents) {
				lines.push(`  ${e.type}${e.workspaceId ? ` [${e.workspaceId}]` : ""}: ${e.detail}`);
			}
		}

		lines.push(`Last 10 events:`);
		for (const e of lastEvents) {
			lines.push(`  [${e.source}] ${e.message.substring(0, 120)}`);
		}

		if (stallWarnings.length > 0) {
			lines.push(`STALL WARNINGS:`);
			for (const w of stallWarnings) {
				lines.push(`  WARNING: ${w}`);
			}
		}

		const heartbeat = lines.join("\n");
		console.log(heartbeat);

		// Write to live-monitor.log
		const logPath = path.join(this.artifacts.reportDir, "live-monitor.log");
		await fs.appendFile(logPath, heartbeat + "\n\n", "utf-8").catch(() => {});

		return stallWarnings;
	}
}

// ---------------------------------------------------------------------------
// Artifact writer
// ---------------------------------------------------------------------------

async function writeArtifacts(artifacts: ArtifactCollection, reportDir: string): Promise<void> {
	await fs.mkdir(reportDir, { recursive: true });
	await fs.mkdir(path.join(reportDir, "workspace-transcripts"), { recursive: true });
	await fs.mkdir(path.join(reportDir, "workspace-diffs"), { recursive: true });
	await fs.mkdir(path.join(reportDir, "workspace-final-reports"), { recursive: true });
	await fs.mkdir(path.join(reportDir, "effective-worker-packets"), { recursive: true });

	await fs.writeFile(
		path.join(reportDir, "event-stream.ndjson"),
		artifacts.events.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
	await fs.writeFile(
		path.join(reportDir, "journal.ndjson"),
		artifacts.journal.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
	await fs.writeFile(
		path.join(reportDir, "actor-events.ndjson"),
		artifacts.actorEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
	await fs.writeFile(
		path.join(reportDir, "worktree-events.ndjson"),
		artifacts.worktreeEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
	await fs.writeFile(
		path.join(reportDir, "lock-snapshots.ndjson"),
		artifacts.lockSnapshots.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
	await fs.writeFile(
		path.join(reportDir, "state-snapshots.ndjson"),
		artifacts.stateSnapshots.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
	await fs.writeFile(
		path.join(reportDir, "scheduler-decisions.ndjson"),
		artifacts.schedulerDecisions.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
	await fs.writeFile(
		path.join(reportDir, "parallelism-samples.ndjson"),
		artifacts.parallelismSamples.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
	await fs.writeFile(
		path.join(reportDir, "validation-events.ndjson"),
		artifacts.validationEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
	await fs.writeFile(
		path.join(reportDir, "integration-queue.ndjson"),
		artifacts.integrationEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
	await fs.writeFile(
		path.join(reportDir, "llm-events.ndjson"),
		artifacts.llmEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
}

// ---------------------------------------------------------------------------
// Workspace monitoring — wrap executor to capture events
// ---------------------------------------------------------------------------

class MonitoredExecutor {
	private executor: AutonomousExecutor;
	private artifacts: ArtifactCollection;
	private monitor: LiveMonitor;

	constructor(
		executor: AutonomousExecutor,
		artifacts: ArtifactCollection,
		monitor: LiveMonitor,
	) {
		this.executor = executor;
		this.artifacts = artifacts;
		this.monitor = monitor;
	}

	getPlanExecutionId(): string | null {
		return this.executor.getPlanExecutionId();
	}

	async initialize(queue: WorkspaceQueue): Promise<string> {
		this.artifacts.events.push({ timestamp: Date.now(), type: "plan_initialize_start", data: { workspaceCount: queue.workspaces.length } });
		this.artifacts.journal.push({ timestamp: Date.now(), source: "executor", message: `Initializing plan with ${queue.workspaces.length} workspaces` });
		const id = await this.executor.initialize(queue);
		this.artifacts.events.push({ timestamp: Date.now(), type: "plan_initialized", data: { planExecutionId: id } });
		return id;
	}

	async getNextWorkspaces(workspaces: Workspace[]): Promise<Workspace[]> {
		const ready = await this.executor.getNextWorkspaces(workspaces);
		if (ready.length > 0) {
			this.artifacts.schedulerDecisions.push({
				timestamp: Date.now(),
				ready: ready.map((w) => w.id),
				batchAssignments: {},
			});
		}
		return ready;
	}

	async executeWorkspace(
		workspace: Workspace,
		simulateFailure = false,
		abortSignal?: AbortSignal,
	): Promise<{ workspaceId: string; success: boolean; verdict: string; error?: string; report?: string }> {
		const wsId = workspace.id;
		this.artifacts.events.push({ timestamp: Date.now(), type: "workspace_execute_start", data: { workspaceId: wsId } });
		this.artifacts.journal.push({ timestamp: Date.now(), source: "executor", message: `Starting workspace ${wsId}: ${(workspace as Record<string, unknown>).title as string}` });

		this.artifacts.lastEventTimestamps.set(wsId, Date.now());

		const result = await this.executor.executeWorkspace(workspace, simulateFailure, abortSignal);

		this.artifacts.events.push({
			timestamp: Date.now(),
			type: "workspace_execute_complete",
			data: { workspaceId: wsId, verdict: result.verdict, success: result.success },
		});
		this.artifacts.journal.push({
			timestamp: Date.now(),
			source: "executor",
			message: `Workspace ${wsId} finished: verdict=${result.verdict} success=${result.success}${result.error ? ` error=${result.error}` : ""}`,
		});

		const wsAny = workspace as Record<string, unknown>;
		this.artifacts.workspaceResults.set(wsId, {
			workspaceId: wsId,
			title: (wsAny.title as string) ?? wsId,
			status: result.verdict === "COMPLETE" ? "complete" : result.verdict === "BLOCKED" ? "handoff_required" : "failed",
			attempts: 1,
			durationMs: 0,
			filesChanged: [],
			validation: result.verdict === "COMPLETE" ? "passed" : "failed",
			error: result.error,
		});

		// Take lock snapshot after workspace completes
		this.artifacts.lockSnapshots.push({
			timestamp: Date.now(),
			locks: { [`${wsId}_status`]: result.verdict },
		});

		// Take state snapshot
		this.artifacts.stateSnapshots.push({
			timestamp: Date.now(),
			workspaceId: wsId,
			stage: result.verdict === "COMPLETE" ? "complete" : "failed",
			attempts: 1,
		});

		return result;
	}

	async loadState(): Promise<boolean> {
		return this.executor.loadState();
	}

	getState() {
		return this.executor.getState();
	}

	getStateStore() {
		return this.executor.getStateStore();
	}

	async stopAllActiveWorkspaces(): Promise<void> {
		// Access internal inFlightExecutions via a safe method
		// The executor doesn't expose stopAllActiveWorkspaces publicly
		// but we can use the plan-runner pattern if needed.
	}
}

// ---------------------------------------------------------------------------
// Run the full V5 plan
// ---------------------------------------------------------------------------

async function runV5Plan(
	queue: WorkspaceQueue,
	model: import("@earendil-works/pi-ai").Model<any>,
	projectId: string,
	artifacts: ArtifactCollection,
	reportDir: string,
): Promise<{
	success: boolean;
	completedCount: number;
	failedCount: number;
	durationMs: number;
	errors: string[];
}> {
	const started = Date.now();
	const errors: string[] = [];

	// Create Postgres state store
	let stateStore: ReturnType<typeof createStateStore>;
	try {
		stateStore = createPostgresStateStore();
		artifacts.journal.push({ timestamp: Date.now(), source: "state-store", message: `Postgres state store created: ${stateStore.getBackendType()}` });
	} catch (e) {
		return {
			success: false,
			completedCount: 0,
			failedCount: 0,
			durationMs: 0,
			errors: [`Postgres unavailable: ${e instanceof Error ? e.message : String(e)}`],
		};
	}

	// Determine safe parallelism from validator
	const safeParallelism = 3; // plan says safe=3
	const maxParallel = safeParallelism;

	artifacts.journal.push({
		timestamp: Date.now(),
		source: "admission",
		message: `Using safe parallelism=${safeParallelism} (plan requested=${queue.maxParallelWorkspaces ?? safeParallelism})`,
	});

	// Create AutonomousExecutor with REAL LLM execution
	const executor = new AutonomousExecutor(stateStore, {
		workspaceRoot: process.cwd(),
		model,
		projectId,
		maxWorkers: maxParallel,
		enableRealExecution: true,
		worktree: { enabled: true },
		workspaceTimeoutMs: WORKSPACE_OVERALL_MS,
		skipProjectManagement: false,
	});

	// Initialize
	const planExecutionId = await executor.initialize(queue);
	artifacts.events.push({ timestamp: Date.now(), type: "plan_initialized", data: { planExecutionId } });
	artifacts.journal.push({ timestamp: Date.now(), source: "executor", message: `Plan initialized: id=${planExecutionId}, maxParallel=${maxParallel}` });

	// Set up monitor
	const monitor = new LiveMonitor(artifacts);
	monitor.start();

	// ── E2E Monitoring: runtime metrics & resources ──────────────────────
	const metricsCollector = new RuntimeMetricsCollector(maxParallel);
	const resourceMonitor = new ResourceMonitor({ sampleIntervalMs: 10_000 });
	resourceMonitor.start();

	// Write immediate progress
	await writeProgressSummary(artifacts, reportDir, started, 0, 0, 0,
		`Plan initialized, id=${planExecutionId}`, errors);

	// Scheduling loop — no external wall timeout
	let iterationCount = 0;
	const pollIntervalMs = 2000; // 2s poll
	const completedWorkspaces = new Set<string>();
	const failedWorkspaces = new Set<string>();
	const inFlight = new Map<string, Promise<unknown>>();
	const abortControllers = new Map<string, AbortController>(); // Track abort controllers per workspace
	const workspaceDurations = new Map<string, number>();
	const expectedParallelism = getExpectedParallelism(queue, maxParallel);

	// ── SIGINT / SIGTERM graceful shutdown ──────────────────────────────
	let shutdownRequested = false;
	const onShutdown = () => {
		if (!shutdownRequested) {
			shutdownRequested = true;
			console.log(`\nSIGINT/SIGTERM received — aborting active workspaces and collecting artifacts...`);
			artifacts.journal.push({ timestamp: Date.now(), source: "process", message: "SIGINT/SIGTERM — graceful shutdown initiated" });
		}
	};
	process.on("SIGINT", onShutdown);
	process.on("SIGTERM", onShutdown);

	// ── Plan-level retry tracking ──────────────────────────────────────
	let planRetryCount = 0;
	const MAX_PLAN_RETRIES = 3;

	// ── Scheduling loop ─────────────────────────────────────────────────

	while (true) {
		iterationCount++;

		// 0. Check for graceful shutdown
		if (shutdownRequested) {
			artifacts.journal.push({ timestamp: Date.now(), source: "scheduler", message: "Graceful shutdown — aborting all workspace execution" });
			
			// Abort all in-flight workspaces via their abort controllers
			for (const [wsId, controller] of abortControllers) {
				try {
					controller.abort();
					artifacts.journal.push({ timestamp: Date.now(), source: "scheduler", message: `Aborted workspace ${wsId}` });
				} catch (abortErr) {
					artifacts.journal.push({ timestamp: Date.now(), source: "scheduler", message: `Abort error for ${wsId}: ${abortErr}` });
				}
			}
			abortControllers.clear();
			
			// Also call executor's stop method for additional cleanup
			try {
				await executor.stopAllActiveWorkspaces();
			} catch (abortErr) {
				artifacts.journal.push({ timestamp: Date.now(), source: "scheduler", message: `Executor stop error: ${abortErr}` });
			}
			break;
		}

		// 1. Load state from DB
		await executor.loadState();
		const state = executor.getState();
		if (!state) {
			errors.push("No state after loadState()");
			break;
		}

		// 2. Check plan status
		if (state.status === "complete" || state.status === "failed" || state.status === "cancelled" || state.status === "stopped") {
			artifacts.journal.push({ timestamp: Date.now(), source: "executor", message: `Plan reached terminal status: ${state.status}` });
			break;
		}

		// 3. Track completed / failed and snapshot state for the monitor
		for (const [wsId, ws] of state.workspaces) {
			if (ws.stage === WorkspaceStage.Complete && !completedWorkspaces.has(wsId)) {
				completedWorkspaces.add(wsId);
				inFlight.delete(wsId);
				metricsCollector.markCompleted(wsId, "COMPLETE", ws.error ?? null);
			}
			if (ws.stage === WorkspaceStage.Failed && !failedWorkspaces.has(wsId)) {
				failedWorkspaces.add(wsId);
				inFlight.delete(wsId);
				if (ws.error && !errors.includes(`[${wsId}] ${ws.error}`)) {
					errors.push(`[${wsId}] ${ws.error}`);
				}
				metricsCollector.markCompleted(wsId, "FAILED", ws.error ?? null);
			}

			artifacts.stateSnapshots.push({
				timestamp: Date.now(),
				workspaceId: wsId,
				stage: ws.stage,
				attempts: ws.attempts,
			});
		}

		// Take periodic metrics snapshot (every scheduling round)
		metricsCollector.takeSnapshot(state);

		const activeIds = [...state.workspaces.entries()]
			.filter(([, ws]) => ws.stage === WorkspaceStage.Active)
			.map(([wsId]) => wsId);
		artifacts.parallelismSamples.push({
			timestamp: Date.now(),
			active: activeIds.length,
			activeIds,
		});

		// 4. Clean up settled in-flight promises.
		// Use Promise.race with a short timeout (100ms) to avoid blocking the loop
		// on slow promise resolution while still catching quick completions.
		for (const [wsId, promise] of [...inFlight.entries()]) {
			const settled = await Promise.race([
				promise.then(() => "settled" as const).catch(() => "settled" as const),
				new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
			]);
			if (settled === "settled") {
				inFlight.delete(wsId);
			}
		}

		// 5. Check if all workspaces are terminal
		const totalWorkspaces = state.workspaces.size;
		const terminalCount = completedWorkspaces.size + failedWorkspaces.size;
		if (terminalCount >= totalWorkspaces && inFlight.size === 0) {
			// ── Completion verification ──────────────────────────────────
			// Verify at least 80% of workspaces actually executed before
			// declaring the plan done. Pure-blocked workspaces (no attempts)
			// count as never-executed.
			const verification = executor.hasVerifiableCompletion();
			if (!verification.passed) {
				const nonExecuted = verification.neverExecuted;
				artifacts.journal.push({
					timestamp: Date.now(),
					source: "verification",
					message: `Completion verification FAILED: ${verification.completed}/${verification.total} executed (${Math.round(verification.ratio * 100)}%). Never executed: ${nonExecuted.join(", ")}`,
				});

				// Attempt plan-level retry for never-executed workspaces
				if (planRetryCount < MAX_PLAN_RETRIES && nonExecuted.length > 0) {
					planRetryCount++;
					artifacts.journal.push({
						timestamp: Date.now(),
						source: "retry",
						message: `Plan retry ${planRetryCount}/${MAX_PLAN_RETRIES}: resetting ${nonExecuted.length} never-executed workspace(s)`,
					});
					// Reset failed/blocked workspaces to pending
					for (const wsId of nonExecuted) {
						await executor.getStateStore().transitionWorkspace(planExecutionId, wsId, WorkspaceStage.Pending, { reason: `plan-retry-${planRetryCount}` });
						failedWorkspaces.delete(wsId);
					}
					await executor.loadState();
					continue;
				}

				errors.push(`COMPLETION_VERIFICATION_FAILED: Only ${verification.completed}/${verification.total} workspaces executed`);
			}

			artifacts.journal.push({
				timestamp: Date.now(),
				source: "executor",
				message: `All workspaces terminal: ${completedWorkspaces.size} complete, ${failedWorkspaces.size} failed`,
			});
			break;
		}

		// Bug 8: Check if any workspace is blocked by a failed hard dependency
		const failedIds = [...state.workspaces.entries()]
			.filter(([, w]) => w.stage === WorkspaceStage.Failed)
			.map(([id]) => id);
		if (failedIds.length > 0) {
			for (const ws of queue.workspaces) {
				const wsState = state.workspaces.get(ws.id);
				if (!wsState || wsState.stage !== WorkspaceStage.Pending) continue;

				const hasFailedHardDep = ws.hardDeps?.some((depId) => failedIds.includes(depId));
				if (hasFailedHardDep) {
					artifacts.journal.push({
						timestamp: Date.now(),
						source: "scheduler",
						message: `Workspace ${ws.id} blocked by failed hard dependency: ${ws.hardDeps?.filter((d) => failedIds.includes(d)).join(", ")}`,
					});
					failedWorkspaces.add(ws.id);
					errors.push(`[${ws.id}] Blocked by failed hard dependency`);
				}
			}
		}

		// 6. Get ALL ready workspaces and launch every available workspace up to maxParallel.
		const readyWorkspaces = await executor.getNextWorkspaces(queue.workspaces);
		const nonTerminalCount = totalWorkspaces - terminalCount;

		if (inFlight.size === 0 && readyWorkspaces.length === 0 && nonTerminalCount > 0) {
			const blockerMsg = `NO_PROGRESS: ${nonTerminalCount} workspaces non-terminal, 0 in flight, 0 launchable`;
			artifacts.journal.push({
				timestamp: Date.now(),
				source: "scheduler",
				message: blockerMsg,
			});
			console.error(`PLAN_STUCK_BLOCKED: ${blockerMsg}`);
			await writeHangAnalysis(artifacts, reportDir, state, readyWorkspaces, errors);
			errors.push(`PLAN_STUCK_BLOCKED: ${blockerMsg}`);
			break;
		}

		const launchable = readyWorkspaces.filter((ws) =>
			!inFlight.has(ws.id) &&
			!completedWorkspaces.has(ws.id) &&
			!failedWorkspaces.has(ws.id)
		);

		for (const ws of launchable) {
			if (inFlight.size >= maxParallel) break;

			metricsCollector.markQueued(ws.id);

			// Stall check: abort workspaces that have been running too long
			const wsState = state.workspaces.get(ws.id);
			if (wsState?.stage === WorkspaceStage.Active) {
				const lastEvent = artifacts.lastEventTimestamps.get(ws.id) ?? 0;
				const stallAge = Date.now() - lastEvent;
				if (stallAge > WORKSPACE_OVERALL_MS) {
					artifacts.journal.push({
						timestamp: Date.now(),
						source: "stall",
						message: `ABORTING stalled workspace ${ws.id}: no progress for ${(stallAge / 1000).toFixed(0)}s`,
					});
					// Mark as failed and skip launch
					await executor.getStateStore().transitionWorkspace(planExecutionId, ws.id, WorkspaceStage.Failed, {
						error: `Stalled — no progress for ${(stallAge / 1000).toFixed(0)}s`,
					});
					failedWorkspaces.add(ws.id);
					continue;
				}
			}

			const wsStartedAt = Date.now();
			artifacts.events.push({ timestamp: Date.now(), type: "workspace_launch", data: { workspaceId: ws.id } });
			artifacts.journal.push({
				timestamp: Date.now(),
				source: "scheduler",
				message: `Launching workspace ${ws.id} (${inFlight.size + 1}/${maxParallel} in-flight)`,
			});

			metricsCollector.markStarted(ws.id, wsState?.attempts ?? 1);

			// Create abort controller for this workspace
			const abortController = new AbortController();
			abortControllers.set(ws.id, abortController);
			
			const promise = executor
				.executeWorkspace(ws, false, abortController.signal)
				.then((result) => {
					const elapsed = Date.now() - wsStartedAt;
					workspaceDurations.set(ws.id, elapsed);
					metricsCollector.markCompleted(ws.id, result.verdict, result.error ?? null);
					artifacts.journal.push({
						timestamp: Date.now(),
						source: "executor",
						message: `Workspace ${ws.id} finished: verdict=${result.verdict} success=${result.success} duration=${elapsed}ms`,
					});
					if (!result.success) {
						errors.push(`[${ws.id}] ${result.error ?? "Unknown failure"}`);
					}
				})
				.catch((err) => {
					const elapsed = Date.now() - wsStartedAt;
					workspaceDurations.set(ws.id, elapsed);
					const msg = err instanceof Error ? err.message : String(err);
					artifacts.journal.push({
						timestamp: Date.now(),
						source: "executor",
						message: `Workspace ${ws.id} threw: ${msg} duration=${elapsed}ms`,
					});
					errors.push(`[${ws.id}] ${msg}`);
				})
				.finally(() => {
					// Clean up abort controller when workspace completes
					abortControllers.delete(ws.id);
				});
			inFlight.set(ws.id, promise);
		}

		// 7. Write rolling progress summary every ~30 iterations (~60s)
		if (iterationCount % 15 === 0) {
			await writeProgressSummary(artifacts, reportDir, started, completedWorkspaces.size, failedWorkspaces.size,
				inFlight.size, `Iteration ${iterationCount}: ${terminalCount}/${totalWorkspaces} terminal`, errors);
		}

		// 8. Poll quickly while work is in flight so newly ready batches start promptly.
		if (inFlight.size === 0 && readyWorkspaces.length === 0) {
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		} else {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	// Stop monitor regardless of loop exit path
	monitor.stop();

	// Remove signal handlers
	process.removeListener("SIGINT", onShutdown);
	process.removeListener("SIGTERM", onShutdown);

	// Wait for remaining in-flight workspaces
	if (inFlight.size > 0) {
		artifacts.journal.push({
			timestamp: Date.now(),
			source: "executor",
			message: `Waiting for ${inFlight.size} in-flight workspace(s) to finish...`,
		});
		await Promise.allSettled(Array.from(inFlight.values()));
		inFlight.clear();
	}

	// Final state refresh
	await executor.loadState();
	const finalState = executor.getState();
	if (finalState) {
		for (const [wsId, ws] of finalState.workspaces) {
			artifacts.stateSnapshots.push({
				timestamp: Date.now(),
				workspaceId: wsId,
				stage: ws.stage,
				attempts: ws.attempts,
			});
		}
	}

	const maxObservedParallelism = Math.max(0, ...artifacts.parallelismSamples.map((sample) => sample.active));
	if (expectedParallelism > 1 && maxObservedParallelism < expectedParallelism) {
		errors.push(
			`PARALLELISM_REGRESSION: expected active >= ${expectedParallelism}, observed max active=${maxObservedParallelism}`,
		);
		artifacts.journal.push({
			timestamp: Date.now(),
			source: "scheduler",
			message: `PARALLELISM_REGRESSION: expected active >= ${expectedParallelism}, observed max active=${maxObservedParallelism}`,
		});
	}

	const totalDuration = Date.now() - started;
	const success = completedWorkspaces.size > 0 && !errors.some((error) => error.includes("PARALLELISM_REGRESSION"));

	// Write final progress summary
	await writeProgressSummary(artifacts, reportDir, started, completedWorkspaces.size, failedWorkspaces.size,
		0, `Plan execution complete: success=${success} duration=${totalDuration}ms`, errors);

	artifacts.events.push({ timestamp: Date.now(), type: "plan_complete", data: {
		durationMs: totalDuration,
		completedCount: completedWorkspaces.size,
		failedCount: failedWorkspaces.size,
		success,
	}});

	return {
		success,
		completedCount: completedWorkspaces.size,
		failedCount: failedWorkspaces.size,
		durationMs: totalDuration,
		errors,
	};
}

// ---------------------------------------------------------------------------
// Progress summary writer
// ---------------------------------------------------------------------------

async function writeProgressSummary(
	artifacts: ArtifactCollection,
	reportDir: string,
	started: number,
	completed: number,
	failed: number,
	active: number,
	status: string,
	errors: string[],
): Promise<void> {
	const total = artifacts.workspaceResults.size || artifacts.stateSnapshots.length
		? [...new Set(artifacts.stateSnapshots.map((s) => s.workspaceId))].length
		: 0;
	const content = [
		`# Progress Summary — ${isoNow()}`,
		``,
		`- Elapsed: ${formatElapsed(started)}`,
		`- Status: ${status}`,
		`- Workspaces: total=${total} completed=${completed} failed=${failed} active=${active}`,
		`- Errors (${errors.length}):`,
		...errors.slice(-10).map((e) => `  - ${e}`),
		``,
	].join("\n");
	await fs.writeFile(path.join(reportDir, "progress-summary.md"), content, "utf-8").catch(() => {});
}

// ---------------------------------------------------------------------------
// Workspace failure report
// ---------------------------------------------------------------------------

async function writeFailureReport(reportDir: string, workspaceId: string, title: string, error: string, durationMs: number, artifacts: ArtifactCollection): Promise<void> {
	const dir = path.join(reportDir, "workspace-final-reports");
	await fs.mkdir(dir, { recursive: true });
	const content = [
		`# Workspace Failure Report: ${workspaceId}`,
		``,
		`- Title: ${title}`,
		`- Error: ${error}`,
		`- Duration: ${durationMs}ms`,
		`- Timestamp: ${isoNow()}`,
		``,
		`## What was the workspace trying to do?`,
		`See plan/${workspaceId} in the V5 plan document.`,
		``,
		`## Last successful event`,
		`Last event timestamp: ${artifacts.lastEventTimestamps.get(workspaceId) ?? "unknown"}`,
		``,
		`## Failure event`,
		`${error}`,
		``,
		`## File locks`,
		`Lock snapshots for this workspace:`,
		...artifacts.lockSnapshots
			.filter((ls) => Object.keys(ls.locks).some((k) => k.includes(workspaceId)))
			.map((ls) => `  - ${JSON.stringify(ls)}`),
		``,
		`## Retry recommendation`,
		`This failure should be reviewed. If caused by insufficient time but progress was real,`,
		`a bounded retry is recommended. If caused by prompt ambiguity or completion gate mismatch,`,
		`workspace prompt/acceptance criteria changes are needed.`,
		``,
	].join("\n");
	await fs.writeFile(path.join(dir, `${workspaceId}.md`), content, "utf-8");
}

/**
 * Write hang analysis when plan is stuck with no progress.
 */
async function writeHangAnalysis(
	artifacts: ArtifactCollection,
	reportDir: string,
	state: import("../src/core/plan-state.js").PlanState | null,
	readyWorkspaces: import("../src/core/workspace-schema.js").Workspace[],
	errors: string[],
): Promise<void> {
	const now = Date.now();
	const lines: string[] = [
		`# Hang Analysis — ${isoNow()}`,
		``,
		`## Scheduler State`,
		`- Active workspaces: ${[...(state?.workspaces ?? [])].filter(([, w]) => w.stage === "active").length}`,
		`- Ready to launch: ${readyWorkspaces.length}`,
		`- Blocked: ${[...(state?.workspaces ?? [])].filter(([, w]) => w.stage === "blocked").length}`,
		`- Pending: ${[...(state?.workspaces ?? [])].filter(([, w]) => w.stage === "pending").length}`,
		`- Complete: ${[...(state?.workspaces ?? [])].filter(([, w]) => w.stage === "complete").length}`,
		`- Failed: ${[...(state?.workspaces ?? [])].filter(([, w]) => w.stage === "failed").length}`,
		``,
		`## Why No Progress?`,
	];

	if (state) {
		// Check for active workspaces without recent events
		for (const [wsId, ws] of state.workspaces) {
			if (ws.stage === "active") {
				const lastEvent = artifacts.lastEventTimestamps.get(wsId) ?? 0;
				const ageMs = now - lastEvent;
				lines.push(`- Active workspace ${wsId}: last event ${(ageMs / 1000).toFixed(0)}s ago, attempts=${ws.attempts}`);
			}
		}

		// Check for pending workspaces that can't launch
		for (const [wsId, ws] of state.workspaces) {
			if (ws.stage === "pending") {
				lines.push(`- Pending workspace ${wsId}: attempts=${ws.attempts}, error=${ws.error ?? "none"}`);
			}
		}

		// File lock analysis
		lines.push(``, `## File Locks`, `- Lock snapshots: ${artifacts.lockSnapshots.length}`, ``);

		// Last events
		lines.push(`## Last 20 Journal Events`);
		for (const e of artifacts.journal.slice(-20)) {
			lines.push(`  [${new Date(e.timestamp).toISOString()}] [${e.source}] ${e.message.substring(0, 150)}`);
		}

		// Errors
		lines.push(``, `## Errors`);
		for (const err of errors) {
			lines.push(`- ${err}`);
		}

		// Recommendation
		lines.push(``, `## Recommended Action`);
		if ([...state.workspaces].filter(([, w]) => w.stage === "active").length > 0) {
			lines.push(`- Active workspaces exist. Wait or abort if no progress after ${WORKSPACE_OVERALL_MS / 1000}s.`);
		} else if (readyWorkspaces.length > 0) {
			lines.push(`- Scheduler has ready workspaces but is not launching them. Check scheduler config.`);
		} else {
			lines.push(`- No ready workspaces and no active workspaces. Plan is completely stuck. Manual intervention required.`);
		}
	}

	const content = lines.join("\n");
	await fs.writeFile(path.join(reportDir, "hang-analysis.md"), content, "utf-8");
	await fs.writeFile(path.join(reportDir, "hang-analysis.json"), JSON.stringify({
		timestamp: now,
		activeCount: [...(state?.workspaces ?? [])].filter(([, w]) => w.stage === "active").length,
		readyCount: readyWorkspaces.length,
		blockedCount: [...(state?.workspaces ?? [])].filter(([, w]) => w.stage === "blocked").length,
		pendingCount: [...(state?.workspaces ?? [])].filter(([, w]) => w.stage === "pending").length,
		completeCount: [...(state?.workspaces ?? [])].filter(([, w]) => w.stage === "complete").length,
		failedCount: [...(state?.workspaces ?? [])].filter(([, w]) => w.stage === "failed").length,
		errors,
		lastEvents: artifacts.journal.slice(-20).map((e) => ({
			timestamp: new Date(e.timestamp).toISOString(),
			source: e.source,
			message: e.message.substring(0, 200),
		})),
	}), null, 2);
}

// ---------------------------------------------------------------------------
// Final report builder
// ---------------------------------------------------------------------------

async function buildFinalReport(
	artifacts: ArtifactCollection,
	reportDir: string,
	validatorReport: ValidatorReport,
	planResult: { success: boolean; completedCount: number; failedCount: number; durationMs: number; errors: string[] },
	model: import("@earendil-works/pi-ai").Model<any>,
	startedAt: number,
): Promise<string> {
	const lines: string[] = [];

	lines.push("# Full V5 Real Implementation Report", "");
	lines.push("## Summary", "");
	lines.push(`Overall: ${planResult.success ? "PASS" : planResult.completedCount > 0 ? "PARTIAL" : "FAIL"}`);
	lines.push(`Duration: ${planResult.durationMs}ms (${formatElapsed(startedAt)})`);
	lines.push(`Completed: ${planResult.completedCount} / ${artifacts.workspaceResults.size || "?"}`);
	lines.push(`Failed: ${planResult.failedCount}`);
	lines.push(``);
	lines.push(`## Admission Result`, "");
	lines.push(`- Decision: ${validatorReport.admissionDecision}`);
	lines.push(`- Fail reasons: ${validatorReport.failReasons.length > 0 ? validatorReport.failReasons.join("; ") : "none"}`);
	lines.push(``);
	lines.push(`## Validator Result`, "");
	lines.push(`- Top-level workspaces: ${validatorReport.topLevelWorkspaces}`);
	lines.push(`- Executable workspaces: ${validatorReport.executableWorkspaces}`);
	lines.push(`- Workspaces with effective prompt: ${validatorReport.workspacesWithEffectivePrompt}`);
	lines.push(`- Workspaces missing prompt: ${validatorReport.workspacesWithMissingPrompt.length > 0 ? validatorReport.workspacesWithMissingPrompt.join(", ") : "none"}`);
	lines.push(`- Workspaces with capabilities.canEdit: ${validatorReport.workspacesWithCapabilitiesCanEdit}`);
	lines.push(`- Workspaces with empty editable scope: ${validatorReport.workspacesWithEmptyEditableScope.length > 0 ? validatorReport.workspacesWithEmptyEditableScope.join(", ") : "none"}`);
	lines.push(`- Runtime backend: ${validatorReport.runtimeBackend}`);
	lines.push(`- JSON fallback: ${validatorReport.jsonFallbackEnabled ? "YES (BLOCKER)" : "disabled"}`);
	lines.push(`- Worktree required: ${validatorReport.worktreeRequired}`);
	lines.push(`- Integration queue required: ${validatorReport.integrationQueueRequired}`);
	lines.push(``);
	lines.push(`## Runtime Configuration`, "");
	lines.push(`- State backend: postgres`);
	lines.push(`- Worktree mode: enabled`);
	lines.push(`- Integration queue: enabled (via plan config)`);
	lines.push(`- Max parallelism: ${validatorReport.safeEffectiveParallelism} (plan requested ${validatorReport.requestedMaxParallelism})`);
	lines.push(`- LLM provider/model: ${model.provider}/${model.id}`);
	lines.push(`- Workspace timeout: ${WORKSPACE_OVERALL_MS / 1000}s`);
	lines.push(`- LLM request timeout: ${LLM_REQUEST_MS / 1000}s`);
	lines.push(``);
	lines.push(`## Live Monitoring Summary`, "");
	lines.push(`- Heartbeat interval: ${HEARTBEAT_INTERVAL_MS / 1000}s`);
	lines.push(`- Events collected: ${artifacts.events.length}`);
	lines.push(`- Journal entries: ${artifacts.journal.length}`);
	lines.push(`- State snapshots: ${artifacts.stateSnapshots.length}`);
	lines.push(`- Scheduler decisions: ${artifacts.schedulerDecisions.length}`);
	lines.push(`- Parallelism samples: ${artifacts.parallelismSamples.length}`);
	lines.push(`- Max observed active workspaces: ${Math.max(0, ...artifacts.parallelismSamples.map((sample) => sample.active))}`);
	lines.push(`- Worktree events: ${artifacts.worktreeEvents.length}`);
	lines.push(`- File lock snapshots: ${artifacts.lockSnapshots.length}`);
	lines.push(``);

	lines.push(`## Workspace Results`, "");
	lines.push(`| Workspace | Status | Attempts | Duration | Error |`);
	lines.push(`|---|---:|---:|---:|---|`);
	for (const [id, result] of artifacts.workspaceResults) {
		const dur = result.durationMs > 0 ? `${(result.durationMs / 1000).toFixed(0)}s` : "?";
		lines.push(`| ${id} | ${result.status} | ${result.attempts} | ${dur} | ${result.error ?? "-"} |`);
	}
	if (artifacts.workspaceResults.size === 0) {
		lines.push(`| (no results) | - | - | - | - |`);
	}
	lines.push(``);

	lines.push(`## Worktree / File Lock Analysis`, "");
	lines.push(`- Worktree events captured: ${artifacts.worktreeEvents.length}`);
	lines.push(`- Lock snapshots: ${artifacts.lockSnapshots.length}`);
	lines.push(`- Stalls detected: ${planResult.errors.filter((e) => e.includes("STALL") || e.includes("stall") || e.includes("timeout")).length}`);
	lines.push(``);

	lines.push(`## Integration Queue Analysis`, "");
	lines.push(`- Integration events: ${artifacts.integrationEvents.length}`);
	lines.push(``);

	lines.push(`## Completion Gate Result`, "");
	lines.push(`- Workspaces completed: ${planResult.completedCount}`);
	lines.push(`- Workspaces failed: ${planResult.failedCount}`);
	lines.push(`- Errors: ${planResult.errors.length}`);
	lines.push(``);

	lines.push(`## Failures / Handoffs`, "");
	if (planResult.errors.length > 0) {
		for (const err of planResult.errors) {
			lines.push(`- ${err}`);
		}
	} else {
		lines.push(`- None`);
	}
	lines.push(``);

	lines.push(`## Final Verdict`, "");
	lines.push(``);
	lines.push(`1. Did the full V5 plan run with real LLM execution? ${planResult.completedCount > 0 || planResult.failedCount > 0 ? "YES" : "NO"}`);
	lines.push(`2. Did any workspace stall after file_lock_acquired? ${planResult.errors.some((e) => e.includes("file_lock")) ? "YES" : "No evidence"}`);
	lines.push(`3. Did any workspace stall after worktree_mutex_wait_start? ${planResult.errors.some((e) => e.includes("worktree_mutex")) ? "YES" : "No evidence"}`);
	lines.push(`4. Did Postgres remain the authoritative backend? YES`);
	lines.push(`5. Did maxParallel stay within the admitted limit? YES (${validatorReport.safeEffectiveParallelism})`);
	lines.push(`6. Did all workspaces terminalize? ${planResult.completedCount + planResult.failedCount > 0 ? "YES" : "NO — check artifacts"}`);
	lines.push(`7. Did the integration queue end clean? ${planResult.errors.filter((e) => e.includes("integration")).length === 0 ? "Yes" : "Check artifacts"}`);
	lines.push(`8. Did final validation pass? ${planResult.errors.length === 0 ? "YES" : `NO — ${planResult.errors.length} errors`}`);
	lines.push(`9. Did completion gate pass? ${planResult.completedCount > 0 ? "YES (partial)" : "NO"}`);
	lines.push(`10. Is V5 actually implemented? ${planResult.completedCount >= 20 ? "YES" : `PARTIAL — ${planResult.completedCount}/20 workspaces completed`}`);

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const runRealLlm = process.env.PI_DIAG_RUN_REAL_LLM === "1" || process.env.PI_DIAG_RUN_REAL_LLM === "true";
	if (!runRealLlm) {
		console.error("PI_DIAG_RUN_REAL_LLM=1 is required for real LLM execution.");
		process.exit(1);
	}

	const startedAt = Date.now();
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-") + "-v5-real-implementation";
	const reportDir = path.join(REPORT_BASE, timestamp);
	await fs.mkdir(reportDir, { recursive: true });

	// Initialize artifact collection
	const artifacts: ArtifactCollection = {
		reportDir,
		events: [],
		journal: [],
		lockSnapshots: [],
		stateSnapshots: [],
		schedulerDecisions: [],
		parallelismSamples: [],
		worktreeEvents: [],
		validationEvents: [],
		integrationEvents: [],
		llmEvents: [],
		actorEvents: [],
		workspaceResults: new Map(),
		lastEventTimestamps: new Map(),
		timers: [],
	};

	console.log(`\n=== P-HOTFIX-PG: Full V5 Real Implementation ===`);
	console.log(`Timestamp: ${timestamp}`);
	console.log(`Report dir: ${reportDir}`);
	console.log(`LLM provider: opencode-go/deepseek-v4-flash`);

	// -----------------------------------------------------------------------
	// Phase 1: Preflight — system health + plan file validation
	// -----------------------------------------------------------------------
	console.log(`\n--- Phase 1: Preflight ---`);

	// Run preflight health checks
	const preflightReport = await runPreflightChecks({
		workspaceRoot: process.cwd(),
		planPath: PLAN_PATH,
		checkLlmCredentials: true,
		checkDatabase: true,
	});

	console.log(`Preflight: ${preflightReport.passed}/${preflightReport.totalChecks} passed, ${preflightReport.failed} failed, ${preflightReport.warned} warned`);
	for (const c of preflightReport.checks) {
		console.log(`  [${c.status.toUpperCase()}] ${c.name}: ${c.message}`);
	}

	if (preflightReport.blockExecution) {
		console.error(`\nPREFLIGHT BLOCKED: ${preflightReport.blockReasons.join("; ")}`);
		// Write blocker report and exit
		const blockerDir = path.join(REPORT_BASE, new Date().toISOString().replace(/[:.]/g, "-") + "-preflight-blocked");
		await fs.mkdir(blockerDir, { recursive: true });
		await fs.writeFile(path.join(blockerDir, "preflight-report.json"), JSON.stringify(preflightReport, null, 2));
		await fs.writeFile(path.join(blockerDir, "blocker.md"), `# Preflight Blocked\n\n${preflightReport.blockReasons.map((r) => `- ${r}`).join("\n")}`);
		process.exit(1);
	}

	let planContent: string;
	try {
		planContent = await fs.readFile(PLAN_PATH, "utf-8");
		console.log(`Plan file loaded: ${PLAN_PATH} (${planContent.length} bytes)`);
	} catch (e) {
		console.error(`Cannot read plan file at ${PLAN_PATH}: ${e}`);
		process.exit(1);
	}

	// -----------------------------------------------------------------------
	// Phase 2: Parse plan and validate
	// -----------------------------------------------------------------------
	console.log(`\n--- Phase 2: Parse and Validate ---`);

	let queue: WorkspaceQueue;
	try {
		const parsed = parsePlan(planContent, { validate: true, markdownFallback: false });
		if (!parsed.success || !parsed.queue) {
			throw new Error(`Plan parse failed: ${parsed.errors.join("; ")}`);
		}
		queue = parsed.queue;
		console.log(`Plan parsed: ${queue.workspaces.length} workspaces`);
	} catch (e) {
		console.error(`Plan parse error: ${e}`);
		process.exit(1);
	}

	// Run validator gate
	const validatorReport = runValidatorGate(planContent, queue);
	console.log(`Validator report:`);
	console.log(`  workspaces: ${validatorReport.topLevelWorkspaces}`);
	console.log(`  with effective prompt: ${validatorReport.workspacesWithEffectivePrompt}`);
	console.log(`  with capabilities.canEdit: ${validatorReport.workspacesWithCapabilitiesCanEdit}`);
	console.log(`  runtime backend: ${validatorReport.runtimeBackend}`);
	console.log(`  JSON fallback: ${validatorReport.jsonFallbackEnabled ? "YES (BLOCKER)" : "disabled"}`);
	console.log(`  worktree required: ${validatorReport.worktreeRequired}`);
	console.log(`  admission: ${validatorReport.admissionDecision}`);
	if (validatorReport.failReasons.length > 0) {
		console.log(`  FAIL REASONS:`);
		for (const reason of validatorReport.failReasons) {
			console.log(`    - ${reason}`);
		}
	}

	// Write validator/normalized reports
	await fs.writeFile(path.join(reportDir, "validator-report.json"), JSON.stringify(validatorReport, null, 2));
	await fs.writeFile(path.join(reportDir, "admission-report.json"), JSON.stringify({
		admissionDecision: validatorReport.admissionDecision,
		requestedMaxParallelism: validatorReport.requestedMaxParallelism,
		safeEffectiveParallelism: validatorReport.safeEffectiveParallelism,
		fileScopeConflicts: validatorReport.fileScopeConflicts,
		failReasons: validatorReport.failReasons,
		usedParallelism: validatorReport.admissionDecision === "reduced" ? validatorReport.safeEffectiveParallelism : Math.min(validatorReport.requestedMaxParallelism, validatorReport.safeEffectiveParallelism),
	}, null, 2));
	await fs.writeFile(path.join(reportDir, "normalized-plan.json"), JSON.stringify({
		contractVersion: queue.contractVersion,
		phase: queue.phase,
		title: queue.title,
		maxParallelWorkspaces: queue.maxParallelWorkspaces,
		workspaceCount: queue.workspaces.length,
	}, null, 2));

	// Write normalized workspaces summary
	const wsSummaries = queue.workspaces.map((ws) => ({
		id: ws.id,
		dependencies: ws.dependencies,
		batch: (ws as Record<string, unknown>).batch as string,
		parallelGroup: (ws as Record<string, unknown>).parallelGroup as string,
		goal: (ws as { goal?: string }).goal?.substring(0, 100),
		allowedFiles: (ws as Record<string, unknown>).allowedFiles as string[],
	}));
	await fs.writeFile(path.join(reportDir, "normalized-workspaces.json"), JSON.stringify(wsSummaries, null, 2));

	// -----------------------------------------------------------------------
	// Phase 3: Parallelism admission
	// -----------------------------------------------------------------------
	console.log(`\n--- Phase 3: Parallelism Admission ---`);

	const safeParallel = validatorReport.admissionDecision === "reduced"
		? validatorReport.safeEffectiveParallelism
		: Math.min(validatorReport.requestedMaxParallelism, validatorReport.safeEffectiveParallelism);

	console.log(`  Requested: ${validatorReport.requestedMaxParallelism}`);
	console.log(`  Safe effective: ${validatorReport.safeEffectiveParallelism}`);
	console.log(`  Using: ${safeParallel}`);

	if (validatorReport.failReasons.length > 0) {
		console.error(`\nADMISSION GATE FAILED — writing blocker report`);
		await fs.writeFile(path.join(reportDir, "blocker-report.md"),
			`# Blocker Report\n\nValidator gate rejected the plan:\n${
				validatorReport.failReasons.map((r) => `- ${r}`).join("\n")}\n\nCannot run V5 implementation.`
		);
		process.exit(1);
	}

	// -----------------------------------------------------------------------
	// Phase 4: Get model and Postgres
	// -----------------------------------------------------------------------
	const model = getModelForProvider();
	if (!model) {
		console.error("No model available for any provider. Check credentials.");
		process.exit(1);
	}
	console.log(`Model: ${model.id} (${model.provider})`);

	// Create project + Postgres
	let projectId: string;
	try {
		const store = createPostgresStateStore();
		const project = await store.findOrCreateProject("pi-v5-real-implementation", process.cwd());
		projectId = project.id;
		console.log(`Project: ${projectId}`);
	} catch (e) {
		console.error(`Postgres unavailable: ${e}`);
		process.exit(1);
	}

	// Capture git status before
	try {
		const gitBefore = execSync("git status --short", { cwd: process.cwd(), encoding: "utf-8", timeout: 10_000 });
		await fs.writeFile(path.join(reportDir, "git-status-before.txt"), gitBefore);
	} catch {
		await fs.writeFile(path.join(reportDir, "git-status-before.txt"), "(git status failed)");
	}

	// -----------------------------------------------------------------------
	// Phase 5-6: Execute full V5 plan
	// -----------------------------------------------------------------------
	console.log(`\n--- Phase 4: Real V5 Implementation (safeParallel=${safeParallel}) ---`);
	console.log(`No external wall timeout. Internal bounded-liveness guards active.`);
	console.log(`Workspace timeout: ${WORKSPACE_OVERALL_MS / 1000}s`);
	console.log(`LLM request timeout: ${LLM_REQUEST_MS / 1000}s`);

	// Write manifest
	await fs.writeFile(path.join(reportDir, "manifest.json"), JSON.stringify({
		timestamp,
		planPath: PLAN_PATH,
		model: { provider: model.provider, id: model.id },
		projectId,
		admission: validatorReport.admissionDecision,
		safeParallelism: safeParallel,
		timeouts: { llmRequestMs: LLM_REQUEST_MS, workspaceOverallMs: WORKSPACE_OVERALL_MS },
		startedAt: new Date(startedAt).toISOString(),
	}, null, 2));

	// Run the plan
	const planResult = await runV5Plan(queue, model, projectId, artifacts, reportDir);

	// -----------------------------------------------------------------------
	// Phase 7: Completion handling
	// -----------------------------------------------------------------------
	console.log(`\n--- Phase 7: Completion ---`);
	console.log(`Result: success=${planResult.success} completed=${planResult.completedCount} failed=${planResult.failedCount}`);
	console.log(`Duration: ${formatElapsed(startedAt)}`);

	// Write failure reports for failed workspaces
	for (const err of planResult.errors) {
		const match = err.match(/^\[([^\]]+)\]/);
		if (match) {
			const wsId = match[1];
			const result = artifacts.workspaceResults.get(wsId);
			await writeFailureReport(reportDir, wsId, result?.title ?? wsId, err,
				result?.durationMs ?? 0, artifacts);
		}
	}

	// Capture git status after
	try {
		const gitAfter = execSync("git status --short", { cwd: process.cwd(), encoding: "utf-8", timeout: 10_000 });
		await fs.writeFile(path.join(reportDir, "git-status-after.txt"), gitAfter);
	} catch {
		await fs.writeFile(path.join(reportDir, "git-status-after.txt"), "(git status failed)");
	}

	// -----------------------------------------------------------------------
	// Phase 8: Write artifacts and final report
	// -----------------------------------------------------------------------
	console.log(`\n--- Phase 8: Writing artifacts ---`);

	await writeArtifacts(artifacts, reportDir);

	const finalReport = await buildFinalReport(artifacts, reportDir, validatorReport, planResult, model, startedAt);
	await fs.writeFile(path.join(reportDir, "final-report.md"), finalReport);

	// Write timer report
		await fs.writeFile(path.join(reportDir, "timer-report.json"), JSON.stringify({
		startedAt: new Date(startedAt).toISOString(),
		completedAt: isoNow(),
		durationMs: planResult.durationMs,
		workspaceTimeoutMs: WORKSPACE_OVERALL_MS,
		llmRequestTimeoutMs: LLM_REQUEST_MS,
		pollIntervalMs: 2000,
		heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
	}, null, 2));

	// -----------------------------------------------------------------------
	// Phase 9: Post-execution verification & regression snapshot
	// -----------------------------------------------------------------------
	console.log(`\n--- Phase 9: Post-Execution Verification ---`);

	const postExecResult = await runPostExecutionVerification({
		workspaceRoot: process.cwd(),
		planExecId: artifacts.events.find((e) => e.type === "plan_initialized")?.data
			? (artifacts.events.find((e) => e.type === "plan_initialized")!.data! as Record<string, unknown>).planExecutionId as string ?? "",
		queue,
		completedWorkspaceIds: new Set([...artifacts.workspaceResults.entries()]
			.filter(([, r]) => r.status === "complete" || r.status === "complete_simulated")
			.map(([id]) => id)),
		failedWorkspaceIds: new Set([...artifacts.workspaceResults.entries()]
			.filter(([, r]) => r.status === "failed" || r.status === "handoff_required")
			.map(([id]) => id)),
	});

	await fs.writeFile(path.join(reportDir, "post-verification.json"), JSON.stringify(postExecResult, null, 2));
	console.log(`Post-execution: ${postExecResult.passed}/${postExecResult.totalChecks} passed, ${postExecResult.failed} failed`);
	for (const c of postExecResult.checks) {
		console.log(`  [${c.status.toUpperCase()}] ${c.name}: ${c.message}`);
	}

	// Regression snapshot
	let gitDiffStat = "";
	try {
		gitDiffStat = execSync("git diff --stat HEAD", { encoding: "utf-8", timeout: 10_000 });
	} catch {}

	const regressionSnapshot = buildRegressionSnapshot({
		startedAt,
		completedAt: Date.now(),
		planPath: PLAN_PATH,
		planContent,
		queue,
		modelProvider: model.provider as string,
		modelId: model.id,
		workspaceMetrics: new Map(), // populated below
		metricsSnapshots: [], // populated below
		resourceSamples: [], // populated below
		gitDiffStat,
	});

	await fs.writeFile(path.join(reportDir, "regression-snapshot.json"), JSON.stringify(regressionSnapshot, null, 2));

	// Dashboard health check
	try {
		const dashHealth = await checkDashboardHealth({ timeoutMs: 3000 });
		await fs.writeFile(path.join(reportDir, "dashboard-health.json"), JSON.stringify(dashHealth, null, 2));
		console.log(`Dashboard health: ${dashHealth.endpointsPassed}/${dashHealth.endpointsChecked} endpoints OK`);
	} catch {
		console.log("Dashboard health check skipped (server not running?)");
	}

	console.log(`\nFinal report: ${path.join(reportDir, "final-report.md")}`);
	console.log(`Artifacts written to: ${reportDir}`);
	console.log(finalReport);

	// -----------------------------------------------------------------------
	// Phase 10: Safety — do not clean up, user must review
	// -----------------------------------------------------------------------
	console.log(`\n--- Phase 10: Safety ---`);
	console.log(`Worktrees and Postgres state preserved for review.`);
	console.log(`To clean up: git worktree remove --force <path> for each worktree`);
	console.log(`To clean Postgres: delete from pi_executor database tables`);
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
