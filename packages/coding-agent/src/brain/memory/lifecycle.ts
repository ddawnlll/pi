/**
 * Memory Lifecycle Engine — P14.C
 *
 * Manages memory state transitions with policy rules. Handles
 * candidate -> active promotion, expiry, supersession, rejection,
 * and restoration of memory records.
 *
 * The lifecycle engine enforces policy constraints such as minimum
 * confidence for automatic activation, configurable TTL for active
 * memories, and state transition validation.
 *
 * Every state transition emits a LifecycleTransition event that can
 * be consumed via the onTransition callback for audit logging,
 * notifications, or downstream processing.
 *
 * File scope: This is the single lifecycle management implementation
 * for all memory state transitions across the system.
 *
 * Dependencies: P14.B (MemoryStore)
 */

import type { MemoryStore } from "./store.js";
import type { MemoryLifecycle, MemoryRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default confidence threshold for auto-activation (0.0 - 1.0). */
const DEFAULT_AUTO_ACTIVATE_CONFIDENCE = 0.8;

/** Default TTL for active memories in days. */
const DEFAULT_TTL_DAYS = 90;

/** Confidence threshold below which records are flagged for review (0.0 - 1.0). */
const DEFAULT_NEEDS_REVIEW_CONFIDENCE = 0.5;

/** How often to run scheduled expiration checks (in hours). */
const DEFAULT_CHECK_INTERVAL_HOURS = 24;

/** Number of milliseconds in a day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// LifecycleConfiguration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Memory Lifecycle Engine.
 *
 * All values have sensible defaults suitable for most use cases.
 * Adjust autoActivateConfidence to control how aggressively candidate
 * memories are promoted to active state.
 */
export interface LifecycleConfig {
	/**
	 * Minimum confidence score required for automatic candidate -> active
	 * promotion. If a candidate memory has confidence below this threshold,
	 * activate() transitions it to needs_review instead.
	 * Range: 0.0 - 1.0
	 * Default: 0.8
	 */
	autoActivateConfidence: number;

	/**
	 * Default time-to-live in days for newly activated memories.
	 * When a candidate is activated without an explicit expiresAt,
	 * the engine sets expiresAt to now + defaultTtlDays.
	 * Default: 90
	 */
	defaultTtlDays: number;

	/**
	 * Confidence threshold for flagging records as needs_review.
	 * During checkNeedsReview(), active records with confidence below
	 * this value are transitioned to needs_review automatically.
	 * Range: 0.0 - 1.0
	 * Default: 0.5
	 */
	needsReviewConfidence: number;

	/**
	 * How often (in hours) scheduled expiration checks should run.
	 * This is a configuration value for the scheduler; the
	 * runExpirationCheck() method must still be called explicitly.
	 * Default: 24
	 */
	checkIntervalHours: number;
}

// ---------------------------------------------------------------------------
// Lifecycle Transition Event
// ---------------------------------------------------------------------------

/**
 * A recorded state transition for a memory record.
 *
 * Every time a memory record changes lifecycle state through the engine,
 * a LifecycleTransition event is produced. These can be consumed via
 * onTransition() for audit logging, notification, or downstream processing.
 */
export interface LifecycleTransition {
	/** The ID of the memory record that transitioned. */
	memoryId: string;

	/** The lifecycle state before the transition. */
	fromState: MemoryLifecycle;

	/** The lifecycle state after the transition. */
	toState: MemoryLifecycle;

	/** Human-readable reason for the transition. */
	reason: string;

	/** What triggered this transition. */
	triggeredBy: "system" | "user" | "policy";

	/** ISO 8601 timestamp of when the transition occurred. */
	timestamp: string;
}

// ---------------------------------------------------------------------------
// Valid Transition Map
// ---------------------------------------------------------------------------

/**
 * Defines which lifecycle states a memory record can transition from
 * for each target state and operation.
 *
 * The map is structured as allowedTransitions[targetState] = Set<sourceStates>
 * indicating which source states can legally transition to the target.
 */
const ALLOWED_TRANSITIONS: Record<string, Set<MemoryLifecycle>> = {
	active: new Set<MemoryLifecycle>(["candidate", "needs_review", "disputed"]),
	candidate: new Set<MemoryLifecycle>(["needs_review", "disputed", "superseded", "expired", "rejected_by_user"]),
	needs_review: new Set<MemoryLifecycle>(["active", "candidate", "disputed"]),
	superseded: new Set<MemoryLifecycle>(["active", "candidate", "needs_review", "disputed", "expired"]),
	expired: new Set<MemoryLifecycle>(["active", "needs_review", "candidate", "disputed"]),
	rejected_by_user: new Set<MemoryLifecycle>(["candidate", "active", "needs_review", "disputed"]),
	disputed: new Set<MemoryLifecycle>(["active", "needs_review"]),
};

// ---------------------------------------------------------------------------
// Memory Lifecycle Engine
// ---------------------------------------------------------------------------

/**
 * Engine for managing memory record lifecycle state transitions.
 *
 * The engine enforces policy rules, validates transitions, and emits
 * events for every state change. It is designed to work with a
 * MemoryStore (P14.B) as its persistence backend.
 *
 * Usage:
 * ```typescript
 * const store = new MemoryStore();
 * await store.initialize();
 *
 * const engine = new MemoryLifecycleEngine(store);
 *
 * // Promote a candidate to active
 * const activated = await engine.activate(memoryId);
 *
 * // Listen for transitions
 * engine.onTransition((t) => console.log(`${t.memoryId}: ${t.fromState} -> ${t.toState}`));
 * ```
 */
export class MemoryLifecycleEngine {
	private config: LifecycleConfig;
	private memoryStore: MemoryStore;
	private transitionCallbacks: Array<(transition: LifecycleTransition) => void>;

	/**
	 * Create a new MemoryLifecycleEngine.
	 *
	 * @param memoryStore - An initialized MemoryStore instance (P14.B).
	 * @param config - Optional partial configuration. Missing keys use defaults.
	 */
	constructor(memoryStore: MemoryStore, config?: Partial<LifecycleConfig>) {
		this.memoryStore = memoryStore;
		this.transitionCallbacks = [];
		this.config = {
			autoActivateConfidence: config?.autoActivateConfidence ?? DEFAULT_AUTO_ACTIVATE_CONFIDENCE,
			defaultTtlDays: config?.defaultTtlDays ?? DEFAULT_TTL_DAYS,
			needsReviewConfidence: config?.needsReviewConfidence ?? DEFAULT_NEEDS_REVIEW_CONFIDENCE,
			checkIntervalHours: config?.checkIntervalHours ?? DEFAULT_CHECK_INTERVAL_HOURS,
		};
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the engine configuration.
	 *
	 * Only provided fields are changed; missing fields keep their current values.
	 *
	 * @param config - Partial configuration to apply.
	 */
	setConfig(config: Partial<LifecycleConfig>): void {
		if (config.autoActivateConfidence !== undefined) {
			this.config.autoActivateConfidence = config.autoActivateConfidence;
		}
		if (config.defaultTtlDays !== undefined) {
			this.config.defaultTtlDays = config.defaultTtlDays;
		}
		if (config.needsReviewConfidence !== undefined) {
			this.config.needsReviewConfidence = config.needsReviewConfidence;
		}
		if (config.checkIntervalHours !== undefined) {
			this.config.checkIntervalHours = config.checkIntervalHours;
		}
	}

	/**
	 * Get a snapshot of the current engine configuration.
	 *
	 * @returns A shallow copy of the current config.
	 */
	getConfig(): LifecycleConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Event Subscription
	// -----------------------------------------------------------------------

	/**
	 * Register a callback for lifecycle transition events.
	 *
	 * The callback is invoked synchronously after each transition is
	 * persisted to the store. Multiple callbacks can be registered;
	 * they are called in registration order.
	 *
	 * @param callback - Function to call with the LifecycleTransition event.
	 */
	onTransition(callback: (transition: LifecycleTransition) => void): void {
		this.transitionCallbacks.push(callback);
	}

	// -----------------------------------------------------------------------
	// State Transitions
	// -----------------------------------------------------------------------

	/**
	 * Promote a memory record to the active lifecycle state.
	 *
	 * If the record is a candidate and its confidence is below the
	 * autoActivateConfidence threshold, it is transitioned to needs_review
	 * instead of active.
	 *
	 * Valid source states: candidate, needs_review, disputed
	 *
	 * When promoting to active, if the record has no expiresAt set,
	 * the engine automatically sets it to now + defaultTtlDays.
	 *
	 * @param memoryId - The ID of the memory record to activate.
	 * @param reason - Optional human-readable reason for the transition.
	 * @returns The updated MemoryRecord.
	 * @throws If the record does not exist or the transition is invalid.
	 */
	async activate(memoryId: string, reason?: string): Promise<MemoryRecord> {
		const record = await this.getRecordOrThrow(memoryId);

		if (!ALLOWED_TRANSITIONS.active.has(record.lifecycle)) {
			throw new Error(
				`Cannot activate memory record ${memoryId}: current state '${record.lifecycle}' cannot transition to 'active'`,
			);
		}

		const triggeredBy: "system" | "user" | "policy" = reason === "auto-activation" ? "system" : "user";

		// If confidence is below threshold, promote to needs_review instead
		if (record.lifecycle === "candidate" && record.confidence < this.config.autoActivateConfidence) {
			return this.transitionTo(
				record,
				"needs_review",
				reason ??
					`Confidence ${record.confidence} below auto-activation threshold ${this.config.autoActivateConfidence}`,
				triggeredBy,
			);
		}

		// Set expiresAt if not already set
		const updates: Partial<MemoryRecord> = {};
		if (!record.expiresAt) {
			const expiresAt = new Date(Date.now() + this.config.defaultTtlDays * MS_PER_DAY).toISOString();
			updates.expiresAt = expiresAt;
		}

		return this.transitionTo(record, "active", reason ?? "Promoted to active state", triggeredBy, updates);
	}

	/**
	 * Demote an active memory record back to candidate state.
	 *
	 * This is useful when a record's confidence drops or a user wants
	 * to review the record again before it influences decisions.
	 *
	 * Valid source states: active
	 *
	 * @param memoryId - The ID of the memory record to deactivate.
	 * @param reason - Optional human-readable reason for the transition.
	 * @returns The updated MemoryRecord.
	 * @throws If the record does not exist or the transition is invalid.
	 */
	async deactivate(memoryId: string, reason?: string): Promise<MemoryRecord> {
		const record = await this.getRecordOrThrow(memoryId);

		if (record.lifecycle !== "active") {
			throw new Error(
				`Cannot deactivate memory record ${memoryId}: current state is '${record.lifecycle}', expected 'active'`,
			);
		}

		// Clear expiresAt when deactivating
		return this.transitionTo(record, "candidate", reason ?? "Deactivated from active state", "user", {
			expiresAt: undefined,
		});
	}

	/**
	 * Mark a memory record as superseded by a replacement record.
	 *
	 * This creates a chain: the old record's supersededBy is set to the
	 * replacement ID. The replacement record's metadata is annotated to
	 * indicate it supersedes the old record.
	 *
	 * Valid source states: active, candidate, needs_review, disputed, expired
	 *
	 * @param memoryId - The ID of the memory record to supersede.
	 * @param replacementId - The ID of the replacement memory record.
	 * @returns The updated (superseded) MemoryRecord.
	 * @throws If either record does not exist or the transition is invalid.
	 */
	async supersede(memoryId: string, replacementId: string): Promise<MemoryRecord> {
		const record = await this.getRecordOrThrow(memoryId);
		const replacement = await this.getRecordOrThrow(replacementId);

		if (!ALLOWED_TRANSITIONS.superseded.has(record.lifecycle)) {
			throw new Error(
				`Cannot supersede memory record ${memoryId}: current state '${record.lifecycle}' cannot transition to 'superseded'`,
			);
		}

		if (replacement.lifecycle === "superseded") {
			throw new Error(
				`Cannot supersede record ${memoryId} with ${replacementId}: replacement record is already superseded`,
			);
		}

		// Annotate replacement metadata to record what it supersedes
		const existingSupersedes = (replacement.metadata?.supersedes as string[]) ?? [];
		if (!existingSupersedes.includes(memoryId)) {
			await this.memoryStore.update(replacementId, {
				metadata: {
					...replacement.metadata,
					supersedes: [...existingSupersedes, memoryId],
				},
			});
		}

		return this.transitionTo(record, "superseded", `Superseded by memory record ${replacementId}`, "system", {
			supersededBy: replacementId,
		});
	}

	/**
	 * Reject a memory record, marking it as rejected_by_user.
	 *
	 * Rejected records are excluded from active queries and do not
	 * influence decisions unless explicitly restored.
	 *
	 * Valid source states: candidate, active, needs_review, disputed
	 *
	 * @param memoryId - The ID of the memory record to reject.
	 * @param reason - Optional human-readable reason for the rejection.
	 * @returns The updated MemoryRecord.
	 * @throws If the record does not exist or the transition is invalid.
	 */
	async reject(memoryId: string, reason?: string): Promise<MemoryRecord> {
		const record = await this.getRecordOrThrow(memoryId);

		if (!ALLOWED_TRANSITIONS.rejected_by_user.has(record.lifecycle)) {
			throw new Error(
				`Cannot reject memory record ${memoryId}: current state '${record.lifecycle}' cannot transition to 'rejected_by_user'`,
			);
		}

		return this.transitionTo(record, "rejected_by_user", reason ?? "Rejected by user", "user");
	}

	/**
	 * Restore a rejected, expired, needs_review, disputed, or superseded
	 * memory record back to candidate state for re-evaluation.
	 *
	 * This allows previously rejected or expired memories to be
	 * reconsidered. The record is set to candidate so it goes through
	 * the normal activation flow again. Active records should use
	 * deactivate() instead.
	 *
	 * Valid source states: rejected_by_user, expired, superseded, needs_review, disputed
	 *
	 * @param memoryId - The ID of the memory record to restore.
	 * @param reason - Optional human-readable reason for the restoration.
	 * @returns The updated MemoryRecord.
	 * @throws If the record does not exist or the transition is invalid.
	 */
	async restore(memoryId: string, reason?: string): Promise<MemoryRecord> {
		const record = await this.getRecordOrThrow(memoryId);

		if (!ALLOWED_TRANSITIONS.candidate.has(record.lifecycle)) {
			throw new Error(
				`Cannot restore memory record ${memoryId}: current state '${record.lifecycle}' cannot transition to 'candidate'`,
			);
		}

		// Clear supersededBy and expiresAt when restoring
		return this.transitionTo(record, "candidate", reason ?? `Restored from '${record.lifecycle}' state`, "user", {
			supersededBy: undefined,
			expiresAt: undefined,
		});
	}

	// -----------------------------------------------------------------------
	// Scheduled Operations
	// -----------------------------------------------------------------------

	/**
	 * Check for and expire memory records whose TTL has passed.
	 *
	 * Scans all active records and transitions those whose expiresAt
	 * timestamp is in the past to the expired state.
	 *
	 * @returns Array of records that were expired.
	 */
	async checkExpired(): Promise<MemoryRecord[]> {
		const now = Date.now();
		const expiredRecords: MemoryRecord[] = [];

		// Find all active records via the store's lifecycle index
		const activeRecords = await this.memoryStore.findByLifecycle("active");

		for (const record of activeRecords) {
			if (record.expiresAt && new Date(record.expiresAt).getTime() <= now) {
				const expired = await this.transitionTo(record, "expired", `TTL expired at ${record.expiresAt}`, "system", {
					expiresAt: undefined,
				});
				expiredRecords.push(expired);
			}
		}

		return expiredRecords;
	}

	/**
	 * Check for active records with low confidence that need review.
	 *
	 * Scans all active records and transitions those whose confidence
	 * is below the needsReviewConfidence threshold to the needs_review
	 * state.
	 *
	 * @returns Array of records that were flagged for review.
	 */
	async checkNeedsReview(): Promise<MemoryRecord[]> {
		const flaggedRecords: MemoryRecord[] = [];

		// Find all active records via the store's lifecycle index
		const activeRecords = await this.memoryStore.findByLifecycle("active");

		for (const record of activeRecords) {
			if (record.confidence < this.config.needsReviewConfidence) {
				const flagged = await this.transitionTo(
					record,
					"needs_review",
					`Confidence ${record.confidence} below review threshold ${this.config.needsReviewConfidence}`,
					"policy",
				);
				flaggedRecords.push(flagged);
			}
		}

		return flaggedRecords;
	}

	/**
	 * Run a full expiration check: expire old records and flag low-confidence
	 * records for review.
	 *
	 * This is the primary method to call from scheduled tasks or cron jobs.
	 * It returns all transitions that were applied.
	 *
	 * @returns Array of all LifecycleTransition events from this check.
	 */
	async runExpirationCheck(): Promise<LifecycleTransition[]> {
		const _transitions: LifecycleTransition[] = [];

		// Collect transition events by wrapping the onTransition callback
		const collectedTransitions: LifecycleTransition[] = [];
		const collector = (t: LifecycleTransition) => {
			collectedTransitions.push(t);
		};

		this.onTransition(collector);

		try {
			await this.checkExpired();
			await this.checkNeedsReview();
		} finally {
			// Remove the collector callback
			const idx = this.transitionCallbacks.indexOf(collector);
			if (idx !== -1) {
				this.transitionCallbacks.splice(idx, 1);
			}
		}

		return collectedTransitions;
	}

	// -----------------------------------------------------------------------
	// Private Helpers
	// -----------------------------------------------------------------------

	/**
	 * Retrieve a record from the store or throw if not found.
	 */
	private async getRecordOrThrow(memoryId: string): Promise<MemoryRecord> {
		const record = await this.memoryStore.get(memoryId);
		if (!record) {
			throw new Error(`MemoryRecord not found: ${memoryId}`);
		}
		return record;
	}

	/**
	 * Execute a state transition: update the record, emit the event.
	 *
	 * @param record - The current record (before transition).
	 * @param toState - The target lifecycle state.
	 * @param reason - Human-readable reason for the transition.
	 * @param triggeredBy - Who or what triggered the transition.
	 * @param extraUpdates - Additional field updates to apply alongside the state change.
	 * @returns The updated record.
	 */
	private async transitionTo(
		record: MemoryRecord,
		toState: MemoryLifecycle,
		reason: string,
		triggeredBy: "system" | "user" | "policy",
		extraUpdates: Partial<MemoryRecord> = {},
	): Promise<MemoryRecord> {
		const fromState = record.lifecycle;

		const updated = await this.memoryStore.update(record.id, {
			lifecycle: toState,
			...extraUpdates,
		});

		const transition: LifecycleTransition = {
			memoryId: record.id,
			fromState,
			toState,
			reason,
			triggeredBy,
			timestamp: new Date().toISOString(),
		};

		// Notify all registered callbacks
		for (const callback of this.transitionCallbacks) {
			try {
				callback(transition);
			} catch {
				// Swallow callback errors to prevent one bad callback from
				// breaking the entire transition flow
			}
		}

		return updated;
	}
}
