/**
 * useEscalations — Hook for Lead Agent escalation operations (P41.09).
 *
 * Provides:
 * - Fetching active escalations for a workspace
 * - Resolving an escalation with a chosen option
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EscalationOption {
	id: string;
	label: string;
	description?: string;
}

export interface EscalationEntry {
	escalationId: string;
	reason: string;
	options: EscalationOption[];
	status: "awaiting_user" | "resolved" | "expired";
	issuedAt: number;
	resolvedAt?: number;
	chosenOptionId?: string;
}

export interface EscalationsResponse {
	success: boolean;
	escalations: EscalationEntry[];
	count: number;
}

export interface ResolveEscalationParams {
	escalationId: string;
	planExecutionId: string;
	workspaceId: string;
	chosenOptionId: string;
	userResponse?: string;
}

export interface ResolveEscalationResponse {
	success: boolean;
	message?: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch active escalations for a specific workspace.
 */
export function useEscalations(
	planExecId: string | null,
	workspaceId: string | null,
	enabled = true,
) {
	return useQuery<EscalationEntry[]>({
		queryKey: ["escalations", planExecId, workspaceId],
		queryFn: async () => {
			if (!planExecId || !workspaceId) return [];

			const res = await fetch(
				`${API_BASE}/api/human/escalations/${planExecId}/${workspaceId}`,
			);
			if (!res.ok) return [];

			const data: EscalationsResponse = await res.json();
			return data.escalations ?? [];
		},
		enabled: enabled && !!planExecId && !!workspaceId,
		refetchInterval: 10_000,
	});
}

/**
 * Mutation hook for resolving an escalation.
 */
export function useResolveEscalation() {
	const queryClient = useQueryClient();

	return useMutation<ResolveEscalationResponse, Error, ResolveEscalationParams>({
		mutationFn: async (params) => {
			const res = await fetch(
				`${API_BASE}/api/human/escalations/${params.escalationId}/resolve`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						planExecutionId: params.planExecutionId,
						workspaceId: params.workspaceId,
						chosenOptionId: params.chosenOptionId,
						userResponse: params.userResponse,
					}),
				},
			);
			return res.json() as Promise<ResolveEscalationResponse>;
		},
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: ["escalations", variables.planExecutionId, variables.workspaceId],
			});
			queryClient.invalidateQueries({
				queryKey: ["worker-context", variables.planExecutionId, variables.workspaceId],
			});
		},
	});
}
