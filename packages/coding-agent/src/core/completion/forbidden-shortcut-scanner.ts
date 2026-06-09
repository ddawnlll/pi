/**
 * P44.05 — Forbidden Shortcut Scanner
 *
 * Scans for forbidden shortcut patterns in workspace output and
 * code changes. Forbidden shortcuts include fake completions,
 * silent pass guards, `|| true` in validation commands, and
 * dangerous git patterns (`git add .`, `git add -A`) in worker
 * paths.
 *
 * References:
 * - completion-gate.ts: dangerous git command patterns
 * - NegativeAssertionScanner (P44.05): complementary scanner
 * - EvidenceLedger (P44.02): evidence production
 */

import type { EvidenceLedgerEntry, EvidenceVerdict } from "./evidence-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Schema version for forbidden shortcut scanner results.
 */
export const FORBIDDEN_SHORTCUT_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The type of forbidden shortcut.
 */
export type ForbiddenShortcutType =
	/** Fake or static stub completion (e.g., content that mimics a completion marker) */
	| "fake_completion"
	/** Static/stub placeholder that indicates no real work was done */
	| "static_stub"
	/** Silent pass guard that swallows failures */
	| "silent_pass_guard"
	/** `|| true` in a validation command that hides failures */
	| "or_true_validation"
	/** `git add .` in a worker path (staging outside write-set) */
	| "git_add_dot"
	/** `git add -A` in a worker path (staging outside write-set) */
	| "git_add_A"
	/** `git commit -a` or `--all` in a worker path */
	| "git_commit_a";

/**
 * A single forbidden shortcut scan result.
 */
export interface ForbiddenShortcutResult {
	/** The type of shortcut detected */
	type: ForbiddenShortcutType;
	/** Human-readable description */
	description: string;
	/** Whether the shortcut was found */
	found: boolean;
	/** The matching text (if found) */
	match?: string;
	/** Line number where the match was found (1-indexed) */
	line?: number;
	/** Whether this finding blocks completion */
	blocked: boolean;
}

/**
 * Aggregate scan result for forbidden shortcuts.
 */
export interface ForbiddenShortcutScanResult {
	/** Whether any blocking shortcuts were found */
	blocked: boolean;
	/** Individual shortcut results */
	results: ForbiddenShortcutResult[];
	/** Summary statistics */
	summary: {
		total: number;
		violations: number;
	};
	/** Schema version */
	schemaVersion: string;
}

/**
 * Options for scanning forbidden shortcuts.
 */
export interface ForbiddenShortcutScanOptions {
	/** Set of shortcut types to skip during scanning */
	skipTypes?: Set<ForbiddenShortcutType>;
	/** Additional regex patterns to check (as custom rules) */
	customPatterns?: Array<{ type: string; description: string; pattern: RegExp; blocked: boolean }>;
}

// ---------------------------------------------------------------------------
// Forbidden Shortcut Patterns
// ---------------------------------------------------------------------------

/**
 * Maps each forbidden shortcut type to its detection regex pattern.
 *
 * These patterns identify constructs that indicate a workspace worker
 * tried to shortcut the completion process.
 */
export const FORBIDDEN_SHORTCUT_PATTERNS: Record<ForbiddenShortcutType, RegExp> = {
	fake_completion: /\[COMPLETE\]|\[DONE\]|MARK\s+AS\s+(COMPLETE|DONE)|COMPLETION\s+MARKER|#\s*COMPLETE\s*$/im,
	static_stub:
		/\bTODO:\s*implement\b|\bstub\s+implementation\b|\bplaceholder\b|\bnot\s+really\s+implemented\b|\bjackson\s+stubbed\b/i,
	silent_pass_guard: /(silently\s+)?(skip|ignore|swallow|suppress)\s+(errors?|failures?|exceptions?|checks?)/i,
	or_true_validation: /\|\|\s*true\b/,
	git_add_dot: /\bgit\s+add\s*\.(?:\s|$|&&|;)/,
	git_add_A: /\bgit\s+add\s+-A(?:\s|$|&&|;)|\bgit\s+add\s+--all(?:\s|$|&&|;)/,
	git_commit_a:
		/\bgit\s+commit\s+-a(?:\s|$|&&|;)|\bgit\s+commit\s+--all(?:\s|$|&&|;)|\bgit\s+commit\s+-am(?:\s|$|&&|;)/,
};

/**
 * Descriptions for each forbidden shortcut type.
 */
export const FORBIDDEN_SHORTCUT_DESCRIPTIONS: Record<ForbiddenShortcutType, string> = {
	fake_completion: "Fake completion marker detected",
	static_stub: "Static stub or placeholder detected",
	silent_pass_guard: "Silent pass guard detected (swallows errors)",
	or_true_validation: "'|| true' in validation command hides failures",
	git_add_dot: "'git add .' stages outside the write-set",
	git_add_A: "'git add -A' stages outside the write-set",
	git_commit_a: "'git commit -a' commits outside the write-set",
};

/**
 * Whether each shortcut type blocks completion entirely.
 */
export const FORBIDDEN_SHORTCUT_BLOCKED: Record<ForbiddenShortcutType, boolean> = {
	fake_completion: true,
	static_stub: true,
	silent_pass_guard: true,
	or_true_validation: true,
	git_add_dot: true,
	git_add_A: true,
	git_commit_a: true,
};

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * Scan content for forbidden shortcut patterns.
 *
 * Returns a scan result indicating which shortcuts were found and
 * whether the content should be blocked from completing.
 *
 * @param content - The text content to scan
 * @param options - Scan options (skip types, custom patterns, etc.)
 * @returns Scan result with findings and block status
 */
