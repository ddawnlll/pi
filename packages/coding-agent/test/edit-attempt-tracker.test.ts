/**
 * Tests for Edit Attempt Tracker and Truncation Detector
 *
 * P4.5 Workstream 4.5.C: Validates edit attempt tracking, truncation detection,
 * exact-match failure detection, same-file failure counting, and handoff threshold.
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
			expect(Object.keys(serialized).length).toBeGreaterThan(0);

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
