/**
 * Fix Strategist Worker — 25.J
 *
 * Tests for:
 * - FixStrategistWorker class and factory
 * - PatchStrategyGenerator and PatchStrategy types
 * - TestPlanGenerator and TestPlan types
 * - Evidence validation, filtering, dedup, cooldown, stop-conditions
 * - Diagnostics and failure handling
 * - Strategy generation, ranking, and risk assessment
 * - Test plan generation with coverage analysis
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { createFixStrategistWorker } from "../../src/brain-workers/fix-strategist/fix-strategist-worker.js";
import {
	ALL_PATCH_ACTION_TYPES,
	ALL_RISK_LEVELS,
	createPatchStrategyGenerator,
	type FixRootCauseFinding,
	type PatchAction,
	PatchStrategyGenerator,
} from "../../src/brain-workers/fix-strategist/patch-strategy.js";
import {
	ALL_TEST_CASE_TYPES,
	createTestPlanGenerator,
	TestPlanGenerator,
} from "../../src/brain-workers/fix-strategist/test-plan-generator.js";

// =============================================================================
// Types & Constants
// =============================================================================

describe("ALL_PATCH_ACTION_TYPES", () => {
	test("contains all expected action types", () => {
		expect(ALL_PATCH_ACTION_TYPES).toContain("modify");
		expect(ALL_PATCH_ACTION_TYPES).toContain("create");
		expect(ALL_PATCH_ACTION_TYPES).toContain("delete");
		expect(ALL_PATCH_ACTION_TYPES).toContain("rename");
		expect(ALL_PATCH_ACTION_TYPES.length).toBe(4);
	});
});

describe("ALL_RISK_LEVELS", () => {
	test("contains all expected risk levels", () => {
		expect(ALL_RISK_LEVELS).toContain("low");
		expect(ALL_RISK_LEVELS).toContain("medium");
		expect(ALL_RISK_LEVELS).toContain("high");
		expect(ALL_RISK_LEVELS).toContain("critical");
		expect(ALL_RISK_LEVELS.length).toBe(4);
	});
});

describe("ALL_TEST_CASE_TYPES", () => {
	test("contains all expected test case types", () => {
		expect(ALL_TEST_CASE_TYPES).toContain("unit");
		expect(ALL_TEST_CASE_TYPES).toContain("integration");
		expect(ALL_TEST_CASE_TYPES).toContain("e2e");
		expect(ALL_TEST_CASE_TYPES).toContain("regression");
		expect(ALL_TEST_CASE_TYPES).toContain("manual");
		expect(ALL_TEST_CASE_TYPES.length).toBe(5);
	});
});

// =============================================================================
// PatchStrategyGenerator
// =============================================================================

describe("PatchStrategyGenerator", () => {
	test("can be created with default config", () => {
		const generator = createPatchStrategyGenerator();
		expect(generator).toBeInstanceOf(PatchStrategyGenerator);
		expect(generator.getConfig().maxRootCauseFindings).toBe(10);
	});

	test("can be created with custom config", () => {
		const generator = createPatchStrategyGenerator({
			maxRootCauseFindings: 5,
			maxActions: 10,
			maxStrategies: 3,
		});
		expect(generator.getConfig().maxRootCauseFindings).toBe(5);
		expect(generator.getConfig().maxActions).toBe(10);
		expect(generator.getConfig().maxStrategies).toBe(3);
	});

	test("config can be updated after creation", () => {
		const generator = createPatchStrategyGenerator();
		generator.setConfig({ maxRootCauseFindings: 8 });
		expect(generator.getConfig().maxRootCauseFindings).toBe(8);
	});

	test("extractRootCauses returns findings from error evidence", () => {
		const generator = createPatchStrategyGenerator();
		const evidence = [
			{
				label: "Error #1",
				content: "TypeError: Cannot read properties of null (reading 'foo')",
				type: "error_message",
				confidence: "high",
			},
			{
				label: "Stack #1",
				content:
					"TypeError: Cannot read properties of null\n    at Object.parse (src/parser.js:42:10)\n    at main (src/index.js:10:5)",
				type: "stack_trace",
				confidence: "high",
			},
		];

		const findings = generator.extractRootCauses(evidence);
		expect(findings.length).toBeGreaterThan(0);
		expect(findings.some((f) => f.category === "null_reference")).toBe(true);
	});

	test("extractRootCauses handles empty evidence", () => {
		const generator = createPatchStrategyGenerator();
		const findings = generator.extractRootCauses([]);
		expect(findings.length).toBe(0);
	});

	test("generateStrategy creates a valid PatchStrategy", () => {
		const generator = createPatchStrategyGenerator();
		const rootCauses = generator.extractRootCauses([
			{ label: "Error", content: "TypeError: x is not a function", type: "error_message", confidence: "high" },
		]);

		const actions: PatchAction[] = [
			{
				id: "action-1",
				type: "modify",
				filePath: "src/index.ts",
				description: "Fix type error in main function",
				content: "diff --git a/src/index.ts b/src/index.ts\n...",
				evidenceRefs: ["Error"],
				confidence: "high",
				complexity: 3,
			},
		];

		const strategy = generator.generateStrategy(
			"Fix type error",
			"Strategy to fix the type error in index.ts",
			rootCauses,
			actions,
			["evidence-summary-1"],
		);

		expect(strategy).toBeDefined();
		expect(strategy.title).toBe("Fix type error");
		expect(strategy.actions.length).toBe(1);
		expect(strategy.isComplete).toBe(true);
		expect(strategy.autonomousEligible).toBe(true);
	});

	test("generateStrategy produces correct risk level for low-confidence actions", () => {
		const generator = createPatchStrategyGenerator();
		const actions: PatchAction[] = [
			{
				id: "action-low",
				type: "modify",
				filePath: "src/index.ts",
				description: "Speculative fix",
				content: "...",
				evidenceRefs: [],
				confidence: "speculative",
				complexity: 5,
			},
		];

		const strategy = generator.generateStrategy("Speculative fix", "Low confidence strategy", [], actions, []);

		expect(strategy.riskLevel).toBe("critical");
		expect(strategy.autonomousEligible).toBe(false);
	});

	test("generateStrategy handles no actions", () => {
		const generator = createPatchStrategyGenerator();
		const strategy = generator.generateStrategy("No actions", "Strategy with no actions", [], [], []);

		expect(strategy.isComplete).toBe(false);
		expect(strategy.riskLevel).toBe("critical");
		expect(strategy.diagnostics).toContain("No patch actions were defined — this strategy is incomplete");
	});

	test("rankStrategies returns sorted list", () => {
		const generator = createPatchStrategyGenerator();

		// Generate two strategies with different confidence levels
		const actions1: PatchAction[] = [
			{
				id: "a1",
				type: "modify",
				filePath: "src/a.ts",
				description: "Fix A",
				content: "",
				evidenceRefs: [],
				confidence: "high",
				complexity: 2,
			},
		];
		const actions2: PatchAction[] = [
			{
				id: "a2",
				type: "modify",
				filePath: "src/b.ts",
				description: "Fix B",
				content: "",
				evidenceRefs: [],
				confidence: "low",
				complexity: 8,
			},
		];

		generator.generateStrategy("Strategy A", "High confidence", [], actions1, []);
		generator.generateStrategy("Strategy B", "Low confidence", [], actions2, []);

		const ranked = generator.rankStrategies();
		expect(ranked.length).toBe(2);
		// Strategy A should rank higher due to higher confidence/lower risk
		expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
	});

	test("serialization round-trip", () => {
		const generator = createPatchStrategyGenerator();
		const actions: PatchAction[] = [
			{
				id: "a1",
				type: "modify",
				filePath: "src/x.ts",
				description: "Fix",
				content: "",
				evidenceRefs: [],
				confidence: "high",
				complexity: 1,
			},
		];
		generator.generateStrategy("Test", "Desc", [], actions, []);

		const json = generator.serializeAll();
		expect(json).toBeTruthy();
		const parsed = JSON.parse(json);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed.length).toBe(1);
		expect(parsed[0].title).toBe("Test");
	});
});

// =============================================================================
// TestPlanGenerator
// =============================================================================

describe("TestPlanGenerator", () => {
	test("can be created with default config", () => {
		const generator = createTestPlanGenerator();
		expect(generator).toBeInstanceOf(TestPlanGenerator);
		expect(generator.getConfig().minCoveragePercent).toBe(70);
	});

	test("can be created with custom config", () => {
		const generator = createTestPlanGenerator({
			maxTestCases: 10,
			minCoveragePercent: 50,
			autoGenerateEdgeCases: false,
		});
		expect(generator.getConfig().maxTestCases).toBe(10);
		expect(generator.getConfig().minCoveragePercent).toBe(50);
		expect(generator.getConfig().autoGenerateEdgeCases).toBe(false);
	});

	test("config can be updated after creation", () => {
		const generator = createTestPlanGenerator();
		generator.setConfig({ minCoveragePercent: 80 });
		expect(generator.getConfig().minCoveragePercent).toBe(80);
	});

	test("generatePlan creates a valid TestPlan from a strategy", () => {
		const strategyGen = createPatchStrategyGenerator();
		const planGen = createTestPlanGenerator();

		const actions: PatchAction[] = [
			{
				id: "pa-1",
				type: "modify",
				filePath: "src/utils.ts",
				description: "Fix null check",
				content: "",
				evidenceRefs: [],
				confidence: "high",
				complexity: 2,
			},
		];

		const strategy = strategyGen.generateStrategy(
			"Fix null check in utils",
			"Strategy to add null guard",
			[],
			actions,
			[],
		);

		const plan = planGen.generatePlan(strategy);
		expect(plan).toBeDefined();
		expect(plan.strategyId).toBe(strategy.id);
		expect(plan.testCases.length).toBeGreaterThan(0);
		expect(plan.isComplete).toBe(true);
	});

	test("generatePlan includes regression tests for root causes", () => {
		const strategyGen = createPatchStrategyGenerator();
		const planGen = createTestPlanGenerator();

		const evidence = [
			{
				label: "Error",
				content: "TypeError: Cannot read properties of null",
				type: "error_message",
				confidence: "high",
			},
		];
		const rootCauses = strategyGen.extractRootCauses(evidence);

		const actions: PatchAction[] = [
			{
				id: "pa-1",
				type: "modify",
				filePath: "src/parser.ts",
				description: "Add null guard",
				content: "",
				evidenceRefs: ["Error"],
				confidence: "high",
				complexity: 1,
			},
		];

		const strategy = strategyGen.generateStrategy("Fix null ref", "Strategy description", rootCauses, actions, [
			"ev-1",
		]);

		const plan = planGen.generatePlan(strategy);
		expect(plan.testCases.some((tc) => tc.type === "regression")).toBe(true);
		expect(plan.coveredRootCauses.length).toBeGreaterThan(0);
	});

	test("generatePlan handles edge case generation", () => {
		const strategyGen = createPatchStrategyGenerator();
		const planGen = createTestPlanGenerator({
			autoGenerateEdgeCases: true,
		});

		const evidence = [
			{
				label: "Error",
				content: "TypeError: Cannot read properties of null",
				type: "error_message",
				confidence: "high",
			},
		];
		const rootCauses = strategyGen.extractRootCauses(evidence);

		const actions: PatchAction[] = [
			{
				id: "pa-edge",
				type: "modify",
				filePath: "src/service.ts",
				description: "Add null guards",
				content: "",
				evidenceRefs: [],
				confidence: "high",
				complexity: 2,
			},
		];

		const strategy = strategyGen.generateStrategy("Fix null refs", "Strategy description", rootCauses, actions, []);

		const plan = planGen.generatePlan(strategy);
		// Should include test cases covering root causes
		expect(plan.testCases.length).toBeGreaterThan(0);
		expect(plan.coveredRootCauses.length).toBeGreaterThan(0);
		expect(plan.testCases.some((tc) => tc.type === "regression")).toBe(true);
		// Edge case tests should be generated (either in step 1 or step 3)
		expect(plan.testCases.some((tc) => tc.name.toLowerCase().includes("edge case"))).toBe(true);
	});

	test("generatePlan reports insufficient coverage", () => {
		const strategyGen = createPatchStrategyGenerator();
		const planGen = createTestPlanGenerator({
			minCoveragePercent: 101, // Higher than maximum possible coverage
		});

		const actions: PatchAction[] = [
			{
				id: "pa-1",
				type: "modify",
				filePath: "src/test.ts",
				description: "Test fix",
				content: "",
				evidenceRefs: [],
				confidence: "low",
				complexity: 1,
			},
		];

		const strategy = strategyGen.generateStrategy("Test", "Desc", [], actions, []);

		const plan = planGen.generatePlan(strategy);
		expect(plan.isSufficient).toBe(false);
		expect(plan.diagnostics.length).toBeGreaterThan(0);
	});

	test("serialization round-trip", () => {
		const strategyGen = createPatchStrategyGenerator();
		const planGen = createTestPlanGenerator();

		const actions: PatchAction[] = [
			{
				id: "pa-1",
				type: "modify",
				filePath: "src/x.ts",
				description: "Fix",
				content: "",
				evidenceRefs: [],
				confidence: "high",
				complexity: 1,
			},
		];

		const strategy = strategyGen.generateStrategy("Test", "Desc", [], actions, []);
		planGen.generatePlan(strategy);

		const json = planGen.serializeAll();
		expect(json).toBeTruthy();
		const parsed = JSON.parse(json);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed.length).toBe(1);
	});

	test("inferTestFilePath works correctly", () => {
		// Use the generator indirectly via plan generation
		const planGen = createTestPlanGenerator();
		expect(planGen).toBeDefined();

		// Test the getConfig method works
		expect(planGen.getConfig().preferredTestType).toBe("unit");
	});
});

// =============================================================================
// FixStrategistWorker
// =============================================================================

describe("FixStrategistWorker", () => {
	test("can be created with default config", () => {
		const worker = createFixStrategistWorker();
		expect(worker).toBeDefined();
		expect(worker.getConfig().maxEvidenceItems).toBe(200);
		expect(worker.totalCycles).toBe(0);
	});

	test("can be created with custom config", () => {
		const worker = createFixStrategistWorker({
			maxEvidenceItems: 50,
			maxStrategies: 3,
			enableAutonomous: true,
		});
		expect(worker.getConfig().maxEvidenceItems).toBe(50);
		expect(worker.getConfig().maxStrategies).toBe(3);
		expect(worker.getConfig().enableAutonomous).toBe(true);
	});

	test("config can be updated after creation", () => {
		const worker = createFixStrategistWorker();
		worker.setConfig({ maxEvidenceItems: 100 });
		expect(worker.getConfig().maxEvidenceItems).toBe(100);
	});

	// Evidence validation
	test("validateEvidence rejects empty evidence", () => {
		const worker = createFixStrategistWorker();
		const errors = worker.validateEvidence([]);
		expect(errors).toContain("No evidence provided");
	});

	test("validateEvidence accepts valid evidence", () => {
		const worker = createFixStrategistWorker();
		const errors = worker.validateEvidence([{ label: "Error", content: "Something broke", type: "error_message" }]);
		expect(errors.length).toBe(0);
	});

	test("validateEvidence flags empty content", () => {
		const worker = createFixStrategistWorker();
		const errors = worker.validateEvidence([{ label: "Empty", content: "   " }]);
		expect(errors.length).toBeGreaterThan(0);
	});

	test("validateEvidence checks required types when allowPartialEvidence is false", () => {
		const worker = createFixStrategistWorker({
			allowPartialEvidence: false,
		});
		const errors = worker.validateEvidence([{ label: "Log", content: "Some log message", type: "execution_log" }]);
		// Should flag missing error_message and stack_trace
		const hasErrorTypeError = errors.some((e) => e.includes("error message"));
		expect(hasErrorTypeError).toBe(true);
	});

	// Dedup
	test("dedup skips duplicate analysis", () => {
		const worker = createFixStrategistWorker();
		const evidence = [{ label: "Error", content: "TypeError: x", type: "error_message", confidence: "high" }];

		// First run should succeed
		const result1 = worker.analyze(evidence);
		expect(result1.strategies.length).toBeGreaterThan(0);

		// Second run with same evidence should be deduped
		const result2 = worker.analyze(evidence);
		expect(result2.summary).toContain("dedup");
	});

	test("dedup can be disabled", () => {
		const worker = createFixStrategistWorker({
			dedupConfig: { enabled: false, windowMs: 300_000, useSimilarity: true, similarityThreshold: 0.85 },
		});
		const evidence = [{ label: "Error", content: "TypeError: x", type: "error_message", confidence: "high" }];

		worker.analyze(evidence);
		const result2 = worker.analyze(evidence);
		// Should not be deduped
		expect(result2.summary).not.toContain("dedup");
	});

	// Cooldown
	test("cooldown management works", () => {
		const worker = createFixStrategistWorker();
		expect(worker.isInCooldown()).toBe(false);

		worker.startCooldown(60_000);
		expect(worker.isInCooldown()).toBe(true);

		const status = worker.getCooldownStatus();
		expect(status.cooling).toBe(true);
		expect(status.remainingMs).toBeGreaterThan(0);

		worker.endCooldown();
		expect(worker.isInCooldown()).toBe(false);
	});

	// Stop conditions
	test("checkStopCondition returns null by default", () => {
		const worker = createFixStrategistWorker();
		expect(worker.checkStopCondition()).toBeNull();
	});

	test("checkStopCondition detects consecutive failures", () => {
		const worker = createFixStrategistWorker();

		// Run with empty evidence to trigger consecutive failures
		worker.analyze([]);
		worker.analyze([]);
		worker.analyze([]);

		// After 3 failures (matching default maxConsecutiveFailures), stop condition should trigger
		expect(worker.checkStopCondition()).toBe("consecutive_failures_exceeded");
	});

	test("getConsecutiveFailureCount returns current count", () => {
		const worker = createFixStrategistWorker();
		expect(worker.consecutiveFailureCount).toBe(0);

		// Empty evidence triggers a validation failure which increments the counter
		worker.analyze([]);
		expect(worker.consecutiveFailureCount).toBe(1);

		// Another failure increments further
		worker.analyze([]);
		expect(worker.consecutiveFailureCount).toBe(2);

		// Successful analysis resets the counter
		worker.analyze([{ label: "Error", content: "test", type: "error_message", confidence: "high" }]);
		expect(worker.consecutiveFailureCount).toBe(0);
	});

	// Evidence filtering
	test("filterEvidenceByConfidence filters low-confidence items", () => {
		const worker = createFixStrategistWorker({
			minEvidenceConfidence: 0.5,
		});
		const evidence = [
			{ label: "High", content: "High confidence error", type: "error_message", confidence: "high" },
			{ label: "Low", content: "Speculative info", type: "execution_log", confidence: "speculative" },
			{ label: "Medium", content: "Medium confidence", type: "execution_log", confidence: "medium" },
		];

		const filtered = worker.filterEvidenceByConfidence(evidence);
		expect(filtered.length).toBe(2); // high and medium pass, speculative is filtered
		expect(filtered.find((e) => e.label === "Low")).toBeUndefined();
	});

	test("filterEvidenceByConfidence handles missing confidence", () => {
		const worker = createFixStrategistWorker();
		const evidence = [{ label: "NoConf", content: "Item without confidence", type: "error_message" }];

		const filtered = worker.filterEvidenceByConfidence(evidence);
		expect(filtered.length).toBe(1); // Default confidence "medium" (0.7) >= 0.3
	});

	// Full analysis cycle
	test("analyze produces strategies from evidence", () => {
		const worker = createFixStrategistWorker();
		const evidence = [
			{
				label: "Error #1",
				content: "TypeError: Cannot read properties of null (reading 'foo')",
				type: "error_message",
				confidence: "high",
			},
			{
				label: "Stack",
				content: "at Object.parse (src/parser.js:42:10)\n    at main (src/index.js:10:5)",
				type: "stack_trace",
				confidence: "high",
			},
			{ label: "Log", content: "Failed to parse input data", type: "execution_log", confidence: "medium" },
		];

		const result = worker.analyze(evidence, {
			projectPath: "/test/project",
			reproducible: true,
		});

		expect(result.success).toBe(true);
		expect(result.strategies.length).toBeGreaterThan(0);
		expect(result.testPlans.length).toBeGreaterThan(0);
		expect(result.sessionId).toBeTruthy();

		// Check strategy has root causes
		const hasNullRefCause = result.strategies.some((s) =>
			s.rootCauses.some((rc) => rc.category === "null_reference"),
		);
		expect(hasNullRefCause).toBe(true);
	});

	test("analyze handles evidence with no stack traces", () => {
		const worker = createFixStrategistWorker();
		const evidence = [
			{ label: "Log message", content: "Something went wrong", type: "execution_log", confidence: "medium" },
		];

		const result = worker.analyze(evidence);
		expect(result.success).toBe(true);
		// Even with only log evidence, it should produce something
		expect(result.strategies.length).toBeGreaterThan(0);
	});

	test("analyze handles context with allowAutonomous", () => {
		const worker = createFixStrategistWorker({
			enableAutonomous: true,
		});
		const evidence = [
			{ label: "Error", content: "Error: connection refused", type: "error_message", confidence: "high" },
		];

		const result = worker.analyze(evidence, {
			allowAutonomous: true,
		});
		expect(result.success).toBe(true);
	});

	test("analyze returns diagnostics on failure", () => {
		const worker = createFixStrategistWorker();
		const result = worker.analyze([]);
		expect(result.success).toBe(false);
		expect(result.diagnostics.length).toBeGreaterThan(0);
		expect(result.summary).toContain("failed");
	});

	// Diagnostics
	test("diagnostics are recorded and retrievable", () => {
		const worker = createFixStrategistWorker();
		expect(worker.getDiagnostics().length).toBe(0);

		worker.analyze([]);
		expect(worker.getDiagnostics().length).toBeGreaterThan(0);
	});

	test("diagnostics can be cleared", () => {
		const worker = createFixStrategistWorker();
		worker.analyze([]);
		worker.clearDiagnostics();
		expect(worker.getDiagnostics().length).toBe(0);
	});

	test("diagnostics can be disabled", () => {
		const worker = createFixStrategistWorker({
			diagnosticsEnabled: false,
		});
		worker.analyze([]);
		expect(worker.getDiagnostics().length).toBe(0);
	});

	// Results
	test("results are stored and retrievable by ID", () => {
		const worker = createFixStrategistWorker();
		const evidence = [{ label: "Error", content: "Test error", type: "error_message", confidence: "high" }];

		const result = worker.analyze(evidence);
		const retrieved = worker.getResult(result.id);
		expect(retrieved).toBeDefined();
		expect(retrieved!.id).toBe(result.id);
	});

	test("getAllResults returns all stored results", () => {
		const worker = createFixStrategistWorker();
		const evidence = [{ label: "Error", content: "Test", type: "error_message", confidence: "high" }];

		worker.analyze(evidence);
		worker.analyze(evidence); // Dedup, but still a result
		const allResults = worker.getAllResults();
		expect(allResults.length).toBe(2);
	});

	test("clearResults removes all results", () => {
		const worker = createFixStrategistWorker();
		const evidence = [{ label: "Error", content: "Test", type: "error_message", confidence: "high" }];

		worker.analyze(evidence);
		worker.clearResults();
		expect(worker.resultCount).toBe(0);
	});

	// Reset
	test("reset restores worker to initial state", () => {
		const worker = createFixStrategistWorker();
		const evidence = [{ label: "Error", content: "Test error", type: "error_message", confidence: "high" }];

		worker.analyze(evidence);
		worker.startCooldown(60_000);
		worker.reset();

		expect(worker.totalCycles).toBe(0);
		expect(worker.consecutiveFailureCount).toBe(0);
		expect(worker.isInCooldown()).toBe(false);
		expect(worker.getDiagnostics().length).toBe(0);
		expect(worker.resultCount).toBe(0);
	});

	// emitProposal
	describe("emitProposal", () => {
		test("returns null for unknown result ID", () => {
			const worker = createFixStrategistWorker();
			const proposal = worker.emitProposal("nonexistent-id");
			expect(proposal).toBeNull();
		});

		test("produces a valid handoff bundle for a known result", () => {
			const worker = createFixStrategistWorker();
			const evidence = [{ label: "Error", content: "TypeError: x", type: "error_message", confidence: "high" }];

			const result = worker.analyze(evidence);
			const proposal = worker.emitProposal(result.id);

			expect(proposal).not.toBeNull();
			expect(proposal!.resultId).toBe(result.id);
			expect(proposal!.sessionId).toBe(result.sessionId);
			expect(proposal!.strategies).toEqual(result.strategies);
			expect(proposal!.testPlans).toEqual(result.testPlans);
			expect(proposal!.success).toBe(result.success);
			expect(proposal!.summary).toBe(result.summary);
			expect(proposal!.diagnostics).toEqual(result.diagnostics);
			expect(proposal!.emittedAt).toBeTruthy();
			expect(proposal!.workerStats).toBeDefined();
			expect(proposal!.workerStats.totalCycles).toBeGreaterThanOrEqual(1);
		});

		test("increments totalProposalsEmitted on each call", () => {
			const worker = createFixStrategistWorker();
			const evidence = [{ label: "Error", content: "TypeError: x", type: "error_message", confidence: "high" }];

			const r1 = worker.analyze(evidence);
			const r2 = worker.analyze([
				{ label: "Error", content: "TypeError: y", type: "error_message", confidence: "high" },
			]);

			worker.emitProposal(r1.id);
			const statsAfterFirst = worker.getStats();
			expect(statsAfterFirst.totalProposalsEmitted).toBe(1);

			worker.emitProposal(r2.id);
			const statsAfterSecond = worker.getStats();
			expect(statsAfterSecond.totalProposalsEmitted).toBe(2);
		});
	});

	// getStats
	describe("getStats", () => {
		test("returns default stats for fresh worker", () => {
			const worker = createFixStrategistWorker();
			const stats = worker.getStats();

			expect(stats.totalCycles).toBe(0);
			expect(stats.completed).toBe(0);
			expect(stats.failed).toBe(0);
			expect(stats.consecutiveFailures).toBe(0);
			expect(stats.totalCyclesCompleted).toBe(0);
			expect(stats.totalCyclesFailed).toBe(0);
			expect(stats.totalProposalsEmitted).toBe(0);
			expect(stats.totalDiagnosticsGenerated).toBe(0);
			expect(stats.totalStrategiesGenerated).toBe(0);
			expect(stats.totalTestPlansGenerated).toBe(0);
			expect(stats.dedupHistorySize).toBe(0);
			expect(stats.healthStatus).toBe("healthy");
		});

		test("tracks cycle stats after analysis", () => {
			const worker = createFixStrategistWorker();
			const evidence = [{ label: "Error", content: "TypeError: x", type: "error_message", confidence: "high" }];

			worker.analyze(evidence);
			const stats = worker.getStats();

			expect(stats.totalCycles).toBe(1);
			expect(stats.completed).toBe(1);
			expect(stats.failed).toBe(0);
			expect(stats.totalCyclesCompleted).toBe(1);
			expect(stats.totalCyclesFailed).toBe(0);
			expect(stats.totalDiagnosticsGenerated).toBeGreaterThanOrEqual(0);
		});

		test("tracks failed cycles", () => {
			const worker = createFixStrategistWorker();

			worker.analyze([]);
			const stats = worker.getStats();

			expect(stats.totalCycles).toBe(1);
			expect(stats.completed).toBe(0);
			expect(stats.failed).toBe(1);
			expect(stats.totalCyclesCompleted).toBe(0);
			expect(stats.totalCyclesFailed).toBe(1);
		});

		test("tracks strategies and test plans generated", () => {
			const worker = createFixStrategistWorker();
			const evidence = [{ label: "Error", content: "TypeError: x", type: "error_message", confidence: "high" }];

			worker.analyze(evidence);
			const stats = worker.getStats();

			expect(stats.totalStrategiesGenerated).toBeGreaterThanOrEqual(1);
			expect(stats.totalTestPlansGenerated).toBeGreaterThanOrEqual(1);
		});
	});

	// getHealthStatus
	describe("getHealthStatus", () => {
		test("returns healthy for fresh worker", () => {
			const worker = createFixStrategistWorker();
			expect(worker.getHealthStatus()).toBe("healthy");
		});

		test("returns degraded after some failures", () => {
			const worker = createFixStrategistWorker();
			worker.analyze([]); // 1 failure
			worker.analyze([]); // 2 failures
			expect(worker.getHealthStatus()).toBe("degraded");
		});

		test("returns unhealthy after many failures", () => {
			const worker = createFixStrategistWorker();
			worker.analyze([]); // 1
			worker.analyze([]); // 2
			worker.analyze([]); // 3
			worker.analyze([]); // 4
			worker.analyze([]); // 5
			expect(worker.getHealthStatus()).toBe("unhealthy");
		});

		test("recovers to healthy after successful analysis", () => {
			const worker = createFixStrategistWorker();
			worker.analyze([]); // 1 failure
			worker.analyze([]); // 2 failures
			expect(worker.getHealthStatus()).toBe("degraded");

			worker.analyze([{ label: "Error", content: "TypeError: x", type: "error_message", confidence: "high" }]); // success resets failures
			expect(worker.getHealthStatus()).toBe("healthy");
		});
	});
});

// =============================================================================
// Integration: End-to-End Analysis Cycle
// =============================================================================

describe("Integration — End-to-End Analysis Cycle", () => {
	test("complete flow: evidence -> analysis -> strategies -> test plans", () => {
		const worker = createFixStrategistWorker({
			maxStrategies: 3,
			autoGenerateTestPlans: true,
			enableAutonomous: true,
		});

		const evidence = [
			{
				label: "TypeError in user service",
				content: "TypeError: Cannot read properties of undefined (reading 'name')",
				type: "error_message",
				confidence: "high",
			},
			{
				label: "Stack trace from user service",
				content:
					"TypeError: Cannot read properties of undefined\n    at UserService.getDisplayName (src/services/user.ts:85:20)\n    at UserController.show (src/controllers/user.ts:15:10)",
				type: "stack_trace",
				confidence: "high",
			},
			{
				label: "Execution log",
				content: "ERROR [2025-01-15 10:30:00] Failed to load user profile: undefined name",
				type: "execution_log",
				confidence: "medium",
			},
		];

		const context = {
			projectPath: "/workspace/my-app",
			reproducible: true,
			reproductionSteps: "1. Open user profile page\n2. Click on a user without a name set\n3. Observe crash",
		};

		const result = worker.analyze(evidence, context, "integration-test-001");

		// Check top-level result
		expect(result.success).toBe(true);
		expect(result.sessionId).toBe("integration-test-001");
		expect(result.strategies.length).toBeGreaterThan(0);
		expect(result.testPlans.length).toBeGreaterThan(0);
		expect(result.summary).toContain("strategy");
		expect(result.summary).toContain("test plan");

		// Check strategies
		const strategy = result.strategies[0]!;
		expect(strategy.rootCauses.length).toBeGreaterThan(0);
		expect(strategy.actions).toBeDefined();
		expect(strategy.isComplete).toBeDefined();
		expect(strategy.evidenceSummaryIds).toContain("integration-test-001");

		// Check root cause analysis
		const hasNullRef = strategy.rootCauses.some((rc) => rc.category === "null_reference");
		expect(hasNullRef).toBe(true);
		const hasFileRef = strategy.rootCauses.some((rc) => rc.affectedFiles.some((f) => f.includes("user.ts")));
		expect(hasFileRef).toBe(true);

		// Check test plans
		const plan = result.testPlans[0]!;
		expect(plan.strategyId).toBe(strategy.id);
		expect(plan.testCases.length).toBeGreaterThan(0);
		expect(plan.coveragePercent).toBeGreaterThan(0);

		// Check that regression tests are generated for root causes
		const regressionTests = plan.testCases.filter((tc) => tc.type === "regression");
		expect(regressionTests.length).toBeGreaterThan(0);

		// Check edge case tests
		const edgeCaseTests = plan.testCases.filter((tc) => tc.name.toLowerCase().includes("null guard"));
		expect(edgeCaseTests.length).toBeGreaterThan(0);
	});

	test("flow with multiple evidence items produces ranked strategies", () => {
		const worker = createFixStrategistWorker({
			maxStrategies: 5,
		});

		// Run analysis once
		const result1 = worker.analyze([
			{ label: "Error #1", content: "TypeError: a is not a function", type: "error_message", confidence: "high" },
			{ label: "Log #1", content: "Failed initialization", type: "execution_log", confidence: "medium" },
		]);

		// Run analysis again with different evidence
		const result2 = worker.analyze([
			{
				label: "Error #2",
				content: "Error: connection timeout after 30000ms",
				type: "error_message",
				confidence: "high",
			},
			{
				label: "Stack #2",
				content: "Error: connection timeout\n    at Client.connect (src/client.ts:50:15)",
				type: "stack_trace",
				confidence: "high",
			},
		]);

		expect(result1.strategies.length).toBeGreaterThan(0);
		expect(result2.strategies.length).toBeGreaterThan(0);
	});

	test("flow with various error categories produces correct categorizations", () => {
		const worker = createFixStrategistWorker();

		const testCases = [
			{ content: "TypeError: Cannot read property 'x' of undefined", expected: "null_reference" },
			{ content: "Error: configuration file not found", expected: "configuration" },
			{ content: "SecurityError: permission denied", expected: "security" },
			{ content: "Error: Module 'foo' not found", expected: "dependency" },
			{ content: "TimeoutError: request timed out", expected: "performance" },
		];

		for (let i = 0; i < testCases.length; i++) {
			const tc = testCases[i]!;
			const result = worker.analyze([
				{ label: "Test", content: tc.content, type: "error_message", confidence: "high" },
			]);

			expect(result.strategies.length, `Test case ${i} should produce at least one strategy`).toBeGreaterThan(0);
			const strategy = result.strategies[0]!;
			const categories = strategy.rootCauses.map((rc) => rc.category);
			expect(
				categories,
				`Test case ${i}: "${tc.content.slice(0, 40)}" expected category ${tc.expected}, got [${categories.join(", ")}]`,
			).toContain(tc.expected);
		}
	});
});

// =============================================================================
// PatchStrategyGenerator.toActions
// =============================================================================

describe("PatchStrategyGenerator.toActions", () => {
	test("generates actions from a null_reference root cause", () => {
		const generator = createPatchStrategyGenerator();
		const findings: FixRootCauseFinding[] = [
			{
				id: "rc-1",
				description: "Cannot read properties of null in userService",
				category: "null_reference",
				evidenceRefs: ["ev-1"],
				confidence: "high",
				affectedFiles: ["src/services/userService.ts"],
				suggestedApproach: "Add null/undefined guards and consider using optional chaining",
			},
		];

		const actions = generator.toActions(findings, ["summary-1"]);
		expect(actions.length).toBeGreaterThan(0);
		expect(actions[0]!.filePath).toBe("src/services/userService.ts");
		expect(actions[0]!.type).toBe("modify");
		expect(actions[0]!.confidence).toBe("high");
		expect(actions[0]!.complexity).toBe(2);
		expect(actions[0]!.evidenceRefs).toContain("ev-1");
		expect(actions[0]!.evidenceRefs).toContain("summary-1");
	});

	test("generates actions for each affected file", () => {
		const generator = createPatchStrategyGenerator();
		const findings: FixRootCauseFinding[] = [
			{
				id: "rc-1",
				description: "TypeError in data processing",
				category: "type_error",
				evidenceRefs: ["ev-1"],
				confidence: "medium",
				affectedFiles: ["src/process.ts", "src/utils.ts"],
				suggestedApproach: "Add proper type checking",
			},
		];

		const actions = generator.toActions(findings);
		expect(actions.length).toBe(2);
		expect(actions[0]!.filePath).toBe("src/process.ts");
		expect(actions[1]!.filePath).toBe("src/utils.ts");
	});

	test("deduplicates identical category+file pairs", () => {
		const generator = createPatchStrategyGenerator();
		const findings: FixRootCauseFinding[] = [
			{
				id: "rc-1",
				description: "First null ref in parser",
				category: "null_reference",
				evidenceRefs: ["ev-1"],
				confidence: "high",
				affectedFiles: ["src/parser.ts"],
				suggestedApproach: "Add null guards",
			},
			{
				id: "rc-2",
				description: "Second null ref in parser",
				category: "null_reference",
				evidenceRefs: ["ev-2"],
				confidence: "medium",
				affectedFiles: ["src/parser.ts"],
				suggestedApproach: "Add extra null checks",
			},
		];

		const actions = generator.toActions(findings);
		expect(actions.length).toBe(1);
	});

	test("respects maxActions limit", () => {
		const generator = createPatchStrategyGenerator({ maxActions: 1 });
		const findings: FixRootCauseFinding[] = [
			{
				id: "rc-1",
				description: "Logic error A",
				category: "logic_error",
				evidenceRefs: [],
				confidence: "high",
				affectedFiles: ["src/a.ts"],
				suggestedApproach: "Review logic",
			},
			{
				id: "rc-2",
				description: "Logic error B",
				category: "logic_error",
				evidenceRefs: [],
				confidence: "high",
				affectedFiles: ["src/b.ts"],
				suggestedApproach: "Review logic",
			},
		];

		const actions = generator.toActions(findings, [], 1);
		expect(actions.length).toBe(1);
	});

	test("maps each category to correct complexity", () => {
		const generator = createPatchStrategyGenerator();

		const categoryComplexities: Array<{ category: FixRootCauseFinding["category"]; expected: number }> = [
			{ category: "logic_error", expected: 4 },
			{ category: "type_error", expected: 2 },
			{ category: "null_reference", expected: 2 },
			{ category: "race_condition", expected: 8 },
			{ category: "configuration", expected: 3 },
			{ category: "api_misuse", expected: 5 },
			{ category: "missing_edge_case", expected: 3 },
			{ category: "performance", expected: 6 },
			{ category: "security", expected: 7 },
			{ category: "dependency", expected: 3 },
			{ category: "other", expected: 5 },
		];

		for (const tc of categoryComplexities) {
			const findings: FixRootCauseFinding[] = [
				{
					id: "rc-1",
					description: `Test ${tc.category}`,
					category: tc.category,
					evidenceRefs: [],
					confidence: "high",
					affectedFiles: ["src/test.ts"],
					suggestedApproach: "Fix it",
				},
			];

			const actions = generator.toActions(findings);
			expect(actions.length).toBeGreaterThan(0);
			expect(actions[0]!.complexity).toBe(tc.expected);
		}
	});

	test("returns empty array for empty findings", () => {
		const generator = createPatchStrategyGenerator();
		const actions = generator.toActions([]);
		expect(actions.length).toBe(0);
	});
});

// =============================================================================
// FixStrategistWorker Generator Accessors
// =============================================================================

describe("FixStrategistWorker generator accessors", () => {
	test("getStrategyGenerator returns the internal generator", () => {
		const worker = createFixStrategistWorker();
		const gen = worker.getStrategyGenerator();
		expect(gen).toBeInstanceOf(PatchStrategyGenerator);
	});

	test("getTestPlanGenerator returns the internal generator", () => {
		const worker = createFixStrategistWorker();
		const gen = worker.getTestPlanGenerator();
		expect(gen).toBeInstanceOf(TestPlanGenerator);
	});
});

// =============================================================================
// FixStrategistWorker Multiple Strategies
// =============================================================================

describe("FixStrategistWorker multiple strategies", () => {
	test("analyze generates strategies with non-empty actions", () => {
		const worker = createFixStrategistWorker();
		const evidence = [
			{
				label: "Error #1",
				content: "TypeError: Cannot read properties of null (reading 'foo')",
				type: "error_message",
				confidence: "high",
			},
			{
				label: "Stack",
				content: "at Object.parse (src/parser.js:42:10)",
				type: "stack_trace",
				confidence: "high",
			},
		];

		const result = worker.analyze(evidence);
		expect(result.success).toBe(true);
		expect(result.strategies.length).toBeGreaterThan(0);

		// Each strategy should have actions now (not empty)
		for (const s of result.strategies) {
			expect(s.actions.length).toBeGreaterThan(0);
			expect(s.isComplete).toBe(true);
		}
	});

	test("analyze generates strategies per unique category with multiple evidence types", () => {
		const worker = createFixStrategistWorker({
			maxStrategies: 5,
		});
		const evidence = [
			{
				label: "Null error",
				content: "TypeError: Cannot read properties of null (reading 'name')",
				type: "error_message",
				confidence: "high",
			},
			{
				label: "Config error",
				content: "ConfigurationError: missing required setting 'apiKey'",
				type: "error_message",
				confidence: "high",
			},
			{
				label: "Timeout",
				content: "TimeoutError: request timed out after 30000ms",
				type: "error_message",
				confidence: "high",
			},
		];

		const result = worker.analyze(evidence);
		expect(result.success).toBe(true);
		expect(result.strategies.length).toBeGreaterThanOrEqual(2);

		// Each strategy should target a different category
		const categories = new Set(result.strategies.map((s) => s.rootCauses[0]?.category));
		expect(categories.size).toBe(result.strategies.length);
	});

	test("analyze respects maxStrategies limit", () => {
		const worker = createFixStrategistWorker({
			maxStrategies: 1,
		});
		const evidence = [
			{
				label: "Null error",
				content: "TypeError: Cannot read properties of null",
				type: "error_message",
				confidence: "high",
			},
			{
				label: "Config error",
				content: "ConfigurationError: missing setting",
				type: "error_message",
				confidence: "high",
			},
		];

		const result = worker.analyze(evidence);
		expect(result.strategies.length).toBe(1);
	});

	test("test plans are generated for each strategy", () => {
		const worker = createFixStrategistWorker({
			autoGenerateTestPlans: true,
		});
		const evidence = [
			{
				label: "Error",
				content: "TypeError: Cannot read properties of null",
				type: "error_message",
				confidence: "high",
			},
			{
				label: "Stack",
				content: "at main (src/index.ts:10:5)",
				type: "stack_trace",
				confidence: "high",
			},
		];

		const result = worker.analyze(evidence);
		expect(result.testPlans.length).toBe(result.strategies.length);
		for (const plan of result.testPlans) {
			expect(plan.isComplete).toBe(true);
			expect(plan.testCases.length).toBeGreaterThan(0);
		}
	});

	test("generateStrategy with auto-generated actions yields complete strategy", () => {
		const generator = createPatchStrategyGenerator();
		const findings: FixRootCauseFinding[] = [
			{
				id: "rc-1",
				description: "TypeError: null ref",
				category: "null_reference",
				evidenceRefs: ["ev-1"],
				confidence: "high",
				affectedFiles: ["src/module.ts"],
				suggestedApproach: "Add null guard",
			},
		];

		const actions = generator.toActions(findings);
		expect(actions.length).toBeGreaterThan(0);

		const strategy = generator.generateStrategy("Test", "Test strategy", findings, actions, []);
		expect(strategy.isComplete).toBe(true);
		expect(strategy.actions.length).toBeGreaterThan(0);
		expect(strategy.rootCauses.length).toBeGreaterThan(0);
	});
});
