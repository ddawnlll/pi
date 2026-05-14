/**
 * Tests for Unsafe Suggestion Guard - P8.D
 */

import { describe, expect, it } from "vitest";
import type { DetectionResult } from "../src/core/detection-types.js";
import { generateDetectionId } from "../src/core/detection-types.js";
import { UnsafeSuggestionGuard } from "../src/core/unsafe-suggestion-guard.js";

function createTestDetection(overrides?: Partial<DetectionResult>): DetectionResult {
	return {
		id: generateDetectionId(),
		category: "bug_candidate",
		title: "Test detection",
		description: "A test detection",
		risk: "medium",
		confidence: "medium",
		evidence: [],
		requiresApproval: true,
		isUnsafe: false,
		detectedAt: Date.now(),
		source: "test",
		...overrides,
	};
}

describe("UnsafeSuggestionGuard", () => {
	const guard = new UnsafeSuggestionGuard();

	describe("check", () => {
		it("should return safe for normal detections", () => {
			const detection = createTestDetection();
			const result = guard.check(detection);

			expect(result.isUnsafe).toBe(false);
			expect(result.blocked).toBe(false);
			expect(result.reasons).toHaveLength(0);
		});

		it("should flag suggestions modifying protected systems", () => {
			const detection = createTestDetection({
				title: "Modify the planner to improve performance",
			});
			const result = guard.check(detection);

			expect(result.isUnsafe).toBe(true);
			expect(result.blocked).toBe(true);
			expect(result.reasons).toContain("modifies_protected_system");
		});

		it("should flag destructive operations", () => {
			const detection = createTestDetection({
				title: "Delete all log files to save space",
			});
			const result = guard.check(detection);

			expect(result.isUnsafe).toBe(true);
			expect(result.blocked).toBe(true);
			expect(result.reasons).toContain("destructive_operation");
		});

		it("should flag bypassing approval", () => {
			const detection = createTestDetection({
				title: "Skip approval gate for faster execution",
			});
			const result = guard.check(detection);

			expect(result.isUnsafe).toBe(true);
			expect(result.blocked).toBe(true);
			expect(result.reasons).toContain("bypasses_approval");
		});

		it("should flag modifying executor state", () => {
			const detection = createTestDetection({
				title: "Directly mutate execution state to mark complete",
			});
			const result = guard.check(detection);

			expect(result.isUnsafe).toBe(true);
			expect(result.blocked).toBe(true);
			expect(result.reasons).toContain("modifies_executor_state");
		});

		it("should flag modifying queue with enhanced approval", () => {
			const detection = createTestDetection({
				title: "Reorder the queue for priority tasks",
			});
			const result = guard.check(detection);

			expect(result.isUnsafe).toBe(true);
			expect(result.blocked).toBe(false); // Queue modifications require enhanced approval but aren't blocked
			expect(result.requiresEnhancedApproval).toBe(true);
		});

		it("should flag security config modifications as blocked", () => {
			const detection = createTestDetection({
				title: "Disable access control checks",
			});
			const result = guard.check(detection);

			expect(result.isUnsafe).toBe(true);
			expect(result.blocked).toBe(true);
			expect(result.reasons).toContain("modifies_security_config");
		});

		it("should flag credential exposure as blocked", () => {
			const detection = createTestDetection({
				title: "Share api_key in logs for debugging",
			});
			const result = guard.check(detection);

			expect(result.isUnsafe).toBe(true);
			expect(result.blocked).toBe(true);
			expect(result.reasons).toContain("modifies_auth_config");
		});

		it("should flag security concerns category as needing enhanced approval", () => {
			const detection = createTestDetection({
				category: "security_concern",
				title: "Potential XSS vulnerability in input handling",
			});
			const result = guard.check(detection);

			expect(result.isUnsafe).toBe(false);
			expect(result.requiresEnhancedApproval).toBe(true);
		});

		it("should detect protected system paths", () => {
			const detection = createTestDetection({
				title: "Refactor agent session code",
				affectedPaths: ["packages/coding-agent/src/core/planner.ts"],
			});
			const result = guard.check(detection);

			expect(result.isUnsafe).toBe(true);
			expect(result.blocked).toBe(true);
			expect(result.reasons).toContain("modifies_protected_system");
		});
	});

	describe("assertSafe", () => {
		it("should throw for blocked suggestions", () => {
			const detection = createTestDetection({
				title: "Disable approval gate",
			});

			expect(() => guard.assertSafe(detection)).toThrow("Unsafe suggestion blocked");
		});

		it("should return check result for safe suggestions", () => {
			const detection = createTestDetection();
			const result = guard.assertSafe(detection);

			expect(result.isUnsafe).toBe(false);
		});
	});

	describe("filter", () => {
		it("should separate safe and unsafe detections", () => {
			const safe = createTestDetection();
			const unsafe1 = createTestDetection({
				title: "Delete all logs",
				id: generateDetectionId(),
			});
			const unsafe2 = createTestDetection({
				title: "Modify executor state directly",
				id: generateDetectionId(),
			});

			const { safe: safeResults, unsafe: unsafeResults, blocked } = guard.filter([safe, unsafe1, unsafe2]);

			expect(safeResults).toHaveLength(1);
			expect(unsafeResults).toHaveLength(2);
			expect(blocked).toHaveLength(2);
		});
	});

	describe("addCustomPattern", () => {
		it("should detect custom unsafe patterns", () => {
			const customGuard = new UnsafeSuggestionGuard();
			customGuard.addCustomPattern({
				reason: "exceeds_scope",
				pattern: /specific_dangerous_pattern/i,
				blocked: true,
				requiresEnhancedApproval: true,
				explanation: "This pattern is explicitly blocked.",
			});

			const detection = createTestDetection({
				title: "Found specific_dangerous_pattern in code",
			});
			const result = customGuard.check(detection);

			expect(result.isUnsafe).toBe(true);
			expect(result.blocked).toBe(true);
			expect(result.reasons).toContain("exceeds_scope");
		});
	});
});
