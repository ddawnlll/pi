import { describe, expect, it } from "vitest";
import {
	assertLegalTransition,
	assertRetryAllowed,
	getDeadlinePolicy,
} from "../../src/execution-runtime/attempt-fsm.js";
import type { AttemptState } from "../../src/execution-runtime/types.js";

describe("attempt-fsm", () => {
	describe("legal transitions", () => {
		const legalCases: Array<[AttemptState, AttemptState]> = [
			["PENDING", "READY"],
			["PENDING", "RUNNING"],
			["PENDING", "CANCELLED"],
			["READY", "RUNNING"],
			["READY", "BLOCKED"],
			["READY", "CANCELLED"],
			["RUNNING", "BLOCKED"],
			["RUNNING", "HANDOFF_REQUIRED"],
			["RUNNING", "FINAL_VALIDATION"],
			["RUNNING", "SUCCEEDED"],
			["RUNNING", "FAILED_RETRYABLE"],
			["RUNNING", "FAILED_FINAL"],
			["RUNNING", "CANCELLED"],
			["BLOCKED", "READY"],
			["BLOCKED", "RUNNING"],
			["BLOCKED", "HANDOFF_REQUIRED"],
			["BLOCKED", "FAILED_RETRYABLE"],
			["BLOCKED", "FAILED_FINAL"],
			["BLOCKED", "CANCELLED"],
			["HANDOFF_REQUIRED", "FINAL_VALIDATION"],
			["HANDOFF_REQUIRED", "FAILED_FINAL"],
			["HANDOFF_REQUIRED", "CANCELLED"],
			["FINAL_VALIDATION", "SUCCEEDED"],
			["FINAL_VALIDATION", "FAILED_FINAL"],
			["FINAL_VALIDATION", "FAILED_RETRYABLE"],
			["FINAL_VALIDATION", "CANCELLED"],
			["FAILED_RETRYABLE", "READY"],
			["FAILED_RETRYABLE", "RUNNING"],
			["FAILED_RETRYABLE", "CANCELLED"],
		];
		for (const [from, to] of legalCases) {
			it(`allows ${from} -> ${to}`, () => {
				expect(() => assertLegalTransition(from, to)).not.toThrow();
			});
		}
	});

	describe("illegal transitions", () => {
		const illegalCases: Array<[AttemptState, AttemptState]> = [
			["SUCCEEDED", "RUNNING"],
			["SUCCEEDED", "PENDING"],
			["SUCCEEDED", "FAILED_RETRYABLE"],
			["FAILED_FINAL", "READY"],
			["FAILED_FINAL", "RUNNING"],
			["FAILED_FINAL", "PENDING"],
			["CANCELLED", "PENDING"],
			["CANCELLED", "RUNNING"],
			["CANCELLED", "READY"],
			["PENDING", "SUCCEEDED"],
			["PENDING", "HANDOFF_REQUIRED"],
			["PENDING", "FAILED_FINAL"],
			["PENDING", "FAILED_RETRYABLE"],
			["PENDING", "FINAL_VALIDATION"],
			["READY", "SUCCEEDED"],
			["READY", "FAILED_FINAL"],
			["READY", "FAILED_RETRYABLE"],
			["READY", "HANDOFF_REQUIRED"],
			["READY", "FINAL_VALIDATION"],
			["RUNNING", "PENDING"],
			["RUNNING", "READY"],
			["BLOCKED", "SUCCEEDED"],
			["BLOCKED", "FINAL_VALIDATION"],
			["HANDOFF_REQUIRED", "RUNNING"],
			["HANDOFF_REQUIRED", "BLOCKED"],
			["HANDOFF_REQUIRED", "SUCCEEDED"],
			["HANDOFF_REQUIRED", "FAILED_RETRYABLE"],
			["HANDOFF_REQUIRED", "READY"],
			["FINAL_VALIDATION", "RUNNING"],
			["FINAL_VALIDATION", "BLOCKED"],
			["FINAL_VALIDATION", "HANDOFF_REQUIRED"],
			["FINAL_VALIDATION", "READY"],
			["FAILED_RETRYABLE", "SUCCEEDED"],
			["FAILED_RETRYABLE", "FAILED_FINAL"],
			["FAILED_RETRYABLE", "BLOCKED"],
			["FAILED_RETRYABLE", "PENDING"],
			["FAILED_RETRYABLE", "FINAL_VALIDATION"],
			["FAILED_RETRYABLE", "HANDOFF_REQUIRED"],
		];
		for (const [from, to] of illegalCases) {
			it(`rejects ${from} -> ${to}`, () => {
				expect(() => assertLegalTransition(from, to)).toThrow();
			});
		}
	});

	describe("retry validation", () => {
		it("rejects retry from non-terminal states", () => {
			expect(() => assertRetryAllowed("PENDING")).toThrow("Retry before terminal");
			expect(() => assertRetryAllowed("READY")).toThrow("Retry before terminal");
			expect(() => assertRetryAllowed("RUNNING")).toThrow("Retry before terminal");
			expect(() => assertRetryAllowed("BLOCKED")).toThrow("Retry before terminal");
			expect(() => assertRetryAllowed("HANDOFF_REQUIRED")).toThrow("Retry before terminal");
			expect(() => assertRetryAllowed("FINAL_VALIDATION")).toThrow("Retry before terminal");
		});
		it("allows retry from FAILED_RETRYABLE", () => {
			expect(() => assertRetryAllowed("FAILED_RETRYABLE")).not.toThrow();
		});
		it("rejects retry from SUCCEEDED", () => {
			expect(() => assertRetryAllowed("SUCCEEDED")).toThrow("Retry before terminal");
		});
		it("rejects retry from FAILED_FINAL", () => {
			expect(() => assertRetryAllowed("FAILED_FINAL")).toThrow("Retry before terminal");
		});
		it("rejects retry from CANCELLED", () => {
			expect(() => assertRetryAllowed("CANCELLED")).toThrow("Retry before terminal");
		});
	});

	describe("deadline policy", () => {
		it("has deadline for non-terminal states", () => {
			expect(getDeadlinePolicy("PENDING")).toBeTypeOf("number");
			expect(getDeadlinePolicy("READY")).toBeTypeOf("number");
			expect(getDeadlinePolicy("RUNNING")).toBeTypeOf("number");
			expect(getDeadlinePolicy("BLOCKED")).toBeTypeOf("number");
			expect(getDeadlinePolicy("HANDOFF_REQUIRED")).toBeTypeOf("number");
			expect(getDeadlinePolicy("FINAL_VALIDATION")).toBeTypeOf("number");
		});
		it("returns null for terminal states", () => {
			expect(getDeadlinePolicy("SUCCEEDED")).toBeNull();
			expect(getDeadlinePolicy("FAILED_FINAL")).toBeNull();
			expect(getDeadlinePolicy("FAILED_RETRYABLE")).toBeNull();
			expect(getDeadlinePolicy("CANCELLED")).toBeNull();
		});
		it("PENDING deadline is 15 minutes", () => {
			expect(getDeadlinePolicy("PENDING")).toBe(15 * 60_000);
		});
		it("RUNNING deadline is 20 minutes", () => {
			expect(getDeadlinePolicy("RUNNING")).toBe(20 * 60_000);
		});
		it("HANDOFF_REQUIRED deadline is 60 minutes", () => {
			expect(getDeadlinePolicy("HANDOFF_REQUIRED")).toBe(60 * 60_000);
		});
	});

	describe("identity transition", () => {
		it("same state is always legal", () => {
			const states: AttemptState[] = [
				"PENDING",
				"READY",
				"RUNNING",
				"BLOCKED",
				"HANDOFF_REQUIRED",
				"FINAL_VALIDATION",
				"SUCCEEDED",
				"FAILED_FINAL",
				"FAILED_RETRYABLE",
				"CANCELLED",
			];
			for (const state of states) {
				expect(() => assertLegalTransition(state, state)).not.toThrow();
			}
		});
	});
});
