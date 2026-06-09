/**
 * Format Plan Compiler Diagnostics
 *
 * CLI and JSON output formatting for compiler diagnostics.
 */

import type { PlanDiagnostic, PlanDiagnosticSeverity } from "./diagnostic.js";

// =============================================================================
// Severity formatting
// =============================================================================

const SEVERITY_LABELS: Record<PlanDiagnosticSeverity, string> = {
	info: "INFO",
	warning: "WARN",
	error: "ERROR",
	fatal: "FATAL",
};

// =============================================================================
// CLI format
// =============================================================================

/**
 * Format diagnostics for human-readable CLI output.
 */
export function formatDiagnostics(diagnostics: PlanDiagnostic[]): string {
	if (diagnostics.length === 0) {
		return "No diagnostics.";
	}

	const lines: string[] = [];

	// Group by severity
	const grouped = groupBySeverity(diagnostics);

	for (const severity of ["fatal", "error", "warning", "info"] as PlanDiagnosticSeverity[]) {
		const diags = grouped[severity];
		if (!diags || diags.length === 0) continue;

		lines.push(`${SEVERITY_LABELS[severity]} (${diags.length}):`);

		for (const d of diags) {
			const location = d.path ? ` ${d.path}` : "";
			const span = d.sourceSpan ? ` [${d.sourceSpan.line}:${d.sourceSpan.column}]` : "";
			lines.push(`  ${d.code}${location}${span}: ${d.message}`);
			if (d.hint) {
				lines.push(`    Hint: ${d.hint}`);
			}
		}

		lines.push("");
	}

	return lines.join("\n").trimEnd();
}

// =============================================================================
// JSON format (structured, machine-readable)
// =============================================================================

/**
 * Format diagnostics as a structured JSON-compatible object.
 */
export function formatDiagnosticsJson(diagnostics: PlanDiagnostic[]): object {
	return {
		ok: diagnostics.length === 0 || diagnostics.every((d) => d.severity !== "error" && d.severity !== "fatal"),
		diagnostics: diagnostics.map((d) => ({
			code: d.code,
			severity: d.severity,
			phase: d.phase,
			path: d.path,
			message: d.message,
			hint: d.hint,
			sourceSpan: d.sourceSpan
				? {
						line: d.sourceSpan.line,
						column: d.sourceSpan.column,
						length: d.sourceSpan.length,
					}
				: undefined,
		})),
	};
}

// =============================================================================
// Summary
// =============================================================================

export interface DiagnosticSummary {
	info: number;
	warning: number;
	error: number;
	fatal: number;
}

export function summarizeDiagnostics(diagnostics: PlanDiagnostic[]): DiagnosticSummary {
	const summary: DiagnosticSummary = { info: 0, warning: 0, error: 0, fatal: 0 };
	for (const d of diagnostics) {
		summary[d.severity]++;
	}
	return summary;
}

// =============================================================================
// Helpers
// =============================================================================

function groupBySeverity(diagnostics: PlanDiagnostic[]): Record<PlanDiagnosticSeverity, PlanDiagnostic[]> {
	const groups: Record<PlanDiagnosticSeverity, PlanDiagnostic[]> = {
		info: [],
		warning: [],
		error: [],
		fatal: [],
	};
	for (const d of diagnostics) {
		groups[d.severity].push(d);
	}
	return groups;
}
