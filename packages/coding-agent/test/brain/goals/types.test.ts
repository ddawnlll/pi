/**
 * Goal & Preference Domain Model — type definitions, validation, and serialization tests.
 *
 * Covers P15.A acceptance criteria:
 * - All types compile without errors
 * - Goal milestones trackable individually
 * - Preference categories defined
 * - Autonomy levels with explicit capabilities
 * - Decision class enum complete
 * - Test fixtures cover all types
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	ALL_AUTONOMY_LEVELS,
	ALL_CONDITION_OPERATORS,
	ALL_DECISION_CLASSES,
	ALL_DRIFT_INDICATOR_TYPES,
	ALL_DRIFT_SEVERITIES,
	ALL_GOAL_PRIORITIES,
	ALL_GOAL_STATUSES,
	ALL_PREFERENCE_CATEGORIES,
	ALL_PREFERENCE_SOURCES,
	AUTONOMY_CAPABILITIES,
	computeGoalsStats,
	createAutonomyProfile,
	createDecisionRule,
	createGoalCreateInput,
	createGoalDriftReport,
	createGoalRecord,
	createMilestone,
	createPreferenceCreateInput,
	createPreferenceRecord,
	type DecisionRule,
	deserializeAutonomyProfile,
	deserializeGoalDriftReport,
	deserializeGoalRecord,
	deserializePreferenceRecord,
	type GoalDriftReport,
	type GoalRecord,
	serializeAutonomyProfile,
	serializeGoalDriftReport,
	serializeGoalRecord,
	serializePreferenceRecord,
	validateAutonomyProfile,
	validateDecisionRule,
	validateGoalDriftReport,
	validateGoalRecord,
	validateMilestone,
	validatePreferenceRecord,
} from "../../../src/brain/goals/types.js";

// ---------------------------------------------------------------------------
// Enum / Const Lists
// ---------------------------------------------------------------------------

describe("enum constant lists", () => {
	test("ALL_AUTONOMY_LEVELS contains all 4 levels", () => {
		expect(ALL_AUTONOMY_LEVELS).toEqual([1, 2, 3, 4]);
		expect(ALL_AUTONOMY_LEVELS.length).toBe(4);
	});

	test("ALL_GOAL_STATUSES contains all 5 statuses", () => {
		expect(ALL_GOAL_STATUSES).toContain("active");
		expect(ALL_GOAL_STATUSES).toContain("completed");
		expect(ALL_GOAL_STATUSES).toContain("paused");
		expect(ALL_GOAL_STATUSES).toContain("cancelled");
		expect(ALL_GOAL_STATUSES).toContain("needs_review");
		expect(ALL_GOAL_STATUSES.length).toBe(5);
	});

	test("ALL_GOAL_PRIORITIES contains all 4 priorities", () => {
		expect(ALL_GOAL_PRIORITIES).toContain("critical");
		expect(ALL_GOAL_PRIORITIES).toContain("high");
		expect(ALL_GOAL_PRIORITIES).toContain("normal");
		expect(ALL_GOAL_PRIORITIES).toContain("low");
		expect(ALL_GOAL_PRIORITIES.length).toBe(4);
	});

	test("ALL_PREFERENCE_SOURCES contains all 4 sources", () => {
		expect(ALL_PREFERENCE_SOURCES).toContain("user_explicit");
		expect(ALL_PREFERENCE_SOURCES).toContain("user_implicit");
		expect(ALL_PREFERENCE_SOURCES).toContain("system_default");
		expect(ALL_PREFERENCE_SOURCES).toContain("learned");
		expect(ALL_PREFERENCE_SOURCES.length).toBe(4);
	});

	test("ALL_DECISION_CLASSES contains all 3 classes", () => {
		expect(ALL_DECISION_CLASSES).toContain("auto_decide");
		expect(ALL_DECISION_CLASSES).toContain("approval_required");
		expect(ALL_DECISION_CLASSES).toContain("never_auto_decide");
		expect(ALL_DECISION_CLASSES.length).toBe(3);
	});

	test("ALL_PREFERENCE_CATEGORIES contains all 6 categories", () => {
		expect(ALL_PREFERENCE_CATEGORIES).toContain("execution");
		expect(ALL_PREFERENCE_CATEGORIES).toContain("planning");
		expect(ALL_PREFERENCE_CATEGORIES).toContain("memory");
		expect(ALL_PREFERENCE_CATEGORIES).toContain("proposal");
		expect(ALL_PREFERENCE_CATEGORIES).toContain("dashboard");
		expect(ALL_PREFERENCE_CATEGORIES).toContain("autonomy");
		expect(ALL_PREFERENCE_CATEGORIES.length).toBe(6);
	});

	test("ALL_CONDITION_OPERATORS contains all 8 operators", () => {
		expect(ALL_CONDITION_OPERATORS).toContain("eq");
		expect(ALL_CONDITION_OPERATORS).toContain("neq");
		expect(ALL_CONDITION_OPERATORS).toContain("gt");
		expect(ALL_CONDITION_OPERATORS).toContain("gte");
		expect(ALL_CONDITION_OPERATORS).toContain("lt");
		expect(ALL_CONDITION_OPERATORS).toContain("lte");
		expect(ALL_CONDITION_OPERATORS).toContain("in");
		expect(ALL_CONDITION_OPERATORS).toContain("contains");
		expect(ALL_CONDITION_OPERATORS.length).toBe(8);
	});

	test("ALL_DRIFT_INDICATOR_TYPES contains all 4 types", () => {
		expect(ALL_DRIFT_INDICATOR_TYPES).toContain("rejection_pattern");
		expect(ALL_DRIFT_INDICATOR_TYPES).toContain("proposal_mismatch");
		expect(ALL_DRIFT_INDICATOR_TYPES).toContain("stale_goal");
		expect(ALL_DRIFT_INDICATOR_TYPES).toContain("priority_shift");
		expect(ALL_DRIFT_INDICATOR_TYPES.length).toBe(4);
	});

	test("ALL_DRIFT_SEVERITIES contains all 3 severities", () => {
		expect(ALL_DRIFT_SEVERITIES).toContain("low");
		expect(ALL_DRIFT_SEVERITIES).toContain("medium");
		expect(ALL_DRIFT_SEVERITIES).toContain("high");
		expect(ALL_DRIFT_SEVERITIES.length).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// AUTONOMY_CAPABILITIES
// ---------------------------------------------------------------------------

describe("AUTONOMY_CAPABILITIES", () => {
	test("has all 4 levels", () => {
		expect(Object.keys(AUTONOMY_CAPABILITIES).map(Number)).toEqual([1, 2, 3, 4]);
	});

	test("level 1 is Advisor (read-only insights and proposals)", () => {
		const caps = AUTONOMY_CAPABILITIES[1];
		expect(caps.canGenerateInsights).toBe(true);
		expect(caps.canProposeIdeas).toBe(true);
		expect(caps.canGeneratePlans).toBe(false);
		expect(caps.canExecutePlans).toBe(false);
		expect(caps.canValidatePlans).toBe(false);
		expect(caps.canRetryTransientFailures).toBe(false);
		expect(caps.canProduceReports).toBe(true);
		expect(caps.canProposeRoadmapChanges).toBe(false);
		expect(caps.canRecommendArchitecture).toBe(false);
		expect(caps.requiresApprovalFor).toContain("memory_creation");
		expect(caps.forbiddenFor).toEqual([]);
	});

	test("level 2 is Planner (can generate plans but not execute)", () => {
		const caps = AUTONOMY_CAPABILITIES[2];
		expect(caps.canGenerateInsights).toBe(true);
		expect(caps.canGeneratePlans).toBe(true);
		expect(caps.canValidatePlans).toBe(true);
		expect(caps.canExecutePlans).toBe(false);
		expect(caps.requiresApprovalFor).toContain("plan_execution");
		expect(caps.forbiddenFor).toEqual([]);
	});

	test("level 3 is Operator (can execute approved plans)", () => {
		const caps = AUTONOMY_CAPABILITIES[3];
		expect(caps.canExecutePlans).toBe(true);
		expect(caps.canRetryTransientFailures).toBe(true);
		expect(caps.canProduceReports).toBe(true);
		expect(caps.canProposeRoadmapChanges).toBe(false);
		expect(caps.canRecommendArchitecture).toBe(false);
		expect(caps.requiresApprovalFor).toContain("strategic_change");
		expect(caps.forbiddenFor).toContain("secret_access");
		expect(caps.forbiddenFor).toContain("destructive_cleanup");
		expect(caps.forbiddenFor).toContain("git_push");
		expect(caps.forbiddenFor).toContain("irreversible_deletion");
		expect(caps.forbiddenFor).toContain("bypass_validation_gate");
	});

	test("level 4 is Autonomous Strategist (full capabilities)", () => {
		const caps = AUTONOMY_CAPABILITIES[4];
		expect(caps.canGenerateInsights).toBe(true);
		expect(caps.canGeneratePlans).toBe(true);
		expect(caps.canExecutePlans).toBe(true);
		expect(caps.canProposeRoadmapChanges).toBe(true);
		expect(caps.canRecommendArchitecture).toBe(true);
		expect(caps.requiresApprovalFor).toContain("irreversible_actions");
		expect(caps.forbiddenFor).toContain("secret_access");
		expect(caps.forbiddenFor).toContain("destructive_cleanup");
		expect(caps.forbiddenFor).toContain("git_push");
	});
});

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

describe("createGoalRecord", () => {
	test("creates a valid goal record with defaults", () => {
		const goal = createGoalRecord({
			title: "Test goal",
			description: "A test goal",
		});

		expect(goal.id).toBeDefined();
		expect(goal.title).toBe("Test goal");
		expect(goal.description).toBe("A test goal");
		expect(goal.priority).toBe("normal");
		expect(goal.status).toBe("active");
		expect(goal.milestones).toEqual([]);
		expect(goal.relatedMemoryIds).toEqual([]);
		expect(goal.metadata).toEqual({});
		expect(goal.createdAt).toBeDefined();
		expect(goal.updatedAt).toBeDefined();
	});

	test("applies overrides correctly", () => {
		const goal = createGoalRecord({
			title: "Critical goal",
			description: "High priority goal",
			priority: "critical",
			status: "paused",
			category: "security",
			milestones: [createMilestone({ title: "Milestone 1" })],
			targetDate: "2026-12-31T00:00:00.000Z",
			relatedMemoryIds: ["mem-001"],
			metadata: { key: "value" },
		});

		expect(goal.priority).toBe("critical");
		expect(goal.status).toBe("paused");
		expect(goal.category).toBe("security");
		expect(goal.milestones).toHaveLength(1);
		expect(goal.milestones[0].title).toBe("Milestone 1");
		expect(goal.targetDate).toBe("2026-12-31T00:00:00.000Z");
		expect(goal.relatedMemoryIds).toEqual(["mem-001"]);
		expect(goal.metadata).toEqual({ key: "value" });
	});
});

describe("createMilestone", () => {
	test("creates a milestone with defaults", () => {
		const ms = createMilestone({ title: "First milestone" });

		expect(ms.id).toBeDefined();
		expect(ms.title).toBe("First milestone");
		expect(ms.completed).toBe(false);
		expect(ms.order).toBe(0);
		expect(ms.createdAt).toBeDefined();
		expect(ms.description).toBeUndefined();
	});

	test("creates a completed milestone", () => {
		const ms = createMilestone({
			title: "Done",
			completed: true,
			order: 1,
			description: "It is done",
		});

		expect(ms.completed).toBe(true);
		expect(ms.order).toBe(1);
		expect(ms.description).toBe("It is done");
	});
});

describe("createPreferenceRecord", () => {
	test("creates a preference record with defaults", () => {
		const pref = createPreferenceRecord({
			category: "execution",
			key: "parallel_off",
			value: false,
		});

		expect(pref.id).toBeDefined();
		expect(pref.category).toBe("execution");
		expect(pref.key).toBe("parallel_off");
		expect(pref.value).toBe(false);
		expect(pref.source).toBe("user_explicit");
		expect(pref.confidence).toBe(1.0);
		expect(pref.updatedAt).toBeDefined();
	});

	test("creates preference with overrides", () => {
		const pref = createPreferenceRecord({
			category: "planning",
			key: "queue_first",
			value: true,
			source: "user_implicit",
			confidence: 0.8,
			description: "Learned preference",
		});

		expect(pref.source).toBe("user_implicit");
		expect(pref.confidence).toBe(0.8);
		expect(pref.description).toBe("Learned preference");
	});
});

describe("createPreferenceCreateInput", () => {
	test("creates input with defaults", () => {
		const input = createPreferenceCreateInput({
			category: "memory",
			key: "auto_index",
			value: true,
		});

		expect(input.category).toBe("memory");
		expect(input.key).toBe("auto_index");
		expect(input.value).toBe(true);
		expect(input.source).toBe("user_explicit");
		expect(input.confidence).toBe(1.0);
	});
});

describe("createAutonomyProfile", () => {
	test("level 1 profile has correct defaults", () => {
		const profile = createAutonomyProfile(1);

		expect(profile.userId).toBe("default");
		expect(profile.level).toBe(1);
		expect(profile.forbiddenActions).toEqual([]);
		expect(profile.createdAt).toBeDefined();
		expect(profile.updatedAt).toBeDefined();
	});

	test("level 3 profile includes forbidden actions", () => {
		const profile = createAutonomyProfile(3);

		expect(profile.level).toBe(3);
		expect(profile.forbiddenActions).toContain("secret_access");
		expect(profile.forbiddenActions).toContain("git_push");
	});
});

describe("createDecisionRule", () => {
	test("creates an empty decision rule", () => {
		const rule = createDecisionRule();

		expect(rule.id).toBe("");
		expect(rule.action).toBe("");
		expect(rule.decisionClass).toBe("approval_required");
		expect(rule.conditions).toEqual([]);
		expect(rule.priority).toBe(0);
		expect(rule.description).toBe("");
	});
});

describe("createGoalDriftReport", () => {
	test("creates an empty drift report with generated id and timestamp", () => {
		const report = createGoalDriftReport();

		expect(report.id).toBeDefined();
		expect(report.goalId).toBe("");
		expect(report.goalTitle).toBe("");
		expect(report.severity).toBe("medium");
		expect(report.indicators).toEqual([]);
		expect(report.generatedAt).toBeDefined();
	});
});

describe("createGoalCreateInput", () => {
	test("creates input with required title", () => {
		const input = createGoalCreateInput("Build trusted second brain");

		expect(input.title).toBe("Build trusted second brain");
		expect(input.description).toBe("");
	});

	test("creates input with title and description", () => {
		const input = createGoalCreateInput("Test", "A description");

		expect(input.title).toBe("Test");
		expect(input.description).toBe("A description");
	});
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateGoalRecord", () => {
	test("accepts a valid goal record", () => {
		const goal = createGoalRecord({
			title: "Valid goal",
			description: "A valid goal for testing",
			category: "test",
		});

		const result = validateGoalRecord(goal);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	test("rejects null input", () => {
		const result = validateGoalRecord(null);
		expect(result.valid).toBe(false);
	});

	test("rejects missing title", () => {
		const result = validateGoalRecord({
			id: "test",
			description: "desc",
			priority: "normal",
			status: "active",
			category: "test",
			milestones: [],
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			relatedMemoryIds: [],
			metadata: {},
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("title"))).toBe(true);
	});

	test("rejects invalid priority", () => {
		const goal = createGoalRecord({
			title: "Test",
			description: "desc",
		});
		const invalid = { ...goal, priority: "invalid" };
		const result = validateGoalRecord(invalid);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("priority"))).toBe(true);
	});

	test("rejects invalid status", () => {
		const goal = createGoalRecord({
			title: "Test",
			description: "desc",
		});
		const invalid = { ...goal, status: "invalid" };
		const result = validateGoalRecord(invalid);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("status"))).toBe(true);
	});

	test("rejects invalid createdAt", () => {
		const goal = createGoalRecord({
			title: "Test",
			description: "desc",
		});
		const invalid = { ...goal, createdAt: "not-a-date" };
		const result = validateGoalRecord(invalid);
		expect(result.valid).toBe(false);
	});
});

describe("validatePreferenceRecord", () => {
	test("accepts a valid preference record", () => {
		const pref = createPreferenceRecord({
			category: "execution",
			key: "parallel_off",
			value: true,
		});

		const result = validatePreferenceRecord(pref);
		expect(result.valid).toBe(true);
	});

	test("rejects null input", () => {
		const result = validatePreferenceRecord(null);
		expect(result.valid).toBe(false);
	});

	test("rejects invalid category", () => {
		const pref = createPreferenceRecord({
			category: "execution" as const,
			key: "test",
			value: "val",
		});
		const invalid = { ...pref, category: "invalid" };
		const result = validatePreferenceRecord(invalid);
		expect(result.valid).toBe(false);
	});

	test("rejects invalid source", () => {
		const pref = createPreferenceRecord({
			category: "execution" as const,
			key: "test",
			value: "val",
		});
		const invalid = { ...pref, source: "invalid" };
		const result = validatePreferenceRecord(invalid);
		expect(result.valid).toBe(false);
	});

	test("rejects confidence out of range", () => {
		const pref = createPreferenceRecord({
			category: "execution" as const,
			key: "test",
			value: "val",
		});
		const invalid = { ...pref, confidence: 1.5 };
		const result = validatePreferenceRecord(invalid);
		expect(result.valid).toBe(false);
	});
});

describe("validateGoalDriftReport", () => {
	test("accepts a valid drift report", () => {
		const report: GoalDriftReport = {
			id: "drift-001",
			goalId: "goal-001",
			goalTitle: "Test goal",
			severity: "high",
			indicators: [
				{
					type: "rejection_pattern",
					details: "Multiple rejections detected",
					evidence: [],
					score: 0.8,
				},
			],
			generatedAt: "2026-05-21T00:00:00.000Z",
		};

		const result = validateGoalDriftReport(report);
		expect(result.valid).toBe(true);
	});

	test("rejects null input", () => {
		const result = validateGoalDriftReport(null);
		expect(result.valid).toBe(false);
	});

	test("rejects invalid severity", () => {
		const report: GoalDriftReport = {
			id: "drift-001",
			goalId: "goal-001",
			goalTitle: "Test",
			severity: "critical" as "high",
			indicators: [],
			generatedAt: "2026-05-21T00:00:00.000Z",
		};
		const invalid = { ...report, severity: "critical" };
		const result = validateGoalDriftReport(invalid);
		expect(result.valid).toBe(false);
	});
});

describe("validateMilestone", () => {
	test("accepts a valid milestone", () => {
		const ms = createMilestone({ title: "MS-1" });
		const result = validateMilestone(ms);
		expect(result.valid).toBe(true);
	});

	test("rejects null input", () => {
		const result = validateMilestone(null);
		expect(result.valid).toBe(false);
	});
});

describe("validateAutonomyProfile", () => {
	test("accepts a valid profile", () => {
		const profile = createAutonomyProfile(2);
		const result = validateAutonomyProfile(profile);
		expect(result.valid).toBe(true);
	});

	test("rejects invalid level", () => {
		const profile = createAutonomyProfile(2);
		const invalid = { ...profile, level: 5 };
		const result = validateAutonomyProfile(invalid);
		expect(result.valid).toBe(false);
	});
});

describe("validateDecisionRule", () => {
	test("accepts a valid rule", () => {
		const rule: DecisionRule = {
			id: "rule-001",
			action: "retry_transient_failure",
			decisionClass: "auto_decide",
			priority: 100,
			description: "Retry safe transient failures",
		};
		const result = validateDecisionRule(rule);
		expect(result.valid).toBe(true);
	});

	test("rejects missing action", () => {
		const rule = createDecisionRule();
		const result = validateDecisionRule(rule);
		expect(result.valid).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

describe("computeGoalsStats", () => {
	test("returns zero stats for empty goals", () => {
		const stats = computeGoalsStats([]);
		expect(stats.totalGoals).toBe(0);
		expect(stats.activeGoals).toBe(0);
		expect(stats.completedGoals).toBe(0);
		expect(stats.driftReports).toBe(0);
		expect(stats.openDriftReports).toBe(0);
	});

	test("computes correct stats for mixed goals", () => {
		const goals: GoalRecord[] = [
			createGoalRecord({ title: "G1", description: "d1", priority: "critical", status: "active" }),
			createGoalRecord({ title: "G2", description: "d2", priority: "high", status: "active" }),
			createGoalRecord({ title: "G3", description: "d3", priority: "normal", status: "completed" }),
			createGoalRecord({ title: "G4", description: "d4", priority: "low", status: "paused" }),
		];

		// Mark G3 as completed manually
		goals[2] = { ...goals[2], status: "completed", completedAt: "2026-05-21T00:00:00.000Z" };

		const driftReports: GoalDriftReport[] = [
			{
				id: "drift-001",
				goalId: goals[0].id,
				goalTitle: "G1",
				severity: "medium",
				indicators: [],
				generatedAt: "2026-05-21T00:00:00.000Z",
			},
		];

		const stats = computeGoalsStats(goals, driftReports);

		expect(stats.totalGoals).toBe(4);
		expect(stats.activeGoals).toBe(2);
		expect(stats.completedGoals).toBe(1);
		expect(stats.byStatus.active).toBe(2);
		expect(stats.byStatus.completed).toBe(1);
		expect(stats.byStatus.paused).toBe(1);
		expect(stats.byPriority.critical).toBe(1);
		expect(stats.byPriority.high).toBe(1);
		expect(stats.byPriority.normal).toBe(1);
		expect(stats.byPriority.low).toBe(1);
		expect(stats.driftReports).toBe(1);
		expect(stats.openDriftReports).toBe(1);
	});

	test("resolved drift reports not counted as open", () => {
		const driftReports: GoalDriftReport[] = [
			{
				id: "drift-001",
				goalId: "g1",
				goalTitle: "G1",
				severity: "high",
				indicators: [],
				generatedAt: "2026-05-21T00:00:00.000Z",
				resolvedAt: "2026-05-21T12:00:00.000Z",
				resolvedBy: "user",
			},
		];

		const stats = computeGoalsStats([], driftReports);
		expect(stats.driftReports).toBe(1);
		expect(stats.openDriftReports).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Serialization / Deserialization
// ---------------------------------------------------------------------------

describe("serialization round-trip", () => {
	test("GoalRecord serializes and deserializes correctly", () => {
		const record = createGoalRecord({
			title: "Serialize test",
			description: "Testing serialization round-trip",
			priority: "high",
			milestones: [createMilestone({ title: "MS-1" })],
		});

		const json = serializeGoalRecord(record);
		const parsed = deserializeGoalRecord(json);

		expect(parsed).toEqual(record);
		expect(typeof json).toBe("string");
	});

	test("PreferenceRecord serializes and deserializes correctly", () => {
		const record = createPreferenceRecord({
			category: "planning",
			key: "queue_first",
			value: "always",
			source: "user_explicit",
			confidence: 0.9,
			description: "Always queue first",
		});

		const json = serializePreferenceRecord(record);
		const parsed = deserializePreferenceRecord(json);

		expect(parsed).toEqual(record);
	});

	test("GoalDriftReport serializes and deserializes correctly", () => {
		const report: GoalDriftReport = {
			id: "drift-serialize-001",
			goalId: "goal-serialize-001",
			goalTitle: "Serialize test",
			severity: "low",
			indicators: [
				{
					type: "stale_goal",
					details: "Goal has not been updated in 30 days",
					evidence: [
						{
							type: "observation",
							path: ".pi/brain/goals/goals.json",
							id: "obs-stale-001",
						},
					],
					score: 0.4,
				},
			],
			generatedAt: "2026-05-21T00:00:00.000Z",
		};

		const json = serializeGoalDriftReport(report);
		const parsed = deserializeGoalDriftReport(json);

		expect(parsed).toEqual(report);
	});

	test("AutonomyProfile serializes and deserializes correctly", () => {
		const profile = createAutonomyProfile(3);
		const serialized = serializeAutonomyProfile(profile);
		const parsed = deserializeAutonomyProfile(serialized);

		expect(parsed).toEqual(profile);
	});
});

describe("deserialization rejects invalid data", () => {
	test("deserializeGoalRecord throws on invalid JSON", () => {
		expect(() => deserializeGoalRecord("not json")).toThrow();
	});

	test("deserializeGoalRecord throws on valid JSON but invalid structure", () => {
		expect(() => deserializeGoalRecord(JSON.stringify({}))).toThrow();
	});

	test("deserializePreferenceRecord throws on invalid JSON", () => {
		expect(() => deserializePreferenceRecord("not json")).toThrow();
	});

	test("deserializePreferenceRecord throws on valid JSON but invalid structure", () => {
		expect(() => deserializePreferenceRecord(JSON.stringify({ id: "test" }))).toThrow();
	});

	test("deserializeGoalDriftReport throws on invalid JSON", () => {
		expect(() => deserializeGoalDriftReport("not json")).toThrow();
	});

	test("deserializeAutonomyProfile throws on null", () => {
		expect(() => deserializeAutonomyProfile(null)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// Fixture Integration
// ---------------------------------------------------------------------------

describe("fixture deserialization — goal records", () => {
	const fixtureDir = join(__dirname, "../../fixtures/brain/goals");

	const goalFixtures = [
		{ file: "goal-record-primary.json", id: "goal-primary-001", title: "Build Pi into a trusted second brain" },
		{
			file: "goal-record-secondary.json",
			id: "goal-secondary-001",
			title: "Improve test coverage across all packages",
		},
		{ file: "goal-record-completed.json", id: "goal-completed-001", title: "Set up CI/CD pipeline" },
	];

	for (const { file, id, title } of goalFixtures) {
		test(`${file} deserializes as a valid GoalRecord`, () => {
			const fixturePath = join(fixtureDir, file);
			const json = readFileSync(fixturePath, "utf-8");
			const record = deserializeGoalRecord(json);

			expect(record.id).toBe(id);
			expect(record.title).toBe(title);
			expect(record.description).toBeDefined();
			expect(record.priority).toBeDefined();
			expect(record.status).toBeDefined();
			expect(record.milestones.length).toBeGreaterThanOrEqual(0);
			expect(typeof record.createdAt).toBe("string");
			expect(typeof record.updatedAt).toBe("string");
			expect(Array.isArray(record.relatedMemoryIds)).toBe(true);
			expect(typeof record.metadata).toBe("object");

			const result = validateGoalRecord(record);
			expect(result.valid).toBe(true);
		});
	}
});

describe("fixture deserialization — preference records", () => {
	const fixtureDir = join(__dirname, "../../fixtures/brain/goals");

	const prefFixtures = [
		{
			file: "preference-record-execution.json",
			id: "pref-exec-001",
			category: "execution" as const,
			key: "parallel_execution_preference",
		},
		{
			file: "preference-record-planning.json",
			id: "pref-plan-001",
			category: "planning" as const,
			key: "prefer_queueable_phases",
		},
		{
			file: "preference-record-autonomy.json",
			id: "pref-aut-001",
			category: "autonomy" as const,
			key: "default_autonomy_level",
		},
	];

	for (const { file, id, category, key } of prefFixtures) {
		test(`${file} deserializes as a valid PreferenceRecord`, () => {
			const fixturePath = join(fixtureDir, file);
			const json = readFileSync(fixturePath, "utf-8");
			const record = deserializePreferenceRecord(json);

			expect(record.id).toBe(id);
			expect(record.category).toBe(category);
			expect(record.key).toBe(key);
			expect(record.value).toBeDefined();
			expect(record.source).toBeDefined();
			expect(typeof record.confidence).toBe("number");
			expect(record.confidence).toBeGreaterThanOrEqual(0);
			expect(record.confidence).toBeLessThanOrEqual(1);
			expect(typeof record.updatedAt).toBe("string");

			const result = validatePreferenceRecord(record);
			expect(result.valid).toBe(true);
		});
	}
});

describe("fixture deserialization — drift report", () => {
	const fixtureDir = join(__dirname, "../../fixtures/brain/goals");

	test("drift-report.json deserializes correctly", () => {
		const fixturePath = join(fixtureDir, "drift-report.json");
		const json = readFileSync(fixturePath, "utf-8");
		const report = deserializeGoalDriftReport(json);

		expect(report.id).toBe("drift-001");
		expect(report.goalId).toBe("goal-primary-001");
		expect(report.goalTitle).toBe("Build Pi into a trusted second brain");
		expect(report.severity).toBe("medium");
		expect(report.indicators).toHaveLength(2);
		expect(report.indicators[0].type).toBe("rejection_pattern");
		expect(report.indicators[0].evidence).toHaveLength(1);
		expect(typeof report.indicators[0].score).toBe("number");

		const result = validateGoalDriftReport(report);
		expect(result.valid).toBe(true);
	});
});

describe("fixture deserialization — autonomy profile", () => {
	const fixtureDir = join(__dirname, "../../fixtures/brain/goals");

	test("autonomy-profile.json deserializes correctly", () => {
		const fixturePath = join(fixtureDir, "autonomy-profile.json");
		const json = readFileSync(fixturePath, "utf-8");
		const profile = deserializeAutonomyProfile(JSON.parse(json));

		expect(profile.userId).toBe("default");
		expect(profile.level).toBe(2);
		expect(profile.approvedCategories).toContain("execution");
		expect(profile.forbiddenActions).toContain("secret_access");
		expect(profile.forbiddenActions).toContain("git_push");
		expect(typeof profile.approvalThresholds).toBe("object");
		expect(profile.approvalThresholds.plan_execution).toBe("approval");

		const result = validateAutonomyProfile(profile);
		expect(result.valid).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Type Exhaustiveness (compile-time checks)
// ---------------------------------------------------------------------------

describe("type exhaustiveness — AutonomyLevel", () => {
	test("all 4 levels are covered in AUTONOMY_CAPABILITIES", () => {
		const covered = new Set(Object.keys(AUTONOMY_CAPABILITIES).map(Number));

		// This is a runtime assertion; the compile-time check is that
		// AUTONOMY_CAPABILITIES is typed as Record<AutonomyLevel, ...>
		for (const level of ALL_AUTONOMY_LEVELS) {
			expect(covered.has(level)).toBe(true);
		}
	});
});

describe("milestone tracking", () => {
	test("goal milestones are individually trackable", () => {
		const goal = createGoalRecord({
			title: "Trackable milestones",
			description: "Testing milestone tracking",
			milestones: [
				createMilestone({ title: "MS-1", completed: true, order: 1 }),
				createMilestone({ title: "MS-2", completed: false, order: 2 }),
				createMilestone({ title: "MS-3", completed: false, order: 3 }),
			],
		});

		expect(goal.milestones).toHaveLength(3);
		expect(goal.milestones[0].completed).toBe(true);
		expect(goal.milestones[1].completed).toBe(false);
		expect(goal.milestones[2].completed).toBe(false);

		// Simulate completing MS-2
		goal.milestones[1] = { ...goal.milestones[1], completed: true, completedAt: "2026-05-21T00:00:00.000Z" };
		expect(goal.milestones[1].completed).toBe(true);
		expect(goal.milestones[1].completedAt).toBeDefined();

		// Other milestones remain unchanged
		expect(goal.milestones[2].completed).toBe(false);
	});
});
