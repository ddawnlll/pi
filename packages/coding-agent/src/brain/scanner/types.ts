/**
 * Repo Scanner v2 — V5.05
 *
 * Core types for the repo scanner module.
 *
 * The scanner performs read-only analysis of a project repository:
 * - Git diff analysis for risky/unusual changes
 * - Hotspot detection (areas of high change frequency)
 * - Failure correlation (linking files/areas to execution failures)
 * - Stale plan area detection (plans not touched recently)
 * - Proposal candidate generation (opportunities for improvement)
 *
 * All output is evidence-backed via EvidenceRef and follows the V4
 * ExecutionKernel doctrine — the scanner never mutates execution state.
 *
 * @packageDocumentation
 */

import type { EvidenceRef } from "../evidence/types.js";

// =========================================================================
// Scan Targets & Requests
// =========================================================================

/** The scope of a scan operation. */
export type ScanTarget = "project" | "workspace" | "plan" | "all";

/** Request parameters for initiating a scan. */
export interface ScanRequest {
	/** What to scan. */
	target: ScanTarget;
	/** Workspace ID (required when target is "workspace"). */
	workspaceId?: string;
	/** Plan execution ID (required when target is "plan"). */
	planExecId?: string;
	/** Additional context for the scanner. */
	context?: {
		/** Project root directory. */
		projectRoot?: string;
		/** .pi directory name (default: ".pi"). */
		piDir?: string;
	};
}

// =========================================================================
// Scanner Output Types
// =========================================================================

/**
 * A hotspot — a file or directory that has experienced high change frequency.
 *
 * Hotspots are detected by analyzing git log for files with above-average
 * commit counts within a time window. They represent areas of code churn
 * that may need attention or refactoring.
 */
export interface Hotspot {
	/** File or directory path relative to project root. */
	path: string;
	/** Type of entity. */
	entityType: "file" | "directory";
	/** Number of changes (commits touching this path) in the analyzed window. */
	changeCount: number;
	/** Number of unique committers, if detectable. */
	contributorCount?: number;
	/** Lines added across all changes. */
	linesAdded?: number;
	/** Lines removed across all changes. */
	linesRemoved?: number;
	/** Severity based on change count relative to threshold. */
	severity: "info" | "warning" | "critical";
	/** Evidence references backing this hotspot. */
	evidence: EvidenceRef[];
	/** Human-readable summary. */
	summary: string;
	/** Additional metadata. */
	metadata?: Record<string, unknown>;
}

/**
 * A risky diff — a change that is unusually large, touches many areas,
 * or exhibits patterns associated with buggy commits.
 *
 * Risky diffs are identified by analyzing git diff output for:
 * - Large total change size (lines added + removed)
 * - Touching many files or directories
 * - High churn (near-equal add/remove suggesting rewrite)
 * - Touching both implementation and tests in suspicious proportions
 */
export interface RiskyDiff {
	/** Commit hash or "uncommitted" for uncommitted changes. */
	commitHash: string;
	/** Commit subject message, if available. */
	commitMessage?: string;
	/** Files changed in this diff. */
	filesChanged: string[];
	/** Lines added. */
	linesAdded: number;
	/** Lines removed. */
	linesRemoved: number;
	/** Total change size (added + removed). */
	totalChanges: number;
	/** Whether the diff touches files in multiple functional areas. */
	touchesMultipleAreas: boolean;
	/** Risk score 0–1 computed from heuristics. */
	riskScore: number;
	/** Severity based on risk score. */
	severity: "info" | "warning" | "critical";
	/** Evidence references backing this diff. */
	evidence: EvidenceRef[];
	/** Human-readable summary. */
	summary: string;
	/** Additional metadata. */
	metadata?: Record<string, unknown>;
}

/**
 * A failure correlation — linking a specific file or area to execution failures.
 *
 * Correlations are derived by analyzing execution journal entries and
 * cross-referencing with git blame information for the affected workspace
 * files. A strong correlation suggests the file may be a root cause of
 * failures.
 */
