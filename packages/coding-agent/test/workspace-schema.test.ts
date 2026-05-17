/**
 * Tests for Workspace Schema & Validation - P2 Workstream 7.B
 */

import { describe, expect, it, test } from "vitest";
import {
	ACCEPTED_SCHEMA_VERSIONS,
	buildDependencyGraph,
	CONTRACT_SCHEMA_VERSION,
	canEditFile,
	canRunCommand,
	detectCycles,
	getEntryWorkspaces,
	isAcceptedSchemaVersion,
	validateWorkspaceQueue,
	type Workspace,
	type WorkspaceQueue,
	WorkspaceStage,
} from "../src/core/workspace-schema.js";

describe("WorkspaceStage", () => {
	it("should have all required stages", () => {
		expect(WorkspaceStage.Pending).toBe("pending");
		expect(WorkspaceStage.Active).toBe("active");
		expect(WorkspaceStage.Complete).toBe("complete");
		expect(WorkspaceStage.Blocked).toBe("blocked");
		expect(WorkspaceStage.Failed).toBe("failed");
	});
});

describe("validateWorkspaceQueue", () => {
	it("should pass validation for valid queue", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
				{
					id: "7.B",
					title: "Task B",
					dependencies: ["7.A"],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should detect duplicate workspace IDs", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
				{
					id: "7.A",
					title: "Task A Duplicate",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "duplicate_id")).toBe(true);
	});

	it("should detect invalid dependencies", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: ["7.Z"], // Non-existent
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "invalid_dependency")).toBe(true);
	});

	it("should detect dependency cycles", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: ["7.B"],
					roleBudget: "worker",
					maxRetries: 3,
				},
				{
					id: "7.B",
					title: "Task B",
					dependencies: ["7.A"], // Cycle!
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "cycle")).toBe(true);
	});

	it("should detect invalid role budgets", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "invalid" as any,
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "invalid_role")).toBe(true);
	});
});

