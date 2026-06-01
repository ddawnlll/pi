/**
 * usePlanSummary — Hook for fetching plan execution summary via the read model API (P42.01).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/plan-summary
 *
 * Returns a plan execution summary with phase, title, status, timestamps,
 * and a dataAvailability sentinel. When no plan data exists, returns an
 * explicit unavailable state with a reason string.
 *
 * This is the read model endpoint, distinct from usePlanExecutionDetail()
 * which fetches the full plan state via the direct state store endpoint.
 * The read model ensures proper data availability sentinels and provides
 * consistent typed contracts.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataAvailability {
	available: boolean;
	reason?: string;
}

export interface PlanExecutionSummary {
	id: string;
	projectId: string;
	phase: string;
	title: string;
	status: string;
	startedAt: string;
	completedAt: string | null;
	dataAvailability?: DataAvailability;
}

export interface PlanSummaryResponse {
	success: boolean;
	summary: PlanExecutionSummary;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch plan execution summary from the read model.
 *
 * Returns the plan summary with real data when available, or an explicit
 * unavailable state (dataAvailability.available=false) when the plan does not
 * exist or its data is not accessible.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param enabled - Whether the query should run (default: true)
 */
export function usePlanSummary(
	projectId: string | null,
	planExecId: string | null,
	enabled = true,
) {
	return useQuery<PlanExecutionSummary>({
		queryKey: ["plan-summary", planExecId],
		queryFn: async () => {
			if (!projectId || !planExecId) {
				return {
					id: planExecId ?? "",
					projectId: projectId ?? "default",
					phase: "unknown",
					title: "Unknown Plan",
					status: "unknown",
					startedAt: "",
					completedAt: null,
					dataAvailability: {
						available: false,
						reason: "No project or plan execution ID provided.",
					},
				};
			}

			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/plan-summary`,
			);
			if (!res.ok) {
				if (res.status === 404) {
					return {
						id: planExecId,
						projectId,
						phase: "unknown",
						title: "Unknown Plan",
						status: "unknown",
						startedAt: "",
						completedAt: null,
						dataAvailability: {
							available: false,
							reason: "Plan summary endpoint returned 404. Plan execution may not exist.",
						},
					};
				}
				throw new Error(`Failed to fetch plan summary: ${res.status}`);
			}

			const data: PlanSummaryResponse = await res.json();
			return data.summary;
		},
		enabled: enabled && !!projectId && !!planExecId,
		staleTime: 10_000,
	});
}
