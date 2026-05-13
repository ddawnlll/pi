/**
 * Edit Failure Handoff - Stops the workspace cleanly when Pi gets stuck editing the same file.
 *
 * P4.5 Workstream 4.5.D: When sameFileEditFailures >= threshold (default 2),
 * marks the workspace as BLOCKED_EDIT_FAILURE, emits an edit_failure_handoff event,
 * and provides a handoff payload with diff, failed attempts, snapshot/restore
 * option, and resume guidance.
 */

import type { EditAttemptTracker } from "./edit-attempt-tracker.js";
import type { EditAttemptRecord, EditFailureHandoffPayload, EditStrategyMode } from "./edit-strategy-types.js";
import type { EventBus } from "./event-bus.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Event channel name for edit failure handoff events. */
export const EDIT_FAILURE_HANDOFF_CHANNEL = "edit_failure_handoff";

/** Workspace blocked reason for edit failure. */
export const BLOCKED_REASON_EDIT_FAILURE = "BLOCKED_EDIT_FAILURE";

// ---------------------------------------------------------------------------
// Handoff Event Data
// ---------------------------------------------------------------------------

/**
 * Event data emitted when a workspace is blocked due to edit failure.
 */
export interface EditFailureHandoffEvent {
	/** Plan execution ID */
	planExecId: string;
	/** Workspace ID */
	workspaceId: string;
	/** File path that caused the handoff */
	filePath: string;
	/** Selected edit mode at time of handoff */
	selectedEditMode: EditStrategyMode;
	/** Number of failed attempts */
	failedAttemptCount: number;
	/** Last tool error */
	lastToolError: string | undefined;
	/** Blocked reason string */
	blockedReason: typeof BLOCKED_REASON_EDIT_FAILURE;
	/** Full handoff payload */
	payload: EditFailureHandoffPayload;
}

// ---------------------------------------------------------------------------
// EditFailureHandoff
// ---------------------------------------------------------------------------

/**
 * Manages the failure handoff flow when a workspace gets stuck editing
 * the same file.
 *
 * When the edit attempt tracker indicates that the handoff threshold has
 * been reached for a file, this module:
 * 1. Marks the workspace as BLOCKED_EDIT_FAILURE
 * 2. Constructs a handoff payload with all relevant information
 * 3. Emits an edit_failure_handoff event on the event bus
 * 4. Returns the handoff payload for dashboard/CLI display
 */
export class EditFailureHandoff {
	private attemptTracker: EditAttemptTracker;
	private eventBus: EventBus | undefined;

	constructor(options: { attemptTracker: EditAttemptTracker; eventBus?: EventBus }) {
		this.attemptTracker = options.attemptTracker;
		this.eventBus = options.eventBus;
	}

	/**
	 * Check if a file should trigger a handoff and perform the handoff if so.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param editMode - Current edit strategy mode
	 * @param currentDiff - Current unified diff of the file
	 * @param preEditSnapshotPath - Path to pre-edit snapshot file
	 * @returns Handoff payload if threshold reached, null otherwise
	 */
	checkAndHandoff(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		editMode: EditStrategyMode,
		currentDiff: string,
		preEditSnapshotPath: string | undefined,
	): EditFailureHandoffPayload | null {
		if (!this.attemptTracker.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)) {
			return null;
		}

		const summary = this.attemptTracker.getSummary(planExecId, workspaceId, filePath);
		const lastFailure = this.attemptTracker.getLastFailure(planExecId, workspaceId, filePath);

		const payload: EditFailureHandoffPayload = {
			filePath,
			selectedEditMode: editMode,
			failedStrategyList: summary.attempts
				.filter((a) => !a.succeeded)
				.map((a) => ({
					attemptType: a.attemptType,
					failureType: a.failureType ?? "truncation",
					errorMessage: a.errorMessage,
				})),
			lastToolError: lastFailure?.errorMessage,
			preEditSnapshotPath,
			currentDiff,
			attemptedPatchSummary: this.buildPatchSummary(summary.attempts),
			suggestedManualFixSteps: this.buildSuggestedFixSteps(summary.attempts, editMode),
			suggestedResumeInstruction: this.buildResumeInstruction(filePath, editMode),
		};

		// Emit handoff event
		this.emitHandoffEvent(planExecId, workspaceId, editMode, payload);

