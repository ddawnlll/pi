/**
 * TaskAggregatesBar — displays total tokens, cost, and duration for a task.
 */

import React from "react";
import { Database, DollarSign, Clock, Layers } from "lucide-react";
import type { TaskAggregate } from "../types";

interface TaskAggregatesBarProps {
	aggregate: TaskAggregate;
	compact?: boolean;
}

function formatTokens(n: number | undefined | null): string {
	if (n === undefined || n === null) return "0";
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

function formatDuration(ms: number | undefined | null): string {
	if (ms === undefined || ms === null) return "0s";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.floor((ms % 60_000) / 1000);
	return `${mins}m ${secs}s`;
}

function formatCost(usd: number | undefined | null): string {
	if (usd === undefined || usd === null) return "$0.00";
	if (usd < 0.01) return "<$0.01";
	return `$${usd.toFixed(2)}`;
}

export function TaskAggregatesBar({ aggregate, compact = false }: TaskAggregatesBarProps) {
	const safe = aggregate ?? {
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCostUsd: 0,
		totalDurationMs: 0,
		completedPhases: 0,
		totalPhases: 0,
		totalWorkspaces: 0,
		completedWorkspaces: 0,
		totalPhaseCount: 0,
		completePhaseCount: 0,
		failedPhaseCount: 0,
		totalWorkspaceCount: 0,
		completeWorkspaceCount: 0,
	};
	const items = [
		{
			icon: Database,
			label: "Tokens",
			value: `${formatTokens(safe.totalTokensIn)} in / ${formatTokens(safe.totalTokensOut)} out`,
		},
		{
			icon: DollarSign,
			label: "Cost",
			value: formatCost(safe.totalCostUsd),
		},
		{
			icon: Clock,
			label: "Duration",
			value: formatDuration(safe.totalDurationMs),
		},
		{
			icon: Layers,
			label: "Phases",
			value: `${safe.completedPhases}/${safe.totalPhases}`,
		},
	];

	if (compact) {
		return (
			<div className="flex items-center gap-3 text-[10px] text-gray-500">
				{items.map((item) => (
					<div key={item.label} className="flex items-center gap-1">
						<item.icon size={10} className="text-gray-600" />
						<span>{item.label}: {item.value}</span>
					</div>
				))}
			</div>
		);
	}

	return (
		<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
			{items.map((item) => (
				<div
					key={item.label}
					className="flex items-center gap-2 px-3 py-2 rounded border border-gray-700 bg-gray-900/50"
				>
					<item.icon size={14} className="text-blue-400 shrink-0" />
					<div className="min-w-0">
						<p className="text-[9px] text-gray-500 uppercase tracking-wider">{item.label}</p>
						<p className="text-xs text-gray-200 font-medium tabular-nums">{item.value}</p>
					</div>
				</div>
			))}
		</div>
	);
}
