/**
 * V5 Output Types — V5.02 Evidence Index Integration
 *
 * Defines the output types for Brain V5 components that can carry
 * evidence references (EvidenceRef[]).
 *
 * Every V5 output — answers, proposals, memory injection reports,
 * and drafts — can reference evidence refs to establish provenance
 * and enable confidence assessment by downstream consumers.
 *
 * Following V4 ExecutionKernel doctrine: these types describe outputs
 * that are emitted as events; they never mutate execution state directly.
 *
 * @packageDocumentation
 */

import type { EvidenceAssessment, EvidenceConfidenceLevel, EvidenceRef } from "./types.js";

// =========================================================================
// V5 Answer
// =========================================================================

/**
 * A Brain V5 answer to a user question or query.
 *
 * Answers carry evidence references to support their claims and
 * include a confidence assessment derived from the referenced
 * evidence. If critical evidence is missing, the answer's
 * confidence level is downgraded (or the answer is blocked).
 */
export interface V5Answer {
	/** Unique answer ID (UUID). */
	id: string;
	/** The answer text/content. */
	content: string;
	/** Summary of what this answer covers. */
	summary: string;
	/** Evidence references backing this answer. */
	evidenceRefs: EvidenceRef[];
	/** Confidence level derived from evidence assessment. */
	confidenceLevel: EvidenceConfidenceLevel;
	/** Numerical confidence score (0-1). */
	confidence: number;
	/** ISO 8601 timestamp of when this answer was generated. */
	createdAt: string;
	/** Human-readable explanation of how confidence was determined. */
	confidenceExplanation: string;
	/** Source type that triggered this answer (e.g., "user_question", "system_query"). */
	sourceType: string;
	/** Arbitrary metadata for extensibility. */
	metadata?: Record<string, unknown>;
}

// =========================================================================
// V5 Memory Injection Report
// =========================================================================

/**
 * A report about memory injections performed by Brain V5.
 *
 * Each injection is supported by evidence references that describe
 * why the memory was created, what source artifacts support it,
 * and what confidence level the injected content carries.
 */
export interface V5MemoryInjectionReport {
	/** Unique report ID (UUID). */
	id: string;
	/** ISO 8601 timestamp of when the report was generated. */
	createdAt: string;
	/** The scope or context for this injection (e.g., workspace ID, plan ID). */
	scope: string;
	/** Individual memory injection entries. */
	injections: V5MemoryInjection[];
	/** Aggregate evidence references across all injections. */
	evidenceRefs: EvidenceRef[];
	/** Overall confidence across all injections. */
	overallConfidence: EvidenceConfidenceLevel;
	/** Numerical overall confidence score (0-1). */
	overallConfidenceScore: number;
	/** Summary of what was injected and why. */
	summary: string;
	/** Whether any injections were blocked due to insufficient evidence. */
	blockedInjections: number;
	/** Number of successful injections. */
	successfulInjections: number;
}

/**
 * A single memory injection action within a report.
 */
export interface V5MemoryInjection {
	/** Unique injection ID (UUID). */
	id: string;
	/** The type of memory being injected. */
	memoryType: string;
	/** Title of the injected memory record. */
	title: string;
	/** Content of the injected memory record. */
	content: string;
	/** Evidence references supporting this injection. */
	evidenceRefs: EvidenceRef[];
	/** Confidence level for this specific injection. */
	confidenceLevel: EvidenceConfidenceLevel;
	/** Numerical confidence score (0-1). */
	confidence: number;
	/** Whether the injection was successfully applied. */
	successful: boolean;
	/** Error message if the injection failed. */
	error?: string;
}

// =========================================================================
// V5 Draft
// =========================================================================

/**
 * A draft proposal or change produced by Brain V5.
 *
 * Drafts are preliminary outputs that may be promoted to full
 * proposals after review. They carry evidence references to
 * support the draft's claims and recommendations, and include
 * a confidence assessment to inform downstream decision-making.
 */
