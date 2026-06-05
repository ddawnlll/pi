/**
 * Brain Proposal Contract — P40 Platform / Agent Separation
 *
 * Proposal contract helpers for the Lead Agent (Brain).
 * Includes escalation and directive proposal creation (P41.09).
 */
import type { BrainProposal, ExecutionCommand } from "@earendil-works/pi-execution-contracts";

// ---------------------------------------------------------------------------
// Proposal ID generation
// ---------------------------------------------------------------------------

function generateProposalId(): string {
	return `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Retry proposal
// ---------------------------------------------------------------------------

export function createRetryProposal(params: {
	workspaceId: string;
	planExecutionId: string;
	summary: string;
	rationale: string;
	evidenceRefs: string[];
	reason?: string;
}): BrainProposal {
	return {
		id: generateProposalId(),
		type: "retry",
		summary: params.summary,
		rationale: params.rationale,
		evidenceRefs: params.evidenceRefs,
		proposedCommand: {
			type: "retry_workspace",
			planExecutionId: params.planExecutionId,
			workspaceId: params.workspaceId,
			reason: params.reason,
		},
	};
}

// ---------------------------------------------------------------------------
// Investigate proposal
// ---------------------------------------------------------------------------

export function createInvestigateProposal(params: {
	summary: string;
	rationale: string;
	evidenceRefs: string[];
}): BrainProposal {
	return {
		id: generateProposalId(),
		type: "investigate",
		summary: params.summary,
		rationale: params.rationale,
		evidenceRefs: params.evidenceRefs,
	};
}

// ---------------------------------------------------------------------------
// Escalation proposal (P41.09)
// ---------------------------------------------------------------------------

/**
 * Create a proposal that escalates a stuck workspace to the user.
 * The escalation includes a description of what happened, why the worker is stuck,
 * and a set of actionable options for the user.
 */
export function createEscalationProposal(params: {
	planExecutionId: string;
	workspaceId: string;
	title: string;
	summary: string;
	rationale: string;
	evidenceRefs: string[];
	whatHappened: string;
	whyStuck: string;
	options: Array<{ id: string; label: string; risk: string; description?: string }>;
	recommendedOptionId: string;
	logsToInspect: string[];
}): BrainProposal {
	return {
		id: generateProposalId(),
		type: "notify",
		summary: params.summary,
		rationale: params.rationale,
		evidenceRefs: params.evidenceRefs,
		proposedCommand: {
			type: "request_user_escalation",
			planExecutionId: params.planExecutionId,
			workspaceId: params.workspaceId,
			reason: params.summary,
		},
	};
}

// ---------------------------------------------------------------------------
// Directive proposal (P41.09)
// ---------------------------------------------------------------------------

/**
 * Create a proposal that issues a directive to a worker after failure review.
 * The directive tells the worker what actions are allowed/forbidden and sets
 * retry budget limits.
 */
export function createDirectiveProposal(params: {
	planExecutionId: string;
	workspaceId: string;
	summary: string;
	rationale: string;
	evidenceRefs: string[];
	directive: string;
	allowedActions: string[];
	forbiddenActions: string[];
	maxAdditionalRetries: number;
	escalateAfter: number;
}): BrainProposal {
	return {
		id: generateProposalId(),
		type: "draft_plan",
		summary: params.summary,
		rationale: params.rationale,
		evidenceRefs: params.evidenceRefs,
		proposedCommand: {
			type: "continue_plan",
			planExecutionId: params.planExecutionId,
			reason: `Directive for ${params.workspaceId}: ${params.summary}`,
		},
	};
}

// ---------------------------------------------------------------------------
// Command validation
// ---------------------------------------------------------------------------

export function validateProposedCommand(command: ExecutionCommand): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!command.type) errors.push("Command must have a type");
	return { valid: errors.length === 0, errors };
}
