import React, { useState } from "react";
import { useMemories } from "../hooks/useMemoryRecords";
import { MemoryList } from "../components/brain/memory/MemoryList";
import { MemoryDetailModal } from "../components/brain/memory/MemoryDetailModal";
import { MemoryEditForm } from "../components/brain/memory/MemoryEditForm";
import { MemoryFilters } from "../components/brain/memory/MemoryFilters";
import { MemorySearch } from "../components/brain/memory/MemorySearch";
import { ErrorState } from "../components/brain/common";

export function BrainMemoryPage() {
	const {
		memories, total, stats, loading, error,
		search, setFilters, filters,
		update, reject, activate, refresh,
		page, setPage,
	} = useMemories();

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const limit = 20;

	const selected = selectedId ? memories.find((m) => m.id === selectedId) ?? null : null;

	const handleEdit = () => {
		setEditingId(selectedId);
	};

	const handleReject = async () => {
		if (!selectedId) return;
		setActionLoading(selectedId);
		try {
			await reject(selectedId);
			setSelectedId(null);
		} finally {
			setActionLoading(null);
		}
	};

	const handleActivate = async () => {
		if (!selectedId) return;
		setActionLoading(selectedId);
		try {
			await activate(selectedId);
		} finally {
			setActionLoading(null);
		}
	};

	const handleEditSubmit = async (data: { title: string; content: string; tags: string[] }) => {
		if (!editingId) return;
		setActionLoading(editingId);
		try {
			await update(editingId, data);
			setEditingId(null);
		} finally {
			setActionLoading(null);
		}
	};

	if (error && memories.length === 0) {
		return (
			<div className="p-6 max-w-5xl mx-auto">
				<ErrorState message={error} onRetry={refresh} />
			</div>
		);
	}

	return (
		<div className="p-6 max-w-5xl mx-auto space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<h1 className="text-base font-semibold text-stone-800 dark:text-stone-200">
					Memory Explorer
				</h1>
				<button onClick={refresh} className="px-2.5 py-1 text-[10px] font-medium rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700">
					Refresh
				</button>
			</div>

			{/* Search + filters */}
			<div className="flex items-center gap-3">
				<div className="flex-1 max-w-xs">
					<MemorySearch
						value={filters.search}
						onChange={search}
						placeholder="Search memories..."
					/>
				</div>
				<MemoryFilters filters={filters} onChange={setFilters} />
			</div>

			{/* Stats */}
			{stats && (
				<div className="flex items-center gap-4 text-[10px] text-stone-400">
					<span>{stats.total} memories</span>
					{Object.entries(stats.byType).map(([type, count]) => (
						<span key={type}>{type.replace(/_/g, " ")}: {count}</span>
					))}
				</div>
			)}

			{/* List */}
			<MemoryList
				memories={memories}
				total={total}
				page={page}
				limit={limit}
				loading={loading}
				error={error}
				onPageChange={setPage}
				onSelect={setSelectedId}
				onRefresh={refresh}
			/>

			{/* Detail modal */}
			{selected && selectedId && !editingId && (
				<MemoryDetailModal
					memory={selected}
					onClose={() => setSelectedId(null)}
					onEdit={handleEdit}
					onReject={handleReject}
					onActivate={handleActivate}
				/>
			)}

			{/* Edit form */}
			{editingId && (
				<MemoryEditForm
					memory={selected}
					onSubmit={handleEditSubmit}
					onCancel={() => setEditingId(null)}
					loading={actionLoading === editingId}
				/>
			)}
		</div>
	);
}
