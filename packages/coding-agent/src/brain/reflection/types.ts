/**
 * Reflection Types — P17.C/D/E/F shared types
 *
 * Defines the core data structures for reflection reports,
 * memory proposals, and future phase suggestions after a
 * plan execution completes.
 */

import type { MemoryType } from "../memory/types.js";
import type { ProposalType } from "../proposals/types.js";

// ---------------------------------------------------------------------------
// Execution Journal & Workspace Outcome
// ---------------------------------------------------------------------------

export interface ExecutionJournalEntry {
	timestamp: string;
	eventType: string;
	workspaceId: string;
	severity?: string;
	data: Record<string, unknown>;
}

export interface WorkspaceOutcome {
	workspaceId: string;
	status: "success" | "failure" | "retry" | "skipped" | "conflict";
	retryCount: number;
	duration: number;
	errorTypes?: string[];
	validationPassed?: boolean;
	summary?: string;
}

// ---------------------------------------------------------------------------
// Reflection Input
// ---------------------------------------------------------------------------

export interface ReflectionInput {
	planExecId: string;
	planId: string;
	planTitle?: string;
	executionJournal: ExecutionJournalEntry[];
	workspaceOutcomes: WorkspaceOutcome[];
	validationResults: ValidationResult[];
	integrationState: {
		wasDirty: boolean;
		conflicts: number;
		resolvedConflicts: number;
	};
	duration: number;
	startTime: string;
	endTime: string;
	autonomyLevel: number;
	policyStops: number;
	approvalRequests: number;
}

export interface ValidationResult {
	type: "error" | "warning" | "info";
	component: string;
	message: string;
	passed?: boolean;
	details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Reflection Report
// ---------------------------------------------------------------------------

export interface ReflectionReport {
	id: string;
	planExecId: string;
	planTitle?: string;

	// Summary
	summary: string;
	whatPeopleNeedToKnow: string;

	// What happened
	whatRan: string[];
	whatWorked: string[];
	whatFailed: string[];
	whatSlowedDown: string[];

	// Metrics
	workspaceCount: number;
	successCount: number;
	failureCount: number;
	retryCount: number;
	successRate: number;
	avgRetryCount: number;
	totalDuration: number;
	validationFailures: number;

	// Memory & proposals
	memoriesToCreate: MemoryProposalSuggestion[];
	proposalsToGenerate: ProposalSuggestion[];
	futurePhaseSuggestions: FuturePhaseSuggestion[];

	// Trust
	policyStops: number;
	approvalRequests: number;
	safetyInterventions: number;

	// V5.10: Evidence-backed claims with confidence
	claims: EvidenceClaim[];

