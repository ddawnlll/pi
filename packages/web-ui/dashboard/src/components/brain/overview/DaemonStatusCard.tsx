import React from "react";
import type { DaemonState } from "../../../types-brain";

interface DaemonStatusCardProps {
	state: DaemonState;
	uptime: string;
	observationCount: number;
}

const DOT_CLASS: Record<DaemonState, string> = {
	running: "bg-emerald-500",
	stopped: "bg-red-500",
	error: "bg-amber-500",
};
const LABEL: Record<DaemonState, string> = {
	running: "Running",
	stopped: "Stopped",
	error: "Error",
};

export function DaemonStatusCard({ state, uptime, observationCount }: DaemonStatusCardProps) {
	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
			<div className="flex items-center justify-between mb-3">
				<h3 className="text-xs font-semibold text-stone-700 dark:text-stone-300">
					Daemon Status
				</h3>
				<span className="flex items-center gap-1.5">
					<span className={`w-2 h-2 rounded-full ${DOT_CLASS[state]}`} />
					<span className="text-[10px] font-medium text-stone-500 dark:text-stone-400">
						{LABEL[state]}
					</span>
				</span>
			</div>
			<div className="space-y-1.5">
				<div className="flex justify-between text-[10px]">
					<span className="text-stone-400">Uptime</span>
					<span className="text-stone-600 dark:text-stone-300 font-mono">{uptime}</span>
				</div>
				<div className="flex justify-between text-[10px]">
					<span className="text-stone-400">Observations</span>
					<span className="text-stone-600 dark:text-stone-300 font-mono">{observationCount}</span>
				</div>
			</div>
		</div>
	);
}
