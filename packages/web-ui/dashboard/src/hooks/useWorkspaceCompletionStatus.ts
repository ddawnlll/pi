/**
 * useWorkspaceCompletionStatus — Hook for fetching workspace completion gate
 * status via the read model API (P44.10).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/completion-status
 *
 * Returns completion gate evaluation results: whether the workspace can be
 * completed, and if blocked, the reasons and recommended stage. When no
 * completion gate data exists, returns an explicit unavailable state.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataAvailability {
	available: boolean;
	reason?: string;
}

export interface CompletionStatus {
	/** Whether the workspace can be marked as Complete */
	canComplete: boolean;
	/** Reasons why completion is blocked (empty when canComplete is true) */
	blockReasons: string[];
	/** Recommended stage when completion is blocked */
	recommendedStage?: string;
	/** Whether this data is backed by real events or default */
	dataAvailability: DataAvailability;
}

export interface CompletionStatusResponse {
	success: boolean;
	completionStatus: CompletionStatus;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch workspace completion gate status from the read model.
 *
 * Returns the completion status with real data when available, or an explicit
 * unavailable state (dataAvailability.available=false) when the workspace does
 * not have completion gate events.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param enabled - Whether the query should run (default: true)
 */
export function useWorkspaceCompletionStatus(
	projectId: string | null,
	planExecId: string | null,
	workspaceId: string | null,
	enabled = true,
) {
	return useQuery<CompletionStatus>({
		queryKey: ["workspace-completion-status", planExecId, workspaceId],
		queryFn: async () => {
			if (!projectId || !planExecId || !workspaceId) {
				return {
					canComplete: false,
					blockReasons: [],
					dataAvailability: {
						available: false,
						reason: "No project, plan execution, or workspace ID provided.",
					},
				};
			}

			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workspaceId)}/completion-status`,
			);
			if (!res.ok) {
				if (res.status === 404) {
					return {
						canComplete: false,
						blockReasons: [],
						dataAvailability: {
							available: false,
							reason: "Completion status endpoint returned 404. Workspace may not exist.",
						},
					};
				}
				throw new Error(`Failed to fetch workspace completion status: ${res.status}`);
			}

			const data: CompletionStatusResponse = await res.json();
			return data.completionStatus;
		},
		enabled: enabled && !!projectId && !!planExecId && !!workspaceId,
		refetchInterval: 10_000,
		staleTime: 5_000,
	});
}
