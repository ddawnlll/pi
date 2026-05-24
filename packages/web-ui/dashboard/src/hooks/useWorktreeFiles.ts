/**
 * useWorktreeFiles — Hook for browsing files in worktree directories
 *
 * Provides polling-based file listing, file content reading, and diff
 * retrieval for active worktrees. Polls every 5 seconds for file list
 * changes while the worktree is active.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorktreeEntry {
	workspaceId: string;
	path: string;
	valid: boolean;
	fileCount: number;
	lastModified: string | null;
}

export interface FileEntry {
	path: string;
	name: string;
	isDir: boolean;
	ext: string;
	size: number;
	children?: FileEntry[];
}

export interface FileContent {
	path: string;
	name: string;
	ext: string;
	language: string;
	size: number;
	modifiedAt: string;
	content: string;
	base64Content: string | null;
	isBinary: boolean;
	truncated: boolean;
	maxBytes: number;
}

export interface DiffFileChange {
	path: string;
	status: string;
	additions: number;
	deletions: number;
}

export interface DiffResult {
	filesChanged: DiffFileChange[];
	diff?: string;
	worktreePath: string;
	fileCount: number;
	totalAdditions: number;
	totalDeletions: number;
}

export interface WorktreeListResult {
	worktrees: WorktreeEntry[];
}

export interface FileListResult {
	files: FileEntry[];
	worktreePath: string;
	totalCount?: number;
	displayCount?: number;
}

export interface FileContentResult {
	path: string;
	name: string;
	ext: string;
	language: string;
	size: number;
	modifiedAt: string;
	content: string;
	base64Content: string | null;
	isBinary: boolean;
	truncated: boolean;
	maxBytes: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API_BASE = "";

async function apiGet<T>(url: string): Promise<T> {
	const res = await fetch(`${API_BASE}${url}`);
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`API error ${res.status}: ${body}`);
	}
	return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// useWorktreeFiles hook
// ---------------------------------------------------------------------------

interface UseWorktreeFilesOptions {
	projectId: string | null;
	planExecId: string | null;
	pollIntervalMs?: number;
}

interface UseWorktreeFilesResult {
	/** List of worktree directories for the plan execution */
	worktrees: WorktreeEntry[];
	/** Currently selected workspace ID */
	selectedWorkspace: string | null;
	/** Set the selected workspace ID */
	setSelectedWorkspace: (id: string | null) => void;
	/** List of files in the selected workspace */
	files: FileEntry[];
	/** File content for the currently selected file */
	fileContent: FileContentResult | null;
	/** Currently selected file path */
	selectedFile: string | null;
	/** Select a file to view its content */
	selectFile: (path: string | null) => void;
	/** Diff result for the selected workspace */
	diff: DiffResult | null;
	/** Whether diff is being loaded */
	diffLoading: boolean;
	/** Load diff for the selected workspace */
	loadDiff: () => Promise<void>;
	/** Whether data is loading */
	isLoading: boolean;
	/** Error message */
	error: string | null;
	/** Refresh worktree list */
	refresh: () => Promise<void>;
}

export function useWorktreeFiles({
	projectId,
	planExecId,
	pollIntervalMs = 5000,
}: UseWorktreeFilesOptions): UseWorktreeFilesResult {
	const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
	const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
	const [files, setFiles] = useState<FileEntry[]>([]);
	const [fileContent, setFileContent] = useState<FileContentResult | null>(null);
	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const [diff, setDiff] = useState<DiffResult | null>(null);
	const [diffLoading, setDiffLoading] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const lastHashRef = useRef<string>("");

	const fetchWorktrees = useCallback(async () => {
		if (!projectId || !planExecId) {
			setWorktrees([]);
			return;
		}

		try {
			const data = await apiGet<WorktreeListResult>(
				`/api/projects/${projectId}/plans/${planExecId}/worktrees`,
			);
			setWorktrees(data.worktrees);
			setError(null);

			// Auto-select first workspace if none selected
			if (data.worktrees.length > 0 && !selectedWorkspace) {
				setSelectedWorkspace(data.worktrees[0].workspaceId);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch worktrees");
		}
	}, [projectId, planExecId, selectedWorkspace]);

	const fetchFiles = useCallback(async () => {
		if (!projectId || !planExecId || !selectedWorkspace) {
			setFiles([]);
			return;
		}

		try {
			const data = await apiGet<FileListResult>(
				`/api/projects/${projectId}/plans/${planExecId}/worktrees/${selectedWorkspace}/files`,
			);
			setFiles(data.files);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch files");
		}
	}, [projectId, planExecId, selectedWorkspace]);

	const fetchFileContent = useCallback(
		async (filePath: string) => {
			if (!projectId || !planExecId || !selectedWorkspace) return;

			try {
				const data = await apiGet<FileContentResult>(
					`/api/projects/${projectId}/plans/${planExecId}/worktrees/${selectedWorkspace}/files/${encodeURIComponent(filePath)}`,
				);
				setFileContent(data);
				setError(null);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to fetch file content");
			}
		},
		[projectId, planExecId, selectedWorkspace],
	);

	const loadDiff = useCallback(async () => {
		if (!projectId || !planExecId || !selectedWorkspace) return;

		setDiffLoading(true);
		try {
			const data = await apiGet<DiffResult>(
				`/api/projects/${projectId}/plans/${planExecId}/worktrees/${selectedWorkspace}/diff?format=patch&maxLines=1000`,
			);
			setDiff(data);
			setError(null);
		} catch (err) {
			setDiff(null);
			setError(err instanceof Error ? err.message : "Failed to fetch diff");
		} finally {
			setDiffLoading(false);
		}
	}, [projectId, planExecId, selectedWorkspace]);

	const selectFile = useCallback(
		(path: string | null) => {
			setSelectedFile(path);
			if (path) {
				fetchFileContent(path);
			} else {
				setFileContent(null);
			}
		},
		[fetchFileContent],
	);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		await fetchWorktrees();
		if (selectedWorkspace) {
			await fetchFiles();
		}
		setIsLoading(false);
	}, [fetchWorktrees, fetchFiles, selectedWorkspace]);

	// Poll worktrees every N seconds
	useEffect(() => {
		if (!projectId || !planExecId) return;

		setIsLoading(true);
		fetchWorktrees().finally(() => setIsLoading(false));

		timerRef.current = setInterval(() => {
			fetchWorktrees();
		}, pollIntervalMs);

		return () => {
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [projectId, planExecId, pollIntervalMs, fetchWorktrees]);

	// Fetch files when workspace changes
	useEffect(() => {
		if (selectedWorkspace) {
			fetchFiles();
			setSelectedFile(null);
			setFileContent(null);
			setDiff(null);
		}
	}, [selectedWorkspace, fetchFiles]);

	// Poll files for changes (check file hash to detect modifications)
	useEffect(() => {
		if (!selectedWorkspace) return;

		const pollFiles = setInterval(() => {
			fetchFiles();
		}, pollIntervalMs);

		return () => {
			clearInterval(pollFiles);
		};
	}, [selectedWorkspace, pollIntervalMs, fetchFiles]);

	return {
		worktrees,
		selectedWorkspace,
		setSelectedWorkspace,
		files,
		fileContent,
		selectedFile,
		selectFile,
		diff,
		diffLoading,
		loadDiff,
		isLoading,
		error,
		refresh,
	};
}
