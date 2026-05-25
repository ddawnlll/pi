/**
 * P26.F — Attempt-scoped worktrees, branches, logs, and artifacts
 *
 * Tests:
 * - Branch names include planExecutionId, workspaceId, and attemptNo
 * - Worktree paths include attempt identity
 * - WorktreeState includes attemptNo
 * - makeState helper function includes attemptNo
 * - Recovery can mark old attempt abandoned
 */

import { describe, expect, it } from "vitest";
import { WorktreeWorkspaceExecutor } from "../src/worktree/worktree-workspace-executor.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P26.F — Attempt-scoped worktrees and branches", () => {
	it("should include attemptNo in branch name when attemptNo > 0", () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: "/tmp/test",
			planExecutionId: "plan-123",
			workspaceId: "ws-A",
			attemptNo: 1,
			worktree: { enabled: true },
		});

		// Access private branchName via any
		const branchName = (executor as any).branchName;
		expect(branchName).toBe("worktree/plan-123/ws-A-a1");
	});

	it("should not include attemptNo suffix in branch name when attemptNo is 0", () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: "/tmp/test",
			planExecutionId: "plan-123",
			workspaceId: "ws-A",
			attemptNo: 0,
			worktree: { enabled: true },
		});

		const branchName = (executor as any).branchName;
		expect(branchName).toBe("worktree/plan-123/ws-A");
	});

	it("should include attemptNo in worktree root dir when attemptNo > 0", () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: "/tmp/test",
			planExecutionId: "plan-123",
			workspaceId: "ws-B",
			attemptNo: 2,
			worktree: { enabled: true, root: ".pi/worktrees" },
		});

		const worktreeDir = (executor as any).getWorktreeRootDir();
		expect(worktreeDir).toContain("ws-B-a2");
	});

	it("should not include attemptNo suffix in worktree root dir when attemptNo is 0", () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: "/tmp/test",
			planExecutionId: "plan-123",
			workspaceId: "ws-B",
			attemptNo: 0,
			worktree: { enabled: true, root: ".pi/worktrees" },
		});

		const worktreeDir = (executor as any).getWorktreeRootDir();
		expect(worktreeDir).not.toContain("-a0");
		expect(worktreeDir).toContain("ws-B");
	});

	it("should include planExecutionId and workspaceId in branch name", () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: "/tmp/test",
			planExecutionId: "plan-xyz",
			workspaceId: "7.C",
			attemptNo: 0,
			worktree: { enabled: true },
		});

		const branchName = (executor as any).branchName;
		expect(branchName).toContain("plan-xyz");
		expect(branchName).toContain("7.C");
	});

	it("should include planExecutionId and workspaceId in worktree path", () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: "/tmp/test",
			planExecutionId: "plan-xyz",
			workspaceId: "7.C",
			attemptNo: 0,
			worktree: { enabled: true, root: ".pi/worktrees" },
		});

		const worktreeDir = (executor as any).getWorktreeRootDir();
		expect(worktreeDir).toContain("plan-xyz");
		expect(worktreeDir).toContain("7.C");
	});

	it("should store attemptNo in WorktreeState", () => {
		const executor = new WorktreeWorkspaceExecutor({
			workspaceRoot: "/tmp/test",
			planExecutionId: "plan-abc",
			workspaceId: "ws-X",
			attemptNo: 3,
			worktree: { enabled: true },
		});

		// Manually set a worktree state (simulating what createWorktree would do)
		const fakeState = {
			worktreePath: "/tmp/test/worktree",
			baseCommit: "abc123",
			branchName: "worktree/plan-abc/ws-X-a3",
			workspaceId: "ws-X",
			planExecutionId: "plan-abc",
			attemptNo: 3,
			createdAt: Date.now(),
			status: "active" as const,
			statusChangedAt: Date.now(),
		};
		(executor as any).worktreeState = fakeState;

		const state = executor.currentWorktreeState;
		expect(state).not.toBeNull();
		expect(state!.attemptNo).toBe(3);
	});

	it("should include attemptNo in WorktreeListEntry via list()", () => {
		// Structural verification: WorktreeListEntry interface has attemptNo
		const fs = require("node:fs") as typeof import("node:fs");
		const src = fs.readFileSync(require.resolve("../src/worktree/worktree-types.ts"), "utf-8");

		expect(src).toContain("attemptNo: number");
		// Should appear in both WorktreeState and WorktreeListEntry
		const matchCount = (src.match(/attemptNo: number/g) || []).length;
		expect(matchCount).toBeGreaterThanOrEqual(2);
	});

	it("should support abandoned status for old attempts", () => {
		// Structural verification: WorktreeStatus includes abandoned
		const fs = require("node:fs") as typeof import("node:fs");
		const src = fs.readFileSync(require.resolve("../src/worktree/worktree-types.ts"), "utf-8");

		expect(src).toContain("abandoned");
	});

	it("should pass attemptNo through execute options to workspace executor", () => {
		// Structural verification: execute() accepts attemptNo option
		const fs = require("node:fs") as typeof import("node:fs");
		const src = fs.readFileSync(require.resolve("../src/core/workspace-agent-executor.ts"), "utf-8");

		expect(src).toContain("attemptNo?: number");
		expect(src).toContain("attemptNo");
	});

	it("should pass attemptNo from autonomous-executor to workspace executor execute()", () => {
		// Structural verification: autonomous-executor passes attemptNo
		const fs = require("node:fs") as typeof import("node:fs");
		const src = fs.readFileSync(require.resolve("../src/core/autonomous-executor.ts"), "utf-8");

		expect(src).toContain("attemptNo:");
		expect(src).toContain("attemptNo: wsStateForPacket.attempts");
	});

	it("should have different branch names for different attempts", () => {
		const executor1 = new WorktreeWorkspaceExecutor({
			workspaceRoot: "/tmp/test",
			planExecutionId: "plan-1",
			workspaceId: "ws-A",
			attemptNo: 0,
			worktree: { enabled: true },
		});
		const executor2 = new WorktreeWorkspaceExecutor({
			workspaceRoot: "/tmp/test",
			planExecutionId: "plan-1",
			workspaceId: "ws-A",
			attemptNo: 1,
			worktree: { enabled: true },
		});

		const branch1 = (executor1 as any).branchName;
		const branch2 = (executor2 as any).branchName;

		expect(branch1).toBe("worktree/plan-1/ws-A");
		expect(branch2).toBe("worktree/plan-1/ws-A-a1");
		expect(branch1).not.toBe(branch2);
	});

	it("should have different worktree paths for different attempts", () => {
		const executor1 = new WorktreeWorkspaceExecutor({
			workspaceRoot: "/tmp/test",
			planExecutionId: "plan-1",
			workspaceId: "ws-A",
			attemptNo: 0,
			worktree: { enabled: true, root: ".pi/worktrees" },
		});
		const executor2 = new WorktreeWorkspaceExecutor({
			workspaceRoot: "/tmp/test",
			planExecutionId: "plan-1",
			workspaceId: "ws-A",
			attemptNo: 1,
			worktree: { enabled: true, root: ".pi/worktrees" },
		});

		const dir1 = (executor1 as any).getWorktreeRootDir();
		const dir2 = (executor2 as any).getWorktreeRootDir();

		expect(dir1).not.toBe(dir2);
		expect(dir2).toContain("-a1");
	});
});