export interface V5Draft {
	/** Unique draft ID (UUID). */
	id: string;
	/** Short title for the draft. */
	title: string;
	/** Detailed draft content/description. */
	content: string;
	/** Type of draft (e.g., "code_change", "plan_adjustment", "memory_injection"). */
	draftType: string;
	/** Evidence references backing this draft. */
	evidenceRefs: EvidenceRef[];
	/** Confidence level derived from evidence assessment. */
	confidenceLevel: EvidenceConfidenceLevel;
	/** Numerical confidence score (0-1). */
	confidence: number;
	/** Human-readable explanation of confidence. */
	confidenceExplanation: string;
	/** Whether this draft requires additional evidence before it can proceed. */
	evidenceSufficient: boolean;
	/** Recommendations if evidence is insufficient. */
	recommendations: string[];
	/** ISO 8601 timestamp of when this draft was created. */
	createdAt: string;
	/** ISO 8601 timestamp of when this draft expires. */
	expiresAt?: string;
	/** Arbitrary metadata for extensibility. */
	metadata?: Record<string, unknown>;
}

// =========================================================================
// Output Builder Helpers
// =========================================================================

/**
 * Options for building a V5 output with evidence assessment.
 */
export interface V5OutputBuildOptions {
	/**
	 * Whether to block the output if critical evidence is missing.
	 * If true, buildAnswer / buildDraft will return null when
	 * the evidence assessment level is BLOCKED.
	 * If false, the output will be created with a LOW/BLOCKED level.
	 */
	blockOnMissingCriticalEvidence?: boolean;
}

/**
 * Build a V5Answer by assessing evidence refs and populating confidence fields.
 *
 * @param partial - Partial answer fields (without confidence assessment)
 * @param assessment - Pre-computed evidence assessment from the EvidenceApi
 * @param options - Optional build configuration
 * @returns A fully populated V5Answer
 */
/**
 * Build a V5Answer by assessing evidence refs and populating confidence fields.
 *
 * @param partial - Partial answer fields (without confidence assessment)
 * @param assessment - Pre-computed evidence assessment from the EvidenceApi
 * @param _options - Optional build configuration
 * @returns A fully populated V5Answer, or null if the answer is blocked
 */
export function buildV5Answer(
	partial: {
		id: string;
		content: string;
		summary: string;
		evidenceRefs: EvidenceRef[];
		sourceType: string;
		metadata?: Record<string, unknown>;
	},
	assessment: EvidenceAssessment,
	_options?: V5OutputBuildOptions,
): V5Answer | null {
	// If blocking is enabled and evidence is BLOCKED, return null
	if (_options?.blockOnMissingCriticalEvidence && assessment.level === "BLOCKED") {
		return null;
	}

	return {
		id: partial.id,
		content: partial.content,
		summary: partial.summary,
		evidenceRefs: partial.evidenceRefs,
		confidenceLevel: assessment.level,
		confidence: assessment.confidence,
		createdAt: new Date().toISOString(),
		confidenceExplanation: buildConfidenceExplanation(assessment),
		sourceType: partial.sourceType,
		metadata: partial.metadata,
	};
}

/**
 * Build a V5MemoryInjectionReport from injection data and evidence assessment.
 *
 * @param partial - Partial report fields
 * @param injections - Individual memory injection entries
 * @param overallAssessment - Overall evidence assessment
 * @returns A fully populated V5MemoryInjectionReport
 */
export function buildV5MemoryInjectionReport(
	partial: {
		id: string;
		scope: string;
		summary: string;
		evidenceRefs: EvidenceRef[];
	},
	injections: V5MemoryInjection[],
	overallAssessment: EvidenceAssessment,
): V5MemoryInjectionReport {
	const successfulInjections = injections.filter((i) => i.successful).length;
	const blockedInjections = injections.filter((i) => !i.successful).length;

	return {
		id: partial.id,
		createdAt: new Date().toISOString(),
		scope: partial.scope,
		injections,
		evidenceRefs: partial.evidenceRefs,
		overallConfidence: overallAssessment.level,
		overallConfidenceScore: overallAssessment.confidence,
		summary: partial.summary,
		blockedInjections,
		successfulInjections,
	};
}

