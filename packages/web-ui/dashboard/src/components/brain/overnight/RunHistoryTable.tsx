import React from "react";
import type { OvernightSession } from "../../../types-brain";
import { LoadingSkeleton, EmptyState } from "../common";

interface RunHistoryTableProps {
	sessions: OvernightSession[];
	loading: boolean;
	error: string | null;
}

const STATUS_STYLES: Record<string, string> = {
	completed: "text-emerald-600 dark:text-emerald-400",
	running: "text-blue-600 dark:text-blue-400",
	queued: "text-amber-600 dark:text-amber-400",
	failed: "text-red-600 dark:text-red-400",
	cancelled: "text-stone-500",
};

export function RunHistoryTable({ sessions, loading, error }: RunHistoryTableProps) {
	if (loading) return <LoadingSkeleton variant="row" count={3} />;
	if (sessions.length === 0) {
		return <EmptyState title="No runs yet" description="Queue an overnight run to see history here." />;
	}

	return (
		<div className="space-y-2">
			{sessions.map((s) => (
				<div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-stone-50 dark:bg-stone-800/50">
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span className={`text-[10px] font-medium ${STATUS_STYLES[s.status] ?? "text-stone-500"}`}>
								{s.status}
							</span>
							<span className="text-[9px] text-stone-400">
								{s.startedAt ? new Date(s.startedAt).toLocaleDateString() : "—"}
							</span>
						</div>
						<p className="text-[9px] text-stone-400 mt-0.5">
							{s.plansCompleted}/{s.totalPlans} plans completed
						</p>
					</div>
					<span className="text-[9px] text-stone-400 shrink-0">
						L{s.autonomyLevel} · {s.maxDurationHours}h
					</span>
				</div>
			))}
		</div>
	);
}
