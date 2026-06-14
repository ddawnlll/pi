/**
 * ACCP YAML Parser V2
 *
 * Uses the real `yaml` package for deterministic YAML parsing, then
 * canonicalizes ACCP v2.0 schema shapes (top-level report_type vs nested
 * report.type, top-level report_id vs nested report.id) into one internal
 * representation. Rejects invalid YAML, multiple documents, and conflicting
 * schema declarations.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpReportFamily, AccpReportType } from "@earendil-works/pi-execution-contracts";
import { parseAllDocuments } from "yaml";
import { isKnownReportType, lookupReportType } from "../registry/report-registry.js";

// =============================================================================
// Parsed output type
// =============================================================================

/** Result of parsing an ACCP YAML source document. */
export interface AccpParsedReport {
	/** ACCP version string. */
	accpVersion: string;
	/** Source format (must be "ACCP-YAML"). */
	sourceFormat: string;
	/** Report object with metadata. */
	report: {
		id: string;
		type: AccpReportType;
		family: AccpReportFamily;
		kind?: string;
		status?: string;
		title?: string;
	};
	/** Meta section. */
	meta?: Record<string, unknown>;
	/** Agent section. */
	agent?: Record<string, unknown>;
	/** Capabilities section. */
	capabilities?: Record<string, unknown>;
	/** Evidence entries. */
	evidence?: unknown[];
	/** References. */
	references?: unknown[];
	/** Assumptions. */
	assumptions?: Record<string, unknown>;
	/** Skipped inspections. */
	skippedInspections?: Record<string, unknown>;
	/** All top-level sections (for extensibility). */
	sections: Record<string, unknown>;
	/** Diagnostics from schema canonicalization. */
	canonicalizationDiagnostics?: AccpDiagnostic[];
}

// =============================================================================
// Internal helper types
// =============================================================================

type CanonicalReportIds = {
	reportId: string | undefined;
	reportType: AccpReportType | undefined;
	reportFamily: AccpReportFamily | undefined;
	diagnostics: AccpDiagnostic[];
};

// =============================================================================
// YAML parse
// =============================================================================

/**
 * Parse a raw YAML source string into a single JSON object.
 *
 * @param sourceYaml - Raw YAML source string.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Parsed object and diagnostics.
 */
