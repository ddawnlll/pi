/**
 * Brain Proposal Contract — P40 Platform / Agent Separation
 */
import type { BrainProposal, ExecutionCommand } from "@earendil-works/pi-execution-core";

export function createRetryProposal(params: { workspaceId: string; planExecutionId: string; summary: string; rationale: string; evidenceRefs: string[]; reason?: string }): BrainProposal {
	return { id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type: "retry", summary: params.summary, rationale: params.rationale, evidenceRefs: params.evidenceRefs, proposedCommand: { type: "retry_workspace", planExecutionId: params.planExecutionId, workspaceId: params.workspaceId, reason: params.reason } };
}

export function createInvestigateProposal(params: { summary: string; rationale: string; evidenceRefs: string[] }): BrainProposal {
	return { id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type: "investigate", summary: params.summary, rationale: params.rationale, evidenceRefs: params.evidenceRefs };
}

export function validateProposedCommand(command: ExecutionCommand): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!command.type) errors.push("Command must have a type");
	return { valid: errors.length === 0, errors };
}
