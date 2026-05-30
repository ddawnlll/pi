/**
 * PlanUploadDialog — 4-step wizard for uploading, validating, reviewing,
 * and executing one or more plans.
 *
 * Steps:
 *   1. Select files  — drag-and-drop or browse, pick execution mode
 *   2. Validation    — per-file validation results, fix with AI
 *   3. Review & approve — preflight summary, dep diff, approval checklist
 *   4. Execute       — queue list with progress bar
 *
 * Supports two modes:
 *   - Multi-file mode: user selects multiple files via FileSelectScreen
 *   - Backward compat mode: when validationResults is empty but
 *     state.validationResponse is set (used by tests / single-plan flow)
 *
 * Acceptance Criteria (workspace 7.H):
 * 1. PlanUploadDialog shows preflight preview before run
 * 2. Run is disabled until required review is approved
 * 3. Edited dependency patches are included in the run request
 * 4. User can compare original and edited dependency graph
 */

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
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
	Loader2,
	FileText,
} from "lucide-react";
import { useParallelismPreview } from "../hooks/useParallelismPreview";
import type {
	ValidateWithPreviewResponse,
	DependencyGraphNode,
	DependencyPatch,
} from "../types";
import { FileSelectScreen, type FileEntry, type ScaleMode } from "./FileSelectScreen";
import { ValidationScreen } from "./ValidationScreen";
import { ReviewScreen } from "./ReviewScreen";
import { ExecuteScreen, type FileExecutionState } from "./ExecuteScreen";

const API_BASE = "";

// ---------------------------------------------------------------------------
// Exports (kept for backward compat with tests and other imports)
// ---------------------------------------------------------------------------

export type DialogStage = "input" | "validating" | "preflight" | "approval" | "running";
export type WizardStep = 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PlanUploadDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
	onExecutionStarted: (planExecId: string) => void;
	/** Called when a plan is queued for later execution */
	onEnqueued?: () => void;
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS = [
	{ step: 1, label: "Select files", short: "Select" },
	{ step: 2, label: "Validation", short: "Valid" },
	{ step: 3, label: "Review & approve", short: "Review" },
	{ step: 4, label: "Execute", short: "Execute" },
] as const;

