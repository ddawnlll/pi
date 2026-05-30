/**
 * Retry Budget Manager — P38.LEAD
 *
 * Tracks failure signatures across retries and enforces budget limits.
 * Prevents the same failure signature from retrying indefinitely.
 *
 * The budget manager is in-memory but is designed to be serializable
 * to state store journal entries for crash recovery.
 */

import type { FailureSignature, RetryBudgetPolicy } from "./types.js";
import { DEFAULT_RETRY_BUDGET_POLICY } from "./types.js";

// ---------------------------------------------------------------------------
// Budget state
// ---------------------------------------------------------------------------

/**
 * Active budget entry for a failure signature on a workspace.
 */
interface BudgetEntry {
	/** Composite key: planExecId + workspaceId + signature */
	key: string;
	/** The failure signature */
	signature: FailureSignature;
	/** Total occurrences observed */
	occurrenceCount: number;
	/** How many lead directives have been issued */
	directivesIssued: number;
	/** Whether the lead has escalated to user */
	escalated: boolean;
	/** When this entry was created (epoch ms) */
	createdAt: number;
	/** When this entry was last updated (epoch ms) */
	updatedAt: number;
}

// ---------------------------------------------------------------------------
// Budget decision
// ---------------------------------------------------------------------------

/**
 * Possible retry budget decisions.
 */
export type RetryBudgetDecision = "allow_retry" | "require_lead_review" | "escalate_user" | "blocked_escalated";

/**
 * Result of checking the retry budget.
 */
export interface RetryBudgetResult {
	/** The budget decision */
	decision: RetryBudgetDecision;
	/** Remaining retries before requiring lead review */
	retriesBeforeLeadReview: number;
	/** Remaining retries before user escalation */
	retriesBeforeEscalation: number;
	/** Total occurrences of this signature */
	occurrenceCount: number;
	/** Whether a directive has been issued */
	hasDirective: boolean;
}

// ---------------------------------------------------------------------------
// Retry Budget Manager
// ---------------------------------------------------------------------------

export class RetryBudgetManager {
	private entries: Map<string, BudgetEntry> = new Map();
	private policy: RetryBudgetPolicy;

	constructor(policy: RetryBudgetPolicy = DEFAULT_RETRY_BUDGET_POLICY) {
		this.policy = policy;
	}

	/**
	 * Record a failure occurrence and get a budget decision.
	 *
	 * @param signature - The failure signature
	 * @param hasActiveDirective - Whether a lead directive is currently active for this workspace
	 * @returns Budget result with decision
	 */
	recordFailure(signature: FailureSignature, hasActiveDirective: boolean): RetryBudgetResult {
		const key = this.makeKey(signature);
		let entry = this.entries.get(key);

		if (!entry) {
			entry = {
				key,
				signature,
				occurrenceCount: 1,
				directivesIssued: 0,
				escalated: false,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			};
		} else {
			entry = {
				...entry,
				signature,
				occurrenceCount: entry.occurrenceCount + 1,
				updatedAt: Date.now(),
			};
		}
		this.entries.set(key, entry);

		// Already escalated — no more retries
		if (entry.escalated) {
			return {
				decision: "blocked_escalated",
				retriesBeforeLeadReview: 0,
				retriesBeforeEscalation: 0,
				occurrenceCount: entry.occurrenceCount,
				hasDirective: entry.directivesIssued > 0,
			};
		}

		// Check if escalation is needed
		if (entry.occurrenceCount >= this.policy.sameFailureSignatureMaxTotalRetriesBeforeUserEscalation) {
			return {
				decision: "escalate_user",
				retriesBeforeLeadReview: 0,
				retriesBeforeEscalation: 0,
				occurrenceCount: entry.occurrenceCount,
				hasDirective: entry.directivesIssued > 0,
			};
		}

		// If directive is active, use the post-directive threshold
		if (hasActiveDirective) {
			if (entry.occurrenceCount > this.policy.sameFailureSignatureMaxRetriesAfterLeadDirective) {
				return {
					decision: "escalate_user",
					retriesBeforeLeadReview: 0,
					retriesBeforeEscalation: 0,
					occurrenceCount: entry.occurrenceCount,
					hasDirective: true,
				};
			}
			return {
				decision: "require_lead_review",
				retriesBeforeLeadReview: 0,
				retriesBeforeEscalation:
					this.policy.sameFailureSignatureMaxTotalRetriesBeforeUserEscalation - entry.occurrenceCount,
				occurrenceCount: entry.occurrenceCount,
				hasDirective: true,
			};
		}

		// First check: does this need lead review?
		if (entry.occurrenceCount >= this.policy.sameFailureSignatureMaxRetriesBeforeLeadReview) {
			return {
				decision: "require_lead_review",
				retriesBeforeLeadReview: 0,
				retriesBeforeEscalation:
					this.policy.sameFailureSignatureMaxTotalRetriesBeforeUserEscalation - entry.occurrenceCount,
				occurrenceCount: entry.occurrenceCount,
				hasDirective: false,
			};
		}

		// Allowed
		return {
			decision: "allow_retry",
			retriesBeforeLeadReview: this.policy.sameFailureSignatureMaxRetriesBeforeLeadReview - entry.occurrenceCount,
			retriesBeforeEscalation:
				this.policy.sameFailureSignatureMaxTotalRetriesBeforeUserEscalation - entry.occurrenceCount,
			occurrenceCount: entry.occurrenceCount,
			hasDirective: false,
		};
	}

