/**
 * DagDiffViewer — Component for displaying DAG diffs with before/after comparison
 *
 * Workspace P11.O — Plan Intake and DAG Diff UI
 *
 * Renders a visual diff between two states of a dependency graph,
 * showing changes in metrics, batches, and dependency structure.
 *
 * Supports:
 * - Loading state (spinner)
 * - Empty state (no changes)
 * - Error state (with retry)
 * - Stale state (data may be outdated)
 * - Normal diff display
 */

import { useMemo, useState } from "react";
import {
	AlertTriangle,
	AlertCircle,
	ArrowUp,
	ArrowDown,
	CheckCircle2,
	GitCompare,
	Info,
	RefreshCw,
	X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const DANGER_BG = "bg-red-50 dark:bg-red-900/10";
const DANGER_TXT = "text-red-600 dark:text-red-400";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/10";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const SUCCESS_BG = "bg-emerald-50 dark:bg-emerald-900/10";
const SUCCESS_TXT = "text-emerald-600 dark:text-emerald-400";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DagDiffData {
	beforeLabel: string;
	afterLabel: string;
	identical: boolean;
	metrics: {
		before: {
			totalBatches: number;
			effectiveParallelism: number;
			criticalPathLength: number;
			totalWorkspaces: number;
			totalDependencies: number;
			isOverSerialized: boolean;
		};
		after: {
			totalBatches: number;
			effectiveParallelism: number;
			criticalPathLength: number;
			totalWorkspaces: number;
			totalDependencies: number;
			isOverSerialized: boolean;
		};
		deltas: {
			totalWorkspacesDiff: number;
			batchDelta: number;
			parallelismDelta: number;
			criticalPathDelta: number;
			dependencyDelta: number;
		};
	};
	batchChanges: Array<{
		beforeBatchIndex?: number;
		afterBatchIndex?: number;
		beforeWorkspaceIds: string[];
		afterWorkspaceIds: string[];
		description: string;
	}>;
	dependencyChanges: Array<{
		kind: "added" | "removed" | "workspace_added" | "workspace_removed" | "workspace_modified";
		workspaceId: string;
		dependencyId?: string;
		description: string;
	}>;
}

export interface DagDiffViewerProps {
	/** The diff data to display */
	diff: DagDiffData | null;
	/** Loading state */
	isLoading: boolean;
	/** Error message */
	error: string | null;
	/** Stale state — data may be outdated */
	isStale?: boolean;
	/** Stale reason text */
	staleReason?: string;
	/** Retry callback for error state */
	onRetry?: () => void;
	/** Optional class name */
	className?: string;
	/** Whether to show the empty state when diff is null */
	showEmptyState?: boolean;
}

// ---------------------------------------------------------------------------
// Metric comparison helpers
// ---------------------------------------------------------------------------

function DeltaBadge({ delta, label, improvement }: {
	delta: number;
	label: string;
	improvement: "positive" | "negative";
}) {
	if (delta === 0) return null;

	const isImprovement =
		improvement === "positive" ? delta > 0 : delta < 0;
	const Icon = isImprovement ? ArrowUp : ArrowDown;
	const color = isImprovement ? SUCCESS_TXT : DANGER_TXT;
	const bg = isImprovement ? SUCCESS_BG : DANGER_BG;

	return (
		<span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${color} ${bg}`}>
			<Icon size={10} strokeWidth={2.5} />
			{Math.abs(delta)}
			<span className="sr-only">{isImprovement ? "improvement" : "regression"}</span>
		</span>
	);
}

function MetricRow({ label, before, after, delta, improvement }: {
	label: string;
	before: number;
	after: number;
	delta: number;
	improvement: "positive" | "negative";
}) {
	return (
		<div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-stone-50 dark:hover:bg-stone-800/30">
			<span className={`text-[11px] ${MUT}`}>{label}</span>
			<div className="flex items-center gap-2">
				<span className="text-[11px] font-medium text-stone-500 dark:text-stone-400 line-through decoration-stone-300 dark:decoration-stone-600">
					{before}
				</span>
				<span className={`text-[11px] font-semibold ${TXT}`}>{after}</span>
				<DeltaBadge delta={delta} label={label} improvement={improvement} />
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DagDiffViewer({
	diff,
	isLoading,
	error,
	isStale,
	staleReason,
	onRetry,
	className,
	showEmptyState = true,
}: DagDiffViewerProps) {
	const [showChanges, setShowChanges] = useState(true);

	// Color for the diff summary badge
	const diffStatus = useMemo(() => {
		if (!diff) return "empty";
		if (diff.identical) return "identical";
		const hasImprovements =
			diff.metrics.deltas.parallelismDelta > 0 ||
			diff.metrics.deltas.batchDelta < 0 ||
			diff.metrics.deltas.criticalPathDelta < 0;
		if (hasImprovements && diff.metrics.after.isOverSerialized) return "partial";
		if (hasImprovements) return "improved";
		return "different";
	}, [diff]);

	const statusBadge = useMemo(() => {
		switch (diffStatus) {
			case "identical":
				return {
					icon: <CheckCircle2 size={12} />,
					text: "No changes",
					className: `${SUCCESS_BG} ${SUCCESS_TXT}`,
				};
			case "improved":
				return {
					icon: <ArrowUp size={12} />,
					text: "Improved",
					className: `${SUCCESS_BG} ${SUCCESS_TXT}`,
				};
			case "partial":
				return {
					icon: <AlertTriangle size={12} />,
					text: "Partial",
					className: `${WARN_BG} ${WARN_TXT}`,
				};
			case "different":
				return {
					icon: <GitCompare size={12} />,
					text: "Modified",
					className: "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400",
				};
			default:
				return {
					icon: <Info size={12} />,
					text: "Unknown",
					className: `${MUT}`,
				};
		}
	}, [diffStatus]);

	// ── Loading state ──
	if (isLoading) {
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-4 space-y-3 ${className ?? ""}`}>
				<div className="flex items-center justify-center py-8">
					<RefreshCw size={18} className={`animate-spin ${MUT}`} />
				</div>
				<p className={`text-xs text-center ${MUT}`}>Analyzing plan dependency graph...</p>
			</div>
		);
	}

	// ── Error state ──
	if (error) {
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-4 space-y-3 ${className ?? ""}`}>
				<div className={`flex items-start gap-2 p-3 rounded-lg ${DANGER_BG}`}>
					<AlertCircle size={14} className={`mt-0.5 shrink-0 ${DANGER_TXT}`} />
					<div className="flex-1 min-w-0">
						<p className={`text-xs font-medium ${DANGER_TXT}`}>Failed to compute DAG diff</p>
						<p className={`text-[11px] mt-1 ${MUT}`}>{error}</p>
					</div>
				</div>
				{onRetry && (
					<button
						onClick={onRetry}
						className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${ACC_TXT} hover:bg-blue-50 dark:hover:bg-blue-900/20`}
					>
						<RefreshCw size={11} /> Retry
					</button>
				)}
			</div>
		);
	}

	// ── Empty state ──
	if (!diff || showEmptyState === false) {
		if (!showEmptyState) return null;
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-4 ${className ?? ""}`}>
				<div className="flex flex-col items-center justify-center py-6 gap-2">
					<GitCompare size={24} className={`${MUT}`} strokeWidth={1.2} />
					<p className={`text-xs ${MUT}`}>No DAG diff to display</p>
					<p className={`text-[10px] ${MUT} text-center max-w-xs`}>
						Upload and validate a plan to see the dependency graph analysis and
						compare original vs optimized structure.
					</p>
				</div>
			</div>
		);
	}

	// ── Stale banner ──
	const staleBanner = isStale && staleReason ? (
		<div className={`flex items-start gap-2 p-2.5 rounded-lg border ${WARN_BG} ${WARN_TXT} border-amber-200 dark:border-amber-800`}>
			<AlertTriangle size={12} className="mt-0.5 shrink-0" />
			<div className="flex-1 min-w-0">
				<p className="text-[10px] font-medium">{staleReason}</p>
				<p className="text-[9px] mt-0.5 opacity-70">Revalidate the plan to get fresh data.</p>
			</div>
			{onRetry && (
				<button onClick={onRetry} className={`shrink-0 p-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-800/50`}>
					<RefreshCw size={10} />
				</button>
			)}
		</div>
	) : null;

	// ── Normal display ──
	return (
		<div className={`${SURF} rounded-lg border ${BORD} ${className ?? ""}`}>
			{/* Header */}
			<div className="flex items-center justify-between p-3 border-b border-[#E8E6E1] dark:border-[#333]">
				<div className="flex items-center gap-2">
					<GitCompare size={14} className={ACC_TXT} />
					<h3 className={`text-sm font-semibold ${TXT}`}>DAG Diff</h3>
					<span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${statusBadge.className}`}>
						{statusBadge.icon}
						{statusBadge.text}
					</span>
				</div>
			</div>

			<div className="p-3 space-y-3">
				{/* Stale banner */}
				{staleBanner}

				{/* Identical state */}
				{diff.identical && (
					<div className={`flex items-center gap-2 p-3 rounded-lg ${SUCCESS_BG}`}>
						<CheckCircle2 size={14} className={`shrink-0 ${SUCCESS_TXT}`} />
						<p className={`text-xs ${SUCCESS_TXT}`}>
							The {diff.beforeLabel} and {diff.afterLabel} dependency graphs are structurally identical.
							No optimization changes to review.
						</p>
					</div>
				)}

				{!diff.identical && (
					<>
						{/* Metrics comparison */}
						<div className={`rounded-lg border ${BORD} overflow-hidden`}>
							<div className={`px-3 py-1.5 bg-stone-50 dark:bg-stone-800/30 border-b ${BORD}`}>
								<span className={`text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>
									Metrics
								</span>
							</div>
							<div className="p-2 space-y-0.5">
								<MetricRow
									label={`Workspaces (${diff.beforeLabel} → ${diff.afterLabel})`}
									before={diff.metrics.before.totalWorkspaces}
									after={diff.metrics.after.totalWorkspaces}
									delta={diff.metrics.deltas.totalWorkspacesDiff}
									improvement="negative"
								/>
								<MetricRow
									label={`Dependencies (${diff.beforeLabel} → ${diff.afterLabel})`}
									before={diff.metrics.before.totalDependencies}
									after={diff.metrics.after.totalDependencies}
									delta={diff.metrics.deltas.dependencyDelta}
									improvement="positive"
								/>
								<MetricRow
									label={`Batches (${diff.beforeLabel} → ${diff.afterLabel})`}
									before={diff.metrics.before.totalBatches}
									after={diff.metrics.after.totalBatches}
									delta={diff.metrics.deltas.batchDelta}
									improvement="negative"
								/>
								<MetricRow
									label={`Effective parallelism (${diff.beforeLabel} → ${diff.afterLabel})`}
									before={diff.metrics.before.effectiveParallelism}
									after={diff.metrics.after.effectiveParallelism}
									delta={diff.metrics.deltas.parallelismDelta}
									improvement="positive"
								/>
								<MetricRow
									label={`Critical path (${diff.beforeLabel} → ${diff.afterLabel})`}
									before={diff.metrics.before.criticalPathLength}
									after={diff.metrics.after.criticalPathLength}
									delta={diff.metrics.deltas.criticalPathDelta}
									improvement="negative"
								/>
							</div>
						</div>

						{/* Over-serialization warnings */}
						{(diff.metrics.before.isOverSerialized || diff.metrics.after.isOverSerialized) && (
							<div className={`flex items-start gap-2 p-2.5 rounded-lg border ${WARN_BG} ${WARN_TXT} border-amber-200 dark:border-amber-800`}>
								<AlertTriangle size={12} className="mt-0.5 shrink-0" />
								<div>
									{diff.metrics.before.isOverSerialized && (
										<p className="text-[10px]">Before: Plan is over-serialized (requested &gt;1 worker but effective parallelism = 1)</p>
									)}
									{diff.metrics.after.isOverSerialized && (
										<p className="text-[10px]">After: Plan remains over-serialized</p>
									)}
								</div>
							</div>
						)}

						{/* Dependency changes */}
						{diff.dependencyChanges.length > 0 && (
							<div className={`rounded-lg border ${BORD} overflow-hidden`}>
								<button
									onClick={() => setShowChanges(!showChanges)}
									className={`w-full flex items-center justify-between px-3 py-1.5 bg-stone-50 dark:bg-stone-800/30 border-b ${BORD} hover:bg-stone-100 dark:hover:bg-stone-700/30 transition-colors`}
								>
									<span className={`text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>
										Dependency Changes ({diff.dependencyChanges.length})
									</span>
									<span className={`text-[10px] ${MUT}`}>{showChanges ? "Hide" : "Show"}</span>
								</button>
								{showChanges && (
									<div className="max-h-48 overflow-y-auto divide-y divide-[#E8E6E1] dark:divide-[#333]">
										{diff.dependencyChanges.map((change, idx) => (
											<div key={idx} className="flex items-start gap-2 px-3 py-2">
												{change.kind === "added" || change.kind === "workspace_added" ? (
													<span className={`shrink-0 mt-0.5 text-[9px] font-bold px-1 rounded ${SUCCESS_BG} ${SUCCESS_TXT}`}>+</span>
												) : change.kind === "removed" || change.kind === "workspace_removed" ? (
													<span className={`shrink-0 mt-0.5 text-[9px] font-bold px-1 rounded ${DANGER_BG} ${DANGER_TXT}`}>-</span>
												) : (
													<span className={`shrink-0 mt-0.5 text-[9px] font-bold px-1 rounded ${WARN_BG} ${WARN_TXT}`}>~</span>
												)}
												<p className="text-[11px] text-stone-600 dark:text-stone-300">{change.description}</p>
											</div>
										))}
									</div>
								)}
							</div>
						)}

						{/* Batch changes */}
						{diff.batchChanges.length > 0 && (
							<div className={`rounded-lg border ${BORD} overflow-hidden`}>
								<div className={`px-3 py-1.5 bg-stone-50 dark:bg-stone-800/30 border-b ${BORD}`}>
									<span className={`text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>
										Batch Changes ({diff.batchChanges.length})
									</span>
								</div>
								<div className="max-h-40 overflow-y-auto divide-y divide-[#E8E6E1] dark:divide-[#333]">
									{diff.batchChanges.map((change, idx) => (
										<div key={idx} className="px-3 py-2">
											<p className="text-[11px] text-stone-600 dark:text-stone-300">{change.description}</p>
										</div>
									))}
								</div>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
