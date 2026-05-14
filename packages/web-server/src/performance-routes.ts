/**
 * Performance Routes — Telemetry endpoints for cache/prompt/validation metrics.
 *
 * Endpoints:
 *   GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/performance
 *       Returns WorkspacePerformanceMetrics for a single workspace.
 *
 *   GET /api/projects/:projectId/plans/:planExecId/performance
 *       Returns aggregated performance metrics across all workspaces.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Types (mirrors frontend types for type safety)
// ---------------------------------------------------------------------------

export interface CachePerformanceMetrics {
	cacheHitRate: number | null;
	cacheHitRateKnown: boolean;
	cacheCreationInputTokens: number | null;
	cacheReadInputTokens: number | null;
}

export interface TokenSplitMetrics {
	prefixTokenCount: number | null;
	suffixTokenCount: number | null;
	totalTokenCount: number | null;
}

export interface ValidationLockMetrics {
	lockWaits: number;
	totalLockWaitMs: number | null;
	maxLockWaitMs: number | null;
	avgLockWaitMs: number | null;
}

export interface WorkspacePerformanceMetricsFull {
	workspaceId: string;
	cache: CachePerformanceMetrics;
	tokenSplit: TokenSplitMetrics;
	validationLock: ValidationLockMetrics;
}

// ---------------------------------------------------------------------------
// Metric calculation helpers (pure functions, exported for testing)
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
export function computeValidationLockMetrics(waitDurations: number[]): ValidationLockMetrics {
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
export function formatPercentForPerformance(value: number | null | undefined, known: boolean): string {
	if (!known || value == null) return "unknown";
	return `${(value * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Journal event parsing for validation lock wait times
// ---------------------------------------------------------------------------

/** Simplified event shape for lock wait extraction. */
interface LockEvent {
	type: string;
	timestamp: number;
	data?: Record<string, unknown>;
}

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
export function extractValidationLockWaitTimes(events: LockEvent[]): number[] {
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

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register performance telemetry routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param getPiDir - Function that returns the .pi directory path
 * @param getWorkspaceRoot - Function that returns the workspace root path
 */
export function registerPerformanceRoutes(
	fastify: FastifyInstance,
	getPiDir: () => string,
	_getWorkspaceRoot: () => string,
): void {
	/**
	 * GET /api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/performance
	 *
	 * Returns detailed performance metrics for a single workspace including:
	 * - Cache hit rate (distinct from "unknown" when not tracked)
	 * - Prefix/suffix token split
	 * - Validation lock wait times
	 */
	fastify.get<{
		Params: { projectId: string; planExecId: string; workspaceId: string };
	}>("/api/projects/:projectId/plans/:planExecId/workspaces/:workspaceId/performance", async (request, reply) => {
		const { planExecId, workspaceId } = request.params;

		try {
			const { getStateStore } = await import("./state-store-provider.js");
			const stateStore = getStateStore();
			const ws = await stateStore.getWorkspaceState(planExecId, workspaceId);

			if (!ws) {
				return reply.code(404).send({ error: "Workspace not found" });
			}

			const piDir = getPiDir();

			// --- Cache performance ---
			let cacheCreationTokens: number | null = null;
			let cacheReadTokens: number | null = null;
			let prefixChars: number | null = null;
			let suffixChars: number | null = null;

			const wsAny = ws as unknown as Record<string, unknown>;
			const maxAttempts = (wsAny.attempts as number) ?? 1;
			for (let a = maxAttempts; a >= 1; a--) {
				const logFile = join(piDir, "workspaces", workspaceId, `execution-${a}.log`);
				if (existsSync(logFile)) {
					const content = await readFile(logFile, "utf-8");
					// Parse cache tokens from log
					for (const line of content.split("<h1>")) {
						const cacheCreationMatch = line.match(/cache_creation_input_tokens[:= ]*(.+)/i);
						if (cacheCreationMatch) {
							cacheCreationTokens = Number(cacheCreationMatch[1].trim()) || null;
						}
						const cacheReadMatch = line.match(/cache_read_input_tokens[:= ]*(.+)/i);
						if (cacheReadMatch) {
							cacheReadTokens = Number(cacheReadMatch[1].trim()) || null;
						}
					}
					// Parse prefix/suffix char counts from log
					const prefixMatch = content.match(/Prefix chars: (.+)/);
					if (prefixMatch) prefixChars = Number(prefixMatch[1].trim()) || null;
					const suffixMatch = content.match(/Suffix chars: (.+)/);
					if (suffixMatch) suffixChars = Number(suffixMatch[1].trim()) || null;
					break;
				}
			}

			const { rate: cacheHitRate, known: cacheHitRateKnown } = computeCacheHitRate(
				cacheCreationTokens,
				cacheReadTokens,
			);
			const tokenSplit = computeTokenSplit(prefixChars, suffixChars);

			// --- Validation lock metrics ---
			let validationLockWaitTimes: number[] = [];
			try {
				const journal = await stateStore.readJournal(planExecId);
				// Lock events may not be in the JournalEventType union yet; cast broadly
				const lockEvents: LockEvent[] = journal
					.filter(
						(e) =>
							e.workspaceId === workspaceId &&
							((e.type as string) === "validation_lock_waiting" ||
								(e.type as string) === "validation_lock_acquired"),
					)
					.map((e) => ({
						type: e.type as string,
						timestamp: e.timestamp,
						data: e.data,
					}));
				validationLockWaitTimes = extractValidationLockWaitTimes(lockEvents);
			} catch {
				validationLockWaitTimes = [];
			}

			const validationLock = computeValidationLockMetrics(validationLockWaitTimes);

			const metrics: WorkspacePerformanceMetricsFull = {
				workspaceId,
				cache: {
					cacheHitRate,
					cacheHitRateKnown,
					cacheCreationInputTokens: cacheCreationTokens,
					cacheReadInputTokens: cacheReadTokens,
				},
				tokenSplit,
				validationLock,
			};

			return metrics;
		} catch (error) {
			fastify.log.error({ error }, "Failed to get workspace performance");
			return reply.code(500).send({ error: "Failed to get workspace performance", message: String(error) });
		}
	});

	/**
	 * GET /api/projects/:projectId/plans/:planExecId/performance
	 *
	 * Returns aggregated performance metrics across all workspaces.
	 */
	fastify.get<{
		Params: { projectId: string; planExecId: string };
	}>("/api/projects/:projectId/plans/:planExecId/performance", async (request, reply) => {
		const { planExecId } = request.params;

		try {
			const { getStateStore } = await import("./state-store-provider.js");
			const stateStore = getStateStore();
			const state = await stateStore.loadState(planExecId);

			if (!state) {
				return reply.code(404).send({ error: "Plan execution not found" });
			}

			const stateAny = state as unknown as Record<string, unknown>;
			const workspaces = (stateAny.workspaces as Array<Record<string, unknown>>) ?? [];
			let totalCacheCreation = 0;
			let totalCacheRead = 0;
			let hasAnyCacheData = false;
			let totalLockWaits = 0;
			let allLockWaitTimes: number[] = [];

			for (const ws of workspaces) {
				if (ws.cacheCreationInputTokens != null) {
					totalCacheCreation += ws.cacheCreationInputTokens as number;
					hasAnyCacheData = true;
				}
				if (ws.cacheReadInputTokens != null) {
					totalCacheRead += ws.cacheReadInputTokens as number;
					hasAnyCacheData = true;
				}
				if (ws.validationLockWaits) {
					totalLockWaits += ws.validationLockWaits as number;
				}
				if (ws.validationLockWaitTimes) {
					allLockWaitTimes = allLockWaitTimes.concat(ws.validationLockWaitTimes as number[]);
				}
			}

			const { rate: cacheHitRate, known: cacheHitRateKnown } = hasAnyCacheData
				? computeCacheHitRate(totalCacheCreation || null, totalCacheRead || null)
				: { rate: null, known: false };

			const validationLock = computeValidationLockMetrics(allLockWaitTimes);

			return {
				planExecId,
				cache: {
					cacheHitRate,
					cacheHitRateKnown,
					cacheCreationInputTokens: hasAnyCacheData ? totalCacheCreation : null,
					cacheReadInputTokens: hasAnyCacheData ? totalCacheRead : null,
				},
				validationLock: {
					...validationLock,
					lockWaits: totalLockWaits || validationLock.lockWaits,
				},
				workspaceCount: workspaces.length,
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to get plan performance");
			return reply.code(500).send({ error: "Failed to get plan performance", message: String(error) });
		}
	});
}
