/**
 * Evidence Index Types — V5.02
 *
 * Defines the core data structures for the unified evidence index.
 *
 * The evidence index is a read-only index (with respect to execution state)
 * that collects evidence references from across the system — git files,
 * validation logs, execution journal events, memory records, proposals,
 * reflections, and approval/decision records.
 *
 * Every V5 brain output (answers, proposals, memory injections, drafts)
 * can reference evidence via EvidenceRef instances.
 *
 * Missing evidence downgrades confidence or blocks confident claims.
 *
 * Following V4 ExecutionKernel doctrine: the evidence index reads from
 * execution artifacts but never mutates execution state directly.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Evidence Ref Types
// ---------------------------------------------------------------------------

/**
 * Types of evidence that the index can reference.
 *
 * Covers all artifact types across the system:
 * - git_file:            Git-tracked files, commits, diffs
 * - validation:          Validation log entries and results
 * - execution_journal:   Execution journal events from workspace runs
 * - memory:              Brain memory records
 * - proposal:            Brain proposals
 * - reflection:          Brain reflection reports
 * - approval:            User approval/decision records
 * - observation:         Brain observations
 * - signal:              Brain signals
 * - temporal_event:      Temporal journal events (V5.01)
 */
export type EvidenceRefType =
	| "git_file"
	| "validation"
	| "execution_journal"
	| "memory"
	| "proposal"
	| "reflection"
	| "approval"
	| "observation"
	| "signal"
	| "temporal_event";

/** All valid EvidenceRefType values for runtime validation. */
export const ALL_EVIDENCE_REF_TYPES: EvidenceRefType[] = [
	"git_file",
	"validation",
	"execution_journal",
	"memory",
	"proposal",
	"reflection",
	"approval",
	"observation",
	"signal",
	"temporal_event",
];

// ---------------------------------------------------------------------------
// Evidence Ref
// ---------------------------------------------------------------------------

/**
 * A single evidence reference.
 *
 * Every V5 answer, proposal, memory injection report, and draft can
 * include an array of these references to establish provenance.
 *
 * The `id` is the unique identifier within the type's domain (e.g., a
 * memory record ID, a proposal ID, a file path). The `type` discriminates
 * which index domain to resolve from.
 */
