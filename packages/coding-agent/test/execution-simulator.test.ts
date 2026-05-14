/**
 * Tests for Execution Simulator — P7 Workstream D
 *
 * Acceptance criteria:
 * 1. Dry-run produces forecast artifacts without side effects.
 * 2. Doctor blocks if dry-run attempts forbidden mutations.
 * 3. Simulation can compare manual and optimized DAGs.
 */

import { describe, expect, it } from "vitest";
import {
	ExecutionSimulator,
	formatDAGComparison,
	formatMutationGuardResult,
	formatSimulationForecast,
} from "../src/core/execution-simulator.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal workspace with given id, dependencies, and capabilities */
function ws(id: string, deps: string[] = [], extra?: Partial<Workspace>): Workspace {
	return {
		id,
		title: `Task ${id}`,
		dependencies: deps,
		roleBudget: "worker",
		maxRetries: 3,
		...extra,
	};
}

/** Create a workspace queue from workspaces */
function queue(workspaces: Workspace[], maxParallel = 3): WorkspaceQueue {
	return {
		phase: "P7.D",
		title: "Execution Simulation Test",
		maxParallelWorkspaces: maxParallel,
		workspaces,
	};
}

// ---------------------------------------------------------------------------
// AC1: Dry-run produces forecast artifacts without side effects
// ---------------------------------------------------------------------------

describe("ExecutionSimulator — AC1: forecast artifacts without side effects", () => {
	it("produces a forecast with batch plan for independent workspaces", () => {
		const simulator = new ExecutionSimulator(3);
		const forecast = simulator.simulate(queue([ws("A"), ws("B"), ws("C")]));

		expect(forecast).toBeDefined();
		expect(forecast.batchPlan).toBeDefined();
		expect(forecast.batchPlan.errors).toHaveLength(0);
		expect(forecast.totalBatches).toBe(1);
		expect(forecast.batchPlan.effectiveParallelism).toBe(3);
		expect(forecast.simulatedAt).toBeDefined();
		expect(typeof forecast.simulatedAt).toBe("string");
	});

	it("produces forecast with worker timeline", () => {
		const simulator = new ExecutionSimulator(3);
		const forecast = simulator.simulate(queue([ws("A"), ws("B", ["A"]), ws("C", ["A"])]));

		expect(forecast.workerTimeline).toHaveLength(3);
		// All workers should have entries
		for (const worker of forecast.workerTimeline) {
			expect(worker.workerIndex).toBeGreaterThanOrEqual(1);
			expect(worker.workerIndex).toBeLessThanOrEqual(3);
		}
	});

	it("produces forecast with contention analysis", () => {
		const simulator = new ExecutionSimulator(3);
		const forecast = simulator.simulate(queue([ws("A"), ws("B"), ws("C")]));

		expect(forecast.batchContention).toHaveLength(1);
		expect(forecast.batchContention[0].batchIndex).toBe(1);
		expect(forecast.batchContention[0].idleSlots).toBe(0); // 3 workspaces, 3 workers
	});

	it("tracks idle slots when workspaces < maxWorkers", () => {
		const simulator = new ExecutionSimulator(5);
		const forecast = simulator.simulate(queue([ws("A"), ws("B")]));

		expect(forecast.totalIdleSlots).toBeGreaterThan(0);
		expect(forecast.estimatedUtilization).toBeLessThan(1);
	});

	it("produces forecast without side effects (no repo mutation)", () => {
		const simulator = new ExecutionSimulator(3);
		const forecast = simulator.simulate(queue([ws("A"), ws("B"), ws("C")]));

		// Forecast should not contain any command execution results
		expect(forecast).not.toHaveProperty("executedCommands");
		expect(forecast).not.toHaveProperty("mutatedFiles");
		expect(forecast).not.toHaveProperty("commits");

		// Should contain only analytical metrics
		expect(forecast).toHaveProperty("batchPlan");
		expect(forecast).toHaveProperty("workerTimeline");
		expect(forecast).toHaveProperty("batchContention");
		expect(forecast).toHaveProperty("estimatedUtilization");
		expect(forecast).toHaveProperty("totalIdleSlots");
	});

	it("detects file overlaps in contention analysis", () => {
		const workspaces = [
			ws("A", [], { capabilities: { canEdit: ["src/file.ts"], canRun: [] } }),
			ws("B", [], { capabilities: { canEdit: ["src/file.ts"], canRun: [] } }),
		];
		const simulator = new ExecutionSimulator(3);
		const forecast = simulator.simulate(queue(workspaces));

		// Same file in same batch -> merge contention
		const batch = forecast.batchContention[0];
		expect(batch.mergeContention).toBe(true);
	});

	it("detects validation contention when multiple heavy-validation workspaces are in the same batch", () => {
		const workspaces = [
			ws("A", [], { capabilities: { canEdit: [], canRun: [], validation: "heavy" as const } }),
			ws("B", [], { capabilities: { canEdit: [], canRun: [], validation: "heavy" as const } }),
		];
		const simulator = new ExecutionSimulator(3);
		const forecast = simulator.simulate(queue(workspaces));

		const batch = forecast.batchContention[0];
		expect(batch.validationContention).toBe(true);
	});

	it("serialized DAG produces many batches with idle slots", () => {
		// A -> B -> C -> D (fully serial)
		const workspaces = [ws("A"), ws("B", ["A"]), ws("C", ["B"]), ws("D", ["C"])];
		const simulator = new ExecutionSimulator(3);
		const forecast = simulator.simulate(queue(workspaces));

		expect(forecast.totalBatches).toBe(4);
		expect(forecast.batchPlan.effectiveParallelism).toBe(1);
		expect(forecast.batchPlan.isOverSerialized).toBe(true);
		// Most workers idle most of the time
		expect(forecast.estimatedUtilization).toBeLessThan(0.5);
	});
});

