/**
 * useProposals — React hooks for the Lead Agent Dashboard (P8.G / P9.F).
 *
 * Provides read-only access to proposals and mutation functions for
 * multi-stage approval actions:
 *   - approve_for_planning
 *   - approve_for_execution
 *   - reject
 *   - request_changes
 *   - approve_self_modification
 *
 * P9.F AC2: Supports all five approval actions.
 * P9.F AC3: Execution approval requires valid dry-run and budget state.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	ProposalAction,
	ProposalActionResponse,
	ProposalDetailResponse,
	ProposalResponse,
	ProposalsListResponse,
} from "../types";

const API_BASE = "";

/**
 * Fetch all proposals with optional filters.
 *
 * @param filter - Optional status/phase filters
 * @returns List of proposals
 */
async function fetchProposals(
	filter?: { status?: string; phase?: string },
): Promise<ProposalResponse[]> {
	const params = new URLSearchParams();
	if (filter?.status) params.set("status", filter.status);
	if (filter?.phase) params.set("phase", filter.phase);

	const query = params.toString();
	const url = `${API_BASE}/api/proposals${query ? `?${query}` : ""}`;

	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Failed to fetch proposals: ${res.status} ${res.statusText}`);
	}

	const data: ProposalsListResponse = await res.json();
	if (!data.success) {
		throw new Error(data.error ?? "Unknown error fetching proposals");
	}

	return data.proposals;
}

/**
 * Fetch a single proposal by ID.
 *
 * @param proposalId - Proposal ID
 * @returns Proposal with full evidence and audit trail
 */
async function fetchProposalDetail(
	proposalId: string,
): Promise<ProposalResponse> {
	const res = await fetch(`${API_BASE}/api/proposals/${encodeURIComponent(proposalId)}`);
	if (!res.ok) {
		throw new Error(`Failed to fetch proposal: ${res.status} ${res.statusText}`);
	}

	const data: ProposalDetailResponse = await res.json();
	if (!data.success) {
		throw new Error(data.error ?? "Unknown error fetching proposal");
	}

	return data.proposal;
}

/**
 * Hook to fetch all proposals with optional filters.
 *
 * Returns proposals sorted by submission time (newest first).
 *
 * @param filter - Optional status/phase filter
 * @returns Query result with proposals array
 */
export function useProposals(filter?: { status?: string; phase?: string }) {
	return useQuery<ProposalResponse[]>({
		queryKey: ["proposals", filter?.status, filter?.phase],
		queryFn: () => fetchProposals(filter),
		refetchInterval: 30_000, // Poll every 30s for updates
		staleTime: 10_000,
	});
}

/**
 * Hook to fetch a single proposal with full detail.
 *
 * @param proposalId - Proposal ID (null/undefined to skip)
 * @returns Query result with proposal detail
 */
export function useProposalDetail(proposalId: string | null | undefined) {
	return useQuery<ProposalResponse>({
		queryKey: ["proposal", proposalId],
		queryFn: () => fetchProposalDetail(proposalId!),
		enabled: !!proposalId,
		refetchInterval: 30_000,
		staleTime: 10_000,
	});
}

// ---------------------------------------------------------------------------
// P9.F — Multi-stage approval mutations
// ---------------------------------------------------------------------------

/**
 * Perform an approval action on a proposal.
 *
 * @param proposalId - The proposal ID
 * @param action - The action to perform
 * @param reason - Optional reason for the action
 * @returns The updated proposal
 */
async function performProposalAction(
	proposalId: string,
	action: ProposalAction,
	reason?: string,
): Promise<ProposalResponse> {
	const res = await fetch(
		`${API_BASE}/api/proposals/${encodeURIComponent(proposalId)}/action`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, reason }),
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
	if (!data.success) {
		throw new Error(data.error ?? `Unknown error performing ${action}`);
	}

	return data.proposal!;
}

/**
 * Hook providing mutation functions for multi-stage proposal approval.
 *
 * Automatically invalidates the proposals list query cache on success.
 */
export function useProposalActions() {
	const queryClient = useQueryClient();

	const baseMutation = useMutation({
		mutationFn: ({
			proposalId,
			action,
			reason,
		}: {
			proposalId: string;
			action: ProposalAction;
			reason?: string;
		}) => performProposalAction(proposalId, action, reason),
		onSuccess: () => {
			// Invalidate all proposal queries so lists and details refresh
			queryClient.invalidateQueries({ queryKey: ["proposals"] });
			queryClient.invalidateQueries({ queryKey: ["proposal"] });
		},
	});

	return {
		/** Approve a proposal for planning. */
		approveForPlanning: (
			proposalId: string,
			reason?: string,
		) =>
			baseMutation.mutateAsync({
				proposalId,
				action: "approve_for_planning",
				reason,
			}),

		/** Approve a proposal for execution. Requires valid dry-run and budget. */
		approveForExecution: (
			proposalId: string,
			reason?: string,
		) =>
			baseMutation.mutateAsync({
				proposalId,
				action: "approve_for_execution",
				reason,
			}),

		/** Reject a proposal (applies to both planning and execution gates). */
		rejectProposal: (
			proposalId: string,
			reason?: string,
		) =>
			baseMutation.mutateAsync({
				proposalId,
				action: "reject",
				reason,
			}),

		/** Request changes to a proposal (marks planning as changes_requested). */
		requestChanges: (
			proposalId: string,
			reason?: string,
		) =>
			baseMutation.mutateAsync({
				proposalId,
				action: "request_changes",
				reason,
			}),

		/** Approve self-modification for a proposal. */
		approveSelfModification: (
			proposalId: string,
			reason?: string,
		) =>
			baseMutation.mutateAsync({
				proposalId,
				action: "approve_self_modification",
				reason,
			}),

		/** Whether any mutation is currently in progress. */
		isPending: baseMutation.isPending,
		/** Latest error, if any. */
		error: baseMutation.error,
		/** Clear any error. */
		reset: baseMutation.reset,
	};
}
