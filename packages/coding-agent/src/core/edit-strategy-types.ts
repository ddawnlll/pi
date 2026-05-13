/**
 * Edit Strategy Types - Shared type definitions for the adaptive edit strategy system.
 *
 * P4.5 introduces three edit strategy modes (Token Saving, Hybrid, Speed)
 * with configurable thresholds, failure tracking, and enforcement modes.
 */

// ---------------------------------------------------------------------------
// Enums & Core Types
// ---------------------------------------------------------------------------

/**
 * The edit strategy mode controlling how aggressively full rewrites are allowed.
 */
export type EditStrategyMode = "token_saving" | "hybrid" | "speed";

/**
 * How strictly the policy is enforced.
 * - "enforce": Blocks the operation and returns an error.
 * - "warn": Allows the operation but emits a warning/audit event.
 */
export type EnforcementMode = "enforce" | "warn";

/**
 * Reason codes returned by the policy to explain its decisions.
 */
export type EditStrategyReasonCode =
	| "new_file_write_allowed"
	| "manifest_marked_rewrite_allowed"
	| "existing_file_blocked_size"
	| "existing_file_blocked_bytes"
	| "tsx_component_patch_required"
	| "output_budget_pass_full_rewrite"
	| "speed_mode_full_rewrite"
	| "speed_mode_warn_above_soft_limit"
	| "hard_safety_gate_blocked"
	| "generated_file_rewrite_blocked";

/**
 * Result of an edit strategy policy check.
 */
export interface EditStrategyResult {
	/** Whether the operation is allowed to proceed */
	allowed: boolean;
	/** Whether a full rewrite is allowed (vs patch-only) */
	writeAllowed: boolean;
	/** The reason code explaining the decision */
	reasonCode: EditStrategyReasonCode;
	/** Human-readable reason */
	reason: string;
	/** Whether this is a warning rather than a hard block (speed mode above soft limit) */
	isWarning?: boolean;
}

/**
 * Metadata about a generated file manifest entry.
 */
export interface GeneratedManifestEntry {
	/** The relative file path */
	path: string;
	/** Whether the manifest explicitly marks this file as rewrite-allowed */
	rewriteAllowed: boolean;
}

// ---------------------------------------------------------------------------
// Mode-Specific Thresholds
// ---------------------------------------------------------------------------

/**
 * Token Saving mode thresholds.
 * Strict patch-first: full rewrites only allowed for very small files.
 */
export interface TokenSavingThresholds {
	/** Enforcement mode for token saving policies */
	enforcementMode: EnforcementMode;
	/** Max lines for existing files to allow full rewrite */
	existingFileFullRewriteMaxLines: number;
	/** Max bytes for existing files to allow full rewrite */
	existingFileFullRewriteMaxBytes: number;
	/** TSX/JSX components above this line count require targeted patch mode */
	tsxComponentPatchRequiredLines: number;
	/** Max generated output bytes without explicit override */
	maxGeneratedOutputBytesWithoutOverride: number;
	/** Same-file edit failure threshold before handoff */
	sameFileEditFailureHandoffThreshold: number;
	/** Whether truncation forces fallback to patch mode */
	truncationForcesFallback: boolean;
	/** Whether exact-match failure counts toward handoff */
	exactMatchFailureCountsTowardHandoff: boolean;
}

/**
 * Hybrid mode thresholds.
 * Default mode: allows full rewrites for moderate-sized files,
 * prefers patches for very large files.
 */
export interface HybridThresholds {
	/** Enforcement mode for hybrid policies */
	enforcementMode: EnforcementMode;
	/** Max lines for full rewrite when output budget passes */
	existingFileFullRewriteMaxLines: number;
	/** Max bytes for full rewrite when output budget passes */
	existingFileFullRewriteMaxBytes: number;
	/** TSX/JSX components above this line count require targeted patch mode */
	tsxComponentPatchRequiredLines: number;
	/** Max generated output bytes without explicit override */
	maxGeneratedOutputBytesWithoutOverride: number;
	/** Same-file edit failure threshold before handoff */
	sameFileEditFailureHandoffThreshold: number;
	/** Whether truncation forces fallback to patch mode */
	truncationForcesFallback: boolean;
	/** Whether exact-match failure counts toward handoff */
	exactMatchFailureCountsTowardHandoff: boolean;
}

