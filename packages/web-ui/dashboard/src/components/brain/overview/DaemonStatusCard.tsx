import React, { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import type { DaemonState } from "../../../types-brain";

interface DaemonStatusCardProps {
	state: DaemonState;
	uptime: string;
	observationCount: number;
	/** Called to start the daemon (via orchestrator control) */
	onStart?: () => Promise<void>;
	/** Called to stop the daemon */
	onStop?: () => Promise<void>;
	/** Called to resume the daemon */
	onResume?: () => Promise<void>;
}

const DOT_CLASS: Record<DaemonState, string> = {
	running: "bg-emerald-500",
	stopped: "bg-red-500",
	paused: "bg-amber-400",
	error: "bg-amber-500",
};
const LABEL: Record<DaemonState, string> = {
	running: "Running",
	stopped: "Stopped",
	paused: "Paused",
	error: "Error",
};

export function DaemonStatusCard({
	state,
	uptime,
	observationCount,
	onStart,
	onStop,
	onResume,
}: DaemonStatusCardProps) {
	const [actionLoading, setActionLoading] = useState<string | null>(null);

	const handleAction = useCallback(
		async (action: string, fn?: () => Promise<void>) => {
			if (!fn) return;
			setActionLoading(action);
			try {
				await fn();
			} finally {
				setActionLoading(null);
			}
		},
		[],
	);

	const showStart = (state === "stopped" || state === "error") && onStart;
	const showStop = (state === "running" || state === "paused") && onStop;
	const showResume = state === "paused" && onResume;

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
			<div className="flex items-center justify-between mb-3">
				<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">
					Daemon Status
				</h3>
				<span className="flex items-center gap-1.5">
					<span className={`w-2 h-2 rounded-full ${DOT_CLASS[state]}`} />
					<span className="text-xs font-medium text-stone-400 dark:text-stone-500">
						{LABEL[state]}
					</span>
				</span>
			</div>
			<div className="space-y-1.5">
				<div className="flex justify-between text-xs">
					<span className="text-stone-400">Uptime</span>
					<span className="text-stone-600 dark:text-stone-300 font-mono">{uptime}</span>
				</div>
				<div className="flex justify-between text-xs">
					<span className="text-stone-400">Observations</span>
					<span className="text-stone-600 dark:text-stone-300 font-mono">{observationCount}</span>
				</div>
			</div>

			{/* Action buttons */}
			{(showStart || showStop || showResume) && (
				<div className="mt-3 pt-3 border-t border-stone-200 dark:border-stone-700 flex gap-2">
					{showStart && (
						<button
							onClick={() => handleAction("start", onStart)}
							disabled={actionLoading !== null}
							className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800/40 transition-colors disabled:opacity-50"
						>
							{actionLoading === "start" ? (
								<Loader2 size={10} className="animate-spin" />
							) : null}
							Start daemon
						</button>
					)}
					{showResume && (
						<button
							onClick={() => handleAction("resume", onResume)}
							disabled={actionLoading !== null}
							className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors disabled:opacity-50"
						>
							{actionLoading === "resume" ? (
								<Loader2 size={10} className="animate-spin" />
							) : null}
							Resume
						</button>
					)}
					{showStop && (
						<button
							onClick={() => handleAction("stop", onStop)}
							disabled={actionLoading !== null}
							className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800/40 transition-colors disabled:opacity-50"
						>
							{actionLoading === "stop" ? (
								<Loader2 size={10} className="animate-spin" />
							) : null}
							Stop daemon
						</button>
					)}
				</div>
			)}
		</div>
	);
}
