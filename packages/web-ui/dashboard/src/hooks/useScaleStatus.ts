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
	paused: boolean;
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
	auditEvents?: AuditEntryInfo[];
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

/** Queue metrics — DAG width, worker cap, safe runnable workers, utilization, timing. */
export interface QueueMetrics {
	/** Maximum number of parallel non-conflicting branches in the DAG. */
	dagWidth: number;
	/** Maximum workers allowed (from settings). */
	workerCap: number;
	/** Number of workers that can safely run without exceeding DAG width or cap. */
	safeRunnableWorkers: number;
	/** Number of workers currently actively processing entries. */
	actualUtilization: number;
	/** Length of the longest serial dependency chain in the queue. */
	criticalPath: number;
	/** Number of entries queued behind the current processing entry. */
	serializedTail: number;
	/** Queue timing metrics when available (null if insufficient data). */
	queueTiming: {
		sampleSize: number;
		avgWaitTimeMs: number | null;
		avgProcessTimeMs: number | null;
		totalProcessed: number;
	} | null;
	/** Advisory optimizer suggestions. */
	optimizerSuggestions: OptimizerSuggestion[];
}

/** Advisory suggestion from the queue optimizer. */
export interface OptimizerSuggestion {
	type: "info" | "warning" | "tip";
	title: string;
	message: string;
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
			paused: false,
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

async function fetchQueueMetrics(): Promise<QueueMetrics | null> {
	try {
		const res = await fetch(`${API_BASE}/api/scale/queue-metrics`);
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

/**
 * Hook for fetching queue metrics (DAG width, worker cap, utilization, timing, optimizer suggestions).
 *
 * @param enabled - Whether the query is enabled
 * @returns Queue metrics with loading/error state
 */
export function useQueueMetrics(enabled: boolean = true) {
	return useQuery<QueueMetrics | null>({
		queryKey: ["scale", "queue-metrics"],
		queryFn: fetchQueueMetrics,
		enabled,
		refetchInterval: 15_000,
		refetchIntervalInBackground: false,
		staleTime: 10_000,
	});
}

// =============================================================================
// Queue Control Actions (6.6.F)
// =============================================================================

/** Audit entry from the queue control audit log. */
export interface AuditEntryInfo {
	action: "pause" | "resume" | "retry" | "requeue" | "clear_completed" | "reorder" | "cancel";
	workspaceId?: string;
	timestamp: number;
	details: string;
}

/** Response from a queue control action. */
export interface QueueControlActionResult {
	success: boolean;
	message?: string;
	error?: string;
	optimized?: boolean;
	throughputImpact?: unknown;
}

/** Audit log API response. */
export interface AuditLogResponse {
	entries: AuditEntryInfo[];
	total: number;
}

async function performQueueAction(
	action: string,
	workspaceId?: string,
): Promise<QueueControlActionResult> {
	let url: string;
	if (workspaceId) {
		url = `${API_BASE}/api/scale/integration-queue/${action}/${encodeURIComponent(workspaceId)}`;
	} else {
		url = `${API_BASE}/api/scale/integration-queue/${action}`;
	}
	const res = await fetch(url, { method: "POST" });
	const data = await res.json();
	if (!res.ok) {
		return { success: false, error: data.error ?? res.statusText };
	}
	return data;
}

async function fetchAuditLog(): Promise<AuditLogResponse> {
	const res = await fetch(`${API_BASE}/api/scale/integration-queue/audit-log`);
	if (!res.ok) return { entries: [], total: 0 };
	return res.json();
}

/**
 * Hook for performing queue control actions (pause, resume, retry, requeue, clear-completed, reorder).
 *
 * Invalidates the integration queue query on success so the UI reflects the changes.
 */
export function useQueueControl() {
	const queryClient = useQueryClient();

	const pauseMutation = useMutation({
		mutationFn: () => performQueueAction("pause"),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["scale", "integration-queue"] });
		},
	});

	const resumeMutation = useMutation({
		mutationFn: () => performQueueAction("resume"),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["scale", "integration-queue"] });
		},
	});

	const retryMutation = useMutation({
		mutationFn: (workspaceId: string) => performQueueAction("retry", workspaceId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["scale", "integration-queue"] });
		},
	});

	const requeueMutation = useMutation({
		mutationFn: (workspaceId: string) => performQueueAction("requeue", workspaceId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["scale", "integration-queue"] });
		},
	});

	const clearCompletedMutation = useMutation({
		mutationFn: () => performQueueAction("clear-completed"),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["scale", "integration-queue"] });
		},
	});

	const reorderMutation = useMutation({
		mutationFn: () => performQueueAction("reorder"),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["scale", "integration-queue"] });
		},
	});

	return {
		pause: pauseMutation.mutateAsync,
		resume: resumeMutation.mutateAsync,
		retry: retryMutation.mutateAsync,
		requeue: requeueMutation.mutateAsync,
		clearCompleted: clearCompletedMutation.mutateAsync,
		reorder: reorderMutation.mutateAsync,
		isPending:
			pauseMutation.isPending ||
			resumeMutation.isPending ||
			retryMutation.isPending ||
			requeueMutation.isPending ||
			clearCompletedMutation.isPending ||
			reorderMutation.isPending,
		lastResult: (pauseMutation.data ??
			resumeMutation.data ??
			retryMutation.data ??
			requeueMutation.data ??
			clearCompletedMutation.data ??
			reorderMutation.data) as QueueControlActionResult | null,
		error:
			pauseMutation.error ??
			resumeMutation.error ??
			retryMutation.error ??
			requeueMutation.error ??
			clearCompletedMutation.error ??
			reorderMutation.error,
	};
}

/**
 * Hook for fetching the audit log.
 */
export function useAuditLog() {
	return useQuery<AuditLogResponse>({
		queryKey: ["scale", "audit-log"],
		queryFn: fetchAuditLog,
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
		staleTime: 15_000,
	});
}
