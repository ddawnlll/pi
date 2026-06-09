/**
 * P44.05 — Negative Assertion Scanner
 *
 * Scans for negative assertion patterns ("must not", "should not",
 * "cannot", "never") in workspace output and generates evidence
 * ledger entries for violations. "Must not" requirements are
 * invisible to standard acceptance criteria checks; this module
 * ensures they are checked explicitly.
 *
 * References:
 * - EvidenceLedger (P44.02): produces evidence ledger entries
 * - EvidenceTypes (P44.02): evidence types, verdicts, confidence
 * - ForbiddenShortcutScanner (P44.05): complementary scanner
 */

import type { EvidenceLedgerEntry, EvidenceVerdict } from "./evidence-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Schema version for negative assertion results.
 */
export const NEGATIVE_ASSERTION_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A negative assertion pattern to scan for.
 */
export interface NegativeAssertionPattern {
	/** Unique identifier for this pattern */
	id: string;
	/** Human-readable description */
	description: string;
	/** The regex pattern to match */
	pattern: RegExp;
	/** Severity level */
	severity: "error" | "warning";
}

/**
 * The result of scanning for a single negative assertion pattern.
 */
export interface NegativeAssertionResult {
	/** The pattern ID that was checked */
	patternId: string;
	/** Description of what was checked */
	description: string;
	/** Whether the negative pattern was found */
	found: boolean;
	/** The matching text (if found) */
	match?: string;
	/** Line number where the match was found (1-indexed) */
	line?: number;
	/** Severity of this check */
	severity: "error" | "warning";
}

/**
 * Aggregate scan result for negative assertions.
 */
export interface NegativeAssertionScanResult {
	/** Whether all checks passed (no violations) */
	pass: boolean;
	/** Individual pattern results */
	results: NegativeAssertionResult[];
	/** Summary statistics */
	summary: {
		total: number;
		violations: number;
		warnings: number;
	};
	/** Schema version */
	schemaVersion: string;
}

/**
 * Options for scanning negative assertions.
 */
export interface NegativeAssertionScanOptions {
	/** Custom patterns to check (overrides defaults) */
	patterns?: NegativeAssertionPattern[];
	/** Additional patterns to append to defaults */
	additionalPatterns?: NegativeAssertionPattern[];
	/** Scope identifier for evidence generation (e.g., "P44.05") */
	scopeId?: string;
}

// ---------------------------------------------------------------------------
// Default Patterns
// ---------------------------------------------------------------------------

/**
 * Default negative assertion patterns.
 *
 * These cover common "must not" patterns found in workspace reports,
 * plan outputs, and completion artifacts.
 */
export const DEFAULT_NEGATIVE_PATTERNS: NegativeAssertionPattern[] = [
	{
		id: "must-not",
		description: 'Contains "must not" assertion',
		pattern: /\bmust\s+not\b/i,
		severity: "error",
	},
	{
		id: "should-not",
		description: 'Contains "should not" assertion',
		pattern: /\bshould\s+not\b/i,
		severity: "warning",
	},
	{
		id: "cannot",
		description: 'Contains "cannot" assertion',
		pattern: /\bcannot\b/i,
		severity: "warning",
	},
	{
		id: "never",
		description: 'Contains "never" assertion',
		pattern: /\bnever\b/i,
		severity: "warning",
	},
	{
		id: "must-not-be",
		description: 'Contains "must not be" assertion',
		pattern: /\bmust\s+not\s+be\b/i,
		severity: "error",
	},
	{
		id: "must-never",
		description: 'Contains "must never" assertion',
		pattern: /\bmust\s+never\b/i,
		severity: "error",
	},
	{
		id: "is-not-allowed",
		description: 'Contains "is not allowed" assertion',
		pattern: /\bis\s+not\s+allowed\b/i,
		severity: "error",
	},
	{
		id: "prohibited",
		description: 'Contains "prohibited" assertion',
		pattern: /\bprohibited\b/i,
		severity: "error",
	},
];

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * Scan content for negative assertion patterns.
 *
 * Returns a scan result with per-pattern findings and an aggregate
 * pass/fail summary.
 *
 * @param content - The text content to scan
 * @param options - Scan options (custom patterns, etc.)
 * @returns Scan result with findings and summary
 */
