/**
 * Detection Types - P8.D
 *
 * Core types for bug, risk, and improvement detection. Defines the
 * categories of detections, risk scoring, evidence attachment, and
 * unsafe suggestion flagging that form the foundation of the P8
 * read-only lead agent's analytical capabilities.
 *
 * Acceptance Criteria:
 * 1. Each proposal includes risk, confidence, evidence, and requiresApproval.
 * 2. False-positive handling is tracked.
 * 3. Unsafe suggestions are flagged and cannot proceed.
 */

// ---------------------------------------------------------------------------
// Detection Categories
// ---------------------------------------------------------------------------

/**
 * The category of a detection finding.
 *
 * Maps to the requirement from P8.D: categorize bug candidates,
 * performance issues, refactor opportunities, dashboard UX issues,
 * conflict hotspots, queue inefficiencies, test coverage gaps, and
 * validation bottlenecks.
 */
export type DetectionCategory =
	| "bug_candidate"
	| "performance_issue"
	| "refactor_opportunity"
	| "dashboard_ux_issue"
	| "conflict_hotspot"
	| "queue_inefficiency"
	| "test_coverage_gap"
	| "validation_bottleneck"
	| "security_concern"
	| "code_quality"
	| "dependency_issue"
	| "documentation_gap";

// ---------------------------------------------------------------------------
// Risk & Confidence
// ---------------------------------------------------------------------------

/**
 * Risk level assigned to a detection finding.
 *
 * - low: Minimal impact if wrong; cosmetic or informational
 * - medium: Moderate impact; could cause rework or minor issues
 * - high: Significant impact; could cause data loss, corruption, or breakage
 */
export type RiskLevel = "low" | "medium" | "high";

/**
 * Confidence level in the detection finding's accuracy.
 *
 * - low: Speculative, needs human verification
 * - medium: Reasonably confident but could be wrong
 * - high: Strong evidence supports this finding
 */
export type ConfidenceLevel = "low" | "medium" | "high";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * A single piece of evidence supporting a detection finding.
 *
 * Evidence can be a code reference, log excerpt, metric, or
 * any other data point that supports the finding.
 */
export interface DetectionEvidenceItem {
	/** Type of evidence */
	type:
		| "code_reference"
		| "log_excerpt"
		| "metric"
		| "history"
		| "dependency_graph"
		| "test_result"
		| "static_analysis";
	/** Human-readable description of the evidence */
	description: string;
	/** File path the evidence relates to (if applicable) */
	filePath?: string;
	/** Line number range (if applicable) */
	lineRange?: { start: number; end: number };
	/** The actual evidence data (snippet, metric value, etc.) */
	data: string;
	/** Timestamp when this evidence was captured */
	capturedAt: number;
}

// ---------------------------------------------------------------------------
// Detection Result
// ---------------------------------------------------------------------------

/**
 * A single detection finding from the analysis engine.
 *
 * Each finding includes:
 * - category: What kind of issue this is
 * - risk: How severe the impact would be if the finding is correct
 * - confidence: How confident the engine is that this finding is accurate
 * - evidence: Supporting data for the finding
 * - requiresApproval: Whether human approval is needed before acting on this
 * - isUnsafe: Whether this finding suggests an unsafe operation
 */
export interface DetectionResult {
	/** Unique identifier for this detection */
	id: string;
	/** Category of the detection */
	category: DetectionCategory;
	/** Title (short human-readable) */
	title: string;
	/** Detailed description of the finding */
	description: string;
	/** Risk level if the finding is correct */
	risk: RiskLevel;
	/** Confidence in the finding's accuracy */
	confidence: ConfidenceLevel;
	/** Supporting evidence */
	evidence: DetectionEvidenceItem[];
	/** Whether human approval is required before acting on this finding */
	requiresApproval: boolean;
	/** Whether this suggestion is flagged as unsafe and cannot proceed */
	isUnsafe: boolean;
	/** Reason the finding is unsafe (only set when isUnsafe === true) */
	unsafeReason?: string;
	/** Whether this was previously marked as a false positive */
	isFalsePositive?: boolean;
	/** False positive tracking details */
	falsePositiveInfo?: FalsePositiveInfo;
	/** File paths relevant to this finding */
	affectedPaths?: string[];
	/** Workspace IDs relevant to this finding */
	affectedWorkspaceIds?: string[];
	/** Estimated effort to address (human-readable, e.g., "~30 min") */
	estimatedEffort?: string;
	/** Suggested fix or improvement */
	suggestedFix?: string;
	/** Timestamp when the detection was made */
	detectedAt: number;
	/** Source analysis that produced this finding */
	source: string;
}

