/**
 * usePlanWorkspaces — Polls the workspaces list for a plan execution
 * to discover workspace IDs for live transcript connections.
 */

import { useEffect, useRef, useState } from "react";

const API_BASE = "";
const DEFAULT_INTERVAL_MS = 3000;

interface WorkspaceSummary {
	id: string;
	stage: string;
	attempts: number;
	error: string | null;
	startedAt: number | null;
	completedAt: number | null;
}

interface UsePlanWorkspacesOptions {
	projectId: string | null;
	planExecId: string | null;
	intervalMs?: number;
}

interface UsePlanWorkspacesResult {
	workspaces: WorkspaceSummary[];
	/** The first active workspace, or null */
	activeWorkspaceId: string | null;
	/** All workspace IDs */
	workspaceIds: string[];
	isLoading: boolean;
	error: string | null;
}

/**
 * Polls the workspace list for a plan execution.
 *
 * Returns workspace summaries and the first active workspace ID
 * for live transcript connections.
 */
export function usePlanWorkspaces({
	projectId,
	planExecId,
	intervalMs = DEFAULT_INTERVAL_MS,
}: UsePlanWorkspacesOptions): UsePlanWorkspacesResult {
	const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const activeRef = useRef(true);

	useEffect(() => {
		setWorkspaces([]);
		setError(null);

		if (!projectId || !planExecId) {
			setIsLoading(false);
			return;
		}

		activeRef.current = true;

		const fetchWorkspaces = async () => {
			if (!activeRef.current) return;
			setIsLoading(true);

			try {
				const res = await fetch(
					`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}/workspaces`,
				);

				if (!activeRef.current) return;

				if (!res.ok) {
					if (res.status === 404) {
						setWorkspaces([]);
						setError(null);
						return;
					}
					throw new Error(`Workspaces fetch failed: ${res.status}`);
				}

				const body = await res.json();
				if (!activeRef.current) return;

				// The endpoint returns { workspaces: [...] }
				const list: WorkspaceSummary[] = body.workspaces ?? [];

				setWorkspaces(list);
				setError(null);

				// Stop polling if all workspaces have completed or failed
				const allDone = list.every(
					(w) => w.stage === "complete" || w.stage === "failed" || w.stage === "blocked",
				);
				if (allDone && list.length > 0) {
					if (timerRef.current) {
						clearInterval(timerRef.current);
						timerRef.current = null;
					}
				}
			} catch (err) {
				if (!activeRef.current) return;
				setError(err instanceof Error ? err.message : "Failed to fetch workspaces");
			} finally {
				if (activeRef.current) {
					setIsLoading(false);
				}
			}
		};

		fetchWorkspaces();

		timerRef.current = setInterval(fetchWorkspaces, intervalMs);

		return () => {
			activeRef.current = false;
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [projectId, planExecId, intervalMs]);

	const activeWorkspaceId = workspaces.find((w) => w.stage === "active")?.id ?? null;
	const workspaceIds = workspaces.map((w) => w.id);

	return { workspaces, activeWorkspaceId, workspaceIds, isLoading, error };
}
