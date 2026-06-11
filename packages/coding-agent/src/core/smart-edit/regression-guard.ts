/**
 * P44.6.23 — Smart Edit Regression Guard
 *
 * Requires targeted validation or negative evidence before smart edit
 * claims a patch resolved a finding.
 *
 * Contract Schema: 4.1.1
 */

import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";
import type { SmartEditAuditFinding } from "./audit-finding.js";

// ---------------------------------------------------------------------------
// Validation Result
// ---------------------------------------------------------------------------

export interface RegressionCheckResult extends DiagnosticCollection {
	/** Whether all findings are validated as resolved. */
	allResolved: boolean;
	/** Findings that passed regression check. */
	resolvedFindings: string[];
	/** Findings that failed regression check. */
	failedFindings: string[];
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export function checkRegression(
	findings: SmartEditAuditFinding[],
	resolvedFindingIds: string[],
	patchEvidence: Map<string, string>,
): RegressionCheckResult {
	const diagnostics: ModeDiagnostic[] = [];
	const resolvedFindings: string[] = [];
	const failedFindings: string[] = [];

	for (const finding of findings) {
		if (!resolvedFindingIds.includes(finding.id)) {
			continue; // Not claimed as resolved
		}

		const evidence = patchEvidence.get(finding.id);

		if (!evidence) {
			diagnostics.push({
				severity: "blocking",
				code: "BLOCKED_REGRESSION_DETECTED",
				message: `Finding ${finding.id} claimed resolved but no patch evidence provided. Required: ${finding.requiredPatchEvidence}`,
				fileRef: finding.fileRef,
			});
			failedFindings.push(finding.id);
			continue;
		}

		if (evidence.includes(finding.requiredPatchEvidence)) {
			resolvedFindings.push(finding.id);
		} else {
			diagnostics.push({
				severity: "warning",
				code: "WARN_STALE_EVIDENCE",
				message: `Finding ${finding.id}: evidence '${evidence}' may not satisfy required evidence '${finding.requiredPatchEvidence}'.`,
				fileRef: finding.fileRef,
			});
			failedFindings.push(finding.id);
		}
	}

	return {
		allResolved: failedFindings.length === 0,
		resolvedFindings,
		failedFindings,
		diagnostics,
	};
}
