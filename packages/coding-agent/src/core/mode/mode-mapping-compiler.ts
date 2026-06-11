/**
 * P44.6.03 — Mode Mapping Compiler
 *
 * Deterministic rules for compiling a TaskIntentEnvelope into an
 * explicit EngineMode. If the intent cannot be deterministically
 * resolved, the compiler emits a blocking diagnostic and does NOT
 * silently fall back to any mode.
 *
 * Key constraints:
 * - No silent mode fallback. If ambiguous, surface as diagnostic.
 * - LLM is not authoritative for mode decisions.
 * - Rules are deterministic (no AI/ML inference).
 *
 * Contract Schema: 4.1.1
 */

import { type EngineConfig, EngineMode, isEngineMode } from "./engine-mode.js";
import type { ModeDiagnostic } from "./mode-diagnostic.js";
import { hasBlockingAmbiguities, hasResolvedIntent, type TaskIntentEnvelope } from "./task-intent-envelope.js";

// ---------------------------------------------------------------------------
// Compilation Result
// ---------------------------------------------------------------------------

/**
 * The result of compiling a TaskIntentEnvelope into an EngineMode.
 */
export interface ModeMappingResult {
	/**
	 * The resolved engine mode. null if compilation failed or was ambiguous.
	 */
	mode: EngineMode | null;

	/**
	 * The engine config derived from the envelope and resolved mode.
	 * null if mode is null (compilation failed).
	 */
	config: EngineConfig | null;

	/**
	 * Diagnostics produced during compilation.
	 * Non-empty when compilation fails or encounters issues.
	 */
	diagnostics: ModeDiagnostic[];

	/**
	 * Whether compilation was successful (mode is non-null and no blocking diagnostics).
	 */
	success: boolean;
}

// ---------------------------------------------------------------------------
// Compilation Rule Result
// ---------------------------------------------------------------------------

/**
 * Result of a single compilation rule.
 */
interface RuleResult {
	mode?: EngineMode;
	config?: EngineConfig;
	diagnostics: ModeDiagnostic[];
}

// ---------------------------------------------------------------------------
// Compilation Rules
// ---------------------------------------------------------------------------

/**
 * Rule 1: If the envelope has blocking ambiguities, block immediately.
 */
function ruleCheckBlockingAmbiguities(envelope: TaskIntentEnvelope): RuleResult | null {
	if (hasBlockingAmbiguities(envelope)) {
		return {
			diagnostics: [
				{
					severity: "blocking",
					code: "BLOCKED_AMBIGUOUS_INPUT",
					message: "Task intent contains blocking ambiguities that must be resolved before mode compilation.",
					details: envelope.ambiguities
						.filter((a) => a.blocking)
						.map((a) => `[${a.code}] ${a.message}`)
						.join("; "),
				},
			],
		};
	}
	return null;
}

/**
 * Rule 2: If mutation intent is already explicitly resolved, map directly.
 */
function ruleExplicitMutationIntent(envelope: TaskIntentEnvelope): RuleResult | null {
	if (!hasResolvedIntent(envelope)) {
		return null;
	}

	switch (envelope.mutationIntent) {
		case "create":
			return compileCreateIntent(envelope);
		case "modify":
			return compileModifyIntent(envelope);
		case "audit_then_mutate":
			return compileAuditThenMutateIntent(envelope);
		case "route_then_create":
			return compileRouteThenCreateIntent(envelope);
		case "delete":
			return {
				diagnostics: [
					{
						severity: "blocking",
						code: "BLOCKED_UNSUPPORTED_INTENT",
						message: `Mutation intent '${envelope.mutationIntent}' is not supported by any engine mode.`,
					},
				],
			};
		case "read_only":
			return {
				diagnostics: [
					{
						severity: "warning",
						code: "WARN_READ_ONLY_INTENT",
						message: "Read-only intent does not require an engine mode. No mutation will be performed.",
					},
				],
			};
		default:
			return null;
	}
}

/**
 * Rule 3: If no explicit mutation intent, try to infer from target paths.
 */
function ruleInferFromTargetPaths(envelope: TaskIntentEnvelope): RuleResult | null {
	if (envelope.targetPaths === null || envelope.targetPaths.length === 0) {
		return null;
	}

	if (envelope.targetPaths.length > 1) {
		return null; // Multiple targets — too ambiguous without explicit intent
	}

	if (envelope.targetExists === true) {
		return {
			mode: EngineMode.Edit,
			config: {
				mode: EngineMode.Edit,
				targetPath: envelope.targetPaths[0],
			},
			diagnostics: [
				{
					severity: "warning",
					code: "WARN_INFERRED_MODE",
					message: `Inferred 'edit' mode from existing target path: ${envelope.targetPaths[0]}.`,
				},
			],
		};
	}

	if (envelope.targetExists === false) {
		return {
			mode: EngineMode.Write,
			config: {
				mode: EngineMode.Write,
				targetPath: envelope.targetPaths[0],
				overwritePolicy: envelope.overwritePolicy ?? "fail_if_exists",
			},
			diagnostics: [
				{
					severity: "warning",
					code: "WARN_INFERRED_MODE",
					message: `Inferred 'write' mode from new target path: ${envelope.targetPaths[0]}.`,
				},
			],
		};
	}

	// targetExists is null — cannot determine
	return null;
}

