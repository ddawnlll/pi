/**
 * Plan Compiler Alpha2 Tests
 *
 * Tests for the `compilePlanSpecAlpha2()` compiler function.
 * Covers source classification, JSON parse, schema validation,
 * semantic validation, graph validation, policy validation,
 * completion validation, and emission.
 */

import { describe, expect, it } from "vitest";
import { compilePlanSpecAlpha2 } from "../../src/core/plan-compiler/compile-alpha2.js";
import type { PlanCompileResult } from "../../src/core/plan-compiler/diagnostics/diagnostic.js";
import { PlanDiagnosticCode } from "../../src/core/plan-compiler/diagnostics/diagnostic-codes.js";

// =============================================================================
// Helpers
// =============================================================================

function minAlpha2Json(overrides: Record<string, unknown> = {}): string {
	const base = {
		planSpecVersion: "5.0.0-alpha2",
		kind: "ImplementationPlan",
		metadata: {
			phaseId: "P48",
			title: "Test Plan",
			description: "A test plan",
			createdAt: "2026-06-09T00:00:00Z",
			updatedAt: "2026-06-09T00:00:00Z",
			owner: "test-user",
			status: "draft",
		},
		compatibility: {
			runtimeContractVersion: "1.0",
			runtimeTemplateVersion: "1.0",
			legacyTemplateCompatible: false,
		},
		intent: {
			goal: "Test goal",
			successCriteria: ["Criterion 1"],
			outOfScope: ["Out of scope"],
		},
		authority: {
			specification: "Test spec",
			executionState: {
				mode: "stable_3",
				maxParallelWorkspaces: 3,
			},
			completion: {
				requiresAcceptanceCriteria: false,
				requiresValidationEvidence: false,
				requiresReport: false,
				requiresRollbackPlan: false,
				requiresFinalVerdict: false,
			},
		},
		enforcementRegistry: {
			rules: [],
			policies: [],
		},
		security: {
			selfModificationFirewall: {
				enabled: true,
				protectedPaths: [],
				requireExplicitApproval: false,
			},
			dataExfiltrationGuard: { enabled: false },
			secretProtection: { enabled: false, maskInLogs: false },
		},
		waves: [
			{
				id: "W1",
				title: "Wave 1",
				description: "First wave",
				order: 0,
				tasks: [
					{
						id: "T1",
						title: "Task 1",
						description: "First task",
						type: "implementation",
						workspaceId: "WS1",
						acceptanceCriteria: ["AC1"],
						priority: "medium",
					},
				],
			},
		],
		workspaces: [
			{
				id: "WS1",
				name: "Workspace 1",
				rootDir: ".",
				canEdit: ["src/"],
			},
		],
		...overrides,
	};
	return JSON.stringify(base);
}

function mustFail(result: PlanCompileResult): void {
	expect(result.ok).toBe(false);
	expect(result.artifact).toBeUndefined();
	expect(result.diagnostics.length).toBeGreaterThan(0);
}

function mustContainCode(diagnostics: PlanCompileResult["diagnostics"], code: string): void {
	const codes = diagnostics.map((d) => d.code);
	expect(codes).toContain(code);
}

// =============================================================================
// Valid input
// =============================================================================

describe("Valid Input", () => {
	it("compiles valid minimal Alpha2 plan", () => {
		const result = compilePlanSpecAlpha2(minAlpha2Json());
		expect(result.ok).toBe(true);
		expect(result.artifact).toBeDefined();
		expect(result.diagnostics.length).toBe(0);
	});

	it("emits CompiledPlan", () => {
		const result = compilePlanSpecAlpha2(minAlpha2Json());
		expect(result.ok).toBe(true);
		expect(result.artifact).toBeDefined();
		const artifact = result.artifact as Record<string, unknown>;
		expect(artifact.planSpecVersion).toBe("5.0.0-alpha2");
		expect(artifact.kind).toBe("ImplementationPlan");
		expect(artifact.waves).toBeDefined();
		expect(artifact.workspaces).toBeDefined();
		expect(artifact.tasks).toBeDefined();
	});

	it("emits workerPackets", () => {
		const result = compilePlanSpecAlpha2(minAlpha2Json());
		expect(result.ok).toBe(true);
		expect(result.workerPackets).toBeDefined();
		expect(Array.isArray(result.workerPackets)).toBe(true);
		expect(result.workerPackets!.length).toBe(1);
	});

	it("emits deterministic planLock", () => {
		const result1 = compilePlanSpecAlpha2(minAlpha2Json());
		const result2 = compilePlanSpecAlpha2(minAlpha2Json());
		expect(result1.ok && result2.ok).toBe(true);
		const lock1 = result1.planLock as Record<string, unknown>;
		const lock2 = result2.planLock as Record<string, unknown>;
		expect(lock1.planLockHash).toBe(lock2.planLockHash);
	});
});