describe("detectCycles", () => {
	it("should detect simple cycle", () => {
		const workspaces: Workspace[] = [
			{
				id: "A",
				title: "Task A",
				dependencies: ["B"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "B",
				title: "Task B",
				dependencies: ["A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const result = detectCycles(workspaces);
		expect(result.hasCycle).toBe(true);
		expect(result.cycle).toBeDefined();
	});

	it("should detect complex cycle", () => {
		const workspaces: Workspace[] = [
			{
				id: "A",
				title: "Task A",
				dependencies: ["B"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "B",
				title: "Task B",
				dependencies: ["C"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "C",
				title: "Task C",
				dependencies: ["A"], // Cycle back to A
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const result = detectCycles(workspaces);
		expect(result.hasCycle).toBe(true);
	});

	it("should not detect cycle in valid DAG", () => {
		const workspaces: Workspace[] = [
			{
				id: "A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "B",
				title: "Task B",
				dependencies: ["A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "C",
				title: "Task C",
				dependencies: ["A", "B"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const result = detectCycles(workspaces);
		expect(result.hasCycle).toBe(false);
	});
});

describe("buildDependencyGraph", () => {
	it("should build reverse dependency graph", () => {
		const workspaces: Workspace[] = [
			{
				id: "A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "B",
				title: "Task B",
				dependencies: ["A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "C",
				title: "Task C",
				dependencies: ["A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const graph = buildDependencyGraph(workspaces);

		// A is depended on by B and C
		expect(graph.get("A")).toEqual(expect.arrayContaining(["B", "C"]));
		// B and C have no dependents
		expect(graph.get("B")).toEqual([]);
		expect(graph.get("C")).toEqual([]);
	});
});

describe("getEntryWorkspaces", () => {
	it("should return workspaces with no dependencies", () => {
		const workspaces: Workspace[] = [
			{
				id: "A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "B",
				title: "Task B",
				dependencies: ["A"],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "C",
				title: "Task C",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
		];

		const entries = getEntryWorkspaces(workspaces);
		expect(entries).toHaveLength(2);
		expect(entries.map((w) => w.id)).toEqual(expect.arrayContaining(["A", "C"]));
	});
});

describe("canEditFile", () => {
	it("should allow editing when no capabilities defined", () => {
		expect(canEditFile(undefined, "any-file.ts")).toBe(true);
	});

	it("should allow editing files in canEdit list", () => {
		const capabilities = {
			canEdit: ["src/*.ts"],
			cannotEdit: [],
			canRun: [],
			cannotRun: [],
		};

		expect(canEditFile(capabilities, "src/test.ts")).toBe(true);
	});

	it("should deny editing files in cannotEdit list", () => {
		const capabilities = {
			canEdit: ["src/*.ts"],
			cannotEdit: ["src/forbidden.ts"],
			canRun: [],
			cannotRun: [],
		};

		expect(canEditFile(capabilities, "src/forbidden.ts")).toBe(false);
	});

	it("should deny editing files not in canEdit list when list is non-empty", () => {
		const capabilities = {
			canEdit: ["src/*.ts"],
			cannotEdit: [],
			canRun: [],
			cannotRun: [],
		};

		expect(canEditFile(capabilities, "other/file.ts")).toBe(false);
	});
});

describe("canRunCommand", () => {
	it("should allow running when no capabilities defined", () => {
		expect(canRunCommand(undefined, "npm test")).toBe(true);
	});

	it("should allow running commands in canRun list", () => {
		const capabilities = {
			canEdit: [],
			cannotEdit: [],
			canRun: ["npm test"],
			cannotRun: [],
		};

		expect(canRunCommand(capabilities, "npm test")).toBe(true);
	});

	it("should deny running commands in cannotRun list", () => {
		const capabilities = {
			canEdit: [],
			cannotEdit: [],
			canRun: ["npm test"],
			cannotRun: ["rm -rf *"],
		};

		expect(canRunCommand(capabilities, "rm -rf *")).toBe(false);
	});
});

// ===========================================================================
// v2.2.0 Tests — Contract Schema Parallelism Fields
// ===========================================================================

describe("v2.2.0: contract version", () => {
	it("should accept contract version 2.2.0", () => {
		expect(isAcceptedSchemaVersion("2.2.0")).toBe(true);
	});

	it("should accept contract version 2.1.0", () => {
		expect(isAcceptedSchemaVersion("2.1.0")).toBe(true);
	});

	it("should accept contract version 2.0.0", () => {
		expect(isAcceptedSchemaVersion("2.0.0")).toBe(true);
	});

	it("should reject unknown contract versions", () => {
		expect(isAcceptedSchemaVersion("3.0.0")).toBe(false);
		expect(isAcceptedSchemaVersion("1.0.0")).toBe(false);
	});

	it("CONTRACT_SCHEMA_VERSION should be 2.3.2", () => {
		expect(CONTRACT_SCHEMA_VERSION).toBe("2.3.2");
	});

	it("ACCEPTED_SCHEMA_VERSIONS should contain 2.0.0, 2.1.0, 2.2.0, 2.3.0, 2.3.1", () => {
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.0.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.1.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.2.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.3.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.3.1")).toBe(true);
	});

	it("ACCEPTED_SCHEMA_VERSIONS should also contain 2.3.2", () => {
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.3.2")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.4.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.5.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.size).toBe(8);
	});

	it("should validate a queue with contractVersion 2.2.0", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.2.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should reject a queue with unsupported contractVersion", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "99.0.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "invalid_contract_version")).toBe(true);
	});

	it("should accept a queue without contractVersion (backward compat)", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});
});

describe("v2.2.0: planExecution.interactiveParallelismReview", () => {
	it("should accept queue with planExecution.interactiveParallelismReview true", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.2.0",
			planExecution: {
				interactiveParallelismReview: true,
			},
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});

	it("should accept queue with planExecution.interactiveParallelismReview false", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.2.0",
			planExecution: {
				interactiveParallelismReview: false,
			},
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});

	it("should accept queue without planExecution (backward compat)", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});
});

describe("v2.2.0: parallelismReview schema", () => {
	it("should accept valid parallelismReview with enabled true", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.2.0",
			parallelismReview: {
				enabled: true,
				threshold: 3,
				description: "Review parallelism above threshold",
			},
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should accept parallelismReview with enabled false", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.2.0",
			parallelismReview: {
				enabled: false,
			},
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});

	it("should accept parallelismReview with threshold null", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.2.0",
			parallelismReview: {
				enabled: true,
				threshold: null,
			},
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});

	it("should not break v2.1.0 plans without parallelismReview", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.1.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should reject parallelismReview with non-boolean enabled", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.2.0",
			parallelismReview: {
				enabled: "yes" as any,
			},
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "invalid_parallelism_review")).toBe(true);
	});

	it("should reject parallelismReview with negative threshold", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.2.0",
			parallelismReview: {
				enabled: true,
				threshold: -1,
			},
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.type === "invalid_parallelism_review")).toBe(true);
	});
});

describe("v2.2.0: workspace parallelGroup field", () => {
	it("should accept workspace with parallelGroup", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.2.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
					parallelGroup: "backend",
				},
				{
					id: "7.B",
					title: "Task B",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
					parallelGroup: "backend",
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});

	it("should accept workspace without parallelGroup (backward compat)", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});
});

