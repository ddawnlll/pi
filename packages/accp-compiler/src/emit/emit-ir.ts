/**
 * ACCP IR Emitter
 *
 * Emits the intermediate representation (IR) of a compiled ACCP report.
 * The IR is structured data between parsed YAML and compiled output.
 *
 * @packageDocumentation
 */

import type {
	AccpDiagnostic,
	AccpIntermediateRepresentation,
	AccpReportFamily,
	AccpReportType,
} from "@earendil-works/pi-execution-contracts";

/**
 * Emit an intermediate representation for a compiled report.
 *
 * @param sourceReportId - Source report ID.
 * @param reportType - Report type.
 * @param family - Report family.
 * @param sections - Parsed sections.
 * @param diagnostics - Compilation diagnostics.
 * @param references - Cross-report references.
 * @returns Intermediate representation.
 */
export function emitIntermediateRepresentation(
	sourceReportId: string,
	reportType: AccpReportType,
	family: AccpReportFamily,
	sections: Record<string, unknown>,
	diagnostics: AccpDiagnostic[],
	references: string[] = [],
): AccpIntermediateRepresentation {
	return {
		sourceReportId,
		reportType,
		family,
		sections,
		diagnostics,
		references,
	};
}
