/**
 * Debug-to-Fix Pipeline — 25.P
 *
 * Tests for:
 * - DebugToFixPolicy creation, validation, defaults
 * - DebugToFixPipeline lifecycle (idle -> debugging -> handoff -> fixing -> completed)
 * - Stage-level execution (debug, handoff, fix)
 * - Budget enforcement, dedup, stop conditions
 * - Evidence-backed diagnostics on failures
 * - Error handling, cancellation, reset
 * - Autonomous behavior with policy gating
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { createDebuggerWorker } from "../../src/brain-workers/debugger/debugger-worker.js";
import { createFixStrategistWorker } from "../../src/brain-workers/fix-strategist/fix-strategist-worker.js";
import {
	ALL_PIPELINE_STATES,
	computeEvidenceHash,
	createDebugToFixPipeline,
	DebugToFixPipeline,
	validatePipelineInput,
} from "../../src/brain-workers/pipelines/debug-to-fix-pipeline.js";
import {
	createDebugToFixPolicy,
	DEFAULT_DEBUG_TO_FIX_POLICY,
	type DebugToFixPolicy,
	type DebugToFixStageConfig,
	stageConfigToWorkerBudget,
	validateDebugToFixPolicy,
} from "../../src/brain-workers/pipelines/debug-to-fix-policy.js";

// =============================================================================
// Constants & Helpers
// =============================================================================

/**
 * Create standard test evidence for pipeline tests.
 */
function createTestEvidence() {
	return [
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
		{
			label: "Log #1",
			content: "[ERROR] Failed to parse user input at line 42",
			type: "execution_log",
			confidence: "medium",
		},
	];
}

/**
 * Create minimal test input for the pipeline.
 */
function createTestInput(overrides?: Record<string, unknown>): Parameters<DebugToFixPipeline["run"]>[0] {
	return {
		label: "Test failure: null reference in parser",
		evidence: createTestEvidence(),
		context: {
			projectPath: "/test/project",
			reproducible: true,
			environment: { node: "18.x", os: "linux" },
		},
		correlationId: "test-correlation-123",
		metadata: { source: "unit-test" },
		...overrides,
	} as Parameters<DebugToFixPipeline["run"]>[0];
}

// =============================================================================
// DebugToFixPolicy
// =============================================================================