export interface EvidenceRef {
	/** Type of evidence source. */
	type: EvidenceRefType;
	/** Unique identifier within the type domain (memory ID, proposal ID, file path, etc.). */
	id: string;
	/** Human-readable short label (e.g., "Validation of workspace X"). */
	label: string;
	/** Longer description of what this evidence shows and why it matters. */
	description: string;
	/** ISO 8601 timestamp of when the evidence was created/recorded. */
	timestamp: string;
	/** Optional file path or resource URI for direct access. */
	sourcePath?: string;
	/** Confidence in this evidence item (0-1). */
	confidence: number;
	/** Arbitrary metadata for extensibility. */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Evidence Source (input for registration)
// ---------------------------------------------------------------------------

/**
 * Input for registering evidence sources in the index.
 *
 * Contains the same fields as EvidenceRef but with `id` optional —
 * if omitted, a UUID is auto-generated. The `content` field provides
 * a snapshot of the evidence content at registration time.
 */
export interface EvidenceSource {
	/** Type of evidence source. */
	type: EvidenceRefType;
	/** Optional ID (auto-generated as UUID if omitted). */
	id?: string;
	/** Human-readable short label. */
	label: string;
	/** Longer description of what this evidence shows. */
	description: string;
	/** ISO 8601 timestamp. Defaults to now if omitted. */
	timestamp?: string;
	/** Optional file path or resource URI. */
	sourcePath?: string;
	/** Confidence (0-1). Defaults to 0.5 if omitted. */
	confidence?: number;
	/** Snapshot of the evidence content at registration time. */
	content?: string;
	/** Arbitrary metadata. */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Evidence Resolution
// ---------------------------------------------------------------------------

/**
 * The result of resolving an evidence reference to its content.
 *
 * If the evidence is found in the index, `resolved` is true and `content`
 * contains the evidence snapshot. If not found, `resolved` is false and
 * `error` explains why.
 */
export interface EvidenceResolution {
	/** The original evidence reference. */
	ref: EvidenceRef;
	/** Whether the evidence was found and resolved successfully. */
	resolved: boolean;
	/** Resolved content snapshot (if available). */
	content?: string;
	/** Error message if resolution failed. */
	error?: string;
	/** ISO 8601 timestamp of when resolution was attempted. */
	resolvedAt: string;
}

// ---------------------------------------------------------------------------
// Evidence Assessment
// ---------------------------------------------------------------------------

/**
 * A confidence assessment for a set of evidence references.
 *
 * Used by V5 components to determine whether they can make confident
 * claims based on available evidence. If any evidence is missing or
 * has low confidence, the overall assessment is downgraded.
 *
 * Rules:
 * - All evidence resolved with confidence >= 0.7 → HIGH confidence
 * - Some evidence missing or confidence < 0.7 but >= 0.4 → MEDIUM
 * - Major evidence missing or confidence < 0.4 → LOW
 * - Critical evidence missing → BLOCKED (cannot make confident claim)
 */
export type EvidenceConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "BLOCKED";

/**
 * Full assessment of a set of evidence references.
 */
export interface EvidenceAssessment {
	/** Overall confidence level derived from the evidence set. */
	level: EvidenceConfidenceLevel;
	/** Numerical confidence score (0-1). */
	confidence: number;
	/** Number of evidence references that were resolved. */
	resolvedCount: number;
	/** Number of evidence references that could not be resolved. */
	missingCount: number;
	/** Number of evidence references with low confidence (< 0.4). */
	lowConfidenceCount: number;
	/** Detailed resolution for each evidence reference. */
	resolutions: EvidenceResolution[];
	/** Human-readable summary of the assessment. */
	summary: string;
	/** Recommendations based on the assessment. */
	recommendations: string[];
}

// ---------------------------------------------------------------------------
// Evidence Query
// ---------------------------------------------------------------------------

/**
 * Query parameters for filtering evidence references in the index.
 */
export interface EvidenceQuery {
	/** Filter by one or more evidence types. */
	types?: EvidenceRefType[];
	/** Filter by ID or label (substring match, case-insensitive). */
	search?: string;
	/** Filter by minimum confidence. */
	minConfidence?: number;
	/** Only evidence created after this ISO 8601 timestamp. */
	createdAfter?: string;
	/** Only evidence created before this ISO 8601 timestamp. */
	createdBefore?: string;
	/** Maximum results (default: 50). */
	limit?: number;
	/** Offset for pagination (default: 0). */
	offset?: number;
	/** Sort field. */
	sortBy?: "timestamp" | "confidence" | "label";
	/** Sort order. */
	sortOrder?: "asc" | "desc";
}

/**
 * Result of querying the evidence index.
 */
export interface EvidenceQueryResult {
	/** Matching evidence references. */
	items: EvidenceRef[];
	/** Total number of matching items (ignoring pagination). */
	total: number;
	/** Applied query parameters (for client-side reflection). */
	query: EvidenceQuery;
}

// ---------------------------------------------------------------------------
// Evidence Stats
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics about the evidence index.
 */
export interface EvidenceStats {
	/** Total number of evidence references in the index. */
	totalRefs: number;
	/** Count by type. */
	byType: Record<EvidenceRefType, number>;
	/** Average confidence across all references. */
	averageConfidence: number;
	/** Number of high-confidence references (>= 0.7). */
	highConfidenceCount: number;
	/** Number of low-confidence references (< 0.4). */
	lowConfidenceCount: number;
	/** Timestamp range. */
	earliestTimestamp: string | null;
	latestTimestamp: string | null;
}

// ---------------------------------------------------------------------------
// Evidence Index Interface (V4 ExecutionKernel doctrine compliant)
// ---------------------------------------------------------------------------

/**
 * The Evidence Index — a read-only window into available evidence.
 *
 * Following V4 ExecutionKernel doctrine, the evidence index never mutates
 * execution state directly. It reads from existing stores and artifacts.
 *
 * Registration of evidence sources is allowed (adding to the index),
 * but the index does not modify execution state — it stores lightweight
 * reference + content-snapshot entries.
 */
export interface IEvidenceIndex {
	/** Query evidence references with filters. */
	query(query: EvidenceQuery): Promise<EvidenceQueryResult>;

