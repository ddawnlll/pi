/**
 * useFileContent — Hook for fetching file content via the read model API (P42.01).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/file-content?path=...
 *
 * Returns file content with metadata. When content is not available through
 * the read model, returns an explicit unavailable state with guidance on
 * alternative data sources (worktree filesystem endpoints).
 *
 * NOTE: File content retrieval requires the adapter's readArchiveFile()
 * implementation to be backed by filesystem access to the execution archive.
 * Without archive file support, this returns null with an unavailable reason.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileContentView {
	path: string;
	content: string | null;
	base64Content?: string | null;
	isBinary: boolean;
	size: number;
	language?: string;
	truncated?: boolean;
}

export interface FileContentResponse {
	success: boolean;
	content: FileContentView | null;
	available?: boolean;
	reason?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch content of a specific file from a workspace execution.
 *
 * Returns null when the file content is not available through the read model.
 * Check `available` and `reason` fields in the response for diagnostics.
 *
 * For full file access including binary files and directory browsing, use:
 *   GET /api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/files/*
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param filePath - Relative file path within the workspace
 * @param enabled - Whether the query should run (default: true)
 */
export function useFileContent(
	projectId: string | null,
	planExecId: string | null,
	workspaceId: string | null,
	filePath: string | null,
	enabled = true,
) {
	return useQuery<FileContentView | null>({
		queryKey: ["file-content", planExecId, workspaceId, filePath],
		queryFn: async () => {
			if (!projectId || !planExecId || !workspaceId || !filePath) return null;

			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workspaceId)}/file-content?path=${encodeURIComponent(filePath)}`,
			);
			if (!res.ok) {
				if (res.status === 404) return null;
				throw new Error(`Failed to fetch file content: ${res.status}`);
			}

			const data: FileContentResponse = await res.json();

			// Handle explicit unavailable state
			if (data.available === false) {
				return null;
			}

			return data.content ?? null;
		},
		enabled: enabled && !!projectId && !!planExecId && !!workspaceId && !!filePath,
		staleTime: 30_000,
	});
}
