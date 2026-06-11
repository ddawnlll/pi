/**
 * P44.6.29 — ACCP Mode Report Validator
 *
 * Validates that ACCP reports are evidence-only and cannot authorize
 * mode transitions or execution. An ACCP report that attempts to
 * authorize a mode transition or execution is malformed and must be
 * rejected.
 *
 * Contract Schema: 4.1.1
 */

import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";

export type ReportValidationVerdict = "valid" | "malformed" | "not_evidence_only";

export interface ReportValidationResult extends DiagnosticCollection {
	verdict: ReportValidationVerdict;
	reportType: string;
}

// Patterns that would make a report attempt to authorize execution
const AUTHORIZATION_PATTERNS = [
	/mode_transition_authorized/i,
	/execution_authorized/i,
	/mode_change_permitted/i,
	/write_authorized/i,
	/edit_authorized/i,
];

export function validateModeReport(reportContent: string, reportType: string): ReportValidationResult {
	const diagnostics: ModeDiagnostic[] = [];

	if (!reportContent || reportContent.trim().length === 0) {
		return {
			verdict: "malformed",
			reportType,
			diagnostics: [
				{
					severity: "blocking",
					code: "BLOCKED_EVIDENCE_MISSING",
					message: "ACCP report is empty or malformed.",
				},
			],
		};
	}

	// Check if report attempts to authorize execution
	for (const pattern of AUTHORIZATION_PATTERNS) {
		if (pattern.test(reportContent)) {
			diagnostics.push({
				severity: "blocking",
				code: "BLOCKED_READINESS_FAILURE",
				message: `ACCP report contains execution authorization language (matched: '${pattern.source}'). ACCP reports are evidence-only and cannot authorize mode transitions or execution.`,
			});
		}
	}

	if (diagnostics.length > 0) {
		return {
			verdict: "not_evidence_only",
			reportType,
			diagnostics,
		};
	}

	return {
		verdict: "valid",
		reportType,
		diagnostics,
	};
}
