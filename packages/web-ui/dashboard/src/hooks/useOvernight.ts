import { useCallback, useEffect, useState } from "react";
import { brainClient } from "../api/brain";
import type { OvernightSession } from "../types-brain";

export interface UseOvernightReturn {
	history: OvernightSession[];
	loading: boolean;
	error: string | null;
	queue: (config: {
		queueSelection: string[];
		autonomyLevel: number;
		maxDurationHours: number;
		stopConditions: string[];
	}) => Promise<string | null>;
	cancel: (sessionId: string) => Promise<void>;
	refresh: () => Promise<void>;
}

export function useOvernight(): UseOvernightReturn {
	const [history, setHistory] = useState<OvernightSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetch = useCallback(async () => {
		try {
			const data = await brainClient.getOvernightHistory().catch(() => []);
			setHistory(data);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load overnight history");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetch();
	}, [fetch]);

	const queue = useCallback(
		async (config: {
			queueSelection: string[];
			autonomyLevel: number;
			maxDurationHours: number;
			stopConditions: string[];
		}) => {
			try {
				const result = await brainClient.queueOvernight(config);
				await fetch();
				return result.sessionId;
			} catch (e) {
				setError(e instanceof Error ? e.message : "Failed to queue overnight run");
				return null;
			}
		},
		[fetch],
	);

	const cancel = useCallback(
		async (sessionId: string) => {
			await brainClient.cancelOvernight(sessionId);
			await fetch();
		},
		[fetch],
	);

	return { history, loading, error, queue, cancel, refresh: fetch };
}
