/**
 * Edit Audit Events - Makes edit strategy decisions, failures, and token-waste prevention visible.
 *
 * P4.5 Workstream 4.5.E: Provides audit event emission for:
 * - edit_strategy_selected
 * - edit_strategy_blocked
 * - full_rewrite_attempted
 * - edit_truncation_detected
 * - edit_exact_match_failed
 * - patch_fallback_forced
 * - edit_failure_handoff
 * - token_waste_prevented
 *
 * Events are emitted on the EventBus and can be archived for reporting.
 */

import type {
	EditAuditEventPayload,
	EditAuditEventType,
	EditFailureType,
	EditStrategyMode,
	EditStrategyReasonCode,
} from "./edit-strategy-types.js";
import type { EventBus } from "./event-bus.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Event channel for all edit strategy audit events. */
export const EDIT_AUDIT_CHANNEL = "edit_strategy_audit";

// ---------------------------------------------------------------------------
// EditAuditEventEmitter
// ---------------------------------------------------------------------------

/**
 * Emits structured audit events for all edit strategy decisions, failures,
 * fallbacks, and handoffs. Events are emitted on the EventBus and can be
 * consumed by dashboards, logging, and reporting systems.
 *
 * Each event includes planExecId, workspaceId, filePath, mode, strategy,
 * lineCount, byteSize, attemptNumber, failureType, and reasonCode.
 */
export class EditAuditEventEmitter {
	private eventBus: EventBus | undefined;
	private eventLog: EditAuditEventPayload[] = [];

	constructor(options?: { eventBus?: EventBus }) {
		this.eventBus = options?.eventBus;
	}

