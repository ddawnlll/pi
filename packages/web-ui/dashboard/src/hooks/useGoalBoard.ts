import { useCallback, useEffect, useState } from "react";
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

export function useGoalBoard(): UseGoalBoardReturn {
	const [goals, setGoals] = useState<GoalRecord[]>([]);
	const [stats, setStats] = useState<GoalStats | null>(null);
	const [driftReports, setDriftReports] = useState<GoalDriftReport[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetch = useCallback(async () => {
		try {
			const [goalsData, statsData, driftData] = await Promise.all([
				brainClient.getGoals(),
				brainClient.getGoalStats().catch(() => null),
				brainClient.getDriftReports().catch(() => []),
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
			await brainClient.createGoal(data);
			await fetch();
		},
		[fetch],
	);

	const update = useCallback(
		async (id: string, data: Partial<GoalRecord>) => {
			await brainClient.updateGoal(id, data);
			await fetch();
		},
		[fetch],
	);

	const complete = useCallback(
		async (id: string) => {
			await brainClient.completeGoal(id);
			await fetch();
		},
		[fetch],
	);

	const deleteGoal = useCallback(
		async (id: string) => {
			await brainClient.deleteGoal(id);
			await fetch();
		},
		[fetch],
	);

	return { goals, stats, driftReports, loading, error, create, update, complete, deleteGoal, refresh: fetch };
}
