/**
 * TaskCreationStudio — full task creation studio for bulk plan intake.
 *
 * Replaces the old TaskCreateDialog with a three-panel studio:
 *   Left:   imported plan list
 *   Center: selected plan details / rename / DAG / execution preview
 *   Right:  validator results / conflicts / create readiness
 *
 * Supports both "Single Task" (backward compat) and "Bulk Plans" modes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
	AlertCircle,
	AlertTriangle,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	FileText,
	Loader2,
	Plus,
	Upload,
	X,
	Copy,
	Trash2,
	RefreshCw,
	ListOrdered,
	GitBranch,
	ShieldCheck,
	Play,
} from "lucide-react";

import type {
	ParsedPlanDraft,
	PlanValidationMessage,
	ExecutionBatch,
	BulkCreateTaskRequest,
	BulkCreateTaskResponse,
	ValidationSeverity,
} from "../types";
import { parsePlan } from "../utils/planParser";
import {
	validatePlans,
	generateRenamePreviews,
	computeExecutionPreview,
	validateRenameTemplate,
	type RenameTemplate,
	type ValidationResult,
} from "../utils/planValidator";

const API_BASE = "";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TaskCreationStudioProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
	onTaskCreated: (taskId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SeverityIcon({ severity }: { severity: ValidationSeverity }) {
	switch (severity) {
		case "pass":
			return <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />;
		case "warning":
			return <AlertTriangle size={12} className="text-amber-400 shrink-0" />;
		case "error":
			return <AlertCircle size={12} className="text-red-400 shrink-0" />;
		case "blocker":
			return <X size={12} className="text-red-500 shrink-0" />;
	}
}

function SeverityBadge({ severity, count }: { severity: ValidationSeverity; count: number }) {
	if (count === 0) return null;
	const colors: Record<string, string> = {
		pass: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
		warning: "bg-amber-900/40 text-amber-300 border-amber-700",
		error: "bg-red-900/40 text-red-300 border-red-700",
		blocker: "bg-red-950/60 text-red-200 border-red-800",
	};
	return (
		<span className={`text-xs px-1.5 py-0.5 rounded border ${colors[severity] ?? colors.warning}`}>
			{severity.toUpperCase()} {count}
		</span>
	);
}

function StatusDot({ status }: { status: "ok" | "warning" | "error" }) {
	const colors: Record<string, string> = {
		ok: "bg-emerald-500",
		warning: "bg-amber-500",
		error: "bg-red-500",
	};
	return <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${colors[status] ?? "bg-stone-400"}`} />;
}

function PlanNameChip({ name }: { name: string }) {
	return (
		<span className="px-1.5 py-0.5 bg-white dark:bg-[#1E1E1E] rounded text-xs text-stone-700 dark:text-stone-300 inline-block">
			{name}
		</span>
	);
}

type CenterTab = "details" | "rename" | "dag" | "execution";

// ---------------------------------------------------------------------------
// Studio Component
// ---------------------------------------------------------------------------

export function TaskCreationStudio({ isOpen, onClose, projectId, onTaskCreated }: TaskCreationStudioProps) {
	// ── Mode ──
	const [mode, setMode] = useState<"single" | "bulk">("bulk");
	const [centerTab, setCenterTab] = useState<CenterTab>("details");

	// ── Single task mode state ──
	const [singleName, setSingleName] = useState("");
	const [singleDescription, setSingleDescription] = useState("");
	const [singleExecutionMode, setSingleExecutionMode] = useState<"sequential" | "parallel">("sequential");

	// ── Bulk plan state ──
	const [plans, setPlans] = useState<ParsedPlanDraft[]>([]);
	const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
	const [renameTemplate, setRenameTemplate] = useState<RenameTemplate>("{planId}-{shortTitle}");
	const [safeParallelism, setSafeParallelism] = useState(3);
	const [hardMaxParallelism, setHardMaxParallelism] = useState(5);

	// ── Validation state ──
	const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
	const [validationRun, setValidationRun] = useState(false);

	// ── Review state ──
	const [showReview, setShowReview] = useState(false);

	// ── Creation state ──
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createResult, setCreateResult] = useState<BulkCreateTaskResponse | null>(null);

	// ── Paste buffer ──
	const [pasteText, setPasteText] = useState("");

	// ── Template preview ──
	const renamePreviews = useMemo(
		() => (plans.length > 0 ? generateRenamePreviews(plans, renameTemplate) : []),
		[plans, renameTemplate],
	);

	const templateError = useMemo(() => validateRenameTemplate(renameTemplate), [renameTemplate]);

	// ── Counts ──
	const severityCounts = useMemo(() => {
		const counts: Record<ValidationSeverity, number> = { pass: 0, warning: 0, error: 0, blocker: 0 };
		if (!validationResult) return counts;
		for (const m of validationResult.messages) {
			counts[m.severity]++;
		}
		return counts;
	}, [validationResult]);

	// ── Selected plan ──
	const selectedPlan = useMemo(
		() => plans.find((p) => p.localId === selectedLocalId) ?? null,
		[plans, selectedLocalId],
	);

	// ── Import files ──
	const handleFileImport = useCallback(
		(files: FileList | null) => {
			if (!files) return;
			setShowReview(false);
			setCreateResult(null);
			setValidationRun(false);
			setValidationResult(null);

			Array.from(files).forEach((file) => {
				const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
				if (!["md", "txt", "json", "yml", "yaml"].includes(ext)) {
					setError(`Unsupported file type: .${ext} for "${file.name}". Use .md, .txt, .json, .yml, or .yaml`);
					return;
				}
				const reader = new FileReader();
				reader.onload = (e) => {
					const text = e.target?.result as string;
					if (!text) return;
					const parsed = parsePlan(text, file.name);
					setPlans((prev) => [...prev, parsed]);
					setError(null);
				};
				reader.onerror = () => {
					setError(`Failed to read file: ${file.name}`);
				};
				reader.readAsText(file);
			});
		},
		[],
	);

	// ── Paste import ──
	const handlePasteImport = useCallback(() => {
		if (!pasteText.trim()) return;
		setShowReview(false);
		setCreateResult(null);
		setValidationRun(false);
		setValidationResult(null);

		// Treat paste as one or more plan documents separated by "---"
		const parts = pasteText
			.split(/(?:^|\n)---\s*(?:\n|$)/)
			.map((s) => s.trim())
			.filter(Boolean);

		if (parts.length === 0) {
			const parsed = parsePlan(pasteText, "pasted-plan.md");
			setPlans((prev) => [...prev, parsed]);
		} else {
			for (let i = 0; i < parts.length; i++) {
				const parsed = parsePlan(parts[i], `pasted-plan-${i + 1}.md`);
				setPlans((prev) => [...prev, parsed]);
			}
		}
		setPasteText("");
		setError(null);
	}, [pasteText]);

	// ── Remove plan ──
	const handleRemovePlan = useCallback((localId: string) => {
		setPlans((prev) => prev.filter((p) => p.localId !== localId));
		setSelectedLocalId((prev) => (prev === localId ? null : prev));
		setShowReview(false);
		setValidationRun(false);
		setValidationResult(null);
		setCreateResult(null);
	}, []);

	// ── Clear all ──
	const handleClearAll = useCallback(() => {
		setPlans([]);
		setSelectedLocalId(null);
		setShowReview(false);
		setValidationRun(false);
		setValidationResult(null);
		setCreateResult(null);
		setError(null);
	}, []);

	// ── Run validation ──
	const handleValidate = useCallback(() => {
		if (plans.length === 0) return;
		const result = validatePlans(plans);
		setValidationResult(result);
		setValidationRun(true);
		setShowReview(false);
		setCreateResult(null);
	}, [plans]);

	// Re-validate when plans change (if already validated)
	useEffect(() => {
		if (plans.length > 0 && validationRun) {
			const result = validatePlans(plans);
			setValidationResult(result);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [plans]);

	// ── Show review before creation ──
	const handleReview = useCallback(() => {
		if (!validationResult || validationResult.hasBlocker) {
			setError("Cannot create: blockers exist. Fix validation issues first.");
			return;
		}
		if (plans.length === 0) {
			setError("No plans to create tasks from.");
			return;
		}
		setShowReview(true);
		setError(null);
	}, [validationResult, plans]);

	// ── Create tasks (bulk) — called after review confirmation ──
	const handleBulkCreate = useCallback(async () => {
		if (!validationResult || validationResult.hasBlocker) {
			setError("Cannot create: blockers exist. Fix validation issues first.");
			return;
		}
		if (plans.length === 0) {
			setError("No plans to create tasks from.");
			return;
		}

		setCreating(true);
		setError(null);
		setCreateResult(null);

		const executionPreview = computeExecutionPreview(plans, validationResult, safeParallelism, hardMaxParallelism);

		const body: BulkCreateTaskRequest = {
			mode: "bulk_plans",
			strategy: "one_task_per_plan",
			executionMode: executionPreview.safeParallelism > 1 ? "parallel" : "sequential",
			safeParallelism: executionPreview.safeParallelism,
			plans: plans.map((p, i) => ({
				localId: p.localId,
				title: renamePreviews[i]?.newTitle ?? p.detectedTitle ?? p.sourceFileName,
				planId: p.detectedPlanId ?? `plan-${i + 1}`,
				sourceFileName: p.sourceFileName,
				rawText: p.rawText,
				dependencies: p.detectedDependencies,
				allowedFiles: p.detectedAllowedFiles,
				forbiddenFiles: p.detectedForbiddenFiles,
				validationCommands: p.detectedValidationCommands,
			})),
		};

		try {
			const response = await fetch(`${API_BASE}/api/projects/${projectId}/tasks/bulk`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			const result: BulkCreateTaskResponse = await response.json();

			if (!response.ok || !result.ok) {
				setError(result.error ?? "Failed to create tasks");
				setCreateResult(result);
				return;
			}

			setCreateResult(result);

			if (result.createdTasks?.length === 1) {
				onTaskCreated(result.createdTasks[0].id);
				handleClose();
			}
		} catch (err) {
			setError(String(err));
		} finally {
			setCreating(false);
		}
	}, [plans, validationResult, renamePreviews, safeParallelism, hardMaxParallelism, projectId, onTaskCreated]);

	// ── Create single task ──
	const handleSingleCreate = useCallback(async () => {
		if (!singleName.trim()) {
			setError("Task name is required");
			return;
		}

		setCreating(true);
		setError(null);

		try {
			const body: Record<string, unknown> = {
				title: singleName.trim(),
				executionMode: singleExecutionMode,
				origin: {
					type: "user_upload",
					sourcePlanFiles: [],
				},
				phases: [
					{
						id: "phase-1",
						title: singleDescription.trim() || singleName.trim(),
						planFile: "pending",
						dependsOn: [],
					},
				],
				planFiles: [],
			};

			const response = await fetch(`${API_BASE}/api/projects/${projectId}/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			const result = await response.json();

			if (!response.ok || !result.task?.id) {
				setError(result.error || "Failed to create task");
				return;
			}

			onTaskCreated(result.task.id);
			handleClose();
		} catch (err) {
			setError(String(err));
		} finally {
			setCreating(false);
		}
	}, [singleName, singleDescription, singleExecutionMode, projectId, onTaskCreated]);

	// ── Close + Reset ──
	const handleClose = useCallback(() => {
		setPlans([]);
		setSelectedLocalId(null);
		setCenterTab("details");
		setShowReview(false);
		setValidationRun(false);
		setValidationResult(null);
		setCreating(false);
		setError(null);
		setCreateResult(null);
		setPasteText("");
		setSingleName("");
		setSingleDescription("");
		setSingleExecutionMode("sequential");
		onClose();
	}, [onClose]);

	const isSingleValid = singleName.trim().length > 0;
	const canBulkCreate =
		plans.length > 0 &&
		validationResult !== null &&
		!validationResult.hasBlocker &&
		!creating &&
		createResult === null;
	const isBulkValidNoIssues = validationResult !== null && !validationResult.hasBlocker;

	// ── Computed execution preview ──
	const executionPreview = useMemo(() => {
		if (!validationResult) return null;
		return computeExecutionPreview(plans, validationResult, safeParallelism, hardMaxParallelism);
	}, [plans, validationResult, safeParallelism, hardMaxParallelism]);

	// ── Render ──
	return (
		<AnimatePresence>
			{isOpen && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
					onClick={handleClose}
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.97 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.97 }}
						transition={{ duration: 0.12 }}
						className="bg-[#F7F6F3] dark:bg-[#161616] border border-[#E8E6E1] dark:border-[#333] rounded-lg shadow-xl w-[95vw] max-w-[1360px] h-[90vh] max-h-[820px] flex flex-col"
						onClick={(e) => e.stopPropagation()}
					>
						{/* ── Header ── */}
						<div className="flex items-center justify-between px-5 py-3 border-b border-[#E8E6E1] dark:border-[#333] shrink-0">
							<div className="flex items-center gap-3">
								<h2 className="text-base font-semibold text-stone-800 dark:text-stone-200">Task Creation Studio</h2>
								<div className="flex gap-1 ml-4">
									<button
										onClick={() => { setMode("bulk"); setError(null); }}
										className={`px-2.5 py-1 text-xs rounded transition-colors ${
											mode === "bulk"
												? "bg-blue-900/50 border border-blue-600 text-blue-300"
												: "bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] text-stone-500 dark:text-stone-400 hover:border-[#E8E6E1] dark:border-[#333]"
										}`}
									>
										Bulk Plans
									</button>
									<button
										onClick={() => { setMode("single"); setError(null); }}
										className={`px-2.5 py-1 text-xs rounded transition-colors ${
											mode === "single"
												? "bg-blue-900/50 border border-blue-600 text-blue-300"
												: "bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] text-stone-500 dark:text-stone-400 hover:border-[#E8E6E1] dark:border-[#333]"
										}`}
									>
										Single Task
									</button>
								</div>
							</div>
							<button
								onClick={handleClose}
								className="text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:text-stone-300 transition-colors p-0.5"
							>
								<X size={14} />
							</button>
						</div>

						{/* ── Body ── */}
						<div className="flex-1 min-h-0 flex overflow-hidden">
							{mode === "single" ? (
								/* ── Single Task Mode ── */
								<div className="flex-1 flex items-start justify-center p-8 overflow-y-auto">
									<div className="w-full max-w-md space-y-5">
										<div>
											<label className="block text-xs text-stone-500 dark:text-stone-400 mb-1.5 font-medium">
												Task name <span className="text-red-400">*</span>
											</label>
											<input
												type="text"
												value={singleName}
												onChange={(e) => setSingleName(e.target.value)}
												placeholder="e.g., Implement user authentication"
												className="w-full px-3 py-2 text-sm bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] rounded text-stone-800 dark:text-stone-200 placeholder:text-stone-400 focus:outline-none focus:border-blue-500"
												autoFocus
												onKeyDown={(e) => {
													if (e.key === "Enter" && isSingleValid && !creating) {
														handleSingleCreate();
													}
												}}
											/>
										</div>
										<div>
											<label className="block text-xs text-stone-500 dark:text-stone-400 mb-1.5 font-medium">
												Description <span className="text-stone-400 dark:text-stone-500">(optional)</span>
											</label>
											<textarea
												value={singleDescription}
												onChange={(e) => setSingleDescription(e.target.value)}
												placeholder="What does this task involve?"
												className="w-full min-h-[60px] px-3 py-2 text-sm bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] rounded text-stone-800 dark:text-stone-200 placeholder:text-stone-400 focus:outline-none focus:border-blue-500 resize-y"
												spellCheck={false}
											/>
										</div>
										<div>
											<label className="block text-xs text-stone-500 dark:text-stone-400 mb-1.5 font-medium">Execution mode</label>
											<div className="flex gap-2">
												<button
													onClick={() => setSingleExecutionMode("sequential")}
													className={`flex-1 px-3 py-2 text-xs rounded border transition-colors ${
														singleExecutionMode === "sequential"
															? "bg-blue-900/50 border-blue-600 text-blue-300"
															: "bg-white dark:bg-[#1E1E1E] border-[#E8E6E1] dark:border-[#333] text-stone-500 dark:text-stone-400 hover:border-[#E8E6E1] dark:border-[#333]"
													}`}
												>
													Sequential
												</button>
												<button
													onClick={() => setSingleExecutionMode("parallel")}
													className={`flex-1 px-3 py-2 text-xs rounded border transition-colors ${
														singleExecutionMode === "parallel"
															? "bg-blue-900/50 border-blue-600 text-blue-300"
															: "bg-white dark:bg-[#1E1E1E] border-[#E8E6E1] dark:border-[#333] text-stone-500 dark:text-stone-400 hover:border-[#E8E6E1] dark:border-[#333]"
													}`}
												>
													Parallel
												</button>
											</div>
										</div>
										{error && (
											<div className="p-2.5 bg-red-900/40 border border-red-800 rounded text-xs text-red-300">
												{error}
											</div>
										)}
										<div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E8E6E1] dark:border-[#333]">
											<button
												onClick={handleClose}
												className="px-3 py-1.5 text-xs rounded bg-stone-100 dark:bg-[#2A2A2A] hover:bg-stone-200 dark:hover:bg-[#333] text-stone-800 dark:text-stone-200 transition-colors"
											>
												Cancel
											</button>
											<button
												onClick={handleSingleCreate}
												disabled={!isSingleValid || creating}
												className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
											>
												{creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
												{creating ? "Creating..." : "Create task"}
											</button>
										</div>
									</div>
								</div>
							) : (
								/* ── Bulk Plans Mode: Three-panel layout ── */
								<>
									{/* LEFT PANEL */}
									<div className="w-[280px] shrink-0 border-r border-[#E8E6E1] dark:border-[#333] flex flex-col overflow-hidden">
										<div className="px-3 py-2 border-b border-[#E8E6E1] dark:border-[#333] flex items-center justify-between shrink-0">
											<span className="text-xs font-medium text-stone-500 dark:text-stone-400">Plans ({plans.length})</span>
											<div className="flex items-center gap-1">
												<label className="cursor-pointer text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:text-stone-300 transition-colors p-0.5">
													<Upload size={12} />
													<input
														type="file"
														multiple
														accept=".md,.txt,.json,.yml,.yaml"
														className="hidden"
														onChange={(e) => handleFileImport(e.target.files)}
													/>
												</label>
												{plans.length > 0 && (
													<button
														onClick={handleClearAll}
														className="text-stone-400 dark:text-stone-500 hover:text-red-400 transition-colors p-0.5"
														title="Clear all"
													>
														<Trash2 size={12} />
													</button>
												)}
											</div>
										</div>
										{/* Paste import */}
										<div className="px-3 py-2 border-b border-[#E8E6E1] dark:border-[#333]">
											<div className="flex gap-1">
												<textarea
													value={pasteText}
													onChange={(e) => setPasteText(e.target.value)}
													placeholder="Paste plan text (--- to separate)..."
													className="flex-1 px-2 py-1 text-xs bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] rounded text-stone-700 dark:text-stone-300 placeholder:text-stone-400 focus:outline-none focus:border-blue-500 resize-none"
													rows={2}
												/>
												<button
													onClick={handlePasteImport}
													disabled={!pasteText.trim()}
													className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-[#2A2A2A] hover:bg-stone-200 dark:hover:bg-[#333] text-stone-700 dark:text-stone-300 disabled:opacity-40 transition-colors shrink-0"
													title="Import pasted text"
												>
													<Copy size={11} />
												</button>
											</div>
										</div>
										{/* Plan list */}
										<div className="flex-1 overflow-y-auto">
											{plans.length === 0 ? (
												<div className="flex flex-col items-center gap-2 px-4 py-8 text-xs text-stone-400 dark:text-stone-500 text-center">
													<FileText size={24} className="text-stone-400 dark:text-stone-500" />
													<p>No plans imported</p>
													<p className="text-stone-400 dark:text-stone-500">Upload .md, .txt, .json, .yml files or paste plan text</p>
												</div>
											) : (
												<div className="flex flex-col gap-0.5 p-1.5">
													{plans.map((p) => (
														<div
															key={p.localId}
															className={`flex items-start gap-2 px-2 py-1.5 rounded transition-colors ${
																selectedLocalId === p.localId
																	? "bg-blue-900/30 border border-blue-700/50"
																	: "hover:bg-white dark:bg-[#1E1E1E] border border-transparent"
															}`}
														>
															<button
																className="flex-1 min-w-0 text-left"
																onClick={() => setSelectedLocalId(p.localId)}
															>
																<div className="text-[12px] text-stone-800 dark:text-stone-200 truncate">
																	{p.detectedTitle ?? p.sourceFileName}
																</div>
																<div className="text-xs text-stone-400 dark:text-stone-500 truncate mt-0.5">
																	{p.sourceFileName}
																	{p.detectedPlanId ? `  \u2022  ${p.detectedPlanId}` : ""}
																</div>
															</button>
															<div className="flex items-center gap-1 shrink-0">
																<StatusDot status={p.parseStatus} />
																<button
																	onClick={() => handleRemovePlan(p.localId)}
																	className="text-stone-400 dark:text-stone-500 hover:text-red-400 transition-colors p-0.5"
																>
																	<X size={10} />
																</button>
															</div>
														</div>
													))}
												</div>
											)}
										</div>
									</div>

									{/* CENTER PANEL */}
									<div className="flex-1 min-w-0 flex flex-col overflow-hidden">
										<div className="flex border-b border-[#E8E6E1] dark:border-[#333] shrink-0">
											{[
												{ id: "details" as CenterTab, label: "Details" },
												{ id: "rename" as CenterTab, label: "Rename" },
												{ id: "dag" as CenterTab, label: "DAG" },
												{ id: "execution" as CenterTab, label: "Execution" },
											].map((tab) => (
												<button
													key={tab.id}
													onClick={() => setCenterTab(tab.id)}
													className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
														centerTab === tab.id
															? "border-blue-500 text-blue-300"
															: "border-transparent text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:text-stone-300"
													}`}
												>
													{tab.label}
												</button>
											))}
										</div>
										<div className="flex-1 overflow-y-auto p-4">
											{/* Details Tab */}
											{centerTab === "details" && (
												<>
													{plans.length === 0 ? (
														<div className="flex flex-col items-center gap-2 py-12 text-xs text-stone-400 dark:text-stone-500">
															<FileText size={28} className="text-stone-400 dark:text-stone-500" />
															<p>Import plans to see details</p>
														</div>
													) : !selectedPlan ? (
														<div className="flex flex-col items-center gap-2 py-12 text-xs text-stone-400 dark:text-stone-500">
															<p>Select a plan from the left panel</p>
														</div>
													) : (
														<div className="space-y-4">
															<h3 className="text-sm font-medium text-stone-800 dark:text-stone-200">
																{selectedPlan.detectedTitle ?? selectedPlan.sourceFileName}
															</h3>
															<div className="space-y-2">
																<MetaRow label="File" value={selectedPlan.sourceFileName} />
																<MetaRow label="Plan ID" value={selectedPlan.detectedPlanId} />
																<MetaRow label="Execution Class" value={selectedPlan.detectedExecutionClass} />
																<MetaRow label="Parse Status" value={selectedPlan.parseStatus} />
																<ListMeta label="Workspaces" items={selectedPlan.detectedWorkspaces} />
																<ListMeta label="Dependencies" items={selectedPlan.detectedDependencies} />
																<ListMeta label="Allowed Files" items={selectedPlan.detectedAllowedFiles} />
																<ListMeta label="Forbidden Files" items={selectedPlan.detectedForbiddenFiles} />
																<ListMeta label="Validation Cmds" items={selectedPlan.detectedValidationCommands} />
																<ListMeta label="Report Req." items={selectedPlan.detectedReportRequirements} />
															</div>
															<details className="text-xs">
																<summary className="text-stone-400 dark:text-stone-500 cursor-pointer hover:text-stone-700 dark:text-stone-300 mb-1">
																	Raw text preview
																</summary>
																<pre className="text-xs text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-[#2A2A2A] p-2 rounded max-h-40 overflow-y-auto border border-[#E8E6E1] dark:border-[#333] whitespace-pre-wrap">
																	{selectedPlan.rawText.slice(0, 2000)}
																	{selectedPlan.rawText.length > 2000 ? "\n\n... (truncated)" : ""}
																</pre>
															</details>
														</div>
													)}
												</>
											)}
											{/* Rename Tab */}
											{centerTab === "rename" && (
												<div className="space-y-4">
													<div>
														<label className="block text-xs text-stone-500 dark:text-stone-400 mb-1.5 font-medium">
															Rename template
														</label>
														<div className="flex gap-1.5 flex-wrap mb-2">
															{[
																"{planId}-{shortTitle}",
																"{index}-{planId}-{slug}",
																"{projectSlug}-{planId}-{title}",
																"{index}-{shortTitle}",
															].map((p) => (
																<button
																	key={p}
																	onClick={() => setRenameTemplate(p as RenameTemplate)}
																	className={`px-2 py-1 text-xs rounded border transition-colors ${
																		renameTemplate === p
																			? "bg-blue-900/40 border-blue-600 text-blue-300"
																			: "bg-white dark:bg-[#1E1E1E] border-[#E8E6E1] dark:border-[#333] text-stone-500 dark:text-stone-400 hover:border-[#E8E6E1] dark:border-[#333]"
																	}`}
																>
																	{p}
																</button>
															))}
														</div>
														<input
															type="text"
															value={renameTemplate}
															onChange={(e) => setRenameTemplate(e.target.value as RenameTemplate)}
															className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] rounded text-stone-800 dark:text-stone-200 focus:outline-none focus:border-blue-500"
														/>
														{templateError && (
															<p className="text-xs text-red-400 mt-1">{templateError}</p>
														)}
														<p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
															Variables: {'{index} {planId} {title} {shortTitle} {slug} {projectSlug}'}
														</p>
													</div>
													{renamePreviews.length > 0 && (
														<div>
															<h4 className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-2">Preview</h4>
															<div className="space-y-1">
																<div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-stone-400 dark:text-stone-500 px-2 py-1 border-b border-[#E8E6E1] dark:border-[#333]">
																	<span>Original</span>
																	<span>New Title</span>
																	<span>Slug</span>
																	<span />
																</div>
																{renamePreviews.map((r, i) => (
																	<div
																		key={i}
																		className={`grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs px-2 py-1 rounded ${
																			r.conflicts.length > 0 ? "bg-red-900/20" : "hover:bg-white dark:bg-[#1E1E1E]"
																		}`}
																	>
																		<span className="truncate text-stone-500 dark:text-stone-400">{r.originalName}</span>
																		<span className="truncate text-stone-800 dark:text-stone-200">{r.newTitle}</span>
																		<span className="truncate text-stone-500 dark:text-stone-400">{r.slug}</span>
																		<span>
																			{r.conflicts.length > 0 && (
																				<span
																					className="text-xs text-red-400"
																					title={r.conflicts.join("; ")}
																				>
																					Conflict
																				</span>
																			)}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}
													{renamePreviews.length === 0 && plans.length > 0 && (
														<p className="text-xs text-stone-400 dark:text-stone-500 text-center py-8">No rename previews generated</p>
													)}
													{plans.length === 0 && (
														<p className="text-xs text-stone-400 dark:text-stone-500 text-center py-8">Import plans to see rename preview</p>
													)}
												</div>
											)}
											{/* DAG Tab */}
											{centerTab === "dag" && (
												<>
													{!validationResult ? (
														<div className="flex flex-col items-center gap-2 py-12 text-xs text-stone-400 dark:text-stone-500">
															<GitBranch size={24} className="text-stone-400 dark:text-stone-500" />
															<p>Run validation to see DAG</p>
														</div>
													) : (
														<div className="space-y-4">
															{/* Batches */}
															<div>
																<h4 className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-2">
																	Execution Batches ({validationResult.batches.length})
																</h4>
																{validationResult.batches.length === 0 ? (
																	<p className="text-xs text-stone-400 dark:text-stone-500">No batches computed</p>
																) : (
																	<div className="space-y-2">
																		{validationResult.batches.map((batch) => {
																			const batchPlans = batch.planLocalIds
																				.map((id) => plans.find((p) => p.localId === id))
																				.filter(Boolean) as ParsedPlanDraft[];
																			return (
																				<div key={batch.id} className="border border-[#E8E6E1] dark:border-[#333] rounded p-2">
																					<div className="flex items-center justify-between mb-1">
																						<span className="text-xs font-medium text-stone-700 dark:text-stone-300">{batch.title}</span>
																						{batch.canRunInParallel && (
																							<span className="text-xs text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded">
																								Parallel-safe
																							</span>
																						)}
																					</div>
																					<div className="flex flex-wrap gap-1">
																						{batchPlans.map((p) => (
																							<PlanNameChip key={p.localId} name={p.detectedTitle ?? p.sourceFileName} />
																						))}
																					</div>
																				</div>
																			);
																		})}
																	</div>
																)}
															</div>
															{/* Root nodes */}
															{validationResult.batches.length > 0 && validationResult.batches[0] && (
																<div>
																	<h4 className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-2">
																		Root Nodes (no dependencies)
																	</h4>
																	<div className="flex flex-wrap gap-1">
																		{validationResult.batches[0].planLocalIds.map((id) => {
																			const p = plans.find((pl) => pl.localId === id);
																			return (
																				<PlanNameChip
																					key={id}
																					name={p ? (p.detectedTitle ?? p.sourceFileName) : id}
																				/>
																			);
																		})}
																	</div>
																</div>
															)}
															{/* Cycles */}
															{validationResult.cycles.length > 0 && (
																<div>
																	<h4 className="text-xs font-medium text-red-400 mb-2">Cycles Detected</h4>
																	<div className="space-y-1">
																		{validationResult.cycles.map((c, i) => (
																			<div
																				key={i}
																				className="bg-red-900/30 border border-red-800/40 rounded p-2 text-xs text-red-300"
																			>
																				Cycle: {c.cycle.join(" \u2192 ")}
																			</div>
																		))}
																	</div>
																</div>
															)}
															{/* File conflicts */}
															{validationResult.fileConflicts.length > 0 && (
																<div>
																	<h4 className="text-xs font-medium text-amber-400 mb-2">File Conflicts</h4>
																	<div className="space-y-1">
																		{validationResult.fileConflicts.map((cf, i) => {
																			const planA = plans.find((p) => p.localId === cf.planA);
																			const planB = plans.find((p) => p.localId === cf.planB);
																			return (
																				<div
																					key={i}
																					className="bg-amber-900/20 border border-amber-800/40 rounded p-2 text-xs text-amber-300"
																				>
																					{planA?.detectedTitle ?? cf.planA} {"\u2194"}{" "}
																					{planB?.detectedTitle ?? cf.planB}: {cf.files.join(", ")}
																				</div>
																			);
																		})}
																	</div>
																</div>
															)}
															{/* Unresolved deps */}
															{validationResult.unresolvedDeps.length > 0 && (
																<div>
																	<h4 className="text-xs font-medium text-red-400 mb-2">Unresolved Dependencies</h4>
																	<div className="space-y-1">
																		{validationResult.unresolvedDeps.map((id) => {
																			const p = plans.find((pl) => pl.localId === id);
																			return (
																				<div
																					key={id}
																					className="bg-red-900/30 border border-red-800/40 rounded p-2 text-xs text-red-300"
																				>
																					{p?.detectedTitle ?? id} — unresolved dependencies
																				</div>
																			);
																		})}
																	</div>
																</div>
															)}
														</div>
													)}
												</>
											)}
											{/* Execution Tab */}
											{centerTab === "execution" && (
												<>
													{!executionPreview ? (
														<div className="flex flex-col items-center gap-2 py-12 text-xs text-stone-400 dark:text-stone-500">
															<ListOrdered size={24} className="text-stone-400 dark:text-stone-500" />
															<p>Run validation first to see execution preview</p>
														</div>
													) : (
														<div className="space-y-4">
															<div>
																<h4 className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-2">
																	Parallelism Configuration
																</h4>
																<div className="flex items-center gap-4 text-xs">
																	<div>
																		<label className="text-stone-400 dark:text-stone-500 block mb-1">Safe Parallelism</label>
																		<input
																			type="number"
																			min={1}
																			max={10}
																			value={safeParallelism}
																			onChange={(e) =>
																				setSafeParallelism(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
																			}
																			className="w-16 px-2 py-1 text-xs bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] rounded text-stone-800 dark:text-stone-200 text-center focus:outline-none focus:border-blue-500"
																		/>
																	</div>
																	<div>
																		<label className="text-stone-400 dark:text-stone-500 block mb-1">Hard Max</label>
																		<input
																			type="number"
																			min={1}
																			max={20}
																			value={hardMaxParallelism}
																			onChange={(e) =>
																				setHardMaxParallelism(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
																			}
																			className="w-16 px-2 py-1 text-xs bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] rounded text-stone-800 dark:text-stone-200 text-center focus:outline-none focus:border-blue-500"
																		/>
																	</div>
																	<div className="text-stone-500 dark:text-stone-400">
																		Effective:{' '}
																		<span className="text-stone-800 dark:text-stone-200 font-medium">{executionPreview.safeParallelism}</span>
																	</div>
																</div>
															</div>
															<div>
																<h4 className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-2">
																	Execution Batches ({executionPreview.batches.length})
																</h4>
																<div className="space-y-1.5">
																	{executionPreview.batches.map((batch) => (
																		<div
																			key={batch.id}
																			className={`border rounded p-2 ${
																				batch.canRunInParallel
																					? "border-emerald-800/30 bg-emerald-900/10"
																					: "border-[#E8E6E1] dark:border-[#333] bg-stone-100 dark:bg-[#2A2A2A]"
																			}`}
																		>
																			<div className="flex items-center justify-between">
																				<span className="text-xs text-stone-700 dark:text-stone-300">{batch.title}</span>
																				<span className="text-xs text-stone-400 dark:text-stone-500">
																					{batch.planLocalIds.length} plan{batch.planLocalIds.length !== 1 ? "s" : ""}
																					{batch.canRunInParallel ? " — parallel" : " — sequential"}
																				</span>
																			</div>
																		</div>
																	))}
																</div>
															</div>
															<div className="bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] rounded p-3 text-xs text-stone-500 dark:text-stone-400 space-y-1">
																<p>
																	Strategy: <span className="text-stone-800 dark:text-stone-200">one task per plan</span>
																</p>
																<p>
																	Safe parallelism:{' '}
																	<span className="text-stone-800 dark:text-stone-200">{executionPreview.safeParallelism}</span>
																</p>
																<p>
																	Total batches:{' '}
																	<span className="text-stone-800 dark:text-stone-200">{executionPreview.batches.length}</span>
																</p>
																{validationResult?.fileConflicts.length ? (
																	<p className="text-amber-400">
																		{'⚠'} {validationResult.fileConflicts.length} file conflict(s) may reduce safe
																		parallelism
																	</p>
																) : null}
																{validationResult?.cycles.length ? (
																	<p className="text-red-400">
																		{'⛔'} Cycle detected — parallelism forced to 1
																	</p>
																) : null}
															</div>
														</div>
													)}
												</>
											)}
										</div>
									</div>

									{/* RIGHT PANEL */}
									<div className="w-[320px] shrink-0 border-l border-[#E8E6E1] dark:border-[#333] flex flex-col overflow-hidden">
										<div className="px-3 py-2 border-b border-[#E8E6E1] dark:border-[#333] shrink-0">
											<div className="flex items-center justify-between mb-2">
												<span className="text-xs font-medium text-stone-500 dark:text-stone-400">Validation</span>
												<button
													onClick={handleValidate}
													disabled={plans.length === 0}
													className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-[#2A2A2A] hover:bg-stone-200 dark:hover:bg-[#333] text-stone-700 dark:text-stone-300 disabled:opacity-40 transition-colors flex items-center gap-1"
												>
													<RefreshCw size={10} />
													Validate
												</button>
											</div>
											{validationResult && (
												<div className="flex flex-wrap gap-1.5">
													<SeverityBadge severity="pass" count={severityCounts.pass} />
													<SeverityBadge severity="warning" count={severityCounts.warning} />
													<SeverityBadge severity="error" count={severityCounts.error} />
													<SeverityBadge severity="blocker" count={severityCounts.blocker} />
												</div>
											)}
											{!validationRun && plans.length > 0 && (
												<p className="text-xs text-stone-400 dark:text-stone-500 mt-1">Click Validate to check all plans</p>
											)}
											{plans.length === 0 && (
												<p className="text-xs text-stone-400 dark:text-stone-500 mt-1">Import plans first</p>
											)}
										</div>
										<div className="flex-1 overflow-y-auto p-3 space-y-1.5">
											{!validationResult && plans.length === 0 && (
												<p className="text-xs text-stone-400 dark:text-stone-500 text-center py-8">No plans to validate</p>
											)}
											{!validationResult && plans.length > 0 && !validationRun && (
												<p className="text-xs text-stone-400 dark:text-stone-500 text-center py-8">Validation not run</p>
											)}
											{validationResult && validationResult.messages.length === 0 && (
												<div className="flex items-center gap-2 text-xs text-emerald-400 py-4">
													<CheckCircle2 size={14} />
													All checks passed
												</div>
											)}
											{validationResult &&
												validationResult.messages.map((m) => (
													<div
														key={m.id}
														className={`p-2 rounded text-xs border ${
															m.severity === "pass"
																? "bg-emerald-900/20 border-emerald-800/30 text-emerald-300"
																: m.severity === "warning"
																	? "bg-amber-900/20 border-amber-800/30 text-amber-300"
																	: m.severity === "error"
																		? "bg-red-900/30 border-red-800/40 text-red-300"
																		: "bg-red-950/40 border-red-800/60 text-red-200"
														}`}
													>
														<div className="flex items-start gap-1.5">
															<SeverityIcon severity={m.severity} />
															<div className="flex-1 min-w-0">
																<span>{m.message}</span>
																{m.evidence && (
																	<div className="text-xs opacity-70 mt-0.5 truncate">{m.evidence}</div>
																)}
															</div>
														</div>
													</div>
												))}
										</div>
										{/* Footer */}
										<div className="px-3 py-3 border-t border-[#E8E6E1] dark:border-[#333] shrink-0 space-y-2">
											{error && (
												<div className="p-2 bg-red-900/40 border border-red-800 rounded text-xs text-red-300">
													{error}
												</div>
											)}
											{createResult && (
												<div className="space-y-1.5">
													{createResult.ok ? (
														<div className="p-2 bg-emerald-900/30 border border-emerald-800/40 rounded text-xs text-emerald-300">
															<CheckCircle2 size={12} className="inline mr-1" />
															Created {createResult.createdTasks?.length ?? 0} task(s)
															{createResult.createdTasks && (
																<ul className="mt-1 space-y-0.5">
																	{createResult.createdTasks.map((t) => (
																		<li key={t.id} className="truncate text-xs">
																			{t.title} ({t.id})
																		</li>
																	))}
																</ul>
															)}
														</div>
													) : (
														<div className="p-2 bg-red-900/40 border border-red-800 rounded text-xs text-red-300">
															Creation failed: {createResult.error}
														</div>
													)}
												</div>
											)}
											<div className="flex items-center gap-2">
												<button
													onClick={handleClose}
													className="px-3 py-1.5 text-xs rounded bg-stone-100 dark:bg-[#2A2A2A] hover:bg-stone-200 dark:hover:bg-[#333] text-stone-800 dark:text-stone-200 transition-colors"
												>
													Cancel
												</button>
												<button
													onClick={handleValidate}
													disabled={plans.length === 0 || creating}
													className="px-3 py-1.5 text-xs rounded bg-stone-100 dark:bg-[#2A2A2A] hover:bg-stone-200 dark:hover:bg-[#333] text-stone-800 dark:text-stone-200 transition-colors disabled:opacity-40 flex items-center gap-1"
												>
													<ShieldCheck size={11} />
													Validate
												</button>
												{!showReview ? (
												<button
													onClick={handleReview}
													disabled={!canBulkCreate}
													className="flex-1 px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
													title={
														!isBulkValidNoIssues
															? "Fix blocker validation errors first"
															: createResult
																? "Tasks already created"
																: ""
													}
												>
													<ListOrdered size={11} />
													Review & Create
												</button>
											) : (
												<button
													onClick={handleBulkCreate}
													disabled={creating}
													className="flex-1 px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
												>
													{creating ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
													{creating ? "Creating..." : "Confirm Create"}
												</button>
											)}
										</div>
										{showReview && validationResult && !createResult && (
											<div className="bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] rounded p-2.5 text-xs space-y-1.5">
												<p className="text-stone-700 dark:text-stone-300 font-medium mb-1">Creation Summary</p>
												<div className="text-stone-500 dark:text-stone-400 space-y-0.5">
													<p>Plans: <span className="text-stone-800 dark:text-stone-200">{plans.length}</span></p>
													<p>Batches: <span className="text-stone-800 dark:text-stone-200">{executionPreview?.batches.length ?? 0}</span></p>
													<p>Mode: <span className="text-stone-800 dark:text-stone-200">{safeParallelism > 1 ? "Parallel" : "Sequential"}</span></p>
													<p>Strategy: <span className="text-stone-800 dark:text-stone-200">one task per plan</span></p>
													<p>Safe parallelism: <span className="text-stone-800 dark:text-stone-200">{executionPreview?.safeParallelism ?? safeParallelism}</span></p>
												</div>
												<div className="mt-1.5 pt-1.5 border-t border-[#E8E6E1] dark:border-[#333]">
													<p className="text-stone-500 dark:text-stone-400 text-xs mb-1">Tasks to create:</p>
													{plans.slice(0, 10).map((p, i) => (
														<p key={p.localId} className="text-xs text-stone-400 dark:text-stone-500 truncate">
															{i + 1}. {renamePreviews[i]?.newTitle ?? p.detectedTitle ?? p.sourceFileName}
														</p>
													))}
													{plans.length > 10 && (
														<p className="text-xs text-stone-400 dark:text-stone-500">...and {plans.length - 10} more</p>
													)}
												</div>
												{!isBulkValidNoIssues && (
													<p className="text-xs text-red-400 mt-1">
														Fix BLOCKER or ERROR issues before creating tasks
													</p>
												)}
											</div>
										)}
										{!showReview && !isBulkValidNoIssues && validationRun && (
											<p className="text-xs text-red-400 text-center">
												Fix BLOCKER or ERROR issues before creating tasks
											</p>
										)}
										</div>
									</div>
								</>
							)}
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

// ---------------------------------------------------------------------------
// Inline helper components
// ---------------------------------------------------------------------------

function MetaRow({ label, value }: { label: string; value: string | undefined | null }) {
	return (
		<div className="flex items-center gap-2 text-xs">
			<span className="text-stone-400 dark:text-stone-500 w-32 shrink-0">{label}</span>
			<span className="text-stone-800 dark:text-stone-200 truncate">
				{value || <span className="text-stone-400 dark:text-stone-500 italic">Not detected</span>}
			</span>
		</div>
	);
}

function ListMeta({ label, items }: { label: string; items: string[] }) {
	return (
		<div className="flex items-start gap-2 text-xs">
			<span className="text-stone-400 dark:text-stone-500 w-32 shrink-0 mt-0.5">{label}</span>
			<div className="flex-1 flex flex-wrap gap-1">
				{items.length === 0 ? (
					<span className="text-stone-400 dark:text-stone-500 italic">None</span>
				) : (
					items.map((item, i) => (
						<span key={i} className="px-1.5 py-0.5 bg-white dark:bg-[#1E1E1E] rounded text-xs text-stone-700 dark:text-stone-300">
							{item}
						</span>
					))
				)}
			</div>
		</div>
	);
}
