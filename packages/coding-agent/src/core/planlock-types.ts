/**
 * PlanLock and WorkerPacket Types — ACCP 1.2 / PlanSpec v5
 *
 * Defines the PlanLock model with integrity hashes, the WorkerPacket
 * derivation model, and lock verification types.
 *
 * PlanLock is the normalized immutable execution contract derived from
 * PlanSpec. Worker packets are scoped from PlanLock per workspace.
 *
 * Hash fields:
 * - canonicalJsonHash: SHA-256 of the canonical PlanSpec JSON
 * - workspaceGraphHash: SHA-256 of the sorted workspace graph
 * - allowedFilesHash: SHA-256 of all workspace allowed files (sorted, deduped)
 * - validationPolicyHash: SHA-256 of validation policies
 * - acceptanceCriteriaHash: SHA-256 of all AC IDs
 * - instructionHash: SHA-256 of workspace prompts
 * - reportContractHash: SHA-256 of required report paths
 * - p45BridgeHash: SHA-256 of P45 bridge config
 * - commandPolicyHash: SHA-256 of command policy config
 */

// =============================================================================
// Integrity Hashes
// =============================================================================

/**
 * Collection of integrity hashes for a PlanLock.
 * Each hash is a hex-encoded SHA-256 of the canonical representation
 * of the corresponding PlanSpec section.
 */
export interface LockIntegrityHashes {
	/** SHA-256 of the canonical PlanSpec JSON */
	readonly canonicalJsonHash: string;
	/** SHA-256 of the sorted workspace dependency graph */
	readonly workspaceGraphHash: string;
	/** SHA-256 of all workspace allowed files (sorted, deduped) */
	readonly allowedFilesHash: string;
	/** SHA-256 of validation policies */
	readonly validationPolicyHash: string;
	/** SHA-256 of all acceptance criterion IDs */
	readonly acceptanceCriteriaHash: string;
	/** SHA-256 of workspace instruction/prompt hashes */
	readonly instructionHash: string;
	/** SHA-256 of required report paths */
	readonly reportContractHash: string;
	/** SHA-256 of P45 bridge config (empty if no P45 bridge) */
	readonly p45BridgeHash: string;
	/** SHA-256 of command policy config (default if no explicit policy) */
	readonly commandPolicyHash: string;
}

// =============================================================================
// Workspace Lock
// =============================================================================

/**
 * Lock state for a single workspace within a PlanLock.
 */
export interface WorkspaceLock {
	/** Workspace ID (e.g., "WS-01") */
	readonly workspaceId: string;
	/** SHA-256 of this workspace's locked payload */
	readonly workspaceLockHash: string;
	/** Allowed files from PlanSpec (read-only copy) */
	readonly allowedFiles: readonly string[];
	/** Forbidden files from PlanSpec (read-only copy) */
	readonly forbiddenFiles: readonly string[];
	/** Dependencies (from PlanSpec) */
	readonly dependencies: readonly string[];
	/** Acceptance criterion IDs */
	readonly acceptanceCriteria: readonly string[];
	/** Validation command refs */
	readonly validationRefs: readonly string[];
	/** Final validation command refs */
	readonly finalValidationRefs: readonly string[];
}

// =============================================================================
// PlanLock
// =============================================================================

export interface PlanLockSource {
	/** Original PlanSpec task ID */
	readonly planSpecTaskId: string;
	/** Path to canonical PlanSpec JSON file */
	readonly specPath: string;
	/** Timestamp when locked */
	readonly lockedAt: string;
	/** Who/what created the lock */
	readonly lockedBy: string;
}

export interface PlanLockContract {
	/** Number of workspaces */
	readonly workspaceCount: number;
	/** Execution mode from PlanSpec */
	readonly mode: string;
	/** Max parallel workspaces */
	readonly maxParallelWorkspaces: number;
	/** Worktree isolation required */
	readonly worktreeRequired: boolean;
	/** Global validation lock required */
	readonly validationLockRequired: boolean;
}

export interface PlanLockNormalized {
	/** Sorted workspace IDs */
	readonly workspaceIds: readonly string[];
	/** Workspace locks keyed by workspace ID */
	readonly workspaces: Record<string, WorkspaceLock>;
	/** Frozen command policy hash */
	readonly commandPolicyFrozen: boolean;
	/** Frozen schema hash */
	readonly schemaFrozen: boolean;
}

