import { useEffect, useState } from "react";
import type { WorkspaceAttempt, GitFilePatch, WorkspacePerformanceMetrics } from "../types";

interface UseWorkerDataOptions {
	planExecId: string | null;
	workerId: string;
}

interface UseWorkerDataResult {
	attempts: WorkspaceAttempt[];
	attemptsLoading: boolean;
	attemptsError: string | null;
	patches: GitFilePatch[];
	diffLoading: boolean;
	diffError: string | null;
	perfMetrics: WorkspacePerformanceMetrics | null;
	perfLoading: boolean;
	perfError: string | null;
}

export function useWorkerData({ planExecId, workerId }: UseWorkerDataOptions): UseWorkerDataResult {
	// ── Attempts ──
	const [attempts, setAttempts] = useState<WorkspaceAttempt[]>([]);
	const [attemptsLoading, setAttemptsLoading] = useState(false);
	const [attemptsError, setAttemptsError] = useState<string | null>(null);

	useEffect(() => {
		if (!planExecId || !workerId) return;
		setAttemptsLoading(true);
		fetch(`/api/projects/_/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workerId)}/attempts`)
			.then((r) => r.json())
			.then((data) => {
				setAttempts(data.attempts ?? []);
				setAttemptsError(null);
			})
			.catch((err) => {
				setAttemptsError(String(err));
				setAttempts([]);
			})
			.finally(() => setAttemptsLoading(false));
	}, [planExecId, workerId]);

	// ── Git diff ──
	const [patches, setPatches] = useState<GitFilePatch[]>([]);
	const [diffLoading, setDiffLoading] = useState(false);
	const [diffError, setDiffError] = useState<string | null>(null);

	useEffect(() => {
		if (!planExecId || !workerId) return;
		setDiffLoading(true);
		setDiffError(null);
		fetch(`/api/projects/_/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workerId)}/git-diff?format=patch`)
			.then((r) => r.json())
			.then((data) => {
				if (data.error) {
					setDiffError(data.error);
				}
				setPatches(data.patches ?? []);
			})
			.catch((err) => {
				setDiffError(String(err));
				setPatches([]);
			})
			.finally(() => setDiffLoading(false));
	}, [planExecId, workerId]);

	// ── Performance ──
	const [perfMetrics, setPerfMetrics] = useState<WorkspacePerformanceMetrics | null>(null);
	const [perfLoading, setPerfLoading] = useState(false);
	const [perfError, setPerfError] = useState<string | null>(null);

	useEffect(() => {
		if (!planExecId || !workerId) {
			setPerfMetrics(null);
			return;
		}
		setPerfLoading(true);
		setPerfError(null);
		fetch(`/api/projects/_/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workerId)}/performance`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((data) => setPerfMetrics(data))
			.catch((err) => {
				setPerfError(String(err));
				setPerfMetrics(null);
			})
			.finally(() => setPerfLoading(false));
	}, [planExecId, workerId]);

	return {
		attempts, attemptsLoading, attemptsError,
		patches, diffLoading, diffError,
		perfMetrics, perfLoading, perfError,
	};
}
