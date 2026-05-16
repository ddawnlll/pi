/**
 * AutonomyCenter — Main dashboard surface for orchestrator status, scan cadence,
 * health, latest proposals, self-improvement triggers, and approval-required
 * actions (P11.N).
 *
 * Acceptance Criteria:
 * - AC1: Autonomy screen renders orchestrator health and proposal cards from
 *        backend data.
 * - AC2: Actions are disabled or marked pending when policy requires approval.
 * - AC3: Self-modification proposals are visually distinguished.
 * - AC4: Loading, empty, error, and stale states are implemented.
 *
 * Dependencies: P11.H (orchestrator proposal generation), P11.M (audit ledger)
 * Conflict scope: packages/web-ui/dashboard/src/features/autonomy/**
 */

import { useEffect, useMemo, useState } from "react";
import {
	AlertCircle,
	Bot,
	CheckCircle,
	Filter,
	Lightbulb,
	Loader2,
	RefreshCw,
	XCircle,
} from "lucide-react";
import { useProposals } from "../../hooks/useProposals";
import { useOrchestratorHealth, useOrchestratorActions } from "../../hooks/useOrchestratorHealth";
import { OrchestratorHealthPanel } from "./OrchestratorHealthPanel";
import { AutonomyProposalCard } from "./AutonomyProposalCard";
import { ProposalDetailPanel } from "../../components/ProposalDetailPanel";
import type { ProposalResponse } from "../../types";

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

interface AutonomyCenterProps {
	className?: string;
}

/**
 * AutonomyCenter — Main dashboard surface for the Autonomy and Self-Improvement
 * Center.
 *
 * Layout: Left sidebar with proposal list, center with orchestrator health
 * panel and proposal detail.
 */
