/**
 * P45.S1 — Spec Quality History Store
 *
 * Persistent read-model for the Spec Quality Ledger.
 * Provides time-windowed queries, trend analysis, and risk scoring
 * for consumption by the PredictiveSpecQualityGate.
 *
 * The history store wraps the ledger and adds:
 * - Time-windowed metric snapshots
 * - Trend direction (improving, stable, degrading)
 * - Risk scoring (0-1 scale)
 * - Decay-weighted recent metrics
 */

import type {
	EvidenceClass,
	SpecOutcomeType,
	SpecQualityEntry,
	SpecQualityLedger,
	SpecQualityMetrics,
} from "./spec-quality-ledger.js";

// =============================================================================
// Types
// =============================================================================

export type TrendDirection = "improving" | "stable" | "degrading" | "insufficient_data";

export interface TimeWindowSnapshot {
	windowStart: string;
	windowEnd: string;
	entryCount: number;
	metrics: SpecQualityMetrics | null;
}

export interface TrendAnalysis {
	/** Trend direction based on comparing recent vs older windows. */
	direction: TrendDirection;
	/** Current metrics from the most recent window. */
	current: SpecQualityMetrics | null;
	/** Previous window metrics (for comparison). */
	previous: SpecQualityMetrics | null;
	/** How many data points were used. */
	sampleSize: number;
	/** Risk score: 0=perfect, 1=highest risk. Based on drift + breaking + llm_only. */
	riskScore: number;
}

export interface HistoryStoreOptions {
	/** Window size in milliseconds for time-windowed queries (default: 7 days). */
	windowMs: number;
	/** Decay factor for weighted metrics (0-1, default: 0.95). */
	decayFactor: number;
}

// =============================================================================
// History Store
// =============================================================================

export class SpecQualityHistoryStore {
	private ledger: SpecQualityLedger;
	private options: HistoryStoreOptions;

	constructor(ledger: SpecQualityLedger, options?: Partial<HistoryStoreOptions>) {
		this.ledger = ledger;
		this.options = {
			windowMs: options?.windowMs ?? 7 * 24 * 60 * 60 * 1000, // 7 days
			decayFactor: options?.decayFactor ?? 0.95,
		};
	}

	/**
	 * Get entries within a time range.
	 */
	getEntriesInRange(startIso: string, endIso: string): SpecQualityEntry[] {
		const start = new Date(startIso).getTime();
		const end = new Date(endIso).getTime();
		return this.ledger.getEntries().filter((e) => {
			const t = new Date(e.recordedAt).getTime();
			return t >= start && t <= end;
		});
	}

	/**
	 * Create a time-window snapshot for a given end time.
	 */
	snapshot(endIso: string): TimeWindowSnapshot {
		const end = new Date(endIso).getTime();
		const start = new Date(end - this.options.windowMs).getTime();
		const entries = this.getEntriesInRange(new Date(start).toISOString(), new Date(end).toISOString());

		const metrics = computeMetricsFromEntries(entries);
		return {
			windowStart: new Date(start).toISOString(),
			windowEnd: new Date(end).toISOString(),
			entryCount: entries.length,
			metrics,
		};
	}

	/**
	 * Analyze trend by comparing the current window with the previous window.
	 */
	analyzeTrend(endIso: string): TrendAnalysis {
		const end = new Date(endIso).getTime();
		const windowMs = this.options.windowMs;

		const current = this.snapshot(endIso);
		const previousEnd = new Date(end - windowMs).toISOString();
		const previous = this.snapshot(previousEnd);

		const direction = determineTrendDirection(current, previous);
		const riskScore = computeRiskScore(current, this.ledger.getEntries().length);

		return {
			direction,
			current: current.metrics,
			previous: previous.metrics,
			sampleSize: current.entryCount + previous.entryCount,
			riskScore,
		};
	}

	/**
	 * Check if the history store has sufficient data for reliable analysis.
	 */
	hasSufficientHistory(minEntries = 10): boolean {
		return this.ledger.isReliable(minEntries);
	}
}

// =============================================================================
// Helpers
// =============================================================================

