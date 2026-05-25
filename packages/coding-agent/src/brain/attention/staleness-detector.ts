/**
 * Staleness & Momentum Detector — 24.N
 *
 * Detects when brain items (observations, signals, memory records, goals,
 * attention items) have become stale — not updated or referenced within a
 * configurable threshold — and tracks momentum (rate of change in attention
 * scores over time) to identify items gaining or losing relevance.
 *
 * Two core capabilities:
 * 1. Staleness Detection: Scans items and flags those exceeding
 *    configurable thresholds per type. Tracks historical staleness to
 *    detect items that are actively decaying (staleness increasing).
 * 2. Momentum Tracking: Records attention score snapshots and computes
 *    velocity (derivative of score over time), identifying items that
 *    are accelerating, steady, decaying, or stale.
 *
 * Integrates with the AttentionRanker to provide staleness-adjusted scores
 * and momentum signals that influence ranking priority.
 */

import type { GoalRecord } from "../goals/types.js";
import type { MemoryRecord } from "../memory/types.js";
import type { BrainObservation, BrainSignal, Severity } from "../types.js";
import type { AttentionItem } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The type of brain item that can be checked for staleness.
 */
export type StalenessCheckableType = "observation" | "signal" | "memory_record" | "goal" | "attention_item";

/**
 * Configurable staleness thresholds per item type (in days).
 *
 * Each threshold defines the number of days after which an item of that
 * type is considered fully stale (stalenessScore = maxStalenessScore).
 */
export interface StalenessThresholds {
	observation: number;
	signal: number;
	memory_record: number;
	goal: number;
	attention_item: number;
}

/**
 * Result of a staleness check for a single item.
 */
export interface StalenessResult {
	/** ID of the item checked. */
	itemId: string;
	/** The type of item checked. */
	itemType: StalenessCheckableType;
	/** Human-readable title of the item. */
	title: string;
	/** Number of days since the item was last updated/created. */
	daysSinceActivity: number;
	/** Staleness score from 0 (fresh) to 1 (maximally stale). */
	stalenessScore: number;
	/** ISO 8601 timestamp of the item's last activity. */
	lastActivityAt: string;
	/** Severity derived from staleness score. */
	severity: Severity;
	/** Whether this item is actively decaying (increasing staleness over consecutive checks). */
	isDecaying: boolean;
	/** Previous staleness score for comparison, if available. */
	previousStalenessScore?: number;
}

/**
 * Overall staleness scan result for a batch of items.
 */
export interface StalenessScanResult {
	/** Results grouped by item type. */
	byType: Partial<Record<StalenessCheckableType, StalenessResult[]>>;
	/** All results flattened and sorted by staleness score descending (most stale first). */
	sorted: StalenessResult[];
	/** ISO 8601 timestamp of the scan. */
	scannedAt: string;
	/** Total items scanned. */
	totalScanned: number;
	/** Number of items flagged as stale (stalenessScore > staleThreshold). */
	staleCount: number;
	/** Number of items actively decaying (staleness increasing). */
	decayingCount: number;
}

/**
 * A snapshot of an item's attention score at a point in time,
 * used for momentum calculations.
 */
export interface AttentionSnapshot {
	/** Item identifier. */
	itemId: string;
	/** ISO 8601 timestamp of the snapshot. */
	timestamp: string;
	/** Attention score at this point (0–1). */
	score: number;
}

/**
 * Momentum direction for an item.
 */
export type MomentumDirection = "accelerating" | "steady" | "decaying" | "stale";

/**
 * Computed momentum for a single item.
 */
export interface MomentumResult {
	/** Item identifier. */
	itemId: string;
	/** Current attention score. */
	currentScore: number;
	/** Moving average of recent attention scores. */
	averageScore: number;
	/** Rate of change (velocity) — positive means gaining momentum, negative means losing. */
	velocity: number;
	/** Momentum direction label. */
	direction: MomentumDirection;
	/** Confidence in the momentum reading (0–1). */
	confidence: number;
	/** Number of data points used. */
	sampleCount: number;
}

/**
 * Momentum tracking configuration.
 */
export interface MomentumConfig {
	/** Window size for the moving average (number of snapshots). Default: 5. */
	movingAverageWindow: number;
	/** Minimum number of snapshots needed for a momentum calculation. Default: 2. */
	minSamples: number;
	/**
	 * Velocity threshold for "accelerating" vs "decaying".
	 * |velocity| > this threshold = accelerating/decaying; otherwise steady.
	 * Default: 0.05 per snapshot interval.
	 */
	velocityThreshold: number;
}

/**
 * Full staleness detector configuration.
 */
