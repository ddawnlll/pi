/**
 * useParallelismPreview — Hook for parallelism preview workflow
 *
 * Acceptance Criteria (workspace 7.F):
 * 1. Dashboard types cover parallelism preview responses
 * 2. Hook can validate, patch, revalidate, approve, and run
 * 3. Hook handles validation errors and stale previews
 * 4. Existing plan upload hook remains compatible
 */

import { useState, useCallback, useRef } from "react";
import type {
	ValidateWithPreviewResponse,
	DependencyPatch,
	PreviewResult,
	BatchPlanResult,
} from "../types";

const API_BASE = "";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

/** Current stage in the parallelism preview workflow. */
export type PreviewWorkflowStage =
	| "idle"
	| "validating"
	| "validated"
	| "patching"
	| "patched"
	| "approving"
	| "approved"
	| "running"
	| "error";

/** Stale reason when a preview is no longer valid. */
export type StaleReason =
	| "plan_content_changed"
	| "patches_applied_out_of_order"
	| "server_rejected_patch"
	| "approval_expired";

/** Error info captured when validation or patching fails. */
export interface PreviewError {
	/** When the error occurred (epoch ms) */
	timestamp: number;
	/** Stage where the error originated */
	stage: PreviewWorkflowStage;
	/** Human-readable error message */
	message: string;
	/** Whether this error is recoverable (user can retry) */
	recoverable: boolean;
	/** Detailed validation errors from server */
	validationErrors?: string[];
}

/** Checker agent analysis response from the server. */
export interface CheckerAgentResponse {
	success: boolean;
	analysis?: {
		verdict: "safe" | "risky" | "blocked";
		summary: string;
		findings: Array<{
			severity: "critical" | "warning" | "info";
			category: string;
			title: string;
			description: string;
			suggestion?: string;
			workspaceIds?: string[];
		}>;
		narrative: string;
		cached: boolean;
		analyzedAt: string;
	};
	error?: string;
}

/** Full state of the parallelism preview workflow. */
export interface ParallelismPreviewState {
	/** Current workflow stage */
	stage: PreviewWorkflowStage;
	/** Validation response from the server (includes batchPlan, suggestedFixes, etc.) */
	validationResponse: ValidateWithPreviewResponse | null;
	/** Last applied patches (for revalidation tracking) */
	appliedPatches: DependencyPatch[];
	/** Preview result after applying patches */
	previewResult: PreviewResult | null;
	/** Whether the current preview is stale and needs revalidation */
	isStale: boolean;
	/** Reason the preview is stale */
	staleReason: StaleReason | null;
	/** Current error, if any */
	error: PreviewError | null;
	/** Whether the plan has been approved for execution */
	isApproved: boolean;
	/** Plan execution ID after successful run */
	planExecutionId: string | null;
	/** Fingerprint of the plan content used for the last successful validation */
	validatedContentFingerprint: string | null;
	/** Checker agent analysis state */
	checkerAnalysis: {
		status: "idle" | "running" | "complete" | "failed";
		result: CheckerAgentResponse["analysis"] | null;
		error?: string;
	};
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function validateWithPreview(
	projectId: string,
	planContent: string,
): Promise<ValidateWithPreviewResponse> {
	try {
		const response = await fetch(
			`${API_BASE}/api/projects/${projectId}/plans/validate`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planContent, includePreview: true }),
			},
		);
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			return {
				success: false,
				errors: [`Validation request failed (${response.status}): ${text}`],
			};
		}
		return await response.json();
	} catch (err) {
		return {
			success: false,
			errors: [String(err)],
		};
	}
}

async function patchPreview(
	projectId: string,
	planContent: string,
	patches: DependencyPatch[],
): Promise<PreviewResult> {
	try {
		const response = await fetch(
			`${API_BASE}/api/projects/${projectId}/plans/preview`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planContent, patches }),
			},
		);
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			return {
				success: false,
				errors: [`Preview patch request failed (${response.status}): ${text}`],
				appliedPatches: [],
				rejectedPatches: [],
			};
		}
		return await response.json();
	} catch (err) {
		return {
			success: false,
			errors: [String(err)],
			appliedPatches: [],
			rejectedPatches: [],
		};
	}
}

