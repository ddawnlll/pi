/**
 * P4.5 Comprehensive Verification Test
 *
 * Covers all verification steps from the plan:
 *  3. Doctor checks
 *  4. Manual dogfood: truncation loop
 *  5. Manual dogfood: exact-match loop
 *  6. Mode behavior
 *  7. Dashboard validation (data structure checks)
 *  8. Audit validation
 */

import { describe, expect, it } from "vitest";
import { createEditAttemptTracker } from "../src/core/edit-attempt-tracker.js";
import { createEditAuditEventEmitter } from "../src/core/edit-audit-events.js";
import { createEditFailureHandoff } from "../src/core/edit-failure-handoff.js";
import {
	createEditStrategyPolicy,
	DEFAULT_EDIT_STRATEGY_POLICY_CONFIG,
	type EditStrategyMode,
} from "../src/core/edit-strategy-policy.js";
import type { EditAuditEventType } from "../src/core/edit-strategy-types.js";
import { createEventBus } from "../src/core/event-bus.js";
import { createTruncationDetector } from "../src/core/truncation-detector.js";
import { createWriteGate } from "../src/core/write-gate.js";

// ---------------------------------------------------------------------------
// Step 3: Doctor validation (policy-based checks mirroring doctor.ts logic)
// ---------------------------------------------------------------------------

