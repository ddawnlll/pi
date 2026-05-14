/**
 * PlanUploadDialog — Upload, preview, review, and run plans with approval flow.
 *
 * Acceptance Criteria (workspace 7.H):
 * 1. PlanUploadDialog shows preflight preview before run
 * 2. Run is disabled until required review is approved
 * 3. Edited dependency patches are included in the run request
 * 4. User can compare original and edited dependency graph
 */

import { useRef, useState, useMemo, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
	AlertTriangle,
	AlertCircle,
	CheckCircle2,
	ChevronRight,
	ChevronDown,
	Eye,
	GitCompare,
	Play,
	ShieldCheck,
	Upload,
	X,
} from "lucide-react";
import { useParallelismPreview } from "../hooks/useParallelismPreview";
import { ParallelismEditor } from "./ParallelismEditor";
import type {
	DependencyPatch,
	DependencyGraphNode,
	BatchPlanResult,
} from "../types";

interface PlanUploadDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
	onExecutionStarted: (planExecId: string) => void;
	/** Called when a plan is queued for later execution */
	onEnqueued?: () => void;
}

/** Stage of the dialog workflow. */
type DialogStage =
	| "input"
	| "validating"
	| "preflight"
	| "approval"
	| "running";

export function PlanUploadDialog({
	isOpen,
	onClose,
	projectId,
	onExecutionStarted,
	onEnqueued,
}: PlanUploadDialogProps) {
	const {
		state: previewState,
		validate,
		patch,
		approve,
		run,
		queuePlan,
		reset: resetPreview,
		clearError,
	} = useParallelismPreview(projectId);

	const [planContent, setPlanContent] = useState("");
	const [planFileName, setPlanFileName] = useState("uploaded-plan.md");
	const [error, setError] = useState<string | null>(null);
	const [showGraphDiff, setShowGraphDiff] = useState(false);
	const [pendingPatches, setPendingPatches] = useState<DependencyPatch[]>([]);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Derive the current dialog stage from the preview state
	const dialogStage: DialogStage = useMemo(() => {
		if (previewState.stage === "idle" && !previewState.validationResponse) {
			return "input";
		}
		if (previewState.stage === "validating") {
			return "validating";
		}
		if (previewState.stage === "running") {
			return "running";
		}
		// After validation (validated, patched, approved, error) → show preflight
		if (
			previewState.validationResponse?.success &&
			previewState.stage !== "running"
		) {
			const requiresApproval =
				previewState.validationResponse?.requiresApproval ?? false;
			if (requiresApproval && !previewState.isApproved) {
				return "approval";
			}
			return "preflight";
		}
		// Validation failed — back to input
		if (
			previewState.validationResponse &&
			!previewState.validationResponse.success
		) {
			return "input";
		}
		return "input";
	}, [previewState.stage, previewState.validationResponse, previewState.isApproved]);

	const handleClose = useCallback(() => {
		setPlanContent("");
		setPlanFileName("uploaded-plan.md");
		setError(null);
		setShowGraphDiff(false);
		setPendingPatches([]);
		resetPreview();
		onClose();
	}, [resetPreview, onClose]);

	const handleValidate = useCallback(async () => {
		if (!planContent.trim()) {
			setError("Plan content is required");
			return;
		}
		setError(null);
		setShowGraphDiff(false);
		setPendingPatches([]);
		await validate(planContent.trim());
	}, [planContent, validate]);

	const handleRun = useCallback(async () => {
		if (!planContent.trim()) return;
		setError(null);

		// If the plan requires approval, ensure it has been approved
		const requiresApproval =
			previewState.validationResponse?.requiresApproval ?? false;
		if (requiresApproval && !previewState.isApproved) {
			setError(
				"This plan requires review approval before execution. Click 'Approve & Run' to proceed.",
			);
			return;
		}

		const result = await run(planContent.trim());
		if (result?.success && result.planExecutionId) {
			onExecutionStarted(result.planExecutionId);
			handleClose();
		} else if (result?.errors) {
			setError(result.errors.join("; "));
		}
	}, [planContent, previewState.validationResponse, previewState.isApproved, run, handleClose, onExecutionStarted]);

	const handleQueuePlan = useCallback(async () => {
		if (!planContent.trim()) return;
		setError(null);

		// Apply any pending patches first
		if (pendingPatches.length > 0) {
			const patchResult = await patch(planContent.trim(), pendingPatches);
			if (!patchResult?.success) {
				setError(
					patchResult?.errors?.join("; ") ?? "Failed to apply dependency patches",
				);
				return;
			}
			setPendingPatches([]);
		}

		const result = await queuePlan(planContent.trim(), planFileName);
		if (result?.success) {
			onEnqueued?.();
			onClose();
		} else if (result?.errors) {
			setError(result.errors.join("; "));
		}
	}, [planContent, planFileName, pendingPatches, patch, queuePlan, onClose]);

	const handleApproveAndRun = useCallback(async () => {
		if (!planContent.trim()) return;
		setError(null);

		// Apply any pending patches first
		if (pendingPatches.length > 0) {
			const patchResult = await patch(planContent.trim(), pendingPatches);
			if (!patchResult?.success) {
				setError(
					patchResult?.errors?.join("; ") ?? "Failed to apply dependency patches",
				);
				return;
			}
			setPendingPatches([]);
		}

		// Approve the plan
		const approved = approve();
		if (!approved) {
			setError(
				previewState.error?.message ?? "Approval failed. Please revalidate.",
			);
			return;
		}

		// Run with patches
		const result = await run(planContent.trim());
		if (result?.success && result.planExecutionId) {
			onExecutionStarted(result.planExecutionId);
			handleClose();
		} else if (result?.errors) {
			setError(result.errors.join("; "));
		}
	}, [
		planContent,
		pendingPatches,
		patch,
		approve,
		run,
		handleClose,
		onExecutionStarted,
		previewState.error,
	]);

	const handleApplyPatches = useCallback(
		async (patches: DependencyPatch[]) => {
			if (!planContent.trim()) return;
			const result = await patch(planContent.trim(), patches);
			if (!result?.success) {
				setError(result?.errors?.join("; ") ?? "Failed to apply patches");
				return;
			}
			setPendingPatches([]);
		},
		[planContent, patch],
	);

	const handleFileUpload = () => {
		fileInputRef.current?.click();
	};

	const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		setPlanFileName(file.name);
		const reader = new FileReader();
		reader.onload = (evt) => {
			const content = evt.target?.result as string;
			setPlanContent(content);
		};
		reader.readAsText(file);
		e.target.value = "";
	};

	// ── Derived data for rendering ──

	const batchPlan = previewState.validationResponse?.batchPlan ?? null;
	const parseResult = previewState.validationResponse?.parseResult ?? null;
	const requiresApproval =
		previewState.validationResponse?.requiresApproval ?? false;
	const isApproved = previewState.isApproved;
	const canRun =
		previewState.validationResponse?.success === true &&
		!showGraphDiff &&
		(requiresApproval ? isApproved : true) &&
		previewState.stage !== "running" &&
		previewState.stage !== "validating";

	// Original graph (from initial validation) vs edited graph (after patches)
	const originalGraph = useMemo(() => {
		if (!batchPlan) return null;
		return batchPlan.dependencyGraph;
	}, [batchPlan]);

	const editedGraph = useMemo(() => {
		if (!previewState.previewResult?.batchPlan) return null;
		return previewState.previewResult.batchPlan.dependencyGraph;
	}, [previewState.previewResult]);

	const graphDiffData = useMemo(() => {
		if (!originalGraph || !editedGraph) return null;

		const origMap = new Map(originalGraph.map((n) => [n.id, n]));
		const editMap = new Map(editedGraph.map((n) => [n.id, n]));

		const added: DependencyGraphNode[] = [];
		const removed: DependencyGraphNode[] = [];
		const changed: Array<{
			node: DependencyGraphNode;
			origDeps: string[];
			newDeps: string[];
			addedDeps: string[];
			removedDeps: string[];
		}> = [];

		// Nodes in edited but not in original
		for (const node of editedGraph) {
			if (!origMap.has(node.id)) added.push(node);
		}

		// Nodes in original but not in edited
		for (const node of originalGraph) {
			if (!editMap.has(node.id)) removed.push(node);
		}

		// Nodes with changed dependencies
		for (const origNode of originalGraph) {
			const editNode = editMap.get(origNode.id);
			if (!editNode) continue;

			const origDeps = [...origNode.dependencies].sort();
			const newDeps = [...editNode.dependencies].sort();

			if (JSON.stringify(origDeps) !== JSON.stringify(newDeps)) {
				const addedDeps = newDeps.filter((d) => !origDeps.includes(d));
				const removedDeps = origDeps.filter((d) => !newDeps.includes(d));
				changed.push({
					node: editNode,
					origDeps,
					newDeps,
					addedDeps,
					removedDeps,
				});
			}
		}

		return { added, removed, changed };
	}, [originalGraph, editedGraph]);

	return (
		<AnimatePresence>
			{isOpen && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
					onClick={handleClose}
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						transition={{ duration: 0.1 }}
						className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-6 min-w-[600px] max-w-3xl max-h-[85vh] flex flex-col"
						onClick={(e) => e.stopPropagation()}
					>
						{/* ── Header ── */}
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-lg font-semibold text-gray-100">
								Upload & Run Plan
							</h2>
							<div className="flex items-center gap-2">
								<StageBadge stage={dialogStage} />
								<span className="text-xs text-gray-500 font-mono">
									Project: {projectId.slice(0, 8)}...
								</span>
							</div>
						</div>

						{/* ── Content area (scrollable) ── */}
						<div className="flex-1 min-h-0 overflow-y-auto space-y-4">
							{/* ── AC 1: Plan input area ── */}
							{(dialogStage === "input" || dialogStage === "validating") && (
								<div className="flex flex-col flex-1">
									<label className="text-xs text-gray-400 block mb-1.5">
										Plan Content
									</label>
									<textarea
										ref={textareaRef}
										value={planContent}
										onChange={(e) => {
											setPlanContent(e.target.value);
										}}
										placeholder={`Paste your plan content here...`}
										className="w-full min-h-[200px] px-3 py-2 text-sm font-mono bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-y"
										spellCheck={false}
									/>
									<div className="flex items-center gap-3 mt-2">
										<input
											ref={fileInputRef}
											type="file"
											accept=".md,.json,.txt"
											onChange={handleFileSelected}
											className="hidden"
										/>
										<button
											onClick={handleFileUpload}
											className="text-xs px-2.5 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
										>
											<Upload size={12} className="inline mr-1" />
											Browse File...
										</button>
										{planFileName && (
											<span className="text-xs text-gray-500">
												{planFileName}
											</span>
										)}
										<span className="text-xs text-gray-600 ml-auto">
											{planContent.length} chars
										</span>
									</div>
								</div>
							)}

							{/* ── Validation result (shown in input stage after failed validation) ── */}
							{previewState.validationResponse &&
								!previewState.validationResponse.success && (
									<div className="p-3 bg-red-900/30 border border-red-800 rounded text-xs text-red-300">
										<div className="font-semibold text-red-200 mb-1">
											Validation Failed
										</div>
										{previewState.validationResponse.errors?.map((e, i) => (
											<div key={i} className="ml-2">
												- {e}
											</div>
										))}
									</div>
								)}

							{/* ── Parse result summary ── */}
							{parseResult && previewState.validationResponse?.success && (
								<div className="p-3 bg-green-900/30 border border-green-800 rounded text-xs text-green-300">
									<div className="font-semibold text-green-200 mb-1.5">
										Plan Valid
									</div>
									<div className="grid grid-cols-2 gap-x-4 gap-y-1">
										<span className="text-green-400/70">Title:</span>
										<span className="text-green-200 text-right">
											{parseResult.title}
										</span>
										<span className="text-green-400/70">Phase:</span>
										<span className="text-green-200 text-right">
											{parseResult.phase}
										</span>
										<span className="text-green-400/70">Workspaces:</span>
										<span className="text-green-200 text-right">
											{parseResult.workspaceCount}
										</span>
										<span className="text-green-400/70">Max Parallel:</span>
										<span className="text-green-200 text-right">
											{parseResult.maxParallel}
										</span>
									</div>
								</div>
							)}

							{/* ── Requires approval badge ── */}
							{requiresApproval && !isApproved && (
								<div className="p-3 bg-amber-900/30 border border-amber-800 rounded text-xs text-amber-300 flex items-start gap-2">
									<ShieldCheck size={14} className="shrink-0 mt-0.5" />
									<div>
										<div className="font-semibold text-amber-200 mb-0.5">
											Review Required
										</div>
										<div>
											This plan requires review approval before execution.
											Review the preflight preview below, then click "Approve &
											Run" to proceed.
										</div>
									</div>
								</div>
							)}
							{requiresApproval && isApproved && (
								<div className="p-3 bg-emerald-900/30 border border-emerald-800 rounded text-xs text-emerald-300 flex items-start gap-2">
									<CheckCircle2 size={14} className="shrink-0 mt-0.5" />
									<div>
										<div className="font-semibold text-emerald-200 mb-0.5">
											Approved
										</div>
										<div>This plan has been approved for execution.</div>
									</div>
								</div>
							)}

							{/* ── AC 1: Preflight preview ── */}
							{batchPlan && previewState.validationResponse?.success && (
								<div className="border border-gray-700 rounded overflow-hidden">
									<div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
										<h3 className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
											<Eye size={12} />
											Preflight Preview
										</h3>
										{/* AC 4: Compare graphs button */}
										{editedGraph && (
											<button
												onClick={() => setShowGraphDiff(!showGraphDiff)}
												className="text-[10px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center gap-1 transition-colors"
											>
												<GitCompare size={10} />
												{showGraphDiff ? "Hide Diff" : "Compare Graphs"}
											</button>
										)}
									</div>

									{/* Parallelism preview summary */}
									<div className="px-3 py-2 bg-gray-850 text-xs border-b border-gray-700">
										<div className="grid grid-cols-4 gap-2">
											<div>
												<span className="text-gray-500 text-[10px]">
													Batches
												</span>
												<div className="text-gray-200 font-medium">
													{batchPlan.totalBatches}
												</div>
											</div>
											<div>
												<span className="text-gray-500 text-[10px]">
													Effective Parallelism
												</span>
												<div
													className={`font-medium ${
														batchPlan.parallelismDelta > 0
															? "text-amber-400"
															: "text-emerald-400"
													}`}
												>
													{batchPlan.effectiveParallelism}
												</div>
											</div>
											<div>
												<span className="text-gray-500 text-[10px]">
													Requested
												</span>
												<div className="text-gray-200 font-medium">
													{batchPlan.requestedParallelism}
												</div>
											</div>
											<div>
												<span className="text-gray-500 text-[10px]">
													Delta
												</span>
												<div
													className={`font-medium ${
														batchPlan.parallelismDelta > 0
															? "text-amber-400"
															: "text-gray-400"
													}`}
												>
													{batchPlan.parallelismDelta > 0
														? `+${batchPlan.parallelismDelta}`
														: "0"}
												</div>
											</div>
										</div>
										{batchPlan.isOverSerialized && (
											<div className="mt-1.5 text-amber-400 flex items-center gap-1">
												<AlertTriangle size={10} />
												Over-serialized: requested parallelism is higher than
												effective
											</div>
										)}
									</div>

									{/* Show batch plan warnings/errors */}
									{(batchPlan.warnings.length > 0 ||
										batchPlan.errors.length > 0) && (
										<div className="px-3 py-2 bg-amber-900/20 border-b border-gray-700 text-xs space-y-1">
											{batchPlan.errors.map((err, i) => (
												<div
													key={`err-${i}`}
													className="text-red-400 flex items-start gap-1"
												>
													<AlertCircle
														size={10}
														className="shrink-0 mt-0.5"
													/>
													{err.message}
												</div>
											))}
											{batchPlan.warnings.map((w, i) => (
												<div
													key={`warn-${i}`}
													className="text-amber-400 flex items-start gap-1"
												>
													<AlertTriangle
														size={10}
														className="shrink-0 mt-0.5"
													/>
													{w.message}
												</div>
											))}
										</div>
									)}

									{/* AC 4: Graph comparison view */}
									{showGraphDiff && graphDiffData && (
										<GraphDiffView diffData={graphDiffData} />
									)}

									{/* ParallelismEditor for dependency editing */}
									{!showGraphDiff && (
										<ParallelismEditor
											batchPlan={
												previewState.previewResult?.batchPlan ?? batchPlan
											}
											onSave={handleApplyPatches}
											onReset={() => setPendingPatches([])}
											saving={previewState.stage === "patching"}
											extraWarnings={batchPlan.warnings}
											extraErrors={batchPlan.errors}
										/>
									)}
								</div>
							)}

							{/* ── Applied patches indicator ── */}
							{previewState.appliedPatches.length > 0 && (
								<div className="p-2 bg-blue-900/20 border border-blue-800 rounded text-xs text-blue-300 flex items-center gap-1.5">
									<CheckCircle2 size={12} className="shrink-0" />
									<span>
										{previewState.appliedPatches.length} dependency patch
										{previewState.appliedPatches.length !== 1 ? "es" : ""} applied
										— will be included in run request
									</span>
								</div>
							)}

							{/* ── Error display ── */}
							{error && (
								<div className="p-2.5 bg-red-900/40 border border-red-800 rounded text-xs text-red-300 whitespace-pre-wrap max-h-32 overflow-auto">
									{error}
								</div>
							)}

							{/* ── Preview state error ── */}
							{previewState.error && (
								<div className="p-2.5 bg-red-900/40 border border-red-800 rounded text-xs text-red-300 flex items-start gap-2">
									<AlertCircle size={12} className="shrink-0 mt-0.5" />
									<div>
										<div className="font-semibold text-red-200 mb-0.5">
											{previewState.error.stage} error
										</div>
										{previewState.error.message}
										{previewState.error.recoverable && (
											<button
												onClick={clearError}
												className="ml-2 underline hover:text-red-200"
											>
												Dismiss
											</button>
										)}
									</div>
								</div>
							)}
						</div>

						{/* ── Action buttons ── */}
						<div className="flex gap-2 justify-end mt-4 pt-3 border-t border-gray-700 shrink-0">
							{/* Input stage: Validate */}
							{dialogStage === "input" && (
								<>
									<button
										onClick={handleClose}
										className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
									>
										Cancel
									</button>
									{previewState.validationResponse &&
										!previewState.validationResponse.success && (
											<button
												onClick={() => {
													resetPreview();
													setError(null);
												}}
												className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
											>
												Edit Plan
											</button>
										)}
									<button
										onClick={handleValidate}
										disabled={
											planContent.trim().length === 0 ||
											previewState.stage === "validating"
										}
										className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
									>
										{previewState.stage === "validating"
											? "Validating..."
											: "Validate & Preview"}
									</button>
								</>
							)}

							{/* Validating stage */}
							{dialogStage === "validating" && (
								<>
									<button
										onClick={handleClose}
										className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
									>
										Cancel
									</button>
									<button
										disabled
										className="px-3 py-1.5 text-xs rounded bg-blue-700 text-white opacity-50"
									>
										Validating...
									</button>
								</>
							)}

							{/* Preflight stage: can run directly (no approval required) */}
							{dialogStage === "preflight" && (
								<>
									<button
										onClick={() => {
											resetPreview();
											setError(null);
										}}
										className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
									>
										Back
									</button>
									<button
										onClick={handleQueuePlan}
										className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors flex items-center gap-1"
										title="Queue this plan to run after the current working plan finishes"
									>
										Do after current
									</button>
									<button
										onClick={handleRun}
										disabled={!canRun}
										className="px-3 py-1.5 text-xs rounded bg-green-700 hover:bg-green-600 text-white transition-colors disabled:opacity-50 flex items-center gap-1"
									>
										<Play size={12} />
										Run Plan
									</button>
								</>
							)}

							{/* Approval stage: Run is disabled until approved */}
							{dialogStage === "approval" && (
								<>
									<button
										onClick={() => {
											resetPreview();
											setError(null);
										}}
										className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
									>
										Back
									</button>
									<button
										onClick={handleQueuePlan}
										className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors flex items-center gap-1"
										title="Queue this plan to run after the current working plan finishes"
									>
										Do after current
									</button>
									{/* AC 2: Run disabled until approved */}
									<button
										disabled
										className="px-3 py-1.5 text-xs rounded bg-gray-600 text-gray-400 cursor-not-allowed flex items-center gap-1 opacity-50"
										title="This plan requires review approval before execution"
									>
										<Play size={12} />
										Run (Approval Required)
									</button>
									<button
										onClick={handleApproveAndRun}
										className="px-3 py-1.5 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white transition-colors flex items-center gap-1"
									>
										<ShieldCheck size={12} />
										Approve & Run
									</button>
								</>
							)}

							{/* Running stage */}
							{dialogStage === "running" && (
								<>
									<button
										onClick={handleClose}
										className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
									>
										Cancel
									</button>
									<button
										disabled
										className="px-3 py-1.5 text-xs rounded bg-green-700 text-white opacity-50 flex items-center gap-1"
									>
										<Play size={12} />
										Starting...
									</button>
								</>
							)}
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

// ─── Stage badge ──

function StageBadge({ stage }: { stage: DialogStage }) {
	const config: Record<DialogStage, { label: string; color: string }> = {
		input: { label: "Input", color: "bg-gray-700 text-gray-300" },
		validating: { label: "Validating", color: "bg-blue-900/50 text-blue-300" },
		preflight: { label: "Preflight", color: "bg-emerald-900/50 text-emerald-300" },
		approval: { label: "Approval", color: "bg-amber-900/50 text-amber-300" },
		running: { label: "Running", color: "bg-green-900/50 text-green-300" },
	};
	const { label, color } = config[stage];
	return (
		<span
			className={`text-[10px] px-2 py-0.5 rounded font-medium ${color}`}
		>
			{label}
		</span>
	);
}

// ─── AC 4: Graph diff view ──

interface GraphDiffData {
	added: DependencyGraphNode[];
	removed: DependencyGraphNode[];
	changed: Array<{
		node: DependencyGraphNode;
		origDeps: string[];
		newDeps: string[];
		addedDeps: string[];
		removedDeps: string[];
	}>;
}

function GraphDiffView({ diffData }: { diffData: GraphDiffData }) {
	const [expanded, setExpanded] = useState(true);
	const hasDiffs =
		diffData.added.length > 0 ||
		diffData.removed.length > 0 ||
		diffData.changed.length > 0;

	return (
		<div className="border-b border-gray-700">
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-750 text-xs text-gray-300 transition-colors"
			>
				{expanded ? (
					<ChevronDown size={12} />
				) : (
					<ChevronRight size={12} />
				)}
				<GitCompare size={12} className="text-blue-400" />
				<span className="font-semibold">Dependency Graph Comparison</span>
				<span className="ml-auto text-[10px] text-gray-500">
					Original vs Edited
				</span>
			</button>

			{expanded && (
				<div className="px-3 py-2 text-xs space-y-3">
					{!hasDiffs && (
						<div className="text-gray-500 text-center py-2">
							No differences between original and edited dependency graphs.
						</div>
					)}

					{/* Added nodes */}
					{diffData.added.length > 0 && (
						<div>
							<h4 className="text-emerald-400 font-semibold mb-1 flex items-center gap-1">
								+ Added Workspaces ({diffData.added.length})
							</h4>
							{diffData.added.map((node) => (
								<div
									key={node.id}
									className="ml-2 py-1 flex items-center gap-2 text-emerald-300"
								>
									<span className="font-mono font-medium">{node.id}</span>
									<span className="text-gray-500">{node.title}</span>
									{node.dependencies.length > 0 && (
										<span className="text-gray-500">
											deps: [{node.dependencies.join(", ")}]
										</span>
									)}
								</div>
							))}
						</div>
					)}

					{/* Removed nodes */}
					{diffData.removed.length > 0 && (
						<div>
							<h4 className="text-red-400 font-semibold mb-1 flex items-center gap-1">
								- Removed Workspaces ({diffData.removed.length})
							</h4>
							{diffData.removed.map((node) => (
								<div
									key={node.id}
									className="ml-2 py-1 flex items-center gap-2 text-red-300 line-through opacity-70"
								>
									<span className="font-mono font-medium">{node.id}</span>
									<span className="text-gray-500">{node.title}</span>
								</div>
							))}
						</div>
					)}

					{/* Changed dependencies */}
					{diffData.changed.length > 0 && (
						<div>
							<h4 className="text-amber-400 font-semibold mb-1 flex items-center gap-1">
								~ Changed Dependencies ({diffData.changed.length})
							</h4>
							{diffData.changed.map(({ node, origDeps, newDeps, addedDeps, removedDeps }) => (
								<div
									key={node.id}
									className="ml-2 py-1.5 border-l-2 border-amber-700 pl-2"
								>
									<div className="font-mono font-medium text-amber-300 mb-1">
										{node.id}
										<span className="text-gray-500 ml-1 font-normal">
											{node.title}
										</span>
									</div>
									<div className="flex items-start gap-3 text-[11px]">
										{/* Original */}
										<div className="flex-1">
											<span className="text-gray-500 block mb-0.5">
												Original
											</span>
											<div className="font-mono text-red-400 bg-red-900/20 px-2 py-1 rounded">
												{origDeps.length > 0
													? origDeps.join(", ")
													: "(none)"}
											</div>
										</div>
										<ChevronRight
											size={12}
											className="text-gray-600 mt-4 shrink-0"
										/>
										{/* Edited */}
										<div className="flex-1">
											<span className="text-gray-500 block mb-0.5">
												Edited
											</span>
											<div className="font-mono text-emerald-400 bg-emerald-900/20 px-2 py-1 rounded">
												{newDeps.length > 0
													? newDeps.join(", ")
													: "(none)"}
											</div>
										</div>
									</div>
									{/* Detailed diff */}
									{addedDeps.length > 0 && (
										<div className="mt-1 text-emerald-400 text-[10px]">
											+ Added: {addedDeps.join(", ")}
										</div>
									)}
									{removedDeps.length > 0 && (
										<div className="mt-0.5 text-red-400 text-[10px]">
											- Removed: {removedDeps.join(", ")}
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export { GraphDiffView };
export type { GraphDiffData, DialogStage };
