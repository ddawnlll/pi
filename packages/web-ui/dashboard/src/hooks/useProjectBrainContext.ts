import { useCallback, useEffect, useRef, useState } from "react";
import { brainClient } from "../api/brain";
import type { MemoryRecord, ReflectionReport, BrainSignal, MemoryStats } from "../types-brain";

export interface ProjectBrainContext {
	memories: MemoryRecord[];
	reflections: ReflectionReport[];
	signals: BrainSignal[];
	memoryStats: MemoryStats | null;
	loading: boolean;
	error: string | null;
	refresh: () => void;
}

/**
 * Hook to fetch brain context data for a specific project.
 *
 * Returns recent memories, reflections, and active signals scoped to the
 * given project ID. All states (loading, empty, error, populated) are
 * tracked for UI rendering.
 *
 * @param projectId - Optional project ID for project-scoped brain API
 */
export function useProjectBrainContext(projectId?: string | null): ProjectBrainContext {
	const [memories, setMemories] = useState<MemoryRecord[]>([]);
	const [reflections, setReflections] = useState<ReflectionReport[]>([]);
	const [signals, setSignals] = useState<BrainSignal[]>([]);
	const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const projectIdRef = useRef(projectId);
	projectIdRef.current = projectId;

	const fetch = useCallback(async () => {
		const pid = projectIdRef.current;
		setLoading(true);
		setError(null);
		try {
			const [memoriesData, reflectionsData, signalsData, statsData] = await Promise.all([
				brainClient.getMemories({ limit: 5, lifecycle: "active" }, pid).catch(() => ({ memories: [], total: 0 })),
				brainClient.getReflections(pid).catch(() => []),
				brainClient.getSignals({ limit: 5, resolved: false }, pid).catch(() => ({ signals: [], total: 0 })),
				brainClient.getMemoryStats(pid).catch(() => null),
			]);

			setMemories(memoriesData.memories);
			setReflections(Array.isArray(reflectionsData) ? reflectionsData : []);
			setSignals(signalsData.signals);
			if (statsData) setMemoryStats(statsData);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load brain context");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetch();
	}, [fetch]);

	return {
		memories,
		reflections,
		signals,
		memoryStats,
		loading,
		error,
		refresh: fetch,
	};
}
