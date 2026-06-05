/**
 * LegacyPlanNormalizer for v4 ExecutionKernel.
 *
 * Maps v3 mechanism-heavy plan fields into v4 intent and derived profile form.
 * Enables old plans to be executed under v4 ExecutionKernel authority without
 * requiring every old plan to be rewritten.
 *
 * Deprecated v3 fields remain readable for compatibility but are not treated
 * as final runtime authority. Emits deprecation warnings when v3 mechanism
 * fields are used.
 */

import type {
	ExecutionIntent,
	IntentConflictRisk,
	IntentExecutionEnvironmentMode,
	IntentSafetyLevel,
} from "./execution-profile-deriver.js";

// =========================================================================
// Deprecation warnings
// =========================================================================

export type DeprecationWarningType = "legacy_mechanism_field_used_as_hint" | "legacy_mechanism_field_used_as_authority";

export interface DeprecationWarning {
	type: DeprecationWarningType;
	field: string;
	message: string;
}

// =========================================================================
// Normalization input
// =========================================================================

export interface LegacyPlanInput {
	maxParallelWorkspaces?: number;
	scale?: {
		selectedMode?: string;
		defaultMode?: string;
	};
	worktreeRequired?: boolean;
	integrationQueueRequired?: boolean;
	validationLockRequired?: boolean;
	completionGateRequired?: boolean;
	jsonFallbackEnabled?: boolean;
	boundedLiveness?: {
		llm?: {
			providerRequestTimeoutMs?: number;
			streamIdleTimeoutMs?: number;
		};
		validation?: {
			defaultTimeoutMs?: number;
			heavyTimeoutMs?: number;
		};
	};
}

// =========================================================================
// Normalization result
// =========================================================================

export interface LegacyNormalizationResult {
	intent: ExecutionIntent;
	warnings: DeprecationWarning[];
}

// =========================================================================
// Normalization logic
// =========================================================================

/**
 * Normalize a legacy v3/v2 plan into v4 intent form.
 *
 * Maps:
 * - maxParallelWorkspaces -> intent.parallelism
 * - scale.selectedMode -> intent.parallelism/safety hint
 * - worktreeRequired / integrationQueueRequired / validationLockRequired -> deprecated hints
 * - jsonFallbackEnabled -> checked against v4 production rules
 *
 * @param input - Legacy plan fields
 * @returns Normalized intent and deprecation warnings
 */
export function normalizeLegacyPlanToIntent(input: LegacyPlanInput): LegacyNormalizationResult {
	const warnings: DeprecationWarning[] = [];

	// Derive parallelism
	const parallelism =
		input.maxParallelWorkspaces ??
		(input.scale?.selectedMode === "experimental_6" ? 6 : input.scale?.selectedMode === "scale_8" ? 8 : 3);

	// Derive safety level from scale mode
	let safetyLevel: IntentSafetyLevel = "normal";
	if (input.scale?.selectedMode === "experimental_6" || input.scale?.selectedMode === "scale_8") {
		safetyLevel = "strict";
	} else if (input.maxParallelWorkspaces && input.maxParallelWorkspaces > 3) {
		safetyLevel = "strict";
	}

	// Derive conflict risk from mechanism hints
	let conflictRisk: IntentConflictRisk = "low";
	if (input.worktreeRequired || input.integrationQueueRequired) {
		conflictRisk = "medium";
	}
	if (input.worktreeRequired && input.integrationQueueRequired) {
		conflictRisk = "high";
	}

	// Emit deprecation warnings for legacy mechanism fields
	if (input.worktreeRequired !== undefined) {
		warnings.push({
			type: "legacy_mechanism_field_used_as_hint",
			field: "worktreeRequired",
			message:
				"worktreeRequired is deprecated in v4: derived from intent.parallelism, conflictRisk, and safetyLevel",
		});
	}
	if (input.integrationQueueRequired !== undefined) {
		warnings.push({
			type: "legacy_mechanism_field_used_as_hint",
			field: "integrationQueueRequired",
			message:
				"integrationQueueRequired is deprecated in v4: derived from intent.parallelism, conflictRisk, and safetyLevel",
		});
	}
	if (input.validationLockRequired !== undefined) {
		warnings.push({
			type: "legacy_mechanism_field_used_as_hint",
			field: "validationLockRequired",
			message: "validationLockRequired is deprecated in v4: replaced by validation lanes derivation",
		});
	}
	if (input.completionGateRequired !== undefined) {
		warnings.push({
			type: "legacy_mechanism_field_used_as_hint",
			field: "completionGateRequired",
			message: "completionGateRequired is deprecated in v4: replaced by PlanSupervisor completion predicate",
		});
	}

	// Derive execution environment
	const executionEnvironmentMode: IntentExecutionEnvironmentMode = "trusted_local";
	if (input.jsonFallbackEnabled !== undefined) {
		// If JSON fallback was enabled in a legacy plan but we're running in v4,
		// warn that production JSON runtime fallback is forbidden
		if (input.jsonFallbackEnabled) {
			warnings.push({
				type: "legacy_mechanism_field_used_as_hint",
				field: "jsonFallbackEnabled",
				message:
					"jsonFallbackEnabled is set but v4 production execution forbids JSON runtime fallback. " +
					"PostgreSQL is the authoritative runtime backend.",
			});
		}
	}

	// Derive deadlines from bounded liveness if present
	const deadlines: Record<string, number> = {};
	if (input.boundedLiveness?.llm?.providerRequestTimeoutMs) {
		deadlines.llmRequestMs = input.boundedLiveness.llm.providerRequestTimeoutMs;
	}
	if (input.boundedLiveness?.llm?.streamIdleTimeoutMs) {
		deadlines.llmStreamIdleMs = input.boundedLiveness.llm.streamIdleTimeoutMs;
	}
	if (input.boundedLiveness?.validation?.defaultTimeoutMs) {
		deadlines.validationDefaultMs = input.boundedLiveness.validation.defaultTimeoutMs;
	}
	if (input.boundedLiveness?.validation?.heavyTimeoutMs) {
		deadlines.validationHeavyMs = input.boundedLiveness.validation.heavyTimeoutMs;
	}

	return {
		intent: {
			parallelism,
			safetyLevel,
			conflictRisk,
			executionEnvironment: {
				mode: executionEnvironmentMode,
			},
			deadlines: Object.keys(deadlines).length > 0 ? deadlines : undefined,
		},
		warnings,
	};
}
