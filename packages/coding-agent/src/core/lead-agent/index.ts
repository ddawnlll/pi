/**
 * Lead Agent v0 — P38.LEAD
 *
 * Public API surface for the Lead Agent / Supervisor module.
 */

export { classifyFailure, failureClassLabel, failureClassSeverity } from "./failure-classifier.js";
export {
	buildFailureSignatureString,
	createFailureSignature,
	formatFailureSignature,
	isSameFailure,
} from "./failure-signature.js";
export { createLeadAgent, LeadAgent } from "./lead-agent.js";
export { RetryBudgetManager } from "./retry-budget.js";
export type {
	AllowedAction,
	FailureClass,
	FailureSignature,
	ForbiddenAction,
	LeadAgentConfig,
	LeadAgentMode,
	LeadDirective,
	LeadFailureReviewInput,
	LeadObservedEvent,
	LeadObservedEventType,
	LeadRetryBudget,
	LeadReviewDecision,
	LeadReviewResult,
	RetryBudgetPolicy,
	UserEscalation,
	UserEscalationOption,
} from "./types.js";
export { DEFAULT_RETRY_BUDGET_POLICY } from "./types.js";