describe("v2.2.0: workspace dependencyReason field", () => {
	it("should accept workspace with dependencyReason", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.2.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
				{
					id: "7.B",
					title: "Task B",
					dependencies: ["7.A"],
					roleBudget: "worker",
					maxRetries: 3,
					dependencyReason: {
						"7.A": "Needs auth module setup",
					},
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});

	it("should warn on dependencyReason keys not in dependencies", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.2.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
				{
					id: "7.B",
					title: "Task B",
					dependencies: ["7.A"],
					roleBudget: "worker",
					maxRetries: 3,
					dependencyReason: {
						"7.A": "Auth dependency",
						"7.Z": "Non-existent dependency reason",
					},
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true); // warnings don't block validity
		expect(result.warnings.some((w) => w.type === "invalid_dependency_reason")).toBe(true);
	});

	it("should accept workspace without dependencyReason (backward compat)", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});
});

// ===========================================================================
// v2.3.0 Tests — Contract Schema Experimental Parallelism & Prerequisites
// ===========================================================================

describe("v2.3.0: contract version acceptance", () => {
	it("should accept contract version 2.3.0", () => {
		expect(isAcceptedSchemaVersion("2.3.0")).toBe(true);
	});

	it("should accept contract version 2.3.1", () => {
		expect(isAcceptedSchemaVersion("2.3.1")).toBe(true);
	});

	it("CONTRACT_SCHEMA_VERSION should be 2.3.2", () => {
		expect(CONTRACT_SCHEMA_VERSION).toBe("2.3.2");
	});

	it("ACCEPTED_SCHEMA_VERSIONS should contain 2.0.0, 2.1.0, 2.2.0, 2.3.0, 2.3.1, 2.3.2, 2.4.0, 2.5.0", () => {
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.0.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.1.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.2.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.3.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.3.1")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.3.2")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.4.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.has("2.5.0")).toBe(true);
		expect(ACCEPTED_SCHEMA_VERSIONS.size).toBe(8);
	});

	it("should accept supported version 2.5.0", () => {
		expect(isAcceptedSchemaVersion("2.5.0")).toBe(true);
	});
});

describe("v2.3.0: minimal plan validates", () => {
	it("should validate a minimal v2.3.0 plan", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.3.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});
});

