/**
 * Performance metrics calculation utilities.
 *
 * Pure functions for computing cache hit rate, token split, and validation
 * lock metrics. No Node.js dependencies — safe for browser and test environments.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cache performance metrics for a workspace's prompt cache. */
export interface CachePerformanceMetrics {
	/** Cache hit rate as a decimal (0.0 – 1.0). null/undefined means unknown. */
	cacheHitRate: number | null;
	/** Whether cache_hit_rate is known; false means the backend hasn't tracked it yet. */
	cacheHitRateKnown: boolean;
	/** Cache creation input tokens (tokens written to cache). */
	cacheCreationInputTokens: number | null;
	/** Cache read input tokens (tokens served from cache). */
	cacheReadInputTokens: number | null;
}

/** Token split for prefix vs suffix in a workspace's prompt assembly. */
export interface TokenSplitMetrics {
	/** Estimated tokens in the cacheable prefix (system prompt + tools + pinned messages). */
	prefixTokenCount: number | null;
	/** Estimated tokens in the dynamic suffix (recent messages, user input). */
	suffixTokenCount: number | null;
	/** Total tokens (prefix + suffix). */
	totalTokenCount: number | null;
}

/** Validation lock performance metrics for a workspace. */
export interface ValidationLockMetrics {
	/** Number of times the workspace waited for the validation lock. */
	lockWaits: number;
	/** Total time (ms) spent waiting for the validation lock across all waits. */
	totalLockWaitMs: number | null;
	/** Longest single lock wait (ms). */
	maxLockWaitMs: number | null;
	/** Average lock wait (ms); null when lockWaits === 0. */
	avgLockWaitMs: number | null;
}

/** Full performance telemetry for a workspace. */
export interface WorkspacePerformanceMetrics {
	/** Workspace ID these metrics belong to. */
	workspaceId: string;
	/** Cache/prompt performance metrics. */
	cache: CachePerformanceMetrics;
	/** Prefix/suffix token split. */
	tokenSplit: TokenSplitMetrics;
	/** Validation lock performance. */
	validationLock: ValidationLockMetrics;
}

// ---------------------------------------------------------------------------
// Metric calculation helpers
// ---------------------------------------------------------------------------

/**
 * Compute cache hit rate from cache creation and read token counts.
 *
 * Cache hit rate = cache_read_input_tokens / (cache_creation_input_tokens + cache_read_input_tokens).
 * Returns null when both inputs are null/undefined/zero (unknown state).
 *
 * @param cacheCreationTokens - Tokens written to cache (may be null if unknown)
 * @param cacheReadTokens - Tokens served from cache (may be null if unknown)
 * @returns Object with rate (decimal 0.0–1.0 or null) and known boolean
 */
export function computeCacheHitRate(
	cacheCreationTokens: number | null | undefined,
	cacheReadTokens: number | null | undefined,
): { rate: number | null; known: boolean } {
	if (cacheCreationTokens == null && cacheReadTokens == null) {
		return { rate: null, known: false };
	}

	const creation = cacheCreationTokens ?? 0;
	const read = cacheReadTokens ?? 0;
	const total = creation + read;

	if (total === 0) {
		return { rate: 0, known: true };
	}

	return { rate: read / total, known: true };
}

/**
 * Compute prefix/suffix token split from chars/4 heuristic.
 *
 * @param prefixChars - Character count of the prefix (system prompt + tools + pinned messages)
 * @param suffixChars - Character count of the suffix (dynamic messages)
 * @returns Token split metrics with estimated token counts
 */
export function computeTokenSplit(
	prefixChars: number | null | undefined,
	suffixChars: number | null | undefined,
): TokenSplitMetrics {
	if (prefixChars == null && suffixChars == null) {
		return { prefixTokenCount: null, suffixTokenCount: null, totalTokenCount: null };
	}

	const prefixTokens = prefixChars != null ? Math.ceil(prefixChars / 4) : 0;
	const suffixTokens = suffixChars != null ? Math.ceil(suffixChars / 4) : 0;

	return {
		prefixTokenCount: prefixTokens,
		suffixTokenCount: suffixTokens,
		totalTokenCount: prefixTokens + suffixTokens,
	};
}

/**
 * Compute validation lock wait metrics from a list of individual wait durations.
 *
 * @param waitDurations - Array of individual lock wait durations in milliseconds
 * @returns Aggregated validation lock metrics
 */
export function computeValidationLockMetrics(
	waitDurations: number[],
): ValidationLockMetrics {
	if (waitDurations.length === 0) {
		return {
			lockWaits: 0,
			totalLockWaitMs: null,
			maxLockWaitMs: null,
			avgLockWaitMs: null,
		};
	}

	const total = waitDurations.reduce((sum, d) => sum + d, 0);
	const max = Math.max(...waitDurations);

	return {
		lockWaits: waitDurations.length,
		totalLockWaitMs: total,
		maxLockWaitMs: max,
		avgLockWaitMs: Math.round(total / waitDurations.length),
	};
}

/**
 * Format a percentage value distinguishing "unknown" from 0%.
 *
 * @param value - Decimal percentage value (0.0–1.0), null/undefined means unknown
 * @param known - Whether the value is known (distinct from null default)
 * @returns Formatted string: "unknown" for unknown, "0.0%" for 0, etc.
 */
export function formatPercentForPerformance(
	value: number | null | undefined,
	known: boolean,
): string {
	if (!known || value == null) return "unknown";
	return `${(value * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Journal event parsing for validation lock wait times
// ---------------------------------------------------------------------------

/**
 * Extract validation lock wait durations from journal events.
 *
 * Looks for events emitted by the validation lock system:
 * - validation_lock_waiting → validation_lock_acquired pairs
 * The wait time is the difference between acquired timestamp and waiting timestamp.
 *
 * @param events - Array of journal events with type, timestamp, and data fields
 * @returns Array of lock wait durations in milliseconds
 */
export function extractValidationLockWaitTimes(
	events: Array<{ type: string; timestamp: number; data?: Record<string, unknown> }>,
): number[] {
	const waitTimes: number[] = [];
	const pendingWaits = new Map<string, number>(); // command -> waiting timestamp

	for (const event of events) {
		if (event.type === "validation_lock_waiting") {
			const command = (event.data?.command as string) ?? "unknown";
			pendingWaits.set(command, event.timestamp);
		} else if (event.type === "validation_lock_acquired") {
			const command = (event.data?.command as string) ?? "unknown";
			const waitStart = pendingWaits.get(command);
			if (waitStart != null) {
				waitTimes.push(event.timestamp - waitStart);
				pendingWaits.delete(command);
			}
		}
	}

	return waitTimes;
}
