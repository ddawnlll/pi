/**
 * Autonomy Profile Engine — P15.C
 *
 * Manages autonomy levels, checks permissions, derives capability sets
 * from level, and provides emergency stop controls.
 *
 * The engine interprets AutonomyProfile (from types.ts) along with the
 * canonical AUTONOMY_CAPABILITIES table to determine whether an action
 * is allowed, requires approval, or is forbidden at the current autonomy
 * level.
 *
 * File scope: Defines AutonomyConfig, AutonomyCheck, AutonomyEngine,
 * and exports DEFAULT_AUTONOMY_CONFIG + DEFAULT_DECISION_RULES for use
 * by the brain barrel and UserProtocol.
 */

import type { AutonomyCapabilities, AutonomyLevel, AutonomyProfile } from "./types.js";
import { AUTONOMY_CAPABILITIES } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the AutonomyEngine.
 */
export interface AutonomyConfig {
	/** Default autonomy level used when no profile is provided */
	defaultLevel: AutonomyLevel;
	/** Maximum autonomy level the system is allowed to reach */
	maxLevel: AutonomyLevel;
	/** Whether level 3 requires explicit approval for plan execution */
	level3RequiresApproval: boolean;
	/** Whether the system is in emergency stop state */
	emergencyStopped: boolean;
}

/**
 * Result of a permission check.
 */
export interface AutonomyCheck {
	/** Whether the action is allowed at current level */
	allowed: boolean;
	/** Whether the action requires explicit user approval */
	requiresApproval: boolean;
	/** Whether the action is explicitly forbidden */
	isForbidden: boolean;
	/** Human-readable explanation of the result */
	reason?: string;
	/** The minimum autonomy level required for this action (if applicable) */
	requiredLevel?: AutonomyLevel;
}

/**
 * Human-readable description of an autonomy level.
 */
