/**
 * useExecutionStatsVerbose — Hook for fetching plan execution stats with
 * data source information via the read model API (P42.01).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/stats-verbose
 *
 * Returns aggregated statistics for a plan execution along with a dataSource
 * field indicating whether the stats are backed by real journal events,
 * state store data, or are entirely unavailable.
 *
 * This is distinct from useExecutionStats and usePlanStats which hit the
 * simpler /stats endpoint. The verbose variant provides data source
 * transparency for debugging and transparency in dashboard displays.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanExecutionStats {
	planExecutionId: string;
	totalWorkspaces: number;
	completedWorkspaces: number;
	failedWorkspaces: number;
	blockedWorkspaces: number;
	runningWorkspaces: number;
	pendingWorkspaces: number;
	cancelledWorkspaces: number;
	skippedWorkspaces: number;
	durationMs: number | null;
	computedAt: string;
	dataSource: "events" | "state-store" | "unavailable";
}

export interface StatsVerboseResponse {
	success: boolean;
	stats: PlanExecutionStats;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

interface UseExecutionStatsVerboseOptions {
	projectId: string | null;
	planExecId: string | null;
	enabled?: boolean;
}

/**
 * Fetch plan execution statistics with data source transparency.
 *
 * The `dataSource` field in the response indicates how the stats were computed:
 *   - "events": Backed by real journal events (most reliable)
 *   - "state-store": Derived from state store snapshot
 *   - "unavailable": No data sources available (all counts are 0)
 *
 * @returns Stats with dataSource info, or an explicit unavailable state
 */
export function useExecutionStatsVerbose({
	projectId,
	planExecId,
	enabled = true,
}: UseExecutionStatsVerboseOptions) {
	return useQuery<PlanExecutionStats>({
		queryKey: ["stats-verbose", planExecId],
		queryFn: async () => {
			if (!projectId || !planExecId) {
				return {
					planExecutionId: planExecId ?? "",
					totalWorkspaces: 0,
					completedWorkspaces: 0,
					failedWorkspaces: 0,
					blockedWorkspaces: 0,
					runningWorkspaces: 0,
					pendingWorkspaces: 0,
					cancelledWorkspaces: 0,
					skippedWorkspaces: 0,
					durationMs: null,
					computedAt: new Date().toISOString(),
					dataSource: "unavailable",
				};
			}

			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/stats-verbose`,
			);
			if (!res.ok) {
				if (res.status === 404) {
					return {
						planExecutionId: planExecId,
						totalWorkspaces: 0,
						completedWorkspaces: 0,
						failedWorkspaces: 0,
						blockedWorkspaces: 0,
						runningWorkspaces: 0,
						pendingWorkspaces: 0,
						cancelledWorkspaces: 0,
						skippedWorkspaces: 0,
						durationMs: null,
						computedAt: new Date().toISOString(),
						dataSource: "unavailable",
					};
				}
				throw new Error(`Failed to fetch stats verbose: ${res.status}`);
			}

			const data: StatsVerboseResponse = await res.json();
			return data.stats;
		},
		enabled: enabled && !!projectId && !!planExecId,
		refetchInterval: 10_000,
		staleTime: 5_000,
	});
}
