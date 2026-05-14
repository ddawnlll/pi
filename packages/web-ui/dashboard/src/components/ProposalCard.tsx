/**
 * ProposalCard — A single proposal card for the Lead Agent Dashboard (P8.G).
 *
 * Displays proposal title, phase, status, evidence summary, and approval
 * requirements. Clicking a card opens the detail view.
 *
 * Acceptance Criteria:
 * - Displays proposal evidence and status (AC1)
 * - Makes approval requirements clear (AC3)
 */

import type { ProposalResponse } from "../types";

// ---------------------------------------------------------------------------
// Styling tokens (matching App.tsx)
// ---------------------------------------------------------------------------

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
	string,
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
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusConfig(status: string) {
	return STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
}

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
	const statusCfg = getStatusConfig(proposal.status);
	const evidenceLines = evidenceSummary(proposal.evidence);
	const auditCount = proposal.auditTrail.length;
	const lastAction =
		auditCount > 0
			? proposal.auditTrail[auditCount - 1]
			: null;

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
				{/* Header row: title + status */}
				<div className="flex items-start justify-between gap-2 mb-1.5">
					<h3 className={`text-sm font-semibold ${TXT} truncate flex-1 min-w-0`}>
						{proposal.title}
					</h3>
					<span
						className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${statusCfg.color} ${statusCfg.bg} ${statusCfg.darkColor} ${statusCfg.darkBg}`}
					>
						{statusCfg.label}
					</span>
				</div>

				{/* Phase + submission time */}
				<div className="flex items-center gap-2 mb-1.5">
					<span className={`text-[10px] font-mono ${MUT}`}>
						{proposal.phase}
					</span>
					<span className={`text-[10px] ${MUT}`}>
						{formatTimestamp(proposal.submittedAt)}
					</span>
					{proposal.actionedAt && (
						<span className={`text-[10px] ${MUT}`}>
							· actioned {formatTimestamp(proposal.actionedAt)}
						</span>
					)}
				</div>

				{/* Evidence summary */}
				<div className="flex flex-wrap gap-1.5 mb-1.5">
					{evidenceLines.map((line, i) => (
						<span
							key={i}
							className={`text-[10px] px-1.5 py-0.5 rounded ${MUT} bg-stone-50 dark:bg-[#2A2A2A] border ${BORD}`}
						>
							{line}
						</span>
					))}
				</div>

				{/* Audit trail summary */}
				{lastAction && (
					<div className={`text-[10px] ${MUT} flex items-center gap-1`}>
						<span>
							{lastAction.action === "submitted"
								? "Submitted"
								: lastAction.action === "approved"
									? "Approved"
									: "Rejected"}{" "}
							by {lastAction.actor}
						</span>
						{lastAction.reason && (
							<span className="truncate">· "{lastAction.reason}"</span>
						)}
					</div>
				)}

				{/* Approval requirement hint for pending proposals */}
				{proposal.status === "pending" && (
					<div
						className={`mt-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded ${BORD} border`}
					>
						Requires approval before execution
					</div>
				)}

				{/* Rejection reason */}
				{proposal.status === "rejected" && proposal.rejectionReason && (
					<div
						className={`mt-1.5 text-[10px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded ${BORD} border`}
					>
						Reason: {proposal.rejectionReason}
					</div>
				)}
			</div>
		</button>
	);
}