// ---------------------------------------------------------------------------
// False-Positive Tracking
// ---------------------------------------------------------------------------

/**
 * Information about a false-positive detection.
 *
 * Tracks when a detection was determined to be incorrect,
 * why it was wrong, and how to avoid similar false positives.
 */
export interface FalsePositiveInfo {
	/** When the false positive was identified */
	identifiedAt: number;
	/** Who identified it (user or system) */
	identifiedBy: string;
	/** Reason it's a false positive */
	reason: string;
	/** Corrective action taken */
	correctiveAction?: string;
	/** Whether the detection pattern should be suppressed in the future */
	suppressFuture: boolean;
	/** Tags for categorizing false-positive types */
	tags?: string[];
}

/**
 * Summary of false-positive tracking for a set of detections.
 */
export interface FalsePositiveSummary {
	/** Total number of detections */
	totalDetections: number;
	/** Number of false positives identified */
	falsePositiveCount: number;
	/** False positive rate (0-1) */
	falsePositiveRate: number;
	/** Breakdown by category */
	byCategory: Record<DetectionCategory, { total: number; falsePositives: number; rate: number }>;
	/** Known false-positive patterns to suppress */
	suppressedPatterns: string[];
}

// ---------------------------------------------------------------------------
// Unsafe Suggestion Flagging
// ---------------------------------------------------------------------------

/**
 * Reasons a suggestion may be flagged as unsafe.
 */
export type UnsafeReason =
	| "modifies_protected_system"
	| "destructive_operation"
	| "modifies_executor_state"
	| "bypasses_approval"
	| "bypasses_validation"
	| "modifies_queue"
	| "bypasses_policy"
	| "unsafe_parallelism"
	| "exceeds_scope"
	| "modifies_security_config"
	| "modifies_auth_config"
	| "unknown";

/**
 * Result of checking whether a detection or suggestion is unsafe.
 */
export interface UnsafeCheckResult {
	/** Whether the item is unsafe */
	isUnsafe: boolean;
	/** Reasons it is unsafe (only populated when isUnsafe === true) */
	reasons: UnsafeReason[];
	/** Human-readable explanation */
	explanation: string;
	/** Whether the item is blocked entirely (cannot proceed) */
	blocked: boolean;
	/** Whether enhanced approval is needed (beyond normal approval) */
	requiresEnhancedApproval: boolean;
}

// ---------------------------------------------------------------------------
// Detection Output
// ---------------------------------------------------------------------------

/**
 * Complete output from the detection engine.
 *
 * Represents the result of running detection analysis on
 * repository data. Includes all findings, false-positive
 * tracking data, and safety checks.
 */
export interface DetectionOutput {
	/** Whether the detection analysis completed successfully */
	success: boolean;
	/** All detection findings */
	detections: DetectionResult[];
	/** False-positive summary */
	falsePositiveSummary: FalsePositiveSummary;
	/** Results of unsafe checks for all detections (keyed by detection ID) */
	unsafeCheckResults: Record<string, UnsafeCheckResult>;
	/** Detections that are unsafe and blocked */
	blockedDetections: DetectionResult[];
	/** Human-readable summary */
	summary: string;
	/** Error message if analysis failed */
	error?: string;
	/** Timestamp when the detection ran */
	analyzedAt: number;
	/** Duration of the analysis in ms */
	durationMs: number;
}

// ---------------------------------------------------------------------------
// Scoring Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a risk level to a numeric score (0-1).
 */
export function riskLevelToScore(level: RiskLevel): number {
	switch (level) {
		case "low":
			return 0.2;
		case "medium":
			return 0.5;
		case "high":
			return 0.8;
	}
}

/**
 * Convert a confidence level to a numeric score (0-1).
 */
export function confidenceLevelToScore(level: ConfidenceLevel): number {
	switch (level) {
		case "low":
			return 0.3;
		case "medium":
			return 0.6;
		case "high":
			return 0.9;
	}
}

/**
 * Convert a numeric confidence score (0-1) back to a level.
 */
export function scoreToConfidenceLevel(score: number): ConfidenceLevel {
	if (score >= 0.75) return "high";
	if (score >= 0.45) return "medium";
	return "low";
}

/**
 * Convert a numeric risk score (0-1) back to a level.
 */
export function scoreToRiskLevel(score: number): RiskLevel {
	if (score >= 0.65) return "high";
	if (score >= 0.35) return "medium";
	return "low";
}

/**
 * Generate a unique detection ID.
 */
export function generateDetectionId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 8);
	return `detect-${timestamp}-${random}`;
}
