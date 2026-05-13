/**
 * Adaptive Edit Strategy Dogfood Replay - P4.5 Workstream 4.5.F
 *
 * Validates both real failure modes from the P4.5 spec:
 * 1. Repeated full-file rewrite/truncation scenario
 * 2. Exact-match patch failure scenario
 *
 * These tests prove that repeated full rewrites cannot loop indefinitely
 * and that repeated exact-match edit failures trigger handoff.
 */

import { describe, expect, it } from "vitest";
import { createEditAttemptTracker } from "../src/core/edit-attempt-tracker.js";
import { createEditAuditEventEmitter } from "../src/core/edit-audit-events.js";
import { createEditFailureHandoff } from "../src/core/edit-failure-handoff.js";
import { createEditStrategyPolicy, type EditStrategyMode } from "../src/core/edit-strategy-policy.js";
import { createEventBus } from "../src/core/event-bus.js";
import { createTruncationDetector } from "../src/core/truncation-detector.js";

// ---------------------------------------------------------------------------
// Dogfood Scenario 1: Repeated Full-File Rewrite / Truncation
// ---------------------------------------------------------------------------

describe("Dogfood: Repeated full-file rewrite/truncation cannot loop indefinitely", () => {
	it("should stop after 2 truncation failures and trigger handoff (token_saving mode)", () => {
		const eventBus = createEventBus();
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const _detector = createTruncationDetector();
		const auditEmitter = createEditAuditEventEmitter({ eventBus });
		const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

		const planExecId = "dogfood-plan";
		const workspaceId = "ws-rewrite";
		const filePath = "src/LargeComponent.tsx";

		// Simulate: Agent tries to rewrite a large file
		// Attempt 1: Full write is blocked because 815-line TSX exceeds 300-line TSX limit
		const policyResult = policy.checkPolicy(filePath, false, 815, 32600);
		expect(policyResult.writeAllowed).toBe(false);
		expect(policyResult.reasonCode).toBe("tsx_component_patch_required");

		auditEmitter.emitStrategyBlocked(
			planExecId,
			workspaceId,
			filePath,
			"token_saving",
			policyResult.reasonCode,
			815,
			32600,
		);

		// Agent falls back to targeted edit, but exact match fails
		tracker.recordFailure(
			planExecId,
			workspaceId,
			filePath,
			"targeted_edit",
			"exact_match_failed",
			"Could not find the exact text",
		);

		// Agent tries another targeted edit, exact match fails again
		tracker.recordFailure(
			planExecId,
			workspaceId,
			filePath,
			"targeted_edit",
			"exact_match_failed",
			"old text must match exactly",
		);

		// Now 2 failures: handoff threshold reached
		expect(tracker.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)).toBe(true);

		// Handoff is triggered
		const handoffResult = handoff.checkAndHandoff(
			planExecId,
			workspaceId,
			filePath,
			"token_saving",
			"diff content",
			"/snapshots/LargeComponent.tsx.snap",
		);
		expect(handoffResult).not.toBeNull();
		expect(handoffResult!.filePath).toBe(filePath);
		expect(handoffResult!.failedStrategyList.length).toBe(2);

		// Verify audit events were emitted
		const auditLog = auditEmitter.getEventLog();
		expect(auditLog.length).toBeGreaterThan(0);
		expect(auditLog.some((e) => e.eventType === "edit_strategy_blocked")).toBe(true);
	});

	it("should stop after 2 truncation failures in hybrid mode", () => {
		const policy = createEditStrategyPolicy({ mode: "hybrid" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const detector = createTruncationDetector();

		const planExecId = "dogfood-plan";
		const workspaceId = "ws-hybrid";
		const filePath = "src/BigService.ts";

		// Hybrid mode: 500 lines, budget passes => full rewrite allowed
		const policyResult = policy.checkPolicy(filePath, false, 500, 20000, 20000, 10000, 500);
		expect(policyResult.writeAllowed).toBe(true);

		// Simulate truncation: full write was attempted but truncated
		const truncationResult = detector.detectTruncation("The file got truncated during write");
		expect(truncationResult.detected).toBe(true);
		expect(truncationResult.failureType).toBe("truncation");

		// Record first failure (truncation)
		tracker.recordFailure(
			planExecId,
			workspaceId,
			filePath,
			"full_write",
			"truncation",
			"The file got truncated during write",
		);

		// Truncation forces fallback: agent tries targeted edit but exact match fails
		tracker.recordFailure(
			planExecId,
			workspaceId,
			filePath,
			"targeted_edit",
			"exact_match_failed",
			"Could not find the exact text",
		);

		// 2 failures reached: handoff
		expect(tracker.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Dogfood Scenario 2: Exact-Match Patch Failure
// ---------------------------------------------------------------------------

describe("Dogfood: Repeated exact-match patch failure triggers handoff", () => {
	it("should trigger handoff after 2 exact-match failures (all modes)", () => {
		const modes: EditStrategyMode[] = ["token_saving", "hybrid", "speed"];

		for (const mode of modes) {
			const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
			const detector = createTruncationDetector();
			const eventBus = createEventBus();
			const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

			const planExecId = "dogfood-exact-match";
			const workspaceId = `ws-${mode}`;
			const filePath = "src/Component.tsx";

			// Attempt 1: exact match fails
			const detection1 = detector.detectExactMatchFailure("Could not find the exact text to replace");
			expect(detection1.detected).toBe(true);

			tracker.recordFailure(
				planExecId,
				workspaceId,
				filePath,
				"targeted_edit",
				"exact_match_failed",
				"Could not find the exact text",
			);

			// Not yet at threshold
			expect(tracker.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)).toBe(false);

			// Attempt 2: exact match fails again
			tracker.recordFailure(
				planExecId,
				workspaceId,
				filePath,
				"targeted_edit",
				"exact_match_failed",
				"old text must match exactly",
			);

			// Now at threshold
			expect(tracker.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)).toBe(true);

			// Handoff triggers
			const handoffResult = handoff.checkAndHandoff(planExecId, workspaceId, filePath, mode, "diff", undefined);
			expect(handoffResult).not.toBeNull();
			expect(handoffResult!.failedStrategyList.length).toBe(2);

			// Suggested fix steps should mention whitespace/exact matching
			const steps = handoffResult!.suggestedManualFixSteps;
			const hasMatchSuggestion = steps.some(
				(s) => s.toLowerCase().includes("whitespace") || s.toLowerCase().includes("exact"),
			);
			expect(hasMatchSuggestion).toBe(true);
		}
	});

	it("should include suggested mode switch in token_saving handoff", () => {
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const eventBus = createEventBus();
		const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

		const planExecId = "dogfood-mode-switch";
		const workspaceId = "ws-ts";
		const filePath = "src/BigFile.tsx";

		tracker.recordFailure(planExecId, workspaceId, filePath, "targeted_edit", "exact_match_failed", "no match");
		tracker.recordFailure(planExecId, workspaceId, filePath, "targeted_edit", "exact_match_failed", "still no match");

		const result = handoff.checkAndHandoff(planExecId, workspaceId, filePath, "token_saving", "", undefined);
		expect(result).not.toBeNull();

		const steps = result!.suggestedManualFixSteps;
		const hasModeSwitch = steps.some((s) => s.toLowerCase().includes("hybrid") || s.toLowerCase().includes("speed"));
		expect(hasModeSwitch).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Dogfood: Truncation forces fallback in all modes
// ---------------------------------------------------------------------------

describe("Dogfood: Truncation forces fallback in all modes", () => {
	it("should detect truncation and record it regardless of mode", () => {
		const detector = createTruncationDetector();

		const truncationMessages = [
			"The file got truncated",
			"write is truncating the content",
			"Let me write the complete file again",
			"complete file in parts",
			"... more lines follow",
		];

		for (const msg of truncationMessages) {
			const result = detector.detectTruncation(msg);
			expect(result.detected).toBe(true);
			expect(result.failureType).toBe("truncation");
		}
	});

	it("should detect various exact-match failure patterns", () => {
		const detector = createTruncationDetector();

		const exactMatchMessages = [
			"Could not find the exact text in the file",
			"old text must match exactly for the edit to apply",
		];

		for (const msg of exactMatchMessages) {
			const result = detector.detectExactMatchFailure(msg);
			expect(result.detected).toBe(true);
			expect(result.failureType).toBe("exact_match_failed");
		}
	});
});

// ---------------------------------------------------------------------------
// Dogfood: Audit event summary shows edit strategy section
// ---------------------------------------------------------------------------

describe("Dogfood: Audit summary includes edit strategy section", () => {
	it("should generate a summary with edit strategy events", () => {
		const auditEmitter = createEditAuditEventEmitter();
		const planExecId = "dogfood-summary";
		const workspaceId = "ws-summary";

		// Emit a series of events simulating a real execution
		auditEmitter.emitStrategySelected(planExecId, workspaceId, "src/file.ts", "hybrid", 500, 20000);
		auditEmitter.emitFullRewriteAttempted(planExecId, workspaceId, "src/file.ts", "hybrid", 500, 20000);
		auditEmitter.emitStrategyBlocked(
			planExecId,
			workspaceId,
			"src/large.ts",
			"hybrid",
			"existing_file_blocked_size",
			1500,
			60000,
		);
		auditEmitter.emitTruncationDetected(planExecId, workspaceId, "src/medium.ts", "hybrid");
		auditEmitter.emitExactMatchFailed(planExecId, workspaceId, "src/medium.ts", "hybrid");
		auditEmitter.emitPatchFallbackForced(planExecId, workspaceId, "src/medium.ts", "hybrid");
		auditEmitter.emitFailureHandoff(planExecId, workspaceId, "src/medium.ts", "hybrid", "exact_match_failed");
		auditEmitter.emitTokenWastePrevented(
			planExecId,
			workspaceId,
			"src/large.ts",
			"hybrid",
			"existing_file_blocked_size",
		);

		const summary = auditEmitter.generateSummary();

		expect(summary.editModeUsed).toBe("hybrid");
		expect(summary.blockedRewrites).toBe(1);
		expect(summary.truncationEvents).toBe(1);
		expect(summary.exactMatchFailures).toBe(1);
		expect(summary.handoffs).toBe(1);
		expect(summary.estimatedWastePrevented).toBeGreaterThanOrEqual(1);

		// Verify all event types appear in the log
		const log = auditEmitter.getEventLog();
		expect(log.length).toBe(8);
		const eventTypes = new Set(log.map((e) => e.eventType));
		expect(eventTypes.has("edit_strategy_selected")).toBe(true);
		expect(eventTypes.has("edit_strategy_blocked")).toBe(true);
		expect(eventTypes.has("edit_truncation_detected")).toBe(true);
		expect(eventTypes.has("edit_exact_match_failed")).toBe(true);
		expect(eventTypes.has("patch_fallback_forced")).toBe(true);
		expect(eventTypes.has("edit_failure_handoff")).toBe(true);
		expect(eventTypes.has("token_waste_prevented")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Dogfood: Speed mode preserves hard safety gates
// ---------------------------------------------------------------------------

describe("Dogfood: Speed mode preserves hard safety gates", () => {
	it("should block dangerously large files even in speed mode", () => {
		const policy = createEditStrategyPolicy({ mode: "speed" });

		// Under limit: allowed
		expect(policy.checkPolicy("file.ts", false, 500, 20000).writeAllowed).toBe(true);
		expect(policy.checkPolicy("file.ts", false, 1000, 40000).writeAllowed).toBe(true);

		// Over limit: blocked by hard safety gate
		expect(policy.checkPolicy("file.ts", false, 1001, 41000).writeAllowed).toBe(false);
		expect(policy.checkPolicy("huge.ts", false, 5000, 200000).writeAllowed).toBe(false);

		// Reason code must always be hard_safety_gate_blocked for speed mode blocks
		const result = policy.checkPolicy("file.ts", false, 1001, 41000);
		expect(result.reasonCode).toBe("hard_safety_gate_blocked");
	});
});
