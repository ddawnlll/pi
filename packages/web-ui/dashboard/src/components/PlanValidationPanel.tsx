/**
 * PlanValidationPanel — Visualizes every validation step of a plan upload.
 *
 * Shows the full validation pipeline:
 * 1. Plan Parsing — parse success, workspace count
 * 2. Project Stack Validation — package manager check, targetCommand compatibility
 * 3. Safety Doctor — safety rules, forbidden commands, capability checks
 * 4. Checker Agent Analysis (NEW) — LLM-based feasibility, risk, completeness analysis
 * 5. DAG Analysis — dependency graph, batch plan, parallelism
 * 6. Optimization Proposals — suggested improvements
 *
 * Each step shows: status (pass/warn/fail/pending/running), checklist items, details.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
	AlertCircle,
	AlertTriangle,
	Brain,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	ClipboardCopy,
	Clock,
	Hammer,
	Loader2,
	MessageSquare,
	ScrollText,
	Search,
	ShieldCheck,
	XCircle,
} from "lucide-react";
import { useCallback, useMemo, useState, type FC } from "react";
import type {
	BatchPlanResult,
	PlanStackValidation,
	SuggestedFix,
} from "../types";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const ACCENT = "text-stone-600 dark:text-stone-400";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationStep {
	id: string;
	label: string;
	icon: typeof ScrollText;
	status: "pending" | "running" | "pass" | "warn" | "fail";
	summary: string;
	details?: ValidationDetail[];
}

export interface ValidationDetail {
	label: string;
	status: "pass" | "warn" | "fail" | "info";
	message: string;
	suggestion?: string;
}

/** Checker agent analysis state from the parent hook. */
export interface CheckerAnalysisState {
	status: "idle" | "running" | "complete" | "failed";
	result?: {
		verdict: "safe" | "risky" | "blocked";
		summary: string;
		findings: Array<{
			severity: "critical" | "warning" | "info";
			category: string;
			title: string;
			description: string;
			suggestion?: string;
			workspaceIds?: string[];
		}>;
		narrative: string;
	};
	error?: string;
}

export interface PlanValidationData {
	steps: ValidationStep[];
	stackValidation?: PlanStackValidation;
	batchPlan?: BatchPlanResult;
	safetyReport?: {
		safe: boolean;
		critical: Array<{ type: string; message: string }>;
		warnings: Array<{ type: string; message: string }>;
	};
	suggestedFixes?: SuggestedFix[];
	checkerAnalysis?: CheckerAnalysisState;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: ValidationStep["status"] | ValidationDetail["status"] }) {
	switch (status) {
		case "pass":
			return <CheckCircle2 size={14} className="text-green-500 shrink-0" />;
		case "warn":
			return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
		case "fail":
			return <XCircle size={14} className="text-red-500 shrink-0" />;
		case "running":
			return <Loader2 size={14} className="animate-spin text-blue-500 shrink-0" />;
		case "pending":
			return <Clock size={14} className={MUT + " shrink-0"} />;
		case "info":
			return <AlertCircle size={14} className="text-blue-500 shrink-0" />;
	}
}

// ---------------------------------------------------------------------------
// Build validation data from API response
// ---------------------------------------------------------------------------

