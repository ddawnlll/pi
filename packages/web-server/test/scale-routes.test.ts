/**
 * Scale Routes Tests — server-side pure function tests.
 *
 * Tests the parsing and helper functions from scale-routes.ts.
 * These are pure functions with no Fastify/HTTP dependency.
 *
 * Covers acceptance criteria:
 * 1. User can see each workspace worktree status
 * 2. User can see integration queue status
 * 3. User can see merge conflicts and handoff details
 * 4. User can see why 6-worker mode is enabled/blocked
 * 5. Worktree cleanup is scoped and safe
 */

import { describe, expect, it } from "vitest";
import {
	buildScaleModeReadiness,
	isWorktreeSafeToPrune,
	parseGitWorktreeList,
	parseIntegrationQueue,
	parseMergeConflictArtifact,
	type WorktreeInfo,
} from "../src/scale-routes.js";

// =============================================================================
// 1. Git worktree list parsing
// =============================================================================

describe("parseGitWorktreeList", () => {
	it("parses a single worktree with branch", () => {
		const output = "/repo/path  abc1234 refs/heads/main";
		const result = parseGitWorktreeList(output);
		expect(result).toHaveLength(1);
		expect(result[0].path).toBe("/repo/path");
		expect(result[0].commit).toBe("abc1234");
		expect(result[0].branch).toBe("main");
		expect(result[0].bare).toBe(false);
		expect(result[0].locked).toBe(false);
		expect(result[0].name).toBe("main");
	});

	it("parses a detached HEAD worktree", () => {
		const output = "/repo/.git/worktrees/feature  def5678 (detached HEAD)";
		const result = parseGitWorktreeList(output);
		expect(result).toHaveLength(1);
		expect(result[0].branch).toBeNull();
		expect(result[0].name).toBe("feature");
	});

	it("parses a bare worktree", () => {
		const output = "/repo/.git  abc1234 (bare)";
		const result = parseGitWorktreeList(output);
		expect(result).toHaveLength(1);
		expect(result[0].bare).toBe(true);
		expect(result[0].branch).toBeNull();
	});

	it("parses multiple worktrees", () => {
		const output = [
			"/repo/path  abc1234 refs/heads/main",
			"/repo/worktrees/feature  def5678 refs/heads/feature",
			"/repo/worktrees/fix  1234567 (detached HEAD)",
		].join("\n");

		const result = parseGitWorktreeList(output);
		expect(result).toHaveLength(3);
		expect(result[0].name).toBe("main");
		expect(result[1].name).toBe("feature");
		expect(result[2].name).toBe("fix");
	});

	it("handles empty output", () => {
		const result = parseGitWorktreeList("");
		expect(result).toHaveLength(0);
	});

	it("handles whitespace-only output", () => {
		const result = parseGitWorktreeList("   \n  \n");
		expect(result).toHaveLength(0);
	});

	it("parses locked worktree from bracket notation", () => {
		const output = "/repo/worktrees/feature  abc1234 refs/heads/feature [locked]";
		const result = parseGitWorktreeList(output);
		expect(result[0].locked).toBe(true);
		expect(result[0].branch).toBe("feature");
	});

	it("derives name from path when branch is null", () => {
		const output = "/some/path/to/worktrees/my-workspace  1234567 (detached HEAD)";
		const result = parseGitWorktreeList(output);
		expect(result[0].name).toBe("my-workspace");
	});
});

// =============================================================================
// 2. Integration queue parsing
// =============================================================================