// =============================================================================
// Source classification
// =============================================================================

describe("Source Classification", () => {
	it("rejects empty input -> E_EMPTY_INPUT", () => {
		const result = compilePlanSpecAlpha2("");
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_EMPTY_INPUT);
	});

	it("rejects whitespace-only input -> E_EMPTY_INPUT", () => {
		const result = compilePlanSpecAlpha2("   \n  \t  ");
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_EMPTY_INPUT);
	});

	it("rejects Markdown input -> E_LEGACY_MARKDOWN", () => {
		const markdown = "# My Plan\n\nThis is a plan in markdown format.";
		const result = compilePlanSpecAlpha2(markdown);
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_LEGACY_MARKDOWN);
	});

	it("rejects Markdown with YAML frontmatter -> E_LEGACY_MARKDOWN", () => {
		const markdown = "---\ntitle: Plan\n---\n\n# My Plan";
		const result = compilePlanSpecAlpha2(markdown);
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_LEGACY_MARKDOWN);
	});

	it("rejects legacy v4 Markdown with Part sections -> E_LEGACY_MARKDOWN", () => {
		const markdown = "## Part 1 — Overview\n\nSome content here.\n\n## Part 3 — Workspace Queue";
		const result = compilePlanSpecAlpha2(markdown);
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_LEGACY_MARKDOWN);
	});

	it("rejects non-JSON input -> E_NOT_JSON", () => {
		const result = compilePlanSpecAlpha2("Hello, world!");
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_NOT_JSON);
	});
});

// =============================================================================
// JSON parse
// =============================================================================

describe("JSON Parse", () => {
	it("rejects malformed JSON -> E_MALFORMED_JSON", () => {
		const result = compilePlanSpecAlpha2("{ malformed json }");
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_MALFORMED_JSON);
	});

	it("rejects root array -> E_ROOT_NOT_OBJECT", () => {
		const result = compilePlanSpecAlpha2("[1, 2, 3]");
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_ROOT_NOT_OBJECT);
	});

	it("rejects root primitive 42 -> E_NOT_JSON (not opening with { or [)", () => {
		const result = compilePlanSpecAlpha2("42");
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_NOT_JSON);
	});

	it("rejects null -> E_NOT_JSON (not opening with { or [)", () => {
		const result = compilePlanSpecAlpha2("null");
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_NOT_JSON);
	});
});

// =============================================================================
// Version and kind
// =============================================================================

describe("Version and Kind", () => {
	it("rejects RC1 version 5.0.0 -> E_WRONG_VERSION", () => {
		const plan = minAlpha2Json({ planSpecVersion: "5.0.0" });
		const result = compilePlanSpecAlpha2(plan);
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_WRONG_VERSION);
		expect(result.diagnostics[0].path).toBe("$.planSpecVersion");
	});

	it("rejects wrong planSpecVersion -> E_WRONG_VERSION", () => {
		const plan = minAlpha2Json({ planSpecVersion: "1.0.0" });
		const result = compilePlanSpecAlpha2(plan);
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_WRONG_VERSION);
	});

	it("rejects wrong kind -> E_WRONG_KIND", () => {
		const plan = minAlpha2Json({ kind: "SomethingElse" });
		const result = compilePlanSpecAlpha2(plan);
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_WRONG_KIND);
		expect(result.diagnostics[0].path).toBe("$.kind");
	});
});

