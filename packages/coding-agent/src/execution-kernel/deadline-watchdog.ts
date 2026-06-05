import type { Database } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";

// =========================================================================
// Types
// =========================================================================

export type DeadlineRecoveryMode = "inbox_only" | "mark_failed_retryable" | "act_and_mark_failed_retryable";

export interface DeadlineAttemptRow {
	id: string;
	plan_execution_id: string;
	workspace_execution_id: string;
	current_state: string;
	current_deadline_at: string | null;
	version: number;
}

export interface DeadlineProcessAborter {
	abortAttempt(input: {
		planExecutionId: string;
		workspaceExecutionId: string;
		attemptId: string;
		reason: string;
	}): Promise<{ aborted: boolean; reason?: string }>;
}

export interface DeadlineAttemptTransitioner {
	markDeadlineExceeded(input: {
		attemptId: string;
		planExecutionId: string;
		workspaceExecutionId: string;
		currentState: string;
		reason: string;
	}): Promise<{ transitioned: boolean }>;
}

export interface DeadlineRecoveryResult {
	recovered: boolean;
	action:
		| "ignored_terminal"
		| "acted_and_marked_failed_retryable"
		| "marked_failed_retryable"
		| "inbox_only"
		| "error";
	attemptId: string;
	fromState?: string;
	toState?: string;
	processAborted?: boolean;
	reason?: string;
}

export interface DeadlineWatchdogConfig {
	scanIntervalMs?: number;
	recoveryMode?: DeadlineRecoveryMode;
	processAborter?: DeadlineProcessAborter;
	transitioner?: DeadlineAttemptTransitioner;
	inboxEnabled?: boolean;
	now?: () => Date;
}

// Terminal states that must not be touched by recovery
const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED_FINAL", "CANCELLED"]);

// States from which deadline recovery can transition
const RECOVERABLE_STATES = new Set(["PENDING", "READY", "RUNNING", "BLOCKED", "HANDOFF_REQUIRED", "FINAL_VALIDATION"]);

// =========================================================================
// DeadlineWatchdog
// =========================================================================

export class DeadlineWatchdog {
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly config: Required<DeadlineWatchdogConfig>;

