import React, { useState } from "react";
import { useGoalBoard } from "../../../hooks/useGoalBoard";
import { GoalCard } from "./GoalCard";
import { GoalDetail } from "./GoalDetail";
import { GoalForm } from "./GoalForm";
import { LoadingSkeleton, EmptyState, ErrorState } from "../common";
import type { GoalRecord } from "../../../types-brain";

const COLUMNS = [
	{ status: "active" as const, label: "Active" },
	{ status: "paused" as const, label: "Paused" },
	{ status: "complete" as const, label: "Complete" },
	{ status: "review" as const, label: "Review" },
];

export function GoalBoard() {
	const { goals, stats, driftReports, loading, error, create, update, complete, deleteGoal, refresh } = useGoalBoard();
	const [selectedGoal, setSelectedGoal] = useState<GoalRecord | null>(null);
	const [showForm, setShowForm] = useState(false);
	const [actionLoading, setActionLoading] = useState(false);

	if (loading && goals.length === 0) {
		return <LoadingSkeleton variant="card" count={6} />;
	}

	if (error && goals.length === 0) {
		return <ErrorState message={error} onRetry={refresh} />;
	}

	const handleCreate = async (data: { title: string; description?: string; priority?: string; milestones?: string[] }) => {
		setActionLoading(true);
		try {
			await create(data);
			setShowForm(false);
		} finally {
			setActionLoading(false);
		}
	};

	const handleComplete = async (id: string) => {
		setActionLoading(true);
		try {
			await complete(id);
			setSelectedGoal(null);
		} finally {
			setActionLoading(false);
		}
	};

	const handleDelete = async (id: string) => {
		setActionLoading(true);
		try {
			await deleteGoal(id);
			setSelectedGoal(null);
		} finally {
			setActionLoading(false);
		}
	};

	const hasDrift = driftReports.some((d) => d.drifted);

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">Goal Board</h2>
					{hasDrift && <span className="px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">Drift detected</span>}
				</div>
				<button
					onClick={() => setShowForm(true)}
					className="px-3 py-1 text-[10px] font-medium rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50"
				>
					+ Add Goal
				</button>
			</div>

			{/* Stats */}
			{stats && (
				<div className="flex items-center gap-4 text-[10px] text-stone-400">
					<span>{stats.total} total</span>
					{Object.entries(stats.byStatus).map(([status, count]) => (
						<span key={status}>{status}: {count}</span>
					))}
				</div>
			)}

			{/* Kanban columns */}
			{goals.length === 0 ? (
				<EmptyState
					title="No goals yet"
					description="Define your first goal to guide Pi's proposals and autonomy decisions."
					action={{ label: "Add Goal", onClick: () => setShowForm(true) }}
				/>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-4 gap-3">
					{COLUMNS.map((col) => (
						<div key={col.status} className="space-y-2">
							<h3 className="text-[10px] font-medium text-stone-500 uppercase tracking-wider px-1">
								{col.label}
							</h3>
							<div className="space-y-2 min-h-[100px]">
								{goals
									.filter((g) => g.status === col.status)
									.map((g) => (
										<GoalCard
											key={g.id}
											goal={g}
											drifted={driftReports.some((d) => d.goalId === g.id && d.drifted)}
											onClick={() => setSelectedGoal(g)}
										/>
									))}
							</div>
						</div>
					))}
				</div>
			)}

			{/* Goal detail modal */}
			{selectedGoal && (
				<GoalDetail
					goal={selectedGoal}
					onClose={() => setSelectedGoal(null)}
					onComplete={() => handleComplete(selectedGoal.id)}
					onDelete={() => handleDelete(selectedGoal.id)}
					onUpdate={(data) => update(selectedGoal.id, data)}
					loading={actionLoading}
				/>
			)}

			{/* Create form */}
			{showForm && (
				<GoalForm
					onSubmit={handleCreate}
					onCancel={() => setShowForm(false)}
					loading={actionLoading}
				/>
			)}
		</div>
	);
}
