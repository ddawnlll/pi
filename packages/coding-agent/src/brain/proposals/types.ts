/**
 * Proposal Domain Model — P16.A
 *
 * Defines the core data structures for proposals with evidence,
 * risk assessment, scoring, and lifecycle tracking.
 *
 * Every proposal requires evidence references and a risk assessment.
 * The status lifecycle tracks proposals from draft through to execution
 * or rejection.
 *
 * File scope: This is the single source of truth for all proposal types
 * used by the Proposal Generator (P16.B), Scoring Engine (P16.C),
 * Deduplication (P16.D), and Inbox Logic (P16.E).
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Proposal Type
// ---------------------------------------------------------------------------

/**
 * The type of proposal being generated.
 *
 * Each type has distinct scoring characteristics, cooldown periods,
 * and approval workflows.
 */
export type ProposalType =
	| "memory_proposal"
	| "plan_proposal"
	| "goal_revision_proposal"
	| "autonomy_adjustment_proposal"
	| "reflection_proposal"
	| "safety_proposal";

// ---------------------------------------------------------------------------
// Proposal Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a proposal.
 *
 * States and transitions:
 * - draft:              Being generated, not yet visible to user
 * - pending_approval:   Awaiting user decision (enters inbox)
 * - approved:           User accepted the proposal
 * - rejected:           User explicitly rejected
 * - superseded:         Replaced by a newer, more relevant proposal
 * - expired:            Time-based expiry reached (default 30 days)
 * - executed:           Plan/action created from this proposal
 */
export type ProposalStatus =
	| "draft"
	| "pending_approval"
	| "approved"
	| "rejected"
	| "superseded"
	| "expired"
	| "executed";

// ---------------------------------------------------------------------------
// Risk Level
// ---------------------------------------------------------------------------

/**
 * Risk level for a proposal's impact assessment.
 */
export type RiskLevel = "low" | "medium" | "high" | "critical";

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

/**
 * Evidence backing a proposal.
 *
 * References memory records and observations that support the proposal.
 * The confidence field represents how strong the combined evidence is.
 */
export interface ProposalEvidence {
	/** IDs of referenced memory records */
	memoryIds: string[];
	/** IDs of referenced observations */
	observationIds: string[];
	/** Source references for provenance tracking */
	sourceRefs: MemorySourceRef[];
	/** Overall confidence in the evidence (0-1) */
	confidence: number;
	/** Human-readable summary of the evidence */
	evidenceSummary: string;
}

/**
 * Risk assessment for a proposal.
 *
 * Evaluates the potential impact, affected systems, and mitigation
 * strategies before the proposal is executed.
 */
export interface ProposalRiskAssessment {
	/** Overall risk level */
	level: RiskLevel;
	/** Contributing risk factors */
	factors: string[];
	/** Mitigation strategies for each factor */
	mitigation: string[];
	/** Systems affected by this proposal */
	affectedSystems: string[];
	/** Description of the potential impact */
	impactDescription: string;
}

/**
 * Scoring dimensions for a proposal.
 *
 * The total score is a weighted combination of novelty, confidence,
 * urgency, and feasibility. Each dimension is 0-1.
 *
 * Auto-queue threshold: total >= 0.7 AND confidence >= 0.6
 */
export interface ProposalScore {
	/** Weighted total score (0-1) */
	total: number;
	/** How different from existing proposals (0-1) */
	novelty: number;
	/** Evidence quality and source trust (0-1) */
	confidence: number;
	/** Time-sensitivity based on observations (0-1) */
	urgency: number;
	/** Can we execute this (resource/capability check, 0-1) */
	feasibility: number;
}

/**
 * A single proposal record.
 *
 * Every proposal carries evidence references, risk assessment, scoring,
 * and full lifecycle tracking with provenance.
 */
