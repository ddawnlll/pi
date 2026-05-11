import { useQuery } from "@tanstack/react-query";
import type { PlanExecution, PlanExecutionDetail, ExecutionStats, JournalPage } from "../types";

const API_BASE = "";

// ---------------------------------------------------------------------------
// List plan executions
// ---------------------------------------------------------------------------

async function fetchPlanExecutions(projectId: string): Promise<PlanExecution[]> {
	try {
		const response = await fetch(`${API_BASE}/api/projects/${projectId}/plans`);
		if (!response.ok) return [];
		const data = await response.json();
		return data.executions ?? [];
	} catch (error) {
		console.error("Failed to fetch plan executions:", error);
		return [];
	}
}

export function usePlanExecutions(projectId: string | null) {
	return useQuery<PlanExecution[]>({
		queryKey: ["plan-executions", projectId],
		queryFn: () => fetchPlanExecutions(projectId!),
		enabled: !!projectId,
		refetchInterval: 10_000,
		refetchIntervalInBackground: false,
		staleTime: 5000,
	});
}

// ---------------------------------------------------------------------------
// Get plan execution detail
// ---------------------------------------------------------------------------

async function fetchPlanExecutionDetail(
	projectId: string,
	planExecId: string,
): Promise<PlanExecutionDetail | null> {
	try {
		const response = await fetch(
			`${API_BASE}/api/projects/${projectId}/plans/${planExecId}`,
		);
		if (!response.ok) return null;
		return await response.json();
	} catch (error) {
		console.error("Failed to fetch plan execution detail:", error);
		return null;
	}
}

export function usePlanExecutionDetail(
	projectId: string | null,
	planExecId: string | null,
) {
	return useQuery<PlanExecutionDetail | null>({
		queryKey: ["plan-execution-detail", projectId, planExecId],
		queryFn: () => fetchPlanExecutionDetail(projectId!, planExecId!),
		enabled: !!projectId && !!planExecId,
		refetchInterval: 5_000, // Reduced from 2s to 5s
		refetchIntervalInBackground: false,
		staleTime: 2000,
	});
}

// ---------------------------------------------------------------------------
// Get plan statistics
// ---------------------------------------------------------------------------

async function fetchPlanStats(
	projectId: string,
	planExecId: string,
): Promise<ExecutionStats | null> {
	try {
		const response = await fetch(
			`${API_BASE}/api/projects/${projectId}/plans/${planExecId}/stats`,
		);
		if (!response.ok) return null;
		return await response.json();
	} catch (error) {
		console.error("Failed to fetch plan stats:", error);
		return null;
	}
}

export function usePlanStats(
	projectId: string | null,
	planExecId: string | null,
) {
	return useQuery<ExecutionStats | null>({
		queryKey: ["plan-stats", projectId, planExecId],
		queryFn: () => fetchPlanStats(projectId!, planExecId!),
		enabled: !!projectId && !!planExecId,
		refetchInterval: 5_000, // Reduced from 2s to 5s
		refetchIntervalInBackground: false,
		staleTime: 2000,
	});
}

// ---------------------------------------------------------------------------
// Get journal page
// ---------------------------------------------------------------------------

async function fetchJournalPage(
	projectId: string,
	planExecId: string,
	limit: number,
	offset: number,
): Promise<JournalPage | null> {
	try {
		const url = `${API_BASE}/api/projects/${projectId}/plans/${planExecId}/journal?limit=${limit}&offset=${offset}`;
		const response = await fetch(url);
		if (!response.ok) return null;
		return await response.json();
	} catch (error) {
		console.error("Failed to fetch journal:", error);
		return null;
	}
}

export function useJournalPage(
	projectId: string | null,
	planExecId: string | null,
	limit = 100,
	offset = 0,
) {
	return useQuery<JournalPage | null>({
		queryKey: ["journal-page", projectId, planExecId, limit, offset],
		queryFn: () => fetchJournalPage(projectId!, planExecId!, limit, offset),
		enabled: !!projectId && !!planExecId,
		refetchInterval: 10_000, // Increased from 5s to 10s
		refetchIntervalInBackground: false,
		staleTime: 5000,
	});
}
