/**
 * Goal & Preference Domain Model — P15.A
 *
 * Defines the core data structures for user goals, preferences, autonomy
 * profiles, decision classification, and goal drift detection.
 *
 * Every goal tracks milestones with individual completion status.
 * Preferences are typed (string, boolean, number) with source attribution.
 * Autonomy levels 1-4 define explicit capability boundaries.
 * Decision classification maps any action to a decision class.
 * Goal drift detection tracks misalignment between proposals and goals.
 *
 * File scope: Single source of truth for all goal/preference/autonomy/decision/
 * drift types used by the Goal Store (P15.B), Autonomy Engine (P15.C),
 * Decision Classifier (P15.D), and Goal Drift Detector (P15.E).
 */

import { randomUUID } from "node:crypto";
import type { MemorySourceRef } from "../memory/types.js";

// ---------------------------------------------------------------------------
// Enums & Unions
// ---------------------------------------------------------------------------

/**
 * Autonomy level (1-4), defining Pi's authority boundaries.
 * - 1: Advisor — read-only insights and proposals
 * - 2: Planner — can generate and validate plans, no execution
 * - 3: Operator — can execute approved plans, retry failures
 * - 4: Autonomous Strategist — strategic capabilities
 */
export type AutonomyLevel = 1 | 2 | 3 | 4;

/**
 * Lifecycle status of a goal record.
 */
export type GoalStatus = "active" | "completed" | "paused" | "cancelled" | "needs_review";

/**
 * Priority level of a goal.
 */
export type GoalPriority = "critical" | "high" | "normal" | "low";

/**
 * Source of a preference value.
 */
export type PreferenceSource = "user_explicit" | "user_implicit" | "system_default" | "learned";

/**
 * Decision class for action classification.
 */
export type DecisionClass = "auto_decide" | "approval_required" | "never_auto_decide";

/**
 * Category of a preference record.
 */
export type PreferenceCategory = "execution" | "planning" | "memory" | "proposal" | "dashboard" | "autonomy";

/**
 * Operator for decision rule conditions.
 */
export type ConditionOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";

/**
 * Type of drift indicator.
 */
export type DriftIndicatorType = "rejection_pattern" | "proposal_mismatch" | "stale_goal" | "priority_shift";

/**
 * Severity of a drift report.
 */
export type DriftSeverity = "low" | "medium" | "high";

// ---------------------------------------------------------------------------
// Constant Arrays
// ---------------------------------------------------------------------------

export const ALL_AUTONOMY_LEVELS: AutonomyLevel[] = [1, 2, 3, 4];

export const ALL_GOAL_STATUSES: GoalStatus[] = ["active", "completed", "paused", "cancelled", "needs_review"];

export const ALL_GOAL_PRIORITIES: GoalPriority[] = ["critical", "high", "normal", "low"];

export const ALL_PREFERENCE_SOURCES: PreferenceSource[] = [
	"user_explicit",
	"user_implicit",
	"system_default",
	"learned",
];

export const ALL_DECISION_CLASSES: DecisionClass[] = ["auto_decide", "approval_required", "never_auto_decide"];

export const ALL_PREFERENCE_CATEGORIES: PreferenceCategory[] = [
	"execution",
	"planning",
	"memory",
	"proposal",
	"dashboard",
	"autonomy",
];

export const ALL_CONDITION_OPERATORS: ConditionOperator[] = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains"];

export const ALL_DRIFT_INDICATOR_TYPES: DriftIndicatorType[] = [
	"rejection_pattern",
	"proposal_mismatch",
	"stale_goal",
	"priority_shift",
];

export const ALL_DRIFT_SEVERITIES: DriftSeverity[] = ["low", "medium", "high"];

// ---------------------------------------------------------------------------
// Goal Types
// ---------------------------------------------------------------------------

/**
 * A single milestone within a goal, tracking progress toward completion.
 */
