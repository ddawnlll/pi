/**
 * Tests for P4.6.1 — Completion Gate Hardening & Log Isolation
 *
 * Proves that false-complete cannot happen when logs contain:
 * - FAIL test file
 * - Tests: X passed, Y failed
 * - Error: messages
 * - Out of retries
 * - File not found
 * - Watch-mode validation commands
 * - Non-zero exit codes
 *
 * Also verifies:
 * - Plan does not complete if any workspace is failed/blocked/interrupted
 * - Watch-mode commands are blocked/rewritten
 * - Old workspace events from different planExecId/workspaceId are ignored
 * - Validation lock still releases on failed validation
 * - Complete workspace remains complete only when no unresolved failures exist
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	CompletionGateRegistry,
	createWorkspaceValidationState,
	evaluatePlanCompletion,
	evaluateWorkspaceCompletion,
	isWorkspaceLegitimatelyComplete,
	mergeFailureSignals,
	recordCommandCompletion,
	recordValidationCommand,
	type WorkspaceValidationState,
} from "../src/core/completion-gate.js";
import { createEventBus } from "../src/core/event-bus.js";
import {
	detectFailureSignals,
	FailureSignalCategory,
	recordExitCodeFailure,
	scanLogLines,
} from "../src/core/log-failure-detector.js";
import type { WorkspaceState } from "../src/core/plan-state.js";
import {
	resetGlobalValidationLock,
	VALIDATION_LOCK_ACQUIRED,
	VALIDATION_LOCK_RELEASED,
	VALIDATION_LOCK_WAITING,
	withValidationLock,
} from "../src/core/validation-lock.js";
import { isWatchModeCommand, rewriteToNonWatch, validateCommand } from "../src/core/watch-mode-guard.js";
import type { Workspace } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a basic workspace for testing. */
function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "4.6.A",
		title: "Test Workspace",
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 3,
		...overrides,
	};
}

