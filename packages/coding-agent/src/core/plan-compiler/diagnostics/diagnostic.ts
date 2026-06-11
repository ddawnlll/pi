/**
 * Plan Compiler Diagnostics
 *
 * Structured diagnostic types for every compiler phase.
 */

import type { PlanDiagnosticCode } from "./diagnostic-codes.js";

// =============================================================================
// Types
// =============================================================================

export type PlanDiagnosticSeverity = "info" | "warning" | "error" | "fatal";

export type PlanCompilerPhase =
	| "source_classification"
	| "json_parse"
	| "schema_validation"
	| "semantic_validation"
	| "graph_validation"
	| "policy_validation"
	| "completion_validation"
	| "emission";

export interface PlanDiagnosticSourceSpan {
	line: number;
	column: number;
	length?: number;
}

export interface PlanDiagnostic {
	code: PlanDiagnosticCode;
	severity: PlanDiagnosticSeverity;
	phase: PlanCompilerPhase;
	path?: string;
	message: string;
	hint?: string;
	sourceSpan?: PlanDiagnosticSourceSpan;
	/** Zod error code (e.g. "invalid_type", "unrecognized_keys") */
	zodCode?: string;
	/** Expected type/value description */
	expected?: string;
	/** Received type/value description */
	received?: string;
	/** Unknown property keys (for unrecognized_keys) */
	unknownKeys?: string[];
	/** Schema pointer or source file path */
	schemaPointer?: string;
	/** The owning object's top-level section name */
	owningSection?: string;
	/** Nearest parent JSON pointer */
	nearestParentPath?: string;
}

export interface PlanCompileResult {
	ok: boolean;
	artifact?: unknown;
	workerPackets?: unknown[];
	planLock?: unknown;
	diagnostics: PlanDiagnostic[];
}

// =============================================================================
// Builder helpers
// =============================================================================

export interface DiagnosticBuilderOptions {
	code: PlanDiagnosticCode;
	severity?: PlanDiagnosticSeverity;
	phase: PlanCompilerPhase;
	path?: string;
	message: string;
	hint?: string;
	sourceSpan?: PlanDiagnosticSourceSpan;
	zodCode?: string;
	expected?: string;
	received?: string;
	unknownKeys?: string[];
	schemaPointer?: string;
	owningSection?: string;
	nearestParentPath?: string;
}

export function diag(options: DiagnosticBuilderOptions): PlanDiagnostic {
	return {
		code: options.code,
		severity: options.severity ?? "error",
		phase: options.phase,
		path: options.path,
		message: options.message,
		hint: options.hint,
		sourceSpan: options.sourceSpan,
		zodCode: options.zodCode,
		expected: options.expected,
		received: options.received,
		unknownKeys: options.unknownKeys,
		schemaPointer: options.schemaPointer,
		owningSection: options.owningSection,
		nearestParentPath: options.nearestParentPath,
	};
}

export function fatal(options: Omit<DiagnosticBuilderOptions, "severity">): PlanDiagnostic {
	return diag({ ...options, severity: "fatal" });
}

export function error(options: Omit<DiagnosticBuilderOptions, "severity">): PlanDiagnostic {
	return diag({ ...options, severity: "error" });
}

export function warn(options: Omit<DiagnosticBuilderOptions, "severity">): PlanDiagnostic {
	return diag({ ...options, severity: "warning" });
}

export function info(options: Omit<DiagnosticBuilderOptions, "severity">): PlanDiagnostic {
	return diag({ ...options, severity: "info" });
}

// =============================================================================
// Result builder
// =============================================================================

export function okResult(artifact: unknown, workerPackets?: unknown[], planLock?: unknown): PlanCompileResult {
	return {
		ok: true,
		artifact,
		workerPackets,
		planLock,
		diagnostics: [],
	};
}

export function failResult(diagnostics: PlanDiagnostic[]): PlanCompileResult {
	// Invariant: failed compile must have diagnostics
	if (diagnostics.length === 0) {
		throw new Error("Compiler invariant violated: failed compile without diagnostics");
	}
	return {
		ok: false,
		diagnostics,
	};
}
