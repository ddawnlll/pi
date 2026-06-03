import React from "react";
import { Lightbulb, ArrowUp, RotateCw } from "lucide-react";
import type { Proposal } from "../../types-brain";
import { LoadingSkeleton } from "../brain/common";
import { EmptyState } from "../brain/common";

interface ProposalNudgeProps {
	proposals: Proposal[] | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
}

const RISK_COLORS = {
	low: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800",
	medium: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
	high: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800",
	critical: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
} as const;

const SCORE_BAR_COLORS = [
	"bg-red-400",
	"bg-orange-400",
	"bg-amber-400",
	"bg-lime-400",
	"bg-emerald-400",
] as const;

function getScoreColor(score: number): string {
	const idx = Math.min(Math.floor(score / 20), SCORE_BAR_COLORS.length - 1);
	return SCORE_BAR_COLORS[idx];
}

function ProposalItem({ proposal }: { proposal: Proposal }) {
	const riskClass = RISK_COLORS[proposal.riskLevel] ?? RISK_COLORS.low;

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-3 space-y-2 hover:border-stone-300 dark:hover:border-stone-600 transition-colors">
			<div className="flex items-start justify-between gap-2">
				<h3 className="text-xs font-medium text-stone-800 dark:text-stone-200 leading-snug">
					{proposal.title}
				</h3>
				<span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded border ${riskClass}`}>
					{proposal.riskLevel}
				</span>
			</div>

			{proposal.description && (
				<p className="text-xs text-stone-400 dark:text-stone-500 line-clamp-2">
					{proposal.description}
				</p>
			)}

			{/* Score bar */}
			<div className="flex items-center gap-2">
				<div className="flex-1 h-1.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
					<div
						className={`h-full rounded-full ${getScoreColor(proposal.score)}`}
						style={{ width: `${Math.min(proposal.score, 100)}%` }}
					/>
				</div>
				<span className="text-xs font-medium text-stone-400 dark:text-stone-500 tabular-nums">
					{proposal.score}%
				</span>
			</div>

			{/* Evidence + time */}
			<div className="flex items-center gap-3 text-xs text-stone-400">
				<span>{proposal.evidence.memories} memories</span>
				<span>{proposal.evidence.observations} observations</span>
				<span className="ml-auto">
					{new Date(proposal.createdAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
				</span>
			</div>
		</div>
	);
}

export function ProposalNudge({ proposals, loading, error, onRefresh }: ProposalNudgeProps) {
	if (loading && !proposals) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-3">
				<LoadingSkeleton variant="card" count={2} />
			</div>
		);
	}

	if (error && !proposals) {
		return null; // handled by parent
	}

	const isEmpty = !proposals || proposals.length === 0;

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-[#1E1E1E]">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-700">
				<div className="flex items-center gap-2">
					<Lightbulb size={16} strokeWidth={1.5} className="text-stone-400" />
					<h2 className="text-xs font-semibold text-stone-800 dark:text-stone-200">
						Proposal Nudges
					</h2>
					{proposals && proposals.length > 0 && (
						<span className="text-xs text-stone-400 dark:text-stone-500">
							{proposals.length} pending
						</span>
					)}
				</div>
				<button
					onClick={onRefresh}
					className="p-1 rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
					title="Refresh"
				>
					<RotateCw size={14} strokeWidth={1.5} />
				</button>
			</div>

			{/* Content */}
			<div className="p-3 space-y-2">
				{isEmpty ? (
					<EmptyState
						icon={<Lightbulb size={24} strokeWidth={1.2} />}
						title="No pending proposals"
						description="All proposals have been reviewed. Nothing needs your attention."
					/>
				) : (
					proposals.map((proposal) => (
						<ProposalItem key={proposal.id} proposal={proposal} />
					))
				)}
			</div>
		</div>
	);
}
