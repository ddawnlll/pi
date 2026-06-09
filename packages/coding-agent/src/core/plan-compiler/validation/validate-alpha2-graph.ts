/**
 * Validate Alpha2 Graph — Cycle Detection
 *
 * Detects cycles in:
 * - Wave dependency graph
 * - Workspace dependency graph (workspaces do not have dependencies field in Alpha2;
 *   this checks workspace dependencies from task workspaceId relationships — not needed now)
 * - Task dependency graph
 *
 * Each cycle diagnostic includes the cycle path.
 */

import type { PlanSpecV5Alpha2 } from "../alpha2/alpha2-types.js";
import { diag, type PlanDiagnostic } from "../diagnostics/diagnostic.js";
import { PlanDiagnosticCode } from "../diagnostics/diagnostic-codes.js";

// =============================================================================
// Main entry
// =============================================================================

export function validateAlpha2Graph(spec: PlanSpecV5Alpha2): PlanDiagnostic[] {
	const diagnostics: PlanDiagnostic[] = [];

	// Wave graph cycles
	const waveCycles = detectCycles(
		spec.waves.map((w) => w.id),
		spec.waves.map((w) => w.dependencies ?? []),
	);
	for (const cycle of waveCycles) {
		diagnostics.push(
			diag({
				code: PlanDiagnosticCode.E_CYCLE_WAVE,
				phase: "graph_validation",
				message: `Wave dependency cycle detected: ${cycle.join(" -> ")}`,
			}),
		);
	}

	// Task graph cycles (all tasks across all waves)
	const allTasks = spec.waves.flatMap((w) => w.tasks);
	const taskCycles = detectCycles(
		allTasks.map((t) => t.id),
		allTasks.map((t) => t.dependencies ?? []),
	);
	for (const cycle of taskCycles) {
		diagnostics.push(
			diag({
				code: PlanDiagnosticCode.E_CYCLE_TASK,
				phase: "graph_validation",
				message: `Task dependency cycle detected: ${cycle.join(" -> ")}`,
			}),
		);
	}

	// Workspace cycles (workspaces don't have direct dependencies in Alpha2,
	// but we check if there are any task-induced cycles we need to flag)
	// This is a placeholder; actual workspace cycles would require workspace-level deps

	return diagnostics;
}

// =============================================================================
// Cycle detection (DFS)
// =============================================================================

function detectCycles(ids: string[], edgesList: string[][]): string[][] {
	const adj = new Map<string, string[]>();
	const idxMap = new Map<string, number>();

	for (let i = 0; i < ids.length; i++) {
		adj.set(
			ids[i],
			edgesList[i].filter((dep) => ids.includes(dep)),
		);
		idxMap.set(ids[i], i);
	}

	const WHITE = 0;
	const GRAY = 1;
	const BLACK = 2;
	const color = new Map<string, number>();
	const cycles: string[][] = [];

	for (const id of ids) {
		color.set(id, WHITE);
	}

	function dfs(u: string, path: string[]): string[] | null {
		color.set(u, GRAY);
		path.push(u);

		const neighbors = adj.get(u) ?? [];
		for (const v of neighbors) {
			const col = color.get(v);
			if (col === GRAY) {
				// Found a cycle — extract cycle path
				const cycleStart = path.indexOf(v);
				return path.slice(cycleStart);
			}
			if (col === WHITE) {
				const result = dfs(v, path);
				if (result) return result;
			}
		}

		color.set(u, BLACK);
		path.pop();
		return null;
	}

	for (const id of ids) {
		if (color.get(id) === WHITE) {
			const cycle = dfs(id, []);
			if (cycle) {
				cycles.push(cycle);
			}
		}
	}

	return cycles;
}
