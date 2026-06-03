import React from "react";
import { Cpu, AlertTriangle, Activity, FileText, Target, RotateCw } from "lucide-react";
import type { MorningDigest } from "../../types-brain";
import { LoadingSkeleton } from "../brain/common";

interface MorningCardProps {
	digest: MorningDigest | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
}

function StatusDot({ state }: { state: string }) {
	return (
		<span
			className={`w-2 h-2 rounded-full ${
				state === "running" ? "bg-emerald-500" :
				state === "error" ? "bg-amber-500" : "bg-red-500"
			}`}
		/>
	);
}

function StatBox({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: string }) {
	return (
		<div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700">
			<div className={`shrink-0 ${accent ?? "text-stone-400"}`}>
				{icon}
			</div>
			<div className="min-w-0">
				<div className={`text-sm font-semibold tabular-nums ${accent ?? "text-stone-800 dark:text-stone-200"}`}>
					{value}
				</div>
				<div className="text-xs text-stone-400 dark:text-stone-500 truncate">
					{label}
				</div>
			</div>
		</div>
	);
}

export function MorningCard({ digest, loading, error, onRefresh }: MorningCardProps) {
	if (loading && !digest) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-3">
				<LoadingSkeleton variant="card" count={1} />
			</div>
		);
	}

	if (error && !digest) {
		return null; // handled by parent
	}

	if (!digest) return null;

	const { summary, reflectionCounts } = digest;

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-[#1E1E1E]">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-700">
				<div className="flex items-center gap-2">
					<Cpu size={16} strokeWidth={1.5} className="text-stone-400" />
					<h2 className="text-xs font-semibold text-stone-800 dark:text-stone-200">
						Morning Overview
					</h2>
					<StatusDot state={summary.daemonState} />
				</div>
				<button
					onClick={onRefresh}
					className="p-1 rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
					title="Refresh"
				>
					<RotateCw size={14} strokeWidth={1.5} />
				</button>
			</div>

			{/* Stats grid */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-4">
				<StatBox
					icon={<Activity size={14} strokeWidth={1.5} />}
					label="Observations"
					value={summary.totalObservations}
				/>
				<StatBox
					icon={<AlertTriangle size={14} strokeWidth={1.5} />}
					label="Critical"
					value={summary.criticalObservations}
					accent={summary.criticalObservations > 0 ? "text-amber-500" : "text-stone-400"}
				/>
				<StatBox
					icon={<FileText size={14} strokeWidth={1.5} />}
					label="Active Signals"
					value={summary.activeSignals}
					accent={summary.activeSignals > 0 ? "text-red-500" : "text-stone-400"}
				/>
				<StatBox
					icon={<Target size={14} strokeWidth={1.5} />}
					label="Pending Proposals"
					value={summary.pendingProposals}
					accent={summary.pendingProposals > 0 ? "text-blue-500" : "text-stone-400"}
				/>
			</div>

			{/* Reflection & daemon info */}
			<div className="flex items-center gap-4 px-4 py-2 border-t border-stone-100 dark:border-stone-800 text-xs text-stone-400">
				<span>{reflectionCounts.today} reflections today</span>
				<span>{reflectionCounts.newMemories} new memories</span>
				<span className="ml-auto">Uptime: {summary.daemonUptime}</span>
			</div>
		</div>
	);
}