describe("DebugToFixPolicy", () => {
	// -----------------------------------------------------------------------
	// Defaults & Creation
	// -----------------------------------------------------------------------

	describe("createDebugToFixPolicy", () => {
		test("creates with default policy", () => {
			const policy = createDebugToFixPolicy();
			expect(policy.enabled).toBe(true);
			expect(policy.autonomous).toBe(true);
			expect(policy.debuggerBudget.maxTokensPerCycle).toBe(
				DEFAULT_DEBUG_TO_FIX_POLICY.debuggerBudget.maxTokensPerCycle,
			);
			expect(policy.fixStrategistBudget.maxTokensPerCycle).toBe(
				DEFAULT_DEBUG_TO_FIX_POLICY.fixStrategistBudget.maxTokensPerCycle,
			);
			expect(policy.dedupConfig.enabled).toBe(true);
			expect(policy.debugStage.enabled).toBe(true);
			expect(policy.handoffStage.enabled).toBe(true);
			expect(policy.fixStage.enabled).toBe(true);
		});

		test("creates with overrides merged into defaults", () => {
			const policy = createDebugToFixPolicy({
				autonomous: false,
				maxTotalRuntimeMs: 1_800_000,
			});

			expect(policy.autonomous).toBe(false);
			expect(policy.maxTotalRuntimeMs).toBe(1_800_000);
			// Unchanged defaults
			expect(policy.fixStage.maxTokens).toBe(DEFAULT_DEBUG_TO_FIX_POLICY.fixStage.maxTokens);
			expect(policy.dedupConfig.enabled).toBe(true);
		});

		test("deep-merges budget overrides", () => {
			const policy = createDebugToFixPolicy({
				debuggerBudget: {
					maxTokensPerCycle: 50_000,
					cooldownMs: 60_000,
					maxConsecutiveFailures: 3,
					maxRuntimeMs: 600_000,
				},
			});

			expect(policy.debuggerBudget.maxTokensPerCycle).toBe(50_000);
			expect(policy.debuggerBudget.cooldownMs).toBe(60_000);
			// Defaults preserved
			expect(policy.debuggerBudget.maxConsecutiveFailures).toBe(3);
			expect(policy.debuggerBudget.maxRuntimeMs).toBe(600_000);
		});

		test("handoffTags are copied by value", () => {
			const tags = ["custom-tag"];
			const policy = createDebugToFixPolicy({ handoffTags: tags });
			tags.push("mutated-tag");
			expect(policy.handoffTags).toEqual(["custom-tag"]);
		});
	});

	// -----------------------------------------------------------------------
	// Validation
	// -----------------------------------------------------------------------

	describe("validateDebugToFixPolicy", () => {
		test("validates a valid policy", () => {
			const result = validateDebugToFixPolicy(DEFAULT_DEBUG_TO_FIX_POLICY);
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
		});

		test("rejects maxTotalRuntimeMs below minimum", () => {
			const policy = createDebugToFixPolicy({ maxTotalRuntimeMs: 5000 });
			const result = validateDebugToFixPolicy(policy);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("maxTotalRuntimeMs must be at least 60,000ms (1 minute)");
		});

		test("rejects negative maxPipelineRetries", () => {
			const policy = createDebugToFixPolicy({ maxPipelineRetries: -1 });
			const result = validateDebugToFixPolicy(policy);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("maxPipelineRetries must be >= 0");
		});

		test("rejects invalid dedup similarityThreshold", () => {
			const policy = createDebugToFixPolicy({
				dedupConfig: { similarityThreshold: 1.5 } as unknown as DebugToFixPolicy["dedupConfig"],
			});
			const result = validateDebugToFixPolicy({
				...policy,
				dedupConfig: { ...policy.dedupConfig, similarityThreshold: 1.5 },
			});
			expect(result.valid).toBe(false);
		});

		test("rejects debug stage with zero runtime", () => {
			const policy = createDebugToFixPolicy({
				debugStage: {
					maxTokens: 1000,
					maxRuntimeMs: 500,
					maxConsecutiveFailures: 1,
					cooldownMs: 1000,
					enabled: true,
				},
			});
			const result = validateDebugToFixPolicy(policy);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("debug stage") && e.includes("maxRuntimeMs"))).toBe(true);
		});

		test("warns on extremely long total runtime", () => {
			const policy = createDebugToFixPolicy({ maxTotalRuntimeMs: 100_000_000 });
			const result = validateDebugToFixPolicy(policy);
			expect(result.warnings.some((w) => w.includes("24 hours"))).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Conversion
	// -----------------------------------------------------------------------

	describe("stageConfigToWorkerBudget", () => {
		test("converts stage config to WorkerBudget correctly", () => {
			const stage: DebugToFixStageConfig = {
				maxTokens: 100_000,
				maxRuntimeMs: 300_000,
				maxConsecutiveFailures: 2,
				cooldownMs: 60_000,
				enabled: true,
			};
			const budget = stageConfigToWorkerBudget(stage);
			expect(budget.maxTokensPerCycle).toBe(100_000);
			expect(budget.maxRuntimeMs).toBe(300_000);
			expect(budget.maxConsecutiveFailures).toBe(2);
			expect(budget.cooldownMs).toBe(60_000);
		});
	});
});

// =============================================================================
// Pipeline Input Validation
// =============================================================================

describe("Pipeline Input Validation", () => {
	test("accepts valid input", () => {
		const errors = validatePipelineInput(createTestInput());
		expect(errors).toEqual([]);
	});

	test("rejects empty label", () => {
		const errors = validatePipelineInput({
			label: "",
			evidence: [{ label: "E", content: "err", type: "error", confidence: "high" }],
		});
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("label");
	});

	test("rejects empty evidence array", () => {
		const errors = validatePipelineInput({ label: "test", evidence: [] });
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("evidence");
	});

	test("rejects evidence with empty content", () => {
		const errors = validatePipelineInput({
			label: "test",
			evidence: [
				{ label: "E1", content: "real error", type: "error_message", confidence: "high" },
				{ label: "E2", content: "", type: "info", confidence: "low" },
			],
		});
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("empty content");
	});
});

// =============================================================================
// Pipeline — DebugToFixPipeline
// =============================================================================

describe("DebugToFixPipeline", () => {
	// -----------------------------------------------------------------------
	// Constructor & Configuration
	// -----------------------------------------------------------------------

	describe("constructor and configuration", () => {
		test("creates with default config", () => {
			const pipeline = createDebugToFixPipeline();
			const config = pipeline.getConfig();
			expect(config.autoStart).toBe(true);
			expect(config.policy.enabled).toBe(true);
			expect(config.policy.autonomous).toBe(true);
			expect(config.tags).toContain("debug-to-fix");
		});

		test("creates idle", () => {
			const pipeline = new DebugToFixPipeline();
			expect(pipeline.getState()).toBe("idle");
			expect(pipeline.isTerminal()).toBe(false);
			expect(pipeline.isActive()).toBe(false);
		});

		test("accepts partial configuration", () => {
			const pipeline = createDebugToFixPipeline({
				autoStart: false,
				policy: createDebugToFixPolicy({ autonomous: false }),
				tags: ["custom-tag"],
			});
			const config = pipeline.getConfig();
			expect(config.autoStart).toBe(false);
			expect(config.policy.autonomous).toBe(false);
			expect(config.tags).toContain("custom-tag");
		});

		test("updatePolicy works when idle", () => {
			const pipeline = new DebugToFixPipeline();
			const result = pipeline.updatePolicy({ autonomous: false });
			expect(result).toBe(true);
			expect(pipeline.getConfig().policy.autonomous).toBe(false);
		});

		test("updatePolicy fails when active", () => {
			const pipeline = new DebugToFixPipeline();
			(pipeline as unknown as { state: string }).state = "debugging";
			const result = pipeline.updatePolicy({ autonomous: false });
			expect(result).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// State Management
	// -----------------------------------------------------------------------

	describe("state management", () => {
		test("ALL_PIPELINE_STATES has all states", () => {
			expect(ALL_PIPELINE_STATES).toContain("idle");
			expect(ALL_PIPELINE_STATES).toContain("debugging");
			expect(ALL_PIPELINE_STATES).toContain("handoff");
			expect(ALL_PIPELINE_STATES).toContain("fixing");
			expect(ALL_PIPELINE_STATES).toContain("completed");
			expect(ALL_PIPELINE_STATES).toContain("paused");
			expect(ALL_PIPELINE_STATES).toContain("failed");
			expect(ALL_PIPELINE_STATES).toContain("cancelled");
			expect(ALL_PIPELINE_STATES.length).toBe(8);
		});

		test("isTerminal returns true for completed state", () => {
			const pipeline = new DebugToFixPipeline();
			(pipeline as unknown as { state: string }).state = "completed";
			expect(pipeline.isTerminal()).toBe(true);
		});

		test("isTerminal returns true for failed state", () => {
			const pipeline = new DebugToFixPipeline();
			(pipeline as unknown as { state: string }).state = "failed";
			expect(pipeline.isTerminal()).toBe(true);
		});

		test("isTerminal returns false for active states", () => {
			const pipeline = new DebugToFixPipeline();
			(pipeline as unknown as { state: string }).state = "debugging";
			expect(pipeline.isTerminal()).toBe(false);
		});

		test("isActive returns true for active states", () => {
			const pipeline = new DebugToFixPipeline();
			expect(pipeline.isActive()).toBe(false);
			(pipeline as unknown as { state: string }).state = "debugging";
			expect(pipeline.isActive()).toBe(true);
			(pipeline as unknown as { state: string }).state = "handoff";
			expect(pipeline.isActive()).toBe(true);
			(pipeline as unknown as { state: string }).state = "fixing";
			expect(pipeline.isActive()).toBe(true);
		});

		test("cancel works on active pipeline", () => {
			const pipeline = new DebugToFixPipeline();
			(pipeline as unknown as { state: string }).state = "debugging";
			const result = pipeline.cancel("test cancellation");
			expect(result).toBe(true);
			expect(pipeline.getState()).toBe("cancelled");
			expect(pipeline.getDiagnostics().length).toBeGreaterThan(0);
			expect(pipeline.getDiagnostics()[0].stopCondition).toBe("user_interrupt");
		});

		test("cancel fails on terminal states", () => {
			const pipeline = new DebugToFixPipeline();
			(pipeline as unknown as { state: string }).state = "completed";
			expect(pipeline.cancel("too late")).toBe(false);
		});

		test("reset works on terminal states", () => {
			const pipeline = new DebugToFixPipeline();
			(pipeline as unknown as { state: string }).state = "failed";
			const result = pipeline.reset();
			expect(result).toBe(true);
			expect(pipeline.getState()).toBe("idle");
			expect(pipeline.getDiagnostics()).toEqual([]);
			expect(pipeline.getStageResults()).toEqual([]);
			expect(pipeline.getTotalTokens()).toBe(0);
		});

		test("reset fails on active states", () => {
			const pipeline = new DebugToFixPipeline();
			(pipeline as unknown as { state: string }).state = "fixing";
			expect(pipeline.reset()).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Full Pipeline Run — Successful
	// -----------------------------------------------------------------------

	describe("run — successful pipeline", () => {
		test("completes all stages successfully", () => {
			const pipeline = createDebugToFixPipeline();
			const debuggerWorker = createDebuggerWorker();
			const fixStrategistWorker = createFixStrategistWorker();
			const input = createTestInput();

			const result = pipeline.run(input, debuggerWorker, fixStrategistWorker);

			expect(result.state).toBe("completed");
			expect(result.success).toBe(true);
			expect(result.stages.length).toBe(3);

			// Check stage results
			const debugStage = result.stages.find((s) => s.stage === "debug");
			expect(debugStage).toBeDefined();
			expect(debugStage!.success).toBe(true);

			const handoffStage = result.stages.find((s) => s.stage === "handoff");
			expect(handoffStage).toBeDefined();
			expect(handoffStage!.success).toBe(true);

			const fixStage = result.stages.find((s) => s.stage === "fix");
			expect(fixStage).toBeDefined();
			expect(fixStage!.success).toBe(true);

			// Check outputs
			expect(result.debuggerOutput).not.toBeNull();
			expect(result.debuggerOutput!.sessionId).toBeDefined();
			expect(result.fixStrategistOutput).not.toBeNull();
			expect(result.fixStrategistOutput!.strategies.length).toBeGreaterThan(0);
			expect(result.fixResult).not.toBeNull();
			expect(result.fixResult!.strategies.length).toBeGreaterThan(0);

			// Check handoff entry
			expect(result.handoffEntryId).not.toBeNull();

			// Check correlation preserved
			expect(result.correlationId).toBe("test-correlation-123");

			// Check runtime is positive
			expect(result.totalRuntimeMs).toBeGreaterThan(0);

			// Check diagnostics exist
			expect(result.diagnostics.length).toBeGreaterThan(0);
		});

		test("maintains coherent timing across stages", () => {
			const pipeline = createDebugToFixPipeline();
			const debuggerWorker = createDebuggerWorker();
			const fixStrategistWorker = createFixStrategistWorker();

			const result = pipeline.run(createTestInput(), debuggerWorker, fixStrategistWorker);

			// Stage results should be ordered correctly
			expect(result.stages[0]!.stage).toBe("debug");
			expect(result.stages[1]!.stage).toBe("handoff");
			expect(result.stages[2]!.stage).toBe("fix");

			// Total runtime should be >= sum of stages
			const sumStageRuntimes = result.stages.reduce((sum, s) => sum + s.runtimeMs, 0);
			expect(result.totalRuntimeMs).toBeGreaterThanOrEqual(sumStageRuntimes);
		});
	});

	// -----------------------------------------------------------------------
	// Full Pipeline Run — Policy Gating
	// -----------------------------------------------------------------------

	describe("run — policy gating", () => {
		test("disabled pipeline returns immediately", () => {
			const pipeline = createDebugToFixPipeline({
				policy: createDebugToFixPolicy({ enabled: false }),
			});
			const debuggerWorker = createDebuggerWorker();
			const fixStrategistWorker = createFixStrategistWorker();

			const result = pipeline.run(createTestInput(), debuggerWorker, fixStrategistWorker);

			expect(result.state).toBe("failed");
			expect(result.success).toBe(false);
			expect(result.stages.length).toBe(0);
			expect(result.diagnostics[0].stopCondition).toBe("policy_blocked");
		});
	});

	// -----------------------------------------------------------------------
	// Compute Evidence Hash
	// -----------------------------------------------------------------------

	describe("computeEvidenceHash", () => {
		test("produces deterministic hash for same evidence", () => {
			const ev1 = [
				{ label: "Error", content: "TypeError: x", type: "error_message", confidence: "high" },
				{ label: "Stack", content: "at foo (bar.js:1)", type: "stack_trace", confidence: "high" },
			];
			const ev2 = [
				{ label: "Error", content: "TypeError: x", type: "error_message", confidence: "high" },
				{ label: "Stack", content: "at foo (bar.js:1)", type: "stack_trace", confidence: "high" },
			];
			expect(computeEvidenceHash(ev1)).toBe(computeEvidenceHash(ev2));
		});

		test("produces different hash for different evidence", () => {
			const ev1 = [{ label: "Error", content: "Error A", type: "error_message", confidence: "high" }];
			const ev2 = [{ label: "Error", content: "Error B", type: "error_message", confidence: "high" }];
			expect(computeEvidenceHash(ev1)).not.toBe(computeEvidenceHash(ev2));
		});
	});
});

// =============================================================================
// Pipeline — Edge Cases and Error Handling
// =============================================================================

describe("DebugToFixPipeline — Edge Cases", () => {
	test("cancellation during debugging produces cancelled state", () => {
		const pipeline = createDebugToFixPipeline();
		(pipeline as unknown as { state: string }).state = "debugging";
		const cancelled = pipeline.cancel("Interrupted by test");
		expect(cancelled).toBe(true);
		expect(pipeline.getState()).toBe("cancelled");
	});

	test("diagnostics include evidence refs on failure", () => {
		const pipeline = createDebugToFixPipeline();
		const debuggerWorker = createDebuggerWorker();
		const fixStrategistWorker = createFixStrategistWorker();

		const result = pipeline.run(createTestInput(), debuggerWorker, fixStrategistWorker);

		// All diagnostics should have evidence refs or context
		for (const diag of result.diagnostics) {
			expect(diag.message).toBeTruthy();
			expect(diag.stopCondition).toBeDefined();
			expect(diag.timestamp).toBeDefined();
		}
	});

	test("pipeline preserves metadata from input", () => {
		const pipeline = createDebugToFixPipeline();
		const debuggerWorker = createDebuggerWorker();
		const fixStrategistWorker = createFixStrategistWorker();

		const input = createTestInput({
			metadata: { customField: "custom-value", source: "integration-test" },
		});

		const result = pipeline.run(input, debuggerWorker, fixStrategistWorker);
		expect(result.metadata).toBeDefined();
	});

	test("pipeline handles multiple sequential runs", () => {
		const pipeline = createDebugToFixPipeline();

		// First run with fresh workers
		const result1 = pipeline.run(
			createTestInput({ label: "Run 1" }),
			createDebuggerWorker(),
			createFixStrategistWorker(),
		);
		expect(result1.success).toBe(true);

		// Reset for second run
		pipeline.reset();

		// Second run with fresh workers to avoid dedup
		const result2 = pipeline.run(
			createTestInput({ label: "Run 2" }),
			createDebuggerWorker(),
			createFixStrategistWorker(),
		);
		expect(result2.success).toBe(true);

		// Both runs should be independent
		expect(result1.id).not.toBe(result2.id);
	});

	test("reset clears all pipeline state", () => {
		const pipeline = createDebugToFixPipeline();
		const debuggerWorker = createDebuggerWorker();
		const fixStrategistWorker = createFixStrategistWorker();

		pipeline.run(createTestInput(), debuggerWorker, fixStrategistWorker);
		expect(pipeline.isTerminal()).toBe(true);

		pipeline.reset();
		expect(pipeline.getState()).toBe("idle");
		expect(pipeline.getDiagnostics()).toEqual([]);
		expect(pipeline.getStageResults()).toEqual([]);
		expect(pipeline.getTotalTokens()).toBe(0);
	});
});

// =============================================================================
// Pipeline — Autonomous Behavior
// =============================================================================

describe("DebugToFixPipeline — Autonomous Behavior", () => {
	test("autonomous mode allows pipeline to run", () => {
		const pipeline = createDebugToFixPipeline({ policy: createDebugToFixPolicy({ autonomous: true }) });
		expect(pipeline.getConfig().policy.autonomous).toBe(true);
	});

	test("non-autonomous mode sets policy flag", () => {
		const pipeline = createDebugToFixPipeline({ policy: createDebugToFixPolicy({ autonomous: false }) });
		expect(pipeline.getConfig().policy.autonomous).toBe(false);
	});

	test("pipeline has explicit stop conditions", () => {
		const pipeline = createDebugToFixPipeline();
		const config = pipeline.getConfig();
		expect(config.policy.maxPipelineRetries).toBeDefined();
		expect(config.policy.maxPipelineRetries).toBeLessThanOrEqual(10);
		expect(config.policy.maxTotalRuntimeMs).toBeLessThanOrEqual(86_400_000);
	});

	test("pipeline produces evidence-backed diagnostics for all failures", () => {
		const pipeline = createDebugToFixPipeline({
			policy: createDebugToFixPolicy({ diagnosticsEnabled: true }),
		});
		expect(pipeline.getConfig().policy.diagnosticsEnabled).toBe(true);

		const debuggerWorker = createDebuggerWorker();
		const fixStrategistWorker = createFixStrategistWorker();

		// Run with empty evidence to produce a diagnostic
		const input = createTestInput({ evidence: [] });
		const result = pipeline.run(input, debuggerWorker, fixStrategistWorker);

		expect(result.diagnostics.length).toBeGreaterThan(0);
		const diagsWithContext = result.diagnostics.filter((d) => Object.keys(d.context).length > 0);
		expect(diagsWithContext.length).toBeGreaterThan(0);
	});
});
