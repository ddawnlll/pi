import React, { useCallback, useState } from "react";
import { useBrainStatus } from "../hooks/useBrainStatus";
import {
	DaemonStatusCard,
	ObservationStats,
	SignalSummaryCards,
	TimelineList,
	LiveDaemonActivity,
	BrainPromptEditor,
} from "../components/brain/overview";
import { LoadingSkeleton, ErrorState } from "../components/brain/common";

const API_BASE = "";

async function sendDaemonControl(
	action: "start" | "stop" | "resume",
): Promise<{ success: boolean; error?: string }> {
	try {
		const orchestratorAction = action === "start" ? "resume" : action === "resume" ? "resume" : "pause";
		const r = await fetch(`${API_BASE}/api/orchestrator/control`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: orchestratorAction,
				reason: `dashboard-${action}`,
			}),
		});
		const data = await r.json();
		return { success: data.success ?? false, error: data.error };
	} catch (e) {
		return { success: false, error: String(e) };
	}
}

export function BrainStatePage() {
	const {
		daemon, observations, signals, timeline,
		observationStats, signalStats,
		loading, error, refresh, autoRefresh, setAutoRefresh,
	} = useBrainStatus();

	const [daemonActionError, setDaemonActionError] = useState<string | null>(null);
	const [showPromptEditor, setShowPromptEditor] = useState(false);

	const handleDaemonAction = useCallback(
		async (action: "start" | "stop" | "resume") => {
			setDaemonActionError(null);
			const res = await sendDaemonControl(action);
			if (!res.success) {
				setDaemonActionError(res.error ?? `Failed to ${action} daemon`);
			} else {
				setTimeout(refresh, 500);
			}
		},
		[refresh],
	);

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
		<div className="p-6 max-w-5xl mx-auto space-y-4" data-testid="brain-overview-page">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<h1 className="text-base font-semibold text-stone-800 dark:text-stone-200">
						Brain State
					</h1>
					{daemon && (
						<span className={`w-2 h-2 rounded-full ${
							daemon.state === "running" ? "bg-emerald-500" :
							daemon.state === "paused" ? "bg-amber-400" :
							daemon.state === "error" ? "bg-amber-500" : "bg-red-500"
						}`} />
					)}
				</div>
				<div className="flex items-center gap-3">
					<button
						onClick={() => setShowPromptEditor((p) => !p)}
						className={`px-2.5 py-1 text-[10px] font-medium rounded-lg transition-colors ${
							showPromptEditor
								? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
								: "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
						}`}
					>
						Brain Prompt
					</button>
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

			{/* Daemon action error */}
			{daemonActionError && (
				<div className="text-[10px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded px-3 py-2">
					{daemonActionError}
				</div>
			)}

			{/* Summary cards */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<div className="md:col-span-1">
					{daemon && (
						<DaemonStatusCard
							state={daemon.state}
							uptime={daemon.uptime}
							observationCount={daemon.observationCount}
							onStart={() => handleDaemonAction("start")}
							onStop={() => handleDaemonAction("stop")}
							onResume={() => handleDaemonAction("resume")}
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

			{/* Live daemon activity + Prompt editor */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div>
					<LiveDaemonActivity />
				</div>
				<div>
					{showPromptEditor ? (
						<BrainPromptEditor />
					) : (
						<button
							onClick={() => setShowPromptEditor(true)}
							className="w-full border border-dashed border-stone-200 dark:border-stone-700 rounded-lg p-4 text-[10px] text-stone-400 dark:text-stone-500 hover:border-stone-300 dark:hover:border-stone-600 transition-colors text-left"
						>
							Click to view and edit the brain prompt that guides how the daemon analyzes your project and generates proposals.
						</button>
					)}
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
