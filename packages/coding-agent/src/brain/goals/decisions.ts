/**
 * Decision Classifier — P15.D
 *
 * Classifies any action into auto_decide, approval_required, or never_auto_decide
 * based on rules and context.
 *
 * Features:
 * - Built-in rules for common actions
 * - Rule-based classification with priority ordering
 * - Extensible — new rules can be added via addRule/removeRule/setRules
 * - Context-aware classification with conditions
 * - Confidence-based override (low confidence downgrades auto_decide)
 * - All classifications logged for audit
 */

import { randomUUID } from "node:crypto";
import type {
	AutonomyLevel,
	ConditionOperator,
	DecisionClass,
	DecisionClassification,
	DecisionCondition,
	DecisionRule,
} from "./types.js";

// ---------------------------------------------------------------------------
// Context & Audit Types
// ---------------------------------------------------------------------------

/**
 * Context provided alongside an action for classification.
 */
export interface ClassificationContext {
	/** Autonomy level at the time of action */
	autonomyLevel: AutonomyLevel;
	/** Risk level of the action */
	riskLevel?: "low" | "medium" | "high" | "critical";
	/** Type of proposal if action relates to a proposal */
	proposalType?: string;
	/** Current system state */
	systemState?: "idle" | "executing" | "integration_active";
	/** Area of the system affected */
	affectedArea?: string;
	/** Whether the action targets a protected system */
	isProtected?: boolean;
	/** Confidence in the decision triggering this action (0-1) */
	confidence?: number;
}

/**
 * Audit entry for a classification decision.
 */
export interface DecisionAuditEntry {
	/** Unique identifier for this audit entry */
	id: string;
	/** The action that was classified */
	action: string;
	/** The decision class assigned */
	decisionClass: DecisionClass;
	/** Confidence in the classification */
	confidence: number;
	/** Human-readable rationale */
	rationale: string;
	/** Which rule matched (or 'fallback') */
	matchedRule: string;
	/** ISO 8601 timestamp */
	timestamp: string;
}

// ---------------------------------------------------------------------------
// Default Rules
// ---------------------------------------------------------------------------

const DEFAULT_RULES: DecisionRule[] = [
	// Auto-decide
	{
		id: "auto_001",
		action: "retry_transient_failure",
		decisionClass: "auto_decide",
		priority: 100,
		description: "Retry safe transient failures",
	},
	{
		id: "auto_002",
		action: "generate_draft_proposal",
		decisionClass: "auto_decide",
		priority: 100,
		description: "Generate draft proposals",
	},
	{
		id: "auto_003",
		action: "create_read_only_summary",
		decisionClass: "auto_decide",
		priority: 100,
		description: "Create read-only summaries",
	},
	{
		id: "auto_004",
		action: "low_risk_queue_reorder",
		decisionClass: "auto_decide",
		priority: 90,
		description: "Reorder queue for efficiency",
		conditions: [{ field: "riskLevel", operator: "eq" as ConditionOperator, value: "low" }],
	},

	// Approval required
	{
		id: "appr_001",
		action: "execute_generated_plan",
		decisionClass: "approval_required",
		priority: 100,
		description: "Execute a generated plan",
	},
	{
		id: "appr_002",
		action: "protected_system_mutation",
		decisionClass: "approval_required",
		priority: 100,
		description: "Mutate protected system",
	},
	{
		id: "appr_003",
		action: "memory_index_sensitive_source",
		decisionClass: "approval_required",
		priority: 100,
		description: "Index sensitive source",
	},
	{
		id: "appr_004",
		action: "architecture_change",
		decisionClass: "approval_required",
		priority: 90,
		description: "Change architecture",
	},
	{
		id: "appr_005",
		action: "extension_permission_expansion",
		decisionClass: "approval_required",
		priority: 90,
		description: "Expand extension permissions",
	},

	// Never auto-decide (hard stops)
	{
		id: "forbid_001",
		action: "secret_access",
		decisionClass: "never_auto_decide",
		priority: 1000,
		description: "Access secrets",
	},
	{
		id: "forbid_002",
		action: "destructive_cleanup",
		decisionClass: "never_auto_decide",
		priority: 1000,
		description: "Raw destructive cleanup",
	},
	{
		id: "forbid_003",
		action: "git_push",
		decisionClass: "never_auto_decide",
		priority: 1000,
		description: "Push to git",
	},
	{
		id: "forbid_004",
		action: "irreversible_deletion",
		decisionClass: "never_auto_decide",
		priority: 1000,
		description: "Irreversible deletion",
	},
	{
		id: "forbid_005",
		action: "bypass_validation_gate",
		decisionClass: "never_auto_decide",
		priority: 1000,
		description: "Bypass validation gates",
	},
];

