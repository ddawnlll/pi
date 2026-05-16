/**
 * PlanIntakePanel — Plan intake dashboard panel for multi-workspace analysis
 *
 * Workspace P11.O — Plan Intake and DAG Diff UI
 *
 * Integrates the following components into a cohesive plan intake UI:
 * - DAG diff viewer (before/after comparison)
 * - Safe batch preview (topological batches)
 * - Optimizer approval panel (proposal review)
 *
 * Manages loading, empty, error, and stale states for graph and batch previews.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertTriangle,
	Info,
	Layers,
	RefreshCw,
	Upload,
	X,
} from "lucide-react";
import { DagDiffViewer, type DagDiffData } from "./DagDiffViewer";
import { SafeBatchPreview, type BatchPreviewData } from "./SafeBatchPreview";
import { OptimizerApprovalPanel } from "./OptimizerApprovalPanel";
import { useOptimizerApproval, type OptimizerProposal } from "../hooks/useOptimizerApproval";
import { useParallelismPreview } from "../hooks/useParallelismPreview";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlanIntakePanelProps {
	/** Plan content (markdown or JSON) to analyze */
	planContent: string;
	/** Project ID for API calls */
	projectId: string;
	/** Plan execution ID if one exists */
	planExecId: string | null;
	/** Whether the intake panel is visible */
	isOpen: boolean;
	/** Close handler */
	onClose: () => void;
	/** Plan content is being changed (stale detection) */
	planContentChanged?: boolean;
	/** Run the plan after approval */
	onRun?: () => void;
	/** Enqueue the plan */
	onEnqueue?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert BatchPlanResult from validation API to BatchPreviewData format.
 */
function toBatchPreviewData(
	batchPlan: {
		batches: Array<{ batchIndex: number; workspaceIds: string[]; width: number }>;
		totalBatches: number;
		effectiveParallelism: number;
		requestedParallelism: number;
		parallelismDelta: number;
		isOverSerialized: boolean;
		criticalPathLength?: number;
		serializedTailLength?: number;
		warnings?: Array<{ type: string; message: string; workspaceIds?: string[]; batchIndex?: number }>;
		errors?: Array<{ type: string; message: string; workspaceIds?: string[] }>;
		blockExplanations?: Array<{ workspaceId: string; batchIndex: number; blockedBy: string[]; reason: string }>;
	} | null,
): BatchPreviewData | null {
	if (!batchPlan) return null;
	return {
		batches: batchPlan.batches.map((b) => ({
			batchIndex: b.batchIndex,
			workspaceIds: b.workspaceIds,
			width: b.width,
		})),
		totalBatches: batchPlan.totalBatches,
		effectiveParallelism: batchPlan.effectiveParallelism,
		requestedParallelism: batchPlan.requestedParallelism,
		parallelismDelta: batchPlan.parallelismDelta,
		isOverSerialized: batchPlan.isOverSerialized,
		criticalPathLength: batchPlan.criticalPathLength ?? batchPlan.totalBatches,
		serializedTailLength: batchPlan.serializedTailLength ?? 0,
		warnings: batchPlan.warnings ?? [],
		errors: batchPlan.errors ?? [],
		blockExplanations: batchPlan.blockExplanations ?? [],
	};
}

/**
 * Convert validation response batch plan and suggested fixes to DagDiffData.
 */
