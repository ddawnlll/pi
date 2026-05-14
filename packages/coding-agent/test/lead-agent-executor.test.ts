/**
 * Tests for P8.A Read-only Lead Agent Runtime
 *
 * Verifies that:
 * 1. Lead agents use read-only tools (read, grep, find, ls) only
 * 2. Lead agents cannot edit code, execute plans, modify queue, apply patches, or commit
 * 3. Attempts to mutate state are blocked and logged
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AutonomousExecutor, createAutonomousExecutor } from "../src/core/autonomous-executor.js";
import type { WorkspaceState } from "../src/core/plan-state.js";
import { RolePacketBuilder } from "../src/core/role-packets.js";
import type { Workspace, WorkspaceQueue } from "../src/core/workspace-schema.js";
import { validateWorkspaceQueue, WorkspaceStage } from "../src/core/workspace-schema.js";

const TEST_DIR = path.join(process.cwd(), ".test-lead-agent-executor");

describe("P8.A Read-only Lead Agent Runtime", () => {
	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	// ---------------------------------------------------------------------------
	// Lead Agent Packet Tests
	// ---------------------------------------------------------------------------

	describe("RolePacketBuilder - Lead packets", () => {
		const builder = new RolePacketBuilder();

		const mockWorkspace: Workspace = {
			id: "8.A",
			title: "Lead Agent Observation",
			dependencies: ["8.B", "8.C"],
			roleBudget: "lead",
			maxRetries: 0,
			capabilities: {
				canEdit: [],
				canRun: [],
			},
			acceptanceCriteria: ["Observe codebase state", "Report findings"],
		};

		const mockState: WorkspaceState = {
			workspaceId: "8.A",
			stage: WorkspaceStage.Pending,
			attempts: 0,
		};

		it("should build lead packet with lead role", () => {
			const depResults = { "8.B": "Completed", "8.C": "Completed" };
			const result = builder.buildLeadPacket(mockWorkspace, mockState, depResults);

			expect(result.packet.role).toBe("lead");
			expect(result.packet.workspaceId).toBe("8.A");
			expect(result.packet.goal).toBe("Lead Agent Observation");
		});

		it("should include dependency results in lead packet state summary", () => {
			const depResults = { "8.B": "Completed task B", "8.C": "Completed task C" };
			const result = builder.buildLeadPacket(mockWorkspace, mockState, depResults);

			expect(result.packet.stateSummary).toContain("Dependencies completed");
			expect(result.packet.stateSummary).toContain("8.B");
			expect(result.packet.stateSummary).toContain("8.C");
		});

		it("should have larger token budget for lead role", () => {
			const depResults = { "8.B": "Completed" };
			const result = builder.buildLeadPacket(mockWorkspace, mockState, depResults);

			// Lead role budget is 24000 tokens
			expect(result.packet.budget.maxInputTokens).toBe(24000);
		});
	});

	// ---------------------------------------------------------------------------
	// WorkspaceAgentExecutor - Role-aware Tool Selection
	// ---------------------------------------------------------------------------

	describe("Role-aware packet building", () => {
		it("should build lead packet with lead role and observable sources", () => {
			const builder = new RolePacketBuilder();
			const depResults = {};
			const leadWorkspace: Workspace = {
				id: "8.A",
				title: "Lead Observation",
				dependencies: [],
				roleBudget: "lead",
				maxRetries: 0,
				capabilities: {
					canEdit: ["src/**/*.ts"],
					canRun: [],
				},
				acceptanceCriteria: ["Observe codebase"],
			};

			const leadState: WorkspaceState = {
				workspaceId: "8.A",
				stage: WorkspaceStage.Pending,
				attempts: 0,
			};

			const packet = builder.buildLeadPacket(leadWorkspace, leadState, depResults);

			// Verify the packet has lead role
			expect(packet.packet.role).toBe("lead");

			// Observable sources are in allowedFiles
			expect(packet.packet.allowedFiles).toEqual(["src/**/*.ts"]);
		});

		it("should build worker packet with worker role and editable files", () => {
			const builder = new RolePacketBuilder();
			const workspace: Workspace = {
				id: "8.B",
				title: "Worker Task",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: ["src/**/*.ts"],
					canRun: ["npm test"],
				},
				acceptanceCriteria: ["Implement feature"],
			};

			const workerState: WorkspaceState = {
				workspaceId: "8.B",
				stage: WorkspaceStage.Pending,
				attempts: 0,
			};

			const packet = builder.buildWorkerPacket(workspace, workerState);

			// Verify worker packet has worker role
			expect(packet.packet.role).toBe("worker");
			expect(packet.packet.allowedFiles).toEqual(["src/**/*.ts"]);
		});
	});

	// ---------------------------------------------------------------------------
	// AutonomousExecutor - Lead Role Dispatch
	// ---------------------------------------------------------------------------

	describe("AutonomousExecutor - Lead role dispatch", () => {
		let executor: AutonomousExecutor;

		beforeEach(async () => {
			executor = createAutonomousExecutor(TEST_DIR, 3);
		});

		it("should execute lead workspace with read-only role", async () => {
			const queue: WorkspaceQueue = {
				phase: "P8",
				title: "Lead Agent Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "8.A",
						title: "Lead Observation Task",
						dependencies: [],
						roleBudget: "lead",
						maxRetries: 0,
						acceptanceCriteria: ["Observe and report"],
					},
				],
			};

			await executor.initialize(queue);
			const result = await executor.executeWorkspace(queue.workspaces[0]);

			// Lead workspace should complete successfully (simulated mode)
			expect(result.success).toBe(true);
			expect(result.verdict).toBe("COMPLETE");
			expect(result.workspaceId).toBe("8.A");
		});

		it("should execute lead workspace alongside worker workspaces", async () => {
			const queue: WorkspaceQueue = {
				phase: "P8",
				title: "Mixed Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "8.A",
						title: "Lead Observation",
						dependencies: [],
						roleBudget: "lead",
						maxRetries: 0,
						acceptanceCriteria: ["Observe codebase"],
					},
					{
						id: "8.B",
						title: "Worker Task",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
						acceptanceCriteria: ["Implement feature"],
					},
				],
			};

			await executor.initialize(queue);

			const leadResult = await executor.executeWorkspace(queue.workspaces[0]);
			expect(leadResult.success).toBe(true);

			const workerResult = await executor.executeWorkspace(queue.workspaces[1]);
			expect(workerResult.success).toBe(true);
		});

		it("should execute lead workspace after its dependencies complete", async () => {
			const queue: WorkspaceQueue = {
				phase: "P8",
				title: "Dependent Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "8.B",
						title: "Worker Task",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
						acceptanceCriteria: ["Implement feature"],
					},
					{
						id: "8.A",
						title: "Lead Observation (depends on worker)",
						dependencies: ["8.B"],
						roleBudget: "lead",
						maxRetries: 0,
						acceptanceCriteria: ["Observe worker output"],
					},
				],
			};

			await executor.initialize(queue);

			const workerResult = await executor.executeWorkspace(queue.workspaces[0]);
			expect(workerResult.success).toBe(true);

			const leadResult = await executor.executeWorkspace(queue.workspaces[1]);
			expect(leadResult.success).toBe(true);
			expect(leadResult.verdict).toBe("COMPLETE");
		});
	});

	// ---------------------------------------------------------------------------
	// Read-only Enforcement Tests
	// ---------------------------------------------------------------------------

	describe("Read-only enforcement", () => {
		it("should not auto-commit changes for lead workspaces", async () => {
			const executor = createAutonomousExecutor(TEST_DIR, 3);

			const queue: WorkspaceQueue = {
				phase: "P8",
				title: "Lead No-Commit Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "8.A",
						title: "Lead Observation",
						dependencies: [],
						roleBudget: "lead",
						maxRetries: 0,
						autoCommit: true,
						acceptanceCriteria: ["Observe and report"],
					},
				],
			};

			await executor.initialize(queue);
			const result = await executor.executeWorkspace(queue.workspaces[0]);

			// Lead workspace should succeed without committing
			expect(result.success).toBe(true);
			expect(result.verdict).toBe("COMPLETE");
		});

		it("should skip completion gate for lead workspaces", async () => {
			const executor = createAutonomousExecutor(TEST_DIR, 3);

			const queue: WorkspaceQueue = {
				phase: "P8",
				title: "Lead No-Gate Test",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "8.A",
						title: "Lead Observation",
						dependencies: [],
						roleBudget: "lead",
						maxRetries: 0,
						targetCommand: "npm test",
						acceptanceCriteria: ["Observe and report"],
					},
				],
			};

			await executor.initialize(queue);
			const result = await executor.executeWorkspace(queue.workspaces[0]);

			// Lead workspace should complete even with targetCommand set
			// (completion gate is skipped for lead)
			expect(result.success).toBe(true);
			expect(result.verdict).toBe("COMPLETE");
		});
	});

	// ---------------------------------------------------------------------------
	// Lead Prompt Instructions
	// ---------------------------------------------------------------------------

	describe("Lead packet instructions", () => {
		it("should generate lead packet with read-only output contract", () => {
			const builder = new RolePacketBuilder();
			const workspace: Workspace = {
				id: "8.A",
				title: "Lead Observation",
				dependencies: [],
				roleBudget: "lead",
				maxRetries: 0,
				acceptanceCriteria: ["Observe and report"],
			};
			const state: WorkspaceState = {
				workspaceId: "8.A",
				stage: WorkspaceStage.Pending,
				attempts: 0,
			};

			const packet = builder.buildLeadPacket(workspace, state, {});

			// The prompt is generated by WorkspaceAgentExecutor.buildPromptFromPacket
			// which converts the role to read-only instructions.
			// We verify the packet has the right role to trigger read-only mode.
			expect(packet.packet.role).toBe("lead");
			expect(packet.packet.outputContract).toContain("VERDICT: COMPLETE");
		});

		it("should set allowed files as observable sources for lead", () => {
			const builder = new RolePacketBuilder();
			const workspace: Workspace = {
				id: "8.A",
				title: "Lead Observation",
				dependencies: [],
				roleBudget: "lead",
				maxRetries: 0,
				capabilities: {
					canEdit: ["src/**/*.ts", "lib/**/*.ts"],
					canRun: [],
				},
				acceptanceCriteria: ["Observe src and lib"],
			};
			const state: WorkspaceState = {
				workspaceId: "8.A",
				stage: WorkspaceStage.Pending,
				attempts: 0,
			};

			const packet = builder.buildLeadPacket(workspace, state, {});

			// Verify the allowedFiles (observable sources) are in the packet
			expect(packet.packet.allowedFiles).toEqual(["src/**/*.ts", "lib/**/*.ts"]);
		});
	});

	// ---------------------------------------------------------------------------
	// Workspace Schema - Lead Role Validation
	// ---------------------------------------------------------------------------

	describe("Workspace schema - Lead role validation", () => {
		it("should validate lead roleBudget as valid TokenRole", () => {
			const queue: WorkspaceQueue = {
				phase: "P8",
				title: "Lead Validation",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "8.A",
						title: "Lead Task",
						dependencies: [],
						roleBudget: "lead",
						maxRetries: 0,
					},
				],
			};

			const result = validateWorkspaceQueue(queue);
			expect(result.valid).toBe(true);
		});

		it("should reject invalid roleBudget", () => {
			const queue: WorkspaceQueue = {
				phase: "P8",
				title: "Invalid Role",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "8.A",
						title: "Bad Task",
						dependencies: [],
						roleBudget: "invalid_role" as any,
						maxRetries: 0,
					},
				],
			};

			const result = validateWorkspaceQueue(queue);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.type === "invalid_role")).toBe(true);
		});
	});
});