/**
 * Rule 4: If nothing resolves, emit ambiguous diagnostic.
 */
function ruleAmbiguousFallback(): RuleResult {
	return {
		diagnostics: [
			{
				severity: "blocking",
				code: "BLOCKED_AMBIGUOUS_MODE",
				message:
					"Cannot deterministically assign engine mode from the task intent envelope. " +
					"The mutation intent could not be resolved and no target path signals were available. " +
					"Please clarify whether this is a write, edit, smart_write, or smart_edit operation.",
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Intent Compilation Helpers
// ---------------------------------------------------------------------------

function compileCreateIntent(envelope: TaskIntentEnvelope): RuleResult {
	const targetPath = envelope.targetPaths?.[0];

	if (!targetPath) {
		return {
			mode: EngineMode.SmartWrite,
			config: {
				mode: EngineMode.SmartWrite,
				outputSchema: "artifact",
			},
			diagnostics: [],
		};
	}

	return {
		mode: EngineMode.Write,
		config: {
			mode: EngineMode.Write,
			targetPath,
			overwritePolicy: envelope.overwritePolicy ?? "fail_if_exists",
		},
		diagnostics: [],
	};
}

function compileModifyIntent(envelope: TaskIntentEnvelope): RuleResult {
	const targetPath = envelope.targetPaths?.[0];

	if (!targetPath) {
		return {
			diagnostics: [
				{
					severity: "blocking",
					code: "BLOCKED_MISSING_TARGET",
					message: "Edit intent declared but no target artifact path was specified.",
				},
			],
		};
	}

	const preserveConstraints = envelope.constraints.filter((c) => c.domain === "preserve").map((c) => c.description);

	return {
		mode: EngineMode.Edit,
		config: {
			mode: EngineMode.Edit,
			targetPath,
			preserveConstraints: preserveConstraints.length > 0 ? preserveConstraints : undefined,
		},
		diagnostics: [],
	};
}

function compileAuditThenMutateIntent(envelope: TaskIntentEnvelope): RuleResult {
	const targetPath = envelope.targetPaths?.[0];

	if (!targetPath) {
		return {
			diagnostics: [
				{
					severity: "blocking",
					code: "BLOCKED_MISSING_TARGET",
					message: "Audit-then-mutate intent declared but no target artifact path was specified.",
				},
			],
		};
	}

	const auditScope = envelope.constraints.filter((c) => c.domain === "scope").map((c) => c.description);

	return {
		mode: EngineMode.SmartEdit,
		config: {
			mode: EngineMode.SmartEdit,
			targetPath,
			auditScope: auditScope.length > 0 ? auditScope : ["full"],
		},
		diagnostics: [],
	};
}

function compileRouteThenCreateIntent(envelope: TaskIntentEnvelope): RuleResult {
	return {
		mode: EngineMode.SmartWrite,
		config: {
			mode: EngineMode.SmartWrite,
			targetPath: envelope.targetPaths?.[0],
			outputSchema: "planspec_v5",
		},
		diagnostics: [],
	};
}

// ---------------------------------------------------------------------------
// Main Compiler
// ---------------------------------------------------------------------------

/**
 * Compile a TaskIntentEnvelope into an explicit EngineMode and EngineConfig.
 *
 * This function is fully deterministic. It applies a fixed set of rules
 * in order and returns the first matching result. No AI/ML inference,
 * no heuristic scoring, no silent fallback.
 *
 * If the result has `success: false`, the diagnostics contain blocking
 * issues that must be resolved before execution can proceed.
 */
export function compileMode(envelope: TaskIntentEnvelope): ModeMappingResult {
	const rules: Array<(e: TaskIntentEnvelope) => RuleResult | null> = [
		ruleCheckBlockingAmbiguities,
		ruleExplicitMutationIntent,
		ruleInferFromTargetPaths,
	];

	for (const rule of rules) {
		const result = rule(envelope);
		if (result !== null) {
			const mode = resolveMode(result.mode);
			return {
				mode: mode,
				config: mode !== null ? (result.config ?? null) : null,
				diagnostics: result.diagnostics,
				success: mode !== null && !result.diagnostics.some((d) => d.severity === "blocking"),
			};
		}
	}

	// No rule matched — ambiguous
	const fallback = ruleAmbiguousFallback();
	return {
		mode: null,
		config: null,
		diagnostics: fallback.diagnostics,
		success: false,
	};
}

/**
 * Validate that a resolved mode is a valid EngineMode value.
 * Returns null if the mode value is not recognized (safety guard).
 */
function resolveMode(mode: EngineMode | undefined): EngineMode | null {
	if (mode === undefined) return null;
	if (isEngineMode(mode)) return mode;
	return null;
}
