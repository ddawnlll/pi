/**
 * Attention Ranking Engine — 24.I
 *
 * Evaluates brain artifacts (observations, signals, timeline events,
 * memory records) and produces a ranked list of items that need the
 * brain's or user's attention most urgently.
 *
 * Scoring factors (configurable via AttentionRankingConfig):
 * - Severity: critical items get higher scores
 * - Recency: newer items are more relevant
 * - Confidence: more certain items deserve more attention
 * - Recurrence: patterns that appear repeatedly need investigation
 *
 * The engine is stateless — ranking is computed on each call from
 * the provided items. Callers pass in the items to evaluate.
 */

import type { MemoryRecord } from "../memory/types.js";
import type { BrainObservation, BrainSignal, BrainTimelineEvent, Severity } from "../types.js";
import type { AttentionItem, AttentionRankingConfig, AttentionRankingResult } from "./types.js";
import {
	computeRecencyScore,
	createAttentionItem,
	DEFAULT_ATTENTION_RANKING_CONFIG,
	SEVERITY_SCORES,
} from "./types.js";

// ---------------------------------------------------------------------------
// Utility: DeepPartial for nested config merging
// ---------------------------------------------------------------------------

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;

// ---------------------------------------------------------------------------
// AttentionRanker
// ---------------------------------------------------------------------------

export class AttentionRanker {
	private config: AttentionRankingConfig;

	constructor(config?: DeepPartial<AttentionRankingConfig>) {
		this.config = {
			...DEFAULT_ATTENTION_RANKING_CONFIG,
			...config,
			weights: {
				...DEFAULT_ATTENTION_RANKING_CONFIG.weights,
				...config?.weights,
			},
		};
	}

	/**
	 * Get the current configuration (read-only).
	 */
	getConfig(): Readonly<AttentionRankingConfig> {
		return this.config;
	}

	/**
	 * Update configuration at runtime.
	 */
	updateConfig(partial: DeepPartial<AttentionRankingConfig>): void {
		this.config = {
			...this.config,
			...partial,
			weights: {
				...this.config.weights,
				...partial.weights,
			},
		};
	}

	// -----------------------------------------------------------------------
	// Public ranking methods
	// -----------------------------------------------------------------------

	/**
	 * Rank observations by attention need.
	 *
	 * @param observations - Brain observations to evaluate.
	 * @param recurrenceMap - Optional map of signalType -> count for recurrence scoring.
	 * @returns Ranked attention items.
	 */
	rankObservations(observations: BrainObservation[], recurrenceMap?: Record<string, number>): AttentionRankingResult {
		const items = observations.map((obs) => {
			const score = this.computeScore({
				severity: obs.severity,
				timestamp: obs.timestamp,
				confidence: obs.provenance.confidence,
				signalType: obs.signalType,
				recurrenceCount: recurrenceMap?.[obs.signalType] ?? 1,
			});

			return createAttentionItem({
				category: "observation",
				severity: obs.severity,
				title: obs.title,
				description: obs.description,
				score,
				timestamp: obs.timestamp,
				refId: obs.id,
				signalType: obs.signalType,
				metadata: { observationId: obs.id },
			});
		});

		return this.buildResult(items, observations.length);
	}

	/**
	 * Rank signals by attention need.
	 *
	 * @param signals - Brain signals to evaluate.
	 * @param recurrenceMap - Optional map of pattern -> count for recurrence scoring.
	 * @returns Ranked attention items.
	 */
	rankSignals(signals: BrainSignal[], recurrenceMap?: Record<string, number>): AttentionRankingResult {
		const items = signals.map((sig) => {
			const score = this.computeScore({
				severity: sig.severity,
				timestamp: sig.createdAt,
				confidence: sig.confidence,
				signalType: undefined,
				recurrenceCount: recurrenceMap?.[sig.pattern] ?? 1,
			});

			return createAttentionItem({
				category: "signal",
				severity: sig.severity,
				title: sig.pattern,
				description: sig.summary,
				score,
				timestamp: sig.createdAt,
				refId: sig.id,
				metadata: { signalId: sig.id, pattern: sig.pattern },
			});
		});

		return this.buildResult(items, signals.length);
	}

