/**
 * useCommandHistory — Hook for fetching command history via the read model API (P42.01).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/commands
 *
 * Returns command history entries extracted from command_started/command_finished
 * journal events. Returns an empty array when no command events exist.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandHistoryEntry {
	command: string;
	cwd: string;
	exitCode: number | null;
	startedAt: number;
	finishedAt: number;
	outputSummary?: string;
	isTargetCommand?: boolean;
}

export interface CommandHistoryResponse {
	success: boolean;
	commands: CommandHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch command history for a specific workspace.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param enabled - Whether the query should run (default: true)
 */
export function useCommandHistory(
	projectId: string | null,
	planExecId: string | null,
	workspaceId: string | null,
	enabled = true,
) {
	return useQuery<CommandHistoryEntry[]>({
		queryKey: ["command-history", planExecId, workspaceId],
		queryFn: async () => {
			if (!projectId || !planExecId || !workspaceId) return [];

			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workspaceId)}/commands`,
			);
			if (!res.ok) {
				if (res.status === 404) return [];
				throw new Error(`Failed to fetch command history: ${res.status}`);
			}

			const data: CommandHistoryResponse = await res.json();
			return data.commands ?? [];
		},
		enabled: enabled && !!projectId && !!planExecId && !!workspaceId,
		refetchInterval: 10_000,
		staleTime: 5_000,
	});
}
