import { describe, expect, it } from "vitest";
import type { ActorId } from "../../src/execution-kernel/actor-permissions.js";
import {
	assertMayMutateAttemptState,
	getActorPermissions,
	mayMutateAttemptState,
	mayMutatePlanState,
} from "../../src/execution-kernel/actor-permissions.js";

describe("actor-permissions", () => {
	it("workspace_attempt_controller may mutate attempt state", () => {
		expect(mayMutateAttemptState("workspace_attempt_controller")).toBe(true);
	});

	it("plan_supervisor may mutate plan state", () => {
		expect(mayMutatePlanState("plan_supervisor")).toBe(true);
	});

	it("executor_actor may NOT mutate attempt state", () => {
		expect(mayMutateAttemptState("executor_actor")).toBe(false);
	});

	it("validation_actor may NOT mutate attempt state", () => {
		expect(mayMutateAttemptState("validation_actor")).toBe(false);
	});

	it("retry_policy may NOT directly create retry", () => {
		const perms = getActorPermissions("retry_policy");
		expect(perms.mayCreateRetryAttempt).toBe(false);
		expect(perms.maySuggestRetry).toBe(true);
	});

	it("brain_worker may propose but not mutate", () => {
		const perms = getActorPermissions("brain_worker");
		expect(perms.mayProposeAction).toBe(true);
		expect(perms.mayEmitDiagnosis).toBe(true);
		expect(perms.mayMutateAttemptState).toBe(false);
	});

	it("human actor is all-powerful", () => {
		const perms = getActorPermissions("human");
		expect(perms.mayMutateAttemptState).toBe(true);
		expect(perms.mayMutatePlanState).toBe(true);
		expect(perms.mayCreateRetryAttempt).toBe(true);
	});

	it("assertMayMutateAttemptState throws for executor", () => {
		expect(() => assertMayMutateAttemptState("executor_actor")).toThrow("direct_attempt_state_mutation_detected");
	});

	it("assertMayMutateAttemptState passes for controller", () => {
		expect(() => assertMayMutateAttemptState("workspace_attempt_controller")).not.toThrow();
	});

	it("throws for unknown actor", () => {
		expect(() => getActorPermissions("unknown_actor" as ActorId)).toThrow("Unknown actor");
	});

	it("all standard actors have defined permissions", () => {
		const actors: ActorId[] = [
			"workspace_attempt_controller",
			"plan_supervisor",
			"executor_actor",
			"validation_actor",
			"git_runner",
			"worktree_actor",
			"lease_actor",
			"integration_actor",
			"retry_policy",
			"deadline_watchdog",
			"cleanup_actor",
			"brain_worker",
			"diagnostics",
			"admission_gate",
			"legacy_adapter",
			"human",
		];
		for (const actor of actors) {
			expect(() => getActorPermissions(actor)).not.toThrow();
		}
	});
});
