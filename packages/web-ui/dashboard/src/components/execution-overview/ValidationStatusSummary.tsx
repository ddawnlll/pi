/**
 * ValidationStatusSummary — Compact validation status summary card (P42.04).
 *
 * Shows plan and workspace validation status. Uses real data from
 * getFinalValidationStatus() or explicit unavailable state.
 */

import { AlertTriangle, CheckCircle2, FileCheck, Loader2, XCircle, HelpCircle } from "lucide-react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";

// ─── Style tokens ──────────────────────────────────────────────────────────

const TXT_MUTED = "text-stone-400 dark:text-stone-500";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ValidationStatusData {
	/** Whether validation is required */
	required: boolean;
	/** Whether validation has passed (null = not yet run) */
	passed: boolean | null;
	/** Whether execution is blocked by validation */
	blocked: boolean;
	/** Reasons why validation is blocked */
	blockReasons: string[];
	/** Individual validation results */
	validations?: Array<{
		name: string;
		status: "passed" | "failed" | "pending" | "skipped";
		message?: string;
	}>;
}

export interface ValidationStatusSummaryProps {
	/** Validation status from getFinalValidationStatus() */
	status?: ValidationStatusData;
	/** Loading state */
	loading?: boolean;
	/** Error state */
	error?: string;
	/** Callback to rerun validation */
	onRerunValidation?: () => void;
	/** Additional class name */
	className?: string;
	/** Whether the data is unavailable (no read model) */
	unavailable?: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function statusIcon(status: ValidationStatusData) {
	if (status.blocked) return <XCircle size={14} className="text-red-500 shrink-0" />;
	if (status.passed === true) return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
	if (status.passed === null && !status.blocked) return <HelpCircle size={14} className="text-amber-500 shrink-0" />;
	if (status.passed === false) return <XCircle size={14} className="text-red-500 shrink-0" />;
	return <HelpCircle size={14} className={TXT_MUTED} />;
}

function statusLabel(status: ValidationStatusData): string {
	if (!status.required) return "Validation not required";
	if (status.blocked) return "Validation blocked";
	if (status.passed === true) return "Validation passed";
	if (status.passed === null) return "Validation pending";
	if (status.passed === false) return "Validation failed";
	return "Unknown";
}

function statusColor(status: ValidationStatusData): string {
	if (status.blocked) return "text-red-600 dark:text-red-400";
	if (status.passed === true) return "text-emerald-600 dark:text-emerald-400";
	if (status.passed === null) return "text-amber-600 dark:text-amber-400";
	if (status.passed === false) return "text-red-600 dark:text-red-400";
	return TXT_MUTED;
}

interface ValidationItem {
	name: string;
	status: "passed" | "failed" | "pending" | "skipped";
	message?: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ValidationStatusSummary({
	status,
	loading = false,
	error,
	onRerunValidation,
	className = "",
	unavailable = false,
}: ValidationStatusSummaryProps) {
	if (loading) {
		return (
			<div
				className={`rounded-lg border ${BORD} ${SURF} p-4 ${className}`}
				role="status"
				aria-label="Loading validation status"
			>
				<div className="space-y-2">
					<div className="h-4 w-28 bg-stone-100 dark:bg-stone-800 rounded animate-pulse" />
					<div className="h-3 w-full bg-stone-100 dark:bg-stone-800 rounded animate-pulse" />
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div
				className={`rounded-lg border border-red-200 dark:border-red-900 p-3 flex items-center gap-2 ${className}`}
				role="alert"
			>
				<XCircle size={14} className="text-red-500 shrink-0" />
				<p className="text-xs text-red-600 dark:text-red-400">{error}</p>
			</div>
		);
	}

	if (unavailable) {
		return (
			<div
				className={`rounded-lg border ${BORD} ${SURF} p-3 flex items-center gap-2 ${className}`}
				role="status"
			>
				<HelpCircle size={14} className={TXT_MUTED} />
				<p className={`text-xs ${TXT_MUTED} italic`}>Validation status unavailable</p>
			</div>
		);
	}

	if (!status) {
		return null;
	}

	const validations = status.validations ?? [];

	return (
		<div
			className={`rounded-lg border ${BORD} ${SURF} overflow-hidden ${className}`}
			role="region"
			aria-label="Validation status"
		>
			{/* Header */}
			<div className={`flex items-center gap-1.5 px-3 py-1.5 border-b ${BORD}`}>
				<FileCheck size={11} className={`shrink-0 ${statusColor(status)}`} />
				<span className={`text-xs font-semibold uppercase tracking-wider ${statusColor(status)}`}>
					{statusLabel(status)}
				</span>
			</div>

			{/* Content */}
			<div className="p-3">
				<div className="flex items-start gap-2.5">
					{statusIcon(status)}
					<div className="flex-1 min-w-0">
						{!status.required && (
							<p className={`text-xs ${TXT_MUTED}`}>Validation is not required for this plan.</p>
						)}

						{status.blocked && (
							<div>
								<p className={`text-xs text-red-600 dark:text-red-400`}>Blocked by:</p>
								<ul className="mt-1 space-y-0.5">
									{status.blockReasons.map((reason, i) => (
										<li key={i} className="text-xs text-red-500 flex items-start gap-1">
											<span className="mt-0.5">•</span>
											<span>{reason}</span>
										</li>
									))}
								</ul>
							</div>
						)}

						{status.passed === true && (
							<p className={`text-xs text-emerald-600 dark:text-emerald-400`}>
								All validations passed.
							</p>
						)}

						{status.passed === null && !status.blocked && (
							<p className={`text-xs ${TXT_MUTED}`}>
								Validation has not yet run for this execution.
							</p>
						)}

						{status.passed === false && (
							<p className={`text-xs text-red-600 dark:text-red-400`}>
								Validation failed. Review issues below.
							</p>
						)}

						{/* Individual validation items */}
						{validations.length > 0 && (
							<div className="mt-2 space-y-1">
								{validations.map((v, i) => {
									const DotIcon = v.status === "passed" ? CheckCircle2
										: v.status === "failed" ? XCircle
											: v.status === "pending" ? Loader2
												: HelpCircle;
									const dotColor = v.status === "passed" ? "text-emerald-500"
										: v.status === "failed" ? "text-red-500"
											: v.status === "pending" ? "text-blue-500"
												: TXT_MUTED;
									return (
										<div key={i} className="flex items-start gap-1.5">
											<DotIcon size={10} className={`shrink-0 mt-0.5 ${dotColor} ${v.status === "pending" ? "animate-spin" : ""}`} />
											<div>
												<span className={`text-xs font-medium ${TXT}`}>{v.name}</span>
												{v.message && (
													<p className={`text-xs ${TXT_MUTED}`}>{v.message}</p>
												)}
											</div>
										</div>
									);
								})}
							</div>
						)}

						{/* Rerun action */}
						{onRerunValidation && (status.passed === false || status.passed === null) && (
							<button
								onClick={onRerunValidation}
								className="inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
							>
								<FileCheck size={10} />
								Rerun validation
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
