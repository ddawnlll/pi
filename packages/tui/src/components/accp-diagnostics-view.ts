/**
 * ACCP Diagnostics View Component (P49.22)
 *
 * Renders ACCP diagnostics in the TUI diagnostics panel.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic } from "@earendil-works/pi-execution-contracts";

/**
 * Render ACCP diagnostics as TUI-safe lines.
 */
export function renderAccpDiagnostics(diagnostics: AccpDiagnostic[]): string[] {
	if (diagnostics.length === 0) return [];

	return diagnostics.map((d) => {
		const icon = d.fatal ? "[x]" : d.severity === "warning" ? "[!]" : "[i]";
		return `${icon} ${d.code}: ${d.message}`;
	});
}
