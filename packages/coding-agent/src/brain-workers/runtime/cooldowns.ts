/**
 * Worker Cooldown and Backoff — 25.R
 *
 * Cooldown management with exponential backoff for brain workers.
 * When a worker fails consecutively, the cooldown period is multiplied
 * by the backoff factor to prevent rapid retry cycles.
 *
 * Features:
 * - Fixed cooldown periods (for normal cycle completion)
 * - Exponential backoff cooldowns (for repeated failures)
 * - Optional jitter to prevent thundering herd
 * - Configurable backoff factor, max backoff cap, and jitter ratio
 *
 * Dependencies: ../types.ts (WorkerCooldown)
 *
 * @packageDocumentation
 */

import type { WorkerCooldown } from "../types.js";

// ---------------------------------------------------------------------------
// Backoff Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for exponential backoff.
 *
 * When a worker fails consecutively, the cooldown duration grows
 * exponentially: baseCooldownMs * (backoffFactor ^ consecutiveFailures).
 * The result is capped at maxBackoffMs and jitter is optionally added.
 */
export interface BackoffConfig {
	/**
	 * Base cooldown in milliseconds (the starting point before backoff).
	 * This is typically the WorkerBudget.cooldownMs value.
	 * Default: 60_000 (1 minute).
	 */
	baseCooldownMs: number;

	/**
	 * Exponential backoff factor.
	 * Each consecutive failure multiplies the cooldown by this factor.
	 * Default: 2.0 (doubles each failure).
	 */
	backoffFactor: number;

	/**
	 * Maximum cooldown in milliseconds (cap for exponential growth).
	 * Default: 3_600_000 (1 hour).
	 */
	maxBackoffMs: number;

	/**
	 * Whether to add random jitter to the computed cooldown.
	 * Jitter helps prevent thundering herd when multiple workers
	 * fail simultaneously.
	 * Default: true.
	 */
	enableJitter: boolean;

	/**
	 * Jitter ratio (0-1) — the range of random variation applied.
	 * E.g., 0.1 means +/-10% of the computed cooldown.
	 * Default: 0.1.
	 */
	jitterRatio: number;
}

/**
 * Default backoff configuration values.
 */
export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
	baseCooldownMs: 60_000,
	backoffFactor: 2.0,
	maxBackoffMs: 3_600_000,
	enableJitter: true,
	jitterRatio: 0.1,
};

// ---------------------------------------------------------------------------
// Cooldown Result
// ---------------------------------------------------------------------------

/**
 * Result of computing a cooldown duration.
 */
export interface CooldownResult {
	/** The computed cooldown duration in milliseconds. */
	durationMs: number;
	/** The cooldown start time (ISO 8601). */
	startedAt: string;
	/** The cooldown end time (ISO 8601). */
	endsAt: string;
	/** A human-readable reason for this cooldown. */
	reason: string;
	/** Whether exponential backoff was applied. */
	backoffApplied: boolean;
	/** The backoff multiplier that was used (1.0 if no backoff). */
	backoffMultiplier: number;
	/** Whether jitter was applied. */
	jitterApplied: boolean;
}

// ---------------------------------------------------------------------------
// Duration Computation
// ---------------------------------------------------------------------------

/**
 * Compute the cooldown duration with exponential backoff.
 *
 * For normal (successful) cycles, the base cooldown is used directly
 * with no backoff multiplier.
 *
 * For failed cycles, the cooldown grows exponentially based on the
 * consecutive failure count: baseCooldownMs * (backoffFactor ^ failures).
 * The result is capped at maxBackoffMs and jittered if enabled.
 *
 * @param consecutiveFailures - Number of consecutive failures (0 for success).
 * @param baseCooldownMs - Base cooldown in milliseconds.
 * @param config - Backoff configuration (uses defaults if not provided).
 * @returns The computed cooldown duration in milliseconds.
 */
export function computeCooldownDuration(
	consecutiveFailures: number,
	baseCooldownMs: number,
	config: Partial<BackoffConfig> = {},
): number {
	const merged: BackoffConfig = { ...DEFAULT_BACKOFF_CONFIG, ...config, baseCooldownMs };

	// For success (no failures) or zero failures, use the base cooldown directly
	if (consecutiveFailures <= 0) {
		return Math.max(0, merged.baseCooldownMs);
	}

	// Compute exponential backoff: base * (factor ^ failures)
	let duration = merged.baseCooldownMs * merged.backoffFactor ** consecutiveFailures;

	// Cap at max backoff
	duration = Math.min(duration, merged.maxBackoffMs);

	// Apply jitter if enabled
	if (merged.enableJitter && duration > 0) {
		const jitterRange = duration * merged.jitterRatio;
		const jitter = (Math.random() * 2 - 1) * jitterRange; // +/- jitterRange
		duration = Math.max(0, duration + jitter);
	}

	return Math.round(duration);
}

