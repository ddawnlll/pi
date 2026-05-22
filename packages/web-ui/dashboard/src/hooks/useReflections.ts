import { useCallback, useEffect, useState } from "react";
import { brainClient } from "../api/brain";
import type { ReflectionReport } from "../types-brain";

export interface UseReflectionsReturn {
	reflections: ReflectionReport[];
	stats: { total: number; memoriesCreated: number; suggestionsGenerated: number } | null;
	loading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}

export function useReflections(): UseReflectionsReturn {
	const [reflections, setReflections] = useState<ReflectionReport[]>([]);
	const [stats, setStats] = useState<{ total: number; memoriesCreated: number; suggestionsGenerated: number } | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetch = useCallback(async () => {
		try {
			const [refData, statsData] = await Promise.all([
				brainClient.getReflections().catch(() => []),
				brainClient.getReflectionStats().catch(() => null),
			]);
			setReflections(refData);
			if (statsData) setStats(statsData);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load reflections");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetch();
	}, [fetch]);

	return { reflections, stats, loading, error, refresh: fetch };
}
