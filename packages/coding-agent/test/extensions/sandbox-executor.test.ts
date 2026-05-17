/**
 * Tests for SandboxExecutor.
 *
 * Covers:
 * - require is undefined inside vm.createContext()
 * - Timeout exceeding 31s triggers SANDBOX_TIMEOUT
 * - Memory limit exceeded triggers SANDBOX_OOM
 * - Successful execution returns SandboxResult
 * - console.log works inside sandbox, safely transmitted to outside
 */

import { describe, it, expect } from "vitest";
import { SandboxExecutor, SANDBOX_TIMEOUT, SANDBOX_OOM } from "../../src/extensions/sandbox/sandbox-executor.js";

// ============================================================================
// Sandbox Isolation
// ============================================================================

describe("SandboxExecutor", () => {
	describe("context isolation", () => {
		it("should not have require inside sandbox (typeof require is 'undefined')", async () => {
			const result = await SandboxExecutor.run("typeof require");
			expect(result.success).toBe(true);
			expect(result.output).toBe("undefined");
		});

		it("should not have process inside sandbox", async () => {
			const result = await SandboxExecutor.run("typeof process");
			expect(result.success).toBe(true);
			expect(result.output).toBe("undefined");
		});

		it("should not have __dirname inside sandbox", async () => {
			const result = await SandboxExecutor.run("typeof __dirname");
			expect(result.success).toBe(true);
			expect(result.output).toBe("undefined");
		});

		it("should not have __filename inside sandbox", async () => {
			const result = await SandboxExecutor.run("typeof __filename");
			expect(result.success).toBe(true);
			expect(result.output).toBe("undefined");
		});

		it("should not have globalThis inside sandbox", async () => {
			const result = await SandboxExecutor.run("typeof globalThis");
			expect(result.success).toBe(true);
			expect(result.output).toBe("undefined");
		});

		it("require('fs') should return undefined inside sandbox", async () => {
			const result = await SandboxExecutor.run("typeof require !== 'undefined' ? require('fs') : 'require is undefined'");
			expect(result.success).toBe(true);
			expect(result.output).toBe("require is undefined");
		});
	});

	// ========================================================================
	// Console Capture
	// ========================================================================

	describe("console capture", () => {
		it("should capture console.log inside sandbox", async () => {
			const result = await SandboxExecutor.run('console.log("hello world"); 42');
			expect(result.success).toBe(true);
			expect(result.output).toBe(42);
			expect(result.logs).toHaveLength(1);
			expect(result.logs[0]).toEqual({ type: "log", text: "hello world" });
		});

		it("should capture multiple console calls", async () => {
			const result = await SandboxExecutor.run(`
				console.log("first");
				console.error("second");
				console.warn("third");
				"done"
			`);
			expect(result.success).toBe(true);
			expect(result.logs).toHaveLength(3);
			expect(result.logs[0]).toEqual({ type: "log", text: "first" });
			expect(result.logs[1]).toEqual({ type: "error", text: "second" });
			expect(result.logs[2]).toEqual({ type: "warn", text: "third" });
		});

		it("should capture console.log with multiple arguments", async () => {
			const result = await SandboxExecutor.run('console.log("a", "b", 3); null');
			expect(result.success).toBe(true);
			expect(result.logs[0].text).toBe("a b 3");
		});
	});

	// ========================================================================
	// Timeout
	// ========================================================================

	describe("timeout enforcement", () => {
		it("should timeout with SANDBOX_TIMEOUT when execution exceeds timeoutMs", async () => {
			const startTime = Date.now();
			const result = await SandboxExecutor.run("while(true) {}", undefined, { timeoutMs: 1500 });
			const elapsed = Date.now() - startTime;

			expect(result.success).toBe(false);
			expect(result.errorType).toBe(SANDBOX_TIMEOUT);
			expect(result.error).toContain("timed out");
			expect(result.exitCode).toBe(124);
			// Should have taken at least 1.5s but not excessively more
			expect(elapsed).toBeGreaterThanOrEqual(1300);
			expect(elapsed).toBeLessThan(10000); // generous upper bound
		}, 15000);

		it("should return SANDBOX_TIMEOUT with errorType for long-running code", async () => {
			const result = await SandboxExecutor.run(
				"while(true) {}",
				undefined,
				{ timeoutMs: 500 },
			);
			expect(result.success).toBe(false);
			expect(result.errorType).toBe(SANDBOX_TIMEOUT);
			expect(result.error).toContain("timed out");
		}, 10000);
	});

	// ========================================================================
	// Memory Limit
	// ========================================================================

	describe("memory limit enforcement", () => {
		it("should fail with SANDBOX_OOM when memory limit is exceeded", async () => {
			// Use a small memory limit (enough for V8 to start but small enough
			// that the allocation loop triggers it quickly). vm.Script's
			// resourceLimits enforce this per-execution within the Worker.
			const result = await SandboxExecutor.run(
				`
					const arr = [];
					while (true) {
						arr.push(new Array(100000).fill("x"));
					}
				`,
				undefined,
				{ maxMemoryMB: 50 },
			);
			expect(result.success).toBe(false);
			expect(result.errorType).toBe(SANDBOX_OOM);
			expect(result.error).toBeTruthy();
			expect(result.exitCode).toBe(137);
		}, 30000);
	});

	// ========================================================================
	// Successful Execution
	// ========================================================================

	describe("successful execution", () => {
		it("should return successful SandboxResult for simple expression", async () => {
			const result = await SandboxExecutor.run("1 + 2");
			expect(result.success).toBe(true);
			expect(result.output).toBe(3);
			expect(typeof result.durationMs).toBe("number");
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
			expect(result.exitCode).toBe(0);
			expect(Array.isArray(result.logs)).toBe(true);
		});

		it("should return the last expression value", async () => {
			const result = await SandboxExecutor.run(`
				const x = 10;
				const y = 20;
				x + y
			`);
			expect(result.success).toBe(true);
			expect(result.output).toBe(30);
		});

		it("should handle string return values", async () => {
			const result = await SandboxExecutor.run('"hello from sandbox"');
			expect(result.success).toBe(true);
			expect(result.output).toBe("hello from sandbox");
		});

		it("should handle object return values", async () => {
			const result = await SandboxExecutor.run('({ a: 1, b: "two" })');
			expect(result.success).toBe(true);
			expect(result.output).toEqual({ a: 1, b: "two" });
		});

		it("should handle null return", async () => {
			const result = await SandboxExecutor.run("null");
			expect(result.success).toBe(true);
			expect(result.output).toBeNull();
		});

		it("should handle undefined return", async () => {
			const result = await SandboxExecutor.run("undefined");
			expect(result.success).toBe(true);
			expect(result.output).toBeUndefined();
		});
	});

	// ========================================================================
	// Error Handling
	// ========================================================================

	describe("error handling", () => {
		it("should catch syntax errors", async () => {
			const result = await SandboxExecutor.run("syntax error {{{");
			expect(result.success).toBe(false);
			expect(result.error).toBeTruthy();
		});

		it("should catch runtime errors", async () => {
			const result = await SandboxExecutor.run("throw new Error('boom')");
			expect(result.success).toBe(false);
			expect(result.error).toContain("boom");
		});

		it("should capture console.log before error", async () => {
			const result = await SandboxExecutor.run(`
				console.log("before error");
				throw new Error("oops");
			`);
			expect(result.success).toBe(false);
			expect(result.logs).toHaveLength(1);
			expect(result.logs[0].text).toBe("before error");
			expect(result.error).toContain("oops");
		});
	});
});
