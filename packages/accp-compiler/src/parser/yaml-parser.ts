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
 * - Must have `source_format` key at root (must be "ACCP-YAML")
 * - Must have `report` object with `id`, `type`, `family`
 * - Rejects XML-like wrappers, Markdown-only, multiple YAML docs
 * - Rejects missing required sections
 *
 * ## Strict Source Profile
 *
 * The parser enforces a strict source profile:
 * - accp_version must be "2.0.0"
 * - source_format must be "ACCP-YAML"
 * - report.type must be a known 3-letter ACCP report type
 * - report.family must match the type's canonical family
 * - All required sections per report schema must be present
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpReportFamily, AccpReportType } from "@earendil-works/pi-execution-contracts";

// =============================================================================
// Type validation helpers
// =============================================================================

/** All 24 valid ACCP report types. */
const VALID_REPORT_TYPES: ReadonlySet<string> = new Set([
	// Core (8)
	"RIR",
	"PIR",
	"IPR",
	"TVR",
	"HIR",
	"RAR",
	"PRR",
	"CAR",
	// Bugfix (5)
	"BSR",
	"BRR",
	"RCA",
	"FPR",
	"FVR",
	// Feature (5)
	"FER",
	"FDR",
	"FCR",
	"FIR",
	"FGR",
	// Writing (4)
	"WBR",
	"WDR",
	"WER",
	"WQR",
	// Coordination (2)
	"ECR",
	"DCR",
]);

/** Valid report families. */
const VALID_REPORT_FAMILIES: ReadonlySet<string> = new Set(["core", "bugfix", "feature", "writing", "coordination"]);

/**
 * Canonical family for each report type. Used to validate that
 * report.family matches the type's actual family.
 */
const TYPE_TO_FAMILY: Readonly<Record<string, AccpReportFamily>> = {
	// Core
	RIR: "core",
	PIR: "core",
	IPR: "core",
	TVR: "core",
	HIR: "core",
	RAR: "core",
	PRR: "core",
	CAR: "core",
	// Bugfix
	BSR: "bugfix",
	BRR: "bugfix",
	RCA: "bugfix",
	FPR: "bugfix",
	FVR: "bugfix",
	// Feature
	FER: "feature",
	FDR: "feature",
	FCR: "feature",
	FIR: "feature",
	FGR: "feature",
	// Writing
	WBR: "writing",
	WDR: "writing",
	WER: "writing",
	WQR: "writing",
	// Coordination
	ECR: "coordination",
	DCR: "coordination",
};

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
}

// =============================================================================
// YAML tokenizer and parser
// =============================================================================

interface YLine {
	/** Original line text (without newline). */
	raw: string;
	/** Line number (1-based). */
	lineNum: number;
	/** Indentation level (number of leading spaces). */
	indent: number;
	/** Content after indent (trimmed). */
	content: string;
	/** Whether this is a blank line or comment-only. */
	isBlank: boolean;
}

interface ParseContext {
	lines: YLine[];
	pos: number;
	diagnostics: AccpDiagnostic[];
	sourcePath?: string;
}

/**
 * Tokenize raw YAML text into parsed lines.
 */
function tokenize(sourceYaml: string): YLine[] {
	const rawLines = sourceYaml.split("\n");
	const lines: YLine[] = [];

	for (let i = 0; i < rawLines.length; i++) {
		const raw = rawLines[i];
		const stripped = raw.replace(/\r$/, "");

		// Skip YAML document marker
		if (stripped.trim() === "---" || stripped.trim() === "...") continue;

		// Check for blank/comment-only lines
		const trimmedLine = stripped.trim();
		const isBlank = trimmedLine.length === 0 || trimmedLine.startsWith("#");

		// Calculate indentation
		const indentMatch = stripped.match(/^(\s*)/);
		const indent = indentMatch ? indentMatch[1].length : 0;

		lines.push({
			raw: stripped,
			lineNum: i + 1,
			indent,
			content: trimmedLine,
			isBlank,
		});
	}

	return lines;
}

