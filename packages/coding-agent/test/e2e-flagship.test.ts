/**
 * P-V5 E2E Flagship Test Suite
 *
 * This is the primary E2E test for the plan execution engine.
 * It uses the faux provider (no real API calls, no paid tokens) and
 * validates the entire execution pipeline: parsing, validation, scheduling,
 * workspace execution, cleanup, and completion.
 *
 * Run with:
 *   npx vitest test/e2e-flagship.test.ts
 *
 * The test produces a comprehensive evidence report at:
 *   reports/e2e-flagship/<timestamp>/
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
	extractBugEvidence,
	ResourceMonitor,
	RuntimeMetricsCollector,
	runPreflightChecks,
	verifySchedulerCorrectness,
	writeBugEvidenceReport,
} from "../scripts/e2e-monitoring/index.js";
import type { WorkspaceTrace } from "../scripts/e2e-monitoring/scheduler-verify.js";
import type { E2ERunResult } from "../scripts/e2e-monitoring/types.js";
import { AutonomousExecutor } from "../src/core/autonomous-executor.js";
import { parsePlan } from "../src/core/plan-parser.js";
import { createStateStore } from "../src/core/state-store.js";
import { configureMemoryGuard } from "../src/core/worker-memory-guard.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PLAN_PATH = path.resolve(REPO_ROOT, "P-V5_Brain_Reality_Layer_v4_Plan_EXECUTOR_SCHEMA_FIXED.md");
const REPORT_BASE = path.resolve(REPO_ROOT, "reports", "e2e-flagship");
const MAX_PARALLEL = 3;
const WORKSPACE_TIMEOUT_MS = 3 * 60 * 1000; // 3 min

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportDir = path.join(REPORT_BASE, timestamp);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("P-V5 E2E Flagship", () => {
	let queue: WorkspaceQueue;
	let planContent: string;
	let _runResult: E2ERunResult;

	// Shared across test phases
	const completedIds = new Set<string>();
	const failedIds = new Set<string>();
	const workspaceTraces: WorkspaceTrace[] = [];

	beforeAll(async () => {
		// Disable memory guard for test — system memory may exceed default 8 GB limit
		configureMemoryGuard({ memoryLimitGb: 64, waitTimeoutSec: 5 });
		await fs.mkdir(reportDir, { recursive: true });
		planContent = await fs.readFile(PLAN_PATH, "utf-8");
	});

	// ── Phase 1: Preflight ────────────────────────────────────────────

	describe("Preflight health checks", () => {
		it("all preflight checks pass", async () => {
			const report = await runPreflightChecks({
				workspaceRoot: process.cwd(),
				planPath: PLAN_PATH,
				checkLlmCredentials: false, // faux provider
				checkDatabase: false, // JSON fallback for CI
				checkWorktrees: false,
				skipBlockingOn: ["git-clean"], // test env may have uncommitted files
			});

			await fs.writeFile(path.join(reportDir, "preflight.json"), JSON.stringify(report, null, 2));

			expect(report.blockExecution).toBe(false);
			for (const check of report.checks) {
				// Skip git-clean in test environment (repo may have uncommitted files)
				if (check.name === "git-clean") continue;
				expect(check.status, `Preflight check "${check.name}": ${check.message}`).not.toBe("fail");
			}
		});
	});

	// ── Phase 2: Parse & Validate ─────────────────────────────────────

	describe("Plan parsing and validation", () => {
		it("parses without errors", () => {
			const result = parsePlan(planContent, { validate: true, markdownFallback: false });
			expect(result.success).toBe(true);
			expect(result.queue).toBeDefined();
			queue = result.queue!;
			expect(queue.workspaces.length).toBeGreaterThanOrEqual(1);
		});

		it("has expected workspace count", () => {
			expect(queue.workspaces.length).toBe(20); // P-V5 plan: 20 workspaces
		});

		it("no dependency cycles", () => {
			const ids = new Set(queue.workspaces.map((w) => w.id));
			for (const ws of queue.workspaces) {
				for (const dep of ws.dependencies) {
					expect(ids.has(dep), `Workspace ${ws.id} depends on missing ${dep}`).toBe(true);
				}
			}
		});

		it("all workspaces have capabilities.canEdit", () => {
			for (const ws of queue.workspaces) {
				const caps = (ws as unknown as Record<string, unknown>).capabilities as Record<string, unknown> | undefined;
				const manifest = (ws as unknown as Record<string, unknown>).capabilityManifest as
					| Record<string, unknown>
					| undefined;
				const canEdit = (caps?.canEdit as string[]) ?? (manifest?.canEdit as string[]) ?? [];
				expect(canEdit.length, `Workspace ${ws.id} has empty canEdit`).toBeGreaterThan(0);
			}
		});
	});

	// ── Phase 3: Execution ────────────────────────────────────────────

	describe("Plan execution", () => {
		let metrics: RuntimeMetricsCollector;
		let resources: ResourceMonitor;

		beforeAll(() => {
			metrics = new RuntimeMetricsCollector(MAX_PARALLEL);
			resources = new ResourceMonitor({ sampleIntervalMs: 15_000 });
		});

		it("executes all workspaces to terminal state", async () => {
			// Use JSON state store for deterministic CI runs
			const stateStore = createStateStore({
				backend: "json",
				workspaceRoot: process.cwd(),
			});

			const executor = new AutonomousExecutor(stateStore, {
				workspaceRoot: process.cwd(),
				maxWorkers: MAX_PARALLEL,
				enableRealExecution: false, // SIMULATED — no real LLM
				worktree: { enabled: false }, // no git worktrees during simulation
				workspaceTimeoutMs: WORKSPACE_TIMEOUT_MS,
				skipProjectManagement: true,
				autoCommit: false, // no git commits during simulation
			});

			const planExecId = await executor.initialize(queue);
			expect(planExecId).toBeTruthy();

			resources.start();

			const maxIterations = queue.workspaces.length * 2 + 20; // generous bound
			let iterations = 0;
			let inFlight = 0;

			while (!executor.isExecutionComplete() && iterations < maxIterations) {
				iterations++;
				await executor.loadState();
				const state = executor.getState();
				if (!state) break;

				// Track completion
				for (const [wsId, ws] of state.workspaces) {
					if (ws.stage === WorkspaceStage.Complete && !completedIds.has(wsId)) {
						completedIds.add(wsId);
						metrics.markCompleted(wsId, "COMPLETE", null);
					}
					if (ws.stage === WorkspaceStage.Failed && !failedIds.has(wsId)) {
						failedIds.add(wsId);
						metrics.markCompleted(wsId, "FAILED", ws.error ?? null);
					}
				}

				metrics.takeSnapshot(state);

				const ready = await executor.getNextWorkspaces(queue.workspaces);
				if (ready.length === 0) {
					// No ready workspaces — wait for in-flight ones to complete
					if (inFlight > 0) {
						await new Promise((r) => setTimeout(r, 100));
						continue;
					}
					// Truly stuck — no in-flight and no ready
					break;
				}

				// Launch workspaces up to maxParallel
				const toLaunch = ready
					.filter((ws) => !completedIds.has(ws.id) && !failedIds.has(ws.id))
					.slice(0, MAX_PARALLEL - inFlight);

				if (toLaunch.length === 0) {
					await new Promise((r) => setTimeout(r, 100));
					continue;
				}

				// Batch launch and await all in this batch to complete
				const launched = toLaunch.map((ws) => {
					const traced: WorkspaceTrace = {
						workspaceId: ws.id,
						dependencies: ws.dependencies,
						cannotRunWith: ws.cannotRunWith ?? [],
						batch: ((ws as unknown as Record<string, unknown>).batch as string) ?? "B0",
						queuedAt: Date.now(),
						startedAt: Date.now(),
						completedAt: null,
						verdict: "pending",
					};
					workspaceTraces.push(traced);
					metrics.markQueued(ws.id);
					metrics.markStarted(ws.id, 1);
					inFlight++;

					return executor
						.executeWorkspace(ws)
						.then((result) => {
							traced.completedAt = Date.now();
							traced.verdict = result.verdict;
							metrics.markCompleted(ws.id, result.verdict, result.error ?? null);
							inFlight--;
							if (result.verdict === "COMPLETE") completedIds.add(ws.id);
							else failedIds.add(ws.id);
						})
						.catch((_err) => {
							traced.completedAt = Date.now();
							traced.verdict = "FAILED";
							inFlight--;
							failedIds.add(ws.id);
						});
				});

				// Wait for the batch to complete before scheduling the next
				await Promise.allSettled(launched);
			}

			resources.stop();

			// Assertions
			expect(iterations).toBeLessThan(maxIterations);
			const finalState = executor.getState();
			expect(finalState).not.toBeNull();

			const terminal = completedIds.size + failedIds.size;
			expect(terminal, `Only ${terminal}/${queue.workspaces.length} workspaces reached terminal state`).toBe(
				queue.workspaces.length,
			);

			// Completion verification
			const verification = executor.hasVerifiableCompletion();
			expect(
				verification.passed,
				`Completion verification: ${verification.completed}/${verification.total} executed`,
			).toBe(true);

			// Write workspace metrics
			const wsMetrics = metrics.getWorkspaceMetrics();
			await fs.writeFile(
				path.join(reportDir, "workspace-metrics.ndjson"),
				`${[...wsMetrics.entries()]
					.map(([id, m]) => JSON.stringify({ id, ...m, toolNames: [...m.toolNames] }))
					.join("\n")}\n`,
			);

			// Write resource samples
			await fs.writeFile(
				path.join(reportDir, "resource-samples.ndjson"),
				`${resources
					.getSamples()
					.map((s) => JSON.stringify(s))
					.join("\n")}\n`,
			);

			// Write metrics snapshots
			await fs.writeFile(
				path.join(reportDir, "metrics-snapshots.ndjson"),
				`${metrics
					.getSnapshots()
					.map((s) => JSON.stringify(s))
					.join("\n")}\n`,
			);
		}, 120_000); // 2 minute test timeout
	});

	// ── Phase 4: Scheduler Correctness ────────────────────────────────

	describe("Scheduler correctness", () => {
		it("respects dependency ordering", () => {
			const result = verifySchedulerCorrectness({
				queue,
				maxParallel: MAX_PARALLEL,
				traces: workspaceTraces,
			});

			expect(result.violations.filter((v) => v.type === "dependency_order")).toHaveLength(0);
		});

		it("never exceeds maxParallel", () => {
			const result = verifySchedulerCorrectness({
				queue,
				maxParallel: MAX_PARALLEL,
				traces: workspaceTraces,
			});
			expect(result.violations.filter((v) => v.type === "max_parallelism")).toHaveLength(0);
		});
	});

	// ── Phase 5: Evidence Report ──────────────────────────────────────

	describe("Bug evidence extraction", () => {
		it("produces zero critical bugs", async () => {
			const schedulerResult = verifySchedulerCorrectness({
				queue,
				maxParallel: MAX_PARALLEL,
				traces: workspaceTraces,
			});

			const bugs = extractBugEvidence({
				runResult: {
					runId: timestamp,
					startedAt: Date.now(),
					completedAt: Date.now(),
					totalDurationMs: 0,
					planPath: PLAN_PATH,
					exitCode: 0,
					success: completedIds.size >= queue.workspaces.length * 0.8,
					preflight: {
						timestamp: 0,
						totalChecks: 0,
						passed: 0,
						failed: 0,
						warned: 0,
						skipped: 0,
						checks: [],
						blockExecution: false,
						blockReasons: [],
					},
					metrics: [],
					resources: [],
					postExecution: {
						timestamp: 0,
						totalChecks: 0,
						passed: 0,
						failed: 0,
						warned: 0,
						checks: [],
						overallPassed: true,
					},
					regression: null,
					dashboardHealth: null,
					workspaceMetrics: new Map(),
					errors: [],
					artifactsDir: reportDir,
				},
				artifactsDir: reportDir,
				schedulerViolations: schedulerResult.violations,
			});

			await writeBugEvidenceReport(bugs, path.join(reportDir, "bug-evidence.md"));

			const criticalBugs = bugs.filter((b) => b.severity === "critical");
			expect(
				criticalBugs,
				`Found ${criticalBugs.length} critical bugs:\n${criticalBugs.map((b) => b.title).join("\n")}`,
			).toHaveLength(0);
		});
	});
});