export function scanForbiddenShortcuts(
	content: string,
	options: ForbiddenShortcutScanOptions = {},
): ForbiddenShortcutScanResult {
	const types = Object.keys(FORBIDDEN_SHORTCUT_PATTERNS) as ForbiddenShortcutType[];
	const results: ForbiddenShortcutResult[] = [];
	let violations = 0;

	for (const type of types) {
		if (options.skipTypes?.has(type)) {
			continue;
		}

		const pattern = FORBIDDEN_SHORTCUT_PATTERNS[type];
		const match = content.match(pattern);
		const blocked = FORBIDDEN_SHORTCUT_BLOCKED[type];

		if (match) {
			const line = findLineNumber(content, match.index);
			results.push({
				type,
				description: FORBIDDEN_SHORTCUT_DESCRIPTIONS[type],
				found: true,
				match: match[0],
				line,
				blocked,
			});
			violations++;
		} else {
			results.push({
				type,
				description: FORBIDDEN_SHORTCUT_DESCRIPTIONS[type],
				found: false,
				blocked,
			});
		}
	}

	// Custom patterns
	if (options.customPatterns) {
		for (const custom of options.customPatterns) {
			const match = content.match(custom.pattern);
			if (match) {
				const line = findLineNumber(content, match.index);
				results.push({
					type: custom.type as ForbiddenShortcutType,
					description: custom.description,
					found: true,
					match: match[0],
					line,
					blocked: custom.blocked,
				});
				violations++;
			}
		}
	}

	const blocked = results.some((r) => r.found && r.blocked);

	return {
		blocked,
		results,
		summary: {
			total: results.length,
			violations,
		},
		schemaVersion: FORBIDDEN_SHORTCUT_SCHEMA_VERSION,
	};
}

/**
 * Check whether any blocking shortcuts were found.
 * Convenience wrapper around the scan result.
 *
 * @param result - The scan result to check
 * @returns true if any blocking shortcuts were found
 */
export function blockedByForbiddenShortcuts(result: ForbiddenShortcutScanResult): boolean {
	return result.blocked;
}

/**
 * Get all blocking shortcut results from a scan.
 *
 * @param result - The scan result
 * @returns Array of blocking shortcut results
 */
export function getBlockingShortcuts(result: ForbiddenShortcutScanResult): ForbiddenShortcutResult[] {
	return result.results.filter((r) => r.found && r.blocked);
}

// ---------------------------------------------------------------------------
// Evidence Integration
// ---------------------------------------------------------------------------

/**
 * Convert a forbidden shortcut result into an evidence ledger entry.
 *
 * @param result - The forbidden shortcut result
 * @param scopeId - Scope identifier (e.g., "P44.05")
 * @param sequence - Sequence number for evidence ID generation
 * @returns Evidence ledger entry
 */
export function forbiddenShortcutToEvidenceEntry(
	result: ForbiddenShortcutResult,
	scopeId: string,
	sequence: number,
): EvidenceLedgerEntry {
	const verdict: EvidenceVerdict = result.found ? (result.blocked ? "fail" : "inconclusive") : "pass";

	const description = result.found
		? `Forbidden shortcut '${result.description}' detected${result.match ? `: "${result.match}"` : ""}${result.line ? ` at line ${result.line}` : ""}`
		: `Forbidden shortcut '${result.description}' not found (pass)`;

	const normalizedScope = scopeId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
	const evidenceId = `EV-${normalizedScope}-${String(sequence).padStart(3, "0")}`;

	return {
		id: evidenceId,
		type: "security_scan",
		description,
		source: "forbidden-shortcut-scanner.ts",
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
 * @param scanResult - The forbidden shortcut scan result
 * @param scopeId - Scope identifier (e.g., "P44.05")
 * @returns Array of evidence ledger entries
 */
export function forbiddenShortcutsToEvidenceEntries(
	scanResult: ForbiddenShortcutScanResult,
	scopeId: string,
): EvidenceLedgerEntry[] {
	return scanResult.results.map((r, i) => forbiddenShortcutToEvidenceEntry(r, scopeId, i + 1));
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
export function forbiddenShortcutScanToJson(scanResult: ForbiddenShortcutScanResult): string {
	return JSON.stringify(scanResult, null, 2);
}

/**
 * Parse a forbidden shortcut scan result from JSON.
 *
 * @param json - JSON string to parse
 * @returns Parsed scan result
 */
export function forbiddenShortcutScanFromJson(json: string): ForbiddenShortcutScanResult {
	return JSON.parse(json) as ForbiddenShortcutScanResult;
}

// ---------------------------------------------------------------------------
// Combined Scanner
// ---------------------------------------------------------------------------

/**
 * Combined result from both the negative assertion scanner and
 * the forbidden shortcut scanner.
 */
export interface CombinedCompletionScanResult {
	negativeAssertions: NegativeAssertionScanResult;
	forbiddenShortcuts: ForbiddenShortcutScanResult;
	blocked: boolean;
}

import type { NegativeAssertionScanResult } from "./negative-assertions.js";
import { scanNegativeAssertions } from "./negative-assertions.js";

/**
 * Run both scanners on content and produce a combined result.
 *
 * @param content - The text content to scan
 * @returns Combined scan result with block status
 */
export function scanCompletion(content: string): CombinedCompletionScanResult {
	const negativeAssertions = scanNegativeAssertions(content);
	const forbiddenShortcuts = scanForbiddenShortcuts(content);

	return {
		negativeAssertions,
		forbiddenShortcuts,
		blocked: forbiddenShortcuts.blocked,
	};
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
