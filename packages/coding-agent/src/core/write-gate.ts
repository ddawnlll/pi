/**
 * Write Gate - Guards full-writes to existing large files.
 *
 * P4.5: Before the write tool overwrites an existing file, the write gate consults
 * the EditStrategyPolicy to decide whether a full rewrite is allowed or
 * whether only targeted edits (patches) should be used.
 *
 * Also integrates with:
 * - TruncationDetector: Detects truncation in tool output and forces fallback
 * - EditAttemptTracker: Records attempted writes and their outcomes
 * - EditAuditEventEmitter: Emits audit events for visibility
 *
 * For guarded files (existing files whose size exceeds the policy threshold),
 * the gate:
 *   1. Consults EditStrategyPolicy.checkPolicy()
 *   2. Creates a pre-write snapshot (in-memory copy of the file content)
 *   3. Blocks the full write if the policy disallows it
 *   4. Emits an "edit_strategy_blocked" event on the EventBus when blocked
 */

import { readFile as fsReadFile, stat as fsStat } from "fs/promises";
import type { EditAttemptTracker } from "./edit-attempt-tracker.js";
import type { EditAuditEventEmitter } from "./edit-audit-events.js";
import type { EditStrategyPolicy, EditStrategyReasonCode, EditStrategyResult } from "./edit-strategy-policy.js";
import type { EventBus } from "./event-bus.js";
import type { TruncationDetector } from "./truncation-detector.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a write gate check. */
export interface WriteGateResult {
	/** Whether the full write is allowed to proceed. */
	allowed: boolean;
	/** Whether this was a new-file write (always allowed). */
	isNewFile: boolean;
	/** Human-readable reason (empty when allowed). */
	reason: string;
	/** Reason code from the edit strategy policy. */
	reasonCode: EditStrategyReasonCode | undefined;
	/** Pre-write snapshot content (set for guarded existing files, even when blocked). */
	snapshot: string | undefined;
	/** Whether truncation forced fallback (P4.5). */
	truncationFallback: boolean;
	/** Whether same-file failure threshold is reached (P4.5). */
	handoffTriggered: boolean;
}

/** Event data emitted when a full write is blocked by the gate. */
export interface EditStrategyBlockedEvent {
	/** Relative or absolute path of the file. */
	filePath: string;
	/** Number of lines in the existing file. */
	existingLineCount: number;
	/** Byte size of the existing file. */
	existingByteSize: number;
	/** Reason code from the policy. */
	reasonCode: EditStrategyReasonCode;
	/** Human-readable reason. */
	reason: string;
}

/** Options for constructing a WriteGate. */
export interface WriteGateOptions {
	/** The edit strategy policy to consult. */
	policy: EditStrategyPolicy;
	/** Optional event bus for emitting edit_strategy_blocked events. */
	eventBus?: EventBus;
	/** Optional truncation detector (P4.5). */
	truncationDetector?: TruncationDetector;
	/** Optional edit attempt tracker (P4.5). */
	attemptTracker?: EditAttemptTracker;
	/** Optional audit event emitter (P4.5). */
	auditEmitter?: EditAuditEventEmitter;
	/** Plan execution ID for tracking (P4.5). */
	planExecId?: string;
	/** Workspace ID for tracking (P4.5). */
	workspaceId?: string;
	/** Custom stat function (for testing). Default: fs.stat. */
	stat?: (path: string) => Promise<{ size: number; isFile: () => boolean }>;
	/** Custom readFile function (for testing). Default: fs.readFile. */
	readFile?: (path: string) => Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Event channel name for blocked-write events. */
export const EDIT_STRATEGY_BLOCKED_CHANNEL = "edit_strategy_blocked";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count the number of lines in a string.
 *
 * Uses the same convention as the read/edit tools: split on newlines,
 * treating both LF and CRLF as line breaks.
 *
 * @param content - File content string
 * @returns Number of lines (0 for empty string, 1 for single line without newline)
 */
export function countLines(content: string): number {
	if (content.length === 0) return 0;
	const normalized = content.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	return lines.length;
}

// ---------------------------------------------------------------------------
// WriteGate
// ---------------------------------------------------------------------------

/**
 * Gate that intercepts write tool invocations and blocks full rewrites of
 * existing large files unless the EditStrategyPolicy permits them.
 *
 * P4.5 enhancements:
 * - Integrates with TruncationDetector to detect truncated writes
 * - Integrates with EditAttemptTracker to record write attempts
 * - Integrates with EditAuditEventEmitter for audit visibility
 * - Blocks writes when same-file failure threshold is reached
 * - Forces fallback after truncation detection
 */
export class WriteGate {
	private readonly policy: EditStrategyPolicy;
	private readonly eventBus: EventBus | undefined;
	private readonly truncationDetector: TruncationDetector | undefined;
	private readonly attemptTracker: EditAttemptTracker | undefined;
	private readonly auditEmitter: EditAuditEventEmitter | undefined;
	private readonly planExecId: string;
	private readonly workspaceId: string;
	private readonly statFn: (path: string) => Promise<{ size: number; isFile: () => boolean }>;
	private readonly readFileFn: (path: string) => Promise<Buffer>;