export function buildValidationData(
	parseResult?: { title: string; phase: string; workspaceCount: number },
	stackValidation?: PlanStackValidation,
	safety?: { safe: boolean; critical: Array<{ type: string; message: string }>; warnings: Array<{ type: string; message: string }> },
	batchPlan?: BatchPlanResult,
	suggestedFixes?: SuggestedFix[],
	checkerAnalysis?: CheckerAnalysisState,
): PlanValidationData {
	const steps: ValidationStep[] = [];

	// 1. Plan Parsing
	const parseStep: ValidationStep = {
		id: "parsing",
		label: "Plan Parsing",
		icon: ScrollText,
		status: parseResult ? "pass" : "fail",
		summary: parseResult
			? `Parsed "${parseResult.title}" (${parseResult.workspaceCount} workspaces, ${parseResult.phase})`
			: "Failed to parse plan",
		details: [],
	};
	steps.push(parseStep);

	// 2. Project Stack Validation
	const stackHasErrors = stackValidation && !stackValidation.valid;
	const stackHasWarnings = stackValidation?.diagnostics.some((d) => d.severity === "warning");
	const stackStep: ValidationStep = {
		id: "stack",
		label: "Project Stack Validation",
		icon: Search,
		status: stackValidation
			? stackHasErrors
				? "fail"
				: stackHasWarnings
					? "warn"
					: "pass"
			: "pending",
		summary: stackValidation
			? stackValidation.valid
				? `Package manager: ${stackValidation.detectedStack.packageManager} — all commands compatible`
				: `${stackValidation.diagnostics.filter((d) => d.severity === "error").length} command(s) incompatible with ${stackValidation.detectedStack.packageManager}`
			: "No stack validation data",
		details: stackValidation
			? [
					{
						label: "Package Manager",
						status: "info",
						message: `Detected: ${stackValidation.detectedStack.packageManager}`,
					},
					...(stackValidation.detectedStack.testRunner
						? [{
								label: "Test Runner",
								status: "info" as const,
								message: `Detected: ${stackValidation.detectedStack.testRunner}`,
							}]
						: []),
					...(stackValidation.detectedStack.buildTool
						? [{
								label: "Build Tool",
								status: "info" as const,
								message: `Detected: ${stackValidation.detectedStack.buildTool}`,
							}]
						: []),
					...Object.entries(stackValidation.workspaceResults)
						.filter(([_, r]) => !r.valid)
						.map(([wsId, r]) => ({
							label: `Workspace ${wsId}`,
							status: "fail" as const,
							message: r.message || "Command incompatible",
							suggestion: r.suggestion,
						})),
					...stackValidation.diagnostics
						.filter((d) => d.severity === "warning")
						.map((d) => ({
							label: "Warning",
							status: "warn" as const,
							message: d.message,
						})),
				]
			: undefined,
	};
	steps.push(stackStep);

	// 3. Safety Doctor
	const safetyHasCritical = safety && safety.critical.length > 0;
	const safetyHasWarnings = safety && safety.warnings.length > 0;
	const safetyStep: ValidationStep = {
		id: "safety",
		label: "Safety Doctor",
		icon: ShieldCheck,
		status: !safety
			? "pending"
			: safetyHasCritical
				? "fail"
				: safetyHasWarnings
					? "warn"
					: "pass",
		summary: safety
			? safety.safe
				? "All safety checks passed"
				: `${safety.critical.length} critical, ${safety.warnings.length} warnings`
			: "No safety data",
		details: safety
			? [
					...safety.critical.map((c) => ({
						label: c.type,
						status: "fail" as const,
						message: c.message,
					})),
					...safety.warnings.map((w) => ({
						label: w.type,
						status: "warn" as const,
						message: w.message,
					})),
				]
			: undefined,
	};
	steps.push(safetyStep);

	// 4. Checker Agent Analysis
	const checkerStep: ValidationStep = {
		id: "checker",
		label: "Checker Agent Analysis",
		icon: Brain,
		status: !checkerAnalysis
			? "pending"
			: checkerAnalysis.status === "running"
				? "running"
				: checkerAnalysis.status === "failed"
					? "fail"
					: checkerAnalysis.result?.verdict === "blocked"
						? "fail"
						: checkerAnalysis.result?.verdict === "risky"
							? "warn"
							: "pass",
		summary: !checkerAnalysis
			? "Waiting for analysis..."
			: checkerAnalysis.status === "running"
				? "LLM is analyzing plan feasibility..."
				: checkerAnalysis.status === "failed"
					? `Analysis failed: ${checkerAnalysis.error || "Unknown error"}`
					: `${checkerAnalysis.result!.findings.length} finding(s) — ${checkerAnalysis.result!.verdict}`,
		details: checkerAnalysis?.result
			? [
					{
						label: "Verdict",
						status: checkerAnalysis.result.verdict === "safe"
							? "pass" as const
							: checkerAnalysis.result.verdict === "risky"
								? "warn" as const
								: "fail" as const,
						message: `Feasibility: ${checkerAnalysis.result.verdict}`,
					},
					{
						label: "Summary",
						status: "info" as const,
						message: checkerAnalysis.result.summary,
					},
					...checkerAnalysis.result.findings.map((f) => ({
						label: `[${f.category}] ${f.title}`,
						status: f.severity === "critical"
							? "fail" as const
							: f.severity === "warning"
								? "warn" as const
								: "info" as const,
						message: f.description,
						suggestion: f.suggestion,
					})),
					{
						label: "Narrative",
						status: "info" as const,
						message: checkerAnalysis.result.narrative.slice(0, 500) + (checkerAnalysis.result.narrative.length > 500 ? "..." : ""),
					},
				]
			: checkerAnalysis?.status === "running"
				? [{ label: "Running", status: "running" as const, message: "Analyzing plan with LLM..." }]
				: undefined,
	};
	steps.push(checkerStep);

	// 5. DAG Analysis
	const dagHasErrors = batchPlan && batchPlan.errors.length > 0;
	const dagHasWarnings = batchPlan && batchPlan.warnings.length > 0;
	const dagStep: ValidationStep = {
		id: "dag",
		label: "DAG Analysis",
		icon: GitBranch,
		status: !batchPlan
			? "pending"
			: dagHasErrors
				? "fail"
				: dagHasWarnings
					? "warn"
					: "pass",
		summary: batchPlan
			? `${batchPlan.totalBatches} batches, ${batchPlan.effectiveParallelism}/${batchPlan.requestedParallelism} parallelism${batchPlan.isOverSerialized ? ", over-serialized" : ""}`
			: "No DAG data",
		details: batchPlan
			? [
					{
						label: "Batches",
						status: "info" as const,
						message: `${batchPlan.totalBatches} total`,
					},
					{
						label: "Parallelism",
						status: batchPlan.isOverSerialized ? "warn" as const : "pass" as const,
						message: `${batchPlan.effectiveParallelism} effective / ${batchPlan.requestedParallelism} requested`,
					},
					...batchPlan.errors.map((e) => ({
						label: "Error",
						status: "fail" as const,
						message: e.message,
					})),
					...batchPlan.warnings.map((w) => ({
						label: "Warning",
						status: "warn" as const,
						message: w.message,
					})),
				]
			: undefined,
	};
	steps.push(dagStep);

	// 6. Optimization Proposals
	const hasProposals = suggestedFixes && suggestedFixes.length > 0;
	const optStep: ValidationStep = {
		id: "optimization",
		label: "Optimization Proposals",
		icon: Hammer,
		status: hasProposals ? "warn" : "pass",
		summary: hasProposals
			? `${suggestedFixes!.length} optimization(s) available`
			: "No optimizations needed",
		details: suggestedFixes?.map((f) => ({
			label: `[${f.category}]`,
			status: "info" as const,
			message: f.description,
			suggestion: f.workspaceIds?.join(", "),
		})),
	};
	steps.push(optStep);

	return { steps, stackValidation, batchPlan, safetyReport: safety, suggestedFixes, checkerAnalysis };
}

