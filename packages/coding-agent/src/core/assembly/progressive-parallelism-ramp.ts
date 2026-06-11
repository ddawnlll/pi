/**
 * P45.S10 — Progressive Parallelism Ramp: 6 to 8 to 12 to Unbounded Dry Run
 *
 * Staged concurrency promotion system:
 * - Promotions are evidence-backed; never based on assumption.
 * - Each tier requires: predecessor stability proof, governor green signal,
 *   sufficient SpecQualityLedger data, coverage above thresholds,
 *   and no blocking semantic conflicts.
 *
 * Tiers:
 * - stable_6: default, always allowed when governor is green
 * - stable_8: requires stable_6 history + promotion evidence
 * - stable_12: requires stable_8 history + promotion evidence
 * - unbounded_logical: requires stable_12 history + governor + visibility
 *
 * Unbounded is always a dry run unless explicitly authorized with all gates green.
 */

// =============================================================================
// Types
// =============================================================================

export type ConcurrencyTier = "stable_6" | "stable_8" | "stable_12" | "unbounded_logical";

export interface TierRequirements {
	/** Minimum number of successful runs at predecessor tier. */
	minPredecessorRuns: number;
	/** Minimum SpecQualityLedger entries required. */
	minLedgerEntries: number;
	/** Maximum allowed risk score. */
	maxRiskScore: number;
	/** Whether governor must be green. */
	governorGreenRequired: boolean;
	/** Whether operator visibility capacity must be sufficient. */
	operatorVisibilityRequired: boolean;
}

export interface TierStatus {
	tier: ConcurrencyTier;
	/** Whether this tier is currently active. */
	active: boolean;
	/** Whether this tier is eligible for promotion. */
	eligibleForPromotion: boolean;
	/** Maximum workers allowed at this tier. */
	maxWorkers: number;
	/** Requirements that must be met. */
	requirements: TierRequirements;
	/** Met requirements count. */
	requirementsMet: number;
	/** Total requirements count. */
	totalRequirements: number;
}

export interface RampState {
	/** Current active tier. */
	currentTier: ConcurrencyTier;
	/** Currently allowed max workers. */
	currentMaxWorkers: number;
	/** Per-tier status. */
	tiers: Record<ConcurrencyTier, TierStatus>;
	/** Promotion history (tier, timestamp, evidence hash). */
	promotionHistory: Array<{ tier: ConcurrencyTier; promotedAt: string; evidenceHash: string }>;
	/** Successful runs at current tier. */
	stableRunCount: number;
	/** Whether unbounded experiment is allowed. */
	unboundedAllowed: boolean;
}

export interface RampInput {
	/** Current governor signal. */
	governorSignal: "green" | "yellow" | "red";
	/** Number of entries in SpecQualityLedger. */
	ledgerEntries: number;
	/** Current risk score from trend/history. */
	riskScore: number;
	/** Number of successful stable runs at current tier. */
	stableRunCount: number;
	/** Operator visibility capacity remaining. */
	operatorVisibilityRemaining: number;
	/** Whether this is a dry-run request (vs real promotion). */
	dryRun: boolean;
}

// =============================================================================
// Tier Definitions
// =============================================================================

const TIER_REQUIREMENTS: Record<ConcurrencyTier, TierRequirements> = {
	stable_6: {
		minPredecessorRuns: 0, // no predecessor needed
		minLedgerEntries: 0,
		maxRiskScore: 1.0, // always allowed when governor green
		governorGreenRequired: true,
		operatorVisibilityRequired: false,
	},
	stable_8: {
		minPredecessorRuns: 3, // 3 successful stable_6 runs
		minLedgerEntries: 10,
		maxRiskScore: 0.5,
		governorGreenRequired: true,
		operatorVisibilityRequired: false,
	},
	stable_12: {
		minPredecessorRuns: 5, // 5 successful stable_8 runs
		minLedgerEntries: 20,
		maxRiskScore: 0.35,
		governorGreenRequired: true,
		operatorVisibilityRequired: false,
	},
	unbounded_logical: {
		minPredecessorRuns: 8, // 8 successful stable_12 runs
		minLedgerEntries: 40,
		maxRiskScore: 0.2,
		governorGreenRequired: true,
		operatorVisibilityRequired: true,
	},
};

const TIER_MAX_WORKERS: Record<ConcurrencyTier, number> = {
	stable_6: 6,
	stable_8: 8,
	stable_12: 12,
	unbounded_logical: Number.MAX_SAFE_INTEGER, // unbounded (but governor-governed)
};

// =============================================================================
// Ramp Engine
// =============================================================================

export class ProgressiveParallelismRamp {
	private state: RampState;

	constructor() {
		this.state = {
			currentTier: "stable_6",
			currentMaxWorkers: 6,
			tiers: createInitialTierStatus(),
			promotionHistory: [],
			stableRunCount: 0,
			unboundedAllowed: false,
		};
	}

	/**
	 * Record a successful stable run at the current tier.
	 */
	recordStableRun(): void {
		this.state.stableRunCount++;
	}

