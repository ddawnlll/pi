/**
 * Tests for Scale Mode Policy - Workspace 6.F
 *
 * Acceptance Criteria:
 * 1. 6 workers cannot be enabled without worktree isolation
 * 2. 6 workers cannot be enabled without integration queue
 * 3. 6 workers cannot be enabled without global validation lock
 * 4. Doctor reports readiness for scale mode
 * 5. Dashboard shows current scale mode and prerequisite status
 * 6. Stable default remains 3 workers
 */

import { describe, expect, it } from "vitest";
import { checkScaleReadiness } from "../src/doctor/scale-readiness-doctor.js";
import {
	checkIntegrationQueuePrerequisite,
	checkScaleModeReadiness,
	checkValidationLockPrerequisite,
	checkWorktreeIsolationPrerequisite,
	DEFAULT_WORKERS,
	formatScaleModeReadiness,
	getScaleModeType,
	isScaleModeWorkerCount,
	PREREQ_INTEGRATION_QUEUE,
	PREREQ_VALIDATION_LOCK,
	PREREQ_WORKTREE_ISOLATION,
	requiresScaleMode,
	SCALE_MODE_MAX_WORKERS,
	SCALE_MODE_MIN_WORKERS,
	type ScaleModeConfig,
	STABLE_MAX_WORKERS,
} from "../src/scheduler/scale-mode-policy.js";

// ---------------------------------------------------------------------------
// AC6: Stable default remains 3 workers
// ---------------------------------------------------------------------------

describe("AC6: stable default remains 3 workers", () => {
	it("should have default workers set to 3", () => {
		expect(DEFAULT_WORKERS).toBe(3);
	});

	it("should have stable max workers set to 3", () => {
		expect(STABLE_MAX_WORKERS).toBe(3);
	});

	it("should not require scale mode for 3 workers", () => {
		expect(requiresScaleMode(3)).toBe(false);
	});

	it("should identify 3 as a stable worker count", () => {
		expect(isScaleModeWorkerCount(3)).toBe(false);
	});

	it("should report stable mode when no scale mode config is provided", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: false,
			integrationQueueEnabled: false,
			validationLockEnabled: false,
			requestedWorkers: 3,
			experimentalModeEnabled: false,
		});
		expect(result.currentMode).toBe("stable");
		expect(result.isScaleModeActive).toBe(false);
		expect(result.ready).toBe(true);
	});

	it("should report stable mode with 3 workers even when experimental flag is on", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 3,
			experimentalModeEnabled: true,
		});
		expect(result.currentMode).toBe("stable");
		expect(result.isScaleModeActive).toBe(false);
		expect(result.ready).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC1: 6 workers cannot be enabled without worktree isolation
// ---------------------------------------------------------------------------

