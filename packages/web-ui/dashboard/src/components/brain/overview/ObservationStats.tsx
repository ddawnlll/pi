import React from "react";
import { SeverityBadge } from "../common";

interface ObservationStatsProps {
	total: number;
	bySeverity: Record<string, number>;
}

const SEVERITY_ORDER = ["critical", "warning", "info"];

export function ObservationStats({ total, bySeverity }: ObservationStatsProps) {
	if (total === 0) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
				<h3 className="text-xs font-semibold text-stone-700 dark:text-stone-300 mb-2">
					Observations
				</h3>
				<p className="text-[10px] text-stone-400 dark:text-stone-500">0 observations</p>
			</div>
		);
	}

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
			<h3 className="text-xs font-semibold text-stone-700 dark:text-stone-300 mb-3">
				Observations
			</h3>
			<div className="space-y-2">
				{SEVERITY_ORDER.map((sev) => {
					const count = bySeverity[sev] ?? 0;
					const maxCount = Math.max(...SEVERITY_ORDER.map((s) => bySeverity[s] ?? 0), 1);
					const pct = (count / maxCount) * 100;
					if (count === 0) return null;
					return (
						<div key={sev} className="flex items-center gap-2">
							<SeverityBadge severity={sev as "info" | "warning" | "critical"} />
							<div className="flex-1 h-4 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
								<div
									className={`h-full rounded-full transition-all duration-500 ${
										sev === "critical"
											? "bg-red-500"
											: sev === "warning"
												? "bg-orange-500"
												: "bg-blue-500"
									}`}
									style={{ width: `${pct}%` }}
								/>
							</div>
							<span className="text-[10px] font-mono text-stone-500 dark:text-stone-400 w-8 text-right">
								{count}
							</span>
						</div>
					);
				})}
			</div>
			<div className="mt-2 pt-2 border-t border-stone-100 dark:border-stone-800 flex justify-between text-[10px]">
				<span className="text-stone-400">Total</span>
				<span className="font-mono text-stone-600 dark:text-stone-300">{total}</span>
			</div>
		</div>
	);
}
