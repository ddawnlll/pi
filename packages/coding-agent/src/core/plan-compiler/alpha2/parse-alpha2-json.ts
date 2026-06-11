/**
 * Parse Alpha2 JSON — Source Classification + JSON Parse + Schema Validation
 *
 * Phase 1: Source classification (Markdown, empty, version, kind)
 * Phase 2: JSON parse (malformed, root type)
 * Phase 3: Schema validation (Zod strict)
 */

import type { z } from "zod";
import { diag, fatal, type PlanDiagnostic } from "../diagnostics/diagnostic.js";
import { PlanDiagnosticCode } from "../diagnostics/diagnostic-codes.js";
import { PlanSpecV5Alpha2Schema } from "./alpha2-schema.js";
import type { PlanSpecV5Alpha2 } from "./alpha2-types.js";

// =============================================================================
// Source Classification
// =============================================================================

const MARKDOWN_HEADING_RE = /^#{1,6}\s/m;
const FRONTMATTER_RE = /^---\s*\n/;
const MARKDOWN_SECTION_RE = /^## Part /m;

/**
 * Classify the raw input string.
 * Returns null if input passes classification (looks like JSON).
 * Returns diagnostics if input is empty, Markdown, or otherwise invalid.
 */
export function classifySource(input: string): PlanDiagnostic[] | null {
	// Empty input
	if (!input || input.trim().length === 0) {
		return [
			fatal({
				code: PlanDiagnosticCode.E_EMPTY_INPUT,
				phase: "source_classification",
				message: "Plan input is empty",
			}),
		];
	}

	const trimmed = input.trim();

	// Markdown detection
	// Detect markdown headings
	if (MARKDOWN_HEADING_RE.test(trimmed)) {
		return [
			fatal({
				code: PlanDiagnosticCode.E_LEGACY_MARKDOWN,
				phase: "source_classification",
				message: "Markdown plans are no longer supported. Only PlanSpec v5 Alpha2 JSON is accepted.",
				hint: 'Provide a JSON document with planSpecVersion: "5.0.0-alpha2" and kind: "ImplementationPlan"',
			}),
		];
	}

	// YAML frontmatter
	if (FRONTMATTER_RE.test(trimmed)) {
		return [
			fatal({
				code: PlanDiagnosticCode.E_LEGACY_MARKDOWN,
				phase: "source_classification",
				message:
					"Markdown plans (YAML frontmatter) are no longer supported. Only PlanSpec v5 Alpha2 JSON is accepted.",
				hint: 'Provide a JSON document with planSpecVersion: "5.0.0-alpha2" and kind: "ImplementationPlan"',
			}),
		];
	}

	// Markdown section headers
	if (MARKDOWN_SECTION_RE.test(trimmed)) {
		return [
			fatal({
				code: PlanDiagnosticCode.E_LEGACY_MARKDOWN,
				phase: "source_classification",
				message:
					"Markdown plans (Part sections) are no longer supported. Only PlanSpec v5 Alpha2 JSON is accepted.",
				hint: 'Provide a JSON document with planSpecVersion: "5.0.0-alpha2" and kind: "ImplementationPlan"',
			}),
		];
	}

	// Non-JSON (doesn't start with { or [)
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		return [
			fatal({
				code: PlanDiagnosticCode.E_NOT_JSON,
				phase: "source_classification",
				message: "Input is not JSON. Only PlanSpec v5 Alpha2 JSON is accepted.",
				hint: 'Provide a JSON document with planSpecVersion: "5.0.0-alpha2" and kind: "ImplementationPlan"',
			}),
		];
	}

	return null;
}

// =============================================================================
// JSON Parse + Root Type
// =============================================================================

export interface JsonParseResult {
	parsed: unknown;
	diagnostics: PlanDiagnostic[];
}

/**
 * Parse JSON and validate root type.
 */
