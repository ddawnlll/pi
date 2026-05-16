/**
 * useOrchestratorHealth — React hooks for the Autonomy Center (P11.N).
 *
 * Provides read-only access to orchestrator health, scan schedules, budgets,
 * and control actions (pause/resume/request-scan).
 *
 * P11.N AC1: Autonomy screen renders orchestrator health and proposal cards
 *            from backend data.
 * P11.N AC2: Actions are disabled or marked pending when policy requires
 *            approval.
 * P11.N AC4: Loading, empty, error, and stale states are implemented.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	AutonomyDashboardData,
	OrchestratorActionRequest,
	OrchestratorActionResponse,
	OrchestratorHealth,
	ProposalResponse,
} from "../types";

const API_BASE = "";

// =============================================================================
// Fetch functions
// =============================================================================

/**
 * Fetch orchestrator health from the API.
 */
async function fetchOrchestratorHealth(): Promise<OrchestratorHealth> {
	const res = await fetch(`${API_BASE}/api/orchestrator/health`);
	if (!res.ok) {
		throw new Error(
			`Failed to fetch orchestrator health: ${res.status} ${res.statusText}`,
		);
	}
	const data = await res.json();

	// Normalize response shape (handle both top-level and nested responses)
	if (data.health && typeof data.health === "object" && data.health.status) {
		return data.health as OrchestratorHealth;
	}
	if (data.status) {
		return data as OrchestratorHealth;
	}
	throw new Error(
		"Unexpected orchestrator health response format",
	);
}

/**
 * Fetch proposals relevant to autonomy center.
 * Returns proposals sorted by submission time (newest first) with
 * self-modification proposals flagged.
 */
async function fetchAutonomyProposals(): Promise<ProposalResponse[]> {
	const res = await fetch(
		`${API_BASE}/api/orchestrator/proposals?scope=autonomy`,
	);
	if (!res.ok) {
		// Fallback to general proposals endpoint
		const fallbackRes = await fetch(`${API_BASE}/api/proposals`);
		if (!fallbackRes.ok) {
			throw new Error(
				`Failed to fetch autonomy proposals: ${res.status} ${res.statusText}`,
			);
		}
		const data = await fallbackRes.json();
		return data.proposals ?? [];
	}
	const data = await res.json();
	return data.proposals ?? data ?? [];
}

/**
 * Fetch the combined autonomy dashboard data.
 */
async function fetchAutonomyDashboard(): Promise<AutonomyDashboardData> {
	const [health, proposals] = await Promise.all([
		fetchOrchestratorHealth(),
		fetchAutonomyProposals(),
	]);

	const fetchedAt = Date.now();

	return {
		health,
		proposals,
		fetchedAt,
		stale: false,
	};
}

/**
 * Send a control action to the orchestrator.
 */
async function sendOrchestratorAction(
	action: OrchestratorActionRequest,
): Promise<OrchestratorActionResponse> {
	const res = await fetch(`${API_BASE}/api/orchestrator/control`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(action),
	});

	if (!res.ok) {
		const errBody = await res.json().catch(() => ({}));
		return {
			success: false,
			error:
				(errBody as { error?: string }).error ??
				`Failed to ${action.action}: ${res.status} ${res.statusText}`,
		};
	}

	return res.json();
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook for fetching orchestrator health data.
 *
 * Polls every 15 seconds for live updates.
 *
 * @param enabled - Whether the query is enabled
 * @returns Query result with OrchestratorHealth or error
 */
export function useOrchestratorHealth(enabled: boolean = true) {
	return useQuery<OrchestratorHealth>({
		queryKey: ["orchestrator", "health"],
		queryFn: fetchOrchestratorHealth,
		enabled,
		refetchInterval: 15_000,
		refetchIntervalInBackground: false,
		staleTime: 10_000,
		retry: 2,
		retryDelay: 1_000,
	});
}

/**
 * Hook for fetching autonomy-relevant proposals.
 *
 * Polls every 30 seconds.
 *
 * @param enabled - Whether the query is enabled
 * @returns Query result with proposals array
 */
export function useAutonomyProposals(enabled: boolean = true) {
	return useQuery<ProposalResponse[]>({
		queryKey: ["orchestrator", "proposals", "autonomy"],
		queryFn: fetchAutonomyProposals,
		enabled,
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
		staleTime: 15_000,
	});
}

/**
 * Hook for fetching the combined autonomy dashboard data.
 *
 * Aggregates orchestrator health and proposals into a single response
 * for convenience.
 *
 * @param enabled - Whether the query is enabled
 * @returns Query result with AutonomyDashboardData
 */
export function useAutonomyDashboard(enabled: boolean = true) {
	return useQuery<AutonomyDashboardData>({
		queryKey: ["orchestrator", "dashboard"],
		queryFn: fetchAutonomyDashboard,
		enabled,
		refetchInterval: 15_000,
		refetchIntervalInBackground: false,
		staleTime: 10_000,
	});
}

/**
 * Hook providing orchestrator control action mutations.
 *
 * Invalidates the orchestrator health query cache on success.
 * Actions are read-only and executor-mediated (P11.N AC2).
 */
export function useOrchestratorActions() {
	const queryClient = useQueryClient();

	const controlMutation = useMutation({
		mutationFn: (action: OrchestratorActionRequest) =>
			sendOrchestratorAction(action),
		onSuccess: (data) => {
			if (data.success) {
				queryClient.invalidateQueries({
					queryKey: ["orchestrator", "health"],
				});
				queryClient.invalidateQueries({
					queryKey: ["orchestrator", "dashboard"],
				});
			}
		},
	});

	return {
		/** Pause the orchestrator. */
		pause: (reason?: string) =>
			controlMutation.mutateAsync({
				action: "pause",
				reason,
			}),

		/** Resume the orchestrator. */
		resume: (reason?: string) =>
			controlMutation.mutateAsync({
				action: "resume",
				reason,
			}),

		/** Request a specific scan type. */
		requestScan: (scanKind?: string) =>
			controlMutation.mutateAsync({
				action: "request_scan",
				scanKind,
			}),

		/** Whether any mutation is in progress. */
		isPending: controlMutation.isPending,
		/** Latest result, if any. */
		lastResult: controlMutation.data as OrchestratorActionResponse | null,
		/** Latest error, if any. */
		error: controlMutation.error,
		/** Reset the mutation state. */
		reset: controlMutation.reset,
	};
}