export interface FailureCorrelation {
	/** File or directory path relative to project root. */
	path: string;
	/** Number of failures correlated with this path. */
	failureCount: number;
	/** Distinct error message patterns that correlate. */
	errorPatterns: string[];
	/** Confidence in the correlation 0–1. */
	correlationConfidence: number;
	/** Severity based on failure count and confidence. */
	severity: "info" | "warning" | "critical";
	/** Evidence references backing this correlation. */
	evidence: EvidenceRef[];
	/** Human-readable summary. */
	summary: string;
	/** Additional metadata. */
	metadata?: Record<string, unknown>;
}

/**
 * A stale plan area — a plan file that has not been modified recently.
 *
 * Plans that remain untouched beyond a configurable threshold may indicate
 * areas where execution has stalled, dependencies are unresolved, or the
 * plan is no longer relevant.
 */
export interface StalePlanArea {
	/** Plan file path relative to project root. */
	path: string;
	/** ISO 8601 timestamp of last modification. */
	lastModified: string;
	/** Estimated days since last modification. */
	daysSinceModification: number;
	/** Current plan status (from plan metadata, if available). */
	status: string;
	/** Plan title or name, if derivable. */
	planName?: string;
	/** Severity based on staleness. */
	severity: "info" | "warning";
	/** Evidence references backing this stale area. */
	evidence: EvidenceRef[];
	/** Human-readable summary. */
	summary: string;
	/** Additional metadata. */
	metadata?: Record<string, unknown>;
}

/**
 * A proposal candidate — a concrete improvement suggestion derived from
 * scanner findings.
 *
 * Proposal candidates are generated by synthesizing multiple scanner signals
 * (hotspots, risky diffs, failure correlations, stale areas) into actionable
 * proposals that can be reviewed and potentially escalated to the proposals
 * system.
 */
export interface ProposalCandidate {
	/** Short title. */
	title: string;
	/** Detailed description of the opportunity. */
	description: string;
	/** Priority estimate. */
	priority: "low" | "medium" | "high";
	/** Suggested next action. */
	suggestedAction: string;
	/** Evidence references backing this candidate. */
	evidence: EvidenceRef[];
	/** Confidence 0–1. */
	confidence: number;
	/** Human-readable summary. */
	summary: string;
	/** Which scanner signal type(s) triggered this candidate. */
	triggeredBy: Array<"hotspot" | "risky_diff" | "failure_correlation" | "stale_plan_area">;
	/** Additional metadata. */
	metadata?: Record<string, unknown>;
}

// =========================================================================
// Scanner Result
// =========================================================================

/**
 * Complete output from a scan operation.
 *
 * All findings are evidence-backed and safe for read-only consumption.
 * The scanner never mutates repo state or calls git push.
 */
export interface ScanResult {
	/** ISO 8601 timestamp of when the scan ran. */
	scannedAt: string;
	/** The target that was scanned. */
	target: ScanTarget;
	/** Duration of the scan in milliseconds. */
	durationMs: number;
	/** Detected hotspots, sorted by severity then change count. */
	hotspots: Hotspot[];
	/** Detected risky diffs, sorted by risk score descending. */
	riskyDiffs: RiskyDiff[];
	/** Detected failure correlations, sorted by confidence descending. */
	failureCorrelations: FailureCorrelation[];
	/** Detected stale plan areas, sorted by staleness descending. */
	stalePlanAreas: StalePlanArea[];
	/** Generated proposal candidates, sorted by priority then confidence. */
	proposalCandidates: ProposalCandidate[];
	/** Aggregate evidence references backing the entire report. */
	evidence: EvidenceRef[];
	/** Any non-fatal errors encountered during scanning. */
	errors: string[];
	/** Overall confidence in the scan results (0–1). */
	confidence: number;
}

// =========================================================================
// Scanner Options
// =========================================================================

/**
 * Configuration options for the repo scanner.
 *
 * All thresholds have sensible defaults and can be overridden
 * for different project sizes or sensitivity requirements.
 */
