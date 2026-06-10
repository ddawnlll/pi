/**
 * P44.03 — CompletionGate v2 Coverage Gate Tests
 *
 * Comprehensive tests for the V2 completion gate, covering:
 * - evaluateWorkspaceCompletionV2 with all PlanSpec mode checks
 * - Worker report lock hash echo verification
 * - AC evidence satisfaction checks
 * - Helper functions (checkEvidenceSatisfaction, buildV2Options)
 * - Completion Gate Adapter functions
 * - Edge cases and negative/positive paths
 * - Result type structural tests
 * - Integration with EvidenceLedger for satisfaction building
 */

import { describe, expect, it } from "vitest";
import {
	buildEvidenceSatisfactionFromLedger,
	buildLockHashV2Options,
	evaluateCompletionWithAdapter,
	shouldUseV2Mode,
} from "../../src/core/completion/completion-gate-adapter.js";
import type {
	EvidenceSatisfaction,
	WorkspaceCompletionResult,
} from "../../src/core/completion/completion-gate-result.js";
import {
	buildV2Options,
	checkEvidenceSatisfaction,
	evaluateWorkspaceCompletionV2,
} from "../../src/core/completion/completion-gate-v2.js";
import { EvidenceLedger } from "../../src/core/completion/evidence-ledger.js";
import { createWorkspaceValidationState, evaluateWorkspaceCompletion } from "../../src/core/completion-gate.js";
import type { Workspace } from "../../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidationState(
	overrides: Record<string, unknown> = {},
): ReturnType<typeof createWorkspaceValidationState> {
	return {
		...createWorkspaceValidationState("plan-1", "ws-1"),
		implementationFinished: true,
		targetCommandPassed: true,
		lastCommandExitCode: 0,
		...overrides,
	};
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "ws-1",
		title: "Test Workspace",
		dependencies: [],
		roleBudget: "worker" as const,
		maxRetries: 3,
		...overrides,
	};
}

function makeSatisfaction(overrides: Partial<EvidenceSatisfaction> = {}): EvidenceSatisfaction {
	return {
		satisfied: 0,
		failed: 0,
		unverified: 0,
		requiresAcceptanceCriteria: false,
		...overrides,
	};
}

// ===========================================================================
// 1. evaluateWorkspaceCompletionV2 — Base Behavior
// ===========================================================================

describe("evaluateWorkspaceCompletionV2 — base behavior", () => {
	it("returns canComplete=true when all base conditions met and no V2 blocks", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws);
		expect(result.canComplete).toBe(true);
		expect(result.blockReasons).toHaveLength(0);
	});

	it("delegates to evaluateWorkspaceCompletion for base checks (implementation not finished)", () => {
		const state = makeValidationState({ implementationFinished: false });
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws);
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons).toContain("Implementation not finished");
	});

	it("delegates to evaluateWorkspaceCompletion for base checks (target command not passed)", () => {
		const state = makeValidationState({ targetCommandPassed: false });
		const ws = makeWorkspace({ targetCommand: "npm test" });
		const result = evaluateWorkspaceCompletionV2(state, ws);
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("Target command") || r.includes("target"))).toBe(true);
	});

	it("delegates base failure signals to block completion", () => {
		const state = makeValidationState({
			failureSignals: [{ category: "test_fail" as any, rawLine: "FAIL", description: "Test failed" }],
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws);
		expect(result.canComplete).toBe(false);
	});
});

// ===========================================================================
// 2. evaluateWorkspaceCompletionV2 — PlanSpec Lock Hash Checks
// ===========================================================================

