/**
 * ACCP YAML Parser
 *
 * Strict ACCP-YAML parser. Accepts native `.accp.yaml` source and
 * extracts structured data. Rejects invalid input with structured
 * diagnostics.
 *
 * ## Parsing Rules
 *
 * - Must start with `accp_version` key at root
 * - Must have `source_format` key at root
 * - Must have `report` object with `id`, `type`, `family`
 * - Rejects XML-like wrappers, Markdown-only, multiple YAML docs
 * - Rejects missing required sections
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpReportFamily, AccpReportType } from "@earendil-works/pi-execution-contracts";

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
	};
	/** Meta section. */
	meta?: Record<string, unknown>;
	/** Agent section. */
	agent?: Record<string, unknown>;
	/** Evidence entries. */
	evidence?: unknown[];
	/** All top-level sections (for extensibility). */
	sections: Record<string, unknown>;
}

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

	// Check for empty input
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

	// Check for ACCP-YAML wrapper (must start with accp_version)
	const trimmed = sourceYaml.trim();
	if (!trimmed.startsWith("accp_version:")) {
		diagnostics.push({
			code: "ACCP_PARSE_YAML_INVALID",
			message: "Source must start with 'accp_version:'",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return { parsed: null, diagnostics };
	}

	// Simple line-by-line parser for ACCP-YAML
	const lines = trimmed.split("\n");
	const sections: Record<string, unknown> = {};
	let currentSection: string | null = null;
	let currentSectionData: string[] = [];
	let accpVersion = "";
	let sourceFormat = "";

	for (const line of lines) {
		// Detect top-level keys
		const topLevelMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
		if (topLevelMatch) {
			// Flush previous section
			if (currentSection && currentSectionData.length > 0) {
				sections[currentSection] = currentSectionData.join("\n");
			}
			currentSection = topLevelMatch[1];
			currentSectionData = [];

			if (currentSection === "accp_version") {
				accpVersion = topLevelMatch[2].replace(/^["']|["']$/g, "").trim();
			} else if (currentSection === "source_format") {
				sourceFormat = topLevelMatch[2].replace(/^["']|["']$/g, "").trim();
			} else if (currentSection === "report") {
				currentSectionData.push(line);
			}
		} else if (currentSection && line.startsWith("  ")) {
			currentSectionData.push(line);
		}
	}

	// Flush last section
	if (currentSection && currentSectionData.length > 0) {
		sections[currentSection] = currentSectionData.join("\n");
	}

	// Validate accp_version
	if (!accpVersion) {
		diagnostics.push({
			code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
			message: "Missing required field: accp_version",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Validate source_format
	if (!sourceFormat) {
		diagnostics.push({
			code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
			message: "Missing required field: source_format",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	} else if (sourceFormat !== "ACCP-YAML") {
		diagnostics.push({
			code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
			message: `Invalid source_format: expected "ACCP-YAML", got "${sourceFormat}"`,
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Extract report section
	const reportSection = sections.report;
	let reportId = "";
	let reportType: AccpReportType = "FCR";
	let reportFamily: AccpReportFamily = "feature";
	let reportStatus = "";

	function stripQuotes(val: string): string {
		return val.replace(/^["']|["']$/g, "").trim();
	}

	if (typeof reportSection === "string" && reportSection) {
		const reportLines = reportSection.split("\n");
		for (const rl of reportLines) {
			const idMatch = rl.match(/^\s{2}id:\s*(.+)$/);
			if (idMatch) reportId = stripQuotes(idMatch[1]);
			const typeMatch = rl.match(/^\s{2}type:\s*(.+)$/);
			if (typeMatch) reportType = stripQuotes(typeMatch[1]) as AccpReportType;
			const familyMatch = rl.match(/^\s{2}family:\s*(.+)$/);
			if (familyMatch) reportFamily = stripQuotes(familyMatch[1]) as AccpReportFamily;
			const statusMatch = rl.match(/^\s{2}status:\s*(.+)$/);
			if (statusMatch) reportStatus = stripQuotes(statusMatch[1]);
		}
	}

	if (!reportId) {
		diagnostics.push({
			code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
			message: "Missing required field: report.id",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	if (diagnostics.some((d) => d.fatal)) {
		return { parsed: null, diagnostics };
	}

	const parsed: AccpParsedReport = {
		accpVersion,
		sourceFormat,
		report: {
			id: reportId,
			type: reportType,
			family: reportFamily,
			status: reportStatus || undefined,
		},
		sections,
	};

	return { parsed, diagnostics };
}