function computeMetricsFromEntries(entries: SpecQualityEntry[]): SpecQualityMetrics | null {
	if (entries.length === 0) return null;

	const outcomeCounts: Record<SpecOutcomeType, number> = {
		matched: 0,
		compatible_drift: 0,
		breaking_drift: 0,
		missing: 0,
		unused: 0,
		overpredicted: 0,
	};

	const evidenceClassCounts: Record<EvidenceClass, number> = {
		static_confirmation: 0,
		human_approval: 0,
		historical_pattern_confirmation: 0,
		llm_only: 0,
		unknown: 0,
	};

	for (const entry of entries) {
		outcomeCounts[entry.actualOutcome]++;
		evidenceClassCounts[entry.evidenceClass]++;
	}

	const total = entries.length;
	const matched = outcomeCounts.matched;
	const compatible = outcomeCounts.compatible_drift;
	const breaking = outcomeCounts.breaking_drift;
	const missing = outcomeCounts.missing;
	const unused = outcomeCounts.unused;
	const overpredicted = outcomeCounts.overpredicted;

	const precision = matched > 0 ? matched / (matched + compatible + unused + overpredicted) : 0;
	const recallDenom = matched + breaking + missing;
	const recall = recallDenom > 0 ? matched / recallDenom : 0;
	const driftRatio = total > 0 ? (breaking + compatible) / total : 0;
	const breakingDriftRatio = total > 0 ? breaking / total : 0;
	const overpredictionRatio = total > 0 ? overpredicted / total : 0;
	const llmOnlyRatio = total > 0 ? evidenceClassCounts.llm_only / total : 0;

	return {
		totalEntries: total,
		outcomeCounts,
		evidenceClassCounts,
		precision: round3(precision),
		recall: round3(recall),
		driftRatio: round3(driftRatio),
		breakingDriftRatio: round3(breakingDriftRatio),
		overpredictionRatio: round3(overpredictionRatio),
		llmOnlyRatio: round3(llmOnlyRatio),
	};
}

function determineTrendDirection(current: TimeWindowSnapshot, previous: TimeWindowSnapshot): TrendDirection {
	if (!current.metrics || !previous.metrics) {
		if (!current.metrics && !previous.metrics) return "insufficient_data";
		// Only one window has data — insufficient for trend
		return "insufficient_data";
	}

	const c = current.metrics;
	const p = previous.metrics;

	// Compute a composite score: lower is better
	// Weight: precision and recall are good (inverted), drift and breaking are bad
	const currentScore = computeCompositeScore(c);
	const previousScore = computeCompositeScore(p);

	const delta = currentScore - previousScore; // positive = degrading
	const threshold = 0.02; // 2% change threshold

	if (Math.abs(delta) < threshold) return "stable";
	return delta > 0 ? "degrading" : "improving";
}

function computeCompositeScore(m: SpecQualityMetrics): number {
	// Higher is worse
	const precisionPenalty = 1 - m.precision;
	const recallPenalty = 1 - m.recall;
	const driftPenalty = m.driftRatio;
	const breakingPenalty = m.breakingDriftRatio * 2; // breaking is twice as bad
	const llmPenalty = m.llmOnlyRatio;

	return round3(
		precisionPenalty * 0.25 + recallPenalty * 0.2 + driftPenalty * 0.2 + breakingPenalty * 0.25 + llmPenalty * 0.1,
	);
}

function computeRiskScore(current: TimeWindowSnapshot, totalEntries: number): number {
	if (!current.metrics || totalEntries < 5) return 1.0; // Max risk with insufficient data

	const m = current.metrics;

	// Risk factors:
	// - high breaking drift
	// - high llm_only ratio
	// - low precision
	// - low recall
	// - insufficient data (< 10 entries in window)

	const breakingFactor = m.breakingDriftRatio;
	const llmFactor = m.llmOnlyRatio;
	const precisionFactor = 1 - m.precision;
	const recallFactor = 1 - m.recall;
	const dataScarcityFactor = current.entryCount < 10 ? 0.3 : 0;

	const raw =
		breakingFactor * 0.35 +
		llmFactor * 0.25 +
		precisionFactor * 0.15 +
		recallFactor * 0.1 +
		dataScarcityFactor * 0.15;

	return round3(Math.min(1.0, Math.max(0.0, raw)));
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/**
 * Create a history store from a ledger.
 */
export function createSpecQualityHistoryStore(
	ledger: SpecQualityLedger,
	options?: Partial<HistoryStoreOptions>,
): SpecQualityHistoryStore {
	return new SpecQualityHistoryStore(ledger, options);
}