describe("parseIntegrationQueue", () => {
	it("parses a queue with multiple entries", () => {
		const json = JSON.stringify({
			isProcessing: true,
			currentWorkspaceId: "ws-1",
			entries: [
				{
					workspaceId: "ws-1",
					status: "validating",
					commitHash: "abc123",
					queuedAt: 1000,
					processedAt: 1500,
					validationPassed: null,
					error: null,
					conflictFiles: null,
				},
				{
					workspaceId: "ws-2",
					status: "queued",
					commitHash: "def456",
					queuedAt: 2000,
					processedAt: null,
					validationPassed: null,
					error: null,
					conflictFiles: null,
				},
			],
		});

		const result = parseIntegrationQueue(json);
		expect(result.isProcessing).toBe(true);
		expect(result.currentWorkspaceId).toBe("ws-1");
		expect(result.totalEntries).toBe(2);
		expect(result.entries[0].workspaceId).toBe("ws-1");
		expect(result.entries[1].status).toBe("queued");
	});

	it("counts entries by status", () => {
		const json = JSON.stringify({
			isProcessing: false,
			entries: [
				{ workspaceId: "a", status: "merged", commitHash: "a1", queuedAt: 1 },
				{ workspaceId: "b", status: "conflict", commitHash: "b2", queuedAt: 2, conflictFiles: ["f1.txt"] },
				{ workspaceId: "c", status: "queued", commitHash: "c3", queuedAt: 3 },
				{ workspaceId: "d", status: "blocked", commitHash: "d4", queuedAt: 4, error: "validation failed" },
				{ workspaceId: "e", status: "failed", commitHash: "e5", queuedAt: 5 },
				{ workspaceId: "f", status: "merging", commitHash: "f6", queuedAt: 6 },
				{ workspaceId: "g", status: "validating", commitHash: "g7", queuedAt: 7 },
			],
		});

		const result = parseIntegrationQueue(json);
		expect(result.counts.merged).toBe(1);
		expect(result.counts.conflict).toBe(1);
		expect(result.counts.queued).toBe(1);
		expect(result.counts.blocked).toBe(1);
		expect(result.counts.failed).toBe(1);
		expect(result.counts.merging).toBe(1);
		expect(result.counts.validating).toBe(1);
	});

	it("handles empty queue", () => {
		const json = JSON.stringify({ isProcessing: false, entries: [] });
		const result = parseIntegrationQueue(json);
		expect(result.totalEntries).toBe(0);
		expect(result.counts.queued).toBe(0);
		expect(result.entries).toHaveLength(0);
	});

	it("handles entry with conflict files", () => {
		const json = JSON.stringify({
			isProcessing: false,
			entries: [
				{
					workspaceId: "ws-conflict",
					status: "conflict",
					commitHash: "abc",
					queuedAt: 100,
					conflictFiles: ["src/a.ts", "src/b.ts"],
				},
			],
		});

		const result = parseIntegrationQueue(json);
		expect(result.entries[0].conflictFiles).toEqual(["src/a.ts", "src/b.ts"]);
		expect(result.counts.conflict).toBe(1);
	});

	it("handles missing optional fields gracefully", () => {
		const json = JSON.stringify({
			entries: [{ workspaceId: "ws-1", status: "queued", commitHash: "abc", queuedAt: 1 }],
		});

		const result = parseIntegrationQueue(json);
		expect(result.isProcessing).toBe(false);
		expect(result.currentWorkspaceId).toBeNull();
		expect(result.entries[0].validationPassed).toBeNull();
		expect(result.entries[0].error).toBeNull();
		expect(result.entries[0].conflictFiles).toBeNull();
	});
});

// =============================================================================
// 3. Merge conflict artifact parsing
// =============================================================================

describe("parseMergeConflictArtifact", () => {
	it("parses a valid conflict artifact", () => {
		const content = JSON.stringify({
			conflictedFiles: ["src/index.ts", "src/utils.ts"],
			diff: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,3 +1,4 @@",
			timestamp: 1234567890,
			artifactPath: ".pi/merge-conflicts/ws-1.json",
		});

		const result = parseMergeConflictArtifact("ws-1", content);
		expect(result).not.toBeNull();
		expect(result!.workspaceId).toBe("ws-1");
		expect(result!.conflictedFiles).toEqual(["src/index.ts", "src/utils.ts"]);
		expect(result!.diff).toContain("src/index.ts");
		expect(result!.timestamp).toBe(1234567890);
	});

	it("returns null for invalid JSON", () => {
		const result = parseMergeConflictArtifact("ws-1", "not json");
		expect(result).toBeNull();
	});

	it("returns null for empty content", () => {
		const result = parseMergeConflictArtifact("ws-1", "");
		expect(result).toBeNull();
	});

	it("handles missing optional fields", () => {
		const content = JSON.stringify({ conflictedFiles: ["f1.ts"] });
		const result = parseMergeConflictArtifact("ws-1", content);
		expect(result).not.toBeNull();
		expect(result!.conflictedFiles).toEqual(["f1.ts"]);
		expect(result!.diff).toBe("");
		expect(result!.timestamp).toBe(0);
	});
});

