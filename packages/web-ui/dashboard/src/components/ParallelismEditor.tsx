/**
 * ParallelismEditor — Interactive component for editing workspace dependency graphs
 * and previewing batch parallelism before saving.
 *
 * Acceptance Criteria (workspace 7.G):
 * 1. Shows requested vs effective parallelism
 * 2. Shows workspace DAG and batch lanes
 * 3. Allows dependency editing with preview-before-save
 * 4. Highlights serialized tails and blocked workspaces
 * 5. Displays file-overlap and dependency-cycle warnings
 */

import { useState, useCallback, useMemo } from "react";
import {
	AlertTriangle,
	AlertCircle,
	ChevronRight,
	Save,
	RotateCcw,
	Plus,
	Minus,
	ArrowRight,
	CircleDot,
	X,
} from "lucide-react";
import type {
	DependencyGraphNode,
	TopologicalBatch,
	DependencyPatch,
	BatchPlanResult,
	BatchPlanWarning,
	BatchPlanError,
} from "../types";

// ─── Style constants ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ─── Batch lane colors (cycled by batch index) ────────────────────────────────

const BATCH_COLORS = [
	{ bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800", text: "text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
	{ bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
	{ bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800", text: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
	{ bg: "bg-violet-50 dark:bg-violet-950/30", border: "border-violet-200 dark:border-violet-800", text: "text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
	{ bg: "bg-rose-50 dark:bg-rose-950/30", border: "border-rose-200 dark:border-rose-800", text: "text-rose-700 dark:text-rose-300", dot: "bg-rose-500" },
	{ bg: "bg-cyan-50 dark:bg-cyan-950/30", border: "border-cyan-200 dark:border-cyan-800", text: "text-cyan-700 dark:text-cyan-300", dot: "bg-cyan-500" },
];

function batchColor(index: number) {
	return BATCH_COLORS[(index - 1) % BATCH_COLORS.length];
}

// ─── File overlap computation ─────────────────────────────────────────────────

interface FileOverlap {
	workspaceA: string;
	workspaceB: string;
	overlappingFiles: string[];
}

function computeFileOverlaps(
	nodes: DependencyGraphNode[],
	fileOwnership: Record<string, string[]>,
): FileOverlap[] {
	const overlaps: FileOverlap[] = [];
	const nodeIds = nodes.map((n) => n.id);

	for (let i = 0; i < nodeIds.length; i++) {
		for (let j = i + 1; j < nodeIds.length; j++) {
			const aId = nodeIds[i];
			const bId = nodeIds[j];
			const filesA = fileOwnership[aId] ?? [];
			const filesB = fileOwnership[bId] ?? [];
			const shared = filesA.filter((f) => filesB.includes(f));
			if (shared.length > 0) {
				overlaps.push({
					workspaceA: aId,
					workspaceB: bId,
					overlappingFiles: shared,
				});
			}
		}
	}

	return overlaps;
}

// ─── Cycle detection in proposed dependency graph ────────────────────────────

/**
 * Detect if adding a dependency (from -> to) would create a cycle.
 * Uses DFS from `to` checking if we can reach `from`.
 */
function wouldCreateCycle(
	nodeId: string,
	newDependencyId: string,
	dependencyGraph: DependencyGraphNode[],
): boolean {
	// Build adjacency: node -> its dependents (forward edges)
	const adj = new Map<string, string[]>();
	for (const node of dependencyGraph) {
		adj.set(node.id, [...node.dependents]);
	}

	// Add the proposed edge: newDependencyId should have nodeId as a dependent
	// (i.e., nodeId depends on newDependencyId, so nodeId comes after newDependencyId)
	// But we want to check: can we reach newDependencyId from nodeId via dependents?
	// Actually: adding "nodeId depends on newDependencyId" means newNodeDependencyId -> nodeId
	// Cycle exists if there's already a path from nodeId to newDependencyId via dependents.
	const currentDependents = adj.get(nodeId) ?? [];
	if (currentDependents.includes(newDependencyId)) {
		// newDependencyId already depends on nodeId — adding the reverse creates a cycle
		return true;
	}

	// DFS from nodeId through dependents to see if newDependencyId is reachable
	const visited = new Set<string>();
	const stack = [nodeId];
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (current === newDependencyId) return true;
		if (visited.has(current)) continue;
		visited.add(current);
		const deps = adj.get(current) ?? [];
		for (const d of deps) {
			if (!visited.has(d)) stack.push(d);
		}
	}

	return false;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParallelismEditorProps {
	/** The batch plan result from validation */
	batchPlan: BatchPlanResult;
	/** Optional file ownership map: workspaceId -> list of owned file paths */
	fileOwnership?: Record<string, string[]>;
	/** Callback when the user saves dependency patches */
	onSave: (patches: DependencyPatch[]) => void;
	/** Callback to reset all pending edits */
	onReset?: () => void;
	/** Whether save is currently in progress */
	saving?: boolean;
	/** Additional warnings from the batch plan computation */
	extraWarnings?: BatchPlanWarning[];
	/** Additional errors from the batch plan computation */
	extraErrors?: BatchPlanError[];
}

/** Internal representation of a pending edit. */
interface PendingEdit {
	patch: DependencyPatch;
	label: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ParallelismEditor({
	batchPlan,
	fileOwnership = {},
	onSave,
	onReset,
	saving = false,
	extraWarnings = [],
	extraErrors = [],
}: ParallelismEditorProps) {
	const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
	const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
	const [addDepTarget, setAddDepTarget] = useState<string | null>(null);
	const [removeDepTarget, setRemoveDepTarget] = useState<string | null>(null);
	const [showOverlapPanel, setShowOverlapPanel] = useState(false);

	const { dependencyGraph, batches, effectiveParallelism, requestedParallelism, parallelismDelta, isOverSerialized, warnings, errors } = batchPlan;

	// ── Compute file overlaps ──

	const fileOverlaps = useMemo(
		() => computeFileOverlaps(dependencyGraph, fileOwnership),
		[dependencyGraph, fileOwnership],
	);

	// ── Identify serialized tails: batches at the end where width=1 ──

	const serializedTails = useMemo(() => {
		const result: TopologicalBatch[] = [];
		// Walk from the end backwards
		for (let i = batches.length - 1; i >= 0; i--) {
			if (batches[i].width === 1) {
				result.unshift(batches[i]);
			} else {
				break;
			}
		}
		return result;
	}, [batches]);

	// ── Identify blocked workspaces (nodes with unresolvable dependencies / errors) ──

	const blockedWorkspaceIds = useMemo(() => {
		const ids = new Set<string>();
		for (const err of errors) {
			for (const wsId of err.workspaceIds ?? []) {
				ids.add(wsId);
			}
		}
		// Also consider workspaces in dependency cycles as blocked
		for (const err of errors) {
			if (err.type === "cycle") {
				for (const wsId of err.workspaceIds ?? []) {
					ids.add(wsId);
				}
			}
		}
		return ids;
	}, [errors]);

	// ── Build node lookup ──

	const nodeMap = useMemo(() => {
		const m = new Map<string, DependencyGraphNode>();
		for (const node of dependencyGraph) {
			m.set(node.id, node);
		}
		return m;
	}, [dependencyGraph]);

	// ── Actions ──

	const addPendingEdit = useCallback(
		(patch: DependencyPatch, label: string) => {
			setPendingEdits((prev) => {
				// Prevent exact duplicate
				const exists = prev.some(
					(e) =>
						e.patch.workspaceId === patch.workspaceId &&
						e.patch.action === patch.action &&
						e.patch.dependencyId === patch.dependencyId,
				);
				if (exists) return prev;
				return [...prev, { patch, label }];
			});
		},
		[],
	);

	const removePendingEdit = useCallback((index: number) => {
		setPendingEdits((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const handleAddDependency = useCallback(
		(workspaceId: string, dependencyId: string) => {
			const node = nodeMap.get(workspaceId);
			if (!node) return;

			// Check if already has this dependency
			if (node.dependencies.includes(dependencyId)) return;

			// Check for cycles
			if (wouldCreateCycle(workspaceId, dependencyId, dependencyGraph)) {
				return; // Don't add — cycle would form
			}

			const patch: DependencyPatch = {
				workspaceId,
				action: "add_dependency",
				dependencyId,
			};
			addPendingEdit(patch, `Add dep: ${dependencyId} → ${workspaceId}`);
			setAddDepTarget(null);
		},
		[nodeMap, dependencyGraph, addPendingEdit],
	);

	const handleRemoveDependency = useCallback(
		(workspaceId: string, dependencyId: string) => {
			const node = nodeMap.get(workspaceId);
			if (!node) return;

			// Check if it actually has this dependency
			if (!node.dependencies.includes(dependencyId)) return;

			const patch: DependencyPatch = {
				workspaceId,
				action: "remove_dependency",
				dependencyId,
			};
			addPendingEdit(patch, `Remove dep: ${dependencyId} → ${workspaceId}`);
			setRemoveDepTarget(null);
		},
		[nodeMap, addPendingEdit],
	);

	const handleSave = useCallback(() => {
		if (pendingEdits.length === 0) return;
		onSave(pendingEdits.map((e) => e.patch));
	}, [pendingEdits, onSave]);

	const handleReset = useCallback(() => {
		setPendingEdits([]);
		setSelectedWorkspaceId(null);
		setAddDepTarget(null);
		setRemoveDepTarget(null);
		onReset?.();
	}, [onReset]);

	// ── Render ──

	const selectedNode = selectedWorkspaceId ? nodeMap.get(selectedWorkspaceId) : null;

	return (
		<div className={`flex flex-col gap-3 ${SURF} rounded-xl border ${BORD} overflow-hidden`}>
			{/* ── Header: Parallelism comparison ── */}
			<ParallelismHeader
				requested={requestedParallelism}
				effective={effectiveParallelism}
				delta={parallelismDelta}
				isOverSerialized={isOverSerialized}
			/>

			{/* ── Warnings ── */}
			<WarningsPanel
				warnings={[...warnings, ...extraWarnings]}
				errors={[...errors, ...extraErrors]}
				fileOverlaps={fileOverlaps}
				showOverlapPanel={showOverlapPanel}
				onToggleOverlap={() => setShowOverlapPanel((v) => !v)}
			/>

			{/* ── Batch lanes (DAG visualization) ── */}
			<BatchLanes
				batches={batches}
				dependencyGraph={dependencyGraph}
				serializedTails={serializedTails}
				blockedWorkspaceIds={blockedWorkspaceIds}
				selectedWorkspaceId={selectedWorkspaceId}
				onSelectWorkspace={setSelectedWorkspaceId}
			/>

			{/* ── Dependency editor panel ── */}
			{selectedNode && (
				<DependencyEditorPanel
					node={selectedNode}
					nodeMap={nodeMap}
					pendingEdits={pendingEdits}
					addDepTarget={addDepTarget}
					removeDepTarget={removeDepTarget}
					onSetAddDepTarget={setAddDepTarget}
					onSetRemoveDepTarget={setRemoveDepTarget}
					onAddDependency={handleAddDependency}
					onRemoveDependency={handleRemoveDependency}
					onRemovePendingEdit={removePendingEdit}
					blockedWorkspaceIds={blockedWorkspaceIds}
				/>
			)}

			{/* ── Pending edits preview ── */}
			{pendingEdits.length > 0 && (
				<PendingEditsPanel
					edits={pendingEdits}
					saving={saving}
					onSave={handleSave}
					onReset={handleReset}
					onRemoveEdit={removePendingEdit}
				/>
			)}
		</div>
	);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ParallelismHeader({
	requested,
	effective,
	delta,
	isOverSerialized,
}: {
	requested: number;
	effective: number;
	delta: number;
	isOverSerialized: boolean;
}) {
	return (
		<div className={`px-4 py-3 border-b ${BORD}`}>
			<div className="flex items-center justify-between">
				<h3 className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}>
					Parallelism
				</h3>
				{isOverSerialized && (
					<span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
						<AlertTriangle size={10} /> Over-serialized
					</span>
				)}
			</div>
			<div className="flex items-end gap-4 mt-2">
				<div>
					<p className={`text-[10px] ${MUT}`}>Requested</p>
					<p className={`text-2xl font-semibold tracking-tight ${TXT}`}>{requested}</p>
				</div>
				<div className="flex items-center pb-1">
					<ChevronRight size={16} className={MUT} />
				</div>
				<div>
					<p className={`text-[10px] ${MUT}`}>Effective</p>
					<p
						className={`text-2xl font-semibold tracking-tight ${
							delta > 0
								? "text-amber-600 dark:text-amber-400"
								: "text-emerald-600 dark:text-emerald-400"
						}`}
					>
						{effective}
					</p>
				</div>
				{delta > 0 && (
					<div className="ml-auto pb-0.5">
						<span className={`text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300`}>
							Δ {delta}
						</span>
					</div>
				)}
			</div>
			{/* Bar visualization */}
			<div className="mt-2 flex gap-1 items-center">
				<div className="flex-1 h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
					<div
						className={`h-full rounded-full transition-all ${
							delta > 0
								? "bg-amber-400 dark:bg-amber-500"
								: "bg-emerald-400 dark:bg-emerald-500"
						}`}
						style={{
							width: requested > 0 ? `${(effective / requested) * 100}%` : "0%",
						}}
					/>
				</div>
				<span className={`text-[9px] ${MUT} ml-1`}>
					{requested > 0 ? `${Math.round((effective / requested) * 100)}%` : "—"}
				</span>
			</div>
		</div>
	);
}

function WarningsPanel({
	warnings,
	errors,
	fileOverlaps,
	showOverlapPanel,
	onToggleOverlap,
}: {
	warnings: BatchPlanWarning[];
	errors: BatchPlanError[];
	fileOverlaps: FileOverlap[];
	showOverlapPanel: boolean;
	onToggleOverlap: () => void;
}) {
	const hasWarnings = warnings.length > 0 || errors.length > 0 || fileOverlaps.length > 0;

	if (!hasWarnings) return null;

	return (
		<div className="px-4 py-2 border-b border-b-amber-200 dark:border-b-amber-900 bg-amber-50/50 dark:bg-amber-950/20">
			{/* Cycle errors */}
			{errors.map((err, i) => (
				<div key={`error-${i}`} className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-300 mb-1">
					<AlertCircle size={12} className="shrink-0 mt-0.5" />
					<span>{err.message}</span>
				</div>
			))}

			{/* Over-serialization / low parallelism warnings */}
			{warnings.map((w, i) => (
				<div key={`warn-${i}`} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300 mb-1">
					<AlertTriangle size={12} className="shrink-0 mt-0.5" />
					<span>{w.message}</span>
				</div>
			))}

			{/* File overlap toggle */}
			{fileOverlaps.length > 0 && (
				<>
					<button
						onClick={onToggleOverlap}
						className={`flex items-center gap-1 text-xs ${ACC_TXT} hover:underline mt-1`}
					>
						<AlertTriangle size={11} />
						{fileOverlaps.length} file overlap{fileOverlaps.length !== 1 ? "s" : ""} detected
						<ChevronRight size={10} className={`transition-transform ${showOverlapPanel ? "rotate-90" : ""}`} />
					</button>
					{showOverlapPanel && (
						<div className="mt-1.5 space-y-1">
							{fileOverlaps.map((overlap, i) => (
								<div key={`overlap-${i}`} className="text-[10px] text-amber-800 dark:text-amber-200 pl-3">
									<span className="font-medium">{overlap.workspaceA}</span>
									{" ↔ "}
									<span className="font-medium">{overlap.workspaceB}</span>
									: {overlap.overlappingFiles.join(", ")}
								</div>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}

function BatchLanes({
	batches,
	dependencyGraph,
	serializedTails,
	blockedWorkspaceIds,
	selectedWorkspaceId,
	onSelectWorkspace,
}: {
	batches: TopologicalBatch[];
	dependencyGraph: DependencyGraphNode[];
	serializedTails: TopologicalBatch[];
	blockedWorkspaceIds: Set<string>;
	selectedWorkspaceId: string | null;
	onSelectWorkspace: (id: string | null) => void;
}) {
	const nodeMap = useMemo(() => {
		const m = new Map<string, DependencyGraphNode>();
		for (const node of dependencyGraph) {
			m.set(node.id, node);
		}
		return m;
	}, [dependencyGraph]);

	const serializedBatchIndices = new Set(serializedTails.map((b) => b.batchIndex));

	return (
		<div className="px-4 py-3">
			<h4 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-2`}>
				Batch Lanes (DAG)
			</h4>
			<div className="flex flex-col gap-2">
				{batches.map((batch) => {
					const color = batchColor(batch.batchIndex);
					const isSerialized = serializedBatchIndices.has(batch.batchIndex);
					const isBlocked = batch.workspaceIds.some((id) => blockedWorkspaceIds.has(id));

					return (
						<div key={`batch-${batch.batchIndex}`} className="flex items-stretch gap-2">
							{/* Batch index label */}
							<div className={`w-8 flex items-center justify-center rounded-l-lg border ${color.border} ${color.bg} shrink-0`}>
								<span className={`text-[10px] font-bold ${color.text}`}>B{batch.batchIndex}</span>
							</div>

							{/* Workspace cards in this batch */}
							<div className="flex-1 flex flex-wrap gap-1.5 items-center min-h-[40px]">
								{batch.workspaceIds.map((wsId) => {
									const node = nodeMap.get(wsId);
									const isSelected = wsId === selectedWorkspaceId;
									const isWsBlocked = blockedWorkspaceIds.has(wsId);

									return (
										<button
											key={wsId}
											onClick={() => onSelectWorkspace(isSelected ? null : wsId)}
											className={`
                        group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all
                        ${isSelected ? `${ACC_BG} border-blue-400 dark:border-blue-500 ring-1 ring-blue-400/30` : `border-[#E8E6E1] dark:border-[#333] hover:border-stone-300 dark:hover:border-[#555] hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
                        ${isWsBlocked ? "border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/20" : ""}
                        ${isSerialized && !isWsBlocked ? "ring-1 ring-amber-300/50 dark:ring-amber-700/50" : ""}
                      `}
										>
											{/* Status indicator */}
											{isWsBlocked ? (
												<AlertCircle size={11} className="text-red-500 shrink-0" />
											) : isSerialized ? (
												<CircleDot size={11} className="text-amber-500 shrink-0" />
											) : (
												<CircleDot size={11} className={`${color.text} shrink-0`} />
											)}

											<span className={`font-medium truncate ${TXT}`}>{wsId}</span>

											{/* Dependency count badge */}
											{node && node.dependencies.length > 0 && (
												<span className={`text-[9px] ${MUT}`}>
													({node.dependencies.length})
												</span>
											)}

											{/* Tail marker */}
											{isSerialized && (
												<span className="absolute -top-1 -right-1 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-amber-400 dark:bg-amber-500 text-[7px] text-white font-bold">
													T
												</span>
											)}
										</button>
									);
								})}
							</div>

							{/* Batch width badge */}
							<div className={`w-8 flex items-center justify-center rounded-r-lg border ${isBlocked ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30" : isSerialized ? "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30" : `${color.border} ${color.bg}`} shrink-0`}>
								<span className={`text-[10px] font-bold ${isBlocked ? "text-red-600 dark:text-red-400" : isSerialized ? "text-amber-600 dark:text-amber-400" : color.text}`}>
									×{batch.width}
								</span>
							</div>

							{/* Arrow to next batch */}
							{batch.batchIndex < batches.length && (
								<div className="flex items-center w-4 shrink-0">
									<ArrowRight size={12} className={MUT} />
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Legend */}
			<div className="flex items-center gap-4 mt-3 text-[9px] text-stone-400 dark:text-stone-500">
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-amber-400" />
					Serialized tail
				</span>
				<span className="flex items-center gap-1">
					<AlertCircle size={8} className="text-red-500" />
					Blocked
				</span>
				<span className="flex items-center gap-1">
					<span className="w-2 h-2 rounded-full bg-blue-500" />
					Normal
				</span>
			</div>
		</div>
	);
}

function DependencyEditorPanel({
	node,
	nodeMap,
	pendingEdits,
	addDepTarget,
	removeDepTarget,
	onSetAddDepTarget,
	onSetRemoveDepTarget,
	onAddDependency,
	onRemoveDependency,
	onRemovePendingEdit,
	blockedWorkspaceIds,
}: {
	node: DependencyGraphNode;
	nodeMap: Map<string, DependencyGraphNode>;
	pendingEdits: PendingEdit[];
	addDepTarget: string | null;
	removeDepTarget: string | null;
	onSetAddDepTarget: (id: string | null) => void;
	onSetRemoveDepTarget: (id: string | null) => void;
	onAddDependency: (workspaceId: string, dependencyId: string) => void;
	onRemoveDependency: (workspaceId: string, dependencyId: string) => void;
	onRemovePendingEdit: (index: number) => void;
	blockedWorkspaceIds: Set<string>;
}) {
	// Compute pending dependency changes for this workspace
	const pendingAddDeps = pendingEdits
		.filter((e) => e.patch.workspaceId === node.id && e.patch.action === "add_dependency")
		.map((e) => e.patch.dependencyId);

	const pendingRemoveDeps = pendingEdits
		.filter((e) => e.patch.workspaceId === node.id && e.patch.action === "remove_dependency")
		.map((e) => e.patch.dependencyId);

	// Effective dependencies = current + pending adds - pending removes
	const effectiveDeps = [
		...node.dependencies.filter((d) => !pendingRemoveDeps.includes(d)),
		...pendingAddDeps.filter((d) => !node.dependencies.includes(d)),
	];

	// Dependency targets that can be added (not already a dep, not self, not already pending)
	const availableDepTargets = Array.from(nodeMap.keys()).filter(
		(id) => id !== node.id && !node.dependencies.includes(id) && !pendingAddDeps.includes(id),
	);

	return (
		<div className={`px-4 py-3 border-t ${BORD}`}>
			<h4 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-2`}>
				Edit dependencies: <span className={ACC_TXT}>{node.id}</span>
			</h4>

			{/* Current dependencies */}
			<div className="mb-2">
				<p className={`text-[10px] ${MUT} mb-1`}>Current dependencies:</p>
				{effectiveDeps.length === 0 ? (
					<p className={`text-[10px] ${MUT} italic`}>No dependencies</p>
				) : (
					<div className="flex flex-wrap gap-1.5">
						{effectiveDeps.map((depId) => {
							const isRemoved = pendingRemoveDeps.includes(depId);
							const isPending = pendingAddDeps.includes(depId);
							const depNode = nodeMap.get(depId);
							const isBlocked = blockedWorkspaceIds.has(depId);

							return (
								<div
									key={depId}
									className={`
                    inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border transition-all
                    ${isRemoved ? "line-through opacity-40 bg-stone-100 dark:bg-stone-800 border-stone-200 dark:border-stone-700" : isPending ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300" : `bg-stone-50 dark:bg-[#222] border-[#E8E6E1] dark:border-[#333] ${TXT}`}
                    ${isBlocked ? "ring-1 ring-red-300/50 dark:ring-red-700/50" : ""}
                  `}
								>
									<span className="font-medium">{depId}</span>
									{depNode && (
										<span className={`text-[9px] ${MUT}`}>
											({depNode.title || depId})
										</span>
									)}
									{/* Remove button */}
									{!isRemoved && !isPending && (
										<button
											onClick={() => onRemoveDependency(node.id, depId)}
											className="text-stone-400 hover:text-red-500 dark:text-stone-500 dark:hover:text-red-400 ml-0.5"
											title="Remove dependency"
										>
											<Minus size={10} />
										</button>
									)}
									{/* Undo remove button */}
									{isRemoved && (
										<button
											onClick={() => {
												// Find and remove the pending edit
												const idx = pendingEdits.findIndex(
													(e) =>
														e.patch.workspaceId === node.id &&
														e.patch.action === "remove_dependency" &&
														e.patch.dependencyId === depId,
												);
												if (idx >= 0) onRemovePendingEdit(idx);
											}}
											className="text-stone-400 hover:text-emerald-500 dark:text-stone-500 dark:hover:text-emerald-400 ml-0.5"
											title="Undo remove"
										>
											<Plus size={10} />
										</button>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Dependents info */}
			{node.dependents.length > 0 && (
				<div className="mb-2">
					<p className={`text-[10px] ${MUT} mb-1`}>Depended on by:</p>
					<div className="flex flex-wrap gap-1.5">
						{node.dependents.map((depId) => (
							<span key={depId} className={`inline-flex items-center px-2 py-1 rounded-md text-xs bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 ${MUT}`}>
								{depId}
							</span>
						))}
					</div>
				</div>
			)}

			{/* Add dependency */}
			{availableDepTargets.length > 0 && (
				<div className="mt-2">
					<button
						onClick={() => onSetAddDepTarget(addDepTarget ? null : "select")}
						className={`text-[10px] font-medium ${ACC_TXT} hover:underline flex items-center gap-1`}
					>
						<Plus size={10} /> Add dependency
					</button>
					{addDepTarget && (
						<div className="mt-1.5 flex flex-wrap gap-1">
							{availableDepTargets.map((targetId) => (
								<button
									key={targetId}
									onClick={() => onAddDependency(node.id, targetId)}
									disabled={wouldCreateCycle(node.id, targetId, Array.from(nodeMap.values()))}
									className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border border-[#E8E6E1] dark:border-[#333] hover:bg-blue-50 dark:hover:bg-blue-950/30 hover:border-blue-200 dark:hover:border-blue-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
									title={
										wouldCreateCycle(node.id, targetId, Array.from(nodeMap.values()))
											? "Would create a cycle"
											: `Add ${targetId} as dependency`
									}
								>
									<Plus size={9} /> {targetId}
									{wouldCreateCycle(node.id, targetId, Array.from(nodeMap.values())) && (
										<AlertCircle size={9} className="text-red-500" />
									)}
								</button>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function PendingEditsPanel({
	edits,
	saving,
	onSave,
	onReset,
	onRemoveEdit,
}: {
	edits: PendingEdit[];
	saving: boolean;
	onSave: () => void;
	onReset: () => void;
	onRemoveEdit: (index: number) => void;
}) {
	return (
		<div className={`px-4 py-3 border-t ${BORD} bg-blue-50/50 dark:bg-blue-950/20`}>
			<div className="flex items-center justify-between mb-2">
				<h4 className={`text-[10px] font-semibold uppercase tracking-widest ${ACC_TXT}`}>
					Pending Changes ({edits.length})
				</h4>
				<span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium">
					Preview before save
				</span>
			</div>

			{/* Edit list */}
			<div className="space-y-1 mb-3">
				{edits.map((edit, i) => (
					<div
						key={i}
						className="flex items-center justify-between gap-2 text-xs bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] rounded-md px-2.5 py-1.5"
					>
						<div className="flex items-center gap-1.5 min-w-0">
							{edit.patch.action === "add_dependency" ? (
								<Plus size={11} className="text-blue-500 shrink-0" />
							) : (
								<Minus size={11} className="text-red-500 shrink-0" />
							)}
							<span className={`${TXT} truncate`}>{edit.label}</span>
						</div>
						<button
							onClick={() => onRemoveEdit(i)}
							className="text-stone-400 hover:text-red-500 dark:text-stone-500 dark:hover:text-red-400 shrink-0"
							title="Remove this change"
						>
							<X size={11} />
						</button>
					</div>
				))}
			</div>

			{/* Action buttons */}
			<div className="flex items-center gap-2">
				<button
					onClick={onSave}
					disabled={saving}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
				>
					<Save size={12} />
					{saving ? "Saving..." : "Save changes"}
				</button>
				<button
					onClick={onReset}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#E8E6E1] dark:border-[#333] text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-all"
				>
					<RotateCcw size={12} />
					Clear all
				</button>
			</div>
		</div>
	);
}

// ─── Exported utilities for testing ──────────────────────────────────────────

export { computeFileOverlaps, wouldCreateCycle };
