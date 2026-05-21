/**
 * ProposalInbox — Proposal Inbox UI (P16.G).
 *
 * Displays the top-ranked, diversified proposals from the brain's
 * ProposalInbox engine. Each entry shows its rank, recommendation
 * label (auto_approve, review, reject), score dimensions, and an
 * evidence-backed reason.
 *
 * Acceptance Criteria:
 * - AC1: Shows top-ranked proposals sorted by score descending
 * - AC2: Diversified by type (max 2 of same type)
 * - AC3: Each entry has evidence summary and recommendation label
 * - AC4: Refresh button reloads inbox data
 * - AC5: Loading, empty, error, and stale states are implemented
 *
 * Dependencies:
 *   - useInbox / useRefreshInbox hooks
 *   - GET /api/brain/proposals/inbox endpoint
 *
 * @packageDocumentation
 */

import { useMemo, useState } from "react";
import {
	AlertCircle,
	ArrowUpCircle,
	BarChart3,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Clock,
	Eye,
	FileText,
	Filter,
	Loader2,
	RefreshCw,
	ThumbsDown,
	ThumbsUp,
	XCircle,
} from "lucide-react";
import { useInbox, useRefreshInbox } from "../../hooks/useBrainProposals";
import type { BrainProposal, InboxEntry } from "../../types";

// ---------------------------------------------------------------------------
// Styling tokens (matching App.tsx)
// ---------------------------------------------------------------------------

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BG = "bg-[#F7F6F3] dark:bg-[#161616]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";

// ---------------------------------------------------------------------------
// Recommendation config
// ---------------------------------------------------------------------------

