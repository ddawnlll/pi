/**
 * AutonomyProposalCard — A proposal card for the Autonomy Center (P11.N).
 *
 * Visually distinguishes self-modification proposals from regular proposals.
 * Shows approval gate status and disables actions when policy requires approval.
 *
 * P11.N AC1: Renders proposal cards from backend data.
 * P11.N AC2: Actions are disabled or marked pending when policy requires approval.
 * P11.N AC3: Self-modification proposals are visually distinguished.
 */

import type { ApprovalGateStatus, ProposalResponse } from "../../types";

// ---------------------------------------------------------------------------
// Styling tokens (matching App.tsx)
// ---------------------------------------------------------------------------

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";

// ---------------------------------------------------------------------------
// Gate status badge config
// ---------------------------------------------------------------------------

interface GateConfigEntry {
	label: string;
	color: string;
	bg: string;
	darkColor: string;
	darkBg: string;
}

const GATE_CONFIG: Record<ApprovalGateStatus, GateConfigEntry> = {
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

function getGateConfig(status: ApprovalGateStatus): GateConfigEntry {
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

function evidenceTags(evidence: ProposalResponse["evidence"]): string[] {
	const tags: string[] = [];
	const queue = evidence.queue ?? {};
	const workspaces = (queue as { workspaces?: unknown[] }).workspaces;
	if (Array.isArray(workspaces)) {
		tags.push(`${workspaces.length} workspace(s)`);
	}
	const optimizations = evidence.optimizationProposals;
	if (Array.isArray(optimizations) && optimizations.length > 0) {
		tags.push(`${optimizations.length} optimization(s)`);
	}
	if (tags.length === 0) {
		tags.push("No evidence summary");
	}
	return tags;
}

/** Check if a proposal involves self-modification (touches protected systems). */
function isSelfModificationProposal(
	proposal: ProposalResponse,
): boolean {
	// Check if the self-modification approval gate has been used
	if (
		proposal.selfModificationApproval.status !== "pending" ||
		proposal.selfModificationApproval.actionedAt != null
	) {
		return true;
	}

	// Check audit trail for self-modification actions
	const hasSelfModAction = proposal.auditTrail.some(
		(entry) =>
			entry.action === "self_modification_approved",
	);
	if (hasSelfModAction) return true;

	// Check evidence for self-mod indicators
	const evidence = proposal.evidence;
	const plannerOutput = evidence.plannerOutput ?? {};
	const selfModFlag = (plannerOutput as Record<string, unknown>)
		.selfModification;
	if (selfModFlag === true) return true;

	const queue = evidence.queue as Record<string, unknown> | undefined;
	const protectedSystems = queue?.protectedSystems as unknown[] | undefined;
	if (Array.isArray(protectedSystems) && protectedSystems.length > 0)
		return true;

	return false;
}

// ---------------------------------------------------------------------------
// Audit trail summary helper (avoids type narrowing issues with nested ternaries)
// ---------------------------------------------------------------------------

function AuditTrailSummary({ entry }: { entry: import("../../types").ProposalAuditEntry }) {
	let label: string;
	switch (entry.action) {
		case "submitted":
			label = "Submitted";
			break;
		case "approved":
		case "approved_for_planning":
		case "approved_for_execution":
			label = "Approved";
			break;
		case "self_modification_approved":
			label = "Self-mod approved";
			break;
		default:
			label = "";
	}
	return (
		<div className={`text-[10px] ${MUT} flex items-center gap-1`}>
			<span>
				{label}{" "}
				{entry.actor !== "system" ? `by ${entry.actor}` : ""}
			</span>
			{entry.reason && (
				<span className="truncate">
					· &ldquo;{entry.reason}&rdquo;
				</span>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AutonomyProposalCardProps {
	proposal: ProposalResponse;
	selected: boolean;
	onClick: () => void;
}

/**
 * AutonomyProposalCard — A proposal card for the autonomy center.
 *
 * P11.N AC3: Self-modification proposals are visually distinguished with
 * a distinct border, icon, and badge.
 */
export function AutonomyProposalCard({
	proposal,
	selected,
	onClick,
}: AutonomyProposalCardProps) {
	const tags = evidenceTags(proposal.evidence);
	const isSelfMod = isSelfModificationProposal(proposal);
	const auditCount = proposal.auditTrail.length;
	const lastAction =
		auditCount > 0
			? proposal.auditTrail[auditCount - 1]
			: null;

	const planCfg = getGateConfig(proposal.planningApproval.status);
	const execCfg = getGateConfig(proposal.executionApproval.status);

	// Self-modification styling: purple accent instead of blue
	const selfModBorder = "border-l-2 border-purple-400 dark:border-purple-500";
	const normalBorder = "border-l-2 border-transparent";

	return (
		<button
			onClick={onClick}
			className={`w-full text-left transition-colors ${
				isSelfMod ? selfModBorder : normalBorder
			} ${
				selected
					? `${ACC_BG}`
					: `${SURF} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`
			}`}
		>
			<div className="px-4 py-3">
				{/* Header row: title + self-mod badge */}
				<div className="flex items-start justify-between gap-2 mb-1">
					<div className="flex items-center gap-1.5 min-w-0 flex-1">
						{isSelfMod && (
							<span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded bg-purple-100 dark:bg-purple-900/40">
								<svg
									width="10"
									height="10"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="text-purple-600 dark:text-purple-400"
								>
									<path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17M12 3v0" />
								</svg>
							</span>
						)}
						<h3
							className={`text-sm font-semibold ${TXT} truncate`}
						>
							{proposal.title}
						</h3>
					</div>

					{/* Self-mod badge */}
					{isSelfMod && (
						<span className="shrink-0 text-[9px] font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded-full border border-purple-200 dark:border-purple-800">
							Self-modification
						</span>
					)}
				</div>

				{/* Approval gates row */}
				<div className="flex items-center gap-2 mb-1.5">
					<span
						className={`inline-flex items-center gap-1 shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${planCfg.color} ${planCfg.bg} ${planCfg.darkColor} ${planCfg.darkBg} border ${BORD}`}
					>
						Plan: {planCfg.label}
					</span>
					<span
						className={`inline-flex items-center gap-1 shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${execCfg.color} ${execCfg.bg} ${execCfg.darkColor} ${execCfg.darkBg} border ${BORD}`}
					>
						Exec: {execCfg.label}
					</span>
					{isSelfMod && (
						<span
							className={`inline-flex items-center gap-1 shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${
								proposal.selfModificationApproval.status === "approved"
									? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
									: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800"
							}`}
						>
							Self-mod:{" "}
							{getGateConfig(proposal.selfModificationApproval.status)
								.label === "Pending"
								? "Required"
								: getGateConfig(proposal.selfModificationApproval.status)
										.label}
						</span>
					)}
				</div>

				{/* Phase + time + dry-run + budget */}
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
					<span
						className={`text-[9px] ${
							proposal.dryRunStatus === "passed"
								? "text-emerald-500"
								: MUT
						}`}
					>
						Dry-run: {proposal.dryRunStatus}
					</span>
					<span
						className={`text-[9px] ${
							proposal.budgetState === "valid"
								? "text-emerald-500"
								: MUT
						}`}
					>
						Budget: {proposal.budgetState}
					</span>
				</div>

				{/* Evidence tags */}
				<div className="flex flex-wrap gap-1.5 mb-1.5">
					{tags.map((tag, i) => (
						<span
							key={i}
							className={`text-[10px] px-1.5 py-0.5 rounded ${MUT} bg-stone-50 dark:bg-[#2A2A2A] border ${BORD}`}
						>
							{tag}
						</span>
					))}
				</div>

				{/* Audit trail summary */}
				{lastAction && <AuditTrailSummary entry={lastAction} />}

				{/* Approval requirements warning */}
				{proposal.planningApproval.status !== "approved" && (
					<div
						className={`mt-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded ${BORD} border`}
					>
						Requires planning approval before execution
					</div>
				)}

				{/* Rejection reason */}
				{proposal.planningApproval.status === "rejected" &&
					proposal.rejectionReason && (
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
