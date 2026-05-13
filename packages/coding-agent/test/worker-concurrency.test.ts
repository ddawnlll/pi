/**
 * Tests for Worker Concurrency Settings & Experimental 6-Worker Mode
 *
 * Acceptance Criteria:
 * 1. Stable worker setting supports 1-3
 * 2. Experimental 4-6 workers disabled by default
 * 3. Explicit confirmation required to enable experimental mode
 * 4. Doctor warns when experimental mode is enabled
 * 5. Experimental mode requires archive enabled and stop-on-failure enabled
 * 6. Stable default remains 3 workers
 */

import { describe, expect, it } from "vitest";
import { createSafetyDoctor, SafetyIssueType } from "../src/core/safety-doctor.js";
import {
	DEFAULT_WORKERS,
	isExperimentalWorkerCount,
	isStableWorkerCount,
	MAX_EXPERIMENTAL_WORKERS,
	MAX_STABLE_WORKERS,
	MIN_STABLE_WORKERS,
	requiresExperimentalMode,
	resolveEffectiveWorkerCount,
	validateWorkerConcurrency,
	type WorkerConcurrencySettings,
} from "../src/core/worker-concurrency.js";
import { WorkspaceScheduler } from "../src/core/workspace-scheduler.js";

describe("Worker Concurrency Settings", () => {
	// AC6: Stable default remains 3 workers
	describe("AC6: stable default remains 3 workers", () => {
		it("should default to 3 workers", () => {
			expect(DEFAULT_WORKERS).toBe(3);
		});

		it("should resolve default worker count when no settings provided", () => {
			expect(resolveEffectiveWorkerCount({})).toBe(3);
		});

		it("should resolve default worker count when all undefined", () => {
			expect(resolveEffectiveWorkerCount({ maxWorkers: undefined, experimentalModeEnabled: undefined })).toBe(3);
		});
	});

	// AC1: Stable worker setting supports 1-3
	describe("AC1: stable worker setting supports 1-3", () => {
		it("should accept 1 worker (minimum)", () => {
			const result = validateWorkerConcurrency({ maxWorkers: 1 });
			expect(result.valid).toBe(true);
			expect(result.effectiveWorkers).toBe(1);
			expect(result.isExperimental).toBe(false);
		});

		it("should accept 2 workers", () => {
			const result = validateWorkerConcurrency({ maxWorkers: 2 });
			expect(result.valid).toBe(true);
			expect(result.effectiveWorkers).toBe(2);
			expect(result.isExperimental).toBe(false);
		});

		it("should accept 3 workers (max stable)", () => {
			const result = validateWorkerConcurrency({ maxWorkers: 3 });
			expect(result.valid).toBe(true);
			expect(result.effectiveWorkers).toBe(3);
			expect(result.isExperimental).toBe(false);
		});

		it("should identify stable worker counts correctly", () => {
			expect(isStableWorkerCount(1)).toBe(true);
			expect(isStableWorkerCount(2)).toBe(true);
			expect(isStableWorkerCount(3)).toBe(true);
			expect(isStableWorkerCount(4)).toBe(false);
			expect(isStableWorkerCount(0)).toBe(false);
		});

		it("MIN_STABLE_WORKERS should be 1", () => {
			expect(MIN_STABLE_WORKERS).toBe(1);
		});

		it("MAX_STABLE_WORKERS should be 3", () => {
			expect(MAX_STABLE_WORKERS).toBe(3);
		});
	});

	// AC2: Experimental 4-6 workers disabled by default
	describe("AC2: experimental 4-6 workers disabled by default", () => {
		it("should reject 4 workers without experimental mode enabled", () => {
			const result = validateWorkerConcurrency({ maxWorkers: 4, experimentalModeEnabled: false });
			expect(result.valid).toBe(false);
			expect(result.effectiveWorkers).toBe(3); // falls back to stable max
			expect(result.isExperimental).toBe(false);
		});

		it("should reject 5 workers without experimental mode enabled", () => {
			const result = validateWorkerConcurrency({ maxWorkers: 5, experimentalModeEnabled: false });
			expect(result.valid).toBe(false);
			expect(result.effectiveWorkers).toBe(3);
		});

		it("should reject 6 workers without experimental mode enabled", () => {
			const result = validateWorkerConcurrency({ maxWorkers: 6, experimentalModeEnabled: false });
			expect(result.valid).toBe(false);
			expect(result.effectiveWorkers).toBe(3);
		});

		it("should reject 4 workers with experimental mode undefined (default)", () => {
			const result = validateWorkerConcurrency({ maxWorkers: 4 });
			expect(result.valid).toBe(false);
		});

		it("should identify experimental worker counts correctly", () => {
			expect(isExperimentalWorkerCount(4)).toBe(true);
			expect(isExperimentalWorkerCount(5)).toBe(true);
			expect(isExperimentalWorkerCount(6)).toBe(true);
			expect(isExperimentalWorkerCount(3)).toBe(false);
			expect(isExperimentalWorkerCount(7)).toBe(false);
		});

		it("MAX_EXPERIMENTAL_WORKERS should be 6", () => {
			expect(MAX_EXPERIMENTAL_WORKERS).toBe(6);
		});
	});

	// AC3: Explicit confirmation required to enable experimental mode
	describe("AC3: explicit confirmation required to enable experimental mode", () => {
		it("should require experimentalModeEnabled=true for worker count > 3", () => {
			expect(requiresExperimentalMode(4)).toBe(true);
			expect(requiresExperimentalMode(5)).toBe(true);
			expect(requiresExperimentalMode(6)).toBe(true);
			expect(requiresExperimentalMode(3)).toBe(false);
			expect(requiresExperimentalMode(2)).toBe(false);
			expect(requiresExperimentalMode(1)).toBe(false);
		});

		it("should not enable experimental mode by default", () => {
			const settings: WorkerConcurrencySettings = {};
			expect(settings.experimentalModeEnabled).toBeUndefined();
		});

		it("should accept 4 workers when experimental mode is explicitly enabled with prerequisites", () => {
			const result = validateWorkerConcurrency(
				{ maxWorkers: 4, experimentalModeEnabled: true },
				{ archiveEnabled: true, stopOnFailureEnabled: true },
			);
			expect(result.valid).toBe(true);
			expect(result.effectiveWorkers).toBe(4);
			expect(result.isExperimental).toBe(true);
		});

		it("should accept 6 workers when experimental mode is explicitly enabled with prerequisites", () => {
			const result = validateWorkerConcurrency(
				{ maxWorkers: 6, experimentalModeEnabled: true },
				{ archiveEnabled: true, stopOnFailureEnabled: true },
			);
			expect(result.valid).toBe(true);
			expect(result.effectiveWorkers).toBe(6);
			expect(result.isExperimental).toBe(true);
		});
	});

	// AC5: Experimental mode requires archive enabled and stop-on-failure enabled
	describe("AC5: experimental mode requires archive and stop-on-failure", () => {
		it("should reject experimental mode when archive is not enabled", () => {
			const result = validateWorkerConcurrency(
				{ maxWorkers: 4, experimentalModeEnabled: true },
				{ archiveEnabled: false, stopOnFailureEnabled: true },
			);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("archive"))).toBe(true);
		});

		it("should reject experimental mode when stop-on-failure is not enabled", () => {
			const result = validateWorkerConcurrency(
				{ maxWorkers: 4, experimentalModeEnabled: true },
				{ archiveEnabled: true, stopOnFailureEnabled: false },
			);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("stop-on-failure"))).toBe(true);
		});

		it("should reject experimental mode when both archive and stop-on-failure are not enabled", () => {
			const result = validateWorkerConcurrency(
				{ maxWorkers: 5, experimentalModeEnabled: true },
				{ archiveEnabled: false, stopOnFailureEnabled: false },
			);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("archive"))).toBe(true);
			expect(result.errors.some((e) => e.includes("stop-on-failure"))).toBe(true);
		});

		it("should accept experimental mode when both archive and stop-on-failure are enabled", () => {
			const result = validateWorkerConcurrency(
				{ maxWorkers: 5, experimentalModeEnabled: true },
				{ archiveEnabled: true, stopOnFailureEnabled: true },
			);
			expect(result.valid).toBe(true);
		});
	});

	// AC4: Doctor warns when experimental mode is enabled
	describe("AC4: doctor warns when experimental mode is enabled", () => {
		it("should produce a warning when experimental mode is enabled", () => {
			const doctor = createSafetyDoctor(4, {
				maxWorkers: 4,
				experimentalModeEnabled: true,
			});

			const issues = doctor.detectExperimentalWorkerIssues({
				maxWorkers: 4,
				experimentalModeEnabled: true,
			});

			expect(issues.length).toBeGreaterThan(0);
			expect(issues.some((i) => i.type === SafetyIssueType.ExperimentalWorkers)).toBe(true);
		});

		it("should produce a warning in the safety report when experimental mode is enabled", () => {
			const doctor = createSafetyDoctor(4, {
				maxWorkers: 4,
				experimentalModeEnabled: true,
			});

			const queue = {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 4,
				workspaces: [
					{
						id: "1A",
						title: "Task A",
						dependencies: [] as string[],
						roleBudget: "worker" as const,
						maxRetries: 3,
					},
				],
			};

			const report = doctor.validateQueue(queue);
			expect(report.warnings.some((w) => w.type === SafetyIssueType.ExperimentalWorkers)).toBe(true);
		});

		it("should not produce experimental warnings when using stable worker count", () => {
			const doctor = createSafetyDoctor(3);

			const issues = doctor.detectExperimentalWorkerIssues({
				maxWorkers: 3,
				experimentalModeEnabled: false,
			});

			expect(issues.some((i) => i.type === SafetyIssueType.ExperimentalWorkers)).toBe(false);
		});
	});

	describe("edge cases", () => {
		it("should clamp worker count below minimum", () => {
			const result = validateWorkerConcurrency({ maxWorkers: 0 });
			expect(result.effectiveWorkers).toBe(1);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it("should clamp worker count below minimum (negative)", () => {
			const result = validateWorkerConcurrency({ maxWorkers: -1 });
			expect(result.effectiveWorkers).toBe(1);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it("should clamp worker count above maximum", () => {
			const result = validateWorkerConcurrency(
				{ maxWorkers: 10, experimentalModeEnabled: true },
				{ archiveEnabled: true, stopOnFailureEnabled: true },
			);
			expect(result.effectiveWorkers).toBe(6);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it("should warn when experimental mode is enabled but worker count is in stable range", () => {
			const result = validateWorkerConcurrency({ maxWorkers: 2, experimentalModeEnabled: true });
			expect(result.warnings.some((w) => w.includes("Experimental mode is enabled"))).toBe(true);
			expect(result.valid).toBe(true);
		});

		it("should produce warning about less tested mode when experimental enabled", () => {
			const result = validateWorkerConcurrency(
				{ maxWorkers: 5, experimentalModeEnabled: true },
				{ archiveEnabled: true, stopOnFailureEnabled: true },
			);
			expect(result.warnings.some((w) => w.includes("less tested"))).toBe(true);
		});
	});

	describe("WorkspaceScheduler integration", () => {
		it("should create scheduler with default 3 workers", () => {
			const scheduler = new WorkspaceScheduler();
			const stats = scheduler.getStatistics({
				workspaces: new Map(),
				phase: "P2",
				title: "Test",
				status: "running",
				startedAt: Date.now(),
			});
			expect(stats.availableSlots).toBe(3);
		});

		it("should create scheduler with experimental 6 workers", () => {
			const scheduler = new WorkspaceScheduler(6);
			const stats = scheduler.getStatistics({
				workspaces: new Map(),
				phase: "P2",
				title: "Test",
				status: "running",
				startedAt: Date.now(),
			});
			expect(stats.availableSlots).toBe(6);
		});

		it("should clamp scheduler worker count to valid range", () => {
			const scheduler = new WorkspaceScheduler(0);
			const stats = scheduler.getStatistics({
				workspaces: new Map(),
				phase: "P2",
				title: "Test",
				status: "running",
				startedAt: Date.now(),
			});
			expect(stats.availableSlots).toBe(1); // clamped to MIN_STABLE_WORKERS
		});

		it("should clamp scheduler worker count above maximum", () => {
			const scheduler = new WorkspaceScheduler(100);
			const stats = scheduler.getStatistics({
				workspaces: new Map(),
				phase: "P2",
				title: "Test",
				status: "running",
				startedAt: Date.now(),
			});
			expect(stats.availableSlots).toBe(6); // clamped to MAX_EXPERIMENTAL_WORKERS
		});
	});
});
