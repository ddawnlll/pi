/**
 * useDependencyGraph — Hook for fetching the dependency graph via the read model API (P42.01).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/dependency-graph
 *
 * Returns the dependency graph view of all workspaces in a plan execution,
 * including workspace nodes, dependency relationships, and batch assignments.
 * Includes a dataAvailability sentinel to distinguish real data from fallback.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyGraphNode {
	id: string;
	title?: string;
	dependsOn: string[];
	batch: number;
	stage: string;
}

export interface DataAvailability {
	available: boolean;
	reason?: string;
}

export interface DependencyGraphView {
	planExecutionId: string;
	nodes: DependencyGraphNode[];
	totalBatches: number;
	dataAvailability: DataAvailability;
}

export interface DependencyGraphResponse {
	success: boolean;
	graph: DependencyGraphView;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch the dependency graph for a plan execution.
 *
 * Returns workspace nodes with dependency relationships, batch assignments,
 * and current stage information. When no plan data is available, returns
 * an explicit unavailable state via dataAvailability.available=false.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param enabled - Whether the query should run (default: true)
 */
export function useDependencyGraph(
	projectId: string | null,
	planExecId: string | null,
	enabled = true,
) {
	return useQuery<DependencyGraphView>({
		queryKey: ["dependency-graph", planExecId],
		queryFn: async () => {
			if (!projectId || !planExecId) {
				return {
					planExecutionId: planExecId ?? "",
					nodes: [],
					totalBatches: 0,
					dataAvailability: {
						available: false,
						reason: "No project or plan execution ID provided.",
					},
				};
			}

			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/dependency-graph`,
			);
			if (!res.ok) {
				if (res.status === 404) {
					return {
						planExecutionId: planExecId,
						nodes: [],
						totalBatches: 0,
						dataAvailability: {
							available: false,
							reason: "Dependency graph endpoint returned 404. Plan execution may not exist.",
						},
					};
				}
				throw new Error(`Failed to fetch dependency graph: ${res.status}`);
			}

			const data: DependencyGraphResponse = await res.json();
			return (
				data.graph ?? {
					planExecutionId: planExecId,
					nodes: [],
					totalBatches: 0,
					dataAvailability: {
						available: false,
						reason: "No dependency graph data returned from API.",
					},
				}
			);
		},
		enabled: enabled && !!projectId && !!planExecId,
		staleTime: 30_000,
	});
}