export interface StalenessDetectorConfig {
	/** Staleness thresholds in days per item type. */
	thresholds: StalenessThresholds;
	/** Momentum tracking configuration. */
	momentum: MomentumConfig;
	/**
	 * Score above which an item is considered "stale" (0–1).
	 * Default: 0.5.
	 */
	staleThreshold: number;
	/**
	 * Maximum staleness score to assign (items beyond the threshold
	 * days get this score). Default: 1.0.
	 */
	maxStalenessScore: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_STALENESS_THRESHOLDS: StalenessThresholds = {
	observation: 3,
	signal: 5,
	memory_record: 14,
	goal: 14,
	attention_item: 7,
};

export const DEFAULT_MOMENTUM_CONFIG: MomentumConfig = {
	movingAverageWindow: 5,
	minSamples: 2,
	velocityThreshold: 0.05,
};

export const DEFAULT_STALENESS_DETECTOR_CONFIG: StalenessDetectorConfig = {
	thresholds: DEFAULT_STALENESS_THRESHOLDS,
	momentum: DEFAULT_MOMENTUM_CONFIG,
	staleThreshold: 0.5,
	maxStalenessScore: 1.0,
};

// ---------------------------------------------------------------------------
// Utility: DeepPartial for nested config merging
// ---------------------------------------------------------------------------

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;

// ---------------------------------------------------------------------------
// StalenessDetector
// ---------------------------------------------------------------------------

export class StalenessDetector {
	private config: StalenessDetectorConfig;
	/** History of staleness scores per item, keyed by item ID, for decay detection. */
	private stalenessHistory: Map<string, number[]> = new Map();
	/** Snapshot history for momentum tracking keyed by item ID. */
	private momentumHistory: Map<string, AttentionSnapshot[]> = new Map();

	constructor(config?: DeepPartial<StalenessDetectorConfig>) {
		this.config = {
			...DEFAULT_STALENESS_DETECTOR_CONFIG,
			...config,
			thresholds: {
				...DEFAULT_STALENESS_THRESHOLDS,
				...config?.thresholds,
			},
			momentum: {
				...DEFAULT_MOMENTUM_CONFIG,
				...config?.momentum,
			},
		};
	}

	/**
	 * Get the current configuration (read-only).
	 */
	getConfig(): Readonly<StalenessDetectorConfig> {
		return this.config;
	}

	/**
	 * Update configuration at runtime.
	 */
	updateConfig(partial: DeepPartial<StalenessDetectorConfig>): void {
		this.config = {
			...this.config,
			...partial,
			thresholds: {
				...this.config.thresholds,
				...partial.thresholds,
			},
			momentum: {
				...this.config.momentum,
				...partial.momentum,
			},
		};
	}

	/**
	 * Clear all tracking history (staleness and momentum).
	 */
	resetHistory(): void {
		this.stalenessHistory.clear();
		this.momentumHistory.clear();
	}

	// -----------------------------------------------------------------------
	// Staleness scanning
	// -----------------------------------------------------------------------

	/**
	 * Scan brain observations for staleness.
	 *
	 * @param observations - Observations to check.
	 * @returns Staleness results for each observation.
	 */
	scanObservations(observations: BrainObservation[]): StalenessResult[] {
		return observations.map((obs) =>
			this.computeStaleness({
				itemId: obs.id,
				itemType: "observation",
				title: obs.title,
				lastActivityAt: obs.timestamp,
			}),
		);
	}

	/**
	 * Scan brain signals for staleness.
	 *
	 * Uses resolvedAt if available (signal is done), otherwise createdAt.
	 *
	 * @param signals - Signals to check.
	 * @returns Staleness results for each signal.
	 */
	scanSignals(signals: BrainSignal[]): StalenessResult[] {
		return signals.map((sig) =>
			this.computeStaleness({
				itemId: sig.id,
				itemType: "signal",
				title: sig.pattern,
				lastActivityAt: sig.resolvedAt ?? sig.createdAt,
			}),
		);
	}

	/**
	 * Scan memory records for staleness.
	 *
	 * Uses updatedAt as the last activity timestamp.
	 *
	 * @param records - Memory records to check.
	 * @returns Staleness results for each record.
	 */
	scanMemoryRecords(records: MemoryRecord[]): StalenessResult[] {
		return records.map((rec) =>
			this.computeStaleness({
				itemId: rec.id,
				itemType: "memory_record",
				title: rec.title,
				lastActivityAt: rec.updatedAt,
			}),
		);
	}