function toDagDiffData(
	originalBatchPlan: {
		batches: Array<{ batchIndex: number; workspaceIds: string[]; width: number }>;
		totalBatches: number;
		effectiveParallelism: number;
		requestedParallelism: number;
		parallelismDelta: number;
		isOverSerialized: boolean;
	} | null,
	patchedBatchPlan: {
		batches: Array<{ batchIndex: number; workspaceIds: string[]; width: number }>;
		totalBatches: number;
		effectiveParallelism: number;
		requestedParallelism: number;
		parallelismDelta: number;
		isOverSerialized: boolean;
	} | null,
	suggestedFixes?: Array<{ id: string; category: string; description: string; workspaceIds: string[] }>,
): DagDiffData | null {
	if (!originalBatchPlan && !patchedBatchPlan) return null;

	const before = originalBatchPlan ?? {
		batches: [],
		totalBatches: 0,
		effectiveParallelism: 0,
		requestedParallelism: 0,
		parallelismDelta: 0,
		isOverSerialized: false,
	};

	const after = patchedBatchPlan ?? {
		batches: [],
		totalBatches: 0,
		effectiveParallelism: 0,
		requestedParallelism: 0,
		parallelismDelta: 0,
		isOverSerialized: false,
	};

	const dependencyChanges = (suggestedFixes ?? []).map((fix) => ({
		kind: (fix.category === "remove_dependency"
			? "removed"
			: fix.category === "add_dependency"
				? "added"
				: "workspace_modified") as "added" | "removed" | "workspace_added" | "workspace_removed" | "workspace_modified",
		workspaceId: fix.workspaceIds[0] ?? "unknown",
		dependencyId: fix.workspaceIds[1],
		description: fix.description,
	}));

	const beforeWsCount = before.batches.reduce((sum, b) => sum + b.workspaceIds.length, 0);
	const afterWsCount = after.batches.reduce((sum, b) => sum + b.workspaceIds.length, 0);
	const beforeDepCount = 0;
	const afterDepCount = dependencyChanges.length;

	return {
		beforeLabel: "Validated",
		afterLabel: "Optimized",
		identical: dependencyChanges.length === 0,
		metrics: {
			before: {
				totalBatches: before.totalBatches,
				effectiveParallelism: before.effectiveParallelism,
				criticalPathLength: before.totalBatches,
				totalWorkspaces: beforeWsCount,
				totalDependencies: beforeDepCount,
				isOverSerialized: before.isOverSerialized,
			},
			after: {
				totalBatches: after.totalBatches,
				effectiveParallelism: after.effectiveParallelism,
				criticalPathLength: after.totalBatches,
				totalWorkspaces: afterWsCount,
				totalDependencies: afterDepCount,
				isOverSerialized: after.isOverSerialized,
			},
			deltas: {
				totalWorkspacesDiff: afterWsCount - beforeWsCount,
				batchDelta: after.totalBatches - before.totalBatches,
				parallelismDelta: after.effectiveParallelism - before.effectiveParallelism,
				criticalPathDelta: after.totalBatches - before.totalBatches,
				dependencyDelta: afterDepCount - beforeDepCount,
			},
		},
		batchChanges: [],
		dependencyChanges,
	};
}

/**
 * Convert suggested fixes to OptimizerProposal format.
 */
