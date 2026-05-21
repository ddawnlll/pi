/**
 * MilestoneTracker — Milestone progress bar for a goal.
 *
 * Renders a percentage bar with milestone count and optional completion
 * details.
 */

import { milestoneProgress, type Milestone } from "../../../hooks/useGoals";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MilestoneTrackerProps {
	milestones: Milestone[];
	className?: string;
	/** Optional: show a compact version (no milestone labels) */
	compact?: boolean;
}

/**
 * MilestoneTracker — Shows milestone completion progress as a bar.
 *
 * When not compact, also lists individual milestone items.
 */
export function MilestoneTracker({ milestones, className = "", compact = false }: MilestoneTrackerProps) {
	const progress = milestoneProgress(milestones);
	const completed = milestones.filter((m) => m.completed).length;
	const total = milestones.length;

	// Color based on progress
	const barColor =
		progress === 100
			? "bg-emerald-500 dark:bg-emerald-400"
			: progress >= 50
				? "bg-blue-500 dark:bg-blue-400"
				: progress > 0
					? "bg-amber-500 dark:bg-amber-400"
					: "bg-stone-200 dark:bg-stone-600";

	return (
		<div className={className}>
			{/* Progress bar */}
			<div className="flex items-center gap-2.5">
				<div className="flex-1 h-2 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
					<div
						className={`h-full rounded-full transition-all duration-500 ${barColor}`}
						style={{ width: `${progress}%` }}
					/>
				</div>
				<span className={`text-[11px] font-semibold tabular-nums ${MUT} shrink-0`}>
					{completed}/{total}
				</span>
				<span className="text-[11px] font-bold tabular-nums text-stone-600 dark:text-stone-400 shrink-0 w-8 text-right">
					{progress}%
				</span>
			</div>

			{/* Milestone list (when not compact) */}
			{!compact && milestones.length > 0 && (
				<div className="mt-2 space-y-1">
					{milestones
						.slice()
						.sort((a, b) => a.order - b.order)
						.map((m) => (
							<div key={m.id} className="flex items-start gap-2 py-0.5">
								<span className={`mt-0.5 shrink-0 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
									m.completed
										? "bg-emerald-500 border-emerald-500 dark:bg-emerald-400 dark:border-emerald-400"
										: "border-stone-300 dark:border-stone-600"
								}`}>
									{m.completed && (
										<svg width="8" height="8" viewBox="0 0 8 8" fill="none">
											<path d="M1 4L3 6L7 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									)}
								</span>
								<div className="flex-1 min-w-0">
									<p className={`text-[11px] leading-tight ${
										m.completed
											? "text-stone-500 dark:text-stone-400 line-through"
											: TXT
									}`}>
										{m.title}
									</p>
									{m.description && (
										<p className={`text-[9px] leading-tight mt-0.5 ${MUT}`}>{m.description}</p>
									)}
								</div>
							</div>
						))}
				</div>
			)}

			{/* Empty state */}
			{!compact && milestones.length === 0 && (
				<p className={`text-[11px] italic ${MUT} mt-1`}>No milestones defined yet.</p>
			)}
		</div>
	);
}