// =============================================================================
// Schema validation
// =============================================================================

describe("Schema Validation", () => {
	it("missing metadata -> E_MISSING_FIELD", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		delete obj.metadata;
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		// May be MISSING_FIELD or INVALID_TYPE depending on Zod
		expect(
			result.diagnostics.some((d) => d.code === PlanDiagnosticCode.E_MISSING_FIELD || d.path?.includes("metadata")),
		).toBe(true);
	});

	it("missing intent -> schema error", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		delete obj.intent;
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
	});

	it("missing authority -> schema error", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		delete obj.authority;
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
	});

	it("missing waves -> schema error", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		delete obj.waves;
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
	});

	it("missing workspaces -> schema error", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		delete obj.workspaces;
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
	});

	it("unknown top-level property -> E_UNKNOWN_PROPERTY", () => {
		const plan = minAlpha2Json({ extraField: "value" });
		const result = compilePlanSpecAlpha2(plan);
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_UNKNOWN_PROPERTY);
	});

	it("invalid enum value -> E_INVALID_VALUE", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		obj.metadata.status = "invalid_status";
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_INVALID_VALUE);
	});
});

// =============================================================================
// Semantic validation
// =============================================================================

describe("Semantic Validation", () => {
	it("duplicate workspace ID -> E_DUPLICATE_WORKSPACE_ID", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		obj.workspaces.push({ ...obj.workspaces[0] });
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_DUPLICATE_WORKSPACE_ID);
	});

	it("duplicate wave ID -> E_DUPLICATE_WAVE_ID", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		obj.waves.push({ ...obj.waves[0], order: 1 });
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_DUPLICATE_WAVE_ID);
	});

	it("duplicate task ID -> E_DUPLICATE_TASK_ID", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		const task = { ...obj.waves[0].tasks[0], title: "Duplicate" };
		obj.waves[0].tasks.push(task);
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_DUPLICATE_TASK_ID);
	});

	it("unknown wave dependency -> E_REF_UNKNOWN_WAVE", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		obj.waves[0].dependencies = ["NON_EXISTENT_WAVE"];
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_REF_UNKNOWN_WAVE);
	});

	it("unknown task dependency -> E_REF_UNKNOWN_TASK", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		obj.waves[0].tasks[0].dependencies = ["NON_EXISTENT_TASK"];
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_REF_UNKNOWN_TASK);
	});

	it("unknown workspace ref in task -> E_REF_UNKNOWN_WORKSPACE_TASK", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		obj.waves[0].tasks[0].workspaceId = "NON_EXISTENT_WS";
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_REF_UNKNOWN_WORKSPACE_TASK);
	});
});

// =============================================================================
// Graph validation
// =============================================================================

describe("Graph Validation", () => {
	it("detects wave cycle -> E_CYCLE_WAVE", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		obj.waves = [
			{
				id: "W1",
				title: "W1",
				description: "W1",
				order: 0,
				tasks: [
					{
						id: "T1",
						title: "T1",
						description: "T1",
						type: "implementation",
						workspaceId: "WS1",
						acceptanceCriteria: [],
						priority: "medium",
					},
				],
				dependencies: ["W2"],
			},
			{
				id: "W2",
				title: "W2",
				description: "W2",
				order: 1,
				tasks: [
					{
						id: "T2",
						title: "T2",
						description: "T2",
						type: "implementation",
						workspaceId: "WS1",
						acceptanceCriteria: [],
						priority: "medium",
					},
				],
				dependencies: ["W1"],
			},
		];
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_CYCLE_WAVE);
	});

	it("detects task cycle -> E_CYCLE_TASK", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		obj.waves[0].tasks = [
			{
				id: "T1",
				title: "T1",
				description: "T1",
				type: "implementation",
				workspaceId: "WS1",
				acceptanceCriteria: [],
				priority: "medium",
				dependencies: ["T2"],
			},
			{
				id: "T2",
				title: "T2",
				description: "T2",
				type: "implementation",
				workspaceId: "WS1",
				acceptanceCriteria: [],
				priority: "medium",
				dependencies: ["T1"],
			},
		];
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_CYCLE_TASK);
	});
});

