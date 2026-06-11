/**
 * ACCP Lineage Validator
 *
 * Validates cross-report lineage relationships and detects cycles.
 * Lineage describes parent/supersedes relationships between reports.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic } from "@earendil-works/pi-execution-contracts";

/** Lineage relationship for a single report. */
export interface ReportLineage {
	reportId: string;
	parentReport?: string;
	supersedes?: string;
}

/**
 * Validate lineage relationships for a set of reports.
 *
 * Checks for:
 * - Self-cycles (a report cannot be its own parent)
 * - Lineage cycles (A -> B -> A)
 * - Unresolved parent references
 *
 * @param lineages - Array of lineage relationships.
 * @param knownIds - Set of known report IDs.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Diagnostics (empty if valid).
 */
export function validateLineage(
	lineages: ReportLineage[],
	knownIds: Set<string>,
	sourcePath?: string,
): AccpDiagnostic[] {
	const diagnostics: AccpDiagnostic[] = [];

	for (const lineage of lineages) {
		// Self-cycle check
		if (lineage.parentReport === lineage.reportId) {
			diagnostics.push({
				code: "ACCP_LINEAGE",
				message: `Self-cycle detected: report "${lineage.reportId}" references itself as parent`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}

		if (lineage.supersedes === lineage.reportId) {
			diagnostics.push({
				code: "ACCP_LINEAGE",
				message: `Self-cycle detected: report "${lineage.reportId}" references itself as supersedes`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}

		// Unresolved parent reference
		if (lineage.parentReport && !knownIds.has(lineage.parentReport)) {
			diagnostics.push({
				code: "ACCP_REF_UNRESOLVED",
				message: `Unresolved parent report: "${lineage.parentReport}" referenced by "${lineage.reportId}"`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}

		// Unresolved supersedes reference
		if (lineage.supersedes && !knownIds.has(lineage.supersedes)) {
			diagnostics.push({
				code: "ACCP_REF_UNRESOLVED",
				message: `Unresolved supersedes target: "${lineage.supersedes}" referenced by "${lineage.reportId}"`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}
	}

	// Cycle detection (A -> B -> A)
	const adjacency = new Map<string, string[]>();
	for (const lineage of lineages) {
		const targets: string[] = [];
		if (lineage.parentReport) targets.push(lineage.parentReport);
		if (lineage.supersedes) targets.push(lineage.supersedes);
		adjacency.set(lineage.reportId, targets);
	}

	for (const [node, deps] of adjacency) {
		for (const dep of deps) {
			const grandDeps = adjacency.get(dep);
			if (grandDeps?.includes(node)) {
				diagnostics.push({
					code: "ACCP_LINEAGE",
					message: `Lineage cycle detected: "${node}" <-> "${dep}"`,
					severity: "error",
					fatal: true,
					sourcePath,
				});
			}
		}
	}

	return diagnostics;
}
