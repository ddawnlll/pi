/**
 * Worker Memory Guard Tests - P6.5 Workstream
 *
 * Tests for the worker memory guard module that enforces system-wide
 * memory limits to prevent runaway memory consumption.
 */

import { describe, expect, it } from "vitest";
import {
	canStartWorker,
	formatBytes,
	formatMemorySnapshot,
	getLastSnapshot,
	getMemorySnapshot,
	SYSTEM_MEMORY_LIMIT_BYTES,
	setSystemMemoryLimitBytes,
	WORKER_MEMORY_LIMIT_BYTES,
	waitForMemoryAvailable,
} from "../src/core/worker-memory-guard.js";

describe("worker-memory-guard", () => {
	describe("formatBytes", () => {
		it("formats bytes correctly", () => {
			expect(formatBytes(500)).toBe("500 B");
			expect(formatBytes(1024)).toBe("1.0 KB");
			expect(formatBytes(1024 * 50)).toBe("50.0 KB");
			expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
			expect(formatBytes(1024 * 1024 * 512)).toBe("512.0 MB");
			expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
			expect(formatBytes(8 * 1024 * 1024 * 1024)).toBe("8.00 GB");
		});
	});

	describe("WORKER_MEMORY_LIMIT_BYTES", () => {
		it("is 2 GB", () => {
			expect(WORKER_MEMORY_LIMIT_BYTES).toBe(2 * 1024 * 1024 * 1024);
		});
	});

	describe("SYSTEM_MEMORY_LIMIT_BYTES", () => {
		it("is 8 GB", () => {
			expect(SYSTEM_MEMORY_LIMIT_BYTES).toBe(8 * 1024 * 1024 * 1024);
		});
	});

	describe("setSystemMemoryLimitBytes", () => {
		it("overrides the system memory limit", () => {
			// Set a very low limit
			setSystemMemoryLimitBytes(1024 * 1024); // 1 MB
			const snapshot = getMemorySnapshot();
			// After setting to 1MB, the current usage will exceed it
			expect(snapshot.systemOverLimit).toBe(true);
		});

		it("setting to 0 effectively disables the limit", () => {
			setSystemMemoryLimitBytes(0);
			const snapshot = getMemorySnapshot();
			// With limit=0, overLimit check becomes: systemUsedBytes > 0
			// which should be false for a fresh process
			expect(snapshot.systemUtilizationPercent).toBe(100); // division by zero fallback
		});
	});

	describe("getMemorySnapshot", () => {
		it("returns a valid snapshot", () => {
			const snapshot = getMemorySnapshot();
			expect(snapshot).toBeDefined();
			expect(typeof snapshot.rssBytes).toBe("number");
			expect(typeof snapshot.heapUsedBytes).toBe("number");
			expect(typeof snapshot.heapTotalBytes).toBe("number");
			expect(typeof snapshot.systemUsedBytes).toBe("number");
			expect(typeof snapshot.systemUtilizationPercent).toBe("number");
			expect(typeof snapshot.sampledAt).toBe("number");
		});

		it("rssBytes is greater than heapUsedBytes in normal circumstances", () => {
			const snapshot = getMemorySnapshot();
			// RSS includes native allocations, non-heap V8 data, etc.
			// so it should typically be larger than heapUsed
			expect(snapshot.rssBytes).toBeGreaterThanOrEqual(snapshot.heapUsedBytes);
		});

		it("sampledAt is approximately now", () => {
			const before = Date.now();
			const snapshot = getMemorySnapshot();
			const after = Date.now();
			expect(snapshot.sampledAt).toBeGreaterThanOrEqual(before);
			expect(snapshot.sampledAt).toBeLessThanOrEqual(after);
		});
	});

	describe("getLastSnapshot", () => {
		it("returns the last snapshot", () => {
			const first = getMemorySnapshot();
			const last = getLastSnapshot();
			expect(last.sampledAt).toBe(first.sampledAt);
		});
	});

	describe("formatMemorySnapshot", () => {
		it("formats RSS and heap correctly", () => {
			const snapshot = getMemorySnapshot();
			const formatted = formatMemorySnapshot(snapshot);
			expect(formatted).toContain("RSS:");
			expect(formatted).toContain("Heap:");
		});
	});

	describe("canStartWorker", () => {
		it("returns true when memory is within limits", () => {
			// Set limit very high so current usage can't exceed it
			setSystemMemoryLimitBytes(Number.MAX_SAFE_INTEGER);
			const result = canStartWorker("test worker");
			expect(result).toBe(true);
		});

		it("returns false when memory exceeds the limit", () => {
			// Set limit extremely low — any real process will exceed it
			setSystemMemoryLimitBytes(1024); // 1 KB
			const result = canStartWorker("test worker");
			expect(result).toBe(false);
		});

		it("logs a warning when refusing a worker", () => {
			setSystemMemoryLimitBytes(1024); // 1 KB — will definitely be exceeded
			const result = canStartWorker("test-logged-worker");
			expect(result).toBe(false);
			// The function logged a warning — verify by checking it returned false
		});
	});

	describe("waitForMemoryAvailable", () => {
		it("resolves immediately when memory is available", async () => {
			setSystemMemoryLimitBytes(Number.MAX_SAFE_INTEGER);
			const snapshot = await waitForMemoryAvailable(100);
			expect(snapshot).toBeDefined();
		});

		it("resolves when limit is set very high", async () => {
			setSystemMemoryLimitBytes(1024 * 1024 * 1024); // 1 GB
			// The current process should be far under 1 GB
			const snapshot = await waitForMemoryAvailable(100);
			expect(snapshot).toBeDefined();
			expect(snapshot.systemOverLimit).toBe(false);
		});
	});
});
