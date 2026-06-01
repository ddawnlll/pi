/**
 * useLeadDirectives — Hook for fetching Lead Agent directives via the read model API (P42.01).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/directives
 *
 * Returns Lead Agent directives extracted from lead_agent_directive_issued
 * journal events. Returns an empty array when no directive events exist.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeadDirectiveView {
	workspaceId: string;
	directiveId: string;
	directiveType: string;
	attemptNumber: number;
	severity: "low" | "medium" | "high" | "blocking";
	summary: string;
	directive: string;
	allowedActions: string[];
	forbiddenActions: string[];
	retryBudget: number;
	escalateAfter: number;
	status: "issued" | "acknowledged" | "resolved" | "escalated" | "expired";
	escalationOption?: string;
	createdAt: string;
}

export interface LeadDirectivesResponse {
	success: boolean;
	directives: LeadDirectiveView[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch Lead Agent directives for a specific workspace.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param enabled - Whether the query should run (default: true)
 */
export function useLeadDirectives(
	projectId: string | null,
	planExecId: string | null,
	workspaceId: string | null,
	enabled = true,
) {
	return useQuery<LeadDirectiveView[]>({
		queryKey: ["lead-directives", planExecId, workspaceId],
		queryFn: async () => {
			if (!projectId || !planExecId || !workspaceId) return [];

			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workspaceId)}/directives`,
			);
			if (!res.ok) {
				if (res.status === 404) return [];
				throw new Error(`Failed to fetch lead directives: ${res.status}`);
			}

			const data: LeadDirectivesResponse = await res.json();
			return data.directives ?? [];
		},
		enabled: enabled && !!projectId && !!planExecId && !!workspaceId,
		refetchInterval: 10_000,
		staleTime: 5_000,
	});
}