	// Metadata
	createdAt: string;
	confidence: number;
	sources: SourceRef[];
}

export interface SourceRef {
	type: "workspace" | "journal" | "validation" | "memory";
	id: string;
	description: string;
}

// ---------------------------------------------------------------------------
// Memory & Proposal Suggestions
// ---------------------------------------------------------------------------

export interface MemoryProposalSuggestion {
	type: MemoryType;
	title: string;
	content: string;
	confidence: number;
	sourceRefs: SourceRef[];
	category: "failure" | "success" | "architecture" | "process";
}

export interface ProposalSuggestion {
	type: ProposalType;
	title: string;
	description: string;
	rationale: string;
	priority: "critical" | "high" | "normal" | "low";
	evidenceIds: string[];
}

export interface FuturePhaseSuggestion {
	title: string;
	rationale: string;
	priority: "critical" | "high" | "normal" | "low";
	estimatedWorkstreams: number;
	relatedMemoryIds: string[];
	relatedObservationIds: string[];
}

// ---------------------------------------------------------------------------
// Reflection Engine Config
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Evidence-Backed Claim (V5.10)
// ---------------------------------------------------------------------------

/**
 * A single evidence-backed claim in a reflection report.
 *
 * Each claim is a factual statement that is supported by one or more
 * evidence references and includes a confidence score. Claims can be
 * later corrected or rejected, with the audit trail preserved.
 *
 * V5.10 AC2: Reflection claims are evidence-backed and include confidence.
 */
export interface EvidenceClaim {
	/** Unique ID for this claim (UUID). */
	id: string;
	/** Category of the claim: what happened, analysis, or recommendation. */
	category: "observation" | "analysis" | "recommendation";
	/** The claim text (a factual statement). */
	statement: string;
	/** Evidence references backing this claim. */
	evidenceIds: string[];
	/** Confidence score (0-1) derived from evidence assessment. */
	confidence: number;
	/** Whether this claim has been audited (corrected or rejected). */
	audited: boolean;
}

// ---------------------------------------------------------------------------
// Reflection Correction & Audit (V5.10 AC3)
// ---------------------------------------------------------------------------

/**
 * A correction applied to a reflection report.
 *
 * Corrections modify specific claims or the report summary, replacing
 * erroneous content with corrected content. The original values are
 * preserved for audit.
 *
 * V5.10 AC3: Rejected/corrected reflections are auditable.
 */
export interface ReflectionCorrection {
	/** Unique ID for this correction (UUID). */
	id: string;
	/** ISO 8601 timestamp of when the correction was applied. */
	timestamp: string;
	/** Who made the correction: "user" or "system". */
	correctedBy: string;
	/** Type of correction. */
	type: "claim" | "summary" | "memory" | "proposal" | "confidence";
	/** The specific claim ID being corrected (if type === "claim"). */
	claimId?: string;
	/** The original (incorrect) value before correction. */
	originalValue: string;
	/** The corrected value. */
	correctedValue: string;
	/** Reason for the correction. */
	reason: string;
	/** Optional source refs supporting the correction. */
	sourceRefs: SourceRef[];
}

/**
 * A rejection of a specific claim or the entire reflection.
 */
export interface ReflectionRejection {
	/** Unique ID for this rejection (UUID). */
	id: string;
	/** ISO 8601 timestamp of when the rejection was made. */
	timestamp: string;
	/** Who rejected: "user" or "system". */
	rejectedBy: string;
	/** Optional specific claim ID being rejected. If omitted, the entire reflection is rejected. */
	claimId?: string;
	/** Reason for rejection. */
	reason: string;
	/** The claim statement that was rejected (copy for audit). */
	rejectedStatement: string;
}

/**
 * A single entry in the reflection audit trail.
 *
 * Every correction or rejection creates an audit entry. The audit trail
 * is append-only and immutable — entries are never deleted or modified.
 */
export interface ReflectionAuditEntry {
	/** Unique ID for this audit entry (UUID). */
	id: string;
	/** ISO 8601 timestamp of when this audit event occurred. */
	timestamp: string;
	/** The reflection report ID this audit entry belongs to. */
	reportId: string;
	/** Type of audit event. */
	eventType: "correction" | "rejection" | "reversal" | "regeneration";
	/** The correction details (if eventType === "correction"). */
	correction?: ReflectionCorrection;
	/** The rejection details (if eventType === "rejection"). */
	rejection?: ReflectionRejection;
	/** Optional previous version reference. */
	previousReportId?: string;
	/** Arbitrary metadata. */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Reflection Engine Config (V5.10)
// ---------------------------------------------------------------------------

export interface ReflectionConfig {
	outputBaseDir: string;
	minWorkspaceCount: number;
	enableMemoryGeneration: boolean;
	enableFutureSuggestions: boolean;
	maxFutureSuggestions: number;
	sourceBackedRequired: boolean;
	/** V5.10: Enable evidence-backed claims with confidence from evidence index. */
	enableEvidenceIntegration: boolean;
	/** V5.10: Register reflection claims as evidence in the evidence index. */
	registerClaimsInEvidenceIndex: boolean;
}
