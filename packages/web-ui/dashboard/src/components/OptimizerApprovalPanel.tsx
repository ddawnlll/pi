/**
 * OptimizerApprovalPanel — Component for reviewing and approving optimizer proposals
 *
 * Workspace P11.O — Plan Intake and DAG Diff UI
 *
 * Displays optimizer proposals with:
 * - Before/after impact metrics
 * - Unsafe change highlighting with blocked reasons
 * - Approve/reject actions through backend API
 * - Audit trail of decisions
 *
 * The panel integrates with the backend optimizer/approve and optimizer/reject
 * endpoints, writing approval requests through the API rather than mutating
 * executor state directly.
 */

import { useState, useCallback, useMemo } from "react";
import {
	AlertTriangle,
	AlertCircle,
	CheckCircle2,
	Info,
	Lightbulb,
	RefreshCw,
	ShieldAlert,
	ThumbsUp,
	ThumbsDown,
	X,
} from "lucide-react";
import type { OptimizerProposal, OptimizerApprovalState } from "../hooks/useOptimizerApproval";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-blue-50 dark:bg-blue-900/20";
const DANGER_BG = "bg-red-50 dark:bg-red-900/10";
const DANGER_TXT = "text-red-600 dark:text-red-400";
const DANGER_BORD = "border-red-200 dark:border-red-800";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/10";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const WARN_BORD = "border-amber-200 dark:border-amber-800";
const SUCCESS_TXT = "text-emerald-600 dark:text-emerald-400";
const SUCCESS_BG = "bg-emerald-50 dark:bg-emerald-900/10";
const SUCCESS_BORD = "border-emerald-200 dark:border-emerald-800";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptimizerApprovalPanelProps {
	/** Proposals to review */
	proposals: OptimizerProposal[];
	/** Current approval state from hook */
	state: OptimizerApprovalState;
	/** Callback to approve proposals */
	onApprove: (
		proposalIds: string[],
		patches?: Array<{ workspaceId: string; action: string; dependencyId: string }>,
		reviewer?: string,
	) => Promise<unknown>;
	/** Callback to reject proposals */
	onReject: (
		proposalIds: string[],
		reasons?: Record<string, string>,
		reviewer?: string,
	) => Promise<unknown>;
	/** Optional class name */
	className?: string;
	/** Whether to show the empty state */
	showEmptyState?: boolean;
}

// ---------------------------------------------------------------------------
// Approval config
// ---------------------------------------------------------------------------

const PROPOSAL_KIND_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
	split_workspace: {
		icon: <span className="text-[9px]">✂</span>,
		label: "Split workspace",
		color: "text-purple-600 dark:text-purple-400",
	},
	remove_dependency: {
		icon: <span className="text-[9px]">−</span>,
		label: "Remove dependency",
		color: ACC_TXT,
	},
	add_dependency: {
		icon: <span className="text-[9px]">+</span>,
		label: "Add dependency",
		color: "text-amber-600 dark:text-amber-400",
	},
};

