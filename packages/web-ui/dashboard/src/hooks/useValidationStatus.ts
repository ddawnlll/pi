/**
 * useValidationStatus — Hook for fetching final validation status via the read model API (P42.01).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/validation
 *
 * Returns the final validation status (passed/failed/blocked) for a workspace,
 * derived from governance_* journal events. When no governance events exist,
 * returns a default state with passed=null and blocked=false.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationStatus {
	required: boolean;
	passed: boolean | null;
	blocked: boolean;
	blockReasons: string[];
}

export interface ValidationResponse {
	success: boolean;
	validation: ValidationStatus;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch final validation status for a specific workspace.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param enabled - Whether the query should run (default: true)
 */
export function useValidationStatus(
	projectId: string | null,
	planExecId: string | null,
	workspaceId: string | null,
	enabled = true,
) {
	return useQuery<ValidationStatus>({
		queryKey: ["validation-status", planExecId, workspaceId],
		queryFn: async () => {
			if (!projectId || !planExecId || !workspaceId) {
				return { required: true, passed: null, blocked: false, blockReasons: [] };
			}

			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workspaceId)}/validation`,
			);
			if (!res.ok) {
				if (res.status === 404) {
					return { required: true, passed: null, blocked: false, blockReasons: [] };
				}
				throw new Error(`Failed to fetch validation status: ${res.status}`);
			}

			const data: ValidationResponse = await res.json();
			return data.validation ?? { required: true, passed: null, blocked: false, blockReasons: [] };
		},
		enabled: enabled && !!projectId && !!planExecId && !!workspaceId,
		refetchInterval: 10_000,
		staleTime: 5_000,
	});
}
