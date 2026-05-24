import { useCallback, useEffect, useRef, useState } from "react";
import { brainClient } from "../api/brain";
import type { GoalDriftReport, GoalRecord, GoalStats } from "../types-brain";

export interface UseGoalBoardReturn {
	goals: GoalRecord[];
	stats: GoalStats | null;
	driftReports: GoalDriftReport[];
	loading: boolean;
	error: string | null;
	create: (data: { title: string; description?: string; priority?: string; milestones?: string[] }) => Promise<void>;
	update: (id: string, data: Partial<GoalRecord>) => Promise<void>;
	complete: (id: string) => Promise<void>;
	deleteGoal: (id: string) => Promise<void>;
	refresh: () => Promise<void>;
}

/**
 * Hook for goal board data. Supports project-scoped API calls.
 *
 * @param projectId - Optional project ID for project-scoped brain API
 */
export function useGoalBoard(projectId?: string | null): UseGoalBoardReturn {
	const [goals, setGoals] = useState<GoalRecord[]>([]);
	const [stats, setStats] = useState<GoalStats | null>(null);
	const [driftReports, setDriftReports] = useState<GoalDriftReport[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const projectIdRef = useRef(projectId);
	projectIdRef.current = projectId;

	const fetch = useCallback(async () => {
		const pid = projectIdRef.current;
		try {
			const [goalsData, statsData, driftData] = await Promise.all([
				brainClient.getGoals({}, pid),
				brainClient.getGoalStats(pid).catch(() => null),
				brainClient.getDriftReports(pid).catch(() => []),
			]);
			setGoals(goalsData);
			if (statsData) setStats(statsData);
			setDriftReports(driftData);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load goals");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetch();
	}, [fetch]);

	const create = useCallback(
		async (data: { title: string; description?: string; priority?: string; milestones?: string[] }) => {
			await brainClient.createGoal(data, projectIdRef.current);
			await fetch();
		},
		[fetch],
	);

	const update = useCallback(
		async (id: string, data: Partial<GoalRecord>) => {
			await brainClient.updateGoal(id, data, projectIdRef.current);
			await fetch();
		},
		[fetch],
	);

	const complete = useCallback(
		async (id: string) => {
			await brainClient.completeGoal(id, projectIdRef.current);
			await fetch();
		},
		[fetch],
	);

	const deleteGoal = useCallback(
		async (id: string) => {
			await brainClient.deleteGoal(id, projectIdRef.current);
			await fetch();
		},
		[fetch],
	);

	return {
		goals,
		stats,
		driftReports,
		loading,
		error,
		create,
		update,
		complete,
		deleteGoal,
		refresh: fetch,
	};
}
