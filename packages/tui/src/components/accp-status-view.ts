/**
 * ACCP Status View Component (P49.22)
 *
 * Renders current ACCP status in the TUI.
 * Shows mode, latest diagnostics, and gate status.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpGateVerdict, AccpMode } from "@earendil-works/pi-execution-contracts";

/** ACCP status view data. */
export interface AccpStatusViewData {
	mode: AccpMode;
	diagnostics: AccpDiagnostic[];
	gateVerdict?: AccpGateVerdict;
	lastCompiledReport?: string;
}

/**
 * Render ACCP status as a TUI-safe string.
 */
export function renderAccpStatus(data: AccpStatusViewData): string {
	const lines: string[] = [];
	const modeLabel = data.mode === "required" ? "REQUIRED" : data.mode === "warn" ? "WARN" : "OFF";

	lines.push(`ACCP Mode: ${modeLabel}`);

	if (data.diagnostics.length > 0) {
		const fatalCount = data.diagnostics.filter((d) => d.fatal).length;
		const warningCount = data.diagnostics.filter((d) => d.severity === "warning").length;
		lines.push(`Diagnostics: ${data.diagnostics.length} total (${fatalCount} fatal, ${warningCount} warnings)`);
	}

	if (data.gateVerdict) {
		lines.push(`Gate: ${data.gateVerdict.valid ? "PASS" : "BLOCK"} | Evidence: ${data.gateVerdict.evidenceStatus}`);
	}

	if (data.lastCompiledReport) {
		lines.push(`Last compiled: ${data.lastCompiledReport}`);
	}

	return lines.join(" | ");
}