describe("evaluateWorkspaceCompletionV2 — PlanSpec lock hash checks", () => {
	it("blocks when lock hashes are not set on validation state in PlanSpec mode", () => {
		const state = makeValidationState({ planspecMode: true });
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, { planspecMode: true });
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons).toContain("Lock hashes not set on validation state in PlanSpec mode");
	});

	it("does not block for missing lock hashes when not in PlanSpec mode", () => {
		const state = makeValidationState({ planspecMode: false });
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, { planspecMode: false });
		expect(result.canComplete).toBe(true);
	});

	it("blocks when plan lock hash does not match expected", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "actual-plan-hash",
			workspaceLockHash: "actual-ws-hash",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "expected-plan-hash",
			expectedWorkspaceLockHash: "actual-ws-hash",
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("Plan lock hash mismatch"))).toBe(true);
	});

	it("blocks when workspace lock hash does not match expected", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "actual-plan-hash",
			workspaceLockHash: "actual-ws-hash",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "actual-plan-hash",
			expectedWorkspaceLockHash: "expected-ws-hash",
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("Workspace lock hash mismatch"))).toBe(true);
	});

	it("allows completion when lock hashes and worker report hashes all match", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "plan-hash-123",
			workspaceLockHash: "ws-hash-456",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "plan-hash-123",
			expectedWorkspaceLockHash: "ws-hash-456",
			workerReportedPlanLockHash: "plan-hash-123",
			workerReportedWorkspaceLockHash: "ws-hash-456",
		});
		expect(result.canComplete).toBe(true);
	});

	it("accumulates multiple lock hash block reasons", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "actual-plan",
			workspaceLockHash: "actual-ws",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "expected-plan",
			expectedWorkspaceLockHash: "expected-ws",
		});
		expect(result.canComplete).toBe(false);
		const planBlocks = result.blockReasons.filter((r) => r.includes("Plan lock hash mismatch"));
		const wsBlocks = result.blockReasons.filter((r) => r.includes("Workspace lock hash mismatch"));
		expect(planBlocks.length).toBe(1);
		expect(wsBlocks.length).toBe(1);
	});
});

// ===========================================================================
// 3. evaluateWorkspaceCompletionV2 — Worker Report Echo Checks
// ===========================================================================

describe("evaluateWorkspaceCompletionV2 — worker report echo checks", () => {
	it("blocks when worker report is missing planLockHash echo", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "plan-hash",
			workspaceLockHash: "ws-hash",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "plan-hash",
			expectedWorkspaceLockHash: "ws-hash",
			// workerReportedPlanLockHash not provided
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("missing planLockHash echo"))).toBe(true);
	});

	it("blocks when worker report planLockHash is explicitly null", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "plan-hash",
			workspaceLockHash: "ws-hash",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "plan-hash",
			expectedWorkspaceLockHash: "ws-hash",
			workerReportedPlanLockHash: null as unknown as undefined,
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("missing planLockHash echo"))).toBe(true);
	});

	it("blocks when worker report planLockHash mismatches expected", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "plan-hash",
			workspaceLockHash: "ws-hash",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "plan-hash",
			expectedWorkspaceLockHash: "ws-hash",
			workerReportedPlanLockHash: "wrong-plan-hash",
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("planLockHash mismatch"))).toBe(true);
	});

	it("blocks when worker report is missing workspaceLockHash echo", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "plan-hash",
			workspaceLockHash: "ws-hash",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "plan-hash",
			expectedWorkspaceLockHash: "ws-hash",
			workerReportedPlanLockHash: "plan-hash",
			// workerReportedWorkspaceLockHash not provided
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("missing workspaceLockHash echo"))).toBe(true);
	});

	it("blocks when worker report workspaceLockHash is explicitly null", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "plan-hash",
			workspaceLockHash: "ws-hash",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "plan-hash",
			expectedWorkspaceLockHash: "ws-hash",
			workerReportedPlanLockHash: "plan-hash",
			workerReportedWorkspaceLockHash: null as unknown as undefined,
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("missing workspaceLockHash echo"))).toBe(true);
	});

	it("blocks when worker report workspaceLockHash mismatches expected", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "plan-hash",
			workspaceLockHash: "ws-hash",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "plan-hash",
			expectedWorkspaceLockHash: "ws-hash",
			workerReportedPlanLockHash: "plan-hash",
			workerReportedWorkspaceLockHash: "wrong-ws-hash",
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("workspaceLockHash mismatch"))).toBe(true);
	});

	it("allows when both worker report hashes match expected", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "plan-hash",
			workspaceLockHash: "ws-hash",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "plan-hash",
			expectedWorkspaceLockHash: "ws-hash",
			workerReportedPlanLockHash: "plan-hash",
			workerReportedWorkspaceLockHash: "ws-hash",
		});
		expect(result.canComplete).toBe(true);
	});

	it("worker report echo checks are skipped when not in PlanSpec mode", () => {
		// Even with undefined workerReportedPlanLockHash, no block because planspecMode is false
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: false,
			// Missing worker hashes but not in PlanSpec mode
		});
		expect(result.canComplete).toBe(true);
	});

	it("does not report mismatch when expectedPlanLockHash is not provided, even if worker hash differs", () => {
		// When expectedPlanLockHash is not set, the mismatch check is skipped
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "plan-hash",
			workspaceLockHash: "ws-hash",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			workerReportedPlanLockHash: "some-other-hash",
			workerReportedWorkspaceLockHash: "ws-hash",
		});
		// Should still block for missing expected hashes on lock hash check but not for echo mismatch
		// Since expectedPlanLockHash is not provided, the echo mismatch check is skipped
		expect(result.blockReasons.some((r) => r.includes("planLockHash mismatch"))).toBe(false);
	});
});

