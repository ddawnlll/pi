/**
 * Plan-Level Queue Store - P12.5.B
 *
 * Manages plan queue persistence to .pi/plan-queue.json with:
 * - Atomic writes (write to temp file, rename)
 * - Duplicate phase/hash detection
 * - Full CRUD for queue entries
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type PlanQueueEntry, PlanQueueEntryStatus } from "./plan-queue-runner.js";
import type { WorkspaceQueue } from "./workspace-schema.js";

// =========================================================================
// Types
// =========================================================================

/**
 * Serialized format for plan queue entries stored on disk.
 * Mirrors PlanQueueEntry but is fully JSON-serializable.
 */
export interface StoredPlanQueueEntry {
	id: string;
	projectId: string;
	planPath: string;
	phase: string;
	contentHash: string;
	status: string;
	planExecutionId?: string;
	queuedAt: number;
	startedAt?: number;
	completedAt?: number;
	error?: string;
	blockReason?: string;
	/**
	 * Reason the entry is waiting (not yet ready).
	 * P12.5.E — Continuous Ready Queue Foundation
	 */
	waitingReason?: string;
	agentId?: string;
}

/**
 * Serialized queue state stored on disk.
 */
export interface StoredPlanQueueState {
	entries: StoredPlanQueueEntry[];
	isRunning: boolean;
	activeEntryId?: string;
	stopOnFailure: boolean;
	savedAt: number;
}

/**
 * Result of adding an entry to the queue.
 */
export interface AddEntryResult {
	entry: StoredPlanQueueEntry;
	/** Whether this entry was actually added (false if duplicate) */
	added: boolean;
	/** The existing entry that caused the duplicate (if any) */
	duplicateOf?: StoredPlanQueueEntry;
}

/**
 * Configuration for PlanLevelQueueStore.
 */
export interface PlanLevelQueueStoreConfig {
	/** Workspace root directory */
	workspaceRoot: string;
	/** .pi directory name (default: ".pi") */
	piDir?: string;
}

// =========================================================================
// Plan-Level Queue Store
// =========================================================================

/**
 * Plan-Level Queue Store
 *
 * Persists plan queue entries to .pi/plan-queue.json with atomic writes.
 * Detects duplicate entries by phase + content hash.
 */
export class PlanLevelQueueStore {
	private workspaceRoot: string;
	private piDir: string;
	private queueFilePath: string;

	/** Mutex promise chain to serialize all load-modify-save cycles */
	private operationQueue: Promise<void> = Promise.resolve();

	constructor(config: PlanLevelQueueStoreConfig) {
		this.workspaceRoot = config.workspaceRoot;
		this.piDir = config.piDir ?? ".pi";
		this.queueFilePath = path.join(this.workspaceRoot, this.piDir, "plan-queue.json");
	}

	// =========================================================================
	// Hash Computation
	// =========================================================================

	/**
	 * Compute a deterministic hash for a workspace queue.
	 *
	 * The hash incorporates:
	 * - Phase identifier
	 * - Workspace IDs (sorted)
	 * - Dependencies for each workspace (sorted)
	 * - Number of workspaces
	 *
	 * This is used for duplicate detection across the queue.
	 *
	 * @param queue - The workspace queue to hash
	 * @returns Hex-encoded SHA-256 hash
	 */
	computeQueueHash(queue: WorkspaceQueue): string {
		const hash = crypto.createHash("sha256");

		hash.update(`phase:${queue.phase}`);
		hash.update(`title:${queue.title}`);
		hash.update(`count:${queue.workspaces.length}`);

		// Sort workspace IDs for deterministic ordering
		const sortedIds = queue.workspaces.map((w) => w.id).sort();
		hash.update(`workspaces:${sortedIds.join(",")}`);

		// Add each workspace's dependencies (sorted)
		for (const wsId of sortedIds) {
			const ws = queue.workspaces.find((w) => w.id === wsId)!;
			const sortedDeps = [...ws.dependencies].sort();
			hash.update(`dep:${wsId}:${sortedDeps.join(",")}`);
		}

		return hash.digest("hex");
	}

	/**
	 * Extract phase from an entry. If the entry has a queue, use queue.phase.
	 * Otherwise, fall back to parsing the planPath.
	 *
	 * @param entry - The queue entry or workspace queue
	 * @returns Phase string
	 */
	extractPhase(entry: PlanQueueEntry | WorkspaceQueue): string {
		if ("queue" in entry && entry.queue) {
			return entry.queue.phase;
		}
		if ("phase" in entry) {
			return (entry as WorkspaceQueue).phase;
		}
		if ("planPath" in entry) {
			// Try to extract phase from plan path
			const match = entry.planPath.match(/P\d+(\.\d+)?/);
			if (match) {
				return match[0];
			}
		}
		return "unknown";
	}

