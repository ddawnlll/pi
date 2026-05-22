import { useCallback, useEffect, useState } from "react";
import { brainClient } from "../api/brain";

export interface UnreadCounts {
	observations: number;
	proposals: number;
	approvals: number;
}

export function useUnreadCount(): UnreadCounts & { refresh: () => Promise<void> } {
	const [observations, setObservations] = useState(0);
	const [proposals, setProposals] = useState(0);
	const [approvals, setApprovals] = useState(0);

	const fetch = useCallback(async () => {
		try {
			const [stateData, proposalsData, approvalsData] = await Promise.all([
				brainClient.getState().catch(() => null),
				brainClient.getProposalInbox().catch(() => null),
				brainClient.getApprovals({ limit: 1, status: "pending" }).catch(() => null),
			]);

			if (stateData) {
				// Critical + warning observations as "unread"
				const critical = stateData.observationStats.bySeverity.critical ?? 0;
				const warning = stateData.observationStats.bySeverity.warning ?? 0;
				setObservations(critical + warning);
			}
			if (proposalsData) setProposals(proposalsData.totalPending);
			if (approvalsData) setApprovals(approvalsData.total);
		} catch {
			// Silently fail — badges just show 0
		}
	}, []);

	useEffect(() => {
		fetch();
	}, [fetch]);

	return { observations, proposals, approvals, refresh: fetch };
}
