/**
 * CompletionStatusSummary — P44.10 Completion Truth Visibility
 *
 * Displays the completion gate status for a workspace: whether it can be
 * completed, and if blocked, the reasons and recommended stage.
 *
 * Uses the read model API via useWorkspaceCompletionStatus hook.
 * When data is unavailable, shows a muted "not available" indicator.
 */

import type { CompletionStatus } from "../hooks/useWorkspaceCompletionStatus";

interface CompletionStatusSummaryProps {
	/** Completion status data (from useWorkspaceCompletionStatus) */
	status: CompletionStatus | undefined;
	/** Whether the status data is still loading */
	isLoading: boolean;
}

/**
 * Compact completion status badge.
 * Shows a green checkmark when canComplete is true,
 * an amber warning with block reasons when blocked,
 * or a muted indicator when no data is available.
 */
export function CompletionStatusBadge({ status, isLoading }: CompletionStatusSummaryProps) {
	if (isLoading) {
		return (
			<div className="text-xs text-stone-400 dark:text-stone-500 italic animate-pulse">
				Loading completion status...
			</div>
		);
	}

	if (!status || !status.dataAvailability?.available) {
		return (
			<div className="text-xs text-stone-400 dark:text-stone-500">
				Completion status not available
			</div>
		);
	}

	if (status.canComplete) {
		return (
			<div className="flex items-center gap-1.5 text-xs">
				<span className="inline-block w-2 h-2 bg-emerald-500 rounded-full shrink-0" />
				<span className="text-emerald-700 dark:text-emerald-400 font-medium">Can complete</span>
			</div>
		);
	}

	return (
		<div className="space-y-1">
			<div className="flex items-center gap-1.5 text-xs">
				<span className="inline-block w-2 h-2 bg-amber-500 rounded-full shrink-0" />
				<span className="text-amber-700 dark:text-amber-400 font-medium">
					Completion blocked — {status.recommendedStage ?? "blocked"}
				</span>
			</div>
			{status.blockReasons.length > 0 && (
				<ul className="ml-4 list-disc text-xs text-amber-600 dark:text-amber-300 space-y-0.5">
					{status.blockReasons.map((reason, i) => (
						<li key={i}>{reason}</li>
					))}
				</ul>
			)}
		</div>
	);
}

/**
 * Detailed completion status panel for the workspace overview.
 * Shows all completion gate details including block reasons in a structured card.
 */
export function CompletionStatusPanel({ status, isLoading }: CompletionStatusSummaryProps) {
	if (isLoading) {
		return (
			<div className="border border-[#E8E6E1] dark:border-[#333] rounded p-3 bg-stone-50 dark:bg-[#161616]">
				<div className="text-sm mb-2 font-semibold text-stone-600 dark:text-stone-400">Completion Gate</div>
				<div className="text-xs text-stone-400 dark:text-stone-500 italic animate-pulse">
					Loading completion status...
				</div>
			</div>
		);
	}

	if (!status || !status.dataAvailability?.available) {
		return (
			<div className="border border-[#E8E6E1] dark:border-[#333] rounded p-3 bg-stone-50 dark:bg-[#161616]">
				<div className="text-sm mb-2 font-semibold text-stone-600 dark:text-stone-400">Completion Gate</div>
				<div className="text-xs text-stone-400 dark:text-stone-500">
					Completion status not yet available. The workspace has not been evaluated by the completion gate.
				</div>
			</div>
		);
	}

	return (
		<div className="border border-[#E8E6E1] dark:border-[#333] rounded p-3 bg-stone-50 dark:bg-[#161616]">
			<div className="flex items-center justify-between mb-2">
				<div className="text-sm font-semibold text-stone-600 dark:text-stone-400">Completion Gate</div>
				{status.canComplete ? (
					<span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
						<span className="w-2 h-2 bg-emerald-500 rounded-full" />
						Can complete
					</span>
				) : (
					<span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 font-medium">
						<span className="w-2 h-2 bg-amber-500 rounded-full" />
						Blocked
					</span>
				)}
			</div>
			{!status.canComplete && status.blockReasons.length > 0 && (
				<div className="space-y-1.5">
					<div className="text-xs font-medium text-stone-500 dark:text-stone-400">Block reasons:</div>
					<ul className="ml-3 list-disc space-y-1">
						{status.blockReasons.map((reason, i) => (
							<li key={i} className="text-xs text-stone-700 dark:text-stone-300">{reason}</li>
						))}
					</ul>
				</div>
			)}
			{!status.canComplete && status.recommendedStage && (
				<div className="mt-2 text-xs text-stone-500 dark:text-stone-400">
					Recommended stage: <span className="font-medium text-stone-700 dark:text-stone-300 capitalize">{status.recommendedStage}</span>
				</div>
			)}
			{status.canComplete && (
				<div className="text-xs text-stone-500 dark:text-stone-400">
					This workspace passed all completion gate checks.
				</div>
			)}
		</div>
	);
}