	/**
	 * Rank timeline events by attention need.
	 *
	 * @param events - Brain timeline events to evaluate.
	 * @returns Ranked attention items.
	 */
	rankTimelineEvents(events: BrainTimelineEvent[]): AttentionRankingResult {
		const items = events.map((evt) => {
			const score = this.computeScore({
				severity: evt.severity,
				timestamp: evt.timestamp,
				confidence: 1.0,
				signalType: undefined,
				recurrenceCount: 1,
			});

			return createAttentionItem({
				category: "timeline_event",
				severity: evt.severity,
				title: evt.eventType,
				description: `Timeline event: ${evt.eventType}`,
				score,
				timestamp: evt.timestamp,
				refId: evt.id,
				metadata: { eventId: evt.id, eventType: evt.eventType },
			});
		});

		return this.buildResult(items, events.length);
	}

	/**
	 * Rank memory records by attention need.
	 *
	 * @param records - Memory records to evaluate.
	 * @param recurrenceMap - Optional map of type -> count for recurrence scoring.
	 * @returns Ranked attention items.
	 */
	rankMemoryRecords(records: MemoryRecord[], recurrenceMap?: Record<string, number>): AttentionRankingResult {
		const items = records.map((rec) => {
			const severity = this.inferMemorySeverity(rec);
			const confidence = rec.confidence ?? 0.5;
			const score = this.computeScore({
				severity,
				timestamp: rec.createdAt,
				confidence,
				signalType: undefined,
				recurrenceCount: recurrenceMap?.[rec.type] ?? 1,
			});

			return createAttentionItem({
				category: "memory_record",
				severity,
				title: rec.title,
				description: rec.summary ?? rec.content,
				score,
				timestamp: rec.createdAt,
				refId: rec.id,
				metadata: { memoryId: rec.id, memoryType: rec.type },
			});
		});

		return this.buildResult(items, records.length);
	}

	/**
	 * Rank mixed items of various categories in one call.
	 *
	 * @param items - AttentionItems to re-rank.
	 * @returns Ranked attention items.
	 */
	rankMixed(items: AttentionItem[]): AttentionRankingResult {
		const sorted = [...items].sort((a, b) => b.score - a.score);
		const limited = sorted.slice(0, this.config.maxResults);
		return {
			items: limited,
			computedAt: new Date().toISOString(),
			totalConsidered: items.length,
		};
	}

	// -----------------------------------------------------------------------
	// Internal helpers
	// -----------------------------------------------------------------------

	/**
	 * Compute a composite attention score from component factors.
	 */
	private computeScore(factors: {
		severity: Severity;
		timestamp: string;
		confidence: number;
		signalType?: string;
		recurrenceCount: number;
	}): number {
		const severityScore = SEVERITY_SCORES[factors.severity];
		const recencyScore = computeRecencyScore(factors.timestamp, this.config.staleAfterDays);
		const confidenceScore = factors.confidence;
		// Recurrence: dampened logarithmic scale — more occurrences = higher score
		const recurrenceScore = Math.min(1.0, Math.log2(factors.recurrenceCount + 1) / 5);

		const { severity, recency, confidence, recurrence } = this.config.weights;
		const totalWeight = severity + recency + confidence + recurrence;

		if (totalWeight === 0) return 0;

		const weighted =
			(severityScore * severity +
				recencyScore * recency +
				confidenceScore * confidence +
				recurrenceScore * recurrence) /
			totalWeight;

		// Clamp to [0, 1]
		return Math.max(0, Math.min(1, weighted));
	}

	/**
	 * Infer a severity level from a memory record's lifecycle state.
	 * Disputed and needs_review records are treated as critical;
	 * candidate records as info; superseded/expired/rejected as info.
	 */
	private inferMemorySeverity(record: MemoryRecord): Severity {
		switch (record.lifecycle) {
			case "disputed":
			case "needs_review":
				return "critical";
			case "active":
				return "info";
			case "candidate":
				return "info";
			default:
				return "info";
		}
	}

	/**
	 * Sort items by descending score, limit to maxResults, and wrap in result.
	 */
	private buildResult(items: AttentionItem[], totalConsidered: number): AttentionRankingResult {
		const sorted = [...items].sort((a, b) => b.score - a.score);
		const limited = sorted.slice(0, this.config.maxResults);
		return {
			items: limited,
			computedAt: new Date().toISOString(),
			totalConsidered,
		};
	}
}
