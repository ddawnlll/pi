/**
 * useFileTree — Hook for fetching the hierarchical file tree via the read model API (P42.01).
 *
 * Consumes GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/file-tree
 *
 * Returns a hierarchical tree of FileTreeNode entries for files changed during
 * a workspace execution. Supports ?flat=true for flat list mode.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "unmerged";

export interface FileTreeNode {
	path: string;
	name: string;
	ext: string;
	status: FileChangeStatus;
	isDir: boolean;
	additions?: number;
	deletions?: number;
	children?: FileTreeNode[];
}

export interface FileTreeResponse {
	success: boolean;
	tree: FileTreeNode[];
}

export interface UseFileTreeOptions {
	flat?: boolean;
	enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch the hierarchical file tree for a specific workspace.
 *
 * @param projectId - Project ID
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param options - Query options (flat mode, enabled)
 */
export function useFileTree(
	projectId: string | null,
	planExecId: string | null,
	workspaceId: string | null,
	options?: UseFileTreeOptions,
) {
	const { flat = false, enabled = true } = options ?? {};

	return useQuery<FileTreeNode[]>({
		queryKey: ["file-tree", planExecId, workspaceId, flat],
		queryFn: async () => {
			if (!projectId || !planExecId || !workspaceId) return [];

			const params = flat ? "?flat=true" : "";
			const res = await fetch(
				`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workspaceId)}/file-tree${params}`,
			);
			if (!res.ok) {
				if (res.status === 404) return [];
				throw new Error(`Failed to fetch file tree: ${res.status}`);
			}

			const data: FileTreeResponse = await res.json();
			return data.tree ?? [];
		},
		enabled: enabled && !!projectId && !!planExecId && !!workspaceId,
		refetchInterval: 10_000,
		staleTime: 5_000,
	});
}
