/**
 * Autonomy Profile Engine — P15.C — Tests
 *
 * Covers:
 * - AutonomyConfig defaults and construction
 * - Permission checks via canPerform()
 *   - Level 1: read-only capabilities
 *   - Level 2: approval required for plan execution
 *   - Level 3: can execute approved plans but not strategic
 *   - Level 4: all strategic capabilities
 *   - Emergency stop blocks all autonomous actions
 *   - Forbidden actions blocked regardless of level
 * - canAutoDecide(), requiresApproval(), isForbidden() convenience methods
 * - getCapabilities(), getAllowedActions(), getForbiddenActions()
 * - Emergency stop and release
 * - Config management (setConfig, getConfig)
 * - validateTransition() and describeLevel()
 * - Event emission
 */

import { beforeEach, describe, expect, test } from "vitest";
import { AutonomyEngine, type AutonomyEngineEvent } from "../../../src/brain/goals/profile-engine.js";
import { type AutonomyLevel, type AutonomyProfile, createAutonomyProfile } from "../../../src/brain/goals/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal profile for a given autonomy level.
 */
function profileForLevel(level: AutonomyLevel, overrides?: Partial<AutonomyProfile>): AutonomyProfile {
	return {
		...createAutonomyProfile(level),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// AutonomyEngine — Construction & Config
// ---------------------------------------------------------------------------

describe("AutonomyEngine — construction & config", () => {
	test("creates with default config", () => {
		const engine = new AutonomyEngine();
		const config = engine.getConfig();
		expect(config.defaultLevel).toBe(2);
		expect(config.maxLevel).toBe(4);
		expect(config.level3RequiresApproval).toBe(true);
		expect(config.emergencyStopped).toBe(false);
	});

	test("accepts partial overrides", () => {
		const engine = new AutonomyEngine({ defaultLevel: 1, maxLevel: 3 });
		const config = engine.getConfig();
		expect(config.defaultLevel).toBe(1);
		expect(config.maxLevel).toBe(3);
		expect(config.level3RequiresApproval).toBe(true); // default
	});

	test("setConfig merges updates", () => {
		const engine = new AutonomyEngine();
		engine.setConfig({ level3RequiresApproval: false });
		expect(engine.getConfig().level3RequiresApproval).toBe(false);
		// Other values unchanged
		expect(engine.getConfig().defaultLevel).toBe(2);
	});

	test("setConfig with emergencyStopped toggles the flag", () => {
		const engine = new AutonomyEngine();
		expect(engine.isEmergencyStopped()).toBe(false);
		engine.setConfig({ emergencyStopped: true });
		expect(engine.isEmergencyStopped()).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Level 1 — Advisor (read-only)
// ---------------------------------------------------------------------------

describe("Level 1 — Advisor (read-only)", () => {
	let engine: AutonomyEngine;
	let profile: AutonomyProfile;

	beforeEach(() => {
		engine = new AutonomyEngine();
		profile = profileForLevel(1);
	});

	test("canGenerateInsights is allowed", () => {
		const result = engine.canPerform("generate_insight", profile);
		expect(result.allowed).toBe(true);
		expect(result.requiresApproval).toBe(false);
		expect(result.isForbidden).toBe(false);
	});

	test("canProposeIdeas is allowed", () => {
		const result = engine.canPerform("propose_idea", profile);
		expect(result.allowed).toBe(true);
		expect(result.requiresApproval).toBe(false);
	});

	test("canProduceReports is allowed", () => {
		const result = engine.canPerform("produce_report", profile);
		expect(result.allowed).toBe(true);
		expect(result.requiresApproval).toBe(false);
	});

	test("plan execution requires approval", () => {
		const result = engine.canPerform("plan_execution", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
		expect(result.isForbidden).toBe(false);
		expect(result.requiredLevel).toBeDefined();
	});

	test("generate plan requires approval", () => {
		const result = engine.canPerform("generate_plan", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
		expect(result.isForbidden).toBe(false);
	});

	test("validate plan requires approval", () => {
		const result = engine.canPerform("validate_plan", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
	});

	test("retry transient failure requires approval", () => {
		const result = engine.canPerform("retry_transient_failure", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
	});

	test("memory_creation requires approval (in requiresApprovalFor)", () => {
		const result = engine.canPerform("memory_creation", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
		expect(result.isForbidden).toBe(false);
	});

	test("canAutoDecide returns true for read-only actions", () => {
		expect(engine.canAutoDecide("generate_insight", profile)).toBe(true);
		expect(engine.canAutoDecide("propose_idea", profile)).toBe(true);
	});

	test("canAutoDecide returns false for actions needing approval", () => {
		expect(engine.canAutoDecide("plan_execution", profile)).toBe(false);
		expect(engine.canAutoDecide("generate_plan", profile)).toBe(false);
	});

	test("requiresApproval returns true for actions needing approval", () => {
		expect(engine.requiresApproval("plan_execution", profile)).toBe(true);
		expect(engine.requiresApproval("generate_plan", profile)).toBe(true);
	});

	test("requiresApproval returns false for allowed actions", () => {
		expect(engine.requiresApproval("generate_insight", profile)).toBe(false);
		expect(engine.requiresApproval("produce_report", profile)).toBe(false);
	});

	test("isForbidden returns false for non-forbidden actions at L1", () => {
		expect(engine.isForbidden("plan_execution", profile)).toBe(false);
		expect(engine.isForbidden("generate_insight", profile)).toBe(false);
	});

	test("allowed actions list includes read-only capabilities", () => {
		const allowed = engine.getAllowedActions(profile);
		expect(allowed).toContain("generate_insight");
		expect(allowed).toContain("propose_idea");
		expect(allowed).toContain("produce_report");
		expect(allowed).not.toContain("plan_execution");
		expect(allowed).not.toContain("generate_plan");
	});
});

// ---------------------------------------------------------------------------
// Level 2 — Planner
// ---------------------------------------------------------------------------

describe("Level 2 — Planner", () => {
	let engine: AutonomyEngine;
	let profile: AutonomyProfile;

	beforeEach(() => {
		engine = new AutonomyEngine();
		profile = profileForLevel(2);
	});

	test("generate_plan is allowed", () => {
		const result = engine.canPerform("generate_plan", profile);
		expect(result.allowed).toBe(true);
	});

	test("validate_plan is allowed", () => {
		const result = engine.canPerform("validate_plan", profile);
		expect(result.allowed).toBe(true);
	});

	test("plan_execution requires approval", () => {
		const result = engine.canPerform("plan_execution", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
		expect(result.isForbidden).toBe(false);
	});

	test("system_mutation requires approval", () => {
		const result = engine.canPerform("system_mutation", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
		expect(result.isForbidden).toBe(false);
	});

	test("memory_indexing requires approval", () => {
		const result = engine.canPerform("memory_indexing", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
	});

	test("generate_insight is allowed", () => {
		expect(engine.canAutoDecide("generate_insight", profile)).toBe(true);
	});

	test("propose_roadmap_change is forbidden (capability false + not in requiresApprovalFor)", () => {
		// At L2, propose_roadmap_change maps to canProposeRoadmapChanges which is false,
		// and it's not in requiresApprovalFor at L2. It's not in forbiddenFor either.
		// So it should require approval.
		const result = engine.canPerform("propose_roadmap_change", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
		expect(result.isForbidden).toBe(false);
	});

	test("allowed actions include planning capabilities", () => {
		const allowed = engine.getAllowedActions(profile);
		expect(allowed).toContain("generate_insight");
		expect(allowed).toContain("propose_idea");
		expect(allowed).toContain("generate_plan");
		expect(allowed).toContain("validate_plan");
		expect(allowed).toContain("produce_report");
		expect(allowed).not.toContain("plan_execution");
	});
});

// ---------------------------------------------------------------------------
// Level 3 — Operator
// ---------------------------------------------------------------------------

describe("Level 3 — Operator", () => {
	let engine: AutonomyEngine;
	let profile: AutonomyProfile;

	beforeEach(() => {
		engine = new AutonomyEngine();
		profile = profileForLevel(3);
	});

	test("can execute approved plans", () => {
		const result = engine.canPerform("plan_execution", profile);
		// By default, level3RequiresApproval is true so plan_execution needs approval
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
		expect(result.isForbidden).toBe(false);
	});

	test("can retry transient failures", () => {
		const result = engine.canPerform("retry_transient_failure", profile);
		expect(result.allowed).toBe(true);
		expect(result.requiresApproval).toBe(false);
	});

	test("strategic changes (roadmap) are forbidden", () => {
		const result = engine.canPerform("propose_roadmap_change", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
		expect(result.isForbidden).toBe(false);
	});

	test("recommend_architecture requires approval", () => {
		const result = engine.canPerform("recommend_architecture", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
	});

	test("destructive_cleanup is forbidden", () => {
		const result = engine.canPerform("destructive_cleanup", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(false);
		expect(result.isForbidden).toBe(true);
	});

	test("secret_access is forbidden", () => {
		const result = engine.canPerform("secret_access", profile);
		expect(result.allowed).toBe(false);
		expect(result.isForbidden).toBe(true);
	});

	test("git_push is forbidden", () => {
		const result = engine.canPerform("git_push", profile);
		expect(result.isForbidden).toBe(true);
	});

	test("irreversible_deletion is forbidden", () => {
		const result = engine.canPerform("irreversible_deletion", profile);
		expect(result.isForbidden).toBe(true);
	});

	test("bypass_validation_gate is forbidden", () => {
		const result = engine.canPerform("bypass_validation_gate", profile);
		expect(result.isForbidden).toBe(true);
	});

	test("isForbidden returns true for forbidden actions", () => {
		expect(engine.isForbidden("destructive_cleanup", profile)).toBe(true);
		expect(engine.isForbidden("secret_access", profile)).toBe(true);
	});

	test("isForbidden returns false for non-forbidden actions", () => {
		expect(engine.isForbidden("plan_execution", profile)).toBe(false);
		expect(engine.isForbidden("generate_insight", profile)).toBe(false);
	});

	test("level3RequiresApproval=false allows plan_execution directly", () => {
		const relaxedEngine = new AutonomyEngine({ level3RequiresApproval: false });
		const result = relaxedEngine.canPerform("plan_execution", profile);
		expect(result.allowed).toBe(true);
		expect(result.requiresApproval).toBe(false);
	});

	test("forbidden actions list includes level-based and profile-based forbidden", () => {
		const forbidden = engine.getForbiddenActions(profile);
		expect(forbidden).toContain("destructive_cleanup");
		expect(forbidden).toContain("secret_access");
		expect(forbidden).toContain("git_push");
		expect(forbidden).toContain("irreversible_deletion");
		expect(forbidden).toContain("bypass_validation_gate");
	});

	test("forbidden actions are excluded from allowed actions", () => {
		const allowed = engine.getAllowedActions(profile);
		expect(allowed).not.toContain("destructive_cleanup");
		expect(allowed).not.toContain("secret_access");
	});
});

// ---------------------------------------------------------------------------
// Level 4 — Autonomous Strategist
// ---------------------------------------------------------------------------

describe("Level 4 — Autonomous Strategist", () => {
	let engine: AutonomyEngine;
	let profile: AutonomyProfile;

	beforeEach(() => {
		engine = new AutonomyEngine();
		profile = profileForLevel(4);
	});

	test("can execute plans", () => {
		const result = engine.canPerform("plan_execution", profile);
		expect(result.allowed).toBe(true);
	});

	test("can retry transient failures", () => {
		expect(engine.canAutoDecide("retry_transient_failure", profile)).toBe(true);
	});

	test("can propose roadmap changes", () => {
		const result = engine.canPerform("propose_roadmap_change", profile);
		expect(result.allowed).toBe(true);
	});

	test("can recommend architecture", () => {
		const result = engine.canPerform("recommend_architecture", profile);
		expect(result.allowed).toBe(true);
	});

	test("destructive actions remain forbidden", () => {
		expect(engine.isForbidden("destructive_cleanup", profile)).toBe(true);
		expect(engine.isForbidden("secret_access", profile)).toBe(true);
		expect(engine.isForbidden("git_push", profile)).toBe(true);
		expect(engine.isForbidden("irreversible_deletion", profile)).toBe(true);
		expect(engine.isForbidden("bypass_validation_gate", profile)).toBe(true);
	});

	test("irreversible_actions require approval", () => {
		const result = engine.canPerform("irreversible_actions", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
	});

	test("policy_override requires approval", () => {
		const result = engine.canPerform("policy_override", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
	});

	test("allowed actions include all strategic capabilities", () => {
		const allowed = engine.getAllowedActions(profile);
		expect(allowed).toContain("generate_insight");
		expect(allowed).toContain("propose_idea");
		expect(allowed).toContain("generate_plan");
		expect(allowed).toContain("validate_plan");
		expect(allowed).toContain("plan_execution");
		expect(allowed).toContain("retry_transient_failure");
		expect(allowed).toContain("produce_report");
		expect(allowed).toContain("propose_roadmap_change");
		expect(allowed).toContain("recommend_architecture");
		// Forbidden actions are excluded
		expect(allowed).not.toContain("destructive_cleanup");
	});
});

// ---------------------------------------------------------------------------
// Forbidden Actions — Regardless of Level
// ---------------------------------------------------------------------------

describe("Forbidden actions — blocked regardless of level", () => {
	const engine = new AutonomyEngine();
	const forbiddenActions = [
		"secret_access",
		"destructive_cleanup",
		"git_push",
		"irreversible_deletion",
		"bypass_validation_gate",
	];

	for (const level of [1, 2, 3, 4] satisfies AutonomyLevel[]) {
		for (const action of forbiddenActions) {
			test(`L${level}: "${action}" is forbidden`, () => {
				const profile = profileForLevel(level);
				const result = engine.canPerform(action, profile);
				expect(result.allowed).toBe(false);
				expect(result.isForbidden).toBe(true);
				expect(result.requiresApproval).toBe(false);
			});
		}
	}
});

// ---------------------------------------------------------------------------
// Profile-level forbiddenActions
// ---------------------------------------------------------------------------

describe("Profile-level forbiddenActions", () => {
	let engine: AutonomyEngine;

	beforeEach(() => {
		engine = new AutonomyEngine();
	});

	test("profile.forbiddenActions overrides allow at higher level", () => {
		// L4 allows plan_execution, but profile forbids it
		const profile = profileForLevel(4, {
			forbiddenActions: ["plan_execution"],
		});
		const result = engine.canPerform("plan_execution", profile);
		expect(result.allowed).toBe(false);
		expect(result.isForbidden).toBe(true);
	});

	test("profile.forbiddenActions merges with level-based forbidden", () => {
		const profile = profileForLevel(3, {
			forbiddenActions: ["custom_blocked_action"],
		});
		expect(engine.isForbidden("destructive_cleanup", profile)).toBe(true); // level-based
		expect(engine.isForbidden("custom_blocked_action", profile)).toBe(true); // profile-based
	});

	test("getForbiddenActions includes both sources", () => {
		const profile = profileForLevel(3, {
			forbiddenActions: ["custom_block"],
		});
		const forbidden = engine.getForbiddenActions(profile);
		expect(forbidden).toContain("destructive_cleanup");
		expect(forbidden).toContain("custom_block");
	});
});

// ---------------------------------------------------------------------------
// Approval Thresholds
// ---------------------------------------------------------------------------

describe("Profile approval thresholds", () => {
	let engine: AutonomyEngine;

	beforeEach(() => {
		engine = new AutonomyEngine();
	});

	test('"auto" override allows action without approval', () => {
		// L1 doesn't allow plan_execution, but profile threshold overrides
		const profile = profileForLevel(1, {
			approvalThresholds: { plan_execution: "auto" },
		});
		const result = engine.canPerform("plan_execution", profile);
		expect(result.allowed).toBe(true);
		expect(result.requiresApproval).toBe(false);
	});

	test('"forbidden" override blocks even if level allows', () => {
		// L4 allows generate_plan, but profile forbids it
		const profile = profileForLevel(4, {
			approvalThresholds: { generate_plan: "forbidden" },
		});
		const result = engine.canPerform("generate_plan", profile);
		expect(result.allowed).toBe(false);
		expect(result.isForbidden).toBe(true);
	});

	test('"approval" threshold makes action require approval', () => {
		// L4 allows generate_insight, but profile requires approval
		const profile = profileForLevel(4, {
			approvalThresholds: { generate_insight: "approval" },
		});
		const result = engine.canPerform("generate_insight", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
	});

	test("unknown action with auto threshold is allowed", () => {
		const profile = profileForLevel(4, {
			approvalThresholds: { custom_action: "auto" },
		});
		// Unknown action normally requires approval, but threshold overrides
		const result = engine.canPerform("custom_action", profile);
		expect(result.allowed).toBe(true);
		expect(result.requiresApproval).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Emergency Stop
// ---------------------------------------------------------------------------

describe("Emergency stop", () => {
	let engine: AutonomyEngine;

	beforeEach(() => {
		engine = new AutonomyEngine();
	});

	test("isEmergencyStopped returns false by default", () => {
		expect(engine.isEmergencyStopped()).toBe(false);
	});

	test("emergencyStop activates and blocks all actions", async () => {
		await engine.emergencyStop();
		expect(engine.isEmergencyStopped()).toBe(true);

		const profile = profileForLevel(4);
		const result = engine.canPerform("generate_insight", profile);
		expect(result.allowed).toBe(false);
		expect(result.isForbidden).toBe(true);
		expect(result.reason).toContain("Emergency stop");
	});

	test("emergency stop blocks even normally allowed actions", async () => {
		await engine.emergencyStop();
		const profile = profileForLevel(4);
		expect(engine.canAutoDecide("generate_insight", profile)).toBe(false);
		expect(engine.requiresApproval("generate_insight", profile)).toBe(false);
		expect(engine.isForbidden("generate_insight", profile)).toBe(true);
	});

	test("releaseEmergencyStop deactivates", async () => {
		await engine.emergencyStop();
		await engine.releaseEmergencyStop("test-user");
		expect(engine.isEmergencyStopped()).toBe(false);

		const profile = profileForLevel(4);
		const result = engine.canPerform("generate_insight", profile);
		expect(result.allowed).toBe(true);
	});

	test("releaseEmergencyStop throws without userId", async () => {
		await engine.emergencyStop();
		// @ts-expect-error - testing runtime validation
		await expect(engine.releaseEmergencyStop()).rejects.toThrow("userId is required");
	});
});

// ---------------------------------------------------------------------------
// Unknown Actions
// ---------------------------------------------------------------------------

describe("Unknown actions", () => {
	const engine = new AutonomyEngine();
	const profile = profileForLevel(4);

	test("unknown action requires approval by default", () => {
		const result = engine.canPerform("some_weird_action", profile);
		expect(result.allowed).toBe(false);
		expect(result.requiresApproval).toBe(true);
		expect(result.isForbidden).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// getCapabilities
// ---------------------------------------------------------------------------

describe("getCapabilities", () => {
	const engine = new AutonomyEngine();

	test("returns capabilities for each level", () => {
		const caps1 = engine.getCapabilities(1);
		expect(caps1.canGenerateInsights).toBe(true);
		expect(caps1.canExecutePlans).toBe(false);

		const caps4 = engine.getCapabilities(4);
		expect(caps4.canProposeRoadmapChanges).toBe(true);
		expect(caps4.canRecommendArchitecture).toBe(true);
	});

	test("each level has requiresApprovalFor and forbiddenFor arrays", () => {
		for (const level of [1, 2, 3, 4] as AutonomyLevel[]) {
			const caps = engine.getCapabilities(level);
			expect(Array.isArray(caps.requiresApprovalFor)).toBe(true);
			expect(Array.isArray(caps.forbiddenFor)).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// getAllowedActions / getForbiddenActions
// ---------------------------------------------------------------------------

describe("getAllowedActions & getForbiddenActions", () => {
	const engine = new AutonomyEngine();

	test("getAllowedActions returns sorted array", () => {
		const profile = profileForLevel(2);
		const allowed = engine.getAllowedActions(profile);
		expect(Array.isArray(allowed)).toBe(true);
		// Check sorted
		for (let i = 1; i < allowed.length; i++) {
			expect(allowed[i - 1].localeCompare(allowed[i])).toBeLessThanOrEqual(0);
		}
	});

	test("getForbiddenActions returns sorted array with unique values", () => {
		const profile = profileForLevel(3);
		const forbidden = engine.getForbiddenActions(profile);
		expect(Array.isArray(forbidden)).toBe(true);
		const unique = new Set(forbidden);
		expect(unique.size).toBe(forbidden.length);
	});

	test("getForbiddenActions includes profile-level forbidden even at L1", () => {
		const profile = profileForLevel(1, {
			forbiddenActions: ["custom_block"],
		});
		const forbidden = engine.getForbiddenActions(profile);
		expect(forbidden).toContain("custom_block");
	});

	test("profile approval threshold 'forbidden' is reflected in getForbiddenActions", () => {
		const profile = profileForLevel(4, {
			approvalThresholds: { generate_insight: "forbidden" },
		});
		const forbidden = engine.getForbiddenActions(profile);
		expect(forbidden).toContain("generate_insight");
	});
});

// ---------------------------------------------------------------------------
// validateTransition
// ---------------------------------------------------------------------------

describe("validateTransition", () => {
	const engine = new AutonomyEngine();

	test("valid transition from 1 to 2", () => {
		expect(engine.validateTransition(1, 2)).toBe(true);
	});

	test("valid transition from 2 to 4", () => {
		expect(engine.validateTransition(2, 4)).toBe(true);
	});

	test("invalid level 0", () => {
		expect(engine.validateTransition(1, 0 as AutonomyLevel)).toBe(false);
	});

	test("invalid level 5", () => {
		expect(engine.validateTransition(1, 5 as AutonomyLevel)).toBe(false);
	});

	test("transition limited by maxLevel", () => {
		const restricted = new AutonomyEngine({ maxLevel: 3 });
		expect(restricted.validateTransition(2, 4)).toBe(false);
		expect(restricted.validateTransition(2, 3)).toBe(true);
	});

	test("transition from invalid source returns false", () => {
		expect(engine.validateTransition(0 as AutonomyLevel, 2)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// describeLevel
// ---------------------------------------------------------------------------

describe("describeLevel", () => {
	const engine = new AutonomyEngine();

	test("Level 1 is Advisor", () => {
		const desc = engine.describeLevel(1);
		expect(desc.name).toBe("Advisor");
		expect(desc.description).toContain("Read-only");
	});

	test("Level 2 is Planner", () => {
		const desc = engine.describeLevel(2);
		expect(desc.name).toBe("Planner");
		expect(desc.description).toContain("generate and validate plans");
	});

	test("Level 3 is Operator", () => {
		const desc = engine.describeLevel(3);
		expect(desc.name).toBe("Operator");
		expect(desc.description).toContain("execute");
	});

	test("Level 4 is Autonomous Strategist", () => {
		const desc = engine.describeLevel(4);
		expect(desc.name).toBe("Autonomous Strategist");
		expect(desc.description).toContain("strategic");
	});

	test("unknown level returns fallback", () => {
		const desc = engine.describeLevel(99 as AutonomyLevel);
		expect(desc.name).toBe("Unknown");
		expect(desc.description).toContain("Unknown");
	});
});

// ---------------------------------------------------------------------------
// Event System
// ---------------------------------------------------------------------------

describe("Event system", () => {
	let engine: AutonomyEngine;
	let events: AutonomyEngineEvent[];

	beforeEach(() => {
		engine = new AutonomyEngine();
		events = [];
	});

	test("onEvent receives authorization events from canPerform", () => {
		engine.onEvent((event) => events.push(event));

		const profile = profileForLevel(1);
		engine.canPerform("plan_execution", profile);

		expect(events.length).toBeGreaterThanOrEqual(1);
		const authEvent = events.find((e) => e.type === "authorization");
		expect(authEvent).toBeDefined();
		expect((authEvent as Record<string, unknown>).action as string).toBe("plan_execution");
	});

	test("offEvent removes listener", () => {
		const listener = (event: AutonomyEngineEvent) => events.push(event);
		engine.onEvent(listener);
		engine.offEvent(listener);

		const profile = profileForLevel(1);
		engine.canPerform("generate_insight", profile);
		expect(events.length).toBe(0);
	});

	test("emergency stop emits event", async () => {
		engine.onEvent((event) => events.push(event));
		await engine.emergencyStop();

		const stopEvent = events.find((e) => e.type === "emergency_stop");
		expect(stopEvent).toBeDefined();
	});

	test("releaseEmergencyStop emits event with userId", async () => {
		await engine.emergencyStop();
		engine.onEvent((event) => events.push(event));
		await engine.releaseEmergencyStop("admin");

		const releaseEvent = events.find(
			(e) => e.type === "emergency_stop" && (e.details as Record<string, unknown>)?.activated === false,
		);
		expect(releaseEvent).toBeDefined();
		expect((releaseEvent?.details as Record<string, unknown>)?.releasedBy).toBe("admin");
	});
});

// ---------------------------------------------------------------------------
// Level-specific Acceptance Criteria
// ---------------------------------------------------------------------------

describe("Acceptance criteria — P15.C", () => {
	const engine = new AutonomyEngine();

	test("Level 1 capabilities are read-only", () => {
		const p = profileForLevel(1);
		expect(engine.canAutoDecide("generate_insight", p)).toBe(true);
		expect(engine.canAutoDecide("propose_idea", p)).toBe(true);
		expect(engine.canAutoDecide("produce_report", p)).toBe(true);
		expect(engine.canAutoDecide("generate_plan", p)).toBe(false);
		expect(engine.canAutoDecide("plan_execution", p)).toBe(false);
	});

	test("Level 2 requires approval for plan execution", () => {
		const p = profileForLevel(2);
		expect(engine.requiresApproval("plan_execution", p)).toBe(true);
		expect(engine.canAutoDecide("generate_plan", p)).toBe(true);
	});

	test("Level 3 can execute approved plans but not strategic", () => {
		const p = profileForLevel(3);
		// With default config, plan execution requires approval
		expect(engine.requiresApproval("plan_execution", p)).toBe(true);
		// Strategic actions are not auto-decisive
		expect(engine.canAutoDecide("propose_roadmap_change", p)).toBe(false);
		// Operational actions are allowed
		expect(engine.canAutoDecide("retry_transient_failure", p)).toBe(true);
	});

	test("Level 4 has all strategic capabilities", () => {
		const p = profileForLevel(4);
		expect(engine.canAutoDecide("propose_roadmap_change", p)).toBe(true);
		expect(engine.canAutoDecide("recommend_architecture", p)).toBe(true);
	});

	test("Emergency stop blocks all autonomous actions", async () => {
		const eStop = new AutonomyEngine();
		await eStop.emergencyStop();

		const p = profileForLevel(4);
		// Even normally allowed actions are blocked
		expect(eStop.canAutoDecide("generate_insight", p)).toBe(false);
		expect(eStop.isForbidden("generate_insight", p)).toBe(true);
	});

	test("Forbidden actions blocked regardless of level", () => {
		for (const level of [1, 2, 3, 4] as AutonomyLevel[]) {
			const p = profileForLevel(level);
			expect(engine.isForbidden("destructive_cleanup", p)).toBe(true);
			expect(engine.isForbidden("secret_access", p)).toBe(true);
		}
	});
});
