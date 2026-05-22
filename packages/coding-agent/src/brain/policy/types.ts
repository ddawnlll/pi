/**
 * Policy Types — P18.A/B shared types
 *
 * Defines the core data structures for policy evaluation,
 * rule management, approval requests, audit entries, and
 * provenance tracking.
 */

import type { AutonomyLevel } from "../goals/types.js";
import type { ProposalType, RiskLevel } from "../proposals/types.js";
import type { SourceRef } from "../reflection/types.js";

// ---------------------------------------------------------------------------
// Policy Engine
// ---------------------------------------------------------------------------

export type PolicyDecision = "allow" | "deny" | "approval_required" | "forbidden";

export interface PolicyRule {
	id: string;
	name: string;
	description: string;
	condition: PolicyCondition;
	decision: PolicyDecision;
	priority: number;
	enabled: boolean;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface PolicyCondition {
	action: string;
	actionType?: ProposalType;
	minAutonomyLevel?: AutonomyLevel;
	maxAutonomyLevel?: AutonomyLevel;
	riskLevel?: RiskLevel | RiskLevel[];
	affectedArea?: string;
	contextMatch?: Record<string, unknown>;
	timeRestriction?: {
		start: string;
		end: string;
		timezone?: string;
	};
}

export interface PolicyContext {
	action: string;
	actionType?: ProposalType;
	actor: "pi" | "user" | "system";
	autonomyLevel: AutonomyLevel;
	riskLevel?: RiskLevel;
	proposalId?: string;
	memoryId?: string;
	planExecId?: string;
	affectedSystem?: string;
	metadata: Record<string, unknown>;
}

export interface PolicyResult {
	decision: PolicyDecision;
	matchedRule: PolicyRule | null;
	allEvaluatedRules: Array<{ rule: PolicyRule; matched: boolean; reason?: string }>;
	explanation: string;
	evaluatedAt: string;
	durationMs: number;
}

// ---------------------------------------------------------------------------
// Rule Store
// ---------------------------------------------------------------------------

export interface RuleStoreConfig {
	basePath: string;
	autoSave: boolean;
	backupOnSave: boolean;
}

export interface RuleConflict {
	ruleA: PolicyRule;
	ruleB: PolicyRule;
	matchAction: string;
	conflictType: "different_decision" | "overlap" | "redundant";
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
	id: string;
	proposalId: string;
	action: string;
	rationale: string;
	risk: ProposalRiskAssessment;
	requestedAt: string;
	deadline: string;
	requestedBy: string;
	status: ApprovalStatus;
	approvedBy?: string;
	rejectedBy?: string;
	approvedAt?: string;
	rejectedAt?: string;
	rejectionReason?: string;
	policyRuleId?: string;
	policyContext: PolicyContext;
}

export interface ProposalRiskAssessment {
	level: RiskLevel;
	score: number;
	factors: string[];
	description: string;
}

export interface ApprovalConfig {
	defaultDeadlineHours: number;
	autoExpireCheckIntervalMs: number;
	requireReasonOnRejection: boolean;
	maxPendingPerType: number;
}

export interface ApprovalStats {
	total: number;
	pending: number;
	approved: number;
	rejected: number;
	expired: number;
	avgResponseTimeMs: number;
	pendingByType: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Audit Ledger
// ---------------------------------------------------------------------------

export interface AuditEntry {
	id: string;
	timestamp: string;
	actor: "pi" | "user" | "system";
	action: string;
	decision: PolicyDecision;
	policyRuleId?: string;
	policyRuleName?: string;
	proposalId?: string;
	planExecId?: string;
	memoryId?: string;
	approvalRequestId?: string;
	evidence: SourceRef[];
	result: "success" | "failure" | "blocked";
	durationMs?: number;
	context: {
		autonomyLevel: AutonomyLevel;
		riskLevel?: RiskLevel;
	};
	metadata: Record<string, unknown>;
}

export interface AuditQuery {
	actor?: string;
	action?: string;
	decision?: PolicyDecision;
	result?: "success" | "failure" | "blocked";
	startDate?: string;
	endDate?: string;
	proposalId?: string;
	planExecId?: string;
	limit?: number;
	offset?: number;
}

export interface AuditStats {
	totalEntries: number;
	byDecision: Record<PolicyDecision, number>;
	byActor: Record<string, number>;
	byResult: Record<string, number>;
	byDate: Record<string, number>;
	dateRange: { first: string; last: string };
	fileSize: number;
	fileCount: number;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export type ProvenanceTargetType = "proposal" | "plan" | "memory" | "decision" | "approval";

export type ProvenanceRelationship =
	| "derived_from"
	| "supported_by"
	| "triggered_by"
	| "corrected_by"
	| "evaluated_by"
	| "resulted_in";

export interface ProvenanceLink {
	sourceId: string;
	sourceType: ProvenanceTargetType;
	relationship: ProvenanceRelationship;
	timestamp: string;
	summary: string;
	metadata: Record<string, unknown>;
}

export interface ProvenanceRecord {
	id: string;
	targetId: string;
	targetType: ProvenanceTargetType;
	links: ProvenanceLink[];
	createdAt: string;
	updatedAt: string;
}
