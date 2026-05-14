/**
 * Scale Mode Policy - Workspace 6.F
 *
 * Enforces prerequisites for enabling 6+ worker scale mode.
 *
 * Scale mode (4-6 workers) builds on the experimental worker mode with
 * additional safety guarantees:
 *
 * Required Prerequisites:
 * 1. Worktree isolation — each worker runs in an isolated git worktree,
 *    preventing file conflicts between concurrent workers.
 * 2. Integration queue — changes from workers are merged through a
 *    serial integration queue, ensuring one-at-a-time validation.
 * 3. Global validation lock — validation commands are serialized across
 *    all workers to prevent simultaneous test/type-check execution.
 *
 * Stable default remains 3 workers. Scale mode must be explicitly
 * enabled and all prerequisites must be met.
 */

import {
	MAX_EXPERIMENTAL_WORKERS,
	MAX_STABLE_WORKERS,
	MIN_EXPERIMENTAL_WORKERS,
	MIN_STABLE_WORKERS,
} from "../core/worker-concurrency.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of workers in stable mode (safe default). */
export const STABLE_MAX_WORKERS = MAX_STABLE_WORKERS;

/** Minimum number of workers considered "scale mode". */
export const SCALE_MODE_MIN_WORKERS = MIN_EXPERIMENTAL_WORKERS;

/** Maximum number of workers in scale mode. */
export const SCALE_MODE_MAX_WORKERS = MAX_EXPERIMENTAL_WORKERS;

/** Default worker count. */
export const DEFAULT_WORKERS = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Type of scale mode.
 * - `"stable"`: 1-3 workers, no prerequisites required.
 * - `"scale"`: 4-6 workers, all prerequisites must be met.
 */
export type ScaleModeType = "stable" | "scale";

/**
 * Status of a single prerequisite for enabling scale mode.
 */
export interface PrerequisiteStatus {
	/** Unique key identifying this prerequisite. */
	key: string;
	/** Human-readable name. */
	name: string;
	/** Whether the prerequisite is met. */
	met: boolean;
	/** Human-readable status message. */
	message: string;
}

/**
 * Overall scale mode readiness result.
 */
export interface ScaleModeReadiness {
	/** Whether scale mode can be safely enabled. */
	ready: boolean;
	/** Current scale mode type based on configuration. */
	currentMode: ScaleModeType;
	/** Whether scale mode (4-6 workers) is currently active. */
	isScaleModeActive: boolean;
	/** Status of each prerequisite. */
	prerequisites: PrerequisiteStatus[];
	/** Error messages (why scale mode is blocked). */
	errors: string[];
	/** Warning messages (non-blocking concerns). */
	warnings: string[];
}

/**
 * Configuration for checking scale mode prerequisites.
 */
