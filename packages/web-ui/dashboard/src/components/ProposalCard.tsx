/**
 * ProposalCard — A single proposal card for the Lead Agent Dashboard (P8.G / P9.F).
 *
 * Displays proposal title, phase, separate planning and execution approval
 * gates, evidence summary, and approval requirements. Clicking a card opens
 * the detail view.
 *
 * Acceptance Criteria (P9.F):
 * - Dashboard shows planning approval and execution approval as separate gates (AC1)
 * - Makes approval requirements clear (AC3)
 */

import type { ApprovalGateStatus, ProposalResponse } from "../types";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../tokens";

// ---------------------------------------------------------------------------
// Styling tokens (matching App.tsx)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Gate status badge configs
// ---------------------------------------------------------------------------

const GATE_CONFIG: Record<
	ApprovalGateStatus,
	{ label: string; color: string; bg: string; darkColor: string; darkBg: string }
> = {
	pending: {
		label: "Pending",
		color: "text-amber-600",
		bg: "bg-amber-50",
		darkColor: "dark:text-amber-400",
		darkBg: "dark:bg-amber-900/30",
	},
	approved: {
		label: "Approved",
		color: "text-emerald-600",
		bg: "bg-emerald-50",
		darkColor: "dark:text-emerald-400",
		darkBg: "dark:bg-emerald-900/30",
	},
	rejected: {
		label: "Rejected",
		color: "text-red-600",
		bg: "bg-red-50",
		darkColor: "dark:text-red-400",
		darkBg: "dark:bg-red-900/30",
	},
	changes_requested: {
		label: "Changes Req.",
		color: "text-purple-600",
		bg: "bg-purple-50",
		darkColor: "dark:text-purple-400",
		darkBg: "dark:bg-purple-900/30",
	},
};