export interface AutonomyLevelDescription {
	/** Short name of the level (e.g. "Advisor", "Planner") */
	name: string;
	/** Longer description explaining the level's capabilities */
	description: string;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Base event emitted by the AutonomyEngine.
 */
export interface AutonomyEngineEvent {
	type: string;
	timestamp: string;
	details?: Record<string, unknown>;
}

/**
 * Event emitted when the autonomy level changes.
 */
export interface ProfileLevelChangeEvent extends AutonomyEngineEvent {
	type: "level_change";
	from: AutonomyLevel;
	to: AutonomyLevel;
	userId?: string;
}

/**
 * Event emitted on authorization check.
 */
export interface AuthorizationEvent extends AutonomyEngineEvent {
	type: "authorization";
	action: string;
	allowed: boolean;
	autonomyLevel: AutonomyLevel;
}

/**
 * Result of an authorization attempt.
 */
export interface AuthorizationResult {
	allowed: boolean;
	event?: AuthorizationEvent;
}

/**
 * Configuration for the AutonomyEngine.
 */
export interface AutonomyEngineConfig {
	/** Default autonomy level */
	defaultLevel: AutonomyLevel;
	/** Maximum autonomy level */
	maxLevel: AutonomyLevel;
	/** Whether level 3 requires approval */
	level3RequiresApproval: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default configuration for the AutonomyEngine.
 */
export const DEFAULT_AUTONOMY_CONFIG: AutonomyConfig = {
	defaultLevel: 2,
	maxLevel: 4,
	level3RequiresApproval: true,
	emergencyStopped: false,
};

/**
 * Default decision rules (empty — the DecisionClassifier manages its own).
 */
export const DEFAULT_DECISION_RULES: Array<{ id: string; action: string }> = [];

/**
 * Actions that are inherently dangerous and forbidden at ALL autonomy levels.
 *
 * These actions appear in forbiddenFor for levels 3 and 4 in the canonical
 * AUTONOMY_CAPABILITIES data. Lower levels (1 and 2) have empty forbiddenFor
 * arrays, but these actions must still be blocked to satisfy the acceptance
 * criteria: "Forbidden actions blocked regardless of level."
 */
const GLOBALLY_FORBIDDEN_ACTIONS: readonly string[] = [
	"secret_access",
	"destructive_cleanup",
	"git_push",
	"irreversible_deletion",
	"bypass_validation_gate",
];

/**
 * Mapping from action names to capability boolean fields on AutonomyCapabilities.
 *
 * This allows the engine to look up whether a given action is permitted
 * by checking the corresponding capability flag for the profile's level.
 */
const ACTION_TO_CAPABILITY: Record<string, keyof AutonomyCapabilities> = {
	generate_insight: "canGenerateInsights",
	propose_idea: "canProposeIdeas",
	generate_plan: "canGeneratePlans",
	validate_plan: "canValidatePlans",
	plan_execution: "canExecutePlans",
	retry_transient_failure: "canRetryTransientFailures",
	produce_report: "canProduceReports",
	propose_roadmap_change: "canProposeRoadmapChanges",
	recommend_architecture: "canRecommendArchitecture",
};

/**
 * Human-readable descriptions for each autonomy level.
 */
const LEVEL_DESCRIPTIONS: Record<AutonomyLevel, AutonomyLevelDescription> = {
	1: {
		name: "Advisor",
		description:
			"Read-only mode. Can generate insights, propose ideas, and produce reports, but cannot generate, validate, or execute plans. All plan-related actions require user approval.",
	},
	2: {
		name: "Planner",
		description:
			"Can generate and validate plans, but cannot execute them. Plan execution, system mutations, memory indexing, architecture changes, and extension permission changes all require user approval.",
	},
	3: {
		name: "Operator",
		description:
			"Can execute approved plans and retry transient failures. Strategic changes (roadmap, architecture) are not allowed. Destructive actions are forbidden. Plan execution may require approval based on configuration.",
	},
	4: {
		name: "Autonomous Strategist",
		description:
			"Full strategic capabilities including roadmap changes and architecture recommendations. Irreversible actions require approval. Destructive actions remain forbidden regardless of level.",
	},
};

// ---------------------------------------------------------------------------
// AutonomyEngine
// ---------------------------------------------------------------------------

/**
 * Engine that manages autonomy levels, checks permissions, and derives
 * capability sets from autonomy profiles.
 */
export class AutonomyEngine {
	private config: AutonomyConfig;
	private emergencyStopActive: boolean;
	private eventListeners: Array<(event: AutonomyEngineEvent) => void>;

	constructor(config?: Partial<AutonomyConfig>) {
		this.config = { ...DEFAULT_AUTONOMY_CONFIG, ...config };
		this.emergencyStopActive = this.config.emergencyStopped;
		this.eventListeners = [];
	}

	// -----------------------------------------------------------------------
	// Permission checks
	// -----------------------------------------------------------------------