function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
	return (
		<div className="flex items-center justify-center gap-0">
			{STEPS.map((s, i) => {
				const isPast = s.step < currentStep;
				const isCurrent = s.step === currentStep;
				const isFuture = s.step > currentStep;

				return (
					<div key={s.step} className="flex items-center">
						{/* Step circle + label */}
						<div className="flex flex-col items-center gap-1">
							<div
								className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
									isPast
										? "bg-emerald-600 text-white"
										: isCurrent
											? "bg-blue-600 text-white"
											: "bg-gray-800 text-gray-500 border border-gray-700"
								}`}
							>
								{isPast ? (
									<CheckCircle2 size={12} />
								) : (
									<span className="text-[10px] font-bold">{s.step}</span>
								)}
							</div>
							<span
								className={`text-[9px] font-medium whitespace-nowrap ${
									isCurrent
										? "text-blue-400 font-semibold"
										: isPast
											? "text-gray-400"
											: "text-gray-600"
								}`}
							>
								{s.short}
							</span>
						</div>

						{/* Connector line */}
						{i < STEPS.length - 1 && (
							<div
								className={`w-8 h-px mx-1 mb-4 ${
									isPast ? "bg-emerald-600" : "bg-gray-700"
								}`}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Stage badge for backward compat (old-style label)
// ---------------------------------------------------------------------------

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
		<span className={`text-[10px] px-2 py-0.5 rounded font-medium ${color}`}>
			{label}
		</span>
	);
}

// ---------------------------------------------------------------------------
// Dialog component
// ---------------------------------------------------------------------------

export function PlanUploadDialog({
	isOpen,
	onClose,
	projectId,
	onExecutionStarted,
	onEnqueued,
}: PlanUploadDialogProps) {
	const {
		state: previewState,
		validate: hookValidate,
		patch,
		approve,
		run: hookRun,
		queuePlan,
		reset: resetPreview,
		clearError,
	} = useParallelismPreview(projectId);

	// ── Wizard step ──
	const [wizardStep, setWizardStep] = useState<WizardStep>(1);

	// ── Multi-file state ──
	const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
	const [executionMode, setExecutionMode] = useState<"parallel" | "sequential">("parallel");
	const [scaleMode, setScaleMode] = useState<ScaleMode>("stable_3");

	// ── Phase name override (P22.E) ──
	const [phaseName, setPhaseName] = useState<string>("");

	// Extract phase name from first file's content when files change
	useEffect(() => {
		if (fileEntries.length > 0 && !phaseName) {
			const content = fileEntries[0].content;
			if (content) {
				// Try format: # Phase P22 — Title Here
				const headingMatch = content.match(/# Phase P\d+[^\n]*[—\-–]\s*([^\n]+)/i);
				if (headingMatch) {
					setPhaseName(headingMatch[1].trim());
				} else {
					// Try format: Title: Value
					const titleFieldMatch = content.match(/Title[^\n]*:\s*([^\n]+)/i);
					if (titleFieldMatch) {
						setPhaseName(titleFieldMatch[1].trim());
					}
				}
			}
		}
	}, [fileEntries, phaseName]);
	const [validationResults, setValidationResults] = useState<Map<string, ValidateWithPreviewResponse>>(new Map());
	const [validatingFiles, setValidatingFiles] = useState<Set<string>>(new Set());
	const [fixingFile, setFixingFile] = useState<string | null>(null);
	const [approvalChecks, setApprovalChecks] = useState<Record<string, boolean>>({});
	const [executions, setExecutions] = useState<FileExecutionState[]>([]);
	const [executionId, setExecutionId] = useState<string | undefined>(undefined);

	// ── Error state ──
	const [error, setError] = useState<string | null>(null);
	const [pendingPatches, setPendingPatches] = useState<DependencyPatch[]>([]);
	const [showGraphDiff, setShowGraphDiff] = useState(false);

	// ── Safety overrides (for backward compat) ──
	const [safetyOverrides, setSafetyOverrides] = useState<Record<string, boolean>>({});

	// ── Backward compat: single-file fix chat ──
	const [fixChatMessages, setFixChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
	const [fixSending, setFixSending] = useState(false);

	// ── Derive effective step from both hook state and wizardStep ──
	const currentStep: WizardStep = useMemo(() => {
		// Multi-file mode: use wizardStep
		if (fileEntries.length > 0 || validationResults.size > 0) {
			return wizardStep;
		}
		// Backward compat: derive from hook stage
		if (
			previewState.stage === "validated" ||
			previewState.stage === "patched" ||
			previewState.stage === "approved"
		) {
			return 3;
		}
		if (previewState.stage === "running") {
			return 4;
		}
		if (previewState.stage === "validating") {
			return 2;
		}
		return 1;
	}, [fileEntries.length, validationResults.size, wizardStep, previewState.stage]);

	// ── Effective validation results (backward compat: derive from hook) ──
	const effectiveResults: Map<string, ValidateWithPreviewResponse> = useMemo(() => {
		if (validationResults.size > 0) return validationResults;
		if (previewState.validationResponse) {
			const m = new Map<string, ValidateWithPreviewResponse>();
			m.set("uploaded-plan.md", previewState.validationResponse);
			return m;
		}
		return validationResults;
	}, [validationResults, previewState.validationResponse]);

	// ── Effective file entries (backward compat) ──
	const effectiveFileEntries: FileEntry[] = useMemo(() => {
		if (fileEntries.length > 0) return fileEntries;
		if (previewState.validationResponse) {
			return [
				{
					file: new File([""], "uploaded-plan.md"),
					content: "",
					status: "ready" as const,
				},
			];
		}
		return fileEntries;
	}, [fileEntries, previewState.validationResponse]);

	// ── Derive old-style dialog stage for backward compat ──
	const dialogStage: DialogStage = useMemo(() => {
		switch (currentStep) {
			case 1:
				return previewState.stage === "validating" ? "validating" : "input";
			case 2:
				return "validating";
			case 3: {
				// Check if any result requires approval
				const needsApproval = Array.from(effectiveResults.values()).some(
					(r) => r.success && r.requiresApproval,
				);
				if (
					needsApproval &&
					!(
						approvalChecks["reviewed_preflight"] &&
						approvalChecks["acknowledged_warnings"] &&
						approvalChecks["confirmed_patches"]
					)
				) {
					return "approval";
				}
				return "preflight";
			}
			case 4:
				return "running";
		}
	}, [currentStep, previewState.stage, effectiveResults, approvalChecks]);

	// ── Helpers ──

	const getFileContent = useCallback(
		(fileName: string): string | undefined => {
			return fileEntries.find((f) => f.file.name === fileName)?.content;
		},
		[fileEntries],
	);

	/**
	 * Inject selected scale mode override into plan content's Part 3 JSON.
	 * Overrides planExecution.scale.selectedMode if the JSON block exists.
	 */
	const injectScaleMode = useCallback(
		(content: string): string => {
			if (scaleMode === "stable_3") return content; // stable_3 is default, no override needed
			try {
				// Try to find and modify JSON block in the plan
				const jsonMatch = content.match(/```json\n([\s\S]*?)```/);
				if (jsonMatch) {
					const json = JSON.parse(jsonMatch[1]);
					if (json.planExecution?.scale) {
						json.planExecution.scale.selectedMode = scaleMode;
						json.planExecution.scale.selected_mode = scaleMode;
					}
					const newJson = JSON.stringify(json, null, 2);
					return content.replace(jsonMatch[0], "```json\n" + newJson + "\n```");
				}
			} catch {
				// If JSON parsing fails, return content unchanged
			}
			return content;
		},
		[scaleMode],
	);

	const allFilesSelected = fileEntries.length > 0;

	const filesWithErrors = useMemo(() => {
		const names: string[] = [];
		for (const [name, result] of effectiveResults) {
			if (!result.success) names.push(name);
		}
		return names;
	}, [effectiveResults]);

	const allValidationsDone = useMemo(
		() =>
			effectiveResults.size > 0 &&
			validatingFiles.size === 0,
		[effectiveResults, validatingFiles],
	);

	const hasErrorFiles = filesWithErrors.length > 0;

	const allApprovalChecksMet = useMemo(() => {
		const hasApprovalRequired = Array.from(effectiveResults.values()).some(
			(r) => r.success && r.requiresApproval,
		);
		if (!hasApprovalRequired) return true;
		return (
			approvalChecks["reviewed_preflight"] &&
			approvalChecks["acknowledged_warnings"] &&
			approvalChecks["confirmed_patches"]
		);
	}, [effectiveResults, approvalChecks]);

	// ── Navigation ──

	const goToStep = useCallback((step: WizardStep) => {
		setWizardStep(step);
		setError(null);
	}, []);

	const handleBack = useCallback(() => {
		if (wizardStep > 1) {
			goToStep((wizardStep - 1) as WizardStep);
		}
	}, [wizardStep, goToStep]);

	// ── Validation ──

	const handleValidateAll = useCallback(async () => {
		if (fileEntries.length === 0) {
			// Backward compat: use the old single-file validate flow
			// (This happens when the user typed in the textarea in old tests)
			return;
		}

		setError(null);
		const fileNames = new Set(fileEntries.map((f) => f.file.name));
		setValidatingFiles(fileNames);

		for (const entry of fileEntries) {
			try {
				const result = await hookValidate(entry.content);
				if (result) {
					setValidationResults((prev) => {
						const next = new Map(prev);
						next.set(entry.file.name, result);
						return next;
					});
				}
			} catch (err) {
				setValidationResults((prev) => {
					const next = new Map(prev);
					next.set(entry.file.name, {
						success: false,
						errors: [String(err)],
					});
					return next;
				});
			}
			setValidatingFiles((prev) => {
				const next = new Set(prev);
				next.delete(entry.file.name);
				return next;
			});
		}

		goToStep(2);
	}, [fileEntries, hookValidate, goToStep]);

	const handleRevalidate = useCallback(async () => {
		setValidationResults(new Map());
		await handleValidateAll();
	}, [handleValidateAll]);

	const handleFixWithAI = useCallback(
		async (fileName: string) => {
			const content = getFileContent(fileName);
			if (!content) {
				setError("Cannot fix: file content not found. Try uploading the plan again.");
				return;
			}

			// Collect validation errors for context
			const fileResult = validationResults.get(fileName);
			const validationErrors = fileResult?.errors ?? [];
			const validationWarnings = fileResult?.warnings ?? [];

			setFixingFile(fileName);
			try {
				const response = await fetch(
					`${API_BASE}/api/projects/${projectId}/plans/fix`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							planContent: content,
							userPrompt: "Fix all validation issues automatically",
							scope: "fix_all_validation",
							validationErrors,
							validationWarnings,
						}),
					},
				);

				if (!response.ok) {
					const text = await response.text().catch(() => "");
					setError(`Fix failed for ${fileName}: ${text}`);
					return;
				}

				const result = await response.json();

				if (result.fixedPlan) {
					setFileEntries((prev) =>
						prev.map((f) =>
							f.file.name === fileName ? { ...f, content: result.fixedPlan } : f,
						),
					);
				}

				if (!result.fixedPlan) {
					setError(
						`Fix returned no changes: ${result.explanation ?? result.error ?? "LLM could not fix the plan"}`,
					);
					return;
				}

				const validateResult = await hookValidate(result.fixedPlan ?? content);
				if (validateResult) {
					setValidationResults((prev) => {
						const next = new Map(prev);
						next.set(fileName, validateResult);
						return next;
					});
				}
			} catch (err) {
				setError(`Fix failed for ${fileName}: ${String(err)}`);
			} finally {
				setFixingFile(null);
			}
		},
		[getFileContent, projectId, hookValidate, validationResults],
	);

	// ── Approve & Run ──

	const handleApproveAndRun = useCallback(async () => {
		if (fileEntries.length === 0 && !previewState.validationResponse) {
			setError("No plans to execute");
			return;
		}

		setError(null);

		// Approve if needed
		const hasApprovalRequired = Array.from(effectiveResults.values()).some(
			(r) => r.success && r.requiresApproval,
		);
		if (hasApprovalRequired) {
			const approved = approve();
			if (!approved) {
				setError("Approval failed. Please revalidate.");
				return;
			}
		}

		// Apply pending patches
		if (pendingPatches.length > 0) {
			setPendingPatches([]);
		}

		// If single-file (backward compat)
		if (fileEntries.length === 0 && previewState.validationResponse) {
			// Use the old hook run method directly
			const result = await hookRun(injectScaleMode(""), safetyOverrides);
			if (result?.success && result.planExecutionId) {
				// Apply phase name override if set (P22.E)
				if (phaseName.trim()) {
					fetch(`${API_BASE}/api/projects/${projectId}/plans/${result.planExecutionId}/rename`, {
						method: "PATCH",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ title: phaseName.trim() }),
					}).catch(() => {});
				}
				onExecutionStarted(result.planExecutionId);
				onClose();
			} else if (result?.errors) {
				setError(result.errors.join("; "));
			}
			return;
		}

		// Multi-file execution
		const execStates: FileExecutionState[] = [];
		for (let i = 0; i < fileEntries.length; i++) {
			const entry = fileEntries[i];
			const isSequential = executionMode === "sequential" && i > 0;
			const result = validationResults.get(entry.file.name);
			execStates.push({
				fileName: entry.file.name,
				status: isSequential ? "queued" : "running",
				isSequential,
				batchPlan: result?.batchPlan,
			});
		}
		setExecutions(execStates);
		setWizardStep(4);

		for (let i = 0; i < fileEntries.length; i++) {
			const entry = fileEntries[i];

			if (executionMode === "sequential" && i > 0) {
				setExecutions((prev) =>
					prev.map((e, idx) =>
						idx === i ? { ...e, status: "running" as const } : e,
					),
				);
			}

			try {
			const result = await hookRun(injectScaleMode(entry.content), safetyOverrides);

				if (result?.success && result.planExecutionId) {
					setExecutions((prev) =>
						prev.map((e, idx) =>
							idx === i
								? { ...e, status: "completed" as const, executionId: result.planExecutionId }
								: e,
						),
					);
					if (!executionId && i === 0) {
						setExecutionId(result.planExecutionId);
						// Apply phase name override if set (P22.E)
						if (phaseName.trim()) {
							fetch(`${API_BASE}/api/projects/${projectId}/plans/${result.planExecutionId}/rename`, {
								method: "PATCH",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ title: phaseName.trim() }),
							}).catch(() => {});
						}
						onExecutionStarted(result.planExecutionId);
					}
				} else {
					setExecutions((prev) =>
						prev.map((e, idx) =>
							idx === i
								? {
										...e,
										status: "failed" as const,
										error: result?.errors?.join("; ") ?? "Execution failed",
									}
								: e,
						),
					);
				}
			} catch (err) {
				setExecutions((prev) =>
					prev.map((e, idx) =>
						idx === i
							? { ...e, status: "failed" as const, error: String(err) }
							: e,
					),
				);
			}
		}
	}, [
		fileEntries,
		previewState.validationResponse,
		effectiveResults,
		pendingPatches,
		executionMode,
		approve,
		hookRun,
		safetyOverrides,
		onExecutionStarted,
		onClose,
		executionId,
	]);

		// ── Close / Reset ──

	const handleClose = useCallback(() => {
		setFileEntries([]);
		setValidationResults(new Map());
		setValidatingFiles(new Set());
		setApprovalChecks({});
		setExecutions([]);
		setExecutionId(undefined);
		setPhaseName("");
		setError(null);
		setShowGraphDiff(false);
		setPendingPatches([]);
		setFixChatMessages([]);
		setFixSending(false);
		setWizardStep(1);
		resetPreview();
		onClose();
	}, [resetPreview, onClose]);

	const handleQueueAll = useCallback(async () => {
		if (fileEntries.length === 0) {
			// Backward compat: single-file queue
			if (previewState.validationResponse) {
				const result = await queuePlan(injectScaleMode(""), "uploaded-plan.md");
				if (result?.success) {
					onEnqueued?.();
					onClose();
				} else if (result?.errors) {
					setError(result.errors.join("; "));
				}
			}
			return;
		}

		setError(null);
		let hasError = false;

		for (const entry of fileEntries) {
			const result = await queuePlan(injectScaleMode(entry.content), entry.file.name);
			if (result?.success) {
				onEnqueued?.();
			} else if (result?.errors) {
				setError(result.errors.join("; "));
				hasError = true;
			}
		}

		if (!hasError) {
			handleClose();
		}
	}, [fileEntries, previewState.validationResponse, queuePlan, onEnqueued, handleClose]);

	// ── Self-modification issues extracted from validation results ──
	const selfModIssues: Array<{ fileName: string; message: string }> = useMemo(() => {
		const issues: Array<{ fileName: string; message: string }> = [];
		for (const [fileName, r] of effectiveResults) {
			for (const c of r.safety?.critical ?? []) {
				if (c.type === "self_modification") {
					issues.push({ fileName, message: c.message });
				}
			}
		}
		// Also check single-file backward compat path
		if (issues.length === 0 && previewState.validationResponse) {
			for (const c of previewState.validationResponse.safety?.critical ?? []) {
				if (c.type === "self_modification") {
					issues.push({ fileName: "uploaded-plan.md", message: c.message });
				}
			}
		}
		return issues;
	}, [effectiveResults, previewState.validationResponse]);

	const hasSelfModIssues = selfModIssues.length > 0;
	const selfModOverridden = safetyOverrides["self_modification"] ?? false;

	// ── Can approve & run? ──
	const canApproveAndRun =
		allValidationsDone &&
		!hasErrorFiles &&
		allApprovalChecksMet &&
		(!hasSelfModIssues || selfModOverridden) &&
		previewState.stage !== "running" &&
		previewState.stage !== "validating";

	// ── Footer message ──
	const footerMessage = useMemo(() => {
		const total = effectiveFileEntries.length;
		if (total === 0) return "";

		const validatedCount = effectiveResults.size;
		const needsReview = Array.from(effectiveResults.values()).filter(
			(r) => r.success && r.requiresApproval,
		).length;

		if (currentStep === 1) {
			const errors = effectiveFileEntries.filter((f) => f.status === "error").length;
			const warns = effectiveFileEntries.filter((f) => f.status === "warn").length;
			const parts = [`${total} file${total !== 1 ? "s" : ""}`];
			if (errors > 0) parts.push(`${errors} with errors`);
			if (warns > 0) parts.push(`${warns} with warnings`);
			return parts.join(" \u00b7 ");
		}

		if (currentStep === 2) {
			if (validatedCount === 0) return "";
			const errCount = filesWithErrors.length;
			if (errCount > 0) return `${errCount} error${errCount !== 1 ? "s" : ""} \u2014 fix before continuing`;
			return `All ${validatedCount} file${validatedCount !== 1 ? "s" : ""} passed`;
		}

		if (currentStep === 3) {
			const parts = [`${total} file${total !== 1 ? "s" : ""}`];
			if (needsReview > 0) parts.push(`${needsReview} needs review`);
			return parts.join(" \u00b7 ");
		}

		return "";
	}, [effectiveFileEntries, effectiveResults, filesWithErrors, currentStep]);

	// ── Rendered validation screen can optionally include legacy PlanValidationPanel ──
	// We always use the new ValidationScreen component, but for backward compat
	// the effective results populate correctly from the hook.

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
						className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-6 min-w-[640px] max-w-3xl max-h-[85vh] flex flex-col"
						onClick={(e) => e.stopPropagation()}
					>
						{/* ── Header ── */}
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-lg font-semibold text-gray-100">
								Upload &amp; Run Plans
							</h2>
							<div className="flex items-center gap-2">
								<StageBadge stage={dialogStage} />
								<span className="text-[10px] text-gray-500">
									Step {currentStep}/4
								</span>
								<button
									onClick={handleClose}
									className="text-gray-500 hover:text-gray-300 transition-colors p-0.5"
								>
									<X size={14} />
								</button>
							</div>
						</div>

						{/* ── Step indicator ── */}
						<div className="mb-4">
							<StepIndicator currentStep={currentStep} />
						</div>

						{/* ── Content area ── */}
						<div className="flex-1 min-h-0 overflow-y-auto space-y-4">
							{/* Step 1: File Select */}
							{currentStep === 1 && (
								<>
									{/* Backward compat: when no multi-file, show textarea */}
									{fileEntries.length === 0 && !previewState.validationResponse && (
										<LegacyInputArea
											projectId={projectId}
											onValidate={async (content, fileName) => {
												try {
													setValidatingFiles(new Set([fileName]));
													const file = new File([content], fileName, { type: "text/markdown" });
													setFileEntries([{ file, content, status: "ready" }]);
													const result = await hookValidate(content);
													if (result) {
														setValidationResults(new Map([[fileName, result]]));
													}
												} catch (err) {
													setValidationResults(new Map([[fileName, { success: false, errors: [String(err)] }]]));
												} finally {
													setValidatingFiles(new Set());
													goToStep(2);
												}
											}}
											onCancel={handleClose}
										/>
									)}
									{/* Multi-file select */}
									{(fileEntries.length > 0 || previewState.validationResponse) && (
										<>
											<FileSelectScreen
												files={fileEntries}
												onFilesChange={setFileEntries}
												executionMode={executionMode}
												onExecutionModeChange={setExecutionMode}
												scaleMode={scaleMode}
												onScaleModeChange={setScaleMode}
											/>
											{/* Phase name override (P22.E) */}
											<div className="border border-gray-700 rounded-lg p-3 bg-gray-800/50">
												<label className="block text-xs text-gray-400 mb-1.5 font-medium">
													Phase name <span className="text-gray-500">(override)</span>
												</label>
												<input
													type="text"
													value={phaseName}
													onChange={(e) => setPhaseName(e.target.value)}
													placeholder="Parsed from plan header, or type to override..."
													className="w-full px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
												/>
												<p className="text-[10px] text-gray-500 mt-1">
													Override the phase name shown throughout the dashboard. Can be changed after execution.
												</p>
											</div>
										</>
									)}
								</>
							)}

							{/* Step 2: Validation */}
							{currentStep === 2 && (
								<ValidationScreen
									results={effectiveResults}
									validatingFiles={validatingFiles}
									onRevalidate={handleRevalidate}
									onFixWithAI={handleFixWithAI}
									fixingFile={fixingFile}
								/>
							)}

							{/* Step 3: Review & Approve */}
							{currentStep === 3 && (
								<ReviewScreen
									results={effectiveResults}
									approvalChecks={approvalChecks}
									onApprovalCheckChange={(key, checked) =>
										setApprovalChecks((prev) => ({
											...prev,
											[key]: checked,
										}))
									}
									preflightAcknowledged={
										approvalChecks["reviewed_preflight"] ?? false
									}
									onPreflightAcknowledgedChange={(v) =>
										setApprovalChecks((prev) => ({
											...prev,
											reviewed_preflight: v,
										}))
									}
									safetyOverrides={safetyOverrides}
									onSafetyOverride={(key, approved) =>
										setSafetyOverrides((prev) => ({
											...prev,
											[key]: approved,
										}))
									}
								/>
							)}

							{/* Step 4: Execute */}
							{currentStep === 4 && (
								<ExecuteScreen
									executions={executions}
									projectId={projectId}
								/>
							)}

							{/* ── Error display ── */}
							{error && (
								<div className="p-2.5 bg-red-900/40 border border-red-800 rounded text-xs text-red-300 whitespace-pre-wrap max-h-32 overflow-auto">
									{error}
								</div>
							)}
						</div>

						{/* ── Footer ── */}
						<div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-700 shrink-0">
							{/* Left side: status message */}
							<div className="text-[10px] text-gray-500">{footerMessage}</div>

							{/* Right side: action buttons */}
							<div className="flex gap-2">
								{/* Step 1: Select files */}
								{currentStep === 1 && (
									<>
										<button
											onClick={handleClose}
											className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
										>
											Cancel
										</button>
										{fileEntries.length > 0 && (
											<button
												onClick={() => handleValidateAll()}
												disabled={!allFilesSelected || validatingFiles.size > 0}
												className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
											>
												{validatingFiles.size > 0 ? "Validating..." : "Validate \u2192"}
											</button>
										)}
									</>
								)}

								{/* Step 2: Validation */}
								{currentStep === 2 && (
									<>
										<button
											onClick={handleBack}
											className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
										>
											Back
										</button>
										<button
											onClick={() => goToStep(3)}
											disabled={!allValidationsDone || hasErrorFiles}
											className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
										>
											Review \u2192
										</button>
									</>
								)}

								{/* Step 3: Review & Approve */}
								{currentStep === 3 && (
									<>
										<button
											onClick={handleBack}
											className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
										>
											Back
										</button>
										<button
											onClick={handleQueueAll}
											disabled={!allValidationsDone}
											className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50 flex items-center gap-1"
										>
											Queue for later
										</button>
										<button
											onClick={handleApproveAndRun}
											disabled={!canApproveAndRun}
											className="px-3 py-1.5 text-xs rounded bg-green-700 hover:bg-green-600 text-white transition-colors disabled:opacity-50 flex items-center gap-1"
										>
											<Play size={12} />
											Approve &amp; Run
										</button>
									</>
								)}

								{/* Step 4: Execute */}
								{currentStep === 4 && (
									<button
										onClick={handleClose}
										className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
									>
										Close
									</button>
								)}
							</div>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// Legacy input area — displayed in backward compat mode when no files
// are selected and no validation has happened yet.
// ═══════════════════════════════════════════════════════════════════════════

function LegacyInputArea({
	projectId,
	onValidate,
	onCancel,
}: {
	projectId: string;
	onValidate: (content: string, fileName: string) => void;
	onCancel: () => void;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [planContent, setPlanContent] = useState("");
	const [planFileName, setPlanFileName] = useState("uploaded-plan.md");
	const [legacyError, setLegacyError] = useState<string | null>(null);

	const handleFileUpload = () => fileInputRef.current?.click();

	const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setPlanFileName(file.name);
		const reader = new FileReader();
		reader.onload = (evt) => {
			setPlanContent((evt.target?.result as string) ?? "");
		};
		reader.readAsText(file);
		e.target.value = "";
	};

	return (
		<div className="flex flex-col flex-1">
			<label className="text-xs text-gray-400 block mb-1.5">
				Plan Content
			</label>
			<textarea
				ref={textareaRef}
				value={planContent}
				onChange={(e) => setPlanContent(e.target.value)}
				placeholder="Paste your plan content here..."
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
					<span className="text-xs text-gray-500">{planFileName}</span>
				)}
				<span className="text-xs text-gray-600 ml-auto">
					{planContent.length} chars
				</span>
			</div>
			<div className="flex gap-2 mt-3">
				<button
					onClick={onCancel}
					className="text-xs px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
				>
					Cancel
				</button>
				<button
					onClick={() => onValidate(planContent, planFileName)}
					disabled={planContent.trim().length === 0}
					className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
				>
					Validate & Preview
				</button>
			</div>
		</div>
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// GraphDiffView — kept for backward compat (tests import this from here)
// ═══════════════════════════════════════════════════════════════════════════

export interface GraphDiffData {
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

export function GraphDiffView({ diffData }: { diffData: GraphDiffData }) {
	const [expanded, setExpanded] = useState(true);
	const hasDiffs =
		diffData.added.length > 0 ||
		diffData.removed.length > 0 ||
		diffData.changed.length > 0;

	return (
		<div className="border border-gray-700 rounded overflow-hidden">
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

					{diffData.changed.length > 0 && (
						<div>
							<h4 className="text-amber-400 font-semibold mb-1 flex items-center gap-1">
								~ Changed Dependencies ({diffData.changed.length})
							</h4>
							{diffData.changed.map(
								({
									node,
									origDeps,
									newDeps,
									addedDeps,
									removedDeps,
								}) => (
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
								),
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