function getProposalMeta(kind: string) {
	return PROPOSAL_KIND_META[kind] ?? {
		icon: <Lightbulb size={11} />,
		label: kind,
		color: ACC_TXT,
	};
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProposalCard({
	proposal,
	onApprove,
	onReject,
	isProcessing,
}: {
	proposal: OptimizerProposal;
	onApprove: (id: string) => void;
	onReject: (id: string) => void;
	isProcessing: boolean;
}) {
	const meta = getProposalMeta(proposal.kind);
	const [rejectReason, setRejectReason] = useState("");
	const [showRejectInput, setShowRejectInput] = useState(false);

	const isApproved = proposal.approvalStatus === "approved";
	const isRejected = proposal.approvalStatus === "rejected";
	const isPending = proposal.approvalStatus === "pending";
	const isUnsafe = proposal.isUnsafe;

	return (
		<div className={`rounded-lg border overflow-hidden transition-colors ${
			isApproved
				? `${SUCCESS_BORD} ${SUCCESS_BG}`
				: isRejected
				? `${DANGER_BORD} ${DANGER_BG}`
				: isUnsafe
				? `${WARN_BORD} ${WARN_BG}`
				: BORD
		}`}>
			{/* Header */}
			<div className="flex items-start justify-between p-3">
				<div className="flex items-start gap-2.5 min-w-0 flex-1">
					<span className={`mt-0.5 shrink-0 ${meta.color}`}>{meta.icon}</span>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2 flex-wrap">
							<p className={`text-[11px] font-semibold ${TXT}`}>{proposal.description}</p>
							{isApproved && (
								<span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${SUCCESS_BG} ${SUCCESS_TXT}`}>
									<CheckCircle2 size={9} /> Approved
								</span>
							)}
							{isRejected && (
								<span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${DANGER_BG} ${DANGER_TXT}`}>
									<X size={9} /> Rejected
								</span>
							)}
							{isUnsafe && (
								<span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${WARN_BG} ${WARN_TXT}`}>
									<ShieldAlert size={9} /> Unsafe
								</span>
							)}
						</div>

						{/* Evidence */}
						{proposal.evidence && (
							<div className="mt-1.5 flex flex-wrap gap-2">
								{proposal.evidence.eliminatesOverSerialization && (
									<span className={`inline-flex items-center gap-0.5 text-[9px] ${SUCCESS_TXT}`}>
										<CheckCircle2 size={8} /> Eliminates over-serialization
									</span>
								)}
								{proposal.evidence.beforeParallelism !== proposal.evidence.afterParallelism && (
									<span className={`text-[9px] ${MUT}`}>
										Parallelism: {proposal.evidence.beforeParallelism} → {proposal.evidence.afterParallelism}
									</span>
								)}
								{proposal.evidence.beforeBatchCount !== proposal.evidence.afterBatchCount && (
									<span className={`text-[9px] ${MUT}`}>
										Batches: {proposal.evidence.beforeBatchCount} → {proposal.evidence.afterBatchCount}
									</span>
								)}
							</div>
						)}

						{/* Block reason for unsafe proposals */}
						{isUnsafe && proposal.blockReason && (
							<div className={`mt-2 flex items-start gap-1.5 p-2 rounded ${WARN_BG}`}>
								<ShieldAlert size={10} className={`mt-0.5 shrink-0 ${WARN_TXT}`} />
								<p className={`text-[9px] leading-relaxed ${WARN_TXT}`}>{proposal.blockReason}</p>
							</div>
						)}

						{/* Rejection reason */}
						{isRejected && proposal.rejectionReason && (
							<div className="mt-2 flex items-start gap-1.5">
								<p className={`text-[9px] ${DANGER_TXT}`}>Reason: {proposal.rejectionReason}</p>
							</div>
						)}
					</div>
				</div>

				{/* Action buttons for pending proposals */}
				{isPending && !isUnsafe && (
					<div className="flex items-center gap-1 shrink-0 ml-2">
						<button
							onClick={() => onApprove(proposal.id)}
							disabled={isProcessing}
							className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium ${
								isProcessing ? `opacity-50 ${MUT}` : `${SUCCESS_TXT} ${SUCCESS_BG} hover:bg-emerald-100 dark:hover:bg-emerald-800/30`
							}`}
							title="Approve this proposal"
						>
							<ThumbsUp size={10} /> Approve
						</button>
						<button
							onClick={() => setShowRejectInput(!showRejectInput)}
							disabled={isProcessing}
							className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium ${
								isProcessing ? `opacity-50 ${MUT}` : `${DANGER_TXT} ${DANGER_BG} hover:bg-red-100 dark:hover:bg-red-800/30`
							}`}
							title="Reject this proposal"
						>
							<ThumbsDown size={10} /> Reject
						</button>
					</div>
				)}
			</div>

			{/* Reject reason input */}
			{showRejectInput && isPending && (
				<div className={`px-3 pb-3 border-t ${BORD} pt-2`}>
					<div className="flex gap-2">
						<input
							type="text"
							value={rejectReason}
							onChange={(e) => setRejectReason(e.target.value)}
							placeholder="Reason for rejection..."
							className={`flex-1 px-2 py-1.5 rounded text-xs border ${BORD} ${SURF} ${TXT} focus:outline-none focus:border-blue-400 dark:focus:border-blue-600`}
						/>
						<button
							onClick={() => {
								onReject(proposal.id);
								setShowRejectInput(false);
								setRejectReason("");
							}}
							disabled={!rejectReason.trim()}
							className={`px-2.5 py-1 rounded text-[10px] font-medium ${
								rejectReason.trim()
									? `${DANGER_TXT} ${DANGER_BG} hover:bg-red-100 dark:hover:bg-red-800/30`
									: `${MUT} cursor-not-allowed`
							}`}
						>
							Confirm reject
						</button>
						<button
							onClick={() => setShowRejectInput(false)}
							className={`px-2 py-1 rounded text-[10px] ${MUT} hover:bg-stone-100 dark:hover:bg-stone-800/50`}
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Patches list */}
			{proposal.patches.length > 0 && (
				<div className={`px-3 py-2 border-t ${BORD} space-y-1`}>
					{proposal.patches.map((patch, idx) => (
						<div key={idx} className={`flex items-center gap-1.5 px-2 py-1 rounded ${
							patch.action === "add_dependency"
								? "bg-emerald-50/50 dark:bg-emerald-900/10"
								: "bg-red-50/50 dark:bg-red-900/10"
						}`}>
							<span className={`text-[9px] font-bold px-1 rounded ${
								patch.action === "add_dependency"
									? `${SUCCESS_BG} ${SUCCESS_TXT}`
									: `${DANGER_BG} ${DANGER_TXT}`
							}`}>
								{patch.action === "add_dependency" ? "+" : "-"}
							</span>
							<span className="text-[10px] text-stone-600 dark:text-stone-300">{patch.description}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OptimizerApprovalPanel({
	proposals,
	state,
	onApprove,
	onReject,
	className,
	showEmptyState = true,
}: OptimizerApprovalPanelProps) {
	const [reviewer, setReviewer] = useState("dashboard");
	const [showReviewerInput, setShowReviewerInput] = useState(false);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	// Classification of proposals
	const unsafeProposals = useMemo(() => proposals.filter((p) => p.isUnsafe), [proposals]);
	const pendingProposals = useMemo(
		() => proposals.filter((p) => p.approvalStatus === "pending" && !p.isUnsafe),
		[proposals],
	);
	const approvedProposals = useMemo(() => proposals.filter((p) => p.approvalStatus === "approved"), [proposals]);
	const rejectedProposals = useMemo(() => proposals.filter((p) => p.approvalStatus === "rejected"), [proposals]);

	const isProcessing = state.stage === "approving" || state.stage === "rejecting";

	// Approve a single proposal
	const handleApproveOne = useCallback(
		(proposalId: string) => {
			const proposal = proposals.find((p) => p.id === proposalId);
			if (!proposal) return;
			onApprove(
				[proposalId],
				proposal.patches.map((p) => ({
					workspaceId: p.workspaceId,
					action: p.action,
					dependencyId: p.dependencyId,
				})),
				reviewer,
			);
		},
		[proposals, onApprove, reviewer],
	);

	// Reject a single proposal
	const handleRejectOne = useCallback(
		(proposalId: string) => {
			onReject([proposalId], { [proposalId]: "Rejected by reviewer" }, reviewer);
		},
		[onReject, reviewer],
	);

	// Approve all pending
	const handleApproveAll = useCallback(() => {
		const pending = proposals.filter((p) => p.approvalStatus === "pending" && !p.isUnsafe);
		if (pending.length === 0) return;
		const allPatches = pending.flatMap((p) =>
			p.patches.map((p2) => ({
				workspaceId: p2.workspaceId,
				action: p2.action,
				dependencyId: p2.dependencyId,
			})),
		);
		onApprove(
			pending.map((p) => p.id),
			allPatches,
			reviewer,
		);
	}, [proposals, onApprove, reviewer]);

	// Reject all pending
	const handleRejectAll = useCallback(() => {
		const pending = proposals.filter((p) => p.approvalStatus === "pending" && !p.isUnsafe);
		if (pending.length === 0) return;
		const reasons: Record<string, string> = {};
		for (const p of pending) {
			reasons[p.id] = "Rejected by reviewer (bulk)";
		}
		onReject(
			pending.map((p) => p.id),
			reasons,
			reviewer,
		);
	}, [proposals, onReject, reviewer]);

	const totalPending = pendingProposals.length;
	const totalUnsafe = unsafeProposals.length;

	// ── Empty state ──
	if (proposals.length === 0) {
		if (!showEmptyState) return null;
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-4 ${className ?? ""}`}>
				<div className="flex flex-col items-center justify-center py-6 gap-2">
					<Lightbulb size={24} className={`${MUT}`} strokeWidth={1.2} />
					<p className={`text-xs ${MUT}`}>No optimizer proposals</p>
					<p className={`text-[10px] ${MUT} text-center max-w-xs`}>
						Upload and validate a plan to generate optimization suggestions
						for improving parallelism and reducing serial bottlenecks.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className={`${SURF} rounded-lg border ${BORD} ${className ?? ""}`}>
			{/* Header */}
			<div className="flex items-center justify-between p-3 border-b border-[#E8E6E1] dark:border-[#333]">
				<div className="flex items-center gap-2">
					<Lightbulb size={14} className={ACC_TXT} />
					<h3 className={`text-sm font-semibold ${TXT}`}>Optimizer Approval</h3>
					{totalPending > 0 && (
						<span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${ACC_BG.replace("dark:", "")} ${ACC_TXT}`}>
							{totalPending} pending
						</span>
					)}
				</div>

				{/* Reviewer input toggle */}
				<button
					onClick={() => setShowReviewerInput(!showReviewerInput)}
					className={`text-[10px] ${MUT} hover:text-stone-600 dark:hover:text-stone-300`}
				>
					{showReviewerInput ? "Done" : `Reviewer: ${reviewer}`}
				</button>
			</div>

			{/* Reviewer input */}
			{showReviewerInput && (
				<div className={`px-3 py-2 border-b ${BORD}`}>
					<label className={`text-[9px] ${MUT} block mb-1`}>Reviewer name</label>
					<input
						type="text"
						value={reviewer}
						onChange={(e) => setReviewer(e.target.value)}
						className={`w-full px-2 py-1.5 rounded text-xs border ${BORD} ${SURF} ${TXT} focus:outline-none focus:border-blue-400 dark:focus:border-blue-600`}
						placeholder="Reviewer identifier..."
					/>
				</div>
			)}

			<div className="p-3 space-y-3">
				{/* Error state */}
				{state.stage === "error" && state.error && (
					<div className={`flex items-start gap-2 p-2.5 rounded-lg border ${DANGER_BG} ${DANGER_TXT} ${DANGER_BORD}`}>
						<AlertCircle size={12} className="mt-0.5 shrink-0" />
						<p className="text-[10px]">{state.error}</p>
					</div>
				)}

				{/* Success state */}
				{state.stage === "approved" && (
					<div className={`flex items-start gap-2 p-2.5 rounded-lg border ${SUCCESS_BG} ${SUCCESS_TXT} ${SUCCESS_BORD}`}>
						<CheckCircle2 size={12} className="mt-0.5 shrink-0" />
						<div>
							<p className="text-[10px] font-medium">
								{state.approvedCount} proposal(s) approved
							</p>
							{state.sessionId && (
								<p className="text-[9px] mt-0.5 opacity-70">
									Session ID: {state.sessionId.slice(0, 24)}...
								</p>
							)}
						</div>
					</div>
				)}

				{/* Bulk action bar */}
				{totalPending > 0 && (
					<div className={`flex items-center gap-2 p-2 rounded-lg ${ACC_BG} border ${BORD}`}>
						<span className={`text-[10px] font-medium flex-1 ${TXT}`}>
							{totalPending} proposal{totalPending !== 1 ? "s" : ""} pending review
						</span>
						<button
							onClick={handleApproveAll}
							disabled={isProcessing}
							className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-medium ${
								isProcessing
									? `opacity-50 ${MUT}`
									: `${SUCCESS_TXT} ${SUCCESS_BG} hover:bg-emerald-100 dark:hover:bg-emerald-800/30`
							}`}
						>
							<ThumbsUp size={10} /> Approve all
						</button>
						<button
							onClick={handleRejectAll}
							disabled={isProcessing}
							className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-medium ${
								isProcessing
									? `opacity-50 ${MUT}`
									: `${DANGER_TXT} ${DANGER_BG} hover:bg-red-100 dark:hover:bg-red-800/30`
							}`}
						>
							<ThumbsDown size={10} /> Reject all
						</button>
					</div>
				)}

				{/* Processing indicator */}
				{isProcessing && (
					<div className="flex items-center justify-center gap-2 py-2">
						<RefreshCw size={12} className="animate-spin text-blue-500" />
						<span className={`text-xs ${MUT}`}>
							{state.stage === "approving" ? "Submitting approval..." : "Submitting rejection..."}
						</span>
					</div>
				)}

				{/* Unsafe proposals section (highlighted) */}
				{totalUnsafe > 0 && (
					<>
						<div className={`flex items-center gap-1.5 px-2 py-1.5 rounded ${WARN_BG} border ${WARN_BORD}`}>
							<ShieldAlert size={11} className={WARN_TXT} />
							<span className={`text-[10px] font-medium ${WARN_TXT}`}>
								{totalUnsafe} unsafe change{totalUnsafe !== 1 ? "s" : ""} detected — review carefully
							</span>
						</div>
						<div className="space-y-2">
							{unsafeProposals.map((proposal) => (
								<ProposalCard
									key={proposal.id}
									proposal={proposal}
									onApprove={handleApproveOne}
									onReject={handleRejectOne}
									isProcessing={isProcessing}
								/>
							))}
						</div>
					</>
				)}

				{/* Pending proposals */}
				{totalPending > 0 && (
					<div className="space-y-2">
						{pendingProposals.map((proposal) => (
							<ProposalCard
								key={proposal.id}
								proposal={proposal}
								onApprove={handleApproveOne}
								onReject={handleRejectOne}
								isProcessing={isProcessing}
							/>
						))}
					</div>
				)}

				{/* Approved proposals */}
				{approvedProposals.length > 0 && (
					<details className={`rounded-lg border ${BORD} overflow-hidden`}>
						<summary className={`px-3 py-1.5 text-[10px] font-medium ${MUT} cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/30 ${SUCCESS_BG}`}>
							{approvedProposals.length} approved proposal{approvedProposals.length !== 1 ? "s" : ""}
						</summary>
						<div className="divide-y divide-[#E8E6E1] dark:divide-[#333]">
							{approvedProposals.map((proposal) => (
								<ProposalCard
									key={proposal.id}
									proposal={proposal}
									onApprove={handleApproveOne}
									onReject={handleRejectOne}
									isProcessing={false}
								/>
							))}
						</div>
					</details>
				)}

				{/* Rejected proposals */}
				{rejectedProposals.length > 0 && (
					<details className={`rounded-lg border ${BORD} overflow-hidden`}>
						<summary className={`px-3 py-1.5 text-[10px] font-medium ${MUT} cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/30 ${DANGER_BG}`}>
							{rejectedProposals.length} rejected proposal{rejectedProposals.length !== 1 ? "s" : ""}
						</summary>
						<div className="divide-y divide-[#E8E6E1] dark:divide-[#333]">
							{rejectedProposals.map((proposal) => (
								<ProposalCard
									key={proposal.id}
									proposal={proposal}
									onApprove={handleApproveOne}
									onReject={handleRejectOne}
									isProcessing={false}
								/>
							))}
						</div>
					</details>
				)}

				{/* Advisory note */}
				<div className={`flex items-start gap-1.5 px-2.5 py-1.5 rounded bg-stone-50 dark:bg-stone-800/50 border ${BORD}`}>
					<Info size={10} className={`mt-0.5 shrink-0 ${MUT}`} />
					<p className={`text-[8px] leading-tight ${MUT}`}>
						Approvals are processed through the backend API and recorded in the optimizer audit log.
						The executor uses the approved graph hash, not stale authored previews, ensuring consistency
						between what was approved and what executes.
					</p>
				</div>
			</div>
		</div>
	);
}