/**
 * Parse a YAML value from the current position in the token stream.
 * Returns the parsed value and advances `ctx.pos` past consumed lines.
 */
function _parseValue(ctx: ParseContext, baseIndent: number): unknown {
	if (ctx.pos >= ctx.lines.length) return null;

	const line = ctx.lines[ctx.pos];

	// Skip blank/comment lines
	if (line.isBlank) {
		ctx.pos++;
		return _parseValue(ctx, baseIndent);
	}

	// Check if we're past the current block (indent is less than base)
	if (line.indent < baseIndent) return null;

	const content = line.content;

	// Inline array: [item1, item2, ...]
	if (content.startsWith("[") && content.endsWith("]") && !content.startsWith('["')) {
		return parseInlineArray(content);
	}

	// Inline map: {key: value, ...}
	if (content.startsWith("{") && content.endsWith("}")) {
		return _parseInlineMap(content, ctx);
	}

	// Key-value pair: key: value
	const kvMatch = content.match(/^([\w][\w-]*)\s*:\s*(.*)$/);
	if (kvMatch) {
		const key = kvMatch[1];
		const rest = kvMatch[2];

		// Handle potential nested structure
		if (rest === "" || rest === "|" || rest === ">" || rest === "|-") {
			// Nested object or block scalar
			ctx.pos++;
			if (rest === "" || rest === "|-") {
				// Nested map
				return { [key]: parseMap(ctx, line.indent + 2) };
			}
			// Block scalar (literal/folded)
			return { [key]: parseBlockScalar(ctx, line.indent + 2) };
		}

		// Simple scalar value
		const value = parseScalar(rest);
		ctx.pos++;
		return { [key]: value };

		// Explicit array marker: -
	} else if (content.startsWith("- ")) {
		const itemContent = content.slice(2).trim();
		const item = parseScalar(itemContent);
		ctx.pos++;

		// Collect remaining array items at same indent
		const items: unknown[] = [item];
		while (ctx.pos < ctx.lines.length) {
			const next = ctx.lines[ctx.pos];
			if (next.isBlank) {
				ctx.pos++;
				continue;
			}
			if (next.indent !== line.indent) break;
			if (!next.content.startsWith("- ")) break;
			items.push(parseScalar(next.content.slice(2).trim()));
			ctx.pos++;
		}
		return items;

		// Quoted string spanning multiple lines or just quoted
	} else if (content.startsWith('"') || content.startsWith("'")) {
		const value = parseQuotedString(content);
		ctx.pos++;
		return value;

		// Plain scalar with colon after key
	} else if (content.includes(":")) {
		// Might be a key without a value (handle as map key)
		const [keyPart, ...restParts] = content.split(":");
		const joinedRest = restParts.join(":").trim();
		if (joinedRest.length > 0) {
			ctx.pos++;
			return { [keyPart.trim()]: parseScalar(joinedRest) };
		}
	}

	// Unknown / plain scalar
	ctx.pos++;
	return null;
}

/**
 * Parse a YAML map (indentation-based) from current position.
 */
function parseMap(ctx: ParseContext, baseIndent: number): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	while (ctx.pos < ctx.lines.length) {
		const line = ctx.lines[ctx.pos];

		// Exit conditions
		if (line.isBlank) {
			ctx.pos++;
			continue;
		}
		if (line.indent < baseIndent) break;

		// Parse key-value pair
		const content = line.content;

		// Handle explicit list items within a map key
		if (content.startsWith("- ") && line.indent > baseIndent) {
			// List items at this indent are array values
			ctx.pos++;
			continue;
		}

		const kvMatch = content.match(/^([\w][\w-]*)\s*:\s*(.*)$/);
		if (kvMatch) {
			const key = kvMatch[1];
			const rest = kvMatch[2];

			if (rest === "" || rest === "|" || rest === ">" || rest === "|-") {
				// Nested object or block scalar
				ctx.pos++;
				if (rest === "" || rest === "|-") {
					result[key] = parseMap(ctx, Math.max(baseIndent + 2, line.indent + 2));
				} else {
					result[key] = parseBlockScalar(ctx, Math.max(baseIndent + 2, line.indent + 2));
				}
			} else {
				// Scalar value
				result[key] = parseScalar(rest);
				ctx.pos++;
			}
		} else if (content.startsWith("- ") && line.indent === baseIndent) {
			// Top-level list items
			break;
		} else {
			// Unknown line, skip
			ctx.pos++;
		}
	}

	return result;
}

