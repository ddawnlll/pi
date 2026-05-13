/**
 * Edit Attempt Tracker - Tracks edit attempts per file for failure detection and handoff.
 *
 * P4.5 Workstream 4.5.C: Tracks edit attempts per {planExecId, workspaceId, filePath},
 * records attempt type and failure type, detects when the same-file failure threshold
 * is reached, and persists state in workspace metadata.
 */

import type { EditAttemptRecord, EditAttemptType, EditFailureType, FileEditSummary } from "./edit-strategy-types.js";

// ---------------------------------------------------------------------------
// Key Construction
// ---------------------------------------------------------------------------

/**
 * Build a composite key for tracking attempts per file.
 *
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param filePath - Relative file path
 * @returns Composite key string
 */
function buildKey(planExecId: string, workspaceId: string, filePath: string): string {
	return `${planExecId}:${workspaceId}:${filePath}`;
}

// ---------------------------------------------------------------------------
// Serialization Types
// ---------------------------------------------------------------------------

/**
 * Serialized state of the EditAttemptTracker for workspace metadata persistence.
 */
export interface EditAttemptTrackerSerializedState {
	/** Serialized attempt records keyed by composite key. */
	attempts: Record<string, EditAttemptRecord[]>;
	/** Set of composite keys where patch mode is forced. */
	forcedPatchKeys: string[];
	/** Current handoff threshold. */
	handoffThreshold: number;
	/** Whether exact-match failures count toward handoff. */
	exactMatchCountsTowardHandoff: boolean;
}

// ---------------------------------------------------------------------------
// EditAttemptTracker
// ---------------------------------------------------------------------------

/**
 * Tracks edit attempts per file within a plan execution / workspace context.
 *
 * Maintains an in-memory map of composite keys to arrays of edit attempt records.
 * Detects when the same-file edit failure threshold is reached and signals that
 * a handoff should occur.
 *
 * P4.5 Workstream 4.5.C enhancements:
 * - Truncation markers force patch mode for the file
 * - Second full-write attempt after truncation is blocked
 * - Git checkout restore after failed write forces patch mode
 * - Targeted edits remain allowed after forced patch mode
 * - Tracker state persists in workspace metadata via serialize/deserialize
 *
 * State can be serialized to/deserialized from workspace metadata for persistence.
 */
export class EditAttemptTracker {
	private attempts: Map<string, EditAttemptRecord[]> = new Map();
	/** Tracks files that have been forced into patch mode. */
	private forcedPatchKeys: Set<string> = new Set();
	private handoffThreshold: number;
	private exactMatchCountsTowardHandoff: boolean;

