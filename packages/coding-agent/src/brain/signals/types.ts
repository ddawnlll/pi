/**
 * Signal & Anomaly Engine — Types (V5.06)
 *
 * Defines types for signal deduplication via cooldown keys,
 * signal feeding configuration, and the signal engine API.
 *
 * Acceptance criteria:
 * 1. Repeated validation signature after threshold creates validation_repeat signal.
 * 2. A memory conflict that affects a proposal creates a decision-impact warning signal.
 * 3. Signals dedupe through cooldown keys and do not spam.
 * 4. Signals can feed proposals, push, overview, and Ask Pi answers.
 *
 * @packageDocumentation
 */

import type { SignalType } from "../types.js";

// =========================================================================
// Signal Deduplication (Cooldown)
// =========================================================================

/**
 * A cooldown key uniquely identifies a deduplication scope for a signal.
 */
export interface SignalDedupKey {
	/** The signal type this dedup key covers. */
	signalType: SignalType;
	/**
	 * A scoped discriminator within the signal type, e.g.:
	 * - For validation_repeat: the file path or validation signature hash
	 * - For decision_impact: the proposal ID
	 * - For generic signals: a pattern or context string
	 */
	scope: string;
}

/** Compute a compact string key from a SignalDedupKey. */
export function formatDedupKey(key: SignalDedupKey): string {
	return `${key.signalType}:${key.scope}`;
}

/** Parse a string key back into a SignalDedupKey. */
export function parseDedupKey(raw: string): SignalDedupKey {
	const colonIdx = raw.indexOf(":");
	const signalType = raw.slice(0, colonIdx) as SignalType;
	const scope = raw.slice(colonIdx + 1);
	return { signalType, scope };
}

/**
 * Configuration for signal cooldown periods.
 */
export interface CooldownConfig {
	/** Default cooldown for all signal types (ms). Default: 60_000 (1 min). */
	defaultCooldownMs: number;
	/** Per-signal-type overrides (ms). */
	perTypeCooldownMs: Partial<Record<SignalType, number>>;
}

/** Default cooldown configuration. */
export const DEFAULT_COOLDOWN_CONFIG: CooldownConfig = {
	defaultCooldownMs: 60_000,
	perTypeCooldownMs: {
		validation_repeat: 300_000,
		decision_impact: 120_000,
		memory_conflict: 60_000,
		retry_hotspot: 120_000,
		failure_pattern: 300_000,
		queue_blocked: 60_000,
		integration_dirty: 60_000,
		goal_drift: 300_000,
		proposal_generated: 60_000,
	},
};

// =========================================================================
// Validation Repeat Signal
// =========================================================================

export interface ValidationSignature {
	signature: string;
	label: string;
	count: number;
	firstSeen: string;
	lastSeen: string;
}

export interface ValidationRepeatConfig {
	threshold: number;
	windowMs: number;
}

export const DEFAULT_VALIDATION_REPEAT_CONFIG: ValidationRepeatConfig = {
	threshold: 3,
	windowMs: 3_600_000,
};

// =========================================================================
// Decision Impact Signal
// =========================================================================

export interface DecisionImpactContext {
	conflictingMemoryIds: [string, string];
	conflictType: "contradiction" | "duplicate" | "staleness";
	memoryTitles: [string, string];
	affectedProposalId?: string;
	affectedProposalTitle?: string;
	impactSummary: string;
}

// =========================================================================
// Signal Feed Target
// =========================================================================

export type SignalFeedTarget = "proposal" | "push" | "overview" | "ask_pi";

export type FeedRoutingConfig = Partial<Record<SignalType, SignalFeedTarget[]>>;

export const DEFAULT_FEED_ROUTING: FeedRoutingConfig = {
	validation_repeat: ["overview", "ask_pi", "proposal"],
	decision_impact: ["overview", "ask_pi", "proposal", "push"],
	memory_conflict: ["overview", "ask_pi"],
	retry_hotspot: ["overview", "ask_pi"],
	failure_pattern: ["overview", "ask_pi", "proposal"],
	queue_blocked: ["overview", "ask_pi"],
	integration_dirty: ["overview", "ask_pi"],
	goal_drift: ["overview", "ask_pi", "proposal"],
	proposal_generated: ["overview", "ask_pi"],
};

// =========================================================================
// Signal Engine Configuration
// =========================================================================

export interface SignalEngineConfig {
	cooldown: CooldownConfig;
	validationRepeat: ValidationRepeatConfig;
	feedRouting: FeedRoutingConfig;
	enabled: boolean;
}

export const DEFAULT_SIGNAL_ENGINE_CONFIG: SignalEngineConfig = {
	cooldown: DEFAULT_COOLDOWN_CONFIG,
	validationRepeat: DEFAULT_VALIDATION_REPEAT_CONFIG,
	feedRouting: DEFAULT_FEED_ROUTING,
	enabled: true,
};

// =========================================================================
// Signal Engine Observable State
// =========================================================================

export interface SignalEngineState {
	activeCount: number;
	totalEmitted: number;
	suppressedByCooldown: number;
	activeCooldowns: Array<{ key: string; expiresAt: string }>;
	enabled: boolean;
}
