/**
 * P45.15 — Dashboard, Doctor, Operator Visibility, and ACCP Assembly Views
 *
 * Provides operator-facing visibility into the P45 async assembly runtime:
 * - Real-time governor status
 * - Spec quality metrics
 * - Conflict matrix visualization data
 * - Assembly journal viewer
 * - Drift budget consumption
 */

import type { GovernorVerdict } from "./adaptive-concurrency-governor.js";
import type { ConflictMatrix } from "./semantic-conflict-analyzer.js";
import type { SpecQualityMetrics } from "./spec-quality-ledger.js";
import type { TrendAnalysis } from "./spec-quality-history.js";
import type { DriftBudget } from "./drift-budget-gate.js";
import type { RetryState } from "./failure-retry-policy.js";
import type { ConcurrencyTier } from "./progressive-parallelism-ramp.js";

// =============================================================================
// Types
// =============================================================================

export interface OperatorDashboard {
	schemaVersion: string;
	generatedAt: string;
	governor: {
		signal: string;
		canAdmit: boolean;
		recommendedWorkers: number;
		sourceStatus: Record<string, { signal: string; detail: string }>;
	};
	specQuality: {
		metrics: SpecQualityMetrics | null;
		trend: string;
		riskScore: number;
	} | null;
	conflicts: {
		totalConflicts: number;
		unresolved: number;
		hasBlocking: boolean;
		riskScore: number;
	};
	driftBudget: {
		consumedDrift: number;
		remainingDrift: number;
		budgetExhausted: boolean;
		hardStop: boolean;
	} | null;
	retries: {
		totalRetries: number;
		exhausted: boolean;
	};
	concurrency: {
		currentTier: ConcurrencyTier;
		currentMaxWorkers: number;
		stableRunCount: number;
	};
}

// =============================================================================
// Dashboard Builder
// =============================================================================

export function buildOperatorDashboard(params: {
	governor?: GovernorVerdict;
	specQuality?: { metrics: SpecQualityMetrics | null; trend: TrendAnalysis };
	conflicts?: ConflictMatrix;
	driftBudget?: DriftBudget;
	retries?: RetryState;
	concurrency?: { currentTier: ConcurrencyTier; currentMaxWorkers: number; stableRunCount: number };
}): OperatorDashboard {
	return {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		governor: params.governor
			? {
					signal: params.governor.signal,
					canAdmit: params.governor.canAdmit,
					recommendedWorkers: params.governor.recommendedWorkers,
					sourceStatus: Object.fromEntries(
						Object.entries(params.governor.sourceStatus).map(([k, v]) => [
							k,
							{ signal: v.signal, detail: v.detail },
						]),
					),
				}
			: { signal: "unknown", canAdmit: false, recommendedWorkers: 0, sourceStatus: {} },
		specQuality: params.specQuality
			? {
					metrics: params.specQuality.metrics,
					trend: params.specQuality.trend.direction,
					riskScore: params.specQuality.trend.riskScore,
				}
			: null,
		conflicts: params.conflicts
			? {
					totalConflicts: params.conflicts.totalConflicts,
					unresolved: params.conflicts.unresolvedConflicts,
					hasBlocking: params.conflicts.hasBlockingConflicts,
					riskScore: params.conflicts.asyncRiskScore,
				}
			: { totalConflicts: 0, unresolved: 0, hasBlocking: false, riskScore: 0 },
		driftBudget: params.driftBudget
			? {
					consumedDrift: params.driftBudget.consumedDrift,
					remainingDrift: params.driftBudget.remainingDrift,
					budgetExhausted: params.driftBudget.budgetExhausted,
					hardStop: params.driftBudget.hardStopRequired,
				}
			: null,
		retries: params.retries
			? {
					totalRetries: params.retries.totalRetries,
					exhausted: params.retries.retriesExhausted,
				}
			: { totalRetries: 0, exhausted: false },
		concurrency: params.concurrency
			? {
					currentTier: params.concurrency.currentTier,
					currentMaxWorkers: params.concurrency.currentMaxWorkers,
					stableRunCount: params.concurrency.stableRunCount,
				}
			: { currentTier: "stable_6", currentMaxWorkers: 6, stableRunCount: 0 },
	};
}

/**
 * Compute overall assembly health score (0-1, 1=healthy).
 */
export function computeAssemblyHealth(dashboard: OperatorDashboard): number {
	let score = 1.0;

	// Governor red = penalty
	if (dashboard.governor.signal === "red") score -= 0.5;
	else if (dashboard.governor.signal === "yellow") score -= 0.2;

	// Conflicts with blocking = penalty
	if (dashboard.conflicts.hasBlocking) score -= 0.3;

	// Drift budget exhausted
	if (dashboard.driftBudget?.hardStop) score -= 0.5;
	else if (dashboard.driftBudget?.budgetExhausted) score -= 0.3;

	// Retries exhausted
	if (dashboard.retries.exhausted) score -= 0.2;

	// Spec quality risk
	const riskScore = dashboard.specQuality?.riskScore ?? 0;
	score -= riskScore * 0.3;

	return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}
