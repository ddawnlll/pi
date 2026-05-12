import { useQuery } from "@tanstack/react-query";
import type { PlanState, WorkerInfo, WorkspaceSummary } from "../types";

const API_BASE = "";

async function fetchPlanState(): Promise<PlanState | null> {
	try {
		const response = await fetch(`${API_BASE}/api/plan-state`);
		if (!response.ok) return null;
		const data = await response.json();

		// Transform to PlanState — the server may return either:
		// Legacy: { title, status, queue: {...}, workers: [...] }
		// New:    { phase, title, status, workspaces: [...] }
		const state: PlanState = {
			phase: data.phase ?? "",
			title: data.title ?? "Plan",
			status: data.status ?? "unknown",
			startedAt: data.startedAt,
			completedAt: data.completedAt,
			workspaces: data.workspaces ?? [],
		};

		return state;
	} catch (error) {
		console.error("Failed to fetch plan state:", error);
		return null;
	}
}

function deriveWorkers(state: PlanState | null | undefined): WorkerInfo[] {
	if (!state?.workspaces) return [];
	return state.workspaces.map((ws) => ({
		id: ws.workspaceId,
		stage: (ws.stage as WorkerInfo["stage"]) ?? "pending",
		attempt: ws.attempts ?? 1,
		retries: 0,
		error: ws.error ?? null,
	}));
}

function deriveQueue(state: PlanState | null | undefined): {
	pending: number;
	active: number;
	blocked: number;
	complete: number;
	failed: number;
} {
	if (!state?.workspaces) return { pending: 0, active: 0, blocked: 0, complete: 0, failed: 0 };
	const byStage: Record<string, number> = {};
	for (const ws of state.workspaces) {
		const s = ws.stage ?? "pending";
		byStage[s] = (byStage[s] ?? 0) + 1;
	}
	return {
		pending: byStage["pending"] ?? 0,
		active: byStage["active"] ?? 0,
		blocked: byStage["blocked"] ?? 0,
		complete: byStage["complete"] ?? 0,
		failed: byStage["failed"] ?? 0,
	};
}

export function usePlanState() {
	const query = useQuery<PlanState | null>({
		queryKey: ["plan-state"],
		queryFn: fetchPlanState,
		refetchInterval: 5000,
		refetchIntervalInBackground: false,
		staleTime: 2000,
	});

	return {
		data: query.data,
		isLoading: query.isLoading,
		workers: deriveWorkers(query.data),
		queue: deriveQueue(query.data),
	};
}

/** Re-export the derived types for convenience */
export type { PlanState };
