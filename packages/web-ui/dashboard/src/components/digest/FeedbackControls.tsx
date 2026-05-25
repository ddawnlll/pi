/**
 * FeedbackControls — 24.J
 *
 * A UI component for providing feedback on digest items. Supports thumbs
 * up/down ratings with an optional text comment for teaching Pi what to
 * do differently.
 *
 * States:
 * - neutral: No feedback submitted yet, showing thumbs buttons
 * - submitting: Feedback is being sent to the server
 * - success: Feedback was submitted, showing a confirmation
 * - error: Feedback submission failed, showing error with retry
 * - update: Previously submitted feedback, showing current state
 */

import React, { useCallback, useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2, Check, AlertCircle, MessageSquare } from "lucide-react";
import type { FeedbackEntry, FeedbackRating } from "../../types-brain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedbackControlsProps {
	/** The type of item being rated. */
	itemType: string;
	/** The ID of the item being rated. */
	itemId: string;
	/** A human-readable title for the item (for context). */
	itemTitle: string;
	/** Optional existing feedback entry (for showing current state). */
	existingFeedback?: FeedbackEntry | null;
	/** Callback when feedback is submitted. */
	onFeedbackSubmit?: (entry: FeedbackEntry) => void;
	/** Callback when feedback is updated. */
	onFeedbackUpdate?: (entry: FeedbackEntry) => void;
	/** Callback when feedback is deleted. */
	onFeedbackDelete?: (id: string) => void;
	/** Custom submit handler (overrides internal API call). */
	customSubmit?: (
		rating: FeedbackRating,
		comment: string,
	) => Promise<FeedbackEntry | null>;
	/** Custom update handler. */
	customUpdate?: (
		id: string,
		updates: { rating?: FeedbackRating; comment?: string },
	) => Promise<FeedbackEntry | null>;
	/** Custom delete handler. */
	customDelete?: (id: string) => Promise<boolean>;
	/** Size variant. */
	size?: "sm" | "md";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeedbackControls({
	itemType,
	itemId,
	itemTitle,
	existingFeedback,
	onFeedbackSubmit,
	onFeedbackUpdate,
	onFeedbackDelete,
	customSubmit,
	customUpdate,
	customDelete,
	size = "sm",
}: FeedbackControlsProps) {
	const [rating, setRating] = useState<FeedbackRating | null>(existingFeedback?.rating ?? null);
	const [feedbackId, setFeedbackId] = useState<string | null>(existingFeedback?.id ?? null);
	const [showComment, setShowComment] = useState(false);
	const [comment, setComment] = useState(existingFeedback?.comment ?? "");
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [showSuccess, setShowSuccess] = useState(false);

	const isSmall = size === "sm";
	const buttonSize = isSmall ? "p-0.5" : "p-1";
	const iconSize = isSmall ? 12 : 14;

	// Clear success flash after 2 seconds
	const flashSuccess = useCallback(() => {
		setShowSuccess(true);
		setTimeout(() => setShowSuccess(false), 2000);
	}, []);

	// Handle thumbs up/down click
	const handleRate = useCallback(
		async (selectedRating: FeedbackRating) => {
			// If clicking the same button, deselect
			if (rating === selectedRating) {
				if (feedbackId && customDelete) {
					setSubmitting(true);
					setSubmitError(null);
					try {
						await customDelete(feedbackId);
						setRating(null);
						setFeedbackId(null);
						setComment("");
						onFeedbackDelete?.(feedbackId);
					} catch {
						setSubmitError("Failed to remove feedback");
					} finally {
						setSubmitting(false);
					}
				}
				return;
			}

			setSubmitError(null);
			setSubmitting(true);

			try {
				if (feedbackId && customUpdate) {
					// Update existing feedback
					const updated = await customUpdate(feedbackId, { rating: selectedRating });
					if (updated) {
						setRating(updated.rating);
						onFeedbackUpdate?.(updated);
						flashSuccess();
					}
				} else if (customSubmit) {
					// Submit new feedback
					const entry = await customSubmit(selectedRating, comment);
					if (entry) {
						setRating(entry.rating);
						setFeedbackId(entry.id);
						onFeedbackSubmit?.(entry);
						flashSuccess();
					}
				} else {
					// Default: use internal submit via brainClient
					const { brainClient } = await import("../../api/brain");
					const entry = await brainClient.submitFeedback({
						itemType: itemType as any,
						itemId,
						itemTitle,
						rating: selectedRating,
						comment,
					});
					setRating(entry.rating);
					setFeedbackId(entry.id);
					onFeedbackSubmit?.(entry);
					flashSuccess();
				}
			} catch (e) {
				const msg = e instanceof Error ? e.message : "Failed to submit feedback";
				setSubmitError(msg);
			} finally {
				setSubmitting(false);
			}
		},
		[rating, feedbackId, comment, itemType, itemId, itemTitle, customSubmit, customUpdate, customDelete, onFeedbackSubmit, onFeedbackUpdate, onFeedbackDelete, flashSuccess],
	);

	// Handle comment submission
	const handleCommentSubmit = useCallback(async () => {
		if (!feedbackId || !comment.trim()) return;

		setSubmitError(null);
		setSubmitting(true);

		try {
			if (customUpdate) {
				const updated = await customUpdate(feedbackId, { comment: comment.trim() });
				if (updated) {
					onFeedbackUpdate?.(updated);
					setShowComment(false);
					flashSuccess();
				}
			} else {
				const { brainClient } = await import("../../api/brain");
				const updated = await brainClient.updateFeedback(feedbackId, { comment: comment.trim() });
				onFeedbackUpdate?.(updated);
				setShowComment(false);
				flashSuccess();
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Failed to save comment";
			setSubmitError(msg);
		} finally {
			setSubmitting(false);
		}
	}, [feedbackId, comment, customUpdate, onFeedbackUpdate, flashSuccess]);

	// ── Render ─────────────────────────────────────────────────────────────

	return (
		<div className="flex items-center gap-1.5">
			{/* Thumbs up */}
			<button
				onClick={() => handleRate(1)}
				disabled={submitting}
				className={`${buttonSize} rounded transition-colors ${
					rating === 1
						? "text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
						: "text-stone-400 hover:text-emerald-500 hover:bg-stone-100 dark:hover:bg-stone-800"
				} disabled:opacity-40 disabled:cursor-not-allowed`}
				title="Thumbs up — this was helpful"
				aria-label="Positive feedback"
			>
				<ThumbsUp size={iconSize} strokeWidth={1.5} />
			</button>

			{/* Thumbs down */}
			<button
				onClick={() => handleRate(-1)}
				disabled={submitting}
				className={`${buttonSize} rounded transition-colors ${
					rating === -1
						? "text-red-500 bg-red-50 dark:bg-red-900/20"
						: "text-stone-400 hover:text-red-500 hover:bg-stone-100 dark:hover:bg-stone-800"
				} disabled:opacity-40 disabled:cursor-not-allowed`}
				title="Thumbs down — this was not helpful"
				aria-label="Negative feedback"
			>
				<ThumbsDown size={iconSize} strokeWidth={1.5} />
			</button>

			{/* Success indicator */}
			{showSuccess && (
				<span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-500 font-medium animate-fade-in">
					<Check size={10} strokeWidth={2} />
					Saved
				</span>
			)}

			{/* Loading spinner */}
			{submitting && !showSuccess && (
				<Loader2 size={10} className="animate-spin text-stone-400" />
			)}

			{/* Error tooltip */}
			{submitError && (
				<span
					className="inline-flex items-center gap-0.5 text-[9px] text-red-500"
					title={submitError}
				>
					<AlertCircle size={10} strokeWidth={1.5} />
					Error
				</span>
			)}

			{/* Add/Show comment button (only after rating) */}
			{rating !== null && (
				<button
					onClick={() => setShowComment(!showComment)}
					className={`${buttonSize} rounded transition-colors text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 ${
						showComment ? "text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-800" : ""
					}`}
					title="Add a comment or teach Pi what to do differently"
					aria-label="Add feedback comment"
				>
					<MessageSquare size={iconSize} strokeWidth={1.5} />
				</button>
			)}

			{/* Comment input */}
			{showComment && (
				<div className="flex items-center gap-1.5 ml-1">
					<input
						type="text"
						value={comment}
						onChange={(e) => setComment(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && comment.trim()) {
								handleCommentSubmit();
							}
						}}
						placeholder="What should Pi do differently?"
						className={`text-[10px] px-1.5 py-0.5 rounded border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400 dark:focus:ring-stone-500 ${
							isSmall ? "w-36" : "w-48"
						}`}
						disabled={submitting}
						aria-label="Feedback comment input"
					/>
					<button
						onClick={handleCommentSubmit}
						disabled={!comment.trim() || submitting}
						className="text-[9px] px-1.5 py-0.5 rounded bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-800 hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-medium"
					>
						Send
					</button>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Empty state variation
// ---------------------------------------------------------------------------

/**
 * Renders a minimal "no feedback yet" indicator, useful in empty-state
 * contexts like digest entries that haven't been rated.
 */
export function NoFeedbackIndicator() {
	return (
		<span className="text-[9px] text-stone-400 dark:text-stone-500 italic flex items-center gap-1">
			<MessageSquare size={10} strokeWidth={1.2} />
			No feedback yet
		</span>
	);
}

// ---------------------------------------------------------------------------
// Error state variation
// ---------------------------------------------------------------------------

/**
 * Renders a feedback-specific error message with retry button.
 */
export function FeedbackErrorState({
	message,
	onRetry,
}: {
	message: string;
	onRetry?: () => void;
}) {
	return (
		<div className="flex items-center gap-1.5 text-[10px] text-red-500">
			<AlertCircle size={12} strokeWidth={1.5} />
			<span className="truncate max-w-[160px]">{message}</span>
			{onRetry && (
				<button
					onClick={onRetry}
					className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
				>
					Retry
				</button>
			)}
		</div>
	);
}