	constructor(options: WriteGateOptions) {
		this.policy = options.policy;
		this.eventBus = options.eventBus;
		this.truncationDetector = options.truncationDetector;
		this.attemptTracker = options.attemptTracker;
		this.auditEmitter = options.auditEmitter;
		this.planExecId = options.planExecId ?? "unknown";
		this.workspaceId = options.workspaceId ?? "unknown";
		this.statFn =
			options.stat ??
			((path: string) => fsStat(path) as unknown as Promise<{ size: number; isFile: () => boolean }>);
		this.readFileFn = options.readFile ?? ((path: string) => fsReadFile(path));
	}

	/**
	 * Check whether a full write to the given file path is allowed.
	 *
	 * For new files (files that don't exist on disk), the write is always allowed.
	 * For existing files, the EditStrategyPolicy is consulted. If the policy
	 * disallows a full rewrite:
	 *   - The write gate blocks the operation
	 *   - A pre-write snapshot is still created
	 *   - An "edit_strategy_blocked" event is emitted on the EventBus
	 *
	 * P4.5 additions:
	 *   - If same-file failure threshold is reached, the write is blocked
	 *   - Truncation detection can force fallback
	 *
	 * @param filePath - Absolute path to the file being written
	 * @param relativePath - Relative path (for policy and event data)
	 * @param newContentByteSize - Byte size of the content being written
	 * @param outputBudgetRemaining - Remaining output token budget (undefined = not checked)
	 * @param newLineCount - Number of lines in the new content
	 * @returns WriteGateResult indicating whether the write is allowed
	 */
	async check(
		filePath: string,
		relativePath: string,
		newContentByteSize: number = 0,
		outputBudgetRemaining?: number,
		newLineCount: number = 0,
	): Promise<WriteGateResult> {
		// P4.5: Check if same-file failure threshold is reached
		if (this.attemptTracker && this.planExecId && this.workspaceId !== "unknown") {
			if (this.attemptTracker.hasReachedHandoffThreshold(this.planExecId, this.workspaceId, relativePath)) {
				return {
					allowed: false,
					isNewFile: false,
					reason: `Cannot write "${relativePath}": same-file edit failure threshold reached. Manual intervention required.`,
					reasonCode: undefined,
					snapshot: undefined,
					truncationFallback: false,
					handoffTriggered: true,
				};
			}
		}

		// Check if file exists and get its stats
		let existingByteSize: number;
		let existingLineCount: number;
		let isNewFile: boolean;
		let snapshot: string | undefined;

		try {
			const stats = await this.statFn(filePath);
			if (!stats.isFile()) {
				// Not a regular file - treat as new
				return {
					allowed: true,
					isNewFile: true,
					reason: "",
					reasonCode: undefined,
					snapshot: undefined,
					truncationFallback: false,
					handoffTriggered: false,
				};
			}
			isNewFile = false;
			existingByteSize = stats.size;

			// Read the file to count lines and create snapshot
			const buffer = await this.readFileFn(filePath);
			const content = buffer.toString("utf-8");
			existingLineCount = countLines(content);
			snapshot = content;
		} catch {
			// File does not exist - new file write always allowed
			return {
				allowed: true,
				isNewFile: true,
				reason: "",
				reasonCode: undefined,
				snapshot: undefined,
				truncationFallback: false,
				handoffTriggered: false,
			};
		}

		// Consult the EditStrategyPolicy
		const policyResult: EditStrategyResult = this.policy.checkPolicy(
			relativePath,
			isNewFile,
			existingLineCount,
			existingByteSize,
			newContentByteSize,
			outputBudgetRemaining,
			newLineCount,
		);

		// P4.5: Emit audit event for strategy selection
		if (this.auditEmitter && this.planExecId && this.workspaceId !== "unknown") {
			this.auditEmitter.emitStrategySelected(
				this.planExecId,
				this.workspaceId,
				relativePath,
				this.policy.getMode(),
				existingLineCount,
				existingByteSize,
			);
		}

		if (policyResult.writeAllowed) {
			// P4.5: Record that a full rewrite was attempted
			if (this.auditEmitter && this.planExecId && this.workspaceId !== "unknown") {
				this.auditEmitter.emitFullRewriteAttempted(
					this.planExecId,
					this.workspaceId,
					relativePath,
					this.policy.getMode(),
					existingLineCount,
					existingByteSize,
				);
			}

			return {
				allowed: true,
				isNewFile: false,
				reason: "",
				reasonCode: policyResult.reasonCode,
				snapshot,
				truncationFallback: false,
				handoffTriggered: false,
			};
		}

		// Full write is blocked
		this.emitBlockedEvent(
			relativePath,
			existingLineCount,
			existingByteSize,
			policyResult.reasonCode,
			policyResult.reason,
		);

		// P4.5: Emit audit events for blocked rewrite and token waste prevention
		if (this.auditEmitter && this.planExecId && this.workspaceId !== "unknown") {
			this.auditEmitter.emitStrategyBlocked(
				this.planExecId,
				this.workspaceId,
				relativePath,
				this.policy.getMode(),
				policyResult.reasonCode,
				existingLineCount,
				existingByteSize,
			);
			this.auditEmitter.emitTokenWastePrevented(
				this.planExecId,
				this.workspaceId,
				relativePath,
				this.policy.getMode(),
				policyResult.reasonCode,
			);
		}

		return {
			allowed: false,
			isNewFile: false,
			reason: policyResult.reason,
			reasonCode: policyResult.reasonCode,
			snapshot,
			truncationFallback: false,
			handoffTriggered: false,
		};
	}

