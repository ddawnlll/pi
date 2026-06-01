/**
 * useChangedFiles — Hook for fetching changed files via the read model API (P42.01).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/changed-files
 *
 * Returns file entries with change metadata extracted from worker_completed
 * journal events. Returns an empty array when no file change data exists.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "unmerged";

export interface ChangedFileEntry {
	path: string;
	name: string;
	ext: string;
	status: FileChangeStatus;
	additions?: number;
	deletions?: number;
	size?: number;
}

export interface ChangedFilesResponse {
	success: boolean;
	files: ChangedFileEntry[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch changed files for a specific workspace.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param enabled - Whether the query should run (default: true)
 */
export function useChangedFiles(
	projectId: string | null,
	planExecId: string | null,
	workspaceId: string | null,
	enabled = true,
) {
	return useQuery<ChangedFileEntry[]>({
		queryKey: ["changed-files", planExecId, workspaceId],
		queryFn: async () => {
			if (!projectId || !planExecId || !workspaceId) return [];

			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workspaceId)}/changed-files`,
			);
			if (!res.ok) {
				if (res.status === 404) return [];
				throw new Error(`Failed to fetch changed files: ${res.status}`);
			}

			const data: ChangedFilesResponse = await res.json();
			return data.files ?? [];
		},
		enabled: enabled && !!projectId && !!planExecId && !!workspaceId,
		refetchInterval: 10_000,
		staleTime: 5_000,
	});
}
