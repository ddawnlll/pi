/**
 * Test suite for Validation Lane Backpressure (P23 W4).
 *
 * Tests:
 * - Heavy validation slot occupancy tracking
 * - Targeted-only workspaces are not deferred
 * - Heavy-validation workspaces are deferred when slot is full
 * - Workspaces are undeferred when slot becomes available
 * - Event emission
 * - Guard: scheduler waits rather than skipping when all remaining workspaces need heavy validation
 */

import { describe, expect, it } from "vitest";
import { ValidationLaneTracker, type ValidationLaneState } from "../src/core/validation-lane.js";

describe("ValidationLaneTracker", () => {
	// -----------------------------------------------------------------------
	// Initial state
	// -----------------------------------------------------------------------

	describe("initial state", () => {
		it("starts with no active validations", () => {
			const tracker = new ValidationLaneTracker();
			const state = tracker.getState();
			expect(state.currentHeavyValidations).toBe(0);
			expect(state.currentTargetedValidations).toBe(0);
			expect(state.backpressureActive).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Heavy validation tracking
	// -----------------------------------------------------------------------

	describe("heavy validation tracking", () => {
		it("tracks heavy validation count", () => {
			const tracker = new ValidationLaneTracker();
			tracker.startValidation("ws-1", "npx vitest run", false);
			tracker.startValidation("ws-2", "npx vitest run", false);

			const state = tracker.getState();
			expect(state.currentHeavyValidations).toBe(2);
			expect(state.backpressureActive).toBe(true);
		});

		it("tracks targeted validation count separately", () => {
			const tracker = new ValidationLaneTracker();
			tracker.startValidation("ws-1", "echo hello", true);

			const state = tracker.getState();
			expect(state.currentTargetedValidations).toBe(1);
			expect(state.currentHeavyValidations).toBe(0);
		});

		it("endValidation decrements heavy count", () => {
			const tracker = new ValidationLaneTracker();
			tracker.startValidation("ws-1", "npx vitest run", false);
			tracker.endValidation("npx vitest run", false);

			const state = tracker.getState();
			expect(state.currentHeavyValidations).toBe(0);
		});

		it("backpressure activates when heavy slot is full", () => {
			const tracker = new ValidationLaneTracker({
				maxConcurrentHeavyValidations: 1,
			});
			tracker.startValidation("ws-1", "npx vitest run", false);
			expect(tracker.isBackpressureActive()).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// shouldDeferWorkspace
	// -----------------------------------------------------------------------

	describe("shouldDeferWorkspace", () => {
		it("defers heavy-validation workspace when heavy slot is occupied", () => {
			const tracker = new ValidationLaneTracker({
				maxConcurrentHeavyValidations: 1,
			});

			// Occupying the heavy slot
			tracker.startValidation("ws-1", "npx vitest run", false);

			// Try to start another heavy workspace
			const deferred = tracker.shouldDeferWorkspace("ws-2", "npx vitest run", false);
			expect(deferred).toBe(true);

			const state = tracker.getState();
			expect(state.deferredWorkspaceIds).toContain("ws-2");
		});

		it("does not defer targeted-only workspace when heavy slot is occupied", () => {
			const tracker = new ValidationLaneTracker({
				maxConcurrentHeavyValidations: 1,
			});

			tracker.startValidation("ws-1", "npx vitest run", false);

			// Targeted-only workspace should NOT be deferred
			const deferred = tracker.shouldDeferWorkspace("ws-3", "echo lint", true);
			expect(deferred).toBe(false);
		});

		it("does not defer when backpressure is disabled", () => {
			const tracker = new ValidationLaneTracker({
				backpressureEnabled: false,
				maxConcurrentHeavyValidations: 1,
			});

			tracker.startValidation("ws-1", "npx vitest run", false);

			const deferred = tracker.shouldDeferWorkspace("ws-2", "npx vitest run", false);
			expect(deferred).toBe(false);
		});

		it("does not defer when heavy slot is available", () => {
			const tracker = new ValidationLaneTracker({
				maxConcurrentHeavyValidations: 2,
			});

			tracker.startValidation("ws-1", "npx vitest run", false);

			// There's still room in the heavy slot
			const deferred = tracker.shouldDeferWorkspace("ws-2", "npx vitest run", false);
			expect(deferred).toBe(false);
		});

		it("removes deferred workspaces when heavy slot opens up", () => {
			const tracker = new ValidationLaneTracker({
				maxConcurrentHeavyValidations: 1,
			});

			tracker.startValidation("ws-1", "npx vitest run", false);
			tracker.shouldDeferWorkspace("ws-2", "npx vitest run", false);
			expect(tracker.getState().deferredWorkspaceIds).toContain("ws-2");

			// End the heavy validation — opens the slot
			tracker.endValidation("npx vitest run", false);

			// Deferred list should be cleared
			expect(tracker.getState().deferredWorkspaceIds).not.toContain("ws-2");
		});

		it("emits backpressure event when deferring", () => {
			const tracker = new ValidationLaneTracker({
				maxConcurrentHeavyValidations: 1,
			});

			let emittedEvent: string | null = null;
			tracker.setEventCallback((event) => { emittedEvent = event; });

			tracker.startValidation("ws-1", "npx vitest run", false);
			tracker.shouldDeferWorkspace("ws-2", "npx vitest run", false);

			expect(emittedEvent).toBe("validation_lane_backpressure_active");
		});
	});

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	describe("configuration", () => {
		it("accepts custom max concurrent limits", () => {
			const tracker = new ValidationLaneTracker({
				maxConcurrentHeavyValidations: 2,
				maxConcurrentTargetedValidations: 5,
			});

			const state = tracker.getState();
			expect(state.maxConcurrentHeavyValidations).toBe(2);
			expect(state.maxConcurrentTargetedValidations).toBe(5);
		});
	});
});
