/**
 * V5 Runtime Enablement — Execution Policy Mode
 *
 * Central type definitions for runtime policy mode separation.
 * Distinguishes between manual (no-plan), legacy v4.1.1, and PlanSpec locked modes.
 *
 * The mode must be available to:
 * - Agent session / bash tool execution
 * - CommandPolicyEngine mode boundary
 * - PlanLock admission
 * - WorkerPacket generation
 * - CompletionGate V2
 * - Read-model population
 */

// ---------------------------------------------------------------------------
// Execution Policy Mode
// ---------------------------------------------------------------------------

/**
 * Runtime execution policy mode.
 */
export type ExecutionPolicyMode = "manual_no_plan" | "legacy_v411" | "planspec_locked";

/**
 * Labels for each mode (human-readable display).
 */
export const EXECUTION_POLICY_MODE_LABELS: Record<ExecutionPolicyMode, string> = {
	manual_no_plan: "Manual (no plan)",
	legacy_v411: "Legacy v4.1.1",
	planspec_locked: "PlanSpec v5 Locked",
};

// ---------------------------------------------------------------------------
// Execution Policy Context
// ---------------------------------------------------------------------------

/**
 * Runtime execution policy context.
 *
 * Attached to the agent session or tool context to determine:
 * - What policy checks apply
 * - Whether PlanLock is required
 * - Whether WorkerPacket is required
 * - Which command policy defaults apply
 * - Which completion gate rules apply
 */
export interface ExecutionPolicyContext {
	/** The active execution policy mode */
	mode: ExecutionPolicyMode;

	/** PlanSpec version if in planspec_locked mode (e.g., "5.0.0") */
	planSpecVersion?: string;

	/** Plan lock hash if PlanLock has been admitted */
	planLockHash?: string;

	/** Workspace lock hash for the current workspace */
	workspaceLockHash?: string;

	/** Legacy template version if in legacy_v411 mode */
	legacyTemplateVersion?: string;

	/** True when user is in a manual editing session (interactive mode, no active plan) */
	manualSession?: boolean;

	/** The PlanSpec v5 template/parsed object (present in planspec_locked mode) */
	planSpecJson?: string;
}

// ---------------------------------------------------------------------------
// Default Context Factory
// ---------------------------------------------------------------------------

/**
 * Create a default execution policy context for manual mode.
 * This is the fallback when no plan is active.
 */
export function createDefaultPolicyContext(): ExecutionPolicyContext {
	return {
		mode: "manual_no_plan",
		manualSession: true,
	};
}

/**
 * Create an execution policy context for legacy v4.1.1 mode.
 * Preserves existing legacy behavior.
 */
export function createLegacyPolicyContext(templateVersion?: string): ExecutionPolicyContext {
	return {
		mode: "legacy_v411",
		legacyTemplateVersion: templateVersion ?? "4.1.1",
	};
}

/**
 * Create an execution policy context for PlanSpec locked mode.
 * Requires a plan spec version and optionally lock hashes.
 */
export function createPlanspecPolicyContext(
	planSpecVersion: string,
	overrides?: Partial<Pick<ExecutionPolicyContext, "planLockHash" | "workspaceLockHash" | "planSpecJson">>,
): ExecutionPolicyContext {
	return {
		mode: "planspec_locked",
		planSpecVersion,
		...overrides,
	};
}