describe("AC1: 6 workers cannot be enabled without worktree isolation", () => {
	it("should block scale mode when worktree isolation is disabled", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: false,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.errors.some((e) => e.includes("Worktree Isolation"))).toBe(true);
	});

	it("should check worktree isolation prerequisite returns not met when disabled", () => {
		const status = checkWorktreeIsolationPrerequisite(false);
		expect(status.key).toBe(PREREQ_WORKTREE_ISOLATION);
		expect(status.met).toBe(false);
	});

	it("should check worktree isolation prerequisite returns met when enabled", () => {
		const status = checkWorktreeIsolationPrerequisite(true);
		expect(status.key).toBe(PREREQ_WORKTREE_ISOLATION);
		expect(status.met).toBe(true);
	});

	it("should pass scale mode with all prerequisites including worktree isolation", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should reject scale mode with only worktree isolation missing", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: false,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 5,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors.some((e) => e.includes("Worktree Isolation"))).toBe(true);
	});

	it("should reject scale mode for 4 workers without worktree isolation", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: false,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 4,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.errors.some((e) => e.includes("Worktree Isolation"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC2: 6 workers cannot be enabled without integration queue
// ---------------------------------------------------------------------------

describe("AC2: 6 workers cannot be enabled without integration queue", () => {
	it("should block scale mode when integration queue is disabled", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: false,
			validationLockEnabled: true,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.errors.some((e) => e.includes("Integration Queue"))).toBe(true);
	});

	it("should check integration queue prerequisite returns not met when disabled", () => {
		const status = checkIntegrationQueuePrerequisite(false);
		expect(status.key).toBe(PREREQ_INTEGRATION_QUEUE);
		expect(status.met).toBe(false);
	});

	it("should check integration queue prerequisite returns met when enabled", () => {
		const status = checkIntegrationQueuePrerequisite(true);
		expect(status.key).toBe(PREREQ_INTEGRATION_QUEUE);
		expect(status.met).toBe(true);
	});

	it("should reject scale mode with only integration queue missing", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: false,
			validationLockEnabled: true,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors.some((e) => e.includes("Integration Queue"))).toBe(true);
	});

	it("should reject scale mode for 4 workers without integration queue", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: false,
			validationLockEnabled: true,
			requestedWorkers: 4,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.errors.some((e) => e.includes("Integration Queue"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC3: 6 workers cannot be enabled without global validation lock
// ---------------------------------------------------------------------------

describe("AC3: 6 workers cannot be enabled without global validation lock", () => {
	it("should block scale mode when validation lock is disabled", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: false,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.errors.some((e) => e.includes("Validation Lock"))).toBe(true);
	});

	it("should check validation lock prerequisite returns not met when disabled", () => {
		const status = checkValidationLockPrerequisite(false);
		expect(status.key).toBe(PREREQ_VALIDATION_LOCK);
		expect(status.met).toBe(false);
	});

	it("should check validation lock prerequisite returns met when enabled", () => {
		const status = checkValidationLockPrerequisite(true);
		expect(status.key).toBe(PREREQ_VALIDATION_LOCK);
		expect(status.met).toBe(true);
	});

	it("should reject scale mode with only validation lock missing", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: false,
			requestedWorkers: 5,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors.some((e) => e.includes("Validation Lock"))).toBe(true);
	});

	it("should reject scale mode for 4 workers without validation lock", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: false,
			requestedWorkers: 4,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.errors.some((e) => e.includes("Validation Lock"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Combined prerequisite rejection
// ---------------------------------------------------------------------------

describe("multiple missing prerequisites block scale mode", () => {
	it("should block scale mode when all prerequisites are missing", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: false,
			integrationQueueEnabled: false,
			validationLockEnabled: false,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.errors.length).toBe(3);
		expect(result.errors.some((e) => e.includes("Worktree Isolation"))).toBe(true);
		expect(result.errors.some((e) => e.includes("Integration Queue"))).toBe(true);
		expect(result.errors.some((e) => e.includes("Validation Lock"))).toBe(true);
	});

	it("should block scale mode when two prerequisites are missing", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: false,
			validationLockEnabled: false,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.errors.length).toBe(2);
	});

	it("should pass scale mode when all prerequisites are met for 6 workers", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true);
		expect(result.ready).toBe(true);
		expect(result.errors).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// AC4: Doctor reports readiness for scale mode
// ---------------------------------------------------------------------------

describe("AC4: doctor reports readiness for scale mode", () => {
	it("should return doctor results with pass status when prerequisites are met", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		};
		const results = checkScaleReadiness(config);
		expect(results.overallStatus).toBe("pass");
		expect(results.checks.length).toBeGreaterThan(0);
		expect(results.readiness.ready).toBe(true);
	});

	it("should return doctor results with fail status when prerequisites are missing", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: false,
			integrationQueueEnabled: false,
			validationLockEnabled: false,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		};
		const results = checkScaleReadiness(config);
		expect(results.overallStatus).toBe("fail");
		expect(results.checks.length).toBeGreaterThan(0);
	});

	it("should include prerequisite checks in doctor results", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: false,
			validationLockEnabled: true,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		};
		const results = checkScaleReadiness(config);

		// Should have check entries for prerequisites
		const prereqChecks = results.checks.filter((c) => c.name.includes("Prerequisite"));
		expect(prereqChecks.length).toBe(3);

		// Worktree isolation should pass, integration queue should fail
		const worktreeCheck = prereqChecks.find((c) => c.name.includes("Worktree Isolation"));
		expect(worktreeCheck?.status).toBe("pass");

		const integrationCheck = prereqChecks.find((c) => c.name.includes("Integration Queue"));
		expect(integrationCheck?.status).toBe("fail");
	});

	it("should report warn status when prerequisites met but scale mode not active", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 3,
			experimentalModeEnabled: false,
		};
		const results = checkScaleReadiness(config);
		expect(results.overallStatus).toBe("pass"); // no failures, just pass
		expect(results.readiness.currentMode).toBe("stable");
	});

	it("should format doctor results as human-readable string", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: false,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		};
		const results = checkScaleReadiness(config);
		const formatted = formatScaleModeReadiness(results.readiness);
		expect(formatted).toContain("Scale Mode Readiness");
		expect(formatted).toContain("Prerequisites");
		expect(formatted).toContain("Worktree Isolation");
	});
});

// ---------------------------------------------------------------------------
// AC5: Dashboard shows current scale mode and prerequisite status
// ---------------------------------------------------------------------------

