import { useCallback, useEffect, useRef, useState } from "react";
import { brainClient } from "../api/brain";
import type { MemoryRecord, MemoryStats } from "../types-brain";

export interface FilterState {
	search: string;
	type: string;
	lifecycle: string;
	tags: string[];
}

export interface UseMemoriesReturn {
	memories: MemoryRecord[];
	total: number;
	stats: MemoryStats | null;
	loading: boolean;
	error: string | null;
	search: (q: string) => void;
	setFilters: (f: Partial<FilterState>) => void;
	filters: FilterState;
	create: (data: { title: string; content: string; type?: string; tags?: string[]; confidence?: number }) => Promise<MemoryRecord>;
	update: (id: string, data: Partial<MemoryRecord>) => Promise<void>;
	reject: (id: string) => Promise<void>;
	activate: (id: string) => Promise<void>;
	refresh: () => Promise<void>;
	page: number;
	setPage: (p: number) => void;
}

/**
 * Hook for memory CRUD operations. Supports project-scoped API calls.
 *
 * @param projectId - Optional project ID for project-scoped brain API
 */
export function useMemories(projectId?: string | null): UseMemoriesReturn {
	const [memories, setMemories] = useState<MemoryRecord[]>([]);
	const [total, setTotal] = useState(0);
	const [stats, setStats] = useState<MemoryStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [filters, setFiltersState] = useState<FilterState>({
		search: "",
		type: "",
		lifecycle: "",
		tags: [],
	});
	const [page, setPage] = useState(1);
	const limit = 20;
	const projectIdRef = useRef(projectId);
	projectIdRef.current = projectId;

	const fetch = useCallback(async () => {
		const pid = projectIdRef.current;
		try {
			const [memData, statsData] = await Promise.all([
				brainClient.getMemories(
					{
						limit,
						offset: (page - 1) * limit,
						search: filters.search || undefined,
						type: filters.type || undefined,
						lifecycle: filters.lifecycle || undefined,
						tags: filters.tags.length > 0 ? filters.tags : undefined,
					},
					pid,
				),
				brainClient.getMemoryStats(pid).catch(() => null),
			]);
			setMemories(memData.memories);
			setTotal(memData.total);
			if (statsData) setStats(statsData);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load memories");
		} finally {
			setLoading(false);
		}
	}, [page, filters]);

	useEffect(() => {
		fetch();
	}, [fetch]);

	const search = useCallback((q: string) => {
		setFiltersState((prev) => ({ ...prev, search: q }));
		setPage(1);
	}, []);

	const setFilters = useCallback((f: Partial<FilterState>) => {
		setFiltersState((prev) => ({ ...prev, ...f }));
		setPage(1);
	}, []);

	const create = useCallback(
		async (data: { title: string; content: string; type?: string; tags?: string[]; confidence?: number }) => {
			const created = await brainClient.createMemory(data, projectIdRef.current);
			await fetch();
			return created;
		},
		[fetch],
	);

	const update = useCallback(
		async (id: string, data: Partial<MemoryRecord>) => {
			await brainClient.updateMemory(id, data, projectIdRef.current);
			await fetch();
		},
		[fetch],
	);

	const reject = useCallback(
		async (id: string) => {
			await brainClient.rejectMemory(id, projectIdRef.current);
			await fetch();
		},
		[fetch],
	);

	const activate = useCallback(
		async (id: string) => {
			await brainClient.activateMemory(id, projectIdRef.current);
			await fetch();
		},
		[fetch],
	);

	return {
		memories,
		total,
		stats,
		loading,
		error,
		search,
		setFilters,
		filters,
		create,
		update,
		reject,
		activate,
		refresh: fetch,
		page,
		setPage,
	};
}
