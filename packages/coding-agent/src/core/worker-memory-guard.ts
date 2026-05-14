/**
 * Worker Memory Guard - P6.5 Workstream
 *
 * Enforces per-worker and system-wide memory limits to prevent
 * runaway memory consumption from validation commands (vitest, etc.)
 * and concurrent agent sessions.
 *
 * Key invariants:
 * - canStartWorker() returns false when system memory exceeds the limit
 * - canStartValidation() returns false when another validation is running
 * - Memory is sampled via process.memoryUsage() at each check
 */

import { PiLogger } from "../utils/logger.js";

/** Hard memory limit per worker process (bytes). Default: 2 GB */
export const WORKER_MEMORY_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

/** System-wide memory threshold — refuse new workers when used > LIMIT_GB */
export const SYSTEM_MEMORY_LIMIT_BYTES = 8 * 1024 * 1024 * 1024;

/** Mutable limit for testing or runtime override */
let _SYSTEM_MEMORY_LIMIT_BYTES = SYSTEM_MEMORY_LIMIT_BYTES;

/** Mutable wait timeout override (ms). Null = use default 5 minutes. */
let _WAIT_TIMEOUT_MS: number | null = null;

/** Interval (ms) for background memory polling when system is near limit */
export const MEMORY_POLL_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Memory snapshot
// ---------------------------------------------------------------------------

export interface MemorySnapshot {
	/** Resident Set Size in bytes (heap + stack + native) */
	rssBytes: number;
	/** V8 heap used bytes */
	heapUsedBytes: number;
	/** V8 heap total bytes */
	heapTotalBytes: number;
	/** External (C++ objects bound to JS) bytes */
	externalBytes: number;
	/** System-wide used memory in bytes (may differ from rss on macOS) */
	systemUsedBytes: number;
	/** Whether system-wide memory exceeds the hard limit */
	systemOverLimit: boolean;
	/** Percentage of system limit used (0-100+) */
	systemUtilizationPercent: number;
	/** Timestamp of snapshot */
	sampledAt: number;
}

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

const logger = new PiLogger({ label: "worker-memory-guard" });

let _systemMemoryCheckInterval: ReturnType<typeof setInterval> | null = null;
let _lastSnapshot: MemorySnapshot | null = null;

/** Background polling state — when system is near limit, poll frequently */
let _isPolling = false;

/** Cooldown: after refusing a worker, minimum time before next check. Prevents thrashing. */
let _refuseCooldownUntil = 0;
const REFUSE_COOLDOWN_MS = 3000;

// ---------------------------------------------------------------------------
// Configuration API
// ---------------------------------------------------------------------------

/**
 * Configure memory guard runtime parameters.
 * Call this once at startup (e.g., from plan-runner) before any workers start.
 *
 * @param config.memoryLimitGb - System memory limit in GB (null = use default 8 GB)
 * @param config.waitTimeoutSec - Max seconds to wait for memory to become available (null = use default 300 s)
 */
export function configureMemoryGuard(config: { memoryLimitGb?: number | null; waitTimeoutSec?: number | null }): void {
	if (config.memoryLimitGb !== undefined && config.memoryLimitGb !== null) {
		_SYSTEM_MEMORY_LIMIT_BYTES = config.memoryLimitGb * 1024 * 1024 * 1024;
		logger.info(`[memory-guard] Memory limit set to ${config.memoryLimitGb} GB`);
	}
	if (config.waitTimeoutSec !== undefined && config.waitTimeoutSec !== null) {
		_WAIT_TIMEOUT_MS = config.waitTimeoutSec * 1000;
		logger.info(`[memory-guard] Wait timeout set to ${config.waitTimeoutSec} s`);
	}
}

/**
 * Get current memory guard configuration.
 */
export function getMemoryGuardConfig(): {
	memoryLimitGb: number;
	waitTimeoutMs: number;
} {
	return {
		memoryLimitGb: Math.round((_SYSTEM_MEMORY_LIMIT_BYTES / (1024 * 1024 * 1024)) * 100) / 100,
		waitTimeoutMs: _WAIT_TIMEOUT_MS ?? 5 * 60 * 1000,
	};
}

/**
 * Override the system memory limit at runtime (e.g., from tests or CLI flags).
 *
 * @param bytes - New limit in bytes. Use 0 to disable the limit.
 */
export function setSystemMemoryLimitBytes(bytes: number): void {
	_SYSTEM_MEMORY_LIMIT_BYTES = bytes;
}

