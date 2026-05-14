/**
 * QueueOptimizationPanel — Dashboard component showing optimizer suggestions
 * for queue configuration, based on DAG metrics and observed patterns.
 *
 * Workspace 6.6.E2 — Dashboard queue metrics and optimizer wiring.
 *
 * AC4: Shows optimizer suggestions as advisory only
 * AC5: Build/typecheck passes
 */

import {
	Lightbulb,
	AlertTriangle,
	Info,
	RefreshCw,
} from "lucide-react";
import { useQueueMetrics, type OptimizerSuggestion } from "../hooks/useScaleStatus";

// ─── Style constants ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ─── Suggestion type config ─────────────────────────────────────────────────

const SUGGESTION_CONFIG: Record<string, { icon: React.ReactNode; bg: string; border: string; text: string }> = {
	info: {
		icon: <Info size={14} />,
		bg: "bg-blue-50 dark:bg-blue-900/10",
		border: "border-blue-200 dark:border-blue-800",
		text: "text-blue-700 dark:text-blue-300",
	},
	warning: {
		icon: <AlertTriangle size={14} />,
		bg: "bg-amber-50 dark:bg-amber-900/10",
		border: "border-amber-200 dark:border-amber-800",
		text: "text-amber-700 dark:text-amber-300",
	},
	tip: {
		icon: <Lightbulb size={14} />,
		bg: "bg-emerald-50 dark:bg-emerald-900/10",
		border: "border-emerald-200 dark:border-emerald-800",
		text: "text-emerald-700 dark:text-emerald-300",
	},
};

function getSuggestionConfig(type: string) {
	return SUGGESTION_CONFIG[type] ?? SUGGESTION_CONFIG.info;
}

// ─── Suggestion card ───────────────────────────────────────────────────────

interface SuggestionCardProps {
	suggestion: OptimizerSuggestion;
}

function SuggestionCard({ suggestion }: SuggestionCardProps) {
	const cfg = getSuggestionConfig(suggestion.type);

	return (
		<div className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border ${cfg.bg} ${cfg.border}`}>
			<span className={`mt-0.5 shrink-0 ${cfg.text}`}>{cfg.icon}</span>
			<div className="min-w-0 flex-1">
				<p className={`text-[11px] font-semibold ${TXT}`}>{suggestion.title}</p>
				<p className={`text-[10px] leading-relaxed mt-0.5 ${MUT}`}>{suggestion.message}</p>
			</div>
		</div>
	);
}

// ─── Main component ─────────────────────────────────────────────────────────

interface QueueOptimizationPanelProps {
	/** Optional class name. */
	className?: string;
	/** Whether to show the empty state with a tip about the queue being empty. */
	showEmptyState?: boolean;
}

/**
 * QueueOptimizationPanel component.
 *
 * Displays advisory optimizer suggestions derived from queue metrics.
 * Suggestions are purely advisory — they never auto-apply settings changes.
 *
 * Supports showing:
 * - info: General observations about queue state
 * - warning: Potential issues that may impact throughput
 * - tip: Actionable suggestions for configuration changes
 */
export function QueueOptimizationPanel({ className, showEmptyState = true }: QueueOptimizationPanelProps) {
	const { data: metrics, isLoading, error } = useQueueMetrics();

	const suggestions = metrics?.optimizerSuggestions ?? [];
	const queueTiming = metrics?.queueTiming ?? null;

	// ── Loading state ──
	if (isLoading) {
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-2 ${className ?? ""}`}>
				<div className="flex items-center justify-center py-4">
					<RefreshCw size={14} className={`animate-spin ${MUT}`} />
				</div>
			</div>
		);
	}

	// ── Error state ──
	if (error) {
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-2 ${className ?? ""}`}>
				<div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/10 rounded px-2.5 py-2">
					<AlertTriangle size={14} className="text-red-500 shrink-0" />
					<p className="text-[11px] text-red-600 dark:text-red-400">
						Failed to load optimizer suggestions: {String(error)}
					</p>
				</div>
			</div>
		);
	}

	// ── Empty state ──
	if (suggestions.length === 0) {
		if (!showEmptyState) return null;
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-2 ${className ?? ""}`}>
				<div className="flex items-center justify-center py-4">
					<p className={`text-xs ${MUT}`}>No optimizer suggestions at this time.</p>
				</div>
			</div>
		);
	}

	return (
		<div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-3 ${className ?? ""}`}>
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Lightbulb size={15} className={ACC_TXT} />
					<h3 className={`text-sm font-semibold ${TXT}`}>Queue Optimizer</h3>
				</div>
				{suggestions.length > 0 && (
					<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
						<Lightbulb size={10} />
						{suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""}
					</span>
				)}
			</div>

			{/* Advisory disclaimer */}
			<div className={`flex items-start gap-1.5 px-2.5 py-1.5 rounded bg-stone-50 dark:bg-stone-800/50 border ${BORD}`}>
				<Info size={11} className={`mt-0.5 shrink-0 ${MUT}`} />
				<p className={`text-[9px] leading-tight ${MUT}`}>
					<strong>Advisory only.</strong> These suggestions are informational and based on
					current queue state. They are never auto-applied.
					Configure worker settings in <strong>Scale &amp; Safety</strong> settings.
				</p>
			</div>

			{/* Suggestion list */}
			<div className="space-y-2 max-h-64 overflow-y-auto">
				{suggestions.map((suggestion, idx) => (
					<SuggestionCard key={`suggestion-${idx}`} suggestion={suggestion} />
				))}
			</div>

			{/* Summary line */}
			{queueTiming && queueTiming.totalProcessed > 0 && (
				<p className={`text-[9px] leading-tight ${MUT} border-t border-[#E8E6E1] dark:border-[#333] pt-2`}>
					Based on {queueTiming.totalProcessed} processed queue entr{queueTiming.totalProcessed !== 1 ? "ies" : "y"}.
					Data refreshes every 15s.
				</p>
			)}
		</div>
	);
}
