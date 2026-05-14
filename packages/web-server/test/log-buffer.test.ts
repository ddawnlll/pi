/**
 * Tests for LogBuffer — batched log flushing to state store
 */
import { describe, expect, it } from "vitest";
import { LogBuffer } from "../src/plan-runner.js";

describe("LogBuffer", () => {
	it("should flush immediately when 50 lines accumulate", async () => {
		const batches: string[] = [];
		const buffer = new LogBuffer("test-plan", {
			saveExecutionLog: async (_id: string, batch: string) => {
				batches.push(batch);
			},
		});

		// Append 50 lines — triggers immediate flush
		for (let i = 0; i < 50; i++) {
			buffer.append(`line ${i}\n`);
		}

		// The flush is async; wait a microtask for the promise to settle
		await new Promise<void>((resolve) => queueMicrotask(resolve));

		expect(batches).toHaveLength(1);
		expect(batches[0]).toContain("line 0");
		expect(batches[0]).toContain("line 49");

		// Buffer should be empty after flush
		await buffer.dispose();
		// No additional flush should have happened
	});

	it("should flush via timer when fewer than 50 lines accumulate", async () => {
		const batches: string[] = [];
		const buffer = new LogBuffer("test-plan", {
			saveExecutionLog: async (_id: string, batch: string) => {
				batches.push(batch);
			},
		});

		buffer.append("line 0\n");
		buffer.append("line 1\n");

		// Wait for the 5-second timer to fire — use dispose to force it
		await buffer.dispose();

		expect(batches).toHaveLength(1);
		expect(batches[0]).toContain("line 0");
		expect(batches[0]).toContain("line 1");
	});

	it("should cancel pending timer when 50-line threshold is hit", async () => {
		const batches: string[] = [];
		const buffer = new LogBuffer("test-plan", {
			saveExecutionLog: async (_id: string, batch: string) => {
				batches.push(batch);
			},
		});

		// Append 49 lines — timer scheduled but not fired
		for (let i = 0; i < 49; i++) {
			buffer.append(`line ${i}\n`);
		}

		// The 50th line triggers immediate flush and cancels the timer
		buffer.append("line 49\n");

		await new Promise<void>((resolve) => queueMicrotask(resolve));

		expect(batches).toHaveLength(1);
		expect(batches[0]).toContain("line 0");
		expect(batches[0]).toContain("line 49");

		// Dispose should not double-flush
		await buffer.dispose();
		expect(batches).toHaveLength(1);
	});

	it("should not double-flush on second dispose()", async () => {
		const batches: string[] = [];
		const buffer = new LogBuffer("test-plan", {
			saveExecutionLog: async (_id: string, batch: string) => {
				batches.push(batch);
			},
		});

		buffer.append("line 0\n");
		await buffer.dispose();

		expect(batches).toHaveLength(1);

		// Second dispose is a no-op
		await buffer.dispose();
		expect(batches).toHaveLength(1);
	});

	it("should be a no-op calling dispose() on an empty buffer", async () => {
		const batches: string[] = [];
		const buffer = new LogBuffer("test-plan", {
			saveExecutionLog: async (_id: string, batch: string) => {
				batches.push(batch);
			},
		});

		await buffer.dispose();
		expect(batches).toHaveLength(0);

		// Second dispose still no-op
		await buffer.dispose();
		expect(batches).toHaveLength(0);
	});

	it("should flush remaining lines on dispose() before timer fires", async () => {
		const batches: string[] = [];
		const buffer = new LogBuffer("test-plan", {
			saveExecutionLog: async (_id: string, batch: string) => {
				batches.push(batch);
			},
		});

		// Append 3 lines — timer is scheduled but won't fire for 5 seconds
		buffer.append("a\n");
		buffer.append("b\n");
		buffer.append("c\n");

		// Dispose cancels the timer and flushes immediately
		await buffer.dispose();

		expect(batches).toHaveLength(1);
		expect(batches[0]).toBe("a\nb\nc\n");
	});

	it("should concatenate multiple lines into a single batch", async () => {
		const batches: string[] = [];
		const buffer = new LogBuffer("test-plan", {
			saveExecutionLog: async (_id: string, batch: string) => {
				batches.push(batch);
			},
		});

		buffer.append("first\n");
		buffer.append("second\n");
		buffer.append("third\n");

		await buffer.dispose();

		expect(batches).toHaveLength(1);
		expect(batches[0]).toBe("first\nsecond\nthird\n");
	});

	it("should handle errors from saveExecutionLog gracefully", async () => {
		const buffer = new LogBuffer("test-plan", {
			saveExecutionLog: async () => {
				throw new Error("storage failure");
			},
		});

		// Should not throw
		buffer.append("line 0\n");
		buffer.append("line 1\n");

		await expect(buffer.dispose()).resolves.toBeUndefined();
	});
});
