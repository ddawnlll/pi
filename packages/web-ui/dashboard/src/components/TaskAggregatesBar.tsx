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

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.floor((ms % 60_000) / 1000);
	return `${mins}m ${secs}s`;
}

function formatCost(usd: number): string {
	if (usd < 0.01) return "<$0.01";
	return `$${usd.toFixed(2)}`;
}

export function TaskAggregatesBar({ aggregate, compact = false }: TaskAggregatesBarProps) {
	const items = [
		{
			icon: Database,
			label: "Tokens",
			value: `${formatTokens(aggregate.totalTokensIn)} in / ${formatTokens(aggregate.totalTokensOut)} out`,
		},
		{
			icon: DollarSign,
			label: "Cost",
			value: formatCost(aggregate.totalCostUsd),
		},
		{
			icon: Clock,
			label: "Duration",
			value: formatDuration(aggregate.totalDurationMs),
		},
		{
			icon: Layers,
			label: "Phases",
			value: `${aggregate.completedPhases}/${aggregate.totalPhases}`,
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