const RECOMMENDATION_CONFIG = {
	auto_approve: {
		label: "Auto-Approve",
		icon: ThumbsUp,
		color: "text-emerald-600 dark:text-emerald-400",
		bg: "bg-emerald-50 dark:bg-emerald-900/30",
		border: "border-emerald-200 dark:border-emerald-800",
	},
	review: {
		label: "Review",
		icon: Eye,
		color: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-50 dark:bg-amber-900/30",
		border: "border-amber-200 dark:border-amber-800",
	},
	reject: {
		label: "Reject",
		icon: ThumbsDown,
		color: "text-red-600 dark:text-red-400",
		bg: "bg-red-50 dark:bg-red-900/30",
		border: "border-red-200 dark:border-red-800",
	},
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
	const ts = new Date(iso).getTime();
	return new Date(ts).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function scoreBar(width: number): string {
	if (width >= 0.7) return "bg-emerald-400 dark:bg-emerald-500";
	if (width >= 0.4) return "bg-amber-400 dark:bg-amber-500";
	return "bg-red-400 dark:bg-red-500";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Colored score bar. */
function ScoreBar({ value, label }: { value: number; label: string }) {
	const pct = Math.round(value * 100);
	return (
		<div className="flex items-center gap-2">
			<span className={`text-[9px] font-mono w-12 text-right ${MUT}`}>
				{label}
			</span>
			<div className="flex-1 h-1.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
				<div
					className={`h-full rounded-full transition-all ${scoreBar(value)}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className={`text-[9px] font-mono w-8 text-right ${MUT}`}>
				{pct}%
			</span>
		</div>
	);
}

/** Rank badge with ordinal label. */
function RankBadge({ rank }: { rank: number }) {
	const colors = [
		"bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
		"bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400",
		"bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300",
	];
	const labels = ["Top Pick", "Runner Up", "Third"];

	return (
		<span
			className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
				colors[rank - 1] ?? colors[2]
			}`}
		>
			<ArrowUpCircle size={10} />
			{labels[rank - 1] ?? `#${rank}`}
		</span>
	);
}

/** Recommendation badge. */
function RecommendationBadge({
	recommendation,
}: {
	recommendation: InboxEntry["recommendation"];
}) {
	const cfg = RECOMMENDATION_CONFIG[recommendation];
	const Icon = cfg.icon;
	return (
		<span
			className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}
		>
			<Icon size={10} />
			{cfg.label}
		</span>
	);
}

/** Type badge. */
function TypeBadge({ type }: { type: BrainProposal["type"] }) {
	return (
		<span
			className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 border ${BORD}`}
		>
			{type}
		</span>
	);
}

// ---------------------------------------------------------------------------
// ProposalRow — Collapsible detail row for a single inbox entry
// ---------------------------------------------------------------------------

function ProposalRow({
	entry,
	expanded,
	onToggle,
}: {
	entry: InboxEntry;
	expanded: boolean;
	onToggle: () => void;
}) {
	const { proposal, rank, recommendation, reason } = entry;
	const { score } = proposal;

	return (
		<div
			className={`border-b ${BORD} ${
				expanded ? ACC_BG : SURF
			} transition-colors`}
		>
			{/* Collapsed row */}
			<button
				onClick={onToggle}
				className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors"
			>
				{/* Rank badge */}
				<div className="shrink-0 pt-0.5">
					<RankBadge rank={rank} />
				</div>

				{/* Main content */}
				<div className="flex-1 min-w-0">
					{/* Title row */}
					<div className="flex items-center gap-2 mb-1">
						<h3 className={`text-sm font-semibold ${TXT} truncate`}>
							{proposal.title}
						</h3>
						{expanded ? (
							<ChevronDown size={12} className={`shrink-0 ${MUT}`} />
						) : (
							<ChevronRight size={12} className={`shrink-0 ${MUT}`} />
						)}
					</div>

					{/* Tags row */}
					<div className="flex items-center gap-1.5 mb-1 flex-wrap">
						<TypeBadge type={proposal.type} />
						<RecommendationBadge recommendation={recommendation} />
						{proposal.tags.length > 0 && (
							<>
								{proposal.tags.slice(0, 2).map((tag) => (
									<span
										key={tag}
										className={`text-[9px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border ${BORD}`}
									>
										{tag}
									</span>
								))}
								{proposal.tags.length > 2 && (
									<span className={`text-[9px] ${MUT}`}>
										+{proposal.tags.length - 2}
									</span>
								)}
							</>
						)}
					</div>

					{/* Reason + score summary */}
					<p className={`text-[10px] ${MUT} leading-relaxed line-clamp-2`}>
						{reason}
					</p>

					{/* Score summary row */}
					<div className="flex items-center gap-2 mt-1.5">
						<span className={`text-[9px] font-mono font-semibold ${
							score.total >= 0.7
								? "text-emerald-600 dark:text-emerald-400"
								: score.total >= 0.4
									? "text-amber-600 dark:text-amber-400"
									: "text-red-600 dark:text-red-400"
						}`}>
							Score: {(score.total * 100).toFixed(0)}
						</span>
						<span className={`text-[9px] ${MUT}`}>
							Confidence: {(score.confidence * 100).toFixed(0)}%
						</span>
						<span className={`text-[9px] ${MUT}`}>
							Urgency: {(score.urgency * 100).toFixed(0)}%
						</span>
					</div>

					{/* Source + time */}
					<div className="flex items-center gap-2 mt-1">
						<Clock size={9} className={MUT} />
						<span className={`text-[9px] ${MUT}`}>
							{formatTimestamp(proposal.createdAt)}
						</span>
						<span className={`text-[9px] ${MUT}`}>
							· {proposal.source}
						</span>
					</div>
				</div>
			</button>

			{/* Expanded detail */}
			{expanded && (
				<div className={`px-4 pb-4 pt-1 border-t ${BORD} ${SURF}`}>
					{/* Description */}
					<div className="mb-3">
						<h4 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-1`}>
							Description
						</h4>
						<p className={`text-xs ${TXT} leading-relaxed`}>
							{proposal.description}
						</p>
					</div>

					{/* Score breakdown */}
					<div className="mb-3">
						<h4 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-1.5`}>
							<BarChart3 size={10} className="inline mr-1" />
							Score Breakdown
						</h4>
						<div className="space-y-1">
							<ScoreBar value={score.total} label="Total" />
							<ScoreBar value={score.novelty} label="Novelty" />
							<ScoreBar value={score.feasibility} label="Feasibility" />
							<ScoreBar value={score.impact} label="Impact" />
							<ScoreBar value={score.urgency} label="Urgency" />
							<ScoreBar value={score.confidence} label="Confidence" />
						</div>
					</div>

					{/* Reason */}
					<div className="mb-3">
						<h4 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-1`}>
							<FileText size={10} className="inline mr-1" />
							Inbox Reason
						</h4>
						<p className={`text-[10px] ${MUT} leading-relaxed bg-stone-50 dark:bg-[#222] rounded-lg px-3 py-2 border ${BORD}`}>
							{reason}
						</p>
					</div>

					{/* Status */}
					<div className="flex items-center gap-2">
						<span className={`text-[10px] font-medium ${MUT}`}>
							Status:
						</span>
						<span className={`text-[10px] font-mono font-medium ${
							proposal.status === "pending_approval"
								? "text-amber-600"
								: proposal.status === "accepted"
									? "text-emerald-600"
									: proposal.status === "rejected"
										? "text-red-600"
										: TXT
						}`}>
							{proposal.status.replace(/_/g, " ")}
						</span>
					</div>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-3 p-8">
			<Filter size={32} strokeWidth={1.2} className="text-stone-300 dark:text-stone-600" />
			<p className={`text-sm ${MUT}`}>No proposals in inbox</p>
			<p className={`text-xs ${MUT} text-center max-w-sm`}>
				The proposal inbox is empty. Proposals will appear here once the brain generates
				and scores them. Click the refresh button to check for new proposals.
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// LoadingState
// ---------------------------------------------------------------------------

function LoadingState() {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-3">
			<Loader2 size={20} className="animate-spin text-stone-400" />
			<p className={`text-sm ${MUT}`}>Loading proposal inbox...</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// ErrorState
// ---------------------------------------------------------------------------

function ErrorState({
	error,
	onRetry,
}: {
	error: string;
	onRetry: () => void;
}) {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-3 p-8">
			<AlertCircle size={24} strokeWidth={1.5} className="text-red-500" />
			<p className="text-sm text-red-600 dark:text-red-400 font-medium">
				Failed to load inbox
			</p>
			<p className={`text-xs ${MUT} text-center max-w-sm`}>{error}</p>
			<button
				onClick={onRetry}
				className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A] text-stone-700 dark:text-stone-300"
			>
				<RefreshCw size={12} /> Retry
			</button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface ProposalInboxProps {
	className?: string;
}

export function ProposalInbox({ className = "" }: ProposalInboxProps) {
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const {
		data: inbox,
		isLoading,
		error,
		refetch,
		dataUpdatedAt,
		isRefetching,
	} = useInbox();

	const refreshMutation = useRefreshInbox();

	// Toggle expanded entry
	const handleToggle = (proposalId: string) => {
		setExpandedId((prev) => (prev === proposalId ? null : proposalId));
	};

	// Handle manual refresh
	const handleRefresh = async () => {
		try {
			await refreshMutation.mutateAsync();
		} catch {
			// Fallback to regular refetch
			refetch();
		}
	};

	// Determine data freshness
	const isStale = useMemo(() => {
		if (!dataUpdatedAt) return false;
		return Date.now() - dataUpdatedAt > 60_000;
	}, [dataUpdatedAt]);

	// Loading state
	if (isLoading && !inbox) {
		return (
			<div className={`h-full ${BG} ${className}`}>
				<LoadingState />
			</div>
		);
	}

	// Error state
	if (error && !inbox) {
		return (
			<div className={`h-full ${BG} ${className}`}>
				<ErrorState
					error={String(error)}
					onRetry={() => refetch()}
				/>
			</div>
		);
	}

	const entries = inbox?.entries ?? [];
	const totalPending = inbox?.totalPending ?? 0;
	const lastUpdated = inbox?.lastUpdated;

	return (
		<div className={`flex flex-col h-full overflow-hidden ${BG} ${className}`}>
			{/* Header */}
			<div
				className={`shrink-0 flex items-center gap-2 px-4 h-11 border-b ${BORD} ${SURF}`}
			>
				<Filter size={14} strokeWidth={1.8} className={ACC_TXT} />
				<span className={`text-xs font-semibold ${TXT}`}>
					Proposal Inbox
				</span>

				{/* Pending count badge */}
				{totalPending > 0 && (
					<span
						className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border ${BORD}`}
					>
						{totalPending} pending
					</span>
				)}

				<div className="flex-1" />

				{/* Refresh button */}
				<button
					onClick={handleRefresh}
					disabled={isRefetching || refreshMutation.isPending}
					className={`flex items-center justify-center h-7 w-7 rounded-lg ${
						MUT
					} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
					title="Refresh inbox"
				>
					<RefreshCw
						size={13}
						strokeWidth={1.8}
						className={
							isRefetching || refreshMutation.isPending
								? "animate-spin"
								: ""
						}
					/>
				</button>
			</div>

			{/* Stale data warning */}
			{isStale && entries.length > 0 && (
				<div
					className={`shrink-0 flex items-center gap-2 px-4 py-2 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-b ${BORD}`}
				>
					<Clock size={10} />
					<span>Data may be stale. Last updated: {formatTimestamp(lastUpdated ?? "")}</span>
					<button
						onClick={handleRefresh}
						className="ml-auto text-[10px] font-medium underline hover:no-underline"
					>
						Refresh
					</button>
				</div>
			)}

			{/* Body */}
			<div className="flex-1 min-h-0 overflow-hidden flex flex-col">
				{entries.length === 0 ? (
					<div className="flex-1">
						<EmptyState />
					</div>
				) : (
					<>
						{/* Summary bar */}
						<div
							className={`shrink-0 flex items-center gap-3 px-4 py-2 border-b ${BORD} ${SURF}`}
						>
							<span className={`text-[10px] ${MUT}`}>
								Showing {entries.length} of {totalPending} pending proposals
							</span>
							{lastUpdated && (
								<span className={`text-[9px] ${MUT}`}>
									· Updated {formatTimestamp(lastUpdated)}
								</span>
							)}
							{isRefetching && (
								<span className="flex items-center gap-1 text-[9px] text-blue-600 dark:text-blue-400">
									<Loader2 size={9} className="animate-spin" />
									Refreshing...
								</span>
							)}
						</div>

						{/* Inbox entries */}
						<div className="flex-1 min-h-0 overflow-y-auto">
							{entries.map((entry) => (
								<ProposalRow
									key={entry.proposal.id}
									entry={entry}
									expanded={expandedId === entry.proposal.id}
									onToggle={() =>
										handleToggle(entry.proposal.id)
									}
								/>
							))}
						</div>
					</>
				)}
			</div>
		</div>
	);
}
