import { useCallback, useEffect, useState } from "react";
import { brainClient } from "../api/brain";
import type { Proposal, ProposalStats } from "../types-brain";

export interface UseProposalsReturn {
	inbox: Proposal[];
	stats: ProposalStats | null;
	loading: boolean;
	error: string | null;
	accept: (id: string) => Promise<void>;
	reject: (id: string, reason?: string) => Promise<void>;
	correct: (id: string, corrections: Record<string, unknown>) => Promise<void>;
	refresh: () => Promise<void>;
}

export function useProposals(): UseProposalsReturn {
	const [inbox, setInbox] = useState<Proposal[]>([]);
	const [stats, setStats] = useState<ProposalStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const [inboxData, statsData] = await Promise.all([
				brainClient.getProposalInbox().catch(() => null),
				brainClient.getProposalStats().catch(() => null),
			]);
			if (inboxData) setInbox(inboxData.pending);
			if (statsData) setStats(statsData);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load proposals");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const accept = useCallback(async (id: string) => {
		await brainClient.acceptProposal(id);
		await refresh();
	}, [refresh]);

	const reject = useCallback(async (id: string, reason?: string) => {
		await brainClient.rejectProposal(id, reason);
		await refresh();
	}, [refresh]);

	const correct = useCallback(async (id: string, corrections: Record<string, unknown>) => {
		await brainClient.correctProposal(id, corrections);
		await refresh();
	}, [refresh]);

	return { inbox, stats, loading, error, accept, reject, correct, refresh };
}
