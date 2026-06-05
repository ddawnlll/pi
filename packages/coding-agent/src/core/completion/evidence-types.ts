/**
 * P44.02 — EvidenceLedger: Evidence Types
 *
 * Defines the types for evidence stored in the EvidenceLedger.
 * Each evidence entry tracks a piece of information that supports
 * or contradicts an acceptance criterion.
 *
 * Contract Schema: 4.1.1
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for evidence ledger entries.
 */
export const EVIDENCE_LEDGER_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The type/source of evidence.
 */
export type EvidenceType =
	/** Output from running a test suite or test command */
	| "test_run"
	/** Source file content or metadata */
	| "source_file"
	/** Manual review result */
	| "manual_review"
	/** Artifact produced by a workspace (report, file, etc.) */
	| "artifact"
	/** Log output from a command execution */
	| "log_output"
	/** Type-checking or linting result */
	| "static_analysis"
	/** Command exit code and output */
	| "command_result"
	/** Build/compilation output */
	| "build_output"
	/** Performance benchmark result */
	| "benchmark"
	/** Security scan result */
	| "security_scan"
	/** Human approval or sign-off */
	| "approval"
	/** Automated analysis result */
	| "automated_analysis"
	/** External system reference or link */
	| "external_reference"
	/** Other evidence type */
	| "other";

/**
 * The confidence level assigned to evidence.
 */
export type EvidenceConfidence = "high" | "medium" | "low" | "unknown";

/**
 * Verdict of an evidence evaluation against an acceptance criterion.
 */
export type EvidenceVerdict = "pass" | "fail" | "inconclusive" | "not_evaluated";

/**
 * A single entry in the evidence ledger.
 */
export interface EvidenceLedgerEntry {
	/** Unique evidence identifier (e.g., "EV-P4401-001") */
	id: string;
	/** Type of evidence */
	type: EvidenceType;
	/** Human-readable description of what this evidence is */
	description: string;
	/** Source of the evidence (file path, command, URL, etc.) */
	source: string;
	/** When the evidence was recorded (epoch ms) */
	timestamp: number;
	/** Verdict against the associated acceptance criterion */
	verdict: EvidenceVerdict;
	/** Confidence in this evidence */
	confidence: EvidenceConfidence;
	/** Full content or summary of the evidence */
	content: string;
	/** Optional structured metadata */
	metadata?: Record<string, unknown>;
	/** Which workspace or plan execution produced this evidence */
	producedBy?: string;
	/** The criterion IDs this evidence relates to */
	criterionIds: string[];
}

/**
 * Filter criteria for querying the evidence ledger.
 */
export interface EvidenceFilter {
	/** Filter by evidence type */
	type?: EvidenceType;
	/** Filter by verdict */
	verdict?: EvidenceVerdict;
	/** Filter by confidence level or higher */
	minConfidence?: EvidenceConfidence;
	/** Filter by producing scope */
	producedBy?: string;
	/** Filter by criterion ID */
	criterionId?: string;
	/** Filter by timestamp range (inclusive) */
	after?: number;
	before?: number;
	/** Maximum number of results */
	limit?: number;
	/** Offset for pagination */
	offset?: number;
}

/**
 * Summary statistics for a set of evidence entries.
 */
export interface EvidenceSummary {
	total: number;
	byType: Record<string, number>;
	byVerdict: Record<string, number>;
	byConfidence: Record<string, number>;
	passRate: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an evidence ID from a scope prefix and sequence number.
 *
 * @param prefix - Scope prefix (e.g., "P4401" or "P44.01")
 * @param sequence - Sequence number (zero-padded to 3 digits)
 * @returns Formatted evidence ID (e.g., "EV-P4401-001")
 */
export function formatEvidenceId(prefix: string, sequence: number): string {
	const normalized = prefix.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
	return `EV-${normalized}-${String(sequence).padStart(3, "0")}`;
}

/**
 * Compute a summary for an array of evidence entries.
 *
 * @param entries - Evidence ledger entries
 * @returns Summary statistics
 */
export function computeEvidenceSummary(entries: EvidenceLedgerEntry[]): EvidenceSummary {
	const byType: Record<string, number> = {};
	const byVerdict: Record<string, number> = {};
	const byConfidence: Record<string, number> = {};

	for (const e of entries) {
		byType[e.type] = (byType[e.type] ?? 0) + 1;
		byVerdict[e.verdict] = (byVerdict[e.verdict] ?? 0) + 1;
		byConfidence[e.confidence] = (byConfidence[e.confidence] ?? 0) + 1;
	}

	const passed = entries.filter((e) => e.verdict === "pass").length;
	const passRate = entries.length > 0 ? passed / entries.length : 0;

	return {
		total: entries.length,
		byType,
		byVerdict,
		byConfidence,
		passRate,
	};
}

/**
 * Check if a confidence level meets or exceeds a minimum threshold.
 *
 * Confidence ordering: high > medium > low > unknown
 *
 * @param confidence - The confidence level to check
 * @param minConfidence - Minimum required confidence level
 * @returns True if confidence meets or exceeds the threshold
 */
export function meetsMinConfidence(confidence: EvidenceConfidence, minConfidence: EvidenceConfidence): boolean {
	const order: EvidenceConfidence[] = ["high", "medium", "low", "unknown"];
	const actualIdx = order.indexOf(confidence);
	const minIdx = order.indexOf(minConfidence);
	if (actualIdx === -1) return false;
	if (minIdx === -1) return false;
	return actualIdx <= minIdx;
}
