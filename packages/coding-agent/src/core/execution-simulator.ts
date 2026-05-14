/**
 * Execution Simulator & Dry-Run — P7 Workstream D
 *
 * Simulates plan execution characteristics without commands, commits, repo
 * mutation, or queue mutation. Produces forecast artifacts describing effective
 * parallelism, worker idle time, validation contention, merge contention, and
 * likely conflicts. Supports comparing manual and optimized DAGs.
 *
 * Acceptance Criteria:
 * 1. Dry-run produces forecast artifacts without side effects.
 * 2. Doctor blocks if dry-run attempts forbidden mutations.
 * 3. Simulation can compare manual and optimized DAGs.
 */

import { type BatchPlanResult, computeBatchPlan, formatBatchPlan } from "./dag-analyzer.js";
import type { WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Priority level for a workspace, derived from its queuePriority or position.
 */
export type SimulationPriority = "critical" | "high" | "medium" | "low";

/**
 * A single simulation timeslice representing a worker slot.
 */
export interface SimulationSlot {
	/** Workspace ID assigned to this slot */
	workspaceId: string;
	/** Simulated start time (batch index, 1-based) */
	startBatch: number;
	/** Simulated end time (batch index, 1-based) */
	endBatch: number;
	/** Whether this slot experienced validation contention */
	validationContention: boolean;
	/** Whether this slot experienced merge contention */
	mergeContention: boolean;
}

/**
 * Simulated worker timeline entry.
 */
export interface WorkerTimelineEntry {
	/** Worker index (1-based) */
	workerIndex: number;
	/** Slots assigned to this worker over time */
	slots: SimulationSlot[];
	/** Total simulated idle batches for this worker */
	idleBatches: number;
}

/**
 * A batch-level contention report.
 */
export interface BatchContention {
	/** Batch index (1-based) */
	batchIndex: number;
	/** Workspace IDs in this batch */
	workspaceIds: string[];
	/** Whether validation contention likely */
	validationContention: boolean;
	/** Whether merge contention likely */
	mergeContention: boolean;
	/** Estimated idle slots (unused worker capacity) */
	idleSlots: number;
}

/**
 * Comparison between a manual and an optimized DAG.
 */
export interface DAGComparison {
	/** Label for manual DAG */
	manualLabel: string;
	/** Label for optimized DAG */
	optimizedLabel: string;
	/** Manual DAG batch plan */
	manualBatches: BatchPlanResult;
	/** Optimized DAG batch plan */
	optimizedBatches: BatchPlanResult;
	/** Difference in effective parallelism (optimized - manual) */
	parallelismDelta: number;
	/** Difference in critical path length (optimized - manual; negative is better) */
	criticalPathDelta: number;
	/** Difference in serialized tail length (optimized - manual; negative is better) */
	serializedTailDelta: number;
	/** Whether the optimization improved parallelism */
	improved: boolean;
}

/**
 * Complete simulation forecast.
 */
export interface SimulationForecast {
	/** Batch plan for the queue */
	batchPlan: BatchPlanResult;
	/** Worker timeline (simulated schedule) */
	workerTimeline: WorkerTimelineEntry[];
	/** Per-batch contention analysis */
	batchContention: BatchContention[];
	/** Total simulated duration in batches */
	totalBatches: number;
	/** Estimated worker utilization ratio (0-1) */
	estimatedUtilization: number;
	/** Estimated idle batch slots across all workers */
	totalIdleSlots: number;
	/** Estimated validation-contended batches */
	validationContendedBatches: number;
	/** Estimated merge-contended batches */
	mergeContendedBatches: number;
	/** File overlap warnings (same-file parallelism violations) */
	fileOverlaps: string[];
	/** DAG comparison if two queue states were provided */
	dagComparison?: DAGComparison;
	/** Timestamp of simulation */
	simulatedAt: string;
}

/**
 * Dry-run mutation guard result.
 */
export interface MutationGuardResult {
	/** Whether any forbidden mutations were detected */
	forbiddenMutationDetected: boolean;
	/** List of detected forbidden mutations */
	forbiddenMutations: string[];
	/** Whether the guard blocks execution */
	blocksExecution: boolean;
}

// ---------------------------------------------------------------------------
// Forbidden mutation patterns for dry-run
// ---------------------------------------------------------------------------

/**
 * Patterns that are forbidden during dry-run simulation.
 */
const FORBIDDEN_MUTATION_PATTERNS: RegExp[] = [
	/git\s+commit/i,
	/git\s+push/i,
	/git\s+reset\s+--hard/i,
	/git\s+checkout\s+\./i,
	/git\s+clean\s+-fd/i,
	/git\s+stash/i,
	/git\s+add\s+-A/i,
	/git\s+add\s+\./i,
	/npm\s+publish/i,
	/yarn\s+publish/i,
	/rm\s+-rf/i,
];

// ---------------------------------------------------------------------------
// Simulation Engine
// ---------------------------------------------------------------------------

/**
 * The execution simulator predicts execution characteristics from a
 * workspace queue without actually running any commands.
 */
export class ExecutionSimulator {
	private maxWorkers: number;

	/**
	 * @param maxWorkers - Maximum concurrent workers to simulate (default: 3)
	 */
	constructor(maxWorkers = 3) {
		this.maxWorkers = maxWorkers;
	}

	/**
	 * Run a full simulation forecast from a workspace queue.
	 *
	 * @param queue - Workspace queue to simulate
	 * @returns Simulation forecast
	 */
	simulate(queue: WorkspaceQueue): SimulationForecast {
		// Compute batch plan
		const batchPlan = computeBatchPlan(queue);

		// Simulate worker timeline and contention
		const workerTimeline = this.simulateWorkerTimeline(batchPlan);
		const batchContention = this.analyzeBatchContention(queue, batchPlan);

		// Aggregate metrics
		const totalBatches = batchPlan.totalBatches;
		const totalIdleSlots = workerTimeline.reduce((sum, w) => sum + w.idleBatches, 0);
		const totalWorkerSlots = totalBatches * this.maxWorkers;
		const estimatedUtilization = totalWorkerSlots > 0 ? 1 - totalIdleSlots / totalWorkerSlots : 0;

		const validationContendedBatches = batchContention.filter((b) => b.validationContention).length;
		const mergeContendedBatches = batchContention.filter((b) => b.mergeContention).length;

		// File overlap warnings from batch plan
		const fileOverlaps = batchPlan.warnings.filter((w) => w.type === "file_overlap").map((w) => w.message);

		return {
			batchPlan,
			workerTimeline,
			batchContention,
			totalBatches,
			estimatedUtilization,
			totalIdleSlots,
			validationContendedBatches,
			mergeContendedBatches,
			fileOverlaps,
			simulatedAt: new Date().toISOString(),
		};
	}

	/**
	 * Compare two queue states (manual vs. optimized DAG).
	 *
	 * @param manualQueue - The original (manual) DAG
	 * @param optimizedQueue - The proposed (optimized) DAG
	 * @param manualLabel - Label for the manual DAG (default: "Manual")
	 * @param optimizedLabel - Label for the optimized DAG (default: "Optimized")
	 * @returns DAG comparison
	 */
	compareDAGs(
		manualQueue: WorkspaceQueue,
		optimizedQueue: WorkspaceQueue,
		manualLabel = "Manual",
		optimizedLabel = "Optimized",
	): DAGComparison {
		const manualBatches = computeBatchPlan(manualQueue);
		const optimizedBatches = computeBatchPlan(optimizedQueue);

		const parallelismDelta = optimizedBatches.effectiveParallelism - manualBatches.effectiveParallelism;
		const criticalPathDelta = optimizedBatches.criticalPathLength - manualBatches.criticalPathLength;
		const serializedTailDelta = optimizedBatches.serializedTailLength - manualBatches.serializedTailLength;

		const improved =
			parallelismDelta > 0 ||
			(parallelismDelta >= 0 && criticalPathDelta < 0) ||
			(parallelismDelta >= 0 && criticalPathDelta <= 0 && serializedTailDelta < 0);

		return {
			manualLabel,
			optimizedLabel,
			manualBatches,
			optimizedBatches,
			parallelismDelta,
			criticalPathDelta,
			serializedTailDelta,
			improved,
		};
	}

	/**
	 * Run a full simulation with optional DAG comparison.
	 *
	 * @param queue - Workspace queue to simulate
	 * @param optimizedQueue - Optional optimized queue for DAG comparison
	 * @param manualLabel - Label for manual DAG
	 * @param optimizedLabel - Label for optimized DAG
	 * @returns Simulation forecast with optional DAG comparison
	 */
	simulateWithComparison(
		queue: WorkspaceQueue,
		optimizedQueue?: WorkspaceQueue,
		manualLabel = "Manual",
		optimizedLabel = "Optimized",
	): SimulationForecast {
		const forecast = this.simulate(queue);

		if (optimizedQueue) {
			forecast.dagComparison = this.compareDAGs(queue, optimizedQueue, manualLabel, optimizedLabel);
		}

		return forecast;
	}

	/**
	 * Simulate worker assignment across batches.
	 */
	private simulateWorkerTimeline(batchPlan: BatchPlanResult): WorkerTimelineEntry[] {
		const workers: WorkerTimelineEntry[] = [];
		for (let i = 0; i < this.maxWorkers; i++) {
			workers.push({ workerIndex: i + 1, slots: [], idleBatches: 0 });
		}

		// Greedy assignment: assign workspaces to first available worker cyclically
		let nextWorkerIndex = 0;
		for (const batch of batchPlan.batches) {
			const assignedThisBatch = new Set<string>();

			for (const wsId of batch.workspaceIds) {
				const worker = workers[nextWorkerIndex % workers.length];
				worker.slots.push({
					workspaceId: wsId,
					startBatch: batch.batchIndex,
					endBatch: batch.batchIndex,
					validationContention: false,
					mergeContention: false,
				});
				assignedThisBatch.add(wsId);
				nextWorkerIndex++;
			}

			// Workers without an assignment in this batch are idle
			const assignedWorkerCount = Math.min(batch.workspaceIds.length, this.maxWorkers);
			for (let i = assignedWorkerCount; i < this.maxWorkers; i++) {
				workers[i].idleBatches++;
			}
		}

		return workers;
	}

	/**
	 * Analyze per-batch contention (validation, merge, idle slots).
	 */
	private analyzeBatchContention(queue: WorkspaceQueue, batchPlan: BatchPlanResult): BatchContention[] {
		const wsMap = new Map(queue.workspaces.map((w) => [w.id, w]));
		const result: BatchContention[] = [];

		for (const batch of batchPlan.batches) {
			const wsIds = batch.workspaceIds;

			// Validation contention: multiple workspaces in the same batch
			// that share test files or have heavy validation requirements
			let validationContention = false;
			if (wsIds.length > 1) {
				// Check if any workspace has a "heavy" validation profile
				const heavyValidation = wsIds.filter((id) => {
					const ws = wsMap.get(id);
					return ws?.capabilities?.validation === "heavy" || ws?.capabilities?.validation === "full";
				});
				if (heavyValidation.length > 1) {
					validationContention = true;
				}
			}

			// Merge contention: workspaces in the same batch that edit similar files
			let mergeContention = false;
			if (wsIds.length > 1) {
				const filesByWs = new Map<string, Set<string>>();
				for (const id of wsIds) {
					const ws = wsMap.get(id);
					if (ws?.capabilities?.canEdit) {
						filesByWs.set(id, new Set(ws.capabilities.canEdit));
					}
				}
				// Check for overlapping files (potential merge conflicts)
				for (let i = 0; i < wsIds.length && !mergeContention; i++) {
					for (let j = i + 1; j < wsIds.length && !mergeContention; j++) {
						const filesA = filesByWs.get(wsIds[i]);
						const filesB = filesByWs.get(wsIds[j]);
						if (filesA && filesB) {
							const overlap = [...filesA].filter((f) => filesB.has(f));
							if (overlap.length > 0) {
								mergeContention = true;
							}
						}
					}
				}
			}

			// Idle slots: unused worker capacity in this batch
			const idleSlots = Math.max(0, this.maxWorkers - wsIds.length);

			result.push({
				batchIndex: batch.batchIndex,
				workspaceIds: wsIds,
				validationContention,
				mergeContention,
				idleSlots,
			});
		}

		return result;
	}

	/**
	 * Check for forbidden mutation patterns in workspace commands.
	 * Used by the doctor to block dry-run if forbidden mutations are detected.
	 *
	 * @param queue - Workspace queue to check
	 * @returns Mutation guard result
	 */
	checkForbiddenMutations(queue: WorkspaceQueue): MutationGuardResult {
		const forbiddenMutations: string[] = [];

		for (const ws of queue.workspaces) {
			const commands = ws.capabilities?.canRun ?? [];
			for (const cmd of commands) {
				for (const pattern of FORBIDDEN_MUTATION_PATTERNS) {
					if (pattern.test(cmd)) {
						forbiddenMutations.push(`Workspace "${ws.id}" contains forbidden command: "${cmd}"`);
					}
				}
			}
		}

		return {
			forbiddenMutationDetected: forbiddenMutations.length > 0,
			forbiddenMutations,
			blocksExecution: forbiddenMutations.length > 0,
		};
	}
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a simulation forecast for human-readable display.
 *
 * @param forecast - Simulation forecast
 * @returns Formatted string
 */
export function formatSimulationForecast(forecast: SimulationForecast): string {
	const lines: string[] = [];

	lines.push("=== Execution Simulation Forecast ===\n");
	lines.push(`Simulated at: ${forecast.simulatedAt}`);
	lines.push("");

	// Batch plan summary
	lines.push(formatBatchPlan(forecast.batchPlan));
	lines.push("");

	// Utilization summary
	lines.push("=== Worker Utilization ===");
	lines.push(`  Total batches:             ${forecast.totalBatches}`);
	lines.push(`  Max workers:               ${forecast.workerTimeline.length}`);
	lines.push(`  Estimated utilization:     ${(forecast.estimatedUtilization * 100).toFixed(1)}%`);
	lines.push(`  Total idle slots:          ${forecast.totalIdleSlots}`);
	lines.push("");

	// Contention summary
	lines.push("=== Contention Analysis ===");
	lines.push(`  Validation-contended batches: ${forecast.validationContendedBatches}`);
	lines.push(`  Merge-contended batches:      ${forecast.mergeContendedBatches}`);
	lines.push("");

	// Per-batch contention detail
	if (forecast.batchContention.length > 0) {
		lines.push("=== Per-Batch Detail ===");
		for (const bc of forecast.batchContention) {
			const flags: string[] = [];
			if (bc.validationContention) flags.push("VALIDATION");
			if (bc.mergeContention) flags.push("MERGE");
			if (bc.idleSlots > 0) flags.push(`${bc.idleSlots} IDLE`);
			const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
			lines.push(`  Batch ${bc.batchIndex}: ${bc.workspaceIds.join(", ")}${flagStr}`);
		}
		lines.push("");
	}

	// File overlap warnings
	if (forecast.fileOverlaps.length > 0) {
		lines.push("=== File Overlap Warnings ===");
		for (const overlap of forecast.fileOverlaps) {
			lines.push(`  ⚠ ${overlap}`);
		}
		lines.push("");
	}

	// DAG comparison
	if (forecast.dagComparison) {
		lines.push("=== DAG Comparison ===");
		const dc = forecast.dagComparison;
		lines.push(
			`  ${dc.manualLabel}:  effective parallelism = ${dc.manualBatches.effectiveParallelism}, ` +
				`critical path = ${dc.manualBatches.criticalPathLength}, ` +
				`serialized tail = ${dc.manualBatches.serializedTailLength}`,
		);
		lines.push(
			`  ${dc.optimizedLabel}: effective parallelism = ${dc.optimizedBatches.effectiveParallelism}, ` +
				`critical path = ${dc.optimizedBatches.criticalPathLength}, ` +
				`serialized tail = ${dc.optimizedBatches.serializedTailLength}`,
		);
		lines.push(`  Parallelism delta:  ${dc.parallelismDelta > 0 ? "+" : ""}${dc.parallelismDelta}`);
		lines.push(`  Critical path delta: ${dc.criticalPathDelta > 0 ? "+" : ""}${dc.criticalPathDelta}`);
		lines.push(`  Serialized tail delta: ${dc.serializedTailDelta > 0 ? "+" : ""}${dc.serializedTailDelta}`);
		lines.push(`  Optimization improved parallelism: ${dc.improved ? "YES" : "NO"}`);
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Format a DAG comparison for human-readable display.
 *
 * @param comparison - DAG comparison
 * @returns Formatted string
 */
export function formatDAGComparison(comparison: DAGComparison): string {
	const lines: string[] = [];

	lines.push("=== DAG Comparison ===\n");
	lines.push(`${comparison.manualLabel}:`);
	lines.push(`  Effective parallelism:          ${comparison.manualBatches.effectiveParallelism}`);
	lines.push(`  Critical path length:           ${comparison.manualBatches.criticalPathLength}`);
	lines.push(`  Serialized tail length:         ${comparison.manualBatches.serializedTailLength}`);
	lines.push(`  Total batches:                  ${comparison.manualBatches.totalBatches}`);
	lines.push(`  Over-serialized:                ${comparison.manualBatches.isOverSerialized ? "YES" : "NO"}`);
	lines.push("");

	lines.push(`${comparison.optimizedLabel}:`);
	lines.push(`  Effective parallelism:          ${comparison.optimizedBatches.effectiveParallelism}`);
	lines.push(`  Critical path length:           ${comparison.optimizedBatches.criticalPathLength}`);
	lines.push(`  Serialized tail length:         ${comparison.optimizedBatches.serializedTailLength}`);
	lines.push(`  Total batches:                  ${comparison.optimizedBatches.totalBatches}`);
	lines.push(`  Over-serialized:                ${comparison.optimizedBatches.isOverSerialized ? "YES" : "NO"}`);
	lines.push("");

	lines.push("=== Delta (Optimized - Manual) ===");
	lines.push(
		`  Parallelism delta:              ${comparison.parallelismDelta > 0 ? "+" : ""}${comparison.parallelismDelta}`,
	);
	lines.push(
		`  Critical path delta:            ${comparison.criticalPathDelta > 0 ? "+" : ""}${comparison.criticalPathDelta} ` +
			`(negative is better)`,
	);
	lines.push(
		`  Serialized tail delta:          ${comparison.serializedTailDelta > 0 ? "+" : ""}${comparison.serializedTailDelta} ` +
			`(negative is better)`,
	);
	lines.push("");
	lines.push(
		`Verdict: ${comparison.improved ? "Optimization improves parallelism" : "Optimization does not improve parallelism"}`,
	);

	return lines.join("\n");
}

/**
 * Format a mutation guard result for display.
 *
 * @param result - Mutation guard result
 * @returns Formatted string
 */
export function formatMutationGuardResult(result: MutationGuardResult): string {
	if (!result.forbiddenMutationDetected) {
		return "Dry-run mutation guard: OK (no forbidden mutations detected)";
	}

	const lines: string[] = ["DRY-RUN MUTATION GUARD: BLOCKED", "", "Forbidden mutations detected:"];
	for (const mutation of result.forbiddenMutations) {
		lines.push(`  ✗ ${mutation}`);
	}
	lines.push("");
	lines.push("These operations are forbidden in dry-run mode.");
	lines.push("Remove them from workspace commands to proceed.");

	return lines.join("\n");
}

/**
 * Convert a DAG comparison to a JSON-serializable object.
 */
export function dagComparisonToJSON(comparison: DAGComparison): Record<string, unknown> {
	return {
		manualLabel: comparison.manualLabel,
		optimizedLabel: comparison.optimizedLabel,
		manual: {
			effectiveParallelism: comparison.manualBatches.effectiveParallelism,
			criticalPathLength: comparison.manualBatches.criticalPathLength,
			serializedTailLength: comparison.manualBatches.serializedTailLength,
			totalBatches: comparison.manualBatches.totalBatches,
			isOverSerialized: comparison.manualBatches.isOverSerialized,
		},
		optimized: {
			effectiveParallelism: comparison.optimizedBatches.effectiveParallelism,
			criticalPathLength: comparison.optimizedBatches.criticalPathLength,
			serializedTailLength: comparison.optimizedBatches.serializedTailLength,
			totalBatches: comparison.optimizedBatches.totalBatches,
			isOverSerialized: comparison.optimizedBatches.isOverSerialized,
		},
		deltas: {
			parallelismDelta: comparison.parallelismDelta,
			criticalPathDelta: comparison.criticalPathDelta,
			serializedTailDelta: comparison.serializedTailDelta,
		},
		improved: comparison.improved,
	};
}
