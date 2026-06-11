/**
 * P44.6.22 — Smart Edit Patch Scope Compiler
 *
 * Compiles audit findings into minimal patch scopes.
 * Rejects patches that are not traceable to a finding.
 *
 * Contract Schema: 4.1.1
 */

import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";
import type { SmartEditAuditFinding } from "./audit-finding.js";

// ---------------------------------------------------------------------------
// Patch Scope
// ---------------------------------------------------------------------------

export interface PatchScope {
	/** The finding ID this patch addresses. */
	findingId: string;
	/** The file to patch. */
	targetFile: string;
	/** Description of the patch. */
	patchDescription: string;
	/** Line range to patch (if applicable). */
	lineRange?: { start: number; end: number };
}

export interface PatchScopeCompilationResult extends DiagnosticCollection {
	scopes: PatchScope[];
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export function compilePatchScopes(findings: SmartEditAuditFinding[]): PatchScopeCompilationResult {
	const diagnostics: ModeDiagnostic[] = [];
	const scopes: PatchScope[] = [];

	for (const finding of findings) {
		if (finding.severity === "blocker") {
			diagnostics.push({
				severity: "blocking",
				code: "BLOCKED_PATCH_NOT_TRACEABLE",
				message: `Finding ${finding.id} is a blocker. Resolve before compiling patch scope.`,
				fileRef: finding.fileRef,
			});
			continue;
		}

		scopes.push({
			findingId: finding.id,
			targetFile: finding.fileRef,
			patchDescription: finding.description,
			lineRange: finding.lineRange,
		});
	}

	return { scopes, diagnostics };
}
