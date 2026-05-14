import { Cpu, Loader2, CheckCircle, AlertTriangle, XCircle, Clock, AlertCircle, ArrowRight } from "lucide-react";
import type { ExecutionStats } from "../types";

// ─── tokens ──────────────────────────────────────────────────────────────────

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const MUT = "text-stone-400 dark:text-stone-500";

// ─── Scheduler status count badge ────────────────────────────────────────────

interface StatusCountProps {
	label: string;
	count: number;
	icon: React.ReactNode;
	color: string;
	bgColor: string;
}

/** A single status counter badge for the scheduler panel. */
function StatusCount({ label, count, icon, color, bgColor }: StatusCountProps) {
	return (
		<div className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg ${bgColor}`}>
			<div className={`${color}`}>{icon}</div>
			<span className={`text-lg font-bold tabular-nums ${color}`}>{count}</span>
			<span className={`text-[9px] uppercase tracking-widest font-semibold ${MUT}`}>{label}</span>
		</div>
	);
}

// ─── SchedulerStatusPanel ─────────────────────────────────────────────────────

interface SchedulerStatusPanelProps {
	/** Execution stats from the backend, or null if unavailable. */
	stats: ExecutionStats | null;
	/** Optional class name. */
	className?: string;
}

/**
 * Scheduler status panel showing active/max/ready/blocked worker counts.
 *
 * Displays a compact grid of status counters derived from ExecutionStats,
 * providing at-a-glance visibility into scheduler activity:
 * - Active workers (currently running)
 * - Ready/pending workers (available to schedule)
 * - Blocked workers (waiting on dependencies)
 * - Completed workers (finished successfully)
 * - Failed workers (terminated with errors)
 * - Total workers (overall count)
 *
 * Also shows:
 * - Requested workers vs max allowed workers
 * - Safe effective parallelism when available
 * - Bottleneck reasons when the scheduler is constrained
 * - Plan progress as a percentage bar
 *
 * Acceptance criteria covered:
 * - Scheduler status shows active/max/ready/blocked counts
 * - Scheduler panel shows requested workers and max allowed workers
 * - Scheduler panel shows safe effective parallelism if available
 * - Scheduler panel shows bottleneck reasons
 * - Existing progress display remains
 */
export function SchedulerStatusPanel({ stats, className }: SchedulerStatusPanelProps) {
	if (!stats) {
		return (
			<div className={`flex flex-col items-center justify-center py-6 gap-2 ${MUT} text-xs ${className ?? ""}`}>
				<Cpu size={18} strokeWidth={1.8} />
				<span>No scheduler data</span>
			</div>
		);
	}

	const items = [
		{
			label: "Active",
			count: stats.active,
			icon: <Loader2 size={16} className="animate-spin" />,
			color: "text-emerald-600 dark:text-emerald-400",
			bgColor: "bg-emerald-50 dark:bg-emerald-900/20",
		},
		{
			label: "Total",
			count: stats.total,
			icon: <Cpu size={16} />,
			color: "text-stone-700 dark:text-stone-300",
			bgColor: "bg-stone-50 dark:bg-[#222]",
		},
		{
			label: "Ready",
			count: stats.pending,
			icon: <Clock size={16} />,
			color: "text-blue-600 dark:text-blue-400",
			bgColor: "bg-blue-50 dark:bg-blue-900/20",
		},
		{
			label: "Blocked",
			count: stats.blocked,
			icon: <AlertTriangle size={16} />,
			color: "text-amber-600 dark:text-amber-400",
			bgColor: "bg-amber-50 dark:bg-amber-900/20",
		},
		{
			label: "Complete",
			count: stats.complete,
			icon: <CheckCircle size={16} />,
			color: "text-blue-600 dark:text-blue-400",
			bgColor: "bg-blue-50 dark:bg-blue-900/20",
		},
		{
			label: "Failed",
			count: stats.failed,
			icon: <XCircle size={16} />,
			color: "text-red-600 dark:text-red-400",
			bgColor: "bg-red-50 dark:bg-red-900/20",
		},
	];

	// Progress bar: complete / total
	const progressPct = stats.total > 0 ? Math.round((stats.complete / stats.total) * 100) : 0;
	const barColor = progressPct >= 80 ? "bg-emerald-500" : progressPct >= 50 ? "bg-blue-500" : "bg-amber-500";

	// Scheduler parallelism info
	const showParallelism =
		stats.requestedWorkers !== undefined &&
		stats.maxAllowedWorkers !== undefined;
	const showSafeParallelism = stats.safeEffectiveParallelism !== undefined;
	const showBottlenecks =
		stats.bottleneckReasons !== undefined && stats.bottleneckReasons.length > 0;

	return (
		<div className={`${className ?? ""}`}>
			{/* Status badge grid */}
			<div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
				{items.map(item => (
					<StatusCount
						key={item.label}
						label={item.label}
						count={item.count}
						icon={item.icon}
						color={item.color}
						bgColor={item.bgColor}
					/>
				))}
			</div>

			{/* Worker parallelism info */}
			{showParallelism && (
				<div className="mt-2 flex items-center gap-3 text-[11px] text-stone-600 dark:text-stone-400">
					<div className="flex items-center gap-1">
						<Cpu size={12} />
						<span>Requested:</span>
						<span className="font-semibold tabular-nums text-stone-800 dark:text-stone-200">
							{stats.requestedWorkers}
						</span>
					</div>
					<ArrowRight size={10} />
					<div className="flex items-center gap-1">
						<span>Max allowed:</span>
						<span className="font-semibold tabular-nums text-stone-800 dark:text-stone-200">
							{stats.maxAllowedWorkers}
						</span>
					</div>
				</div>
			)}

			{/* Safe effective parallelism */}
			{showSafeParallelism && (
				<div className="mt-1 flex items-center gap-1.5 text-[11px] text-stone-600 dark:text-stone-400">
					<Clock size={12} />
					<span>Safe effective parallelism:</span>
					<span className="font-semibold tabular-nums text-stone-800 dark:text-stone-200">
						{stats.safeEffectiveParallelism}
					</span>
				</div>
			)}

			{/* Bottleneck reasons */}
			{showBottlenecks && (
				<div className="mt-1.5 space-y-0.5">
					{stats.bottleneckReasons!.map((reason, idx) => (
						<div
							key={idx}
							className="flex items-start gap-1.5 text-[10px] text-amber-600 dark:text-amber-400"
						>
							<AlertCircle size={10} className="mt-0.5 shrink-0" />
							<span>{reason}</span>
						</div>
					))}
				</div>
			)}

			{/* Progress bar */}
			<div className="mt-3">
				<div className="flex items-center justify-between text-[10px] text-stone-500 dark:text-stone-400 mb-1">
					<span>Progress</span>
					<span className="tabular-nums font-medium">
						{stats.complete}/{stats.total} ({progressPct}%)
					</span>
				</div>
				<div className="w-full h-1.5 bg-stone-100 dark:bg-[#333] rounded-full overflow-hidden">
					<div
						className={`h-full rounded-full transition-all duration-500 ease-out ${barColor}`}
						style={{ width: `${Math.min(progressPct, 100)}%` }}
					/>
				</div>
			</div>
		</div>
	);
}