// ===========================================================================
// 4. evaluateWorkspaceCompletionV2 — AC Evidence Satisfaction Checks
// ===========================================================================

describe("evaluateWorkspaceCompletionV2 — AC evidence satisfaction checks", () => {
	it("blocks when there are unverified ACs with requiresAcceptanceCriteria", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			evidenceSatisfaction: makeSatisfaction({ unverified: 2, requiresAcceptanceCriteria: true }),
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("unverified"))).toBe(true);
	});

	it("does NOT block when there are unverified ACs but requiresAcceptanceCriteria is false", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			evidenceSatisfaction: makeSatisfaction({ unverified: 2, requiresAcceptanceCriteria: false }),
		});
		expect(result.canComplete).toBe(true);
	});

	it("blocks when there are failed ACs", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			evidenceSatisfaction: makeSatisfaction({ failed: 1 }),
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("failed"))).toBe(true);
	});

	it("allows when all AC evidence is satisfied", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			evidenceSatisfaction: makeSatisfaction({ satisfied: 3, requiresAcceptanceCriteria: true }),
		});
		expect(result.canComplete).toBe(true);
	});

	it("allows when evidenceSatisfaction is not provided", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws);
		expect(result.canComplete).toBe(true);
	});

	it("blocks with both unverified and failed ACs", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			evidenceSatisfaction: makeSatisfaction({
				unverified: 1,
				failed: 2,
				requiresAcceptanceCriteria: true,
			}),
		});
		expect(result.canComplete).toBe(false);
		const unverifiedBlock = result.blockReasons.some((r) => r.includes("unverified"));
		const failedBlock = result.blockReasons.some((r) => r.includes("failed"));
		expect(unverifiedBlock).toBe(true);
		expect(failedBlock).toBe(true);
	});

	it("allows with zero counts across the board", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			evidenceSatisfaction: makeSatisfaction({
				satisfied: 0,
				failed: 0,
				unverified: 0,
				requiresAcceptanceCriteria: true,
			}),
		});
		expect(result.canComplete).toBe(true);
	});
});

// ===========================================================================
// 5. evaluateWorkspaceCompletionV2 — Combined Checks
// ===========================================================================

describe("evaluateWorkspaceCompletionV2 — combined checks", () => {
	it("accumulates all block reasons from base, lock hash, and evidence checks", () => {
		const state = makeValidationState({
			implementationFinished: false,
			planspecMode: true,
			planLockHash: "plan-hash",
			workspaceLockHash: "ws-hash",
		});
		const ws = makeWorkspace({ targetCommand: "npm test" });
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "other-plan",
			expectedWorkspaceLockHash: "other-ws",
			evidenceSatisfaction: makeSatisfaction({ failed: 1, requiresAcceptanceCriteria: true }),
		});
		expect(result.canComplete).toBe(false);
		// Should have at least: implementation not finished + plan hash mismatch + ws hash mismatch + AC failed
		expect(result.blockReasons.length).toBeGreaterThanOrEqual(4);
	});

	it("recommendedState from base check is preserved when V2 blocks", () => {
		const state = makeValidationState({
			implementationFinished: false,
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			evidenceSatisfaction: makeSatisfaction({ failed: 1 }),
		});
		expect(result.canComplete).toBe(false);
		expect(result.recommendedState).toBeDefined();
	});
});

