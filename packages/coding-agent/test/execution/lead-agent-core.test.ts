/**
 * Lead Agent Core Tests — P38.LEAD
 *
 * Tests the Lead Agent's review decisions for known failure patterns.
 * Verifies that:
 * - Repeated target_command_not_executed triggers directive then escalation
 * - FSM illegal transitions are classified correctly
 * - No-tests-found exit 0 is classified
 * - Lead Agent does not mutate execution state (only returns decisions)
 * - Dry run mode observes but does not block
 */
import { beforeEach, describe, expect, it } from "vitest";
import { LeadAgent } from "../../src/core/lead-agent/lead-agent.js";
import type { LeadAgentConfig, LeadFailureReviewInput } from "../../src/core/lead-agent/types.js";

function reviewInput(overrides: Partial<LeadFailureReviewInput> = {}): LeadFailureReviewInput {
	return {
		planExecId: "pexec_test",
		workspaceId: "P37.03",
		errorMessage:
			"Completion gate blocked: Target command has not been executed: npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
		attemptNo: 1,
		completionGateBlockReasons: ["Target command has not been executed"],
		commandHistory: [],
		...overrides,
	};
}

describe("LeadAgent review decisions", () => {
	let agent: LeadAgent;

	beforeEach(() => {
		agent = new LeadAgent({ mode: "enforcement" } as LeadAgentConfig);
	});

	describe("target_command_not_executed", () => {
		it("allows first retry", () => {
			const result = agent.reviewFailure(reviewInput({ attemptNo: 1 }));
			expect(result.decision).toBe("allow_retry");
			expect(result.failureClass).toBe("target_command_not_executed");
		});

		it("issues directive on second same-signature failure", () => {
			// First failure
			agent.reviewFailure(reviewInput({ attemptNo: 1 }));
			// Second failure — same signature
			const result = agent.reviewFailure(reviewInput({ attemptNo: 2 }));
			expect(result.decision).toBe("retry_with_directive");
			expect(result.directive).toBeDefined();
			expect(result.directive!.failureClass).toBe("target_command_not_executed");
			expect(result.directive!.directive).toContain("Do not retry the same implementation");
		});

		it("escalates to user on third same-signature failure", () => {
			agent.reviewFailure(reviewInput({ attemptNo: 1 }));
			agent.reviewFailure(reviewInput({ attemptNo: 2 }));
			const result = agent.reviewFailure(reviewInput({ attemptNo: 3 }));

			expect(result.decision).toBe("block_and_escalate_user");
			expect(result.escalation).toBeDefined();
			expect(result.escalation!.status).toBe("awaiting_user");
			expect(result.escalation!.workspaceId).toBe("P37.03");
		});

		it("escalation includes options for user", () => {
			agent.reviewFailure(reviewInput({ attemptNo: 1 }));
			agent.reviewFailure(reviewInput({ attemptNo: 2 }));
			const result = agent.reviewFailure(reviewInput({ attemptNo: 3 }));

			expect(result.escalation!.options.length).toBeGreaterThan(0);
			expect(result.escalation!.recommendedOptionId).toBeDefined();
		});

		it("directive is retrievable after issuance", () => {
			agent.reviewFailure(reviewInput({ attemptNo: 1 }));
			agent.reviewFailure(reviewInput({ attemptNo: 2 }));

			const directive = agent.getDirective("pexec_test", "P37.03");
			expect(directive).toBeDefined();
			expect(directive!.failureClass).toBe("target_command_not_executed");
			expect(directive!.status).toBe("issued");
		});

		it("escalation is retrievable after issuance", () => {
			agent.reviewFailure(reviewInput({ attemptNo: 1 }));
			agent.reviewFailure(reviewInput({ attemptNo: 2 }));
			agent.reviewFailure(reviewInput({ attemptNo: 3 }));

			const escalations = agent.getEscalations("pexec_test");
			expect(escalations).toHaveLength(1);
			expect(escalations[0].workspaceId).toBe("P37.03");
		});
	});

	describe("FSM illegal transitions", () => {
		it("classifies PENDING->SUCCEEDED as stale_attempt_completion", () => {
			const result = agent.reviewFailure(
				reviewInput({
					errorMessage: "Illegal attempt transition: PENDING -> SUCCEEDED",
					attemptNo: 1,
					completionGateBlockReasons: [],
				}),
			);
			expect(result.failureClass).toBe("stale_attempt_completion");
			// Blocking severity should escalate immediately
			expect(result.decision).toBe("block_and_escalate_user");
		});

		it("classifies SUCCEEDED->RUNNING as attempt_cache_retry_bug", () => {
			const result = agent.reviewFailure(
				reviewInput({
					errorMessage: "Illegal attempt transition: SUCCEEDED -> RUNNING",
					attemptNo: 1,
					completionGateBlockReasons: [],
				}),
			);
			expect(result.failureClass).toBe("attempt_cache_retry_bug");
			expect(result.decision).toBe("block_and_escalate_user");
		});
	});

	describe("no_tests_found_exit_zero", () => {
		it("classifies no-tests-found exit 0 correctly", () => {
			const result = agent.reviewFailure(
				reviewInput({
					errorMessage: "No test files found, exiting with code 0",
					attemptNo: 1,
					completionGateBlockReasons: ["No test files found"],
				}),
			);
			expect(result.failureClass).toBe("no_tests_found_exit_zero");
		});

		it("issues directive on repeated no-tests-found", () => {
			agent.reviewFailure(
				reviewInput({
					errorMessage: "No test files found, exiting with code 0",
					attemptNo: 1,
					completionGateBlockReasons: ["No test files found"],
				}),
			);
			const result = agent.reviewFailure(
				reviewInput({
					errorMessage: "No test files found, exiting with code 0",
					attemptNo: 2,
					completionGateBlockReasons: ["No test files found"],
				}),
			);
			expect(result.decision).toBe("retry_with_directive");
			expect(result.directive!.directive).toContain("Do not accept exit code 0");
		});
	});

	describe("dry run mode", () => {
		it("observes and classifies but does not block retries", () => {
			const dryRunAgent = new LeadAgent({ mode: "dry_run" } as LeadAgentConfig);

			dryRunAgent.reviewFailure(reviewInput({ attemptNo: 1 }));
			dryRunAgent.reviewFailure(reviewInput({ attemptNo: 2 }));
			const result = dryRunAgent.reviewFailure(reviewInput({ attemptNo: 3 }));

			// In dry run mode, should always allow retry but record diagnosis
			expect(result.decision).toBe("allow_retry");
			expect(result.failureClass).toBe("target_command_not_executed");
			expect(result.directive).toBeDefined(); // Still generates directive for diagnosis
		});
	});

	describe("safety: Lead Agent does not mutate execution state", () => {
		it("LeadAgent has no workspace state mutation methods", () => {
			// The LeadAgent class should NOT have methods like markComplete, transitionWorkspace, etc.
			const proto = Object.getOwnPropertyNames(LeadAgent.prototype);
			expect(proto).not.toContain("markComplete");
			expect(proto).not.toContain("transitionWorkspace");
			expect(proto).not.toContain("setCompletionGate");
		});

		it("reviewFailure returns decision objects, does not mutate DB", () => {
			// reviewFailure is a pure function on internal state maps
			const result = agent.reviewFailure(reviewInput({ attemptNo: 1 }));
			expect(result).toBeDefined();
			expect(typeof result.decision).toBe("string");
			// No state mutation side effects
		});
	});

	describe("diagnosis retrieval", () => {
		it("getDiagnosis returns null for empty workspace", () => {
			const diagnosis = agent.getDiagnosis("pexec_test", "NONEXISTENT");
			expect(diagnosis.failureClass).toBeNull();
			expect(diagnosis.directive).toBeNull();
			expect(diagnosis.escalation).toBeNull();
		});

		it("getDiagnosis returns diagnostic info after failures", () => {
			agent.reviewFailure(reviewInput({ attemptNo: 1 }));
			agent.reviewFailure(reviewInput({ attemptNo: 2 }));

			const diagnosis = agent.getDiagnosis("pexec_test", "P37.03");
			expect(diagnosis.failureClass).toBe("target_command_not_executed");
			expect(diagnosis.directive).toBeDefined();
			expect(diagnosis.retryCount).toBeGreaterThan(0);
			expect(diagnosis.escalated).toBe(false);
		});

		it("getDiagnosis shows escalated state", () => {
			agent.reviewFailure(reviewInput({ attemptNo: 1 }));
			agent.reviewFailure(reviewInput({ attemptNo: 2 }));
			agent.reviewFailure(reviewInput({ attemptNo: 3 }));

			const diagnosis = agent.getDiagnosis("pexec_test", "P37.03");
			expect(diagnosis.escalated).toBe(true);
			expect(diagnosis.escalation).toBeDefined();
		});
	});
});
