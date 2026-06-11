/**
 * ACCP Gate Verdict Emitter
 *
 * Compiles an ACCP report into a gate-verdict.json artifact.
 * Gate verdicts record whether a report's evidence and findings
 * indicate gate passage or blocking.
 *
 * ## Authority
 *
 * Gate verdicts are diagnostic inputs to CompletionGateV2 and
 * TransitionRouter. They do NOT authorize execution, mutation,
 * or workspace transitions.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpGateVerdict, AccpReportType } from "@earendil-works/pi-execution-contracts";

/**
 * Compile a gate verdict from diagnostics and evidence status.
 *
 * @param reportId - Report ID.
 * @param reportType - Report type.
 * @param diagnostics - All diagnostics from compilation/validation.
 * @param evidenceStatus - Status of evidence validation.
 * @param customDetails - Optional additional context.
 * @returns Gate verdict.
 */
export function compileGateVerdict(
	reportId: string,
	reportType: AccpReportType,
	diagnostics: AccpDiagnostic[],
	evidenceStatus: "complete" | "partial" | "missing" | "not_checked" = "not_checked",
	customDetails?: Record<string, unknown>,
): AccpGateVerdict {
	const fatalErrors: string[] = [];
	const warnings: string[] = [];
	const blockingFindings: string[] = [];

	for (const d of diagnostics) {
		if (d.fatal) {
			fatalErrors.push(`[${d.code}] ${d.message}`);
			blockingFindings.push(d.message);
		} else if (d.severity === "warning") {
			warnings.push(`[${d.code}] ${d.message}`);
		}
	}

	const hasFatalErrors = fatalErrors.length > 0;
	const hasBlocking = blockingFindings.length > 0;
	const hasEvidenceIssues = evidenceStatus === "missing";

	// Gate is valid if no fatal errors, no blocking findings, and evidence is present
	const valid = !hasFatalErrors && !hasBlocking && !hasEvidenceIssues;

	// Promotion-ready requires valid + complete evidence
	const promotionReady = valid && evidenceStatus === "complete";

	return {
		reportId,
		reportType,
		valid,
		fatalErrors,
		warnings,
		blockingFindings,
		findingCount: fatalErrors.length + warnings.length,
		promotionReady,
		evidenceStatus,
		details: customDetails,
	};
}