// ===========================================================================
// 6. checkEvidenceSatisfaction Helper
// ===========================================================================

describe("checkEvidenceSatisfaction", () => {
	it("returns empty array when all conditions met", () => {
		const reasons = checkEvidenceSatisfaction(makeSatisfaction({ satisfied: 3 }));
		expect(reasons).toHaveLength(0);
	});

	it("returns unverified reason when requiresAcceptanceCriteria and unverified > 0", () => {
		const reasons = checkEvidenceSatisfaction(makeSatisfaction({ unverified: 1, requiresAcceptanceCriteria: true }));
		expect(reasons).toHaveLength(1);
		expect(reasons[0]).toContain("unverified");
	});

	it("returns empty when unverified > 0 but requiresAcceptanceCriteria is false", () => {
		const reasons = checkEvidenceSatisfaction(makeSatisfaction({ unverified: 2, requiresAcceptanceCriteria: false }));
		expect(reasons).toHaveLength(0);
	});

	it("returns failed reason when failed > 0", () => {
		const reasons = checkEvidenceSatisfaction(makeSatisfaction({ failed: 1 }));
		expect(reasons).toHaveLength(1);
		expect(reasons[0]).toContain("failed");
	});

	it("returns both unverified and failed reasons", () => {
		const reasons = checkEvidenceSatisfaction(
			makeSatisfaction({
				unverified: 1,
				failed: 2,
				requiresAcceptanceCriteria: true,
			}),
		);
		expect(reasons).toHaveLength(2);
	});

	it("handles all-zero counts", () => {
		const reasons = checkEvidenceSatisfaction(makeSatisfaction());
		expect(reasons).toHaveLength(0);
	});
});

// ===========================================================================
// 7. buildV2Options Helper
// ===========================================================================

describe("buildV2Options", () => {
	it("returns default options when no overrides provided", () => {
		const opts = buildV2Options();
		expect(opts.planspecMode).toBe(false);
		expect(opts.evidenceSatisfaction).toBeUndefined();
	});

	it("merges partial overrides with defaults", () => {
		const opts = buildV2Options({ planspecMode: true });
		expect(opts.planspecMode).toBe(true);
		expect(opts.evidenceSatisfaction).toBeUndefined();
	});

	it("accepts full overrides", () => {
		const es: EvidenceSatisfaction = { satisfied: 2, failed: 0, unverified: 0, requiresAcceptanceCriteria: true };
		const opts = buildV2Options({
			planspecMode: true,
			evidenceSatisfaction: es,
			expectedPlanLockHash: "plan-hash",
			expectedWorkspaceLockHash: "ws-hash",
		});
		expect(opts.planspecMode).toBe(true);
		expect(opts.evidenceSatisfaction).toEqual(es);
		expect(opts.expectedPlanLockHash).toBe("plan-hash");
		expect(opts.expectedWorkspaceLockHash).toBe("ws-hash");
	});
});

// ===========================================================================
// 8. Completion Gate Adapter — buildEvidenceSatisfactionFromLedger
// ===========================================================================

