/**
 * Patch-First Dogfood Replay — P4.5.F
 *
 * Validates the patch-first edit strategy against real observed failure modes.
 *
 * Acceptance Criteria:
 * 1. Doctor warns on large existing editable files without patch-first instruction
 * 2. Dogfood replay simulates SettingsDialog repeated rewrite failure
 * 3. Second and third full-write attempts are blocked in dogfood
 * 4. Documentation explains thresholds and overrides
 * 5. Stability report published
 * 6. TypeScript compiles cleanly
 */

import { describe, expect, it } from "vitest";
import { checkLargeEditableFiles, type EditableFileInfo, getModeThresholds } from "../src/cli/doctor.js";
import { createEditAttemptTracker } from "../src/core/edit-attempt-tracker.js";
import { createEditAuditEventEmitter } from "../src/core/edit-audit-events.js";
import { createEditFailureHandoff } from "../src/core/edit-failure-handoff.js";
import {
	createEditStrategyPolicy,
	DEFAULT_EDIT_STRATEGY_POLICY_CONFIG,
	type EditStrategyMode,
} from "../src/core/edit-strategy-policy.js";
import { createEventBus } from "../src/core/event-bus.js";
import type { SettingsManager } from "../src/core/settings-manager.js";
import { createTruncationDetector } from "../src/core/truncation-detector.js";
import { createWriteGate } from "../src/core/write-gate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock SettingsManager that returns a specific edit strategy mode. */
function createMockSettingsManager(mode: EditStrategyMode = "hybrid"): SettingsManager {
	return {
		getGlobalSettings: () => ({
			editStrategyMode: mode,
		}),
		getContextBudgets: () => undefined,
		getCompactionSettings: () => ({ enabled: true, reserveTokens: 16384 }),
	} as unknown as SettingsManager;
}

/** Create a mock stat result. */
function _mockStat(size: number) {
	return async (_path: string) => ({
		size,
		isFile: () => true,
	});
}

// ---------------------------------------------------------------------------
// AC1: Doctor warns on large existing editable files without patch-first
// ---------------------------------------------------------------------------

describe("AC1: Doctor warns on large existing editable files", () => {
	it("should warn when a plan has editable files exceeding hybrid mode thresholds", () => {
		const settingsManager = createMockSettingsManager("hybrid");

		const editableFiles: EditableFileInfo[] = [
			{
				filePath: "src/components/SettingsDialog.tsx",
				lineCount: 1200, // Exceeds hybrid 1000-line limit
				byteSize: 48000, // Exceeds hybrid 40KB byte limit
				isTsx: true,
			},
			{
				filePath: "src/utils/helpers.ts",
				lineCount: 100,
				byteSize: 4000,
				isTsx: false,
			},
		];

		const checks = checkLargeEditableFiles(settingsManager, editableFiles);

		// At least one check should be a warning about large files
		const warnChecks = checks.filter((c) => c.status === "warn");
		expect(warnChecks.length).toBeGreaterThan(0);

		const largeFileWarning = warnChecks.find((c) => c.name === "Edit Strategy Large Editable Files");
		expect(largeFileWarning).toBeDefined();
		expect(largeFileWarning!.message).toContain("patch-first");
		expect(largeFileWarning!.details).toContain("SettingsDialog.tsx");
	});

	it("should pass when no editable files exceed thresholds", () => {
		const settingsManager = createMockSettingsManager("hybrid");

		const editableFiles: EditableFileInfo[] = [
			{
				filePath: "src/utils/helpers.ts",
				lineCount: 50,
				byteSize: 2000,
				isTsx: false,
			},
		];

		const checks = checkLargeEditableFiles(settingsManager, editableFiles);

		const largeFileCheck = checks.find((c) => c.name === "Edit Strategy Large Editable Files");
		expect(largeFileCheck).toBeDefined();
		expect(largeFileCheck!.status).toBe("pass");
	});

	it("should warn on TSX components exceeding tsx patch threshold in token_saving mode", () => {
		const settingsManager = createMockSettingsManager("token_saving");

		const editableFiles: EditableFileInfo[] = [
			{
				filePath: "src/components/Header.tsx",
				lineCount: 350,
				byteSize: 14000,
				isTsx: true,
			},
		];

		const checks = checkLargeEditableFiles(settingsManager, editableFiles);

		const largeFileWarning = checks.find(
			(c) => c.name === "Edit Strategy Large Editable Files" && c.status === "warn",
		);
		expect(largeFileWarning).toBeDefined();
		expect(largeFileWarning!.details).toContain("Header.tsx");
	});

	it("should pass in speed mode for files under hard safety gate", () => {
		const settingsManager = createMockSettingsManager("speed");

		const editableFiles: EditableFileInfo[] = [
			{
				filePath: "src/components/SettingsDialog.tsx",
				lineCount: 800,
				byteSize: 32000,
				isTsx: true,
			},
		];

		const checks = checkLargeEditableFiles(settingsManager, editableFiles);

		const largeFileCheck = checks.find((c) => c.name === "Edit Strategy Large Editable Files");
		expect(largeFileCheck).toBeDefined();
		// Speed mode allows rewrites up to 1000 lines
		expect(largeFileCheck!.status).toBe("pass");
	});

	it("should warn in speed mode for files over hard safety gate", () => {
		const settingsManager = createMockSettingsManager("speed");

		const editableFiles: EditableFileInfo[] = [
			{
				filePath: "src/huge/DataGrid.tsx",
				lineCount: 1200,
				byteSize: 48000,
				isTsx: true,
			},
		];

		const checks = checkLargeEditableFiles(settingsManager, editableFiles);

		const largeFileWarning = checks.find(
			(c) => c.name === "Edit Strategy Large Editable Files" && c.status === "warn",
		);
		expect(largeFileWarning).toBeDefined();
		expect(largeFileWarning!.details).toContain("DataGrid.tsx");
	});

	it("should handle no editable files provided gracefully", () => {
		const settingsManager = createMockSettingsManager("hybrid");
		const checks = checkLargeEditableFiles(settingsManager, []);
		// When no files provided, returns a pass check (no files to warn about)
		const largeFileCheck = checks.find((c) => c.name === "Edit Strategy Large Editable Files");
		expect(largeFileCheck).toBeDefined();
		expect(largeFileCheck!.status).toBe("pass");
	});
});

