/**
 * Validate Alpha2 Semantics
 *
 * Checks:
 * - Duplicate wave IDs
 * - Duplicate workspace IDs
 * - Wave workspaceId references must resolve to real workspaces
 * - Wave dependencies must resolve to real wave IDs
 * - Workspace dependencies must resolve to real workspace IDs
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

	// Check wave IDs and collect them
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
	});

	// Check workspace IDs and collect them
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

	// Check wave workspaceId references resolve
	spec.waves.forEach((wave, i) => {
		if (wave.workspaceIds) {
			wave.workspaceIds.forEach((wsId, j) => {
				if (!workspaceIds.has(wsId)) {
					diagnostics.push(
						diag({
							code: PlanDiagnosticCode.E_REF_UNKNOWN_WORKSPACE_TASK,
							phase: "semantic_validation",
							path: `$.waves[${i}].workspaceIds[${j}]`,
							message: `Unknown workspace reference: "${wsId}" from wave "${wave.id}"`,
						}),
					);
				}
			});
		}
	});

	// Check wave dependencies resolve
	spec.waves.forEach((wave, i) => {
		if (wave.dependencies) {
			wave.dependencies.forEach((depId, j) => {
				if (!waveIds.has(depId)) {
					diagnostics.push(
						diag({
							code: PlanDiagnosticCode.E_REF_UNKNOWN_WAVE,
							phase: "semantic_validation",
							path: `$.waves[${i}].dependencies[${j}]`,
							message: `Unknown wave dependency: "${depId}" referenced by wave "${wave.id}"`,
						}),
					);
				}
			});
		}
	});

	// Check workspace dependencies resolve
	spec.workspaces.forEach((ws, i) => {
		if (ws.dependencies) {
			ws.dependencies.forEach((depId, j) => {
				if (!workspaceIds.has(depId)) {
					diagnostics.push(
						diag({
							code: PlanDiagnosticCode.E_REF_UNKNOWN_WORKSPACE_TASK,
							phase: "semantic_validation",
							path: `$.workspaces[${i}].dependencies[${j}]`,
							message: `Unknown workspace dependency: "${depId}" referenced by workspace "${ws.id}"`,
						}),
					);
				}
			});
		}
	});

	return diagnostics;
}
