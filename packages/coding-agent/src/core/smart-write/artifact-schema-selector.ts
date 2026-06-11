/**
 * P44.6.17 — Smart Write Artifact Schema Selector
 *
 * Chooses the JSON artifact schema for smart write requests before
 * generation and rejects markdown-only executable plans.
 *
 * Contract Schema: 4.1.1
 */

import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";

// ---------------------------------------------------------------------------
// Schema Types
// ---------------------------------------------------------------------------

export type ArtifactSchema = "planspec_v5" | "artifact" | "report" | "unknown";

export interface SchemaSelectionResult extends DiagnosticCollection {
	schema: ArtifactSchema;
	/** Whether markdown-only execution was rejected. */
	markdownRejected: boolean;
	/** The selected JSON schema path or hint. */
	schemaPath?: string;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const PLANSEC_PATTERNS = [/\bplan.?spec\b/i, /\bimplementation.?plan\b/i, /\bphase.?plan\b/i, /\bworkspace.?plan\b/i];

const REPORT_PATTERNS = [/\breport\b/i, /\baccp\b/i, /\btvr\b/i, /\bipr\b/i, /\bprr\b/i];

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

export function selectSchema(prompt: string, targetPath?: string): SchemaSelectionResult {
	const diagnostics: ModeDiagnostic[] = [];

	// Reject markdown-only plans
	if (targetPath?.endsWith(".md") && !targetPath?.endsWith(".md.json")) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_READINESS_FAILURE",
			message: `Markdown-only plan rejected: '${targetPath}'. Smart write must produce a JSON schema artifact, not markdown.`,
			fileRef: targetPath,
		});
		return {
			schema: "unknown",
			markdownRejected: true,
			diagnostics,
		};
	}

	let schema: ArtifactSchema = "artifact";

	if (PLANSEC_PATTERNS.some((p) => p.test(prompt))) {
		schema = "planspec_v5";
	} else if (REPORT_PATTERNS.some((p) => p.test(prompt))) {
		schema = "report";
	}

	return {
		schema,
		markdownRejected: false,
		schemaPath: targetPath,
		diagnostics,
	};
}
