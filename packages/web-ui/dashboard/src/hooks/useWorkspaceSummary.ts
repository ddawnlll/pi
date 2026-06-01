/**
 * useWorkspaceSummary — Hook for fetching workspace execution summary via the read model API (P42.01).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/workspace-summary
 *
 * Returns a workspace execution summary with stage, attempts, timestamps,
 * and a dataAvailability sentinel. When no workspace data exists, returns
 * an explicit unavailable state.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataAvailability {
	available: boolean;
	reason?: string;
}

export interface WorkspaceExecutionSummary {
	id: string;
	planExecutionId: string;
	workspaceId: string;
	stage: string;
	attempts: number;
	startedAt?: string;
	completedAt?: string;
	error?: string;
	reportPath?: string;
	dataAvailability?: DataAvailability;
}

export interface WorkspaceSummaryResponse {
	success: boolean;
	summary: WorkspaceExecutionSummary;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch workspace execution summary from the read model.
 *
 * Returns the workspace summary with real data when available, or an explicit
 * unavailable state (dataAvailability.available=false) when the workspace does
 * not exist or its data is not accessible.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param enabled - Whether the query should run (default: true)
 */
export function useWorkspaceSummary(
	projectId: string | null,
	planExecId: string | null,
	workspaceId: string | null,
	enabled = true,
) {
	return useQuery<WorkspaceExecutionSummary>({
		queryKey: ["workspace-summary", planExecId, workspaceId],
		queryFn: async () => {
			if (!projectId || !planExecId || !workspaceId) {
				return {
					id: workspaceId ?? "",
					planExecutionId: planExecId ?? "",
					workspaceId: workspaceId ?? "",
					stage: "unknown",
					attempts: 0,
					dataAvailability: {
						available: false,
						reason: "No project, plan execution, or workspace ID provided.",
					},
				};
			}

			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workspaceId)}/workspace-summary`,
			);
			if (!res.ok) {
				if (res.status === 404) {
					return {
						id: workspaceId,
						planExecutionId: planExecId,
						workspaceId,
						stage: "unknown",
						attempts: 0,
						dataAvailability: {
							available: false,
							reason: "Workspace summary endpoint returned 404. Workspace may not exist.",
						},
					};
				}
				throw new Error(`Failed to fetch workspace summary: ${res.status}`);
			}

			const data: WorkspaceSummaryResponse = await res.json();
			return data.summary;
		},
		enabled: enabled && !!projectId && !!planExecId && !!workspaceId,
		refetchInterval: 10_000,
		staleTime: 5_000,
	});
}
