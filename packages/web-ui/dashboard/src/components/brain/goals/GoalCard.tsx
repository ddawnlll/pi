import React from "react";
import type { GoalRecord } from "../../../types-brain";

interface GoalCardProps {
	goal: GoalRecord;
	drifted: boolean;
	onClick: () => void;
}

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
	critical: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300" },
	high: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300" },
	normal: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300" },
	low: { bg: "bg-stone-100 dark:bg-stone-800", text: "text-stone-400 dark:text-stone-500" },
};

const PROGRESS_COLORS = ["bg-red-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500"];

export function GoalCard({ goal, drifted, onClick }: GoalCardProps) {
	const ps = PRIORITY_STYLES[goal.priority] ?? PRIORITY_STYLES.normal;
	const progressColor = PROGRESS_COLORS[
		Math.min(Math.floor(goal.progress / 25), PROGRESS_COLORS.length - 1)
	];

	return (
		<button
			onClick={onClick}
			className={`w-full text-left border rounded-lg p-3 space-y-2 transition-smooth card-hover hover:border-blue-300 dark:hover:border-blue-700 ${
				drifted ? "border-red-300 dark:border-red-700" : "border-stone-200 dark:border-stone-700"
			}`}
		>
			<div className="flex items-start justify-between gap-1">
				<span className="text-xs font-medium text-stone-800 dark:text-stone-200 truncate">
					{goal.title}
				</span>
				{drifted && <span className="shrink-0 text-xs text-red-500 font-medium">Drifted</span>}
			</div>

			<div className="flex items-center gap-1.5">
				<span className={`px-1 py-0.5 text-xs rounded-full ${ps.bg} ${ps.text}`}>
					{goal.priority}
				</span>
				<span className="text-xs text-stone-400">
					{goal.milestones.filter((m) => m.completed).length}/{goal.milestones.length} done
				</span>
			</div>

			{/* Progress bar */}
			<div className="h-1.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
				<div
					className={`h-full rounded-full transition-all ${progressColor}`}
					style={{ width: `${goal.progress}%` }}
				/>
			</div>
		</button>
	);
}
