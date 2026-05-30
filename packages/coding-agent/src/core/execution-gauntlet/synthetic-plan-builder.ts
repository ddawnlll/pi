/**
 * Synthetic Plan Builder — P38.1
 *
 * Builds small, deterministic synthetic plans that exercise the real
 * execution control plane without requiring real LLM calls.
 *
 * Plans use synthetic workers with controlled behaviors, and are
 * designed to test specific invariants: FSM, CompletionGate,
 * Lead Agent retry prevention, parallelism, patch transactions, etc.
 */

import type { PlanExecutionConfig, Workspace, WorkspaceQueue } from "../workspace-schema.js";
import { WorkspaceStage } from "../workspace-schema.js";
import type { SyntheticWorkerBehavior } from "./synthetic-worker.js";

// ---------------------------------------------------------------------------
// Gauntlet plan definition
// ---------------------------------------------------------------------------

export interface GauntletPlan {
	/** Unique plan ID (e.g., "G1", "G2") */
	id: string;
	/** Human-readable name */
	name: string;
	/** Execution mode: stable_3 or patch_transaction */
	executionMode: "stable_3" | "patch_transaction";
	/** Category */
	category:
		| "happy-path"
		| "parallelism"
		| "completion-gate"
		| "lead-agent"
		| "stop-continue"
		| "fsm"
		| "patch-transaction"
		| "validation"
		| "visibility";
	/** Workspaces in this plan, with synthetic behavior annotations */
	workspaces: Array<{
		workspaceId: string;
		task: string;
		behavior: SyntheticWorkerBehavior;
		/** Optional dependencies on other workspace IDs */
		dependencies?: string[];
		/** Target command for completion gate */
		targetCommand?: string;
		/** Write set for patch_transaction plans */
		writeSet?: string[];
		/** Seed offset for this workspace (added to plan seed) */
		seedOffset?: number;
		/** Whether this is a final validation workspace */
		isFinalValidation?: boolean;
		/** Dependencies (wait for these workspace IDs to complete) */
		dependsOn?: string[];
	}>;
	/** Max parallel workers for this plan */
	maxParallelWorkspaces?: number;
	/** Expected behavior description */
	purpose: string;
	/** Assertions to check after execution */
	expected: {
		/** All workspaces should complete */
		allComplete?: boolean;
		/** Command history should exist for all workspaces */
		commandHistoryExists?: boolean;
		/** Final validation should pass */
		finalValidationPasses?: boolean;
		/** Plan should complete */
		planCompletes?: boolean;
		/** Max observed active workers should be >= this value */
		minObservedParallelism?: number;
		/** Max observed active workers should be <= this value */
		maxParallelism?: number;
		/** CompletionGate should block at least one workspace */
		completionGateBlocks?: boolean;
		/** LeadAgent should create at least one directive */
		leadDirectiveCreated?: boolean;
		/** LeadAgent should escalate to user */
		userEscalationCreated?: boolean;
		/** Patch should be rejected or handoff */
		patchRejectedOrHandoff?: boolean;
		/** No direct repo mutation from workers */
		noDirectMutation?: boolean;
		/** Stale completion should be ignored */
		staleCompletionIgnored?: boolean;
		/** Plan should NOT complete (failure expected) */
		planDoesNotComplete?: boolean;
		/** No tests found should be classified as failure */
		noTestsFoundClassified?: boolean;
		/** Final repair should succeed */
		finalRepairPasses?: boolean;
		/** Dashboard visibility artifacts present */
		visibilityArtifactsPresent?: boolean;
	};
}

// ---------------------------------------------------------------------------
// Build a WorkspaceQueue from a GauntletPlan
// ---------------------------------------------------------------------------

export function buildPlanQueue(plan: GauntletPlan): WorkspaceQueue {
	const workspaces: Workspace[] = plan.workspaces.map((w) => ({
		id: w.workspaceId,
		task: w.task,
		stage: WorkspaceStage.Pending,
		dependencies: w.dependencies ?? [],
		dependsOn: w.dependsOn ?? [],
		files: w.writeSet ?? [],
		// Retry policy — default allow 1 retry
		retryPolicy: {
			maxRetries: 2,
			retryStrategy: "same_strategy",
			retryDelayMs: 0,
		},
		executionAttempt: 0,
	}));

	const planExecution: PlanExecutionConfig = {
		phase: plan.id,
		title: plan.name,
		maxParallelWorkspaces: plan.maxParallelWorkspaces ?? 3,
		scale: plan.executionMode === "stable_3" ? "stable_3" : "patch_transaction",
		executionMode: plan.executionMode,
		worktree: {
			required: false,
		},
		integrationQueue: {
			required: false,
		},
		validation: {
			required: false,
		},
		interactiveParallelismReview: false,
	};

	return {
		schemaVersion: "2.6.0",
		plan: {
			id: plan.id,
			phase: plan.id,
			title: plan.name,
			description: plan.purpose,
			planExecution,
		},
		workspaces,
	};
}