/**
 * Full PlanLock model.
 */
export interface PlanLock {
	/** ACCP version */
	readonly accpVersion: string;
	/** Plan lock schema version */
	readonly planLockVersion: string;
	/** Source metadata */
	readonly source: PlanLockSource;
	/** Plan lock hash (SHA-256 of the entire PlanLock JSON) */
	readonly planLockHash: string;
	/** Contract summary */
	readonly contract: PlanLockContract;
	/** Integrity hashes */
	readonly integrity: LockIntegrityHashes;
	/** Normalized execution data */
	readonly normalized: PlanLockNormalized;
	/** Optional signature (for future signed locks) */
	readonly signature?: string;
}

// =============================================================================
// Worker Packet
// =============================================================================

/**
 * Scoped execution packet for a single workspace worker.
 * Derived from PlanLock and carries the minimal data a worker needs.
 */
export interface WorkerPacketV5 {
	/** ACCP version */
	readonly accpVersion: string;
	/** Plan lock hash this packet was derived from */
	readonly planLockHash: string;
	/** Workspace lock hash this packet was derived from */
	readonly workspaceLockHash: string;
	/** Repo base SHA at lock time */
	readonly repoBaseSha: string;
	/** Workspace identity */
	readonly workspaceId: string;
	/** Workspace title */
	readonly workspaceTitle: string;
	/** Workspace description */
	readonly description?: string;
	/** Allowed files (from lock) */
	readonly allowedFiles: readonly string[];
	/** Forbidden files (from lock) */
	readonly forbiddenFiles: readonly string[];
	/** Acceptance criteria (from lock) */
	readonly acceptanceCriteria: readonly string[];
	/** Validation command refs */
	readonly validationRefs: readonly string[];
	/** Final validation command refs */
	readonly finalValidationRefs: readonly string[];
	/** Command scope (ref -> exact command) */
	readonly commandScope: Record<string, string>;
	/** Required reports */
	readonly requiredReports: readonly string[];
	/** Whether the worker report must echo lock hashes */
	readonly completionEchoRequired: boolean;
	/** Dependencies (from lock) */
	readonly dependencies: readonly string[];
}

// =============================================================================
// Lock Verification
// =============================================================================

/**
 * Result of a lock verification check.
 */
export interface LockVerificationResult {
	readonly valid: boolean;
	readonly errorCode?: string;
	readonly errorMessage?: string;
}

// =============================================================================
// Lock Admission
// =============================================================================

/**
 * Result of a lock admission check.
 */
export interface LockAdmissionResult {
	readonly admitted: boolean;
	readonly errorCode?: string;
	readonly errorMessage?: string;
}

// =============================================================================
// Kernel Event Types for Lock/Worker Packet Lifecycle
// =============================================================================

/**
 * Event payload for plan_lock_admitted
 */
export interface PlanLockAdmittedPayload {
	readonly planLockHash: string;
	readonly planSpecTaskId: string;
	readonly workspaceCount: number;
	readonly mode: string;
}

/**
 * Event payload for workspace_packet_created
 */
export interface WorkspacePacketCreatedPayload {
	readonly planLockHash: string;
	readonly workspaceLockHash: string;
	readonly workspaceId: string;
}

/**
 * Event payload for workspace_packet_rejected
 */
export interface WorkspacePacketRejectedPayload {
	readonly planLockHash: string;
	readonly workspaceLockHash: string;
	readonly workspaceId: string;
	readonly reason: string;
}

/**
 * Event payload for command_grant_requested
 */
export interface CommandGrantRequestedPayload {
	readonly workspaceId: string;
	readonly command: string;
	readonly reason: string;
	readonly risk: string;
}

/**
 * Event payload for command_grant_decision
 */
export interface CommandGrantDecisionPayload {
	readonly workspaceId: string;
	readonly command: string;
	readonly decision: "approved" | "denied";
	readonly grantedBy: string;
}

/**
 * Event payload for delete_policy_blocked
 */
export interface DeletePolicyBlockedPayload {
	readonly workspaceId: string;
	readonly command: string;
	readonly target: string;
	readonly errorCode: string;
}

/**
 * Event payload for plan_amendment_requested
 */
export interface PlanAmendmentRequestedPayload {
	readonly workspaceId: string;
	readonly reason: string;
	readonly changes: readonly string[];
}