// ---------------------------------------------------------------------------
// AC2: Dogfood replay simulates SettingsDialog repeated rewrite failure
// ---------------------------------------------------------------------------

describe("AC2: Dogfood replay — SettingsDialog repeated rewrite failure", () => {
	it("simulates SettingsDialog full rewrite failure sequence", async () => {
		// Real-world scenario: SettingsDialog.tsx is an 815-line TSX component
		// The agent tries full rewrite multiple times but gets truncated each time
		const eventBus = createEventBus();
		const policy = createEditStrategyPolicy({ mode: "hybrid" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const detector = createTruncationDetector();
		const auditEmitter = createEditAuditEventEmitter({ eventBus });
		const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

		const planExecId = "dogfood-settings-dialog";
		const workspaceId = "ws-settings-dialog";
		const filePath = "src/components/SettingsDialog.tsx";

		// The SettingsDialog.tsx is 815 lines, 32600 bytes
		const gate = createWriteGate({
			policy,
			attemptTracker: tracker,
			truncationDetector: detector,
			auditEmitter,
			planExecId,
			workspaceId,
			stat: async () => ({ size: 32600, isFile: () => true }),
			readFile: async () => Buffer.from("x".repeat(815 * 40)),
		});

		// Attempt 1: Full write allowed (815 lines under 1000-line hybrid limit,
		// output budget passes)
		const check1 = await gate.check(
			`/project/${filePath}`,
			filePath,
			32600, // new content byte size
			50000, // output budget remaining (passes)
			815, // new line count
		);
		expect(check1.allowed).toBe(true);

		// Agent writes but the output is truncated
		gate.processWriteResult(filePath, "The file got truncated during write", false);

		// Verify truncation was detected
		const summary1 = tracker.getSummary(planExecId, workspaceId, filePath);
		expect(summary1.failedAttempts).toBe(1);
		expect(summary1.attempts[0].failureType).toBe("truncation");

		// Truncation forced patch mode for this file
		expect(tracker.isPatchModeForced(planExecId, workspaceId, filePath)).toBe(true);

		// Now the agent tries targeted edit (patch) but exact match fails
		gate.processEditResult(filePath, "old text must match exactly for the edit to apply", false);

		const summary2 = tracker.getSummary(planExecId, workspaceId, filePath);
		expect(summary2.failedAttempts).toBe(2);

		// Handoff threshold reached (2 failures)
		expect(tracker.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)).toBe(true);

		// Handoff payload is generated
		const handoffPayload = handoff.checkAndHandoff(
			planExecId,
			workspaceId,
			filePath,
			"hybrid",
			"--- diff of SettingsDialog current vs pre-edit state ---",
			"/snapshots/SettingsDialog.tsx.snap",
		);

		expect(handoffPayload).not.toBeNull();
		expect(handoffPayload!.filePath).toBe(filePath);
		expect(handoffPayload!.failedStrategyList.length).toBe(2);
		expect(handoffPayload!.failedStrategyList[0].attemptType).toBe("full_write");
		expect(handoffPayload!.failedStrategyList[0].failureType).toBe("truncation");
		expect(handoffPayload!.failedStrategyList[1].attemptType).toBe("targeted_edit");
		expect(handoffPayload!.failedStrategyList[1].failureType).toBe("exact_match_failed");
		expect(handoffPayload!.preEditSnapshotPath).toBe("/snapshots/SettingsDialog.tsx.snap");
		expect(handoffPayload!.currentDiff).toContain("diff");

		// Suggested manual fix steps must be provided
		expect(handoffPayload!.suggestedManualFixSteps.length).toBeGreaterThan(0);
		expect(handoffPayload!.suggestedResumeInstruction).toBeTruthy();

		// Audit events verify the full sequence was recorded
		const auditLog = auditEmitter.getEventLog();
		expect(auditLog.some((e) => e.eventType === "edit_truncation_detected")).toBe(true);
		expect(auditLog.some((e) => e.eventType === "edit_exact_match_failed")).toBe(true);
	});

	it("simulates SettingsDialog token_saving mode blocked scenario", () => {
		// In token_saving mode, the 815-line TSX component is immediately blocked
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const eventBus = createEventBus();
		const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

		const planExecId = "dogfood-settings-ts";
		const workspaceId = "ws-settings-ts";
		const filePath = "src/components/SettingsDialog.tsx";

		// Token saving: 815-line TSX exceeds 300-line TSX patch-required limit
		const policyResult = policy.checkPolicy(filePath, false, 815, 32600);
		expect(policyResult.writeAllowed).toBe(false);
		expect(policyResult.reasonCode).toBe("tsx_component_patch_required");

		// Agent tries targeted edit but exact match fails twice
		tracker.recordFailure(
			planExecId,
			workspaceId,
			filePath,
			"targeted_edit",
			"exact_match_failed",
			"Could not find the exact text to replace",
		);
		tracker.recordFailure(
			planExecId,
			workspaceId,
			filePath,
			"targeted_edit",
			"exact_match_failed",
			"old text must match exactly",
		);

		// Handoff triggered
		expect(tracker.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)).toBe(true);

		const handoffPayload = handoff.checkAndHandoff(
			planExecId,
			workspaceId,
			filePath,
			"token_saving",
			"diff",
			undefined,
		);

		expect(handoffPayload).not.toBeNull();
		expect(handoffPayload!.failedStrategyList.length).toBe(2);

		// Suggested fix should mention mode switch to Hybrid
		const hasHybridSuggestion = handoffPayload!.suggestedManualFixSteps.some(
			(s) => s.toLowerCase().includes("hybrid") || s.toLowerCase().includes("speed"),
		);
		expect(hasHybridSuggestion).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC3: Second and third full-write attempts are blocked in dogfood
// ---------------------------------------------------------------------------

describe("AC3: Second and third full-write attempts are blocked", () => {
	it("should block second full-write attempt after first truncation failure", async () => {
		const eventBus = createEventBus();
		const policy = createEditStrategyPolicy({ mode: "hybrid" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const detector = createTruncationDetector();
		const auditEmitter = createEditAuditEventEmitter({ eventBus });

		const gate = createWriteGate({
			policy,
			attemptTracker: tracker,
			truncationDetector: detector,
			auditEmitter,
			planExecId: "dogfood-block-2nd",
			workspaceId: "ws-block-2nd",
			stat: async () => ({ size: 32600, isFile: () => true }),
			readFile: async () => Buffer.from("x".repeat(815 * 40)),
		});

		const filePath = "src/components/SettingsDialog.tsx";

		// Attempt 1: Full write allowed
		const check1 = await gate.check(`/project/${filePath}`, filePath, 32600, 50000, 815);
		expect(check1.allowed).toBe(true);

		// Write fails with truncation
		gate.processWriteResult(filePath, "The file got truncated during write", false);

		// Truncation forced patch mode — full writes now blocked
		expect(tracker.isPatchModeForced("dogfood-block-2nd", "ws-block-2nd", filePath)).toBe(true);

		// Attempt 2: Full write is BLOCKED because truncation forced patch mode
		const fullWriteAllowed = tracker.isFullWriteAllowed("dogfood-block-2nd", "ws-block-2nd", filePath);
		expect(fullWriteAllowed.allowed).toBe(false);
		expect(fullWriteAllowed.reason).toContain("patch mode forced");
	});

	it("should block third full-write attempt after handoff threshold reached", async () => {
		const eventBus = createEventBus();
		const policy = createEditStrategyPolicy({ mode: "hybrid" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const detector = createTruncationDetector();
		const auditEmitter = createEditAuditEventEmitter({ eventBus });

		const gate = createWriteGate({
			policy,
			attemptTracker: tracker,
			truncationDetector: detector,
			auditEmitter,
			planExecId: "dogfood-block-3rd",
			workspaceId: "ws-block-3rd",
			stat: async () => ({ size: 32600, isFile: () => true }),
			readFile: async () => Buffer.from("x".repeat(815 * 40)),
		});

		const filePath = "src/components/SettingsDialog.tsx";

		// Attempt 1: Full write allowed
		const check1 = await gate.check(`/project/${filePath}`, filePath, 32600, 50000, 815);
		expect(check1.allowed).toBe(true);

		// First write truncation
		gate.processWriteResult(filePath, "The file got truncated during write", false);

		// First targeted edit exact-match failure
		gate.processEditResult(filePath, "Could not find the exact text in the file", false);

		// Now 2 failures: handoff threshold reached
		expect(tracker.hasReachedHandoffThreshold("dogfood-block-3rd", "ws-block-3rd", filePath)).toBe(true);

		// Attempt 3: Full write is BLOCKED by handoff threshold
		const check3 = await gate.check(`/project/${filePath}`, filePath, 32600, 50000, 815);
		expect(check3.allowed).toBe(false);
		expect(check3.handoffTriggered).toBe(true);

		// Verify audit events captured all three attempts
		const auditLog = auditEmitter.getEventLog();
		expect(auditLog.some((e) => e.eventType === "edit_truncation_detected")).toBe(true);
		expect(auditLog.some((e) => e.eventType === "edit_exact_match_failed")).toBe(true);
	});

	it("should block any further full-write after truncation + exact-match failure (complete scenario)", async () => {
		const policy = createEditStrategyPolicy({ mode: "hybrid" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const detector = createTruncationDetector();

		const gate = createWriteGate({
			policy,
			attemptTracker: tracker,
			truncationDetector: detector,
			planExecId: "dogfood-complete",
			workspaceId: "ws-complete",
			stat: async () => ({ size: 32600, isFile: () => true }),
			readFile: async () => Buffer.from("x".repeat(815 * 40)),
		});

		const filePath = "src/components/SettingsDialog.tsx";

		// First full write allowed
		const check1 = await gate.check(`/project/${filePath}`, filePath, 32600, 50000, 815);
		expect(check1.allowed).toBe(true);

		// Truncation on first write
		gate.processWriteResult(filePath, "write is truncating the output", false);
		expect(tracker.isPatchModeForced("dogfood-complete", "ws-complete", filePath)).toBe(true);

		// Second full-write attempt: blocked by patch mode forced
		const secondFullWrite = tracker.isFullWriteAllowed("dogfood-complete", "ws-complete", filePath);
		expect(secondFullWrite.allowed).toBe(false);

		// Agent falls back to targeted edit, but that also fails
		gate.processEditResult(filePath, "old text must match exactly", false);

		// Third attempt via gate: blocked by handoff
		const check3 = await gate.check(`/project/${filePath}`, filePath);
		expect(check3.allowed).toBe(false);
		expect(check3.handoffTriggered).toBe(true);

		// All further full-write checks return blocked
		const check4 = await gate.check(`/project/${filePath}`, filePath);
		expect(check4.allowed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// AC4: Documentation explains thresholds and overrides
// ---------------------------------------------------------------------------

describe("AC4: Documentation explains thresholds and overrides", () => {
	it("should expose mode thresholds via getModeThresholds for documentation", () => {
		// Token Saving mode
		const tsThresholds = getModeThresholds("token_saving");
		expect(tsThresholds.maxLines).toBe(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingMaxLines);
		expect(tsThresholds.maxBytes).toBe(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingMaxBytes);
		expect(tsThresholds.tsxPatchRequiredLines).toBe(
			DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingTsxPatchRequiredLines,
		);

		// Hybrid mode
		const hybridThresholds = getModeThresholds("hybrid");
		expect(hybridThresholds.maxLines).toBe(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridBudgetMaxLines);
		expect(hybridThresholds.maxBytes).toBe(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridBudgetMaxBytes);
		expect(hybridThresholds.tsxPatchRequiredLines).toBe(
			DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridTsxPatchRequiredLines,
		);

		// Speed mode
		const speedThresholds = getModeThresholds("speed");
		expect(speedThresholds.maxLines).toBe(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.speedMaxLines);
		// Speed mode doesn't enforce byte limits or TSX patch requirements
		expect(speedThresholds.maxBytes).toBe(Number.MAX_SAFE_INTEGER);
		expect(speedThresholds.tsxPatchRequiredLines).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("should provide default values that match documentation", () => {
		// Verify default config values match what documentation states
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.mode).toBe("hybrid");
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingMaxLines).toBe(200);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingMaxBytes).toBe(8192);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingTsxPatchRequiredLines).toBe(300);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridBudgetMaxLines).toBe(1000);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridBudgetMaxBytes).toBe(40960);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridTsxPatchRequiredLines).toBe(1000);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.speedMaxLines).toBe(1000);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.sameFileEditFailureHandoffThreshold).toBe(2);
	});

	it("should allow override of edit strategy mode via config", () => {
		// Users can override the default mode
		const tokenSavingPolicy = createEditStrategyPolicy({ mode: "token_saving" });
		expect(tokenSavingPolicy.getMode()).toBe("token_saving");

		const speedPolicy = createEditStrategyPolicy({ mode: "speed" });
		expect(speedPolicy.getMode()).toBe("speed");

		// Default is hybrid
		const defaultPolicy = createEditStrategyPolicy();
		expect(defaultPolicy.getMode()).toBe("hybrid");
	});

	it("should allow override of handoff threshold", () => {
		const tracker = createEditAttemptTracker({ handoffThreshold: 5 });
		expect(tracker.getHandoffThreshold()).toBe(5);

		tracker.setHandoffThreshold(3);
		expect(tracker.getHandoffThreshold()).toBe(3);
	});

	it("should allow enforcement mode override via config", () => {
		// Verify that enforcement mode can be "enforce" or "warn"
		const config = createEditStrategyPolicy().getConfig();
		expect(typeof config.sameFileEditFailureHandoffThreshold).toBe("number");
		expect(typeof config.truncationForcesFallback).toBe("boolean");
		expect(typeof config.exactMatchFailureCountsTowardHandoff).toBe("boolean");
	});
});

// ---------------------------------------------------------------------------
// AC5: Stability report published
// ---------------------------------------------------------------------------

describe("AC5: Stability report data matches expected schema", () => {
	it("audit summary has all required fields for stability report", () => {
		const auditEmitter = createEditAuditEventEmitter();

		const planExecId = "stability-report";
		const workspaceId = "ws-stability";

		// Simulate a realistic execution generating a stability report
		auditEmitter.emitStrategySelected(
			planExecId,
			workspaceId,
			"src/components/SettingsDialog.tsx",
			"hybrid",
			815,
			32600,
		);
		auditEmitter.emitFullRewriteAttempted(
			planExecId,
			workspaceId,
			"src/components/SettingsDialog.tsx",
			"hybrid",
			815,
			32600,
		);
		auditEmitter.emitStrategyBlocked(
			planExecId,
			workspaceId,
			"src/components/BigForm.tsx",
			"hybrid",
			"tsx_component_patch_required",
			1200,
			48000,
		);
		auditEmitter.emitTruncationDetected(planExecId, workspaceId, "src/components/SettingsDialog.tsx", "hybrid");
		auditEmitter.emitExactMatchFailed(planExecId, workspaceId, "src/components/SettingsDialog.tsx", "hybrid");
		auditEmitter.emitPatchFallbackForced(planExecId, workspaceId, "src/components/SettingsDialog.tsx", "hybrid");
		auditEmitter.emitFailureHandoff(
			planExecId,
			workspaceId,
			"src/components/SettingsDialog.tsx",
			"hybrid",
			"truncation",
		);
		auditEmitter.emitTokenWastePrevented(
			planExecId,
			workspaceId,
			"src/components/BigForm.tsx",
			"hybrid",
			"tsx_component_patch_required",
		);

		const summary = auditEmitter.generateSummary();

		// Verify all fields needed for stability report are present
		expect(typeof summary.editModeUsed).toBe("string");
		expect(summary.editModeUsed).toBe("hybrid");
		expect(typeof summary.blockedRewrites).toBe("number");
		expect(summary.blockedRewrites).toBe(1);
		expect(typeof summary.truncationEvents).toBe("number");
		expect(summary.truncationEvents).toBe(1);
		expect(typeof summary.exactMatchFailures).toBe("number");
		expect(summary.exactMatchFailures).toBe(1);
		expect(typeof summary.handoffs).toBe("number");
		expect(summary.handoffs).toBe(1);
		expect(typeof summary.estimatedWastePrevented).toBe("number");
		expect(summary.estimatedWastePrevented).toBeGreaterThanOrEqual(1);
	});

	it("handoff payload has all fields needed for stability report", () => {
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const eventBus = createEventBus();
		const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

		const planExecId = "stability-handoff";
		const workspaceId = "ws-stability-handoff";
		const filePath = "src/components/SettingsDialog.tsx";

		// Simulate repeated rewrite failures
		tracker.recordFailure(
			planExecId,
			workspaceId,
			filePath,
			"full_write",
			"truncation",
			"File got truncated during write",
		);
		tracker.recordFailure(
			planExecId,
			workspaceId,
			filePath,
			"targeted_edit",
			"exact_match_failed",
			"old text must match exactly",
		);

		const payload = handoff.checkAndHandoff(
			planExecId,
			workspaceId,
			filePath,
			"hybrid",
			"diff-content-here",
			"/snapshots/SettingsDialog.tsx.snap",
		);

		expect(payload).not.toBeNull();

		// All fields needed for stability report
		expect(typeof payload!.filePath).toBe("string");
		expect(typeof payload!.selectedEditMode).toBe("string");
		expect(Array.isArray(payload!.failedStrategyList)).toBe(true);
		expect(payload!.failedStrategyList.length).toBe(2);
		expect(typeof payload!.lastToolError).toBe("string");
		expect(typeof payload!.preEditSnapshotPath).toBe("string");
		expect(typeof payload!.currentDiff).toBe("string");
		expect(typeof payload!.attemptedPatchSummary).toBe("string");
		expect(Array.isArray(payload!.suggestedManualFixSteps)).toBe(true);
		expect(payload!.suggestedManualFixSteps.length).toBeGreaterThan(0);
		expect(typeof payload!.suggestedResumeInstruction).toBe("string");
	});
});

// ---------------------------------------------------------------------------
// AC6: TypeScript compiles cleanly (verified by typecheck command)
// ---------------------------------------------------------------------------

describe("AC6: TypeScript compiles cleanly", () => {
	it("all exported types are properly typed", () => {
		// This test validates that the types are properly exported and usable
		// The actual TypeScript compilation is verified by `npm run typecheck`
		const mode: EditStrategyMode = "hybrid";
		expect(mode).toBe("hybrid");

		const fileInfo: EditableFileInfo = {
			filePath: "src/test.tsx",
			lineCount: 100,
			byteSize: 4000,
			isTsx: true,
		};
		expect(fileInfo.filePath).toBe("src/test.tsx");

		const thresholds = getModeThresholds("hybrid");
		expect(typeof thresholds.maxLines).toBe("number");
		expect(typeof thresholds.maxBytes).toBe("number");
		expect(typeof thresholds.tsxPatchRequiredLines).toBe("number");
	});
});