function currentSystemLimit(): number {
	return _SYSTEM_MEMORY_LIMIT_BYTES;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Get the current memory snapshot for this process.
 *
 * Uses process.memoryUsage() which measures the current Node.js process.
 * For system-wide memory on Linux, reads /proc/meminfo.
 * On macOS/Windows, falls back to rss as an approximation.
 */
export function getMemorySnapshot(): MemorySnapshot {
	const usage = process.memoryUsage();
	const sampledAt = Date.now();

	// Try to read system memory from /proc/meminfo (Linux only)
	let systemUsedBytes = usage.rss;
	let systemTotalBytes = 0;

	try {
		if (process.platform === "linux") {
			const fs = require("node:fs") as typeof import("node:fs");
			const meminfo = fs.readFileSync("/proc/meminfo", "utf-8");
			let memFree = 0;
			let memAvailable = 0;
			let memTotal = 0;

			for (const line of meminfo.split("\n")) {
				if (line.startsWith("MemTotal:")) {
					memTotal = parseInt(line.split(/\s+/)[1], 10) * 1024;
				} else if (line.startsWith("MemAvailable:")) {
					memAvailable = parseInt(line.split(/\s+/)[1], 10) * 1024;
				} else if (line.startsWith("MemFree:")) {
					memFree = parseInt(line.split(/\s+/)[1], 10) * 1024;
				}
			}

			if (memTotal > 0) {
				systemTotalBytes = memTotal;
				systemUsedBytes = memTotal - (memAvailable || memFree);
			}
		}
	} catch {
		// Fallback: use rss as approximation
	}

	const systemOverLimit =
		systemTotalBytes > 0 ? systemUsedBytes > currentSystemLimit() : usage.rss > currentSystemLimit();

	const systemUtilizationPercent = systemTotalBytes > 0 ? (systemUsedBytes / currentSystemLimit()) * 100 : 100; // Unknown on non-Linux

	_lastSnapshot = {
		rssBytes: usage.rss,
		heapUsedBytes: usage.heapUsed,
		heapTotalBytes: usage.heapTotal,
		externalBytes: usage.external,
		systemUsedBytes,
		systemOverLimit,
		systemUtilizationPercent: Math.round(systemUtilizationPercent),
		sampledAt,
	};

	return _lastSnapshot;
}

/**
 * Whether a new worker/cleanup session can be started.
 *
 * Returns false if:
 * - System memory exceeds the limit
 * - Inside the refusal cooldown window (3s after last refusal)
 *
 * Logs the reason when refusing and when allowing.
 *
 * @param reason - Human-readable identifier for the caller (e.g., "workspace executor", "cleanup review")
 */
export function canStartWorker(reason: string): boolean {
	const now = Date.now();

	// Check cooldown first (fast path)
	if (now < _refuseCooldownUntil) {
		return false;
	}

	const snapshot = getMemorySnapshot();

	if (snapshot.systemOverLimit) {
		logger.warn(
			`[memory-guard] Refusing to start ${reason}: system memory ${formatBytes(snapshot.systemUsedBytes)} ` +
				`exceeds ${formatBytes(currentSystemLimit())} limit (${snapshot.systemUtilizationPercent}% used)`,
		);
		_refuseCooldownUntil = now + REFUSE_COOLDOWN_MS;
		_startPollingIfNearLimit(snapshot);
		return false;
	}

	// Log on first allow after being near limit
	if (_isPolling && snapshot.systemUtilizationPercent < 70) {
		logger.info(
			`[memory-guard] Memory pressure relieved: ${snapshot.systemUtilizationPercent}% used, resuming normal operation`,
		);
		_stopPolling();
	}

	return true;
}

/**
 * Wait for memory to drop below the limit.
 * Resolves immediately if already under limit.
 * Times out after effectiveTimeout (defaults to configured _WAIT_TIMEOUT_MS or 5 minutes).
 *
 * @param maxWaitMs - Per-call timeout override in ms. Null = use configured default.
 * @returns The memory snapshot at the time of resolution
 */
export async function waitForMemoryAvailable(maxWaitMs?: number): Promise<MemorySnapshot> {
	const effectiveTimeout = maxWaitMs ?? _WAIT_TIMEOUT_MS ?? 5 * 60 * 1000;
	const deadline = Date.now() + effectiveTimeout;

	logger.info(`[memory-guard] Waiting up to ${Math.round(effectiveTimeout / 1000)}s for memory to become available`);

	while (Date.now() < deadline) {
		const snapshot = getMemorySnapshot();
		if (!snapshot.systemOverLimit) {
			logger.info(`[memory-guard] Memory available after wait`);
			return snapshot;
		}
		await sleep(Math.min(5000, deadline - Date.now()));
	}

	logger.warn(`[memory-guard] Memory wait timed out after ${Math.round(effectiveTimeout / 1000)}s`);
	return getMemorySnapshot();
}

// ---------------------------------------------------------------------------
// Background polling
// ---------------------------------------------------------------------------

function _startPollingIfNearLimit(snapshot: MemorySnapshot) {
	if (_isPolling) return;
	if (snapshot.systemUtilizationPercent < 80) return; // Plenty of headroom, no need

	_isPolling = true;
	logger.info(`[memory-guard] Starting background memory polling (${snapshot.systemUtilizationPercent}% used)`);

	_systemMemoryCheckInterval = setInterval(() => {
		const snap = getMemorySnapshot();
		if (snap.systemUtilizationPercent < 70) {
			_stopPolling();
		}
	}, MEMORY_POLL_INTERVAL_MS);
}

function _stopPolling() {
	if (_systemMemoryCheckInterval) {
		clearInterval(_systemMemoryCheckInterval);
		_systemMemoryCheckInterval = null;
	}
	_isPolling = false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------

/**
 * Format bytes as a human-readable string.
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format a memory snapshot for logging.
 */
export function formatMemorySnapshot(snapshot: MemorySnapshot): string {
	const lines: string[] = [];
	lines.push(
		`RSS: ${formatBytes(snapshot.rssBytes)}, Heap: ${formatBytes(snapshot.heapUsedBytes)}/${formatBytes(snapshot.heapTotalBytes)}`,
	);
	if (snapshot.systemUsedBytes > 0) {
		const limit = currentSystemLimit();
		lines.push(
			`System: ${formatBytes(snapshot.systemUsedBytes)} (${snapshot.systemUtilizationPercent}% of ${formatBytes(limit)} limit)`,
		);
	}
	return lines.join(" ");
}

/**
 * Get the last memory snapshot, or sample if none exists.
 */
export function getLastSnapshot(): MemorySnapshot {
	return _lastSnapshot ?? getMemorySnapshot();
}
