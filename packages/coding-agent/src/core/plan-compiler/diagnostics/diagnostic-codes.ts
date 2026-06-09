/**
 * Plan Compiler Diagnostic Codes
 *
 * Central enum for all diagnostic codes emitted by the plan compiler.
 * Every failure path must produce at least one diagnostic.
 */

export const PlanDiagnosticCode = {
	// =========================================================================
	// Source classification
	// =========================================================================
	E_EMPTY_INPUT: "E_EMPTY_INPUT",
	E_NOT_JSON: "E_NOT_JSON",
	E_LEGACY_MARKDOWN: "E_LEGACY_MARKDOWN",

	// =========================================================================
	// JSON parse
	// =========================================================================
	E_MALFORMED_JSON: "E_MALFORMED_JSON",
	E_ROOT_NOT_OBJECT: "E_ROOT_NOT_OBJECT",

	// =========================================================================
	// Version and kind
	// =========================================================================
	E_WRONG_VERSION: "E_WRONG_VERSION",
	E_WRONG_KIND: "E_WRONG_KIND",

	// =========================================================================
	// Schema validation
	// =========================================================================
	E_MISSING_FIELD: "E_MISSING_FIELD",
	E_INVALID_TYPE: "E_INVALID_TYPE",
	E_INVALID_VALUE: "E_INVALID_VALUE",
	E_UNKNOWN_PROPERTY: "E_UNKNOWN_PROPERTY",

	// =========================================================================
	// Semantic validation
	// =========================================================================
	E_DUPLICATE_ID: "E_DUPLICATE_ID",
	E_DUPLICATE_WAVE_ID: "E_DUPLICATE_WAVE_ID",
	E_DUPLICATE_WORKSPACE_ID: "E_DUPLICATE_WORKSPACE_ID",
	E_DUPLICATE_TASK_ID: "E_DUPLICATE_TASK_ID",
	E_REF_UNKNOWN_WAVE: "E_REF_UNKNOWN_WAVE",
	E_REF_UNKNOWN_WORKSPACE: "E_REF_UNKNOWN_WORKSPACE",
	E_REF_UNKNOWN_TASK: "E_REF_UNKNOWN_TASK",
	E_REF_UNKNOWN_WORKSPACE_TASK: "E_REF_UNKNOWN_WORKSPACE_TASK",

	// =========================================================================
	// Graph validation
	// =========================================================================
	E_CYCLE_WAVE: "E_CYCLE_WAVE",
	E_CYCLE_WORKSPACE: "E_CYCLE_WORKSPACE",
	E_CYCLE_TASK: "E_CYCLE_TASK",

	// =========================================================================
	// Policy validation
	// =========================================================================
	E_COMMAND_POLICY_VIOLATION: "E_COMMAND_POLICY_VIOLATION",
	E_BLOCKED_COMMAND: "E_BLOCKED_COMMAND",
	E_FILE_POLICY_VIOLATION: "E_FILE_POLICY_VIOLATION",
	E_DELETE_FORBIDDEN: "E_DELETE_FORBIDDEN",
	E_VALIDATION_UNRESOLVABLE: "E_VALIDATION_UNRESOLVABLE",

	// =========================================================================
	// Completion validation
	// =========================================================================
	E_COMPLETION_UNSATISFIABLE: "E_COMPLETION_UNSATISFIABLE",

	// =========================================================================
	// Emission
	// =========================================================================
	E_EMISSION_FAILED: "E_EMISSION_FAILED",
} as const;

export type PlanDiagnosticCode = (typeof PlanDiagnosticCode)[keyof typeof PlanDiagnosticCode];