export function AutonomyCenter({ className = "" }: AutonomyCenterProps) {
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [selectedProposalId, setSelectedProposalId] = useState<
		string | null
	>(null);
	const [showOrchestratorDetail, setShowOrchestratorDetail] =
		useState(true);

	// Fetch orchestrator health
	const {
		data: health,
		isLoading: healthLoading,
		error: healthError,
		refetch: refetchHealth,
		dataUpdatedAt: healthUpdatedAt,
	} = useOrchestratorHealth(true);

	// Fetch proposals
	const { data: proposals = [], isLoading: proposalsLoading, error: proposalsError, refetch: refetchProposals } =
		useProposals(statusFilter === "all" ? undefined : { status: statusFilter });

	// Orchestrator actions (pause/resume/request-scan)
	const {
		pause: pauseOrchestrator,
		resume: resumeOrchestrator,
		requestScan,
		isPending: orchestratorActionPending,
	} = useOrchestratorActions();

	// Sync selected proposal when list changes
	const [selectedProposal, setSelectedProposal] =
		useState<ProposalResponse | null>(null);

	useEffect(() => {
		// Clear selection if proposal no longer in filtered list
		if (
			selectedProposalId &&
			!proposals.find((p) => p.id === selectedProposalId)
		) {
			setSelectedProposalId(null);
			return;
		}

		const found =
			proposals.find((p) => p.id === selectedProposalId) ?? null;
		setSelectedProposal((prev) => {
			if (found?.id !== prev?.id || found?.status !== prev?.status) {
				return found;
			}
			return prev;
		});
	}, [proposals, selectedProposalId]);

	// Counts for filter tabs
	const counts = useMemo(() => {
		const all = proposals.length;
		const pending = proposals.filter((p) => p.status === "pending").length;
		const approved = proposals.filter(
			(p) => p.status === "approved",
		).length;
		const rejected = proposals.filter(
			(p) => p.status === "rejected",
		).length;
		return { all, pending, approved, rejected };
	}, [proposals]);

	// Overall loading state
	const isLoading = healthLoading && proposalsLoading;
	// Error state: only show if both failed
	const combinedError = healthError && proposalsError
		? new Error("Failed to load autonomy data")
		: null;

	// Handle refresh
	const handleRefresh = () => {
		refetchHealth();
		refetchProposals();
	};

	// Loading state
	if (isLoading && !health && proposals.length === 0) {
		return (
			<div
				className={`flex items-center justify-center h-full ${BG} ${className}`}
			>
				<div className={`flex items-center gap-2.5 ${MUT} text-sm`}>
					<Loader2 size={16} className="animate-spin" />{" "}
					Loading autonomy center...
				</div>
			</div>
		);
	}

	// Error state
	if (combinedError) {
		return (
			<div
				className={`flex items-center justify-center h-full ${BG} ${className}`}
			>
				<div className="flex flex-col items-center gap-3 text-sm text-red-600 dark:text-red-400">
					<AlertCircle size={24} strokeWidth={1.5} />
					<p>Failed to load autonomy center data</p>
					<p className={`text-xs ${MUT}`}>{String(combinedError)}</p>
					<button
						onClick={handleRefresh}
						className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
					>
						<RefreshCw size={12} /> Retry
					</button>
				</div>
			</div>
		);
	}

	return (
		<div
			className={`flex h-full overflow-hidden ${BG} ${className}`}
		>
			{/* Left: Proposal list */}
			<div
				className={`w-80 shrink-0 border-r ${BORD} ${SURF} flex flex-col overflow-hidden`}
			>
				{/* Header */}
				<div
					className={`shrink-0 flex items-center gap-2 px-4 h-11 border-b ${BORD}`}
				>
					<Lightbulb
						size={14}
						strokeWidth={1.8}
						className={ACC_TXT}
					/>
					<span className={`text-xs font-semibold ${TXT}`}>
						Self-Improvement Proposals
					</span>
					<div className="flex-1" />
					<button
						onClick={() => refetchProposals()}
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

				{/* Proposals loading overlay */}
				{proposalsLoading && proposals.length === 0 ? (
					<div className="flex-1 flex items-center justify-center">
						<Loader2
							size={14}
							className="animate-spin text-stone-400"
						/>
					</div>
				) : proposals.length === 0 ? (
					/* Empty state */
					<div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
						<Lightbulb
							size={32}
							strokeWidth={1.2}
							className="text-stone-300 dark:text-stone-600"
						/>
						<p className={`text-sm ${MUT}`}>
							No proposals found
						</p>
						<p className={`text-xs ${MUT} text-center max-w-xs`}>
							No self-improvement proposals have been generated yet.
							Proposals will appear here once the orchestrator
							detects improvement opportunities.
						</p>
					</div>
				) : (
					/* Proposal list */
					<div className="flex-1 min-h-0 overflow-y-auto">
						{proposals.map((p) => (
							<AutonomyProposalCard
								key={p.id}
								proposal={p}
								selected={p.id === selectedProposalId}
								onClick={() =>
									setSelectedProposalId(
										p.id === selectedProposalId ? null : p.id,
									)
								}
							/>
						))}
					</div>
				)}
			</div>

			{/* Right: Orchestrator health + Proposal detail */}
			<div className="flex-1 min-w-0 flex flex-col overflow-hidden">
				{/* Orchestrator health summary bar */}
				<div
					className={`shrink-0 border-b ${BORD} px-3 h-10 flex items-center gap-2 cursor-pointer ${
						SURF
					} ${
						showOrchestratorDetail
							? "border-b-0"
							: ""
					}`}
					onClick={() =>
						setShowOrchestratorDetail(!showOrchestratorDetail)
					}
				>
					<Bot size={13} strokeWidth={1.8} className={ACC_TXT} />
					<span
						className={`text-xs font-semibold ${TXT}`}
					>
						Orchestrator Health
					</span>
					{health && (
						<span
							className={`text-[10px] font-medium ${
								health.health === "healthy"
									? "text-emerald-600"
									: health.health === "degraded"
										? "text-amber-600"
										: "text-red-600"
							}`}
						>
							· {health.health}
						</span>
					)}
					{health && (
						<span className={`text-[10px] ${MUT}`}>
							· {health.status}
						</span>
					)}
					{health?.paused && (
						<span className="text-[9px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
							Paused
						</span>
					)}
					<div className="flex-1" />
					<button
						onClick={(e) => {
							e.stopPropagation();
							handleRefresh();
						}}
						className={`flex items-center justify-center h-7 w-7 rounded-lg ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
						title="Refresh all"
					>
						<RefreshCw size={12} strokeWidth={1.8} />
					</button>
				</div>

				{/* Orchestrator health detail panel */}
				{showOrchestratorDetail && (
					<div
						className={`shrink-0 border-b ${BORD} overflow-hidden`}
						style={{ maxHeight: "60vh" }}
					>
						<OrchestratorHealthPanel
							health={health ?? null}
							isLoading={healthLoading}
							error={healthError}
							fetchedAt={healthUpdatedAt ?? null}
							onRefresh={() => refetchHealth()}
							onPause={(reason) =>
								pauseOrchestrator(reason)
							}
							onResume={(reason) =>
								resumeOrchestrator(reason)
							}
							onRequestScan={(scanKind) =>
								requestScan(scanKind)
							}
							isActionPending={orchestratorActionPending}
						/>
					</div>
				)}

				{/* Proposal detail area */}
				<div
					className={`flex-1 min-h-0 ${
						showOrchestratorDetail ? "" : "border-t-0"
					}`}
				>
					{selectedProposal ? (
						<ProposalDetailPanel
							proposal={selectedProposal}
							onProposalUpdated={(updated) => {
								setSelectedProposal(updated);
								refetchProposals();
							}}
						/>
					) : proposals.length > 0 ? (
						<div
							className={`flex flex-col items-center justify-center h-full ${MUT} gap-2`}
						>
							<Lightbulb
								size={28}
								strokeWidth={1.2}
							/>
							<p className="text-sm">
								Select a proposal to view details
							</p>
						</div>
					) : (
						<div
							className={`flex flex-col items-center justify-center h-full ${MUT} gap-2`}
						>
							<Bot size={28} strokeWidth={1.2} />
							<p className="text-sm">
								No proposals yet
							</p>
							<p className="text-xs text-center max-w-md">
								Proposals from the orchestrator will appear here once
								self-improvement opportunities are identified.
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
