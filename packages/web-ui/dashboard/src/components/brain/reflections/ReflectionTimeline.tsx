import React from "react";
import { ReflectionCard } from "./ReflectionCard";
import { LoadingSkeleton, EmptyState, ErrorState } from "../common";
import type { ReflectionReport } from "../../../types-brain";

interface ReflectionTimelineProps {
	reflections: ReflectionReport[];
	stats: { total: number; memoriesCreated: number; suggestionsGenerated: number } | null;
	loading: boolean;
	error: string | null;
	onSelect: (planExecId: string) => void;
	onRefresh: () => void;
}

export function ReflectionTimeline({ reflections, stats, loading, error, onSelect, onRefresh }: ReflectionTimelineProps) {
	if (loading && reflections.length === 0) {
		return <LoadingSkeleton variant="card" count={4} />;
	}

	if (error && reflections.length === 0) {
		return <ErrorState message={error} onRetry={onRefresh} />;
	}

	if (reflections.length === 0) {
		return (
			<EmptyState
				title="No reflections yet"
				description="Complete a plan to get your first reflection. Pi will analyze what worked, what failed, and suggest improvements."
			/>
		);
	}

	return (
		<div className="space-y-4">
			{stats && (
				<div className="flex items-center gap-4 text-[10px] text-stone-400">
					<span>{stats.total} reflections</span>
					<span>{stats.memoriesCreated} memories created</span>
					<span>{stats.suggestionsGenerated} suggestions</span>
				</div>
			)}

			<div className="space-y-3">
				{reflections.map((r) => (
					<ReflectionCard
						key={r.planExecId}
						reflection={r}
						onClick={() => onSelect(r.planExecId)}
					/>
				))}
			</div>
		</div>
	);
}
