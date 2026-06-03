import React from "react";
import { SeverityBadge } from "../common";
import type { BrainSignal } from "../../../types-brain";

interface SignalSummaryCardsProps {
	signals: BrainSignal[];
}

export function SignalSummaryCards({ signals }: SignalSummaryCardsProps) {
	const activeCount = signals.filter((s) => !s.resolved).length;
	const resolvedCount = signals.filter((s) => s.resolved).length;

	if (signals.length === 0) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
				<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200 mb-2">
					Signals
				</h3>
				<p className="text-xs text-stone-400 dark:text-stone-500">No signals detected</p>
			</div>
		);
	}

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
			<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200 mb-3">
				Signals
			</h3>
			<div className="flex gap-3 mb-3">
				<div className="flex-1 text-center">
					<div className="text-lg font-bold text-amber-600 dark:text-amber-400">{activeCount}</div>
					<div className="text-xs text-stone-400">Active</div>
				</div>
				<div className="flex-1 text-center">
					<div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{resolvedCount}</div>
					<div className="text-xs text-stone-400">Resolved</div>
				</div>
			</div>
			<div className="space-y-1.5">
				{signals.slice(0, 5).map((s) => (
					<div
						key={s.id}
						className="flex items-center gap-2 py-1"
					>
						<SeverityBadge severity={s.severity} />
						<span className="flex-1 text-xs text-stone-600 dark:text-stone-300 truncate">
							{s.title}
						</span>
						<span
							className={`shrink-0 w-1.5 h-1.5 rounded-full ${
								s.resolved ? "bg-emerald-400" : "bg-amber-400"
							}`}
							title={s.resolved ? "Resolved" : "Active"}
						/>
					</div>
				))}
				{signals.length > 5 && (
					<p className="text-xs text-stone-400 text-center pt-1">
						+{signals.length - 5} more
					</p>
				)}
			</div>
		</div>
	);
}
