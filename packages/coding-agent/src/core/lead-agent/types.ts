/**
 * Lead Agent v0 Types — P38.LEAD
 *
 * Core types for the Execution Lead Agent / Supervisor.
 * The Lead Agent observes, classifies, directs, limits retries, and escalates.
 * It does NOT own state transitions, completion, or validation.
 */

// ---------------------------------------------------------------------------
// Failure classes
// ---------------------------------------------------------------------------

/**
 * Known failure classes the Lead Agent can classify.
 */
export type FailureClass =
	| "target_command_not_executed"
	| "command_history_missing"
	| "test_file_missing"
	| "wrong_test_path"
	| "no_tests_found_exit_zero"
	| "validation_command_failed"
	| "completion_gate_blocked"
	| "memory_limit_or_process_killed"
	| "stale_attempt_completion"
	| "illegal_attempt_transition"
	| "attempt_cache_retry_bug"
	| "stop_not_drained"
	| "continue_recovery_failed"
	| "queue_snapshot_missing"
	| "file_lock_stuck"
	| "dependency_missing"
	| "artifact_missing"
	| "plan_contract_mismatch"
	| "unknown";

// ---------------------------------------------------------------------------
// Failure signature
// ---------------------------------------------------------------------------

/**
 * A stable, normalized failure signature for detecting repeated failures.
 */
export interface FailureSignature {
	/** The workspace that failed */
	workspaceId: string;
	/** The plan execution ID */
	planExecId: string;
	/** Normalized signature string (e.g., "completion_gate:target_command_not_executed:patch-coordinator.test.ts") */
	signature: string;
	/** Failure class determined by classifier */
	failureClass: FailureClass;
	/** Error message or block reason from the failure */
	errorMessage: string;
	/** The last command executed (if any) */
	lastCommand: string | null;
	/** Exit code of last command (if any) */
	lastCommandExitCode: number | null;
	/** Completion gate block reasons (if any) */
	completionGateBlockReasons: string[];
	/** Attempt number when this failure occurred */
	attemptNo: number;
	/** When this signature was first observed (epoch ms) */
	firstObservedAt: number;
	/** When this signature was most recently observed (epoch ms) */
	lastObservedAt: number;
	/** How many times this exact signature has been observed */
	occurrenceCount: number;
}

// ---------------------------------------------------------------------------
// Lead directives
// ---------------------------------------------------------------------------

/**
 * Actions the Lead Agent may allow a worker to take.
 */
export type AllowedAction =
	| "inspect_file"
	| "create_missing_test"
	| "fix_command_wiring"
	| "change_validation_command"
	| "defer_validation"
	| "move_to_final_validation"
	| "fix_command_path"
	| "retry_with_same_strategy"
	| "request_user_escalation"
	| "none";

/**
 * Actions the Lead Agent forbids a worker from taking.
 */
export type ForbiddenAction =
	| "disable_completion_gate"
	| "mark_complete_without_validation"
	| "make_pending_to_succeeded_legal"
	| "make_succeeded_to_running_legal"
	| "bypass_completion_gate"
	| "disable_validation";

/**
 * A retry budget from the Lead Agent's perspective.
 */
export interface LeadRetryBudget {
	/** Maximum additional retries the Lead allows before escalation */
	maxAdditionalRetries: number;
	/** After how many failed retries the Lead will escalate to user */
	escalateAfter: number;
	/** Total retries observed for this failure signature */
	totalRetriesObserved: number;
}

/**
 * A durable directive from the Lead Agent to a worker.
 */
export interface LeadDirective {
	/** Unique directive ID */
	directiveId: string;
	/** Plan execution ID */
	planExecId: string;
	/** Workspace ID this directive targets */
	workspaceId: string;
	/** Attempt number when this directive was issued */
	attemptNo: number;
	/** When this directive was created (epoch ms) */
	createdAt: number;
	/** Severity — "low", "medium", "high", "blocking" */
	severity: "low" | "medium" | "high" | "blocking";
	/** Failure class determined by classifier */
	failureClass: FailureClass;
	/** Stable failure signature */
	failureSignature: string;
	/** Human-readable summary of the failure */
	summary: string;
	/** The directed next actions for the worker */
	directive: string;
	/** Actions the worker is allowed to take */
	allowedActions: AllowedAction[];
	/** Actions the worker is forbidden from taking */
	forbiddenActions: ForbiddenAction[];
	/** Retry budget for this directive */
	retryBudget: LeadRetryBudget;
	/** Current directive status */
	status: "issued" | "acknowledged" | "resolved" | "escalated" | "expired";
}

// ---------------------------------------------------------------------------
// User escalation
// ---------------------------------------------------------------------------

/**
 * An option presented to the user for resolving a stuck workspace.
 */
export interface UserEscalationOption {
	/** Unique option ID */
	id: string;
	/** Human-readable label */
	label: string;
	/** Risk level */
	risk: "low" | "medium" | "high" | "safe";
	/** Brief description */
	description?: string;
}

/**
 * A durable user-facing escalation item.
 */
