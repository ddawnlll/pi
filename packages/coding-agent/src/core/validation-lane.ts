/**
 * Validation Lane Backpressure (P23 W4)
 *
 * Tracks validation lane saturation and provides a pre-filter for the
 * scheduler to prefer targeted-only workspaces when the heavy validation
 * slot is occupied.
 *
 * Key concepts:
 * - Heavy validation: commands that use the global validation lock (e.g., full test suite)
 * - Targeted validation: lightweight checks that don't need the global lock
 * - Only 1 heavy validation can run at a time
 * - Up to 3 targeted validations can run concurrently
 * - When the heavy slot is full, the scheduler defers heavy-validation workspaces
 */

import { isValidationCommand } from "./validation-lock.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for validation lane backpressure.
 */
export interface ValidationLaneConfig {
	/** Maximum concurrent heavy validations */
	maxConcurrentHeavyValidations: number;
	/** Maximum concurrent targeted validations */
	maxConcurrentTargetedValidations: number;
	/** Whether backpressure is enabled */
	backpressureEnabled: boolean;
	/** Strategy when heavy lane is saturated */
	backpressureStrategy: "prefer_targeted_when_heavy_saturated";
	/** Whether the scheduler receives feedback from the lane tracker */
	schedulerFeedbackEnabled: boolean;
}

/**
 * Default validation lane configuration.
 */
export const DEFAULT_VALIDATION_LANE_CONFIG: ValidationLaneConfig = {
	maxConcurrentHeavyValidations: 1,
	maxConcurrentTargetedValidations: 3,
	backpressureEnabled: true,
	backpressureStrategy: "prefer_targeted_when_heavy_saturated",
	schedulerFeedbackEnabled: true,
};

/**
 * Current state of the validation lanes.
 */
export interface ValidationLaneState {
	/** Number of heavy validations currently running */
	currentHeavyValidations: number;
	/** Maximum concurrent heavy validations */
	maxConcurrentHeavyValidations: number;
	/** Number of targeted validations currently running */
	currentTargetedValidations: number;
	/** Maximum concurrent targeted validations */
	maxConcurrentTargetedValidations: number;
	/** Whether backpressure is active (heavy lane is saturated) */
	backpressureActive: boolean;
	/** Workspace IDs currently deferred due to lane saturation */
	deferredWorkspaceIds: string[];
	/** Reason each workspace is deferred */
	deferredReasons: Map<string, string>;
}

// ---------------------------------------------------------------------------
// ValidationLaneTracker
// ---------------------------------------------------------------------------

/**
 * Tracks validation lane usage and provides backpressure signals.
 *
 * The scheduler calls `shouldDeferWorkspace()` before launching a workspace.
 * If the heavy validation slot is full and the workspace requires heavy validation,
 * the tracker signals to defer it in favor of targeted-only workspaces.
 */
export class ValidationLaneTracker {
	private config: ValidationLaneConfig;
	private heavyCount = 0;
	private targetedCount = 0;
	private deferredWorkspaceIds: string[] = [];
	private deferredReasons: Map<string, string> = new Map();
	private eventCallback: ((event: string, data: any) => void) | null = null;

	constructor(config: Partial<ValidationLaneConfig> = {}) {
		this.config = { ...DEFAULT_VALIDATION_LANE_CONFIG, ...config };
	}

	/**
	 * Set a callback for lane events (for dashboard emission).
	 */
	setEventCallback(cb: (event: string, data: any) => void): void {
		this.eventCallback = cb;
	}

	/**
	 * Get the current lane state.
	 */
	getState(): ValidationLaneState {
		return {
			currentHeavyValidations: this.heavyCount,
			maxConcurrentHeavyValidations: this.config.maxConcurrentHeavyValidations,
			currentTargetedValidations: this.targetedCount,
			maxConcurrentTargetedValidations: this.config.maxConcurrentTargetedValidations,
			backpressureActive: this.isBackpressureActive(),
			deferredWorkspaceIds: [...this.deferredWorkspaceIds],
			deferredReasons: new Map(this.deferredReasons),
		};
	}

