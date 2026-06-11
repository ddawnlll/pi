/**
 * P44.6.19 — JSON Plan Artifact Writer
 *
 * Ensures plan-like smart write outputs are JSON PlanSpec artifacts,
 * not markdown. Produces a JSON PlanSpec document from the task intent.
 *
 * Contract Schema: 4.1.1
 */

import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";
import type { TaskIntentEnvelope } from "../mode/task-intent-envelope.js";
import type { ArtifactSchema } from "./artifact-schema-selector.js";

// ---------------------------------------------------------------------------
// Plan Artifact
// ---------------------------------------------------------------------------

export interface PlanArtifact {
	/** Schema version. */
	schemaVersion: string;
	/** The kind of artifact. */
	kind: "planspec_v5" | "artifact_export" | "report";
	/** The target path for the artifact. */
	targetPath: string;
	/** The content (JSON-serializable). */
	content: Record<string, unknown>;
	/** Whether this was produced from markdown (false). */
	fromMarkdown: boolean;
}

export interface PlanArtifactResult extends DiagnosticCollection {
	artifact: PlanArtifact | null;
	written: boolean;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export function writePlanArtifact(
	envelope: TaskIntentEnvelope,
	schema: ArtifactSchema,
	targetPath: string,
): PlanArtifactResult {
	const _diagnostics: ModeDiagnostic[] = [];

	if (schema === "unknown") {
		return {
			artifact: null,
			written: false,
			diagnostics: [
				{
					severity: "blocking",
					code: "BLOCKED_READINESS_FAILURE",
					message: "Cannot write plan artifact: schema is unknown.",
				},
			],
		};
	}

	const kind =
		schema === "planspec_v5"
			? ("planspec_v5" as const)
			: schema === "report"
				? ("report" as const)
				: ("artifact_export" as const);

	const artifact: PlanArtifact = {
		schemaVersion: "5.0.0-alpha2",
		kind,
		targetPath,
		content: {
			intent: envelope.mutationIntent,
			targetPaths: envelope.targetPaths,
			constraints: envelope.constraints.map((c) => c.description),
			rawPrompt: envelope.rawPrompt,
		},
		fromMarkdown: false,
	};

	return {
		artifact,
		written: true,
		diagnostics: [],
	};
}
