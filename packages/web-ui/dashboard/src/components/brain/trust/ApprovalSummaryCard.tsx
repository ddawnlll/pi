import React from "react";

interface ApprovalSummaryCardProps {
	pending: number;
	approvedToday: number;
	totalToday: number;
}

export function ApprovalSummaryCard({ pending, approvedToday, totalToday }: ApprovalSummaryCardProps) {
	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-3">
			<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">Approvals</h3>
			<div className="grid grid-cols-3 gap-3">
				<div className="text-center">
					<div className="text-lg font-bold text-amber-600 dark:text-amber-400">{pending}</div>
					<div className="text-xs text-stone-400">Pending</div>
				</div>
				<div className="text-center">
					<div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{approvedToday}</div>
					<div className="text-xs text-stone-400">Approved today</div>
				</div>
				<div className="text-center">
					<div className="text-lg font-bold text-stone-600 dark:text-stone-300">{totalToday}</div>
					<div className="text-xs text-stone-400">Total today</div>
				</div>
			</div>
		</div>
	);
}
