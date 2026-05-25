/**
 * Correlation model: propagation, merging, and context sharing.
 *
 * The correlation model links observability events across execution
 * hierarchy boundaries. It enables tracing a request from user action
 * through plan execution, workspace execution, and individual tool calls.
 *
 * Key concepts:
 * - correlationId: cross-cutting identifier (user request, webhook, CI trigger)
 * - projectId: project-level identifier for multi-project workspaces
 * - planExecutionId: links events within a single plan execution
 * - workspaceExecutionId: links events within a single workspace execution
 *
 * @module observability/correlation
 */

import type { CorrelationModel, TraceContext } from "./types.js";
import { EMPTY_CORRELATION } from "./types.js";

// ─────────────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────────────

export { EMPTY_CORRELATION };
export type { CorrelationModel };

// ─────────────────────────────────────────────────────────────────────
// CorrelationHelpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Create a CorrelationModel from partial fields.
 *
 * All unspecified fields default to null.
 *
 * @param fields - Partial correlation fields
 * @returns A fully populated CorrelationModel
 */
export function createCorrelation(
	fields?: Partial<CorrelationModel>,
): CorrelationModel {
	return {
		correlationId: fields?.correlationId ?? null,
		projectId: fields?.projectId ?? null,
		planExecutionId: fields?.planExecutionId ?? null,
		workspaceExecutionId: fields?.workspaceExecutionId ?? null,
	};
}

/**
 * Merge two correlation models, preferring non-null values from `override`.
 *
 * Useful when a child scope wants to add more specific identifiers
 * while preserving the parent's broad correlation context.
 *
 * @param base - Base correlation model (typically from parent scope)
 * @param override - Override values (typically from child scope)
 * @returns Merged CorrelationModel
 */
export function mergeCorrelation(
	base: CorrelationModel,
	override: Partial<CorrelationModel>,
): CorrelationModel {
	return {
		correlationId: override.correlationId ?? base.correlationId,
		projectId: override.projectId ?? base.projectId,
		planExecutionId: override.planExecutionId ?? base.planExecutionId,
		workspaceExecutionId:
			override.workspaceExecutionId ?? base.workspaceExecutionId,
	};
}

/**
 * Extract correlation fields from a TraceContext.
 *
 * @param context - Trace context to extract from
 * @returns CorrelationModel with the context's correlation fields
 */
export function correlationFromTraceContext(
	context: TraceContext,
): CorrelationModel {
	return {
		correlationId: context.correlationId,
		projectId: context.projectId,
		planExecutionId: context.planExecutionId,
		workspaceExecutionId: context.workspaceExecutionId,
	};
}

/**
 * Check if a CorrelationModel has any non-null field.
 *
 * @param model - Correlation model to check
 * @returns True if at least one field is non-null
 */
export function isCorrelationPopulated(model: CorrelationModel): boolean {
	return (
		model.correlationId !== null ||
		model.projectId !== null ||
		model.planExecutionId !== null ||
		model.workspaceExecutionId !== null
	);
}

/**
 * Check if a CorrelationModel is empty (all null fields).
 *
 * @param model - Correlation model to check
 * @returns True if all fields are null
 */
export function isCorrelationEmpty(model: CorrelationModel): boolean {
	return !isCorrelationPopulated(model);
}

/**
 * Format a CorrelationModel as a log-friendly string.
 *
 * @param model - Correlation model to format
 * @returns Human-readable string like "corr=req-1 proj=p-1 plan=pl-1 ws=ws-1"
 */
export function formatCorrelation(model: CorrelationModel): string {
	const parts: string[] = [];
	if (model.correlationId) parts.push(`corr=${model.correlationId}`);
	if (model.projectId) parts.push(`proj=${model.projectId}`);
	if (model.planExecutionId) parts.push(`plan=${model.planExecutionId}`);
	if (model.workspaceExecutionId)
		parts.push(`ws=${model.workspaceExecutionId}`);
	return parts.length > 0 ? parts.join(" ") : "(empty)";
}
