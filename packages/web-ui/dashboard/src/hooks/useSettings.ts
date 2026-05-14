import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

const API_BASE = "";

export interface ContextBudgets {
	flash: number;
	worker: number;
	lead: number;
	reviewer: number;
	debug: number;
	maxAuto: number;
	millionContextEnabled: boolean;
	expensiveContextFlag: string;
}

export interface DashboardSettings {
	defaultProvider?: string;
	defaultModel?: string;
	theme?: string;
	shellPath?: string;
	quietStartup?: boolean;
	npmCommand?: string[];
	collapseChangelog?: boolean;
	enableInstallTelemetry?: boolean;
	enableSkillCommands?: boolean;
	doubleEscapeAction?: "fork" | "tree" | "none";
	treeFilterMode?: "default" | "no-tools" | "user-only" | "labeled-only" | "all";
	steeringMode?: "all" | "one-at-a-time";
	followUpMode?: "all" | "one-at-a-time";
	contextBudgets?: Partial<ContextBudgets>;
	scaleMode?: "stable_3" | "experimental_6" | "scale_8";
	dogfoodPass?: boolean;
	explicitApproval?: boolean;
	[key: string]: unknown;
}

export interface AiModelInfo {
	provider: string;
	models: Array<{ id: string; name: string }>;
}

async function fetchMergedSettings(): Promise<DashboardSettings> {
	const res = await fetch(`${API_BASE}/api/settings`);
	if (!res.ok) return {};
	return res.json();
}

async function fetchContextBudgets(): Promise<ContextBudgets> {
	const res = await fetch(`${API_BASE}/api/settings/context-budgets`);
	if (!res.ok) {
		return {
			flash: 4000,
			worker: 12000,
			lead: 24000,
			reviewer: 16000,
			debug: 24000,
			maxAuto: 64000,
			millionContextEnabled: false,
			expensiveContextFlag: "--expensive-context-1m",
		};
	}
	return res.json();
}

async function fetchAiModels(): Promise<AiModelInfo[]> {
	const res = await fetch(`${API_BASE}/api/ai-models`);
	if (!res.ok) return [];
	const data = (await res.json()) as { providers: AiModelInfo[] };
	return data.providers ?? [];
}

async function updateGlobalSettings(updates: Record<string, unknown>): Promise<boolean> {
	const res = await fetch(`${API_BASE}/api/settings`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(updates),
	});
	return res.ok;
}

async function updateProjectSettings(updates: Record<string, unknown>): Promise<boolean> {
	const res = await fetch(`${API_BASE}/api/settings/project`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(updates),
	});
	return res.ok;
}

export function useSettings() {
	const queryClient = useQueryClient();

	const settingsQuery = useQuery<DashboardSettings>({
		queryKey: ["settings"],
		queryFn: fetchMergedSettings,
		staleTime: 60_000,
	});

	const budgetsQuery = useQuery<ContextBudgets>({
		queryKey: ["settings", "context-budgets"],
		queryFn: fetchContextBudgets,
		staleTime: 60_000,
	});

	const modelsQuery = useQuery<AiModelInfo[]>({
		queryKey: ["ai-models"],
		queryFn: fetchAiModels,
		staleTime: 120_000,
	});

	const updateMutation = useMutation({
		mutationFn: async (updates: Record<string, unknown>) => {
			const ok = await updateGlobalSettings(updates);
			if (!ok) throw new Error("Failed to update settings");
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["settings"] });
			queryClient.invalidateQueries({ queryKey: ["settings", "context-budgets"] });
		},
	});

	const updateProjectMutation = useMutation({
		mutationFn: async (updates: Record<string, unknown>) => {
			const ok = await updateProjectSettings(updates);
			if (!ok) throw new Error("Failed to update project settings");
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["settings"] });
			queryClient.invalidateQueries({ queryKey: ["settings", "context-budgets"] });
		},
	});

	const updateSettings = useCallback(
		(updates: Record<string, unknown>) => updateMutation.mutateAsync(updates),
		[updateMutation],
	);

	const updateProject = useCallback(
		(updates: Record<string, unknown>) => updateProjectMutation.mutateAsync(updates),
		[updateProjectMutation],
	);

	// Stable refetch reference — avoids triggering effects that depend on it
	const refetchRef = useRef<() => void>();
	if (!refetchRef.current) {
		refetchRef.current = () => {
			settingsQuery.refetch();
			budgetsQuery.refetch();
			modelsQuery.refetch();
		};
	}
	const refetch = refetchRef.current;

	// Stable object references to avoid infinite re-render loops
	const settings = useMemo(() => settingsQuery.data ?? {}, [settingsQuery.data]);
	const budgets = useMemo(() => budgetsQuery.data ?? null, [budgetsQuery.data]);
	const aiModels = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);

	return {
		settings,
		budgets,
		aiModels,
		modelsLoading: modelsQuery.isLoading,
		isLoading: settingsQuery.isLoading || budgetsQuery.isLoading,
		isSaving: updateMutation.isPending || updateProjectMutation.isPending,
		error: settingsQuery.error || budgetsQuery.error,
		updateSettings,
		updateProject,
		refetch,
	};
}

/** Hook for updating a project's name/rootPath */
async function updateProjectMeta(
	projectId: string,
	updates: { name?: string; rootPath?: string },
): Promise<boolean> {
	const res = await fetch(`${API_BASE}/api/projects/${projectId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(updates),
	});
	return res.ok;
}

export function useProjectMeta() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		mutationFn: async ({
			projectId,
			...updates
		}: { projectId: string; name?: string; rootPath?: string }) => {
			const ok = await updateProjectMeta(projectId, updates);
			if (!ok) throw new Error("Failed to update project");
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["projects"] });
		},
	});

	return {
		updateProject: mutation.mutateAsync,
		isSaving: mutation.isPending,
	};
}
