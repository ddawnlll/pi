/**
 * Invariant Checker Tests — P38.1
 *
 * Verifies:
 * - Invariant checker catches known illegal FSM transitions
 * - Completion gate invariants work
 * - Lead Agent invariants work
 * - Patch transaction invariants work
 * - Parallelism invariants work
 * - Visibility invariants work
 */
import { describe, expect, it } from "vitest";
import type { ScenarioInvariantContext } from "../../src/core/execution-gauntlet/invariant-checker.js";
import { checkInvariants } from "../../src/core/execution-gauntlet/invariant-checker.js";
import {
	buildG1HelloSuccess,
	buildG5CompletionGateMissingCommand,
} from "../../src/core/execution-gauntlet/synthetic-plan-builder.js";

function baseCtx(overrides: Partial<ScenarioInvariantContext> = {}): ScenarioInvariantContext {
	return {
		plan: buildG1HelloSuccess(),
		workspaceStates: [],
		leadResults: [],
		directiveCount: 0,
		escalationCount: 0,
		fsmTransitions: [],
		staleCompletionsCount: 0,
		directMutationsObserved: 0,
		patchApplyCount: 0,
		patchRejectedCount: 0,
		maxObservedParallelism: 1,
		averageActiveWorkers: 1,
		activeWorkerTimeline: [],
		planCompleted: true,
		reportWritten: true,
		completionGateBlocks: [],
		noTestsFoundEvents: [],
		visibilityArtifacts: {},
		executionMode: "stable_3",
		fastMode: true,
		...overrides,
	};
}

