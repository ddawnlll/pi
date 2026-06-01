/**
 * WorkspaceCardActions — Action buttons for workspace cards (P42.05).
 *
 * Provides contextual action buttons: Stop, Retry for workspaces.
 * Shown on hover / as needed.
 */

import { Square, RefreshCw } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkspaceCardActionsProps {
	workspaceId: string;
	stage: string;
	/** Called when stop is requested */
	onStop?: (workspaceId: string) => void;
	/** Called when retry is requested */
	onRetry?: (workspaceId: string) => void;
	className?: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function WorkspaceCardActions({
	workspaceId,
	stage,
	onStop,
	onRetry,
	className = "",
}: WorkspaceCardActionsProps) {
	const showStop = (stage === "active" || stage === "blocked") && onStop;
	const showRetry = stage === "failed" && onRetry;

	if (!showStop && !showRetry) return null;

	return (
		<div className={`flex items-center gap-0.5 ${className}`}>
			{showStop && (
				<button
					onClick={(e) => {
						e.stopPropagation();
						onStop?.(workspaceId);
					}}
					title="Stop workspace"
					className="p-1 rounded hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
					aria-label={`Stop workspace ${workspaceId}`}
				>
					<Square size={10} fill="currentColor" />
				</button>
			)}
			{showRetry && (
				<button
					onClick={(e) => {
						e.stopPropagation();
						onRetry?.(workspaceId);
					}}
					title="Retry workspace"
					className="p-1 rounded hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 transition-colors"
					aria-label={`Retry workspace ${workspaceId}`}
				>
					<RefreshCw size={11} />
				</button>
			)}
		</div>
	);
}