	constructor(
		private readonly db: Kysely<Database>,
		config: DeadlineWatchdogConfig = {},
	) {
		this.config = {
			scanIntervalMs: config.scanIntervalMs ?? 60_000,
			recoveryMode: config.recoveryMode ?? "act_and_mark_failed_retryable",
			processAborter: config.processAborter ?? (null as unknown as DeadlineProcessAborter),
			transitioner: config.transitioner ?? (null as unknown as DeadlineAttemptTransitioner),
			inboxEnabled: config.inboxEnabled ?? true,
			now: config.now ?? (() => new Date()),
		};
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.scan(), this.config.scanIntervalMs);
		this.timer.unref();
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	}

	async scan(): Promise<DeadlineRecoveryResult[]> {
		const results: DeadlineRecoveryResult[] = [];
		const attempts = (await this.db
			.selectFrom("attempts" as any)
			.selectAll()
			.execute()) as unknown as DeadlineAttemptRow[];

		for (const attempt of attempts) {
			const result = await this.recoverAttempt(attempt);
			results.push(result);
		}

		return results;
	}

	private async recoverAttempt(attempt: DeadlineAttemptRow): Promise<DeadlineRecoveryResult> {
		const now = this.config.now();
		if (!attempt.current_deadline_at || new Date(attempt.current_deadline_at).getTime() >= now.getTime()) {
			return {
				recovered: false,
				action: "inbox_only",
				attemptId: attempt.id,
				reason: "deadline_not_expired",
			};
		}

		// Terminal attempts: no-op
		if (TERMINAL_STATES.has(attempt.current_state)) {
			// Still write inbox for audit
			if (this.config.inboxEnabled) {
				await this.writeInbox(attempt, "deadline_exceeded", { attemptId: attempt.id });
			}
			return {
				recovered: false,
				action: "ignored_terminal",
				attemptId: attempt.id,
				fromState: attempt.current_state,
				reason: "already_terminal",
			};
		}

		// Non-recoverable states: inbox only
		if (!RECOVERABLE_STATES.has(attempt.current_state)) {
			if (this.config.inboxEnabled) {
				await this.writeInbox(attempt, "deadline_exceeded", { attemptId: attempt.id });
			}
			return {
				recovered: false,
				action: "inbox_only",
				attemptId: attempt.id,
				fromState: attempt.current_state,
				reason: `non_recoverable_state:${attempt.current_state}`,
			};
		}

		// Recovery mode decisions
		if (this.config.recoveryMode === "inbox_only") {
			if (this.config.inboxEnabled) {
				await this.writeInbox(attempt, "deadline_exceeded", { attemptId: attempt.id });
			}
			return {
				recovered: false,
				action: "inbox_only",
				attemptId: attempt.id,
				fromState: attempt.current_state,
				reason: "inbox_only_mode",
			};
		}

		// Perform recovery: abort process first if mode requires it
		let processAborted = false;
		if (
			this.config.recoveryMode === "act_and_mark_failed_retryable" &&
			this.config.processAborter &&
			attempt.current_state === "RUNNING"
		) {
			try {
				const abortResult = await this.config.processAborter.abortAttempt({
					planExecutionId: attempt.plan_execution_id,
					workspaceExecutionId: attempt.workspace_execution_id,
					attemptId: attempt.id,
					reason: "deadline_exceeded",
				});
				processAborted = abortResult.aborted;
			} catch (error) {
				// Process abort failure should not crash the scan
				console.error(
					`[DeadlineWatchdog] processAborter failed for attempt ${attempt.id}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		// Transition the attempt
		if (this.config.transitioner) {
			try {
				await this.config.transitioner.markDeadlineExceeded({
					attemptId: attempt.id,
					planExecutionId: attempt.plan_execution_id,
					workspaceExecutionId: attempt.workspace_execution_id,
					currentState: attempt.current_state,
					reason: `deadline_exceeded:${attempt.current_state}`,
				});
			} catch (error) {
				// Transition failure should not crash the scan
				console.error(
					`[DeadlineWatchdog] transitioner failed for attempt ${attempt.id}: ${error instanceof Error ? error.message : String(error)}`,
				);
				return {
					recovered: false,
					action: "error",
					attemptId: attempt.id,
					fromState: attempt.current_state,
					processAborted,
					reason: `transition_failed:${error instanceof Error ? error.message : String(error)}`,
				};
			}
		}

		// Write inbox for audit if enabled
		if (this.config.inboxEnabled) {
			await this.writeInbox(attempt, "deadline_recovery_completed", {
				attemptId: attempt.id,
				action: this.config.recoveryMode,
				processAborted,
			});
		}

		return {
			recovered: true,
			action:
				this.config.recoveryMode === "act_and_mark_failed_retryable"
					? "acted_and_marked_failed_retryable"
					: "marked_failed_retryable",
			attemptId: attempt.id,
			fromState: attempt.current_state,
			toState: "FAILED_RETRYABLE",
			processAborted,
			reason: `deadline_recovered:${this.config.recoveryMode}`,
		};
	}

	private async writeInbox(
		attempt: DeadlineAttemptRow,
		messageType: string,
		payload: Record<string, unknown>,
	): Promise<void> {
		try {
			await this.db
				.insertInto("controller_inbox" as any)
				.values({
					id: crypto.randomUUID(),
					attempt_id: attempt.id,
					plan_execution_id: attempt.plan_execution_id,
					workspace_execution_id: attempt.workspace_execution_id,
					message_type: messageType,
					payload,
					dedupe_key: `${messageType}:${attempt.id}:${attempt.version}`,
					processed_at: null,
					created_at: new Date().toISOString(),
				})
				.onConflict((oc) => oc.column("dedupe_key" as any).doNothing())
				.execute();
		} catch (error) {
			// Inbox write failure should not crash the scan
			console.error(
				`[DeadlineWatchdog] inbox write failed for ${messageType} on attempt ${attempt.id}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