/**
 * Default confidence threshold for auto-decide.
 * Actions classified as auto_decide with context confidence below this
 * value are downgraded to approval_required.
 */
const DEFAULT_AUTO_DECIDE_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Fallback decision class when no rule matches.
 */
const FALLBACK_DECISION: DecisionClass = "approval_required";

// ---------------------------------------------------------------------------
// Condition Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a single condition against the context.
 */
function evaluateCondition(condition: DecisionCondition, context: ClassificationContext): boolean {
	const value = (context as unknown as Record<string, unknown>)[condition.field];

	switch (condition.operator) {
		case "eq":
			return value === condition.value;
		case "neq":
			return value !== condition.value;
		case "gt":
			return typeof value === "number" && typeof condition.value === "number" && value > condition.value;
		case "gte":
			return typeof value === "number" && typeof condition.value === "number" && value >= condition.value;
		case "lt":
			return typeof value === "number" && typeof condition.value === "number" && value < condition.value;
		case "lte":
			return typeof value === "number" && typeof condition.value === "number" && value <= condition.value;
		case "in":
			return Array.isArray(condition.value) && condition.value.includes(value);
		case "contains":
			return typeof value === "string" && typeof condition.value === "string" && value.includes(condition.value);
		default:
			return false;
	}
}

/**
 * Evaluate all conditions for a rule. All conditions must pass (AND logic).
 */
function evaluateConditions(conditions: DecisionCondition[] | undefined, context: ClassificationContext): boolean {
	if (!conditions || conditions.length === 0) return true;
	return conditions.every((c) => evaluateCondition(c, context));
}

// ---------------------------------------------------------------------------
// Decision Classifier
// ---------------------------------------------------------------------------

/**
 * Classifies actions into decision classes based on rules and context.
 *
 * Built-in rules cover common actions. New rules can be added at runtime.
 * The classifier uses priority ordering: higher-priority rules are evaluated
 * first. Conditions allow context-aware classification.
 *
 * Confidence-based override: if context.confidence is below the threshold,
 * auto_decide is downgraded to approval_required.
 */
export class DecisionClassifier {
	private rules: DecisionRule[] = [];
	private auditEntries: DecisionAuditEntry[] = [];
	private autoDecideConfidenceThreshold: number = DEFAULT_AUTO_DECIDE_CONFIDENCE_THRESHOLD;

	constructor() {
		this.initDefaultRules();
	}

	// -----------------------------------------------------------------------
	// Core Classification
	// -----------------------------------------------------------------------

	/**
	 * Classify an action using action-name matching only (ignores conditions).
	 *
	 * @param action - The action name to classify
	 * @param context - Classification context (used for confidence override)
	 * @returns DecisionClassification result
	 */
	classify(action: string, context: ClassificationContext): DecisionClassification {
		return this.classifyInternal(action, context, false);
	}

	/**
	 * Classify an action with full context-aware condition evaluation.
	 *
	 * @param action - The action name to classify
	 * @param context - Classification context (includes conditions evaluation)
	 * @returns DecisionClassification result
	 */
	classifyWithContext(action: string, context: ClassificationContext): DecisionClassification {
		return this.classifyInternal(action, context, true);
	}

	// -----------------------------------------------------------------------
	// Rule Management
	// -----------------------------------------------------------------------

	/**
	 * Add a new decision rule.
	 */
	addRule(rule: DecisionRule): void {
		this.rules.push(rule);
	}

	/**
	 * Remove a rule by its ID.
	 *
	 * @returns true if the rule was found and removed, false otherwise
	 */
	removeRule(ruleId: string): boolean {
		const index = this.rules.findIndex((r) => r.id === ruleId);
		if (index === -1) return false;
		this.rules.splice(index, 1);
		return true;
	}

	/**
	 * Get all current rules (shallow copy).
	 */
	getRules(): DecisionRule[] {
		return [...this.rules];
	}

	/**
	 * Replace all rules.
	 */
	setRules(rules: DecisionRule[]): void {
		this.rules = rules.map((r) => ({ ...r }));
	}

	// -----------------------------------------------------------------------
	// Confidence Threshold
	// -----------------------------------------------------------------------

	/**
	 * Set the auto-decide confidence threshold (0-1).
	 */
	setAutoDecideConfidenceThreshold(threshold: number): void {
		this.autoDecideConfidenceThreshold = threshold;
	}