export interface ScannerOptions {
	/** Project root directory. */
	projectRoot: string;
	/** .pi directory name (default: ".pi"). */
	piDir?: string;
	/** Path to git binary (default: "git"). */
	gitPath?: string;
	/**
	 * Minimum number of changes for a file to be considered a hotspot.
	 * Default: 5 changes.
	 */
	hotspotMinChanges?: number;
	/**
	 * Number of recent commits to analyze for hotspot detection.
	 * Default: 100 commits.
	 */
	hotspotCommitWindow?: number;
	/**
	 * Risk score threshold above which a diff is flagged.
	 * Default: 0.5.
	 */
	riskThreshold?: number;
	/**
	 * Large diff threshold in lines changed.
	 * Default: 500 lines.
	 */
	largeDiffThreshold?: number;
	/**
	 * Number of days after which a plan area is considered stale.
	 * Default: 14 days.
	 */
	staleThresholdDays?: number;
	/**
	 * Minimum number of failures for a correlation to be reported.
	 * Default: 2 failures.
	 */
	correlationMinFailures?: number;
	/**
	 * Maximum number of results per category.
	 * Default: 20.
	 */
	maxResults?: number;
}

// =========================================================================
// Scanner Defaults
// =========================================================================

/** Default scanner options applied when values are not provided. */
export const DEFAULT_SCANNER_OPTIONS: Omit<ScannerOptions, "projectRoot"> = {
	piDir: ".pi",
	gitPath: "git",
	hotspotMinChanges: 5,
	hotspotCommitWindow: 100,
	riskThreshold: 0.5,
	largeDiffThreshold: 500,
	staleThresholdDays: 14,
	correlationMinFailures: 2,
	maxResults: 20,
};

// =========================================================================
// Scanner Signal Types
// =========================================================================

/**
 * Signal type labels that the scanner can generate in brain timeline events.
 */
export type ScannerSignalType =
	| "hotspot"
	| "risky_diff"
	| "failure_correlation"
	| "stale_plan_area"
	| "proposal_candidate";

/** All scanner signal types for runtime validation. */
export const ALL_SCANNER_SIGNAL_TYPES: ScannerSignalType[] = [
	"hotspot",
	"risky_diff",
	"failure_correlation",
	"stale_plan_area",
	"proposal_candidate",
];

// =========================================================================
// Scanner Error Types
// =========================================================================

/** Categories of errors the scanner may encounter. */
export type ScannerErrorCategory = "git" | "filesystem" | "parsing" | "timeout" | "internal";

/** A structured scanner error. */
export interface ScannerError {
	category: ScannerErrorCategory;
	message: string;
	details?: string;
}

// =========================================================================
// Helper functions
// =========================================================================

/**
 * Compute a risk label based on a numeric score.
 *
 * @param score - Risk score 0–1
 * @returns The corresponding severity label
 */
export function riskScoreToSeverity(score: number): "info" | "warning" | "critical" {
	if (score >= 0.8) return "critical";
	if (score >= 0.5) return "warning";
	return "info";
}

/**
 * Compute a hotspot severity based on change count relative to a threshold.
 *
 * @param changeCount - Number of changes detected
 * @param threshold - The minimum threshold for hotspot classification
 * @returns The corresponding severity label
 */
export function hotspotSeverity(changeCount: number, threshold: number): "info" | "warning" | "critical" {
	if (changeCount >= threshold * 3) return "critical";
	if (changeCount >= threshold * 1.5) return "warning";
	return "info";
}

/**
 * Compute a correlation severity based on failure count and confidence.
 *
 * @param failureCount - Number of correlated failures
 * @param confidence - Correlation confidence 0–1
 * @returns The corresponding severity label
 */
export function correlationSeverity(failureCount: number, confidence: number): "info" | "warning" | "critical" {
	if (failureCount >= 5 && confidence >= 0.7) return "critical";
	if (failureCount >= 3 && confidence >= 0.5) return "warning";
	return "info";
}

/**
 * Compute a priority label from a numeric score 0–1.
 */
export function scoreToPriority(score: number): "low" | "medium" | "high" {
	if (score >= 0.7) return "high";
	if (score >= 0.4) return "medium";
	return "low";
}