export interface Milestone {
	/** Unique identifier for the milestone */
	id: string;
	/** Short title of the milestone */
	title: string;
	/** Optional detailed description */
	description?: string;
	/** Whether this milestone has been completed */
	completed: boolean;
	/** ISO 8601 timestamp of completion (undefined if not completed) */
	completedAt?: string;
	/** ISO 8601 timestamp of creation */
	createdAt: string;
	/** Display order within the goal (lower = earlier) */
	order: number;
}

/**
 * A goal record representing something the user is trying to achieve.
 */
export interface GoalRecord {
	/** Unique identifier (ULID recommended but UUID accepted) */
	id: string;
	/** Short human-readable title */
	title: string;
	/** Longer description of the goal */
	description: string;
	/** Priority level */
	priority: GoalPriority;
	/** Current status */
	status: GoalStatus;
	/** Category grouping (e.g. "project", "learning", "health") */
	category: string;
	/** Ordered milestones tracking progress */
	milestones: Milestone[];
	/** ISO 8601 timestamp of creation */
	createdAt: string;
	/** ISO 8601 timestamp of last update */
	updatedAt: string;
	/** Optional target date for completion */
	targetDate?: string;
	/** ISO 8601 timestamp of completion (if completed) */
	completedAt?: string;
	/** IDs of memory records related to this goal */
	relatedMemoryIds: string[];
	/** Arbitrary metadata key-value store */
	metadata: Record<string, unknown>;
}

/**
 * Input for creating a new goal.
 */
export interface GoalCreateInput {
	/** Short human-readable title */
	title: string;
	/** Longer description of the goal */
	description: string;
	/** Priority level (default: "normal") */
	priority?: GoalPriority;
	/** Category grouping */
	category?: string;
	/** Initial milestones (without id/createdAt, which will be generated) */
	milestones?: Omit<Milestone, "id" | "createdAt">[];
	/** Optional target date */
	targetDate?: string;
	/** IDs of memory records related to this goal */
	relatedMemoryIds?: string[];
}

/**
 * Input for updating an existing goal (all fields optional).
 */
export interface GoalUpdateInput {
	title?: string;
	description?: string;
	priority?: GoalPriority;
	status?: GoalStatus;
	category?: string;
	milestones?: Milestone[];
	targetDate?: string;
	relatedMemoryIds?: string[];
}

// ---------------------------------------------------------------------------
// Preference Types
// ---------------------------------------------------------------------------

/**
 * A preference record storing a user's preference with typed value and source attribution.
 */
export interface PreferenceRecord {
	/** Unique identifier */
	id: string;
	/** Category of the preference */
	category: PreferenceCategory;
	/** Key name within the category */
	key: string;
	/** Typed value (string, boolean, or number) */
	value: string | boolean | number;
	/** How this preference was established */
	source: PreferenceSource;
	/** Confidence in this preference (0-1) */
	confidence: number;
	/** Human-readable description */
	description?: string;
	/** ISO 8601 timestamp of last update */
	updatedAt: string;
}

/**
 * Input for creating a new preference.
 */
export interface PreferenceCreateInput {
	/** Category of the preference */
	category: PreferenceCategory;
	/** Key name within the category */
	key: string;
	/** Typed value (string, boolean, or number) */
	value: string | boolean | number;
	/** How this preference was established (default: "user_explicit") */
	source?: PreferenceSource;
	/** Confidence in this preference (0-1, default: 1.0) */
	confidence?: number;
	/** Human-readable description */
	description?: string;
}

// ---------------------------------------------------------------------------
// Autonomy Types
// ---------------------------------------------------------------------------

/**
 * Full autonomy profile for a user/session.
 */
export interface AutonomyProfile {
	/** User identifier */
	userId: string;
	/** Current autonomy level (1-4) */
	level: AutonomyLevel;
	/** Categories of work that are approved */
	approvedCategories: string[];
	/** Actions that are explicitly forbidden */
	forbiddenActions: string[];
	/** Per-action threshold overrides */
	approvalThresholds: Record<string, "auto" | "approval" | "forbidden">;
	/** Maximum compute-minutes before requiring approval */
	maxAutonomousSpend?: number;
	/** ISO 8601 timestamp of last update */
	updatedAt: string;
	/** ISO 8601 timestamp of creation */
	createdAt: string;
}