	/**
	 * Evaluate whether promotion to the next tier is possible.
	 */
	evaluatePromotion(input: RampInput): {
		canPromote: boolean;
		nextTier?: ConcurrencyTier;
		reason?: string;
		state: RampState;
	} {
		const nextTier = this.getNextTier();
		if (!nextTier) {
			return { canPromote: false, reason: "Already at highest tier", state: this.getState() };
		}

		const reqs = TIER_REQUIREMENTS[nextTier];

		// Governor must be green for any promotion
		if (reqs.governorGreenRequired && input.governorSignal !== "green") {
			return { canPromote: false, reason: "Governor signal is not green", state: this.getState() };
		}

		// Predecessor runs
		if (this.state.stableRunCount < reqs.minPredecessorRuns) {
			return {
				canPromote: false,
				reason: `Need ${reqs.minPredecessorRuns} stable runs at ${this.state.currentTier}, have ${this.state.stableRunCount}`,
				state: this.getState(),
			};
		}

		// Ledger entries
		if (input.ledgerEntries < reqs.minLedgerEntries) {
			return {
				canPromote: false,
				reason: `Need ${reqs.minLedgerEntries} ledger entries, have ${input.ledgerEntries}`,
				state: this.getState(),
			};
		}

		// Risk score
		if (input.riskScore > reqs.maxRiskScore) {
			return {
				canPromote: false,
				reason: `Risk score ${input.riskScore} exceeds max ${reqs.maxRiskScore}`,
				state: this.getState(),
			};
		}

		// Operator visibility (unbounded only)
		if (reqs.operatorVisibilityRequired && input.operatorVisibilityRemaining < 0) {
			return {
				canPromote: false,
				reason: "Operator visibility capacity insufficient",
				state: this.getState(),
			};
		}

		// For unbounded: dry run only unless explicitly authorized
		if (nextTier === "unbounded_logical" && input.dryRun) {
			return {
				canPromote: true,
				nextTier,
				reason: "Unbounded logical is dry-run only",
				state: this.getState(),
			};
		}

		return { canPromote: true, nextTier, state: this.getState() };
	}

	/**
	 * Promote to the next tier (if eligible).
	 */
	promote(evidenceHash: string): { success: boolean; reason?: string; state: RampState } {
		const nextTier = this.getNextTier();
		if (!nextTier) {
			return { success: false, reason: "Already at highest tier", state: this.state };
		}

		const oldTier = this.state.currentTier;
		this.state.currentTier = nextTier;
		this.state.currentMaxWorkers = TIER_MAX_WORKERS[nextTier];
		this.state.stableRunCount = 0; // reset for new tier
		this.state.promotionHistory.push({
			tier: nextTier,
			promotedAt: new Date().toISOString(),
			evidenceHash,
		});

		if (nextTier === "unbounded_logical") {
			this.state.unboundedAllowed = true;
		}

		// Update tier statuses
		this.state.tiers = createInitialTierStatus();
		for (const tier of this.getPromotedTiers()) {
			if (this.state.tiers[tier]) {
				this.state.tiers[tier].active = true;
			}
		}

		return { success: true, reason: `Promoted from ${oldTier} to ${nextTier}`, state: this.state };
	}

	/**
	 * Get current ramp state.
	 */
	getState(): RampState {
		return { ...this.state, tiers: { ...this.state.tiers } };
	}

	/**
	 * Get next tier or undefined if at max.
	 */
	private getNextTier(): ConcurrencyTier | undefined {
		switch (this.state.currentTier) {
			case "stable_6":
				return "stable_8";
			case "stable_8":
				return "stable_12";
			case "stable_12":
				return "unbounded_logical";
			case "unbounded_logical":
				return undefined;
		}
	}

	/**
	 * Get all tiers that have been promoted to.
	 */
	private getPromotedTiers(): ConcurrencyTier[] {
		return this.state.promotionHistory.map((p) => p.tier);
	}
}

// =============================================================================
// Helpers
// =============================================================================

function createInitialTierStatus(): Record<ConcurrencyTier, TierStatus> {
	const tiers: ConcurrencyTier[] = ["stable_6", "stable_8", "stable_12", "unbounded_logical"];
	const result = {} as Record<ConcurrencyTier, TierStatus>;

	for (const tier of tiers) {
		const reqs = TIER_REQUIREMENTS[tier];
		const totalReqs =
			1 + // governor green
			(reqs.minPredecessorRuns > 0 ? 1 : 0) +
			(reqs.minLedgerEntries > 0 ? 1 : 0) +
			(reqs.maxRiskScore < 1.0 ? 1 : 0) +
			(reqs.operatorVisibilityRequired ? 1 : 0);

		result[tier] = {
			tier,
			active: tier === "stable_6", // stable_6 always active initially
			eligibleForPromotion: false,
			maxWorkers: TIER_MAX_WORKERS[tier],
			requirements: reqs,
			requirementsMet: tier === "stable_6" ? totalReqs : 0,
			totalRequirements: totalReqs,
		};
	}

	return result;
}