	/**
	 * Compute content hash for a plan entry.
	 *
	 * The hash combines phase + queue structure for duplicate detection.
	 * If no queue is provided, falls back to hashing the planPath.
	 *
	 * @param entry - Plan queue entry
	 * @returns Content hash string
	 */
	computeEntryHash(entry: PlanQueueEntry): string {
		if (entry.queue) {
			return this.computeQueueHash(entry.queue);
		}
		// Fallback: hash planPath
		const hash = crypto.createHash("sha256");
		hash.update(`planPath:${entry.planPath}`);
		hash.update(`projectId:${entry.projectId}`);
		return hash.digest("hex");
	}

	// =========================================================================
	// Persistence
	// =========================================================================

	/**
	 * Load queue state from disk.
	 *
	 * @returns The stored queue state, or null if the file doesn't exist
	 */
	async load(): Promise<StoredPlanQueueState | null> {
		try {
			const content = await fs.readFile(this.queueFilePath, "utf-8");
			return JSON.parse(content) as StoredPlanQueueState;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Queue an operation to run sequentially through the load-modify-save cycle.
	 *
	 * Each operation waits for the previous one to complete before starting,
	 * ensuring no two operations load stale state simultaneously.
	 *
	 * @param fn - Function that receives the loaded state and returns { state, result } or null to skip save
	 * @returns The result of the operation, or undefined if fn returned null
	 */
	private async withMutex<T>(
		fn: (state: StoredPlanQueueState) => Promise<{ state: StoredPlanQueueState; result: T } | null>,
	): Promise<T | undefined> {
		// Chain onto the operation queue — this ensures operations run sequentially
		// even if many are kicked off concurrently via Promise.all.
		const prev = this.operationQueue;
		let resolve!: () => void;
		this.operationQueue = new Promise<void>((r) => {
			resolve = r;
		});

		await prev;

		try {
			const loaded = await this.load();
			const state: StoredPlanQueueState = loaded ?? {
				entries: [],
				isRunning: false,
				stopOnFailure: true,
				savedAt: Date.now(),
			};

			const outcome = await fn(state);
			if (outcome === null) {
				return undefined;
			}

			await this.writeState(outcome.state);
			return outcome.result;
		} finally {
			resolve();
		}
	}

	/**
	 * Low-level write to disk (no mutex — callers must hold the mutex).
	 */
	private async writeState(state: StoredPlanQueueState): Promise<void> {
		const dir = path.dirname(this.queueFilePath);
		await fs.mkdir(dir, { recursive: true });

		// Atomic write: write to unique temp file, then rename
		state.savedAt = Date.now();
		const tempPath = `${this.queueFilePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
		await fs.writeFile(tempPath, JSON.stringify(state, null, 2), "utf-8");
		await fs.rename(tempPath, this.queueFilePath);
	}

	// =========================================================================
	// Queue Operations
	// =========================================================================

	/**
	 * Add an entry to the queue.
	 *
	 * Checks for duplicate entries by phase + content hash.
	 * If a duplicate exists, the entry is NOT added and the existing
	 * duplicate entry is returned.
	 *
	 * @param entry - The entry to add
	 * @param options - Options for the add operation
	 * @returns Result indicating whether the entry was added or rejected as duplicate
	 */
	async addEntry(entry: PlanQueueEntry, options?: { skipDuplicateCheck?: boolean }): Promise<AddEntryResult> {
		const result = await this.withMutex(async (state) => {
			const phase = this.extractPhase(entry);
			const contentHash = this.computeEntryHash(entry);

			// Check for duplicates unless explicitly skipped
			if (!options?.skipDuplicateCheck) {
				const duplicate = state.entries.find((e) => e.phase === phase && e.contentHash === contentHash);
				if (duplicate) {
					return {
						state,
						result: {
							entry: {
								id: entry.id,
								projectId: entry.projectId,
								planPath: entry.planPath,
								phase,
								contentHash,
								status: "duplicate",
								queuedAt: entry.queuedAt,
								agentId: entry.agentId,
							} as StoredPlanQueueEntry,
							added: false,
							duplicateOf: duplicate,
						} as AddEntryResult,
					};
				}
			}

			// Convert to stored format
			const stored: StoredPlanQueueEntry = {
				id: entry.id,
				projectId: entry.projectId,
				planPath: entry.planPath,
				phase,
				contentHash,
				status: entry.status,
				planExecutionId: entry.planExecutionId,
				queuedAt: entry.queuedAt,
				startedAt: entry.startedAt,
				completedAt: entry.completedAt,
				error: entry.error,
				blockReason: entry.blockReason,
				waitingReason: entry.waitingReason,
				agentId: entry.agentId,
			};

			state.entries.push(stored);

			return {
				state,
				result: {
					entry: stored,
					added: true,
				} as AddEntryResult,
			};
		});

		return result ?? { entry: null as unknown as StoredPlanQueueEntry, added: false };
	}

	/**
	 * Remove an entry from the queue by ID.
	 *
	 * @param entryId - ID of the entry to remove
	 * @returns True if the entry was found and removed
	 */
	async removeEntry(entryId: string): Promise<boolean> {
		const result = await this.withMutex(async (state) => {
			const initialLength = state.entries.length;
			state.entries = state.entries.filter((e) => e.id !== entryId);

			if (state.entries.length === initialLength) {
				return null; // Entry not found
			}

			return { state, result: true };
		});

		return result ?? false;
	}

	/**
	 * Get all entries in the queue.
	 *
	 * @returns Array of stored queue entries
	 */
	async listEntries(): Promise<StoredPlanQueueEntry[]> {
		const state = await this.load();
		return state?.entries ?? [];
	}

	/**
	 * Get a single entry by ID.
	 *
	 * @param entryId - Entry ID
	 * @returns The entry, or undefined if not found
	 */
	async getEntry(entryId: string): Promise<StoredPlanQueueEntry | undefined> {
		const entries = await this.listEntries();
		return entries.find((e) => e.id === entryId);
	}

	/**
	 * Get entries filtered by project ID.
	 *
	 * @param projectId - Project ID
	 * @returns Entries for the project
	 */
	async getEntriesForProject(projectId: string): Promise<StoredPlanQueueEntry[]> {
		const entries = await this.listEntries();
		return entries.filter((e) => e.projectId === projectId);
	}

	/**
	 * Find duplicate entries for a given entry.
	 *
	 * Returns all entries that have the same phase + content hash as the
	 * provided entry, excluding the entry itself (matched by ID).
	 *
	 * @param entry - The entry to check for duplicates
	 * @returns Array of duplicate entries
	 */
	async findDuplicates(entry: PlanQueueEntry): Promise<StoredPlanQueueEntry[]> {
		const entries = await this.listEntries();
		const phase = this.extractPhase(entry);
		const contentHash = this.computeEntryHash(entry);

		return entries.filter((e) => e.phase === phase && e.contentHash === contentHash && e.id !== entry.id);
	}

	/**
	 * Check if an entry with the same phase + content hash already exists.
	 *
	 * @param entry - The entry to check
	 * @returns True if a duplicate exists
	 */
	async hasDuplicate(entry: PlanQueueEntry): Promise<boolean> {
		const duplicates = await this.findDuplicates(entry);
		return duplicates.length > 0;
	}

	/**
	 * Clear all entries from the queue.
	 */
	async clear(): Promise<void> {
		await this.withMutex(async (state) => {
			state.entries = [];
			state.activeEntryId = undefined;
			return { state, result: undefined };
		});
	}

	/**
	 * Update the status of an entry.
	 *
	 * @param entryId - ID of the entry to update
	 * @param updates - Status fields to update
	 * @returns True if the entry was found and updated
	 */
	async updateEntry(
		entryId: string,
		updates: Partial<
			Pick<
				StoredPlanQueueEntry,
				"status" | "planExecutionId" | "startedAt" | "completedAt" | "error" | "blockReason" | "waitingReason"
			>
		>,
	): Promise<boolean> {
		const result = await this.withMutex(async (state) => {
			const entry = state.entries.find((e) => e.id === entryId);
			if (!entry) {
				return null;
			}

			Object.assign(entry, updates);
			return { state, result: true };
		});

		return result ?? false;
	}

	/**
	 * Check if the queue has any entries.
	 *
	 * @returns True if the queue is empty
	 */
	async isEmpty(): Promise<boolean> {
		const entries = await this.listEntries();
		return entries.length === 0;
	}

	/**
	 * Get the number of entries in the queue.
	 *
	 * @returns Entry count
	 */
	async count(): Promise<number> {
		const entries = await this.listEntries();
		return entries.length;
	}

	/**
	 * Get the file path to the queue store.
	 *
	 * @returns Absolute path to plan-queue.json
	 */
	getFilePath(): string {
		return this.queueFilePath;
	}

	/**
	 * Convert a StoredPlanQueueEntry back to PlanQueueEntryStatus.
	 *
	 * @param status - Status string
	 * @returns PlanQueueEntryStatus enum value
	 */
	static parseStatus(status: string): PlanQueueEntryStatus {
		switch (status) {
			case "pending":
				return PlanQueueEntryStatus.Pending;
			case "active":
				return PlanQueueEntryStatus.Active;
			case "complete":
				return PlanQueueEntryStatus.Complete;
			case "failed":
				return PlanQueueEntryStatus.Failed;
			case "blocked":
				return PlanQueueEntryStatus.Blocked;
			case "skipped":
				return PlanQueueEntryStatus.Skipped;
			default:
				return PlanQueueEntryStatus.Pending;
		}
	}
}

/**
 * Create a PlanLevelQueueStore instance.
 *
 * @param config - Store configuration
 * @returns PlanLevelQueueStore instance
 */
export function createPlanLevelQueueStore(config: PlanLevelQueueStoreConfig): PlanLevelQueueStore {
	return new PlanLevelQueueStore(config);
}