export interface Proposal {
	/** Unique proposal identifier (ULID-style, currently UUID v4) */
	id: string;
	/** Type of proposal */
	type: ProposalType;
	/** Short human-readable title */
	title: string;
	/** Detailed description of what is proposed */
	description: string;
	/** Evidence backing this proposal */
	evidence: ProposalEvidence;
	/** Risk assessment */
	risk: ProposalRiskAssessment;
	/** Scoring dimensions */
	score: ProposalScore;
	/** Current lifecycle status */
	status: ProposalStatus;
	/** ISO 8601 timestamp of creation */
	createdAt: string;
	/** ISO 8601 timestamp of last modification */
	updatedAt: string;
	/** Optional ISO 8601 timestamp of automatic expiry (default +30 days) */
	expiresAt?: string;
	/** Who submitted this proposal ('pi' or 'user') */
	submittedBy: string;
	/** Who approved this proposal (if approved) */
	approvedBy?: string;
	/** Who rejected this proposal (if rejected) */
	rejectedBy?: string;
	/** Reason for rejection */
	rejectionReason?: string;
	/** ID of the plan created from this proposal (P17+) */
	executedAsPlanId?: string;
	/** IDs of related proposals */
	relatedProposalIds: string[];
	/** IDs of related goals */
	relatedGoalIds: string[];
	/** Free-form tags for categorization */
	tags: string[];
	/** Arbitrary metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

/**
 * Input for creating a new proposal.
 *
 * Score is optional at creation time — the scoring engine computes
 * it before the proposal is persisted. All other fields are required
 * to ensure complete proposals.
 */
export interface ProposalCreateInput {
	/** Type of proposal */
	type: ProposalType;
	/** Short human-readable title */
	title: string;
	/** Detailed description */
	description: string;
	/** Evidence backing this proposal */
	evidence: ProposalEvidence;
	/** Risk assessment */
	risk: ProposalRiskAssessment;
	/** Pre-computed score (optional, engine fills if missing) */
	score?: ProposalScore;
	/** IDs of related goals */
	relatedGoalIds?: string[];
	/** Free-form tags */
	tags?: string[];
	/** Arbitrary metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Input for updating an existing proposal.
 *
 * Only provided fields are changed. Status transitions are validated
 * by the proposal store.
 */
export interface ProposalUpdateInput {
	/** New status */
	status?: ProposalStatus;
	/** Who approved this proposal */
	approvedBy?: string;
	/** Who rejected this proposal */
	rejectedBy?: string;
	/** Reason for rejection */
	rejectionReason?: string;
	/** ID of the executed plan */
	executedAsPlanId?: string;
	/** Updated tags */
	tags?: string[];
}

// ---------------------------------------------------------------------------
// Query Types
// ---------------------------------------------------------------------------

/**
 * Query parameters for listing and filtering proposals.
 *
 * All fields are optional. Only provided fields are used for filtering.
 * Results are sorted by the specified field and order.
 */
export interface ProposalQuery {
	/** Filter by one or more statuses */
	status?: ProposalStatus[];
	/** Filter by one or more types */
	type?: ProposalType[];
	/** Minimum total score (0-1) */
	minScore?: number;
	/** Maximum total score (0-1) */
	maxScore?: number;
	/** Filter by tag */
	tag?: string;
	/** Filter by related goal ID */
	relatedGoalId?: string;
	/** Only proposals created after this ISO 8601 timestamp */
	createdAfter?: string;
	/** Only proposals created before this ISO 8601 timestamp */
	createdBefore?: string;
	/** Maximum number of results (default: 20) */
	limit?: number;
	/** Number of results to skip (for pagination) */
	offset?: number;
	/** Field to sort by */
	sortBy?: "score" | "createdAt" | "updatedAt";
	/** Sort direction */
	sortOrder?: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics about proposals.
 */
export interface ProposalStats {
	/** Total number of proposals */
	totalProposals: number;
	/** Count by status */
	byStatus: Record<ProposalStatus, number>;
	/** Count by type */
	byType: Record<ProposalType, number>;
	/** Average total score across all scored proposals */
	averageScore: number;
	/** Ratio of approved to total reviewed proposals */
	acceptanceRate: number;
	/** Number of proposals pending approval */
	pendingApprovalCount: number;
	/** Number of expired proposals */
	expiredCount: number;
}

// ---------------------------------------------------------------------------
// Inbox Types
// ---------------------------------------------------------------------------

/**
 * A single entry in the proposal inbox.
 */
export interface InboxEntry {
	/** The proposal */
	proposal: Proposal;
	/** Rank position (1-3 for top-3) */
	rank: number;
	/** Why this proposal is in the inbox */
	reason: string;
	/** Recommendation: auto-approve, review, or reject */
	recommendation: "auto_approve" | "review" | "reject";
	/** Summaries of related memory records */
	relatedMemorySummaries: string[];
	/** Summaries of related observations */
	relatedObservationSummaries: string[];
}

/**
 * The full inbox view presented to the user.
 */
export interface InboxView {
	/** Inbox entries, sorted by rank */
	entries: InboxEntry[];
	/** Total number of pending proposals */
	totalPending: number;
	/** ISO 8601 timestamp of last update */
	lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Store Interface
// ---------------------------------------------------------------------------

/**
 * Interface for the proposal storage backend.
 *
 * Used by the ProposalGenerator, ProposalInbox, and other components
 * to persist and retrieve proposals. The concrete implementation
 * may use in-memory storage, JSON files, or a database.
 */
export interface ProposalStore {
	/** Create a new proposal */
	create(input: ProposalCreateInput): Promise<Proposal>;
	/** Get a proposal by ID */
	getById(id: string): Promise<Proposal | null>;
	/** Update an existing proposal */
	update(id: string, input: ProposalUpdateInput): Promise<Proposal>;
	/** Delete a proposal */
	delete(id: string): Promise<void>;
	/** List proposals matching a query */
	list(query?: ProposalQuery): Promise<Proposal[]>;
	/** Get aggregate statistics */
	stats(): Promise<ProposalStats>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All valid proposal types */
export const ALL_PROPOSAL_TYPES: ProposalType[] = [
	"memory_proposal",
	"plan_proposal",
	"goal_revision_proposal",
	"autonomy_adjustment_proposal",
	"reflection_proposal",
	"safety_proposal",
];

/** All valid proposal statuses */
export const ALL_PROPOSAL_STATUSES: ProposalStatus[] = [
	"draft",
	"pending_approval",
	"approved",
	"rejected",
	"superseded",
	"expired",
	"executed",
];

/** All valid risk levels */
export const ALL_RISK_LEVELS: RiskLevel[] = ["low", "medium", "high", "critical"];

/** Default expiry duration in days */
export const DEFAULT_PROPOSAL_EXPIRY_DAYS = 30;

/** Default auto-queue threshold for total score */
export const DEFAULT_AUTO_QUEUE_TOTAL_THRESHOLD = 0.7;

/** Default auto-queue threshold for confidence score */
export const DEFAULT_AUTO_QUEUE_CONFIDENCE_MIN = 0.6;

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create a new ProposalCreateInput with defaults.
 *
 * @param input - Partial input to override defaults
 * @returns A fully populated ProposalCreateInput
 */
export function createProposalCreateInput(
	input: Partial<ProposalCreateInput> & {
		type: ProposalType;
		title: string;
		description: string;
		evidence: ProposalEvidence;
		risk: ProposalRiskAssessment;
	},
): ProposalCreateInput {
	return {
		type: input.type,
		title: input.title,
		description: input.description,
		evidence: input.evidence,
		risk: input.risk,
		score: input.score,
		relatedGoalIds: input.relatedGoalIds ?? [],
		tags: input.tags ?? [],
		metadata: input.metadata ?? {},
	};
}

/**
 * Create a new Proposal with defaults.
 *
 * @param input - Creation input
 * @param overrides - Optional field overrides (e.g., for testing)
 * @returns A fully populated Proposal
 */
export function createProposal(input: ProposalCreateInput, overrides?: Partial<Proposal>): Proposal {
	const now = new Date().toISOString();
	const expiresAt = new Date(Date.now() + DEFAULT_PROPOSAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

	return {
		id: overrides?.id ?? randomUUID(),
		type: input.type,
		title: input.title,
		description: input.description,
		evidence: {
			memoryIds: [...input.evidence.memoryIds],
			observationIds: [...input.evidence.observationIds],
			sourceRefs: [...input.evidence.sourceRefs],
			confidence: input.evidence.confidence,
			evidenceSummary: input.evidence.evidenceSummary,
		},
		risk: {
			level: input.risk.level,
			factors: [...input.risk.factors],
			mitigation: [...input.risk.mitigation],
			affectedSystems: [...input.risk.affectedSystems],
			impactDescription: input.risk.impactDescription,
		},
		score: overrides?.score ??
			input.score ?? {
				total: 0,
				novelty: 0,
				confidence: 0,
				urgency: 0,
				feasibility: 0,
			},
		status: overrides?.status ?? "draft",
		createdAt: overrides?.createdAt ?? now,
		updatedAt: overrides?.updatedAt ?? now,
		expiresAt: overrides?.expiresAt ?? expiresAt,
		submittedBy: overrides?.submittedBy ?? "pi",
		approvedBy: overrides?.approvedBy,
		rejectedBy: overrides?.rejectedBy,
		rejectionReason: overrides?.rejectionReason,
		executedAsPlanId: overrides?.executedAsPlanId,
		relatedProposalIds: overrides?.relatedProposalIds ?? [],
		relatedGoalIds: input.relatedGoalIds ?? [],
		tags: input.tags ?? [],
		metadata: { ...input.metadata },
	};
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a proposal's evidence references.
 *
 * @param evidence - The evidence to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateProposalEvidence(evidence: ProposalEvidence): string[] {
	const errors: string[] = [];

	if (evidence.memoryIds.length === 0 && evidence.observationIds.length === 0 && evidence.sourceRefs.length === 0) {
		errors.push("proposal must have at least one evidence reference (memory, observation, or source ref)");
	}

	if (evidence.confidence < 0 || evidence.confidence > 1) {
		errors.push("evidence confidence must be between 0 and 1");
	}

	if (!evidence.evidenceSummary || evidence.evidenceSummary.trim().length === 0) {
		errors.push("evidence summary is required");
	}

	return errors;
}

/**
 * Validate a proposal's risk assessment.
 *
 * @param risk - The risk assessment to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateProposalRisk(risk: ProposalRiskAssessment): string[] {
	const errors: string[] = [];

	if (!ALL_RISK_LEVELS.includes(risk.level)) {
		errors.push(`invalid risk level: ${risk.level}. Must be one of: ${ALL_RISK_LEVELS.join(", ")}`);
	}

	if (risk.factors.length === 0) {
		errors.push("at least one risk factor is required");
	}

	if (risk.affectedSystems.length === 0) {
		errors.push("at least one affected system is required");
	}

	return errors;
}

/**
 * Validate a full ProposalCreateInput.
 *
 * @param input - The input to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateProposalCreateInput(input: ProposalCreateInput): string[] {
	const errors: string[] = [];

	if (!ALL_PROPOSAL_TYPES.includes(input.type)) {
		errors.push(`invalid proposal type: ${input.type}`);
	}

	if (!input.title || input.title.trim().length === 0) {
		errors.push("title is required");
	}

	if (!input.description || input.description.trim().length === 0) {
		errors.push("description is required");
	}

	errors.push(...validateProposalEvidence(input.evidence));
	errors.push(...validateProposalRisk(input.risk));

	return errors;
}

// ---------------------------------------------------------------------------
// Statistics Computation
// ---------------------------------------------------------------------------

/**
 * Compute aggregate statistics from an array of proposals.
 *
 * @param proposals - Array of proposals to analyze
 * @returns Computed ProposalStats
 */
export function computeProposalStats(proposals: Proposal[]): ProposalStats {
	const byStatus = {} as Record<ProposalStatus, number>;
	const byType = {} as Record<ProposalType, number>;

	for (const status of ALL_PROPOSAL_STATUSES) {
		byStatus[status] = 0;
	}
	for (const type of ALL_PROPOSAL_TYPES) {
		byType[type] = 0;
	}

	let totalScore = 0;
	let scoredCount = 0;
	let approvedCount = 0;
	let reviewedCount = 0;

	for (const proposal of proposals) {
		byStatus[proposal.status] = (byStatus[proposal.status] ?? 0) + 1;
		byType[proposal.type] = (byType[proposal.type] ?? 0) + 1;

		totalScore += proposal.score.total;
		scoredCount++;

		if (proposal.status === "approved" || proposal.status === "rejected") {
			reviewedCount++;
			if (proposal.status === "approved") {
				approvedCount++;
			}
		}
	}

	return {
		totalProposals: proposals.length,
		byStatus,
		byType,
		averageScore: scoredCount > 0 ? totalScore / scoredCount : 0,
		acceptanceRate: reviewedCount > 0 ? approvedCount / reviewedCount : 0,
		pendingApprovalCount: byStatus.pending_approval ?? 0,
		expiredCount: byStatus.expired ?? 0,
	};
}

// Re-export MemorySourceRef for convenience
// (full import from brain/memory/types is available, but we need the type here)
import type { MemorySourceRef } from "../memory/types.js";
