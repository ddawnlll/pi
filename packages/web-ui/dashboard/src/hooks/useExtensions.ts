/**
 * useExtensions — Hook for interacting with the Extension Lifecycle API.
 *
 * P11.P — Extensions and Skills Manager UI
 *
 * Provides queries and mutations for:
 * - Listing installed extensions
 * - Health check
 * - Install, update, rollback, enable, disable
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_BASE = "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtensionInfo {
	source: string;
	scope: "user" | "project";
	type: "package" | "local" | "unknown";
	installedPath?: string;
	enabled: boolean;
	filtered: boolean;
	hasRollbackBackup: boolean;
	error?: string;
}

export interface AuditEntry {
	timestamp: number;
	action: "install" | "update" | "rollback" | "enable" | "disable" | "remove";
	source: string;
	scope: "user" | "project";
	success: boolean;
	detail?: string;
	error?: string;
}

export interface ExtensionHealth {
	source: string;
	healthy: boolean;
	installed: boolean;
	version?: string;
	error?: string;
}

export interface ExtensionApiError {
	error: string;
	code: string;
	detail?: string;
}

export interface ExtensionListResponse {
	extensions: ExtensionInfo[];
	count: number;
}

export interface ExtensionHealthResponse {
	status: "healthy" | "degraded";
	extensions: ExtensionHealth[];
	healthy: boolean;
	total: number;
	unhealthy: number;
}

export interface ExtensionMutationResponse {
	success: boolean;
	source: string;
	message: string;
	fallback?: string;
	extensionPath?: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

async function fetchExtensions(): Promise<ExtensionListResponse> {
	const r = await fetch(`${API_BASE}/api/extensions`);
	if (!r.ok) {
		if (r.status === 404) throw new Error("Extensions not available — API routes not configured on server");
		throw new Error(`Failed to fetch extensions: ${r.statusText}`);
	}
	return r.json();
}

async function fetchExtensionHealth(): Promise<ExtensionHealthResponse> {
	const r = await fetch(`${API_BASE}/api/extensions/health`);
	if (!r.ok) {
		if (r.status === 404) throw new Error("Extensions not available — API routes not configured on server");
		throw new Error(`Failed to fetch extension health: ${r.statusText}`);
	}
	return r.json();
}

async function installExtension(source: string, local?: boolean): Promise<ExtensionMutationResponse> {
	const r = await fetch(`${API_BASE}/api/extensions/install`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ source, local }),
	});
	const data = await r.json();
	if (!r.ok) {
		throw { ...data, status: r.status } as ExtensionApiError & { status: number };
	}
	return data;
}

async function updateExtension(source?: string): Promise<ExtensionMutationResponse> {
	const r = await fetch(`${API_BASE}/api/extensions/update`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(source ? { source } : {}),
	});
	const data = await r.json();
	if (!r.ok) {
		throw { ...data, status: r.status } as ExtensionApiError & { status: number };
	}
	return data;
}

async function rollbackExtension(source: string): Promise<ExtensionMutationResponse> {
	const r = await fetch(`${API_BASE}/api/extensions/rollback`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ source }),
	});
	const data = await r.json();
	if (!r.ok) {
		throw { ...data, status: r.status } as ExtensionApiError & { status: number };
	}
	return data;
}

async function enableExtension(source: string, extensionPath?: string): Promise<ExtensionMutationResponse> {
	const r = await fetch(`${API_BASE}/api/extensions/enable`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ source, extensionPath }),
	});
	const data = await r.json();
	if (!r.ok) {
		throw { ...data, status: r.status } as ExtensionApiError & { status: number };
	}
	return data;
}

async function disableExtension(source: string, extensionPath?: string): Promise<ExtensionMutationResponse> {
	const r = await fetch(`${API_BASE}/api/extensions/disable`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ source, extensionPath }),
	});
	const data = await r.json();
	if (!r.ok) {
		throw { ...data, status: r.status } as ExtensionApiError & { status: number };
	}
	return data;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useExtensions() {
	const queryClient = useQueryClient();

	const listQuery = useQuery<ExtensionListResponse>({
		queryKey: ["extensions"],
		queryFn: fetchExtensions,
		staleTime: 30_000,
	});

	const healthQuery = useQuery<ExtensionHealthResponse>({
		queryKey: ["extensions", "health"],
		queryFn: fetchExtensionHealth,
		staleTime: 30_000,
	});

	const installMutation = useMutation({
		mutationFn: ({ source, local }: { source: string; local?: boolean }) =>
			installExtension(source, local),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["extensions"] });
			queryClient.invalidateQueries({ queryKey: ["extensions", "health"] });
		},
	});

	const updateMutation = useMutation({
		mutationFn: ({ source }: { source?: string }) => updateExtension(source),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["extensions"] });
			queryClient.invalidateQueries({ queryKey: ["extensions", "health"] });
		},
	});

	const rollbackMutation = useMutation({
		mutationFn: ({ source }: { source: string }) => rollbackExtension(source),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["extensions"] });
			queryClient.invalidateQueries({ queryKey: ["extensions", "health"] });
		},
	});

	const enableMutation = useMutation({
		mutationFn: ({ source, extensionPath }: { source: string; extensionPath?: string }) =>
			enableExtension(source, extensionPath),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["extensions"] });
		},
	});

	const disableMutation = useMutation({
		mutationFn: ({ source, extensionPath }: { source: string; extensionPath?: string }) =>
			disableExtension(source, extensionPath),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["extensions"] });
		},
	});

	return {
		extensions: listQuery.data?.extensions ?? [],
		count: listQuery.data?.count ?? 0,
		isLoading: listQuery.isLoading,
		error: listQuery.error,
		refetch: () => {
			listQuery.refetch();
			healthQuery.refetch();
		},
		health: healthQuery.data ?? null,
		healthLoading: healthQuery.isLoading,
		install: installMutation.mutateAsync,
		isInstalling: installMutation.isPending,
		installError: installMutation.error,
		update: updateMutation.mutateAsync,
		isUpdating: updateMutation.isPending,
		rollback: rollbackMutation.mutateAsync,
		isRollingBack: rollbackMutation.isPending,
		enable: enableMutation.mutateAsync,
		isEnabling: enableMutation.isPending,
		disable: disableMutation.mutateAsync,
		isDisabling: disableMutation.isPending,
	};
}
