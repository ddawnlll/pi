/**
 * P44.6.18 — Smart Write Route Signal Compiler
 *
 * Compiles smart write prompts into route signals:
 * - ROUTE_TO_WRITE: new target, clear overwrite, evidence present
 * - ROUTE_TO_PLAN_JSON: plan-like smart write -> JSON PlanSpec
 * - ROUTE_TO_ARTIFACT_EXPORT: artifact export -> P49.5 bridge
 * - BLOCKED: ambiguous or missing requirements
 *
 * Contract Schema: 4.1.1
 */

import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";
import { hasBlockingAmbiguities, type TaskIntentEnvelope } from "../mode/task-intent-envelope.js";
import { type ArtifactSchema, selectSchema } from "./artifact-schema-selector.js";

// ---------------------------------------------------------------------------
// Route Signals
// ---------------------------------------------------------------------------

export type RouteSignal =
	| "ROUTE_TO_WRITE"
	| "ROUTE_TO_PLAN_JSON"
	| "ROUTE_TO_ARTIFACT_EXPORT"
	| "BLOCKED_MISSING_TARGET"
	| "BLOCKED_LARGE_OVERWRITE"
	| "BLOCKED_AMBIGUOUS_MODE";

export interface RouteSignalResult extends DiagnosticCollection {
	signal: RouteSignal;
	/** The selected schema for the route target. */
	schema: ArtifactSchema;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export function compileRouteSignal(envelope: TaskIntentEnvelope): RouteSignalResult {
	const _diagnostics: ModeDiagnostic[] = [];

	// Check blocking ambiguities first
	if (hasBlockingAmbiguities(envelope)) {
		return {
			signal: "BLOCKED_AMBIGUOUS_MODE",
			schema: "unknown",
			diagnostics: [
				{
					severity: "blocking",
					code: "BLOCKED_AMBIGUOUS_MODE",
					message: "Cannot compile route signal due to blocking ambiguities in the task intent envelope.",
				},
			],
		};
	}

	// ROUTE_TO_ARTIFACT_EXPORT: artifact export intent
	if (envelope.mutationIntent === "route_then_create") {
		const schemaResult = selectSchema(envelope.rawPrompt, envelope.targetPaths?.[0]);

		if (schemaResult.markdownRejected) {
			return {
				signal: "BLOCKED_AMBIGUOUS_MODE",
				schema: "unknown",
				diagnostics: schemaResult.diagnostics,
			};
		}

		if (schemaResult.schema === "planspec_v5") {
			return {
				signal: "ROUTE_TO_PLAN_JSON",
				schema: "planspec_v5",
				diagnostics: [],
			};
		}

		if (schemaResult.schema === "report") {
			return {
				signal: "ROUTE_TO_ARTIFACT_EXPORT",
				schema: "report",
				diagnostics: [],
			};
		}

		// Default: route to write
		return {
			signal: "ROUTE_TO_WRITE",
			schema: "artifact",
			diagnostics: [],
		};
	}

	// Check if target exists and overwrite is clear
	if (envelope.targetPaths && envelope.targetPaths.length > 0) {
		if (envelope.targetExists === true && !envelope.overwritePolicy) {
			return {
				signal: "BLOCKED_MISSING_TARGET",
				schema: "unknown",
				diagnostics: [
					{
						severity: "blocking",
						code: "BLOCKED_MISSING_TARGET",
						message: `Target '${envelope.targetPaths[0]}' already exists but no overwrite policy specified.`,
					},
				],
			};
		}

		return {
			signal: "ROUTE_TO_WRITE",
			schema: "artifact",
			diagnostics: [],
		};
	}

	// Default: route to write
	return {
		signal: "ROUTE_TO_WRITE",
		schema: "artifact",
		diagnostics: [],
	};
}
