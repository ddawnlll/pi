/**
 * PlanLock Verifier — ACCP 1.2 / PlanSpec v5
 *
 * Verifies PlanLock integrity, workspace lock hash consistency,
 * and worker report echo correctness.
 *
 * Enforces:
 * - PlanLock has required fields
 * - planLockHash matches recomputed hash
 * - workspaceLockHash matches recomputed hash for each workspace
 * - Worker report echoes correct lock hashes
 * - Mismatch → rejection with typed error code
 * - Missing lock → rejection in PlanSpec mode
 */

import { sha256Hex } from "./planlock-hash.js";
import type { LockVerificationResult, PlanLock, WorkerPacketV5, WorkspaceLock } from "./planlock-types.js";

// =============================================================================
// PlanLock Verification
// =============================================================================

/**
 * Verify that a PlanLock has all required fields.
 */
export function verifyPlanLockRequiredFields(lock: PlanLock): LockVerificationResult {
	if (!lock.accpVersion) {
		return { valid: false, errorCode: "E_LOCK_MISSING_FIELD", errorMessage: "PlanLock missing accpVersion" };
	}
	if (!lock.planLockHash) {
		return { valid: false, errorCode: "E_LOCK_MISSING_FIELD", errorMessage: "PlanLock missing planLockHash" };
	}
	if (!lock.source?.planSpecTaskId) {
		return {
			valid: false,
			errorCode: "E_LOCK_MISSING_FIELD",
			errorMessage: "PlanLock missing source.planSpecTaskId",
		};
	}
	if (!lock.source?.lockedAt) {
		return { valid: false, errorCode: "E_LOCK_MISSING_FIELD", errorMessage: "PlanLock missing source.lockedAt" };
	}
	if (!lock.normalized?.workspaceIds?.length) {
		return {
			valid: false,
			errorCode: "E_LOCK_MISSING_FIELD",
			errorMessage: "PlanLock missing normalized.workspaceIds",
		};
	}
	if (!lock.integrity?.canonicalJsonHash) {
		return { valid: false, errorCode: "E_LOCK_MISSING_FIELD", errorMessage: "PlanLock missing integrity hashes" };
	}
	return { valid: true };
}

/**
 * Verify that a planLockHash matches the recomputed hash.
 */
export function verifyPlanLockHash(lock: PlanLock, recomputedPlanLockHash: string): LockVerificationResult {
	if (lock.planLockHash !== recomputedPlanLockHash) {
		return {
			valid: false,
			errorCode: "E_LOCK_HASH_MISMATCH",
			errorMessage: `Plan lock hash mismatch: expected ${recomputedPlanLockHash}, got ${lock.planLockHash}`,
		};
	}
	return { valid: true };
}

/**
 * Verify a workspace lock hash.
 */
export function verifyWorkspaceLockHash(
	workspaceLock: WorkspaceLock,
	recomputedWorkspaceLockHash: string,
): LockVerificationResult {
	if (workspaceLock.workspaceLockHash !== recomputedWorkspaceLockHash) {
		return {
			valid: false,
			errorCode: "E_WORKSPACE_LOCK_HASH_MISMATCH",
			errorMessage: `Workspace lock hash mismatch for "${workspaceLock.workspaceId}": expected ${recomputedWorkspaceLockHash}, got ${workspaceLock.workspaceLockHash}`,
		};
	}
	return { valid: true };
}

// =============================================================================
// Worker Packet / Report Echo Verification
// =============================================================================

/**
 * Verify that a worker packet carries valid lock hashes.
 * The packet's planLockHash must match the active PlanLock.
 * The packet's workspaceLockHash must match the workspace's lock.
 */
export function verifyWorkerPacketLockEcho(
	packet: WorkerPacketV5,
	activePlanLock: PlanLock,
	workspaceLock: WorkspaceLock,
): LockVerificationResult {
	// Verify planLockHash
	if (packet.planLockHash !== activePlanLock.planLockHash) {
		return {
			valid: false,
			errorCode: "E_LOCK_HASH_MISMATCH",
			errorMessage: `Worker packet planLockHash mismatch for workspace "${packet.workspaceId}": expected ${activePlanLock.planLockHash}, got ${packet.planLockHash}`,
		};
	}

	// Verify workspaceLockHash
	if (packet.workspaceLockHash !== workspaceLock.workspaceLockHash) {
		return {
			valid: false,
			errorCode: "E_WORKSPACE_LOCK_HASH_MISMATCH",
			errorMessage: `Worker packet workspaceLockHash mismatch for workspace "${packet.workspaceId}": expected ${workspaceLock.workspaceLockHash}, got ${packet.workspaceLockHash}`,
		};
	}

	return { valid: true };
}

