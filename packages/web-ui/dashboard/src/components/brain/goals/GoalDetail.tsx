import React from "react";
import type { GoalRecord } from "../../../types-brain";
import { MilestoneTracker } from "./MilestoneTracker";

interface GoalDetailProps {
	goal: GoalRecord;
	onClose: () => void;
	onComplete: () => void;
	onDelete?: () => void;
	onUpdate?: (data: Partial<GoalRecord>) => void;
	loading: boolean;
}

export function GoalDetail({ goal, onClose, onComplete, onDelete, onUpdate, loading }: GoalDetailProps) {
	return (
		<div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
			<div className="bg-white dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 w-full max-w-lg shadow-xl max-h-[80vh] flex flex-col">
				<div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-700 shrink-0">
					<h3 className="text-sm font-medium text-stone-800 dark:text-stone-200">{goal.title}</h3>
					<button onClick={onClose} className="text-stone-400 hover:text-stone-600">✕</button>
				</div>

				<div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
					{goal.description && (
						<p className="text-xs text-stone-600 dark:text-stone-300">{goal.description}</p>
					)}

					<div className="flex items-center gap-3 text-[10px] text-stone-400">
						<span>Priority: {goal.priority}</span>
						<span>Status: {goal.status}</span>
						<span>Progress: {goal.progress}%</span>
					</div>

					{/* Progress bar */}
					<div className="h-2 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
						<div
							className="h-full rounded-full bg-blue-500 transition-all"
							style={{ width: `${goal.progress}%` }}
						/>
					</div>

					<MilestoneTracker milestones={goal.milestones} />

					<div className="text-[9px] text-stone-400 space-y-0.5">
						<p>Created: {new Date(goal.createdAt).toLocaleDateString()}</p>
						{goal.completedAt && <p>Completed: {new Date(goal.completedAt).toLocaleDateString()}</p>}
					</div>
				</div>

				<div className="flex items-center gap-2 px-5 py-3 border-t border-stone-100 dark:border-stone-700 shrink-0">
					{goal.status !== "complete" && (
						<button onClick={onComplete} disabled={loading}
							className="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 disabled:opacity-50">
							Mark Complete
						</button>
					)}
					{onDelete && (
						<button onClick={onDelete} disabled={loading}
							className="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 disabled:opacity-50">
							Delete
						</button>
					)}
					<div className="flex-1" />
					<button onClick={onClose}
						className="px-3 py-1.5 text-[10px] rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300">
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
