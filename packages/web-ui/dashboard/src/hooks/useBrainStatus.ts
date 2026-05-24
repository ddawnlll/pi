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
 */
export function useBrainStatus(projectId?: string | null): UseBrainStatusReturn {
	const [state, setState] = useState<BrainStateData | null>(null);
	const [observations, setObservations] = useState<BrainObservation[]>([]);
	const [signals, setSignals] = useState<BrainSignal[]>([]);
	const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [autoRefresh, setAutoRefresh] = useState(true);

	const fetch = useCallback(async () => {
		try {
			const [stateData, obsData, sigData, tlData] = await Promise.all([
				brainClient.getState(projectId).catch(() => null),
				brainClient.getObservations({ limit: 50 }, projectId).catch(() => ({ observations: [], total: 0 })),
				brainClient.getSignals({ limit: 50 }, projectId).catch(() => ({ signals: [], total: 0 })),
				brainClient.getTimeline({ limit: 50 }, projectId).catch(() => ({ events: [], total: 0 })),
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
	}, [projectId]);

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