async function enqueuePlan(
	projectId: string,
	planContent: string,
	planFileName?: string,
): Promise<{ success: boolean; entryId?: string; errors?: string[] }> {
	try {
		const response = await fetch(
			`${API_BASE}/api/projects/${projectId}/queue/enqueue`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planContent, planFileName, queueAfterCurrent: true }),
			},
		);
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			return {
				success: false,
				errors: [`Queue request failed (${response.status}): ${text}`],
			};
		}
		const json = await response.json();
		// The enqueue API returns { success: true, added: [entryId], errors }
		// success is always true even when validation fails; check added[] length.
		const added = json.added as string[] | undefined;
		return {
			success: (added?.length ?? 0) > 0,
			entryId: added?.[0],
			errors: json.errors,
		};
	} catch (err) {
		return {
			success: false,
			errors: [String(err)],
		};
	}
}

async function runCheckerAnalysis(
	projectId: string,
	planContent: string,
): Promise<CheckerAgentResponse> {
	try {
		const response = await fetch(
			`${API_BASE}/api/projects/${projectId}/plans/check`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planContent }),
			},
		);
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			return {
				success: false,
				error: `Checker agent request failed (${response.status}): ${text}`,
			};
		}
		return await response.json();
	} catch (err) {
		return {
			success: false,
			error: String(err),
		};
	}
}

async function approveAndRun(
	projectId: string,
	planContent: string,
	patches: DependencyPatch[],
	safetyOverrides?: Record<string, boolean>,
): Promise<{ success: boolean; planExecutionId?: string; errors?: string[] }> {
	try {
		const response = await fetch(
			`${API_BASE}/api/projects/${projectId}/plans/run`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planContent, patches, approved: true, safetyOverrides }),
			},
		);
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			return {
				success: false,
				errors: [`Run request failed (${response.status}): ${text}`],
			};
		}
		return await response.json();
	} catch (err) {
		return {
			success: false,
			errors: [String(err)],
		};
	}
}

// ---------------------------------------------------------------------------
// Content fingerprinting
// ---------------------------------------------------------------------------

/**
 * Simple fingerprint for plan content — used to detect stale previews.
 * In production this could be a hash; for now we use length + first/last chars.
 */