export function parseJson(input: string): JsonParseResult {
	const diagnostics: PlanDiagnostic[] = [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(input);
	} catch (e) {
		const err = e as SyntaxError;
		// Try to extract line/column from JSON parse error
		const sourceSpan = extractSourceSpan(err.message);
		diagnostics.push(
			fatal({
				code: PlanDiagnosticCode.E_MALFORMED_JSON,
				phase: "json_parse",
				message: `Invalid JSON: ${err.message}`,
				sourceSpan,
			}),
		);
		return { parsed: undefined, diagnostics };
	}

	// Root must be an object
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		diagnostics.push(
			fatal({
				code: PlanDiagnosticCode.E_ROOT_NOT_OBJECT,
				phase: "json_parse",
				path: "$",
				message: Array.isArray(parsed)
					? "Root must be an object, got array"
					: `Root must be an object, got ${typeof parsed}`,
			}),
		);
		return { parsed: undefined, diagnostics };
	}

	return { parsed, diagnostics };
}

// =============================================================================
// Version and Kind Validation
// =============================================================================

/**
 * Validate planSpecVersion and kind at the top level.
 * Returns diagnostics if version or kind is wrong.
 */
export function validateVersionAndKind(parsed: Record<string, unknown>): PlanDiagnostic[] {
	const diagnostics: PlanDiagnostic[] = [];

	const version = parsed.planSpecVersion;
	const legacyVersion = parsed.planspecVersion;
	const kind = parsed.kind;

	// Legacy RC1 key check first (planspecVersion — lowercase 's')
	if (legacyVersion === "5.0.0") {
		diagnostics.push(
			fatal({
				code: PlanDiagnosticCode.E_WRONG_VERSION,
				phase: "json_parse",
				path: "$.planspecVersion",
				message: 'Unsupported planspecVersion "5.0.0". Only planSpecVersion "5.0.0-alpha2" is supported.',
				hint: 'Rename "planspecVersion" to "planSpecVersion" and set to "5.0.0-alpha2"',
			}),
		);
	} else if (legacyVersion !== undefined && legacyVersion !== "5.0.0-alpha2") {
		diagnostics.push(
			fatal({
				code: PlanDiagnosticCode.E_WRONG_VERSION,
				phase: "json_parse",
				path: "$.planspecVersion",
				message: `Unsupported planspecVersion "${String(legacyVersion)}". Only planSpecVersion "5.0.0-alpha2" is supported.`,
				hint: 'Rename "planspecVersion" to "planSpecVersion" and set to "5.0.0-alpha2"',
			}),
		);
	}

	// Alpha2 version check
	if (version === undefined && legacyVersion === undefined) {
		diagnostics.push(
			fatal({
				code: PlanDiagnosticCode.E_MISSING_FIELD,
				phase: "json_parse",
				path: "$.planSpecVersion",
				message: "Missing required field: planSpecVersion",
				hint: 'Must be "5.0.0-alpha2"',
			}),
		);
	} else if (version !== undefined && version === "5.0.0") {
		diagnostics.push(
			fatal({
				code: PlanDiagnosticCode.E_WRONG_VERSION,
				phase: "json_parse",
				path: "$.planSpecVersion",
				message: 'Unsupported planSpecVersion "5.0.0". Only "5.0.0-alpha2" is supported.',
				hint: 'Change planSpecVersion to "5.0.0-alpha2" and update the document structure',
			}),
		);
	} else if (version !== undefined && version !== "5.0.0-alpha2") {
		diagnostics.push(
			fatal({
				code: PlanDiagnosticCode.E_WRONG_VERSION,
				phase: "json_parse",
				path: "$.planSpecVersion",
				message: `Unsupported planSpecVersion "${String(version)}". Only "5.0.0-alpha2" is supported.`,
				hint: 'Change planSpecVersion to "5.0.0-alpha2"',
			}),
		);
	}

	// Kind check
	if (kind === undefined) {
		diagnostics.push(
			fatal({
				code: PlanDiagnosticCode.E_MISSING_FIELD,
				phase: "json_parse",
				path: "$.kind",
				message: "Missing required field: kind",
				hint: 'Must be "ImplementationPlan"',
			}),
		);
	} else if (kind !== "ImplementationPlan") {
		diagnostics.push(
			fatal({
				code: PlanDiagnosticCode.E_WRONG_KIND,
				phase: "json_parse",
				path: "$.kind",
				message: `Unsupported kind "${String(kind)}". Only "ImplementationPlan" is supported.`,
				hint: 'Change kind to "ImplementationPlan"',
			}),
		);
	}

	return diagnostics;
}

// =============================================================================
// Schema Validation (Zod)
// =============================================================================

export interface SchemaValidationResult {
	spec?: PlanSpecV5Alpha2;
	diagnostics: PlanDiagnostic[];
}

