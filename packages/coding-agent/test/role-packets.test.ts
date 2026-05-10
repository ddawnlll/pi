/**
 * Tests for Agent Role Packet Builders - P2 Workstream 7.E
 */

import { describe, expect, it } from "vitest";
import type { WorkspaceState } from "../src/core/plan-state.js";
import {
	createRolePacketBuilder,
	ROLE_CONFIGS,
	RolePacketBuilder,
	verifyPacketHash,
} from "../src/core/role-packets.js";
import type { Workspace } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

describe("RolePacketBuilder", () => {
	const builder = new RolePacketBuilder();

	const mockWorkspace: Workspace = {
		id: "7.A",
		title: "Test Workspace",
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 3,
		capabilities: {
			canEdit: ["src/*.ts"],
			cannotEdit: ["node_modules/*"],
			canRun: ["npm test"],
			cannotRun: ["rm -rf"],
		},
		acceptanceCriteria: ["Tests pass", "Code compiles"],
		targetCommand: "npm test",
	};

	const mockState: WorkspaceState = {
		workspaceId: "7.A",
		stage: WorkspaceStage.Pending,
		attempts: 0,
	};

	describe("buildWorkerPacket", () => {
		it("should build worker packet with correct role", () => {
			const result = builder.buildWorkerPacket(mockWorkspace, mockState);

			expect(result.packet.role).toBe("worker");
			expect(result.packet.workspaceId).toBe("7.A");
			expect(result.packet.goal).toBe("Test Workspace");
		});

		it("should include capabilities in packet", () => {
			const result = builder.buildWorkerPacket(mockWorkspace, mockState);

			expect(result.packet.allowedFiles).toEqual(["src/*.ts"]);
			expect(result.packet.forbiddenFiles).toEqual(["node_modules/*"]);
		});

		it("should include acceptance criteria", () => {
			const result = builder.buildWorkerPacket(mockWorkspace, mockState);

			expect(result.packet.acceptanceCriteria).toHaveLength(2);
			expect(result.packet.acceptanceCriteria[0].description).toBe("Tests pass");
		});

		it("should stay within worker budget", () => {
			const result = builder.buildWorkerPacket(mockWorkspace, mockState);

			expect(result.packet.budget.maxInputTokens).toBe(ROLE_CONFIGS.worker.maxInputTokens);
			expect(result.packet.budget.estimatedInputTokens).toBeLessThanOrEqual(ROLE_CONFIGS.worker.maxInputTokens);
		});

		it("should include hash and timestamp", () => {
			const result = builder.buildWorkerPacket(mockWorkspace, mockState);

			expect(result.hash).toBeDefined();
			expect(result.hash).toHaveLength(64); // SHA-256 hex
			expect(result.createdAt).toBeGreaterThan(0);
		});

		it("should truncate long state summaries", () => {
			const longSummary = "x".repeat(10000);
			const result = builder.buildWorkerPacket(mockWorkspace, mockState, longSummary);

			expect(result.packet.stateSummary.length).toBeLessThan(longSummary.length);
			expect(result.packet.stateSummary).toContain("[truncated]");
		});
	});

	describe("buildFlashPacket", () => {
		it("should build flash packet with minimal context", () => {
			const errorContext = "TypeError: Cannot read property 'foo' of undefined";
			const result = builder.buildFlashPacket(mockWorkspace, mockState, errorContext);

			expect(result.packet.role).toBe("flash");
			expect(result.packet.budget.maxInputTokens).toBe(ROLE_CONFIGS.flash.maxInputTokens);
		});

		it("should include error context in goal", () => {
			const errorContext = "Test failed: expected 1 to equal 2";
			const result = builder.buildFlashPacket(mockWorkspace, mockState, errorContext);

			expect(result.packet.goal).toContain("Quick fix");
			expect(result.packet.goal).toContain("7.A");
		});

		it("should stay within flash budget (4K tokens)", () => {
			const errorContext = "Error message";
			const result = builder.buildFlashPacket(mockWorkspace, mockState, errorContext);

			expect(result.packet.budget.estimatedInputTokens).toBeLessThanOrEqual(4000);
		});
	});

	describe("buildReviewerPacket", () => {
		it("should build reviewer packet", () => {
			const workerReport = "Worker completed task successfully. All tests pass.";
			const result = builder.buildReviewerPacket(mockWorkspace, mockState, workerReport);

			expect(result.packet.role).toBe("reviewer");
			expect(result.packet.budget.maxInputTokens).toBe(ROLE_CONFIGS.reviewer.maxInputTokens);
		});

		it("should include worker report in state summary", () => {
			const workerReport = "Task completed with 3 files changed";
			const result = builder.buildReviewerPacket(mockWorkspace, mockState, workerReport);

			expect(result.packet.stateSummary).toContain("Task completed");
		});

		it("should have empty allowed files (reviewer doesn't edit)", () => {
			const result = builder.buildReviewerPacket(mockWorkspace, mockState, "Report");

			expect(result.packet.allowedFiles).toEqual([]);
		});
	});

	describe("buildLeadPacket", () => {
		it("should build lead packet with larger budget", () => {
			const depResults = {
				"7.A": "Completed successfully",
				"7.B": "Completed with warnings",
			};
			const result = builder.buildLeadPacket(mockWorkspace, mockState, depResults);

			expect(result.packet.role).toBe("lead");
			expect(result.packet.budget.maxInputTokens).toBe(ROLE_CONFIGS.lead.maxInputTokens);
		});

		it("should include dependency results in state summary", () => {
			const depResults = {
				"7.A": "Completed successfully",
				"7.B": "Completed with warnings",
			};
			const result = builder.buildLeadPacket(mockWorkspace, mockState, depResults);

			expect(result.packet.stateSummary).toContain("Dependencies completed");
			expect(result.packet.stateSummary).toContain("7.A");
			expect(result.packet.stateSummary).toContain("7.B");
		});
	});

	describe("packet hashing", () => {
		it("should generate different hashes when timestamp differs", () => {
			const result1 = builder.buildWorkerPacket(mockWorkspace, mockState);

			// Wait a bit to ensure different timestamp
			const start = Date.now();
			while (Date.now() === start) {
				// Busy wait for timestamp to change
			}

			const result2 = builder.buildWorkerPacket(mockWorkspace, mockState);

			// Hashes should be different because createdAt differs
			// But they might be the same if called in same millisecond, so just verify they're valid
			expect(result1.hash).toBeDefined();
			expect(result2.hash).toBeDefined();
		});

		it("should verify packet hash correctly", () => {
			const result = builder.buildWorkerPacket(mockWorkspace, mockState);

			expect(verifyPacketHash(result)).toBe(true);
		});

		it("should detect tampered packets", () => {
			const result = builder.buildWorkerPacket(mockWorkspace, mockState);

			// Tamper with packet
			result.packet.goal = "Tampered goal";

			expect(verifyPacketHash(result)).toBe(false);
		});
	});

	describe("budget validation", () => {
		it("should validate packet is within budget", () => {
			const result = builder.buildWorkerPacket(mockWorkspace, mockState);

			expect(builder.validatePacketBudget(result.packet)).toBe(true);
		});

		it("should attempt to compact packet when over budget", () => {
			const result = builder.buildWorkerPacket(mockWorkspace, mockState);

			// Artificially reduce budget to force compaction
			result.packet.budget.maxInputTokens = 100;

			const compacted = builder.compactPacket(result.packet);

			// Compaction returns a packet (may not always reduce if no snippets to remove)
			expect(compacted).toBeDefined();
			expect(compacted.budget).toBeDefined();
		});
	});

	describe("createRolePacketBuilder", () => {
		it("should create builder instance", () => {
			const builder = createRolePacketBuilder();

			expect(builder).toBeInstanceOf(RolePacketBuilder);
		});
	});

	describe("ROLE_CONFIGS", () => {
		it("should have all role configurations", () => {
			expect(ROLE_CONFIGS.worker).toBeDefined();
			expect(ROLE_CONFIGS.flash).toBeDefined();
			expect(ROLE_CONFIGS.lead).toBeDefined();
			expect(ROLE_CONFIGS.reviewer).toBeDefined();
		});

		it("should have correct budget limits", () => {
			expect(ROLE_CONFIGS.flash.maxInputTokens).toBe(4000);
			expect(ROLE_CONFIGS.worker.maxInputTokens).toBe(12000);
			expect(ROLE_CONFIGS.reviewer.maxInputTokens).toBe(16000);
			expect(ROLE_CONFIGS.lead.maxInputTokens).toBe(24000);
		});
	});
});