// ---------------------------------------------------------------------------
// Plan factory functions
// ---------------------------------------------------------------------------

export function buildG1HelloSuccess(): GauntletPlan {
	return {
		id: "G1",
		name: "hello_success",
		executionMode: "stable_3",
		category: "happy-path",
		maxParallelWorkspaces: 1,
		purpose: "Happy path — single workspace completes successfully.",
		workspaces: [
			{
				workspaceId: "G1-hello",
				task: "Create a hello module with tests",
				behavior: "success",
				targetCommand: "npm test",
			},
		],
		expected: {
			allComplete: true,
			commandHistoryExists: true,
			finalValidationPasses: true,
			planCompletes: true,
		},
	};
}

export function buildG2ThreeParallelHello(): GauntletPlan {
	return {
		id: "G2",
		name: "three_parallel_hello_stable_3",
		executionMode: "stable_3",
		category: "parallelism",
		maxParallelWorkspaces: 3,
		purpose: "Verify stable_3 can run 3 independent workspaces in parallel.",
		workspaces: [
			{
				workspaceId: "G2-hello-a",
				task: "Create hello module A",
				behavior: "success",
				targetCommand: "npm test",
				writeSet: ["src/hello-a.ts"],
			},
			{
				workspaceId: "G2-hello-b",
				task: "Create hello module B",
				behavior: "success",
				targetCommand: "npm test",
				writeSet: ["src/hello-b.ts"],
			},
			{
				workspaceId: "G2-hello-c",
				task: "Create hello module C",
				behavior: "success",
				targetCommand: "npm test",
				writeSet: ["src/hello-c.ts"],
			},
		],
		expected: {
			allComplete: true,
			minObservedParallelism: 2,
			maxParallelism: 3,
			planCompletes: true,
		},
	};
}

export function buildG3PatchNonOverlapping(): GauntletPlan {
	return {
		id: "G3",
		name: "patch_transaction_non_overlapping_patches",
		executionMode: "patch_transaction",
		category: "patch-transaction",
		maxParallelWorkspaces: 3,
		purpose: "Verify patch_transaction accepts non-overlapping patches.",
		workspaces: [
			{
				workspaceId: "G3-patch-a",
				task: "Patch file A",
				behavior: "patch_non_overlapping",
				writeSet: ["src/file-a.ts"],
			},
			{
				workspaceId: "G3-patch-b",
				task: "Patch file B",
				behavior: "patch_non_overlapping",
				writeSet: ["src/file-b.ts"],
			},
			{
				workspaceId: "G3-patch-c",
				task: "Patch file C",
				behavior: "patch_non_overlapping",
				writeSet: ["src/file-c.ts"],
			},
		],
		expected: {
			allComplete: true,
			noDirectMutation: true,
			planCompletes: true,
		},
	};
}

export function buildG4PatchWriteSetViolation(): GauntletPlan {
	return {
		id: "G4",
		name: "patch_transaction_write_set_violation",
		executionMode: "patch_transaction",
		category: "patch-transaction",
		maxParallelWorkspaces: 1,
		purpose: "Verify patch transaction rejects or handoffs writeSet violations.",
		workspaces: [
			{
				workspaceId: "G4-patch-violation",
				task: "Patch touching file outside writeSet",
				behavior: "patch_write_set_violation",
				writeSet: ["src/file-a.ts"],
			},
		],
		expected: {
			noDirectMutation: true,
			patchRejectedOrHandoff: true,
			planDoesNotComplete: true,
		},
	};
}

export function buildG5CompletionGateMissingCommand(): GauntletPlan {
	return {
		id: "G5",
		name: "completion_gate_missing_command",
		executionMode: "stable_3",
		category: "completion-gate",
		maxParallelWorkspaces: 1,
		purpose: "Verify CompletionGate blocks when command evidence is missing.",
		workspaces: [
			{
				workspaceId: "G5-missing-cmd",
				task: "Run without command history",
				behavior: "missing_command_history",
				targetCommand: "npm test",
			},
		],
		expected: {
			completionGateBlocks: true,
			leadDirectiveCreated: true,
			planDoesNotComplete: true,
		},
	};
}

export function buildG6NoTestsFoundExitZero(): GauntletPlan {
	return {
		id: "G6",
		name: "no_tests_found_exit_zero",
		executionMode: "stable_3",
		category: "completion-gate",
		maxParallelWorkspaces: 1,
		purpose: 'Verify "No test files found" with exit 0 is treated as failure.',
		workspaces: [
			{
				workspaceId: "G6-no-tests",
				task: "Run tests with wrong path",
				behavior: "no_tests_found_exit_zero",
				targetCommand: "npm test",
			},
		],
		expected: {
			noTestsFoundClassified: true,
			planDoesNotComplete: true,
			leadDirectiveCreated: true,
		},
	};
}

