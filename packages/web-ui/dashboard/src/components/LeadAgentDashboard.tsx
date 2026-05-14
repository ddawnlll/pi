/**
 * LeadAgentDashboard — Main dashboard for the Read-Only Lead Agent (P8.G).
 *
 * Displays the proposal inbox with evidence, status, and approval requirements.
 * Read-only — no mutation controls (AC2 compliance).
 *
 * Acceptance Criteria:
 * - Displays proposal evidence and status (AC1)
 * - Dashboard cannot directly mutate protected systems or queue state (AC2)
 * - Makes approval requirements clear (AC3)
 */

import { useMemo, useState } from "react";
import {
	AlertCircle,
	Bot,
	CheckCircle,
	Filter,
	Loader2,
	RefreshCw,
	XCircle,
} from "lucide-react";
import { useProposals } from "../hooks/useProposals";
import { ProposalCard } from "./ProposalCard";
import { ProposalDetailPanel } from "./ProposalDetailPanel";
import type { ProposalResponse } from "../types";

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
// Status filter tabs
// ---------------------------------------------------------------------------

type StatusFilter = "all" | "pending" | "approved" | "rejected";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "pending", label: "Pending" },
	{ key: "approved", label: "Approved" },
	{ key: "rejected", label: "Rejected" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LeadAgentDashboardProps {
	className?: string;
}

export function LeadAgentDashboard({ className = "" }: LeadAgentDashboardProps) {
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);

	const { data: proposals = [], isLoading, error, refetch } = useProposals(
		statusFilter === "all" ? undefined : { status: statusFilter },
	);

	// Get selected proposal from the list
	const selectedProposal = useMemo(
		() => proposals.find((p) => p.id === selectedProposalId) ?? null,
		[proposals, selectedProposalId],
	);

	// If the selected proposal is no longer in the list (e.g., filter changed),
	// clear the selection
	if (selectedProposalId && !selectedProposal) {
		setSelectedProposalId(null);
	}

	// Counts for filter tabs
	const counts = useMemo(() => {
		const all = proposals.length;
		const pending = proposals.filter((p) => p.status === "pending").length;
		const approved = proposals.filter((p) => p.status === "approved").length;
		const rejected = proposals.filter((p) => p.status === "rejected").length;
		return { all, pending, approved, rejected };
	}, [proposals]);

	// Loading state
	if (isLoading) {
		return (
			<div
				className={`flex items-center justify-center h-full ${BG} ${className}`}
			>
				<div className={`flex items-center gap-2.5 ${MUT} text-sm`}>
					<Loader2 size={16} className="animate-spin" /> Loading proposals...
				</div>
			</div>
		);
	}

	// Error state
	if (error) {
		return (
			<div
				className={`flex items-center justify-center h-full ${BG} ${className}`}
			>
				<div className="flex flex-col items-center gap-3 text-sm text-red-600 dark:text-red-400">
					<AlertCircle size={24} strokeWidth={1.5} />
					<p>Failed to load proposals</p>
					<p className={`text-xs ${MUT}`}>{String(error)}</p>
					<button
						onClick={() => refetch()}
						className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
					>
						<RefreshCw size={12} /> Retry
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className={`flex h-full overflow-hidden ${BG} ${className}`}>
			{/* Left: Proposal list */}
			<div
				className={`w-80 shrink-0 border-r ${BORD} ${SURF} flex flex-col overflow-hidden`}
			>
				{/* Header */}
				<div
					className={`shrink-0 flex items-center gap-2 px-4 h-11 border-b ${BORD}`}
				>
					<Bot size={14} strokeWidth={1.8} className={ACC_TXT} />
					<span className={`text-xs font-semibold ${TXT}`}>
						Lead Agent Proposals
					</span>
					<div className="flex-1" />
					<button
						onClick={() => refetch()}
						className={`flex items-center justify-center h-7 w-7 rounded-lg ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
						title="Refresh proposals"
					>
						<RefreshCw size={13} strokeWidth={1.8} />
					</button>
				</div>

				{/* Status filter tabs */}
				<div
					className={`shrink-0 flex items-center border-b ${BORD} px-2 gap-1 h-10`}
				>
					{STATUS_FILTERS.map((f) => (
						<button
							key={f.key}
							onClick={() => {
								setStatusFilter(f.key);
								setSelectedProposalId(null);
							}}
							className={`flex items-center gap-1 h-7 px-2.5 rounded text-[10px] font-medium transition-colors ${
								statusFilter === f.key
									? `${ACC_BG} ${ACC_TXT}`
									: `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
							}`}
						>
							{f.key === "pending" && (
								<AlertCircle size={10} className="text-amber-500" />
							)}
							{f.key === "approved" && (
								<CheckCircle size={10} className="text-emerald-500" />
							)}
							{f.key === "rejected" && (
								<XCircle size={10} className="text-red-500" />
							)}
							{f.key === "all" && <Filter size={10} />}
							{f.label}
							{counts[f.key] > 0 && (
								<span
									className={`text-[9px] px-1.5 py-0.5 rounded-full ${
										statusFilter === f.key
											? "bg-white/50 dark:bg-black/20"
											: "bg-stone-100 dark:bg-[#2A2A2A]"
									}`}
								>
									{counts[f.key]}
								</span>
							)}
						</button>
					))}
				</div>

				{/* Empty state */}
				{proposals.length === 0 ? (
					<div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
						<Bot
							size={32}
							strokeWidth={1.2}
							className="text-stone-300 dark:text-stone-600"
						/>
						<p className={`text-sm ${MUT}`}>No proposals found</p>
						<p className={`text-xs ${MUT} text-center max-w-xs`}>
							The lead agent has not generated any proposals yet. Proposals will
							appear here once the lead agent runs its analysis.
						</p>
					</div>
				) : (
					/* Proposal list */
					<div className="flex-1 min-h-0 overflow-y-auto">
						{proposals.map((p) => (
							<ProposalCard
								key={p.id}
								proposal={p}
								selected={p.id === selectedProposalId}
								onClick={() => setSelectedProposalId(p.id)}
							/>
						))}
					</div>
				)}
			</div>

			{/* Right: Proposal detail */}
			<div
				className={`flex-1 min-w-0 border-r ${BORD} overflow-hidden`}
			>
				{selectedProposal ? (
					<ProposalDetailPanel proposal={selectedProposal} />
				) : proposals.length > 0 ? (
					<div
						className={`flex flex-col items-center justify-center h-full ${MUT} gap-2`}
					>
						<Bot size={28} strokeWidth={1.2} />
						<p className="text-sm">Select a proposal to view details</p>
					</div>
				) : null}
			</div>
		</div>
	);
}
