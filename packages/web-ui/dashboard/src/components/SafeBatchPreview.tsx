/**
 * SafeBatchPreview — Component for displaying safe batch previews
 *
 * Workspace P11.O — Plan Intake and DAG Diff UI
 *
 * Renders topological batches from a plan dependency graph, showing
 * which workspaces can run in parallel and which are serialized.
 *
 * Supports:
 * - Loading state (spinner with message)
 * - Empty state (no batches computed)
 * - Error state (with retry button)
 * - Stale state (data may be outdated, with revalidation prompt)
 * - Normal batch display with parallelism indicators
 */

import {
	AlertTriangle,
	AlertCircle,
	Layers,
	RefreshCw,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-blue-50 dark:bg-blue-900/20";
const DANGER_BG = "bg-red-50 dark:bg-red-900/10";
const DANGER_TXT = "text-red-600 dark:text-red-400";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/10";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const SUCCESS_TXT = "text-emerald-600 dark:text-emerald-400";
const SUCCESS_BG = "bg-emerald-50 dark:bg-emerald-900/10";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchData {
	batchIndex: number;
	workspaceIds: string[];
	width: number;
}

export interface BatchPreviewData {
	batches: BatchData[];
	totalBatches: number;
	effectiveParallelism: number;
	requestedParallelism: number;
	parallelismDelta: number;
	isOverSerialized: boolean;
	criticalPathLength: number;
	serializedTailLength: number;
	warnings: Array<{
		type: string;
		message: string;
		workspaceIds?: string[];
		batchIndex?: number;
	}>;
	errors: Array<{
		type: string;
		message: string;
		workspaceIds?: string[];
	}>;
	blockExplanations: Array<{
		workspaceId: string;
		batchIndex: number;
		blockedBy: string[];
		reason: string;
	}>;
}

export interface SafeBatchPreviewProps {
	/** Batch preview data from validation */
	data: BatchPreviewData | null;
	/** Loading state */
	isLoading: boolean;
	/** Error message */
	error: string | null;
	/** Stale state */
	isStale?: boolean;
	/** Stale reason text */
	staleReason?: string;
	/** Retry callback */
	onRetry?: () => void;
	/** Optional class name */
	className?: string;
	/** Whether to show empty state */
	showEmptyState?: boolean;
}

// ---------------------------------------------------------------------------
// Sub-component: Batch card
// ---------------------------------------------------------------------------

function BatchCard({ batch, isEarliest, index }: {
	batch: BatchData;
	isEarliest: boolean;
	index: number;
}) {
	return (
		<div className={`rounded-lg border ${BORD} overflow-hidden`}>
			<div className={`flex items-center justify-between px-3 py-1.5 ${
				isEarliest ? "bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-800" :
				"bg-stone-50 dark:bg-stone-800/30 border-b border-[#E8E6E1] dark:border-[#333]"
			}`}>
				<div className="flex items-center gap-2">
					<span className={`text-[10px] font-semibold ${isEarliest ? "text-emerald-700 dark:text-emerald-300" : MUT}`}>
						Batch {batch.batchIndex}
					</span>
					{isEarliest && (
						<span className="text-[9px] text-emerald-600 dark:text-emerald-400">(runs first)</span>
					)}
				</div>
				<span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
					batch.width > 1
						? `${SUCCESS_BG} ${SUCCESS_TXT}`
						: `${MUT}`
				}`}>
					{batch.width} worker{batch.width !== 1 ? "s" : ""}
				</span>
			</div>
			<div className="px-3 py-2 flex flex-wrap gap-1.5">
				{batch.workspaceIds.map((wsId) => (
					<span
						key={wsId}
						className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium
							${isEarliest
								? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
								: "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 border border-[#E8E6E1] dark:border-[#333]"
							}`}
					>
						{wsId}
					</span>
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SafeBatchPreview({
	data,
	isLoading,
	error,
	isStale,
	staleReason,
	onRetry,
	className,
	showEmptyState = true,
}: SafeBatchPreviewProps) {
	// ── Loading state ──
	if (isLoading) {
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-4 space-y-3 ${className ?? ""}`}>
				<div className="flex items-center justify-center py-6">
					<RefreshCw size={16} className={`animate-spin ${MUT}`} />
				</div>
				<div className="text-center">
					<p className={`text-xs ${MUT}`}>Computing safe batch plan...</p>
					<p className={`text-[10px] ${MUT} mt-1`}>Analyzing workspace dependency graph for optimal parallelism.</p>
				</div>
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
						<p className={`text-xs font-medium ${DANGER_TXT}`}>Failed to compute batch plan</p>
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
	if (!data) {
		if (!showEmptyState) return null;
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-4 ${className ?? ""}`}>
				<div className="flex flex-col items-center justify-center py-6 gap-2">
					<Layers size={24} className={`${MUT}`} strokeWidth={1.2} />
					<p className={`text-xs ${MUT}`}>No batch plan available</p>
					<p className={`text-[10px] ${MUT} text-center max-w-xs`}>
						Upload and validate a plan to see the topological batch breakdown
						and parallelism analysis.
					</p>
				</div>
			</div>
		);
	}

	// Check for computation errors
	const hasErrors = data.errors.length > 0;

	return (
		<div className={`${SURF} rounded-lg border ${BORD} ${className ?? ""}`}>
			{/* Header */}
			<div className="flex items-center justify-between p-3 border-b border-[#E8E6E1] dark:border-[#333]">
				<div className="flex items-center gap-2">
					<Layers size={14} className={ACC_TXT} />
					<h3 className={`text-sm font-semibold ${TXT}`}>Safe Batch Preview</h3>
				</div>
				<span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${
					hasErrors ? `${DANGER_BG} ${DANGER_TXT}` :
					data.isOverSerialized ? `${WARN_BG} ${WARN_TXT}` :
					`${SUCCESS_BG} ${SUCCESS_TXT}`
				}`}>
					{hasErrors ? "Error" : data.isOverSerialized ? "Over-serialized" : `${data.totalBatches} batches`}
				</span>
			</div>

			<div className="p-3 space-y-3">
				{/* Stale banner */}
				{isStale && staleReason && (
					<div className={`flex items-start gap-2 p-2.5 rounded-lg border ${WARN_BG} ${WARN_TXT} border-amber-200 dark:border-amber-800`}>
						<AlertTriangle size={12} className="mt-0.5 shrink-0" />
						<div className="flex-1 min-w-0">
							<p className="text-[10px] font-medium">{staleReason}</p>
							<p className="text-[9px] mt-0.5 opacity-70">Revalidate the plan to refresh the batch plan.</p>
						</div>
						{onRetry && (
							<button onClick={onRetry} className="shrink-0 p-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-800/50">
								<RefreshCw size={10} />
							</button>
						)}
					</div>
				)}

				{/* Computation errors */}
				{hasErrors && (
					<div className={`flex flex-col gap-2 p-3 rounded-lg ${DANGER_BG} border border-red-200 dark:border-red-800`}>
						<p className={`text-xs font-medium ${DANGER_TXT}`}>Batch computation errors</p>
						{data.errors.map((err, idx) => (
							<div key={idx} className="flex items-start gap-1.5">
								<AlertCircle size={10} className={`mt-0.5 shrink-0 ${DANGER_TXT}`} />
								<p className={`text-[10px] ${DANGER_TXT}`}>{err.message}</p>
							</div>
						))}
					</div>
				)}

				{!hasErrors && (
					<>
						{/* Metrics summary */}
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
							<div className={`${ACC_BG} rounded-lg p-2.5 text-center`}>
								<p className={`text-[9px] ${MUT} uppercase tracking-wider`}>Batches</p>
								<p className={`text-sm font-bold ${ACC_TXT}`}>{data.totalBatches}</p>
							</div>
							<div className={`${SUCCESS_BG} rounded-lg p-2.5 text-center`}>
								<p className={`text-[9px] ${MUT} uppercase tracking-wider`}>Parallelism</p>
								<p className={`text-sm font-bold ${SUCCESS_TXT}`}>{data.effectiveParallelism}</p>
							</div>
							<div className="bg-stone-50 dark:bg-stone-800/30 rounded-lg p-2.5 text-center">
								<p className={`text-[9px] ${MUT} uppercase tracking-wider`}>Requested</p>
								<p className={`text-sm font-bold ${TXT}`}>{data.requestedParallelism}</p>
							</div>
							<div className="bg-stone-50 dark:bg-stone-800/30 rounded-lg p-2.5 text-center">
								<p className={`text-[9px] ${MUT} uppercase tracking-wider`}>Delta</p>
								<p className={`text-sm font-bold ${data.parallelismDelta <= 0 ? DANGER_TXT : SUCCESS_TXT}`}>
									{data.parallelismDelta > 0 ? `+${data.parallelismDelta}` : data.parallelismDelta}
								</p>
							</div>
						</div>

						{/* Over-serialization warning */}
						{data.isOverSerialized && (
							<div className={`flex items-start gap-2 p-2.5 rounded-lg border ${WARN_BG} ${WARN_TXT} border-amber-200 dark:border-amber-800`}>
								<AlertTriangle size={12} className="mt-0.5 shrink-0" />
								<div>
									<p className="text-[10px] font-medium">Plan is over-serialized</p>
									<p className="text-[9px] mt-0.5 opacity-70">
										Requested parallelism ({data.requestedParallelism}) exceeds effective parallelism ({data.effectiveParallelism}).
										Workspaces will execute sequentially despite requesting parallel workers.
									</p>
								</div>
							</div>
						)}

						{/* Warnings */}
						{data.warnings.length > 0 && (
							<div className="flex flex-col gap-1.5">
								{data.warnings.map((warn, idx) => (
									<div key={idx} className={`flex items-start gap-1.5 p-2 rounded-lg ${WARN_BG} border border-amber-200 dark:border-amber-800`}>
										<AlertTriangle size={10} className={`mt-0.5 shrink-0 ${WARN_TXT}`} />
										<p className={`text-[10px] ${WARN_TXT}`}>{warn.message}</p>
									</div>
								))}
							</div>
						)}

						{/* Batch list */}
						<div className="space-y-2">
							{data.batches.map((batch, idx) => (
								<BatchCard
									key={batch.batchIndex}
									batch={batch}
									isEarliest={idx === 0}
									index={idx}
								/>
							))}
						</div>

						{/* Block explanations */}
						{data.blockExplanations.length > 0 && (
							<div className={`rounded-lg border ${BORD} overflow-hidden`}>
								<div className={`px-3 py-1.5 bg-stone-50 dark:bg-stone-800/30 border-b ${BORD}`}>
									<span className={`text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>
										Blocked Workspace Explanations ({data.blockExplanations.length})
									</span>
								</div>
								<div className="max-h-40 overflow-y-auto divide-y divide-[#E8E6E1] dark:divide-[#333]">
									{data.blockExplanations.map((exp, idx) => (
										<div key={idx} className="px-3 py-2">
											<div className="flex items-start gap-1.5">
												<AlertCircle size={10} className={`mt-0.5 shrink-0 ${WARN_TXT}`} />
												<div>
													<p className="text-[11px] font-medium text-stone-700 dark:text-stone-300">
														{exp.workspaceId}
													</p>
													<p className="text-[10px] ${MUT} mt-0.5">{exp.reason}</p>
													{exp.blockedBy.length > 0 && (
														<p className={`text-[9px] ${MUT} mt-0.5`}>
															Blocked by: {exp.blockedBy.join(", ")}
														</p>
													)}
												</div>
											</div>
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