function getGateConfig(status: ApprovalGateStatus) {
	return GATE_CONFIG[status] ?? GATE_CONFIG.pending;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
	return new Date(ts).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function evidenceSummary(evidence: ProposalResponse["evidence"]): string[] {
	const lines: string[] = [];

	const plannerOutput = evidence.plannerOutput ?? {};
	const queue = evidence.queue ?? {};

	// Workspace count from queue
	const workspaces = (queue as any).workspaces;
	if (Array.isArray(workspaces)) {
		lines.push(`${workspaces.length} workspace(s)`);
	}

	// Parallelism from planner output
	const parallelism = (plannerOutput as any).predictedParallelism;
	if (parallelism) {
		lines.push(
			`Parallelism: ${parallelism.effective ?? "?"}/${parallelism.requested ?? "?"}`,
		);
	}

	// Warnings/suggestions
	const warnings = (plannerOutput as any).plannerWarnings;
	const suggestions = (plannerOutput as any).plannerSuggestions;
	if (Array.isArray(warnings) && warnings.length > 0) {
		lines.push(`${warnings.length} warning(s)`);
	}
	if (Array.isArray(suggestions) && suggestions.length > 0) {
		lines.push(`${suggestions.length} suggestion(s)`);
	}

	// Optimization proposals
	const optimizations = evidence.optimizationProposals;
	if (Array.isArray(optimizations) && optimizations.length > 0) {
		lines.push(`${optimizations.length} optimization(s)`);
	}

	if (lines.length === 0) {
		lines.push("No evidence summary available");
	}

	return lines;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProposalCardProps {
	proposal: ProposalResponse;
	selected: boolean;
	onClick: () => void;
}

export function ProposalCard({ proposal, selected, onClick }: ProposalCardProps) {
	const evidenceLines = evidenceSummary(proposal.evidence);
	const auditCount = proposal.auditTrail.length;
	const lastAction =
		auditCount > 0
			? proposal.auditTrail[auditCount - 1]
			: null;

	const planCfg = getGateConfig(proposal.planningApproval.status);
	const execCfg = getGateConfig(proposal.executionApproval.status);

	return (
		<button
			onClick={onClick}
			className={`w-full text-left border-b ${BORD} transition-colors ${
				selected
					? `${ACC_BG}`
					: `${SURF} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`
			}`}
		>
			<div className="px-4 py-3">
				{/* Header row: title + dry-run/budget summary */}
				<div className="flex items-start justify-between gap-2 mb-1">
					<h3 className={`text-sm font-semibold ${TXT} truncate flex-1 min-w-0`}>
						{proposal.title}
					</h3>
					{proposal.dryRunStatus === "passed" && proposal.budgetState === "valid" && (
						<span className="shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
							Ready to execute
						</span>
					)}
				</div>

				{/* P9.F AC1: Separate planning and execution approval gates */}
				<div className="flex items-center gap-2 mb-1.5">
					<span
						className={`inline-flex items-center gap-1 shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full ${planCfg.color} ${planCfg.bg} ${planCfg.darkColor} ${planCfg.darkBg} border ${BORD}`}
					>
						Plan: {planCfg.label}
					</span>
					<span
						className={`inline-flex items-center gap-1 shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full ${execCfg.color} ${execCfg.bg} ${execCfg.darkColor} ${execCfg.darkBg} border ${BORD}`}
					>
						Exec: {execCfg.label}
					</span>
					{proposal.selfModificationApproval.status === "approved" && (
						<span className="inline-flex items-center gap-1 shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
							Self-mod OK
						</span>
					)}
				</div>

				{/* Phase + submission time */}
				<div className="flex items-center gap-2 mb-1.5">
					<span className={`text-xs font-mono ${MUT}`}>
						{proposal.phase}
					</span>
					<span className={`text-xs ${MUT}`}>
						{formatTimestamp(proposal.submittedAt)}
					</span>
					{proposal.actionedAt && (
						<span className={`text-xs ${MUT}`}>
							· actioned {formatTimestamp(proposal.actionedAt)}
						</span>
					)}
					{/* Dry-run + budget indicators */}
					<span className={`text-xs ${proposal.dryRunStatus === "passed" ? "text-emerald-500" : "text-stone-400"}`}>
						Dry-run: {proposal.dryRunStatus}
					</span>
					<span className={`text-xs ${proposal.budgetState === "valid" ? "text-emerald-500" : "text-stone-400"}`}>
						Budget: {proposal.budgetState}
					</span>
				</div>

				{/* Evidence summary */}
				<div className="flex flex-wrap gap-1.5 mb-1.5">
					{evidenceLines.map((line, i) => (
						<span
							key={i}
							className={`text-xs px-1.5 py-0.5 rounded ${MUT} bg-stone-100 dark:bg-[#2A2A2A] border ${BORD}`}
						>
							{line}
						</span>
					))}
				</div>

				{/* Audit trail summary */}
				{lastAction && (
					<div className={`text-xs ${MUT} flex items-center gap-1`}>
						<span>
							{lastAction.action === "submitted"
								? "Submitted"
								: lastAction.action === "approved" ||
										lastAction.action === "approved_for_planning" ||
										lastAction.action === "approved_for_execution"
									? "Approved"
									: lastAction.action === "self_modification_approved"
										? "Self-mod approved"
										: ""}{" "}
							{lastAction.actor !== "system" ? `by ${lastAction.actor}` : ""}
						</span>
						{lastAction.reason && (
							<span className="truncate">· "{lastAction.reason}"</span>
						)}
					</div>
				)}

				{/* Approval gates summary for pending proposals */}
				{proposal.planningApproval.status !== "approved" && (
					<div className={`mt-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded ${BORD} border`}>
						Requires planning approval before execution
					</div>
				)}

				{/* Rejection reason */}
				{proposal.planningApproval.status === "rejected" && proposal.rejectionReason && (
					<div
						className={`mt-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded ${BORD} border`}
					>
						Reason: {proposal.rejectionReason}
					</div>
				)}
			</div>
		</button>
	);
}
