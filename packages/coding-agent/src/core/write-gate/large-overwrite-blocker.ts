/**
 * P44.6.12 — Large Overwrite and Rewrite Blocker
 *
 * Prevents large existing source-file rewrites unless the plan
 * explicitly grants rewrite scope and preservation evidence is present.
 *
 * Contract Schema: 4.1.1
 */

import { type EngineConfig, EngineMode } from "../mode/engine-mode.js";
import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";
import type { TaskIntentEnvelope } from "../mode/task-intent-envelope.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LARGE_REWRITE_THRESHOLD_BYTES = 100 * 1024; // 100 KB

// ---------------------------------------------------------------------------
// Blocker Result
// ---------------------------------------------------------------------------

export interface LargeOverwriteResult extends DiagnosticCollection {
	/** Whether the large overwrite is permitted. */
	permitted: boolean;
	/** Whether a rewrite scope grant was found. */
	rewriteScopeGranted: boolean;
	/** Whether preservation evidence was present. */
	preservationEvidencePresent: boolean;
}

// ---------------------------------------------------------------------------
// Blocker Evaluation
// ---------------------------------------------------------------------------

export function evaluateLargeOverwrite(
	config: EngineConfig,
	envelope: TaskIntentEnvelope,
	fileSizeBytes?: number,
): LargeOverwriteResult {
	const diagnostics: ModeDiagnostic[] = [];

	if (config.mode !== EngineMode.Write) {
		return {
			permitted: true, // Only applies to write mode
			rewriteScopeGranted: false,
			preservationEvidencePresent: false,
			diagnostics: [],
		};
	}

	// If no file size provided, we can't determine if it's large
	if (fileSizeBytes === undefined || fileSizeBytes === 0) {
		return {
			permitted: true,
			rewriteScopeGranted: false,
			preservationEvidencePresent: false,
			diagnostics: [],
		};
	}

	if (fileSizeBytes <= LARGE_REWRITE_THRESHOLD_BYTES) {
		return {
			permitted: true,
			rewriteScopeGranted: false,
			preservationEvidencePresent: false,
			diagnostics: [],
		};
	}

	// Check for rewrite scope grant
	const rewriteScopeGranted = envelope.constraints.some(
		(c) => c.domain === "scope" && c.description.toLowerCase().includes("rewrite"),
	);

	// Check for preservation evidence
	const preservationEvidencePresent = envelope.constraints.some((c) => c.domain === "preserve");

	if (!rewriteScopeGranted) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_LARGE_OVERWRITE",
			message: `Target file is ${fileSizeBytes} bytes, exceeding the ${LARGE_REWRITE_THRESHOLD_BYTES} threshold. A rewrite scope constraint is required. Add a 'scope' constraint containing 'rewrite' to grant permission.`,
		});
	}

	if (!preservationEvidencePresent) {
		diagnostics.push({
			severity: "warning",
			code: "WARN_MISSING_CONSTRAINTS",
			message:
				"Large rewrite detected but no preserve constraints specified. Add 'preserve' constraints to ensure critical content is not lost.",
		});
	}

	const hasBlocking = diagnostics.some((d) => d.severity === "blocking");

	return {
		permitted: !hasBlocking,
		rewriteScopeGranted,
		preservationEvidencePresent,
		diagnostics,
	};
}