describe("buildEvidenceSatisfactionFromLedger", () => {
	it("returns all unverified when ledger has no entries for criteria", () => {
		const ledger = new EvidenceLedger("test-scope");
		const result = buildEvidenceSatisfactionFromLedger(ledger, ["AC-01", "AC-02"]);
		expect(result.unverified).toBe(2);
		expect(result.satisfied).toBe(0);
		expect(result.failed).toBe(0);
		expect(result.requiresAcceptanceCriteria).toBe(true);
	});

	it("returns empty satisfaction when criterionIds is empty", () => {
		const ledger = new EvidenceLedger("test-scope");
		const result = buildEvidenceSatisfactionFromLedger(ledger, []);
		expect(result.unverified).toBe(0);
		expect(result.satisfied).toBe(0);
		expect(result.failed).toBe(0);
		expect(result.requiresAcceptanceCriteria).toBe(false);
	});

	it("counts passed evidence as satisfied", () => {
		const ledger = new EvidenceLedger("test-scope");
		ledger.add({
			id: "ev-1",
			type: "test_run",
			description: "Tests pass",
			source: "npm test",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "high",
			content: "All tests passed",
			criterionIds: ["AC-01"],
		});
		const result = buildEvidenceSatisfactionFromLedger(ledger, ["AC-01"]);
		expect(result.satisfied).toBe(1);
		expect(result.unverified).toBe(0);
		expect(result.failed).toBe(0);
	});

	it("counts failed evidence as failed even when pass evidence also exists", () => {
		const ledger = new EvidenceLedger("test-scope");
		ledger.add({
			id: "ev-1",
			type: "test_run",
			description: "Tests pass",
			source: "npm test",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "high",
			content: "All tests passed",
			criterionIds: ["AC-01"],
		});
		ledger.add({
			id: "ev-2",
			type: "test_run",
			description: "Tests fail",
			source: "npm test",
			timestamp: Date.now(),
			verdict: "fail",
			confidence: "high",
			content: "Test failed",
			criterionIds: ["AC-01"],
		});
		const result = buildEvidenceSatisfactionFromLedger(ledger, ["AC-01"]);
		expect(result.failed).toBe(1);
		expect(result.satisfied).toBe(0);
	});

	it("counts multiple criteria independently", () => {
		const ledger = new EvidenceLedger("test-scope");
		ledger.add({
			id: "ev-1",
			type: "test_run",
			description: "AC-01 passes",
			source: "npm test",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "high",
			content: "Passed",
			criterionIds: ["AC-01"],
		});
		ledger.add({
			id: "ev-2",
			type: "test_run",
			description: "AC-02 fails",
			source: "npm test",
			timestamp: Date.now(),
			verdict: "fail",
			confidence: "high",
			content: "Failed",
			criterionIds: ["AC-02"],
		});
		const result = buildEvidenceSatisfactionFromLedger(ledger, ["AC-01", "AC-02"]);
		expect(result.satisfied).toBe(1);
		expect(result.failed).toBe(1);
		expect(result.unverified).toBe(0);
	});

	it("counts criteria with evidence but no pass/fail verdict as unverified", () => {
		const ledger = new EvidenceLedger("test-scope");
		ledger.add({
			id: "ev-1",
			type: "other",
			description: "Info only",
			source: "manual",
			timestamp: Date.now(),
			verdict: "not_evaluated",
			confidence: "low",
			content: "Info",
			criterionIds: ["AC-01"],
		});
		const result = buildEvidenceSatisfactionFromLedger(ledger, ["AC-01"]);
		expect(result.satisfied).toBe(0);
		expect(result.failed).toBe(0);
		expect(result.unverified).toBe(1);
	});
});

// ===========================================================================
// 9. Completion Gate Adapter — evaluateCompletionWithAdapter
// ===========================================================================

describe("evaluateCompletionWithAdapter", () => {
	it("returns only v1 result when no v2 options", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateCompletionWithAdapter(state, ws);
		expect(result.canComplete).toBe(true);
	});

	it("runs v2 checks on top of v1 when options provided", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateCompletionWithAdapter(state, ws, {
			evidenceSatisfaction: makeSatisfaction({ failed: 1 }),
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("failed"))).toBe(true);
	});

	it("merges block reasons from both v1 and v2", () => {
		const state = makeValidationState({
			implementationFinished: false,
		});
		const ws = makeWorkspace();
		const result = evaluateCompletionWithAdapter(state, ws, {
			evidenceSatisfaction: makeSatisfaction({ failed: 1 }),
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("Implementation not finished"))).toBe(true);
		expect(result.blockReasons.some((r) => r.includes("failed"))).toBe(true);
	});

	it("deduplicates block reasons when both v1 and v2 produce the same reason", () => {
		const state = makeValidationState({
			implementationFinished: false,
		});
		const ws = makeWorkspace();
		const result = evaluateCompletionWithAdapter(state, ws, {
			evidenceSatisfaction: makeSatisfaction({ failed: 1 }),
		});
		// Check that "Implementation not finished" appears exactly once
		const implBlocks = result.blockReasons.filter((r) => r.includes("Implementation not finished"));
		expect(implBlocks).toHaveLength(1);
	});

	it("prefers v2 recommendedState when v1 also blocks", () => {
		const state = makeValidationState({
			implementationFinished: false,
		});
		const ws = makeWorkspace();
		// v1 should set recommendedState on its own
		const result = evaluateCompletionWithAdapter(state, ws, {
			evidenceSatisfaction: makeSatisfaction({ failed: 1 }),
		});
		expect(result.recommendedState).toBeDefined();
	});
});

