/**
 * P44.04 — Terminal Verdict Reconciler Tests
 */

import { describe, expect, it } from "vitest";
import {
	type AttemptRecord,
	reconcileTerminalVerdicts,
	TerminalVerdictReconciler,
} from "../../src/core/completion/terminal-reconciler.js";
import { parseTerminalVerdict } from "../../src/core/completion/terminal-verdict-parser.js";

function makeAttempt(attemptNo: number, verdict: "COMPLETE" | "BLOCKED" | "FAILED", error?: string): AttemptRecord {
	return {
		attemptNo,
		verdict,
		confidence: verdict === "COMPLETE" ? "high" : "medium",
		reasoning: error ? `Execution failed: ${error}` : `Attempt ${attemptNo} completed`,
		error,
		completedAt: Date.now() + attemptNo * 1000,
	};
}

// ---------------------------------------------------------------------------
// Reconciler class tests
// ---------------------------------------------------------------------------

describe("TerminalVerdictReconciler", () => {
	it("should return FAILED with no attempts", () => {
		const reconciler = new TerminalVerdictReconciler();
		const result = reconciler.reconcile("ws-1", []);

		expect(result.finalVerdict).toBe("FAILED");
		expect(result.totalAttempts).toBe(0);
		expect(result.isDefinitive).toBe(false);
		expect(result.attempts).toHaveLength(0);
	});

	it("should return COMPLETE if any attempt succeeded", () => {
		const reconciler = new TerminalVerdictReconciler();
		const attempts = [makeAttempt(1, "FAILED", "Error"), makeAttempt(2, "COMPLETE"), makeAttempt(3, "BLOCKED")];
		const result = reconciler.reconcile("ws-1", attempts);

		expect(result.finalVerdict).toBe("COMPLETE");
		expect(result.totalAttempts).toBe(3);
		expect(result.determiningAttempt.attemptNo).toBe(2);
		expect(result.isDefinitive).toBe(true);
	});

	it("should return the last attempt verdict if none succeeded", () => {
		const reconciler = new TerminalVerdictReconciler();
		const attempts = [
			makeAttempt(1, "FAILED", "Error 1"),
			makeAttempt(2, "FAILED", "Error 2"),
			makeAttempt(3, "BLOCKED"),
		];
		const result = reconciler.reconcile("ws-1", attempts);

		expect(result.finalVerdict).toBe("BLOCKED");
		expect(result.totalAttempts).toBe(3);
		expect(result.determiningAttempt.attemptNo).toBe(3);
		expect(result.isDefinitive).toBe(true);
	});

	it("should handle single attempt", () => {
		const reconciler = new TerminalVerdictReconciler();
		const result = reconciler.reconcile("ws-1", [makeAttempt(1, "COMPLETE")]);

		expect(result.finalVerdict).toBe("COMPLETE");
		expect(result.totalAttempts).toBe(1);
	});

	it("should sort attempts by attempt number", () => {
		const reconciler = new TerminalVerdictReconciler();
		const attempts = [makeAttempt(3, "FAILED"), makeAttempt(1, "COMPLETE"), makeAttempt(2, "FAILED")];
		const result = reconciler.reconcile("ws-1", attempts);

		expect(result.finalVerdict).toBe("COMPLETE");
		expect(result.determiningAttempt.attemptNo).toBe(1);
	});

	it("should clamp to maxAttempts", () => {
		const reconciler = new TerminalVerdictReconciler({ maxAttempts: 2 });
		const attempts = [makeAttempt(1, "FAILED"), makeAttempt(2, "FAILED"), makeAttempt(3, "COMPLETE")];
		const result = reconciler.reconcile("ws-1", attempts);

		// The last 2 attempts should be considered: [FAILED, COMPLETE] -> COMPLETE
		expect(result.finalVerdict).toBe("COMPLETE");
		expect(result.totalAttempts).toBe(2);
	});

	it("should not retry when verdict is COMPLETE", () => {
		const reconciler = new TerminalVerdictReconciler();
		const attempts = [makeAttempt(1, "FAILED"), makeAttempt(2, "COMPLETE")];
		const result = reconciler.reconcile("ws-1", attempts);

		expect(reconciler.shouldRetry(result, 5)).toBe(false);
	});

	it("should retry when not definitive and under maxRetries", () => {
		const reconciler = new TerminalVerdictReconciler();
		const attempts = [makeAttempt(1, "FAILED")];
		const result = reconciler.reconcile("ws-1", attempts);

		expect(reconciler.shouldRetry(result, 3)).toBe(true);
	});

	it("should not retry when maxRetries reached", () => {
		const reconciler = new TerminalVerdictReconciler();
		const attempts = [makeAttempt(1, "FAILED"), makeAttempt(2, "FAILED")];
		const result = reconciler.reconcile("ws-1", attempts);

		expect(reconciler.shouldRetry(result, 2)).toBe(false);
	});

	it("should build AttemptRecord from parse result", () => {
		const content = "VERDICT: COMPLETE\nAll acceptance criteria are satisfied.";
		const parseResult = parseTerminalVerdict(content);
		const record = TerminalVerdictReconciler.buildAttemptRecord(1, parseResult);

		expect(record.attemptNo).toBe(1);
		expect(record.verdict).toBe("COMPLETE");
		expect(record.confidence).toBe("high");
	});

	it("should update config via updateConfig", () => {
		const reconciler = new TerminalVerdictReconciler();
		reconciler.updateConfig({ treatBlockedAsTerminal: false });

		const config = reconciler.getConfig();
		expect(config.treatBlockedAsTerminal).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Shorthand function tests
// ---------------------------------------------------------------------------

describe("reconcileTerminalVerdicts", () => {
	it("should return COMPLETE if first attempt succeeded", () => {
		const result = reconcileTerminalVerdicts("ws-1", [makeAttempt(1, "COMPLETE")]);

		expect(result.finalVerdict).toBe("COMPLETE");
	});

	it("should return FAILED for all failed attempts", () => {
		const attempts = [makeAttempt(1, "FAILED", "Err1"), makeAttempt(2, "FAILED", "Err2")];
		const result = reconcileTerminalVerdicts("ws-1", attempts);

		expect(result.finalVerdict).toBe("FAILED");
		expect(result.totalAttempts).toBe(2);
	});

	it("should pass config options through", () => {
		const attempts = [makeAttempt(1, "FAILED")];
		const result = reconcileTerminalVerdicts("ws-1", attempts, { maxAttempts: 5 });

		expect(result.finalVerdict).toBe("FAILED");
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("TerminalVerdictReconciler edge cases", () => {
	it("should handle single BLOCKED attempt", () => {
		const reconciler = new TerminalVerdictReconciler();
		const result = reconciler.reconcile("ws-1", [makeAttempt(1, "BLOCKED")]);

		expect(result.finalVerdict).toBe("BLOCKED");
		expect(result.isDefinitive).toBe(true);
	});

	it("should handle a mix of BLOCKED and FAILED", () => {
		const reconciler = new TerminalVerdictReconciler();
		const attempts = [makeAttempt(1, "BLOCKED"), makeAttempt(2, "FAILED", "Error")];
		const result = reconciler.reconcile("ws-1", attempts);

		// Last attempt is FAILED
		expect(result.finalVerdict).toBe("FAILED");
		expect(result.determiningAttempt.attemptNo).toBe(2);
	});

	it("should handle a mix of FAILED then BLOCKED", () => {
		const reconciler = new TerminalVerdictReconciler();
		const attempts = [makeAttempt(1, "FAILED", "Error"), makeAttempt(2, "BLOCKED")];
		const result = reconciler.reconcile("ws-1", attempts);

		// Last attempt is BLOCKED
		expect(result.finalVerdict).toBe("BLOCKED");
		expect(result.determiningAttempt.attemptNo).toBe(2);
	});

	it("should include attempt summary in output for COMPLETE case", () => {
		const attempts = [makeAttempt(1, "FAILED", "Error 1"), makeAttempt(2, "COMPLETE")];
		const result = reconcileTerminalVerdicts("ws-1", attempts);

		expect(result.summary).toContain("attempt 2");
		expect(result.determiningAttempt.attemptNo).toBe(2);
		expect(result.totalAttempts).toBe(2);
	});

	it("should include attempt summary in output for FAILED case", () => {
		const attempts = [makeAttempt(1, "FAILED", "Error 1"), makeAttempt(2, "FAILED", "Error 2")];
		const result = reconcileTerminalVerdicts("ws-1", attempts);

		expect(result.summary).toContain("Attempt 1: FAILED");
		expect(result.summary).toContain("Attempt 2: FAILED");
		expect(result.summary).toContain("Final verdict: FAILED");
	});

	it("should respect treatBlockedAsTerminal config", () => {
		const reconciler = new TerminalVerdictReconciler({ treatBlockedAsTerminal: false });
		const attempts = [makeAttempt(1, "BLOCKED")];
		const result = reconciler.reconcile("ws-1", attempts);

		// When treatBlockedAsTerminal is false, BLOCKED is not definitive
		expect(result.finalVerdict).toBe("BLOCKED");
		expect(result.isDefinitive).toBe(false);
	});
});
