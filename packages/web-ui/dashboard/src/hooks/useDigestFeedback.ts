/**
 * useDigestFeedback — 24.J
 *
 * React hook for submitting and managing feedback on digest items.
 * Supports feedback on signals, observations, proposals, and other
 * digest item types. Handles loading, error, and success states.
 */

import { useCallback, useState } from "react";
import { brainClient } from "../api/brain";
import type { FeedbackEntry, FeedbackRating } from "../types-brain";

export interface UseDigestFeedbackReturn {
	/** Submit new feedback for a digest item. */
	submitFeedback: (
		itemType: string,
		itemId: string,
		itemTitle: string,
		rating: FeedbackRating,
		comment?: string,
	) => Promise<FeedbackEntry | null>;
	/** Update existing feedback (rating/comment). */
	updateFeedback: (
		id: string,
		updates: { rating?: FeedbackRating; comment?: string },
	) => Promise<FeedbackEntry | null>;
	/** Delete feedback entry. */
	deleteFeedback: (id: string) => Promise<boolean>;
	/** Get feedback entries for a specific item. */
	getItemFeedback: (itemId: string) => Promise<FeedbackEntry[]>;
	/** Loading state for the current operation. */
	loading: boolean;
	/** Error message from the last failed operation. */
	error: string | null;
	/** Clear the error state. */
	clearError: () => void;
}

export function useDigestFeedback(): UseDigestFeedbackReturn {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const clearError = useCallback(() => setError(null), []);

	const submitFeedback = useCallback(
		async (
			itemType: string,
			itemId: string,
			itemTitle: string,
			rating: FeedbackRating,
			comment?: string,
		): Promise<FeedbackEntry | null> => {
			setLoading(true);
			setError(null);
			try {
				const entry = await brainClient.submitFeedback({
					itemType: itemType as any,
					itemId,
					itemTitle,
					rating,
					comment,
				});
				return entry;
			} catch (e) {
				const msg = e instanceof Error ? e.message : "Failed to submit feedback";
				setError(msg);
				return null;
			} finally {
				setLoading(false);
			}
		},
		[],
	);

	const updateFeedback = useCallback(
		async (
			id: string,
			updates: { rating?: FeedbackRating; comment?: string },
		): Promise<FeedbackEntry | null> => {
			setLoading(true);
			setError(null);
			try {
				const entry = await brainClient.updateFeedback(id, updates);
				return entry;
			} catch (e) {
				const msg = e instanceof Error ? e.message : "Failed to update feedback";
				setError(msg);
				return null;
			} finally {
				setLoading(false);
			}
		},
		[],
	);

	const deleteFeedback = useCallback(async (id: string): Promise<boolean> => {
		setLoading(true);
		setError(null);
		try {
			await brainClient.deleteFeedback(id);
			return true;
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Failed to delete feedback";
			setError(msg);
			return false;
		} finally {
			setLoading(false);
		}
	}, []);

	const getItemFeedback = useCallback(
		async (itemId: string): Promise<FeedbackEntry[]> => {
			setLoading(true);
			setError(null);
			try {
				const result = await brainClient.listFeedback({ itemId });
				return result.entries;
			} catch (e) {
				const msg = e instanceof Error ? e.message : "Failed to get feedback";
				setError(msg);
				return [];
			} finally {
				setLoading(false);
			}
		},
		[],
	);

	return {
		submitFeedback,
		updateFeedback,
		deleteFeedback,
		getItemFeedback,
		loading,
		error,
		clearError,
	};
}