// ===========================================================================
// 10. Completion Gate Adapter — buildLockHashV2Options
// ===========================================================================

describe("buildLockHashV2Options", () => {
	it("builds options with lock hashes from validation state", () => {
		const state = makeValidationState({
			planLockHash: "plan-hash-123",
			workspaceLockHash: "ws-hash-456",
		});
		const opts = buildLockHashV2Options(state);
		expect(opts.planspecMode).toBe(true);
		expect(opts.expectedPlanLockHash).toBe("plan-hash-123");
		expect(opts.expectedWorkspaceLockHash).toBe("ws-hash-456");
	});

	it("includes worker reported hashes when provided", () => {
		const state = makeValidationState({
			planLockHash: "plan-hash",
			workspaceLockHash: "ws-hash",
		});
		const opts = buildLockHashV2Options(state, "worker-plan", "worker-ws");
		expect(opts.workerReportedPlanLockHash).toBe("worker-plan");
		expect(opts.workerReportedWorkspaceLockHash).toBe("worker-ws");
	});

	it("handles missing validation state lock hashes", () => {
		const state = makeValidationState();
		const opts = buildLockHashV2Options(state);
		expect(opts.expectedPlanLockHash).toBeUndefined();
		expect(opts.expectedWorkspaceLockHash).toBeUndefined();
	});
});

// ===========================================================================
// 11. Completion Gate Adapter — shouldUseV2Mode
// ===========================================================================

describe("shouldUseV2Mode", () => {
	it("returns true when workspace has acceptance criteria", () => {
		const state = makeValidationState();
		const ws = makeWorkspace({ acceptanceCriteria: ["AC-01"] });
		expect(shouldUseV2Mode(ws, state)).toBe(true);
	});

	it("returns true when validation state has lock hashes", () => {
		const state = makeValidationState({ planLockHash: "hash", workspaceLockHash: "hash" });
		const ws = makeWorkspace();
		expect(shouldUseV2Mode(ws, state)).toBe(true);
	});

	it("returns false when no acceptance criteria and no lock hashes", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		expect(shouldUseV2Mode(ws, state)).toBe(false);
	});

	it("returns true when only planLockHash is set", () => {
		const state = makeValidationState({ planLockHash: "hash" });
		const ws = makeWorkspace();
		expect(shouldUseV2Mode(ws, state)).toBe(true);
	});

	it("returns true when only workspaceLockHash is set", () => {
		const state = makeValidationState({ workspaceLockHash: "hash" });
		const ws = makeWorkspace();
		expect(shouldUseV2Mode(ws, state)).toBe(true);
	});
});

// ===========================================================================
// 12. Result Type Structural Tests
// ===========================================================================

describe("WorkspaceCompletionResult type structure", () => {
	it("has the expected shape for a successful result", () => {
		const result: WorkspaceCompletionResult = {
			canComplete: true,
			blockReasons: [],
		};
		expect(result.canComplete).toBe(true);
		expect(result.blockReasons).toEqual([]);
	});

	it("has the expected shape for a blocked result", () => {
		const result: WorkspaceCompletionResult = {
			canComplete: false,
			blockReasons: ["Reason 1", "Reason 2"],
			recommendedState: "Blocked" as any,
		};
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons).toHaveLength(2);
		expect(result.recommendedState).toBeDefined();
	});
});

describe("EvidenceSatisfaction type structure", () => {
	it("holds satisfaction counts correctly", () => {
		const es: EvidenceSatisfaction = {
			satisfied: 5,
			failed: 0,
			unverified: 1,
			requiresAcceptanceCriteria: true,
		};
		expect(es.satisfied).toBe(5);
		expect(es.failed).toBe(0);
		expect(es.unverified).toBe(1);
		expect(es.requiresAcceptanceCriteria).toBe(true);
	});
});

// ===========================================================================
// 13. evaluateWorkspaceCompletionV2 — Edge Cases
// ===========================================================================