// ---------------------------------------------------------------------------
// AC2: Doctor blocks if dry-run attempts forbidden mutations
// ---------------------------------------------------------------------------

describe("ExecutionSimulator — AC2: doctor blocks forbidden mutations", () => {
	it("detects forbidden git commit in workspace commands", () => {
		const workspaces = [
			ws("A", [], {
				capabilities: { canRun: ["git commit -m 'fix'"], canEdit: [] },
			}),
		];
		const simulator = new ExecutionSimulator(3);
		const result = simulator.checkForbiddenMutations(queue(workspaces));

		expect(result.forbiddenMutationDetected).toBe(true);
		expect(result.forbiddenMutations.length).toBeGreaterThan(0);
		expect(result.forbiddenMutations[0]).toContain("git commit");
	});

	it("detects forbidden git push in workspace commands", () => {
		const workspaces = [
			ws("A", [], {
				capabilities: { canRun: ["git push origin main"], canEdit: [] },
			}),
		];
		const simulator = new ExecutionSimulator(3);
		const result = simulator.checkForbiddenMutations(queue(workspaces));

		expect(result.forbiddenMutationDetected).toBe(true);
		expect(result.forbiddenMutations[0]).toContain("git push");
	});

	it("detects forbidden git reset --hard in workspace commands", () => {
		const workspaces = [
			ws("A", [], {
				capabilities: { canRun: ["git reset --hard HEAD~1"], canEdit: [] },
			}),
		];
		const simulator = new ExecutionSimulator(3);
		const result = simulator.checkForbiddenMutations(queue(workspaces));

		expect(result.forbiddenMutationDetected).toBe(true);
		expect(result.forbiddenMutations[0]).toContain("git reset --hard");
	});

	it("detects forbidden git add -A in workspace commands", () => {
		const workspaces = [
			ws("A", [], {
				capabilities: { canRun: ["git add -A"], canEdit: [] },
			}),
		];
		const simulator = new ExecutionSimulator(3);
		const result = simulator.checkForbiddenMutations(queue(workspaces));

		expect(result.forbiddenMutationDetected).toBe(true);
		expect(result.forbiddenMutations[0]).toContain("git add");
	});

	it("detects forbidden bash commands in workspace capabilities", () => {
		const workspaces = [
			ws("A", [], {
				capabilities: { canRun: ["git commit -m 'test'"], canEdit: [] },
			}),
		];
		const simulator = new ExecutionSimulator(3);
		const result = simulator.checkForbiddenMutations(queue(workspaces));

		expect(result.forbiddenMutationDetected).toBe(true);
		expect(result.forbiddenMutations[0]).toContain("git commit");
	});

	it("passes when no forbidden mutations are present", () => {
		const workspaces = [
			ws("A", [], {
				capabilities: { canRun: ["npm test"], canEdit: ["src/file.ts"] },
			}),
			ws("B", [], {
				capabilities: { canRun: ["npm run build"], canEdit: ["src/other.ts"] },
			}),
		];
		const simulator = new ExecutionSimulator(3);
		const result = simulator.checkForbiddenMutations(queue(workspaces));

		expect(result.forbiddenMutationDetected).toBe(false);
		expect(result.forbiddenMutations).toHaveLength(0);
		expect(result.blocksExecution).toBe(false);
	});

	it("blocks execution when forbidden mutations are detected", () => {
		const workspaces = [
			ws("A", [], {
				capabilities: { canRun: ["git push"], canEdit: [] },
			}),
		];
		const simulator = new ExecutionSimulator(3);
		const result = simulator.checkForbiddenMutations(queue(workspaces));

		expect(result.blocksExecution).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC3: Simulation can compare manual and optimized DAGs
// ---------------------------------------------------------------------------

describe("ExecutionSimulator — AC3: compare manual and optimized DAGs", () => {
	it("compares two DAGs and reports delta", () => {
		// Manual DAG: fully serial (A -> B -> C -> D)
		const manual = queue([ws("A"), ws("B", ["A"]), ws("C", ["B"]), ws("D", ["C"])], 3);

		// Optimized DAG: A and B independent, C depends on A, D depends on B
		const optimized = queue(
			[
				ws("A"),
				ws("B"), // independent of A
				ws("C", ["A"]),
				ws("D", ["B"]),
			],
			3,
		);

		const simulator = new ExecutionSimulator(3);
		const comparison = simulator.compareDAGs(manual, optimized);

		expect(comparison.manualBatches.totalBatches).toBe(4);
		expect(comparison.optimizedBatches.totalBatches).toBe(2); // A,B then C,D
		expect(comparison.parallelismDelta).toBeGreaterThan(0); // Optimized has more parallelism
		expect(comparison.criticalPathDelta).toBeLessThan(0); // Optimized has shorter critical path
		expect(comparison.improved).toBe(true);
	});

	it("reports no improvement when DAGs are identical", () => {
		const dag = queue([ws("A"), ws("B", ["A"])], 3);

		const simulator = new ExecutionSimulator(3);
		const comparison = simulator.compareDAGs(dag, dag);

		expect(comparison.parallelismDelta).toBe(0);
		expect(comparison.criticalPathDelta).toBe(0);
		expect(comparison.improved).toBe(false);
	});

	it("reports when optimization reduces parallelism", () => {
		// Manual DAG: A, B independent (parallelism 2)
		const manual = queue([ws("A"), ws("B")], 3);

		// Optimized DAG: A -> B serialized (parallelism 1)
		const optimized = queue([ws("A"), ws("B", ["A"])], 3);

		const simulator = new ExecutionSimulator(3);
		const comparison = simulator.compareDAGs(manual, optimized);

		expect(comparison.parallelismDelta).toBeLessThan(0);
		expect(comparison.criticalPathDelta).toBeGreaterThan(0);
		expect(comparison.improved).toBe(false);
	});

	it("supports simulateWithComparison for combined forecast + comparison", () => {
		const manual = queue([ws("A"), ws("B", ["A"])], 3);
		const optimized = queue([ws("A"), ws("B")], 3);

		const simulator = new ExecutionSimulator(3);
		const forecast = simulator.simulateWithComparison(manual, optimized);

		expect(forecast.dagComparison).toBeDefined();
		expect(forecast.dagComparison!.improved).toBe(true);
		expect(forecast.batchPlan).toBeDefined();
	});

	it("simulateWithComparison works without optimized DAG", () => {
		const queueData = queue([ws("A"), ws("B")], 3);

		const simulator = new ExecutionSimulator(3);
		const forecast = simulator.simulateWithComparison(queueData);

		expect(forecast.dagComparison).toBeUndefined();
		expect(forecast.batchPlan).toBeDefined();
	});

	it("custom labels for DAG comparison", () => {
		const manual = queue([ws("A"), ws("B", ["A"])], 3);
		const optimized = queue([ws("A"), ws("B")], 3);

		const simulator = new ExecutionSimulator(3);
		const comparison = simulator.compareDAGs(manual, optimized, "Original", "V2");

		expect(comparison.manualLabel).toBe("Original");
		expect(comparison.optimizedLabel).toBe("V2");
	});
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe("formatSimulationForecast", () => {
	it("produces a non-empty string for a valid forecast", () => {
		const simulator = new ExecutionSimulator(3);
		const forecast = simulator.simulate(queue([ws("A"), ws("B"), ws("C")]));
		const formatted = formatSimulationForecast(forecast);

		expect(formatted).toBeTruthy();
		expect(formatted).toContain("Execution Simulation Forecast");
		expect(formatted).toContain("DAG Batch Plan");
	});

	it("includes DAG comparison when present", () => {
		const manual = queue([ws("A"), ws("B", ["A"])], 3);
		const optimized = queue([ws("A"), ws("B")], 3);

		const simulator = new ExecutionSimulator(3);
		const forecast = simulator.simulateWithComparison(manual, optimized);
		const formatted = formatSimulationForecast(forecast);

		expect(formatted).toContain("DAG Comparison");
	});
});

describe("formatMutationGuardResult", () => {
	it("reports OK when no forbidden mutations", () => {
		const result = formatMutationGuardResult({
			forbiddenMutationDetected: false,
			forbiddenMutations: [],
			blocksExecution: false,
		});
		expect(result).toContain("OK");
		expect(result).not.toContain("BLOCKED");
	});

	it("reports BLOCKED with mutations listed", () => {
		const result = formatMutationGuardResult({
			forbiddenMutationDetected: true,
			forbiddenMutations: ["git commit detected"],
			blocksExecution: true,
		});
		expect(result).toContain("BLOCKED");
		expect(result).toContain("git commit detected");
	});
});

describe("formatDAGComparison", () => {
	it("produces a readable comparison string", () => {
		const manual = queue([ws("A"), ws("B", ["A"])], 3);
		const optimized = queue([ws("A"), ws("B")], 3);

		const simulator = new ExecutionSimulator(3);
		const comparison = simulator.compareDAGs(manual, optimized);
		const formatted = formatDAGComparison(comparison);

		expect(formatted).toContain("DAG Comparison");
		expect(formatted).toContain("Manual");
		expect(formatted).toContain("Optimized");
	});
});
