/**
 * ValidationScreen — Step 2 of the plan upload wizard.
 *
 * Shows per-file validation results with summary stat cards,
 * collapsible detail rows, and Fix with AI integration.
 */

import { useMemo, useState } from "react";
import {
	CheckCircle2,
	AlertTriangle,
	AlertCircle,
	ChevronDown,
	ChevronRight,
	Copy,
	Loader2,
	MessageSquare,
	X,
	RefreshCw,
} from "lucide-react";
import type { ValidateWithPreviewResponse } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidationScreenProps {
	/** Map of filename -> validation response */
	results: Map<string, ValidateWithPreviewResponse>;
	/** Currently validating filenames (spinner) */
	validatingFiles: Set<string>;
	/** Callback to re-validate all files */
	onRevalidate: () => void;
	/** Callback to fix a specific file with AI */
	onFixWithAI: (fileName: string) => void;
	/** Is the "Fix with AI" operation in progress for a file? */
	fixingFile: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFileStatus(
	result: ValidateWithPreviewResponse | undefined,
): { status: "passed" | "warning" | "error" | "pending"; label: string; color: string; bg: string } {
	if (!result) {
		return {
			status: "pending",
			label: "Pending",
			color: "text-stone-400 dark:text-stone-500",
			bg: "bg-[#F7F6F3] dark:bg-[#161616]/30 border-[#E8E6E1] dark:border-[#333]",
		};
	}
	if (!result.success) {
		return {
			status: "error",
			label: "Failed",
			color: "text-red-400",
			bg: "bg-red-900/30 border-red-800",
		};
	}

	// Check for non-blocking issues
	const hasWarnings =
		(result.safety?.warnings?.length ?? 0) > 0 ||
		(result.batchPlan?.warnings?.length ?? 0) > 0 ||
		(result.stackValidation && !result.stackValidation.valid);
	const hasCritical =
		(result.safety?.critical?.length ?? 0) > 0 ||
		(result.batchPlan?.errors?.length ?? 0) > 0;

	if (hasCritical) {
		return {
			status: "error",
			label: "Failed",
			color: "text-red-400",
			bg: "bg-red-900/30 border-red-800",
		};
	}
	if (hasWarnings) {
		return {
			status: "warning",
			label: "Review",
			color: "text-amber-400",
			bg: "bg-amber-900/30 border-amber-800",
		};
	}
	return {
		status: "passed",
		label: "Passed",
		color: "text-emerald-400",
		bg: "bg-emerald-900/30 border-emerald-800",
	};
}

function countSummary(results: Map<string, ValidateWithPreviewResponse>) {
	let passed = 0;
	let warnings = 0;
	let errors = 0;
	for (const [, result] of results) {
		const { status } = getFileStatus(result);
		if (status === "passed") passed++;
		else if (status === "warning") warnings++;
		else if (status === "error") errors++;
	}
	const pending = results.size === 0;
	return { passed, warnings, errors, total: results.size, pending };
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
	icon: Icon,
	label,
	value,
	color,
}: {
	icon: React.ElementType;
	label: string;
	value: string | number;
	color: string;
}) {
	return (
		<div className="flex flex-col gap-1 p-3 rounded-lg border border-[#E8E6E1] dark:border-[#333] bg-stone-100 dark:bg-[#2A2A2A]">
			<div className="flex items-center gap-1.5">
				<Icon size={11} className={color} />
				<span className="text-xs text-stone-400 dark:text-stone-500 font-medium uppercase tracking-wider">
					{label}
				</span>
			</div>
			<span className={`text-lg font-semibold ${color}`}>{value}</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Detail Items
// ---------------------------------------------------------------------------

interface DetailItem {
	icon: React.ElementType;
	iconColor: string;
	message: string;
}

function extractDetails(result: ValidateWithPreviewResponse): DetailItem[] {
	const items: DetailItem[] = [];

	// Show top-level errors from failed validation (parse failures, etc.)
	if (!result.success && result.errors && result.errors.length > 0) {
		for (const err of result.errors) {
			items.push({
				icon: AlertCircle,
				iconColor: "text-red-400",
				message: typeof err === "string" ? err : err.message,
			});
		}
	}

	if (result.parseResult) {
		items.push({
			icon: CheckCircle2,
			iconColor: "text-emerald-400",
			message: `Parse: valid — ${result.parseResult.workspaceCount} workspaces, maxParallel ${result.parseResult.maxParallel}`,
		});
	} else {
		items.push({
			icon: AlertCircle,
			iconColor: "text-red-400",
			message: "Parse: failed to parse plan",
		});
	}

	if (result.stackValidation) {
		if (result.stackValidation.valid) {
			items.push({
				icon: CheckCircle2,
				iconColor: "text-emerald-400",
				message: `Stack validation: passed (${result.stackValidation.detectedStack.packageManager})`,
			});
		} else {
			for (const d of result.stackValidation.diagnostics.filter(
				(d) => d.severity === "error",
			)) {
				items.push({
					icon: AlertCircle,
					iconColor: "text-red-400",
					message: d.message,
				});
			}
		}
	}

	if (result.safety) {
		if (result.safety.safe) {
			items.push({
				icon: CheckCircle2,
				iconColor: "text-emerald-400",
				message: "Safety: no critical issues",
			});
		} else {
			for (const c of result.safety.critical) {
				items.push({
					icon: AlertCircle,
					iconColor: "text-red-400",
					message: `${c.type}: ${c.message}`,
				});
			}
			for (const w of result.safety.warnings) {
				items.push({
					icon: AlertTriangle,
					iconColor: "text-amber-400",
					message: `${w.type}: ${w.message}`,
				});
			}
		}
	}

	if (result.batchPlan) {
		if (result.batchPlan.errors.length > 0) {
			for (const e of result.batchPlan.errors) {
				items.push({
					icon: AlertCircle,
					iconColor: "text-red-400",
					message: e.message,
				});
			}
		}
		if (result.batchPlan.isOverSerialized) {
			items.push({
				icon: AlertTriangle,
				iconColor: "text-amber-400",
				message: `Over-serialized: parallelism delta +${result.batchPlan.parallelismDelta}`,
			});
		}
		if (result.batchPlan.warnings.length > 0) {
			for (const w of result.batchPlan.warnings) {
				items.push({
					icon: AlertTriangle,
					iconColor: "text-amber-400",
					message: w.message,
				});
			}
		}
	}

	if (result.requiresApproval) {
		items.push({
			icon: AlertTriangle,
			iconColor: "text-amber-400",
			message: "Requires review approval before execution",
		});
	}

	return items;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ValidationScreen({
	results,
	validatingFiles,
	onRevalidate,
	onFixWithAI,
	fixingFile,
}: ValidationScreenProps) {
	const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
	const summary = countSummary(results);
	const hasErrors = summary.errors > 0;
	const hasWarnings = summary.warnings > 0;

	const toggleExpand = (fileName: string) => {
		setExpandedFiles((prev) => {
			const next = new Set(prev);
			if (next.has(fileName)) {
				next.delete(fileName);
			} else {
				next.add(fileName);
			}
			return next;
		});
	};

	return (
		<div className="flex flex-col gap-4">
			{/* ── Summary stat cards ── */}
			<div className="grid grid-cols-4 gap-2">
				<StatCard
					icon={CheckCircle2}
					label="Passed"
					value={summary.passed}
					color="text-emerald-400"
				/>
				<StatCard
					icon={AlertTriangle}
					label="Warnings"
					value={summary.warnings}
					color="text-amber-400"
				/>
				<StatCard
					icon={AlertCircle}
					label="Errors"
					value={summary.errors}
					color="text-red-400"
				/>
				<StatCard
					icon={CheckCircle2}
					label="Total"
					value={summary.total}
					color="text-stone-700 dark:text-stone-300"
				/>
			</div>

			{/* ── Per-file rows ── */}
			{summary.total === 0 && validatingFiles.size === 0 && (
				<div className="text-center py-8 text-stone-400 dark:text-stone-500 text-xs">
					No validation results yet. Click "Validate" to start.
				</div>
			)}

			{validatingFiles.size > 0 && (
				<div className="flex items-center gap-2 py-3 text-blue-400 text-xs">
					<Loader2 size={12} className="animate-spin" />
					Validating {validatingFiles.size} file{validatingFiles.size !== 1 ? "s" : ""}...
				</div>
			)}

			<div className="space-y-2">
				{Array.from(results.entries()).map(([fileName, result]) => {
					const { status, label, color, bg } = getFileStatus(result);
					const isExpanded = expandedFiles.has(fileName);
					const isValidating = validatingFiles.has(fileName);
					const details = extractDetails(result);
					const hasIssues =
						(result.errors && result.errors.length > 0) ||
						result.safety?.critical?.length ||
						result.safety?.warnings?.length ||
						result.batchPlan?.errors?.length ||
						result.batchPlan?.warnings?.length ||
						(result.stackValidation && !result.stackValidation.valid) ||
						result.requiresApproval;

					return (
						<div
							key={fileName}
							className={`rounded-lg border ${bg} overflow-hidden transition-colors`}
						>
							{/* File header row */}
							<button
								onClick={() => toggleExpand(fileName)}
								className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
							>
								{isExpanded ? (
									<ChevronDown size={12} className="text-stone-400 dark:text-stone-500 shrink-0" />
								) : (
									<ChevronRight size={12} className="text-stone-400 dark:text-stone-500 shrink-0" />
								)}
								<div className="flex-1 min-w-0">
									<p className="text-xs text-stone-800 dark:text-stone-200 truncate font-medium">
										{fileName}
									</p>
									<p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
										{result.parseResult
											? `${result.parseResult.workspaceCount} workspaces, ${result.parseResult.phase}`
											: "Validation details"}
									</p>
								</div>

								{isValidating && (
									<Loader2 size={11} className="animate-spin text-blue-400 shrink-0" />
								)}

								{!isValidating && (
									<span
										className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${color} ${bg}`}
									>
										{status === "passed" && <CheckCircle2 size={9} className="mr-0.5" />}
										{status === "warning" && <AlertTriangle size={9} className="mr-0.5" />}
										{status === "error" && <AlertCircle size={9} className="mr-0.5" />}
										{label}
									</span>
								)}
							</button>

							{/* Expandable details */}
							{isExpanded && details.length > 0 && (
								<div className="px-3 pb-3 pt-0 space-y-1">
									{details.map((item, i) => (
										<div
											key={i}
											className="flex items-start gap-2 py-1 px-2 rounded text-xs text-stone-700 dark:text-stone-300 group"
										>
											<item.icon
												size={10}
												className={`${item.iconColor} shrink-0 mt-0.5`}
											/>
											<span className="flex-1 select-all whitespace-pre-wrap break-all">{item.message}</span>
											<button
												onClick={(e) => {
													e.stopPropagation();
													navigator.clipboard.writeText(item.message);
												}}
												className="opacity-0 group-hover:opacity-100 transition-opacity text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:text-stone-300 shrink-0"
												title="Copy message"
											>
												<Copy size={10} />
											</button>
										</div>
									))}

									{/* Fix with AI button */}
									{hasIssues && !isValidating && (
										<button
											onClick={(e) => {
												e.stopPropagation();
												onFixWithAI(fileName);
											}}
											disabled={fixingFile === fileName}
											className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-amber-900/30 text-amber-300 border border-amber-800 hover:bg-amber-900/50 transition-colors disabled:opacity-50"
										>
											{fixingFile === fileName ? (
												<Loader2 size={9} className="animate-spin" />
											) : (
												<MessageSquare size={9} />
											)}
											{fixingFile === fileName ? "Fixing..." : "Fix with AI"}
										</button>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* ── Footer message ── */}
			{summary.total > 0 && (
				<div className="flex items-center justify-between">
					<span className="text-xs text-stone-400 dark:text-stone-500">
						{hasErrors
							? `${summary.errors} error${summary.errors !== 1 ? "s" : ""} — fix before continuing`
							: hasWarnings
								? `${summary.warnings} warning${summary.warnings !== 1 ? "s" : ""} — safe to continue`
								: "All plans passed validation"}
					</span>
					<button
						onClick={onRevalidate}
						disabled={validatingFiles.size > 0}
						className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
					>
						<RefreshCw
							size={10}
							className={validatingFiles.size > 0 ? "animate-spin" : ""}
						/>
						{validatingFiles.size > 0 ? "Validating..." : "Re-validate"}
					</button>
				</div>
			)}
		</div>
	);
}