	/**
	 * Scan goals for staleness.
	 *
	 * Uses updatedAt as the last activity timestamp.
	 *
	 * @param goals - Goals to check.
	 * @returns Staleness results for each goal.
	 */
	scanGoals(goals: GoalRecord[]): StalenessResult[] {
		return goals.map((goal) =>
			this.computeStaleness({
				itemId: goal.id,
				itemType: "goal",
				title: goal.title,
				lastActivityAt: goal.updatedAt,
			}),
		);
	}

	/**
	 * Scan attention items for staleness (using their timestamp).
	 *
	 * @param items - Attention items to check.
	 * @returns Staleness results for each item.
	 */
	scanAttentionItems(items: AttentionItem[]): StalenessResult[] {
		return items.map((item) =>
			this.computeStaleness({
				itemId: item.id,
				itemType: "attention_item",
				title: item.title,
				lastActivityAt: item.timestamp,
			}),
		);
	}

	/**
	 * Run a full staleness scan across all supplied item types.
	 *
	 * Returns aggregated results sorted by staleness score descending,
	 * with summary statistics (stale count, decaying count).
	 *
	 * @param params - Collections of items to scan (all optional).
	 * @returns Aggregated scan results.
	 */
	fullScan(params: {
		observations?: BrainObservation[];
		signals?: BrainSignal[];
		memoryRecords?: MemoryRecord[];
		goals?: GoalRecord[];
		attentionItems?: AttentionItem[];
	}): StalenessScanResult {
		const byType: StalenessScanResult["byType"] = {};

		if (params.observations && params.observations.length > 0) {
			byType.observation = this.scanObservations(params.observations);
		}
		if (params.signals && params.signals.length > 0) {
			byType.signal = this.scanSignals(params.signals);
		}
		if (params.memoryRecords && params.memoryRecords.length > 0) {
			byType.memory_record = this.scanMemoryRecords(params.memoryRecords);
		}
		if (params.goals && params.goals.length > 0) {
			byType.goal = this.scanGoals(params.goals);
		}
		if (params.attentionItems && params.attentionItems.length > 0) {
			byType.attention_item = this.scanAttentionItems(params.attentionItems);
		}

		const allResults = Object.values(byType).flat();
		const sorted = [...allResults].sort((a, b) => b.stalenessScore - a.stalenessScore);
		const staleCount = sorted.filter((r) => r.stalenessScore > this.config.staleThreshold).length;
		const decayingCount = sorted.filter((r) => r.isDecaying).length;

		return {
			byType,
			sorted,
			scannedAt: new Date().toISOString(),
			totalScanned: sorted.length,
			staleCount,
			decayingCount,
		};
	}

	// -----------------------------------------------------------------------
	// Momentum tracking
	// -----------------------------------------------------------------------

	/**
	 * Record an attention score snapshot for momentum tracking.
	 *
	 * @param itemId - The item to record a snapshot for.
	 * @param score - The current attention score (0–1).
	 */
	recordSnapshot(itemId: string, score: number): void {
		if (score < 0 || score > 1) {
			throw new Error(`Attention score must be between 0 and 1, got ${score}`);
		}
		if (!this.momentumHistory.has(itemId)) {
			this.momentumHistory.set(itemId, []);
		}
		const history = this.momentumHistory.get(itemId)!;
		history.push({
			itemId,
			timestamp: new Date().toISOString(),
			score,
		});

		// Trim history to avoid unbounded memory growth (keep 2x window)
		const maxLen = this.config.momentum.movingAverageWindow * 2;
		if (history.length > maxLen) {
			history.splice(0, history.length - maxLen);
		}
	}

	/**
	 * Record snapshots for multiple items at once.
	 *
	 * @param entries - Array of item IDs and their current scores.
	 */
	recordSnapshots(entries: Array<{ itemId: string; score: number }>): void {
		for (const { itemId, score } of entries) {
			this.recordSnapshot(itemId, score);
		}
	}

	/**
	 * Get the snapshot history for an item.
	 *
	 * @param itemId - The item to look up.
	 * @returns Array of snapshots (empty if none recorded).
	 */
	getSnapshotHistory(itemId: string): AttentionSnapshot[] {
		return this.momentumHistory.get(itemId) ?? [];
	}

