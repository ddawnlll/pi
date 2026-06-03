/**
 * LatestEscalationSummary — Compact escalation summary card (P42.04).
 *
 * Shows the most recent escalation requiring user attention.
 * Hides when no escalations are active.
 */

import { AlertTriangle, ArrowRight, MessageSquare, UserCheck } from "lucide-react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";

// ─── Style tokens ──────────────────────────────────────────────────────────

const TXT_MUTED = "text-stone-400 dark:text-stone-500";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EscalationSummaryData {
	/** Escalation ID */
	id: string;
	/** Escalation reason */
	reason: string;
	/** Workspace ID this escalation belongs to */
	workspaceId: string;
	/** Severity level */
	severity: "critical" | "high" | "medium" | "low";
	/** Available resolution options */
	options: Array<{
		id: string;
		label: string;
		description?: string;
	}>;
	/** When the escalation was issued */
	issuedAt: number;
}

export interface LatestEscalationSummaryProps {
	/** Latest escalation, or undefined if none */
	escalation?: EscalationSummaryData;
	/** Loading state */
	loading?: boolean;
	/** Whether there are no escalations */
	noEscalations?: boolean;
	/** Callback to resolve escalation with an option */
	onResolve?: (escalationId: string, optionId: string) => void;
	/** Callback to navigate to escalation center */
	onViewAll?: () => void;
	/** Additional class name */
	className?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function severityColor(severity: EscalationSummaryData["severity"]): string {
	switch (severity) {
		case "critical": return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900";
		case "high": return "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-900";
		case "medium": return "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900";
		case "low": return "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900";
	}
}

function severityLabel(severity: EscalationSummaryData["severity"]): string {
	return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function relativeTime(ts: number): string {
	const diff = Date.now() - ts;
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function LatestEscalationSummary({
	escalation,
	loading = false,
	noEscalations = false,
	onResolve,
	onViewAll,
	className = "",
}: LatestEscalationSummaryProps) {
	if (loading) {
		return (
			<div
				className={`rounded-lg border ${BORD} ${SURF} p-4 ${className}`}
				role="status"
				aria-label="Loading escalations"
			>
				<div className="space-y-2">
					<div className="h-4 w-36 bg-stone-100 dark:bg-stone-800 rounded animate-pulse" />
					<div className="h-3 w-full bg-stone-100 dark:bg-stone-800 rounded animate-pulse" />
				</div>
			</div>
		);
	}

	if (noEscalations) {
		return (
			<div
				className={`rounded-lg border ${BORD} ${SURF} p-3 flex items-center gap-2 ${className}`}
				role="status"
			>
				<UserCheck size={14} className="text-emerald-500 shrink-0" />
				<p className={`text-xs ${TXT_MUTED}`}>No active escalations</p>
			</div>
		);
	}

	if (!escalation) {
		return null;
	}

	return (
		<div
			className={`rounded-lg border overflow-hidden ${severityColor(escalation.severity)} ${className}`}
			role="region"
			aria-label={`Escalation: ${escalation.reason}`}
		>
			{/* Header */}
			<div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-inherit">
				<AlertTriangle size={11} className="shrink-0" />
				<span className={`text-xs font-semibold uppercase tracking-wider`}>
					{severityLabel(escalation.severity)} Escalation
				</span>
			</div>

			{/* Content */}
			<div className="p-3">
				<div className="flex items-start gap-2.5">
					<MessageSquare size={14} className="shrink-0 mt-0.5" />
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span className={`text-xs font-mono ${TXT_MUTED}`}>
								{escalation.workspaceId.length > 12
									? `${escalation.workspaceId.slice(0, 8)}..`
									: escalation.workspaceId}
							</span>
							<span className={`text-xs ${TXT_MUTED}`}>
								{relativeTime(escalation.issuedAt)}
							</span>
						</div>
						<p className={`text-xs ${TXT} mt-0.5`}>{escalation.reason}</p>

						{/* Resolution options */}
						{escalation.options.length > 0 && (
							<div className="mt-2 space-y-1">
								{escalation.options.map((option) => (
									<button
										key={option.id}
										onClick={() => onResolve?.(escalation.id, option.id)}
										className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-left bg-white dark:bg-[#2A2A2A] hover:bg-stone-50 dark:hover:bg-[#333] border ${BORD} transition-colors`}
									>
										<ArrowRight size={9} className="shrink-0" />
										<span>{option.label}</span>
									</button>
								))}
							</div>
						)}

						{onViewAll && (
							<button
								onClick={onViewAll}
								className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-blue-700 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
							>
								View all escalations
								<ArrowRight size={10} />
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
