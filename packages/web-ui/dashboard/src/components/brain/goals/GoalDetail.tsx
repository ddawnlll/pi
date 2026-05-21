/**
 * GoalDetail — Full detail view for a single goal with milestone list,
 * progress tracking, edit/complete/delete actions.
 */

import { X, Edit3, CheckCircle, Trash2, Clock, CalendarDays } from "lucide-react";
import type { GoalRecord } from "../../../hooks/useGoals";
import { MilestoneTracker } from "./MilestoneTracker";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const BG = "bg-[#F7F6F3] dark:bg-[#161616]";

// ---------------------------------------------------------------------------
// Priority + Status display helpers
// ---------------------------------------------------------------------------

type GP = GoalRecord["priority"];
type GS = GoalRecord["status"];

const PRIORITY_STYLES: Record<GP, { bg: string; text: string; label: string }> = {
	critical: { bg: "bg-red-50 dark:bg-red-900/20", text: "text-red-700 dark:text-red-300", label: "CRITICAL" },
	high: { bg: "bg-amber-50 dark:bg-amber-900/20", text: "text-amber-700 dark:text-amber-300", label: "HIGH" },
	normal: { bg: "bg-blue-50 dark:bg-blue-900/20", text: "text-blue-700 dark:text-blue-300", label: "NORMAL" },
	low: { bg: "bg-stone-50 dark:bg-stone-800/50", text: "text-stone-500 dark:text-stone-400", label: "LOW" },
};

const STATUS_STYLES: Record<GS, { bg: string; text: string }> = {
	active: { bg: "bg-emerald-50 dark:bg-emerald-900/15", text: "text-emerald-700 dark:text-emerald-300" },
	completed: { bg: "bg-blue-50 dark:bg-blue-900/15", text: "text-blue-700 dark:text-blue-300" },
	paused: { bg: "bg-amber-50 dark:bg-amber-900/15", text: "text-amber-700 dark:text-amber-300" },
	cancelled: { bg: "bg-red-50 dark:bg-red-900/15", text: "text-red-700 dark:text-red-300" },
	needs_review: { bg: "bg-purple-50 dark:bg-purple-900/15", text: "text-purple-700 dark:text-purple-300" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GoalDetailProps {
	goal: GoalRecord;
	onClose: () => void;
	onEdit: (goal: GoalRecord) => void;
	onComplete: (id: string) => void;
	onDelete: (id: string) => void;
	isCompleting?: boolean;
	isDeleting?: boolean;
	className?: string;
}

/**
 * GoalDetail — Full detail panel showing goal information, milestones,
 * metadata, and actions (edit, complete, delete).
 */
export function GoalDetail({
	goal,
	onClose,
	onEdit,
	onComplete,
	onDelete,
	isCompleting = false,
	isDeleting = false,
	className = "",
}: GoalDetailProps) {
	const pStyle = PRIORITY_STYLES[goal.priority] ?? PRIORITY_STYLES.normal;
	const sStyle = STATUS_STYLES[goal.status] ?? STATUS_STYLES.active;
	const canComplete = goal.status === "active" || goal.status === "paused";

	return (
		<div className={`flex flex-col overflow-hidden ${SURF} ${className}`}>
			{/* Header */}
			<div className={`shrink-0 flex items-center gap-3 px-4 py-3 border-b ${BORD}`}>
				<h2 className={`text-sm font-bold ${TXT} truncate flex-1`}>{goal.title}</h2>
				<button
					onClick={() => onEdit(goal)}
					className={`flex items-center gap-1 h-7 px-2 rounded-lg text-[10px] font-medium ${ACC_TXT} hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors`}
					title="Edit goal"
				>
					<Edit3 size={11} /> Edit
				</button>
				<button
					onClick={onClose}
					className={`flex items-center justify-center h-7 w-7 rounded-lg ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
				>
					<X size={14} />
				</button>
			</div>

			{/* Body */}
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				{/* Badges row */}
				<div className="flex items-center gap-1.5 flex-wrap">
					<span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${pStyle.bg} ${pStyle.text}`}>
						{pStyle.label}
					</span>
					<span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-semibold ${sStyle.bg} ${sStyle.text}`}>
						{goal.status}
					</span>
					{goal.category && (
						<span className={`text-[9px] px-1.5 py-0.5 rounded ${BG} ${MUT}`}>
							{goal.category}
						</span>
					)}
				</div>

				{/* Description */}
				{goal.description && (
					<div>
						<h4 className={`text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1`}>Description</h4>
						<p className={`text-xs leading-relaxed ${TXT}`}>{goal.description}</p>
					</div>
				)}

				{/* Metadata grid */}
				<div className="grid grid-cols-2 gap-2">
					{goal.targetDate && (
						<div className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${BORD} ${BG}`}>
							<CalendarDays size={12} className={MUT} />
							<div>
								<p className={`text-[9px] font-semibold uppercase tracking-wider ${MUT}`}>Target Date</p>
								<p className={`text-[11px] font-medium ${TXT}`}>{new Date(goal.targetDate).toLocaleDateString()}</p>
							</div>
						</div>
					)}
					<div className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${BORD} ${BG}`}>
						<Clock size={12} className={MUT} />
						<div>
							<p className={`text-[9px] font-semibold uppercase tracking-wider ${MUT}`}>Created</p>
							<p className={`text-[11px] font-medium ${TXT}`}>{new Date(goal.createdAt).toLocaleDateString()}</p>
						</div>
					</div>
					{goal.completedAt && (
						<div className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${BORD} ${BG}`}>
							<CheckCircle size={12} className="text-emerald-500" />
							<div>
								<p className={`text-[9px] font-semibold uppercase tracking-wider ${MUT}`}>Completed</p>
								<p className={`text-[11px] font-medium text-emerald-700 dark:text-emerald-300`}>
									{new Date(goal.completedAt).toLocaleDateString()}
								</p>
							</div>
						</div>
					)}
				</div>

				{/* Milestones progress */}
				<div>
					<h4 className={`text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-2`}>
						Milestones ({goal.milestones.filter((m) => m.completed).length}/{goal.milestones.length})
					</h4>
					<MilestoneTracker milestones={goal.milestones} />
				</div>
			</div>

			{/* Footer: actions */}
			<div className={`shrink-0 border-t ${BORD} ${SURF} p-3 flex items-center gap-2`}>
				{canComplete && (
					<button
						onClick={() => onComplete(goal.id)}
						disabled={isCompleting}
						className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-[10px] font-semibold transition-colors ${
							isCompleting
								? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-400 cursor-not-allowed"
								: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
						}`}
					>
						<CheckCircle size={12} />
						{isCompleting ? "Completing..." : "Mark Complete"}
					</button>
				)}
				<div className="flex-1" />
				<button
					onClick={() => onDelete(goal.id)}
					disabled={isDeleting}
					className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-[10px] font-semibold transition-colors ${
						isDeleting
							? "bg-red-50 dark:bg-red-900/30 text-red-400 cursor-not-allowed"
							: "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
					}`}
				>
					<Trash2 size={12} />
					{isDeleting ? "Deleting..." : "Delete"}
				</button>
			</div>
		</div>
	);
}