/**
 * Validate against the strict Alpha2 Zod schema.
 * Converts Zod issues to compiler diagnostics.
 */
function owningSectionFromPath(pathSegments: readonly (string | number | symbol)[]): string | undefined {
	// Top-level key is the first string segment after root
	const topKey = pathSegments.find((s): s is string => typeof s === "string");
	return topKey;
}

function nearestParentPath(pathSegments: readonly (string | number | symbol)[]): string {
	if (pathSegments.length <= 1) return "$";
	const parent = pathSegments.slice(0, -1);
	return `$.${parent.join(".")}`;
}

function formatZodExpected(issue: z.ZodIssue): string | undefined {
	const issueRecord = issue as unknown as Record<string, unknown>;
	if ("expected" in issueRecord) {
		const val = issueRecord.expected;
		return val !== undefined ? String(val) : undefined;
	}
	const code = String(issueRecord.code);
	if (code === "invalid_type") {
		return String(issueRecord.expected ?? "");
	}
	if (code === "invalid_enum_value" || code === "invalid_literal" || code === "invalid_value") {
		const opts = issueRecord.options;
		if (Array.isArray(opts)) return opts.map(String).join("|");
	}
	return undefined;
}

function formatZodReceived(issue: z.ZodIssue): string | undefined {
	const issueRecord = issue as unknown as Record<string, unknown>;
	if ("received" in issueRecord) {
		const val = issueRecord.received;
		return val !== undefined ? String(val) : undefined;
	}
	return undefined;
}

export function validateAlpha2Schema(parsed: Record<string, unknown>): SchemaValidationResult {
	const result = PlanSpecV5Alpha2Schema.safeParse(parsed);

	if (result.success) {
		return { spec: result.data as PlanSpecV5Alpha2, diagnostics: [] };
	}

	const diagnostics = result.error.issues.map((issue) => {
		const path = `$.${issue.path.join(".")}`;
		const code = mapZodCode(issue.code);

		const issueRecord = issue as unknown as Record<string, unknown>;
		let message = String(issueRecord.message ?? "");
		let unknownKeys: string[] | undefined;
		const codeStr = String(issueRecord.code);
		if (codeStr === "unrecognized_keys") {
			const keys = (issueRecord.keys as string[]) ?? [];
			unknownKeys = keys;
			message = `Unknown property: ${keys.join(", ")}`;
		}

		const pathArr = Array.isArray(issueRecord.path) ? (issueRecord.path as (string | number | symbol)[]) : [];
		const section = owningSectionFromPath(pathArr);
		const parentPath = nearestParentPath(pathArr);

		return diag({
			code,
			phase: "schema_validation",
			path,
			message,
			zodCode: codeStr,
			expected: formatZodExpected(issue),
			received: formatZodReceived(issue),
			unknownKeys,
			owningSection: section,
			nearestParentPath: parentPath,
		});
	});

	return { diagnostics };
}

// =============================================================================
// Helpers
// =============================================================================

function mapZodCode(zodCode: string): (typeof PlanDiagnosticCode)[keyof typeof PlanDiagnosticCode] {
	switch (zodCode) {
		case "invalid_type":
			return PlanDiagnosticCode.E_INVALID_TYPE;
		case "invalid_literal":
		case "invalid_enum_value":
			return PlanDiagnosticCode.E_INVALID_VALUE;
		case "unrecognized_keys":
			return PlanDiagnosticCode.E_UNKNOWN_PROPERTY;
		default:
			return PlanDiagnosticCode.E_INVALID_VALUE;
	}
}

/**
 * Try to extract line/column from JSON.parse error message.
 */
function extractSourceSpan(message: string): { line: number; column: number } | undefined {
	// Chrome/V8 format: "Unexpected token } in JSON at position 123"
	// Node.js format: "Unexpected token ... at line 5 column 10"
	const lineColMatch = message.match(/at line (\d+) column (\d+)/);
	if (lineColMatch) {
		return { line: Number(lineColMatch[1]), column: Number(lineColMatch[2]) };
	}

	const posMatch = message.match(/at position (\d+)/);
	if (posMatch) {
		// We can't compute exact line/column without the input, but we have the position
		return { line: 0, column: Number(posMatch[1]) };
	}

	return undefined;
}
