/**
 * P45.S7 — Drift Budget Gate and Drift Metrics
 *
 * Tracks spec drift consumption across assembly execution.
 * The drift budget is a finite resource: each detected drift event
 * consumes budget. When the budget is exhausted, the assembly is
 * placed on hold until the budget is replenished (via replay, human
 * review, or plan amendment).
 *
 * Budget is defined per-wave and per-assembly-run:
 * - maxDriftEvents: maximum drift events before hold
 * - maxBreakingDriftEvents: maximum breaking drifts before hard stop
 * - driftBudgetRefillPolicy: how budget is replenished
 */

// =============================================================================
// Types
// =============================================================================

export type DriftKind = "compatible" | "breaking";

export interface DriftEvent {
	/** Unique event identifier. */
	id: string;
	/** Kind of drift. */
	kind: DriftKind;
	/** The contract that drifted. */
	contract: string;
	/** Namespace where drift was detected. */
	namespace: string;
	/** ISO timestamp. */
	detectedAt: string;
	/** Version of the spec at the time of detection. */
	specVersion: string;
	/** Whether this drift was resolved via replay. */
	resolved: boolean;
	/** Human-readable description. */
	description: string;
}

export interface DriftBudget {
	/** Total drift events allowed in this run. */
	maxDriftEvents: number;
	/** Maximum breaking drift events before hard stop. */
	maxBreakingDriftEvents: number;
	/** Total drift events consumed so far. */
	consumedDrift: number;
	/** Breaking drift events consumed so far. */
	consumedBreakingDrift: number;
	/** Remaining drift budget. */
	remainingDrift: number;
	/** Remaining breaking drift budget. */
	remainingBreakingDrift: number;
	/** Whether the total drift budget is exhausted. */
	budgetExhausted: boolean;
	/** Whether the breaking drift budget is exhausted (hard stop). */
	hardStopRequired: boolean;
}

export interface DriftBudgetGateVerdict {
	/** Whether execution can continue. */
	canContinue: boolean;
	/** Whether a hold is recommended. */
	holdRecommended: boolean;
	/** Whether a hard stop is required. */
	hardStop: boolean;
	/** Current budget state. */
	budget: DriftBudget;
	/** Blocking reasons if execution cannot continue. */
	blockingReasons: string[];
	/** Drift events recorded. */
	events: DriftEvent[];
}

export interface DriftBudgetConfig {
	/** Maximum total drift events (default: 20). */
	maxDriftEvents: number;
	/** Maximum breaking drift events (default: 5). */
	maxBreakingDriftEvents: number;
	/** Whether a hold is recommended when budget is at 50%. */
	holdAtHalfBudget: boolean;
}

// =============================================================================
// Default Config
// =============================================================================

export const DEFAULT_DRIFT_BUDGET_CONFIG: DriftBudgetConfig = {
	maxDriftEvents: 20,
	maxBreakingDriftEvents: 5,
	holdAtHalfBudget: true,
};

// =============================================================================
// Drift Budget Gate
// =============================================================================

export class DriftBudgetGate {
	private events: DriftEvent[] = [];
	private config: DriftBudgetConfig;

	constructor(config: DriftBudgetConfig = DEFAULT_DRIFT_BUDGET_CONFIG) {
		this.config = config;
	}

	/**
	 * Record a drift event.
	 */
	recordDrift(event: Omit<DriftEvent, "id" | "resolved">): DriftEvent {
		const fullEvent: DriftEvent = {
			...event,
			id: `drift-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			resolved: false,
		};
		this.events.push(fullEvent);
		return fullEvent;
	}

	/**
	 * Mark a drift event as resolved (e.g., via replay).
	 */
	resolveDrift(id: string): boolean {
		const event = this.events.find((e) => e.id === id);
		if (!event) return false;
		event.resolved = true;
		return true;
	}

	/**
	 * Get current budget state.
	 */
	getBudget(): DriftBudget {
		const unresolved = this.events.filter((e) => !e.resolved);
		const consumedDrift = unresolved.length;
		const consumedBreakingDrift = unresolved.filter((e) => e.kind === "breaking").length;

		const remainingDrift = Math.max(0, this.config.maxDriftEvents - consumedDrift);
		const remainingBreakingDrift = Math.max(0, this.config.maxBreakingDriftEvents - consumedBreakingDrift);

		return {
			maxDriftEvents: this.config.maxDriftEvents,
			maxBreakingDriftEvents: this.config.maxBreakingDriftEvents,
			consumedDrift,
			consumedBreakingDrift,
			remainingDrift,
			remainingBreakingDrift,
			budgetExhausted: consumedDrift >= this.config.maxDriftEvents,
			hardStopRequired: consumedBreakingDrift >= this.config.maxBreakingDriftEvents,
		};
	}

	/**
	 * Evaluate whether execution can continue given current drift budget.
	 */
	evaluate(): DriftBudgetGateVerdict {
		const budget = this.getBudget();
		const blockingReasons: string[] = [];

		// Hard stop: breaking drift budget exhausted
		if (budget.hardStopRequired) {
			blockingReasons.push(
				`Breaking drift budget exhausted: ${budget.consumedBreakingDrift}/${this.config.maxBreakingDriftEvents} breaking events`,
			);
		}

		// Soft block: total drift budget exhausted
		if (budget.budgetExhausted) {
			blockingReasons.push(`Drift budget exhausted: ${budget.consumedDrift}/${this.config.maxDriftEvents} events`);
		}

		// Hold recommendation: budget at 50%
		const holdRecommended =
			this.config.holdAtHalfBudget &&
			!budget.budgetExhausted &&
			!budget.hardStopRequired &&
			budget.consumedDrift >= this.config.maxDriftEvents * 0.5;

		const hardStop = budget.hardStopRequired;
		const canContinue = !hardStop;

		return {
			canContinue,
			holdRecommended,
			hardStop,
			budget,
			blockingReasons,
			events: [...this.events],
		};
	}

	/**
	 * Get unresolved drift events.
	 */
	getUnresolvedDrifts(): DriftEvent[] {
		return this.events.filter((e) => !e.resolved);
	}

	/**
	 * Clear all drift events (new run or replan).
	 */
	clear(): void {
		this.events = [];
	}
}