/**
 * Create a full CooldownResult from parameters.
 *
 * @param consecutiveFailures - Number of consecutive failures.
 * @param baseCooldownMs - Base cooldown in milliseconds.
 * @param reason - Human-readable reason for the cooldown.
 * @param config - Optional backoff configuration overrides.
 * @returns A CooldownResult with computed duration and timestamps.
 */
export function createCooldownResult(
	consecutiveFailures: number,
	baseCooldownMs: number,
	reason: string,
	config: Partial<BackoffConfig> = {},
): CooldownResult {
	const merged: BackoffConfig = { ...DEFAULT_BACKOFF_CONFIG, ...config, baseCooldownMs };

	// For zero failures, use base cooldown directly
	if (consecutiveFailures <= 0) {
		const now = Date.now();
		return {
			durationMs: Math.max(0, merged.baseCooldownMs),
			startedAt: new Date(now).toISOString(),
			endsAt: new Date(now + merged.baseCooldownMs).toISOString(),
			reason,
			backoffApplied: false,
			backoffMultiplier: 1.0,
			jitterApplied: false,
		};
	}

	// Compute exponential backoff
	const baseDuration = merged.baseCooldownMs * merged.backoffFactor ** consecutiveFailures;
	const cappedDuration = Math.min(baseDuration, merged.maxBackoffMs);

	// Apply jitter
	let finalDuration = cappedDuration;
	let jitterApplied = false;
	if (merged.enableJitter && cappedDuration > 0) {
		const jitterRange = cappedDuration * merged.jitterRatio;
		const jitter = (Math.random() * 2 - 1) * jitterRange;
		finalDuration = Math.max(0, Math.round(cappedDuration + jitter));
		jitterApplied = Math.abs(jitter) > 0;
	}

	const now = Date.now();
	const backoffMultiplier = merged.backoffFactor ** consecutiveFailures;

	return {
		durationMs: Math.round(finalDuration),
		startedAt: new Date(now).toISOString(),
		endsAt: new Date(now + finalDuration).toISOString(),
		reason: `${reason}${consecutiveFailures > 0 ? ` (backoff x${backoffMultiplier.toFixed(1)})` : ""}`,
		backoffApplied: consecutiveFailures > 0,
		backoffMultiplier,
		jitterApplied,
	};
}

/**
 * Check if a cooldown period has elapsed.
 *
 * @param cooldown - The cooldown state to check.
 * @returns true if there is no cooldown or if the cooldown period has ended.
 */
export function isCooldownElapsed(cooldown: WorkerCooldown): boolean {
	if (!cooldown.endsAt) return true;
	return Date.now() >= new Date(cooldown.endsAt).getTime();
}

/**
 * Get remaining cooldown time in milliseconds.
 *
 * @param cooldown - The cooldown state to check.
 * @returns Remaining ms until cooldown ends, or 0 if not in cooldown.
 */
export function getRemainingCooldownMs(cooldown: WorkerCooldown): number {
	if (!cooldown.endsAt) return 0;
	const remaining = new Date(cooldown.endsAt).getTime() - Date.now();
	return Math.max(0, remaining);
}

/**
 * Apply a cooldown result to a WorkerCooldown state object.
 *
 * Mutates the WorkerCooldown in-place and returns it.
 *
 * @param cooldown - The cooldown state to update.
 * @param result - The computed cooldown result.
 * @returns The updated WorkerCooldown (same reference).
 */
export function applyCooldown(cooldown: WorkerCooldown, result: CooldownResult): WorkerCooldown {
	cooldown.startedAt = result.startedAt;
	cooldown.endsAt = result.endsAt;
	cooldown.reason = result.reason;
	cooldown.count++;
	return cooldown;
}

/**
 * Reset a WorkerCooldown to its initial state (not cooling).
 *
 * @param cooldown - The cooldown state to reset.
 * @returns The reset WorkerCooldown (same reference).
 */
export function resetCooldown(cooldown: WorkerCooldown): WorkerCooldown {
	cooldown.startedAt = null;
	cooldown.endsAt = null;
	cooldown.reason = "";
	// Keep count for diagnostics (represents total cooldown events)
	return cooldown;
}