	/**
	 * Emit an edit_strategy_selected event.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param mode - Selected edit strategy mode
	 * @param lineCount - Line count of the file
	 * @param byteSize - Byte size of the file
	 */
	emitStrategySelected(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		mode: EditStrategyMode,
		lineCount?: number,
		byteSize?: number,
	): void {
		this.emit({
			eventType: "edit_strategy_selected",
			planExecId,
			workspaceId,
			filePath,
			mode,
			lineCount,
			byteSize,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit an edit_strategy_blocked event.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param mode - Current edit strategy mode
	 * @param reasonCode - Reason code for blocking
	 * @param lineCount - Line count of the file
	 * @param byteSize - Byte size of the file
	 */
	emitStrategyBlocked(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		mode: EditStrategyMode,
		reasonCode: EditStrategyReasonCode,
		lineCount?: number,
		byteSize?: number,
	): void {
		this.emit({
			eventType: "edit_strategy_blocked",
			planExecId,
			workspaceId,
			filePath,
			mode,
			reasonCode,
			lineCount,
			byteSize,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit a full_rewrite_attempted event.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param mode - Current edit strategy mode
	 * @param lineCount - Line count of the file
	 * @param byteSize - Byte size of the file
	 */
	emitFullRewriteAttempted(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		mode: EditStrategyMode,
		lineCount?: number,
		byteSize?: number,
	): void {
		this.emit({
			eventType: "full_rewrite_attempted",
			planExecId,
			workspaceId,
			filePath,
			mode,
			strategy: "full_write",
			lineCount,
			byteSize,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit an edit_truncation_detected event.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param mode - Current edit strategy mode
	 * @param attemptNumber - Attempt number
	 */
	emitTruncationDetected(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		mode: EditStrategyMode,
		attemptNumber?: number,
	): void {
		this.emit({
			eventType: "edit_truncation_detected",
			planExecId,
			workspaceId,
			filePath,
			mode,
			strategy: "full_write",
			failureType: "truncation",
			attemptNumber,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit an edit_exact_match_failed event.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param mode - Current edit strategy mode
	 * @param attemptNumber - Attempt number
	 */
	emitExactMatchFailed(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		mode: EditStrategyMode,
		attemptNumber?: number,
	): void {
		this.emit({
			eventType: "edit_exact_match_failed",
			planExecId,
			workspaceId,
			filePath,
			mode,
			strategy: "targeted_edit",
			failureType: "exact_match_failed",
			attemptNumber,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit a patch_fallback_forced event.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param mode - Current edit strategy mode
	 * @param reasonCode - Reason code for fallback
	 */
	emitPatchFallbackForced(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		mode: EditStrategyMode,
		reasonCode?: EditStrategyReasonCode,
	): void {
		this.emit({
			eventType: "patch_fallback_forced",
			planExecId,
			workspaceId,
			filePath,
			mode,
			strategy: "targeted_edit",
			reasonCode,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit an edit_failure_handoff event.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param mode - Current edit strategy mode
	 * @param failureType - Primary failure type
	 */
	emitFailureHandoff(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		mode: EditStrategyMode,
		failureType?: EditFailureType,
	): void {
		this.emit({
			eventType: "edit_failure_handoff",
			planExecId,
			workspaceId,
			filePath,
			mode,
			failureType,
			timestamp: Date.now(),
		});
	}

	/**
	 * Emit a token_waste_prevented event.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param filePath - Relative file path
	 * @param mode - Current edit strategy mode
	 * @param reasonCode - Reason for prevention
	 */
	emitTokenWastePrevented(
		planExecId: string,
		workspaceId: string,
		filePath: string,
		mode: EditStrategyMode,
		reasonCode: EditStrategyReasonCode,
	): void {
		this.emit({
			eventType: "token_waste_prevented",
			planExecId,
			workspaceId,
			filePath,
			mode,
			reasonCode,
			timestamp: Date.now(),
		});
	}

	/**
	 * Get all events that have been emitted.
	 *
	 * @returns Array of emitted event payloads
	 */
	getEventLog(): EditAuditEventPayload[] {
		return [...this.eventLog];
	}

	/**
	 * Get events filtered by type.
	 *
	 * @param eventType - Event type to filter by
	 * @returns Filtered events
	 */
	getEventsByType(eventType: EditAuditEventType): EditAuditEventPayload[] {
		return this.eventLog.filter((e) => e.eventType === eventType);
	}

	/**
	 * Generate a final summary of edit strategy events.
	 *
	 * @returns Summary object
	 */
	generateSummary(): EditStrategyAuditSummary {
		const summary: EditStrategyAuditSummary = {
			editModeUsed: undefined,
			blockedRewrites: 0,
			truncationEvents: 0,
			exactMatchFailures: 0,
			handoffs: 0,
			estimatedWastePrevented: 0,
		};

		for (const event of this.eventLog) {
			switch (event.eventType) {
				case "edit_strategy_selected":
					summary.editModeUsed = event.mode;
					break;
				case "edit_strategy_blocked":
					summary.blockedRewrites++;
					summary.estimatedWastePrevented++;
					break;
				case "edit_truncation_detected":
					summary.truncationEvents++;
					break;
				case "edit_exact_match_failed":
					summary.exactMatchFailures++;
					break;
				case "edit_failure_handoff":
					summary.handoffs++;
					break;
				case "token_waste_prevented":
					summary.estimatedWastePrevented++;
					break;
			}
		}

		return summary;
	}

	/**
	 * Clear the event log.
	 */
	clear(): void {
		this.eventLog = [];
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	/**
	 * Emit an event to both the event bus and the internal log.
	 */
	private emit(payload: EditAuditEventPayload): void {
		this.eventLog.push(payload);

		if (this.eventBus) {
			this.eventBus.emit(EDIT_AUDIT_CHANNEL, payload);
		}
	}
}

// ---------------------------------------------------------------------------
// Summary Types
// ---------------------------------------------------------------------------

/**
 * Summary of edit strategy audit events for a plan execution.
 */
export interface EditStrategyAuditSummary {
	/** Edit mode used during execution */
	editModeUsed: EditStrategyMode | undefined;
	/** Number of blocked full rewrites */
	blockedRewrites: number;
	/** Number of truncation events */
	truncationEvents: number;
	/** Number of exact-match edit failures */
	exactMatchFailures: number;
	/** Number of edit failure handoffs */
	handoffs: number;
	/** Estimated number of token-waste events prevented */
	estimatedWastePrevented: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an EditAuditEventEmitter instance.
 *
 * @param options - Emitter configuration
 * @returns EditAuditEventEmitter instance
 */
export function createEditAuditEventEmitter(options?: { eventBus?: EventBus }): EditAuditEventEmitter {
	return new EditAuditEventEmitter(options);
}