	/**
	 * Whether backpressure is currently active (heavy lane is saturated).
	 */
	isBackpressureActive(): boolean {
		if (!this.config.backpressureEnabled) return false;
		return this.heavyCount >= this.config.maxConcurrentHeavyValidations;
	}

	/**
	 * Whether a validation is a heavy validation (needs the global lock).
	 */
	isHeavyValidation(validationCommand: string | undefined): boolean {
		if (!validationCommand) return false;
		// Reuse the validation command pattern check from validation-lock
		return isValidationCommand(validationCommand);
	}

	/**
	 * Register the start of a validation.
	 *
	 * @param workspaceId - Workspace ID
	 * @param validationCommand - The validation command being run
	 * @param canRunTargetedOnly - Whether this workspace can run targeted-only validation
	 */
	startValidation(_workspaceId: string, validationCommand: string | undefined, canRunTargetedOnly: boolean): void {
		const isHeavy = !canRunTargetedOnly && this.isHeavyValidation(validationCommand);
		if (isHeavy) {
			this.heavyCount++;
		} else {
			this.targetedCount++;
		}
	}

	/**
	 * Register the end of a validation.
	 *
	 * @param validationCommand - The validation command that was run
	 * @param canRunTargetedOnly - Whether this workspace can run targeted-only validation
	 */
	endValidation(validationCommand: string | undefined, canRunTargetedOnly: boolean): void {
		const isHeavy = !canRunTargetedOnly && this.isHeavyValidation(validationCommand);
		if (isHeavy) {
			this.heavyCount = Math.max(0, this.heavyCount - 1);
		} else {
			this.targetedCount = Math.max(0, this.targetedCount - 1);
		}

		// Re-evaluate deferred workspaces when a validation completes
		this.deferredWorkspaceIds = this.deferredWorkspaceIds.filter((id) => {
			if (!this.isBackpressureActive()) {
				this.deferredReasons.delete(id);
				return false;
			}
			return true;
		});
	}

	/**
	 * Check whether a workspace should be deferred due to lane saturation.
	 *
	 * This is the pre-filter for the scheduler. Called BEFORE launching a workspace.
	 *
	 * @param workspaceId - Workspace ID
	 * @param validationCommand - Workspace's validation command
	 * @param canRunTargetedOnly - Whether the workspace can run targeted-only validation
	 * @returns True if the workspace should be deferred (not launched yet)
	 */
	shouldDeferWorkspace(
		workspaceId: string,
		validationCommand: string | undefined,
		canRunTargetedOnly: boolean,
	): boolean {
		if (!this.config.backpressureEnabled) return false;

		// If it can run targeted-only, never defer it
		if (canRunTargetedOnly) return false;

		// If it doesn't run heavy validation, never defer it
		if (!this.isHeavyValidation(validationCommand)) return false;

		// If heavy lane is not saturated, don't defer
		if (!this.isBackpressureActive()) return false;

		// Heavy lane is saturated and this workspace needs heavy validation — defer it
		this.deferredWorkspaceIds.push(workspaceId);
		this.deferredReasons.set(workspaceId, "Heavy validation slot saturated");
		this.emitEvent("validation_lane_backpressure_active", {
			workspaceId,
			reason: `Heavy validation slot saturated (${this.heavyCount}/${this.config.maxConcurrentHeavyValidations})`,
		});
		return true;
	}

	/**
	 * Reset the tracker state (for testing / fresh start).
	 */
	reset(): void {
		this.heavyCount = 0;
		this.targetedCount = 0;
		this.deferredWorkspaceIds = [];
		this.deferredReasons.clear();
	}

	private emitEvent(event: string, data: any): void {
		this.eventCallback?.(event, data);
	}
}