describe("v2.3.0: experimental_6 prerequisites", () => {
	const makeBaseQueue = (overrides: Partial<WorkspaceQueue> = {}): WorkspaceQueue => ({
		phase: "P2",
		title: "Test Phase",
		maxParallelWorkspaces: 6,
		contractVersion: "2.3.0",
		planExecution: {
			scale: {
				selectedMode: "experimental_6",
			},
			worktree: { enabled: true },
			integrationQueue: { enabled: true },
			validation: {
				globalValidationLockRequired: true,
			},
		},
		workspaces: [
			{
				id: "7.A",
				title: "Task A",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.B",
				title: "Task B",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.C",
				title: "Task C",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.D",
				title: "Task D",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.E",
				title: "Task E",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
			{
				id: "7.F",
				title: "Task F",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			},
		],
		...overrides,
	});

	it("should validate v2.3.0 experimental_6 with maxParallelWorkspaces=6 and all prerequisites", () => {
		const result = validateWorkspaceQueue(makeBaseQueue());
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("should fail v2.3.0 experimental_6 when worktree is missing", () => {
		const queue = makeBaseQueue();
		if (queue.planExecution) {
			delete queue.planExecution.worktree;
		}
		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.message.includes("worktree"))).toBe(true);
	});

	it("should fail v2.3.0 experimental_6 when integrationQueue is missing", () => {
		const queue = makeBaseQueue();
		if (queue.planExecution) {
			delete queue.planExecution.integrationQueue;
		}
		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.message.includes("integrationQueue"))).toBe(true);
	});

	it("should fail v2.3.0 experimental_6 when globalValidationLockRequired is missing", () => {
		const queue = makeBaseQueue();
		if (queue.planExecution?.validation) {
			delete queue.planExecution.validation.globalValidationLockRequired;
		}
		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.message.includes("globalValidationLockRequired"))).toBe(true);
	});

	it("should fail v2.3.0 experimental_6 when scale.selectedMode is standard (needs experimental_6)", () => {
		const queue = makeBaseQueue();
		if (queue.planExecution?.scale) {
			queue.planExecution.scale.selectedMode = "standard";
		}
		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.message.includes("exceeds standard limit"))).toBe(true);
	});

	it("should fail v2.3.0 when planExecution is missing and maxParallelWorkspaces > 3", () => {
		const queue = makeBaseQueue();
		delete queue.planExecution;
		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.message.includes("exceeds standard limit"))).toBe(true);
	});

	it("should fail v2.3.0 experimental_6 when all prerequisite fields are present but disabled", () => {
		const queue = makeBaseQueue();
		if (queue.planExecution) {
			queue.planExecution.worktree = { enabled: false };
			queue.planExecution.integrationQueue = { enabled: false };
			if (queue.planExecution.validation) {
				queue.planExecution.validation.globalValidationLockRequired = false;
			}
		}
		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThanOrEqual(3);
	});

	it("should require experimental_6 mode to enable >3 parallelism even with all other prereqs", () => {
		const queue = makeBaseQueue();
		if (queue.planExecution?.scale) {
			queue.planExecution.scale.selectedMode = "standard";
		}
		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.message.includes("exceeds standard limit"))).toBe(true);
	});

	it("should fail when maxParallelWorkspaces exceeds 6 in experimental_6", () => {
		const queue = makeBaseQueue({ maxParallelWorkspaces: 7 });
		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.message.includes("exceeds"))).toBe(true);
	});

	it("should succeed with maxParallelWorkspaces=4 and all prerequisites", () => {
		const queue = makeBaseQueue({ maxParallelWorkspaces: 4 });
		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});
});

describe("v2.3.0: pre-v2.3.0 maxParallelWorkspaces limit preserved", () => {
	it("should reject v2.2.0 with maxParallelWorkspaces=6", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 6,
			contractVersion: "2.2.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.message.includes("maxParallelWorkspaces"))).toBe(true);
	});

	it("should reject v2.1.0 with maxParallelWorkspaces=6", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 6,
			contractVersion: "2.1.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
	});

	it("should reject v2.0.0 with maxParallelWorkspaces=6", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 6,
			contractVersion: "2.0.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
	});

	it("should accept v2.3.0 with maxParallelWorkspaces=3 and no planExecution (minimal plan)", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.3.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});
});

// ===========================================================================
// v2.3.2 Tests — Contract Schema Version Acceptance
// ===========================================================================

describe("v2.3.2: contract version acceptance", () => {
	test("should accept contract version 2.3.2", () => {
		expect(isAcceptedSchemaVersion("2.3.2")).toBe(true);
	});

	test("should accept contract version 2.3.1", () => {
		expect(isAcceptedSchemaVersion("2.3.1")).toBe(true);
	});

	test("should accept contract version 2.3.0", () => {
		expect(isAcceptedSchemaVersion("2.3.0")).toBe(true);
	});
});

describe("v2.3.2: minimal plan validates", () => {
	test("should validate a minimal v2.3.2 plan", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.3.2",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});

	test("should be backward compatible with v2.3.0 validations", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "2.3.2",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
			planExecution: {
				scale: { selectedMode: "experimental_6" },
				worktree: { enabled: true },
				integrationQueue: { enabled: true },
				validation: { globalValidationLockRequired: true },
			},
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(true);
	});

	test("should enforce experimental_6 prerequisites for v2.3.2", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 6,
			contractVersion: "2.3.2",
			planExecution: {
				scale: { selectedMode: "experimental_6" },
			},
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
	});
});

describe("Future unsupported versions still rejected", () => {
	it("should reject unsupported version 3.0.0", () => {
		const queue: WorkspaceQueue = {
			phase: "P2",
			title: "Test Phase",
			maxParallelWorkspaces: 3,
			contractVersion: "3.0.0",
			workspaces: [
				{
					id: "7.A",
					title: "Task A",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const result = validateWorkspaceQueue(queue);
		expect(result.valid).toBe(false);
	});
});
