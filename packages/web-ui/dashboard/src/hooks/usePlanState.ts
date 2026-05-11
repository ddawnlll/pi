import { useQuery } from "@tanstack/react-query";
import type { PlanState } from "../types";

const API_BASE = "";

async function fetchPlanState(): Promise<PlanState | null> {
	try {
		const response = await fetch(`${API_BASE}/api/plan-state`);
		if (!response.ok) return null;
		return await response.json();
	} catch (error) {
		console.error("Failed to fetch plan state:", error);
		return null;
	}
}

export function usePlanState() {
	return useQuery<PlanState | null>({
		queryKey: ["plan-state"],
		queryFn: fetchPlanState,
		refetchInterval: 5000, // Reduced from 500ms to 5s to prevent memory issues
		refetchIntervalInBackground: false, // Don't poll when tab is not visible
		staleTime: 2000, // Consider data fresh for 2 seconds
	});
}
