/**
 * Future Phase Suggestion Engine — P17.F tests
 *
 * Covers acceptance criteria:
 * - Failures generate fix suggestions
 * - Bottlenecks generate optimization suggestions
 * - Goals generate advancement suggestions
 * - Suggestions ranked by priority
 * - Each suggestion includes rationale
 * - Max 3 suggestions by default
 */

import { describe, expect, test } from "vitest";
import type { GoalRecord } from "../../../src/brain/goals/types.js";
import { FutureSuggestionEngine } from "../../../src/brain/reflection/future-suggestions.js";
import type { FuturePhaseSuggestion, ReflectionReport } from "../../../src/brain/reflection/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function sampleReflection(overrides?: Partial<ReflectionReport>): ReflectionReport {
	return {
		id: "refl-001",
		planExecId: "exec-001",
		planTitle: "Test Plan",
		summary: "A test reflection",
		whatPeopleNeedToKnow: "Nothing special",
		whatRan: ["Phase 1: Setup", "Phase 2: Build", "Phase 3: Deploy"],
		whatWorked: ["Setup completed", "Build passed"],
		whatFailed: ["Deploy timeout", "Lint validation failed"],
		whatSlowedDown: ["Queue wait times", "Retry overhead"],
		workspaceCount: 10,
		successCount: 7,
		failureCount: 3,
		retryCount: 2,
		successRate: 0.7,
		avgRetryCount: 0.2,
		totalDuration: 120_000,
		validationFailures: 1,
		memoriesToCreate: [],
		proposalsToGenerate: [],
		futurePhaseSuggestions: [],
		policyStops: 0,
		approvalRequests: 0,
		safetyInterventions: 0,
		createdAt: new Date().toISOString(),
		confidence: 0.85,
		sources: [],
		...overrides,
	};
}

