/**
 * useWorkerContext — Hook for fetching worker context from the context inspector API (P41.08).
 *
 * Consumes GET /api/worker-context/:planExecId/:workspaceId
 * Returns the full WorkerContextView including role packet, touched files,
 * command history, Lead Agent directives, escalations, and more.
 */

import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeadDirectiveView {
	directiveId: string;
	directive: string;
	severity: "low" | "medium" | "high" | "blocking";
	status: "issued" | "acknowledged" | "resolved" | "expired";
	issuedAt: number;
	acknowledgedAt?: number;
}

export interface LeadEscalationView {
	escalationId: string;
	reason: string;
	options: Array<{ id: string; label: string; description?: string }>;
	status: "awaiting_user" | "resolved" | "expired";
	issuedAt: number;
	resolvedAt?: number;
	chosenOptionId?: string;
}

export interface TouchedFileEntry {
	path: string;
	change: "created" | "modified" | "deleted";
}

export interface WorkerContextView {
	workspaceId: string;
	planExecutionId: string;
	stage: string;
	attempts: number;
	error?: string;
	startedAt?: string;
	completedAt?: string;
	goal?: string;
	role?: string;
	rolePacketContent?: string;
	contextPacketSummary?: string;
	allowedFiles: string[];
	touchedFiles: TouchedFileEntry[];
	lastCommand?: string;
	logSummary?: string;
	activeDirectives: LeadDirectiveView[];
	activeEscalations: LeadEscalationView[];
	humanDirective?: string;
	transcriptUrl: string;
}

interface WorkerContextResponse {
	success: boolean;
	context: WorkerContextView;
	error?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch the full worker context for a specific workspace.
 *
 * @param planExecId - The plan execution ID
 * @param workspaceId - The workspace ID
 * @param enabled - Whether the query should run (default: true)
 */
export function useWorkerContext(
	planExecId: string | null,
	workspaceId: string | null,
	enabled = true,
) {
	return useQuery<WorkerContextView | null>({
		queryKey: ["worker-context", planExecId, workspaceId],
		queryFn: async () => {
			if (!planExecId || !workspaceId) return null;

			const res = await fetch(`/api/worker-context/${planExecId}/${workspaceId}`);
			if (!res.ok) {
				if (res.status === 404) return null;
				throw new Error(`Failed to fetch worker context: ${res.status}`);
			}

			const data: WorkerContextResponse = await res.json();
			if (!data.success || !data.context) {
				return null;
			}

			return data.context;
		},
		enabled: enabled && !!planExecId && !!workspaceId,
		refetchInterval: 10_000, // Poll every 10s for live updates
		staleTime: 5_000,
	});
}