describe("evaluateWorkspaceCompletionV2 — edge cases", () => {
	it("handles null/undefined options gracefully", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		expect(() => evaluateWorkspaceCompletionV2(state, ws, null as unknown as undefined)).not.toThrow();
		expect(() => evaluateWorkspaceCompletionV2(state, ws, undefined)).not.toThrow();
	});

	it("handles empty options object", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {});
		expect(result.canComplete).toBe(true);
	});

	it("handles evidenceSatisfaction with zero unverified and requiresAcceptanceCriteria true", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			evidenceSatisfaction: makeSatisfaction({ requiresAcceptanceCriteria: true }),
		});
		expect(result.canComplete).toBe(true);
	});

	it("lock hash check is skipped when expectedPlanLockHash is not provided", () => {
		const state = makeValidationState({
			planspecMode: true,
			planLockHash: "actual-hash",
			workspaceLockHash: "ws-hash",
		});
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			// expectedPlanLockHash not provided — no mismatch check
			expectedWorkspaceLockHash: "ws-hash",
		});
		// Should pass because lock hashes ARE set (so no "not set" error)
		// and no expectedPlanLockHash to compare against
		// But worker report echo will fail since not provided
		expect(result.canComplete).toBe(false);
		// Block should only be about worker report echo, not lock hash
		expect(result.blockReasons.filter((r) => r.includes("missing planLockHash echo")).length).toBe(1);
	});

	it("blocks on missing lock hashes when planspecMode is true, even without explicit options", () => {
		// When options has planspecMode:true but no lock hashes on state
		const state = makeValidationState({ planspecMode: true }); // no lock hashes
		const ws = makeWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, { planspecMode: true });
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("Lock hashes not set"))).toBe(true);
	});
});

// ===========================================================================
// 14. Cross-Validation: V2 vs evaluateWorkspaceCompletion consistency
// ===========================================================================

describe("V2 vs base evaluateWorkspaceCompletion consistency", () => {
	it("returns same base result as evaluateWorkspaceCompletion when no V2 options", () => {
		const state = makeValidationState({ implementationFinished: false });
		const ws = makeWorkspace();
		const v1Result = evaluateWorkspaceCompletion(state, ws);
		const v2Result = evaluateWorkspaceCompletionV2(state, ws);
		expect(v2Result.canComplete).toBe(v1Result.canComplete);
		expect(v2Result.blockReasons).toEqual(v1Result.blockReasons);
	});

	it("V2 adds block reasons on top of base when V2 options specify issues", () => {
		const state = makeValidationState();
		const ws = makeWorkspace();
		const v1Result = evaluateWorkspaceCompletion(state, ws);
		const v2Result = evaluateWorkspaceCompletionV2(state, ws, {
			evidenceSatisfaction: makeSatisfaction({ failed: 1 }),
		});
		// v1 says canComplete, v2 adds block
		expect(v1Result.canComplete).toBe(true);
		expect(v2Result.canComplete).toBe(false);
		expect(v2Result.blockReasons.length).toBeGreaterThan(v1Result.blockReasons.length);
	});
});

// ===========================================================================
// 15. Module Exports Validation
// ===========================================================================

describe("completion-gate-v2 module exports", () => {
	it("exports evaluateWorkspaceCompletionV2 as a function", () => {
		expect(typeof evaluateWorkspaceCompletionV2).toBe("function");
	});

	it("exports checkEvidenceSatisfaction as a function", () => {
		expect(typeof checkEvidenceSatisfaction).toBe("function");
	});

	it("exports buildV2Options as a function", () => {
		expect(typeof buildV2Options).toBe("function");
	});
});

describe("completion-gate-adapter module exports", () => {
	it("exports buildEvidenceSatisfactionFromLedger as a function", () => {
		expect(typeof buildEvidenceSatisfactionFromLedger).toBe("function");
	});

	it("exports evaluateCompletionWithAdapter as a function", () => {
		expect(typeof evaluateCompletionWithAdapter).toBe("function");
	});

	it("exports buildLockHashV2Options as a function", () => {
		expect(typeof buildLockHashV2Options).toBe("function");
	});

	it("exports shouldUseV2Mode as a function", () => {
		expect(typeof shouldUseV2Mode).toBe("function");
	});
});
