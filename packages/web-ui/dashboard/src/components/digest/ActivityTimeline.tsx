/**
 * ActivityTimeline — Displays a unified feed of recent system activity.
 *
 * Shows plan execution events (started, completed, failed, paused, stopped)
 * with loading, empty, error, and populated states.
 */

import { AlertCircle, CheckCircle, Clock, Loader2, PauseCircle, PlayCircle, StopCircle, RefreshCw } from "lucide-react";
import { useActivityTimeline } from "../../hooks/useActivityTimeline";
import type { ActivityEvent } from "../../hooks/useActivityTimeline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<string, typeof PlayCircle> = {
	plan_started: PlayCircle,
	plan_completed: CheckCircle,
	plan_failed: AlertCircle,
	plan_paused: PauseCircle,
	plan_stopped: StopCircle,
};

const TYPE_COLORS: Record<string, string> = {
	plan_started: "text-blue-500 dark:text-blue-400",
	plan_completed: "text-emerald-500 dark:text-emerald-400",
	plan_failed: "text-red-500 dark:text-red-400",
	plan_paused: "text-amber-500 dark:text-amber-400",
	plan_stopped: "text-orange-500 dark:text-orange-400",
};

function formatTime(ts: number): string {
	const date = new Date(ts);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMin = Math.floor(diffMs / 60000);

	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;

	const diffHrs = Math.floor(diffMin / 60);
	if (diffHrs < 24) return `${diffHrs}h ago`;

	const diffDays = Math.floor(diffHrs / 24);
	if (diffDays < 7) return `${diffDays}d ago`;

	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function ActivityRow({ event }: { event: ActivityEvent }) {
	const Icon = TYPE_ICONS[event.type] ?? Clock;
	const colorClass = TYPE_COLORS[event.type] ?? "text-stone-400 dark:text-stone-500";

	return (
		<div className="flex items-start gap-3 px-4 py-2.5 border-b border-stone-100 dark:border-stone-800 last:border-b-0 hover:bg-stone-50 dark:hover:bg-white/[0.02] transition-colors">
			<Icon size={14} className={`${colorClass} mt-0.5 shrink-0`} strokeWidth={2} />
			<div className="flex-1 min-w-0">
				<p className="text-[11px] leading-snug text-stone-700 dark:text-stone-300 truncate">
					{event.message}
				</p>
				<div className="flex items-center gap-2 mt-1">
					<span className="text-[9px] text-stone-400 dark:text-stone-500 tracking-wide">
						{formatTime(event.timestamp)}
					</span>
					{event.projectName && (
						<span className="text-[9px] text-stone-400 dark:text-stone-500">
							{event.projectName}
						</span>
					)}
					{event.source && (
						<span className="text-[9px] text-stone-400 dark:text-stone-500 capitalize">
							{event.source.replace(/_/g, " ")}
						</span>
					)}
				</div>
			</div>
			{event.severity === "error" && (
				<span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-1" />
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityTimeline() {
	const { activities, isLoading, error, refetch } = useActivityTimeline();

	// ── Loading state ──────────────────────────────────────────────────
	if (isLoading) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden">
				<Header activityCount={0} />
				<div className="flex items-center justify-center py-12">
					<Loader2 size={16} className="text-stone-400 animate-spin" strokeWidth={2} />
					<span className="ml-2 text-[11px] text-stone-400">Loading activity...</span>
				</div>
			</div>
		);
	}

	// ── Error state ────────────────────────────────────────────────────
	if (error) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden">
				<Header activityCount={0} />
				<div className="flex flex-col items-center justify-center py-10 px-4">
					<AlertCircle size={18} className="text-red-400 mb-2" strokeWidth={2} />
					<p className="text-[11px] text-red-500 text-center mb-3">{error}</p>
					<button
						type="button"
						onClick={refetch}
						className="flex items-center gap-1.5 text-[10px] font-medium text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors px-3 py-1.5 rounded-md border border-stone-200 dark:border-stone-700"
					>
						<RefreshCw size={11} strokeWidth={2} />
						Retry
					</button>
				</div>
			</div>
		);
	}

	// ── Empty state ────────────────────────────────────────────────────
	if (activities.length === 0) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden">
				<Header activityCount={0} />
				<div className="flex flex-col items-center justify-center py-10 px-4">
					<Clock size={18} className="text-stone-300 dark:text-stone-600 mb-2" strokeWidth={2} />
					<p className="text-[11px] text-stone-400 dark:text-stone-500 text-center">
						No activity yet
					</p>
					<p className="text-[10px] text-stone-300 dark:text-stone-600 text-center mt-1">
						Activity from plan executions and system events will appear here.
					</p>
				</div>
			</div>
		);
	}

	// ── Success state ──────────────────────────────────────────────────
	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden">
			<Header activityCount={activities.length} />
			<div className="max-h-80 overflow-y-auto">
				{activities.map((event) => (
					<ActivityRow key={event.id} event={event} />
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({ activityCount }: { activityCount: number }) {
	return (
		<div className="flex items-center justify-between px-4 py-2 bg-stone-50 dark:bg-[#1E1E1E] border-b border-stone-200 dark:border-stone-700">
			<h3 className="text-[10px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400">
				Activity Timeline
			</h3>
			{activityCount > 0 && (
				<span className="text-[9px] text-stone-400 dark:text-stone-500">
					{activityCount} event{activityCount !== 1 ? "s" : ""}
				</span>
			)}
		</div>
	);
}
