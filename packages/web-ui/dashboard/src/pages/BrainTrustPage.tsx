import React, { useState } from "react";
import { useTrust } from "../hooks/useTrust";
import { EmergencyStopButton, ApprovalSummaryCard, AuditStatsChart, PolicyRuleTable, DecisionExplainer } from "../components/brain/trust";
import { LoadingSkeleton, ErrorState } from "../components/brain/common";

export function BrainTrustPage() {
	const {
		rules, approvals, approvalStats, auditEntries, auditStats, autonomy,
		loading, error,
		toggleRule, approve, rejectApproval,
		emergencyStop, releaseStop, emergencyStopped,
		explainDecision, refresh,
	} = useTrust();

	const [actionLoading, setActionLoading] = useState(false);

	if (loading && rules.length === 0) {
		return (
			<div className="p-6 max-w-4xl mx-auto space-y-4">
				<LoadingSkeleton variant="card" count={4} />
			</div>
		);
	}

	if (error && rules.length === 0) {
		return (
			<div className="p-6 max-w-4xl mx-auto">
				<ErrorState message={error} onRetry={refresh} />
			</div>
		);
	}

	const handleToggleRule = async (id: string) => {
		setActionLoading(true);
		try {
			await toggleRule(id);
		} finally {
			setActionLoading(false);
		}
	};

	return (
		<div className="p-6 max-w-4xl mx-auto space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<h1 className="text-base font-semibold text-stone-800 dark:text-stone-200">Trust & Safety</h1>
				<button onClick={refresh} className="px-2.5 py-1 text-xs font-medium rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700">
					Refresh
				</button>
			</div>

			{/* Emergency stop */}
			<EmergencyStopButton
				active={emergencyStopped}
				onStop={emergencyStop}
				onRelease={releaseStop}
				loading={actionLoading}
			/>

			{/* Autonomy level */}
			{autonomy && (
				<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 flex items-center justify-between">
					<div>
						<span className="text-xs text-stone-400">Autonomy Level</span>
						<p className="text-sm font-semibold text-stone-800 dark:text-stone-200">
							Level {autonomy.level} — {autonomy.levelLabel}
						</p>
					</div>
					<div className="text-right text-xs text-stone-400">
						<p>{autonomy.approvedActions} approved</p>
						<p>{autonomy.blockedActions} blocked</p>
					</div>
				</div>
			)}

			{/* Summary cards */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{approvalStats && (
					<ApprovalSummaryCard
						pending={approvalStats.pending}
						approvedToday={approvalStats.todayApproved}
						totalToday={approvalStats.todayTotal}
					/>
				)}
				{auditStats && (
					<AuditStatsChart
						total={auditStats.total}
						today={auditStats.today}
						approvalRate={auditStats.approvalRate}
					/>
				)}
			</div>

			{/* Policy rules */}
			<PolicyRuleTable rules={rules} onToggle={handleToggleRule} loading={actionLoading} />

			{/* Decision explainer */}
			<DecisionExplainer onExplain={explainDecision} />

			{/* Pending approvals */}
			{approvals.length > 0 && (
				<div className="border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden">
					<div className="px-4 py-3 border-b border-stone-100 dark:border-stone-800">
						<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">Pending Approvals</h3>
					</div>
					<div className="divide-y divide-stone-100 dark:divide-stone-800">
						{approvals.map((a) => (
							<div key={a.id} className="flex items-start gap-3 px-4 py-3">
								<div className="flex-1 min-w-0">
									<p className="text-xs font-medium text-stone-800 dark:text-stone-200">{a.title}</p>
									<p className="text-xs text-stone-400 truncate mt-0.5">{a.description}</p>
									<p className="text-xs text-stone-400 mt-0.5">By: {a.requestedBy}</p>
								</div>
								<div className="flex gap-1.5 shrink-0">
									<button
										onClick={() => { setActionLoading(true); approve(a.id).finally(() => setActionLoading(false)); }}
										disabled={actionLoading}
										className="px-2 py-1 text-xs font-medium rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 disabled:opacity-50"
									>
										Approve
									</button>
									<button
										onClick={() => { setActionLoading(true); rejectApproval(a.id).finally(() => setActionLoading(false)); }}
										disabled={actionLoading}
										className="px-2 py-1 text-xs font-medium rounded bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 disabled:opacity-50"
									>
										Reject
									</button>
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
