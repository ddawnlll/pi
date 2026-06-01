/**
 * useHumanDirectives — Hook for human directive operations (P41.10).
 *
 * Provides:
 * - Fetching directives for a workspace
 * - Issuing a new directive
 * - Workspace intervention (stop/pause/cancel/retry)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HumanDirectiveEntry {
	id: string;
	directive: string;
	severity: string;
	issuedAt: number;
	acknowledged: boolean;
}

export interface HumanDirectivesResponse {
	success: boolean;
	directives: HumanDirectiveEntry[];
	count: number;
}

export interface IssueDirectiveParams {
	planExecutionId: string;
	workspaceId: string;
	directive: string;
	severity?: "low" | "medium" | "high" | "blocking";
}

export interface IssueDirectiveResponse {
	success: boolean;
	directiveId?: string;
	message?: string;
	error?: string;
}

export interface InterventionParams {
	planExecutionId: string;
	workspaceId: string;
	action: "stop" | "pause" | "cancel" | "retry";
	reason?: string;
}

export interface InterventionResponse {
	success: boolean;
	message?: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const API_BASE = "";

/**
 * Fetch human directives for a specific workspace.
 */
export function useHumanDirectives(
	planExecId: string | null,
	workspaceId: string | null,
	enabled = true,
) {
	return useQuery<HumanDirectiveEntry[]>({
		queryKey: ["human-directives", planExecId, workspaceId],
		queryFn: async () => {
			if (!planExecId || !workspaceId) return [];

			const res = await fetch(
				`${API_BASE}/api/human/directives/${planExecId}/${workspaceId}`,
			);
			if (!res.ok) return [];

			const data: HumanDirectivesResponse = await res.json();
			return data.directives ?? [];
		},
		enabled: enabled && !!planExecId && !!workspaceId,
		refetchInterval: 15_000,
	});
}

/**
 * Mutation hook for issuing a human directive.
 */
export function useIssueDirective() {
	const queryClient = useQueryClient();

	return useMutation<IssueDirectiveResponse, Error, IssueDirectiveParams>({
		mutationFn: async (params) => {
			const res = await fetch(`${API_BASE}/api/human/directive`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(params),
			});
			return res.json() as Promise<IssueDirectiveResponse>;
		},
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: ["human-directives", variables.planExecutionId, variables.workspaceId],
			});
			queryClient.invalidateQueries({
				queryKey: ["worker-context", variables.planExecutionId, variables.workspaceId],
			});
		},
	});
}

/**
 * Mutation hook for intervening on a workspace (stop/pause/cancel/retry).
 */
export function useInterveneWorkspace() {
	const queryClient = useQueryClient();

	return useMutation<InterventionResponse, Error, InterventionParams>({
		mutationFn: async (params) => {
			const res = await fetch(
				`${API_BASE}/api/human/intervene/${params.planExecutionId}/${params.workspaceId}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ action: params.action, reason: params.reason }),
				},
			);
			return res.json() as Promise<InterventionResponse>;
		},
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: ["worker-context", variables.planExecutionId, variables.workspaceId],
			});
			queryClient.invalidateQueries({
				queryKey: ["plan-execution-detail"],
			});
		},
	});
}
