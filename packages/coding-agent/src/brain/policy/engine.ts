/**
 * Policy Engine V0 — P18.A
 *
 * Evaluates any action against policy rules and returns a policy decision
 * (allow / deny / approval_required / forbidden).
 *
 * Features:
 * - Rule-based evaluation with priority ordering (higher priority evaluated first)
 * - Glob pattern matching on action names ("memory_*" matches "memory_creation")
 * - Context-aware evaluation (autonomy level, risk level, affected system)
 * - Time-restricted rules (e.g., block during maintenance window)
 * - Recent-decision cache with configurable TTL
 * - Default-deny when no rule matches (fail-safe)
 * - Integration with AuditLedger for decision logging
 *
 * Dependencies: P18.B RuleStore, P18.E AuditLedger
 */

import { randomUUID } from "node:crypto";
import type { AuditEntry } from "../audit/ledger.js";
import type { RuleStore } from "./store.js";
import type { PolicyCondition, PolicyContext, PolicyDecision, PolicyResult, PolicyRule } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PolicyEngineConfig {
	/**
	 * Time-to-live for cached decisions in milliseconds.
	 * Default: 5000 (5 seconds)
	 */
	cacheTtlMs: number;

	/**
	 * Maximum number of cached entries.
	 * Default: 1000
	 */
	maxCacheSize: number;
}

const DEFAULT_CONFIG: PolicyEngineConfig = {
	cacheTtlMs: 5000,
	maxCacheSize: 1000,
};

// ---------------------------------------------------------------------------
// Cache Entry
// ---------------------------------------------------------------------------

interface CacheEntry {
	result: PolicyResult;
	cachedAt: number;
}

// ---------------------------------------------------------------------------
// PolicyEngine
// ---------------------------------------------------------------------------

export class PolicyEngine {
	private ruleStore: RuleStore;
	private cache: Map<string, CacheEntry>;
	private config: PolicyEngineConfig;

