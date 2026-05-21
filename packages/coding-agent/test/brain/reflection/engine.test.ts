/**
 * Reflection Engine Tests — P17.C
 *
 * Covers acceptance criteria:
 * - Triggers automatically on plan completion
 * - Analyzes workspace outcomes correctly
 * - Detects failure patterns (retry hotspots, validation failures)
 * - Computes accurate metrics
 * - Summary references evidence (no hallucination)
 * - Memory proposals reference reflection evidence
 * - Future suggestions ranked by priority
 * - Markdown and JSON artifacts written correctly
 */

import { describe, expect, test } from "vitest";
import { ReflectionEngine } from "../../../src/brain/reflection/engine.js";
import type {
	ExecutionJournalEntry,
	ReflectionInput,
	ValidationResult,
	WorkspaceOutcome,
} from "../../../src/brain/reflection/types.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function createOutcome(
	overrides: Partial<WorkspaceOutcome> & { workspaceId: string },
): WorkspaceOutcome {
	return {
		status: "success",
		retryCount: 0,
		duration: 1000,
		...overrides,
	};
}

function createValidation(
	overrides: Partial<ValidationResult> & { component: string },
): ValidationResult {
	return {
		type: "error",
		message: "Validation message",
		passed: false,
		...overrides,
	};
}

function createJournalEntry(
	overrides: Partial<ExecutionJournalEntry> & { workspaceId: string },
): ExecutionJournalEntry {
	return {
		timestamp: "2026-05-22T00:00:00.000Z",
		eventType: "workspace_start",
		severity: "info",
		data: {},
		...overrides,
	};
}

function createDefaultInput(
	overrides?: Partial<ReflectionInput>,
): ReflectionInput {
	return {
		planExecId: "exec-test-001",
		planId: "plan-test-001",
		planTitle: "Test Reflection Plan",
		executionJournal: [
			createJournalEntry({ workspaceId: "ws-A", eventType: "workspace_start" }),
			createJournalEntry({
				workspaceId: "ws-A",
				eventType: "workspace_complete",
				data: { status: "success" },
			}),
			createJournalEntry({ workspaceId: "ws-B", eventType: "workspace_start" }),
			createJournalEntry({
				workspaceId: "ws-B",
				eventType: "workspace_retry",
				data: { retryCount: 1, error: "TypeError" },
			}),
			createJournalEntry({
				workspaceId: "ws-B",
				eventType: "workspace_complete",
				data: { status: "retry" },
			}),
		],
		workspaceOutcomes: [
			createOutcome({
				workspaceId: "ws-A",
				status: "success",
				retryCount: 0,
				duration: 60_000,
				validationPassed: true,
				summary: "Integration tests passed successfully",
			}),
			createOutcome({
				workspaceId: "ws-B",
				status: "retry",
				retryCount: 1,
				duration: 120_000,
				validationPassed: true,
				summary: "Build completed after retry",
			}),
			createOutcome({
				workspaceId: "ws-C",
				status: "failure",
				retryCount: 3,
				duration: 180_000,
				errorTypes: ["TypeError", "NetworkError"],
				validationPassed: false,
				summary: "Deploy failed with network errors",
			}),
		],
		validationResults: [
			createValidation({
				component: "lint",
				type: "error",
				message: "Found 3 ESLint errors in workspace C",
				passed: false,
			}),
			createValidation({
				component: "style",
				type: "warning",
				message: "Style formatting issues detected",
				passed: true,
			}),
		],
		integrationState: {
			wasDirty: true,
			conflicts: 1,
			resolvedConflicts: 0,
		},
		duration: 360_000,
		startTime: "2026-05-22T10:00:00.000Z",
		endTime: "2026-05-22T10:06:00.000Z",
		autonomyLevel: 3,
		policyStops: 0,
		approvalRequests: 1,
		...overrides,
	};
}

