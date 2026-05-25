import { useCallback, useEffect, useState } from "react";
import { brainClient } from "../api/brain";
import type { MorningDigest } from "../types-brain";

export interface UseDigestReturn {
	digest: MorningDigest | null;
	loading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}

export function useDigest(): UseDigestReturn {
	const [digest, setDigest] = useState<MorningDigest | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetch = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await brainClient.getDigest();
			setDigest(data);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load morning digest");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetch();
	}, [fetch]);

	return { digest, loading, error, refresh: fetch };
}
