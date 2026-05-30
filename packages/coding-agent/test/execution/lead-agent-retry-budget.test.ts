/**
 * Lead Agent Retry Budget Tests — P38.LEAD
 *
 * Tests that the retry budget manager correctly tracks failure signatures
 * and enforces budget limits, preventing infinite retry loops.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { RetryBudgetManager } from "../../src/core/lead-agent/retry-budget.js";
import type { FailureSignature } from "../../src/core/lead-agent/types.js";

function makeSignature(
	workspaceId: string,
	signature: string,
	overrides: Partial<FailureSignature> = {},
): FailureSignature {
	return {
		workspaceId,
		planExecId: "pexec_test",
		signature,
		failureClass: "unknown",
		errorMessage: "test error",
		lastCommand: null,
		lastCommandExitCode: null,
		completionGateBlockReasons: [],
		attemptNo: 1,
		firstObservedAt: Date.now(),
		lastObservedAt: Date.now(),
		occurrenceCount: 1,
		...overrides,
	};
}

describe("RetryBudgetManager", () => {
	let budget: RetryBudgetManager;

	beforeEach(() => {
		budget = new RetryBudgetManager();
	});

	describe("same signature retry limits", () => {
		it("allows first occurrence of a new signature", () => {
			const sig = makeSignature("W1", "completion_gate:target_command_not_executed:test.ts");
			const result = budget.recordFailure(sig, false);
			expect(result.decision).toBe("allow_retry");
		});

		it("requires lead review on second occurrence (policy: maxRetriesBeforeLeadReview=2)", () => {
			const sig = makeSignature("W1", "completion_gate:target_command_not_executed:test.ts");

			budget.recordFailure(sig, false); // 1st
			sig.occurrenceCount = 2;
			const result = budget.recordFailure(sig, false); // 2nd — >= threshold

			expect(result.decision).toBe("require_lead_review");
		});

		it("escalates user on third occurrence (policy: maxTotalRetries=3)", () => {
			const sig = makeSignature("W1", "completion_gate:target_command_not_executed:test.ts");

			budget.recordFailure(sig, false); // 1st
			sig.occurrenceCount = 2;
			budget.recordFailure(sig, false); // 2nd
			sig.occurrenceCount = 3;
			const result = budget.recordFailure(sig, false); // 3rd — >= threshold

			expect(result.decision).toBe("escalate_user");
		});

		it("resets signature-specific budget for different signatures", () => {
			const sig1 = makeSignature("W1", "completion_gate:target_command_not_executed:test_a.ts");
			const sig2 = makeSignature("W1", "completion_gate:target_command_not_executed:test_b.ts");

			// Fail with sig1 twice
			budget.recordFailure(sig1, false);
			budget.recordFailure(sig1, false);

			// Fail with sig2 - should be first occurrence
			const result = budget.recordFailure(sig2, false);
			expect(result.decision).toBe("allow_retry");
			expect(result.occurrenceCount).toBe(1);
		});

		it("tracks remaining retries correctly", () => {
			const sig = makeSignature("W1", "completion_gate:target_command_not_executed:test.ts");

			// First occurrence
			const result1 = budget.recordFailure(sig, false);
			expect(result1.retriesBeforeLeadReview).toBe(1); // 2 - 1
			expect(result1.retriesBeforeEscalation).toBe(2); // 3 - 1
		});

		it("blocks retries after escalation", () => {
			const sig = makeSignature("W1", "completion_gate:target_command_not_executed:test.ts");

			budget.recordFailure(sig, false); // 1st
			sig.occurrenceCount = 2;
			budget.recordFailure(sig, false); // 2nd
			sig.occurrenceCount = 3;
			budget.recordFailure(sig, false); // 3rd

			budget.markEscalated(sig);

			sig.occurrenceCount = 4;
			const result = budget.recordFailure(sig, false);
			expect(result.decision).toBe("blocked_escalated");
		});

		it("post-directive retries escalate after threshold", () => {
			const sig = makeSignature("W1", "completion_gate:target_command_not_executed:test.ts");

			budget.recordFailure(sig, false); // 1st
			sig.occurrenceCount = 2;
			budget.recordFailure(sig, false); // 2nd

			budget.markDirectiveIssued(sig);

			sig.occurrenceCount = 3;
			const result = budget.recordFailure(sig, true); // hasActiveDirective=true

			// After directive, maxAdditionalRetries=1, so 3rd occurrence should escalate
			expect(result.decision).toBe("escalate_user");
		});
	});

	describe("budget clearing", () => {
		it("clears budget for a specific workspace", () => {
			const sig1 = makeSignature("W1", "sig_a");
			const sig2 = makeSignature("W2", "sig_a");

			budget.recordFailure(sig1, false);
			budget.recordFailure(sig2, false);

			budget.clearWorkspace("pexec_test", "W1");

			const summaryW1 = budget.getBudgetSummary("pexec_test", "W1");
			expect(summaryW1).toHaveLength(0);

			const summaryW2 = budget.getBudgetSummary("pexec_test", "W2");
			expect(summaryW2).toHaveLength(1);
		});

		it("clears budget for an entire plan", () => {
			const sig = makeSignature("W1", "sig_a");

			budget.recordFailure(sig, false);

			budget.clearPlan("pexec_test");

			const summary = budget.getBudgetSummary("pexec_test", "W1");
			expect(summary).toHaveLength(0);
		});
	});
});
