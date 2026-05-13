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
// EditAttemptTracker
// ---------------------------------------------------------------------------

/**
 * Tracks edit attempts per file within a plan execution / workspace context.
 *
 * Maintains an in-memory map of composite keys to arrays of edit attempt records.
 * Detects when the same-file edit failure threshold is reached and signals that
 * a handoff should occur.
 *
 * State can be serialized to/deserialized from workspace metadata for persistence.
 */
export class EditAttemptTracker {
	private attempts: Map<string, EditAttemptRecord[]> = new Map();
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
		this.addRecord(buildKey(planExecId, workspaceId, filePath), record);
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
	 * Clear all tracked attempts.
	 */
	clear(): void {
		this.attempts.clear();
	}

	/**
	 * Clear tracked attempts for a specific file.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 */
	clearFile(planExecId: string, workspaceId: string, filePath: string): void {
		this.attempts.delete(buildKey(planExecId, workspaceId, filePath));
	}

	/**
	 * Serialize the tracker state to a JSON-compatible object.
	 *
	 * @returns Serialized state
	 */
	serialize(): Record<string, EditAttemptRecord[]> {
		const result: Record<string, EditAttemptRecord[]> = {};
		for (const [key, records] of this.attempts) {
			result[key] = records;
		}
		return result;
	}

	/**
	 * Restore tracker state from a serialized object.
	 *
	 * @param data - Previously serialized state
	 */
	deserialize(data: Record<string, EditAttemptRecord[]>): void {
		this.attempts.clear();
		for (const [key, records] of Object.entries(data)) {
			this.attempts.set(key, records);
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
