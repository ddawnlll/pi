/**
 * BrainNudgeCard — sidebar nudge showing brain activity summary
 *
 * Displays compact counts of observations needing attention, pending
 * proposals, and pending approvals. Placed inside the brain section
 * of the project-centric sidebar.
 */

import { AlertCircle, FileText, ShieldAlert } from "lucide-react";

// ---------------------------------------------------------------------------
// Style tokens (matching Sidebar.tsx conventions)
// ---------------------------------------------------------------------------

const MUT = "text-stone-400 dark:text-stone-500";
const TXT = "text-stone-800 dark:text-stone-200";
const BORD = "border-[#E8E6E1] dark:border-[#333]";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrainNudgeCardProps {
	/** Critical + warning observations count */
	observations: number;
	/** Pending proposals count */
	proposals: number;
	/** Pending approvals count */
	approvals: number;
	/** If true, show loading skeleton */
	loading?: boolean;
}

// ---------------------------------------------------------------------------
// Nudge row component
// ---------------------------------------------------------------------------

interface NudgeRowProps {
	icon: React.ElementType;
	label: string;
	count: number;
	accent?: "critical" | "warning" | "info";
}

function NudgeRow({ icon: Icon, label, count, accent }: NudgeRowProps) {
	const accentColor =
		accent === "critical"
			? "text-red-600 dark:text-red-400"
			: accent === "warning"
				? "text-amber-600 dark:text-amber-400"
				: "text-blue-600 dark:text-blue-400";
	const bgAccent =
		accent === "critical"
			? "bg-red-50 dark:bg-red-900/20"
			: accent === "warning"
				? "bg-amber-50 dark:bg-amber-900/20"
				: "bg-blue-50 dark:bg-blue-900/20";

	return (
		<div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors">
			<span
				className={`flex items-center justify-center w-6 h-6 rounded-md shrink-0 ${bgAccent}`}
			>
				<Icon size={12} strokeWidth={2} className={accentColor} />
			</span>
			<span className={`flex-1 text-[11px] ${TXT}`}>{label}</span>
			<span
				className={`text-[11px] font-semibold font-mono tabular-nums ${accentColor}`}
			>
				{count}
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Skeleton loading state
// ---------------------------------------------------------------------------

function NudgeSkeleton() {
	return (
		<div className="flex flex-col gap-1.5 animate-pulse px-1">
			<div className="flex items-center gap-2 px-2 py-1.5">
				<div className="w-6 h-6 rounded-md bg-stone-200 dark:bg-stone-700" />
				<div className="flex-1 h-3 rounded bg-stone-200 dark:bg-stone-700" />
				<div className="w-6 h-3 rounded bg-stone-200 dark:bg-stone-700" />
			</div>
			<div className="flex items-center gap-2 px-2 py-1.5">
				<div className="w-6 h-6 rounded-md bg-stone-200 dark:bg-stone-700" />
				<div className="flex-1 h-3 rounded bg-stone-200 dark:bg-stone-700" />
				<div className="w-6 h-3 rounded bg-stone-200 dark:bg-stone-700" />
			</div>
			<div className="flex items-center gap-2 px-2 py-1.5">
				<div className="w-6 h-6 rounded-md bg-stone-200 dark:bg-stone-700" />
				<div className="flex-1 h-3 rounded bg-stone-200 dark:bg-stone-700" />
				<div className="w-6 h-3 rounded bg-stone-200 dark:bg-stone-700" />
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function NudgeEmpty() {
	return (
		<div className="flex flex-col items-center gap-1 px-3 py-3 text-center">
			<span className="text-xs text-stone-400 dark:text-stone-500">
				No new brain activity
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function NudgeError() {
	return (
		<div className="flex flex-col items-center gap-1 px-3 py-3 text-center">
			<span className="text-[10px] text-amber-600 dark:text-amber-400">
				Could not load brain state
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BrainNudgeCard({
	observations,
	proposals,
	approvals,
	loading = false,
}: BrainNudgeCardProps) {
	if (loading) {
		return (
			<div
				className={`mx-1 mb-1 rounded-lg border ${BORD} bg-white dark:bg-[#1E1E1E] overflow-hidden`}
			>
				<div className={`px-3 py-1.5 border-b ${BORD}`}>
					<span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
						Brain Activity
					</span>
				</div>
				<div className="py-2">
					<NudgeSkeleton />
				</div>
			</div>
		);
	}

	const total = observations + proposals + approvals;

	if (total === 0) {
		return (
			<div
				className={`mx-1 mb-1 rounded-lg border ${BORD} bg-white dark:bg-[#1E1E1E] overflow-hidden`}
			>
				<div className={`px-3 py-1.5 border-b ${BORD}`}>
					<span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
						Brain Activity
					</span>
				</div>
				<NudgeEmpty />
			</div>
		);
	}

	return (
		<div
			className={`mx-1 mb-1 rounded-lg border ${BORD} bg-white dark:bg-[#1E1E1E] overflow-hidden`}
		>
			<div className={`px-3 py-1.5 border-b ${BORD}`}>
				<span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
					Brain Activity
				</span>
			</div>
			<div className="py-1">
				{observations > 0 && (
					<NudgeRow
						icon={AlertCircle}
						label="Needs attention"
						count={observations}
						accent={observations > 5 ? "critical" : "warning"}
					/>
				)}
				{proposals > 0 && (
					<NudgeRow icon={FileText} label="Pending proposals" count={proposals} accent="info" />
				)}
				{approvals > 0 && (
					<NudgeRow
						icon={ShieldAlert}
						label="Pending approvals"
						count={approvals}
						accent="info"
					/>
				)}
			</div>
		</div>
	);
}