/**
 * Capability set derived from an autonomy level.
 */
export interface AutonomyCapabilities {
	/** The autonomy level this capability set represents */
	level: AutonomyLevel;
	/** Can generate insights and identify bottlenecks */
	canGenerateInsights: boolean;
	/** Can propose ideas and draft phase plans */
	canProposeIdeas: boolean;
	/** Can generate phase plans */
	canGeneratePlans: boolean;
	/** Can validate plans */
	canValidatePlans: boolean;
	/** Can execute approved plans */
	canExecutePlans: boolean;
	/** Can retry safe transient failures */
	canRetryTransientFailures: boolean;
	/** Can produce morning reports and summaries */
	canProduceReports: boolean;
	/** Can propose roadmap changes */
	canProposeRoadmapChanges: boolean;
	/** Can recommend architecture direction */
	canRecommendArchitecture: boolean;
	/** Actions that require approval at this level */
	requiresApprovalFor: string[];
	/** Actions that are forbidden at this level */
	forbiddenFor: string[];
}

/**
 * Pre-defined capability sets for each autonomy level.
 *
 * These are the canonical mappings from autonomy levels to
 * capabilities and restrictions.
 */
export const AUTONOMY_CAPABILITIES: Record<AutonomyLevel, AutonomyCapabilities> = {
	1: {
		level: 1,
		canGenerateInsights: true,
		canProposeIdeas: true,
		canGeneratePlans: false,
		canValidatePlans: false,
		canExecutePlans: false,
		canRetryTransientFailures: false,
		canProduceReports: true,
		canProposeRoadmapChanges: false,
		canRecommendArchitecture: false,
		requiresApprovalFor: ["memory_creation", "proposal_submission", "goal_change"],
		forbiddenFor: [],
	},
	2: {
		level: 2,
		canGenerateInsights: true,
		canProposeIdeas: true,
		canGeneratePlans: true,
		canValidatePlans: true,
		canExecutePlans: false,
		canRetryTransientFailures: false,
		canProduceReports: true,
		canProposeRoadmapChanges: false,
		canRecommendArchitecture: false,
		requiresApprovalFor: [
			"plan_execution",
			"system_mutation",
			"memory_indexing",
			"architecture_change",
			"extension_permission",
		],
		forbiddenFor: [],
	},
	3: {
		level: 3,
		canGenerateInsights: true,
		canProposeIdeas: true,
		canGeneratePlans: true,
		canValidatePlans: true,
		canExecutePlans: true,
		canRetryTransientFailures: true,
		canProduceReports: true,
		canProposeRoadmapChanges: false,
		canRecommendArchitecture: false,
		requiresApprovalFor: ["strategic_change", "unusual_risk", "emergency_stop_override"],
		forbiddenFor: [
			"secret_access",
			"destructive_cleanup",
			"git_push",
			"irreversible_deletion",
			"bypass_validation_gate",
		],
	},
	4: {
		level: 4,
		canGenerateInsights: true,
		canProposeIdeas: true,
		canGeneratePlans: true,
		canValidatePlans: true,
		canExecutePlans: true,
		canRetryTransientFailures: true,
		canProduceReports: true,
		canProposeRoadmapChanges: true,
		canRecommendArchitecture: true,
		requiresApprovalFor: ["irreversible_actions", "policy_override"],
		forbiddenFor: [
			"secret_access",
			"destructive_cleanup",
			"git_push",
			"irreversible_deletion",
			"bypass_validation_gate",
		],
	},
};

// ---------------------------------------------------------------------------
// Decision Types
// ---------------------------------------------------------------------------

/**
 * Result of classifying an action.
 */
export interface DecisionClassification {
	/** The action that was classified */
	action: string;
	/** The decision class assigned to this action */
	decisionClass: DecisionClass;
	/** Confidence in this classification (0-1) */
	confidence: number;
	/** Role/identity from whom approval is required (if applicable) */
	requiresApprovalFrom?: string;
	/** Policy references that support this classification */
	policyRefs: string[];
	/** Human-readable rationale for the classification */
	rationale: string;
	/** Autonomy level at which this classification was made */
	autonomyLevel: AutonomyLevel;
}