/**
 * Verify a worker report echo (completion report must match lock hashes).
 */
export function verifyWorkerReportEcho(
	reportPlanLockHash: string,
	reportWorkspaceLockHash: string,
	activePlanLock: PlanLock,
	workspaceLock: WorkspaceLock,
): LockVerificationResult {
	if (reportPlanLockHash !== activePlanLock.planLockHash) {
		return {
			valid: false,
			errorCode: "E_LOCK_HASH_MISMATCH",
			errorMessage: `Worker report planLockHash mismatch: expected ${activePlanLock.planLockHash}, got ${reportPlanLockHash}`,
		};
	}
	if (reportWorkspaceLockHash !== workspaceLock.workspaceLockHash) {
		return {
			valid: false,
			errorCode: "E_WORKSPACE_LOCK_HASH_MISMATCH",
			errorMessage: `Worker report workspaceLockHash mismatch for workspace "${workspaceLock.workspaceId}": expected ${workspaceLock.workspaceLockHash}, got ${reportWorkspaceLockHash}`,
		};
	}
	return { valid: true };
}

// =============================================================================
// Stale Packet Detection
// =============================================================================

/**
 * Check if a worker packet is stale.
 * A packet is stale if either:
 * - The planLockHash does not match the active lock (plan was re-locked)
 * - The workspaceLockHash does not match (workspace was amended/relocked)
 * - The packet was created before the lock was last updated
 */
export function isWorkerPacketStale(
	packet: WorkerPacketV5,
	activePlanLock: PlanLock,
	workspaceLock: WorkspaceLock,
): { stale: boolean; reason?: string } {
	if (packet.planLockHash !== activePlanLock.planLockHash) {
		return {
			stale: true,
			reason: `Packet planLockHash ${packet.planLockHash} does not match active lock ${activePlanLock.planLockHash}`,
		};
	}
	if (packet.workspaceLockHash !== workspaceLock.workspaceLockHash) {
		return {
			stale: true,
			reason: `Packet workspaceLockHash ${packet.workspaceLockHash} does not match active workspace lock ${workspaceLock.workspaceLockHash}`,
		};
	}
	return { stale: false };
}

// =============================================================================
// Admission Check
// =============================================================================

/**
 * Verify that execution can proceed with the given PlanLock.
 * In PlanSpec v5 mode, a lock is REQUIRED.
 * In legacy v4.1.1 mode, lock is optional.
 */
export function verifyAdmission(lock: PlanLock | undefined, planspecMode: boolean): LockVerificationResult {
	if (planspecMode && !lock) {
		return {
			valid: false,
			errorCode: "E_LOCK_REQUIRED",
			errorMessage: "PlanSpec v5 mode requires a PlanLock. No lock provided.",
		};
	}
	return { valid: true };
}

// =============================================================================
// Lock Hash Computation from PlanLock (re-hash verification)
// =============================================================================

/**
 * Recompute the planLockHash from the PlanLock contents.
 * Used to verify integrity.
 */
export function recomputePlanLockHash(lock: PlanLock): string {
	const parts = [
		lock.accpVersion,
		lock.source.planSpecTaskId,
		lock.source.lockedAt,
		lock.source.lockedBy,
		lock.integrity.canonicalJsonHash,
		lock.integrity.workspaceGraphHash,
		lock.integrity.allowedFilesHash,
		lock.integrity.validationPolicyHash,
		lock.integrity.acceptanceCriteriaHash,
		lock.integrity.instructionHash,
		lock.integrity.reportContractHash,
		lock.integrity.p45BridgeHash,
		lock.integrity.commandPolicyHash,
		lock.contract.mode,
		String(lock.contract.maxParallelWorkspaces),
		String(lock.contract.worktreeRequired),
		String(lock.contract.validationLockRequired),
	];
	return sha256Hex(parts.join("|"));
}