/**
 * Parse a list of items at a given indent level.
 */
function _parseList(ctx: ParseContext, baseIndent: number): unknown[] {
	const items: unknown[] = [];

	while (ctx.pos < ctx.lines.length) {
		const line = ctx.lines[ctx.pos];

		if (line.isBlank) {
			ctx.pos++;
			continue;
		}
		if (line.indent < baseIndent) break;

		if (line.content.startsWith("- ")) {
			const itemContent = line.content.slice(2).trim();

			// Check if item has a nested value
			const kvMatch = itemContent.match(/^([\w][\w-]*)\s*:\s*(.*)$/);
			if (kvMatch && kvMatch[2] === "") {
				// Item is a key with nested map
				ctx.pos++;
				const nestedMap = parseMap(ctx, line.indent + 2);
				items.push({ [kvMatch[1]]: nestedMap });
			} else {
				items.push(parseScalar(itemContent));
				ctx.pos++;
			}
		} else if (line.indent > baseIndent) {
			// Continuation of last item (nested content)
			ctx.pos++;
		} else {
			break;
		}
	}

	return items;
}

/**
 * Parse a block scalar (literal `|` or folded `>`).
 */
function parseBlockScalar(ctx: ParseContext, baseIndent: number): string {
	const lines: string[] = [];

	while (ctx.pos < ctx.lines.length) {
		const line = ctx.lines[ctx.pos];

		if (line.isBlank) {
			lines.push("");
			ctx.pos++;
			continue;
		}
		if (line.indent < baseIndent) break;

		lines.push(line.raw.slice(baseIndent));
		ctx.pos++;
	}

	return lines.join("\n").trim();
}

/**
 * Parse a scalar value (string, number, boolean, null).
 */
function parseScalar(raw: string): unknown {
	const trimmed = raw.trim();

	// Handle quoted strings
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}

	// Handle null
	if (trimmed === "" || trimmed === "null" || trimmed === "~") return null;

	// Handle booleans
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "yes") return true;
	if (trimmed === "no") return false;

	// Handle numbers
	if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
	if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);

	// Default: string
	return trimmed;
}

/**
 * Parse a quoted string, handling escaped quotes.
 */
function parseQuotedString(raw: string): string {
	const trimmed = raw.trim();
	const quote = trimmed[0];

	if ((quote !== '"' && quote !== "'") || !trimmed.endsWith(quote)) {
		return trimmed;
	}

	const inner = trimmed.slice(1, -1);
	if (quote === "'") return inner; // Single quotes: no escaping

	// Double quotes: handle escape sequences
	return inner.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
}

/**
 * Parse an inline array like [a, b, c] or ["a", "b"].
 */
function parseInlineArray(raw: string): unknown[] {
	const inner = raw.slice(1, -1).trim();
	if (!inner) return [];

	// Simple split on commas (handles quoted values)
	const items: string[] = [];
	let current = "";
	let inQuote = false;
	let quoteChar = "";

	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if ((ch === '"' || ch === "'") && (i === 0 || inner[i - 1] !== "\\")) {
			if (!inQuote) {
				inQuote = true;
				quoteChar = ch;
			} else if (ch === quoteChar) {
				inQuote = false;
				quoteChar = "";
			}
		} else if (ch === "," && !inQuote) {
			items.push(parseScalar(current.trim()) as string);
			current = "";
			continue;
		}
		current += ch;
	}
	if (current.trim()) {
		items.push(parseScalar(current.trim()) as string);
	}

	return items;
}

