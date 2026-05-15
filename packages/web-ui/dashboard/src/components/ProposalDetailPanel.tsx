/**
 * ProposalDetailPanel — Detailed view of a single proposal (P8.G / P9.F).
 *
 * Shows the full evidence bundle, audit trail, separate planning/execution
 * approval gates, and action buttons for multi-stage approval.
 *
 * P9.F AC1: Dashboard shows planning approval and execution approval as
 *           separate gates.
 * P9.F AC2: Dashboard supports approve_for_planning, approve_for_execution,
 *           reject, request_changes, and approve_self_modification.
 * P9.F AC3: Execution cannot start from the UI without valid dry-run and
 *           budget state.
 */

import { useMemo, useState } from "react";
import type { ApprovalGateStatus, ProposalResponse } from "../types";
import { useProposalActions } from "../hooks/useProposals";

// ---------------------------------------------------------------------------
// Styling tokens (matching App.tsx)
// ---------------------------------------------------------------------------

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
	return new Date(ts).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatJSON(obj: unknown): string {
	try {
		return JSON.stringify(obj, null, 2);
	} catch {
		return String(obj);
	}
}

/** Safe access to nested evidence fields. */
function getEvidenceField(
	evidence: ProposalResponse["evidence"],
	path: string[],
): unknown {
	let current: unknown = evidence;
	for (const key of path) {
		if (current && typeof current === "object" && key in current) {
			current = (current as Record<string, unknown>)[key];
		} else {
			return undefined;
		}
	}
	return current;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const GATE_BADGE_CONFIG: Record<
	ApprovalGateStatus,
	{ label: string; color: string; bg: string }
> = {
	pending: {
		label: "Pending",
		color: "text-amber-700 dark:text-amber-300",
		bg: "bg-amber-100 dark:bg-amber-900/40",
	},
	approved: {
		label: "Approved",
		color: "text-emerald-700 dark:text-emerald-300",
		bg: "bg-emerald-100 dark:bg-emerald-900/40",
	},
	rejected: {
		label: "Rejected",
		color: "text-red-700 dark:text-red-300",
		bg: "bg-red-100 dark:bg-red-900/40",
	},
	changes_requested: {
		label: "Changes Req.",
		color: "text-purple-700 dark:text-purple-300",
		bg: "bg-purple-100 dark:bg-purple-900/40",
	},
};

function GateBadge({ status }: { status: ApprovalGateStatus }) {
	const c = GATE_BADGE_CONFIG[status] ?? GATE_BADGE_CONFIG.pending;
	const dotColor =
		status === "approved"
			? "bg-emerald-500"
			: status === "rejected"
				? "bg-red-500"
				: status === "changes_requested"
					? "bg-purple-500"
					: "bg-amber-500";

	return (
		<span
			className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.color} ${c.bg}`}
		>
			<span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
			{c.label}
		</span>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="mb-4">
			<h4 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-2 px-4`}>
				{title}
			</h4>
			{children}
		</div>
	);
}

/** Action button for approval operations. */
interface ActionButtonProps {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	variant?: "primary" | "danger" | "warning" | "ghost";
	loading?: boolean;
}

function ActionButton({
	label,
	onClick,
	disabled = false,
	variant = "ghost",
	loading = false,
}: ActionButtonProps) {
	const base =
		"flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
	const variants: Record<string, string> = {
		primary:
			"bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600",
		danger:
			"bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800",
		warning:
			"bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 border border-amber-200 dark:border-amber-800",
		ghost:
			"text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] border border-transparent",
	};

	return (
		<button
			onClick={onClick}
			disabled={disabled || loading}
			className={`${base} ${variants[variant]}`}
		>
			{loading && (
				<svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
					<circle
						className="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						strokeWidth="4"
						fill="none"
					/>
					<path
						className="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
					/>
				</svg>
			)}
			{label}
		</button>
	);
}

