/**
 * Worker Packet Derivation — ACCP 1.2 / PlanSpec v5
 *
 * Derives a scoped worker execution packet from a PlanLock.
 * The worker packet contains only the data a specific workspace
 * worker needs — not the full plan.
 *
 * Includes lock hashes so the worker report can echo them back
 * for integrity verification.
 */

import { computeWorkspaceLockHash } from "./planlock-hash.js";
import type { PlanLock, WorkerPacketV5, WorkspaceLock } from "./planlock-types.js";

// =============================================================================
// Derivation
// =============================================================================

/**
 * Input required to derive a worker packet.
 */
export interface WorkerPacketDerivationInput {
	/** The active PlanLock */
	readonly planLock: PlanLock;
	/** The repo base SHA at lock time */
	readonly repoBaseSha: string;
	/** Workspace ID to derive packet for */
	readonly workspaceId: string;
	/** Workspace title */
	readonly workspaceTitle: string;
	/** Workspace description */
	readonly description?: string;
	/** Workspace instructions/prompt text */
	readonly instructions?: string;
	/** Command scope (ref -> exact command) */
	readonly commandScope: Record<string, string>;
	/** Required report paths for this workspace */
	readonly requiredReports: string[];
}

/**
 * Derive a worker packet from a PlanLock for a specific workspace.
 *
 * @param input - Derivation input
 * @returns The derived WorkerPacketV5
 * @throws If workspace is not found in the lock
 */
export function deriveWorkerPacket(input: WorkerPacketDerivationInput): WorkerPacketV5 {
	const { planLock, workspaceId, repoBaseSha } = input;

	// Find the workspace lock
	const workspaceLock = planLock.normalized.workspaces[workspaceId];
	if (!workspaceLock) {
		throw new Error(
			`Cannot derive worker packet: workspace "${workspaceId}" not found in PlanLock. ` +
				`Available workspaces: ${Object.keys(planLock.normalized.workspaces).join(", ")}`,
		);
	}

	return {
		accpVersion: planLock.accpVersion,
		planLockHash: planLock.planLockHash,
		workspaceLockHash: workspaceLock.workspaceLockHash,
		repoBaseSha,
		workspaceId: input.workspaceId,
		workspaceTitle: input.workspaceTitle,
		description: input.description,
		allowedFiles: workspaceLock.allowedFiles,
		forbiddenFiles: workspaceLock.forbiddenFiles,
		acceptanceCriteria: workspaceLock.acceptanceCriteria,
		validationRefs: workspaceLock.validationRefs,
		finalValidationRefs: workspaceLock.finalValidationRefs,
		commandScope: input.commandScope,
		requiredReports: input.requiredReports,
		completionEchoRequired: true,
		dependencies: workspaceLock.dependencies,
	};
}

/**
 * Recompute a workspace lock hash for verification purposes.
 */
export function recomputeWorkspaceLockHash(workspaceLock: WorkspaceLock): string {
	return computeWorkspaceLockHash(
		workspaceLock.workspaceId,
		[...workspaceLock.allowedFiles],
		[...workspaceLock.forbiddenFiles],
		[...workspaceLock.dependencies],
		[...workspaceLock.acceptanceCriteria],
		[...workspaceLock.validationRefs],
		[...workspaceLock.finalValidationRefs],
	);
}

/**
 * Derive a WorkspaceLock from per-workspace data.
 */
export function deriveWorkspaceLock(
	workspaceId: string,
	allowedFiles: string[],
	forbiddenFiles: string[],
	dependencies: string[],
	acIds: string[],
	validationRefs: string[],
	finalValidationRefs: string[],
): WorkspaceLock {
	const workspaceLockHash = computeWorkspaceLockHash(
		workspaceId,
		allowedFiles,
		forbiddenFiles,
		dependencies,
		acIds,
		validationRefs,
		finalValidationRefs,
	);
	return {
		workspaceId,
		workspaceLockHash,
		allowedFiles,
		forbiddenFiles,
		dependencies,
		acceptanceCriteria: acIds,
		validationRefs,
		finalValidationRefs,
	};
}
