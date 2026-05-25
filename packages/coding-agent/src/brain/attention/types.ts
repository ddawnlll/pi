/**
 * Attention Ranking Types — 24.I
 *
 * Defines the core data structures for ranking brain items (observations,
 * signals, timeline events, memory records) by how urgently they need
 * attention from the brain or user.
 *
 * Each item gets an attention score (0–1) based on factors such as
 * severity, recency, confidence, and recurrence. The ranker produces
 * a sorted list so the brain can focus on the most important items first.
 */

import { randomUUID } from "node:crypto";
import type { Severity, SignalType } from "../types.js";

// ---------------------------------------------------------------------------
// Attention Category
// ---------------------------------------------------------------------------

/**
 * Categories of items that can be ranked for attention.
 */
export type AttentionCategory =
	| "observation"
	| "signal"
	| "timeline_event"
	| "memory_record"
	| "proposal"
	| "goal_drift";

// ---------------------------------------------------------------------------
// Attention Item
// ---------------------------------------------------------------------------

/**
 * A single item that needs attention ranking.
 * Wraps a brain artifact with a computed attention score.
 */
export interface AttentionItem {
	/** Unique identifier. */
	id: string;
	/** ISO 8601 timestamp of when this item was created/recorded. */
	timestamp: string;
	/** Category of brain item. */
	category: AttentionCategory;
	/** Severity level (derived from wrapped item). */
	severity: Severity;
	/** Human-readable title. */
	title: string;
	/** Longer description. */
	description: string;
	/** The source signal type, if applicable. */
	signalType?: SignalType;
	/** Computed attention score between 0 and 1. */
	score: number;
	/** Optional reference to the original item ID. */
	refId?: string;
	/** Arbitrary metadata. */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Attention Ranking Config
// ---------------------------------------------------------------------------

/**
 * Configuration for the attention ranker.
 *
 * Each weight controls how much a factor contributes to the final
 * score. Lowering a weight reduces its influence; setting to 0
 * disables it entirely.
 */
export interface AttentionRankingConfig {
	weights: {
		/** How much severity (critical > warning > info) influences the score. */
		severity: number;
		/** How much recency (newer = higher score) influences the score. */
		recency: number;
		/** How much the item's confidence influences the score. */
		confidence: number;
		/** How much recurrence / frequency of same pattern influences the score. */
		recurrence: number;
	};
	/**
	 * Number of days after which an item is considered stale
	 * and receives minimal recency contribution. Default: 7.
	 */
	staleAfterDays: number;
	/**
	 * Maximum number of items to return from a ranking call.
	 * Default: 50.
	 */
	maxResults: number;
}

// ---------------------------------------------------------------------------
// Attention Ranking Result
// ---------------------------------------------------------------------------

/**
 * The result of a ranking operation.
 */
export interface AttentionRankingResult {
	/** Ranked items in descending order of attention need (highest first). */
	items: AttentionItem[];
	/** ISO 8601 timestamp of when the ranking was computed. */
	computedAt: string;
	/** Number of items considered. */
	totalConsidered: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default configuration for the attention ranker. */
export const DEFAULT_ATTENTION_RANKING_CONFIG: AttentionRankingConfig = {
	weights: {
		severity: 0.4,
		recency: 0.3,
		confidence: 0.2,
		recurrence: 0.1,
	},
	staleAfterDays: 7,
	maxResults: 50,
};

/** Array of all valid AttentionCategory values for runtime validation. */
export const ALL_ATTENTION_CATEGORIES: AttentionCategory[] = [
	"observation",
	"signal",
	"timeline_event",
	"memory_record",
	"proposal",
	"goal_drift",
];

// ---------------------------------------------------------------------------
// Severity score map
// ---------------------------------------------------------------------------

/**
 * Maps severity levels to numeric values for scoring.
 * critical = 1.0, warning = 0.6, info = 0.2.
 */
export const SEVERITY_SCORES: Record<Severity, number> = {
	critical: 1.0,
	warning: 0.6,
	info: 0.2,
};

// ---------------------------------------------------------------------------
// Factory / Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Create a new AttentionItem with defaults applied.
 */
export function createAttentionItem(
	overrides: Partial<Omit<AttentionItem, "id">> & {
		category: AttentionCategory;
		severity: Severity;
		title: string;
		description: string;
		score: number;
	},
): AttentionItem {
	return {
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		metadata: {},
		...overrides,
	};
}

/**
 * Validate an AttentionItem.
 */
export function validateAttentionItem(value: unknown): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const item = value as Record<string, unknown>;

	if (typeof item.id !== "string" || item.id.length === 0) {
		errors.push("id must be a non-empty string");
	}
	if (typeof item.timestamp !== "string" || item.timestamp.length === 0) {
		errors.push("timestamp must be a non-empty string");
	}
	if (!ALL_ATTENTION_CATEGORIES.includes(item.category as AttentionCategory)) {
		errors.push(`category must be one of: ${ALL_ATTENTION_CATEGORIES.join(", ")}`);
	}
	if (typeof item.severity !== "string" || !["info", "warning", "critical"].includes(item.severity as string)) {
		errors.push('severity must be one of: "info", "warning", "critical"');
	}
	if (typeof item.title !== "string" || item.title.length === 0) {
		errors.push("title must be a non-empty string");
	}
	if (typeof item.description !== "string") {
		errors.push("description must be a string");
	}
	if (typeof item.score !== "number" || item.score < 0 || item.score > 1) {
		errors.push("score must be a number between 0 and 1");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Compute a recency score based on how many days old an item is.
 * Returns 1.0 for items created now, approaching 0 as items age past staleAfterDays.
 */
export function computeRecencyScore(timestamp: string, staleAfterDays: number = 7): number {
	const created = new Date(timestamp).getTime();
	const now = Date.now();
	const ageMs = now - created;
	const ageDays = ageMs / (1000 * 60 * 60 * 24);

	if (ageDays <= 0) return 1.0;
	if (ageDays >= staleAfterDays) return 0.05;

	// Linear decay from 1.0 down to 0.05 over staleAfterDays
	return 1.0 - (ageDays / staleAfterDays) * 0.95;
}