describe("Invariant Checker", () => {
	describe("FSM Invariants", () => {
		it("catches PENDING -> SUCCEEDED transition", () => {
			const results = checkInvariants(
				baseCtx({
					fsmTransitions: [{ from: "PENDING", to: "SUCCEEDED", workspaceId: "ws-1" }],
				}),
			);

			const fsmInvariant = results.find((r) => r.name === "No PENDING -> SUCCEEDED attempted");
			expect(fsmInvariant).toBeDefined();
			expect(fsmInvariant!.passed).toBe(false);
		});

		it("catches SUCCEEDED -> RUNNING transition", () => {
			const results = checkInvariants(
				baseCtx({
					fsmTransitions: [{ from: "SUCCEEDED", to: "RUNNING", workspaceId: "ws-1" }],
				}),
			);

			const fsmInvariant = results.find((r) => r.name === "No SUCCEEDED -> RUNNING retry-cache regression");
			expect(fsmInvariant).toBeDefined();
			expect(fsmInvariant!.passed).toBe(false);
		});

		it("passes with legal FSM transitions", () => {
			const results = checkInvariants(
				baseCtx({
					fsmTransitions: [
						{ from: "PENDING", to: "RUNNING", workspaceId: "ws-1" },
						{ from: "RUNNING", to: "SUCCEEDED", workspaceId: "ws-1" },
					],
				}),
			);

			const pendingToSucceeded = results.find((r) => r.name === "No PENDING -> SUCCEEDED attempted");
			expect(pendingToSucceeded!.passed).toBe(true);

			const succeededToRunning = results.find((r) => r.name === "No SUCCEEDED -> RUNNING retry-cache regression");
			expect(succeededToRunning!.passed).toBe(true);
		});

		it("catches SUCCEEDED -> PENDING illegal transition", () => {
			const results = checkInvariants(
				baseCtx({
					fsmTransitions: [{ from: "SUCCEEDED", to: "PENDING", workspaceId: "ws-1" }],
				}),
			);

			const noIllegal = results.find((r) => r.name === "No illegal FSM transitions");
			expect(noIllegal).toBeDefined();
			expect(noIllegal!.passed).toBe(false);
		});
	});

	describe("Completion Gate Invariants", () => {
		it("catches missing completion gate block when expected", () => {
			const plan = buildG5CompletionGateMissingCommand();
			const results = checkInvariants(
				baseCtx({
					plan,
					planCompleted: false,
					completionGateBlocks: [], // empty even though plan expects blocks
				}),
			);

			const cgInvariant = results.find((r) => r.name === "CompletionGate blocks when conditions not met");
			expect(cgInvariant).toBeDefined();
			expect(cgInvariant!.passed).toBe(false);
		});

		it("passes when completion gate correctly blocks", () => {
			const plan = buildG5CompletionGateMissingCommand();
			const results = checkInvariants(
				baseCtx({
					plan,
					planCompleted: false,
					completionGateBlocks: [{ workspaceId: "G5-missing-cmd", reasons: ["Command history is missing"] }],
				}),
			);

			const cgInvariant = results.find((r) => r.name === "CompletionGate blocks when conditions not met");
			expect(cgInvariant!.passed).toBe(true);
		});

		it("catches no-tests-found exit 0 not detected", () => {
			// Build a plan that expects no-tests-found
			const plan = buildG5CompletionGateMissingCommand();
			// Override expected
			plan.expected.noTestsFoundClassified = true;

			const results = checkInvariants(
				baseCtx({
					plan,
					planCompleted: false,
					noTestsFoundEvents: [], // empty
				}),
			);

			const ntInvariant = results.find((r) => r.name === "No tests found exit zero is treated as failure");
			expect(ntInvariant).toBeDefined();
			expect(ntInvariant!.passed).toBe(false);
		});
	});

	describe("Lead Agent Invariants", () => {
		it("catches missing LeadDirective when expected", () => {
			const plan = buildG5CompletionGateMissingCommand();
			plan.expected.leadDirectiveCreated = true;

			const results = checkInvariants(
				baseCtx({
					plan,
					planCompleted: false,
					directiveCount: 0,
				}),
			);

			const leadInvariant = results.find((r) => r.name === "LeadDirective created on repeated failure");
			expect(leadInvariant).toBeDefined();
			expect(leadInvariant!.passed).toBe(false);
		});

		it("passes when LeadDirective was created", () => {
			const plan = buildG5CompletionGateMissingCommand();
			plan.expected.leadDirectiveCreated = true;

			const results = checkInvariants(
				baseCtx({
					plan,
					planCompleted: false,
					directiveCount: 1,
				}),
			);

			const leadInvariant = results.find((r) => r.name === "LeadDirective created on repeated failure");
			expect(leadInvariant!.passed).toBe(true);
		});

		it("catches missing UserEscalation when expected", () => {
			const plan = buildG5CompletionGateMissingCommand();
			plan.expected.userEscalationCreated = true;

			const results = checkInvariants(
				baseCtx({
					plan,
					planCompleted: false,
					escalationCount: 0,
				}),
			);

			const escInvariant = results.find((r) => r.name === "UserEscalation created after retry budget exhausted");
			expect(escInvariant).toBeDefined();
			expect(escInvariant!.passed).toBe(false);
		});
	});

	describe("Patch Transaction Invariants", () => {
		it("catches direct worker mutation in patch_transaction mode", () => {
			const results = checkInvariants(
				baseCtx({
					executionMode: "patch_transaction",
					plan: {
						...buildG1HelloSuccess(),
						executionMode: "patch_transaction",
						expected: { noDirectMutation: true },
					},
					directMutationsObserved: 3,
				}),
			);

			const mutInvariant = results.find((r) => r.name === "Workers do not directly mutate repo");
			expect(mutInvariant).toBeDefined();
			expect(mutInvariant!.passed).toBe(false);
		});

		it("passes with zero direct mutations in patch_transaction mode", () => {
			const results = checkInvariants(
				baseCtx({
					executionMode: "patch_transaction",
					plan: {
						...buildG1HelloSuccess(),
						executionMode: "patch_transaction",
						expected: { noDirectMutation: true },
					},
					directMutationsObserved: 0,
				}),
			);

			const mutInvariant = results.find((r) => r.name === "Workers do not directly mutate repo");
			expect(mutInvariant!.passed).toBe(true);
		});

		it("catches patch not rejected when writeSet violation expected", () => {
			const results = checkInvariants(
				baseCtx({
					executionMode: "patch_transaction",
					plan: {
						...buildG1HelloSuccess(),
						executionMode: "patch_transaction",
						expected: { patchRejectedOrHandoff: true },
					},
					patchRejectedCount: 0,
				}),
			);

			const rejInvariant = results.find(
				(r) => r.name === "Patch rejected or handoff_required for writeSet violation",
			);
			expect(rejInvariant).toBeDefined();
			expect(rejInvariant!.passed).toBe(false);
		});
	});

	describe("Parallelism Invariants", () => {
		it("catches stable_3 exceeding max parallelism", () => {
			const results = checkInvariants(
				baseCtx({
					executionMode: "stable_3",
					maxObservedParallelism: 5,
				}),
			);

			const parInvariant = results.find((r) => r.name === "stable_3 max workers <= 3");
			expect(parInvariant).toBeDefined();
			expect(parInvariant!.passed).toBe(false);
		});

		it("passes with stable_3 at or under 3 workers", () => {
			const results = checkInvariants(
				baseCtx({
					executionMode: "stable_3",
					maxObservedParallelism: 3,
				}),
			);

			const parInvariant = results.find((r) => r.name === "stable_3 max workers <= 3");
			expect(parInvariant!.passed).toBe(true);
		});

		it("catches min parallelism not reached", () => {
			const plan = buildG1HelloSuccess();
			plan.expected.minObservedParallelism = 2;
			plan.expected.maxParallelism = 3;

			const results = checkInvariants(
				baseCtx({
					plan,
					maxObservedParallelism: 1,
				}),
			);

			const minInvariant = results.find((r) => r.name.includes("Max observed parallelism >="));
			expect(minInvariant).toBeDefined();
			expect(minInvariant!.passed).toBe(false);
		});
	});

	describe("Visibility Invariants", () => {
		it("catches missing visibility artifacts when expected", () => {
			const plan = buildG5CompletionGateMissingCommand();
			plan.expected.visibilityArtifactsPresent = true;

			const results = checkInvariants(
				baseCtx({
					plan,
					visibilityArtifacts: {},
				}),
			);

			const visInvariant = results.find((r) => r.name === "Dashboard visibility artifacts produced");
			expect(visInvariant).toBeDefined();
			expect(visInvariant!.passed).toBe(false);
		});

		it("passes when visibility artifacts are present", () => {
			const plan = buildG5CompletionGateMissingCommand();
			plan.expected.visibilityArtifactsPresent = true;

			const results = checkInvariants(
				baseCtx({
					plan,
					visibilityArtifacts: {
						workspaceErrors: true,
						completionGateBlocks: true,
					},
				}),
			);

			const visInvariant = results.find((r) => r.name === "Dashboard visibility artifacts produced");
			expect(visInvariant!.passed).toBe(true);
		});
	});

	describe("Plan Completion Invariants", () => {
		it("catches plan completion mismatch", () => {
			const plan = buildG1HelloSuccess();
			plan.expected.planCompletes = true;

			const results = checkInvariants(
				baseCtx({
					plan,
					planCompleted: false,
				}),
			);

			const compInvariant = results.find((r) => r.name === "Plan completion matches expectation");
			expect(compInvariant).toBeDefined();
			expect(compInvariant!.passed).toBe(false);
		});

		it("passess when plan completion matches expectation", () => {
			const plan = buildG1HelloSuccess();
			plan.expected.planCompletes = true;

			const results = checkInvariants(
				baseCtx({
					plan,
					planCompleted: true,
				}),
			);

			const compInvariant = results.find((r) => r.name === "Plan completion matches expectation");
			expect(compInvariant!.passed).toBe(true);
		});
	});
});
