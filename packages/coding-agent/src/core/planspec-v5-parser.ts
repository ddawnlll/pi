/**
 * PlanSpec v5 RC1 JSON-Only Parser Entry — ACCP 1.2
 *
 * JSON-only PlanSpec entrypoint.
 * - Never inspects Markdown headings in jsonOnly mode.
 * - Never falls back to workstream heading extraction.
 * - Rejects Markdown input with typed error.
 * - Legacy v4.1.1 parser only when explicitly requested.
 *
 * Integrates with existing parsePlan for legacy path.
 */

import { type ParseOptions, type ParseResult, parsePlan } from "./plan-parser.js";
import { PlanSpecV5Schema } from "./planspec-v5-schema.js";
import { validatePlanSpecSemantics } from "./planspec-v5-semantic-validator.js";
import type { PlanSpecV5 } from "./planspec-v5-types.js";

// =============================================================================
// Parser Mode
// =============================================================================

/**
 * Parser mode selection.
 */
export type ParserMode = "json_only" | "legacy_v4" | "auto";

/**
 * Options for the combined plan parser.
 */
export interface PlanSpecParseOptions {
	/** Parser mode. Default: "auto" (json_only if JSON, fallback to legacy if Markdown) */
	mode?: ParserMode;
	/** Options passed through to legacy parser */
	legacyOptions?: ParseOptions;
}

/**
 * Combined parse result for PlanSpec v5 + legacy v4.
 */
export type PlanSpecCombinedResult = {
	success: boolean;
	planspec?: PlanSpecV5;
	semanticErrors?: string[];
	errors?: string[];
	errorCode?: string;
	legacyResult?: ParseResult;
};

// =============================================================================
// JSON-Only Parser
// =============================================================================

/**
 * Parse PlanSpec input in JSON-only mode.
 *
 * - Rejects non-JSON input (Markdown) with typed error.
 * - Validates against strict v5 RC1 schema.
 * - Runs semantic validation.
 *
 * @param input - Input string
 * @returns Parse result
 */
export function parsePlanSpecJsonOnly(input: string): PlanSpecCombinedResult {
	// Reject empty
	if (!input || input.trim().length === 0) {
		return { success: false, errors: ["Input is empty"], errorCode: "E_EMPTY_INPUT" };
	}

	const trimmed = input.trim();

	// Reject Markdown / non-JSON
	if (!trimmed.startsWith("{")) {
		return {
			success: false,
			errors: [
				"PlanSpec v5 requires JSON input. Markdown is not accepted in json_only mode. " +
					"Use mode='legacy_v4' for Markdown plans.",
			],
			errorCode: "E_NOT_JSON",
		};
	}

	// Parse JSON and validate schema
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (e) {
		return {
			success: false,
			errors: [`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`],
			errorCode: "E_MALFORMED_JSON",
		};
	}

	const schemaResult = PlanSpecV5Schema.safeParse(parsed);
	if (!schemaResult.success) {
		const errors = schemaResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
		return { success: false, errors, errorCode: "E_SCHEMA_INVALID" };
	}

	const planspec = schemaResult.data;

	// Semantic validation
	const semanticErrors = validatePlanSpecSemantics(planspec);
	const semanticErrorMessages = semanticErrors.map((e) => `[${e.code}] ${e.message} (${e.path})`);

	return {
		success: semanticErrors.length === 0,
		planspec,
		semanticErrors: semanticErrorMessages,
	};
}

// =============================================================================
// Combined Parser
// =============================================================================

/**
 * Parse PlanSpec input with mode detection.
 *
 * - "json_only": JSON-only, reject Markdown
 * - "legacy_v4": Use existing Markdown-based parsePlan
 * - "auto": Try JSON first, fall back to legacy
 *
 * @param input - Input string
 * @param options - Parse options
 * @returns Combined parse result
 */
export function parsePlanSpecCombined(input: string, options: PlanSpecParseOptions = {}): PlanSpecCombinedResult {
	const mode = options.mode ?? "auto";

	if (mode === "json_only") {
		return parsePlanSpecJsonOnly(input);
	}

	if (mode === "legacy_v4") {
		const legacyResult = parsePlan(input, options.legacyOptions);
		if (legacyResult.success) {
			return { success: true, planspec: legacyResultToPlanSpec(legacyResult), semanticErrors: [] };
		}
		return {
			success: false,
			errors: legacyResult.errors,
			legacyResult,
		};
	}

	// "auto" mode: try JSON first
	if (input.trim().startsWith("{")) {
		const jsonResult = parsePlanSpecJsonOnly(input);
		if (jsonResult.success) {
			return jsonResult;
		}
		// JSON parse failed, fall back to legacy
	}

	// Fall back to legacy parser
	const legacyResult = parsePlan(input, options.legacyOptions);
	if (legacyResult.success) {
		return { success: true, planspec: legacyResultToPlanSpec(legacyResult), semanticErrors: [] };
	}
	return {
		success: false,
		errors: legacyResult.errors,
		legacyResult,
	};
}

// =============================================================================
// Legacy Adapter
// =============================================================================

/**
 * Convert a legacy v4 parse result to a minimal PlanSpec v5 structure.
 * This is non-authoritative — the canonical PlanSpec is always JSON.
 */
function legacyResultToPlanSpec(legacyResult: ParseResult): PlanSpecV5 {
	const queue = legacyResult.queue;
	return {
		accpVersion: "1.2",
		planspecVersion: "5.0.0",
		taskId: queue?.phase ?? "unknown",
		taskName: queue?.title ?? "Legacy Plan",
		executionClass: "implementation",
		workspaceGroup: "A",
		allowProductionCodeChanges: true,
		allowTestCodeChanges: true,
		allowReportFiles: true,
		requireRepoInspectionFirst: true,
		requireValidationEvidence: true,
		requireRollbackPlan: true,
		requireFinalAccpReport: true,
		authority: {
			specification: "legacy_v4_conversion",
			executionState: {
				mode: queue?.planExecution?.scale?.selectedMode ?? "stable_3",
				maxParallelWorkspaces: queue?.maxParallelWorkspaces ?? 3,
			},
			completion: {
				requiresAcceptanceCriteria: true,
				requiresValidationEvidence: true,
				requiresReport: true,
				requiresRollbackPlan: true,
				requiresFinalVerdict: true,
			},
		},
		waves: [],
		workspaces: (queue?.workspaces ?? []).map((ws, i) => ({
			id: ws.id ?? `ws_${i}`,
			title: ws.title ?? `Workspace ${i + 1}`,
			dependencies: ws.dependencies ?? [],
			acceptanceCriteria: (ws.acceptanceCriteria ?? []).map((ac, j) => ({
				id: `${ws.id ?? `ws_${i}`}_ac_${j}`,
				description: typeof ac === "string" ? ac : String(ac),
			})),
			validation: {
				commandRefs: [],
				watchModeRejected: true,
				mustPass: true,
				requireEvidence: true,
			},
			reports: [],
			rollback: { steps: [] },
			commands: [],
		})),
		templates: [],
		validationCases: [],
	};
}
