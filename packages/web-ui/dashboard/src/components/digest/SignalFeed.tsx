import React from "react";
import { Bell, AlertTriangle, Info, XCircle, Activity, RotateCw } from "lucide-react";
import type { BrainSignal } from "../../types-brain";
import { LoadingSkeleton } from "../brain/common";
import { EmptyState } from "../brain/common";

interface SignalFeedProps {
	signals: BrainSignal[] | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
}

const SEVERITY_ICONS = {
	info: Info,
	warning: AlertTriangle,
	critical: XCircle,
} as const;

const SEVERITY_COLORS = {
	info: "text-blue-500 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
	warning: "text-amber-500 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
	critical: "text-red-500 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
} as const;

function SignalItem({ signal }: { signal: BrainSignal }) {
	const Icon = SEVERITY_ICONS[signal.severity] ?? Activity;
	const colorClass = SEVERITY_COLORS[signal.severity] ?? SEVERITY_COLORS.info;

	return (
		<div
			className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border ${colorClass}`}
		>
			<Icon size={14} strokeWidth={1.5} className="shrink-0 mt-0.5" />
			<div className="min-w-0 flex-1">
				<div className="text-xs font-medium text-stone-800 dark:text-stone-200 truncate">
					{signal.title}
				</div>
				{signal.details && (
					<div className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 line-clamp-2">
						{signal.details}
					</div>
				)}
				<div className="flex items-center gap-2 mt-1">
					<span className="text-xs text-stone-400 dark:text-stone-500 uppercase">
						{signal.type.replace(/_/g, " ")}
					</span>
					<span className="text-xs text-stone-400 dark:text-stone-500">
						{new Date(signal.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
					</span>
				</div>
			</div>
			{signal.resolved && (
				<span className="shrink-0 text-xs text-emerald-500 font-medium px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20">
					Resolved
				</span>
			)}
		</div>
	);
}

export function SignalFeed({ signals, loading, error, onRefresh }: SignalFeedProps) {
	if (loading && !signals) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-3">
				<LoadingSkeleton variant="row" count={4} />
			</div>
		);
	}

	if (error && !signals) {
		return null; // handled by parent
	}

	const isEmpty = !signals || signals.length === 0;

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-[#1E1E1E]">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-700">
				<div className="flex items-center gap-2">
					<Bell size={16} strokeWidth={1.5} className="text-stone-400" />
					<h2 className="text-xs font-semibold text-stone-800 dark:text-stone-200">
						Signal Feed
					</h2>
					{signals && signals.length > 0 && (
						<span className="text-xs text-stone-400 dark:text-stone-500">
							{signals.length} active
						</span>
					)}
				</div>
				<button
					onClick={onRefresh}
					className="p-1 rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
					title="Refresh"
				>
					<RotateCw size={14} strokeWidth={1.5} />
				</button>
			</div>

			{/* Content */}
			<div className="p-3 space-y-2">
				{isEmpty ? (
					<EmptyState
						icon={<Bell size={24} strokeWidth={1.2} />}
						title="No active signals"
						description="All systems nominal — no signals require attention."
					/>
				) : (
					signals.map((signal) => (
						<SignalItem key={signal.id} signal={signal} />
					))
				)}
			</div>
		</div>
	);
}
