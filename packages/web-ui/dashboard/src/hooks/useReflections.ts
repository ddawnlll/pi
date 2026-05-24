import { useCallback, useEffect, useRef, useState } from "react";
import { brainClient } from "../api/brain";
import type { ReflectionReport } from "../types-brain";

export interface UseReflectionsReturn {
	reflections: ReflectionReport[];
	stats: { total: number; memoriesCreated: number; suggestionsGenerated: number } | null;
	loading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}

/**
 * Hook for reflection data. Supports project-scoped API calls.
 *
 * @param projectId - Optional project ID for project-scoped brain API
 */
export function useReflections(projectId?: string | null): UseReflectionsReturn {
	const [reflections, setReflections] = useState<ReflectionReport[]>([]);
	const [stats, setStats] = useState<{ total: number; memoriesCreated: number; suggestionsGenerated: number } | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const projectIdRef = useRef(projectId);
	projectIdRef.current = projectId;

	const fetch = useCallback(async () => {
		const pid = projectIdRef.current;
		try {
			const [refData, statsData] = await Promise.all([
				brainClient.getReflections(pid).catch(() => []),
				brainClient.getReflectionStats(pid).catch(() => null),
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
