/**
 * Validate Alpha2 Security Policy
 *
 * Checks:
 * - Delete operations must respect security policy
 * - Workspace editable paths must respect self-modification firewall
 * - File operations on protected paths
 */

import type { PlanSpecV5Alpha2 } from "../alpha2/alpha2-types.js";
import { error, type PlanDiagnostic } from "../diagnostics/diagnostic.js";
import { PlanDiagnosticCode } from "../diagnostics/diagnostic-codes.js";

// =============================================================================
// Main entry
// =============================================================================

export function validateAlpha2Security(spec: PlanSpecV5Alpha2): PlanDiagnostic[] {
	const diagnostics: PlanDiagnostic[] = [];

	const firewall = spec.security.selfModificationFirewall;

	if (!firewall.enabled) return diagnostics;

	const protectedPaths = new Set(firewall.protectedPaths);
	const allowListedFiles = new Set(firewall.allowListedFiles ?? []);

	// Check task file operations against firewall
	for (let i = 0; i < spec.waves.length; i++) {
		const wave = spec.waves[i];
		for (let j = 0; j < wave.tasks.length; j++) {
			const task = wave.tasks[j];
			if (!task.files) continue;

			const taskPath = `$.waves[${i}].tasks[${j}]`;

			for (let k = 0; k < task.files.length; k++) {
				const file = task.files[k];
				const filePath = `${taskPath}.files[${k}]`;

				// Check delete operations
				if (file.operation === "delete") {
					// Deletes on protected paths are always forbidden
					for (const protectedPath of protectedPaths) {
						if (file.path.startsWith(protectedPath) || file.path === protectedPath) {
							diagnostics.push(
								error({
									code: PlanDiagnosticCode.E_DELETE_FORBIDDEN,
									phase: "policy_validation",
									path: filePath,
									message: `Task "${task.id}" attempts to delete protected path: "${file.path}"`,
								}),
							);
						}
					}

					// Deletes only allowed if in allowListedFiles
					if (firewall.requireExplicitApproval && !allowListedFiles.has(file.path)) {
						// Check if path is in any workspace's canEdit
						const ws = spec.workspaces.find((w) => w.id === task.workspaceId);
						if (!ws?.canEdit.includes(file.path)) {
							diagnostics.push(
								error({
									code: PlanDiagnosticCode.E_DELETE_FORBIDDEN,
									phase: "policy_validation",
									path: filePath,
									message: `Task "${task.id}" attempts to delete "${file.path}" without explicit approval`,
								}),
							);
						}
					}
				}

				// Check modify/create on protected paths
				if (file.operation === "modify" || file.operation === "create") {
					for (const protectedPath of protectedPaths) {
						if (file.path.startsWith(protectedPath) || file.path === protectedPath) {
							// Only allow if in allowListedFiles
							if (!allowListedFiles.has(file.path)) {
								diagnostics.push(
									error({
										code: PlanDiagnosticCode.E_FILE_POLICY_VIOLATION,
										phase: "policy_validation",
										path: filePath,
										message: `Task "${task.id}" attempts to modify protected path: "${file.path}"`,
									}),
								);
							}
						}
					}
				}
			}
		}
	}

	return diagnostics;
}