export function scanNegativeAssertions(
	content: string,
	options: NegativeAssertionScanOptions = {},
): NegativeAssertionScanResult {
	const patterns: NegativeAssertionPattern[] = options.patterns ?? DEFAULT_NEGATIVE_PATTERNS;
	if (options.additionalPatterns && options.additionalPatterns.length > 0) {
		patterns.push(...options.additionalPatterns);
	}

	const results: NegativeAssertionResult[] = [];
	let violations = 0;
	let warnings = 0;

	for (const pattern of patterns) {
		const match = content.match(pattern.pattern);
		if (match) {
			const line = findLineNumber(content, match.index);
			results.push({
				patternId: pattern.id,
				description: pattern.description,
				found: true,
				match: match[0],
				line,
				severity: pattern.severity,
			});
			if (pattern.severity === "error") {
				violations++;
			} else {
				warnings++;
			}
		} else {
			results.push({
				patternId: pattern.id,
				description: pattern.description,
				found: false,
				severity: pattern.severity,
			});
		}
	}

	return {
		pass: violations === 0,
		results,
		summary: {
			total: results.length,
			violations,
			warnings,
		},
		schemaVersion: NEGATIVE_ASSERTION_SCHEMA_VERSION,
	};
}

/**
 * Check whether a specific negative assertion pattern is present
 * in the given content.
 *
 * This is the "grep negative" check: returns true when the pattern
 * IS present (the negative assertion exists), false when absent.
 *
 * @param content - The text content to scan
 * @param patternId - The pattern ID to look for
 * @param patterns - Custom pattern list (uses defaults if omitted)
 * @returns true if the pattern was found
 */
export function checkNegativeAssertionPresent(
	content: string,
	patternId: string,
	patterns?: NegativeAssertionPattern[],
): boolean {
	const list = patterns ?? DEFAULT_NEGATIVE_PATTERNS;
	const pattern = list.find((p) => p.id === patternId);
	if (!pattern) {
		return false;
	}
	return pattern.pattern.test(content);
}

/**
 * Gnegative check: returns true when a negative assertion pattern
 * is ABSENT (i.e., the check passes — no violation found).
 * This is the inverse of checkNegativeAssertionPresent.
 *
 * @param content - The text content to scan
 * @param patternId - The pattern ID to look for
 * @param patterns - Custom pattern list
 * @returns true if the pattern was NOT found (check passes)
 */
export function grepNegativeCheck(content: string, patternId: string, patterns?: NegativeAssertionPattern[]): boolean {
	return !checkNegativeAssertionPresent(content, patternId, patterns);
}

// ---------------------------------------------------------------------------
// Evidence Integration
// ---------------------------------------------------------------------------

/**
 * Convert a negative assertion result into an evidence ledger entry.
 *
 * @param result - The negative assertion result
 * @param scopeId - Scope identifier (e.g., "P44.05")
 * @param sequence - Sequence number for evidence ID generation
 * @returns Evidence ledger entry
 */
export function negativeAssertionToEvidenceEntry(
	result: NegativeAssertionResult,
	scopeId: string,
	sequence: number,
): EvidenceLedgerEntry {
	const verdict: EvidenceVerdict = result.found ? (result.severity === "error" ? "fail" : "inconclusive") : "pass";

	const description = result.found
		? `Negative assertion '${result.description}' found${result.match ? `: "${result.match}"` : ""}${result.line ? ` at line ${result.line}` : ""}`
		: `Negative assertion '${result.description}' not found (pass)`;

	const normalizedScope = scopeId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
	const evidenceId = `EV-${normalizedScope}-${String(sequence).padStart(3, "0")}`;

	return {
		id: evidenceId,
		type: "automated_analysis",
		description,
		source: "negative-assertions.ts",
		timestamp: Date.now(),
		verdict,
		confidence: "high",
		content: JSON.stringify(result, null, 2),
		criterionIds: [],
		producedBy: scopeId,
	};
}

/**
 * Convert a full scan result into an array of evidence ledger entries.
 *
 * @param scanResult - The negative assertion scan result
 * @param scopeId - Scope identifier (e.g., "P44.05")
 * @returns Array of evidence ledger entries
 */
export function negativeAssertionsToEvidenceEntries(
	scanResult: NegativeAssertionScanResult,
	scopeId: string,
): EvidenceLedgerEntry[] {
	return scanResult.results.map((r, i) => negativeAssertionToEvidenceEntry(r, scopeId, i + 1));
}

// ---------------------------------------------------------------------------
// JSON Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a scan result to machine-readable JSON.
 *
 * @param scanResult - The scan result to serialize
 * @returns JSON string
 */
export function negativeAssertionScanToJson(scanResult: NegativeAssertionScanResult): string {
	return JSON.stringify(scanResult, null, 2);
}

/**
 * Parse a negative assertion scan result from JSON.
 *
 * @param json - JSON string to parse
 * @returns Parsed scan result
 */
export function negativeAssertionScanFromJson(json: string): NegativeAssertionScanResult {
	return JSON.parse(json) as NegativeAssertionScanResult;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Find the 1-indexed line number for a character index in a string.
 */
function findLineNumber(text: string, charIndex: number | undefined): number | undefined {
	if (charIndex === undefined) {
		return undefined;
	}
	let line = 1;
	for (let i = 0; i < charIndex && i < text.length; i++) {
		if (text[i] === "\n") {
			line++;
		}
	}
	return line;
}
