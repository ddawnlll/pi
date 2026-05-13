/**
 * Worker Concurrency Settings & Experimental 6-Worker Mode
 *
 * Manages worker concurrency configuration with:
 * - Stable mode: 1-3 workers (default: 3)
 * - Experimental mode: 4-6 workers (disabled by default)
 * - Explicit confirmation required to enable experimental mode
 * - Experimental mode requires archive enabled and stop-on-failure enabled
 */

/** Minimum worker count (stable range) */
export const MIN_STABLE_WORKERS = 1;

/** Maximum worker count in stable mode */
export const MAX_STABLE_WORKERS = 3;

/** Minimum worker count in experimental range */
export const MIN_EXPERIMENTAL_WORKERS = 4;

/** Maximum worker count in experimental range */
export const MAX_EXPERIMENTAL_WORKERS = 6;

/** Default worker count */
export const DEFAULT_WORKERS = 3;

/**
 * Worker concurrency settings from user configuration.
 */
export interface WorkerConcurrencySettings {
	/** Maximum concurrent workers (1-6, default: 3) */
	maxWorkers?: number;
	/**
	 * Whether experimental mode (4-6 workers) is explicitly enabled.
	 * Must be explicitly set to true by user confirmation.
	 * Default: false
	 */
	experimentalModeEnabled?: boolean;
}

/**
 * Validation result for worker concurrency configuration.
 */
export interface WorkerConcurrencyValidationResult {
	/** Whether the configuration is valid */
	valid: boolean;
	/** Warning messages (non-blocking) */
	warnings: string[];
	/** Error messages (blocking) */
	errors: string[];
	/** Whether experimental mode is active */
	isExperimental: boolean;
	/** Effective worker count (clamped to valid range) */
	effectiveWorkers: number;
}

/**
 * Determine if a worker count is in the stable range.
 *
 * @param count - Worker count to check
 * @returns True if the count is within the stable range (1-3)
 */
export function isStableWorkerCount(count: number): boolean {
	return count >= MIN_STABLE_WORKERS && count <= MAX_STABLE_WORKERS;
}

/**
 * Determine if a worker count is in the experimental range.
 *
 * @param count - Worker count to check
 * @returns True if the count is within the experimental range (4-6)
 */
export function isExperimentalWorkerCount(count: number): boolean {
	return count >= MIN_EXPERIMENTAL_WORKERS && count <= MAX_EXPERIMENTAL_WORKERS;
}

/**
 * Determine if a worker count requires experimental mode.
 *
 * @param count - Worker count to check
 * @returns True if the count requires experimental mode to be enabled
 */
export function requiresExperimentalMode(count: number): boolean {
	return count > MAX_STABLE_WORKERS;
}

/**
 * Validate worker concurrency settings.
 *
 * Checks that:
 * - Worker count is within valid range (1-6)
 * - Experimental mode is enabled when worker count > 3
 * - Experimental mode requires archive enabled and stop-on-failure enabled
 *
 * @param settings - Worker concurrency settings to validate
 * @param options - Additional options for validation
 * @returns Validation result
 */
