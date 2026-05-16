/**
 * useOptimizerApproval — Hook for optimizer approval workflow
 *
 * Workspace P11.O — Plan Intake and DAG Diff UI
 *
 * Provides:
 * - Approve/reject optimizer proposals through backend API
 * - Loading, error, success state management
 * - Audit log integration
 */

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE = "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptimizerProposal {
	id: string;
	kind: string;
	description: string;
	evidence: {
		beforeParallelism: number;
		afterParallelism: number;
		beforeBatchCount: number;
		afterBatchCount: number;
		eliminatesOverSerialization: boolean;
		description: string;
	};
	patches: Array<{
		workspaceId: string;
		action: string;
		dependencyId: string;
		description: string;
	}>;
	affectedWorkspaceIds: string[];
	approvalStatus: "pending" | "approved" | "rejected";
	rejectionReason?: string;
	/** Whether this proposal is unsafe (highlighted in UI) */
	isUnsafe?: boolean;
	/** Reason for being unsafe or blocked */
	blockReason?: string;
}

export interface OptimizerApprovalState {
	/** Proposals being reviewed */
	proposals: OptimizerProposal[];
	/** Current review stage */
	stage: "idle" | "reviewing" | "approving" | "rejecting" | "approved" | "error";
	/** Error message if stage is "error" */
	error: string | null;
	/** Approval session ID from server */
	sessionId: string | null;
	/** Number of approved proposals */
	approvedCount: number;
	/** Number of rejected proposals */
	rejectedCount: number;
}

export interface ApprovalActionResponse {
	success: boolean;
	sessionId?: string;
	approvedCount?: number;
	rejectedCount?: number;
	message?: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook for managing optimizer approval workflow through backend API.
 *
 * All approval/rejection actions go through the backend API endpoints
 * rather than mutating executor state directly.
 *
 * @param projectId - The project ID for API calls
 * @param planExecId - The plan execution ID
 */
export function useOptimizerApproval(
	projectId: string | null,
	planExecId: string | null,
) {
	const [state, setState] = useState<OptimizerApprovalState>({
		proposals: [],
		stage: "idle",
		error: null,
		sessionId: null,
		approvedCount: 0,
		rejectedCount: 0,
	});
	const queryClient = useQueryClient();

	/**
	 * Set proposals for review.
	 */
	const setProposals = useCallback((proposals: OptimizerProposal[]) => {
		setState((prev) => ({
			...prev,
			proposals,
			stage: proposals.length > 0 ? "reviewing" : "idle",
			error: null,
		}));
	}, []);

	/**
	 * Approve selected proposals through the backend API.
	 *
	 * Writes an approval request through backend API rather than
	 * mutating executor state directly.
	 *
	 * @param proposalIds - Array of proposal IDs to approve
	 * @param patches - Optional dependency patches
	 * @param reviewer - Optional reviewer identifier
	 */
	const approve = useCallback(
		async (
			proposalIds: string[],
			patches?: Array<{ workspaceId: string; action: string; dependencyId: string }>,
			reviewer?: string,
		): Promise<ApprovalActionResponse | null> => {
			if (!projectId || !planExecId) return null;

			setState((prev) => ({
				...prev,
				stage: "approving",
				error: null,
			}));

			try {
				const response = await fetch(
					`${API_BASE}/api/projects/${projectId}/optimizer/approve`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							planExecId,
							proposalIds,
							patches: patches ?? [],
							reviewer,
						}),
					},
				);

				if (!response.ok) {
					const text = await response.text().catch(() => "");
					throw new Error(`Approval request failed (${response.status}): ${text}`);
				}

				const data: ApprovalActionResponse = await response.json();

				if (data.success) {
					setState((prev) => ({
						...prev,
						stage: "approved",
						sessionId: data.sessionId ?? null,
						approvedCount: data.approvedCount ?? proposalIds.length,
						proposals: prev.proposals.map((p) =>
							proposalIds.includes(p.id)
								? { ...p, approvalStatus: "approved" as const }
								: p,
						),
					}));

					// Invalidate relevant queries
					queryClient.invalidateQueries({ queryKey: ["scale", "queue-metrics"] });
					queryClient.invalidateQueries({ queryKey: ["plan-executions", projectId] });
				}

				return data;
			} catch (err) {
				const message = String(err);
				setState((prev) => ({
					...prev,
					stage: "error",
					error: message,
				}));
				return { success: false, error: message };
			}
		},
		[projectId, planExecId, queryClient],
	);

	/**
	 * Reject selected proposals through the backend API.
	 *
	 * @param proposalIds - Array of proposal IDs to reject
	 * @param reasons - Optional map of proposal ID to rejection reason
	 * @param reviewer - Optional reviewer identifier
	 */
	const reject = useCallback(
		async (
			proposalIds: string[],
			reasons?: Record<string, string>,
			reviewer?: string,
		): Promise<ApprovalActionResponse | null> => {
			if (!projectId || !planExecId) return null;

			setState((prev) => ({
				...prev,
				stage: "rejecting",
				error: null,
			}));

			try {
				const response = await fetch(
					`${API_BASE}/api/projects/${projectId}/optimizer/reject`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							planExecId,
							proposalIds,
							reasons,
							reviewer,
						}),
					},
				);

				if (!response.ok) {
					const text = await response.text().catch(() => "");
					throw new Error(`Rejection request failed (${response.status}): ${text}`);
				}

				const data: ApprovalActionResponse = await response.json();

				if (data.success) {
					setState((prev) => ({
						...prev,
						stage: "reviewing",
						rejectedCount: data.rejectedCount ?? proposalIds.length,
						proposals: prev.proposals.map((p) =>
							proposalIds.includes(p.id)
								? {
										...p,
										approvalStatus: "rejected" as const,
										rejectionReason: reasons?.[p.id],
									}
								: p,
						),
					}));
				}

				return data;
			} catch (err) {
				const message = String(err);
				setState((prev) => ({
					...prev,
					stage: "error",
					error: message,
				}));
				return { success: false, error: message };
			}
		},
		[projectId, planExecId],
	);

	/**
	 * Reset the approval workflow.
	 */
	const reset = useCallback(() => {
		setState({
			proposals: [],
			stage: "idle",
			error: null,
			sessionId: null,
			approvedCount: 0,
			rejectedCount: 0,
		});
	}, []);

	/**
	 * Get pending proposals (not yet approved or rejected).
	 */
	const getPendingProposals = useCallback((): OptimizerProposal[] => {
		return state.proposals.filter((p) => p.approvalStatus === "pending");
	}, [state.proposals]);

	/**
	 * Get unsafe proposals (those flagged with isUnsafe).
	 */
	const getUnsafeProposals = useCallback((): OptimizerProposal[] => {
		return state.proposals.filter((p) => p.isUnsafe);
	}, [state.proposals]);

	/**
	 * Get proposals by approval status.
	 */
	const getProposalsByStatus = useCallback(
		(status: "pending" | "approved" | "rejected"): OptimizerProposal[] => {
			return state.proposals.filter((p) => p.approvalStatus === status);
		},
		[state.proposals],
	);

	return {
		/** Current approval state */
		state,
		/** Set proposals for review */
		setProposals,
		/** Approve proposals through backend API */
		approve,
		/** Reject proposals through backend API */
		reject,
		/** Reset the workflow */
		reset,
		/** Get pending/unprocessed proposals */
		getPendingProposals,
		/** Get unsafe proposals (highlighted in UI) */
		getUnsafeProposals,
		/** Get proposals by their approval status */
		getProposalsByStatus,
	};
}