	constructor(options?: { handoffThreshold?: number; exactMatchCountsTowardHandoff?: boolean }) {
		this.handoffThreshold = options?.handoffThreshold ?? 2;
		this.exactMatchCountsTowardHandoff = options?.exactMatchCountsTowardHandoff ?? true;
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	/**
	 * Record a successful edit attempt.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param attemptType - Type of edit attempt
	 * @returns The created record
	 */
	recordSuccess(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		attemptType: EditAttemptType,
	): EditAttemptRecord {
		const record = this.createRecord(planExecId, workspaceId, filePath, attemptType, true);
		this.addRecord(buildKey(planExecId, workspaceId, filePath), record);
		return record;
	}

	/**
	 * Record a failed edit attempt.
	 *
	 * When the failure is a truncation or a restore_after_failed_write,
	 * automatically forces patch mode for the file.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param attemptType - Type of edit attempt
	 * @param failureType - Type of failure
	 * @param errorMessage - Error message from the tool (optional)
	 * @returns The created record
	 */
	recordFailure(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		attemptType: EditAttemptType,
		failureType: EditFailureType,
		errorMessage?: string,
	): EditAttemptRecord {
		const record = this.createRecord(
			planExecId,
			workspaceId,
			filePath,
			attemptType,
			false,
			failureType,
			errorMessage,
		);
		const key = buildKey(planExecId, workspaceId, filePath);
		this.addRecord(key, record);

		// P4.5 Workstream 4.5.C: Truncation markers force patch mode
		if (failureType === "truncation") {
			this.forcePatchMode(planExecId, workspaceId, filePath);
		}

		// P4.5 Workstream 4.5.C: git checkout restore after failed write forces patch mode
		if (failureType === "restore_after_failed_write") {
			this.forcePatchMode(planExecId, workspaceId, filePath);
		}

		return record;
	}

	/**
	 * Get all edit attempt records for a specific file.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @returns Array of edit attempt records
	 */
	getAttempts(planExecId: string, workspaceId: string, filePath: string): EditAttemptRecord[] {
		const key = buildKey(planExecId, workspaceId, filePath);
		return this.attempts.get(key) ?? [];
	}

	/**
	 * Get a summary of edit attempts for a specific file.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @returns File edit summary
	 */
	getSummary(planExecId: string, workspaceId: string, filePath: string): FileEditSummary {
		const attempts = this.getAttempts(planExecId, workspaceId, filePath);
		const failedAttempts = this.countFailures(planExecId, workspaceId, filePath);

		return {
			filePath,
			totalAttempts: attempts.length,
			failedAttempts,
			attempts,
			reachedHandoffThreshold: this.hasReachedHandoffThreshold(planExecId, workspaceId, filePath),
		};
	}

	/**
	 * Count failed edit attempts for a specific file.
	 *
	 * Only counts failures that are relevant to the handoff threshold:
	 * - All failures count except exact_match_failed when
	 *   exactMatchCountsTowardHandoff is false.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @returns Number of failed edit attempts
	 */
	countFailures(planExecId: string, workspaceId: string, filePath: string): number {
		const attempts = this.getAttempts(planExecId, workspaceId, filePath);
		return attempts.filter((a) => {
			if (a.succeeded) return false;
			if (!this.exactMatchCountsTowardHandoff && a.failureType === "exact_match_failed") {
				return false;
			}
			return true;
		}).length;
	}

	/**
	 * Check whether the same-file edit failure threshold has been reached.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @returns True if the handoff threshold has been reached
	 */
	hasReachedHandoffThreshold(planExecId: string, workspaceId: string, filePath: string): boolean {
		return this.countFailures(planExecId, workspaceId, filePath) >= this.handoffThreshold;
	}

	/**
	 * Get the last failed edit attempt for a file.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @returns The last failed record, or undefined if none
	 */
	getLastFailure(planExecId: string, workspaceId: string, filePath: string): EditAttemptRecord | undefined {
		const attempts = this.getAttempts(planExecId, workspaceId, filePath);
		for (let i = attempts.length - 1; i >= 0; i--) {
			if (!attempts[i].succeeded) {
				return attempts[i];
			}
		}
		return undefined;
	}

	/**
	 * Get the last error message for a file.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @returns The last error message, or undefined
	 */
	getLastErrorMessage(planExecId: string, workspaceId: string, filePath: string): string | undefined {
		return this.getLastFailure(planExecId, workspaceId, filePath)?.errorMessage;
	}

	/**
	 * Get all file paths that have reached the handoff threshold.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @returns Array of file paths
	 */
	getBlockedFiles(planExecId: string, workspaceId: string): string[] {
		const blocked: string[] = [];
		const prefix = `${planExecId}:${workspaceId}:`;

		for (const [key, _attempts] of this.attempts) {
			if (key.startsWith(prefix)) {
				const filePath = key.slice(prefix.length);
				if (this.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)) {
					blocked.push(filePath);
				}
			}
		}

		return blocked;
	}

	/**
	 * Force patch mode for a specific file.
	 *
	 * Once patch mode is forced, full_writes are blocked for that file,
	 * but targeted_edit attempts remain allowed.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 */
	forcePatchMode(planExecId: string, workspaceId: string, filePath: string): void {
		const key = buildKey(planExecId, workspaceId, filePath);
		this.forcedPatchKeys.add(key);
	}

	/**
	 * Check whether patch mode has been forced for a specific file.
	 *
	 * Returns true if the file has a truncation or restore_after_failed_write
	 * failure recorded, which forces patch mode.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @returns True if patch mode is forced for this file
	 */
	isPatchModeForced(planExecId: string, workspaceId: string, filePath: string): boolean {
		const key = buildKey(planExecId, workspaceId, filePath);
		return this.forcedPatchKeys.has(key);
	}

	/**
	 * Check whether a full write is allowed for a specific file.
	 *
	 * A full write is blocked if:
	 * - Patch mode has been forced for the file (due to truncation or restore)
	 * - The handoff threshold has been reached for the file
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @returns Object indicating whether full write is allowed and why
	 */
	isFullWriteAllowed(planExecId: string, workspaceId: string, filePath: string): { allowed: boolean; reason: string } {
		if (this.isPatchModeForced(planExecId, workspaceId, filePath)) {
			return {
				allowed: false,
				reason: `Full write blocked for "${filePath}": patch mode forced due to previous truncation or restore failure. Use targeted edits instead.`,
			};
		}

		if (this.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)) {
			return {
				allowed: false,
				reason: `Full write blocked for "${filePath}": same-file edit failure threshold reached. Manual intervention required.`,
			};
		}

