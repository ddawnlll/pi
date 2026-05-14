import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single entry in the plan queue, matching the server-side interface. */
export interface PlanQueueEntry {
	entryId: string;
	projectId: string;
	planExecId: string | null;
	title: string;
	status: "pending" | "active" | "complete" | "failed" | "skipped" | "blocked";
	queuedAt: number;
	startedAt: number | null;
	completedAt: number | null;
	error: string | null;
	blockReason: string | null;
}

/** Full queue state for a project. */
export interface PlanQueueState {
	entries: PlanQueueEntry[];
	isPaused: boolean;
	stopAfterCurrent: boolean;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchPlanQueue(projectId: string): Promise<PlanQueueState> {
	const response = await fetch(`${API_BASE}/api/projects/${projectId}/queue`);
	if (!response.ok) {
		return { entries: [], isPaused: false, stopAfterCurrent: false };
	}
	return response.json();
}

async function enqueuePlans(
	projectId: string,
	plans: Array<{ planContent: string; planFileName?: string }>,
): Promise<{ success: boolean; added: string[]; errors?: string[]; safetyWarnings?: Array<{ planFileName?: string; warnings: string[] }> }> {
	const response = await fetch(`${API_BASE}/api/projects/${projectId}/queue/enqueue`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ plans }),
	});
	return response.json();
}

async function reorderQueue(
	projectId: string,
	orderedIds: string[],
): Promise<{ success: boolean }> {
	const response = await fetch(`${API_BASE}/api/projects/${projectId}/queue/reorder`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ orderedIds }),
	});
	return response.json();
}

async function skipEntry(
	projectId: string,
	entryId: string,
): Promise<{ success: boolean }> {
	const response = await fetch(
		`${API_BASE}/api/projects/${projectId}/queue/${entryId}/skip`,
		{ method: "POST" },
	);
	return response.json();
}

async function removeEntry(
	projectId: string,
	entryId: string,
): Promise<{ success: boolean }> {
	const response = await fetch(
		`${API_BASE}/api/projects/${projectId}/queue/${entryId}`,
		{ method: "DELETE" },
	);
	return response.json();
}

async function moveToTop(
	projectId: string,
	entryId: string,
): Promise<{ success: boolean }> {
	const response = await fetch(
		`${API_BASE}/api/projects/${projectId}/queue/${entryId}/move-to-top`,
		{ method: "POST" },
	);
	return response.json();
}

async function runNext(
	projectId: string,
): Promise<{ success: boolean }> {
	const response = await fetch(
		`${API_BASE}/api/projects/${projectId}/queue/run-next`,
		{ method: "POST" },
	);
	return response.json();
}

async function pauseQueue(projectId: string): Promise<{ success: boolean }> {
	const response = await fetch(
		`${API_BASE}/api/projects/${projectId}/queue/pause`,
		{ method: "POST" },
	);
	return response.json();
}

async function resumeQueue(projectId: string): Promise<{ success: boolean }> {
	const response = await fetch(
		`${API_BASE}/api/projects/${projectId}/queue/resume`,
		{ method: "POST" },
	);
	return response.json();
}

async function stopAfterCurrent(
	projectId: string,
): Promise<{ success: boolean }> {
	const response = await fetch(
		`${API_BASE}/api/projects/${projectId}/queue/stop-after-current`,
		{ method: "POST" },
	);
	return response.json();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook for managing the plan queue for a project.
 *
 * Provides query data and mutation functions for all queue operations:
 * enqueue, reorder, skip, remove, move-to-top, run-next, pause, resume,
 * and stop-after-current.
 *
 * All mutations automatically invalidate the queue query on success.
 */
export function usePlanQueue(projectId: string | null) {
	const queryClient = useQueryClient();

	const query = useQuery<PlanQueueState>({
		queryKey: ["plan-queue", projectId],
		queryFn: () => fetchPlanQueue(projectId!),
		enabled: !!projectId,
		refetchInterval: 5_000,
		staleTime: 2_000,
	});

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: ["plan-queue", projectId] });
	};

	const enqueueMutation = useMutation({
		mutationFn: (plans: Array<{ planContent: string; planFileName?: string }>) =>
			projectId ? enqueuePlans(projectId, plans) : Promise.reject("No project"),
		onSuccess: invalidate,
	});

	const reorderMutation = useMutation({
		mutationFn: (orderedIds: string[]) =>
			projectId ? reorderQueue(projectId, orderedIds) : Promise.reject("No project"),
		onSuccess: invalidate,
	});

	const skipMutation = useMutation({
		mutationFn: (entryId: string) =>
			projectId ? skipEntry(projectId, entryId) : Promise.reject("No project"),
		onSuccess: invalidate,
	});

	const removeMutation = useMutation({
		mutationFn: (entryId: string) =>
			projectId ? removeEntry(projectId, entryId) : Promise.reject("No project"),
		onSuccess: invalidate,
	});

	const moveToTopMutation = useMutation({
		mutationFn: (entryId: string) =>
			projectId ? moveToTop(projectId, entryId) : Promise.reject("No project"),
		onSuccess: invalidate,
	});

	const runNextMutation = useMutation({
		mutationFn: () =>
			projectId ? runNext(projectId) : Promise.reject("No project"),
		onSuccess: invalidate,
	});

	const pauseMutation = useMutation({
		mutationFn: () =>
			projectId ? pauseQueue(projectId) : Promise.reject("No project"),
		onSuccess: invalidate,
	});

	const resumeMutation = useMutation({
		mutationFn: () =>
			projectId ? resumeQueue(projectId) : Promise.reject("No project"),
		onSuccess: invalidate,
	});

	const stopAfterCurrentMutation = useMutation({
		mutationFn: () =>
			projectId ? stopAfterCurrent(projectId) : Promise.reject("No project"),
		onSuccess: invalidate,
	});

	return {
		/** Current queue state */
		queue: query.data ?? { entries: [], isPaused: false, stopAfterCurrent: false },
		/** Whether the queue is loading */
		isLoading: query.isLoading,
		/** Enqueue one or more plans */
		enqueue: enqueueMutation.mutate,
		/** Whether an enqueue is in progress */
		isEnqueueing: enqueueMutation.isPending,
		/** Result of the last enqueue operation (includes safetyWarnings) */
		enqueueResult: enqueueMutation.data ?? null,
		/** Reorder pending entries by providing ordered IDs */
		reorder: reorderMutation.mutate,
		/** Skip a queued entry */
		skip: skipMutation.mutate,
		/** Remove a queued entry */
		remove: removeMutation.mutate,
		/** Move an entry to the top of the pending section */
		moveToTop: moveToTopMutation.mutate,
		/** Run the next pending plan in the queue */
		runNext: runNextMutation.mutate,
		/** Pause queue processing */
		pause: pauseMutation.mutate,
		/** Resume queue processing */
		resume: resumeMutation.mutate,
		/** Stop queue after current plan finishes */
		stopAfterCurrent: stopAfterCurrentMutation.mutate,
	};
}
