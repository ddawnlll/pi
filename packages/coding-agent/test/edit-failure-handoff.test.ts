/**
 * Tests for Edit Failure Handoff - P4.5 Workstream 4.5.D
 *
 * Validates that:
 * - Two same-file edit failures mark workspace as BLOCKED_EDIT_FAILURE
 * - Workspace stops further autonomous edits after handoff
 * - Handoff payload includes diff, failed attempts, snapshot, manual fix steps, resume instruction
 * - Handoff event is emitted on the event bus
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createEditAttemptTracker } from "../src/core/edit-attempt-tracker.js";
import {
	createEditFailureHandoff,
	EDIT_FAILURE_HANDOFF_CHANNEL,
	type EditFailureHandoffEvent,
} from "../src/core/edit-failure-handoff.js";
import { createEventBus, type EventBusController } from "../src/core/event-bus.js";

// ---------------------------------------------------------------------------
// EditFailureHandoff
// ---------------------------------------------------------------------------

describe("EditFailureHandoff", () => {
	let tracker: ReturnType<typeof createEditAttemptTracker>;
	let eventBus: EventBusController;
	let receivedEvents: unknown[];

	beforeEach(() => {
		tracker = createEditAttemptTracker({ handoffThreshold: 2 });
		eventBus = createEventBus();
		receivedEvents = [];
		eventBus.on(EDIT_FAILURE_HANDOFF_CHANNEL, (data: unknown) => {
			receivedEvents.push(data);
		});
	});

	describe("checkAndHandoff", () => {
		it("should return null when threshold is NOT reached", () => {
			const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");

			const result = handoff.checkAndHandoff("plan1", "ws1", "file.ts", "hybrid", "", undefined);
			expect(result).toBeNull();
			expect(receivedEvents.length).toBe(0);
		});

		it("should return handoff payload when threshold IS reached", () => {
			const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation", "file truncated");
			tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed", "no exact match");

			const result = handoff.checkAndHandoff(
				"plan1",
				"ws1",
				"file.ts",
				"hybrid",
				"diff content here",
				"/snapshots/file.ts.snap",
			);

			expect(result).not.toBeNull();
			expect(result!.filePath).toBe("file.ts");
			expect(result!.selectedEditMode).toBe("hybrid");
			expect(result!.failedStrategyList.length).toBe(2);
			expect(result!.lastToolError).toBe("no exact match");
			expect(result!.preEditSnapshotPath).toBe("/snapshots/file.ts.snap");
			expect(result!.currentDiff).toBe("diff content here");
			expect(result!.suggestedManualFixSteps.length).toBeGreaterThan(0);
			expect(result!.suggestedResumeInstruction).toBeTruthy();
		});

		it("should emit edit_failure_handoff event when threshold is reached", () => {
			const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed");

			handoff.checkAndHandoff("plan1", "ws1", "file.ts", "hybrid", "diff", undefined);

			expect(receivedEvents.length).toBe(1);
			const event = receivedEvents[0] as EditFailureHandoffEvent;
			expect(event.planExecId).toBe("plan1");
			expect(event.workspaceId).toBe("ws1");
			expect(event.filePath).toBe("file.ts");
			expect(event.selectedEditMode).toBe("hybrid");
			expect(event.blockedReason).toBe("BLOCKED_EDIT_FAILURE");
		});

		it("should include truncation-specific suggested fixes for truncation failures", () => {
			const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");

			const result = handoff.checkAndHandoff("plan1", "ws1", "file.ts", "token_saving", "", undefined);

			expect(result).not.toBeNull();
			const steps = result!.suggestedManualFixSteps;
			const hasTruncationStep = steps.some(
				(s) => s.toLowerCase().includes("truncat") || s.toLowerCase().includes("targeted"),
			);
			expect(hasTruncationStep).toBe(true);
		});

		it("should include exact-match-specific suggested fixes for exact-match failures", () => {
			const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

			tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed");
			tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed");

			const result = handoff.checkAndHandoff("plan1", "ws1", "file.ts", "hybrid", "", undefined);

			expect(result).not.toBeNull();
			const steps = result!.suggestedManualFixSteps;
			const hasExactMatchStep = steps.some(
				(s) => s.toLowerCase().includes("whitespace") || s.toLowerCase().includes("exact"),
			);
			expect(hasExactMatchStep).toBe(true);
		});

		it("should suggest mode switch in token_saving mode", () => {
			const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");

			const result = handoff.checkAndHandoff("plan1", "ws1", "file.ts", "token_saving", "", undefined);

			expect(result).not.toBeNull();
			const steps = result!.suggestedManualFixSteps;
			const hasModeSwitchSuggestion = steps.some(
				(s) => s.toLowerCase().includes("hybrid") || s.toLowerCase().includes("speed"),
			);
			expect(hasModeSwitchSuggestion).toBe(true);
		});
	});

	describe("forceHandoff", () => {
		it("should force a handoff regardless of threshold", () => {
			const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

			// No failures recorded for file.ts
			const result = handoff.forceHandoff("plan1", "ws1", "file.ts", "hybrid", "diff", undefined, "manual override");

			expect(result).not.toBeNull();
			expect(result!.lastToolError).toBe("manual override");
		});

		it("should emit handoff event even when forcing", () => {
			const handoff = createEditFailureHandoff({ attemptTracker: tracker, eventBus });

			handoff.forceHandoff("plan1", "ws1", "file.ts", "speed", "", undefined, "forced");

			expect(receivedEvents.length).toBe(1);
		});
	});

	describe("no event bus", () => {
		it("should still return payload when no event bus is provided", () => {
			const handoff = createEditFailureHandoff({ attemptTracker: tracker });

			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");

			const result = handoff.checkAndHandoff("plan1", "ws1", "file.ts", "hybrid", "diff", undefined);

			expect(result).not.toBeNull();
			// No event emitted (no event bus)
		});
	});
});
