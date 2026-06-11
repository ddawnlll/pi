/**
 * P44.6.04 — Mode Diagnostic Model
 *
 * Defines diagnostic types for mode compilation, readiness gating,
 * route signal compilation, and evidence validation.
 *
 * Diagnostics have two severity levels:
 * - blocking: Must be resolved before execution can proceed.
 * - warning: Informational — does not block execution but should be surfaced.
 *
 * Each diagnostic carries a unique code, human-readable message,
 * optional file reference, and optional additional details.
 *
 * Contract Schema: 4.1.1
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for ModeDiagnostic types.
 */
export const MODE_DIAGNOSTIC_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Diagnostic Code
// ---------------------------------------------------------------------------

/**
 * Standard diagnostic codes for mode-related issues.
 */
export type ModeDiagnosticCode =
	// Ambiguity / Blocking
	| "BLOCKED_AMBIGUOUS_INPUT"
	| "BLOCKED_AMBIGUOUS_MODE"
	| "BLOCKED_MISSING_TARGET"
	| "BLOCKED_LARGE_OVERWRITE"
	| "BLOCKED_UNSUPPORTED_INTENT"
	| "BLOCKED_READINESS_FAILURE"
	| "BLOCKED_EVIDENCE_MISSING"
	| "BLOCKED_PATCH_NOT_TRACEABLE"
	| "BLOCKED_REGRESSION_DETECTED"
	// Warnings
	| "WARN_INFERRED_MODE"
	| "WARN_READ_ONLY_INTENT"
	| "WARN_STALE_EVIDENCE"
	| "WARN_OVERWRITE_UNCONFIRMED"
	| "WARN_MISSING_CONSTRAINTS"
	| "WARN_LARGE_TARGET"
	// Route Signals
	| "ROUTE_TO_WRITE"
	| "ROUTE_TO_PLAN_JSON"
	| "ROUTE_TO_ARTIFACT_EXPORT"
	// Custom
	| "CUSTOM";

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

/**
 * Diagnostic severity levels.
 */
export type DiagnosticSeverity = "blocking" | "warning";

// ---------------------------------------------------------------------------
// ModeDiagnostic
// ---------------------------------------------------------------------------

/**
 * A single diagnostic produced during mode compilation, readiness gating,
 * route signal compilation, or evidence validation.
 */
export interface ModeDiagnostic {
	/** Severity level. */
	severity: DiagnosticSeverity;

	/** Standard diagnostic code categorizing the issue. */
	code: ModeDiagnosticCode;

	/** Human-readable description of the issue. */
	message: string;

	/** Optional file reference for file-scoped diagnostics. */
	fileRef?: string;

	/** Optional line range within the referenced file. */
	lineRange?: { start: number; end: number };

	/** Optional structured details (machine-readable). */
	details?: string;
}

// ---------------------------------------------------------------------------
// Diagnostic Collection
// ---------------------------------------------------------------------------

/**
 * A collection of diagnostics with helper methods.
 */
export interface DiagnosticCollection {
	diagnostics: ModeDiagnostic[];
}

/**
 * Check whether a diagnostic collection has any blocking diagnostics.
 */
export function hasBlockingDiagnostics(collection: DiagnosticCollection): boolean {
	return collection.diagnostics.some((d) => d.severity === "blocking");
}

/**
 * Filter diagnostics by severity.
 */
export function filterBySeverity(collection: DiagnosticCollection, severity: DiagnosticSeverity): ModeDiagnostic[] {
	return collection.diagnostics.filter((d) => d.severity === severity);
}

/**
 * Filter diagnostics by code.
 */
export function filterByCode(collection: DiagnosticCollection, code: ModeDiagnosticCode): ModeDiagnostic[] {
	return collection.diagnostics.filter((d) => d.code === code);
}

/**
 * Create a blocking diagnostic.
 */
export function blockingDiagnostic(code: ModeDiagnosticCode, message: string, fileRef?: string): ModeDiagnostic {
	return { severity: "blocking", code, message, fileRef };
}

/**
 * Create a warning diagnostic.
 */
export function warningDiagnostic(code: ModeDiagnosticCode, message: string, fileRef?: string): ModeDiagnostic {
	return { severity: "warning", code, message, fileRef };
}
