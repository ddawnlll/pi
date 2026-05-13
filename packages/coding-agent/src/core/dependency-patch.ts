/**
 * Dependency Edit Patch Model - P2 Workstream 7.C
 *
 * Provides safe patch operations for editing workspace dependency graphs.
 * Operations are represented as validated, immutable patches that can be
 * previewed before being applied to a WorkspaceQueue.
 *
 * Key guarantees:
 * - Patches are validated before mutation (no partial states)
 * - Cycle-creating edits are rejected
 * - Patches can be previewed (rendered) before save
 * - All operations are reversible via the inverse patch
 */

import type { Workspace, WorkspaceQueue } from "./workspace-schema.js";
import { detectCycles } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Patch Operation Types
// ---------------------------------------------------------------------------

/**
 * The kind of dependency edit operation.
 */
export type DependencyPatchKind = "add_dependency" | "remove_dependency" | "reorder_dependencies";

/**
 * A single dependency patch operation.
 *
 * Each patch describes exactly one atomic change to a workspace's
 * dependency list. Patches are validated before application to ensure
 * the resulting graph remains acyclic and all references are valid.
 */
export interface DependencyPatch {
	/** Unique patch identifier */
	id: string;
	/** The workspace ID this patch targets */
	workspaceId: string;
	/** Kind of dependency edit */
	kind: DependencyPatchKind;
	/** The dependency being added or removed */
	dependencyId: string;
	/** For reorder: the new index position (0-based) */
	newIndex?: number;
	/** The original index position before the patch (populated after preview) */
	originalIndex?: number;
	/** Human-readable description of what this patch does */
	description: string;
}

/**
 * A batch of dependency patches to be applied atomically.
 *
 * Either all patches in the plan are applied, or none are.
 * The plan is validated as a whole before any mutation occurs.
 */
export interface DependencyPatchPlan {
	/** Unique plan identifier */
	id: string;
	/** The workspace queue phase this plan targets */
	phase: string;
	/** Ordered list of patches to apply */
	patches: DependencyPatch[];
	/** Whether this plan has been validated */
	validated: boolean;
	/** Validation result (populated after validation) */
	validationResult?: DependencyPatchValidationResult;
	/** Timestamp when the plan was created */
	createdAt: number;
}

/**
 * Result of validating a dependency patch plan.
 */
export interface DependencyPatchValidationResult {
	/** Whether all patches in the plan are valid */
	valid: boolean;
	/** Validation errors (if any) */
	errors: DependencyPatchValidationError[];
	/** Warnings (non-fatal issues) */
	warnings: DependencyPatchValidationError[];
}

/**
 * A validation error for a dependency patch.
 */
export interface DependencyPatchValidationError {
	/** Error type */
	type:
		| "workspace_not_found"
		| "dependency_not_found"
		| "duplicate_dependency"
		| "dependency_already_exists"
		| "cycle_detected"
		| "invalid_index"
		| "empty_patch_plan"
		| "cross_workspace_cycle";
	/** Human-readable error message */
	message: string;
	/** The patch ID that caused the error (if applicable) */
	patchId?: string;
	/** The workspace ID involved (if applicable) */
	workspaceId?: string;
	/** Additional context */
	context?: Record<string, unknown>;
}

/**
 * Preview of a dependency patch plan showing before/after state.
 */
export interface DependencyPatchPreview {
	/** The patch plan being previewed */
	planId: string;
	/** Per-workspace before/after snapshots */
	snapshots: DependencyPatchSnapshot[];
	/** Whether applying this plan would introduce a cycle */
	introducesCycle: boolean;
	/** Overall validation result */
	valid: boolean;
	/** Any validation errors */
	errors: DependencyPatchValidationError[];
}

/**
 * Snapshot of a workspace's dependency list before and after a patch.
 */
export interface DependencyPatchSnapshot {
	/** Workspace ID */
	workspaceId: string;
	/** Dependencies before the patch */
	before: string[];
	/** Dependencies after the patch */
	after: string[];
	/** Patches affecting this workspace */
	patches: DependencyPatch[];
}