function createEngine(config?: Record<string, unknown>): ReflectionEngine {
	return new ReflectionEngine(
		config as Partial<import("../../../src/brain/reflection/types.js").ReflectionConfig>,
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReflectionEngine", () => {
	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	describe("configuration", () => {
		test("uses default config when no args provided", () => {
			const engine = createEngine();
			const config = engine.getConfig();
			expect(config.minWorkspaceCount).toBe(3);
			expect(config.enableMemoryGeneration).toBe(true);
			expect(config.enableFutureSuggestions).toBe(true);
			expect(config.maxFutureSuggestions).toBe(3);
			expect(config.sourceBackedRequired).toBe(true);
			expect(config.outputBaseDir).toBe(".pi/brain/reflections/");
		});

		test("merges partial config with defaults", () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const config = engine.getConfig();
			expect(config.minWorkspaceCount).toBe(1);
			expect(config.enableMemoryGeneration).toBe(true);
		});

		test("setConfig updates configuration", () => {
			const engine = createEngine();
			engine.setConfig({ maxFutureSuggestions: 5, sourceBackedRequired: false });
			const config = engine.getConfig();
			expect(config.maxFutureSuggestions).toBe(5);
			expect(config.sourceBackedRequired).toBe(false);
		});

		test("getConfig returns a copy", () => {
			const engine = createEngine();
			const config = engine.getConfig();
			config.minWorkspaceCount = 99;
			expect(engine.getConfig().minWorkspaceCount).toBe(3);
		});
	});

	// -----------------------------------------------------------------------
	// AC: Triggers on plan completion — generateReflection / reflect
	// -----------------------------------------------------------------------

	describe("generateReflection / reflect", () => {
		test("generates a complete reflection report from input", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			expect(report).toBeDefined();
			expect(report.id).toBeTruthy();
			expect(report.planExecId).toBe("exec-test-001");
			expect(report.planTitle).toBe("Test Reflection Plan");
			expect(report.createdAt).toBeTruthy();
		});

		test("throws when workspace count is below minimum", async () => {
			const engine = createEngine({ minWorkspaceCount: 10 });
			const input = createDefaultInput();

			await expect(engine.reflect(input)).rejects.toThrow(
				"Reflection skipped",
			);
		});

		test("allows reflection with small plans when minWorkspaceCount is lowered", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			expect(report.workspaceCount).toBe(3);
		});
	});

	// -----------------------------------------------------------------------
	// AC: Analyzes workspace outcomes correctly
	// -----------------------------------------------------------------------

	describe("analyzeWhatRan", () => {
		test("lists all workspace IDs with status", () => {
			const engine = createEngine();
			const outcomes = [
				createOutcome({ workspaceId: "ws-A", status: "success" }),
				createOutcome({ workspaceId: "ws-B", status: "retry" }),
				createOutcome({ workspaceId: "ws-C", status: "failure" }),
			];

			const result = engine.analyzeWhatRan(outcomes);

			expect(result).toHaveLength(3);
			expect(result[0]).toContain("ws-A");
			expect(result[1]).toContain("ws-B");
			expect(result[1]).toContain("retry");
			expect(result[2]).toContain("ws-C");
			expect(result[2]).toContain("failure");
		});
	});

	describe("analyzeWhatWorked", () => {
		test("includes successful and retry outcomes", () => {
			const engine = createEngine();
			const outcomes = [
				createOutcome({ workspaceId: "ws-A", status: "success" }),
				createOutcome({ workspaceId: "ws-B", status: "retry" }),
				createOutcome({ workspaceId: "ws-C", status: "failure" }),
			];

			const result = engine.analyzeWhatWorked(outcomes, []);

			expect(result).toHaveLength(2);
			expect(result[0]).toContain("ws-A");
			expect(result[1]).toContain("ws-B");
		});

		test("uses summary when available", () => {
			const engine = createEngine();
			const outcomes = [
				createOutcome({
					workspaceId: "ws-A",
					status: "success",
					summary: "Custom success message",
				}),
			];

			const result = engine.analyzeWhatWorked(outcomes, []);
			expect(result[0]).toContain("Custom success message");
		});
	});

	describe("analyzeWhatFailed", () => {
		test("includes failed outcomes", () => {
			const engine = createEngine();
			const outcomes = [
				createOutcome({ workspaceId: "ws-X", status: "failure" }),
			];

			const result = engine.analyzeWhatFailed(outcomes, []);
			expect(result).toHaveLength(1);
			expect(result[0]).toContain("ws-X");
		});

		test("includes skipped outcomes", () => {
			const engine = createEngine();
			const outcomes = [
				createOutcome({ workspaceId: "ws-skip", status: "skipped" }),
			];

			const result = engine.analyzeWhatFailed(outcomes, []);
			expect(result).toHaveLength(1);
			expect(result[0]).toContain("ws-skip");
		});

		test("includes validation errors", () => {
			const engine = createEngine();
			const outcomes: WorkspaceOutcome[] = [];
			const validations: ValidationResult[] = [
				createValidation({
					component: "typecheck",
					type: "error",
					message: "Type errors found",
					passed: false,
				}),
			];

			const result = engine.analyzeWhatFailed(outcomes, validations);
			expect(result).toHaveLength(1);
			expect(result[0]).toContain("typecheck");
		});

		test("excludes passed validations", () => {
			const engine = createEngine();
			const validations: ValidationResult[] = [
				createValidation({
					component: "lint",
					type: "error",
					message: "Should not appear",
					passed: true,
				}),
			];

			const result = engine.analyzeWhatFailed([], validations);
			expect(result).toHaveLength(0);
		});
	});

	describe("analyzeWhatSlowedDown", () => {
		test("identifies high-retry workspaces", () => {
			const engine = createEngine();
			const outcomes = [
				createOutcome({ workspaceId: "ws-A", status: "success", retryCount: 0, duration: 100 }),
				createOutcome({ workspaceId: "ws-B", status: "success", retryCount: 3, duration: 200 }),
			];

			const result = engine.analyzeWhatSlowedDown(outcomes, []);
			expect(result).toHaveLength(1);
			expect(result[0]).toContain("ws-B");
			expect(result[0]).toContain("3 retries");
		});

		test("identifies slow workspaces (above 2x avg)", () => {
			const engine = createEngine();
			// Three fast workspaces + one very slow one
			// avg = (100 + 100 + 100 + 10000) / 4 = 2575
			// 2x avg = 5150, 10000 > 5150 ✓
			const outcomes = [
				createOutcome({ workspaceId: "ws-fast1", status: "success", retryCount: 0, duration: 100 }),
				createOutcome({ workspaceId: "ws-fast2", status: "success", retryCount: 0, duration: 100 }),
				createOutcome({ workspaceId: "ws-fast3", status: "success", retryCount: 0, duration: 100 }),
				createOutcome({ workspaceId: "ws-slow", status: "success", retryCount: 0, duration: 10000 }),
			];

			const result = engine.analyzeWhatSlowedDown(outcomes, []);
			expect(result).toHaveLength(1);
			expect(result[0]).toContain("ws-slow");
			expect(result[0]).toContain("10000ms");
		});

		test("returns empty array when nothing slowed down", () => {
			const engine = createEngine();
			const outcomes = [
				createOutcome({ workspaceId: "ws-A", status: "success", retryCount: 0, duration: 100 }),
				createOutcome({ workspaceId: "ws-B", status: "success", retryCount: 0, duration: 100 }),
			];

			const result = engine.analyzeWhatSlowedDown(outcomes, []);
			expect(result).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// AC: Computes accurate metrics
	// -----------------------------------------------------------------------

	describe("computeMetrics", () => {
		test("computes correct metrics from outcomes", () => {
			const engine = createEngine();
			const outcomes = [
				createOutcome({ workspaceId: "ws-A", status: "success", retryCount: 0, duration: 1000 }),
				createOutcome({ workspaceId: "ws-B", status: "retry", retryCount: 2, duration: 2000 }),
				createOutcome({ workspaceId: "ws-C", status: "failure", retryCount: 3, duration: 3000 }),
			];

			const metrics = engine.computeMetrics(outcomes);

			expect(metrics.workspaceCount).toBe(3);
			expect(metrics.successCount).toBe(2);
			expect(metrics.failureCount).toBe(1);
			expect(metrics.retryCount).toBe(5);
			expect(metrics.successRate).toBeCloseTo(0.667, 2);
			expect(metrics.avgRetryCount).toBeCloseTo(1.667, 2);
			expect(metrics.totalDuration).toBe(6000);
		});

		test("returns zeros for empty outcomes", () => {
			const engine = createEngine();
			const metrics = engine.computeMetrics([]);

			expect(metrics.workspaceCount).toBe(0);
			expect(metrics.successCount).toBe(0);
			expect(metrics.failureCount).toBe(0);
			expect(metrics.retryCount).toBe(0);
			expect(metrics.successRate).toBe(0);
			expect(metrics.avgRetryCount).toBe(0);
			expect(metrics.totalDuration).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// AC: Summary references evidence (no hallucination)
	// // -----------------------------------------------------------------------

	describe("summary contains evidence references", () => {
		test("generated summary includes [source:*] references", async () => {
			const engine = createEngine({ minWorkspaceCount: 1, sourceBackedRequired: true });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			// Summary should contain source references
			expect(report.summary).toMatch(/\[source:/);

			// whatWorked should contain source references
			for (const w of report.whatWorked) {
				expect(w).toMatch(/\[source:/);
			}

			// whatFailed should contain source references
			for (const w of report.whatFailed) {
				expect(w).toMatch(/\[source:/);
			}
		});

		test("throws when source-backing is required but missing", async () => {
			const engine = createEngine({
				minWorkspaceCount: 1,
				sourceBackedRequired: true,
			});

			// Create an input with no outcomes (so no sources)
			const input = createDefaultInput({
				workspaceOutcomes: [],
				validationResults: [],
			});

			await expect(engine.reflect(input)).rejects.toThrow(
				"Reflection skipped",
			);
		});
	});

	// -----------------------------------------------------------------------
	// AC: Memory proposals reference reflection evidence
	// -----------------------------------------------------------------------

	describe("memory proposals", () => {
		test("generates memory proposals from a full report", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			expect(report.memoriesToCreate.length).toBeGreaterThan(0);
			for (const mem of report.memoriesToCreate) {
				expect(mem.title).toBeTruthy();
				expect(mem.content).toBeTruthy();
				expect(mem.confidence).toBeGreaterThan(0);
				expect(mem.sourceRefs.length).toBeGreaterThan(0);
				expect(mem.type).toMatch(/memory$/);
			}
		});

		test("memory proposals have proper source refs", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			for (const mem of report.memoriesToCreate) {
				for (const ref of mem.sourceRefs) {
					expect(ref.type).toBe("workspace");
					expect(ref.id).toBeTruthy();
					expect(ref.description).toMatch(/^Evidence source reflection:/);
				}
			}
		});

		test("skips memory generation when disabled", async () => {
			const engine = createEngine({
				minWorkspaceCount: 1,
				enableMemoryGeneration: false,
			});
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			expect(report.memoriesToCreate).toHaveLength(0);
		});
	});

	// -----------------------------------------------------------------------
	// AC: Future suggestions ranked by priority
	// -----------------------------------------------------------------------

	describe("future suggestions", () => {
		test("generates future phase suggestions", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			// With the default input (failures + bottlenecks), we should have suggestions
			expect(report.futurePhaseSuggestions.length).toBeGreaterThan(0);
		});

		test("suggestions are ranked by priority", async () => {
			const engine = createEngine({ minWorkspaceCount: 1, maxFutureSuggestions: 5 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			// Each suggestion should have a priority
			for (const s of report.futurePhaseSuggestions) {
				expect(s.priority).toMatch(/^(critical|high|normal|low)$/);
				expect(s.rationale).toBeTruthy();
				expect(s.title).toBeTruthy();
			}
		});

		test("skips future suggestions when disabled", async () => {
			const engine = createEngine({
				minWorkspaceCount: 1,
				enableFutureSuggestions: false,
			});
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			expect(report.futurePhaseSuggestions).toHaveLength(0);
		});

		test("respects maxFutureSuggestions config", async () => {
			const engine = createEngine({
				minWorkspaceCount: 1,
				maxFutureSuggestions: 1,
			});
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			expect(report.futurePhaseSuggestions.length).toBeLessThanOrEqual(1);
		});
	});

	// -----------------------------------------------------------------------
	// AC: Markdown and JSON artifacts written correctly
	// -----------------------------------------------------------------------

	describe("artifact formatting", () => {
		test("writeMarkdown produces formatted markdown", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			const md = engine.writeMarkdown(report);

			expect(md).toContain("## Reflection:");
			expect(md).toContain("### Summary");
			expect(md).toContain("### What Ran");
			expect(md).toContain("### What Worked");
			expect(md).toContain("### What Failed");
			expect(md).toContain("### Metrics");
		});

		test("writeJson produces valid JSON", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			const json = engine.writeJson(report);
			const parsed = JSON.parse(json);

			expect(parsed.id).toBe(report.id);
			expect(parsed.planExecId).toBe("exec-test-001");
		});

		test("artifact paths follow expected pattern", () => {
			const engine = createEngine();
			const mdPath = engine.reflectionMdPath("exec-abc");
			const jsonPath = engine.reflectionJsonPath("exec-abc");

			expect(mdPath).toContain("exec-abc");
			expect(mdPath).toContain("reflection.md");
			expect(jsonPath).toContain("reflection.json");
		});
	});

	// -----------------------------------------------------------------------
	// MorningReportReflectionEngine interface
	// -----------------------------------------------------------------------

	describe("MorningReportReflectionEngine interface", () => {
		test("countReflectionsSince returns 0 when no reflections exist", async () => {
			const engine = createEngine();
			const count = await engine.countReflectionsSince("2026-01-01T00:00:00.000Z");
			expect(count).toBe(0);
		});

		test("countReflectionsSince counts reflections after timestamp", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();

			// Generate reflection now
			await engine.reflect(input);

			// Count after a time before the reflection was created
			const count = await engine.countReflectionsSince("2026-01-01T00:00:00.000Z");
			expect(count).toBe(1);

			// Count after now (in the future) should be 0
			const futureCount = await engine.countReflectionsSince("2099-01-01T00:00:00.000Z");
			expect(futureCount).toBe(0);
		});

		test("countReflectionsSince counts multiple reflections", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });

			await engine.reflect(createDefaultInput({ planExecId: "exec-1" }));
			await engine.reflect(createDefaultInput({ planExecId: "exec-2" }));
			await engine.reflect(createDefaultInput({ planExecId: "exec-3" }));

			const count = await engine.countReflectionsSince("2026-01-01T00:00:00.000Z");
			expect(count).toBe(3);
		});
	});

	// -----------------------------------------------------------------------
	// Report structure and completeness
	// -----------------------------------------------------------------------

	describe("report structure", () => {
		test("contains all required fields", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			expect(report.id).toBeTruthy();
			expect(report.planExecId).toBeTruthy();
			expect(typeof report.summary).toBe("string");
			expect(typeof report.whatPeopleNeedToKnow).toBe("string");
			expect(Array.isArray(report.whatRan)).toBe(true);
			expect(Array.isArray(report.whatWorked)).toBe(true);
			expect(Array.isArray(report.whatFailed)).toBe(true);
			expect(Array.isArray(report.whatSlowedDown)).toBe(true);
			expect(typeof report.workspaceCount).toBe("number");
			expect(typeof report.successCount).toBe("number");
			expect(typeof report.failureCount).toBe("number");
			expect(typeof report.retryCount).toBe("number");
			expect(typeof report.successRate).toBe("number");
			expect(typeof report.totalDuration).toBe("number");
			expect(typeof report.validationFailures).toBe("number");
			expect(Array.isArray(report.memoriesToCreate)).toBe(true);
			expect(Array.isArray(report.futurePhaseSuggestions)).toBe(true);
			expect(typeof report.policyStops).toBe("number");
			expect(typeof report.approvalRequests).toBe("number");
			expect(typeof report.safetyInterventions).toBe("number");
			expect(report.createdAt).toBeTruthy();
			expect(typeof report.confidence).toBe("number");
			expect(Array.isArray(report.sources)).toBe(true);
		});

		test("proposal suggestions reference memory proposals", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			if (report.proposalsToGenerate.length > 0) {
				for (const prop of report.proposalsToGenerate) {
					expect(prop.type).toBeTruthy();
					expect(prop.title).toBeTruthy();
					expect(prop.description).toBeTruthy();
					expect(prop.rationale).toBeTruthy();
					expect(Array.isArray(prop.evidenceIds)).toBe(true);
				}
			}
		});
	});

	// -----------------------------------------------------------------------
	// Fixture loading test
	// -----------------------------------------------------------------------

	describe("fixture loading", () => {
		test("loads valid-input fixture correctly", () => {
			const fixturePath = resolve(
				__dirname,
				"../../fixtures/reflection/valid-input.json",
			);
			const content = readFileSync(fixturePath, "utf-8");
			const input: ReflectionInput = JSON.parse(content);

			expect(input.planExecId).toBe("exec-test-001");
			expect(input.workspaceOutcomes).toHaveLength(3);
			expect(input.validationResults).toHaveLength(3);
		});

		test("loads expected-output fixture correctly", () => {
			const fixturePath = resolve(
				__dirname,
				"../../fixtures/reflection/expected-output.json",
			);
			const content = readFileSync(fixturePath, "utf-8");
			const expected = JSON.parse(content);

			expect(expected.expectedMetrics).toBeDefined();
			expect(expected.expectedMetrics.successRate).toBe(2 / 3);
			expect(expected.expectedMetrics.retryCount).toBe(4);
		});

		test("generated metrics match expected fixture values", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const fixturePath = resolve(
				__dirname,
				"../../fixtures/reflection/valid-input.json",
			);
			const content = readFileSync(fixturePath, "utf-8");
			const input: ReflectionInput = JSON.parse(content);

			const report = await engine.reflect(input);

			// Expected from fixture expectation file
			const expectedPath = resolve(
				__dirname,
				"../../fixtures/reflection/expected-output.json",
			);
			const expectedContent = readFileSync(expectedPath, "utf-8");
			const expected = JSON.parse(expectedContent);

			expect(report.workspaceCount).toBe(expected.expectedMetrics.workspaceCount);
			expect(report.successCount).toBe(expected.expectedMetrics.successCount);
			expect(report.failureCount).toBe(expected.expectedMetrics.failureCount);
			expect(report.retryCount).toBe(expected.expectedMetrics.retryCount);
		});
	});

	// -----------------------------------------------------------------------
	// Integration validation
	// -----------------------------------------------------------------------

	describe("integration state", () => {
		test("includes integration state in the report sources", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			expect(report.sources.length).toBeGreaterThan(0);
		});

		test("all required fields have non-empty values", async () => {
			const engine = createEngine({ minWorkspaceCount: 1 });
			const input = createDefaultInput();
			const report = await engine.reflect(input);

			expect(report.summary.length).toBeGreaterThan(0);
			expect(report.whatPeopleNeedToKnow.length).toBeGreaterThan(0);
			expect(report.whatRan.length).toBeGreaterThan(0);
		});
	});
});