export interface ScaleModeConfig {
	/** Whether worktree isolation is enabled. */
	worktreeIsolationEnabled: boolean;
	/** Whether integration queue is enabled. */
	integrationQueueEnabled: boolean;
	/** Whether global validation lock is enabled. */
	validationLockEnabled: boolean;
	/** Requested number of concurrent workers. */
	requestedWorkers: number;
	/** Whether experimental/scale mode is explicitly enabled. */
	experimentalModeEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Prerequisite Keys
// ---------------------------------------------------------------------------

/** Prerequisite key: worktree isolation. */
export const PREREQ_WORKTREE_ISOLATION = "worktree_isolation";

/** Prerequisite key: integration queue. */
export const PREREQ_INTEGRATION_QUEUE = "integration_queue";

/** Prerequisite key: global validation lock. */
export const PREREQ_VALIDATION_LOCK = "validation_lock";

/** All prerequisite keys in check order. */
export const ALL_PREREQUISITES = [PREREQ_WORKTREE_ISOLATION, PREREQ_INTEGRATION_QUEUE, PREREQ_VALIDATION_LOCK] as const;

// ---------------------------------------------------------------------------
// Prerequisite helpers
// ---------------------------------------------------------------------------

/**
 * Build prerequisite status for worktree isolation.
 *
 * @param enabled - Whether worktree isolation is enabled
 * @returns Prerequisite status
 */
export function checkWorktreeIsolationPrerequisite(enabled: boolean): PrerequisiteStatus {
	return {
		key: PREREQ_WORKTREE_ISOLATION,
		name: "Worktree Isolation",
		met: enabled,
		message: enabled
			? "Worktree isolation is enabled — workers run in isolated git worktrees"
			: "Worktree isolation is disabled — file conflicts may occur with concurrent workers",
	};
}

/**
 * Build prerequisite status for integration queue.
 *
 * @param enabled - Whether integration queue is enabled
 * @returns Prerequisite status
 */
export function checkIntegrationQueuePrerequisite(enabled: boolean): PrerequisiteStatus {
	return {
		key: PREREQ_INTEGRATION_QUEUE,
		name: "Integration Queue",
		met: enabled,
		message: enabled
			? "Integration queue is enabled — workspace changes are merged serially"
			: "Integration queue is disabled — without serial merge, concurrent changes may conflict",
	};
}

/**
 * Build prerequisite status for validation lock.
 *
 * @param enabled - Whether validation lock is enabled
 * @returns Prerequisite status
 */
export function checkValidationLockPrerequisite(enabled: boolean): PrerequisiteStatus {
	return {
		key: PREREQ_VALIDATION_LOCK,
		name: "Global Validation Lock",
		met: enabled,
		message: enabled
			? "Global validation lock is enabled — validation commands are serialized"
			: "Global validation lock is disabled — concurrent validation may cause conflicts",
	};
}

// ---------------------------------------------------------------------------
// Scale mode type helpers
// ---------------------------------------------------------------------------

/**
 * Determine the scale mode type based on worker count and experimental flag.
 *
 * @param workers - Requested worker count
 * @param experimentalEnabled - Whether experimental/scale mode is enabled
 * @returns The effective scale mode type
 */
export function getScaleModeType(workers: number, experimentalEnabled: boolean): ScaleModeType {
	if (workers >= SCALE_MODE_MIN_WORKERS && workers <= SCALE_MODE_MAX_WORKERS && experimentalEnabled) {
		return "scale";
	}
	return "stable";
}

/**
 * Check whether the given worker count falls within scale mode range.
 *
 * @param workers - Worker count to check
 * @returns True if the count is in the scale range (4-6)
 */
export function isScaleModeWorkerCount(workers: number): boolean {
	return workers >= SCALE_MODE_MIN_WORKERS && workers <= SCALE_MODE_MAX_WORKERS;
}

/**
 * Check whether the given worker count would require scale mode to be enabled.
 *
 * @param workers - Worker count to check
 * @returns True if scale mode is required for this worker count
 */
export function requiresScaleMode(workers: number): boolean {
	return workers > STABLE_MAX_WORKERS;
}

// ---------------------------------------------------------------------------
// Readiness check
// ---------------------------------------------------------------------------

/**
 * Check scale mode prerequisites and return overall readiness.
 *
 * Evaluates all three prerequisites:
 * 1. Worktree isolation
 * 2. Integration queue
 * 3. Global validation lock
 *
 * If the requested worker count is within stable range (1-3),
 * prerequisites are not enforced and the result is always ready.
 *
 * If the worker count requires scale mode (4-6) but prerequisites
 * are not fully met, the result will indicate which prerequisites failed
 * and why scale mode is blocked.
 *
 * @param config - Scale mode configuration to evaluate
 * @returns Scale mode readiness result
 */
export function checkScaleModeReadiness(config: ScaleModeConfig): ScaleModeReadiness {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Clamp to valid worker range
	const workers = Math.max(MIN_STABLE_WORKERS, Math.min(MAX_EXPERIMENTAL_WORKERS, config.requestedWorkers));

	// Determine current mode
	const currentMode = getScaleModeType(workers, config.experimentalModeEnabled);
	const isScaleModeActive = currentMode === "scale";

	// Check prerequisites
	const prerequisites: PrerequisiteStatus[] = [
		checkWorktreeIsolationPrerequisite(config.worktreeIsolationEnabled),
		checkIntegrationQueuePrerequisite(config.integrationQueueEnabled),
		checkValidationLockPrerequisite(config.validationLockEnabled),
	];

	// If scale mode would be active, enforce prerequisites
	if (isScaleModeActive) {
		const unmet = prerequisites.filter((p) => !p.met);
		if (unmet.length > 0) {
			for (const prereq of unmet) {
				errors.push(`Scale mode requires "${prereq.name}" to be enabled. ${prereq.message}`);
			}
		}
	}

	// Warn if prerequisites are met but scale mode is not active (stable range)
	if (!isScaleModeActive && prerequisites.every((p) => p.met)) {
		warnings.push(
			`All scale mode prerequisites are met, but worker count (${workers}) is within stable range (1-3). ` +
				"Increase worker count to 4-6 enable scale mode.",
		);
	}

	// Warn if experimental flag is set but worker count is in stable range
	if (config.experimentalModeEnabled && !isScaleModeActive) {
		warnings.push(
			`Scale/experimental mode is enabled but worker count (${workers}) is within stable range (1-3). ` +
				"The flag has no effect at this worker count.",
		);
	}

	const ready = !isScaleModeActive || errors.length === 0;

	return {
		ready,
		currentMode,
		isScaleModeActive,
		prerequisites,
		errors,
		warnings,
	};
}

/**
 * Format scale mode readiness for human-readable display.
 *
 * @param readiness - Scale mode readiness result
 * @returns Formatted string
 */
export function formatScaleModeReadiness(readiness: ScaleModeReadiness): string {
	const lines: string[] = [];

	lines.push("=== Scale Mode Readiness ===");
	lines.push(`  Current mode: ${readiness.currentMode}`);
	lines.push(`  Scale mode active: ${readiness.isScaleModeActive ? "YES" : "no"}`);
	lines.push(`  Ready: ${readiness.ready ? "YES" : "NO"}`);
	lines.push("");

	lines.push("Prerequisites:");
	for (const prereq of readiness.prerequisites) {
		const icon = prereq.met ? "  ✓" : "  ✗";
		lines.push(`${icon} ${prereq.name}: ${prereq.message}`);
	}

	if (readiness.errors.length > 0) {
		lines.push("");
		lines.push("ERRORS:");
		for (const error of readiness.errors) {
			lines.push(`  ✗ ${error}`);
		}
	}

	if (readiness.warnings.length > 0) {
		lines.push("");
		lines.push("WARNINGS:");
		for (const warning of readiness.warnings) {
			lines.push(`  ⚠ ${warning}`);
		}
	}

	return lines.join("\n");
}
