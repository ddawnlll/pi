/**
 * P26.I — Validation lane backpressure and scheduler feedback
 *
 * Tests:
 * - Heavy validation lane permits max 1 concurrent by default
 * - Targeted validation lane permits max 3 concurrent by default
 * - Scheduler defers heavy-validation workspaces when heavy lane saturated
 * - Doctor/dashboard can explain validation_lane_saturated_blocking_scheduler
 */

import { describe, expect, it } from "vitest";
import { createSafetyDoctor, SafetyIssueSeverity, SafetyIssueType } from "../src/core/safety-doctor.js";
import { DEFAULT_VALIDATION_LANE_CONFIG, ValidationLaneTracker } from "../src/core/validation-lane.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P26.I — Validation lane backpressure", () => {
	// ---- Default configuration ----

	it("should default to max 1 concurrent heavy validation", () => {
		expect(DEFAULT_VALIDATION_LANE_CONFIG.maxConcurrentHeavyValidations).toBe(1);
	});

	it("should default to max 3 concurrent targeted validations", () => {
		expect(DEFAULT_VALIDATION_LANE_CONFIG.maxConcurrentTargetedValidations).toBe(3);
	});

	it("should have backpressure enabled by default", () => {
		expect(DEFAULT_VALIDATION_LANE_CONFIG.backpressureEnabled).toBe(true);
	});

	it("should have scheduler feedback enabled by default", () => {
		expect(DEFAULT_VALIDATION_LANE_CONFIG.schedulerFeedbackEnabled).toBe(true);
	});

	// ---- Lane tracking ----

	it("should start with zero heavy and targeted validations", () => {
		const tracker = new ValidationLaneTracker();
		const state = tracker.getState();
		expect(state.currentHeavyValidations).toBe(0);
		expect(state.currentTargetedValidations).toBe(0);
	});

	it("should increment heavy count on startValidation for heavy command", () => {
		const tracker = new ValidationLaneTracker();
		tracker.startValidation("ws-1", "npm run check", false);
		const state = tracker.getState();
		expect(state.currentHeavyValidations).toBe(1);
		expect(state.currentTargetedValidations).toBe(0);
	});

	it("should increment targeted count on startValidation for targeted command", () => {
		const tracker = new ValidationLaneTracker();
		tracker.startValidation("ws-1", "echo hello", false);
		const state = tracker.getState();
		expect(state.currentHeavyValidations).toBe(0);
		expect(state.currentTargetedValidations).toBe(1);
	});

	it("should decrement counts on endValidation", () => {
		const tracker = new ValidationLaneTracker();
		tracker.startValidation("ws-1", "npm run check", false);
		tracker.endValidation("npm run check", false);
		const state = tracker.getState();
		expect(state.currentHeavyValidations).toBe(0);
	});

	it("should not increment heavy count for canRunTargetedOnly workspaces", () => {
		const tracker = new ValidationLaneTracker();
		tracker.startValidation("ws-1", "npm run check", true);
		// canRunTargetedOnly=true means even heavy commands count as targeted
		const state = tracker.getState();
		expect(state.currentHeavyValidations).toBe(0);
		expect(state.currentTargetedValidations).toBe(1);
	});

	// ---- Backpressure ----

	it("should not be active when heavy count is below max", () => {
		const tracker = new ValidationLaneTracker();
		expect(tracker.isBackpressureActive()).toBe(false);
	});

	it("should be active when heavy count reaches max", () => {
		const tracker = new ValidationLaneTracker();
		tracker.startValidation("ws-1", "npm run check", false);
		// Max is 1, so 1 heavy validation saturates the lane
		expect(tracker.isBackpressureActive()).toBe(true);
	});

	it("should not defer targeted-only workspaces under backpressure", () => {
		const tracker = new ValidationLaneTracker();
		tracker.startValidation("ws-1", "npm run check", false); // saturate heavy lane

		const defer = tracker.shouldDeferWorkspace("ws-2", "echo hello", true);
		expect(defer).toBe(false); // targeted-only workspaces never defer
	});

	it("should defer heavy workspaces when lane is saturated", () => {
		const tracker = new ValidationLaneTracker();
		tracker.startValidation("ws-1", "npm run check", false); // saturate heavy lane

		const defer = tracker.shouldDeferWorkspace("ws-2", "npm run check", false);
		expect(defer).toBe(true); // heavy workspace should be deferred
	});

	it("should not defer when backpressure is disabled", () => {
		const tracker = new ValidationLaneTracker({ backpressureEnabled: false });
		tracker.startValidation("ws-1", "npm run check", false); // saturate heavy lane

		const defer = tracker.shouldDeferWorkspace("ws-2", "npm run check", false);
		expect(defer).toBe(false); // backpressure disabled, no deferral
	});

	it("should track deferred workspaces", () => {
		const tracker = new ValidationLaneTracker();
		tracker.startValidation("ws-1", "npm run check", false); // saturate heavy lane

		tracker.shouldDeferWorkspace("ws-2", "npm run check", false);
		const state = tracker.getState();

		expect(state.deferredWorkspaceIds).toContain("ws-2");
		expect(state.deferredReasons.get("ws-2")).toContain("Heavy validation slot saturated");
	});

	it("should clear deferred workspaces when backpressure resolves", () => {
		const tracker = new ValidationLaneTracker();
		tracker.startValidation("ws-1", "npm run check", false); // saturate heavy lane

		tracker.shouldDeferWorkspace("ws-2", "npm run check", false);
		expect(tracker.getState().deferredWorkspaceIds.length).toBe(1);

		// End the heavy validation to release the lane
		tracker.endValidation("npm run check", false);
		expect(tracker.getState().deferredWorkspaceIds.length).toBe(0);
	});

	// ---- Safety doctor integration ----

	it("should detect validation lane saturation via SafetyDoctor", () => {
		const doctor = createSafetyDoctor();
		const issues = doctor.detectValidationLaneIssues({
			heavyCount: 1,
			maxHeavy: 1,
			targetedCount: 0,
			maxTargeted: 3,
		});

		expect(issues.length).toBe(1);
		expect(issues[0].type).toBe(SafetyIssueType.ValidationLaneSaturated);
		expect(issues[0].severity).toBe(SafetyIssueSeverity.Warning);
		expect(issues[0].message).toContain("validation_lane_saturated_blocking_scheduler");
	});

	it("should not detect saturation when lane is not saturated", () => {
		const doctor = createSafetyDoctor();
		const issues = doctor.detectValidationLaneIssues({
			heavyCount: 0,
			maxHeavy: 1,
			targetedCount: 1,
			maxTargeted: 3,
		});

		expect(issues.length).toBe(0);
	});

	it("should include the lane state context in the issue", () => {
		const doctor = createSafetyDoctor();
		const issues = doctor.detectValidationLaneIssues({
			heavyCount: 1,
			maxHeavy: 1,
			targetedCount: 2,
			maxTargeted: 3,
		});

		expect(issues[0].context).toEqual({
			heavyCount: 1,
			maxHeavy: 1,
			targetedCount: 2,
			maxTargeted: 3,
		});
	});

	// ---- reset ----

	it("should reset all counts and deferred workspaces", () => {
		const tracker = new ValidationLaneTracker();
		tracker.startValidation("ws-1", "npm run check", false);
		tracker.shouldDeferWorkspace("ws-2", "npm run check", false);

		tracker.reset();
		const state = tracker.getState();
		expect(state.currentHeavyValidations).toBe(0);
		expect(state.currentTargetedValidations).toBe(0);
		expect(state.deferredWorkspaceIds.length).toBe(0);
	});
});