	/**
	 * Mark that a directive has been issued for a signature.
	 */
	markDirectiveIssued(signature: FailureSignature): void {
		const key = this.makeKey(signature);
		const entry = this.entries.get(key);
		if (entry) {
			this.entries.set(key, {
				...entry,
				directivesIssued: entry.directivesIssued + 1,
				updatedAt: Date.now(),
			});
		}
	}

	/**
	 * Mark that a user escalation has been created for a signature.
	 */
	markEscalated(signature: FailureSignature): void {
		const key = this.makeKey(signature);
		const entry = this.entries.get(key);
		if (entry) {
			this.entries.set(key, {
				...entry,
				escalated: true,
				updatedAt: Date.now(),
			});
		}
	}

	/**
	 * Clear budget entries for a workspace (e.g., after workspace completes).
	 */
	clearWorkspace(planExecId: string, workspaceId: string): void {
		const prefix = `${planExecId}:${workspaceId}:`;
		for (const key of Array.from(this.entries.keys())) {
			if (key.startsWith(prefix)) {
				this.entries.delete(key);
			}
		}
	}

	/**
	 * Clear budget entries for an entire plan.
	 */
	clearPlan(planExecId: string): void {
		const prefix = `${planExecId}:`;
		for (const key of Array.from(this.entries.keys())) {
			if (key.startsWith(prefix)) {
				this.entries.delete(key);
			}
		}
	}

	/**
	 * Clear all budget entries.
	 */
	clear(): void {
		this.entries.clear();
	}

	/**
	 * Get the current retry budget policy.
	 */
	getPolicy(): RetryBudgetPolicy {
		return { ...this.policy };
	}

	/**
	 * Get budget entries for a workspace.
	 */
	getBudgetSummary(
		planExecId: string,
		workspaceId: string,
	): Array<{
		signature: string;
		occurrenceCount: number;
		directivesIssued: number;
		escalated: boolean;
	}> {
		const prefix = `${planExecId}:${workspaceId}:`;
		const result: Array<{
			signature: string;
			occurrenceCount: number;
			directivesIssued: number;
			escalated: boolean;
		}> = [];
		for (const [key, entry] of this.entries) {
			if (key.startsWith(prefix)) {
				result.push({
					signature: entry.signature.signature,
					occurrenceCount: entry.occurrenceCount,
					directivesIssued: entry.directivesIssued,
					escalated: entry.escalated,
				});
			}
		}
		return result;
	}

	/**
	 * Get all budget entries (for reporting).
	 */
	getAllEntries(): ReadonlyMap<string, BudgetEntry> {
		return this.entries;
	}

	private makeKey(signature: FailureSignature): string {
		return `${signature.planExecId}:${signature.workspaceId}:${signature.signature}`;
	}
}
