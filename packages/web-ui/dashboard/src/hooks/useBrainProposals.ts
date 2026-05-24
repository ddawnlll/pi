/**
 * useBrainProposals — React hooks for the Brain Proposal Inbox (P16.G).
 *
 * Provides read-only access to the proposal inbox view from
 * GET /api/brain/proposals/inbox (global) or
 * GET /api/projects/:projectId/brain/proposals/inbox (project-scoped).
 *
 * The inbox returns top-ranked, diversified proposals with
 * recommendation labels (auto_approve, review, reject) and
 * evidence-backed reasons.
 *
 * P16.G AC1: Shows top-ranked proposals sorted by score descending.
 * P16.G AC2: Diversified by type (max 2 of same type).
 * P16.G AC3: Each entry has evidence summary and recommendation label.
 * P16.G AC4: Refresh button reloads inbox data.
 *
 * P22.B: Accepts optional projectId for per-project brain scoping.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InboxResponse, InboxView } from "../types";

const API_BASE = "";

/**
 * Build the inbox URL, scoped to a project if projectId is provided.
 */
function inboxUrl(projectId?: string | null): string {
	if (projectId) {
		return `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/brain/proposals/inbox`;
	}
	return `${API_BASE}/api/brain/proposals/inbox`;
}

/**
 * Build the inbox refresh URL, scoped to a project if projectId is provided.
 */
function inboxRefreshUrl(projectId?: string | null): string {
	if (projectId) {
		return `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/brain/proposals/inbox/refresh`;
	}
	return `${API_BASE}/api/brain/proposals/inbox/refresh`;
}

/**
 * Fetch the current inbox view from the API.
 *
 * @param projectId - Optional project ID for project-scoped brain API
 * @returns InboxView with entries and summary stats
 */
async function fetchInbox(projectId?: string | null): Promise<InboxView> {
	const res = await fetch(inboxUrl(projectId));
	if (!res.ok) {
		throw new Error(`Failed to fetch inbox: ${res.status} ${res.statusText}`);
	}

	const data: InboxResponse = await res.json();
	if (!data.success || !data.inbox) {
		throw new Error(data.error ?? "Unknown error fetching inbox");
	}

	return data.inbox;
}

/**
 * Hook to fetch the current proposal inbox view.
 *
 * Returns the top-ranked, diversified proposals with recommendation
 * labels and evidence-backed reasons.
 *
 * Automatically polls every 30 seconds for updates.
 *
 * @param projectId - Optional project ID for per-project brain inbox
 */
export function useInbox(projectId?: string | null) {
	return useQuery<InboxView>({
		queryKey: ["brain-proposals", "inbox", projectId ?? "global"],
		queryFn: () => fetchInbox(projectId),
		refetchInterval: 30_000,
		staleTime: 10_000,
	});
}

/**
 * Hook to force-refresh the inbox.
 *
 * Calls the POST /api/brain/proposals/inbox/refresh endpoint which
 * triggers auto-expiry and re-computation of the top N list.
 *
 * @param projectId - Optional project ID for per-project brain inbox
 */
export function useRefreshInbox(projectId?: string | null) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (): Promise<InboxView> => {
			const res = await fetch(inboxRefreshUrl(projectId), {
				method: "POST",
			});
			if (!res.ok) {
				throw new Error(`Failed to refresh inbox: ${res.status} ${res.statusText}`);
			}
			const data: InboxResponse = await res.json();
			if (!data.success || !data.inbox) {
				throw new Error(data.error ?? "Unknown error refreshing inbox");
			}
			return data.inbox;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["brain-proposals", "inbox", projectId ?? "global"] });
		},
	});
}