	/** Resolve one or more evidence refs to their stored content. */
	resolve(refs: EvidenceRef[]): Promise<EvidenceResolution[]>;

	/** Assess confidence for a set of evidence refs. */
	assess(refs: EvidenceRef[]): Promise<EvidenceAssessment>;

	/** Register new evidence sources in the index. */
	register(source: EvidenceSource): Promise<EvidenceRef>;

	/** Register multiple evidence sources atomically. */
	registerBatch(sources: EvidenceSource[]): Promise<EvidenceRef[]>;

	/** Get a single evidence ref by type and id. */
	getByRef(type: EvidenceRefType, id: string): Promise<EvidenceRef | null>;

	/** Get aggregate statistics. */
	stats(): Promise<EvidenceStats>;

	/** Clear all references from the index (for testing/reset). */
	clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory Helpers
// ---------------------------------------------------------------------------

/**
 * Create an EvidenceRef with defaults applied.
 */
export function createEvidenceRef(
	overrides: Partial<EvidenceRef> & {
		type: EvidenceRefType;
		id: string;
		label: string;
		description: string;
		confidence: number;
	},
): EvidenceRef {
	return {
		timestamp: new Date().toISOString(),
		...overrides,
	};
}

/**
 * Create an EvidenceSource from an EvidenceRef and optional content.
 */
export function evidenceRefToSource(ref: EvidenceRef, content?: string): EvidenceSource {
	return {
		type: ref.type,
		id: ref.id,
		label: ref.label,
		description: ref.description,
		timestamp: ref.timestamp,
		sourcePath: ref.sourcePath,
		confidence: ref.confidence,
		content,
		metadata: ref.metadata,
	};
}

/**
 * Create an EvidenceSource with defaults applied.
 */
export function createEvidenceSource(
	overrides: Partial<EvidenceSource> & {
		type: EvidenceRefType;
		label: string;
		description: string;
	},
): EvidenceSource {
	return {
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		confidence: 0.5,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Confidence Assessment Logic
// ---------------------------------------------------------------------------

/**
 * The minimum confidence threshold for considering evidence "high quality".
 * Evidence below this threshold is flagged for review.
 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/**
 * The minimum confidence threshold for considering evidence "acceptable".
 * Evidence below this threshold is considered low confidence.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.4;

/**
 * Critical evidence types that must always resolve for a confident claim.
 */
export const CRITICAL_EVIDENCE_TYPES: EvidenceRefType[] = ["validation", "execution_journal", "approval"];

/**
 * Assess confidence for a set of evidence resolutions.
 *
 * @param resolutions - The evidence resolutions to assess
 * @returns An EvidenceAssessment with overall confidence level
 */
export function assessEvidenceConfidence(resolutions: EvidenceResolution[]): EvidenceAssessment {
	const resolved = resolutions.filter((r) => r.resolved);
	const missing = resolutions.filter((r) => !r.resolved);
	const lowConfidence = resolved.filter((r) => r.ref.confidence < LOW_CONFIDENCE_THRESHOLD);

	const resolvedCount = resolved.length;
	const missingCount = missing.length;
	const lowConfidenceCount = lowConfidence.length;

	// Check for missing critical evidence
	const missingCritical = missing.filter((r) => CRITICAL_EVIDENCE_TYPES.includes(r.ref.type));
	if (missingCritical.length > 0) {
		const recommendations = [
			`Critical evidence missing: ${missingCritical.map((r) => r.ref.label).join(", ")}`,
			"Resolve missing critical evidence before making confident claims.",
			"Consider re-running the relevant workspace or validation.",
		];

		return {
			level: "BLOCKED",
			confidence: 0,
			resolvedCount,
			missingCount,
			lowConfidenceCount,
			resolutions,
			summary: "Cannot make confident claims — critical evidence is missing.",
			recommendations,
		};
	}

	// Calculate aggregate confidence from resolved items
	const averageConfidence =
		resolvedCount > 0 ? resolved.reduce((sum, r) => sum + r.ref.confidence, 0) / resolvedCount : 0;

	// Determine overall level
	let level: EvidenceConfidenceLevel;
	let summary: string;
	const recommendations: string[] = [];

	if (resolvedCount === 0) {
		level = "LOW";
		summary = "No evidence could be resolved. Confidence is low.";
		recommendations.push("Ensure evidence sources are registered before making claims.");
	} else if (averageConfidence >= HIGH_CONFIDENCE_THRESHOLD) {
		level = "HIGH";
		summary = `All ${resolvedCount} evidence reference(s) resolved with high confidence.`;
	} else if (averageConfidence >= LOW_CONFIDENCE_THRESHOLD) {
		level = "MEDIUM";
		summary = `Evidence resolved with medium confidence (${(averageConfidence * 100).toFixed(0)}%).`;
		if (missingCount > 0) {
			recommendations.push(`${missingCount} evidence reference(s) could not be resolved.`);
		}
		if (lowConfidenceCount > 0) {
			recommendations.push(`${lowConfidenceCount} evidence reference(s) have low confidence.`);
		}
	} else {
		level = "LOW";
		summary = `Evidence resolved with low confidence (${(averageConfidence * 100).toFixed(0)}%).`;
		recommendations.push("Improve evidence quality or gather additional sources.");
		if (missingCount > 0) {
			recommendations.push(`${missingCount} evidence reference(s) could not be resolved.`);
		}
	}

	return {
		level,
		confidence: averageConfidence,
		resolvedCount,
		missingCount,
		lowConfidenceCount,
		resolutions,
		summary,
		recommendations,
	};
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an EvidenceRef.
 *
 * @param ref - The evidence reference to validate
 * @returns Array of error messages (empty if valid)
 */
export function validateEvidenceRef(ref: EvidenceRef): string[] {
	const errors: string[] = [];

	if (!ref.type || !ALL_EVIDENCE_REF_TYPES.includes(ref.type)) {
		errors.push(`type must be one of: ${ALL_EVIDENCE_REF_TYPES.join(", ")}`);
	}
	if (!ref.id || typeof ref.id !== "string" || ref.id.length === 0) {
		errors.push("id must be a non-empty string");
	}
	if (!ref.label || typeof ref.label !== "string" || ref.label.length === 0) {
		errors.push("label must be a non-empty string");
	}
	if (!ref.description || typeof ref.description !== "string" || ref.description.length === 0) {
		errors.push("description must be a non-empty string");
	}
	if (typeof ref.confidence !== "number" || ref.confidence < 0 || ref.confidence > 1) {
		errors.push("confidence must be a number between 0 and 1");
	}

	return errors;
}

/**
 * Validate an EvidenceSource.
 *
 * @param source - The evidence source to validate
 * @returns Array of error messages (empty if valid)
 */
export function validateEvidenceSource(source: EvidenceSource): string[] {
	const errors: string[] = [];

	if (!source.type || !ALL_EVIDENCE_REF_TYPES.includes(source.type)) {
		errors.push(`type must be one of: ${ALL_EVIDENCE_REF_TYPES.join(", ")}`);
	}
	if (!source.label || typeof source.label !== "string" || source.label.length === 0) {
		errors.push("label must be a non-empty string");
	}
	if (!source.description || typeof source.description !== "string" || source.description.length === 0) {
		errors.push("description must be a non-empty string");
	}
	if (
		source.confidence !== undefined &&
		(typeof source.confidence !== "number" || source.confidence < 0 || source.confidence > 1)
	) {
		errors.push("confidence must be a number between 0 and 1 when provided");
	}

	return errors;
}