	/**
	 * Process the result of a write operation for truncation detection.
	 *
	 * Called after a write tool completes (successfully or not) to detect
	 * truncation and record the attempt.
	 *
	 * @param relativePath - Relative file path
	 * @param writeOutput - Output/result from the write tool
	 * @param succeeded - Whether the write succeeded
	 */
	processWriteResult(relativePath: string, writeOutput: string, succeeded: boolean): void {
		if (
			!this.attemptTracker ||
			!this.truncationDetector ||
			this.planExecId === "unknown" ||
			this.workspaceId === "unknown"
		) {
			return;
		}

		if (succeeded) {
			this.attemptTracker.recordSuccess(this.planExecId, this.workspaceId, relativePath, "full_write");
		} else {
			// Detect failure type from output
			const detection = this.truncationDetector.detectAny(writeOutput);
			const failureType = detection.failureType ?? "restore_after_failed_write";

			this.attemptTracker.recordFailure(
				this.planExecId,
				this.workspaceId,
				relativePath,
				"full_write",
				failureType,
				writeOutput.slice(0, 500),
			);

			// Emit appropriate audit event
			if (this.auditEmitter) {
				if (detection.failureType === "truncation") {
					this.auditEmitter.emitTruncationDetected(
						this.planExecId,
						this.workspaceId,
						relativePath,
						this.policy.getMode(),
					);
				} else if (detection.failureType === "exact_match_failed") {
					this.auditEmitter.emitExactMatchFailed(
						this.planExecId,
						this.workspaceId,
						relativePath,
						this.policy.getMode(),
					);
				}

				// If truncation detected, emit patch fallback forced
				if (detection.failureType === "truncation" && this.policy.isTruncationFallbackEnabled()) {
					this.auditEmitter.emitPatchFallbackForced(
						this.planExecId,
						this.workspaceId,
						relativePath,
						this.policy.getMode(),
					);
				}
			}
		}
	}

	/**
	 * Process the result of an edit operation for failure detection.
	 *
	 * @param relativePath - Relative file path
	 * @param editOutput - Output/result from the edit tool
	 * @param succeeded - Whether the edit succeeded
	 */
	processEditResult(relativePath: string, editOutput: string, succeeded: boolean): void {
		if (!this.attemptTracker || this.planExecId === "unknown" || this.workspaceId === "unknown") {
			return;
		}

		if (succeeded) {
			this.attemptTracker.recordSuccess(this.planExecId, this.workspaceId, relativePath, "targeted_edit");
		} else {
			const detection = this.truncationDetector?.detectAny(editOutput);
			const failureType = detection?.failureType ?? "exact_match_failed";

			this.attemptTracker.recordFailure(
				this.planExecId,
				this.workspaceId,
				relativePath,
				"targeted_edit",
				failureType,
				editOutput.slice(0, 500),
			);

			if (this.auditEmitter && detection?.failureType === "exact_match_failed") {
				this.auditEmitter.emitExactMatchFailed(
					this.planExecId,
					this.workspaceId,
					relativePath,
					this.policy.getMode(),
				);
			}
		}
	}

	/**
	 * Emit an edit_strategy_blocked event on the EventBus.
	 */
	private emitBlockedEvent(
		filePath: string,
		existingLineCount: number,
		existingByteSize: number,
		reasonCode: EditStrategyReasonCode,
		reason: string,
	): void {
		if (!this.eventBus) return;

		const eventData: EditStrategyBlockedEvent = {
			filePath,
			existingLineCount,
			existingByteSize,
			reasonCode,
			reason,
		};

		this.eventBus.emit(EDIT_STRATEGY_BLOCKED_CHANNEL, eventData);
	}
}

/**
 * Create a WriteGate instance.
 *
 * @param options - WriteGate constructor options
 * @returns WriteGate instance
 */
export function createWriteGate(options: WriteGateOptions): WriteGate {
	return new WriteGate(options);
}
