/**
 * useBatchPlan — React hook for fetching the topological batch plan for a running execution.
 *
 * Fetches from GET /api/projects/:projectId/plans/:planExecId/batch-plan.
 * The batch plan includes topological batches, dependency graph, and effective parallelism.
 */

import { useQuery } from "@tanstack/react-query";
import type { TopologicalBatch, DependencyGraphNode, BatchPlanResult } from "../types";

const API_BASE = "";

/** Batch plan data suitable for the BatchExplorer component. */
export interface BatchPlanExplorerData {
	batches: TopologicalBatch[];
	totalBatches: number;
	effectiveParallelism: number;
	dependencyGraph?: DependencyGraphNode[];
}

async function fetchBatchPlan(projectId: string | null, planExecId: string | null): Promise<BatchPlanExplorerData | null> {
	if (!projectId || !planExecId) return null;

	try {
		const res = await fetch(
			`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/batch-plan`,
		);
		if (!res.ok) return null;

		const data: { success: boolean; batchPlan?: BatchPlanResult; error?: string } = await res.json();
		if (!data.success || !data.batchPlan) return null;

		return {
			batches: data.batchPlan.batches,
			totalBatches: data.batchPlan.totalBatches,
			effectiveParallelism: data.batchPlan.effectiveParallelism,
			dependencyGraph: data.batchPlan.dependencyGraph,
		};
	} catch {
		return null;
	}
}

/**
 * Hook for fetching the batch plan for a specific execution.
 *
 * @param projectId - The project ID
 * @param planExecId - The plan execution ID
 * @param enabled - Whether the query is enabled
 * @returns Batch plan data with loading/error state
 */
export function useBatchPlan(
	projectId: string | null,
	planExecId: string | null,
	enabled: boolean = true,
) {
	return useQuery<BatchPlanExplorerData | null>({
		queryKey: ["batch-plan", projectId, planExecId],
		queryFn: () => fetchBatchPlan(projectId, planExecId),
		enabled: enabled && !!projectId && !!planExecId,
		refetchInterval: 15_000,
		refetchIntervalInBackground: false,
		staleTime: 10_000,
	});
}
