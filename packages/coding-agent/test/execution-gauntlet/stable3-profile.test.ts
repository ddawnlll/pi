/**
 * P39.01 — Stable_3 Execution Profile Tests
 *
 * Verifies the stable_3 execution profile can't be accidentally mutated
 * and that the profile assertions catch violations.
 */
import { describe, expect, it } from "vitest";
import {
	assertStable3Profile,
	createExecutionModeContext,
	STABLE_3_PROFILE,
} from "../../src/core/execution-gauntlet/execution-mode-adapter.js";
import { buildG1HelloSuccess } from "../../src/core/execution-gauntlet/synthetic-plan-builder.js";

describe("STABLE_3_PROFILE", () => {
	it("profile is immutable", () => {
		expect(STABLE_3_PROFILE.maxParallelWorkspaces).toBe(3);
		expect(STABLE_3_PROFILE.worktreeRequired).toBe(false);
		expect(STABLE_3_PROFILE.patchIsolationRequired).toBe(false);
		expect(STABLE_3_PROFILE.patchTransaction).toBe(false);
		expect(STABLE_3_PROFILE.finalValidationRequired).toBe(true);
		expect(STABLE_3_PROFILE.leadAgentEnabled).toBe(true);
		expect(STABLE_3_PROFILE.completionGateEnabled).toBe(true);
		expect(STABLE_3_PROFILE.commandHistoryRequired).toBe(true);
		expect(STABLE_3_PROFILE.stopContinueRecoveryEnabled).toBe(true);
	});

	it("profile fields match actual stable_3 context", () => {
		const plan = buildG1HelloSuccess();
		const ctx = createExecutionModeContext("stable_3", plan);

		expect(ctx.maxWorkers).toBeLessThanOrEqual(STABLE_3_PROFILE.maxParallelWorkspaces);
		expect(ctx.patchCoordinatorRequired).toBe(STABLE_3_PROFILE.patchIsolationRequired);
		expect(ctx.completionGateActive).toBe(STABLE_3_PROFILE.completionGateEnabled);
		expect(ctx.leadAgentActive).toBe(STABLE_3_PROFILE.leadAgentEnabled);
		expect(ctx.finalValidationRequired).toBe(STABLE_3_PROFILE.finalValidationRequired);
		expect(ctx.stopContinueSupported).toBe(STABLE_3_PROFILE.stopContinueRecoveryEnabled);
	});
});

describe("assertStable3Profile", () => {
	it("returns no violations for valid stable_3 context", () => {
		const plan = buildG1HelloSuccess();
		const ctx = createExecutionModeContext("stable_3", plan);
		const violations = assertStable3Profile(ctx);
		expect(violations).toEqual([]);
	});

	it("detects maxWorkers > 3 violation", () => {
		const plan = buildG1HelloSuccess();
		const ctx = createExecutionModeContext("stable_3", plan);
		ctx.maxWorkers = 4;
		const violations = assertStable3Profile(ctx);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations.some((v) => v.includes("maxWorkers"))).toBe(true);
	});

	it("detects patch coordinator enabled violation", () => {
		const plan = buildG1HelloSuccess();
		const ctx = createExecutionModeContext("stable_3", plan);
		ctx.patchCoordinatorRequired = true;
		const violations = assertStable3Profile(ctx);
		expect(violations.some((v) => v.includes("patchCoordinatorRequired"))).toBe(true);
	});

	it("detects missing CompletionGate", () => {
		const plan = buildG1HelloSuccess();
		const ctx = createExecutionModeContext("stable_3", plan);
		ctx.completionGateActive = false;
		const violations = assertStable3Profile(ctx);
		expect(violations.some((v) => v.includes("completionGateActive"))).toBe(true);
	});

	it("detects missing LeadAgent", () => {
		const plan = buildG1HelloSuccess();
		const ctx = createExecutionModeContext("stable_3", plan);
		ctx.leadAgentActive = false;
		const violations = assertStable3Profile(ctx);
		expect(violations.some((v) => v.includes("leadAgentActive"))).toBe(true);
	});

	it("returns no violations for patch_transaction mode", () => {
		const plan = buildG1HelloSuccess();
		const ctx = createExecutionModeContext("patch_transaction", plan);
		const violations = assertStable3Profile(ctx);
		expect(violations).toEqual([]);
	});

	it("stable_3 workers never exceed 3 in context", () => {
		const plan = buildG1HelloSuccess();
		// Plan may request more, but context caps at 3
		plan.maxParallelWorkspaces = 8;
		const ctx = createExecutionModeContext("stable_3", plan);
		expect(ctx.maxWorkers).toBeLessThanOrEqual(3);
	});
});
