import React from "react";
import { MemoryCard } from "./MemoryCard";
import { Pagination, LoadingSkeleton, EmptyState, ErrorState } from "../common";
import type { MemoryRecord } from "../../../types-brain";

interface MemoryListProps {
	memories: MemoryRecord[];
	total: number;
	page: number;
	limit: number;
	loading: boolean;
	error: string | null;
	onPageChange: (page: number) => void;
	onSelect: (id: string) => void;
	onRefresh: () => void;
}

export function MemoryList({
	memories, total, page, limit,
	loading, error,
	onPageChange, onSelect, onRefresh,
}: MemoryListProps) {
	if (loading && memories.length === 0) {
		return <LoadingSkeleton variant="card" count={4} />;
	}

	if (error && memories.length === 0) {
		return <ErrorState message={error} onRetry={onRefresh} />;
	}

	if (memories.length === 0) {
		return (
			<EmptyState
				title="No memories yet"
				description="Run plans to generate memories. Pi will capture failure patterns, user preferences, and workflow knowledge."
			/>
		);
	}

	return (
		<div className="space-y-3">
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				{memories.map((m) => (
					<MemoryCard key={m.id} memory={m} onClick={() => onSelect(m.id)} />
				))}
			</div>
			<Pagination page={page} total={total} limit={limit} onPageChange={onPageChange} />
		</div>
	);
}