function toOptimizerProposals(
	suggestedFixes?: Array<{ id: string; category: string; description: string; workspaceIds: string[] }>,
): OptimizerProposal[] {
	if (!suggestedFixes || suggestedFixes.length === 0) return [];

	return suggestedFixes.map((fix, idx) => ({
		id: fix.id ?? `suggested-fix-${idx}`,
		kind: fix.category,
		description: fix.description,
		evidence: {
			beforeParallelism: 0,
			afterParallelism: 0,
			beforeBatchCount: 0,
			afterBatchCount: 0,
			eliminatesOverSerialization: fix.category === "resolve_cycle",
			description: `Suggested fix: ${fix.description}`,
		},
		patches: [
			{
				workspaceId: fix.workspaceIds[0] ?? "",
				action: fix.category === "add_dependency" ? "add_dependency" : "remove_dependency",
				dependencyId: fix.workspaceIds[1] ?? "",
				description: fix.description,
			},
		],
		affectedWorkspaceIds: fix.workspaceIds,
		approvalStatus: "pending",
		isUnsafe: fix.category === "resolve_cycle",
		blockReason: fix.category === "resolve_cycle"
			? "This fix resolves a cycle in the dependency graph. Verify the changes do not introduce unintended ordering constraints."
			: undefined,
	}));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PlanIntakePanel({
	planContent,
	projectId,
	planExecId,
	isOpen,
	onClose,
	planContentChanged,
	onRun,
	onEnqueue,
}: PlanIntakePanelProps) {
	const [activeTab, setActiveTab] = useState<"diff" | "batches" | "approval">("diff");
	const [retryCount, setRetryCount] = useState(0);

	// Hook for parallelism preview (validation, patching)
	const {
		state: previewState,
		validate,
		approve: approvePlan,
	} = useParallelismPreview(projectId);

	// Hook for optimizer approval
	const optimizerApproval = useOptimizerApproval(projectId, planExecId);

	// Derive validation data
	const validationResponse = previewState.validationResponse;
	const batchPlan = validationResponse?.batchPlan;
	const suggestedFixes = validationResponse?.suggestedFixes;

	// Compute DAG diff from validation response
	const dagDiff = useMemo(() => {
		if (!batchPlan) return null;
		return toDagDiffData(batchPlan, batchPlan, suggestedFixes);
	}, [batchPlan, suggestedFixes]);

	// Compute batch preview data
	const batchPreviewData = useMemo(() => {
		return toBatchPreviewData(batchPlan ?? null);
	}, [batchPlan]);

	// Compute optimizer proposals
	const optimizerProposals = useMemo(() => {
		return toOptimizerProposals(suggestedFixes);
	}, [suggestedFixes]);

	// Update optimizer approval hook when proposals change
	useEffect(() => {
		if (optimizerProposals.length > 0) {
			optimizerApproval.setProposals(optimizerProposals);
		}
	}, [optimizerProposals, optimizerApproval]);

	// Retry handler
	const handleRetry = useCallback(() => {
		setRetryCount((c) => c + 1);
		if (planContent) {
			validate(planContent);
		}
	}, [planContent, validate]);

	// Whether preview is stale
	const isStale = previewState.isStale || !!planContentChanged;
	const staleReason = previewState.staleReason
		? previewState.staleReason === "plan_content_changed"
			? "Plan content changed since validation."
			: previewState.staleReason === "patches_applied_out_of_order"
				? "Patches applied out of order — preview may be inconsistent."
				: previewState.staleReason === "server_rejected_patch"
					? "Server rejected a patch — preview may be stale."
					: "Preview is stale."
		: planContentChanged
			? "Plan content has changed. Revalidate to refresh the analysis."
			: null;

	// Loading state
	const isLoading =
		previewState.stage === "validating" || previewState.stage === "patching";

	// Error state
	const error = previewState.error?.message ?? null;

	if (!isOpen) return null;

	return (
		<div className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}>
			{/* Header */}
			<div className="flex items-center justify-between p-3 border-b border-[#E8E6E1] dark:border-[#333]">
				<div className="flex items-center gap-2">
					<Upload size={14} className={ACC_TXT} />
					<h3 className={`text-sm font-semibold ${TXT}`}>Plan Intake</h3>
					{isStale && (
						<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-50 dark:bg-amber-900/10 text-amber-600 dark:text-amber-400">
							<AlertTriangle size={9} /> Stale
						</span>
					)}
				</div>
				<button onClick={onClose} className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300`}>
					<X size={14} />
				</button>
			</div>

			{/* Tab bar */}
			<div className={`flex items-center border-b ${BORD}`}>
				<button
					onClick={() => setActiveTab("diff")}
					className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
						activeTab === "diff"
							? `${ACC_TXT} border-b-2 border-blue-500 dark:border-blue-400`
							: `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
					}`}
				>
					DAG Diff
				</button>
				<button
					onClick={() => setActiveTab("batches")}
					className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
						activeTab === "batches"
							? `${ACC_TXT} border-b-2 border-blue-500 dark:border-blue-400`
							: `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
					}`}
				>
					<Layers size={11} /> Batches
				</button>
				<button
					onClick={() => setActiveTab("approval")}
					className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
						activeTab === "approval"
							? `${ACC_TXT} border-b-2 border-blue-500 dark:border-blue-400`
							: `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
					}`}
				>
					Approval
					{optimizerApproval.state.proposals.filter((p) => p.approvalStatus === "pending" && !p.isUnsafe).length > 0 && (
						<span className="inline-flex items-center justify-center min-w-[14px] h-[14px] rounded-full bg-blue-500 text-[8px] font-bold text-white px-1">
							{optimizerApproval.state.proposals.filter((p) => p.approvalStatus === "pending" && !p.isUnsafe).length}
						</span>
					)}
				</button>
			</div>

			{/* Action bar */}
			<div className={`flex items-center gap-2 px-3 py-2 border-b ${BORD} ${previewState.stage === "running" ? "bg-blue-50 dark:bg-blue-900/10" : ""}`}>
				<button
					onClick={() => validate(planContent)}
					disabled={isLoading || !planContent}
					className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ${
						isLoading
							? `${MUT} cursor-not-allowed`
							: `${ACC_TXT} hover:bg-blue-50 dark:hover:bg-blue-900/20`
					}`}
				>
					{isLoading ? <RefreshCw size={11} className="animate-spin" /> : <RefreshCw size={11} />}
					{isLoading ? "Validating..." : "Validate"}
				</button>

				{/* Run / Enqueue buttons */}
				{!isStale && validationResponse?.success && (
					<>
						<button
							onClick={() => {
								approvePlan();
								if (onRun) onRun();
							}}
							disabled={isStale}
							className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30`}
						>
							Run plan
						</button>
						{onEnqueue && (
							<button
								onClick={onEnqueue}
								className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ${ACC_TXT} hover:bg-blue-50 dark:hover:bg-blue-900/20`}
							>
								Queue
							</button>
						)}
					</>
				)}

				{isStale && (
					<button
						onClick={() => validate(planContent)}
						className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30`}
					>
						<AlertTriangle size={11} /> Revalidate
					</button>
				)}

				{/* Stage indicator */}
				<span className={`ml-auto text-[9px] ${MUT}`}>
					{previewState.stage === "validated" ? "Validated" :
					 previewState.stage === "patched" ? "Patched" :
					 previewState.stage === "approved" ? "Approved" :
					 previewState.stage === "running" ? "Running" :
					 previewState.stage === "error" ? "Error" :
					 "Idle"}
				</span>
			</div>

			{/* Content area */}
			<div className="p-3 max-h-[60vh] overflow-y-auto">
				{activeTab === "diff" && (
					<DagDiffViewer
						diff={dagDiff}
						isLoading={isLoading}
						error={error}
						isStale={isStale}
						staleReason={staleReason ?? undefined}
						onRetry={handleRetry}
					/>
				)}

				{activeTab === "batches" && (
					<SafeBatchPreview
						data={batchPreviewData}
						isLoading={isLoading}
						error={error}
						isStale={isStale}
						staleReason={staleReason ?? undefined}
						onRetry={handleRetry}
					/>
				)}

				{activeTab === "approval" && (
					<OptimizerApprovalPanel
						proposals={optimizerApproval.state.proposals}
						state={optimizerApproval.state}
						onApprove={optimizerApproval.approve}
						onReject={optimizerApproval.reject}
					/>
				)}
			</div>

			{/* Footer advisory */}
			<div className={`flex items-start gap-1.5 px-3 py-2 border-t ${BORD} bg-stone-50 dark:bg-stone-800/30`}>
				<Info size={10} className={`mt-0.5 shrink-0 ${MUT}`} />
				<p className={`text-[8px] leading-tight ${MUT}`}>
					Plan analysis and optimization approvals are processed through the backend API.
					The executor uses the approved graph hash, not stale authored previews.
					Hover over metrics and changes for detailed explanations.
				</p>
			</div>
		</div>
	);
}
