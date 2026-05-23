/**
 * useProposals — React hooks for Proposal inbox and approval actions
 * (P8.G / P9.F / P11.N).
 *
 * Provides:
 * - useProposals: fetches proposal list with optional status filter
 * - useProposalActions: performs approval gate actions on a single proposal
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	ProposalAction,
	ProposalActionRequest,
	ProposalActionResponse,
	ProposalResponse,
	ProposalsListResponse,
} from "../types";

const API_BASE = "";

// =============================================================================
// Fetch proposals
// =============================================================================

/**
 * Fetch proposals from the API.
 *
 * @param status - Optional status filter
 * @returns Array of ProposalResponse
 */
async function fetchProposals(
	status?: string,
): Promise<ProposalResponse[]> {
	const qs = status ? `?status=${encodeURIComponent(status)}` : "";
	const res = await fetch(`${API_BASE}/api/proposals${qs}`);
	if (!res.ok) {
		throw new Error(
			`Failed to fetch proposals: ${res.status} ${res.statusText}`,
		);
	}
	const data: ProposalsListResponse = await res.json();
	if (!data.success || !Array.isArray(data.proposals)) {
		throw new Error(data.error ?? "Unexpected proposals response format");
	}
	return data.proposals;
}

// =============================================================================
// Send proposal action
// =============================================================================

/**
 * Send an action to a proposal.
 *
 * @param proposalId - The proposal to act on
 * @param action - The action to perform
 * @param reason - Optional reason for the action
 * @returns Updated ProposalResponse
 */
async function sendProposalAction(
	proposalId: string,
	action: ProposalAction,
	reason?: string,
): Promise<ProposalResponse> {
	const body: ProposalActionRequest = { action };
	if (reason) body.reason = reason;

	const res = await fetch(
		`${API_BASE}/api/proposals/${encodeURIComponent(proposalId)}/action`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	);
	if (!res.ok) {
		const errBody = await res.json().catch(() => ({}));
		throw new Error(
			(errBody as { error?: string }).error ??
				`Failed to ${action}: ${res.status} ${res.statusText}`,
		);
	}
	const data: ProposalActionResponse = await res.json();
	if (!data.success || !data.proposal) {
		throw new Error(data.error ?? `Failed to ${action}`);
	}
	return data.proposal;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to fetch proposals with optional status filter.
 *
 * @param filter - Optional filter object with `status` key
 * @returns React Query result with ProposalResponse array
 */
export function useProposals(
	filter?: { status?: string },
) {
	const status = filter?.status;

	return useQuery<ProposalResponse[]>({
		queryKey: ["proposals", status ?? "all"],
		queryFn: () => fetchProposals(status),
		refetchInterval: 30_000,
		staleTime: 10_000,
	});
}

/**
 * Hook providing proposal action mutations.
 *
 * Returns functions to approve for planning/execution, reject, request
 * changes, and approve self-modification, along with pending/error/reset
 * state.
 */
export function useProposalActions() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		mutationFn: ({
			proposalId,
			action,
			reason,
		}: {
			proposalId: string;
			action: ProposalAction;
			reason?: string;
		}) => sendProposalAction(proposalId, action, reason),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["proposals"] });
		},
	});

	return {
		/** Approve proposal for planning phase. */
		approveForPlanning: (proposalId: string, reason?: string) =>
			mutation.mutateAsync({ proposalId, action: "approve_for_planning", reason }),

		/** Approve proposal for execution phase. */
		approveForExecution: (proposalId: string, reason?: string) =>
			mutation.mutateAsync({ proposalId, action: "approve_for_execution", reason }),

		/** Reject proposal with optional reason. */
		rejectProposal: (proposalId: string, reason?: string) =>
			mutation.mutateAsync({ proposalId, action: "reject", reason }),

		/** Request changes to a pending proposal. */
		requestChanges: (proposalId: string, reason?: string) =>
			mutation.mutateAsync({ proposalId, action: "request_changes", reason }),

		/** Approve proposal for self-modification. */
		approveSelfModification: (proposalId: string, reason?: string) =>
			mutation.mutateAsync({ proposalId, action: "approve_self_modification", reason }),

		/** Whether any action mutation is in progress. */
		isPending: mutation.isPending,

		/** Latest error from a mutation, if any. */
		error: mutation.error,

		/** Reset the mutation state. */
		reset: mutation.reset,
	};
}
