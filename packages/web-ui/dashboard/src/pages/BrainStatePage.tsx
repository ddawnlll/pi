import React from "react";
import { useBrainStatus } from "../hooks/useBrainStatus";
import { DaemonStatusCard, ObservationStats, SignalSummaryCards, TimelineList } from "../components/brain/overview";
import { LoadingSkeleton, ErrorState } from "../components/brain/common";

export function BrainStatePage() {
	const {
		daemon, observations, signals, timeline,
		observationStats, signalStats,
		loading, error, refresh, autoRefresh, setAutoRefresh,
	} = useBrainStatus();

	if (loading && !daemon) {
		return (
			<div className="p-6 max-w-5xl mx-auto space-y-4">
				<LoadingSkeleton variant="card" count={3} />
				<LoadingSkeleton variant="row" count={8} />
			</div>
		);
	}

	if (error && !daemon) {
		return (
			<div className="p-6 max-w-5xl mx-auto">
				<ErrorState
					message="Unable to connect to Pi server"
					details={error}
					onRetry={refresh}
				/>
			</div>
		);
	}

	return (
		<div className="p-6 max-w-5xl mx-auto space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<h1 className="text-base font-semibold text-stone-800 dark:text-stone-200">
						Brain State
					</h1>
					{daemon && (
						<span className={`w-2 h-2 rounded-full ${
							daemon.state === "running" ? "bg-emerald-500" :
							daemon.state === "error" ? "bg-amber-500" : "bg-red-500"
						}`} />
					)}
				</div>
				<div className="flex items-center gap-3">
					<label className="flex items-center gap-1.5 text-[10px] text-stone-400 cursor-pointer">
						<input
							type="checkbox"
							checked={autoRefresh}
							onChange={(e) => setAutoRefresh(e.target.checked)}
							className="rounded border-stone-300"
						/>
						Auto-refresh
					</label>
					<button
						onClick={refresh}
						className="px-2.5 py-1 text-[10px] font-medium rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
					>
						Refresh
					</button>
				</div>
			</div>

			{/* Summary cards */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<div className="md:col-span-1">
					{daemon && (
						<DaemonStatusCard
							state={daemon.state}
							uptime={daemon.uptime}
							observationCount={daemon.observationCount}
						/>
					)}
				</div>
				<div className="md:col-span-1">
					{observationStats && (
						<ObservationStats
							total={observationStats.total}
							bySeverity={observationStats.bySeverity}
						/>
					)}
				</div>
				<div className="md:col-span-1">
					<SignalSummaryCards signals={signals} />
				</div>
			</div>

			{/* Timeline */}
			<TimelineList events={timeline} loading={loading} error={error} />

			{/* Stats footer */}
			{signalStats && (
				<div className="flex items-center gap-4 text-[9px] text-stone-400">
					<span>{signalStats.total} total signals</span>
					<span>{signalStats.active} active</span>
					<span>{signalStats.resolved} resolved</span>
				</div>
			)}
		</div>
	);
}
