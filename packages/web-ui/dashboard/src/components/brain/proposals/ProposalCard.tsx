import React from "react";
import type { Proposal } from "../../../types-brain";

interface ProposalCardProps {
	proposal: Proposal;
	expanded: boolean;
	onToggle: () => void;
	actionLoading: boolean;
	onAccept: () => void;
	onReject: () => void;
	onCorrect: () => void;
}

const RISK_COLORS: Record<string, string> = {
	low: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20",
	medium: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20",
	high: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20",
	critical: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20",
};

export function ProposalCard({
	proposal,
	expanded,
	onToggle,
	actionLoading,
	onAccept,
	onReject,
	onCorrect,
}: ProposalCardProps) {
	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden card-hover transition-smooth">
			{/* Main card */}
			<div className="p-4">
				<div className="flex items-start justify-between mb-2">
					<div className="flex-1 min-w-0">
						<button
							onClick={onToggle}
							className="text-left text-sm font-medium text-stone-800 dark:text-stone-200 hover:text-blue-600 dark:hover:text-blue-400 truncate block w-full transition-colors link-hover"
						>
							{proposal.title}
						</button>
					</div>
					<span
						className={`shrink-0 ml-2 px-1.5 py-0.5 text-xs font-medium rounded-full ${
							RISK_COLORS[proposal.riskLevel] ?? RISK_COLORS.medium
						}`}
					>
						{proposal.riskLevel}
					</span>
				</div>

				{/* Score */}
				<div className="flex items-center gap-2 mb-2">
					<span className="text-xs font-mono text-stone-500">
						Score: {proposal.score.toFixed(2)}
					</span>
					<span className="text-xs text-stone-400">
						★ {Math.round(proposal.score * 5) / 5}/5
					</span>
				</div>

				{/* Evidence */}
				<div className="flex items-center gap-3 text-xs text-stone-400 mb-3">
					<span>{proposal.evidence.memories} memories</span>
					<span>{proposal.evidence.observations} observations</span>
				</div>

				{/* Actions */}
				<div className="flex gap-2">
					<button
						onClick={onAccept}
						disabled={actionLoading}
						className="px-3 py-1 text-xs font-medium rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 transition-all btn-press"
					>
						Accept
					</button>
					<button
						onClick={onReject}
						disabled={actionLoading}
						className="px-3 py-1 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 transition-all btn-press"
					>
						Reject
					</button>
					<button
						onClick={onCorrect}
						disabled={actionLoading}
						className="px-3 py-1 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 transition-all btn-press"
					>
						Correct
					</button>
				</div>
			</div>

			{/* Expanded description */}
			{expanded && (
				<div className="px-4 py-3 border-t border-stone-100 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/30">
					<p className="text-xs text-stone-600 dark:text-stone-300 leading-relaxed">
						{proposal.description}
					</p>
				</div>
			)}
		</div>
	);
}
