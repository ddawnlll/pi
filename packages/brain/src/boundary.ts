/**
 * Brain Boundary — P40 Platform / Agent Separation
 *
 * The Brain is the Lead Agent / Planner. It creates proposals and directives
 * in response to execution events. This boundary defines the escalation surface
 * where the Lead Agent interacts with workers and users.
 */
import type {
	BrainProposal,
	ExecutionReadModel,
	LeadDirectiveView,
	LeadEscalationView,
} from "@earendil-works/pi-execution-core";

export interface BrainBoundaryConfig {
	executionReadModel: ExecutionReadModel;
}

export class BrainBoundary {
	private readonly executionReadModel: ExecutionReadModel;

	constructor(config: BrainBoundaryConfig) {
		this.executionReadModel = config.executionReadModel;
	}

	get execution(): ExecutionReadModel {
		return this.executionReadModel;
	}

	// -----------------------------------------------------------------------
	// Proposal creation
	// -----------------------------------------------------------------------

	createProposal(proposal: Omit<BrainProposal, "id">): BrainProposal {
		return { id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...proposal };
	}

	// -----------------------------------------------------------------------
	// Lead Agent escalation surface (P41.09)
	// -----------------------------------------------------------------------

	/**
	 * Create a proposal that escalates a stuck workspace to the user.
	 * Returns a BrainProposal of type "notify" with escalation details.
	 */
	createEscalationProposal(params: {
		planExecutionId: string;
		workspaceId: string;
		summary: string;
		rationale: string;
		evidenceRefs: string[];
		title: string;
		whatHappened: string;
		whyStuck: string;
		options: Array<{ id: string; label: string; risk: string; description?: string }>;
		recommendedOptionId: string;
		logsToInspect: string[];
	}): BrainProposal {
		return this.createProposal({
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
		});
	}

	/**
	 * Create a proposal that issues a directive to a worker after failure review.
	 * Returns a BrainProposal of type "draft_plan" with directive details.
	 */
	createDirectiveProposal(params: {
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
		return this.createProposal({
			type: "draft_plan",
			summary: params.summary,
			rationale: params.rationale,
			evidenceRefs: params.evidenceRefs,
			proposedCommand: {
				type: "continue_plan",
				planExecutionId: params.planExecutionId,
				reason: `Directive for ${params.workspaceId}: ${params.summary}`,
			},
		});
	}

	/**
	 * Create an investigate proposal when the Lead Agent needs more information
	 * before making a decision.
	 */
	createInvestigateProposal(params: { summary: string; rationale: string; evidenceRefs: string[] }): BrainProposal {
		return this.createProposal({
			type: "investigate",
			summary: params.summary,
			rationale: params.rationale,
			evidenceRefs: params.evidenceRefs,
		});
	}

	// -----------------------------------------------------------------------
	// Read convenience methods (wrap execution read model)
	// -----------------------------------------------------------------------

	/**
	 * Get all directives issued by the Lead Agent for a workspace.
	 */
	async getDirectives(planExecutionId: string, workspaceId: string): Promise<LeadDirectiveView[]> {
		return this.executionReadModel.getLeadDirectives(planExecutionId, workspaceId);
	}

	/**
	 * Get all escalations initiated by the Lead Agent for a workspace.
	 */
	async getEscalations(planExecutionId: string, workspaceId: string): Promise<LeadEscalationView[]> {
		return this.executionReadModel.getLeadEscalations(planExecutionId, workspaceId);
	}
}

export function createBrainBoundary(executionReadModel: ExecutionReadModel): BrainBoundary {
	return new BrainBoundary({ executionReadModel });
}