/**
 * A rule that maps an action to a decision class with optional conditions.
 */
export interface DecisionRule {
	/** Unique identifier for the rule */
	id: string;
	/** The action pattern this rule applies to */
	action: string;
	/** Decision class to assign when this rule matches */
	decisionClass: DecisionClass;
	/** Optional conditions that must be met for the rule to apply */
	conditions?: DecisionCondition[];
	/** Priority (higher = evaluated first) */
	priority: number;
	/** Human-readable description */
	description: string;
}

/**
 * A condition used to match context during decision classification.
 */
export interface DecisionCondition {
	/** The field in the context to evaluate */
	field: string;
	/** Comparison operator */
	operator: ConditionOperator;
	/** Value to compare against */
	value: unknown;
}

// ---------------------------------------------------------------------------
// Drift Types
// ---------------------------------------------------------------------------

/**
 * A report generated when goal drift is detected.
 */
export interface GoalDriftReport {
	/** Unique identifier */
	id: string;
	/** ID of the goal that may have drifted */
	goalId: string;
	/** Title of the goal (denormalized for readability) */
	goalTitle: string;
	/** Severity of the detected drift */
	severity: DriftSeverity;
	/** Indicators that triggered this report */
	indicators: DriftIndicator[];
	/** ISO 8601 timestamp when the report was generated */
	generatedAt: string;
	/** ISO 8601 timestamp when the drift was resolved (if applicable) */
	resolvedAt?: string;
	/** Who resolved the drift */
	resolvedBy?: string;
}

/**
 * An individual indicator contributing to a drift report.
 */
