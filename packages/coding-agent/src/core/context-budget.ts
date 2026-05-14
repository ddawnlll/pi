/**
 * Context Budget Configuration - P1 Workstream 7.B
 *
 * Provides context budget configuration and enforcement to prevent
 * excessive token usage and ensure Pi is cost-efficient by default.
 */

import type { TokenRole } from "./token-metering.js";

// Re-export TokenRole for consumers that import it from this module
export type { TokenRole };

/**
 * Context budget settings for different agent roles
 */
export interface ContextBudgetSettings {
	/** Flash role budget (quick, small tasks) */
	flash: number;
	/** Worker role budget (standard tasks) */
	worker: number;
	/** Lead role budget (complex planning) */
	lead: number;
	/** Reviewer role budget (code review) */
	reviewer: number;
	/** Debug role budget (debugging sessions) */
	debug: number;
	/** Maximum automatic context (escalation threshold) */
	maxAuto: number;
	/** Whether 1M context is enabled by default */
	millionContextEnabled: boolean;
	/** CLI flag required to enable expensive 1M context */
	expensiveContextFlag: string;
}

/**
 * Default context budget values (safe defaults from P1 spec)
 */
export const DEFAULT_CONTEXT_BUDGETS: ContextBudgetSettings = {
	flash: 4000,
	worker: 12000,
	lead: 24000,
	reviewer: 16000,
	debug: 24000,
	maxAuto: 64000,
	millionContextEnabled: false,
	expensiveContextFlag: "--expensive-context-1m",
};

/**
 * Result of a budget check
 */
export interface BudgetCheckResult {
	/** Whether the budget check passed */
	passed: boolean;
	/** Estimated tokens being checked */
	estimatedTokens: number;
	/** Budget limit for the role */
	budgetLimit: number;
	/** Role being checked */
	role: TokenRole;
	/** Reason for failure (if failed) */
	reason?: string;
	/** Whether escalation is required */
	requiresEscalation: boolean;
}

/**
 * Context budget enforcer
 *
 * Enforces token budgets before provider calls to prevent
 * accidental expensive context injection.
 */
export class ContextBudgetEnforcer {
	constructor(private settings: ContextBudgetSettings = DEFAULT_CONTEXT_BUDGETS) {}

	/**
	 * Get budget limit for a specific role
	 *
	 * @param role - Token role
	 * @returns Budget limit in tokens
	 */
	getBudgetForRole(role: TokenRole): number {
		switch (role) {
			case "flash":
				return this.settings.flash;
			case "worker":
				return this.settings.worker;
			case "lead":
				return this.settings.lead;
			case "reviewer":
				return this.settings.reviewer;
			case "debug":
				return this.settings.debug;
			case "unknown":
				// Use worker budget as default for unknown roles
				return this.settings.worker;
		}
	}

	/**
	 * Check if estimated tokens are within budget for a role
	 *
	 * @param estimatedTokens - Estimated input tokens
	 * @param role - Token role
	 * @returns Budget check result
	 */
	checkBudget(estimatedTokens: number, role: TokenRole = "unknown"): BudgetCheckResult {
		const budgetLimit = this.getBudgetForRole(role);
		const requiresEscalation = estimatedTokens > this.settings.maxAuto;

		// Check maxAuto first if escalation is required and 1M context is not enabled
		if (requiresEscalation && !this.settings.millionContextEnabled) {
			return {
				passed: false,
				estimatedTokens,
				budgetLimit: this.settings.maxAuto,
				role,
				reason: `Estimated tokens (${estimatedTokens}) exceed max automatic context (${this.settings.maxAuto}). Use ${this.settings.expensiveContextFlag} to enable expensive context.`,
				requiresEscalation: true,
			};
		}

		// If we're above maxAuto and 1M context is enabled, bypass role budget check
		// The maxAuto threshold acts as the gate - once you're past it (with 1M enabled), role budgets don't apply
		if (requiresEscalation && this.settings.millionContextEnabled) {
			return {
				passed: true,
				estimatedTokens,
				budgetLimit: this.settings.maxAuto,
				role,
				requiresEscalation: true,
			};
		}

		// Special case: exactly at maxAuto is allowed (acts as upper bound for automatic context)
		if (estimatedTokens === this.settings.maxAuto) {
			return {
				passed: true,
				estimatedTokens,
				budgetLimit: this.settings.maxAuto,
				role,
				requiresEscalation: false,
			};
		}

		// For tokens below maxAuto, check role budget
		const passed = estimatedTokens <= budgetLimit;
		if (!passed) {
			return {
				passed: false,
				estimatedTokens,
				budgetLimit,
				role,
				reason: `Estimated tokens (${estimatedTokens}) exceed ${role} budget (${budgetLimit})`,
				requiresEscalation,
			};
		}

		return {
			passed: true,
			estimatedTokens,
			budgetLimit,
			role,
			requiresEscalation,
		};
	}

	/**
	 * Check if escalation is required (exceeds maxAuto)
	 *
	 * @param estimatedTokens - Estimated input tokens
	 * @returns True if escalation is required
	 */
	requiresEscalation(estimatedTokens: number): boolean {
		return estimatedTokens > this.settings.maxAuto;
	}

	/**
	 * Check if 1M context is enabled
	 *
	 * @returns True if 1M context is enabled
	 */
	isMillionContextEnabled(): boolean {
		return this.settings.millionContextEnabled;
	}

	/**
	 * Update budget settings
	 *
	 * @param settings - New budget settings (partial update)
	 */
	updateSettings(settings: Partial<ContextBudgetSettings>): void {
		this.settings = { ...this.settings, ...settings };
	}

	/**
	 * Get current budget settings
	 *
	 * @returns Current budget settings
	 */
	getSettings(): Readonly<ContextBudgetSettings> {
		return { ...this.settings };
	}
}

/**
 * Budget enforcement error
 *
 * Thrown when a request exceeds its budget and should not proceed
 */
export class BudgetExceededError extends Error {
	constructor(
		public readonly result: BudgetCheckResult,
		message?: string,
	) {
		super(message || result.reason || "Budget exceeded");
		this.name = "BudgetExceededError";
	}
}

/**
 * Create a budget enforcer from settings
 *
 * @param settings - Budget settings (uses defaults if not provided)
 * @returns Budget enforcer instance
 */
export function createBudgetEnforcer(settings?: Partial<ContextBudgetSettings>): ContextBudgetEnforcer {
	const fullSettings = settings ? { ...DEFAULT_CONTEXT_BUDGETS, ...settings } : DEFAULT_CONTEXT_BUDGETS;
	return new ContextBudgetEnforcer(fullSettings);
}
