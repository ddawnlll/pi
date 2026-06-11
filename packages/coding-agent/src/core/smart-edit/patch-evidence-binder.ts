/**
 * P44.6.24 — Patch Evidence Binder
 *
 * Binds diff hunks, commands, and source evidence to AC IDs and
 * audit finding IDs.
 *
 * Contract Schema: 4.1.1
 */

import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";

// ---------------------------------------------------------------------------
// Evidence Binding
// ---------------------------------------------------------------------------

export type EvidenceKind = "diff_hunk" | "command_output" | "source_snippet" | "test_result";

export interface PatchEvidenceBinding {
	/** Unique binding ID. */
	id: string;
	/** The kind of evidence. */
	kind: EvidenceKind;
	/** The criterion or finding IDs this binding supports. */
	targetIds: string[];
	/** The evidence content or reference. */
	content: string;
	/** Source path for the diff or file. */
	sourcePath?: string;
}

export interface EvidenceBindingResult extends DiagnosticCollection {
	bindings: PatchEvidenceBinding[];
}

// ---------------------------------------------------------------------------
// Binder
// ---------------------------------------------------------------------------

export function bindEvidence(
	targetIds: string[],
	kind: EvidenceKind,
	content: string,
	sourcePath?: string,
): EvidenceBindingResult {
	const diagnostics: ModeDiagnostic[] = [];

	if (targetIds.length === 0) {
		diagnostics.push({
			severity: "warning",
			code: "WARN_STALE_EVIDENCE",
			message: "Evidence binding created with no target IDs. Evidence will not be traceable.",
		});
	}

	const binding: PatchEvidenceBinding = {
		id: `EB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		kind,
		targetIds,
		content,
		sourcePath,
	};

	return {
		bindings: [binding],
		diagnostics,
	};
}
