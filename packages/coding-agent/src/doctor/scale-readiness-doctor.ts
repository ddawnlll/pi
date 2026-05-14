/**
 * Scale Readiness Doctor - Workspace 6.F
 *
 * Validates the system is ready for scale mode (4-6 workers).
 *
 * Acceptance criteria:
 * - AC4: Doctor reports readiness for scale mode
 * - AC6: Stable default remains 3 workers
 *
 * The doctor checks:
 * 1. Worktree isolation is enabled
 * 2. Integration queue is enabled
 * 3. Global validation lock is enabled
 * 4. Reports whether scale mode can be safely activated
 */

import {
	checkScaleModeReadiness,
	type ScaleModeConfig,
	type ScaleModeReadiness,
} from "../scheduler/scale-mode-policy.js";

/**
 * Scale readiness doctor check result.
 */
export interface ScaleDoctorCheck {
	/** Check name. */
	name: string;
	/** Check status. */
	status: "pass" | "fail" | "warn";
	/** Status message. */
	message: string;
	/** Optional details. */
	details?: string;
}

/**
 * Categorized scale readiness doctor results.
 */
export interface ScaleDoctorResults {
	/** All checks. */
	checks: ScaleDoctorCheck[];
	/** Overall status. */
	overallStatus: "pass" | "warn" | "fail";
	/** Number of passed checks. */
	passCount: number;
	/** Number of warnings. */
	warnCount: number;
	/** Number of failed checks. */
	failCount: number;
	/** The underlying scale mode readiness for dashboard use. */
	readiness: ScaleModeReadiness;
}

// ---------------------------------------------------------------------------
// Check categories
// ---------------------------------------------------------------------------

/**
 * Category for scale readiness doctor checks.
 */
export type ScaleDoctorCategory = "prerequisites" | "config" | "summary";

// ---------------------------------------------------------------------------
// Doctor checks
// ---------------------------------------------------------------------------

/**
 * Run all scale readiness doctor checks.
 *
 * @param config - Scale mode configuration to evaluate
 * @returns Scale doctor results
 */
export function checkScaleReadiness(config: ScaleModeConfig): ScaleDoctorResults {
	const readiness = checkScaleModeReadiness(config);
	const checks: ScaleDoctorCheck[] = [];

	// 1. Prerequisite checks
	checks.push(...checkScalePrerequisites(readiness));

	// 2. Configuration checks
	checks.push(...checkScaleConfig(readiness, config));

	// 3. Scale mode summary
	checks.push(checkScaleModeSummary(readiness));

	// Calculate overall status
	const passCount = checks.filter((c) => c.status === "pass").length;
	const warnCount = checks.filter((c) => c.status === "warn").length;
	const failCount = checks.filter((c) => c.status === "fail").length;
	const overallStatus = failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass";

	return {
		checks,
		overallStatus,
		passCount,
		warnCount,
		failCount,
		readiness,
	};
}

/**
 * Check individual scale mode prerequisites.
 *
 * @param readiness - Scale mode readiness
 * @returns Array of doctor checks for prerequisites
 */
function checkScalePrerequisites(readiness: ScaleModeReadiness): ScaleDoctorCheck[] {
	return readiness.prerequisites.map((prereq) => {
		return {
			name: `Scale Mode Prerequisite: ${prereq.name}`,
			status: prereq.met ? "pass" : readiness.isScaleModeActive ? "fail" : "warn",
			message: prereq.message,
			details: prereq.met
				? undefined
				: `Required for scale mode (4-6 workers). Currently ${readiness.isScaleModeActive ? "blocking" : "recommended"}.`,
		};
	});
}

/**
 * Check scale mode configuration.
 *
 * @param readiness - Scale mode readiness
 * @param config - Original scale mode configuration
 * @returns Array of doctor checks for configuration
 */
function checkScaleConfig(readiness: ScaleModeReadiness, config: ScaleModeConfig): ScaleDoctorCheck[] {
	const checks: ScaleDoctorCheck[] = [];

	// Check current scale mode
	checks.push({
		name: "Current Scale Mode",
		status: "pass",
		message: `Scale mode: ${readiness.currentMode}${readiness.isScaleModeActive ? ` (${config.requestedWorkers} workers)` : ""}`,
		details: readiness.isScaleModeActive
			? `Running with ${config.requestedWorkers} concurrent workers`
			: `Running with stable mode (${config.requestedWorkers} workers, maximum 3 without scale mode)`,
	});

	// Check worker count
	const isStableDefault = config.requestedWorkers === 3 || config.requestedWorkers === undefined;
	checks.push({
		name: "Worker Count Configuration",
		status: "pass",
		message: isStableDefault
			? `Using stable default: ${config.requestedWorkers ?? 3} worker(s)`
			: `Configured: ${config.requestedWorkers} worker(s)`,
	});

	return checks;
}

/**
 * Generate a summary check for scale mode readiness.
 *
 * @param readiness - Scale mode readiness
 * @returns A single summary doctor check
 */
function checkScaleModeSummary(readiness: ScaleModeReadiness): ScaleDoctorCheck {
	if (readiness.isScaleModeActive && readiness.ready) {
		return {
			name: "Scale Mode Readiness",
			status: "pass",
			message: "System is ready for scale mode — all prerequisites are met",
			details: "Worktree isolation, integration queue, and global validation lock are all enabled",
		};
	}

	if (readiness.isScaleModeActive && !readiness.ready) {
		return {
			name: "Scale Mode Readiness",
			status: "fail",
			message: "System is NOT ready for scale mode — prerequisites are missing",
			details: readiness.errors.join("; "),
		};
	}

	// Not in scale mode
	const allMet = readiness.prerequisites.every((p) => p.met);
	if (allMet) {
		return {
			name: "Scale Mode Readiness",
			status: "pass",
			message: "System is ready for scale mode (prerequisites met, but scale mode is not active)",
			details: "Increase worker count to 4-6 and enable experimental mode to activate scale mode",
		};
	}

	return {
		name: "Scale Mode Readiness",
		status: "warn",
		message: "System is partially ready for scale mode",
		details:
			"Some prerequisites are not yet met. Run with stable worker count (1-3) until all prerequisites are satisfied.",
	};
}

/**
 * Format scale doctor results for human-readable output.
 *
 * @param results - Scale doctor results
 * @returns Formatted string
 */
export function formatScaleDoctorResults(results: ScaleDoctorResults): string {
	const lines: string[] = [];

	lines.push("=== Scale Readiness Doctor ===");
	lines.push("");

	const statusIcon = results.overallStatus === "pass" ? "PASS" : results.overallStatus === "warn" ? "WARN" : "FAIL";
	lines.push(`Overall Status: ${statusIcon}`);
	lines.push(`Passed: ${results.passCount} | Warnings: ${results.warnCount} | Failed: ${results.failCount}`);
	lines.push("");

	// Checks
	lines.push("CHECKS:");
	for (const check of results.checks) {
		const icon = check.status === "pass" ? "  ✓" : check.status === "warn" ? "  ⚠" : "  ✗";
		lines.push(`${icon} ${check.name}: ${check.message}`);
		if (check.details) {
			lines.push(`       ${check.details}`);
		}
	}

	return lines.join("\n");
}