function sampleGoals(): GoalRecord[] {
	return [
		{
			id: "goal-001",
			title: "Improve Deployment Reliability",
			description: "Make the deployment pipeline more reliable with automatic rollbacks and health checks",
			priority: "high",
			status: "active",
			category: "infrastructure",
			milestones: [
				{
					id: "m1",
					title: "Add health checks",
					completed: true,
					completedAt: new Date().toISOString(),
					order: 1,
					createdAt: new Date().toISOString(),
				},
				{
					id: "m2",
					title: "Implement rollbacks",
					completed: false,
					order: 2,
					createdAt: new Date().toISOString(),
				},
			],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			relatedMemoryIds: ["mem-001"],
			metadata: {},
		},
		{
			id: "goal-002",
			title: "Reduce Build Times",
			description: "Optimize CI/CD pipeline to reduce build times by 50%",
			priority: "normal",
			status: "active",
			category: "performance",
			milestones: [
				{
					id: "m3",
					title: "Cache dependencies",
					completed: true,
					completedAt: new Date().toISOString(),
					order: 1,
					createdAt: new Date().toISOString(),
				},
				{ id: "m4", title: "Parallelize builds", completed: false, order: 2, createdAt: new Date().toISOString() },
			],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			relatedMemoryIds: ["mem-002"],
			metadata: {},
		},
	];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FutureSuggestionEngine", () => {
	// ---- Configuration ----

	test("constructor uses default config when no args provided", () => {
		const engine = new FutureSuggestionEngine();
		const config = engine.getConfig();
		expect(config.goalAlignmentWeight).toBe(0.4);
		expect(config.bottleneckSeverityWeight).toBe(0.3);
		expect(config.failureFrequencyWeight).toBe(0.3);
		expect(config.maxSuggestions).toBe(3);
	});

	test("constructor merges partial config with defaults", () => {
		const engine = new FutureSuggestionEngine({ maxSuggestions: 5 });
		const config = engine.getConfig();
		expect(config.maxSuggestions).toBe(5);
		expect(config.goalAlignmentWeight).toBe(0.4);
	});

	test("setConfig updates config", () => {
		const engine = new FutureSuggestionEngine();
		engine.setConfig({ goalAlignmentWeight: 0.5, maxSuggestions: 2 });
		const config = engine.getConfig();
		expect(config.goalAlignmentWeight).toBe(0.5);
		expect(config.maxSuggestions).toBe(2);
	});

	test("getConfig returns a copy, not a reference", () => {
		const engine = new FutureSuggestionEngine();
		const config = engine.getConfig();
		config.maxSuggestions = 99;
		expect(engine.getConfig().maxSuggestions).toBe(3);
	});

	// ---- fromFailures ----

	test("fromFailures generates fix suggestions from failures", () => {
		const engine = new FutureSuggestionEngine();
		const scores = new Map<string, number>([
			["Deploy timeout", 0.8],
			["Lint validation failed", 0.6],
		]);
		const suggestions = engine.fromFailures(["Deploy timeout", "Lint validation failed"], scores);

		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions.length).toBeLessThanOrEqual(3);

		for (const s of suggestions) {
			expect(s.title).toBeTruthy();
			expect(s.rationale).toBeTruthy();
			expect(s.rationale).toContain("Failure");
			expect(s.estimatedWorkstreams).toBeGreaterThan(0);
			expect(s.priority).toMatch(/^(critical|high|normal|low)$/);
		}
	});

	test("fromFailures deduplicates similar failures", () => {
		const engine = new FutureSuggestionEngine();
		const scores = new Map<string, number>([
			["Deploy timeout", 0.8],
			["Also deploy timeout", 0.7],
		]);
		const suggestions = engine.fromFailures(["Deploy timeout", "Also deploy timeout"], scores);
		// Both are timeouts, so they should group into one "Performance & Stability Fix"
		const timeoutTitles = suggestions.filter((s) => s.title.includes("Performance"));
		expect(timeoutTitles.length).toBe(1);
	});

	test("fromFailures handles empty failures", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromFailures([], new Map());
		expect(suggestions).toEqual([]);
	});

	// ---- fromBottlenecks ----

	test("fromBottlenecks generates optimization suggestions", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromBottlenecks(["Queue wait times", "Retry overhead"]);

		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions.length).toBeLessThanOrEqual(3);

		for (const s of suggestions) {
			expect(s.title).toBeTruthy();
			expect(s.rationale).toBeTruthy();
			expect(s.estimatedWorkstreams).toBeGreaterThan(0);
		}
	});

	test("fromBottlenecks handles queue-related bottlenecks", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromBottlenecks(["Queue wait times"]);
		expect(suggestions[0].title).toContain("Queue");
	});

	test("fromBottlenecks handles empty bottlenecks", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromBottlenecks([]);
		expect(suggestions).toEqual([]);
	});

	// ---- fromGoals ----

	test("fromGoals generates advancement suggestions from active goals", () => {
		const engine = new FutureSuggestionEngine();
		const goals = sampleGoals();
		const suggestions = engine.fromGoals(goals, ["Phase 1: Setup"]);

		expect(suggestions.length).toBeGreaterThan(0);
		for (const s of suggestions) {
			expect(s.title).toContain("Advance Goal");
			expect(s.rationale).toBeTruthy();
			expect(s.priority).toMatch(/^(critical|high|normal|low)$/);
		}
	});

	test("fromGoals skips completed goals", () => {
		const engine = new FutureSuggestionEngine();
		const goals: GoalRecord[] = [
			{
				...sampleGoals()[0],
				status: "completed",
			},
		];
		const suggestions = engine.fromGoals(goals, []);
		expect(suggestions).toEqual([]);
	});

	test("fromGoals skips cancelled goals", () => {
		const engine = new FutureSuggestionEngine();
		const goals: GoalRecord[] = [
			{
				...sampleGoals()[0],
				status: "cancelled",
			},
		];
		const suggestions = engine.fromGoals(goals, []);
		expect(suggestions).toEqual([]);
	});

	test("fromGoals handles empty goals", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromGoals([], []);
		expect(suggestions).toEqual([]);
	});

	// ---- fromReflection (integration) ----

	test("fromReflection generates suggestions from a full reflection report", () => {
		const engine = new FutureSuggestionEngine();
		const report = sampleReflection();
		const goals = sampleGoals();
		const suggestions = engine.fromReflection(report, goals);

		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions.length).toBeLessThanOrEqual(3);
	});

	test("fromReflection respects maxSuggestions config", () => {
		const engine = new FutureSuggestionEngine({ maxSuggestions: 1 });
		const report = sampleReflection({
			whatFailed: ["Failure A", "Failure B", "Failure C"],
			whatSlowedDown: ["Bottleneck A", "Bottleneck B"],
		});
		const suggestions = engine.fromReflection(report);
		expect(suggestions.length).toBe(1);
	});

	test("fromReflection works without goals", () => {
		const engine = new FutureSuggestionEngine();
		const report = sampleReflection();
		const suggestions = engine.fromReflection(report);
		expect(suggestions.length).toBeGreaterThan(0);
	});

	test("fromReflection returns empty when nothing to suggest", () => {
		const engine = new FutureSuggestionEngine();
		const report = sampleReflection({
			whatFailed: [],
			whatSlowedDown: [],
		});
		const suggestions = engine.fromReflection(report);
		expect(suggestions.length).toBe(0);
	});

	test("each suggestion includes a rationale", () => {
		const engine = new FutureSuggestionEngine();
		const report = sampleReflection();
		const suggestions = engine.fromReflection(report);
		for (const s of suggestions) {
			expect(s.rationale).toBeTruthy();
			expect(s.rationale.length).toBeGreaterThan(10);
		}
	});

	// ---- rankSuggestions ----

	test("rankSuggestions sorts by score descending", () => {
		const engine = new FutureSuggestionEngine({
			goalAlignmentWeight: 1,
			bottleneckSeverityWeight: 0,
			failureFrequencyWeight: 0,
		});
		const goals = sampleGoals();
		// Make one suggestion that aligns with goals, one that doesn't
		const suggestions: FuturePhaseSuggestion[] = [
			{
				title: "Advance Goal: Improve Deployment Reliability",
				rationale: "Improve deployments",
				priority: "high",
				estimatedWorkstreams: 2,
				relatedMemoryIds: [],
				relatedObservationIds: [],
			},
			{
				title: "Random Unrelated Suggestion",
				rationale: "No relation to goals",
				priority: "low",
				estimatedWorkstreams: 1,
				relatedMemoryIds: [],
				relatedObservationIds: [],
			},
		];
		const ranked = engine.rankSuggestions(suggestions, goals);
		expect(ranked[0].title).toBe("Advance Goal: Improve Deployment Reliability");
		expect(ranked[1].title).toBe("Random Unrelated Suggestion");
	});

	test("rankSuggestions uses all config weights", () => {
		const engine = new FutureSuggestionEngine({
			goalAlignmentWeight: 0.25,
			bottleneckSeverityWeight: 0.5,
			failureFrequencyWeight: 0.25,
		});
		const suggestions: FuturePhaseSuggestion[] = [
			{
				title: "Queue & Scheduling Optimization",
				rationale: "Bottleneck detected in queue scheduling",
				priority: "high",
				estimatedWorkstreams: 2,
				relatedMemoryIds: [],
				relatedObservationIds: [],
			},
			{
				title: "General Robustness Fix",
				rationale: "Some failure detected",
				priority: "normal",
				estimatedWorkstreams: 1,
				relatedMemoryIds: [],
				relatedObservationIds: [],
			},
		];
		const failureScores = new Map<string, number>([["test failure", 0.5]]);
		const ranked = engine.rankSuggestions(suggestions, undefined, failureScores);
		expect(ranked.length).toBe(2);
	});

	// ---- Acceptance Criteria ----

	test("AC1: Failures generate fix suggestions", () => {
		const engine = new FutureSuggestionEngine();
		const report = sampleReflection({
			whatFailed: ["Build script crashed"],
		});
		const suggestions = engine.fromReflection(report);
		const fixSuggestions = suggestions.filter((s) => s.rationale.includes("Failure") || s.title.includes("Fix"));
		expect(fixSuggestions.length).toBeGreaterThan(0);
	});

	test("AC2: Bottlenecks generate optimization suggestions", () => {
		const engine = new FutureSuggestionEngine();
		const report = sampleReflection({
			whatSlowedDown: ["Queue wait times"],
		});
		const suggestions = engine.fromReflection(report);
		const optSuggestions = suggestions.filter(
			(s) => s.rationale.includes("Bottleneck") || s.title.includes("Optimization"),
		);
		expect(optSuggestions.length).toBeGreaterThan(0);
	});

	test("AC3: Goals generate advancement suggestions", () => {
		const engine = new FutureSuggestionEngine();
		const report = sampleReflection({
			whatFailed: [],
			whatSlowedDown: [],
		});
		const goals = sampleGoals();
		const suggestions = engine.fromReflection(report, goals);
		const advSuggestions = suggestions.filter((s) => s.title.includes("Advance Goal"));
		expect(advSuggestions.length).toBeGreaterThan(0);
	});

	test("AC4: Suggestions ranked by priority", () => {
		const engine = new FutureSuggestionEngine({ maxSuggestions: 10 });
		const report = sampleReflection({
			whatFailed: ["Critical timeout failure", "Minor lint warning"],
			whatSlowedDown: ["Major queue bottleneck"],
		});
		const goals = sampleGoals();
		const suggestions = engine.fromReflection(report, goals);

		// At least the first suggestion should be critical or high
		expect(["critical", "high"]).toContain(suggestions[0].priority);
	});

	test("AC5: Each suggestion includes rationale", () => {
		const engine = new FutureSuggestionEngine();
		const report = sampleReflection();
		const suggestions = engine.fromReflection(report);
		for (const s of suggestions) {
			expect(s.rationale).toBeTruthy();
		}
	});

	test("AC6: Max 3 suggestions by default", () => {
		const engine = new FutureSuggestionEngine();
		const report = sampleReflection({
			whatFailed: ["Failure 1", "Failure 2", "Failure 3", "Failure 4", "Failure 5"],
			whatSlowedDown: ["Bottleneck 1", "Bottleneck 2", "Bottleneck 3"],
		});
		const goals = sampleGoals();
		const suggestions = engine.fromReflection(report, goals);
		expect(suggestions.length).toBeLessThanOrEqual(3);
	});

	// ---- Failure categorization ----

	test("timeout failures get Performance & Stability Fix", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromFailures(["Connection timeout"], new Map([["Connection timeout", 0.5]]));
		expect(suggestions[0].title).toBe("Performance & Stability Fix");
	});

	test("validation failures get Validation Pipeline Fix", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromFailures(["Test assertion failed"], new Map([["Test assertion failed", 0.5]]));
		expect(suggestions[0].title).toBe("Validation Pipeline Fix");
	});

	test("tool failures get Tool Execution Fix", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromFailures(["Edit tool error"], new Map([["Edit tool error", 0.5]]));
		expect(suggestions[0].title).toBe("Tool Execution Fix");
	});

	test("permission failures get Permission & Access Fix", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromFailures(["Permission denied"], new Map([["Permission denied", 0.5]]));
		expect(suggestions[0].title).toBe("Permission & Access Fix");
	});

	test("network failures get Network & API Reliability Fix", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromFailures(
			["Network connection refused"],
			new Map([["Network connection refused", 0.5]]),
		);
		expect(suggestions[0].title).toBe("Network & API Reliability Fix");
	});

	test("memory failures get Resource Management Fix", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromFailures(["Out of memory"], new Map([["Out of memory", 0.5]]));
		expect(suggestions[0].title).toBe("Resource Management Fix");
	});

	test("unknown failures get General Robustness Fix", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromFailures(["Unknown error occurred"], new Map([["Unknown error occurred", 0.5]]));
		expect(suggestions[0].title).toBe("General Robustness Fix");
	});

	// ---- Bottleneck categorization ----

	test("queue bottlenecks get Queue & Scheduling Optimization", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromBottlenecks(["Queue scheduling delay"]);
		expect(suggestions[0].title).toBe("Queue & Scheduling Optimization");
	});

	test("execution bottlenecks get Tool Execution Optimization", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromBottlenecks(["Slow tool execution"]);
		expect(suggestions[0].title).toBe("Tool Execution Optimization");
	});

	test("memory bottlenecks get Context & Memory Optimization", () => {
		const engine = new FutureSuggestionEngine();
		const suggestions = engine.fromBottlenecks(["Large context overhead"]);
		expect(suggestions[0].title).toBe("Context & Memory Optimization");
	});
});