/** Create a basic validation state for a workspace. */
function makeValidationState(
	planExecId: string = "plan-1",
	workspaceId: string = "4.6.A",
	overrides: Partial<WorkspaceValidationState> = {},
): WorkspaceValidationState {
	return {
		...createWorkspaceValidationState(planExecId, workspaceId),
		implementationFinished: true,
		targetCommandPassed: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// 1. Log Failure Detector
// ---------------------------------------------------------------------------

describe("log-failure-detector", () => {
	it("detects FAIL <test file> in log line", () => {
		const signals = detectFailureSignals("FAIL src/hooks/useWorkspaceLogStream.test.ts");
		expect(signals.length).toBeGreaterThan(0);
		expect(signals[0].category).toBe(FailureSignalCategory.TestFail);
		expect(signals[0].rawLine).toContain("FAIL");
	});

	it("detects 'Tests: X passed, Y failed' summary", () => {
		const signals = detectFailureSignals("Tests: 3 passed, 1 failed, 4 total");
		expect(signals.length).toBeGreaterThan(0);
		const summary = signals.find((s) => s.category === FailureSignalCategory.TestSummaryFail);
		expect(summary).toBeDefined();
		expect(summary!.description).toContain("1 failed");
	});

	it("detects vitest summary with 'failed,'", () => {
		const signals = detectFailureSignals("Test Files  2 failed, 3 passed");
		const vitest = signals.find((s) => s.category === FailureSignalCategory.VitestSummaryFail);
		expect(vitest).toBeDefined();
	});

	it("detects 'Error:' lines", () => {
		const signals = detectFailureSignals("Error: Out of retries for workspace 3.2.B");
		expect(signals.length).toBeGreaterThan(0);
		expect(signals.some((s) => s.category === FailureSignalCategory.ErrorLine)).toBe(true);
	});

	it("detects 'Out of retries'", () => {
		const signals = detectFailureSignals("Error: Out of retries for workspace 3.2.B");
		expect(signals.some((s) => s.category === FailureSignalCategory.OutOfRetries)).toBe(true);
	});

	it("detects 'File not found:'", () => {
		const signals = detectFailureSignals("Error: File not found: src/deleted-component.tsx");
		expect(signals.some((s) => s.category === FailureSignalCategory.FileNotFound)).toBe(true);
	});

	it("detects multiple signals in a single line", () => {
		const signals = detectFailureSignals("Error: Out of retries for workspace 3.2.B");
		// Both Error: and Out of retries should be detected
		expect(signals.length).toBeGreaterThanOrEqual(2);
	});

	it("returns empty array for clean log lines", () => {
		const signals = detectFailureSignals("All tests passed");
		expect(signals).toHaveLength(0);
	});

	it("returns empty array for empty lines", () => {
		const signals = detectFailureSignals("");
		expect(signals).toHaveLength(0);
	});

	it("scanLogLines aggregates signals across multiple lines", () => {
		const lines = [
			"PASS src/utils/format.test.ts",
			"FAIL src/hooks/useWorkspaceLogStream.test.ts",
			"Tests: 3 passed, 1 failed, 4 total",
		];
		const result = scanLogLines(lines);
		expect(result.hasFailures).toBe(true);
		expect(result.signals.length).toBeGreaterThanOrEqual(2);
	});

	it("scanLogLines returns no failures for clean output", () => {
		const lines = ["PASS src/utils/format.test.ts", "PASS src/hooks/useSettings.test.ts", "Tests: 2 passed, 2 total"];
		const result = scanLogLines(lines);
		expect(result.hasFailures).toBe(false);
	});

	it("recordExitCodeFailure returns signal for non-zero code", () => {
		const signal = recordExitCodeFailure(1, "vitest run");
		expect(signal).not.toBeNull();
		expect(signal!.category).toBe(FailureSignalCategory.NonZeroExitCode);
	});

	it("recordExitCodeFailure returns null for zero code", () => {
		const signal = recordExitCodeFailure(0, "vitest run");
		expect(signal).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 2. Watch-Mode Guard
// ---------------------------------------------------------------------------

describe("watch-mode-guard", () => {
	it("blocks vitest --watch", () => {
		expect(isWatchModeCommand("vitest --watch")).toBe(true);
	});

	it("blocks vitest --watchAll", () => {
		expect(isWatchModeCommand("vitest --watchAll")).toBe(true);
	});

	it("blocks vitest --ui", () => {
		expect(isWatchModeCommand("vitest --ui")).toBe(true);
	});

	it("blocks 'npm test -- --watch'", () => {
		expect(isWatchModeCommand("npm test -- --watch")).toBe(true);
	});

	it("blocks 'npm run test -- --watch'", () => {
		expect(isWatchModeCommand("npm run test -- --watch")).toBe(true);
	});

	it("blocks 'pnpm test -- --watch'", () => {
		expect(isWatchModeCommand("pnpm test -- --watch")).toBe(true);
	});

	it("blocks 'jest --watch'", () => {
		expect(isWatchModeCommand("jest --watch")).toBe(true);
	});

	it("blocks 'npm run dev'", () => {
		expect(isWatchModeCommand("npm run dev")).toBe(true);
	});

	it("blocks 'vite dev'", () => {
		expect(isWatchModeCommand("vite dev")).toBe(true);
	});

	it("blocks 'vite --host'", () => {
		expect(isWatchModeCommand("vite --host")).toBe(true);
	});

	it("allows 'vitest run'", () => {
		expect(isWatchModeCommand("vitest run")).toBe(false);
	});

	it("allows 'npm test -- --run'", () => {
		expect(isWatchModeCommand("npm test -- --run")).toBe(false);
	});

	it("allows 'npm run typecheck'", () => {
		expect(isWatchModeCommand("npm run typecheck")).toBe(false);
	});

	it("allows 'npm run build'", () => {
		expect(isWatchModeCommand("npm run build")).toBe(false);
	});

	it("rewrites vitest --watch to vitest run", () => {
		expect(rewriteToNonWatch("vitest --watch")).toBe("vitest run");
	});

	it("rewrites npm test -- --watch to npm test -- --run", () => {
		expect(rewriteToNonWatch("npm test -- --watch")).toBe("npm test -- --run");
	});

	it("rewrites npm run dev to npm run build", () => {
		expect(rewriteToNonWatch("npm run dev")).toBe("npm run build");
	});

	it("rewrites vite dev to vite build", () => {
		expect(rewriteToNonWatch("vite dev")).toBe("vite build");
	});

	it("returns null for non-watch commands", () => {
		expect(rewriteToNonWatch("vitest run")).toBeNull();
	});

	it("validateCommand returns invalid for watch-mode", () => {
		const result = validateCommand("vitest --watch");
		expect(result.valid).toBe(false);
		expect(result.isWatchMode).toBe(true);
		expect(result.suggestedAlternative).toBe("vitest run");
	});

	it("validateCommand returns valid for non-watch", () => {
		const result = validateCommand("vitest run");
		expect(result.valid).toBe(true);
		expect(result.isWatchMode).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 3. Workspace Completion Gate
// ---------------------------------------------------------------------------

describe("completion-gate: workspace", () => {
	it("workspace can complete when all conditions are met", () => {
		const state = makeValidationState();
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(true);
	});

	it("workspace does not complete when typecheck passes but test fails", () => {
		const signals = detectFailureSignals("FAIL src/hooks/useWorkspaceLogStream.test.ts");
		const state = makeValidationState("plan-1", "4.6.A", {
			failureSignals: signals,
		});
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("Unresolved test failures"))).toBe(true);
	});

	it("workspace does not complete when log contains 'FAIL src/hooks/useWorkspaceLogStream.test.ts'", () => {
		const signals = detectFailureSignals("FAIL src/hooks/useWorkspaceLogStream.test.ts");
		const state = makeValidationState("plan-1", "4.6.A", {
			failureSignals: signals,
		});
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
	});

	it("workspace does not complete when 'Tests: 3 passed, 1 failed' appears", () => {
		const signals = detectFailureSignals("Tests: 3 passed, 1 failed, 4 total");
		const state = makeValidationState("plan-1", "4.6.A", {
			failureSignals: signals,
		});
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
	});

	it("workspace does not complete on 'Out of retries'", () => {
		const signals = detectFailureSignals("Error: Out of retries for workspace 3.2.B");
		const state = makeValidationState("plan-1", "4.6.A", {
			failureSignals: signals,
			outOfRetries: true,
		});
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
		expect(result.recommendedState).toBe(WorkspaceStage.Failed);
	});

	it("workspace does not complete when implementation is not finished", () => {
		const state = makeValidationState("plan-1", "4.6.A", {
			implementationFinished: false,
		});
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons).toContain("Implementation not finished");
	});

	it("workspace does not complete when target command did not pass", () => {
		const state = makeValidationState("plan-1", "4.6.A", {
			targetCommandPassed: false,
		});
		const workspace = makeWorkspace({ targetCommand: "vitest run" });
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
	});

	it("workspace does not complete when target command is still running", () => {
		const state = makeValidationState("plan-1", "4.6.A", {
			targetCommandRunning: true,
		});
		const workspace = makeWorkspace({ targetCommand: "vitest run" });
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("still running"))).toBe(true);
	});

	it("workspace does not complete when validation command is still running", () => {
		const state = makeValidationState("plan-1", "4.6.A", {
			validationCommandRunning: true,
		});
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
	});

	it("workspace does not complete when watch-mode command was used", () => {
		const state = makeValidationState("plan-1", "4.6.A", {
			watchModeCommandDetected: true,
			watchModeCommand: "vitest --watch",
		});
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("watch-mode"))).toBe(true);
		expect(result.recommendedState).toBe(WorkspaceStage.Blocked);
	});

	it("workspace does not complete on non-zero exit code", () => {
		const exitSignal = recordExitCodeFailure(1, "vitest run");
		const state = makeValidationState("plan-1", "4.6.A", {
			lastCommandExitCode: 1,
			failureSignals: exitSignal ? [exitSignal] : [],
		});
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
	});

	it("workspace with no targetCommand passes without checking target", () => {
		const state = makeValidationState("plan-1", "4.6.A", {
			targetCommandPassed: null,
		});
		const workspace = makeWorkspace({ targetCommand: undefined });
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(true);
	});

	it("complete workspace remains complete when no unresolved failures exist", () => {
		const state = makeValidationState("plan-1", "4.6.A");
		const workspace = makeWorkspace();
		expect(isWorkspaceLegitimatelyComplete(state, workspace)).toBe(true);
	});

	it("complete workspace is NOT legitimately complete after new failure signals arrive", () => {
		const state = makeValidationState("plan-1", "4.6.A");
		const workspace = makeWorkspace();
		expect(isWorkspaceLegitimatelyComplete(state, workspace)).toBe(true);

		// Now add a failure signal
		const signals = detectFailureSignals("FAIL src/foo.test.ts");
		const updatedState = mergeFailureSignals(state, signals, "plan-1", "4.6.A");
		expect(isWorkspaceLegitimatelyComplete(updatedState, workspace)).toBe(false);
	});

	it("workspace with only test failures (not out-of-retries) recommends blocked", () => {
		const signals = detectFailureSignals("FAIL src/foo.test.ts");
		const state = makeValidationState("plan-1", "4.6.A", {
			implementationFinished: true,
			failureSignals: signals,
		});
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
		expect(result.recommendedState).toBe(WorkspaceStage.Blocked);
	});
});

// ---------------------------------------------------------------------------
// 4. Plan Completion Gate
// ---------------------------------------------------------------------------

describe("completion-gate: plan", () => {
	it("plan can complete when all workspaces are complete", () => {
		const workspaces = new Map<string, WorkspaceState>([
			["4.6.A", { workspaceId: "4.6.A", stage: WorkspaceStage.Complete, attempts: 1 }],
			["4.6.B", { workspaceId: "4.6.B", stage: WorkspaceStage.Complete, attempts: 1 }],
		]);
		const result = evaluatePlanCompletion(workspaces);
		expect(result.canComplete).toBe(true);
	});

	it("plan does not complete if any workspace is failed", () => {
		const workspaces = new Map<string, WorkspaceState>([
			["4.6.A", { workspaceId: "4.6.A", stage: WorkspaceStage.Complete, attempts: 1 }],
			["4.6.B", { workspaceId: "4.6.B", stage: WorkspaceStage.Failed, attempts: 3 }],
		]);
		const result = evaluatePlanCompletion(workspaces);
		expect(result.canComplete).toBe(false);
		expect(result.unhealthyWorkspaceIds).toContain("4.6.B");
	});

	it("plan does not complete if any workspace is blocked", () => {
		const workspaces = new Map<string, WorkspaceState>([
			["4.6.A", { workspaceId: "4.6.A", stage: WorkspaceStage.Complete, attempts: 1 }],
			["4.6.B", { workspaceId: "4.6.B", stage: WorkspaceStage.Blocked, attempts: 2 }],
		]);
		const result = evaluatePlanCompletion(workspaces);
		expect(result.canComplete).toBe(false);
		expect(result.unhealthyWorkspaceIds).toContain("4.6.B");
	});

	it("plan does not complete if any workspace is still pending", () => {
		const workspaces = new Map<string, WorkspaceState>([
			["4.6.A", { workspaceId: "4.6.A", stage: WorkspaceStage.Complete, attempts: 1 }],
			["4.6.B", { workspaceId: "4.6.B", stage: WorkspaceStage.Pending, attempts: 0 }],
		]);
		const result = evaluatePlanCompletion(workspaces);
		expect(result.canComplete).toBe(false);
	});

	it("plan does not complete if any workspace is still active", () => {
		const workspaces = new Map<string, WorkspaceState>([
			["4.6.A", { workspaceId: "4.6.A", stage: WorkspaceStage.Complete, attempts: 1 }],
			["4.6.B", { workspaceId: "4.6.B", stage: WorkspaceStage.Active, attempts: 1 }],
		]);
		const result = evaluatePlanCompletion(workspaces);
		expect(result.canComplete).toBe(false);
	});

	it("plan does not complete with multiple unhealthy workspaces", () => {
		const workspaces = new Map<string, WorkspaceState>([
			["4.6.A", { workspaceId: "4.6.A", stage: WorkspaceStage.Failed, attempts: 3 }],
			["4.6.B", { workspaceId: "4.6.B", stage: WorkspaceStage.Blocked, attempts: 2 }],
			["4.6.C", { workspaceId: "4.6.C", stage: WorkspaceStage.Complete, attempts: 1 }],
		]);
		const result = evaluatePlanCompletion(workspaces);
		expect(result.canComplete).toBe(false);
		expect(result.unhealthyWorkspaceIds).toHaveLength(2);
		expect(result.unhealthyWorkspaceIds).toContain("4.6.A");
		expect(result.unhealthyWorkspaceIds).toContain("4.6.B");
	});

	it("empty workspace map allows completion", () => {
		const result = evaluatePlanCompletion(new Map());
		expect(result.canComplete).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 5. Log Isolation (planExecId + workspaceId scoping)
// ---------------------------------------------------------------------------

describe("completion-gate: log isolation", () => {
	it("old workspace event from different planExecId is ignored", () => {
		const state = createWorkspaceValidationState("plan-current", "4.6.A");
		// Signals from a different planExecId should be dropped
		const signals = detectFailureSignals("FAIL src/foo.test.ts");
		const updated = mergeFailureSignals(state, signals, "plan-old", "4.6.A");
		expect(updated.failureSignals).toHaveLength(0);
	});

	it("old workspace event from different workspaceId is ignored", () => {
		const state = createWorkspaceValidationState("plan-1", "4.6.A");
		// Signals for a different workspaceId should be dropped
		const signals = detectFailureSignals("FAIL src/foo.test.ts");
		const updated = mergeFailureSignals(state, signals, "plan-1", "4.6.B");
		expect(updated.failureSignals).toHaveLength(0);
	});

	it("matching planExecId and workspaceId are accepted", () => {
		const state = createWorkspaceValidationState("plan-1", "4.6.A");
		const signals = detectFailureSignals("FAIL src/foo.test.ts");
		const updated = mergeFailureSignals(state, signals, "plan-1", "4.6.A");
		expect(updated.failureSignals.length).toBeGreaterThan(0);
	});

	it("validation command recording is isolated by planExecId+workspaceId", () => {
		const state = createWorkspaceValidationState("plan-1", "4.6.A");
		// Different planExecId — should be ignored
		const updated = recordValidationCommand(state, "vitest run", "plan-2", "4.6.A");
		expect(updated.validationCommandRunning).toBe(false);
		expect(updated.watchModeCommandDetected).toBe(false);
	});

	it("validation command recording detects watch-mode for matching context", () => {
		const state = createWorkspaceValidationState("plan-1", "4.6.A");
		const updated = recordValidationCommand(state, "vitest --watch", "plan-1", "4.6.A");
		expect(updated.validationCommandRunning).toBe(true);
		expect(updated.watchModeCommandDetected).toBe(true);
		expect(updated.watchModeCommand).toBe("vitest --watch");
	});

	it("command completion is isolated by planExecId+workspaceId", () => {
		const state = createWorkspaceValidationState("plan-1", "4.6.A");
		state.validationCommandRunning = true;
		// Different planExecId — should be ignored
		const updated = recordCommandCompletion(state, 0, true, "plan-2", "4.6.A");
		expect(updated.validationCommandRunning).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 6. CompletionGateRegistry
// ---------------------------------------------------------------------------

describe("CompletionGateRegistry", () => {
	it("creates states on demand", () => {
		const registry = new CompletionGateRegistry();
		const state = registry.getOrCreate("plan-1", "4.6.A");
		expect(state.planExecId).toBe("plan-1");
		expect(state.workspaceId).toBe("4.6.A");
	});

	it("merges failure signals into the correct context", () => {
		const registry = new CompletionGateRegistry();
		const signals = detectFailureSignals("FAIL src/foo.test.ts");
		registry.mergeSignals("plan-1", "4.6.A", signals);
		const state = registry.get("plan-1", "4.6.A");
		expect(state?.failureSignals.length).toBeGreaterThan(0);
	});

	it("ignores signals from different context", () => {
		const registry = new CompletionGateRegistry();
		registry.getOrCreate("plan-1", "4.6.A");
		const signals = detectFailureSignals("FAIL src/foo.test.ts");
		// Different workspaceId
		registry.mergeSignals("plan-1", "4.6.B", signals);
		const stateA = registry.get("plan-1", "4.6.A");
		expect(stateA?.failureSignals).toHaveLength(0);
	});

	it("records validation commands", () => {
		const registry = new CompletionGateRegistry();
		registry.recordCommand("plan-1", "4.6.A", "vitest run");
		const state = registry.get("plan-1", "4.6.A");
		expect(state?.validationCommandRunning).toBe(true);
	});

	it("detects watch-mode via command recording", () => {
		const registry = new CompletionGateRegistry();
		registry.recordCommand("plan-1", "4.6.A", "vitest --watch");
		const state = registry.get("plan-1", "4.6.A");
		expect(state?.watchModeCommandDetected).toBe(true);
		expect(state?.watchModeCommand).toBe("vitest --watch");
	});

	it("records command completion", () => {
		const registry = new CompletionGateRegistry();
		registry.recordCommand("plan-1", "4.6.A", "vitest run");
		registry.recordCompletion("plan-1", "4.6.A", 0, false);
		const state = registry.get("plan-1", "4.6.A");
		expect(state?.validationCommandRunning).toBe(false);
		expect(state?.lastCommandExitCode).toBe(0);
	});

	it("clears states for a plan", () => {
		const registry = new CompletionGateRegistry();
		registry.getOrCreate("plan-1", "4.6.A");
		registry.getOrCreate("plan-1", "4.6.B");
		registry.getOrCreate("plan-2", "4.6.A");
		registry.clearForPlan("plan-1");
		expect(registry.get("plan-1", "4.6.A")).toBeUndefined();
		expect(registry.get("plan-1", "4.6.B")).toBeUndefined();
		expect(registry.get("plan-2", "4.6.A")).toBeDefined();
	});

	it("evaluates workspace completion through registry", () => {
		const registry = new CompletionGateRegistry();
		registry.markImplementationFinished("plan-1", "4.6.A");
		const workspace = makeWorkspace({ id: "4.6.A" });
		const result = registry.evaluateWorkspace("plan-1", "4.6.A", workspace);
		expect(result.canComplete).toBe(true);
	});

	it("evaluates workspace completion with failure signals in registry", () => {
		const registry = new CompletionGateRegistry();
		registry.markImplementationFinished("plan-1", "4.6.A");
		const signals = detectFailureSignals("FAIL src/foo.test.ts");
		registry.mergeSignals("plan-1", "4.6.A", signals);
		const workspace = makeWorkspace({ id: "4.6.A" });
		const result = registry.evaluateWorkspace("plan-1", "4.6.A", workspace);
		expect(result.canComplete).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 7. Validation Lock Integration
// ---------------------------------------------------------------------------

describe("validation lock: releases on failed validation", () => {
	beforeEach(() => {
		resetGlobalValidationLock();
	});

	it("lock still releases on failed validation command", async () => {
		const eventBus = createEventBus();
		const events: string[] = [];
		eventBus.on(VALIDATION_LOCK_WAITING, () => events.push("waiting"));
		eventBus.on(VALIDATION_LOCK_ACQUIRED, () => events.push("acquired"));
		eventBus.on(VALIDATION_LOCK_RELEASED, () => events.push("released"));

		let thrownError: Error | null = null;
		try {
			await withValidationLock("vitest run", eventBus, async () => {
				throw new Error("Test command failed");
			});
		} catch (e) {
			thrownError = e as Error;
		}

		// Error should have been thrown
		expect(thrownError).not.toBeNull();
		expect(thrownError!.message).toBe("Test command failed");

		// But lock should have been released
		expect(events).toContain("released");

		// And subsequent commands should be able to acquire the lock
		const result = await withValidationLock("vitest run", eventBus, async () => "ok");
		expect(result).toBe("ok");

		eventBus.clear();
	});

	it("lock releases even when command throws during execution", async () => {
		const eventBus = createEventBus();
		const events: string[] = [];
		eventBus.on(VALIDATION_LOCK_RELEASED, () => events.push("released"));

		try {
			await withValidationLock("npm run typecheck", eventBus, async () => {
				throw new Error("TypeError: something went wrong");
			});
		} catch {
			// Expected
		}

		expect(events).toContain("released");
		eventBus.clear();
	});

	it("non-validation commands run without lock", async () => {
		const eventBus = createEventBus();
		const events: string[] = [];
		eventBus.on(VALIDATION_LOCK_WAITING, () => events.push("waiting"));

		const result = await withValidationLock("echo hello", eventBus, async () => "done");
		expect(result).toBe("done");
		expect(events).toHaveLength(0);

		eventBus.clear();
	});
});

// ---------------------------------------------------------------------------
// 8. Full Scenario: The pasted log scenario
// ---------------------------------------------------------------------------

describe("P4.6.1 false-complete prevention: full scenario", () => {
	it("workspace does NOT become complete given the scenario logs", () => {
		const scenarioLogs = [
			"FAIL src/hooks/useWorkspaceLogStream.test.ts",
			"Tests: 3 passed, 1 failed, 4 total",
			"Error: Out of retries for workspace 3.2.B",
			"Error: File not found: src/deleted-component.tsx",
			"Running vitest --watch...",
		];

		// Scan all the logs
		const scanResult = scanLogLines(scenarioLogs);
		expect(scanResult.hasFailures).toBe(true);

		// Check we detected the key failure categories
		const categories = new Set(scanResult.signals.map((s) => s.category));
		expect(categories.has(FailureSignalCategory.TestFail)).toBe(true);
		expect(categories.has(FailureSignalCategory.TestSummaryFail)).toBe(true);
		expect(categories.has(FailureSignalCategory.OutOfRetries)).toBe(true);
		expect(categories.has(FailureSignalCategory.FileNotFound)).toBe(true);

		// Build validation state with these signals
		const state = makeValidationState("plan-1", "4.6.A", {
			failureSignals: scanResult.signals,
			outOfRetries: scanResult.signals.some((s) => s.category === FailureSignalCategory.OutOfRetries),
		});

		// Also check the "Running vitest --watch" line — detect watch mode
		const watchResult = validateCommand("vitest --watch");
		expect(watchResult.valid).toBe(false);
		expect(watchResult.isWatchMode).toBe(true);

		// If the executor ran vitest --watch, mark it in the validation state
		const stateWithWatch = {
			...state,
			watchModeCommandDetected: true,
			watchModeCommand: "vitest --watch",
		};

		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(stateWithWatch, workspace);

		// MUST NOT be complete
		expect(result.canComplete).toBe(false);
		expect(result.recommendedState).toBe(WorkspaceStage.Failed);
	});

	it("plan does NOT become complete given any workspace is unhealthy", () => {
		const workspaces = new Map<string, WorkspaceState>([
			["3.2.A", { workspaceId: "3.2.A", stage: WorkspaceStage.Complete, attempts: 1 }],
			["3.2.B", { workspaceId: "3.2.B", stage: WorkspaceStage.Failed, attempts: 10 }],
		]);
		const result = evaluatePlanCompletion(workspaces);
		expect(result.canComplete).toBe(false);
	});

	it("complete workspace loses legitimacy after new failure signals", () => {
		const state = makeValidationState("plan-1", "4.6.A");
		const workspace = makeWorkspace();
		expect(isWorkspaceLegitimatelyComplete(state, workspace)).toBe(true);

		// Typecheck passed, but later a test fails
		const testFailSignals = detectFailureSignals("FAIL src/hooks/useWorkspaceLogStream.test.ts");
		const updated = mergeFailureSignals(state, testFailSignals, "plan-1", "4.6.A");
		expect(isWorkspaceLegitimatelyComplete(updated, workspace)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 9. Edge cases
// ---------------------------------------------------------------------------

describe("completion-gate: edge cases", () => {
	it("handles null/undefined workspace targetCommand correctly", () => {
		const state = makeValidationState();
		const workspace = makeWorkspace({ targetCommand: undefined });
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(true);
	});

	it("handles empty failure signals gracefully", () => {
		const state = makeValidationState();
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(true);
		expect(result.blockReasons).toHaveLength(0);
	});

	it("File not found signal blocks completion", () => {
		const signals = detectFailureSignals("Error: File not found: src/deleted-component.tsx");
		const state = makeValidationState("plan-1", "4.6.A", {
			failureSignals: signals,
		});
		const workspace = makeWorkspace();
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
	});

	it("all block reasons are accumulated (not short-circuited)", () => {
		const state = makeValidationState("plan-1", "4.6.A", {
			implementationFinished: false,
			watchModeCommandDetected: true,
			watchModeCommand: "npm run dev",
			outOfRetries: true,
			failureSignals: detectFailureSignals("FAIL src/foo.test.ts"),
		});
		const workspace = makeWorkspace({ targetCommand: "vitest run" });
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
		// Should have multiple block reasons
		expect(result.blockReasons.length).toBeGreaterThanOrEqual(3);
	});

	it("plan with single complete workspace completes", () => {
		const workspaces = new Map<string, WorkspaceState>([
			["4.6.A", { workspaceId: "4.6.A", stage: WorkspaceStage.Complete, attempts: 1 }],
		]);
		const result = evaluatePlanCompletion(workspaces);
		expect(result.canComplete).toBe(true);
	});

	it("plan with single failed workspace does not complete", () => {
		const workspaces = new Map<string, WorkspaceState>([
			["4.6.A", { workspaceId: "4.6.A", stage: WorkspaceStage.Failed, attempts: 3 }],
		]);
		const result = evaluatePlanCompletion(workspaces);
		expect(result.canComplete).toBe(false);
	});
});
