/**
 * useScaleStatus — React hook for fetching scale mode status data.
 *
 * Workspace 6.J — Dashboard scale controls and integration visibility.
 *
 * Fetches:
 * - Worktree status (list of git worktrees with dirty/branch info)
 * - Integration queue status (queue entries, merge conflicts)
 * - Scale mode readiness (prerequisites, enable/block reasons)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_BASE = "";

// =============================================================================
// Types
// =============================================================================

/** Git worktree info from the API. */
export interface WorktreeInfo {
	path: string;
	branch: string | null;
	commit: string;
	bare: boolean;
	locked: boolean;
	dirty: boolean;
	name: string;
}

/** Worktree list API response. */
export interface WorktreeListResponse {
	worktrees: WorktreeInfo[];
	total: number;
}

/** Integration queue entry from the API. */
export interface QueueEntryInfo {
	workspaceId: string;
	status: string;
	commitHash: string;
	queuedAt: number;
	processedAt: number | null;
	validationPassed: boolean | null;
	error: string | null;
	conflictFiles: string[] | null;
}

/** Integration queue status from the API. */
export interface IntegrationQueueStatus {
	isProcessing: boolean;
	currentWorkspaceId: string | null;
	entries: QueueEntryInfo[];
	totalEntries: number;
	counts: {
		queued: number;
		merging: number;
		validating: number;
		merged: number;
		failed: number;
		blocked: number;
		conflict: number;
	};
	mergeConflicts?: MergeConflictInfo[];
}

/** Merge conflict info from the API. */
export interface MergeConflictInfo {
	workspaceId: string;
	conflictedFiles: string[];
	diff: string;
	timestamp: number;
	artifactPath: string;
}

/** Scale mode prerequisite status. */
export interface PrerequisiteStatus {
	key: string;
	name: string;
	met: boolean;
	message: string;
}

/** Scale mode readiness from the API. */
export interface ScaleModeReadiness {
	ready: boolean;
	currentMode: "stable" | "scale";
	isScaleModeActive: boolean;
	prerequisites: PrerequisiteStatus[];
	errors: string[];
	warnings: string[];
	requestedWorkers: number;
	experimentalModeEnabled: boolean;
}

/** Worktree cleanup result from the API. */
export interface WorktreeCleanupResult {
	removed: number;
	removedNames: string[];
	errors: string[];
}

// =============================================================================
// Fetch functions
// =============================================================================

async function fetchWorktrees(): Promise<WorktreeListResponse> {
	const res = await fetch(`${API_BASE}/api/scale/worktrees`);
	if (!res.ok) return { worktrees: [], total: 0 };
	return res.json();
}

async function fetchIntegrationQueue(): Promise<IntegrationQueueStatus> {
	const res = await fetch(`${API_BASE}/api/scale/integration-queue`);
	if (!res.ok) {
		return {
			isProcessing: false,
			currentWorkspaceId: null,
			entries: [],
			totalEntries: 0,
			counts: {
				queued: 0,
				merging: 0,
				validating: 0,
				merged: 0,
				failed: 0,
				blocked: 0,
				conflict: 0,
			},
		};
	}
	return res.json();
}

async function fetchScaleReadiness(): Promise<ScaleModeReadiness | null> {
	const res = await fetch(`${API_BASE}/api/scale/readiness`);
	if (!res.ok) return null;
	return res.json();
}

async function postWorktreeCleanup(): Promise<WorktreeCleanupResult> {
	const res = await fetch(`${API_BASE}/api/scale/worktrees/cleanup`, { method: "POST" });
	if (!res.ok) return { removed: 0, removedNames: [], errors: [res.statusText] };
	return res.json();
}

async function deleteWorktree(name: string): Promise<{ success: boolean; error?: string }> {
	const res = await fetch(`${API_BASE}/api/scale/worktrees/${encodeURIComponent(name)}`, {
		method: "DELETE",
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		return { success: false, error: data.error ?? res.statusText };
	}
	return { success: true };
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook for fetching git worktree status.
 *
 * @param enabled - Whether the query is enabled
 * @returns Worktree list with loading/error state
 */
export function useWorktreeStatus(enabled: boolean = true) {
	return useQuery<WorktreeListResponse>({
		queryKey: ["scale", "worktrees"],
		queryFn: fetchWorktrees,
		enabled,
		refetchInterval: 15_000,
		refetchIntervalInBackground: false,
		staleTime: 10_000,
	});
}

/**
 * Hook for fetching integration queue status.
 *
 * @param enabled - Whether the query is enabled
 * @returns Integration queue status with loading/error state
 */
export function useIntegrationQueueStatus(enabled: boolean = true) {
	return useQuery<IntegrationQueueStatus>({
		queryKey: ["scale", "integration-queue"],
		queryFn: fetchIntegrationQueue,
		enabled,
		refetchInterval: 10_000,
		refetchIntervalInBackground: false,
		staleTime: 5_000,
	});
}

/**
 * Hook for fetching scale mode readiness.
 *
 * @param enabled - Whether the query is enabled
 * @returns Scale mode readiness with loading/error state
 */
export function useScaleModeReadiness(enabled: boolean = true) {
	return useQuery<ScaleModeReadiness | null>({
		queryKey: ["scale", "readiness"],
		queryFn: fetchScaleReadiness,
		enabled,
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
		staleTime: 15_000,
	});
}

/**
 * Hook for worktree cleanup mutations.
 *
 * Provides both bulk cleanup and single worktree removal.
 */
export function useWorktreeCleanup() {
	const queryClient = useQueryClient();

	const bulkCleanupMutation = useMutation({
		mutationFn: postWorktreeCleanup,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["scale", "worktrees"] });
		},
	});

	const singleRemoveMutation = useMutation({
		mutationFn: deleteWorktree,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["scale", "worktrees"] });
		},
	});

	return {
		cleanupAll: bulkCleanupMutation.mutateAsync,
		removeWorktree: singleRemoveMutation.mutateAsync,
		isCleaning: bulkCleanupMutation.isPending || singleRemoveMutation.isPending,
		lastResult: (bulkCleanupMutation.data ?? singleRemoveMutation.data) as
			| WorktreeCleanupResult
			| { success: boolean; error?: string }
			| null,
		error: bulkCleanupMutation.error ?? singleRemoveMutation.error,
	};
}


