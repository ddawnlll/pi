/**
 * useDigestActions — 24.K
 *
 * React hook for performing quick actions on digest items (signals,
 * observations, proposals). Provides per-action loading states, error
 * handling, and success feedback.
 *
 * Actions available:
 * - resolveSignal(signalId)  — Mark a brain signal as resolved
 * - dismissObservation(observationId) — Dismiss an observation
 * - acknowledgeProposal(proposalId) — Acknowledge a proposal
 */

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionState = "idle" | "loading" | "success" | "error";

export interface DigestActionStatus {
	state: ActionState;
	error: string | null;
}

export interface UseDigestActionsReturn {
	/** Resolve a brain signal by ID. */
	resolveSignal: (signalId: string) => Promise<boolean>;
	/** Dismiss an observation by ID. */
	dismissObservation: (observationId: string) => Promise<boolean>;
	/** Acknowledge a proposal by ID. */
	acknowledgeProposal: (proposalId: string) => Promise<boolean>;
	/** Get the current status of a specific action by item ID. */
	getActionStatus: (itemId: string) => DigestActionStatus;
	/** Clear the status for a specific item. */
	clearActionStatus: (itemId: string) => void;
	/** Clear all action statuses. */
	clearAllStatuses: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDigestActions(): UseDigestActionsReturn {
	const [actionStatuses, setActionStatuses] = useState<Record<string, DigestActionStatus>>({});

	const updateStatus = useCallback((itemId: string, state: ActionState, error: string | null = null) => {
		setActionStatuses((prev) => ({ ...prev, [itemId]: { state, error } }));
	}, []);

	const getActionStatus = useCallback(
		(itemId: string): DigestActionStatus => {
			return actionStatuses[itemId] ?? { state: "idle", error: null };
		},
		[actionStatuses],
	);

	const clearActionStatus = useCallback((itemId: string) => {
		setActionStatuses((prev) => {
			const next = { ...prev };
			delete next[itemId];
			return next;
		});
	}, []);

	const clearAllStatuses = useCallback(() => {
		setActionStatuses({});
	}, []);

	const resolveSignal = useCallback(async (signalId: string): Promise<boolean> => {
		updateStatus(signalId, "loading");
		try {
			const res = await fetch(`/api/brain/digest/actions/signal/${encodeURIComponent(signalId)}/resolve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			});

			if (!res.ok) {
				const body = await res.text().catch(() => "");
				throw new Error(`Failed to resolve signal: ${res.status}${body ? ` - ${body}` : ""}`);
			}

			updateStatus(signalId, "success");
			// Auto-clear success after 2 seconds
			setTimeout(() => {
				setActionStatuses((prev) => {
					const current = prev[signalId];
					if (current?.state === "success") {
						const next = { ...prev };
						delete next[signalId];
						return next;
					}
					return prev;
				});
			}, 2000);

			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Failed to resolve signal";
			updateStatus(signalId, "error", msg);
			return false;
		}
	}, [updateStatus]);

	const dismissObservation = useCallback(async (observationId: string): Promise<boolean> => {
		updateStatus(observationId, "loading");
		try {
			const res = await fetch(
				`/api/brain/digest/actions/observation/${encodeURIComponent(observationId)}/dismiss`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
				},
			);

			if (!res.ok) {
				const body = await res.text().catch(() => "");
				throw new Error(`Failed to dismiss observation: ${res.status}${body ? ` - ${body}` : ""}`);
			}

			updateStatus(observationId, "success");
			setTimeout(() => {
				setActionStatuses((prev) => {
					const current = prev[observationId];
					if (current?.state === "success") {
						const next = { ...prev };
						delete next[observationId];
						return next;
					}
					return prev;
				});
			}, 2000);

			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Failed to dismiss observation";
			updateStatus(observationId, "error", msg);
			return false;
		}
	}, [updateStatus]);

	const acknowledgeProposal = useCallback(async (proposalId: string): Promise<boolean> => {
		updateStatus(proposalId, "loading");
		try {
			const res = await fetch(
				`/api/brain/digest/actions/proposal/${encodeURIComponent(proposalId)}/acknowledge`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
				},
			);

			if (!res.ok) {
				const body = await res.text().catch(() => "");
				throw new Error(`Failed to acknowledge proposal: ${res.status}${body ? ` - ${body}` : ""}`);
			}

			updateStatus(proposalId, "success");
			setTimeout(() => {
				setActionStatuses((prev) => {
					const current = prev[proposalId];
					if (current?.state === "success") {
						const next = { ...prev };
						delete next[proposalId];
						return next;
					}
					return prev;
				});
			}, 2000);

			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Failed to acknowledge proposal";
			updateStatus(proposalId, "error", msg);
			return false;
		}
	}, [updateStatus]);

	return {
		resolveSignal,
		dismissObservation,
		acknowledgeProposal,
		getActionStatus,
		clearActionStatus,
		clearAllStatuses,
	};
}
