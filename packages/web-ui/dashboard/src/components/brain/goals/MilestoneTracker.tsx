import React from "react";
import type { Milestone } from "../../../types-brain";

interface MilestoneTrackerProps {
	milestones: Milestone[];
}

export function MilestoneTracker({ milestones }: MilestoneTrackerProps) {
	if (milestones.length === 0) return null;
	const completed = milestones.filter((m) => m.completed).length;

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between text-[10px]">
				<span className="font-medium text-stone-500">Milestones</span>
				<span className="text-stone-400">{completed}/{milestones.length}</span>
			</div>
			<div className="space-y-1">
				{milestones.map((m) => (
					<div key={m.id} className="flex items-center gap-2 text-[10px]">
						<span className={`w-3 h-3 rounded-full border flex items-center justify-center shrink-0 ${
							m.completed ? "bg-emerald-500 border-emerald-500" : "border-stone-300 dark:border-stone-600"
						}`}>
							{m.completed && (
								<svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
									<path d="M5 13l4 4L19 7" />
								</svg>
							)}
						</span>
						<span className={`${m.completed ? "text-stone-400 line-through" : "text-stone-600 dark:text-stone-300"}`}>
							{m.title}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
