/**
 * Tests for False-Positive Tracker - P8.D
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DetectionResult } from "../src/core/detection-types.js";
import { generateDetectionId } from "../src/core/detection-types.js";
import { FalsePositiveTracker } from "../src/core/false-positive-tracker.js";

const TEST_DIR = path.join(process.cwd(), ".test-false-positive-tracker");

function createTestDetection(overrides?: Partial<DetectionResult>): DetectionResult {
	return {
		id: generateDetectionId(),
		category: "bug_candidate",
		title: "Test detection",
		description: "A test detection for testing",
		risk: "medium",
		confidence: "medium",
		evidence: [
			{
				type: "metric",
				description: "Test metric",
				data: "test data",
				capturedAt: Date.now(),
			},
		],
		requiresApproval: true,
		isUnsafe: false,
		detectedAt: Date.now(),
		source: "test",
		...overrides,
	};
}

describe("FalsePositiveTracker", () => {
	let tracker: FalsePositiveTracker;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
		tracker = new FalsePositiveTracker({ storageDir: TEST_DIR });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("should initialize without errors", async () => {
		await tracker.initialize();
		expect(tracker.getRecords()).toHaveLength(0);
	});

	it("should record a false positive", async () => {
		const detection = createTestDetection();
		const record = await tracker.recordFalsePositive(detection, {
			identifiedAt: Date.now(),
			identifiedBy: "test-user",
			reason: "Was actually correct behavior",
			suppressFuture: true,
		});

		expect(record.detectionId).toBe(detection.id);
		expect(record.suppressed).toBe(true);
		expect(record.falsePositiveInfo.reason).toBe("Was actually correct behavior");
	});

	it("should detect a known false positive by content hash", async () => {
		const detection = createTestDetection();
		await tracker.recordFalsePositive(detection, {
			identifiedAt: Date.now(),
			identifiedBy: "test-user",
			reason: "Incorrect detection",
			suppressFuture: true,
		});

		// Create another detection with same content (will have different ID but same hash)
		const duplicate = createTestDetection({
			id: generateDetectionId(), // Different ID
			title: "Test detection", // Same title
			description: "A test detection for testing", // Same description
		});

		const fpInfo = await tracker.isKnownFalsePositive(duplicate);
		expect(fpInfo).toBeDefined();
		expect(fpInfo!.reason).toBe("Incorrect detection");
	});

	it("should not detect a non-matching detection as false positive", async () => {
		const detection = createTestDetection();
		await tracker.recordFalsePositive(detection, {
			identifiedAt: Date.now(),
			identifiedBy: "test-user",
			reason: "Incorrect",
			suppressFuture: true,
		});

		const different = createTestDetection({
			id: generateDetectionId(),
			title: "Different detection",
			description: "A completely different description",
		});

		const fpInfo = await tracker.isKnownFalsePositive(different);
		expect(fpInfo).toBeUndefined();
	});

	it("should add and use suppression patterns", async () => {
		await tracker.initialize();

		await tracker.addSuppression({
			category: "bug_candidate",
			pattern: "test detection",
			reason: "Suppressing test detections",
			active: true,
		});

		const detection = createTestDetection();
		const fpInfo = await tracker.isKnownFalsePositive(detection);
		expect(fpInfo).toBeDefined();
		expect(fpInfo!.reason).toBe("Suppressing test detections");
	});

	it("should compute false-positive summary", async () => {
		await tracker.initialize();

		const d1 = createTestDetection({ title: "FP detection", isFalsePositive: true });
		const d2 = createTestDetection({ title: "Valid detection", isFalsePositive: false });
		const d3 = createTestDetection({ title: "Another valid", isFalsePositive: false });

		const summary = await tracker.computeSummary([d1, d2, d3]);

		expect(summary.totalDetections).toBe(3);
		expect(summary.falsePositiveCount).toBe(1);
		expect(summary.falsePositiveRate).toBeCloseTo(1 / 3);
	});

	it("should remove suppression patterns", async () => {
		await tracker.initialize();
		const sup = await tracker.addSuppression({
			category: "*",
			pattern: ".*",
			reason: "Test",
			active: true,
		});

		expect(tracker.getSuppressions()).toHaveLength(1);

		const removed = await tracker.removeSuppression(sup.id);
		expect(removed).toBe(true);
		expect(tracker.getSuppressions()).toHaveLength(0);
	});

	it("should reset all records", async () => {
		const detection = createTestDetection();
		await tracker.recordFalsePositive(detection, {
			identifiedAt: Date.now(),
			identifiedBy: "test",
			reason: "Test",
			suppressFuture: false,
		});

		expect(tracker.getRecords()).toHaveLength(1);

		await tracker.reset();
		expect(tracker.getRecords()).toHaveLength(0);
	});
});
