/**
 * ACCP Gate Evaluator
 *
 * Evaluates gate-critical reports against their schema and evidence
 * to determine whether the gate passes or blocks.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpGateVerdict, AccpReportType } from "@earendil-works/pi-execution-contracts";
import { compileGateVerdict } from "../emit/emit-gate-verdict.js";

/**
 * Evaluate gate for a report given its diagnostics and evidence.
 *
 * @param reportId - Report ID.
 * @param reportType - Report type.
 * @param diagnostics - All diagnostics from compilation/validation.
 * @param evidenceStatus - Status of evidence validation.
 * @returns Gate verdict.
 */
export function evaluateGate(
	reportId: string,
	reportType: AccpReportType,
	diagnostics: AccpDiagnostic[],
	evidenceStatus: "complete" | "partial" | "missing" | "not_checked" = "not_checked",
): AccpGateVerdict {
	return compileGateVerdict(reportId, reportType, diagnostics, evidenceStatus);
}