describe("Step 3: Doctor checks", () => {
	it("should report hybrid as default mode", () => {
		const policy = createEditStrategyPolicy();
		expect(policy.getMode()).toBe("hybrid");
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.mode).toBe("hybrid");
	});

	it("should warn on token_saving mode (may block useful rewrites)", () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		// A 500-line .ts file is blocked in token_saving but allowed in hybrid
		const tsResult = policy.checkPolicy("src/medium.ts", false, 500, 20000);
		expect(tsResult.writeAllowed).toBe(false);

		const hybridPolicy = createEditStrategyPolicy({ mode: "hybrid" });
		const hybridResult = hybridPolicy.checkPolicy("src/medium.ts", false, 500, 20000, 20000, 15000, 500);
		expect(hybridResult.writeAllowed).toBe(true);
	});

	it("should warn on speed mode (may cause token spikes)", () => {
		const policy = createEditStrategyPolicy({ mode: "speed" });
		// 800-line file allowed in speed mode (would be blocked in token_saving)
		const result = policy.checkPolicy("src/large.ts", false, 800, 32000);
		expect(result.writeAllowed).toBe(true);
		expect(result.reasonCode).toBe("speed_mode_full_rewrite");
	});

	it("should validate handoff threshold >= 2", () => {
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.sameFileEditFailureHandoffThreshold).toBeGreaterThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------
// Step 4: Manual dogfood — truncation loop
// ---------------------------------------------------------------------------

describe("Step 4: Truncation loop prevention", () => {
	it("should block 3rd full rewrite attempt after 2 truncation failures", async () => {
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
			planExecId: "plan-t",
			workspaceId: "ws-t",
			stat: async () => ({ size: 20000, isFile: () => true }),
			readFile: async () => Buffer.from("x".repeat(500 * 40)),
		});

		const filePath = "src/BigService.ts";

		// Attempt 1: Full write allowed (500 lines, budget passes)
		const check1 = await gate.check("/test/BigService.ts", filePath, 20000, 15000, 500);
		expect(check1.allowed).toBe(true);

		// Simulate truncation after write
		gate.processWriteResult(filePath, "The file got truncated during write", false);

		// Verify truncation was detected and recorded
		const summary1 = tracker.getSummary("plan-t", "ws-t", filePath);
		expect(summary1.failedAttempts).toBe(1);
		expect(summary1.attempts[0].failureType).toBe("truncation");

		// Attempt 2: Full write still allowed (1 failure, threshold not reached)
		const check2 = await gate.check("/test/BigService.ts", filePath, 20000, 15000, 500);
		expect(check2.allowed).toBe(true);
		expect(check2.handoffTriggered).toBe(false);

		// Simulate second truncation
		gate.processWriteResult(filePath, "write is truncating the output again", false);

		// Now 2 failures: threshold reached
		expect(tracker.hasReachedHandoffThreshold("plan-t", "ws-t", filePath)).toBe(true);

		// Attempt 3: Full write BLOCKED — handoff triggered
		const check3 = await gate.check("/test/BigService.ts", filePath, 20000, 15000, 500);
		expect(check3.allowed).toBe(false);
		expect(check3.handoffTriggered).toBe(true);

		// Verify audit events were emitted
		const auditLog = auditEmitter.getEventLog();
		expect(auditLog.some((e) => e.eventType === "edit_truncation_detected")).toBe(true);
		expect(auditLog.some((e) => e.eventType === "patch_fallback_forced")).toBe(true);
	});

	it("should trigger handoff with correct payload after truncation failures", () => {
		const eventBus = createEventBus();
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

		const planExecId = "plan-t2";
		const workspaceId = "ws-t2";
		const filePath = "src/LargeComponent.tsx";

		// Record 2 truncation failures
		tracker.recordFailure(planExecId, workspaceId, filePath, "full_write", "truncation", "truncated first time");
		tracker.recordFailure(planExecId, workspaceId, filePath, "full_write", "truncation", "truncated second time");

		// Handoff
		const payload = handoff.checkAndHandoff(
			planExecId,
			workspaceId,
			filePath,
			"hybrid",
			"diff content",
			"/snapshots/LargeComponent.tsx.snap",
		);
		expect(payload).not.toBeNull();
		expect(payload!.filePath).toBe(filePath);
		expect(payload!.failedStrategyList.length).toBe(2);
		expect(payload!.lastToolError).toBe("truncated second time");
		expect(payload!.preEditSnapshotPath).toBe("/snapshots/LargeComponent.tsx.snap");
		expect(payload!.currentDiff).toBe("diff content");
		expect(payload!.suggestedManualFixSteps.length).toBeGreaterThan(0);
		expect(payload!.suggestedResumeInstruction).toBeTruthy();

		// Verify the suggested fixes mention truncation
		const hasTruncationFix = payload!.suggestedManualFixSteps.some(
			(s) => s.toLowerCase().includes("truncat") || s.toLowerCase().includes("targeted"),
		);
		expect(hasTruncationFix).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Step 5: Manual dogfood — exact-match loop
// ---------------------------------------------------------------------------

describe("Step 5: Exact-match loop prevention", () => {
	it("should record first exact-match failure and NOT handoff", () => {
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const detector = createTruncationDetector();

		const planExecId = "plan-em";
		const workspaceId = "ws-em";
		const filePath = "src/Component.tsx";

		// First exact-match failure
		const detection = detector.detectExactMatchFailure("Could not find the exact text in the file");
		expect(detection.detected).toBe(true);
		expect(detection.failureType).toBe("exact_match_failed");

		tracker.recordFailure(planExecId, workspaceId, filePath, "targeted_edit", "exact_match_failed", "no match");

		// Not yet at threshold
		expect(tracker.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)).toBe(false);
		expect(tracker.countFailures(planExecId, workspaceId, filePath)).toBe(1);
	});

	it("should handoff after second exact-match failure and prevent 3rd attempt", async () => {
		const eventBus = createEventBus();
		const policy = createEditStrategyPolicy({ mode: "hybrid" });
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

		const planExecId = "plan-em2";
		const workspaceId = "ws-em2";
		const filePath = "src/Widget.tsx";

		// First exact-match failure
		tracker.recordFailure(
			planExecId,
			workspaceId,
			filePath,
			"targeted_edit",
			"exact_match_failed",
			"Could not find the exact text",
		);

		// NOT at threshold yet
		expect(tracker.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)).toBe(false);

		// Second exact-match failure
		tracker.recordFailure(
			planExecId,
			workspaceId,
			filePath,
			"targeted_edit",
			"exact_match_failed",
			"old text must match exactly",
		);

		// NOW at threshold
		expect(tracker.hasReachedHandoffThreshold(planExecId, workspaceId, filePath)).toBe(true);

		// Handoff triggers
		const payload = handoff.checkAndHandoff(planExecId, workspaceId, filePath, "hybrid", "diff", undefined);
		expect(payload).not.toBeNull();
		expect(payload!.failedStrategyList.length).toBe(2);

		// Suggested fixes should mention whitespace/exact matching
		const steps = payload!.suggestedManualFixSteps;
		const hasWhitespaceFix = steps.some(
			(s) => s.toLowerCase().includes("whitespace") || s.toLowerCase().includes("exact"),
		);
		expect(hasWhitespaceFix).toBe(true);

		// 3rd attempt is blocked via WriteGate
		const gate = createWriteGate({
			policy,
			attemptTracker: tracker,
			planExecId,
			workspaceId,
			stat: async () => ({ size: 15000, isFile: () => true }),
			readFile: async () => Buffer.from("content"),
		});

		const check = await gate.check("/test/Widget.tsx", filePath);
		expect(check.allowed).toBe(false);
		expect(check.handoffTriggered).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Step 6: Mode behavior
// ---------------------------------------------------------------------------

describe("Step 6: Mode behavior", () => {
	it("Token Saving: 300+ line TSX full rewrite is blocked", () => {
		const policy = createEditStrategyPolicy({ mode: "token_saving" });
		const result = policy.checkPolicy("src/Component.tsx", false, 301, 12000);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("tsx_component_patch_required");
	});

	it("Hybrid: 500-line file full rewrite is allowed when budget passes", () => {
		const policy = createEditStrategyPolicy({ mode: "hybrid" });
		const result = policy.checkPolicy("src/service.ts", false, 500, 20000, 20000, 15000, 500);
		expect(result.writeAllowed).toBe(true);
		expect(result.reasonCode).toBe("output_budget_pass_full_rewrite");
	});

	it("Hybrid: 1000+ line file requires patch/handoff path", () => {
		const policy = createEditStrategyPolicy({ mode: "hybrid" });
		// Over 1000 lines: blocked even when budget passes
		const result = policy.checkPolicy("src/large.ts", false, 1001, 41000, 41000, 50000, 1001);
		expect(result.writeAllowed).toBe(false);
		// Falls back to patch mode; at handoff threshold, workspace blocks

		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		tracker.recordFailure("p", "w", "src/large.ts", "targeted_edit", "exact_match_failed");
		tracker.recordFailure("p", "w", "src/large.ts", "targeted_edit", "exact_match_failed");
		expect(tracker.hasReachedHandoffThreshold("p", "w", "src/large.ts")).toBe(true);
	});

	it("Speed: under 1000 lines full rewrite is allowed", () => {
		const policy = createEditStrategyPolicy({ mode: "speed" });
		const result = policy.checkPolicy("src/app.ts", false, 800, 32000);
		expect(result.writeAllowed).toBe(true);
		expect(result.reasonCode).toBe("speed_mode_full_rewrite");
	});

	it("Speed: over 1000 lines is blocked by hard safety gate", () => {
		const policy = createEditStrategyPolicy({ mode: "speed" });
		const result = policy.checkPolicy("src/huge.ts", false, 1001, 41000);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("hard_safety_gate_blocked");
	});

	it("New files are always allowed in all modes", () => {
		for (const mode of ["token_saving", "hybrid", "speed"] as EditStrategyMode[]) {
			const policy = createEditStrategyPolicy({ mode });
			const result = policy.checkPolicy("src/brand-new.ts", true, 0, 0);
			expect(result.writeAllowed).toBe(true);
			expect(result.reasonCode).toBe("new_file_write_allowed");
		}
	});

	it("Generated files without manifest marking are blocked from rewrite", () => {
		const policy = createEditStrategyPolicy({
			mode: "token_saving",
			generatedManifest: [{ path: "dist/output.js", rewriteAllowed: false }],
		});
		const result = policy.checkPolicy("dist/output.js", false, 500, 20000);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("generated_file_rewrite_blocked");
	});
});

// ---------------------------------------------------------------------------
// Step 7: Dashboard data structure validation
// ---------------------------------------------------------------------------

describe("Step 7: Dashboard data structures", () => {
	it("EditFailureHandoffPayload has all required fields", () => {
		const tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		const eventBus = createEventBus();
		const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

		tracker.recordFailure("p", "w", "f.tsx", "full_write", "truncation", "err1");
		tracker.recordFailure("p", "w", "f.tsx", "targeted_edit", "exact_match_failed", "err2");

		const payload = handoff.checkAndHandoff("p", "w", "f.tsx", "hybrid", "diff-here", "/snap/file.snap");

		expect(payload).not.toBeNull();

		// Verify all required fields are present and correctly typed
		expect(typeof payload!.filePath).toBe("string");
		expect(typeof payload!.selectedEditMode).toBe("string");
		expect(Array.isArray(payload!.failedStrategyList)).toBe(true);
		expect(payload!.failedStrategyList.length).toBe(2);
		expect(typeof payload!.failedStrategyList[0].attemptType).toBe("string");
		expect(typeof payload!.failedStrategyList[0].failureType).toBe("string");
		expect(typeof payload!.lastToolError).toBe("string");
		expect(typeof payload!.preEditSnapshotPath).toBe("string");
		expect(typeof payload!.currentDiff).toBe("string");
		expect(typeof payload!.attemptedPatchSummary).toBe("string");
		expect(Array.isArray(payload!.suggestedManualFixSteps)).toBe(true);
		expect(payload!.suggestedManualFixSteps.length).toBeGreaterThan(0);
		expect(typeof payload!.suggestedResumeInstruction).toBe("string");

		// Specifically check diff, failed attempts, suggested fix, restore, resume
		expect(payload!.currentDiff).toBe("diff-here");
		expect(payload!.failedStrategyList[0].attemptType).toBe("full_write");
		expect(payload!.failedStrategyList[1].attemptType).toBe("targeted_edit");
		expect(payload!.preEditSnapshotPath).toBe("/snap/file.snap");
		expect(payload!.suggestedManualFixSteps.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
		expect(payload!.suggestedResumeInstruction.length).toBeGreaterThan(0);
	});

	it("EditStrategyWarnings data has correct shape", () => {
		const auditEmitter = createEditAuditEventEmitter();
		const planExecId = "p";
		const workspaceId = "w";

		auditEmitter.emitStrategySelected(planExecId, workspaceId, "f.ts", "hybrid", 500, 20000);
		auditEmitter.emitStrategyBlocked(
			planExecId,
			workspaceId,
			"big.ts",
			"hybrid",
			"existing_file_blocked_size",
			1500,
			60000,
		);
		auditEmitter.emitTruncationDetected(planExecId, workspaceId, "mid.ts", "hybrid");
		auditEmitter.emitExactMatchFailed(planExecId, workspaceId, "mid.ts", "hybrid");
		auditEmitter.emitFailureHandoff(planExecId, workspaceId, "mid.ts", "hybrid", "exact_match_failed");
		auditEmitter.emitTokenWastePrevented(planExecId, workspaceId, "big.ts", "hybrid", "existing_file_blocked_size");

		const summary = auditEmitter.generateSummary();

		// This is the shape that the EditStrategyWarnings component consumes
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

	it("Settings editStrategyMode field is a valid mode", () => {
		// Verify the Settings type supports the field
		const validModes: EditStrategyMode[] = ["token_saving", "hybrid", "speed"];
		for (const mode of validModes) {
			const policy = createEditStrategyPolicy({ mode });
			expect(policy.getMode()).toBe(mode);
		}
	});
});

// ---------------------------------------------------------------------------
// Step 8: Audit validation
// ---------------------------------------------------------------------------

describe("Step 8: Audit validation", () => {
	it("should emit all 6 required audit event types in a realistic execution flow", () => {
		const auditEmitter = createEditAuditEventEmitter();
		const planExecId = "audit-p";
		const workspaceId = "audit-w";

		// Simulate a realistic execution flow:
		// 1. Strategy selected for a file
		auditEmitter.emitStrategySelected(planExecId, workspaceId, "src/app.ts", "hybrid", 300, 12000);

		// 2. Full rewrite attempted
		auditEmitter.emitFullRewriteAttempted(planExecId, workspaceId, "src/app.ts", "hybrid", 300, 12000);

		// 3. Another file blocked
		auditEmitter.emitStrategyBlocked(
			planExecId,
			workspaceId,
			"src/huge.ts",
			"hybrid",
			"existing_file_blocked_size",
			1500,
			60000,
		);

		// 4. Token waste prevented for the blocked file
		auditEmitter.emitTokenWastePrevented(
			planExecId,
			workspaceId,
			"src/huge.ts",
			"hybrid",
			"existing_file_blocked_size",
		);

		// 5. Truncation detected on a third file
		auditEmitter.emitTruncationDetected(planExecId, workspaceId, "src/medium.ts", "hybrid");

		// 6. Exact match failed on same file
		auditEmitter.emitExactMatchFailed(planExecId, workspaceId, "src/medium.ts", "hybrid");

		// 7. Handoff triggered
		auditEmitter.emitFailureHandoff(planExecId, workspaceId, "src/medium.ts", "hybrid", "exact_match_failed");

		// Verify all 6 required event types are in the log
		const requiredEvents: EditAuditEventType[] = [
			"edit_strategy_selected",
			"edit_strategy_blocked",
			"edit_truncation_detected",
			"edit_exact_match_failed",
			"edit_failure_handoff",
			"token_waste_prevented",
		];

		const log = auditEmitter.getEventLog();
		const emittedTypes = new Set(log.map((e) => e.eventType));

		for (const required of requiredEvents) {
			expect(emittedTypes.has(required)).toBe(true);
		}
	});

	it("each audit event has required fields", () => {
		const auditEmitter = createEditAuditEventEmitter();
		const planExecId = "audit-fields";
		const workspaceId = "audit-w";

		auditEmitter.emitStrategySelected(planExecId, workspaceId, "f.ts", "hybrid", 100, 4000);
		auditEmitter.emitStrategyBlocked(
			planExecId,
			workspaceId,
			"f.ts",
			"hybrid",
			"existing_file_blocked_size",
			500,
			20000,
		);
		auditEmitter.emitFullRewriteAttempted(planExecId, workspaceId, "f.ts", "hybrid", 100, 4000);
		auditEmitter.emitTruncationDetected(planExecId, workspaceId, "f.ts", "hybrid", 1);
		auditEmitter.emitExactMatchFailed(planExecId, workspaceId, "f.ts", "hybrid", 2);
		auditEmitter.emitFailureHandoff(planExecId, workspaceId, "f.ts", "hybrid", "truncation");
		auditEmitter.emitTokenWastePrevented(planExecId, workspaceId, "f.ts", "hybrid", "existing_file_blocked_size");

		const log = auditEmitter.getEventLog();

		for (const event of log) {
			// Every event must have these fields
			expect(typeof event.eventType).toBe("string");
			expect(typeof event.planExecId).toBe("string");
			expect(typeof event.workspaceId).toBe("string");
			expect(typeof event.filePath).toBe("string");
			expect(typeof event.mode).toBe("string");
			expect(typeof event.timestamp).toBe("number");
			expect(event.timestamp).toBeGreaterThan(0);
		}
	});

	it("audit summary provides counts for dashboard display", () => {
		const auditEmitter = createEditAuditEventEmitter();

		// Emit a realistic mix
		auditEmitter.emitStrategySelected("p", "w", "a.ts", "hybrid");
		auditEmitter.emitStrategyBlocked("p", "w", "b.ts", "hybrid", "existing_file_blocked_size");
		auditEmitter.emitStrategyBlocked("p", "w", "c.ts", "hybrid", "tsx_component_patch_required");
		auditEmitter.emitTruncationDetected("p", "w", "d.ts", "hybrid");
		auditEmitter.emitExactMatchFailed("p", "w", "d.ts", "hybrid");
		auditEmitter.emitExactMatchFailed("p", "w", "d.ts", "hybrid");
		auditEmitter.emitFailureHandoff("p", "w", "d.ts", "hybrid");
		auditEmitter.emitTokenWastePrevented("p", "w", "b.ts", "hybrid", "existing_file_blocked_size");
		auditEmitter.emitTokenWastePrevented("p", "w", "c.ts", "hybrid", "tsx_component_patch_required");

		const summary = auditEmitter.generateSummary();

		expect(summary.editModeUsed).toBe("hybrid");
		expect(summary.blockedRewrites).toBe(2);
		expect(summary.truncationEvents).toBe(1);
		expect(summary.exactMatchFailures).toBe(2);
		expect(summary.handoffs).toBe(1);
		expect(summary.estimatedWastePrevented).toBe(4); // 2 blocked + 2 token_waste_prevented

		// Verify by-type filtering works
		expect(auditEmitter.getEventsByType("edit_strategy_blocked").length).toBe(2);
		expect(auditEmitter.getEventsByType("edit_exact_match_failed").length).toBe(2);
		expect(auditEmitter.getEventsByType("token_waste_prevented").length).toBe(2);
	});
});
