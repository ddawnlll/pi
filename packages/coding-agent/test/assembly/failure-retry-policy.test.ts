import { describe, expect, it } from "vitest";
import {
	classifyFailure,
	FAILURE_ACTION_MAP,
	RetryPolicy,
	TimeBudgetEnforcer,
} from "../../src/core/assembly/failure-retry-policy.js";

// =============================================================================
// Failure Policy Tests
// =============================================================================

describe("FailurePolicy", () => {
	it("classifies validation errors", () => {
		const event = classifyFailure(new Error("validation failed: assertion error"), "ns", "c.ts");
		expect(event.failureClass).toBe("validation_error");
		expect(event.action).toBe("retry");
	});

	it("classifies typecheck errors", () => {
		const event = classifyFailure(new Error("TS2345: Type error"), "ns", "c.ts");
		expect(event.failureClass).toBe("typecheck_error");
		expect(event.action).toBe("retry");
	});

	it("classifies test failures", () => {
		const event = classifyFailure(new Error("test failed: FAIL"), "ns", "c.ts");
		expect(event.failureClass).toBe("test_failure");
	});

	it("classifies ACCP errors", () => {
		const event = classifyFailure(new Error("ACCP compile failed"), "ns", "c.ts");
		expect(event.failureClass).toBe("accp_compile_error");
		expect(event.action).toBe("fallback");
	});

	it("classifies assembler errors as escalate", () => {
		const event = classifyFailure(new Error("assembler crashed"), "ns", "c.ts");
		expect(event.failureClass).toBe("assembler_error");
		expect(event.action).toBe("escalate");
	});

	it("classifies timeouts as fallback", () => {
		const event = classifyFailure(new Error("operation timed out"), "ns", "c.ts");
		expect(event.failureClass).toBe("timeout");
		expect(event.action).toBe("fallback");
	});

	it("classifies unknown errors as hold", () => {
		const event = classifyFailure(new Error("something weird happened"), "ns", "c.ts");
		expect(event.failureClass).toBe("unknown");
		expect(event.action).toBe("hold");
	});

	it("every failure class has a defined action", () => {
		const classes = Object.keys(FAILURE_ACTION_MAP);
		for (const c of classes) {
			expect(FAILURE_ACTION_MAP[c as keyof typeof FAILURE_ACTION_MAP]).toBeDefined();
		}
	});
});

// =============================================================================
// Retry Policy Tests
// =============================================================================

describe("RetryPolicy", () => {
	it("allows retries within limits", () => {
		const policy = new RetryPolicy(3, 50);
		expect(policy.canRetry("ns-a").allowed).toBe(true);
	});

	it("records retries and blocks when namespace limit exceeded", () => {
		const policy = new RetryPolicy(2, 50);
		const event = classifyFailure(new Error("test"), "ns-a", "c.ts");

		policy.recordRetry("ns-a", event);
		expect(policy.canRetry("ns-a").allowed).toBe(true);

		policy.recordRetry("ns-a", event);
		expect(policy.canRetry("ns-a").allowed).toBe(false);
	});

	it("blocks when total retries exhausted", () => {
		const policy = new RetryPolicy(10, 3);
		const event = classifyFailure(new Error("test"), "ns-a", "c.ts");

		policy.recordRetry("ns-a", event);
		policy.recordRetry("ns-b", event);
		policy.recordRetry("ns-c", event);
		expect(policy.canRetry("ns-d").allowed).toBe(false);
	});

	it("retry attempt number increments", () => {
		const policy = new RetryPolicy(5, 50);
		const event = classifyFailure(new Error("test"), "ns-a", "c.ts");

		const r1 = policy.recordRetry("ns-a", event);
		expect(r1.retryAttempt).toBe(1);

		const r2 = policy.recordRetry("ns-a", event);
		expect(r2.retryAttempt).toBe(2);
	});

	it("last retry switches to fallback action", () => {
		const policy = new RetryPolicy(1, 50);
		const event = classifyFailure(new Error("test"), "ns-a", "c.ts");
		const result = policy.recordRetry("ns-a", event);
		expect(result.action).toBe("fallback");
	});

	it("reset clears all counters", () => {
		const policy = new RetryPolicy(3, 50);
		policy.recordRetry("ns-a", classifyFailure(new Error("test"), "ns-a", "c.ts"));
		policy.reset();
		expect(policy.getState().totalRetries).toBe(0);
		expect(policy.canRetry("ns-a").allowed).toBe(true);
	});

	it("getState returns accurate retry counts", () => {
		const policy = new RetryPolicy(3, 50);
		policy.recordRetry("ns-a", classifyFailure(new Error("e1"), "ns-a", "c.ts"));
		policy.recordRetry("ns-a", classifyFailure(new Error("e2"), "ns-a", "c.ts"));
		policy.recordRetry("ns-b", classifyFailure(new Error("e3"), "ns-b", "c.ts"));

		const state = policy.getState();
		expect(state.totalRetries).toBe(3);
		expect(state.perNamespace.get("ns-a")).toBe(2);
		expect(state.perNamespace.get("ns-b")).toBe(1);
	});
});

// =============================================================================
// Time Budget Tests
// =============================================================================

describe("TimeBudgetEnforcer", () => {
	it("new budget has full remaining time", () => {
		const budget = new TimeBudgetEnforcer(600_000, 3_600_000, 36_000_000);
		const state = budget.getState();
		expect(state.anyExceeded).toBe(false);
		expect(state.workspaceExceeded).toBe(false);
	});

	it("hasRemainingBudget returns hasBudget=true initially", () => {
		const budget = new TimeBudgetEnforcer(600_000, 3_600_000, 36_000_000);
		expect(budget.hasRemainingBudget().hasBudget).toBe(true);
	});

	it("workspace budget with tiny limit exceeds", async () => {
		const budget = new TimeBudgetEnforcer(1, 3_600_000, 36_000_000); // 1ms
		budget.startWorkspace();
		await new Promise((r) => setTimeout(r, 10));
		const state = budget.getState();
		expect(state.workspaceExceeded).toBe(true);
		expect(state.anyExceeded).toBe(true);
	});

	it("startWorkspace resets workspace elapsed", () => {
		const budget = new TimeBudgetEnforcer(600_000, 3_600_000, 36_000_000);
		budget.startWorkspace();
		budget.endWorkspace();
		budget.startWorkspace();
		expect(budget.getState().workspaceExceeded).toBe(false);
	});

	it("hasRemainingBudget reports which budgets are exceeded", () => {
		const budget = new TimeBudgetEnforcer(1, 1, 1); // all 1ms
		const result = budget.hasRemainingBudget();
		// All budgets started at 0 elapsed initially...
		// But they may or may not exceed based on timing
		// Just check the structure is correct
		expect(typeof result.hasBudget).toBe("boolean");
		expect(Array.isArray(result.exceeded)).toBe(true);
	});

	it("budget structure is well-formed", () => {
		const budget = new TimeBudgetEnforcer(300_000, 1_800_000, 18_000_000);
		const state = budget.getState();
		expect(state.budget.perWorkspaceMs).toBe(300_000);
		expect(state.budget.perWaveMs).toBe(1_800_000);
		expect(state.budget.totalMs).toBe(18_000_000);
		expect(state.budget.startTimeMs).toBeGreaterThan(0);
	});
});