describe("AC5: dashboard shows current scale mode and prerequisite status", () => {
	it("should produce readiness data suitable for dashboard display", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		};
		const readiness = checkScaleModeReadiness(config);

		// Dashboard needs: current mode, isActive, prerequisites array, errors/warnings
		expect(readiness.currentMode).toBe("scale");
		expect(readiness.isScaleModeActive).toBe(true);
		expect(readiness.prerequisites).toHaveLength(3);
		expect(readiness.errors).toBeDefined();
		expect(readiness.warnings).toBeDefined();

		// Each prerequisite must have key, name, met, message for the dashboard component
		for (const prereq of readiness.prerequisites) {
			expect(prereq).toHaveProperty("key");
			expect(prereq).toHaveProperty("name");
			expect(prereq).toHaveProperty("met");
			expect(prereq).toHaveProperty("message");
		}
	});

	it("should indicate scale mode is not active when in stable range", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 3,
			experimentalModeEnabled: false,
		};
		const readiness = checkScaleModeReadiness(config);
		expect(readiness.currentMode).toBe("stable");
		expect(readiness.isScaleModeActive).toBe(false);
	});

	it("should indicate which prerequisites are met in dashboard data", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: false,
			validationLockEnabled: false,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		};
		const readiness = checkScaleModeReadiness(config);

		const worktree = readiness.prerequisites.find((p) => p.key === PREREQ_WORKTREE_ISOLATION);
		expect(worktree?.met).toBe(true);

		const integration = readiness.prerequisites.find((p) => p.key === PREREQ_INTEGRATION_QUEUE);
		expect(integration?.met).toBe(false);

		const validation = readiness.prerequisites.find((p) => p.key === PREREQ_VALIDATION_LOCK);
		expect(validation?.met).toBe(false);
	});

	it("should include prerequisite keys for icon mapping", () => {
		const config: ScaleModeConfig = {
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 6,
			experimentalModeEnabled: true,
		};
		const readiness = checkScaleModeReadiness(config);

		const keys = readiness.prerequisites.map((p) => p.key);
		expect(keys).toContain(PREREQ_WORKTREE_ISOLATION);
		expect(keys).toContain(PREREQ_INTEGRATION_QUEUE);
		expect(keys).toContain(PREREQ_VALIDATION_LOCK);
	});
});

// ---------------------------------------------------------------------------
// Scale mode type helpers
// ---------------------------------------------------------------------------

describe("scale mode type helpers", () => {
	it("SCALE_MODE_MIN_WORKERS should be 4", () => {
		expect(SCALE_MODE_MIN_WORKERS).toBe(4);
	});

	it("SCALE_MODE_MAX_WORKERS should be 6", () => {
		expect(SCALE_MODE_MAX_WORKERS).toBe(6);
	});

	it("should identify scale mode worker counts correctly", () => {
		expect(isScaleModeWorkerCount(4)).toBe(true);
		expect(isScaleModeWorkerCount(5)).toBe(true);
		expect(isScaleModeWorkerCount(6)).toBe(true);
		expect(isScaleModeWorkerCount(3)).toBe(false);
		expect(isScaleModeWorkerCount(7)).toBe(false);
		expect(isScaleModeWorkerCount(1)).toBe(false);
	});

	it("should identify require scale mode correctly", () => {
		expect(requiresScaleMode(4)).toBe(true);
		expect(requiresScaleMode(5)).toBe(true);
		expect(requiresScaleMode(6)).toBe(true);
		expect(requiresScaleMode(3)).toBe(false);
		expect(requiresScaleMode(2)).toBe(false);
		expect(requiresScaleMode(1)).toBe(false);
	});

	it("getScaleModeType should return scale for 4-6 with experimental enabled", () => {
		expect(getScaleModeType(4, true)).toBe("scale");
		expect(getScaleModeType(5, true)).toBe("scale");
		expect(getScaleModeType(6, true)).toBe("scale");
	});

	it("getScaleModeType should return stable for 1-3 regardless of experimental flag", () => {
		expect(getScaleModeType(1, true)).toBe("stable");
		expect(getScaleModeType(2, true)).toBe("stable");
		expect(getScaleModeType(3, true)).toBe("stable");
		expect(getScaleModeType(1, false)).toBe("stable");
		expect(getScaleModeType(3, false)).toBe("stable");
	});

	it("getScaleModeType should return stable for 4-6 without experimental enabled", () => {
		expect(getScaleModeType(4, false)).toBe("stable");
		expect(getScaleModeType(5, false)).toBe("stable");
		expect(getScaleModeType(6, false)).toBe("stable");
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	it("should clamp worker count below minimum for readiness check", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 0,
			experimentalModeEnabled: true,
		});
		// Should not crash, should still evaluate
		expect(result.currentMode).toBe("stable"); // 0 clamped down, not scale
		expect(result.isScaleModeActive).toBe(false);
	});

	it("should clamp worker count above maximum for readiness check", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 10,
			experimentalModeEnabled: true,
		});
		expect(result.isScaleModeActive).toBe(true); // 10 clamped to 6 = scale
		expect(result.ready).toBe(true);
	});

	it("should warn when all prerequisites met but scale mode not active", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: true,
			integrationQueueEnabled: true,
			validationLockEnabled: true,
			requestedWorkers: 2,
			experimentalModeEnabled: false,
		});
		expect(result.warnings.some((w) => w.includes("prerequisites are met"))).toBe(true);
	});

	it("should warn when experimental flag is enabled but workers in stable range", () => {
		const result = checkScaleModeReadiness({
			worktreeIsolationEnabled: false,
			integrationQueueEnabled: false,
			validationLockEnabled: false,
			requestedWorkers: 2,
			experimentalModeEnabled: true,
		});
		expect(result.warnings.some((w) => w.includes("Scale/experimental mode is enabled"))).toBe(true);
	});
});
