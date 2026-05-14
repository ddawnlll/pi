/**
 * useProposals — React hooks for the Lead Agent Dashboard (P8.G).
 *
 * Provides read-only access to proposal evidence and status.
 * No mutation endpoints are called (AC2 compliance).
 */

import { useQuery } from "@tanstack/react-query";
import type {
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