// ---------------------------------------------------------------------------
// Placeholder icon
// ---------------------------------------------------------------------------

function GitBranch({ size, className }: { size: number; className?: string }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
			<line x1="6" y1="3" x2="6" y2="15" />
			<circle cx="18" cy="6" r="3" />
			<circle cx="6" cy="18" r="3" />
			<path d="M18 9a9 9 0 0 1-9 9" />
		</svg>
	);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PlanValidationPanelProps {
	data: PlanValidationData;
	className?: string;
	compact?: boolean;
	/** Callback when user sends a fix prompt from the inline chat */
	onFixPlan?: (prompt: string) => void;
	/** Callback to auto-fix all detected issues in one shot */
	onFixAll?: () => void;
	/** Chat state for the inline fix widget */
	chatState?: {
		sending: boolean;
		messages: Array<{ role: "user" | "assistant"; content: string }>;
	};
	/** Safety override: key is the safety finding type (e.g. "self_modification"), value is whether approved */
	safetyOverrides?: Record<string, boolean>;
	/** Called when user toggles a safety override */
	onSafetyOverride?: (safetyKey: string, approved: boolean) => void;
}

export const PlanValidationPanel: FC<PlanValidationPanelProps> = ({
	data,
	className = "",
	compact = false,
	onFixPlan,
	onFixAll,
	chatState,
	safetyOverrides,
	onSafetyOverride,
}) => {
	const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
	const [activeStep, setActiveStep] = useState<string | null>(null);
	const [chatInput, setChatInput] = useState("");
	const [chatExpanded, setChatExpanded] = useState(false);
	const [copied, setCopied] = useState(false);

	const toggleStep = (stepId: string) => {
		setExpandedSteps((prev) => {
			const next = new Set(prev);
			if (next.has(stepId)) {
				next.delete(stepId);
			} else {
				next.add(stepId);
			}
			return next;
		});
	};

	const toggleDetail = (stepId: string) => {
		setActiveStep((prev) => (prev === stepId ? null : stepId));
		setExpandedSteps((prev) => {
			const next = new Set(prev);
			next.add(stepId);
			return next;
		});
	};

	// Calculate overall status
	const overallStatus = useMemo(() => {
		const failed = data.steps.some((s) => s.status === "fail");
		const warned = data.steps.some((s) => s.status === "warn");
		const pending = data.steps.some((s) => s.status === "pending" || s.status === "running");
		if (failed) return { label: "Validation Failed", color: "text-red-500", icon: XCircle };
		if (pending) return { label: "Validating...", color: "text-blue-500", icon: Loader2 };
		if (warned) return { label: "Passed with Warnings", color: "text-amber-500", icon: AlertTriangle };
		return { label: "All Checks Passed", color: "text-green-500", icon: CheckCircle2 };
	}, [data.steps]);

	const OverallIcon = overallStatus.icon;

	const copyAsJson = useCallback(() => {
		const json = JSON.stringify(data, null, 2);
		navigator.clipboard.writeText(json).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}, [data]);

	return (
		<div className={`${SURF} rounded-lg border ${BORD} ${className}`}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b ${BORD}">
				<div className="flex items-center gap-2">
					<ShieldCheck size={16} className={ACCENT} />
					<h3 className={`text-xs font-semibold ${TXT}`}>Plan Validation</h3>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={copyAsJson}
						title="Copy validation as JSON"
						className={`p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors ${copied ? "text-green-500" : ACCENT}`}
					>
						<ClipboardCopy size={12} />
					</button>
					<OverallIcon size={14} className={overallStatus.color} />
					<span className={`text-[10px] font-medium ${overallStatus.color}`}>
						{overallStatus.label}
					</span>
				</div>
			</div>

			{/* Steps */}
			<div className={`divide-y ${BORD}`}>
				{data.steps.map((step) => {
					const isExpanded = expandedSteps.has(step.id);
					const isActive = activeStep === step.id;
					const StepIcon = step.icon;

					return (
						<div key={step.id}>
							{/* Step header */}
							<button
								onClick={() => {
									toggleStep(step.id);
									toggleDetail(step.id);
								}}
								className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-[#252525] transition-colors ${
									isActive ? "bg-stone-50 dark:bg-[#252525]" : ""
								}`}
							>
								<div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
									step.status === "pass" ? "bg-green-50 dark:bg-green-900/20" :
									step.status === "warn" ? "bg-amber-50 dark:bg-amber-900/20" :
									step.status === "fail" ? "bg-red-50 dark:bg-red-900/20" :
									step.status === "running" ? "bg-blue-50 dark:bg-blue-900/20" :
									"bg-stone-50 dark:bg-stone-800"
								}`}>
									{step.status === "running" ? (
										<Loader2 size={12} className="animate-spin text-blue-500" />
									) : (
										<StepIcon size={12} className={
											step.status === "pass" ? "text-green-500" :
											step.status === "warn" ? "text-amber-500" :
											step.status === "fail" ? "text-red-500" :
											MUT
										} />
									)}
								</div>
								<div className="flex-1 min-w-0">
									<div className={`text-xs font-medium ${TXT}`}>{step.label}</div>
									{!compact && (
										<p className={`text-[10px] ${MUT} truncate mt-0.5`}>
											{step.summary}
										</p>
									)}
								</div>
								<StatusIcon status={step.status} />
								{step.details && step.details.length > 0 && (
									<ChevronDown
										size={12}
										className={`${MUT} transition-transform ${isExpanded ? "" : "-rotate-90"}`}
									/>
								)}
							</button>

							{/* Step details (expandable) */}
							<AnimatePresence initial={false}>
								{isExpanded && step.details && step.details.length > 0 && (
									<motion.div
										initial={{ height: 0, opacity: 0 }}
										animate={{ height: "auto", opacity: 1 }}
										exit={{ height: 0, opacity: 0 }}
										transition={{ duration: 0.15 }}
										className="overflow-hidden"
									>
										<div className="px-4 pb-2 space-y-1">
											{step.details.map((detail, i) => (
												<div
													key={i}
													className={`flex items-start gap-2 py-1.5 px-2 rounded ${
														detail.status === "fail" ? "bg-red-50 dark:bg-red-900/10" :
														detail.status === "warn" ? "bg-amber-50 dark:bg-amber-900/10" :
														""
													}`}
												>
													<StatusIcon status={detail.status} />
													<div className="flex-1 min-w-0">
														<div className={`text-[10px] font-medium ${TXT}`}>
															{detail.label}
														</div>
														<p className={`text-[10px] ${MUT}`}>{detail.message}</p>
														{detail.suggestion && (
															<p className={`text-[10px] text-blue-500 mt-0.5`}>
																Suggest: {detail.suggestion}
															</p>
														)}
														{/* Safety override toggle for critical items */}
														{step.id === "safety" && detail.status === "fail" && onSafetyOverride && (
															<label className="flex items-center gap-1.5 mt-1 cursor-pointer">
																<input
																	type="checkbox"
																	checked={safetyOverrides?.[detail.label] ?? false}
																	onChange={(e) => onSafetyOverride(detail.label, e.target.checked)}
																	className="w-3 h-3 rounded border-stone-400"
																/>
																<span className="text-[9px] text-amber-500 font-medium">
																	Override: approve anyway
																</span>
															</label>
														)}
													</div>
												</div>
											))}
										</div>
									</motion.div>
								)}
							</AnimatePresence>
						</div>
					);
				})}
			</div>

			{/* Footer: checker agent summary (always visible) */}
			<div className={`px-4 py-2.5 border-t ${BORD}`}>
				<div className="flex items-start justify-between gap-2">
					<div className="flex items-start gap-2 min-w-0">
						<Search size={12} className={`${MUT} mt-0.5 shrink-0`} />
						<div>
							<p className={`text-[10px] font-medium ${TXT}`}>Checker Agent Report</p>
							<p className={`text-[10px] ${MUT} mt-0.5`}>
								{overallStatus.label === "All Checks Passed"
									? "Plan is safe to execute. All validation gates passed."
									: overallStatus.label === "Passed with Warnings"
										? "Plan can execute but review warnings before proceeding. Non-blocking issues detected."
										: overallStatus.label === "Validation Failed"
											? "Plan blocked: resolve all failing checks before execution. See details above."
											: "Validation in progress..."}
							</p>
						</div>
					</div>
					{/* Fix All button — visible when there are failures or warnings */}
					{onFixAll && !chatState?.sending && (
						<button
							onClick={onFixAll}
							className="shrink-0 px-2.5 py-1 rounded text-[9px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
						>
							{chatState?.sending ? "Fixing..." : "Fix All"}
						</button>
					)}
				</div>
			</div>

			{/* ── Inline Fix Chat ── */}
			{onFixPlan && !compact && (
				<>
					<button
						onClick={() => setChatExpanded(!chatExpanded)}
						className={`w-full flex items-center gap-2 px-4 py-2.5 border-t ${BORD} text-left text-[10px] font-medium ${TXT} hover:bg-stone-50 dark:hover:bg-[#252525] transition-colors`}
					>
						<MessageSquare size={12} className={MUT} />
						<span>Fix Plan with AI</span>
						<ChevronDown size={12} className={`${MUT} transition-transform ml-auto ${chatExpanded ? "" : "-rotate-90"}`} />
					</button>
					<AnimatePresence initial={false}>
						{chatExpanded && (
							<motion.div
								initial={{ height: 0, opacity: 0 }}
								animate={{ height: "auto", opacity: 1 }}
								exit={{ height: 0, opacity: 0 }}
								transition={{ duration: 0.15 }}
								className="overflow-hidden"
							>
								<div className="px-4 py-3 space-y-2">
									{/* Chat messages */}
									{chatState?.messages?.map((msg, i) => (
										<div
											key={i}
											className={`p-2 rounded text-[10px] ${
												msg.role === "user"
													? "bg-blue-50 dark:bg-blue-900/20 ml-4"
													: "bg-stone-50 dark:bg-stone-800 mr-4"
											}`}
										>
											<p className={`${TXT}`}>{msg.content}</p>
										</div>
									))}
									{chatState?.sending && (
										<div className="flex items-center gap-2 text-[10px] text-blue-500">
											<Loader2 size={10} className="animate-spin" />
											<span>Analyzing and fixing plan...</span>
										</div>
									)}

									{/* Input */}
									<form
										onSubmit={(e) => {
											e.preventDefault();
											if (!chatInput.trim() || chatState?.sending) return;
											onFixPlan?.(chatInput);
											setChatInput("");
										}}
										className="flex gap-2"
									>
										<input
											type="text"
											value={chatInput}
											onChange={(e) => setChatInput(e.target.value)}
											placeholder="Ask AI to fix a specific issue..."
											className={`flex-1 px-2.5 py-1.5 text-[10px] rounded border ${BORD} ${SURF} ${TXT} placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400`}
											disabled={chatState?.sending}
										/>
										<button
											type="submit"
											disabled={!chatInput.trim() || chatState?.sending}
											className="px-3 py-1.5 rounded text-[10px] font-medium bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-40 transition-colors"
										>
											Send
										</button>
									</form>
								</div>
							</motion.div>
						)}
					</AnimatePresence>
				</>
			)}
		</div>
	);
};