	/**
	 * Compute momentum for a single item.
	 *
	 * Uses the recorded snapshot history and an optional current score
	 * to calculate velocity (rate of change) and direction.
	 *
	 * @param itemId - The item to compute momentum for.
	 * @param currentScore - Optional current score (if omitted, uses the latest recorded snapshot).
	 * @returns MomentumResult or null if insufficient data.
	 */
	computeMomentum(itemId: string, currentScore?: number): MomentumResult | null {
		const history = this.momentumHistory.get(itemId);
		if (!history || history.length === 0) return null;

		const cfg = this.config.momentum;

		// Collect scores from history and optionally the current score
		const scores = history.map((s) => s.score);
		if (currentScore !== undefined) {
			if (currentScore < 0 || currentScore > 1) {
				throw new Error(`Attention score must be between 0 and 1, got ${currentScore}`);
			}
			scores.push(currentScore);
		}

		if (scores.length < cfg.minSamples) return null;

		const current = currentScore ?? scores[scores.length - 1];

		// Compute moving average over the last `movingAverageWindow` scores
		const window = Math.min(cfg.movingAverageWindow, scores.length);
		const recentScores = scores.slice(-window);
		const averageScore = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

		// Compute velocity as difference between averages of two halves
		const half = Math.max(1, Math.floor(window / 2));
		const firstHalf = scores.slice(-window, -half || window);
		const secondHalf = scores.slice(-half || -1);
		const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : current;
		const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : current;

		const velocity = secondAvg - firstAvg;

		// Classify direction
		let direction: MomentumDirection;
		if (current < 0.1 && velocity <= 0) {
			// Score is very low and not rising
			direction = "stale";
		} else if (Math.abs(velocity) <= cfg.velocityThreshold) {
			direction = "steady";
		} else if (velocity > 0) {
			direction = "accelerating";
		} else {
			direction = "decaying";
		}

		// Confidence increases with more samples
		const confidence = Math.min(1.0, scores.length / (cfg.movingAverageWindow * 2));

		return {
			itemId,
			currentScore: current,
			averageScore,
			velocity,
			direction,
			confidence,
			sampleCount: scores.length,
		};
	}

	/**
	 * Compute momentum for multiple items at once.
	 *
	 * @param items - Array of item IDs and optional current scores.
	 * @returns Array of momentum results (only items with sufficient data).
	 */
	computeMomentumBatch(items: Array<{ itemId: string; currentScore?: number }>): MomentumResult[] {
		const results: MomentumResult[] = [];
		for (const { itemId, currentScore } of items) {
			const momentum = this.computeMomentum(itemId, currentScore);
			if (momentum) {
				results.push(momentum);
			}
		}
		return results;
	}

	/**
	 * Prune tracking history for items that are no longer active.
	 *
	 * Removes staleness and momentum data for item IDs not in the
	 * provided active set. Call periodically to prevent unbounded growth.
	 *
	 * @param activeItemIds - Set of item IDs that are still tracked.
	 */
	pruneHistory(activeItemIds: Set<string>): void {
		for (const key of this.momentumHistory.keys()) {
			if (!activeItemIds.has(key)) {
				this.momentumHistory.delete(key);
			}
		}
		for (const key of this.stalenessHistory.keys()) {
			if (!activeItemIds.has(key)) {
				this.stalenessHistory.delete(key);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Internal helpers
	// -----------------------------------------------------------------------

	/**
	 * Compute staleness for a single item and track history for decay detection.
	 */
	private computeStaleness(params: {
		itemId: string;
		itemType: StalenessCheckableType;
		title: string;
		lastActivityAt: string;
	}): StalenessResult {
		const thresholdDays = this.config.thresholds[params.itemType];
		const lastActivity = new Date(params.lastActivityAt).getTime();
		const now = Date.now();
		const daysSinceActivity = Math.max(0, (now - lastActivity) / (1000 * 60 * 60 * 24));

		// Linear staleness score: 0 at last activity, 1 at threshold days
		const stalenessScore = Math.min(this.config.maxStalenessScore, daysSinceActivity / (thresholdDays || 1));

		// Map score to severity
		const severity: Severity = stalenessScore >= 0.8 ? "critical" : stalenessScore >= 0.5 ? "warning" : "info";

		// Track staleness history for decay detection
		if (!this.stalenessHistory.has(params.itemId)) {
			this.stalenessHistory.set(params.itemId, []);
		}
		const history = this.stalenessHistory.get(params.itemId)!;
		const previousScore = history.length > 0 ? history[history.length - 1] : undefined;
		history.push(stalenessScore);

		// Trim to prevent unbounded growth
		if (history.length > 10) {
			history.splice(0, history.length - 10);
		}

		const isDecaying = previousScore !== undefined && stalenessScore > previousScore;

		return {
			itemId: params.itemId,
			itemType: params.itemType,
			title: params.title,
			daysSinceActivity,
			stalenessScore,
			lastActivityAt: params.lastActivityAt,
			severity,
			isDecaying,
			previousStalenessScore: previousScore,
		};
	}
}
