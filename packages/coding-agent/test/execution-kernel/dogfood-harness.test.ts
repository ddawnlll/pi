import { describe, expect, it } from "vitest";
import {
	assertRetryEventOrdering,
	buildProductionLockChecklist,
	runStable1GateCheck,
	runStable3DogfoodScenario,
	runStable6StressScenario,
} from "../../src/execution-kernel/dogfood-harness.js";

describe("P32 dogfood harness", () => {
	it("stable_1 gate passes when all enforcement preconditions are enabled", () => {
		const result = runStable1GateCheck();
		expect(result.ok).toBe(true);
	});

	it("stable_3 proves controller-only state writes and terminal reconstruction", () => {
		const result = runStable3DogfoodScenario();
		expect(result.controllerOnlyWriter).toBe(true);
		expect(result.retryDuringRunningRejected).toBe(true);
		expect(result.deadlineExceededEmitted).toBe(true);
		expect(result.replayFromJournalExact).toBe(true);
		expect(result.noJsonAuthoritativeState).toBe(true);
		expect(result.handoffQueueRowCreated).toBe(true);
		expect(result.dashboardBlockedReasonPopulated).toBe(true);
		expect(result.noInfiniteRunning).toBe(true);
		expect(result.noAttemptRunningWithoutDeadline).toBe(true);
		expect(result.everyTerminalTransitionHasJournalEvidence).toBe(true);
	});

	it("stable_6 injects all required failure modes and enforcement assertions", async () => {
		const result = await runStable6StressScenario();
		expect(result.deterministic).toBe(true);
		expect(result.noOrphanProcess).toBe(true);
		expect(result.noStaleLease).toBe(true);
		expect(result.noRetryBeforeTerminal).toBe(true);
		expect(result.noGateBypass).toBe(true);
		expect(result.controllerConflictEmitted).toBe(true);
		expect(result.validationLaneSaturated).toBe(true);
		expect(result.legacyGitMutationRejected).toBe(true);
		expect(result.postgresReconnectRecovered).toBe(true);
		expect(result.replayOnlyRecoveryWorked).toBe(true);
		expect(result.noAttemptRunningWithoutDeadline).toBe(true);
		expect(result.everyTerminalTransitionHasJournalEvidence).toBe(true);
		expect(result.noLongLockSpans).toBe(true);
		expect(result.finalPlanState).toBe("HANDOFF_REQUIRED");
	});

	it("rejects retry ordering regressions for initial attempt and pre-terminal retry", () => {
		const stable3 = runStable3DogfoodScenario();
		expect(assertRetryEventOrdering(stable3.events)).toEqual({ valid: true });

		const invalid = assertRetryEventOrdering([
			{ type: "retry_attempt", timestamp: 10, workspaceId: "ws-1", data: { attempt: 1 } },
		]);
		expect(invalid.valid).toBe(false);
	});

	it("production lock is ready only when all checks pass", () => {
		const result = buildProductionLockChecklist({
			stable1Passed: true,
			stable3Passed: true,
			stable6Passed: true,
			noKnownLegacyWriter: true,
			postgresAuthoritative: true,
			jsonRuntimeFallbackDisabled: true,
			dashboardShowsBlockedReasons: true,
			handoffWorkflowUsable: true,
		});
		expect(result.ready).toBe(true);
	});
});
