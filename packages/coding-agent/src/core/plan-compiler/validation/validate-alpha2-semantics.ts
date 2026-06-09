/**
 * Validate Alpha2 Semantics
 *
 * Checks:
 * - Duplicate wave IDs
 * - Duplicate workspace IDs
 * - Duplicate task IDs
 * - Wave references must resolve
 * - Workspace references must resolve
 * - Task dependencies must resolve
 * - Task workspaceId must reference an existing workspace
 */

import type { PlanSpecV5Alpha2 } from "../alpha2/alpha2-types.js";
import { diag, type PlanDiagnostic } from "../diagnostics/diagnostic.js";
import { PlanDiagnosticCode } from "../diagnostics/diagnostic-codes.js";

// =============================================================================
// Main entry
// =============================================================================

export function validateAlpha2Semantics(spec: PlanSpecV5Alpha2): PlanDiagnostic[] {
	const diagnostics: PlanDiagnostic[] = [];

	// Collect all IDs
	const waveIds = new Map<string, number>();
	const workspaceIds = new Map<string, number>();
	const taskIds = new Map<string, number>();

	// Check duplicate wave IDs
	spec.waves.forEach((wave, i) => {
		if (waveIds.has(wave.id)) {
			diagnostics.push(
				diag({
					code: PlanDiagnosticCode.E_DUPLICATE_WAVE_ID,
					phase: "semantic_validation",
					path: `$.waves[${i}].id`,
					message: `Duplicate wave ID: "${wave.id}" (first seen at index ${waveIds.get(wave.id)})`,
				}),
			);
		}
		waveIds.set(wave.id, i);

		// Collect tasks from waves
		wave.tasks.forEach((task, j) => {
			if (taskIds.has(task.id)) {
				diagnostics.push(
					diag({
						code: PlanDiagnosticCode.E_DUPLICATE_TASK_ID,
						phase: "semantic_validation",
						path: `$.waves[${i}].tasks[${j}].id`,
						message: `Duplicate task ID: "${task.id}" (first seen earlier)`,
					}),
				);
			}
			taskIds.set(task.id, j);
		});
	});

	// Check duplicate workspace IDs
	spec.workspaces.forEach((ws, i) => {
		if (workspaceIds.has(ws.id)) {
			diagnostics.push(
				diag({
					code: PlanDiagnosticCode.E_DUPLICATE_WORKSPACE_ID,
					phase: "semantic_validation",
					path: `$.workspaces[${i}].id`,
					message: `Duplicate workspace ID: "${ws.id}" (first seen at index ${workspaceIds.get(ws.id)})`,
				}),
			);
		}
		workspaceIds.set(ws.id, i);
	});

	// Check wave dependencies
	for (let i = 0; i < spec.waves.length; i++) {
		const wave = spec.waves[i];
		if (wave.dependencies) {
			for (const depId of wave.dependencies) {
				if (!waveIds.has(depId)) {
					diagnostics.push(
						diag({
							code: PlanDiagnosticCode.E_REF_UNKNOWN_WAVE,
							phase: "semantic_validation",
							path: `$.waves[${i}].dependencies`,
							message: `Unknown wave dependency: "${depId}" referenced by wave "${wave.id}"`,
						}),
					);
				}
			}
		}
	}

	// Check task dependencies and workspace references
	for (let i = 0; i < spec.waves.length; i++) {
		const wave = spec.waves[i];
		for (let j = 0; j < wave.tasks.length; j++) {
			const task = wave.tasks[j];
			const taskPath = `$.waves[${i}].tasks[${j}]`;

			// Task dependencies
			if (task.dependencies) {
				for (const depId of task.dependencies) {
					if (!taskIds.has(depId)) {
						diagnostics.push(
							diag({
								code: PlanDiagnosticCode.E_REF_UNKNOWN_TASK,
								phase: "semantic_validation",
								path: `${taskPath}.dependencies`,
								message: `Unknown task dependency: "${depId}" referenced by task "${task.id}"`,
							}),
						);
					}
				}
			}

			// Task workspace reference
			if (task.workspaceId) {
				if (!workspaceIds.has(task.workspaceId)) {
					diagnostics.push(
						diag({
							code: PlanDiagnosticCode.E_REF_UNKNOWN_WORKSPACE_TASK,
							phase: "semantic_validation",
							path: `${taskPath}.workspaceId`,
							message: `Unknown workspace reference: "${task.workspaceId}" from task "${task.id}"`,
						}),
					);
				}
			}
		}
	}

	return diagnostics;
}