	constructor(ruleStore: RuleStore, config?: Partial<PolicyEngineConfig>) {
		this.ruleStore = ruleStore;
		this.cache = new Map<string, CacheEntry>();
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	/**
	 * Evaluate a single action against all policy rules.
	 *
	 * 1. Check cache for a recent decision on the same context.
	 * 2. Load all enabled rules from the store.
	 * 3. Filter to matching rules (by action glob + context conditions).
	 * 4. Sort by priority (highest first).
	 * 5. Return the highest-priority matching rule's decision.
	 * 6. If no rule matches, return default-deny.
	 *
	 * @param context - The policy context describing the action being taken
	 * @returns PolicyResult with decision, matched rule, and explanation
	 */
	async evaluate(context: PolicyContext): Promise<PolicyResult> {
		const startTime = Date.now();

		// 1. Check cache
		const key = this.cacheKey(context);
		const cached = this.cache.get(key);
		if (cached && Date.now() - cached.cachedAt < this.config.cacheTtlMs) {
			return cached.result;
		}

		// 2. Load enabled rules from store
		const allRules = await this.ruleStore.listRules({ enabled: true });

		// 3. Filter to matching rules (by action glob + context conditions)
		const matchingRules = this.findMatchingRules(allRules, context);

		// 4. Sort by priority (highest first)
		const sorted = this.sortByPriority(matchingRules);

		// 5. Determine result
		let result: PolicyResult;

		if (sorted.length === 0) {
			// No matching rule → default deny
			result = {
				decision: this.getDefaultDecision(),
				matchedRule: null,
				allEvaluatedRules: [],
				explanation: `No policy rule matched action "${context.action}". Defaulting to deny (fail-safe).`,
				evaluatedAt: new Date().toISOString(),
				durationMs: Date.now() - startTime,
			};
		} else {
			// Return the highest-priority matching rule
			const matchedRule = sorted[0];
			const evaluatedRules = sorted.map((r) => ({
				rule: r,
				matched: r.id === matchedRule.id,
				reason:
					r.id === matchedRule.id
						? `Rule "${r.name}" (priority ${r.priority}) matched with decision "${r.decision}"`
						: `Lower priority rule (${r.priority}) superseded by higher priority rule`,
			}));

			result = {
				decision: matchedRule.decision,
				matchedRule,
				allEvaluatedRules: evaluatedRules,
				explanation: this.explainDecision(matchedRule, context),
				evaluatedAt: new Date().toISOString(),
				durationMs: Date.now() - startTime,
			};
		}

		// 6. Cache the result
		this.setCacheEntry(key, result);

		return result;
	}

	/**
	 * Evaluate a single action and log the decision to the audit ledger.
	 *
	 * @param context - The policy context describing the action
	 * @param auditLedger - The audit ledger instance
	 * @returns PolicyResult plus the generated audit entry
	 */
	async evaluateWithAudit(
		context: PolicyContext,
		auditLedger: { append(entry: AuditEntry): Promise<void> },
	): Promise<PolicyResult & { auditEntry: AuditEntry }> {
		const result = await this.evaluate(context);

		const auditEntry: AuditEntry = {
			id: randomUUID(),
			timestamp: result.evaluatedAt,
			actor: context.actor,
			action: context.action,
			decision: result.decision,
			policyRuleId: result.matchedRule?.id,
			policyRuleName: result.matchedRule?.name,
			proposalId: context.proposalId,
			planExecId: context.planExecId,
			memoryId: context.memoryId,
			evidence: [],
			result: result.decision === "allow" ? "success" : "blocked",
			durationMs: result.durationMs,
			context: {
				autonomyLevel: context.autonomyLevel,
				riskLevel: context.riskLevel,
			},
			metadata: context.metadata,
		};

		await auditLedger.append(auditEntry);

		return { ...result, auditEntry };
	}

	// -----------------------------------------------------------------------
	// Convenience Methods
	// -----------------------------------------------------------------------

	/**
	 * Check whether an action can be auto-executed without approval.
	 *
	 * Returns true only if the policy decision is "allow".
	 */
	async canAutoExecute(context: PolicyContext): Promise<boolean> {
		const result = await this.evaluate(context);
		return result.decision === "allow";
	}

	/**
	 * Check whether an action requires user approval.
	 *
	 * Returns true if the policy decision is "approval_required".
	 */
	async requiresApproval(context: PolicyContext): Promise<boolean> {
		const result = await this.evaluate(context);
		return result.decision === "approval_required";
	}

	/**
	 * Check whether an action is forbidden.
	 *
	 * Returns true if the policy decision is "forbidden".
	 */
	async isForbidden(context: PolicyContext): Promise<boolean> {
		const result = await this.evaluate(context);
		return result.decision === "forbidden";
	}

	// -----------------------------------------------------------------------
	// Explanation
	// -----------------------------------------------------------------------

	/**
	 * Generate a human-readable explanation for a policy result.
	 */
	explain(result: PolicyResult): string {
		if (result.matchedRule) {
			return `Policy rule "${result.matchedRule.name}" (id: ${result.matchedRule.id}, priority: ${result.matchedRule.priority}) evaluated action with decision: ${result.decision}. ${result.matchedRule.description}`;
		}
		return `No matching policy rule found. Default decision: ${result.decision}.`;
	}

	/**
	 * Generate a simple one-line explanation for a decision.
	 */
	explainSimple(decision: PolicyDecision, rule: PolicyRule | null): string {
		if (rule) {
			return `[${decision.toUpperCase()}] ${rule.name}: ${rule.description}`;
		}
		return `[${decision.toUpperCase()}] Default decision (no matching rule)`;
	}

	// -----------------------------------------------------------------------
	// Cache Management
	// -----------------------------------------------------------------------

	/**
	 * Clear all cached policy decisions.
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Invalidate cached decisions for a specific action.
	 */
	invalidateForAction(action: string): void {
		for (const [key] of this.cache) {
			if (key.startsWith(`${action}::`)) {
				this.cache.delete(key);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Private: Matching & Evaluation
	// -----------------------------------------------------------------------

	/**
	 * Filter rules to only those that match the given context.
	 *
	 * A rule matches if:
	 * 1. The action pattern (glob) matches the context action
	 * 2. All condition fields (autonomy level, risk level, etc.) match
	 */
	private findMatchingRules(rules: PolicyRule[], context: PolicyContext): PolicyRule[] {
		return rules.filter((rule) => {
			if (!rule.enabled) return false;
			return this.evaluateCondition(rule.condition, context);
		});
	}

	/**
	 * Evaluate a single policy condition against the action context.
	 *
	 * Checks:
	 * - Action name matches (glob pattern)
	 * - Action type matches (if specified)
	 * - Autonomy level is within range (if specified)
	 * - Risk level matches (if specified)
	 * - Affected area matches (if specified)
	 * - Context match conditions (if specified)
	 * - Time restrictions (if specified)
	 */
	private evaluateCondition(condition: PolicyCondition, context: PolicyContext): boolean {
		// 1. Action name match (supports glob patterns)
		if (!this.matchGlob(condition.action, context.action)) {
			return false;
		}

		// 2. Action type match
		if (condition.actionType !== undefined && condition.actionType !== context.actionType) {
			return false;
		}

		// 3. Autonomy level range
		if (condition.minAutonomyLevel !== undefined) {
			if (context.autonomyLevel < condition.minAutonomyLevel) {
				return false;
			}
		}
		if (condition.maxAutonomyLevel !== undefined) {
			if (context.autonomyLevel > condition.maxAutonomyLevel) {
				return false;
			}
		}

		// 4. Risk level match
		if (condition.riskLevel !== undefined) {
			if (context.riskLevel === undefined) {
				return false;
			}
			const allowedLevels = Array.isArray(condition.riskLevel) ? condition.riskLevel : [condition.riskLevel];
			if (!allowedLevels.includes(context.riskLevel)) {
				return false;
			}
		}

		// 5. Affected area match
		if (condition.affectedArea !== undefined) {
			if (context.affectedSystem !== condition.affectedArea) {
				return false;
			}
		}

		// 6. Context match conditions
		if (condition.contextMatch !== undefined) {
			for (const [key, value] of Object.entries(condition.contextMatch)) {
				const ctxVal = context.metadata[key];
				if (ctxVal !== value) {
					return false;
				}
			}
		}

		// 7. Time restrictions
		if (condition.timeRestriction !== undefined) {
			if (!this.evaluateTimeRestriction(condition.timeRestriction)) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Match a glob pattern against a value.
	 *
	 * Supports:
	 * - Exact match: "memory_query" matches "memory_query"
	 * - Wildcard suffix: "memory_*" matches "memory_creation", "memory_query"
	 * - Wildcard prefix: "*_query" matches "memory_query", "plan_query"
	 * - Full wildcard: "*" matches everything
	 */
	private matchGlob(pattern: string, value: string): boolean {
		// Fast path: exact match
		if (pattern === value) return true;

		// Full wildcard
		if (pattern === "*") return true;

		// Convert glob pattern to regex
		const regexStr =
			"^" +
			pattern
				.replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
				.replace(/\*/g, ".*") // wildcard → regex .*
				.replace(/\?/g, ".") + // single char wildcard → regex .
			"$";

		try {
			return new RegExp(regexStr).test(value);
		} catch {
			// Invalid pattern, fall back to exact match
			return pattern === value;
		}
	}

	/**
	 * Evaluate time-based restrictions on a rule.
	 *
	 * If the current time falls within the restricted window and
	 * the rule's timeRestriction specifies it, the rule matches.
	 *
	 * If no timeRestriction is set, the condition is always satisfied.
	 */
	private evaluateTimeRestriction(restriction: NonNullable<PolicyCondition["timeRestriction"]>): boolean {
		const now = new Date();
		const currentMinutes = now.getHours() * 60 + now.getMinutes();

		// Parse start/end as HH:mm
		const [startH, startM] = restriction.start.split(":").map(Number);
		const [endH, endM] = restriction.end.split(":").map(Number);

		if (Number.isNaN(startH) || Number.isNaN(startM) || Number.isNaN(endH) || Number.isNaN(endM)) {
			return false; // Invalid time format, skip
		}

		const startMinutes = startH * 60 + startM;
		const endMinutes = endH * 60 + endM;

		if (startMinutes <= endMinutes) {
			// Normal range (e.g., 09:00–17:00)
			return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
		}
		// Overnight range (e.g., 22:00–06:00)
		return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
	}

	/**
	 * Sort rules by priority descending (highest first).
	 */
	private sortByPriority(rules: PolicyRule[]): PolicyRule[] {
		return [...rules].sort((a, b) => b.priority - a.priority);
	}

	// -----------------------------------------------------------------------
	// Private: Defaults
	// -----------------------------------------------------------------------

	/**
	 * Get the default policy decision when no rule matches.
	 *
	 * Fail-safe: returns "deny" so that unmatched actions are blocked.
	 */
	private getDefaultDecision(): PolicyDecision {
		return "deny";
	}

	// -----------------------------------------------------------------------
	// Private: Explanation
	// -----------------------------------------------------------------------

	/**
	 * Generate a human-readable explanation for why a rule matched.
	 */
	private explainDecision(rule: PolicyRule, context: PolicyContext): string {
		const parts: string[] = [
			`Rule "${rule.name}" matched action "${context.action}" with decision "${rule.decision}".`,
		];

		if (rule.description) {
			parts.push(rule.description);
		}

		if (context.autonomyLevel !== undefined) {
			parts.push(`Autonomy level: ${context.autonomyLevel}.`);
		}

		if (context.riskLevel) {
			parts.push(`Risk level: ${context.riskLevel}.`);
		}

		return parts.join(" ");
	}

	// -----------------------------------------------------------------------
	// Private: Cache
	// -----------------------------------------------------------------------

	/**
	 * Generate a cache key from the context.
	 *
	 * The key includes: action, actionType, actor, autonomyLevel,
	 * riskLevel, and affectedSystem — but not transient fields like
	 * proposalId or metadata.
	 */
	private cacheKey(context: PolicyContext): string {
		const parts = [
			context.action,
			context.actionType ?? "",
			context.actor,
			String(context.autonomyLevel),
			context.riskLevel ?? "",
			context.affectedSystem ?? "",
		];
		return parts.join("::");
	}

	/**
	 * Store a result in the cache, evicting oldest entries if at capacity.
	 */
	private setCacheEntry(key: string, result: PolicyResult): void {
		// Evict oldest entries if at capacity
		if (this.cache.size >= this.config.maxCacheSize) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey !== undefined) {
				this.cache.delete(oldestKey);
			}
		}

		this.cache.set(key, {
			result,
			cachedAt: Date.now(),
		});
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a PolicyEngine instance.
 *
 * @param ruleStore - Initialized RuleStore instance
 * @param config - Optional configuration overrides
 * @returns PolicyEngine instance
 */
export function createPolicyEngine(ruleStore: RuleStore, config?: Partial<PolicyEngineConfig>): PolicyEngine {
	return new PolicyEngine(ruleStore, config);
}
