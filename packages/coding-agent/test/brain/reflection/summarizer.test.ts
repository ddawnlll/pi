/**
 * Source-Backed Summarizer tests — P17.D
 *
 * Covers:
 * - WhatWorked summary references workspace outcomes
 * - WhatFailed summary references validation results
 * - Summaries include source IDs inline [source:workspace-*]
 * - validateEvidenceChain rejects missing references
 * - Markdown and dashboard format outputs
 */

import { describe, expect, test } from "vitest";
import { SourceBackedSummarizer } from "../../../src/brain/reflection/summarizer.js";
import type {
	ReflectionReport,
	SourceRef,
	ValidationResult,
	WorkspaceOutcome,
} from "../../../src/brain/reflection/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSummarizer(): SourceBackedSummarizer {
	return new SourceBackedSummarizer();
}

function makeOutcome(overrides: Partial<WorkspaceOutcome> = {}): WorkspaceOutcome {
	return {
		workspaceId: "ws-test-1",
		status: "success",
		retryCount: 0,
		duration: 1000,
		...overrides,
	};
}

function makeValidationResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
	return {
		type: "error",
		component: "test-component",
		message: "Validation failed",
		passed: false,
		...overrides,
	};
}

function makeSourceRef(overrides: Partial<SourceRef> = {}): SourceRef {
	return {
		type: "workspace",
		id: "workspace-ws-test-1",
		description: "Test workspace source",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SourceBackedSummarizer", () => {
	// ── generateWhatWorkedSummary ──────────────────────────────────────

	describe("generateWhatWorkedSummary", () => {
		test("returns summary with source references for successful outcomes", () => {
			const summarizer = makeSummarizer();
			const outcomes: WorkspaceOutcome[] = [
				makeOutcome({
					workspaceId: "ws-A",
					status: "success",
					summary: "Integration tests passed",
				}),
				makeOutcome({
					workspaceId: "ws-B",
					status: "success",
					summary: "Build completed without errors",
				}),
			];

			const result = summarizer.generateWhatWorkedSummary(outcomes);

			expect(result).toContain("[source:workspace-ws-A]");
			expect(result).toContain("[source:workspace-ws-B]");
			expect(result).toContain("Integration tests passed");
			expect(result).toContain("Build completed without errors");
		});

		test("includes retry outcomes in what worked", () => {
			const summarizer = makeSummarizer();
			const outcomes: WorkspaceOutcome[] = [
				makeOutcome({
					workspaceId: "ws-retry",
					status: "retry",
					retryCount: 2,
					summary: "Succeeded after retries",
				}),
			];

			const result = summarizer.generateWhatWorkedSummary(outcomes);

			expect(result).toContain("[source:workspace-ws-retry]");
		});

		test("excludes failure and skipped outcomes", () => {
			const summarizer = makeSummarizer();
			const outcomes: WorkspaceOutcome[] = [
				makeOutcome({ workspaceId: "ws-ok", status: "success" }),
				makeOutcome({ workspaceId: "ws-fail", status: "failure" }),
				makeOutcome({ workspaceId: "ws-skip", status: "skipped" }),
			];

			const result = summarizer.generateWhatWorkedSummary(outcomes);

			expect(result).toContain("[source:workspace-ws-ok]");
			expect(result).not.toContain("ws-fail");
			expect(result).not.toContain("ws-skip");
		});

		test("returns sentinel when no successes", () => {
			const summarizer = makeSummarizer();

			const result = summarizer.generateWhatWorkedSummary([]);

			expect(result).toBe("No workspaces completed successfully. [source:none]");
		});
	});

	// ── generateWhatFailedSummary ──────────────────────────────────────

	describe("generateWhatFailedSummary", () => {
		test("returns summary with source references for failed outcomes", () => {
			const summarizer = makeSummarizer();
			const outcomes: WorkspaceOutcome[] = [
				makeOutcome({
					workspaceId: "ws-fail-1",
					status: "failure",
					errorTypes: ["TypeError", "NetworkError"],
					summary: "Failed to complete integration",
				}),
			];

			const result = summarizer.generateWhatFailedSummary(outcomes, []);

			expect(result).toContain("[source:workspace-ws-fail-1]");
			expect(result).toContain("Failed to complete integration");
		});

		test("includes validation failures", () => {
			const summarizer = makeSummarizer();
			const validationResults: ValidationResult[] = [
				makeValidationResult({
					component: "lint",
					message: "Found 5 ESLint errors",
				}),
			];

			const result = summarizer.generateWhatFailedSummary([], validationResults);

			expect(result).toContain("[source:validation-lint]");
			expect(result).toContain("Found 5 ESLint errors");
		});

		test("includes skipped outcomes", () => {
			const summarizer = makeSummarizer();
			const outcomes: WorkspaceOutcome[] = [
				makeOutcome({
					workspaceId: "ws-skip-1",
					status: "skipped",
				}),
			];

			const result = summarizer.generateWhatFailedSummary(outcomes, []);

			expect(result).toContain("[source:workspace-ws-skip-1]");
		});

		test("does not include passed validations", () => {
			const summarizer = makeSummarizer();
			const validationResults: ValidationResult[] = [
				makeValidationResult({
					type: "error",
					component: "lint",
					message: "Should not appear",
					passed: true,
				}),
			];

			const result = summarizer.generateWhatFailedSummary([], validationResults);

			expect(result).not.toContain("Should not appear");
		});

		test("does not include info/warning validations as errors", () => {
			const summarizer = makeSummarizer();
			const validationResults: ValidationResult[] = [
				makeValidationResult({
					type: "warning",
					component: "style",
					message: "Style warning",
					passed: false,
				}),
				makeValidationResult({
					type: "info",
					component: "docs",
					message: "Info message",
					passed: false,
				}),
			];

			const result = summarizer.generateWhatFailedSummary([], validationResults);

			expect(result).not.toContain("Style warning");
			expect(result).not.toContain("Info message");
		});

		test("returns sentinel when no failures", () => {
			const summarizer = makeSummarizer();
			const outcomes: WorkspaceOutcome[] = [makeOutcome({ workspaceId: "ws-ok", status: "success" })];

			const result = summarizer.generateWhatFailedSummary(outcomes, []);

			expect(result).toBe("No failures detected. [source:none]");
		});
	});

	// ── generateMetricSummary ──────────────────────────────────────────

	describe("generateMetricSummary", () => {
		test("returns metric summary with source references", () => {
			const summarizer = makeSummarizer();

			const result = summarizer.generateMetricSummary({
				successRate: 0.85,
				avgRetryCount: 1.5,
				totalDuration: 125_000,
			});

			expect(result).toContain("[source:metrics]");
			expect(result).toContain("85.0%");
			expect(result).toContain("1.50");
			expect(result).toContain("2m 5s");
		});

		test("formats short durations correctly", () => {
			const summarizer = makeSummarizer();

			const result = summarizer.generateMetricSummary({
				successRate: 1.0,
				avgRetryCount: 0,
				totalDuration: 500,
			});

			expect(result).toContain("500ms");
		});

		test("formats second-only durations correctly", () => {
			const summarizer = makeSummarizer();

			const result = summarizer.generateMetricSummary({
				successRate: 0.5,
				avgRetryCount: 0.33,
				totalDuration: 8_500,
			});

			expect(result).toContain("8.5s");
		});
	});

	// ── validateEvidenceChain ──────────────────────────────────────────

	describe("validateEvidenceChain", () => {
		test("passes when all source references are matched", () => {
			const summarizer = makeSummarizer();
			const text = "Build passed [source:workspace-build] and tests pass [source:workspace-tests].";
			const sources: SourceRef[] = [
				makeSourceRef({ id: "workspace-build", description: "Build workspace" }),
				makeSourceRef({ id: "workspace-tests", description: "Tests workspace" }),
			];

			const result = summarizer.validateEvidenceChain(text, sources);

			expect(result.valid).toBe(true);
			expect(result.matchedRefs).toContain("workspace-build");
			expect(result.matchedRefs).toContain("workspace-tests");
			expect(result.missingRefs).toHaveLength(0);
		});

		test("rejects when source references are missing from sources array", () => {
			const summarizer = makeSummarizer();
			const text = "Build passed [source:workspace-build] and tests pass [source:workspace-tests].";
			const sources: SourceRef[] = [makeSourceRef({ id: "workspace-build", description: "Build workspace" })];

			const result = summarizer.validateEvidenceChain(text, sources);

			expect(result.valid).toBe(false);
			expect(result.missingRefs).toContain("workspace-tests");
			expect(result.matchedRefs).toContain("workspace-build");
		});

		test("rejects when no source references in text", () => {
			const summarizer = makeSummarizer();
			const text = "Build passed and tests pass.";
			const sources: SourceRef[] = [makeSourceRef({ id: "workspace-build", description: "Build workspace" })];

			const result = summarizer.validateEvidenceChain(text, sources);

			expect(result.valid).toBe(false);
			expect(result.missingRefs).toContain("no source references found");
		});

		test("accepts sentinel no-evidence texts", () => {
			const summarizer = makeSummarizer();

			const result1 = summarizer.validateEvidenceChain("No workspaces completed successfully. [source:none]", []);
			expect(result1.valid).toBe(true);

			const result2 = summarizer.validateEvidenceChain("No failures detected. [source:none]", []);
			expect(result2.valid).toBe(true);
		});

		test("[source:none] in arbitrary text is rejected as missing evidence", () => {
			const summarizer = makeSummarizer();
			const text = "Something happened [source:none].";
			const sources: SourceRef[] = [];

			const result = summarizer.validateEvidenceChain(text, sources);

			// [source:none] only accepted for specific sentinel texts
			expect(result.valid).toBe(false);
		});

		test("handles duplicate references", () => {
			const summarizer = makeSummarizer();
			const text = "Build passed [source:workspace-build]. Also build was green [source:workspace-build].";
			const sources: SourceRef[] = [makeSourceRef({ id: "workspace-build", description: "Build workspace" })];

			const result = summarizer.validateEvidenceChain(text, sources);

			expect(result.valid).toBe(true);
			expect(result.matchedRefs).toEqual(["workspace-build"]);
		});
	});

	// ── formatForMarkdown ──────────────────────────────────────────────

	describe("formatForMarkdown", () => {
		test("generates markdown report with all sections", () => {
			const summarizer = makeSummarizer();
			const report: ReflectionReport = {
				id: "ref-1",
				planExecId: "exec-1",
				planTitle: "Test Plan",
				summary: "Plan executed successfully.",
				whatPeopleNeedToKnow: "All good.",
				whatRan: ["ws-1", "ws-2"],
				whatWorked: ["Integration passed [source:workspace-ws-1]"],
				whatFailed: [],
				whatSlowedDown: [],
				workspaceCount: 2,
				successCount: 2,
				failureCount: 0,
				retryCount: 0,
				successRate: 1.0,
				avgRetryCount: 0,
				totalDuration: 60_000,
				validationFailures: 0,
				memoriesToCreate: [
					{
						type: "execution_memory",
						title: "Remember build success",
						content: "Build succeeded on first try",
						confidence: 0.9,
						sourceRefs: [
							{
								type: "workspace",
								id: "workspace-ws-1",
								description: "Workspace 1",
							},
						],
						category: "success",
					},
				],
				proposalsToGenerate: [],
				futurePhaseSuggestions: [
					{
						title: "Optimize build times",
						rationale: "Build is slow",
						priority: "normal",
						estimatedWorkstreams: 1,
						relatedMemoryIds: [],
						relatedObservationIds: [],
					},
				],
				policyStops: 0,
				approvalRequests: 0,
				safetyInterventions: 0,
				createdAt: "2026-05-22T00:00:00.000Z",
				confidence: 0.95,
				sources: [],
			};

			const result = summarizer.formatForMarkdown(report);

			expect(result).toContain("## Reflection: Test Plan");
			expect(result).toContain("### Summary");
			expect(result).toContain("Plan executed successfully.");
			expect(result).toContain("### What Ran");
			expect(result).toContain("- ws-1");
			expect(result).toContain("- ws-2");
			expect(result).toContain("### What Worked");
			expect(result).toContain("- Integration passed [source:workspace-ws-1]");
			expect(result).toContain("### What Failed");
			expect(result).toContain("- Nothing failed");
			expect(result).toContain("### Metrics");
			expect(result).toContain("| Workspaces | 2 |");
			expect(result).toContain("| Success Rate | 100.0% |");
			expect(result).toContain("| Duration | 1m 0s |");
			expect(result).toContain("### Memory Proposals (1)");
			expect(result).toContain("Remember build success");
			expect(result).toContain("### Future Suggestions");
			expect(result).toContain("Optimize build times");
		});

		test("handles empty sections gracefully", () => {
			const summarizer = makeSummarizer();
			const report: ReflectionReport = {
				id: "ref-empty",
				planExecId: "exec-empty",
				summary: "Nothing happened.",
				whatPeopleNeedToKnow: "N/A",
				whatRan: [],
				whatWorked: [],
				whatFailed: [],
				whatSlowedDown: [],
				workspaceCount: 0,
				successCount: 0,
				failureCount: 0,
				retryCount: 0,
				successRate: 0,
				avgRetryCount: 0,
				totalDuration: 0,
				validationFailures: 0,
				memoriesToCreate: [],
				proposalsToGenerate: [],
				futurePhaseSuggestions: [],
				policyStops: 0,
				approvalRequests: 0,
				safetyInterventions: 0,
				createdAt: "2026-05-22T00:00:00.000Z",
				confidence: 0.5,
				sources: [],
			};

			const result = summarizer.formatForMarkdown(report);

			expect(result).toContain("- No workspaces ran");
			expect(result).toContain("- Nothing worked");
			expect(result).toContain("- Nothing failed");
			expect(result).toContain("- None");
		});
	});

	// ── formatForDashboard ─────────────────────────────────────────────

	describe("formatForDashboard", () => {
		test("returns structured data with source extraction", () => {
			const summarizer = makeSummarizer();
			const report: ReflectionReport = {
				id: "ref-dash",
				planExecId: "exec-dash",
				summary: "Plan completed.",
				whatPeopleNeedToKnow: "Good.",
				whatRan: ["ws-1"],
				whatWorked: ["Integration passed [source:workspace-ws-1]", "Build was green [source:workspace-ws-2]"],
				whatFailed: ["Deploy failed [source:workspace-ws-3]"],
				whatSlowedDown: [],
				workspaceCount: 3,
				successCount: 2,
				failureCount: 1,
				retryCount: 0,
				successRate: 0.667,
				avgRetryCount: 0,
				totalDuration: 100_000,
				validationFailures: 1,
				memoriesToCreate: [],
				proposalsToGenerate: [],
				futurePhaseSuggestions: [],
				policyStops: 0,
				approvalRequests: 0,
				safetyInterventions: 0,
				createdAt: "2026-05-22T00:00:00.000Z",
				confidence: 0.8,
				sources: [],
			};

			const result = summarizer.formatForDashboard(report);

			expect(result.summary).toBe("Plan completed.");
			expect(result.whatWorked).toHaveLength(2);
			expect(result.whatWorked[0].text).toBe("Integration passed [source:workspace-ws-1]");
			expect(result.whatWorked[0].sources).toEqual(["workspace-ws-1"]);
			expect(result.whatWorked[1].sources).toEqual(["workspace-ws-2"]);
			expect(result.whatFailed).toHaveLength(1);
			expect(result.whatFailed[0].text).toBe("Deploy failed [source:workspace-ws-3]");
			expect(result.whatFailed[0].sources).toEqual(["workspace-ws-3"]);
		});

		test("handles empty sections", () => {
			const summarizer = makeSummarizer();
			const report: ReflectionReport = {
				id: "ref-empty-dash",
				planExecId: "exec-empty",
				summary: "Nothing.",
				whatPeopleNeedToKnow: "",
				whatRan: [],
				whatWorked: [],
				whatFailed: [],
				whatSlowedDown: [],
				workspaceCount: 0,
				successCount: 0,
				failureCount: 0,
				retryCount: 0,
				successRate: 0,
				avgRetryCount: 0,
				totalDuration: 0,
				validationFailures: 0,
				memoriesToCreate: [],
				proposalsToGenerate: [],
				futurePhaseSuggestions: [],
				policyStops: 0,
				approvalRequests: 0,
				safetyInterventions: 0,
				createdAt: "2026-05-22T00:00:00.000Z",
				confidence: 0.5,
				sources: [],
			};

			const result = summarizer.formatForDashboard(report);

			expect(result.whatWorked).toHaveLength(0);
			expect(result.whatFailed).toHaveLength(0);
		});
	});
});