		return payload;
	}

	/**
	 * Manually trigger a handoff for a file, regardless of threshold.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param editMode - Current edit strategy mode
	 * @param currentDiff - Current unified diff
	 * @param preEditSnapshotPath - Path to pre-edit snapshot
	 * @param reason - Reason for manual handoff
	 * @returns Handoff payload
	 */
	forceHandoff(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		editMode: EditStrategyMode,
		currentDiff: string,
		preEditSnapshotPath: string | undefined,
		reason: string,
	): EditFailureHandoffPayload {
		const summary = this.attemptTracker.getSummary(planExecId, workspaceId, filePath);
		const lastFailure = this.attemptTracker.getLastFailure(planExecId, workspaceId, filePath);

		const payload: EditFailureHandoffPayload = {
			filePath,
			selectedEditMode: editMode,
			failedStrategyList: summary.attempts
				.filter((a) => !a.succeeded)
				.map((a) => ({
					attemptType: a.attemptType,
					failureType: a.failureType ?? "truncation",
					errorMessage: a.errorMessage,
				})),
			lastToolError: reason || lastFailure?.errorMessage,
			preEditSnapshotPath,
			currentDiff,
			attemptedPatchSummary: this.buildPatchSummary(summary.attempts),
			suggestedManualFixSteps: this.buildSuggestedFixSteps(summary.attempts, editMode),
			suggestedResumeInstruction: this.buildResumeInstruction(filePath, editMode),
		};

		this.emitHandoffEvent(planExecId, workspaceId, editMode, payload);

		return payload;
	}

	/**
	 * Build a human-readable summary of attempted patches.
	 */
	private buildPatchSummary(attempts: EditAttemptRecord[]): string {
		const failed = attempts.filter((a) => !a.succeeded);
		if (failed.length === 0) {
			return "No failed edit attempts recorded.";
		}

		const lines: string[] = [];
		for (const attempt of failed) {
			const typeLabel = attempt.attemptType.replace(/_/g, " ");
			const failureLabel = attempt.failureType?.replace(/_/g, " ") ?? "unknown";
			lines.push(
				`- ${typeLabel} failed (${failureLabel})${attempt.errorMessage ? `: ${attempt.errorMessage.slice(0, 200)}` : ""}`,
			);
		}

		return lines.join("; ");
	}

	/**
	 * Build suggested manual fix steps based on the failure types.
	 */
	private buildSuggestedFixSteps(attempts: EditAttemptRecord[], editMode: EditStrategyMode): string[] {
		const steps: string[] = [];
		const failureTypes = new Set(attempts.filter((a) => !a.succeeded).map((a) => a.failureType));

		if (failureTypes.has("truncation")) {
			steps.push(
				"The file was truncated during a full rewrite. Manually edit the specific sections that need changes using targeted patches.",
			);
			steps.push("If sections are at the end of the file, check for missing closing brackets or incomplete code.");
		}

		if (failureTypes.has("exact_match_failed")) {
			steps.push(
				"The exact-match patch failed. Check for whitespace differences, tab/space mismatches, or trailing newlines in the original file.",
			);
			steps.push(
				"Read the file again to get the exact current content, then apply a new targeted edit with the correct oldText.",
			);
		}

		if (failureTypes.has("output_too_large")) {
			steps.push("The output was too large. Split the edit into smaller targeted patches.");
		}

		if (failureTypes.has("malformed_patch")) {
			steps.push("The patch was malformed. Ensure edit operations have valid oldText and newText fields.");
		}

		if (failureTypes.has("validation_failed_after_edit")) {
			steps.push(
				"The edit was applied but validation failed. Check for type errors or lint issues in the modified file.",
			);
		}

		if (failureTypes.has("restore_after_failed_write")) {
			steps.push(
				"A previous write was restored after failure. Verify the restored file is in a good state before proceeding.",
			);
		}

		if (editMode === "token_saving") {
			steps.push(
				"Consider switching to Hybrid or Speed mode for this file to allow full rewrites if the file is reasonably sized.",
			);
		}

		if (steps.length === 0) {
			steps.push("Review the failed edit attempts and manually correct the file.");
			steps.push("Resume the workspace after making the manual fix.");
		}

		return steps;
	}

	/**
	 * Build a suggested resume instruction.
	 */
	private buildResumeInstruction(filePath: string, editMode: EditStrategyMode): string {
		if (editMode === "token_saving") {
			return `After manually fixing "${filePath}", resume the workspace. Consider switching to hybrid mode if full rewrites would be more efficient.`;
		}
		if (editMode === "speed") {
			return `After manually fixing "${filePath}", resume the workspace. The speed mode hard safety gate may have blocked the edit; verify the file is under the line limit.`;
		}
		return `After manually fixing "${filePath}", resume the workspace. The edit strategy will retry with targeted patches.`;
	}

	/**
	 * Emit the handoff event on the event bus.
	 */
	private emitHandoffEvent(
		planExecId: string,
		workspaceId: string,
		editMode: EditStrategyMode,
		payload: EditFailureHandoffPayload,
	): void {
		if (!this.eventBus) return;

		const eventData: EditFailureHandoffEvent = {
			planExecId,
			workspaceId,
			filePath: payload.filePath,
			selectedEditMode: editMode,
			failedAttemptCount: payload.failedStrategyList.length,
			lastToolError: payload.lastToolError,
			blockedReason: BLOCKED_REASON_EDIT_FAILURE,
			payload,
		};

		this.eventBus.emit(EDIT_FAILURE_HANDOFF_CHANNEL, eventData);
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an EditFailureHandoff instance.
 *
 * @param options - Handoff configuration
 * @returns EditFailureHandoff instance
 */
export function createEditFailureHandoff(options: {
	attemptTracker: EditAttemptTracker;
	eventBus?: EventBus;
}): EditFailureHandoff {
	return new EditFailureHandoff(options);
}
