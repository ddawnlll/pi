/**
 * GoalFilters — Status and priority filter tabs for the Goal Board.
 *
 * Allows the user to filter the goals list by status or priority.
 */

import type { GoalStatus, GoalPriority } from "../../../hooks/useGoals";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const MUT = "text-stone-400 dark:text-stone-500";

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

export type StatusFilterValue = "all" | GoalStatus;

export const STATUS_FILTERS: { key: StatusFilterValue; label: string; color?: string }[] = [
	{ key: "all", label: "All" },
	{ key: "active", label: "Active", color: "text-emerald-600 dark:text-emerald-400" },
	{ key: "completed", label: "Completed", color: "text-blue-600 dark:text-blue-400" },
	{ key: "paused", label: "Paused", color: "text-amber-600 dark:text-amber-400" },
	{ key: "cancelled", label: "Cancelled", color: "text-red-600 dark:text-red-400" },
	{ key: "needs_review", label: "Needs Review", color: "text-purple-600 dark:text-purple-400" },
];

export type PriorityFilterValue = "all" | GoalPriority;

export const PRIORITY_FILTERS: { key: PriorityFilterValue; label: string; color?: string }[] = [
	{ key: "all", label: "All" },
	{ key: "critical", label: "Critical", color: "text-red-600 dark:text-red-400" },
	{ key: "high", label: "High", color: "text-amber-600 dark:text-amber-400" },
	{ key: "normal", label: "Normal", color: "text-blue-600 dark:text-blue-400" },
	{ key: "low", label: "Low", color: "text-stone-500 dark:text-stone-400" },
];

// ---------------------------------------------------------------------------
// Component: StatusFilterBar
// ---------------------------------------------------------------------------

interface StatusFilterBarProps {
	value: StatusFilterValue;
	onChange: (value: StatusFilterValue) => void;
	counts?: Record<string, number>;
	className?: string;
}

/**
 * Horizontal filter tabs for goal status.
 */
export function StatusFilterBar({ value, onChange, counts, className = "" }: StatusFilterBarProps) {
	return (
		<div className={`flex items-center gap-1 overflow-x-auto ${className}`}>
			{STATUS_FILTERS.map((f) => {
				const count = counts?.[f.key];
				return (
					<button
						key={f.key}
						onClick={() => onChange(f.key as StatusFilterValue)}
						className={`flex items-center gap-1 h-7 px-2.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
							value === f.key
								? `${ACC_BG} ${ACC_TXT}`
								: `${MUT} hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
						}`}
					>
						<span className={value === f.key ? "" : f.color ?? ""}>{f.label}</span>
						{count !== undefined && count > 0 && (
							<span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
								value === f.key
									? "bg-white/50 dark:bg-black/20"
									: "bg-stone-100 dark:bg-[#2A2A2A]"
							}`}>
								{count}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Component: PriorityFilterBar
// ---------------------------------------------------------------------------

interface PriorityFilterBarProps {
	value: PriorityFilterValue;
	onChange: (value: PriorityFilterValue) => void;
	counts?: Record<string, number>;
	className?: string;
}

/**
 * Horizontal filter tabs for goal priority.
 */
export function PriorityFilterBar({ value, onChange, counts, className = "" }: PriorityFilterBarProps) {
	return (
		<div className={`flex items-center gap-1 overflow-x-auto ${className}`}>
			{PRIORITY_FILTERS.map((f) => {
				const count = counts?.[f.key];
				return (
					<button
						key={f.key}
						onClick={() => onChange(f.key as PriorityFilterValue)}
						className={`flex items-center gap-1 h-7 px-2.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
							value === f.key
								? `${ACC_BG} ${ACC_TXT}`
								: `${MUT} hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
						}`}
					>
						<span className={value === f.key ? "" : f.color ?? ""}>{f.label}</span>
						{count !== undefined && count > 0 && (
							<span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
								value === f.key
									? "bg-white/50 dark:bg-black/20"
									: "bg-stone-100 dark:bg-[#2A2A2A]"
							}`}>
								{count}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
