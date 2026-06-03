/**
 * MetricsStrip — Compact execution metrics strip (P42.04).
 *
 * Shows progress, cost, tokens, burn rate, cache hit rate in a
 * single horizontal strip. Uses real data from ExecutionStats or
 * explicit unavailable state.
 */

import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import {
	Activity,
	Clock,
	Coins,
	Cpu,
	Database,
	Gauge,
} from "lucide-react";

// ─── Style tokens ──────────────────────────────────────────────────────────

const TXT_MUTED = "text-stone-400 dark:text-stone-500";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface MetricsStripProps {
	/** Total workspaces */
	totalWorkspaces?: number;
	/** Completed workspaces */
	completedWorkspaces?: number;
	/** Estimated cost in USD */
	estimatedCost?: number;
	/** Total tokens consumed */
	totalTokens?: number;
	/** Burn rate per minute */
	burnRatePerMin?: number;
	/** Cache hit rate (0-1) */
	cacheHitRate?: number;
	/** Whether cache hit rate is known */
	cacheHitRateKnown?: boolean;
	/** Tokens per completed workspace */
	tokensPerWorkspace?: number;
	/** Duration in minutes */
	durationMinutes?: number;
	/** Loading state */
	loading?: boolean;
	/** Additional class name */
	className?: string;
}

// ─── Metric Item ───────────────────────────────────────────────────────────

interface MetricItemProps {
	icon: React.ElementType;
	label: string;
	value: string;
	unavailable?: boolean;
}

function MetricItem({ icon: Icon, label, value, unavailable }: MetricItemProps) {
	return (
		<div className="flex items-center gap-2 px-3 py-1.5">
			<Icon
				size={12}
				className={unavailable ? "text-stone-300 dark:text-stone-600" : "text-stone-400 dark:text-stone-500"}
			/>
			<div className="flex items-baseline gap-1.5 min-w-0">
				<span className={`text-xs font-medium leading-none whitespace-nowrap ${
					unavailable
						? "text-stone-300 dark:text-stone-600"
						: TXT
				}`}>
					{value}
				</span>
				<span className={`text-xs leading-none whitespace-nowrap ${
					unavailable
						? "text-stone-200 dark:text-stone-700"
						: TXT_MUTED
				}`}>
					{label}
				</span>
			</div>
		</div>
	);
}

// ─── Separator ─────────────────────────────────────────────────────────────

function Sep() {
	return (
		<div className="w-px h-6 bg-stone-100 dark:bg-stone-800 shrink-0" />
	);
}

// ─── Format helpers ────────────────────────────────────────────────────────

function formatCost(cost: number | undefined): string {
	if (cost === undefined || cost === null) return "—";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number | undefined): string {
	if (tokens === undefined || tokens === null) return "—";
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return tokens.toString();
}

function formatPercent(rate: number | undefined): string {
	if (rate === undefined || rate === null) return "—";
	return `${(rate * 100).toFixed(0)}%`;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function MetricsStrip({
	totalWorkspaces,
	completedWorkspaces,
	estimatedCost,
	totalTokens,
	burnRatePerMin,
	cacheHitRate,
	cacheHitRateKnown,
	tokensPerWorkspace,
	durationMinutes,
	loading = false,
	className = "",
}: MetricsStripProps) {
	if (loading) {
		return (
			<div
				className={`flex items-center gap-1 px-3 py-2 rounded-lg border ${BORD} ${SURF} ${className}`}
				role="status"
				aria-label="Loading metrics"
			>
				{[...Array(5)].map((_, i) => (
					<div key={i} className="h-4 w-16 bg-stone-100 dark:bg-stone-800 rounded animate-pulse" />
				))}
			</div>
		);
	}

	const allUnavailable =
		totalWorkspaces === undefined && estimatedCost === undefined &&
		totalTokens === undefined && burnRatePerMin === undefined;

	if (allUnavailable) {
		return (
			<div
				className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${BORD} ${SURF} ${className}`}
				role="status"
				aria-label="Metrics unavailable"
			>
				<Database size={12} className="text-stone-300 dark:text-stone-600" />
				<span className="text-xs text-stone-300 dark:text-stone-600 italic">
					Metrics unavailable
				</span>
			</div>
		);
	}

	const progress = totalWorkspaces && totalWorkspaces > 0
		? `${completedWorkspaces ?? 0}/${totalWorkspaces}`
		: "—";

	return (
		<div
			className={`flex items-center flex-wrap rounded-lg border ${BORD} ${SURF} px-1 py-1 ${className}`}
			role="region"
			aria-label="Execution metrics"
		>
			<MetricItem
				icon={Activity}
				label="workspaces"
				value={progress}
				unavailable={!totalWorkspaces}
			/>
			<Sep />
			<MetricItem
				icon={Coins}
				label="cost"
				value={formatCost(estimatedCost)}
				unavailable={estimatedCost === undefined}
			/>
			<Sep />
			<MetricItem
				icon={Database}
				label="tokens"
				value={formatTokens(totalTokens)}
				unavailable={totalTokens === undefined}
			/>
			<Sep />
			<MetricItem
				icon={Gauge}
				label="burn/min"
				value={burnRatePerMin !== undefined ? `~${formatTokens(Math.round(burnRatePerMin))}/m` : "—"}
				unavailable={burnRatePerMin === undefined}
			/>
			<Sep />
			<MetricItem
				icon={Cpu}
				label="cache"
				value={
					cacheHitRateKnown !== false && cacheHitRate !== undefined
						? `${formatPercent(cacheHitRate)}`
						: cacheHitRateKnown === false
							? "N/A"
							: "—"
				}
				unavailable={cacheHitRate === undefined}
			/>
			{/* Desktop-only: tokens per workspace */}
			{tokensPerWorkspace !== undefined && (
				<>
					<Sep />
					<MetricItem
						icon={Database}
						label="tokens/ws"
						value={formatTokens(tokensPerWorkspace)}
					/>
				</>
			)}
			{/* Desktop-only: duration */}
			{durationMinutes !== undefined && (
				<>
					<Sep />
					<MetricItem
						icon={Clock}
						label="duration"
						value={durationMinutes < 60 ? `${durationMinutes}m` : `${(durationMinutes / 60).toFixed(1)}h`}
					/>
				</>
			)}
		</div>
	);
}
