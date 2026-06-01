/**
 * useFileDiff — Hook for fetching file diffs via the read model API (P42.01).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/file-diff?path=...&maxDiffLines=...
 *
 * Returns unified diff output for files changed in a workspace execution.
 * Supports filtering by individual file path and truncating long diffs.
 * When no diff data is available through the read model, returns an empty array
 * with an availability reason guiding consumers to alternative data sources.
 *
 * NOTE: Diff retrieval requires git access or pre/post snapshot pairs from the
 * snapshot artifact store. The read model can serve archived diff.patch files
 * from the execution archive. Without archive support, this returns empty.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "unmerged";

export interface FileDiffView {
	path: string;
	status: FileChangeStatus;
	diff: string;
	additions: number;
	deletions: number;
	truncated?: boolean;
}

export interface FileDiffResponse {
	success: boolean;
	diffs: FileDiffView[];
	available: boolean;
	reason?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

export interface UseFileDiffOptions {
	/** Specific file path to diff (optional — omit for all files) */
	filePath?: string;
	/** Maximum lines to include in the diff output (optional) */
	maxDiffLines?: number;
	/** Whether the query should run (default: true) */
	enabled?: boolean;
}

/**
 * Fetch diffs for files changed in a workspace execution.
 *
 * Returns an array of FileDiffView entries. When no diff data is available,
 * returns an empty array. Check the response `available` field to distinguish
 * between loaded-but-empty and unavailable scenarios.
 *
 * For full diff access with richer metadata, use:\n   GET /api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/diff?format=patch
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param options - Query options (filePath filter, maxDiffLines truncation, enabled)
 */
export function useFileDiff(
	projectId: string | null,
	planExecId: string | null,
	workspaceId: string | null,
	options?: UseFileDiffOptions,
) {
	const { filePath, maxDiffLines, enabled = true } = options ?? {};

	return useQuery<FileDiffView[]>({
		queryKey: ["file-diff", planExecId, workspaceId, filePath, maxDiffLines],
		queryFn: async () => {
			if (!projectId || !planExecId || !workspaceId) return [];

			const params = new URLSearchParams();
			if (filePath) params.set("path", filePath);
			if (maxDiffLines !== undefined) params.set("maxDiffLines", String(maxDiffLines));

			const queryString = params.toString();
			const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workspaceId)}/file-diff${queryString ? `?${queryString}` : ""}`;

			const res = await fetch(url);
			if (!res.ok) {
				if (res.status === 404) return [];
				throw new Error(`Failed to fetch file diff: ${res.status}`);
			}

			const data: FileDiffResponse = await res.json();
			return data.diffs ?? [];
		},
		enabled: enabled && !!projectId && !!planExecId && !!workspaceId,
		staleTime: 30_000,
	});
}