export function validateWorkerConcurrency(
	settings: WorkerConcurrencySettings,
	options?: {
		/** Whether archive is enabled */
		archiveEnabled?: boolean;
		/** Whether stop-on-failure is enabled */
		stopOnFailureEnabled?: boolean;
	},
): WorkerConcurrencyValidationResult {
	const warnings: string[] = [];
	const errors: string[] = [];

	const requestedWorkers = settings.maxWorkers ?? DEFAULT_WORKERS;
	const experimentalEnabled = settings.experimentalModeEnabled ?? false;

	// Clamp to valid range
	let effectiveWorkers = requestedWorkers;
	if (effectiveWorkers < MIN_STABLE_WORKERS) {
		errors.push(
			`Worker count ${effectiveWorkers} is below minimum (${MIN_STABLE_WORKERS}). Clamping to ${MIN_STABLE_WORKERS}.`,
		);
		effectiveWorkers = MIN_STABLE_WORKERS;
	}
	if (effectiveWorkers > MAX_EXPERIMENTAL_WORKERS) {
		errors.push(
			`Worker count ${effectiveWorkers} exceeds maximum (${MAX_EXPERIMENTAL_WORKERS}). Clamping to ${MAX_EXPERIMENTAL_WORKERS}.`,
		);
		effectiveWorkers = MAX_EXPERIMENTAL_WORKERS;
	}

	let isExperimental = effectiveWorkers > MAX_STABLE_WORKERS;

	// If worker count requires experimental mode but it's not enabled
	if (isExperimental && !experimentalEnabled) {
		errors.push(
			`Worker count ${effectiveWorkers} requires experimental mode. ` +
				`Enable experimental mode with explicit confirmation to use ${MIN_EXPERIMENTAL_WORKERS}-${MAX_EXPERIMENTAL_WORKERS} workers.`,
		);
		effectiveWorkers = MAX_STABLE_WORKERS;
		isExperimental = false;
	}

	// If experimental mode is enabled, check prerequisites
	if (experimentalEnabled && isExperimental) {
		const archiveEnabled = options?.archiveEnabled ?? false;
		const stopOnFailureEnabled = options?.stopOnFailureEnabled ?? false;

		if (!archiveEnabled) {
			errors.push(
				"Experimental worker mode requires archive to be enabled. " +
					"Enable archive to ensure execution history is preserved for debugging.",
			);
		}

		if (!stopOnFailureEnabled) {
			errors.push(
				"Experimental worker mode requires stop-on-failure to be enabled. " +
					"With 4-6 workers, a failure in one workspace can cascade; stop-on-failure prevents wasted work.",
			);
		}

		// Add warning about experimental mode
		warnings.push(
			`Experimental mode enabled: using ${effectiveWorkers} workers. ` +
				"This mode is less tested and may have stability issues with high concurrency.",
		);
	}

	// If experimental mode is enabled but worker count is in stable range
	if (experimentalEnabled && !isExperimental) {
		warnings.push(
			"Experimental mode is enabled but worker count is within stable range. " +
				"The experimental flag has no effect at this worker count.",
		);
	}

	return {
		valid: errors.length === 0,
		warnings,
		errors,
		isExperimental,
		effectiveWorkers,
	};
}

/**
 * Resolve effective worker count from settings.
 *
 * Returns the validated worker count, falling back to default (3) if
 * experimental mode is not enabled for counts > 3.
 *
 * @param settings - Worker concurrency settings
 * @param options - Additional validation options
 * @returns Effective worker count
 */
export function resolveEffectiveWorkerCount(
	settings: WorkerConcurrencySettings,
	options?: {
		archiveEnabled?: boolean;
		stopOnFailureEnabled?: boolean;
	},
): number {
	const validation = validateWorkerConcurrency(settings, options);
	return validation.effectiveWorkers;
}

/**
 * Format worker concurrency validation for display.
 *
 * @param validation - Validation result
 * @returns Formatted string for console output
 */
export function formatWorkerConcurrencyValidation(validation: WorkerConcurrencyValidationResult): string {
	const lines: string[] = [];

	lines.push("=== Worker Concurrency ===");
	lines.push(`  Effective workers: ${validation.effectiveWorkers}`);
	lines.push(`  Experimental mode: ${validation.isExperimental ? "YES" : "no"}`);
	lines.push(`  Valid: ${validation.valid ? "YES" : "NO"}`);

	if (validation.errors.length > 0) {
		lines.push("");
		lines.push("ERRORS:");
		for (const error of validation.errors) {
			lines.push(`  ✗ ${error}`);
		}
	}

	if (validation.warnings.length > 0) {
		lines.push("");
		lines.push("WARNINGS:");
		for (const warning of validation.warnings) {
			lines.push(`  ⚠ ${warning}`);
		}
	}

	return lines.join("\n");
}