export interface DriftIndicator {
	/** The type of drift indicator */
	type: DriftIndicatorType;
	/** Detailed description */
	details: string;
	/** Evidence references linking to memory records */
	evidence: MemorySourceRef[];
	/** Severity score (0-1) */
	score: number;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics across goals.
 */
export interface GoalsStats {
	/** Total number of goals */
	totalGoals: number;
	/** Number of active goals */
	activeGoals: number;
	/** Number of completed goals */
	completedGoals: number;
	/** Breakdown by status */
	byStatus: Record<GoalStatus, number>;
	/** Breakdown by priority */
	byPriority: Record<GoalPriority, number>;
	/** Total drift reports */
	driftReports: number;
	/** Open (unresolved) drift reports */
	openDriftReports: number;
}

// ---------------------------------------------------------------------------
// Validation Result
// ---------------------------------------------------------------------------

/**
 * Result of a validation check.
 */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

// ---------------------------------------------------------------------------
// Validation Functions
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isIso8601(value: unknown): boolean {
	if (typeof value !== "string") return false;
	return !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a GoalRecord.
 *
 * @param value - The value to validate
 * @returns ValidationResult with any errors
 */
export function validateGoalRecord(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!isRecord(value)) {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	if (!isNonEmptyString(value.id)) errors.push("id must be a non-empty string");
	if (!isNonEmptyString(value.title)) errors.push("title must be a non-empty string");
	if (!isNonEmptyString(value.description)) errors.push("description must be a non-empty string");
	if (!ALL_GOAL_PRIORITIES.includes(value.priority as GoalPriority)) {
		errors.push("priority must be one of: critical, high, normal, low");
	}
	if (!ALL_GOAL_STATUSES.includes(value.status as GoalStatus)) {
		errors.push("status must be one of: active, completed, paused, cancelled, needs_review");
	}
	if (typeof value.category !== "string") errors.push("category must be a string");
	if (!Array.isArray(value.milestones)) {
		errors.push("milestones must be an array");
	} else {
		for (const [i, m] of value.milestones.entries()) {
			if (!isRecord(m)) {
				errors.push(`milestones[${i}] must be an object`);
			} else {
				if (!isNonEmptyString(m.id)) errors.push(`milestones[${i}].id must be a non-empty string`);
				if (!isNonEmptyString(m.title)) errors.push(`milestones[${i}].title must be a non-empty string`);
				if (typeof m.completed !== "boolean") errors.push(`milestones[${i}].completed must be a boolean`);
				if (!isNonEmptyString(m.createdAt)) errors.push(`milestones[${i}].createdAt must be a non-empty string`);
				if (typeof m.order !== "number") errors.push(`milestones[${i}].order must be a number`);
			}
		}
	}
	if (!isIso8601(value.createdAt)) errors.push("createdAt must be a valid ISO 8601 string");
	if (!isIso8601(value.updatedAt)) errors.push("updatedAt must be a valid ISO 8601 string");
	if (value.targetDate !== undefined && !isIso8601(value.targetDate)) {
		errors.push("targetDate must be a valid ISO 8601 string when provided");
	}
	if (value.completedAt !== undefined && !isIso8601(value.completedAt)) {
		errors.push("completedAt must be a valid ISO 8601 string when provided");
	}
	if (!Array.isArray(value.relatedMemoryIds)) {
		errors.push("relatedMemoryIds must be an array");
	}
	if (value.metadata !== undefined && !isRecord(value.metadata)) {
		errors.push("metadata must be a record when provided");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a PreferenceRecord.
 *
 * @param value - The value to validate
 * @returns ValidationResult with any errors
 */
export function validatePreferenceRecord(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!isRecord(value)) {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	if (!isNonEmptyString(value.id)) errors.push("id must be a non-empty string");
	if (!ALL_PREFERENCE_CATEGORIES.includes(value.category as PreferenceCategory)) {
		errors.push("category must be one of: execution, planning, memory, proposal, dashboard, autonomy");
	}
	if (!isNonEmptyString(value.key)) errors.push("key must be a non-empty string");
	if (value.value === undefined) {
		errors.push("value must be a string, boolean, or number");
	}
	if (!ALL_PREFERENCE_SOURCES.includes(value.source as PreferenceSource)) {
		errors.push("source must be one of: user_explicit, user_implicit, system_default, learned");
	}
	if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
		errors.push("confidence must be a number between 0 and 1");
	}
	if (!isIso8601(value.updatedAt)) errors.push("updatedAt must be a valid ISO 8601 string");

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a GoalDriftReport.
 *
 * @param value - The value to validate
 * @returns ValidationResult with any errors
 */
export function validateGoalDriftReport(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!isRecord(value)) {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	if (!isNonEmptyString(value.id)) errors.push("id must be a non-empty string");
	if (!isNonEmptyString(value.goalId)) errors.push("goalId must be a non-empty string");
	if (!isNonEmptyString(value.goalTitle)) errors.push("goalTitle must be a non-empty string");
	if (!ALL_DRIFT_SEVERITIES.includes(value.severity as DriftSeverity)) {
		errors.push("severity must be one of: low, medium, high");
	}
	if (!Array.isArray(value.indicators)) {
		errors.push("indicators must be an array");
	} else {
		for (const [i, ind] of value.indicators.entries()) {
			if (!isRecord(ind)) {
				errors.push(`indicators[${i}] must be an object`);
			} else {
				if (!ALL_DRIFT_INDICATOR_TYPES.includes(ind.type as DriftIndicatorType)) {
					errors.push(
						`indicators[${i}].type must be one of: rejection_pattern, proposal_mismatch, stale_goal, priority_shift`,
					);
				}
				if (!isNonEmptyString(ind.details)) errors.push(`indicators[${i}].details must be a non-empty string`);
				if (!Array.isArray(ind.evidence)) errors.push(`indicators[${i}].evidence must be an array`);
				if (typeof ind.score !== "number" || ind.score < 0 || ind.score > 1) {
					errors.push(`indicators[${i}].score must be a number between 0 and 1`);
				}
			}
		}
	}
	if (!isIso8601(value.generatedAt)) errors.push("generatedAt must be a valid ISO 8601 string");

	if (value.resolvedAt !== undefined && !isIso8601(value.resolvedAt)) {
		errors.push("resolvedAt must be a valid ISO 8601 string when provided");
	}
	if (value.resolvedBy !== undefined && !isNonEmptyString(value.resolvedBy)) {
		errors.push("resolvedBy must be a non-empty string when provided");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a Milestone object.
 *
 * @param value - The value to validate
 * @returns ValidationResult with any errors
 */
export function validateMilestone(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!isRecord(value)) {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	if (!isNonEmptyString(value.id)) errors.push("id must be a non-empty string");
	if (!isNonEmptyString(value.title)) errors.push("title must be a non-empty string");
	if (typeof value.completed !== "boolean") errors.push("completed must be a boolean");
	if (!isIso8601(value.createdAt)) errors.push("createdAt must be a valid ISO 8601 string");
	if (typeof value.order !== "number") errors.push("order must be a number");

	return { valid: errors.length === 0, errors };
}

/**
 * Validate an AutonomyProfile.
 *
 * @param value - The value to validate
 * @returns ValidationResult with any errors
 */
export function validateAutonomyProfile(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!isRecord(value)) {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	if (!isNonEmptyString(value.userId)) errors.push("userId must be a non-empty string");
	if (!ALL_AUTONOMY_LEVELS.includes(value.level as AutonomyLevel)) {
		errors.push("level must be one of: 1, 2, 3, 4");
	}
	if (!Array.isArray(value.approvedCategories)) {
		errors.push("approvedCategories must be an array");
	}
	if (!Array.isArray(value.forbiddenActions)) {
		errors.push("forbiddenActions must be an array");
	}
	if (typeof value.approvalThresholds !== "object" || value.approvalThresholds === null) {
		errors.push("approvalThresholds must be an object");
	}
	if (!isIso8601(value.updatedAt)) errors.push("updatedAt must be a valid ISO 8601 string");
	if (!isIso8601(value.createdAt)) errors.push("createdAt must be a valid ISO 8601 string");

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a DecisionRule.
 *
 * @param value - The value to validate
 * @returns ValidationResult with any errors
 */
export function validateDecisionRule(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!isRecord(value)) {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	if (!isNonEmptyString(value.id)) errors.push("id must be a non-empty string");
	if (!isNonEmptyString(value.action)) errors.push("action must be a non-empty string");
	if (!ALL_DECISION_CLASSES.includes(value.decisionClass as DecisionClass)) {
		errors.push("decisionClass must be one of: auto_decide, approval_required, never_auto_decide");
	}
	if (value.conditions !== undefined && !Array.isArray(value.conditions)) {
		errors.push("conditions must be an array when provided");
	}
	if (typeof value.priority !== "number") errors.push("priority must be a number");
	if (!isNonEmptyString(value.description)) errors.push("description must be a non-empty string");

	return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create a new GoalRecord with defaults applied.
 *
 * @param overrides - Partial or complete goal fields (title and description are required)
 * @returns A fully populated GoalRecord
 */
export function createGoalRecord(
	overrides: Partial<Omit<GoalRecord, "id" | "createdAt" | "updatedAt">> & Pick<GoalRecord, "title" | "description">,
): GoalRecord {
	const now = new Date().toISOString();

	const milestoneOverrides = overrides.milestones ?? [];
	const milestones: Milestone[] = milestoneOverrides.map((m, i) => ({
		id: randomUUID(),
		title: m.title,
		description: m.description,
		completed: m.completed,
		completedAt: m.completedAt,
		createdAt: m.createdAt ?? now,
		order: m.order ?? i,
	}));

	return {
		id: randomUUID(),
		title: overrides.title,
		description: overrides.description,
		priority: overrides.priority ?? "normal",
		status: overrides.status ?? "active",
		category: overrides.category ?? "general",
		milestones,
		createdAt: now,
		updatedAt: now,
		targetDate: overrides.targetDate,
		completedAt: overrides.completedAt,
		relatedMemoryIds: overrides.relatedMemoryIds ?? [],
		metadata: overrides.metadata ?? {},
	};
}

/**
 * Create a new GoalCreateInput with a title.
 *
 * @param title - The goal title
 * @returns A GoalCreateInput with defaults
 */
export function createGoalCreateInput(title: string, description?: string): GoalCreateInput {
	return {
		title,
		description: description ?? "",
	};
}

/**
 * Create a new Milestone with defaults applied.
 *
 * @param overrides - Partial milestone fields (title is required)
 * @returns A fully populated Milestone
 */
export function createMilestone(
	overrides: Partial<Omit<Milestone, "id" | "createdAt">> & Pick<Milestone, "title">,
): Milestone {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		title: overrides.title,
		description: overrides.description,
		completed: overrides.completed ?? false,
		completedAt: overrides.completedAt,
		createdAt: now,
		order: overrides.order ?? 0,
	};
}

/**
 * Create a new PreferenceRecord with defaults applied.
 *
 * @param overrides - Partial preference fields (category, key, and value are required)
 * @returns A fully populated PreferenceRecord
 */
export function createPreferenceRecord(
	overrides: Partial<Omit<PreferenceRecord, "id" | "updatedAt">> &
		Pick<PreferenceRecord, "category" | "key" | "value">,
): PreferenceRecord {
	return {
		id: randomUUID(),
		category: overrides.category,
		key: overrides.key,
		value: overrides.value,
		source: overrides.source ?? "user_explicit",
		confidence: overrides.confidence ?? 1.0,
		description: overrides.description,
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Create a new PreferenceCreateInput with defaults applied.
 *
 * @param overrides - Partial input fields (category, key, and value are required)
 * @returns A fully populated PreferenceCreateInput
 */
export function createPreferenceCreateInput(
	overrides: Partial<PreferenceCreateInput> & Pick<PreferenceCreateInput, "category" | "key" | "value">,
): PreferenceCreateInput {
	return {
		category: overrides.category,
		key: overrides.key,
		value: overrides.value,
		source: overrides.source ?? "user_explicit",
		confidence: overrides.confidence ?? 1.0,
		description: overrides.description,
	};
}

/**
 * Create a new AutonomyProfile with defaults applied.
 *
 * @param level - The autonomy level
 * @returns A fully populated AutonomyProfile
 */
export function createAutonomyProfile(level: AutonomyLevel): AutonomyProfile {
	const now = new Date().toISOString();
	const caps = AUTONOMY_CAPABILITIES[level];

	return {
		userId: "default",
		level,
		approvedCategories: [],
		forbiddenActions: [...caps.forbiddenFor],
		approvalThresholds: {},
		maxAutonomousSpend: undefined,
		updatedAt: now,
		createdAt: now,
	};
}

/**
 * Create a new DecisionRule with defaults applied.
 *
 * @returns A bare DecisionRule (all fields must be filled by caller)
 */
export function createDecisionRule(): DecisionRule {
	return {
		id: "",
		action: "",
		decisionClass: "approval_required",
		conditions: [],
		priority: 0,
		description: "",
	};
}

/**
 * Create a new GoalDriftReport with defaults applied.
 *
 * @returns A bare GoalDriftReport (fields must be filled by caller)
 */
export function createGoalDriftReport(): GoalDriftReport {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		goalId: "",
		goalTitle: "",
		severity: "medium",
		indicators: [],
		generatedAt: now,
	};
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Compute aggregate GoalsStats from an array of goal records and drift reports.
 *
 * @param goals - All goal records
 * @param driftReports - All drift reports (optional)
 * @returns GoalsStats with aggregated counts
 */
export function computeGoalsStats(goals: GoalRecord[], driftReports?: GoalDriftReport[]): GoalsStats {
	const byStatus = {} as Record<GoalStatus, number>;
	const byPriority = {} as Record<GoalPriority, number>;

	for (const s of ALL_GOAL_STATUSES) {
		byStatus[s] = 0;
	}
	for (const p of ALL_GOAL_PRIORITIES) {
		byPriority[p] = 0;
	}

	let activeGoals = 0;
	let completedGoals = 0;

	for (const goal of goals) {
		byStatus[goal.status]++;
		byPriority[goal.priority]++;
		if (goal.status === "active") activeGoals++;
		if (goal.status === "completed") completedGoals++;
	}

	const reports = driftReports ?? [];
	const driftCount = reports.length;
	const openDriftCount = reports.filter((r) => !r.resolvedAt).length;

	return {
		totalGoals: goals.length,
		activeGoals,
		completedGoals,
		byStatus,
		byPriority,
		driftReports: driftCount,
		openDriftReports: openDriftCount,
	};
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a GoalRecord to a JSON string.
 *
 * @param record - The goal record to serialize
 * @returns Pretty-printed JSON string
 */
export function serializeGoalRecord(record: GoalRecord): string {
	return JSON.stringify(record, null, 2);
}

/**
 * Deserialize a JSON string to a GoalRecord with validation.
 *
 * @param json - The JSON string to parse
 * @returns A validated GoalRecord
 * @throws If the JSON is invalid or validation fails
 */
export function deserializeGoalRecord(json: string): GoalRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(`Failed to parse GoalRecord JSON: ${(e as Error).message}`);
	}

	const result = validateGoalRecord(parsed);
	if (!result.valid) {
		throw new Error(`Invalid GoalRecord: ${result.errors.join("; ")}`);
	}

	return parsed as GoalRecord;
}

/**
 * Serialize a PreferenceRecord to a JSON string.
 *
 * @param record - The preference record to serialize
 * @returns Pretty-printed JSON string
 */
export function serializePreferenceRecord(record: PreferenceRecord): string {
	return JSON.stringify(record, null, 2);
}

/**
 * Deserialize a JSON string to a PreferenceRecord with validation.
 *
 * @param json - The JSON string to parse
 * @returns A validated PreferenceRecord
 * @throws If the JSON is invalid or validation fails
 */
export function deserializePreferenceRecord(json: string): PreferenceRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(`Failed to parse PreferenceRecord JSON: ${(e as Error).message}`);
	}

	const result = validatePreferenceRecord(parsed);
	if (!result.valid) {
		throw new Error(`Invalid PreferenceRecord: ${result.errors.join("; ")}`);
	}

	return parsed as PreferenceRecord;
}

/**
 * Serialize a GoalDriftReport to a JSON string.
 *
 * @param report - The drift report to serialize
 * @returns Pretty-printed JSON string
 */
export function serializeGoalDriftReport(report: GoalDriftReport): string {
	return JSON.stringify(report, null, 2);
}

/**
 * Deserialize a JSON string to a GoalDriftReport with validation.
 *
 * @param json - The JSON string to parse
 * @returns A validated GoalDriftReport
 * @throws If the JSON is invalid or validation fails
 */
export function deserializeGoalDriftReport(json: string): GoalDriftReport {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(`Failed to parse GoalDriftReport JSON: ${(e as Error).message}`);
	}

	const result = validateGoalDriftReport(parsed);
	if (!result.valid) {
		throw new Error(`Invalid GoalDriftReport: ${result.errors.join("; ")}`);
	}

	return parsed as GoalDriftReport;
}

/**
 * Serialize an AutonomyProfile to JSON (as plain object).
 *
 * @param profile - The autonomy profile to serialize
 * @returns Plain object for serialization
 */
export function serializeAutonomyProfile(profile: AutonomyProfile): AutonomyProfile {
	return profile;
}

/**
 * Deserialize an AutonomyProfile from a plain object.
 *
 * @param data - The data to deserialize
 * @returns A validated AutonomyProfile
 * @throws If the data is invalid
 */
export function deserializeAutonomyProfile(data: unknown): AutonomyProfile {
	if (!isRecord(data)) {
		throw new Error("AutonomyProfile data must be a non-null object");
	}

	const result = validateAutonomyProfile(data);
	if (!result.valid) {
		throw new Error(`Invalid AutonomyProfile: ${result.errors.join("; ")}`);
	}

	return data as unknown as AutonomyProfile;
}
