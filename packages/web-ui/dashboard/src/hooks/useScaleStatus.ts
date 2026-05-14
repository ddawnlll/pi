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

/** Per-worker queue entry fetched from the integration queue for a specific workspace. */
export interface WorkerQueueEntry {
	/** Whether the workspace was found in the integration queue. */
	found: boolean;
	/** The queue entry for this workspace, if found. */
	entry: QueueEntryInfo | null;
	/** The merge conflict for this workspace, if any. */
	mergeConflict: MergeConflictInfo | null;
}

/** Quarantine/cleanup state for a failed workspace. */
export interface QuarantineState {
	/** Whether the workspace is in quarantine. */
	inQuarantine: boolean;
	/** Reason for quarantine. */
	reason?: string;
	/** Whether cleanup has been performed. */
	cleanupPerformed: boolean;
	/** Cleanup timestamp. */
	cleanedAt?: number;
	/** Cleanup details. */
	cleanupDetails?: string;
	/** Whether auto-cleanup is pending. */
	cleanupPending: boolean;
	/** Error during cleanup, if any. */
	cleanupError?: string;
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

/**
 * Fetch a single workspace's entry from the integration queue, plus
 * any associated merge conflict info.
 */
export async function fetchWorkerQueueEntry(workspaceId: string): Promise<WorkerQueueEntry> {
	try {
		// We fetch the full queue and filter client-side.
		const queueData = await fetchIntegrationQueue();
		const entry = queueData.entries.find((e) => e.workspaceId === workspaceId) ?? null;
		const mergeConflict = queueData.mergeConflicts?.find((c) => c.workspaceId === workspaceId) ?? null;
		return {
			found: entry !== null,
			entry,
			mergeConflict,
		};
	} catch {
		return {
			found: false,
			entry: null,
			mergeConflict: null,
		};
	}
}

/**
 * Fetch quarantine state for a failed workspace.
 * Returns null if unavailable (no backend support).
 */
export async function fetchQuarantineState(workspaceId: string): Promise<QuarantineState | null> {
	try {
		const res = await fetch(`${API_BASE}/api/scale/workspaces/${encodeURIComponent(workspaceId)}/quarantine`);
		if (!res.ok) return null;
		return res.json();
	} catch {
		return null;
	}
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
	currentMode: "stable_3" | "experimental_6" | "scale_8";
	isScaleModeActive: boolean;
	prerequisites: PrerequisiteStatus[];
	blockedReasons: string[];
	warnings: string[];
	requestedWorkers: number;
	maxAllowedWorkers: number;
	experimentalModeEnabled: boolean;
}

/** Worktree cleanup result from the API. */
export interface WorktreeCleanupResult {
	removed: number;
	removedNames: string[];
	errors: string[];
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

/**
 * Hook for fetching a single workspace's entry from the integration queue.
 *
 * @param workspaceId - The workspace ID to look up
 * @param enabled - Whether the query is enabled
 * @returns Worker queue entry with loading/error state
 */
export function useWorkerQueueEntry(workspaceId: string | null | undefined, enabled: boolean = true) {
	return useQuery<WorkerQueueEntry>({
		queryKey: ["scale", "worker-queue-entry", workspaceId],
		queryFn: () => fetchWorkerQueueEntry(workspaceId!),
		enabled: enabled && !!workspaceId,
		refetchInterval: 10_000,
		refetchIntervalInBackground: false,
		staleTime: 5_000,
	});
}

/**
 * Hook for fetching quarantine state for a failed workspace.
 *
 * @param workspaceId - The workspace ID to look up
 * @param enabled - Whether the query is enabled
 * @returns Quarantine state or null if unavailable
 */
export function useQuarantineState(workspaceId: string | null | undefined, enabled: boolean = true) {
	return useQuery<QuarantineState | null>({
		queryKey: ["scale", "quarantine", workspaceId],
		queryFn: () => fetchQuarantineState(workspaceId!),
		enabled: enabled && !!workspaceId,
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
		staleTime: 15_000,
	});
}