function KeyValue({
	label,
	value,
	mono,
}: {
	label: string;
	value: string | number | undefined | null;
	mono?: boolean;
}) {
	if (value == null) return null;
	return (
		<div className="flex items-center gap-2 px-4 py-1.5 text-xs">
			<span className={`${MUT} shrink-0 w-28`}>{label}</span>
			<span className={`${TXT} ${mono ? "font-mono text-[11px]" : ""} break-all`}>
				{String(value)}
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface ProposalDetailPanelProps {
	proposal: ProposalResponse;
	onProposalUpdated?: (updated: ProposalResponse) => void;
}

export function ProposalDetailPanel({
	proposal,
	onProposalUpdated,
}: ProposalDetailPanelProps) {
	const [actionError, setActionError] = useState<string | null>(null);
	const [actionSuccess, setActionSuccess] = useState<string | null>(null);
	const {
		approveForPlanning,
		approveForExecution,
		rejectProposal,
		requestChanges,
		approveSelfModification,
		isPending,
		error: mutationError,
		reset: resetMutation,
	} = useProposalActions();

	const plannerOutput = proposal.evidence.plannerOutput ?? {};
	const queue = proposal.evidence.queue ?? {};
	const optimizations = proposal.evidence.optimizationProposals ?? [];

	const workspaces = useMemo(() => {
		const ws = getEvidenceField(proposal.evidence, ["queue", "workspaces"]);
		return Array.isArray(ws) ? ws : [];
	}, [proposal.evidence]);

	const predictedParallelism = useMemo(() => {
		return getEvidenceField(proposal.evidence, [
			"plannerOutput",
			"predictedParallelism",
		]) as Record<string, unknown> | undefined;
	}, [proposal.evidence]);

	const criticalPath = useMemo(() => {
		return getEvidenceField(proposal.evidence, [
			"plannerOutput",
			"criticalPath",
		]);
	}, [proposal.evidence]);

	// P9.F AC3: Execution cannot start without valid dry-run and budget
	const canApproveForExecution =
		proposal.planningApproval.status === "approved" &&
		proposal.dryRunStatus === "passed" &&
		proposal.budgetState === "valid";

	const canApproveForPlanning =
		proposal.planningApproval.status === "pending" ||
		proposal.planningApproval.status === "changes_requested";

	const canReject =
		proposal.planningApproval.status === "pending" ||
		proposal.planningApproval.status === "changes_requested" ||
		proposal.executionApproval.status === "pending";

	const canRequestChanges =
		proposal.planningApproval.status === "pending";

	const canApproveSelfModification =
		proposal.selfModificationApproval.status === "pending";

	const handleAction = async (
		action: (
			proposalId: string,
			reason?: string,
		) => Promise<ProposalResponse>,
		actionLabel: string,
	) => {
		resetMutation();
		setActionError(null);
		setActionSuccess(null);

		// Simple confirmation via reason prompt
		const reason = window.prompt(
			`Enter a reason for ${actionLabel} (optional):`,
		);
		// If user cancels the prompt, reason is null — treat as cancel
		if (reason === null) return;

		try {
			const updated = await action(proposal.id, reason || undefined);
			setActionSuccess(`${actionLabel} successful`);
			onProposalUpdated?.(updated);
			setTimeout(() => setActionSuccess(null), 3000);
		} catch (err) {
			setActionError(String(err));
			setTimeout(() => setActionError(null), 5000);
		}
	};

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Header */}
			<div
				className={`shrink-0 px-4 py-3 border-b ${BORD} ${SURF}`}
			>
				<div className="flex items-start justify-between gap-3 mb-2">
					<div className="min-w-0 flex-1">
						<h2 className={`text-sm font-semibold ${TXT} truncate`}>
							{proposal.title}
						</h2>
						<p className={`text-[11px] font-mono ${MUT} mt-0.5`}>
							{proposal.id}
						</p>
					</div>
				</div>

				{/* P9.F AC1: Separate planning and execution approval gates */}
				<div className="flex items-center gap-2 mb-2">
					<span className={`text-[10px] font-semibold ${MUT} uppercase tracking-wider`}>
						Gates:
					</span>
					<div className="flex items-center gap-1.5">
						<span className="text-[9px] font-medium text-stone-500">Plan</span>
						<GateBadge status={proposal.planningApproval.status} />
					</div>
					<div className="flex items-center gap-1.5">
						<span className="text-[9px] font-medium text-stone-500">Exec</span>
						<GateBadge status={proposal.executionApproval.status} />
					</div>
					<div className="flex items-center gap-1.5">
						<span className="text-[9px] font-medium text-stone-500">Self-mod</span>
						<GateBadge status={proposal.selfModificationApproval.status} />
					</div>
				</div>

				{/* Dry-run and Budget status */}
				<div className="flex items-center gap-3 text-[10px]">
					<span className={`${MUT}`}>
						Phase: <span className={`${TXT} font-medium`}>{proposal.phase}</span>
					</span>
					<span className={`${MUT}`}>
						Dry-run:{" "}
						<span
							className={`font-medium ${
								proposal.dryRunStatus === "passed"
									? "text-emerald-600 dark:text-emerald-400"
									: proposal.dryRunStatus === "failed"
										? "text-red-600 dark:text-red-400"
										: TXT
							}`}
						>
							{proposal.dryRunStatus}
						</span>
					</span>
					<span className={`${MUT}`}>
						Budget:{" "}
						<span
							className={`font-medium ${
								proposal.budgetState === "valid"
									? "text-emerald-600 dark:text-emerald-400"
									: proposal.budgetState === "exceeded" ||
											proposal.budgetState === "insufficient"
										? "text-red-600 dark:text-red-400"
										: TXT
							}`}
						>
							{proposal.budgetState}
						</span>
					</span>
					{proposal.actionedAt && (
						<span className={`${MUT}`}>
							Actioned:{" "}
							<span className={`${TXT} font-medium`}>
								{formatTimestamp(proposal.actionedAt)}
							</span>
						</span>
					)}
					<span className={`text-[10px] ${MUT}`}>
						Submitted: {formatTimestamp(proposal.submittedAt)}
					</span>
				</div>
			</div>

			{/* Feedback banners */}
			{actionError && (
				<div
					className={`shrink-0 mx-4 mt-3 mb-1 px-3 py-2 rounded-lg border ${BORD} bg-red-50 dark:bg-red-900/20`}
				>
					<p className="text-xs font-medium text-red-700 dark:text-red-300">
						{actionError}
					</p>
				</div>
			)}
			{actionSuccess && (
				<div
					className={`shrink-0 mx-4 mt-3 mb-1 px-3 py-2 rounded-lg border ${BORD} bg-emerald-50 dark:bg-emerald-900/20`}
				>
					<p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
						{actionSuccess}
					</p>
				</div>
			)}

			{/* Scrollable content */}
			<div className="flex-1 min-h-0 overflow-y-auto">
				{/* P9.F AC2: Action buttons for multi-stage approval */}
				<Section title="Approval Actions">
					<div
						className={`mx-3 p-3 rounded-lg border ${BORD} ${SURF} space-y-2`}
					>
						<div className="flex flex-wrap items-center gap-2">
							<ActionButton
								label="Approve for Planning"
								onClick={() =>
									handleAction(approveForPlanning, "approve for planning")
								}
								disabled={!canApproveForPlanning || isPending}
								variant="primary"
								loading={isPending}
							/>
							<ActionButton
								label="Approve for Execution"
								onClick={() =>
									handleAction(
										approveForExecution,
										"approve for execution",
									)
								}
								disabled={!canApproveForExecution || isPending}
								variant="primary"
								loading={isPending}
							/>
							<ActionButton
								label="Reject"
								onClick={() =>
									handleAction(rejectProposal, "reject")
								}
								disabled={!canReject || isPending}
								variant="danger"
								loading={isPending}
							/>
							<ActionButton
								label="Request Changes"
								onClick={() =>
									handleAction(
										requestChanges,
										"request changes",
									)
								}
								disabled={!canRequestChanges || isPending}
								variant="warning"
								loading={isPending}
							/>
							<ActionButton
								label="Approve Self-Modification"
								onClick={() =>
									handleAction(
										approveSelfModification,
										"approve self-modification",
									)
								}
								disabled={!canApproveSelfModification || isPending}
								variant="primary"
								loading={isPending}
							/>
						</div>

						{/* Execution approval blocked hint */}
						{proposal.planningApproval.status === "approved" &&
							!canApproveForExecution && (
								<div
									className={`text-[10px] px-2 py-1.5 rounded ${BORD} border bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300`}
								>
									Execution approval requires passed dry-run and valid budget.
									Current: dry-run = {proposal.dryRunStatus}, budget ={" "}
									{proposal.budgetState}
								</div>
							)}
					</div>
				</Section>

				{/* Summary */}
				<Section title="Summary">
					<div className={`mx-3 p-3 rounded-lg border ${BORD} ${SURF}`}>
						<KeyValue label="Proposal ID" value={proposal.id} mono />
						<KeyValue label="Phase" value={proposal.phase} />
						<KeyValue label="Legacy Status" value={proposal.status} />
						<KeyValue label="Workspaces" value={workspaces.length} />
						<KeyValue
							label="Parallelism"
							value={
								predictedParallelism
									? `${String(predictedParallelism.effective ?? "?")} / ${String(predictedParallelism.requested ?? "?")}`
									: undefined
							}
						/>
						<KeyValue
							label="Batches"
							value={
								predictedParallelism
									? String(predictedParallelism.totalBatches ?? "?")
									: undefined
							}
						/>
						<KeyValue
							label="Critical Path"
							value={
								Array.isArray(criticalPath)
									? `${criticalPath.length} batch(es)`
									: undefined
							}
						/>
						<KeyValue
							label="Warnings"
							value={
								Array.isArray(
									getEvidenceField(proposal.evidence, [
										"plannerOutput",
										"plannerWarnings",
									]),
								)
									? String(
											(
												getEvidenceField(proposal.evidence, [
													"plannerOutput",
													"plannerWarnings",
												]) as unknown[]
											).length,
										)
									: undefined
							}
						/>
						<KeyValue
							label="Suggestions"
							value={
								Array.isArray(
									getEvidenceField(proposal.evidence, [
										"plannerOutput",
										"plannerSuggestions",
									]),
								)
									? String(
											(
												getEvidenceField(proposal.evidence, [
													"plannerOutput",
													"plannerSuggestions",
												]) as unknown[]
											).length,
										)
									: undefined
							}
						/>
						<KeyValue
							label="Optimizations"
							value={optimizations.length > 0 ? optimizations.length : undefined}
						/>
						<KeyValue label="Dry-run Status" value={proposal.dryRunStatus} />
						<KeyValue label="Budget State" value={proposal.budgetState} />
					</div>
				</Section>

				{/* Approval Gate Details */}
				<Section title="Approval Gates">
					<div className={`mx-3 rounded-lg border ${BORD} divide-y ${BORD}`}>
						<div className={`px-4 py-2.5 ${SURF}`}>
							<div className="flex items-center justify-between">
								<span className="text-xs font-medium text-stone-700 dark:text-stone-300">
									Planning
								</span>
								<GateBadge status={proposal.planningApproval.status} />
							</div>
							{proposal.planningApproval.actionedBy && (
								<p className={`text-[10px] ${MUT} mt-0.5`}>
									By: {proposal.planningApproval.actionedBy}
									{proposal.planningApproval.actionedAt &&
										` · ${formatTimestamp(proposal.planningApproval.actionedAt)}`}
								</p>
							)}
							{proposal.planningApproval.reason && (
								<p className={`text-[10px] ${MUT} mt-0.5 italic`}>
									"{proposal.planningApproval.reason}"
								</p>
							)}
						</div>
						<div className={`px-4 py-2.5 ${SURF}`}>
							<div className="flex items-center justify-between">
								<span className="text-xs font-medium text-stone-700 dark:text-stone-300">
									Execution
								</span>
								<GateBadge status={proposal.executionApproval.status} />
							</div>
							{proposal.executionApproval.actionedBy && (
								<p className={`text-[10px] ${MUT} mt-0.5`}>
									By: {proposal.executionApproval.actionedBy}
									{proposal.executionApproval.actionedAt &&
										` · ${formatTimestamp(proposal.executionApproval.actionedAt)}`}
								</p>
							)}
							{proposal.executionApproval.reason && (
								<p className={`text-[10px] ${MUT} mt-0.5 italic`}>
									"{proposal.executionApproval.reason}"
								</p>
							)}
						</div>
						<div className={`px-4 py-2.5 ${SURF}`}>
							<div className="flex items-center justify-between">
								<span className="text-xs font-medium text-stone-700 dark:text-stone-300">
									Self-Modification
								</span>
								<GateBadge status={proposal.selfModificationApproval.status} />
							</div>
							{proposal.selfModificationApproval.actionedBy && (
								<p className={`text-[10px] ${MUT} mt-0.5`}>
									By: {proposal.selfModificationApproval.actionedBy}
									{proposal.selfModificationApproval.actionedAt &&
										` · ${formatTimestamp(proposal.selfModificationApproval.actionedAt)}`}
								</p>
							)}
							{proposal.selfModificationApproval.reason && (
								<p className={`text-[10px] ${MUT} mt-0.5 italic`}>
									"{proposal.selfModificationApproval.reason}"
								</p>
							)}
						</div>
					</div>
				</Section>

				{/* Workspace Queue (AC1 — evidence) */}
				<Section title="Workspace Queue">
					<div className={`mx-3 rounded-lg border ${BORD} overflow-hidden`}>
						{workspaces.length === 0 ? (
							<div className={`px-4 py-3 text-xs ${MUT}`}>
								No workspace data available
							</div>
						) : (
							<div className="divide-y ${BORD}">
								{(workspaces as Array<Record<string, unknown>>).map(
									(ws: Record<string, unknown>, i: number) => (
										<div key={String(ws.id ?? i)} className={`px-4 py-2 ${SURF}`}>
											<p className={`text-xs font-medium ${TXT}`}>
												{String(ws.title ?? ws.id ?? `Workspace ${i + 1}`)}
											</p>
											<div className="flex gap-3 mt-0.5">
												<span className={`text-[10px] ${MUT}`}>
													ID: {String(ws.id ?? "—")}
												</span>
												{(Boolean(ws.dependencies) && (
													<span className={`text-[10px] ${MUT}`}>
														Deps:{" "}
														{((ws.dependencies as unknown[]) || []).length > 0
															? (ws.dependencies as unknown[]).join(", ")
															: "none"}
													</span>
												))}
											</div>
										</div>
									),
								)}
							</div>
						)}
					</div>
				</Section>

				{/* Optimization Proposals (AC1 — evidence) */}
				{optimizations.length > 0 && (
					<Section title="Optimization Proposals">
						<div
							className={`mx-3 rounded-lg border ${BORD} divide-y ${BORD} overflow-hidden`}
						>
							{optimizations.map((opt) => (
								<div key={opt.id} className={`px-4 py-2 ${SURF}`}>
									<div className="flex items-center justify-between gap-2">
										<p className={`text-xs font-medium ${TXT}`}>
											{opt.description}
										</p>
										<span
											className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
												opt.approvalStatus === "approved"
													? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
													: opt.approvalStatus === "rejected"
														? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
														: "bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
											}`}
										>
											{opt.approvalStatus}
										</span>
									</div>
									<p className={`text-[10px] ${MUT} mt-0.5`}>
										Kind: {opt.kind}
									</p>
								</div>
							))}
						</div>
					</Section>
				)}

				{/* Planner Output Raw Evidence (AC1) */}
				<Section title="Planner Output (Raw)">
					<div className={`mx-3 rounded-lg border ${BORD} overflow-hidden`}>
						<pre
							className={`px-4 py-3 text-[10px] font-mono leading-relaxed ${MUT} max-h-64 overflow-y-auto ${SURF}`}
						>
							{formatJSON(plannerOutput)}
						</pre>
					</div>
				</Section>

				{/* Audit Trail (AC3 — transparency) */}
				<Section title="Audit Trail">
					<div
						className={`mx-3 rounded-lg border ${BORD} divide-y ${BORD} overflow-hidden`}
					>
						{proposal.auditTrail.length === 0 ? (
							<div className={`px-4 py-3 text-xs ${MUT}`}>
								No audit entries
							</div>
						) : (
							proposal.auditTrail.map((entry, i) => (
								<div key={i} className={`px-4 py-2.5 ${SURF}`}>
									<div className="flex items-center gap-2">
										<span
											className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
												entry.action === "approved" ||
												entry.action === "approved_for_planning" ||
												entry.action === "approved_for_execution" ||
												entry.action === "self_modification_approved"
													? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
													: entry.action === "rejected"
														? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
														: entry.action === "changes_requested"
															? "bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
															: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
											}`}
										>
											{entry.action === "approved"
												? "approved"
												: entry.action === "approved_for_planning"
													? "planning approved"
													: entry.action === "approved_for_execution"
														? "execution approved"
														: entry.action === "self_modification_approved"
															? "self-mod approved"
															: entry.action === "changes_requested"
																? "changes requested"
																: entry.action}
										</span>
										<span className={`text-xs ${TXT}`}>{entry.actor}</span>
										<span className={`text-[10px] ${MUT}`}>
											{formatTimestamp(entry.timestamp)}
										</span>
									</div>
									{entry.reason && (
										<p className={`text-[10px] ${MUT} mt-1 ml-1`}>
											"{entry.reason}"
										</p>
									)}
								</div>
							))
						)}
					</div>
				</Section>

				{/* Spacer for bottom padding */}
				<div className="h-6" />
			</div>
		</div>
	);
}