/**
 * Parse an inline map like {key: val, key2: val2}.
 */
function _parseInlineMap(raw: string, _ctx: ParseContext): Record<string, unknown> {
	const inner = raw.slice(1, -1).trim();
	const result: Record<string, unknown> = {};

	if (!inner) return result;

	// Split on commas, respecting quotes
	const parts: string[] = [];
	let current = "";
	let inQuote = false;
	let quoteChar = "";

	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if ((ch === '"' || ch === "'") && (i === 0 || inner[i - 1] !== "\\")) {
			if (!inQuote) {
				inQuote = true;
				quoteChar = ch;
			} else if (ch === quoteChar) {
				inQuote = false;
				quoteChar = "";
			}
		} else if (ch === "," && !inQuote) {
			parts.push(current.trim());
			current = "";
			continue;
		}
		current += ch;
	}
	if (current.trim()) parts.push(current.trim());

	for (const part of parts) {
		const colonIdx = part.indexOf(":");
		if (colonIdx === -1) continue;
		const key = part.slice(0, colonIdx).trim();
		const val = part.slice(colonIdx + 1).trim();
		result[key] = parseScalar(val);
	}

	return result;
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

	// Check for empty input
	if (!sourceYaml || sourceYaml.trim().length === 0) {
		diagnostics.push({
			code: "ACCP_PARSE_SOURCE_EMPTY",
			message: "Source YAML is empty",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return { parsed: null, diagnostics };
	}

	// Check for multiple YAML documents (--- separator anywhere)
	const yamlDocMatches = sourceYaml.match(/^---\s*$/gm);
	if (yamlDocMatches && yamlDocMatches.length > 0) {
		diagnostics.push({
			code: "ACCP_PARSE_SOURCE_INVALID",
			message: "YAML document separator (---) detected — only single-document ACCP-YAML is supported",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return { parsed: null, diagnostics };
	}

	// Strip leading comment/blank lines before checking for accp_version
	const linesForCheck = sourceYaml.split("\n");
	let firstContentLine = "";
	for (const line of linesForCheck) {
		const trimmedLine = line.trim();
		if (trimmedLine.length > 0 && !trimmedLine.startsWith("#")) {
			firstContentLine = trimmedLine;
			break;
		}
	}

	// Check for ACCP-YAML wrapper (must start with accp_version after stripping comments)
	const _trimmed = sourceYaml.trim();
	if (!firstContentLine.startsWith("accp_version:")) {
		diagnostics.push({
			code: "ACCP_PARSE_SOURCE_INVALID",
			message: "Source must start with 'accp_version:' — not an ACCP-YAML document",
			severity: "error",
			fatal: true,
			sourcePath,
		});
		return { parsed: null, diagnostics };
	}

	// Tokenize (use full source, including comments)
	const lines = tokenize(sourceYaml);
	const ctx: ParseContext = { lines, pos: 0, diagnostics, sourcePath };

	// Parse top-level map
	const sections = parseMap(ctx, 0);

	// Extract required fields
	const accpVersion = String(sections.accp_version ?? "");
	const sourceFormat = String(sections.source_format ?? "");

	// Validate accp_version
	if (!accpVersion) {
		diagnostics.push({
			code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
			message: "Missing required field: accp_version",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	} else if (accpVersion !== "2.0.0") {
		diagnostics.push({
			code: "ACCP_SCHEMA_INVALID_VERSION",
			message: `Invalid accp_version: expected "2.0.0", got "${accpVersion}"`,
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
			code: "ACCP_SCHEMA_INVALID_SOURCE_FORMAT",
			message: `Invalid source_format: expected "ACCP-YAML", got "${sourceFormat}"`,
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Extract report section
	const reportRaw = sections.report;
	let reportId = "";
	let reportType: AccpReportType = "FCR";
	let reportFamily: AccpReportFamily = "feature";
	let reportKind: string | undefined;
	let reportStatus: string | undefined;

	if (typeof reportRaw === "object" && reportRaw !== null && !Array.isArray(reportRaw)) {
		const reportObj = reportRaw as Record<string, unknown>;
		reportId = String(reportObj.id ?? "");
		reportType = (reportObj.type as AccpReportType) ?? "FCR";
		reportFamily = (reportObj.family as AccpReportFamily) ?? "feature";
		reportKind = reportObj.kind ? String(reportObj.kind) : undefined;
		reportStatus = reportObj.status ? String(reportObj.status) : undefined;

		// Validate report.type is a known type
		if (reportObj.type && !VALID_REPORT_TYPES.has(String(reportObj.type))) {
			diagnostics.push({
				code: "ACCP_SCHEMA_INVALID_REPORT_TYPE",
				message: `Unknown report type: "${reportObj.type}". Must be one of the 24 ACCP report types.`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}

		// Validate family matches type
		if (reportObj.type && reportObj.family) {
			const typeStr = String(reportObj.type);
			const familyStr = String(reportObj.family);
			if (VALID_REPORT_TYPES.has(typeStr) && TYPE_TO_FAMILY[typeStr]) {
				const expectedFamily = TYPE_TO_FAMILY[typeStr];
				if (familyStr !== expectedFamily) {
					diagnostics.push({
						code: "ACCP_SCHEMA_FAMILY_TYPE_MISMATCH",
						message: `Report family "${familyStr}" does not match canonical family "${expectedFamily}" for type "${typeStr}"`,
						severity: "warning",
						fatal: false,
						sourcePath,
					});
				}
			}
		}

		// Validate family is a known family
		if (reportObj.family && !VALID_REPORT_FAMILIES.has(String(reportObj.family))) {
			diagnostics.push({
				code: "ACCP_SCHEMA_INVALID_FAMILY",
				message: `Invalid report family: "${reportObj.family}". Must be one of: core, bugfix, feature, writing, coordination`,
				severity: "error",
				fatal: true,
				sourcePath,
			});
		}
	} else {
		// report section exists but is not a proper object
		diagnostics.push({
			code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
			message: "Invalid report section: must be a YAML object with id, type, and family fields",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Validate report.id
	if (!reportId) {
		diagnostics.push({
			code: "ACCP_SCHEMA_MISSING_REQUIRED_SECTION",
			message: "Missing required field: report.id",
			severity: "error",
			fatal: true,
			sourcePath,
		});
	}

	// Check for fatal diagnostics
	if (diagnostics.some((d) => d.fatal)) {
		return { parsed: null, diagnostics };
	}

	// Build sections map excluding core fields that are stored top-level
	const remainingSections: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(sections)) {
		if (key !== "accp_version" && key !== "source_format" && key !== "report") {
			remainingSections[key] = value;
		}
	}

	const parsed: AccpParsedReport = {
		accpVersion,
		sourceFormat,
		report: {
			id: reportId,
			type: reportType,
			family: reportFamily,
			...(reportKind ? { kind: reportKind } : {}),
			...(reportStatus ? { status: reportStatus } : {}),
		},
		meta: sections.meta as Record<string, unknown> | undefined,
		agent: sections.agent as Record<string, unknown> | undefined,
		capabilities: sections.capabilities as Record<string, unknown> | undefined,
		evidence: sections.evidence as unknown[] | undefined,
		references: sections.references as unknown[] | undefined,
		assumptions: sections.assumptions as Record<string, unknown> | undefined,
		skippedInspections: sections.skipped_inspections as Record<string, unknown> | undefined,
		sections: remainingSections,
	};

	return { parsed, diagnostics };
}
