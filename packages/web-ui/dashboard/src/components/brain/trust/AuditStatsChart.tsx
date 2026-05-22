import React from "react";

interface AuditStatsChartProps {
	total: number;
	today: number;
	approvalRate: number;
}

export function AuditStatsChart({ total, today, approvalRate }: AuditStatsChartProps) {
	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-3">
			<h3 className="text-xs font-semibold text-stone-700 dark:text-stone-300">Audit</h3>
			<div className="grid grid-cols-3 gap-3">
				<div className="text-center">
					<div className="text-lg font-bold text-stone-600 dark:text-stone-300">{total}</div>
					<div className="text-[9px] text-stone-400">Total entries</div>
				</div>
				<div className="text-center">
					<div className="text-lg font-bold text-blue-600 dark:text-blue-400">{today}</div>
					<div className="text-[9px] text-stone-400">Today</div>
				</div>
				<div className="text-center">
					<div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
						{Math.round(approvalRate * 100)}%
					</div>
					<div className="text-[9px] text-stone-400">Approval rate</div>
				</div>
			</div>
		</div>
	);
}
