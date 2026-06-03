import React, { useState } from "react";
import { ProposalCard } from "./ProposalCard";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { RejectModal } from "./RejectModal";
import { CorrectForm } from "./CorrectForm";
import type { Proposal } from "../../../types-brain";
import { EmptyState } from "../common";
import { LoadingSkeleton } from "../common";
import { ErrorState } from "../common";

interface ProposalInboxProps {
	proposals: Proposal[];
	loading: boolean;
	error: string | null;
	stats: { total: number; pending: number; approved: number; rejected: number } | null;
	onAccept: (id: string) => Promise<void>;
	onReject: (id: string, reason?: string) => Promise<void>;
	onCorrect: (id: string, corrections: Record<string, unknown>) => Promise<void>;
	onRefresh: () => Promise<void>;
}

export function ProposalInbox({
	proposals,
	loading,
	error,
	stats,
	onAccept,
	onReject,
	onCorrect,
	onRefresh,
}: ProposalInboxProps) {
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [rejectId, setRejectId] = useState<string | null>(null);
	const [correctId, setCorrectId] = useState<string | null>(null);
	const [actionLoading, setActionLoading] = useState<string | null>(null);

	if (loading && proposals.length === 0) {
		return (
			<div className="p-6 max-w-3xl mx-auto">
				<div className="mb-4">
					<LoadingSkeleton variant="card" count={3} />
				</div>
			</div>
		);
	}

	if (error && proposals.length === 0) {
		return (
			<div className="p-6 max-w-3xl mx-auto">
				<ErrorState message={error} onRetry={onRefresh} />
			</div>
		);
	}

	const handleAccept = async (id: string) => {
		setActionLoading(id);
		try {
			await onAccept(id);
		} finally {
			setActionLoading(null);
		}
	};

	const handleReject = async (reason?: string) => {
		if (!rejectId) return;
		setActionLoading(rejectId);
		try {
			await onReject(rejectId, reason);
			setRejectId(null);
		} finally {
			setActionLoading(null);
		}
	};

	const handleCorrect = async (corrections: Record<string, unknown>) => {
		if (!correctId) return;
		setActionLoading(correctId);
		try {
			await onCorrect(correctId, corrections);
			setCorrectId(null);
		} finally {
			setActionLoading(null);
		}
	};

	return (
		<div className="p-6 max-w-3xl mx-auto space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<h1 className="text-base font-semibold text-stone-800 dark:text-stone-200">
						Proposal Inbox
					</h1>
					{stats && stats.pending > 0 && (
						<span className="px-1.5 py-0.5 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
							{stats.pending} pending
						</span>
					)}
				</div>
				<button
					onClick={onRefresh}
					className="px-2.5 py-1 text-xs font-medium rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
				>
					Refresh
				</button>
			</div>

			{/* Stats bar */}
			{stats && (
				<div className="flex items-center gap-4 text-xs text-stone-400">
					<span>{stats.total} total</span>
					<span className="text-amber-600 dark:text-amber-400">{stats.pending} pending</span>
					<span className="text-emerald-600 dark:text-emerald-400">{stats.approved} accepted</span>
					<span className="text-red-600 dark:text-red-400">{stats.rejected} rejected</span>
				</div>
			)}

			{/* Proposal list */}
			{proposals.length === 0 ? (
				<EmptyState
					title="No pending proposals"
					description="Pi will generate ideas from observations. Check back after some plans run."
				/>
			) : (
				<div className="space-y-3">
					{proposals.slice(0, 3).map((p) => (
						<ProposalCard
							key={p.id}
							proposal={p}
							expanded={expandedId === p.id}
							onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
							actionLoading={actionLoading === p.id}
							onAccept={() => handleAccept(p.id)}
							onReject={() => setRejectId(p.id)}
							onCorrect={() => setCorrectId(p.id)}
						/>
					))}
				</div>
			)}

			{/* Reject modal */}
			{rejectId && (
				<RejectModal
					onConfirm={handleReject}
					onCancel={() => setRejectId(null)}
					loading={actionLoading === rejectId}
				/>
			)}

			{/* Correct form */}
			{correctId && (
				<CorrectForm
					proposal={proposals.find((p) => p.id === correctId) ?? null}
					onSubmit={handleCorrect}
					onCancel={() => setCorrectId(null)}
					loading={actionLoading === correctId}
				/>
			)}
		</div>
	);
}