	/**
	 * Check whether a specific action can be performed at the profile's
	 * autonomy level.
	 *
	 * The check follows this priority:
	 * 1. Emergency stop — block everything
	 * 2. Forbidden actions (globally forbidden + level-based + profile-based) — blocked regardless of level
	 * 3. Profile "auto" threshold override — allow
	 * 4. Profile "approval" threshold override — require approval
	 * 5. Capability-mapped action — allowed if capability true, else requires approval
	 * 6. Level-based requiresApprovalFor — require approval
	 * 7. Unknown action — requires approval (safe default)
	 *
	 * @param action - The action to check (e.g. "plan_execution")
	 * @param profile - The autonomy profile to evaluate against
	 * @param _context - Optional context for future-aware checks (unused currently)
	 * @returns An AutonomyCheck describing the result
	 */
	canPerform(action: string, profile: AutonomyProfile, _context?: Record<string, unknown>): AutonomyCheck {
		// 1. Emergency stop — block everything
		if (this.emergencyStopActive) {
			this.emitEvent({
				type: "authorization",
				timestamp: new Date().toISOString(),
				details: { reason: "emergency_stop", action, allowed: false, autonomyLevel: profile.level },
			});
			return {
				allowed: false,
				requiresApproval: false,
				isForbidden: true,
				reason: "Emergency stop is active — all autonomous actions blocked",
			};
		}

		const caps = this.getCapabilities(profile.level);

		// 2. Check forbidden actions (globally forbidden + level-based + profile-based)
		const allForbidden = [...GLOBALLY_FORBIDDEN_ACTIONS, ...caps.forbiddenFor, ...profile.forbiddenActions];
		const profileThreshold = profile.approvalThresholds[action];

		if (allForbidden.includes(action) || profileThreshold === "forbidden") {
			this.emitEvent({
				type: "authorization",
				timestamp: new Date().toISOString(),
				details: { reason: "forbidden", action, allowed: false, autonomyLevel: profile.level },
			});
			return {
				allowed: false,
				requiresApproval: false,
				isForbidden: true,
				reason: `Action "${action}" is forbidden at level ${profile.level}`,
			};
		}

		// 3. Check profile-level approval threshold override for "auto"
		if (profileThreshold === "auto") {
			this.emitEvent({
				type: "authorization",
				timestamp: new Date().toISOString(),
				details: { reason: "approval_threshold_auto", action, allowed: true, autonomyLevel: profile.level },
			});
			return {
				allowed: true,
				requiresApproval: false,
				isForbidden: false,
				reason: `Action "${action}" is set to auto-approve in profile thresholds`,
			};
		}

		// 4. Check profile-level approval threshold override for "approval"
		if (profileThreshold === "approval") {
			this.emitEvent({
				type: "authorization",
				timestamp: new Date().toISOString(),
				details: {
					reason: "approval_threshold_requires_approval",
					action,
					allowed: false,
					autonomyLevel: profile.level,
				},
			});
			return {
				allowed: false,
				requiresApproval: true,
				isForbidden: false,
				reason: `Action "${action}" requires approval per profile threshold`,
			};
		}

		// 5. Check capability-mapped actions
		const capabilityKey = ACTION_TO_CAPABILITY[action];
		if (capabilityKey) {
			const isAllowed = caps[capabilityKey] as boolean;

			if (isAllowed) {
				// Level 3 special case: if level3RequiresApproval, plan_execution needs approval
				if (profile.level === 3 && action === "plan_execution" && this.config.level3RequiresApproval) {
					this.emitEvent({
						type: "authorization",
						timestamp: new Date().toISOString(),
						details: {
							reason: "level3_requires_approval_for_execution",
							action,
							allowed: false,
							autonomyLevel: profile.level,
						},
					});
					return {
						allowed: false,
						requiresApproval: true,
						isForbidden: false,
						reason: "Level 3 requires approval for plan execution per configuration",
					};
				}

				this.emitEvent({
					type: "authorization",
					timestamp: new Date().toISOString(),
					details: { reason: "capability_allowed", action, allowed: true, autonomyLevel: profile.level },
				});
				return {
					allowed: true,
					requiresApproval: false,
					isForbidden: false,
					reason: `Action "${action}" is allowed at level ${profile.level}`,
				};
			}

			// Capability is false — not allowed but not forbidden → needs approval
			this.emitEvent({
				type: "authorization",
				timestamp: new Date().toISOString(),
				details: {
					reason: "capability_not_granted",
					action,
					allowed: false,
					autonomyLevel: profile.level,
				},
			});
			return {
				allowed: false,
				requiresApproval: true,
				isForbidden: false,
				reason: `Action "${action}" is not permitted at level ${profile.level} — approval required`,
				requiredLevel: this.findRequiredLevel(action, profile.level),
			};
		}

		// 6. Check if action requires approval per level capabilities
		if (caps.requiresApprovalFor.includes(action) || profileThreshold === "approval") {
			this.emitEvent({
				type: "authorization",
				timestamp: new Date().toISOString(),
				details: { reason: "requires_approval", action, allowed: false, autonomyLevel: profile.level },
			});
			return {
				allowed: false,
				requiresApproval: true,
				isForbidden: false,
				reason: `Action "${action}" requires approval at level ${profile.level}`,
			};
		}

		// 7. Unknown action — safe default: requires approval
		this.emitEvent({
			type: "authorization",
			timestamp: new Date().toISOString(),
			details: { reason: "unknown_action", action, allowed: false, autonomyLevel: profile.level },
		});
		return {
			allowed: false,
			requiresApproval: true,
			isForbidden: false,
			reason: `Action "${action}" is not recognized — approval required as safe default`,
		};
	}

