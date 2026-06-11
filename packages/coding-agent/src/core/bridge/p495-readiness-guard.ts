/**
 * P44.6.34 — P49.5 Readiness Guard
 *
 * Blocks promotion unless mode mapping, mutation safety, runtime scan,
 * and evidence ledger all pass readiness checks.
 *
 * Contract Schema: 4.1.1
 */

import type { DiagnosticCollection, ModeDiagnostic } from "../mode/mode-diagnostic.js";

export interface P495ReadinessVerdict extends DiagnosticCollection {
	ready: boolean;
	checks: {
		modeMappingComplete: boolean;
		mutationSafetyVerified: boolean;
		runtimeScanPassed: boolean;
		evidenceLedgerPopulated: boolean;
	};
}

export function evaluateP495Readiness(
	modeMappingComplete: boolean,
	mutationSafetyVerified: boolean,
	runtimeScanPassed: boolean,
	evidenceLedgerPopulated: boolean,
): P495ReadinessVerdict {
	const diagnostics: ModeDiagnostic[] = [];
	const checks = { modeMappingComplete, mutationSafetyVerified, runtimeScanPassed, evidenceLedgerPopulated };

	if (!modeMappingComplete) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_READINESS_FAILURE",
			message: "P49.5 readiness: mode mapping is not complete.",
		});
	}
	if (!mutationSafetyVerified) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_READINESS_FAILURE",
			message: "P49.5 readiness: mutation safety not verified.",
		});
	}
	if (!runtimeScanPassed) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_READINESS_FAILURE",
			message: "P49.5 readiness: runtime scan did not pass.",
		});
	}
	if (!evidenceLedgerPopulated) {
		diagnostics.push({
			severity: "blocking",
			code: "BLOCKED_EVIDENCE_MISSING",
			message: "P49.5 readiness: evidence ledger not populated.",
		});
	}

	return {
		ready: diagnostics.length === 0,
		checks,
		diagnostics,
	};
}