// =============================================================================
// 4. Worktree safety check
// =============================================================================

describe("isWorktreeSafeToPrune", () => {
	const makeWorktree = (overrides: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
		path: "/repo/worktrees/feature",
		branch: "feature",
		commit: "abc123",
		bare: false,
		locked: false,
		dirty: false,
		name: "feature",
		...overrides,
	});

	it("allows clean non-main worktree", () => {
		const wt = makeWorktree();
		expect(isWorktreeSafeToPrune(wt, new Set())).toBe(true);
	});

	it("blocks bare worktrees", () => {
		const wt = makeWorktree({ bare: true });
		expect(isWorktreeSafeToPrune(wt, new Set())).toBe(false);
	});

	it("blocks dirty worktrees", () => {
		const wt = makeWorktree({ dirty: true });
		expect(isWorktreeSafeToPrune(wt, new Set())).toBe(false);
	});

	it("blocks main/master worktrees", () => {
		const main = makeWorktree({ name: "main" });
		expect(isWorktreeSafeToPrune(main, new Set())).toBe(false);

		const master = makeWorktree({ name: "master" });
		expect(isWorktreeSafeToPrune(master, new Set())).toBe(false);

		const primary = makeWorktree({ name: "primary" });
		expect(isWorktreeSafeToPrune(primary, new Set())).toBe(false);
	});

	it("blocks dot-prefixed worktrees", () => {
		const wt = makeWorktree({ name: ".hidden" });
		expect(isWorktreeSafeToPrune(wt, new Set())).toBe(false);
	});

	it("blocks worktrees active in integration queue", () => {
		const wt = makeWorktree({ name: "ws-1" });
		const activeIds = new Set(["ws-1", "ws-2"]);
		expect(isWorktreeSafeToPrune(wt, activeIds)).toBe(false);
	});

	it("allows worktree not in active queue", () => {
		const wt = makeWorktree({ name: "ws-old" });
		const activeIds = new Set(["ws-1", "ws-2"]);
		expect(isWorktreeSafeToPrune(wt, activeIds)).toBe(true);
	});
});

// =============================================================================
// 5. Scale mode readiness
// =============================================================================