/**
 * Speed mode thresholds.
 * Prioritizes fast implementation; token-saving restrictions disabled
 * but hard safety gates remain active.
 */
export interface SpeedThresholds {
	/** Enforcement mode (speed defaults to "warn") */
	enforcementMode: EnforcementMode;
	/** Whether token-saving edit restrictions are enabled (false in speed mode) */
	tokenSavingEditRestrictionsEnabled: boolean;
	/** Soft limit: warn when existing files exceed this line count */
	existingFileFullRewriteSoftLimitLines: number;
	/** Require explicit override above this line count */
	requireOverrideAboveLines: number;
	/** Same-file edit failure threshold before handoff */
	sameFileEditFailureHandoffThreshold: number;
	/** Whether truncation forces fallback to patch mode */
	truncationForcesFallback: boolean;
	/** Whether exact-match failure counts toward handoff */
	exactMatchFailureCountsTowardHandoff: boolean;
	/** Hard safety gates are always enabled in speed mode */
	hardSafetyGatesEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Full Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for an edit strategy policy instance.
 */
export interface EditStrategyPolicyConfig {
	/** The strategy mode (defaults to "hybrid") */
	mode: EditStrategyMode;
	/** Token-saving mode: max lines for existing files to allow edits */
	tokenSavingMaxLines: number;
	/** Token-saving mode: max bytes for existing files to allow edits */
	tokenSavingMaxBytes: number;
	/** Hybrid mode: max lines for full rewrite when output budget passes */
	hybridBudgetMaxLines: number;
	/** Hybrid mode: max bytes for full rewrite when output budget passes */
	hybridBudgetMaxBytes: number;
	/** Speed mode: max lines for full rewrite (hard gate) */
	speedMaxLines: number;
	/** Token-saving mode: TSX components above this line count require patch mode */
	tokenSavingTsxPatchRequiredLines: number;
	/** Hybrid mode: TSX components above this line count require patch mode */
	hybridTsxPatchRequiredLines: number;
	/** Same-file edit failure handoff threshold (default 2) */
	sameFileEditFailureHandoffThreshold: number;
	/** Whether truncation forces fallback in all modes */
	truncationForcesFallback: boolean;
	/** Whether exact-match failure counts toward handoff */
	exactMatchFailureCountsTowardHandoff: boolean;
	/** Generated file manifest entries */
	generatedManifest: GeneratedManifestEntry[];
}

// ---------------------------------------------------------------------------
// Default Thresholds
// ---------------------------------------------------------------------------

/** Default Token Saving thresholds per the P4.5 spec. */
export const DEFAULT_TOKEN_SAVING_THRESHOLDS: TokenSavingThresholds = {
	enforcementMode: "enforce",
	existingFileFullRewriteMaxLines: 200,
	existingFileFullRewriteMaxBytes: 8000,
	tsxComponentPatchRequiredLines: 300,
	maxGeneratedOutputBytesWithoutOverride: 12000,
	sameFileEditFailureHandoffThreshold: 2,
	truncationForcesFallback: true,
	exactMatchFailureCountsTowardHandoff: true,
};

/** Default Hybrid thresholds per the P4.5 spec. */
export const DEFAULT_HYBRID_THRESHOLDS: HybridThresholds = {
	enforcementMode: "enforce",
	existingFileFullRewriteMaxLines: 1000,
	existingFileFullRewriteMaxBytes: 40000,
	tsxComponentPatchRequiredLines: 1000,
	maxGeneratedOutputBytesWithoutOverride: 50000,
	sameFileEditFailureHandoffThreshold: 2,
	truncationForcesFallback: true,
	exactMatchFailureCountsTowardHandoff: true,
};

/** Default Speed thresholds per the P4.5 spec. */
export const DEFAULT_SPEED_THRESHOLDS: SpeedThresholds = {
	enforcementMode: "warn",
	tokenSavingEditRestrictionsEnabled: false,
	existingFileFullRewriteSoftLimitLines: 1000,
	requireOverrideAboveLines: 1000,
	sameFileEditFailureHandoffThreshold: 2,
	truncationForcesFallback: true,
	exactMatchFailureCountsTowardHandoff: true,
	hardSafetyGatesEnabled: true,
};

// ---------------------------------------------------------------------------
// Edit Attempt Tracking Types
// ---------------------------------------------------------------------------

/**
 * Type of edit attempt.
 */
export type EditAttemptType = "full_write" | "targeted_edit" | "patch_plan" | "restore";

/**
 * Type of edit failure.
 */
export type EditFailureType =
	| "truncation"
	| "exact_match_failed"
	| "output_too_large"
	| "malformed_patch"
	| "validation_failed_after_edit"
	| "restore_after_failed_write";

/**
 * Record of a single edit attempt.
 */
export interface EditAttemptRecord {
	/** Unique attempt ID */
	id: string;
	/** Plan execution ID */
	planExecId: string;
	/** Workspace ID */
	workspaceId: string;
	/** File path (relative) */
	filePath: string;
	/** Type of edit attempt */
	attemptType: EditAttemptType;
	/** Failure type (if failed) */
	failureType?: EditFailureType;
	/** Whether this attempt succeeded */
	succeeded: boolean;
	/** Timestamp of the attempt */
	timestamp: number;
	/** Error message from the tool (if failed) */
	errorMessage?: string;
}

/**
 * Summary of edit attempts for a specific file.
 */
export interface FileEditSummary {
	/** File path (relative) */
	filePath: string;
	/** Total attempts */
	totalAttempts: number;
	/** Failed attempts */
	failedAttempts: number;
	/** Attempt records */
	attempts: EditAttemptRecord[];
	/** Whether this file has reached the handoff threshold */
	reachedHandoffThreshold: boolean;
}

// ---------------------------------------------------------------------------
// Failure Handoff Types
// ---------------------------------------------------------------------------

/**
 * Handoff payload when a workspace is blocked due to repeated edit failures.
 */
export interface EditFailureHandoffPayload {
	/** File path that caused the handoff */
	filePath: string;
	/** Selected edit mode at time of handoff */
	selectedEditMode: EditStrategyMode;
	/** List of failed strategy attempts */
	failedStrategyList: Array<{
		attemptType: EditAttemptType;
		failureType: EditFailureType;
		errorMessage?: string;
	}>;
	/** Last tool error message */
	lastToolError: string | undefined;
	/** Pre-edit snapshot path */
	preEditSnapshotPath: string | undefined;
	/** Current unified diff */
	currentDiff: string;
	/** Attempted patch summary */
	attemptedPatchSummary: string;
	/** Suggested manual fix steps */
	suggestedManualFixSteps: string[];
	/** Suggested resume instruction */
	suggestedResumeInstruction: string;
}

// ---------------------------------------------------------------------------
// Audit Event Types
// ---------------------------------------------------------------------------

/**
 * Edit strategy audit event types.
 */
export type EditAuditEventType =
	| "edit_strategy_selected"
	| "edit_strategy_blocked"
	| "full_rewrite_attempted"
	| "edit_truncation_detected"
	| "edit_exact_match_failed"
	| "patch_fallback_forced"
	| "edit_failure_handoff"
	| "token_waste_prevented";

/**
 * Payload for edit strategy audit events.
 */
export interface EditAuditEventPayload {
	/** Event type */
	eventType: EditAuditEventType;
	/** Plan execution ID */
	planExecId: string;
	/** Workspace ID */
	workspaceId: string;
	/** File path (relative) */
	filePath: string;
	/** Edit mode */
	mode: EditStrategyMode;
	/** Strategy attempted */
	strategy?: EditAttemptType;
	/** Line count of the file */
	lineCount?: number;
	/** Byte size of the file */
	byteSize?: number;
	/** Attempt number */
	attemptNumber?: number;
	/** Failure type */
	failureType?: EditFailureType;
	/** Reason code */
	reasonCode?: EditStrategyReasonCode;
	/** Timestamp */
	timestamp: number;
}
