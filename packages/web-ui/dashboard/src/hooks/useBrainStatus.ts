import { useCallback, useEffect, useState } from "react";
import { brainClient } from "../api/brain";
import type {
	BrainObservation,
	BrainSignal,
	BrainStateData,
	DaemonState,
	TimelineEvent,
} from "../types-brain";

export interface UseBrainStatusReturn {
	daemon: { state: DaemonState; uptime: string; observationCount: number } | null;
	observations: BrainObservation[];
	signals: BrainSignal[];
	timeline: TimelineEvent[];
	observationStats: { total: number; bySeverity: Record<string, number> } | null;
	signalStats: { total: number; active: number; resolved: number } | null;
	loading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
	autoRefresh: boolean;
	setAutoRefresh: (v: boolean) => void;
}

/**
 * Hook for brain state data. Supports project-scoped API calls.
 *
 * @param projectId - Optional project ID for project-scoped brain API
 * @param planExecId - P41.1-HOTFIX: Optional plan execution ID for scoped brain data
 * @param workspaceId - P41.1-HOTFIX: Optional workspace ID for scoped brain data
 */
export function useBrainStatus(projectId?: string | null, planExecId?: string | null, workspaceId?: string | null): UseBrainStatusReturn {
	const [state, setState] = useState<BrainStateData | null>(null);
	const [observations, setObservations] = useState<BrainObservation[]>([]);
	const [signals, setSignals] = useState<BrainSignal[]>([]);
	const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [autoRefresh, setAutoRefresh] = useState(true);

	const fetch = useCallback(async () => {
		try {
			const stateQuery = projectId ?? null;
			const obsQuery = { limit: 50, planExecId: planExecId ?? undefined, workspaceId: workspaceId ?? undefined };
			const sigQuery = { limit: 50, planExecId: planExecId ?? undefined, workspaceId: workspaceId ?? undefined };
			const tlQuery = { limit: 50, planExecId: planExecId ?? undefined, workspaceId: workspaceId ?? undefined };
			const [stateData, obsData, sigData, tlData] = await Promise.all([
				brainClient.getState(stateQuery).catch(() => null),
				brainClient.getObservations(obsQuery, projectId).catch(() => ({ observations: [], total: 0 })),
				brainClient.getSignals(sigQuery, projectId).catch(() => ({ signals: [], total: 0 })),
				brainClient.getTimeline(tlQuery, projectId).catch(() => ({ events: [], total: 0 })),
			]);

			if (stateData) setState(stateData);
			setObservations(obsData.observations);
			setSignals(sigData.signals);
			setTimeline(tlData.events);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load brain status");
		} finally {
			setLoading(false);
		}
	}, [projectId, planExecId, workspaceId]);

	useEffect(() => {
		fetch();
	}, [fetch]);

	useEffect(() => {
		if (!autoRefresh) return;
		const interval = setInterval(fetch, 10_000);
		return () => clearInterval(interval);
	}, [autoRefresh, fetch]);

	return {
		daemon: state
			? { state: state.daemon.state, uptime: state.daemon.uptime, observationCount: state.daemon.observationCount }
			: null,
		observations,
		signals,
		timeline,
		observationStats: state?.observationStats ?? null,
		signalStats: state?.signalStats
			? { total: state.signalStats.total, active: state.signalStats.active, resolved: state.signalStats.resolved }
			: null,
		loading,
		error,
		refresh: fetch,
		autoRefresh,
		setAutoRefresh,
	};
}