	/**
	 * Get the current auto-decide confidence threshold.
	 */
	getAutoDecideConfidenceThreshold(): number {
		return this.autoDecideConfidenceThreshold;
	}

	// -----------------------------------------------------------------------
	// Helper Queries
	// -----------------------------------------------------------------------

	/**
	 * Check if an action is classified as auto_decide.
	 */
	isAutoDecide(action: string, context?: ClassificationContext): boolean {
		const ctx = context ?? { autonomyLevel: 3 as AutonomyLevel };
		const result = this.classifyWithContext(action, ctx);
		return result.decisionClass === "auto_decide";
	}

	/**
	 * Check if an action is classified as approval_required.
	 */
	isApprovalRequired(action: string, context?: ClassificationContext): boolean {
		const ctx = context ?? { autonomyLevel: 3 as AutonomyLevel };
		const result = this.classifyWithContext(action, ctx);
		return result.decisionClass === "approval_required";
	}

	/**
	 * Check if an action is classified as never_auto_decide.
	 */
	isNeverAutoDecide(action: string, context?: ClassificationContext): boolean {
		const ctx = context ?? { autonomyLevel: 3 as AutonomyLevel };
		const result = this.classifyWithContext(action, ctx);
		return result.decisionClass === "never_auto_decide";
	}

	// -----------------------------------------------------------------------
	// Audit
	// -----------------------------------------------------------------------

	/**
	 * Get all audit entries (shallow copy).
	 */
	getAuditLog(): DecisionAuditEntry[] {
		return [...this.auditEntries];
	}

	/**
	 * Clear the audit log.
	 */
	clearAuditLog(): void {
		this.auditEntries = [];
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	/**
	 * Initialize default rules.
	 */
	private initDefaultRules(): void {
		this.rules = DEFAULT_RULES.map((r) => ({ ...r }));
	}

	/**
	 * Internal classification logic.
	 *
	 * @param action - The action name
	 * @param context - Classification context
	 * @param evaluateCtx - If true, evaluate conditions; if false, ignore them
	 * @returns DecisionClassification
	 */
	private classifyInternal(
		action: string,
		context: ClassificationContext,
		evaluateCtx: boolean,
	): DecisionClassification {
		// Sort rules by priority descending
		const sortedRules = [...this.rules].sort((a, b) => b.priority - a.priority);

		let matchedRule: DecisionRule | null = null;

		for (const rule of sortedRules) {
			// Check action match
			if (rule.action !== action) continue;

			// If evaluating context, check conditions
			if (evaluateCtx && rule.conditions && rule.conditions.length > 0) {
				if (!evaluateConditions(rule.conditions, context)) continue;
			}

			matchedRule = rule;
			break;
		}

		let decisionClass: DecisionClass;
		let rationale: string;
		let matchedRuleId: string;
		let confidence: number;

		if (matchedRule) {
			decisionClass = matchedRule.decisionClass;
			matchedRuleId = matchedRule.id;
			rationale = matchedRule.description;
			confidence = 1.0;

			// Apply confidence override: if auto_decide and context confidence
			// is below threshold, downgrade to approval_required
			if (
				decisionClass === "auto_decide" &&
				context.confidence !== undefined &&
				context.confidence < this.autoDecideConfidenceThreshold
			) {
				decisionClass = "approval_required";
				rationale = `Downgraded from auto_decide: confidence ${context.confidence} below threshold ${this.autoDecideConfidenceThreshold}. Originally matched rule '${matchedRule.id}': ${matchedRule.description}`;
				confidence = context.confidence;
			}
		} else {
			// Fallback
			decisionClass = FALLBACK_DECISION;
			matchedRuleId = "fallback";
			rationale = `No matching rule found for action '${action}'. Defaulting to approval_required.`;
			confidence = 0.5;
		}

		const classification: DecisionClassification = {
			action,
			decisionClass,
			confidence,
			requiresApprovalFrom: decisionClass === "approval_required" ? "user" : undefined,
			policyRefs: matchedRule ? [matchedRule.id] : [],
			rationale,
			autonomyLevel: context.autonomyLevel,
		};

		// Create audit entry
		const auditEntry: DecisionAuditEntry = {
			id: randomUUID(),
			action,
			decisionClass,
			confidence,
			rationale,
			matchedRule: matchedRuleId,
			timestamp: new Date().toISOString(),
		};
		this.auditEntries.push(auditEntry);

		return classification;
	}
}
