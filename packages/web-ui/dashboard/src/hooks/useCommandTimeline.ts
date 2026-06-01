/**
 * useCommandTimeline — Hook for fetching command history across all workspaces (P42.08).
 *
 * Aggregates GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/commands
 * across all provided workspace IDs. Used by CommandTimelineView to show the
 * unified command timeline.
 */

import { useQueries } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandTimelineEntry {
	command: string;
	cwd: string;
	exitCode: number | null;
	startedAt: number;
	finishedAt: number;
	outputSummary?: string;
	isTargetCommand?: boolean;
	workspaceId: string;
}

export interface CommandHistoryResponse {
	success: boolean;
	commands: Array<{
		command: string;
		cwd: string;
		exitCode: number | null;
		startedAt: number;
		finishedAt: number;
		outputSummary?: string;
		isTargetCommand?: boolean;
	}>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch command history across all workspaces for a plan execution.
 *
 * Uses useQueries to fetch per-workspace command history in parallel,
 * then merges and sorts by startedAt.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceIds - Array of workspace IDs
 * @param enabled - Whether the queries should run (default: true)
 */
export function useCommandTimeline(
	projectId: string | null,
	planExecId: string | null,
	workspaceIds: string[],
	enabled = true,
) {
	const results = useQueries({
		queries: workspaceIds.map((workspaceId) => ({
			queryKey: ["command-history", planExecId, workspaceId],
			queryFn: async (): Promise<CommandTimelineEntry[]> => {
				if (!projectId || !planExecId) return [];

				const res = await fetch(
					`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workspaceId)}/commands`,
				);
				if (!res.ok) {
					if (res.status === 404) return [];
					throw new Error(`Failed to fetch command history: ${res.status}`);
				}

				const data: CommandHistoryResponse = await res.json();
				return (data.commands ?? []).map((cmd) => ({
					...cmd,
					workspaceId,
				}));
			},
			enabled: enabled && !!projectId && !!planExecId && !!workspaceId,
			refetchInterval: 10_000,
			staleTime: 5_000,
		})),
		combine: (results) => {
			const allCommands: CommandTimelineEntry[] = [];
			for (const result of results) {
				if (result.data) {
					allCommands.push(...result.data);
				}
			}
			// Sort by startedAt ascending
			allCommands.sort((a, b) => a.startedAt - b.startedAt);

			return {
				commands: allCommands,
				isLoading: results.some((r) => r.isLoading),
				isError: results.some((r) => r.isError),
				errors: results.filter((r) => r.error).map((r) => r.error),
			};
		},
	});

	return results;
}
