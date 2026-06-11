/**
 * P44.6.32 — CAR Correction Path for Mode Report Failures
 *
 * Requires a Corrective Action Report (CAR) when a mode report is
 * malformed, stale, contradictory, or tries to authorize execution.
 *
 * Contract Schema: 4.1.1
 */

import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";

export type CarReason =
	| "malformed_report"
	| "stale_report"
	| "contradictory_report"
	| "execution_authorization_attempt"
	| "evidence_only_violation";

export interface CAR {
	id: string;
	reason: CarReason;
	description: string;
	reportId: string;
	createdAt: number;
	resolved: boolean;
}

export interface CarResult extends DiagnosticCollection {
	car: CAR | null;
	requiresCAR: boolean;
}

export function requireCAR(reason: CarReason, description: string, reportId: string): CarResult {
	const diagnostics: ModeDiagnostic[] = [];

	const car: CAR = {
		id: `CAR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		reason,
		description,
		reportId,
		createdAt: Date.now(),
		resolved: false,
	};

	diagnostics.push({
		severity: "blocking",
		code: "BLOCKED_EVIDENCE_MISSING",
		message: `CAR required: ${description} (report: ${reportId}, reason: ${reason})`,
	});

	return {
		car,
		requiresCAR: true,
		diagnostics,
	};
}
