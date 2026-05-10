/**
 * Tests for Retry Handler - P2 Workstream 7.G
 */

import { describe, expect, it } from "vitest";
import type { WorkspaceState } from "../src/core/plan-state.js";
import {
	createRetryHandler,
	DEFAULT_RETRY_POLICY,
	FailureType,
	RetryHandler,
	type RetryPolicy,
	RetryStage,
} from "../src/core/retry-handler.js";
import type { Workspace } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

describe("RetryHandler", () => {
	const handler = new RetryHandler();

	const mockWorkspace: Workspace = {
		id: "7.A",
		title: "Test Workspace",
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 10,
	};

	const mockState: WorkspaceState = {
		workspaceId: "7.A",
		stage: WorkspaceStage.Failed,
		attempts: 0,
	};

	describe("retry stage determination", () => {
		it("should return Worker stage for attempts 1-3", () => {
			expect(handler.getRetryStage(1)).toBe(RetryStage.Worker);
			expect(handler.getRetryStage(2)).toBe(RetryStage.Worker);
			expect(handler.getRetryStage(3)).toBe(RetryStage.Worker);
		});

		it("should return Flash stage for attempts 4-6", () => {
			expect(handler.getRetryStage(4)).toBe(RetryStage.Flash);
			expect(handler.getRetryStage(5)).toBe(RetryStage.Flash);
			expect(handler.getRetryStage(6)).toBe(RetryStage.Flash);
		});

		it("should return Reviewer stage for attempts 7-9", () => {
			expect(handler.getRetryStage(7)).toBe(RetryStage.Reviewer);
			expect(handler.getRetryStage(8)).toBe(RetryStage.Reviewer);
			expect(handler.getRetryStage(9)).toBe(RetryStage.Reviewer);
		});

		it("should return Final stage for attempt 10+", () => {
			expect(handler.getRetryStage(10)).toBe(RetryStage.Final);
			expect(handler.getRetryStage(11)).toBe(RetryStage.Final);
		});
	});

	describe("retry decision for test failures", () => {
		it("should allow retry on first test failure", () => {
			const state = { ...mockState, attempts: 1 };
			const decision = handler.shouldRetry(mockWorkspace, state, FailureType.Test);

			expect(decision.shouldRetry).toBe(true);
			expect(decision.stage).toBe(RetryStage.Worker);
			expect(decision.nextAttempt).toBe(2);
		});

		it("should allow retry up to 10 attempts for test failures", () => {
			const state = { ...mockState, attempts: 9 };
			const decision = handler.shouldRetry(mockWorkspace, state, FailureType.Test);

			expect(decision.shouldRetry).toBe(true);
			expect(decision.stage).toBe(RetryStage.Final);
			expect(decision.nextAttempt).toBe(10);
		});

		it("should not allow retry after 10 attempts for test failures", () => {
			const state = { ...mockState, attempts: 10 };
			const decision = handler.shouldRetry(mockWorkspace, state, FailureType.Test);

			expect(decision.shouldRetry).toBe(false);
			expect(decision.reason).toContain("Exhausted retries");
		});
	});

	describe("retry decision for review failures", () => {
		it("should allow retry on first review failure", () => {
			const state = { ...mockState, attempts: 1 };
			const decision = handler.shouldRetry(mockWorkspace, state, FailureType.Review);

			expect(decision.shouldRetry).toBe(true);
			expect(decision.nextAttempt).toBe(2);
		});

		it("should limit review retries to 3 attempts", () => {
			const state = { ...mockState, attempts: 3 };
			const decision = handler.shouldRetry(mockWorkspace, state, FailureType.Review);

			expect(decision.shouldRetry).toBe(false);
			expect(decision.reason).toContain("Exhausted retries");
			expect(decision.reason).toContain("3/3");
		});

		it("should not allow retry after 3 attempts for review failures", () => {
			const state = { ...mockState, attempts: 4 };
			const decision = handler.shouldRetry(mockWorkspace, state, FailureType.Review);

			expect(decision.shouldRetry).toBe(false);
		});
	});

	describe("retry escalation", () => {
		it("should escalate to Flash at attempt 4", () => {
			const state = { ...mockState, attempts: 3 };
			const decision = handler.shouldRetry(mockWorkspace, state, FailureType.Test);

			expect(decision.shouldRetry).toBe(true);
			expect(decision.stage).toBe(RetryStage.Flash);
			expect(decision.nextAttempt).toBe(4);
		});

		it("should escalate to Reviewer at attempt 7", () => {
			const state = { ...mockState, attempts: 6 };
			const decision = handler.shouldRetry(mockWorkspace, state, FailureType.Test);

			expect(decision.shouldRetry).toBe(true);
			expect(decision.stage).toBe(RetryStage.Reviewer);
			expect(decision.nextAttempt).toBe(7);
		});

		it("should mark as Final at attempt 10", () => {
			const state = { ...mockState, attempts: 9 };
			const decision = handler.shouldRetry(mockWorkspace, state, FailureType.Test);

			expect(decision.shouldRetry).toBe(true);
			expect(decision.stage).toBe(RetryStage.Final);
			expect(decision.nextAttempt).toBe(10);
		});
	});

	describe("failure classification", () => {
		it("should classify test failures", () => {
			expect(handler.classifyFailure("Test failed: expected 1 to equal 2")).toBe(FailureType.Test);
			expect(handler.classifyFailure("Spec assertion failed")).toBe(FailureType.Test);
			expect(handler.classifyFailure("AssertionError: values not equal")).toBe(FailureType.Test);
		});

		it("should classify lint failures", () => {
			expect(handler.classifyFailure("ESLint error: no-unused-vars")).toBe(FailureType.Lint);
			expect(handler.classifyFailure("Biome check failed")).toBe(FailureType.Lint);
			expect(handler.classifyFailure("Lint errors found")).toBe(FailureType.Lint);
		});

		it("should classify type failures", () => {
			expect(handler.classifyFailure("TypeScript error TS2345")).toBe(FailureType.Type);
			expect(handler.classifyFailure("Type 'string' is not assignable to type 'number'")).toBe(FailureType.Type);
			expect(handler.classifyFailure("tsc compilation failed")).toBe(FailureType.Type);
		});

		it("should classify review failures", () => {
			expect(handler.classifyFailure("Review rejected: needs revision")).toBe(FailureType.Review);
			expect(handler.classifyFailure("Code review failed")).toBe(FailureType.Review);
		});

		it("should classify build failures", () => {
			expect(handler.classifyFailure("Build failed: compilation error")).toBe(FailureType.Build);
			expect(handler.classifyFailure("Compile error in module")).toBe(FailureType.Build);
		});

		it("should classify runtime failures", () => {
			expect(handler.classifyFailure("Runtime exception: null pointer")).toBe(FailureType.Runtime);
			expect(handler.classifyFailure("Uncaught exception at runtime")).toBe(FailureType.Runtime);
		});

		it("should classify unknown failures", () => {
			expect(handler.classifyFailure("Something went wrong")).toBe(FailureType.Unknown);
		});
	});

	describe("retry context generation", () => {
		it("should generate context for worker retry", () => {
			const state = { ...mockState, attempts: 1 };
			const error = "Test failed: expected true to be false";
			const context = handler.getRetryContext(state, error);

			expect(context).toContain("Previous attempt 1 failed");
			expect(context).toContain("test");
			expect(context).toContain("Next retry strategy: worker");
		});

		it("should generate context for flash retry", () => {
			const state = { ...mockState, attempts: 4 };
			const error = "Lint error: unused variable";
			const context = handler.getRetryContext(state, error);

			expect(context).toContain("Previous attempt 4 failed");
			expect(context).toContain("Next retry strategy: flash");
			expect(context).toContain("quick, targeted fixes");
		});

		it("should generate context for reviewer retry", () => {
			const state = { ...mockState, attempts: 7 };
			const error = "Type error: incompatible types";
			const context = handler.getRetryContext(state, error);

			expect(context).toContain("Previous attempt 7 failed");
			expect(context).toContain("Next retry strategy: reviewer");
			expect(context).toContain("deeper analysis");
		});

		it("should generate context for final retry", () => {
			const state = { ...mockState, attempts: 9 };
			const error = "Build failed";
			const context = handler.getRetryContext(state, error);

			expect(context).toContain("Previous attempt 9 failed");
			expect(context).toContain("Next retry strategy: final");
			expect(context).toContain("FINAL ATTEMPT");
		});

		it("should truncate long error messages", () => {
			const state = { ...mockState, attempts: 1 };
			const longError = "x".repeat(1000);
			const context = handler.getRetryContext(state, longError);

			expect(context.length).toBeLessThan(longError.length + 200);
		});
	});

	describe("workspace serialization", () => {
		it("should serialize high-risk workspaces", () => {
			const workspace = { ...mockWorkspace, riskLevel: "high" as const };
			expect(handler.shouldSerialize(workspace)).toBe(true);
		});

		it("should serialize security-related workspaces", () => {
			const securityWorkspace = { ...mockWorkspace, title: "Implement authentication system" };
			expect(handler.shouldSerialize(securityWorkspace)).toBe(true);

			const tokenWorkspace = { ...mockWorkspace, title: "Update API token handling" };
			expect(handler.shouldSerialize(tokenWorkspace)).toBe(true);

			const credentialWorkspace = { ...mockWorkspace, title: "Fix credential storage" };
			expect(handler.shouldSerialize(credentialWorkspace)).toBe(true);
		});

		it("should serialize workspaces with sensitive commands", () => {
			const workspace: Workspace = {
				...mockWorkspace,
				capabilities: {
					canEdit: [],
					cannotEdit: [],
					canRun: ["npm publish", "echo test"],
					cannotRun: [],
				},
			};
			expect(handler.shouldSerialize(workspace)).toBe(true);
		});

		it("should not serialize low-risk workspaces", () => {
			const workspace = { ...mockWorkspace, riskLevel: "low" as const };
			expect(handler.shouldSerialize(workspace)).toBe(false);
		});

		it("should not serialize normal workspaces", () => {
			expect(handler.shouldSerialize(mockWorkspace)).toBe(false);
		});
	});

	describe("policy management", () => {
		it("should use default policy", () => {
			const handler = new RetryHandler();
			const policy = handler.getPolicy();

			expect(policy.maxTestRetries).toBe(10);
			expect(policy.maxReviewRetries).toBe(3);
			expect(policy.escalationThresholds.flash).toBe(4);
			expect(policy.escalationThresholds.reviewer).toBe(7);
			expect(policy.escalationThresholds.final).toBe(10);
		});

		it("should accept custom policy", () => {
			const customPolicy: RetryPolicy = {
				maxTestRetries: 5,
				maxReviewRetries: 2,
				escalationThresholds: {
					flash: 3,
					reviewer: 4,
					final: 5,
				},
			};

			const handler = new RetryHandler(customPolicy);
			const policy = handler.getPolicy();

			expect(policy.maxTestRetries).toBe(5);
			expect(policy.maxReviewRetries).toBe(2);
		});

		it("should update policy", () => {
			const handler = new RetryHandler();
			handler.updatePolicy({ maxTestRetries: 15 });

			const policy = handler.getPolicy();
			expect(policy.maxTestRetries).toBe(15);
			expect(policy.maxReviewRetries).toBe(3); // Unchanged
		});
	});

	describe("createRetryHandler", () => {
		it("should create handler with default policy", () => {
			const handler = createRetryHandler();
			expect(handler).toBeInstanceOf(RetryHandler);

			const policy = handler.getPolicy();
			expect(policy.maxTestRetries).toBe(DEFAULT_RETRY_POLICY.maxTestRetries);
		});

		it("should create handler with custom policy", () => {
			const customPolicy: RetryPolicy = {
				maxTestRetries: 8,
				maxReviewRetries: 4,
				escalationThresholds: {
					flash: 3,
					reviewer: 6,
					final: 8,
				},
			};

			const handler = createRetryHandler(customPolicy);
			const policy = handler.getPolicy();

			expect(policy.maxTestRetries).toBe(8);
		});
	});

	describe("workspace max retries override", () => {
		it("should respect workspace maxRetries when lower than policy", () => {
			const workspace = { ...mockWorkspace, maxRetries: 5 };
			const state = { ...mockState, attempts: 5 };
			const decision = handler.shouldRetry(workspace, state, FailureType.Test);

			expect(decision.shouldRetry).toBe(false);
			expect(decision.reason).toContain("5/5");
		});

		it("should use policy limit when lower than workspace maxRetries", () => {
			const workspace = { ...mockWorkspace, maxRetries: 20 };
			const state = { ...mockState, attempts: 10 };
			const decision = handler.shouldRetry(workspace, state, FailureType.Test);

			expect(decision.shouldRetry).toBe(false);
			expect(decision.reason).toContain("10/10");
		});
	});
});