function contentFingerprint(content: string): string {
	if (!content) return "empty";
	return `${content.length}:${content.charCodeAt(0) ?? 0}:${content.charCodeAt(content.length - 1) ?? 0}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook for the parallelism preview workflow: validate, patch, revalidate, approve, run.
 *
 * Manages the full lifecycle:
 * 1. validate() — POST to /plans/validate with includePreview, get batchPlan + suggestedFixes
 * 2. patch() — PATCH to /plans/preview with dependency patches
 * 3. revalidate() — re-run validate after patching (or auto on stale detection)
 * 4. approve() — mark the plan as approved for execution
 * 5. run() — POST to /plans/run with approved flag and patches
 *
 * Handles:
 * - Validation errors (captured in state.error)
 * - Stale previews (detected when planContent fingerprint changes vs. validated one)
 * - Rejected patches (tracked in previewResult.rejectedPatches)
 *
 * @param projectId - The project ID for API calls (null disables the hook)
 * @returns Hook state and action functions
 */
export function useParallelismPreview(projectId: string | null) {
	const [state, setState] = useState<ParallelismPreviewState>({
		stage: "idle",
		validationResponse: null,
		appliedPatches: [],
		previewResult: null,
		isStale: false,
		staleReason: null,
		error: null,
		isApproved: false,
		planExecutionId: null,
		validatedContentFingerprint: null,
		checkerAnalysis: {
			status: "idle",
			result: null,
		},
	});

	// Track the last plan content string for stale detection
	const lastPlanContentRef = useRef<string | null>(null);

	/**
	 * Validate a plan and retrieve parallelism preview data.
	 *
	 * @param planContent - The plan JSON content to validate
	 * @returns The validation response, or null if projectId is missing
	 */
	const validate = useCallback(
		async (planContent: string): Promise<ValidateWithPreviewResponse | null> => {
			if (!projectId) return null;

			setState((prev) => ({
				...prev,
				stage: "validating",
				error: null,
				isStale: false,
				staleReason: null,
			}));

			lastPlanContentRef.current = planContent;

			try {
				const response = await validateWithPreview(projectId, planContent);

				if (!response.success) {
					setState((prev) => ({
						...prev,
						stage: "error",
						error: {
							timestamp: Date.now(),
							stage: "validating",
							message: response.errors?.join("; ") ?? "Validation failed",
							recoverable: true,
							validationErrors: response.errors,
						},
						validationResponse: response,
					}));
					return response;
				}

				setState((prev) => ({
					...prev,
					stage: "validated",
					validationResponse: response,
					appliedPatches: [],
					previewResult: null,
					isApproved: false,
					planExecutionId: null,
					validatedContentFingerprint: contentFingerprint(planContent),
					isStale: false,
					staleReason: null,
					error: null,
					checkerAnalysis: {
						status: "running",
						result: null,
					},
				}));

				// Fire checker agent analysis in background
				runCheckerAnalysis(projectId, planContent).then((checkerResponse) => {
					setState((prev) => ({
						...prev,
						checkerAnalysis: {
							status: checkerResponse.success ? "complete" : "failed",
							result: checkerResponse.analysis ?? null,
							error: checkerResponse.success ? undefined : checkerResponse.error,
						},
					}));
				});

				return response;
			} catch (err) {
				setState((prev) => ({
					...prev,
					stage: "error",
					error: {
						timestamp: Date.now(),
						stage: "validating",
						message: String(err),
						recoverable: true,
					},
				}));
				return null;
			}
		},
		[projectId],
	);

	/**
	 * Apply dependency patches to the plan preview without starting execution.
	 *
	 * Marks the preview as stale after patching so the caller knows to revalidate.
	 *
	 * @param planContent - The plan JSON content
	 * @param patches - Dependency patches to apply
	 * @returns The preview result, or null if projectId is missing / not yet validated
	 */
	const patch = useCallback(
		async (
			planContent: string,
			patches: DependencyPatch[],
		): Promise<PreviewResult | null> => {
			if (!projectId) return null;
			if (state.stage !== "validated" && state.stage !== "patched" && state.stage !== "approved") {
				// Must validate first
				setState((prev) => ({
					...prev,
					error: {
						timestamp: Date.now(),
						stage: "patching",
						message: "Plan must be validated before patching",
						recoverable: true,
					},
				}));
				return null;
			}

			// Check if plan content has changed since last validation (stale detection)
			const fp = contentFingerprint(planContent);
			if (
				state.validatedContentFingerprint !== null &&
				fp !== state.validatedContentFingerprint
			) {
				setState((prev) => ({
					...prev,
					isStale: true,
					staleReason: "plan_content_changed",
					error: {
						timestamp: Date.now(),
						stage: "patching",
						message:
							"Plan content has changed since last validation. Please revalidate before patching.",
						recoverable: true,
					},
				}));
				return null;
			}

			setState((prev) => ({ ...prev, stage: "patching", error: null }));

			try {
				const result = await patchPreview(projectId, planContent, patches);

				if (!result.success) {
					// Determine staleness: if the server rejected patches, mark stale
					const hasServerRejections =
						result.rejectedPatches.length > 0;

					setState((prev) => ({
						...prev,
						stage: "error",
						previewResult: result,
						isStale: hasServerRejections,
						staleReason: hasServerRejections
							? "server_rejected_patch"
							: null,
						error: {
							timestamp: Date.now(),
							stage: "patching",
							message: result.errors.join("; ") || "Patch preview failed",
							recoverable: true,
							validationErrors: result.errors,
						},
					}));
					return result;
				}

				const newAppliedPatches = [
					...state.appliedPatches,
					...result.appliedPatches,
				];

				setState((prev) => ({
					...prev,
					stage: "patched",
					previewResult: result,
					appliedPatches: newAppliedPatches,
					isStale: hasValidationErrors(result),
					staleReason: hasValidationErrors(result)
						? "patches_applied_out_of_order"
						: null,
					// Patches may change approval state — reset approval
					isApproved: false,
				}));

				return result;
			} catch (err) {
				setState((prev) => ({
					...prev,
					stage: "error",
					error: {
						timestamp: Date.now(),
						stage: "patching",
						message: String(err),
						recoverable: true,
					},
				}));
				return null;
			}
		},
		[projectId, state.stage, state.appliedPatches, state.validatedContentFingerprint],
	);

	/**
	 * Revalidate the plan after patching.
	 *
	 * Re-runs validation with the patched plan content so the preview is fresh.
	 *
	 * @param planContent - The (possibly patched) plan JSON content
	 * @returns The new validation response, or null
	 */
	const revalidate = useCallback(
		async (planContent: string): Promise<ValidateWithPreviewResponse | null> => {
			if (!projectId) return null;

			const result = await validate(planContent);

			// After revalidation, restore applied patches knowledge if successful
			if (result?.success) {
				setState((prev) => ({
					...prev,
					isStale: false,
					staleReason: null,
				}));
			}

			return result;
		},
		[projectId, validate],
	);

	/**
	 * Approve the plan for execution.
	 *
	 * Only works when the plan is validated and not stale.
	 * Plans that require interactive approval (requiresApproval=true) must be
	 * explicitly approved before calling run().
	 *
	 * @returns Whether approval was successful
	 */
	const approve = useCallback((): boolean => {
		if (state.stage !== "validated" && state.stage !== "patched" && state.stage !== "approved") {
			setState((prev) => ({
				...prev,
				error: {
					timestamp: Date.now(),
					stage: "approving",
					message: "Plan must be validated before approval",
					recoverable: true,
				},
			}));
			return false;
		}

		if (state.isStale) {
			setState((prev) => ({
				...prev,
				error: {
					timestamp: Date.now(),
					stage: "approving",
					message:
						state.staleReason === "plan_content_changed"
							? "Plan content has changed since validation. Revalidate before approving."
							: "Preview is stale. Revalidate before approving.",
					recoverable: true,
				},
			}));
			return false;
		}

		setState((prev) => ({
			...prev,
			stage: "approved",
			isApproved: true,
			error: null,
		}));

		return true;
	}, [state.stage, state.isStale, state.staleReason]);

	/**
	 * Run the plan after approval.
	 *
	 * Only works when the plan is approved. Sends the plan content along with
	 * any applied dependency patches.
	 *
	 * @param planContent - The plan JSON content
	 * @returns The execution result with planExecutionId, or null
	 */
	const run = useCallback(
		async (
			planContent: string,
			safetyOverrides?: Record<string, boolean>,
		): Promise<{ success: boolean; planExecutionId?: string; errors?: string[] } | null> => {
			if (!projectId) return null;

			if (!state.isApproved) {
				// Check if the plan requires explicit approval
				const requiresApproval =
					state.validationResponse?.requiresApproval ?? false;

				if (requiresApproval) {
					setState((prev) => ({
						...prev,
						error: {
							timestamp: Date.now(),
							stage: "running",
							message:
								"Plan requires interactive approval before execution. Call approve() first.",
							recoverable: true,
						},
					}));
					return null;
				}

				// Non-interactive plans: auto-approve
				setState((prev) => ({ ...prev, isApproved: true }));
			}

			if (state.isStale) {
				setState((prev) => ({
					...prev,
					error: {
						timestamp: Date.now(),
						stage: "running",
						message: "Preview is stale. Revalidate before running.",
						recoverable: true,
					},
				}));
				return null;
			}

			setState((prev) => ({ ...prev, stage: "running", error: null }));

			try {
				const result = await approveAndRun(
					projectId,
					planContent,
					state.appliedPatches,
					safetyOverrides,
				);

				if (!result.success) {
					setState((prev) => ({
						...prev,
						stage: "error",
						error: {
							timestamp: Date.now(),
							stage: "running",
							message: result.errors?.join("; ") ?? "Run failed",
							recoverable: true,
							validationErrors: result.errors,
						},
					}));
					return result;
				}

				setState((prev) => ({
					...prev,
					planExecutionId: result.planExecutionId ?? null,
					error: null,
				}));

				return result;
			} catch (err) {
				setState((prev) => ({
					...prev,
					stage: "error",
					error: {
						timestamp: Date.now(),
						stage: "running",
						message: String(err),
						recoverable: true,
					},
				}));
				return null;
			}
		},
		[projectId, state.isApproved, state.isStale, state.appliedPatches, state.validationResponse],
	);

	/**
	 * Queue the plan for execution after the current plan finishes.
	 *
	 * Enqueues the plan via the server queue API instead of running it immediately.
	 * The plan must be validated first.
	 *
	 * @param planContent - The plan JSON content
	 * @param planFileName - Optional plan file name for display
	 * @returns The queue result with entryId, or null
	 */
	const queuePlan = useCallback(
		async (
			planContent: string,
			planFileName?: string,
		): Promise<{ success: boolean; entryId?: string; errors?: string[] } | null> => {
			if (!projectId) return null;

			if (state.stage !== "validated" && state.stage !== "patched" && state.stage !== "approved") {
				setState((prev) => ({
					...prev,
					error: {
						timestamp: Date.now(),
						stage: "running",
						message: "Plan must be validated before queuing",
						recoverable: true,
					},
				}));
				return null;
			}

			if (state.isStale) {
				setState((prev) => ({
					...prev,
					error: {
						timestamp: Date.now(),
						stage: "running",
						message: "Preview is stale. Revalidate before queuing.",
						recoverable: true,
					},
				}));
				return null;
			}

			try {
				const result = await enqueuePlan(projectId, planContent, planFileName);

				if (!result.success) {
					setState((prev) => ({
						...prev,
						error: {
							timestamp: Date.now(),
							stage: "running",
							message: result.errors?.join("; ") ?? "Queue failed",
							recoverable: true,
							validationErrors: result.errors,
						},
					}));
					return result;
				}

				return result;
			} catch (err) {
				setState((prev) => ({
					...prev,
					error: {
						timestamp: Date.now(),
						stage: "running",
						message: String(err),
						recoverable: true,
					},
				}));
				return null;
			}
		},
		[projectId, state.stage, state.isStale],
	);

	/**
	 * Reset the workflow to the initial idle state.
	 */
	const reset = useCallback((): void => {
		setState({
			stage: "idle",
			validationResponse: null,
			appliedPatches: [],
			previewResult: null,
			isStale: false,
			staleReason: null,
			error: null,
			isApproved: false,
			planExecutionId: null,
			validatedContentFingerprint: null,
			checkerAnalysis: {
				status: "idle",
				result: null,
			},
		});
		lastPlanContentRef.current = null;
	}, []);

	/**
	 * Clear the current error, allowing retry.
	 */
	const clearError = useCallback((): void => {
		setState((prev) => ({
			...prev,
			error: null,
		}));
	}, []);

	return {
		/** Current workflow state */
		state,
		/** Validate the plan and get parallelism preview */
		validate,
		/** Apply dependency patches to the preview */
		patch,
		/** Revalidate the plan (e.g. after content change) */
		revalidate,
		/** Approve the plan for execution */
		approve,
		/** Run the approved plan */
		run,
		/** Queue the plan to run after the current plan */
		queuePlan,
		/** Run checker agent analysis on the plan */
		runCheckerAnalysis: (planContent: string) => runCheckerAnalysis(projectId!, planContent),
		/** Reset to initial idle state */
		reset,
		/** Clear current error */
		clearError,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a PreviewResult has validation-level errors that indicate staleness.
 *
 * @param result - Preview result to check
 * @returns Whether the result has validation errors suggesting staleness
 */
function hasValidationErrors(result: PreviewResult): boolean {
	// If there are errors beyond what's in rejectedPatches, the patched state
	// may be inconsistent and should be considered stale
	return result.errors.length > result.rejectedPatches.length;
}

/**
 * Re-export batch plan computation types for convenience.
 */
export type {
	ValidateWithPreviewResponse,
	DependencyPatch,
	PreviewResult,
	BatchPlanResult,
} from "../types";