export function parseSingleYamlDocument(
	sourceYaml: string,
	sourcePath?: string,
): { parsed: Record<string, unknown> | null; diagnostics: AccpDiagnostic[] } {
	const diagnostics: AccpDiagnostic[] = [];

	if (!sourceYaml || sourceYaml.trim().length === 0) {
		diagnostics.push({
			code: "ACCP_PARSE_YAML_INVALID",
			message: "Source YAML is empty",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return { parsed: null, diagnostics };
	}

	let docs: ReturnType<typeof parseAllDocuments>;
	try {
		docs = parseAllDocuments(sourceYaml);
	} catch (err) {
		diagnostics.push({
			code: "ACCP_PARSE_YAML_INVALID",
			message: err instanceof Error ? err.message : String(err),
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return { parsed: null, diagnostics };
	}

	if (docs.length === 0) {
		diagnostics.push({
			code: "ACCP_PARSE_YAML_INVALID",
			message: "Empty YAML document",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return { parsed: null, diagnostics };
	}

	if (docs.length > 1) {
		diagnostics.push({
			code: "ACCP_PARSE_MULTIDOC_NOT_ALLOWED",
			message: "Multiple YAML documents detected — only single-document ACCP-YAML is supported",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return { parsed: null, diagnostics };
	}

	const doc = docs[0];
	if (doc.errors && doc.errors.length > 0) {
		diagnostics.push({
			code: "ACCP_PARSE_YAML_INVALID",
			message: doc.errors[0].message,
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return { parsed: null, diagnostics };
	}

	const value = doc.toJS();
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		diagnostics.push({
			code: "ACCP_PARSE_YAML_INVALID",
			message: "YAML document must be a top-level mapping",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return { parsed: null, diagnostics };
	}

	return { parsed: value as Record<string, unknown>, diagnostics };
}

// =============================================================================
// Schema canonicalization
// =============================================================================

/**
 * Canonicalize report id and type from top-level and nested forms.
 *
 * Accepts:
 * - top-level report_type
 * - nested report.type
 * - top-level report_id
 * - nested report.id
 *
 * Rejects conflicts.
 */
function canonicalizeReport(sections: Record<string, unknown>, sourcePath?: string): CanonicalReportIds {
	const diagnostics: AccpDiagnostic[] = [];

	const topLevelReportType = sections.report_type;
	const reportSection = sections.report;
	let nestedReportType: unknown;
	let nestedReportId: unknown;
	let nestedReportFamily: unknown;
	if (typeof reportSection === "object" && reportSection !== null && !Array.isArray(reportSection)) {
		const reportObj = reportSection as Record<string, unknown>;
		nestedReportType = reportObj.type;
		nestedReportId = reportObj.id;
		nestedReportFamily = reportObj.family;
	}

	const topLevelReportId = sections.report_id;

	// Resolve report id
	let reportId: string | undefined;
	if (topLevelReportId !== undefined && nestedReportId !== undefined) {
		diagnostics.push({
			code: "ACCP_SCHEMA_CONFLICTING_REPORT_ID",
			message: "Conflicting report id declarations: report_id and report.id both present",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	} else if (topLevelReportId !== undefined) {
		reportId = String(topLevelReportId);
	} else if (nestedReportId !== undefined) {
		reportId = String(nestedReportId);
	}

	// Resolve report type
	let reportType: AccpReportType | undefined;
	if (topLevelReportType !== undefined && nestedReportType !== undefined) {
		diagnostics.push({
			code: "ACCP_SCHEMA_CONFLICTING_REPORT_TYPE",
			message: "Conflicting report type declarations: report_type and report.type both present",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	} else if (topLevelReportType !== undefined) {
		reportType = String(topLevelReportType) as AccpReportType;
	} else if (nestedReportType !== undefined) {
		reportType = String(nestedReportType) as AccpReportType;
	}

	// Resolve family from explicit value or infer from type
	let reportFamily: AccpReportFamily | undefined;
	if (nestedReportFamily !== undefined) {
		reportFamily = String(nestedReportFamily) as AccpReportFamily;
	} else if (reportType && isKnownReportType(reportType)) {
		const entry = lookupReportType(reportType);
		if (entry) {
			reportFamily = entry.family;
			diagnostics.push({
				code: "ACCP_SCHEMA_FAMILY_INFERRED",
				message: `Report family inferred from type: "${reportFamily}"`,
				severity: "info",
				fatal: false,
				sourcePath,
			});
		}
	}

	return { reportId, reportType, reportFamily, diagnostics };
}

// =============================================================================
// Main parse function
// =============================================================================

/**
 * Parse an ACCP YAML source string into a structured object.
 *
 * @param sourceYaml - Raw YAML source string.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Parsed report and diagnostics.
 */
export function parseAccpYaml(
	sourceYaml: string,
	sourcePath?: string,
): {
	parsed: AccpParsedReport | null;
	diagnostics: AccpDiagnostic[];
} {
	const diagnostics: AccpDiagnostic[] = [];

	// Parse raw YAML into JSON
	const parseResult = parseSingleYamlDocument(sourceYaml, sourcePath);
	diagnostics.push(...parseResult.diagnostics);

	if (parseResult.parsed === null) {
		return { parsed: null, diagnostics };
	}

	const sections = parseResult.parsed;

	// Validate top-level required fields
	const accpVersion = String(sections.accp_version ?? "");
	const sourceFormat = String(sections.source_format ?? "");

	if (!accpVersion) {
		diagnostics.push({
			code: "ACCP_SCHEMA_MISSING_TOP_LEVEL_KEY",
			message: "Missing required field: accp_version",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	} else if (accpVersion !== "2.0.0") {
		diagnostics.push({
			code: "ACCP_SCHEMA_INVALID_ACCP_VERSION",
			message: `Invalid accp_version: expected "2.0.0", got "${accpVersion}"`,
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	if (!sourceFormat) {
		diagnostics.push({
			code: "ACCP_SCHEMA_MISSING_TOP_LEVEL_KEY",
			message: "Missing required field: source_format",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	} else if (sourceFormat !== "ACCP-YAML") {
		diagnostics.push({
			code: "ACCP_SCHEMA_INVALID_SOURCE_FORMAT",
			message: `Invalid source_format: expected "ACCP-YAML", got "${sourceFormat}"`,
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Canonicalize report id/type/family
	const canonical = canonicalizeReport(sections, sourcePath);
	diagnostics.push(...canonical.diagnostics);

	if (!canonical.reportId) {
		diagnostics.push({
			code: "ACCP_SCHEMA_REPORT_ID_MISSING",
			message: "Missing required field: report.id or report_id",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	if (!canonical.reportType) {
		diagnostics.push({
			code: "ACCP_SCHEMA_REPORT_TYPE_MISSING",
			message: "Missing required field: report.type or report_type",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	} else if (!isKnownReportType(canonical.reportType)) {
		diagnostics.push({
			code: "ACCP_SCHEMA_UNKNOWN_REPORT_TYPE",
			message: `Unknown report type: "${canonical.reportType}"`,
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	if (!canonical.reportFamily && canonical.reportType) {
		// Family could not be inferred because type is unknown; already reported above.
		diagnostics.push({
			code: "ACCP_SCHEMA_REPORT_FAMILY_MISSING",
			message: "Missing required field: report.family (and could not infer from report type)",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Check family/type consistency when both are known
	if (canonical.reportType && canonical.reportFamily && isKnownReportType(canonical.reportType)) {
		const entry = lookupReportType(canonical.reportType);
		if (entry && entry.family !== canonical.reportFamily) {
			diagnostics.push({
				code: "ACCP_SCHEMA_FAMILY_TYPE_MISMATCH",
				message: `Report family "${canonical.reportFamily}" does not match canonical family "${entry.family}" for type "${canonical.reportType}"`,
				severity: "warning",
				fatal: false,
				sourcePath,
			});
		}
	}

	// Any fatal diagnostic blocks parse result
	if (diagnostics.some((d) => d.fatal)) {
		return { parsed: null, diagnostics };
	}

	// Build report section
	const reportObj =
		typeof sections.report === "object" && sections.report !== null && !Array.isArray(sections.report)
			? (sections.report as Record<string, unknown>)
			: ({} as Record<string, unknown>);

	const report: AccpParsedReport["report"] = {
		id: canonical.reportId ?? "UNKNOWN",
		type: canonical.reportType ?? ("FCR" as AccpReportType),
		family: canonical.reportFamily ?? ("feature" as AccpReportFamily),
	};

	if (reportObj.kind !== undefined) report.kind = String(reportObj.kind);
	if (reportObj.status !== undefined) report.status = String(reportObj.status);
	if (reportObj.title !== undefined) report.title = String(reportObj.title);

	// Build sections map excluding core fields that are stored top-level
	const remainingSections: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(sections)) {
		if (
			key !== "accp_version" &&
			key !== "source_format" &&
			key !== "report" &&
			key !== "report_type" &&
			key !== "report_id"
		) {
			remainingSections[key] = value;
		}
	}

	const parsed: AccpParsedReport = {
		accpVersion,
		sourceFormat,
		report,
		meta: sections.meta as Record<string, unknown> | undefined,
		agent: sections.agent as Record<string, unknown> | undefined,
		capabilities: sections.capabilities as Record<string, unknown> | undefined,
		evidence: sections.evidence as unknown[] | undefined,
		references: sections.references as unknown[] | undefined,
		assumptions: sections.assumptions as Record<string, unknown> | undefined,
		skippedInspections: sections.skipped_inspections as Record<string, unknown> | undefined,
		sections: remainingSections,
		canonicalizationDiagnostics: canonical.diagnostics,
	};

	return { parsed, diagnostics };
}
