import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = "";

export interface ProviderAuthInfo {
	provider: string;
	name: string;
	configured: boolean;
	source?: string;
	label?: string;
}

export interface AuthListResponse {
	providers: ProviderAuthInfo[];
}

async function fetchAuthProviders(): Promise<ProviderAuthInfo[]> {
	const res = await fetch(`${API_BASE}/api/auth`);
	if (!res.ok) return [];
	const data = (await res.json()) as AuthListResponse;
	return data.providers ?? [];
}

async function saveApiKey(provider: string, apiKey: string): Promise<boolean> {
	const res = await fetch(`${API_BASE}/api/auth/${encodeURIComponent(provider)}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ apiKey }),
	});
	return res.ok;
}

async function removeCredentials(provider: string): Promise<boolean> {
	const res = await fetch(`${API_BASE}/api/auth/${encodeURIComponent(provider)}`, {
		method: "DELETE",
	});
	return res.ok;
}

export function useAuth() {
	const queryClient = useQueryClient();

	const providersQuery = useQuery<ProviderAuthInfo[]>({
		queryKey: ["auth", "providers"],
		queryFn: fetchAuthProviders,
		staleTime: 30_000,
	});

	const saveMutation = useMutation({
		mutationFn: async ({ provider, apiKey }: { provider: string; apiKey: string }) => {
			const ok = await saveApiKey(provider, apiKey);
			if (!ok) throw new Error(`Failed to save API key for ${provider}`);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["auth", "providers"] });
		},
	});

	const removeMutation = useMutation({
		mutationFn: async (provider: string) => {
			const ok = await removeCredentials(provider);
			if (!ok) throw new Error(`Failed to remove credentials for ${provider}`);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["auth", "providers"] });
		},
	});

	return {
		providers: providersQuery.data ?? [],
		isLoading: providersQuery.isLoading,
		error: providersQuery.error,
		saveApiKey: saveMutation.mutateAsync,
		removeCredentials: removeMutation.mutateAsync,
		isSaving: saveMutation.isPending,
		isRemoving: removeMutation.isPending,
	};
}
