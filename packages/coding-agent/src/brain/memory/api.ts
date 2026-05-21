/**
 * Memory Correction API — P14.F
 *
 * REST-friendly API layer that wraps MemoryStore and MemoryLifecycleEngine
 * to provide CRUD, correction actions, query, and stats operations.
 *
 * The API layer:
 * - Exposes a MemoryCorrectionRecord type for audit trail
 * - Validates all inputs before delegating to the store/lifecycle engine
 * - Returns typed results suitable for serialization by the web-server routes
 *
 * File scope: This is the single API implementation for all memory
 * CRUD and correction operations.
 *
 * Dependencies: P14.B (MemoryStore), P14.C (MemoryLifecycleEngine)
 */

import { randomUUID } from "node:crypto";
import { type LifecycleTransition, MemoryLifecycleEngine } from "./lifecycle.js";
import type { MemoryStore } from "./store.js";
import {
	type MemoryQuery,
	type MemoryRecord,
	type MemoryStats,
	validateMemoryQuery,
	validateMemoryRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// Memory Correction Record
// ---------------------------------------------------------------------------

/**
 * An audit record for a memory correction action.
 *
 * Every correction (reject, supersede, correct) creates one of these
 * records to maintain a full audit trail of user modifications.
 */
export interface MemoryCorrectionRecord {
	/** Unique correction identifier (UUID v4) */
	id: string;
	/** The ID of the original memory record that was corrected */
	originalMemoryId: string;
	/** The ID of the corrected/ replacement memory record (if applicable) */
	correctedMemoryId?: string;
	/** Human-readable reason for the correction */
	reason: string;
	/** What kind of correction action was taken */
	action: "rejected" | "superseded" | "corrected";
	/** ISO 8601 timestamp of when the correction was made */
	createdAt: string;
	/** Who performed the correction (e.g., user ID or "system") */
	createdBy: string;
}

// ---------------------------------------------------------------------------
// API Response Types
// ---------------------------------------------------------------------------

/**
 * Result of listing memories with total count for pagination.
 */
export interface MemoryListResult {
	memories: MemoryRecord[];
	total: number;
}

/**
 * Result of a supersede action returning both the original and replacement.
 */
export interface SupersedeResult {
	original: MemoryRecord;
	replacement: MemoryRecord;
}

// ---------------------------------------------------------------------------
// Memory Correction API
// ---------------------------------------------------------------------------

/**
 * High-level API for memory CRUD and correction actions.
 *
 * This class wraps MemoryStore and MemoryLifecycleEngine into a single
 * convenience API suitable for use by web-server route handlers.
 *
 * Usage:
 * ```typescript
 * const store = new MemoryStore();
 * await store.initialize();
 * const api = new MemoryCorrectionApi(store);
 *
 * // Create a memory
 * const memory = await api.createMemory({ type: "decision_memory", title: "...", ... });
 *
 * // Query memories
 * const { memories, total } = await api.listMemories({ types: ["decision_memory"] });
 *
 * // Reject a memory
 * const rejected = await api.rejectMemory(memory.id, "Not accurate", "user123");
 * ```
 */
export class MemoryCorrectionApi {
	private store: MemoryStore;
	private lifecycle: MemoryLifecycleEngine;
	private correctionRecords: MemoryCorrectionRecord[];

	/**
	 * @param store - An initialized MemoryStore instance
	 * @param lifecycle - An optional MemoryLifecycleEngine; created automatically if omitted
	 */
	constructor(store: MemoryStore, lifecycle?: MemoryLifecycleEngine) {
		this.store = store;
		this.lifecycle = lifecycle ?? new MemoryLifecycleEngine(store);
		this.correctionRecords = [];
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Get the underlying MemoryStore instance.
	 */
	getStore(): MemoryStore {
		return this.store;
	}

	/**
	 * Get the underlying MemoryLifecycleEngine instance.
	 */
	getLifecycle(): MemoryLifecycleEngine {
		return this.lifecycle;
	}

	// -----------------------------------------------------------------------
	// CRUD Operations
	// -----------------------------------------------------------------------

	/**
	 * Create a new memory record.
	 *
	 * The record is created in the "candidate" lifecycle state unless
	 * explicitly overridden. If confidence is not provided, it defaults
	 * to 0.5.
	 *
	 * @param input - Memory record fields (type, title, content, provenance are required)
	 * @returns The created MemoryRecord
	 * @throws If validation fails
	 */
	async createMemory(
		input: Pick<MemoryRecord, "type" | "title" | "content" | "provenance"> &
			Partial<Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">>,
	): Promise<MemoryRecord> {
		const record = this.createRecordFromInput(input);
		return this.store.create(record);
	}

	/**
	 * Retrieve a memory record by its ID.
	 *
	 * @param id - The record UUID
	 * @returns The MemoryRecord, or null if not found
	 */
	async getMemory(id: string): Promise<MemoryRecord | null> {
		return this.store.get(id);
	}

	/**
	 * Update an existing memory record with partial fields.
	 *
	 * @param id - The record UUID
	 * @param updates - Partial fields to update
	 * @returns The updated MemoryRecord
	 * @throws If the record does not exist or validation fails
	 */
	async updateMemory(id: string, updates: Partial<MemoryRecord>): Promise<MemoryRecord> {
		return this.store.update(id, updates);
	}

	/**
	 * Delete a memory record permanently.
	 *
	 * @param id - The record UUID
	 * @throws If the record does not exist
	 */
	async deleteMemory(id: string): Promise<void> {
		return this.store.delete(id);
	}

	// -----------------------------------------------------------------------
	// Query Operations
	// -----------------------------------------------------------------------

	/**
	 * List memory records with filters, sorting, and pagination.
	 *
	 * @param query - Query parameters (all fields optional)
	 * @returns List of matching memories with total count
	 */
	async listMemories(query: MemoryQuery = {}): Promise<MemoryListResult> {
		const validation = validateMemoryQuery(query);
		if (!validation.valid) {
			throw new Error(`Invalid query: ${validation.errors.join("; ")}`);
		}

		const memories = await this.store.query(query);

		// Count total (without pagination)
		const countQuery = { ...query, limit: undefined, offset: undefined };
		const allMemories = await this.store.query(countQuery);

		return {
			memories,
			total: allMemories.length,
		};
	}

	/**
	 * Get aggregate memory statistics.
	 *
	 * @returns MemoryStats with counts, averages
	 */
	async getMemoryStats(): Promise<MemoryStats> {
		return this.store.getStats();
	}

	// -----------------------------------------------------------------------
	// Correction Actions
	// -----------------------------------------------------------------------

	/**
	 * Reject a memory record, marking it as rejected_by_user.
	 *
	 * The record will be excluded from active queries and will not
	 * influence decisions unless explicitly restored.
	 *
	 * Creates a MemoryCorrectionRecord for audit trail.
	 *
	 * @param id - The record UUID to reject
	 * @param reason - Optional reason for rejection
	 * @param createdBy - Who performed the rejection (default: "user")
	 * @returns The updated MemoryRecord (now rejected_by_user)
	 */
	async rejectMemory(id: string, reason?: string, createdBy = "user"): Promise<MemoryRecord> {
		const rejected = await this.lifecycle.reject(id, reason);

		// Record correction audit trail
		this.correctionRecords.push({
			id: randomUUID(),
			originalMemoryId: id,
			reason: reason ?? "Rejected by user",
			action: "rejected",
			createdAt: new Date().toISOString(),
			createdBy,
		});

		return rejected;
	}

	/**
	 * Supersede a memory record with a replacement.
	 *
	 * The original record is marked as superseded and linked to the
	 * replacement. The replacement is created as a candidate and can
	 * be activated separately.
	 *
	 * Creates a MemoryCorrectionRecord for audit trail.
	 *
	 * @param id - The record UUID to supersede
	 * @param replacement - The replacement memory fields (type, title, content, provenance required)
	 * @param reason - Optional reason for supersession
	 * @param createdBy - Who performed the supersession (default: "user")
	 * @returns Both the original (now superseded) and the replacement records
	 */
	async supersedeMemory(
		id: string,
		replacement: Pick<MemoryRecord, "type" | "title" | "content" | "provenance"> &
			Partial<Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">>,
		reason?: string,
		createdBy = "user",
	): Promise<SupersedeResult> {
		// Create the replacement record first
		const original = await this.store.get(id);
		if (!original) {
			throw new Error(`MemoryRecord not found: ${id}`);
		}

		// Inherit some fields from the original if not provided
		const replacementRecord = this.createRecordFromInput({
			...replacement,
			tags: replacement.tags ?? original.tags,
			category: replacement.category ?? original.category,
		});

		// Persist the replacement
		const persistedReplacement = await this.store.create(replacementRecord);

		// Mark the original as superseded
		const supersededOriginal = await this.lifecycle.supersede(id, persistedReplacement.id);

		// Record correction audit trail
		this.correctionRecords.push({
			id: randomUUID(),
			originalMemoryId: id,
			correctedMemoryId: persistedReplacement.id,
			reason: reason ?? `Superseded by ${persistedReplacement.id}`,
			action: "superseded",
			createdAt: new Date().toISOString(),
			createdBy,
		});

		return {
			original: supersededOriginal,
			replacement: persistedReplacement,
		};
	}

	/**
	 * Activate a memory record, promoting it to the active lifecycle state.
	 *
	 * If the record is a candidate and its confidence is below the
	 * auto-activation threshold, it is promoted to needs_review instead.
	 *
	 * @param id - The record UUID to activate
	 * @param reason - Optional reason for activation
	 * @returns The updated MemoryRecord
	 */
	async activateMemory(id: string, reason?: string): Promise<MemoryRecord> {
		return this.lifecycle.activate(id, reason);
	}

	/**
	 * Deactivate an active memory record back to candidate state.
	 *
	 * @param id - The record UUID to deactivate
	 * @param reason - Optional reason for deactivation
	 * @returns The updated MemoryRecord
	 */
	async deactivateMemory(id: string, reason?: string): Promise<MemoryRecord> {
		return this.lifecycle.deactivate(id, reason);
	}

	/**
	 * Restore a rejected, expired, or superseded memory record back to
	 * candidate state for re-evaluation.
	 *
	 * @param id - The record UUID to restore
	 * @param reason - Optional reason for restoration
	 * @returns The updated MemoryRecord (now candidate)
	 */
	async restoreMemory(id: string, reason?: string): Promise<MemoryRecord> {
		return this.lifecycle.restore(id, reason);
	}

	// -----------------------------------------------------------------------
	// Correction Audit Trail
	// -----------------------------------------------------------------------

	/**
	 * Get all correction records.
	 *
	 * Correction records are kept in-memory (not persisted to disk as
	 * part of this implementation). They provide an audit trail for
	 * the current session.
	 *
	 * @returns Array of MemoryCorrectionRecord in chronological order
	 */
	getCorrectionRecords(): MemoryCorrectionRecord[] {
		return [...this.correctionRecords];
	}

	/**
	 * Get lifecycle transition events by registering a listener on the
	 * underlying lifecycle engine.
	 *
	 * @param callback - Function called for each lifecycle transition
	 */
	onTransition(callback: (transition: LifecycleTransition) => void): void {
		this.lifecycle.onTransition(callback);
	}

	// -----------------------------------------------------------------------
	// Private Helpers
	// -----------------------------------------------------------------------

	/**
	 * Create a MemoryRecord from user input with defaults applied.
	 */
	private createRecordFromInput(
		input: Pick<MemoryRecord, "type" | "title" | "content" | "provenance"> &
			Partial<Omit<MemoryRecord, "createdAt" | "updatedAt">>, // id is optional
	): MemoryRecord {
		const now = new Date().toISOString();

		const record: MemoryRecord = {
			id: randomUUID(),
			type: input.type,
			title: input.title,
			content: input.content,
			summary: input.summary,
			lifecycle: input.lifecycle ?? "candidate",
			confidence: input.confidence ?? 0.5,
			provenance: input.provenance,
			createdAt: now,
			updatedAt: now,
			expiresAt: input.expiresAt,
			supersededBy: input.supersededBy,
			affectedBy: input.affectedBy,
			tags: input.tags ?? [],
			category: input.category,
			metadata: input.metadata ?? {},
		};

		const validation = validateMemoryRecord(record);
		if (!validation.valid) {
			throw new Error(`Invalid memory record: ${validation.errors.join("; ")}`);
		}

		return record;
	}
}