	/**
	 * Check whether an action can be decided autonomously (no approval needed).
	 *
	 * @param action - The action to check
	 * @param profile - The autonomy profile
	 * @returns True if the action can be auto-decided
	 */
	canAutoDecide(action: string, profile: AutonomyProfile): boolean {
		const result = this.canPerform(action, profile);
		return result.allowed && !result.requiresApproval;
	}

	/**
	 * Check whether an action requires approval.
	 *
	 * @param action - The action to check
	 * @param profile - The autonomy profile
	 * @returns True if the action requires approval
	 */
	requiresApproval(action: string, profile: AutonomyProfile): boolean {
		const result = this.canPerform(action, profile);
		return result.requiresApproval;
	}

	/**
	 * Check whether an action is explicitly forbidden.
	 *
	 * @param action - The action to check
	 * @param profile - The autonomy profile
	 * @returns True if the action is forbidden
	 */
	isForbidden(action: string, profile: AutonomyProfile): boolean {
		const result = this.canPerform(action, profile);
		return result.isForbidden;
	}

	// -----------------------------------------------------------------------
	// Capabilities
	// -----------------------------------------------------------------------

	/**
	 * Get the canonical capability set for a given autonomy level.
	 *
	 * @param level - The autonomy level (1-4)
	 * @returns The AutonomyCapabilities for that level
	 */
	getCapabilities(level: AutonomyLevel): AutonomyCapabilities {
		return AUTONOMY_CAPABILITIES[level];
	}

	/**
	 * Get the list of actions that are allowed for a given profile.
	 *
	 * This returns all capability-mapped actions that are true at the
	 * profile's level, minus any that are explicitly forbidden.
	 *
	 * @param profile - The autonomy profile
	 * @returns Array of allowed action names
	 */
	getAllowedActions(profile: AutonomyProfile): string[] {
		const caps = this.getCapabilities(profile.level);
		const forbidden = new Set([...GLOBALLY_FORBIDDEN_ACTIONS, ...caps.forbiddenFor, ...profile.forbiddenActions]);

		const allowed: string[] = [];

		for (const [action, capKey] of Object.entries(ACTION_TO_CAPABILITY)) {
			if ((caps[capKey] as boolean) && !forbidden.has(action)) {
				allowed.push(action);
			}
		}

		// Also include actions that are in requiresApprovalFor but approved
		// via profile threshold overrides
		for (const action of Object.keys(profile.approvalThresholds)) {
			if (profile.approvalThresholds[action] === "auto" && !forbidden.has(action)) {
				if (!allowed.includes(action)) {
					allowed.push(action);
				}
			}
		}

		return allowed.sort();
	}

	/**
	 * Get the list of forbidden actions for a profile.
	 *
	 * @param profile - The autonomy profile
	 * @returns Array of forbidden action names
	 */
	getForbiddenActions(profile: AutonomyProfile): string[] {
		const caps = this.getCapabilities(profile.level);
		const forbidden = new Set([...GLOBALLY_FORBIDDEN_ACTIONS, ...caps.forbiddenFor, ...profile.forbiddenActions]);

		// Include explicit "forbidden" thresholds
		for (const [action, threshold] of Object.entries(profile.approvalThresholds)) {
			if (threshold === "forbidden") {
				forbidden.add(action);
			}
		}

		return [...forbidden].sort();
	}

	// -----------------------------------------------------------------------
	// Emergency controls
	// -----------------------------------------------------------------------

	/**
	 * Check whether the emergency stop is active.
	 *
	 * @returns True if emergency stop is active
	 */
	isEmergencyStopped(): boolean {
		return this.emergencyStopActive;
	}