		return { allowed: true, reason: "" };
	}

	/**
	 * Check whether a targeted edit is allowed for a specific file.
	 *
	 * Targeted edits remain allowed even when patch mode is forced
	 * or the handoff threshold is reached, since targeted edits are
	 * the recommended fallback strategy.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @returns True - targeted edits are always allowed
	 */
	isTargetedEditAllowed(_planExecId: string, _workspaceId: string, _filePath: string): boolean {
		return true;
	}

	/**
	 * Get all file paths that have patch mode forced within a plan/workspace.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @returns Array of file paths with forced patch mode
	 */
	getForcedPatchFiles(planExecId: string, workspaceId: string): string[] {
		const prefix = `${planExecId}:${workspaceId}:`;
		const result: string[] = [];

		for (const key of this.forcedPatchKeys) {
			if (key.startsWith(prefix)) {
				result.push(key.slice(prefix.length));
			}
		}

		return result;
	}

	/**
	 * Clear all tracked attempts and forced patch state.
	 */
	clear(): void {
		this.attempts.clear();
		this.forcedPatchKeys.clear();
	}

	/**
	 * Clear tracked attempts and forced patch state for a specific file.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 */
	clearFile(planExecId: string, workspaceId: string, filePath: string): void {
		const key = buildKey(planExecId, workspaceId, filePath);
		this.attempts.delete(key);
		this.forcedPatchKeys.delete(key);
	}

	/**
	 * Serialize the tracker state to a JSON-compatible object for workspace metadata.
	 *
	 * Includes both attempt records and forced patch mode state.
	 *
	 * @returns Serialized state suitable for storing in workspace metadata
	 */
	serialize(): EditAttemptTrackerSerializedState {
		const attempts: Record<string, EditAttemptRecord[]> = {};
		for (const [key, records] of this.attempts) {
			attempts[key] = records;
		}
		return {
			attempts,
			forcedPatchKeys: Array.from(this.forcedPatchKeys),
			handoffThreshold: this.handoffThreshold,
			exactMatchCountsTowardHandoff: this.exactMatchCountsTowardHandoff,
		};
	}

	/**
	 * Restore tracker state from a serialized object.
	 *
	 * Supports both the new EditAttemptTrackerSerializedState format and
	 * the legacy Record<string, EditAttemptRecord[]> format for backward compat.
	 *
	 * @param data - Previously serialized state
	 */
	deserialize(data: EditAttemptTrackerSerializedState | Record<string, EditAttemptRecord[]>): void {
		this.attempts.clear();
		this.forcedPatchKeys.clear();

		// Support legacy format: Record<string, EditAttemptRecord[]>
		if ("attempts" in data && typeof data.attempts === "object" && !Array.isArray(data.attempts)) {
			const typedData = data as EditAttemptTrackerSerializedState;
			for (const [key, records] of Object.entries(typedData.attempts)) {
				this.attempts.set(key, records);
			}
			for (const key of typedData.forcedPatchKeys ?? []) {
				this.forcedPatchKeys.add(key);
			}
			if (typedData.handoffThreshold !== undefined) {
				this.handoffThreshold = typedData.handoffThreshold;
			}
			if (typedData.exactMatchCountsTowardHandoff !== undefined) {
				this.exactMatchCountsTowardHandoff = typedData.exactMatchCountsTowardHandoff;
			}
		} else {
			// Legacy format: direct Record<string, EditAttemptRecord[]>
			const legacyData = data as Record<string, EditAttemptRecord[]>;
			for (const [key, records] of Object.entries(legacyData)) {
				this.attempts.set(key, records);
			}
		}
	}

	/**
	 * Get the current handoff threshold.
	 */
	getHandoffThreshold(): number {
		return this.handoffThreshold;
	}

	/**
	 * Update the handoff threshold.
	 *
	 * @param threshold - New handoff threshold
	 */
	setHandoffThreshold(threshold: number): void {
		this.handoffThreshold = Math.max(1, threshold);
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	/**
	 * Create a new edit attempt record.
	 */
	private createRecord(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		attemptType: EditAttemptType,
		succeeded: boolean,
		failureType?: EditFailureType,
		errorMessage?: string,
	): EditAttemptRecord {
		const existingAttempts = this.getAttempts(planExecId, workspaceId, filePath);
		return {
			id: `attempt-${existingAttempts.length + 1}-${Date.now()}`,
			planExecId,
			workspaceId,
			filePath,
			attemptType,
			failureType,
			succeeded,
			timestamp: Date.now(),
			errorMessage,
		};
	}

	/**
	 * Add a record to the tracking map.
	 */
	private addRecord(key: string, record: EditAttemptRecord): void {
		const existing = this.attempts.get(key) ?? [];
		existing.push(record);
		this.attempts.set(key, existing);
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an EditAttemptTracker instance.
 *
 * @param options - Tracker configuration options
 * @returns EditAttemptTracker instance
 */
export function createEditAttemptTracker(options?: {
	handoffThreshold?: number;
	exactMatchCountsTowardHandoff?: boolean;
}): EditAttemptTracker {
	return new EditAttemptTracker(options);
}
