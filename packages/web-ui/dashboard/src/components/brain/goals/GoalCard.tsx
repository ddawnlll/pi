/**
 * GoalCard — Individual goal card for the Goal Board.
 *
 * Shows goal title, description (truncated), priority badge, status,
 * and milestone progress bar. Clickable to open detail view.
 */

import { milestoneProgress, type GoalRecord, type GoalPriority, type GoalStatus } from "../../../hooks/useGoals";
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

// ---------------------------------------------------------------------------
// Priority badge styles
// ---------------------------------------------------------------------------

const PRIORITY_STYLES: Record<GoalPriority, { bg: string; text: string; label: string }> = {
	critical: {
		bg: "bg-red-50 dark:bg-red-900/20",
		text: "text-red-700 dark:text-red-300",
		label: "CRITICAL",
	},
	high: {
		bg: "bg-amber-50 dark:bg-amber-900/20",
		text: "text-amber-700 dark:text-amber-300",
		label: "HIGH",
	},
	normal: {
		bg: "bg-blue-50 dark:bg-blue-900/20",
		text: "text-blue-700 dark:text-blue-300",
		label: "NORMAL",
	},
	low: {
		bg: "bg-stone-50 dark:bg-stone-800/50",
		text: "text-stone-500 dark:text-stone-400",
		label: "LOW",
	},
};

// ---------------------------------------------------------------------------
// Status styles
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<GoalStatus, { bg: string; text: string }> = {
	active: {
		bg: "bg-emerald-50 dark:bg-emerald-900/15",
		text: "text-emerald-700 dark:text-emerald-300",
	},
	completed: {
		bg: "bg-blue-50 dark:bg-blue-900/15",
		text: "text-blue-700 dark:text-blue-300",
	},
	paused: {
		bg: "bg-amber-50 dark:bg-amber-900/15",
		text: "text-amber-700 dark:text-amber-300",
	},
	cancelled: {
		bg: "bg-red-50 dark:bg-red-900/15",
		text: "text-red-700 dark:text-red-300",
	},
	needs_review: {
		bg: "bg-purple-50 dark:bg-purple-900/15",
		text: "text-purple-700 dark:text-purple-300",
	},
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GoalCardProps {
	goal: GoalRecord;
	selected?: boolean;
	onClick?: () => void;
}

/**
 * GoalCard — Displays a single goal with priority badge, status, title,
 * truncated description, and milestone progress.
 */
export function GoalCard({ goal, selected = false, onClick }: GoalCardProps) {
	const priorityStyle = PRIORITY_STYLES[goal.priority] ?? PRIORITY_STYLES.normal;
	const statusStyle = STATUS_STYLES[goal.status] ?? STATUS_STYLES.active;
	const progress = milestoneProgress(goal.milestones);
	const hasDrift = goal.status === "needs_review";

	return (
		<button
			onClick={onClick}
			className={`w-full text-left rounded-lg border transition-all ${
				selected
					? `${ACC_BG} border-blue-200 dark:border-blue-800`
					: `${SURF} ${BORD} hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-sm`
			}`}
		>
			<div className="p-3 space-y-2.5">
				{/* Top row: priority badge + status */}
				<div className="flex items-center gap-1.5">
					<span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${priorityStyle.bg} ${priorityStyle.text}`}>
						{priorityStyle.label}
					</span>
					<span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
						{hasDrift && <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />}
						{goal.status === "active" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
						{goal.status === "completed" && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
						{goal.status}
					</span>
					{goal.category && (
						<span className={`text-[9px] ${MUT} ml-auto`}>{goal.category}</span>
					)}
				</div>

				{/* Title + description */}
				<div>
					<h3 className={`text-sm font-semibold leading-snug ${TXT} line-clamp-2`}>
						{goal.title}
					</h3>
					{goal.description && (
						<p className={`text-[11px] leading-relaxed mt-1 ${MUT} line-clamp-2`}>
							{goal.description}
						</p>
					)}
				</div>

				{/* Milestone progress bar (compact) */}
				<MilestoneTracker milestones={goal.milestones} compact />

				{/* Target date info */}
				{goal.targetDate && (
					<div className={`flex items-center gap-1 text-[9px] ${MUT}`}>
						<svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
							<circle cx="5" cy="5" r="4.5" stroke="currentColor" strokeWidth="1" />
							<path d="M5 3V5L6.5 6.5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
						</svg>
						Target: {new Date(goal.targetDate).toLocaleDateString()}
					</div>
				)}

				{/* Milestone summary */}
				{goal.milestones.length > 0 && (
					<div className={`flex items-center gap-1.5 text-[9px] ${MUT}`}>
						<svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
							<rect x="1" y="1" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1" />
							<path d="M3 5L4.5 6.5L7 4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
						{goal.milestones.filter((m) => m.completed).length} / {goal.milestones.length} milestones
						<span className="ml-auto">{progress}%</span>
					</div>
				)}
			</div>
		</button>
	);
}
