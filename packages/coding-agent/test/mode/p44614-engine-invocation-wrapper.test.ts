import { describe, expect, it } from "vitest";
import { CircuitBreaker, invokeEngine } from "../../src/execution-runtime/engine-invocation-wrapper.js";

describe("CircuitBreaker", () => {
	it("starts in closed state", () => {
		const cb = new CircuitBreaker();
		expect(cb.getState()).toBe("closed");
	});

	it("returns success for successful invocations", async () => {
		const cb = new CircuitBreaker({ maxRetries: 0, failureThreshold: 3 });
		const result = await invokeEngine(async () => "ok", cb);
		expect(result.success).toBe(true);
		expect(result.value).toBe("ok");
	});

	it("opens circuit after failure threshold", async () => {
		const cb = new CircuitBreaker({ maxRetries: 0, failureThreshold: 2 });
		await invokeEngine(async () => {
			throw new Error("fail");
		}, cb);
		await invokeEngine(async () => {
			throw new Error("fail");
		}, cb);
		expect(cb.getState()).toBe("open");
	});

	it("rejects requests when circuit is open", async () => {
		const cb = new CircuitBreaker({ maxRetries: 0, failureThreshold: 1, circuitResetTimeoutMs: 60000 });
		await invokeEngine(async () => {
			throw new Error("fail");
		}, cb);
		const result = await invokeEngine(async () => "ok", cb);
		expect(result.success).toBe(false);
		expect(result.circuitState).toBe("open");
	});

	it("retries on failure", async () => {
		let attempts = 0;
		const cb = new CircuitBreaker({ maxRetries: 2, failureThreshold: 5 });
		const result = await invokeEngine(async () => {
			attempts++;
			if (attempts < 3) throw new Error("retry");
			return "success";
		}, cb);
		expect(result.success).toBe(true);
		expect(result.value).toBe("success");
		expect(result.attempts).toBe(3);
	});
});