	/**
	 * Activate the emergency stop. Blocks all autonomous actions until
	 * released.
	 */
	async emergencyStop(): Promise<void> {
		this.emergencyStopActive = true;
		this.emitEvent({
			type: "emergency_stop",
			timestamp: new Date().toISOString(),
			details: { activated: true },
		});
	}

	/**
	 * Release the emergency stop. Requires a userId for audit trail.
	 *
	 * @param userId - The user releasing the emergency stop
	 */
	async releaseEmergencyStop(userId: string): Promise<void> {
		if (!userId) {
			throw new Error("userId is required to release emergency stop");
		}
		this.emergencyStopActive = false;
		this.emitEvent({
			type: "emergency_stop",
			timestamp: new Date().toISOString(),
			details: { activated: false, releasedBy: userId },
		});
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the engine configuration.
	 *
	 * @param config - Partial configuration to merge
	 */
	setConfig(config: Partial<AutonomyConfig>): void {
		this.config = { ...this.config, ...config };
		if (config.emergencyStopped !== undefined) {
			this.emergencyStopActive = config.emergencyStopped;
		}
	}

	/**
	 * Get the current engine configuration.
	 *
	 * @returns A copy of the current configuration
	 */
	getConfig(): AutonomyConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Validate whether a transition from one autonomy level to another is
	 * allowed.
	 *
	 * Any level can transition to any other valid level (1-4), provided
	 * the target level does not exceed maxLevel.
	 *
	 * @param from - The current autonomy level
	 * @param to - The desired autonomy level
	 * @returns True if the transition is valid
	 */
	validateTransition(from: AutonomyLevel, to: AutonomyLevel): boolean {
		if (![1, 2, 3, 4].includes(to) || ![1, 2, 3, 4].includes(from)) {
			return false;
		}
		if (to > this.config.maxLevel) {
			return false;
		}
		return true;
	}

	/**
	 * Get a human-readable name and description for an autonomy level.
	 *
	 * @param level - The autonomy level (1-4)
	 * @returns An object with name and description fields
	 */
	describeLevel(level: AutonomyLevel): AutonomyLevelDescription {
		return (
			LEVEL_DESCRIPTIONS[level] ?? {
				name: "Unknown",
				description: "Unknown autonomy level — no description available",
			}
		);
	}

	// -----------------------------------------------------------------------
	// Event system
	// -----------------------------------------------------------------------

	/**
	 * Register an event listener.
	 *
	 * @param listener - Callback for engine events
	 */
	onEvent(listener: (event: AutonomyEngineEvent) => void): void {
		this.eventListeners.push(listener);
	}

	/**
	 * Remove an event listener.
	 *
	 * @param listener - The listener to remove
	 */
	offEvent(listener: (event: AutonomyEngineEvent) => void): void {
		const idx = this.eventListeners.indexOf(listener);
		if (idx >= 0) {
			this.eventListeners.splice(idx, 1);
		}
	}

	/**
	 * Emit an event to all registered listeners.
	 *
	 * @param event - The event to emit
	 */
	private emitEvent(event: AutonomyEngineEvent): void {
		for (const listener of this.eventListeners) {
			try {
				listener(event);
			} catch {
				// Silently ignore listener errors — do not crash the engine
			}
		}
	}

	// -----------------------------------------------------------------------
	// Internal helpers
	// -----------------------------------------------------------------------

	/**
	 * Find the minimum autonomy level that grants a given capability.
	 *
	 * @param action - The action name
	 * @param currentLevel - The current level (to avoid suggesting same or lower)
	 * @returns The minimum level that allows this action, or undefined
	 */
	private findRequiredLevel(action: string, currentLevel: AutonomyLevel): AutonomyLevel | undefined {
		const capabilityKey = ACTION_TO_CAPABILITY[action];
		if (!capabilityKey) return undefined;

		for (let level = currentLevel + 1; level <= 4; level++) {
			const caps = AUTONOMY_CAPABILITIES[level as AutonomyLevel];
			if (caps[capabilityKey] as boolean) {
				return level as AutonomyLevel;
			}
		}
		return undefined;
	}
}
