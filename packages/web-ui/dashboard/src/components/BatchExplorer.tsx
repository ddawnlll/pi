/**
 * BatchExplorer — animated visual explorer for topological batch execution.
 *
 * Shows all batches as horizontal rows with cards for each workspace.
 * Workspace cards are animated (pulsing for active, dimmed for pending,
 * checkmarked for complete, error-styled for failed) so the user can see
 * at a glance which batch is currently executing, which workers it uses,
 * and what's coming next.
 *
 * Data sources:
 * - BatchPlanResult (batches, dependency graph, effective parallelism)
 * - WorkspaceSummary[] (current stage of each workspace)
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu,
  Layers,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ArrowRight,
  GitBranch,
  AlertTriangle,
} from "lucide-react";
import type { WorkspaceSummary } from "../types";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A topological batch of workspaces (mirrored from plan-preview types). */
export interface TopologicalBatch {
	batchIndex: number;
	workspaceIds: string[];
	width: number;
}

/** Dependency graph node with batch assignment. */
export interface DependencyGraphNode {
	id: string;
	title: string;
	dependencies: string[];
	dependents: string[];
	batchIndex: number;
}

/** Batch plan metadata used by the explorer. */
export interface BatchPlanExplorerData {
	batches: TopologicalBatch[];
	totalBatches: number;
	effectiveParallelism: number;
	dependencyGraph?: DependencyGraphNode[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getWorkspaceStage(workspaces: WorkspaceSummary[], id: string): string {
	return workspaces.find((w) => w.id === id)?.stage ?? "pending";
}

function stagePriority(stage: string): number {
	switch (stage) {
		case "active": return 0;
		case "blocked": return 1;
		case "pending": return 2;
		case "complete": return 3;
		case "failed": return 4;
		default: return 5;
	}
}

/** Returns the index of the first batch that has at least one active workspace. */
function findActiveBatchIndex(batches: TopologicalBatch[], workspaces: WorkspaceSummary[]): number {
	for (const batch of batches) {
		const hasActive = batch.workspaceIds.some((id) => getWorkspaceStage(workspaces, id) === "active");
		if (hasActive) return batch.batchIndex;
	}
	return -1;
}

/** Returns the index of the next batch after the active one (the first subsequent batch with pending workspaces). */
function findNextBatchIndex(batches: TopologicalBatch[], workspaces: WorkspaceSummary[]): number {
	const activeIdx = findActiveBatchIndex(batches, workspaces);
	if (activeIdx < 0) return -1;
	for (let i = activeIdx + 1; i <= batches.length; i++) {
		const batch = batches[i - 1]; // batches are 1-based
		if (!batch) continue;
		const hasPending = batch.workspaceIds.some(
			(id) => getWorkspaceStage(workspaces, id) === "pending",
		);
		if (hasPending) return batch.batchIndex;
	}
	return -1;
}

// ─── Workspace card sub-component ──────────────────────────────────────────

interface WorkspaceCardProps {
	id: string;
	stage: string;
	/** Whether this card's batch is the currently active batch. */
	isInActiveBatch: boolean;
	onClick?: (id: string) => void;
}

function WorkspaceCard({ id, stage, isInActiveBatch, onClick }: WorkspaceCardProps) {
	const stageColors: Record<string, { border: string; bg: string; text: string; icon: React.ReactNode }> = {
		active: {
			border: "border-emerald-400 dark:border-emerald-500",
			bg: "bg-emerald-50 dark:bg-emerald-900/20",
			text: "text-emerald-700 dark:text-emerald-300",
			icon: <Loader2 size={12} className="animate-spin" />,
		},
		pending: {
			border: "border-stone-200 dark:border-stone-600",
			bg: "bg-stone-50 dark:bg-stone-800/40",
			text: "text-stone-500 dark:text-stone-400",
			icon: <Clock size={12} />,
		},
		blocked: {
			border: "border-amber-300 dark:border-amber-600",
			bg: "bg-amber-50 dark:bg-amber-900/15",
			text: "text-amber-600 dark:text-amber-400",
			icon: <AlertTriangle size={12} />,
		},
		complete: {
			border: "border-blue-300 dark:border-blue-600",
			bg: "bg-blue-50 dark:bg-blue-900/15",
			text: "text-blue-600 dark:text-blue-400",
			icon: <CheckCircle2 size={12} />,
		},
		failed: {
			border: "border-red-300 dark:border-red-600",
			bg: "bg-red-50 dark:bg-red-900/15",
			text: "text-red-600 dark:text-red-400",
			icon: <XCircle size={12} />,
		},
	};

	const colors = stageColors[stage] ?? stageColors.pending;

	return (
		<motion.button
			layout
			onClick={() => onClick?.(id)}
			whileHover={{ scale: 1.03 }}
			whileTap={{ scale: 0.97 }}
			className={`
				flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-medium
				border transition-shadow cursor-pointer
				${colors.border} ${colors.bg} ${colors.text}
				${isInActiveBatch && stage === "active"
					? "shadow-[0_0_0_2px_rgba(52,211,153,0.4)] dark:shadow-[0_0_0_2px_rgba(52,211,153,0.3)]"
					: "shadow-sm"}
			`}
			initial={{ opacity: 0, y: -6 }}
			animate={{
				opacity: 1,
				y: 0,
				...(stage === "active" && isInActiveBatch
					? { boxShadow: ["0 0 0 0px rgba(52,211,153,0.4)", "0 0 0 4px rgba(52,211,153,0)", "0 0 0 0px rgba(52,211,153,0.4)"] }
					: {}),
			}}
			transition={{
				duration: 0.2,
				...(stage === "active" && isInActiveBatch
					? { boxShadow: { duration: 1.5, repeat: Infinity, ease: "easeInOut" } }
					: {}),
			}}
		>
			<span className="shrink-0">{colors.icon}</span>
			<span className="truncate max-w-[100px]">{id}</span>
		</motion.button>
	);
}

// ─── Batch row sub-component ───────────────────────────────────────────────

interface BatchRowProps {
	batch: TopologicalBatch;
	workspaces: WorkspaceSummary[];
	isActive: boolean;
	isNext: boolean;
	batchIndex: number;
	totalBatches: number;
	onWorkspaceClick?: (id: string) => void;
}

function BatchRow({ batch, workspaces, isActive, isNext, batchIndex, totalBatches, onWorkspaceClick }: BatchRowProps) {
	const [expanded, setExpanded] = useState(isActive);

	const allDone = batch.workspaceIds.every(
		(id) => getWorkspaceStage(workspaces, id) === "complete",
	);
	const anyFailed = batch.workspaceIds.some(
		(id) => getWorkspaceStage(workspaces, id) === "failed",
	);
	const anyActive = batch.workspaceIds.some(
		(id) => getWorkspaceStage(workspaces, id) === "active",
	);
	const allPending = batch.workspaceIds.every(
		(id) => getWorkspaceStage(workspaces, id) === "pending",
	);

	const rowBorderColor = isActive
		? "border-emerald-400 dark:border-emerald-500"
		: isNext
			? "border-blue-300 dark:border-blue-500"
			: allDone
				? "border-blue-200 dark:border-blue-700"
				: anyFailed
					? "border-red-300 dark:border-red-700"
					: BORD;

	const rowBg = isActive
		? "bg-emerald-50/60 dark:bg-emerald-900/10"
		: isNext
			? "bg-blue-50/40 dark:bg-blue-900/8"
			: SURF;

	// Dependencies within batch: count of dependency edges inside this batch
	const internalDeps = batch.workspaceIds.filter(
		(id) => false,
	).length; // simplified — we don't have dep graph per batch here

	const doneCount = batch.workspaceIds.filter(
		(id) => getWorkspaceStage(workspaces, id) === "complete",
	).length;
	const progressLabel = doneCount > 0 ? `${doneCount}/${batch.workspaceIds.length}` : null;

	return (
		<motion.div
			layout
			className={`rounded-lg border-2 transition-colors overflow-hidden ${rowBorderColor} ${rowBg}`}
			initial={{ opacity: 0, y: -10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.25 }}
		>
			{/* Batch header (always visible) */}
			<button
				onClick={() => setExpanded((e) => !e)}
				className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
			>
				{isActive ? (
					<span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-400 dark:bg-emerald-500">
						<Cpu size={10} className="text-white" />
					</span>
				) : isNext ? (
					<span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-400 dark:bg-blue-500">
						<ArrowRight size={10} className="text-white" />
					</span>
				) : allDone ? (
					<span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-400 dark:bg-blue-500">
						<CheckCircle2 size={10} className="text-white" />
					</span>
				) : anyFailed ? (
					<span className="flex items-center justify-center w-5 h-5 rounded-full bg-red-400 dark:bg-red-500">
						<XCircle size={10} className="text-white" />
					</span>
				) : (
					<span className="flex items-center justify-center w-5 h-5 rounded-full bg-stone-300 dark:bg-stone-600">
						<Clock size={10} className="text-white" />
					</span>
				)}

				<div className="flex items-center gap-2 min-w-0 flex-1">
					<span className={`text-[11px] font-semibold ${TXT}`}>Batch {batch.batchIndex}</span>
					<span className={`text-[9px] ${MUT}`}>
						{batch.width} workspace{batch.width !== 1 ? "s" : ""}
					</span>
					{progressLabel && (
						<span className="text-[9px] font-medium text-blue-600 dark:text-blue-400">
							{progressLabel} done
						</span>
					)}
				</div>

				{/* Status badge */}
				{isActive && (
					<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
						<span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
						Running
					</span>
				)}
				{isNext && (
					<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-[9px] font-semibold text-blue-700 dark:text-blue-300">
						Next up
					</span>
				)}
				{allDone && !isActive && (
					<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-[9px] font-semibold text-blue-600 dark:text-blue-400">
						Complete
					</span>
				)}

				<span className={`${MUT}`}>
					{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
				</span>
			</button>

			{/* Workspace cards (expandable) */}
			<AnimatePresence>
				{expanded && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.15 }}
						className="overflow-hidden"
					>
						<div className="flex flex-wrap gap-1.5 px-3 pb-2.5 pt-1">
							{/* Sort: active first, then blocked, pending, complete, failed */}
							{[...batch.workspaceIds]
								.sort((a, b) => stagePriority(getWorkspaceStage(workspaces, a)) - stagePriority(getWorkspaceStage(workspaces, b)))
								.map((id) => (
									<WorkspaceCard
										key={id}
										id={id}
										stage={getWorkspaceStage(workspaces, id)}
										isInActiveBatch={isActive}
										onClick={onWorkspaceClick}
									/>
								))}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</motion.div>
	);
}

// ─── Main component ─────────────────────────────────────────────────────────

interface BatchExplorerProps {
	/** Topological batch plan data. */
	batchPlan: BatchPlanExplorerData | null;
	/** Current workspace stage information. */
	workspaces: WorkspaceSummary[];
	/** Optional callback when a workspace card is clicked. */
	onWorkspaceClick?: (id: string) => void;
	/** Optional class name. */
	className?: string;
}

/**
 * BatchExplorer — animated visual explorer for batch execution.
 *
 * Renders all batches as a vertical stack of collapsible rows. The active batch
 * is highlighted with a pulsing emerald border, the next batch with a blue border.
 * Workspace cards show their current stage (active/pending/blocked/complete/failed)
 * with appropriate icons and colors.
 */
export function BatchExplorer({ batchPlan, workspaces, onWorkspaceClick, className }: BatchExplorerProps) {
	if (!batchPlan || batchPlan.batches.length === 0) {
		return (
			<div className={`flex flex-col items-center justify-center py-8 gap-2 ${MUT} ${className ?? ""}`}>
				<Layers size={24} strokeWidth={1.2} />
				<p className="text-xs">No batch data available</p>
				<p className="text-[10px]">Upload and validate a plan to see batch topology</p>
			</div>
		);
	}

	const activeBatchIdx = findActiveBatchIndex(batchPlan.batches, workspaces);
	const nextBatchIdx = findNextBatchIndex(batchPlan.batches, workspaces);

	const sortedBatches = [...batchPlan.batches].sort((a, b) => a.batchIndex - b.batchIndex);

	return (
		<div className={`space-y-2 ${className ?? ""}`}>
			{/* Summary strip */}
			<div className="flex items-center gap-3 px-1 pb-1">
				<div className="flex items-center gap-1.5">
					<Cpu size={12} className={ACC_TXT} />
					<span className={`text-[10px] font-semibold ${MUT}`}>
						{batchPlan.totalBatches} batch{batchPlan.totalBatches !== 1 ? "es" : ""}
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					<GitBranch size={12} className={ACC_TXT} />
					<span className={`text-[10px] font-semibold ${MUT}`}>
						Effective parallelism: {batchPlan.effectiveParallelism}
					</span>
				</div>
				{activeBatchIdx > 0 && (
					<div className="flex items-center gap-1.5">
						<span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
						<span className={`text-[10px] font-semibold ${MUT}`}>
							Batch {activeBatchIdx} active
						</span>
					</div>
				)}
			</div>

			{/* Batch rows */}
			{sortedBatches.map((batch) => (
				<BatchRow
					key={batch.batchIndex}
					batch={batch}
					workspaces={workspaces}
					isActive={batch.batchIndex === activeBatchIdx}
					isNext={batch.batchIndex === nextBatchIdx}
					batchIndex={batch.batchIndex}
					totalBatches={batchPlan.totalBatches}
					onWorkspaceClick={onWorkspaceClick}
				/>
			))}
		</div>
	);
}
