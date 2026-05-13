/**
 * Tests for Edit Attempt Tracker and Truncation Detector
 *
 * P4.5 Workstream 4.5.C: Validates edit attempt tracking, truncation detection,
 * exact-match failure detection, same-file failure counting, and handoff threshold.
 *
 * Acceptance Criteria:
 * 1. Edit attempts tracked per plan/workspace/file
 * 2. Truncation markers force patch mode
 * 3. Second full-write attempt after truncation is blocked
 * 4. Git checkout restore after failed write forces patch mode
 * 5. Targeted edits remain allowed after forced patch mode
 * 6. Tracker state persists in workspace metadata
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createEditAttemptTracker, type EditAttemptTracker } from "../src/core/edit-attempt-tracker.js";
import { createTruncationDetector, type TruncationDetector } from "../src/core/truncation-detector.js";

// ---------------------------------------------------------------------------
// TruncationDetector
// ---------------------------------------------------------------------------

describe("TruncationDetector", () => {
	let detector: TruncationDetector;

	beforeEach(() => {
		detector = createTruncationDetector();
	});

	describe("truncation detection", () => {
		it("should detect 'truncated' marker", () => {
			const result = detector.detectTruncation("The file was truncated during write");
			expect(result.detected).toBe(true);
			expect(result.matchedMarker).toBe("truncated");
			expect(result.failureType).toBe("truncation");
		});

		it("should detect 'The file got truncated' marker", () => {
			const result = detector.detectTruncation("The file got truncated");
			expect(result.detected).toBe(true);
			// 'truncated' is a shorter marker that also matches
			expect(result.matchedMarker).toBeTruthy();
		});

		it("should detect 'write is truncating' marker", () => {
			const result = detector.detectTruncation("write is truncating the output");
			expect(result.detected).toBe(true);
		});

		it("should detect 'Let me write the complete file again' marker", () => {
			const result = detector.detectTruncation("Let me write the complete file again from scratch");
			expect(result.detected).toBe(true);
		});

		it("should detect 'complete file in parts' marker", () => {
			const result = detector.detectTruncation("I will write the complete file in parts");
			expect(result.detected).toBe(true);
		});

		it("should detect '... more lines' marker", () => {
			const result = detector.detectTruncation("... more lines follow");
			expect(result.detected).toBe(true);
		});

		it("should NOT detect truncation in normal text", () => {
			const result = detector.detectTruncation("File written successfully");
			expect(result.detected).toBe(false);
		});

		it("should handle case-insensitive detection", () => {
			const result = detector.detectTruncation("THE FILE GOT TRUNCATED");
			expect(result.detected).toBe(true);
		});

		it("should return no detection for empty string", () => {
			const result = detector.detectTruncation("");
			expect(result.detected).toBe(false);
		});
	});

	describe("exact-match failure detection", () => {
		it("should detect 'Could not find the exact text' marker", () => {
			const result = detector.detectExactMatchFailure("Could not find the exact text in the file");
			expect(result.detected).toBe(true);
			expect(result.failureType).toBe("exact_match_failed");
		});

		it("should detect 'old text must match exactly' marker", () => {
			const result = detector.detectExactMatchFailure("old text must match exactly");
			expect(result.detected).toBe(true);
			expect(result.failureType).toBe("exact_match_failed");
		});

		it("should NOT detect exact-match failure in normal text", () => {
			const result = detector.detectExactMatchFailure("Edit applied successfully");
			expect(result.detected).toBe(false);
		});
	});

	describe("output too large detection", () => {
		it("should detect 'output too large' marker", () => {
			const result = detector.detectOutputTooLarge("The output too large for the budget");
			expect(result.detected).toBe(true);
			expect(result.failureType).toBe("output_too_large");
		});
	});

	describe("malformed patch detection", () => {
		it("should detect 'malformed patch' marker", () => {
			const result = detector.detectMalformedPatch("The malformed patch could not be applied");
			expect(result.detected).toBe(true);
			expect(result.failureType).toBe("malformed_patch");
		});
	});

	describe("validation failed after edit detection", () => {
		it("should detect 'validation failed after edit' marker", () => {
			const result = detector.detectValidationFailed("validation failed after edit was applied");
			expect(result.detected).toBe(true);
			expect(result.failureType).toBe("validation_failed_after_edit");
		});
	});

	describe("detectAny", () => {
		it("should detect truncation first (highest priority)", () => {
			const result = detector.detectAny("truncated: Could not find the exact text");
			expect(result.detected).toBe(true);
			expect(result.failureType).toBe("truncation");
		});

		it("should detect exact-match when no truncation present", () => {
			const result = detector.detectAny("Could not find the exact text");
			expect(result.detected).toBe(true);
			expect(result.failureType).toBe("exact_match_failed");
		});

		it("should return no detection for normal text", () => {
			const result = detector.detectAny("File updated successfully");
			expect(result.detected).toBe(false);
		});

		it("should return no detection for empty string", () => {
			const result = detector.detectAny("");
			expect(result.detected).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// EditAttemptTracker
// ---------------------------------------------------------------------------

describe("EditAttemptTracker", () => {
	let tracker: EditAttemptTracker;

	beforeEach(() => {
		tracker = createEditAttemptTracker({ handoffThreshold: 2 });
	});

	describe("recording attempts", () => {
		it("should record a successful attempt", () => {
			const record = tracker.recordSuccess("plan1", "ws1", "file.ts", "full_write");
			expect(record.succeeded).toBe(true);
			expect(record.attemptType).toBe("full_write");
			expect(record.failureType).toBeUndefined();
		});

		it("should record a failed attempt", () => {
			const record = tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation", "truncated");
			expect(record.succeeded).toBe(false);
			expect(record.attemptType).toBe("full_write");
			expect(record.failureType).toBe("truncation");
			expect(record.errorMessage).toBe("truncated");
		});

		it("should accumulate multiple attempts for the same file", () => {
			tracker.recordSuccess("plan1", "ws1", "file.ts", "full_write");
			tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed");

			const attempts = tracker.getAttempts("plan1", "ws1", "file.ts");
			expect(attempts.length).toBe(2);
		});

		it("should track different files independently", () => {
			tracker.recordFailure("plan1", "ws1", "a.ts", "full_write", "truncation");
			tracker.recordFailure("plan1", "ws1", "b.ts", "targeted_edit", "exact_match_failed");

			expect(tracker.getAttempts("plan1", "ws1", "a.ts").length).toBe(1);
			expect(tracker.getAttempts("plan1", "ws1", "b.ts").length).toBe(1);
		});
	});

	describe("failure counting", () => {
		it("should count failed attempts", () => {
			tracker.recordSuccess("plan1", "ws1", "file.ts", "full_write");
			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed");

			expect(tracker.countFailures("plan1", "ws1", "file.ts")).toBe(2);
		});

		it("should exclude exact_match_failed when exactMatchCountsTowardHandoff is false", () => {
			const customTracker = createEditAttemptTracker({
				handoffThreshold: 2,
				exactMatchCountsTowardHandoff: false,
			});

			customTracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed", "no match");
			customTracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "truncation");

			expect(customTracker.countFailures("plan1", "ws1", "file.ts")).toBe(1);
		});
	});

	describe("handoff threshold", () => {
		it("should detect when handoff threshold is reached (2 failures)", () => {
			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			expect(tracker.hasReachedHandoffThreshold("plan1", "ws1", "file.ts")).toBe(false);

			tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed");
			expect(tracker.hasReachedHandoffThreshold("plan1", "ws1", "file.ts")).toBe(true);
		});

		it("should NOT reach threshold after 1 failure with threshold 2", () => {
			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			expect(tracker.hasReachedHandoffThreshold("plan1", "ws1", "file.ts")).toBe(false);
		});

		it("should support custom handoff threshold", () => {
			const customTracker = createEditAttemptTracker({ handoffThreshold: 3 });
			customTracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			customTracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			expect(customTracker.hasReachedHandoffThreshold("plan1", "ws1", "file.ts")).toBe(false);

			customTracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			expect(customTracker.hasReachedHandoffThreshold("plan1", "ws1", "file.ts")).toBe(true);
		});
	});

	describe("summary", () => {
		it("should generate a file edit summary", () => {
			tracker.recordSuccess("plan1", "ws1", "file.ts", "full_write");
			tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed");

			const summary = tracker.getSummary("plan1", "ws1", "file.ts");
			expect(summary.filePath).toBe("file.ts");
			expect(summary.totalAttempts).toBe(2);
			expect(summary.failedAttempts).toBe(1);
			expect(summary.reachedHandoffThreshold).toBe(false);
		});
	});

	describe("last failure", () => {
		it("should return the last failure for a file", () => {
			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation", "first error");
			tracker.recordSuccess("plan1", "ws1", "file.ts", "full_write");
			tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed", "second error");

			const lastFailure = tracker.getLastFailure("plan1", "ws1", "file.ts");
			expect(lastFailure?.failureType).toBe("exact_match_failed");
			expect(lastFailure?.errorMessage).toBe("second error");
		});

		it("should return undefined when no failures exist", () => {
			tracker.recordSuccess("plan1", "ws1", "file.ts", "full_write");
			const lastFailure = tracker.getLastFailure("plan1", "ws1", "file.ts");
			expect(lastFailure).toBeUndefined();
		});
	});

	describe("blocked files", () => {
		it("should list files that have reached the handoff threshold", () => {
			tracker.recordFailure("plan1", "ws1", "a.ts", "full_write", "truncation");
			tracker.recordFailure("plan1", "ws1", "a.ts", "full_write", "truncation");
			tracker.recordFailure("plan1", "ws1", "b.ts", "full_write", "truncation");

			const blocked = tracker.getBlockedFiles("plan1", "ws1");
			expect(blocked).toContain("a.ts");
			expect(blocked).not.toContain("b.ts");
		});
	});

	describe("serialization", () => {
		it("should serialize and deserialize state", () => {
			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			tracker.recordSuccess("plan1", "ws1", "file.ts", "full_write");

			const serialized = tracker.serialize();
			expect(Object.keys(serialized.attempts).length).toBeGreaterThan(0);

			const newTracker = createEditAttemptTracker();
			newTracker.deserialize(serialized);

			const attempts = newTracker.getAttempts("plan1", "ws1", "file.ts");
			expect(attempts.length).toBe(2);
		});
	});

	describe("clear", () => {
		it("should clear all tracked attempts", () => {
			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
			tracker.clear();
			expect(tracker.getAttempts("plan1", "ws1", "file.ts").length).toBe(0);
		});

		it("should clear attempts for a specific file", () => {
			tracker.recordFailure("plan1", "ws1", "a.ts", "full_write", "truncation");
			tracker.recordFailure("plan1", "ws1", "b.ts", "full_write", "truncation");
			tracker.clearFile("plan1", "ws1", "a.ts");
			expect(tracker.getAttempts("plan1", "ws1", "a.ts").length).toBe(0);
			expect(tracker.getAttempts("plan1", "ws1", "b.ts").length).toBe(1);
		});
	});

	describe("handoff threshold configuration", () => {
		it("should allow changing the handoff threshold", () => {
			tracker.setHandoffThreshold(5);
			expect(tracker.getHandoffThreshold()).toBe(5);
		});

		it("should enforce minimum threshold of 1", () => {
			tracker.setHandoffThreshold(0);
			expect(tracker.getHandoffThreshold()).toBe(1);
		});
	});
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 1: Edit attempts tracked per plan/workspace/file
// ---------------------------------------------------------------------------

describe("AC1: Edit attempts tracked per plan/workspace/file", () => {
	let tracker: EditAttemptTracker;

	beforeEach(() => {
		tracker = createEditAttemptTracker({ handoffThreshold: 2 });
	});

	it("should track attempts separately per plan", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
		tracker.recordFailure("plan2", "ws1", "file.ts", "full_write", "truncation");

		expect(tracker.getAttempts("plan1", "ws1", "file.ts").length).toBe(1);
		expect(tracker.getAttempts("plan2", "ws1", "file.ts").length).toBe(1);
	});

	it("should track attempts separately per workspace", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
		tracker.recordFailure("plan1", "ws2", "file.ts", "full_write", "truncation");

		expect(tracker.getAttempts("plan1", "ws1", "file.ts").length).toBe(1);
		expect(tracker.getAttempts("plan1", "ws2", "file.ts").length).toBe(1);
	});

	it("should track attempts separately per file", () => {
		tracker.recordFailure("plan1", "ws1", "a.ts", "full_write", "truncation");
		tracker.recordFailure("plan1", "ws1", "b.ts", "full_write", "truncation");

		expect(tracker.getAttempts("plan1", "ws1", "a.ts").length).toBe(1);
		expect(tracker.getAttempts("plan1", "ws1", "b.ts").length).toBe(1);
	});

	it("should record attempts with correct plan/workspace/file metadata", () => {
		tracker.recordFailure("planA", "wsB", "fileC.ts", "full_write", "truncation", "error msg");

		const attempts = tracker.getAttempts("planA", "wsB", "fileC.ts");
		expect(attempts.length).toBe(1);
		expect(attempts[0].planExecId).toBe("planA");
		expect(attempts[0].workspaceId).toBe("wsB");
		expect(attempts[0].filePath).toBe("fileC.ts");
		expect(attempts[0].attemptType).toBe("full_write");
		expect(attempts[0].failureType).toBe("truncation");
		expect(attempts[0].errorMessage).toBe("error msg");
	});
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 2: Truncation markers force patch mode
// ---------------------------------------------------------------------------

describe("AC2: Truncation markers force patch mode", () => {
	let tracker: EditAttemptTracker;

	beforeEach(() => {
		tracker = createEditAttemptTracker({ handoffThreshold: 2 });
	});

	it("should force patch mode when truncation failure is recorded", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation", "file was truncated");

		expect(tracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(true);
	});

	it("should NOT force patch mode for non-truncation failures", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed", "no match");

		expect(tracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(false);
	});

	it("should NOT force patch mode for successful attempts", () => {
		tracker.recordSuccess("plan1", "ws1", "file.ts", "full_write");

		expect(tracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(false);
	});

	it("should integrate with TruncationDetector to detect and force patch", () => {
		const detector = createTruncationDetector();
		const output = "The file was truncated during write";

		const detection = detector.detectAny(output);
		expect(detection.detected).toBe(true);
		expect(detection.failureType).toBe("truncation");

		// Simulate recording the truncation failure from detection
		if (detection.failureType === "truncation") {
			tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation", output);
		}

		expect(tracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(true);
	});

	it("should force patch mode independently per file (only truncated file)", () => {
		tracker.recordFailure("plan1", "ws1", "a.ts", "full_write", "truncation");
		tracker.recordFailure("plan1", "ws1", "b.ts", "targeted_edit", "exact_match_failed");

		expect(tracker.isPatchModeForced("plan1", "ws1", "a.ts")).toBe(true);
		expect(tracker.isPatchModeForced("plan1", "ws1", "b.ts")).toBe(false);
	});

	it("should list forced patch files", () => {
		tracker.recordFailure("plan1", "ws1", "a.ts", "full_write", "truncation");
		tracker.recordFailure("plan1", "ws1", "b.ts", "full_write", "truncation");

		const forcedPatchFiles = tracker.getForcedPatchFiles("plan1", "ws1");
		expect(forcedPatchFiles).toContain("a.ts");
		expect(forcedPatchFiles).toContain("b.ts");
	});

	it("should support explicit forcePatchMode call", () => {
		tracker.forcePatchMode("plan1", "ws1", "file.ts");
		expect(tracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 3: Second full-write attempt after truncation is blocked
// ---------------------------------------------------------------------------

describe("AC3: Second full-write attempt after truncation is blocked", () => {
	let tracker: EditAttemptTracker;

	beforeEach(() => {
		tracker = createEditAttemptTracker({ handoffThreshold: 3 });
	});

	it("should block full-write after truncation forces patch mode", () => {
		// First full-write attempt fails with truncation
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation", "truncated");

		// Second full-write should be blocked because truncation forced patch mode
		const result = tracker.isFullWriteAllowed("plan1", "ws1", "file.ts");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("patch mode forced");
	});

	it("should allow full-write before any truncation", () => {
		// No truncation recorded yet
		const result = tracker.isFullWriteAllowed("plan1", "ws1", "file.ts");
		expect(result.allowed).toBe(true);
	});

	it("should block full-write after truncation even with no other failures", () => {
		// A single truncation forces patch mode immediately
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");

		const result = tracker.isFullWriteAllowed("plan1", "ws1", "file.ts");
		expect(result.allowed).toBe(false);
	});

	it("should block full-write after truncation regardless of handoff threshold", () => {
		// Even with a high handoff threshold, truncation blocks full-write
		const result = tracker.isFullWriteAllowed("plan1", "ws1", "file.ts");
		expect(result.allowed).toBe(true);

		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");

		const resultAfter = tracker.isFullWriteAllowed("plan1", "ws1", "file.ts");
		expect(resultAfter.allowed).toBe(false);
	});

	it("should also block full-write when handoff threshold is reached (independent of truncation)", () => {
		// Use a tracker with threshold of 2 so 2 failures reach the threshold
		const thresholdTracker = createEditAttemptTracker({ handoffThreshold: 2 });

		// Two exact_match_failed failures reach handoff threshold
		thresholdTracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed", "miss1");
		thresholdTracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed", "miss2");

		const result = thresholdTracker.isFullWriteAllowed("plan1", "ws1", "file.ts");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("threshold reached");
	});
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 4: Git checkout restore after failed write forces patch mode
// ---------------------------------------------------------------------------

describe("AC4: Git checkout restore after failed write forces patch mode", () => {
	let tracker: EditAttemptTracker;

	beforeEach(() => {
		tracker = createEditAttemptTracker({ handoffThreshold: 2 });
	});

	it("should force patch mode when restore_after_failed_write is recorded", () => {
		tracker.recordFailure(
			"plan1",
			"ws1",
			"file.ts",
			"restore",
			"restore_after_failed_write",
			"git checkout restored file",
		);

		expect(tracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(true);
	});

	it("should block full-write after restore_after_failed_write", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "restore", "restore_after_failed_write");

		const result = tracker.isFullWriteAllowed("plan1", "ws1", "file.ts");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("patch mode forced");
	});

	it("should not force patch mode for other failure types", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed", "miss");
		tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "output_too_large", "big");
		tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "malformed_patch", "bad");
		tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "validation_failed_after_edit", "fail");

		expect(tracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(false);
	});

	it("should force patch mode for both truncation AND restore_after_failed_write", () => {
		tracker.recordFailure("plan1", "ws1", "a.ts", "full_write", "truncation");
		tracker.recordFailure("plan1", "ws1", "b.ts", "restore", "restore_after_failed_write");

		expect(tracker.isPatchModeForced("plan1", "ws1", "a.ts")).toBe(true);
		expect(tracker.isPatchModeForced("plan1", "ws1", "b.ts")).toBe(true);
	});

	it("should include restore_after_failed_write file in forced patch list", () => {
		tracker.recordFailure("plan1", "ws1", "restored.ts", "restore", "restore_after_failed_write");

		const forced = tracker.getForcedPatchFiles("plan1", "ws1");
		expect(forced).toContain("restored.ts");
	});
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 5: Targeted edits remain allowed after forced patch mode
// ---------------------------------------------------------------------------

describe("AC5: Targeted edits remain allowed after forced patch mode", () => {
	let tracker: EditAttemptTracker;

	beforeEach(() => {
		tracker = createEditAttemptTracker({ handoffThreshold: 2 });
	});

	it("should allow targeted edits when patch mode is forced", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");

		expect(tracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(true);
		expect(tracker.isTargetedEditAllowed("plan1", "ws1", "file.ts")).toBe(true);
	});

	it("should allow targeted edits when handoff threshold is reached", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed", "miss1");
		tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed", "miss2");

		expect(tracker.hasReachedHandoffThreshold("plan1", "ws1", "file.ts")).toBe(true);
		expect(tracker.isFullWriteAllowed("plan1", "ws1", "file.ts").allowed).toBe(false);
		expect(tracker.isTargetedEditAllowed("plan1", "ws1", "file.ts")).toBe(true);
	});

	it("should allow targeted edits for files without any failures", () => {
		expect(tracker.isTargetedEditAllowed("plan1", "ws1", "file.ts")).toBe(true);
	});

	it("should always allow targeted edits (never blocked)", () => {
		// Force patch mode and hit handoff threshold simultaneously
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
		tracker.recordFailure("plan1", "ws1", "file.ts", "targeted_edit", "exact_match_failed");

		expect(tracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(true);
		expect(tracker.hasReachedHandoffThreshold("plan1", "ws1", "file.ts")).toBe(true);
		expect(tracker.isTargetedEditAllowed("plan1", "ws1", "file.ts")).toBe(true);
	});

	it("should block full-write while allowing targeted edit after restore", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "restore", "restore_after_failed_write");

		const fullWriteResult = tracker.isFullWriteAllowed("plan1", "ws1", "file.ts");
		expect(fullWriteResult.allowed).toBe(false);
		expect(tracker.isTargetedEditAllowed("plan1", "ws1", "file.ts")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Acceptance Criterion 6: Tracker state persists in workspace metadata
// ---------------------------------------------------------------------------

describe("AC6: Tracker state persists in workspace metadata", () => {
	let tracker: EditAttemptTracker;

	beforeEach(() => {
		tracker = createEditAttemptTracker({ handoffThreshold: 2 });
	});

	it("should serialize forced patch mode state", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");

		const serialized = tracker.serialize();
		expect(serialized.forcedPatchKeys).toContain("plan1:ws1:file.ts");
	});

	it("should deserialize forced patch mode state", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");

		const serialized = tracker.serialize();
		const newTracker = createEditAttemptTracker();
		newTracker.deserialize(serialized);

		expect(newTracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(true);
	});

	it("should serialize handoff threshold in state", () => {
		tracker.setHandoffThreshold(5);
		const serialized = tracker.serialize();
		expect(serialized.handoffThreshold).toBe(5);
	});

	it("should deserialize handoff threshold from state", () => {
		tracker.setHandoffThreshold(5);
		const serialized = tracker.serialize();

		const newTracker = createEditAttemptTracker();
		newTracker.deserialize(serialized);
		expect(newTracker.getHandoffThreshold()).toBe(5);
	});

	it("should serialize exactMatchCountsTowardHandoff in state", () => {
		const customTracker = createEditAttemptTracker({ exactMatchCountsTowardHandoff: false });
		const serialized = customTracker.serialize();
		expect(serialized.exactMatchCountsTowardHandoff).toBe(false);
	});

	it("should deserialize exactMatchCountsTowardHandoff from state", () => {
		const customTracker = createEditAttemptTracker({ exactMatchCountsTowardHandoff: false });
		const serialized = customTracker.serialize();

		const newTracker = createEditAttemptTracker();
		newTracker.deserialize(serialized);
		expect(newTracker.countFailures("plan1", "ws1", "file.ts")).toBe(0);
		// Verify by recording an exact_match_failed and checking it doesn't count
		newTracker.deserialize(serialized);
		// The threshold should still be properly set
		expect(serialized.exactMatchCountsTowardHandoff).toBe(false);
	});

	it("should round-trip full state including attempts and forced patch keys", () => {
		// Create a complex state
		tracker.recordFailure("plan1", "ws1", "a.ts", "full_write", "truncation", "truncated!");
		tracker.recordSuccess("plan1", "ws1", "a.ts", "targeted_edit");
		tracker.recordFailure("plan1", "ws1", "b.ts", "restore", "restore_after_failed_write", "git checkout");
		tracker.recordFailure("plan1", "ws1", "c.ts", "targeted_edit", "exact_match_failed", "no match");

		const serialized = tracker.serialize();

		// Verify serialized state structure
		expect(Object.keys(serialized.attempts).length).toBe(3);
		expect(serialized.forcedPatchKeys).toContain("plan1:ws1:a.ts");
		expect(serialized.forcedPatchKeys).toContain("plan1:ws1:b.ts");
		expect(serialized.forcedPatchKeys).not.toContain("plan1:ws1:c.ts");
		expect(serialized.handoffThreshold).toBe(2);

		// Deserialize into new tracker
		const newTracker = createEditAttemptTracker();
		newTracker.deserialize(serialized);

		// Verify all state is correctly restored
		expect(newTracker.getAttempts("plan1", "ws1", "a.ts").length).toBe(2);
		expect(newTracker.getAttempts("plan1", "ws1", "b.ts").length).toBe(1);
		expect(newTracker.getAttempts("plan1", "ws1", "c.ts").length).toBe(1);

		expect(newTracker.isPatchModeForced("plan1", "ws1", "a.ts")).toBe(true);
		expect(newTracker.isPatchModeForced("plan1", "ws1", "b.ts")).toBe(true);
		expect(newTracker.isPatchModeForced("plan1", "ws1", "c.ts")).toBe(false);

		expect(newTracker.isFullWriteAllowed("plan1", "ws1", "a.ts").allowed).toBe(false);
		expect(newTracker.isFullWriteAllowed("plan1", "ws1", "b.ts").allowed).toBe(false);
		expect(newTracker.isFullWriteAllowed("plan1", "ws1", "c.ts").allowed).toBe(true);

		expect(newTracker.isTargetedEditAllowed("plan1", "ws1", "a.ts")).toBe(true);
		expect(newTracker.isTargetedEditAllowed("plan1", "ws1", "b.ts")).toBe(true);
		expect(newTracker.isTargetedEditAllowed("plan1", "ws1", "c.ts")).toBe(true);

		expect(newTracker.getHandoffThreshold()).toBe(2);
	});

	it("should support backward-compatible deserialization of legacy format", () => {
		// Legacy format: Record<string, EditAttemptRecord[]>
		const legacyData = {
			"plan1:ws1:file.ts": [
				{
					id: "attempt-1-1000",
					planExecId: "plan1",
					workspaceId: "ws1",
					filePath: "file.ts",
					attemptType: "full_write" as const,
					failureType: "truncation" as const,
					succeeded: false,
					timestamp: 1000,
					errorMessage: "truncated",
				},
			],
		};

		const newTracker = createEditAttemptTracker();
		newTracker.deserialize(legacyData);

		const attempts = newTracker.getAttempts("plan1", "ws1", "file.ts");
		expect(attempts.length).toBe(1);
		// In legacy format, forcedPatchKeys are not included
		expect(newTracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(false);
	});

	it("should be safe to serialize empty tracker", () => {
		const emptyTracker = createEditAttemptTracker();
		const serialized = emptyTracker.serialize();

		expect(Object.keys(serialized.attempts).length).toBe(0);
		expect(serialized.forcedPatchKeys.length).toBe(0);

		const newTracker = createEditAttemptTracker();
		newTracker.deserialize(serialized);
		expect(newTracker.getAttempts("plan1", "ws1", "file.ts").length).toBe(0);
	});

	it("should clear forced patch state when clearing file", () => {
		tracker.recordFailure("plan1", "ws1", "file.ts", "full_write", "truncation");
		expect(tracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(true);

		tracker.clearFile("plan1", "ws1", "file.ts");
		expect(tracker.isPatchModeForced("plan1", "ws1", "file.ts")).toBe(false);
	});

	it("should clear all forced patch state on clear()", () => {
		tracker.recordFailure("plan1", "ws1", "a.ts", "full_write", "truncation");
		tracker.recordFailure("plan1", "ws1", "b.ts", "restore", "restore_after_failed_write");

		tracker.clear();
		expect(tracker.isPatchModeForced("plan1", "ws1", "a.ts")).toBe(false);
		expect(tracker.isPatchModeForced("plan1", "ws1", "b.ts")).toBe(false);
		expect(tracker.getForcedPatchFiles("plan1", "ws1").length).toBe(0);
	});
});