describe("buildScaleModeReadiness", () => {
	const allSettingsTrue = {
		worktreeIsolationEnabled: true,
		integrationQueueEnabled: true,
		validationLockEnabled: true,
	};

	it("returns ready=true for stable mode (1-3 workers)", () => {
		const result = buildScaleModeReadiness(allSettingsTrue, 3, false);
		expect(result.ready).toBe(true);
		expect(result.currentMode).toBe("stable_3");
		expect(result.isScaleModeActive).toBe(false);
		expect(result.blockedReasons).toHaveLength(0);
	});

	it("returns ready when all prerequisites met for experimental_6 mode", () => {
		const result = buildScaleModeReadiness(allSettingsTrue, 4, true);
		expect(result.ready).toBe(true);
		expect(result.currentMode).toBe("experimental_6");
		expect(result.isScaleModeActive).toBe(true);
		expect(result.blockedReasons).toHaveLength(0);
	});

	it("blocks scale mode when worktree isolation is disabled", () => {
		const result = buildScaleModeReadiness(
			{
				worktreeIsolationEnabled: false,
				integrationQueueEnabled: true,
				validationLockEnabled: true,
			},
			4,
			true,
		);
		expect(result.ready).toBe(false);
		expect(result.isScaleModeActive).toBe(true);
		expect(result.blockedReasons).toHaveLength(1);
		expect(result.blockedReasons[0]).toContain("Worktree Isolation");
	});

	it("blocks scale mode when integration queue is disabled", () => {
		const result = buildScaleModeReadiness(
			{
				worktreeIsolationEnabled: true,
				integrationQueueEnabled: false,
				validationLockEnabled: true,
			},
			5,
			true,
		);
		expect(result.ready).toBe(false);
		expect(result.blockedReasons).toHaveLength(1);
		expect(result.blockedReasons[0]).toContain("Integration Queue");
	});

	it("blocks scale mode when validation lock is disabled", () => {
		const result = buildScaleModeReadiness(
			{
				worktreeIsolationEnabled: true,
				integrationQueueEnabled: true,
				validationLockEnabled: false,
			},
			6,
			true,
		);
		expect(result.ready).toBe(false);
		expect(result.blockedReasons).toHaveLength(1);
		expect(result.blockedReasons[0]).toContain("Global Validation Lock");
	});

	it("reports multiple failures when multiple prerequisites are unmet", () => {
		const result = buildScaleModeReadiness(
			{
				worktreeIsolationEnabled: false,
				integrationQueueEnabled: false,
				validationLockEnabled: false,
			},
			6,
			true,
		);
		expect(result.ready).toBe(false);
		expect(result.blockedReasons).toHaveLength(3);
	});

	it("all prerequisites are listed", () => {
		const result = buildScaleModeReadiness(allSettingsTrue, 3, false);
		expect(result.prerequisites).toHaveLength(3);
		expect(result.prerequisites.map((p) => p.key).sort()).toEqual([
			"integration_queue",
			"validation_lock",
			"worktree_isolation",
		]);
	});

	it("warns when prerequisites are met but workers in stable range", () => {
		const result = buildScaleModeReadiness(allSettingsTrue, 3, true);
		// Two warnings: prerequisites met + stable range, and experimental flag has no effect
		expect(result.warnings.length).toBeGreaterThanOrEqual(1);
		expect(result.warnings.some((w) => w.includes("stable range") && w.includes("4-8"))).toBe(true);
	});

	it("warns when experimental flag set but workers in stable range", () => {
		const result = buildScaleModeReadiness(allSettingsTrue, 2, true);
		expect(result.warnings.length).toBeGreaterThanOrEqual(1);
		expect(result.warnings.some((w) => w.includes("experimental"))).toBe(true);
	});

	it("clamps worker count to valid range", () => {
		const result = buildScaleModeReadiness(allSettingsTrue, 99, true);
		expect(result.currentMode).toBe("scale_8");
		expect(result.requestedWorkers).toBe(99);
		expect(result.maxAllowedWorkers).toBe(8);
	});

	it("clamps worker count below minimum", () => {
		const result = buildScaleModeReadiness(allSettingsTrue, 0, false);
		expect(result.ready).toBe(true);
		expect(result.currentMode).toBe("stable_3");
	});

	it("six workers with experimental enabled returns experimental_6 mode", () => {
		const result = buildScaleModeReadiness(allSettingsTrue, 6, true);
		expect(result.ready).toBe(true);
		expect(result.currentMode).toBe("experimental_6");
		expect(result.isScaleModeActive).toBe(true);
		expect(result.blockedReasons).toHaveLength(0);
	});

	it("eight workers with experimental enabled returns scale_8 mode", () => {
		const result = buildScaleModeReadiness(allSettingsTrue, 8, true);
		expect(result.ready).toBe(true);
		expect(result.currentMode).toBe("scale_8");
		expect(result.isScaleModeActive).toBe(true);
		expect(result.blockedReasons).toHaveLength(0);
		expect(result.maxAllowedWorkers).toBe(8);
	});

	it("includes requestedWorkers and maxAllowedWorkers fields", () => {
		const result = buildScaleModeReadiness(allSettingsTrue, 4, true);
		expect(result).toHaveProperty("requestedWorkers", 4);
		expect(result).toHaveProperty("maxAllowedWorkers", 8);
	});

	it("includes blockedReasons and warnings fields", () => {
		const result = buildScaleModeReadiness(allSettingsTrue, 4, true);
		expect(result).toHaveProperty("blockedReasons");
		expect(result).toHaveProperty("warnings");
		expect(Array.isArray(result.blockedReasons)).toBe(true);
		expect(Array.isArray(result.warnings)).toBe(true);
	});
});