/**
 * Build a V5Draft from draft data and evidence assessment.
 *
 * @param partial - Partial draft fields
 * @param assessment - Pre-computed evidence assessment
 * @param options - Optional build configuration
 * @returns A fully populated V5Draft, or null if blocked by missing critical evidence
 */
export function buildV5Draft(
	partial: {
		id: string;
		title: string;
		content: string;
		draftType: string;
		evidenceRefs: EvidenceRef[];
		metadata?: Record<string, unknown>;
	},
	assessment: EvidenceAssessment,
	options?: V5OutputBuildOptions,
): V5Draft | null {
	// If blocking is enabled and evidence is BLOCKED, return null
	if (options?.blockOnMissingCriticalEvidence && assessment.level === "BLOCKED") {
		return null;
	}

	const isSufficient = assessment.level === "HIGH" || assessment.level === "MEDIUM";

	return {
		id: partial.id,
		title: partial.title,
		content: partial.content,
		draftType: partial.draftType,
		evidenceRefs: partial.evidenceRefs,
		confidenceLevel: assessment.level,
		confidence: assessment.confidence,
		confidenceExplanation: buildConfidenceExplanation(assessment),
		evidenceSufficient: isSufficient,
		recommendations: assessment.recommendations,
		createdAt: new Date().toISOString(),
		metadata: partial.metadata,
	};
}

// =========================================================================
// Confidence Helpers
// =========================================================================

/**
 * Build a human-readable confidence explanation from an assessment.
 *
 * @param assessment - The evidence assessment
 * @returns A human-readable string
 */
export function buildConfidenceExplanation(assessment: EvidenceAssessment): string {
	switch (assessment.level) {
		case "HIGH":
			return `High confidence: all ${assessment.resolvedCount} evidence reference(s) resolved successfully with average confidence of ${(assessment.confidence * 100).toFixed(0)}%.`;
		case "MEDIUM":
			return `Medium confidence: ${assessment.resolvedCount} of ${assessment.resolvedCount + assessment.missingCount} evidence reference(s) resolved. ${assessment.missingCount > 0 ? `${assessment.missingCount} reference(s) missing.` : ""} Average confidence: ${(assessment.confidence * 100).toFixed(0)}%.`;
		case "LOW":
			return `Low confidence: only ${assessment.resolvedCount} of ${assessment.resolvedCount + assessment.missingCount} evidence reference(s) resolved. Average confidence: ${(assessment.confidence * 100).toFixed(0)}%.`;
		case "BLOCKED":
			return `Blocked: critical evidence is missing (${assessment.missingCount} unresolved reference(s)). Cannot make confident claims.`;
	}
}

/**
 * Determine if a set of evidence is sufficient for a given confidence level requirement.
 *
 * @param assessment - The evidence assessment
 * @param requiredLevel - The minimum required confidence level
 * @returns True if the evidence meets or exceeds the required level
 */
export function evidenceMeetsThreshold(
	assessment: EvidenceAssessment,
	requiredLevel: EvidenceConfidenceLevel,
): boolean {
	const levels: EvidenceConfidenceLevel[] = ["HIGH", "MEDIUM", "LOW", "BLOCKED"];
	const actualIndex = levels.indexOf(assessment.level);
	const requiredIndex = levels.indexOf(requiredLevel);
	// Lower index = better (HIGH = 0, MEDIUM = 1, LOW = 2, BLOCKED = 3)
	return requiredIndex >= 0 && actualIndex >= 0 && actualIndex <= requiredIndex;
}