export function buildG7RepeatedRetryLoop(): GauntletPlan {
	return {
		id: "G7",
		name: "repeated_retry_loop",
		executionMode: "stable_3",
		category: "lead-agent",
		maxParallelWorkspaces: 1,
		purpose: "Verify Lead Agent prevents blind retries for same failure.",
		workspaces: [
			{
				workspaceId: "G7-retry-loop",
				task: "Fail repeatedly with same error",
				behavior: "repeat_same_failure",
				targetCommand: "npm test",
			},
		],
		expected: {
			leadDirectiveCreated: true,
			userEscalationCreated: true,
			planDoesNotComplete: true,
		},
	};
}

export function buildG8HalfDoneWorker(): GauntletPlan {
	return {
		id: "G8",
		name: "half_done_worker",
		executionMode: "stable_3",
		category: "validation",
		maxParallelWorkspaces: 1,
		purpose: "Verify worker cannot say COMPLETE after partial implementation.",
		workspaces: [
			{
				workspaceId: "G8-half-done",
				task: "Partial implementation only",
				behavior: "half_done",
				targetCommand: "npm test",
			},
		],
		expected: {
			planDoesNotComplete: true,
			leadDirectiveCreated: true,
		},
	};
}

export function buildG9StopContinueStaleCompletion(): GauntletPlan {
	return {
		id: "G9",
		name: "stop_continue_stale_completion",
		executionMode: "stable_3",
		category: "stop-continue",
		maxParallelWorkspaces: 1,
		purpose: "Verify stale worker completion after stop/continue is ignored.",
		workspaces: [
			{
				workspaceId: "G9-stale",
				task: "Send stale completion after reset",
				behavior: "late_complete_after_reset",
				targetCommand: "npm test",
			},
		],
		expected: {
			staleCompletionIgnored: true,
			planCompletes: true,
		},
	};
}

export function buildG10SucceededToRunningRetry(): GauntletPlan {
	return {
		id: "G10",
		name: "succeeded_to_running_retry_cache_regression",
		executionMode: "stable_3",
		category: "fsm",
		maxParallelWorkspaces: 1,
		purpose: "Verify cached attempt retry does not produce SUCCEEDED -> RUNNING.",
		workspaces: [
			{
				workspaceId: "G10-retry-cache",
				task: "Succeed then retry",
				behavior: "success",
				targetCommand: "npm test",
			},
		],
		expected: {
			allComplete: true,
			planCompletes: true,
		},
	};
}

export function buildG11FinalValidationRepair(): GauntletPlan {
	return {
		id: "G11",
		name: "final_validation_repair",
		executionMode: "stable_3",
		category: "validation",
		maxParallelWorkspaces: 2,
		purpose: "Verify deferred validation + final repair flow.",
		workspaces: [
			{
				workspaceId: "G11-impl",
				task: "Implementation with bug",
				behavior: "validation_fail_then_repair",
				targetCommand: "npm test",
			},
			{
				workspaceId: "G11-repair",
				task: "Fix the bug",
				behavior: "validation_fail_then_repair",
				targetCommand: "npm test",
				isFinalValidation: true,
				dependsOn: ["G11-impl"],
			},
		],
		expected: {
			finalRepairPasses: true,
			planCompletes: true,
		},
	};
}

export function buildG12DashboardVisibility(): GauntletPlan {
	return {
		id: "G12",
		name: "dashboard_visibility_artifacts",
		executionMode: "stable_3",
		category: "visibility",
		maxParallelWorkspaces: 1,
		purpose: "Verify report/dashboard data is produced for failures.",
		workspaces: [
			{
				workspaceId: "G12-visibility",
				task: "Fail with completion gate block",
				behavior: "missing_command_history",
				targetCommand: "npm test",
			},
		],
		expected: {
			visibilityArtifactsPresent: true,
			completionGateBlocks: true,
			planDoesNotComplete: true,
		},
	};
}

// ---------------------------------------------------------------------------
// All plans registry
// ---------------------------------------------------------------------------

export const ALL_PLANS: GauntletPlan[] = [
	buildG1HelloSuccess(),
	buildG2ThreeParallelHello(),
	buildG3PatchNonOverlapping(),
	buildG4PatchWriteSetViolation(),
	buildG5CompletionGateMissingCommand(),
	buildG6NoTestsFoundExitZero(),
	buildG7RepeatedRetryLoop(),
	buildG8HalfDoneWorker(),
	buildG9StopContinueStaleCompletion(),
	buildG10SucceededToRunningRetry(),
	buildG11FinalValidationRepair(),
	buildG12DashboardVisibility(),
];

export function getPlansByCategory(category: GauntletPlan["category"]): GauntletPlan[] {
	return ALL_PLANS.filter((p) => p.category === category);
}

export function getPlansByExecutionMode(mode: GauntletPlan["executionMode"]): GauntletPlan[] {
	return ALL_PLANS.filter((p) => p.executionMode === mode);
}