export interface UserEscalation {
	/** Unique escalation ID */
	escalationId: string;
	/** Plan execution ID */
	planExecId: string;
	/** Workspace ID this escalation targets */
	workspaceId: string;
	/** Severity */
	severity: "blocking" | "high" | "medium" | "low";
	/** Title for the escalation card */
	title: string;
	/** Human-readable summary */
	summary: string;
	/** What happened */
	whatHappened: string;
	/** Why the worker is stuck */
	whyTheWorkerIsStuck: string;
	/** Options for the user to choose from */
	options: UserEscalationOption[];
	/** Which option the Lead recommends */
	recommendedOptionId: string;
	/** Log paths to inspect */
	logsToInspect: string[];
	/** Evidence references (paths, artifact IDs) */
	evidenceRefs: string[];
	/** When this escalation was created (epoch ms) */
	createdAt: number;
	/** Current escalation status */
	status: "awaiting_user" | "user_responded" | "resolved" | "expired";
	/** User's chosen option (if responded) */
	userChoice?: string;
	/** User's response message (if responded) */
	userResponse?: string;
}

// ---------------------------------------------------------------------------
// Lead Agent events
// ---------------------------------------------------------------------------

/**
 * Event types the Lead Agent observes.
 */
export type LeadObservedEventType =
	| "workspace_failed"
	| "workspace_blocked"
	| "completion_gate_blocked"
	| "retry_about_to_schedule"
	| "retry_exhausted"
	| "validation_failed"
	| "illegal_transition"
	| "stale_completion_ignored"
	| "worker_command_executed";

/**
 * An event observed by the Lead Agent.
 */
export interface LeadObservedEvent {
	/** Event type */
	eventType: LeadObservedEventType;
	/** Plan execution ID */
	planExecId: string;
	/** Workspace ID */
	workspaceId: string;
	/** Attempt number */
	attemptNo: number;
	/** Error message (if failure event) */
	errorMessage?: string;
	/** Completion gate block reasons (if blocked) */
	completionGateBlockReasons?: string[];
	/** Last command executed */
	lastCommand?: string | null;
	/** Last command exit code */
	lastCommandExitCode?: number | null;
	/** Command history entries (recent) */
	commandHistory?: Array<{
		command: string;
		exitCode: number | null;
		noTestsFoundDetected?: boolean;
	}>;
	/** Whether test file was found */
	testFileFound?: boolean | null;
	/** Timestamp (epoch ms) */
	timestamp: number;
}

/**
 * Input for the Lead Agent to review a potential retry.
 */
export interface LeadFailureReviewInput {
	/** Plan execution ID */
	planExecId: string;
	/** Workspace ID */
	workspaceId: string;
	/** Error message from the failure */
	errorMessage: string;
	/** Current attempt number */
	attemptNo: number;
	/** Completion gate block reasons (if any) */
	completionGateBlockReasons?: string[];
	/** Command history for the workspace */
	commandHistory?: Array<{
		command: string;
		exitCode: number | null;
		noTestsFoundDetected?: boolean;
	}>;
	/** Whether the test file exists */
	testFileFound?: boolean | null;
	/** Last executed command */
	lastCommand?: string | null;
	/** Last command exit code */
	lastCommandExitCode?: number | null;
}

/**
 * Possible decisions from a Lead Agent review.
 */
export type LeadReviewDecision =
	| "allow_retry"
	| "retry_with_directive"
	| "open_repair_workspace"
	| "block_and_escalate_user"
	| "handoff_required";

/**
 * Result of a Lead Agent failure review.
 */
export interface LeadReviewResult {
	/** The decision */
	decision: LeadReviewDecision;
	/** Failure class determined */
	failureClass: FailureClass;
	/** Failure signature */
	failureSignature: string;
	/** Reason for the decision */
	reason: string;
	/** Directive if decision is retry_with_directive */
	directive?: LeadDirective;
	/** Escalation if decision is block_and_escalate_user */
	escalation?: UserEscalation;
	/** Summary for logging and display */
	summary: string;
}

// ---------------------------------------------------------------------------
// Retry budget policy
// ---------------------------------------------------------------------------

/**
 * Configuration for the retry budget manager.
 */
export interface RetryBudgetPolicy {
	/** Max same-signature retries before Lead review is required */
	sameFailureSignatureMaxRetriesBeforeLeadReview: number;
	/** Max same-signature retries after a Lead directive has been issued */
	sameFailureSignatureMaxRetriesAfterLeadDirective: number;
	/** Max total same-signature retries before user escalation */
	sameFailureSignatureMaxTotalRetriesBeforeUserEscalation: number;
	/** Max retries for unknown failures before escalation */
	unknownFailureMaxRetriesBeforeEscalation: number;
}

/**
 * Default retry budget policy.
 */
export const DEFAULT_RETRY_BUDGET_POLICY: RetryBudgetPolicy = {
	sameFailureSignatureMaxRetriesBeforeLeadReview: 2,
	sameFailureSignatureMaxRetriesAfterLeadDirective: 1,
	sameFailureSignatureMaxTotalRetriesBeforeUserEscalation: 3,
	unknownFailureMaxRetriesBeforeEscalation: 2,
};

// ---------------------------------------------------------------------------
// Feature flag types
// ---------------------------------------------------------------------------

/**
 * Lead Agent feature mode.
 */
export type LeadAgentMode = "disabled" | "dry_run" | "enforcement";

/**
 * Lead Agent runtime configuration.
 */
export interface LeadAgentConfig {
	/** Feature mode */
	mode: LeadAgentMode;
	/** Retry budget policy */
	retryBudgetPolicy: RetryBudgetPolicy;
}