// =============================================================================
// Policy validation
// =============================================================================

describe("Policy Validation", () => {
	it("blocked command in task -> E_BLOCKED_COMMAND", () => {
		const plan = minAlpha2Json({
			commands: {
				policy: "strict",
				blockedCommands: ["rm -rf /"],
				allowedCommands: ["ls", "echo"],
			},
		});
		const obj = JSON.parse(plan);
		obj.waves[0].tasks[0].executionPolicy = {
			mode: "moderate",
			allowedCommands: ["rm -rf /"],
		};
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_BLOCKED_COMMAND);
	});

	it("command policy violation (strict) -> E_COMMAND_POLICY_VIOLATION", () => {
		const plan = minAlpha2Json({
			commands: {
				policy: "strict",
				allowedCommands: ["ls"],
			},
		});
		const obj = JSON.parse(plan);
		obj.waves[0].tasks[0].executionPolicy = {
			mode: "moderate",
			allowedCommands: ["echo"],
		};
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_COMMAND_POLICY_VIOLATION);
	});

	it("protected file edit -> E_FILE_POLICY_VIOLATION", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		obj.security.selfModificationFirewall.protectedPaths = ["packages/coding-agent/src/"];
		obj.waves[0].tasks[0].files = [
			{
				path: "packages/coding-agent/src/core/some-file.ts",
				operation: "modify",
			},
		];
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_FILE_POLICY_VIOLATION);
	});

	it("forbidden delete -> E_DELETE_FORBIDDEN", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		obj.security.selfModificationFirewall.protectedPaths = ["packages/"];
		obj.waves[0].tasks[0].files = [
			{
				path: "packages/coding-agent/src/some-file.ts",
				operation: "delete",
			},
		];
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_DELETE_FORBIDDEN);
	});

	it("invalid validation command -> E_VALIDATION_UNRESOLVABLE", () => {
		const plan = minAlpha2Json({
			commands: {
				policy: "strict",
				allowedCommands: ["npm run check"],
			},
		});
		const obj = JSON.parse(plan);
		obj.validation = {
			preValidation: { checks: ["unknown_check_command"] },
		};
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_VALIDATION_UNRESOLVABLE);
	});
});

// =============================================================================
// Completion validation
// =============================================================================

describe("Completion Validation", () => {
	it("acceptance criteria required but none defined -> E_COMPLETION_UNSATISFIABLE", () => {
		const plan = minAlpha2Json();
		const obj = JSON.parse(plan);
		obj.authority.completion.requiresAcceptanceCriteria = true;
		obj.waves[0].tasks[0].acceptanceCriteria = [];
		const result = compilePlanSpecAlpha2(JSON.stringify(obj));
		mustFail(result);
		mustContainCode(result.diagnostics, PlanDiagnosticCode.E_COMPLETION_UNSATISFIABLE);
	});
});

// =============================================================================
// Regression
// =============================================================================

describe("Regression", () => {
	it("every failing input returns at least one diagnostic", () => {
		const badInputs = [
			"", // empty
			"# Markdown plan", // markdown
			"{ bad json", // malformed JSON
			"[]", // root array
			minAlpha2Json({ planSpecVersion: "5.0.0" }), // wrong version
		];
		for (const input of badInputs) {
			const result = compilePlanSpecAlpha2(input);
			expect(result.diagnostics.length, `Input "${input.slice(0, 30)}" returned no diagnostics`).toBeGreaterThan(0);
		}
	});

	it("no output contains 'no details available'", () => {
		const badInputs = ["", "# Markdown plan", "{ bad json", "[]", minAlpha2Json({ planSpecVersion: "5.0.0" })];
		for (const input of badInputs) {
			const result = compilePlanSpecAlpha2(input);
			const json = JSON.stringify(result.diagnostics);
			expect(json).not.toContain("no details available");
		}
	});

	it("failing compile without diagnostics throws", async () => {
		// The failResult function enforces this invariant
		const mod = await import("../../src/core/plan-compiler/diagnostics/diagnostic.js");
		expect(() => mod.failResult([])).toThrow("Compiler invariant violated");
	});
});