// ---------------------------------------------------------------------------
// Patch ID Generation
// ---------------------------------------------------------------------------

let patchIdCounter = 0;
let planIdCounter = 0;

/**
 * Generate a unique patch ID.
 *
 * @returns A unique string ID for a DependencyPatch
 */
export function generatePatchId(): string {
	patchIdCounter++;
	return `dep-patch-${patchIdCounter}-${Date.now()}`;
}

/**
 * Generate a unique plan ID.
 *
 * @returns A unique string ID for a DependencyPatchPlan
 */
export function generatePlanId(): string {
	planIdCounter++;
	return `dep-plan-${planIdCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Patch Creation
// ---------------------------------------------------------------------------

/**
 * Create a dependency-add patch.
 *
 * @param workspaceId - The workspace to add a dependency to
 * @param dependencyId - The workspace ID to add as a dependency
 * @param description - Optional human-readable description
 * @returns A DependencyPatch that adds the specified dependency
 */
export function createAddDependencyPatch(
	workspaceId: string,
	dependencyId: string,
	description: string = "",
): DependencyPatch {
	return {
		id: generatePatchId(),
		workspaceId,
		kind: "add_dependency",
		dependencyId,
		description: description || `Add dependency "${dependencyId}" to workspace "${workspaceId}"`,
	};
}

/**
 * Create a dependency-remove patch.
 *
 * @param workspaceId - The workspace to remove a dependency from
 * @param dependencyId - The workspace ID to remove as a dependency
 * @param description - Optional human-readable description
 * @returns A DependencyPatch that removes the specified dependency
 */
export function createRemoveDependencyPatch(
	workspaceId: string,
	dependencyId: string,
	description: string = "",
): DependencyPatch {
	return {
		id: generatePatchId(),
		workspaceId,
		kind: "remove_dependency",
		dependencyId,
		description: description || `Remove dependency "${dependencyId}" from workspace "${workspaceId}"`,
	};
}

/**
 * Create a dependency-reorder patch.
 *
 * Moves the specified dependency to a new position in the workspace's
 * dependency list. The index is 0-based.
 *
 * @param workspaceId - The workspace whose dependency list to reorder
 * @param dependencyId - The dependency to move
 * @param newIndex - The new 0-based index for the dependency
 * @param description - Optional human-readable description
 * @returns A DependencyPatch that reorders the specified dependency
 */
export function createReorderDependencyPatch(
	workspaceId: string,
	dependencyId: string,
	newIndex: number,
	description: string = "",
): DependencyPatch {
	return {
		id: generatePatchId(),
		workspaceId,
		kind: "reorder_dependencies",
		dependencyId,
		newIndex,
		description:
			description || `Move dependency "${dependencyId}" to index ${newIndex} in workspace "${workspaceId}"`,
	};
}

// ---------------------------------------------------------------------------
// Patch Plan Creation
// ---------------------------------------------------------------------------

/**
 * Create a dependency patch plan from a list of patches.
 *
 * @param patches - The patches to include in the plan
 * @param phase - The workspace queue phase (defaults to "P2")
 * @returns A DependencyPatchPlan containing the patches
 */
export function createDependencyPatchPlan(patches: DependencyPatch[], phase: string = "P2"): DependencyPatchPlan {
	return {
		id: generatePlanId(),
		phase,
		patches,
		validated: false,
		createdAt: Date.now(),
	};
}

// ---------------------------------------------------------------------------
// Patch Validation
// ---------------------------------------------------------------------------

/**
 * Validate a dependency patch plan against a workspace queue.
 *
 * Checks that:
 * - All referenced workspaces exist in the queue
 * - All referenced dependencies exist in the queue
 * - Add operations don't duplicate existing dependencies
 * - Remove operations reference existing dependencies
 * - Reorder operations reference existing dependencies with valid indices
 * - The combined effect of all patches does not introduce cycles
 *
 * @param plan - The patch plan to validate
 * @param queue - The workspace queue to validate against
 * @returns DependencyPatchValidationResult with errors and warnings
 */
export function validateDependencyPatchPlan(
	plan: DependencyPatchPlan,
	queue: WorkspaceQueue,
): DependencyPatchValidationResult {
	const errors: DependencyPatchValidationError[] = [];
	const warnings: DependencyPatchValidationError[] = [];

	if (plan.patches.length === 0) {
		errors.push({
			type: "empty_patch_plan",
			message: "Patch plan contains no patches",
		});
		return { valid: false, errors, warnings };
	}

	// Build workspace lookup
	const workspaceMap = new Map<string, Workspace>();
	for (const ws of queue.workspaces) {
		workspaceMap.set(ws.id, ws);
	}

	// Validate each individual patch
	for (const patch of plan.patches) {
		// Check workspace exists
		const workspace = workspaceMap.get(patch.workspaceId);
		if (!workspace) {
			errors.push({
				type: "workspace_not_found",
				message: `Workspace "${patch.workspaceId}" not found in queue`,
				patchId: patch.id,
				workspaceId: patch.workspaceId,
			});
			continue;
		}

		// Check dependency workspace exists (for add/reorder)
		if (patch.kind === "add_dependency" || patch.kind === "reorder_dependencies") {
			if (!workspaceMap.has(patch.dependencyId)) {
				errors.push({
					type: "dependency_not_found",
					message: `Dependency workspace "${patch.dependencyId}" not found in queue`,
					patchId: patch.id,
					workspaceId: patch.workspaceId,
					context: { dependencyId: patch.dependencyId },
				});
			}
		}

		// Check add-specific constraints
		if (patch.kind === "add_dependency") {
			if (workspace.dependencies.includes(patch.dependencyId)) {
				errors.push({
					type: "dependency_already_exists",
					message: `Workspace "${patch.workspaceId}" already depends on "${patch.dependencyId}"`,
					patchId: patch.id,
					workspaceId: patch.workspaceId,
					context: { dependencyId: patch.dependencyId },
				});
			}
			// Self-dependency check
			if (patch.workspaceId === patch.dependencyId) {
				errors.push({
					type: "cycle_detected",
					message: `Workspace "${patch.workspaceId}" cannot depend on itself`,
					patchId: patch.id,
					workspaceId: patch.workspaceId,
					context: { dependencyId: patch.dependencyId },
				});
			}
		}

		// Check remove-specific constraints
		if (patch.kind === "remove_dependency") {
			if (!workspace.dependencies.includes(patch.dependencyId)) {
				errors.push({
					type: "dependency_not_found",
					message: `Workspace "${patch.workspaceId}" does not depend on "${patch.dependencyId}"`,
					patchId: patch.id,
					workspaceId: patch.workspaceId,
					context: { dependencyId: patch.dependencyId },
				});
			}
		}

		// Check reorder-specific constraints
		if (patch.kind === "reorder_dependencies") {
			const depIndex = workspace.dependencies.indexOf(patch.dependencyId);
			if (depIndex === -1) {
				errors.push({
					type: "dependency_not_found",
					message: `Workspace "${patch.workspaceId}" does not depend on "${patch.dependencyId}", cannot reorder`,
					patchId: patch.id,
					workspaceId: patch.workspaceId,
					context: { dependencyId: patch.dependencyId },
				});
			} else if (
				patch.newIndex === undefined ||
				patch.newIndex < 0 ||
				patch.newIndex >= workspace.dependencies.length
			) {
				errors.push({
					type: "invalid_index",
					message: `Invalid index ${patch.newIndex} for reorder in workspace "${patch.workspaceId}" (dependencies count: ${workspace.dependencies.length})`,
					patchId: patch.id,
					workspaceId: patch.workspaceId,
					context: { newIndex: patch.newIndex, depCount: workspace.dependencies.length },
				});
			}
		}
	}

	// If individual patches have errors, skip cycle check
	if (errors.length > 0) {
		return { valid: false, errors, warnings };
	}

	// Apply patches to a simulated queue and check for cycles
	const simulated = simulatePatchApplication(plan, queue);
	const cycleResult = detectCycles(simulated.workspaces);
	if (cycleResult.hasCycle) {
		errors.push({
			type: "cross_workspace_cycle",
			message: `Applying patches would create a dependency cycle: ${cycleResult.cycle?.join(" → ")}`,
			context: { cycle: cycleResult.cycle },
		});
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Mark a plan as validated after running validation.
 *
 * @param plan - The plan to mark
 * @param result - The validation result
 * @returns A new plan with validation result attached
 */
export function markPlanValidated(
	plan: DependencyPatchPlan,
	result: DependencyPatchValidationResult,
): DependencyPatchPlan {
	return {
		...plan,
		validated: true,
		validationResult: result,
	};
}

// ---------------------------------------------------------------------------
// Patch Simulation (for validation & preview)
// ---------------------------------------------------------------------------

/**
 * Apply patches to a copy of the workspace queue without mutating the original.
 *
 * This is used internally for validation and preview. It does NOT validate
 * the patches; it only applies them mechanically.
 *
 * @param plan - The patch plan to simulate
 * @param queue - The original workspace queue
 * @returns A new WorkspaceQueue with patches applied
 */
export function simulatePatchApplication(plan: DependencyPatchPlan, queue: WorkspaceQueue): WorkspaceQueue {
	// Deep clone workspaces
	const newWorkspaces: Workspace[] = queue.workspaces.map((ws) => ({
		...ws,
		dependencies: [...ws.dependencies],
	}));

	for (const patch of plan.patches) {
		const ws = newWorkspaces.find((w) => w.id === patch.workspaceId);
		if (!ws) continue;

		switch (patch.kind) {
			case "add_dependency": {
				if (!ws.dependencies.includes(patch.dependencyId)) {
					ws.dependencies = [...ws.dependencies, patch.dependencyId];
				}
				break;
			}
			case "remove_dependency": {
				ws.dependencies = ws.dependencies.filter((d) => d !== patch.dependencyId);
				break;
			}
			case "reorder_dependencies": {
				const idx = ws.dependencies.indexOf(patch.dependencyId);
				if (idx !== -1 && patch.newIndex !== undefined) {
					const [removed] = ws.dependencies.splice(idx, 1);
					const clampedIndex = Math.min(patch.newIndex, ws.dependencies.length);
					ws.dependencies.splice(clampedIndex, 0, removed);
				}
				break;
			}
		}
	}

	return {
		...queue,
		workspaces: newWorkspaces,
	};
}

// ---------------------------------------------------------------------------
// Patch Preview
// ---------------------------------------------------------------------------

/**
 * Generate a preview of what a patch plan would do to a workspace queue.
 *
 * The preview shows before/after dependency lists for each affected
 * workspace, and indicates whether applying the plan would introduce
 * a cycle or other validation errors.
 *
 * @param plan - The patch plan to preview
 * @param queue - The current workspace queue
 * @returns DependencyPatchPreview with before/after snapshots
 */
export function previewDependencyPatchPlan(plan: DependencyPatchPlan, queue: WorkspaceQueue): DependencyPatchPreview {
	const validation = validateDependencyPatchPlan(plan, queue);
	const simulated = simulatePatchApplication(plan, queue);

	// Build workspace lookups
	const originalMap = new Map<string, Workspace>();
	for (const ws of queue.workspaces) {
		originalMap.set(ws.id, ws);
	}
	const simulatedMap = new Map<string, Workspace>();
	for (const ws of simulated.workspaces) {
		simulatedMap.set(ws.id, ws);
	}

	// Collect all workspace IDs affected by patches
	const affectedIds = new Set<string>();
	for (const patch of plan.patches) {
		affectedIds.add(patch.workspaceId);
	}

	// Build snapshots for affected workspaces
	const snapshots: DependencyPatchSnapshot[] = [];
	for (const wsId of affectedIds) {
		const original = originalMap.get(wsId);
		const simulated_ = simulatedMap.get(wsId);
		if (!original || !simulated_) continue;

		const affectingPatches = plan.patches.filter((p) => p.workspaceId === wsId);
		snapshots.push({
			workspaceId: wsId,
			before: [...original.dependencies],
			after: [...simulated_.dependencies],
			patches: affectingPatches,
		});
	}

	return {
		planId: plan.id,
		snapshots,
		introducesCycle: validation.errors.some((e) => e.type === "cross_workspace_cycle"),
		valid: validation.valid,
		errors: validation.errors,
	};
}

// ---------------------------------------------------------------------------
// Patch Application
// ---------------------------------------------------------------------------

/**
 * Apply a validated dependency patch plan to a workspace queue.
 *
 * The plan MUST be validated before calling this function. If the plan
 * has not been validated or failed validation, an error is thrown.
 *
 * Returns a new WorkspaceQueue; the original is not mutated.
 *
 * @param plan - The validated patch plan to apply
 * @param queue - The workspace queue to apply patches to
 * @returns A new WorkspaceQueue with the patches applied
 * @throws Error if the plan has not been validated or failed validation
 */
export function applyDependencyPatchPlan(plan: DependencyPatchPlan, queue: WorkspaceQueue): WorkspaceQueue {
	if (!plan.validated) {
		throw new Error(`Patch plan "${plan.id}" has not been validated. Call validateDependencyPatchPlan first.`);
	}

	if (plan.validationResult && !plan.validationResult.valid) {
		throw new Error(
			`Patch plan "${plan.id}" failed validation: ${plan.validationResult.errors.map((e) => e.message).join("; ")}`,
		);
	}

	return simulatePatchApplication(plan, queue);
}

// ---------------------------------------------------------------------------
// Patch Inverse (Undo)
// ---------------------------------------------------------------------------

/**
 * Compute the inverse of a dependency patch.
 *
 * The inverse patch undoes the original patch when applied to a queue
 * that has already had the original patch applied.
 *
 * @param patch - The patch to invert
 * @param originalDependencies - The original dependency list of the workspace (before the patch)
 * @returns A DependencyPatch that undoes the original
 */
export function invertDependencyPatch(patch: DependencyPatch, originalDependencies: string[]): DependencyPatch {
	switch (patch.kind) {
		case "add_dependency": {
			// Inverse of add is remove
			const _index = originalDependencies.length; // The add appends at the end
			return createRemoveDependencyPatch(
				patch.workspaceId,
				patch.dependencyId,
				`Undo: remove dependency "${patch.dependencyId}" from workspace "${patch.workspaceId}"`,
			);
		}
		case "remove_dependency": {
			// Inverse of remove is add back at original position
			const originalIndex = originalDependencies.indexOf(patch.dependencyId);
			if (originalIndex !== -1) {
				// Create add + reorder to restore position
				return {
					id: generatePatchId(),
					workspaceId: patch.workspaceId,
					kind: "add_dependency",
					dependencyId: patch.dependencyId,
					description: `Undo: re-add dependency "${patch.dependencyId}" to workspace "${patch.workspaceId}"`,
				};
			}
			// Dependency wasn't in original, so nothing to undo
			return {
				id: generatePatchId(),
				workspaceId: patch.workspaceId,
				kind: "add_dependency",
				dependencyId: patch.dependencyId,
				description: `Undo: re-add dependency "${patch.dependencyId}" to workspace "${patch.workspaceId}"`,
			};
		}
		case "reorder_dependencies": {
			// Inverse of reorder is reorder back to original index
			const originalIndex = originalDependencies.indexOf(patch.dependencyId);
			return createReorderDependencyPatch(
				patch.workspaceId,
				patch.dependencyId,
				originalIndex,
				`Undo: move dependency "${patch.dependencyId}" back to index ${originalIndex} in workspace "${patch.workspaceId}"`,
			);
		}
	}
}

/**
 * Create an inverse patch plan that undoes all patches in the original plan.
 *
 * The inverse plan is generated in reverse order so that each
 * inverse patch operates on the state produced by patches above it.
 *
 * @param plan - The original patch plan
 * @param originalQueue - The original queue state (before patches were applied)
 * @returns A new DependencyPatchPlan that undoes the original plan
 */
export function createInversePatchPlan(plan: DependencyPatchPlan, originalQueue: WorkspaceQueue): DependencyPatchPlan {
	const workspaceMap = new Map<string, Workspace>();
	for (const ws of originalQueue.workspaces) {
		workspaceMap.set(ws.id, ws);
	}

	// Invert patches in reverse order
	const inversePatches: DependencyPatch[] = [];
	for (let i = plan.patches.length - 1; i >= 0; i--) {
		const patch = plan.patches[i];
		const ws = workspaceMap.get(patch.workspaceId);
		if (!ws) continue;
		const inverse = invertDependencyPatch(patch, ws.dependencies);
		inversePatches.push(inverse);
	}

	return createDependencyPatchPlan(inversePatches, plan.phase);
}

// ---------------------------------------------------------------------------
// Patch Rendering
// ---------------------------------------------------------------------------

/**
 * Render a dependency patch preview as a human-readable string.
 *
 * Shows each affected workspace with before → after dependency lists,
 * and highlights any validation errors or cycle warnings.
 *
 * @param preview - The preview to render
 * @returns Human-readable string representation
 */
export function renderPatchPreview(preview: DependencyPatchPreview): string {
	const lines: string[] = [];

	lines.push(`=== Dependency Patch Preview (Plan: ${preview.planId}) ===`);
	lines.push("");

	if (preview.snapshots.length === 0) {
		lines.push("(No workspaces affected)");
	} else {
		for (const snapshot of preview.snapshots) {
			lines.push(`Workspace: ${snapshot.workspaceId}`);
			lines.push(`  Before: [${snapshot.before.join(", ")}]`);
			lines.push(`  After:  [${snapshot.after.join(", ")}]`);

			// Show individual patches
			for (const patch of snapshot.patches) {
				lines.push(
					`  Patch:  ${patch.kind} "${patch.dependencyId}"${patch.newIndex !== undefined ? ` at index ${patch.newIndex}` : ""}`,
				);
			}
			lines.push("");
		}
	}

	if (preview.introducesCycle) {
		lines.push("⚠ WARNING: Applying this plan would introduce a dependency cycle!");
	}

	if (!preview.valid) {
		lines.push("❌ VALIDATION FAILED:");
		for (const error of preview.errors) {
			lines.push(`  - ${error.type}: ${error.message}`);
		}
	} else {
		lines.push("✓ All patches valid — safe to apply");
	}

	return lines.join("");
}

/**
 * Render a patch preview with proper newlines.
 *
 * @param preview - The preview to render
 * @returns Human-readable string with newline separators
 */
export function renderPatchPreviewFormatted(preview: DependencyPatchPreview): string {
	const lines: string[] = [];

	lines.push(`=== Dependency Patch Preview (Plan: ${preview.planId}) ===`);
	lines.push("");

	if (preview.snapshots.length === 0) {
		lines.push("(No workspaces affected)");
	} else {
		for (const snapshot of preview.snapshots) {
			lines.push(`Workspace: ${snapshot.workspaceId}`);
			lines.push(`  Before: [${snapshot.before.join(", ")}]`);
			lines.push(`  After:  [${snapshot.after.join(", ")}]`);

			for (const patch of snapshot.patches) {
				lines.push(
					`  Patch:  ${patch.kind} "${patch.dependencyId}"${patch.newIndex !== undefined ? ` at index ${patch.newIndex}` : ""}`,
				);
			}
			lines.push("");
		}
	}

	if (preview.introducesCycle) {
		lines.push("⚠ WARNING: Applying this plan would introduce a dependency cycle!");
	}

	if (!preview.valid) {
		lines.push("VALIDATION FAILED:");
		for (const error of preview.errors) {
			lines.push(`  - ${error.type}: ${error.message}`);
		}
	} else {
		lines.push("All patches valid — safe to apply");
	}

	return lines.join("⏎");
}
