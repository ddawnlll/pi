/**
 * Regression test: retry-before-terminal is impossible at FSM level.
 *
 * v4 invariant I4: Retry can only create a new attempt after the
 * previous attempt is terminal. Actor permissions and the FSM
 * enforce this at multiple levels.
 */

import { describe, expect, it } from "vitest";
import type { ActorId } from "../../src/execution-runtime/actor-permissions.js";
import { mayMutateAttemptState } from "../../src/execution-runtime/actor-permissions.js";
import { assertRetryAllowed } from "../../src/execution-runtime/attempt-fsm.js";
import type { AttemptState } from "../../src/execution-runtime/types.js";

describe("retry-before-terminal", () => {
	// =========================================================================
	// FSM-level enforcement
	// =========================================================================

	describe("FSM rejects retry from non-terminal states", () => {
		const nonTerminalStates: AttemptState[] = [
			"PENDING",
			"READY",
			"RUNNING",
			"BLOCKED",
			"HANDOFF_REQUIRED",
			"FINAL_VALIDATION",
		];

		for (const state of nonTerminalStates) {
			it(`retry_requested from ${state} is rejected`, () => {
				expect(() => assertRetryAllowed(state)).toThrow("Retry before terminal");
			});
		}
	});

	describe("FSM allows retry from retryable terminal states", () => {
		it("FAILED_RETRYABLE allows retry", () => {
			expect(() => assertRetryAllowed("FAILED_RETRYABLE")).not.toThrow();
		});
	});

	describe("FSM rejects retry from non-retryable terminal states", () => {
		const nonRetryableStates: AttemptState[] = ["SUCCEEDED", "FAILED_FINAL", "CANCELLED"];

		for (const state of nonRetryableStates) {
			it(`${state} rejects retry`, () => {
				expect(() => assertRetryAllowed(state)).toThrow("Retry before terminal");
			});
		}
	});

	// =========================================================================
	// Actor permission enforcement
	// =========================================================================

	describe("actor permissions prevent retry creation by non-controllers", () => {
		const actorsThatCannotRetry: ActorId[] = [
			"executor_actor",
			"validation_actor",
			"git_runner",
			"worktree_actor",
			"lease_actor",
			"integration_actor",
			"retry_policy", // may *suggest* retry but not create
			"deadline_watchdog",
			"cleanup_actor",
			"brain_worker",
			"diagnostics",
			"admission_gate",
			"legacy_adapter",
		];

		for (const actor of actorsThatCannotRetry) {
			it(`${actor} cannot mutate attempt state`, () => {
				expect(mayMutateAttemptState(actor)).toBe(false);
			});
		}

		it("workspace_attempt_controller can mutate attempt state", () => {
			expect(mayMutateAttemptState("workspace_attempt_controller")).toBe(true);
		});

		it("plan_supervisor cannot mutate attempt state", () => {
			expect(mayMutateAttemptState("plan_supervisor")).toBe(false);
		});
	});
});
