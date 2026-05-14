/**
 * Cacheable Workspace Packet Format - P2 Workstream 5.5.C
 *
 * Defines a deterministic workspace packet format that separates
 * the static contract from dynamic state for cacheable execution.
 *
 * The contract hash is computed only from the contract fields,
 * so retries and state changes don't invalidate the cache.
 *
 * ## Hash Determinism
 *
 * - Same contract fields always produce the same hash (stable JSON sort keys).
 * - Dynamic state (stage, attempts, error, timestamps) is excluded from hashing.
 * - Retrying a workspace does not change its packet hash.
 * - Changing contract fields (id, title, dependencies, etc.) changes the hash.
 * - Packet hash is available for logging and artifact tracking.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Contract fields (deterministic, contribute to hash)
// ---------------------------------------------------------------------------

/**
 * Static contract fields that determine the packet hash.
 *
 * These fields represent the "what" of the workspace -- they are
 * stable across retries and execution attempts.
 */
export interface WorkspacePacketContract {
	/** Workspace identifier */
	id: string;
	/** Human-readable title */
	title: string;
	/** Workspace dependencies */
	dependencies: string[];
	/** Role budget for this workspace */
	roleBudget: string;
	/** Maximum retry attempts */
	maxRetries: number;
	/** Retry policy (overrides defaults) */
	retryPolicy?: Record<string, unknown>;
	/** Risk level */
	riskLevel?: string;
	/** Capability manifest */
	capabilities?: Record<string, unknown>;
	/** Acceptance criteria */
	acceptanceCriteria?: string[];
	/** Target command */
	targetCommand?: string;
	/** Auto-commit flag */
	autoCommit?: boolean;
	/** Parallel group identifier */
	parallelGroup?: string;
	/** Dependency reasons */
	dependencyReason?: Record<string, string>;
	/** Preflight requirement */
	preflightRequired?: boolean;
}

// ---------------------------------------------------------------------------
// Dynamic state fields (do NOT contribute to hash)
// ---------------------------------------------------------------------------

/**
 * Dynamic state that does NOT affect the packet hash.
 *
 * These fields represent the "how far along" of the workspace --
 * they change during execution but don't change the contract.
 */
export interface WorkspacePacketState {
	/** Current execution stage */
	stage?: string;
	/** Number of attempts so far */
	attempts?: number;
	/** Error message (if failed) */
	error?: string;
	/** Timestamp of last update */
	lastUpdated?: number;
	/** Execution metadata */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Cacheable workspace packet
// ---------------------------------------------------------------------------

/**
 * A cacheable workspace packet with a deterministic hash.
 *
 * The hash is computed only from the contract fields, so:
 * - Same contract -> same hash (cache hit)
 * - State changes -> same hash (cache still valid)
 * - Contract changes -> different hash (cache miss)
 *
 * The hash is logged and available in artifacts for debugging the caching layer.
 */
export interface CachedWorkspacePacket {
	/** Static contract (determines hash) */
	contract: WorkspacePacketContract;
	/** Dynamic state (does NOT affect hash) */
	state: WorkspacePacketState;
	/** Deterministic hash of contract only */
	contractHash: string;
	/** Packet format version */
	version: number;
}

// ---------------------------------------------------------------------------
// Packet version
// ---------------------------------------------------------------------------

/**
 * Current workspace packet format version.
 * Bump this when the contract serialization format changes
 * to invalidate all cached hashes.
 */
export const WORKSPACE_PACKET_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Deterministic serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a contract to a stable JSON string for hashing.
 *
 * Recursively sorts all object keys for deterministic output
 * across platforms and engine versions.
 *
 * @param contract - The workspace packet contract
 * @returns Stable JSON string with sorted keys at all nesting levels
 */
export function serializeContract(contract: WorkspacePacketContract): string {
	return JSON.stringify(contract, stableSortReplacer, 0);
}

/**
 * JSON.stringify replacer that recursively sorts object keys
 * for deterministic serialization.
 */
function stableSortReplacer(_key: string, value: unknown): unknown {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		const keys = Object.keys(value).sort();
		const sorted: Record<string, unknown> = {};
		for (const k of keys) {
			sorted[k] = (value as Record<string, unknown>)[k];
		}
		return sorted;
	}
	return value;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic SHA-256 hash of a workspace packet contract.
 *
 * The hash is computed only from the contract fields, excluding:
 * - Dynamic state (stage, attempts, error, timestamps)
 * - Version number
 *
 * @param contract - The workspace packet contract
 * @returns Hex SHA-256 hash string (64 characters)
 */
export function hashContract(contract: WorkspacePacketContract): string {
	const serialized = serializeContract(contract);
	return createHash("sha256").update(serialized, "utf-8").digest("hex");
}

/**
 * Compute the contract hash and create a cached workspace packet.
 *
 * @param contract - Static contract fields
 * @param state - Dynamic state fields (optional, defaults to empty)
 * @returns A new CachedWorkspacePacket with the contract hash
 */
export function createWorkspacePacket(
	contract: WorkspacePacketContract,
	state?: WorkspacePacketState,
): CachedWorkspacePacket {
	const contractHash = hashContract(contract);
	return {
		contract,
		state: state ?? {},
		contractHash,
		version: WORKSPACE_PACKET_VERSION,
	};
}

/**
 * Recompute a contract hash and verify it matches the stored hash.
 *
 * @param packet - The cached workspace packet to verify
 * @returns True if the contract hash is valid (packet is untampered)
 */
export function verifyContractHash(packet: CachedWorkspacePacket): boolean {
	const computed = hashContract(packet.contract);
	return computed === packet.contractHash;
}

/**
 * Update the dynamic state of a packet without changing its hash.
 *
 * This is the key method for caching: state updates don't invalidate
 * the contract hash, so the same contract can be retried without
 * changing the cache key.
 *
 * @param packet - The existing cached workspace packet
 * @param stateUpdate - Partial state update to merge
 * @returns A new packet with updated state but same contract hash
 */
export function updatePacketState(
	packet: CachedWorkspacePacket,
	stateUpdate: Partial<WorkspacePacketState>,
): CachedWorkspacePacket {
	return {
		...packet,
		state: {
			...packet.state,
			...stateUpdate,
		},
	};
}

/**
 * Get the contract hash for logging and artifacts.
 *
 * @param packet - The cached workspace packet
 * @returns The hex hash string suitable for log display
 */
export function getPacketHash(packet: CachedWorkspacePacket): string {
	return packet.contractHash;
}

/**
 * Convert a cached workspace packet to a human-readable log line.
 *
 * @param packet - The cached workspace packet
 * @returns A log-friendly representation including id, hash, title, and stage
 */
export function formatPacketForLog(packet: CachedWorkspacePacket): string {
	return `[workspace-packet v${packet.version}] id=${packet.contract.id} hash=${packet.contractHash} title="${packet.contract.title}" state=${packet.state.stage ?? "unknown"}`;
}
