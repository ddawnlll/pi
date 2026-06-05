/**
 * P43.8A — Execution Safety Wiring Test
 *
 * Tests WorkspaceCommitGate integration into the completion gate and automatic execution paths.
 *
 * Uses temp git repos to verify:
 * - Dangerous git command detection in completion gate
 * - completion gate blocks on dangerous commands
 * - WorkspaceCommitGate staged file validation
 * - Write-set drift blocking default
 * - Full flow: scoped commit passes, unsafe commit blocks
 *
 * Does NOT require real LLM API keys.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CompletionGateRegistry,
	hasDangerousGitCommandInHistory,
	isDangerousGitCommand,
} from "../src/core/completion-gate.js";
import { WorkspaceCommitGate } from "../src/core/workspace-commit-gate.js";
import type { Workspace } from "../src/core/workspace-schema.js";

// ===========================================================================
// Helpers
// ===========================================================================

interface TempRepo {
	dir: string;
}

function createTempRepo(): TempRepo {
	const dir = fs.mkdtempSync("p43_8a-safety-");
	execSync("git init", { cwd: dir, stdio: "pipe" });
	execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
	execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });

	// Create initial structure with owned and unowned files
	const files: Record<string, string> = {
		"package.json": JSON.stringify({ name: "test" }),
		"src/owned.ts": 'export function foo(): string { return "foo"; }\n',
		"src/unowned.ts": 'export function bar(): string { return "bar"; }\n',
		"README.md": "# Test Project\n",
	};

	for (const [filePath, content] of Object.entries(files)) {
		const fullPath = path.join(dir, filePath);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, content, "utf-8");
	}

	execSync("git add -A", { cwd: dir, stdio: "pipe" });
	execSync("git commit -m 'initial'", { cwd: dir, stdio: "pipe" });

	return { dir };
}

function cleanupRepo(repo: TempRepo): void {
	try {
		fs.rmSync(repo.dir, { recursive: true, force: true });
	} catch {
		// cleanup only
	}
}

function writeFile(dir: string, relativePath: string, content: string): void {
	const fullPath = path.join(dir, relativePath);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content, "utf-8");
}

function gitAdd(dir: string, filePath: string): void {
	execSync(`git add ${filePath}`, { cwd: dir, stdio: "pipe" });
}

function _gitCommit(dir: string, message: string): void {
	execSync(`git commit -m "${message}"`, { cwd: dir, stdio: "pipe" });
}

function committedFiles(dir: string): string[] {
	try {
		const output = execSync("git show --name-only --pretty=format: HEAD", {
			cwd: dir,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		});
		return output
			.trim()
			.split("\n")
			.filter((f) => f.length > 0 && !f.startsWith("commit ") && !f.startsWith("Author:") && !f.startsWith("Date:"));
	} catch {
		return [];
	}
}

function createTestWorkspace(id: string, writeSet: string[]): Workspace {
	return {
		id,
		title: `Test workspace ${id}`,
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 3,
		writeSet,
		capabilities: {
			canEdit: writeSet,
			canRun: ["npm test"],
		},
	} as Workspace;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("P43.8A Execution Safety Wiring", () => {
	let repo: TempRepo;

	beforeEach(() => {
		repo = createTempRepo();
	});

	afterEach(() => {
		cleanupRepo(repo);
	});

	// =======================================================================
	// Section 1: Dangerous git command detection (pure function)
	// =======================================================================

	describe("isDangerousGitCommand", () => {
		const dangerousCommands = [
			"git add .",
			"git add -A",
			"git add --all",
			"git add -- .",
			"git add ':/'",
			"git commit -a",
			"git commit --all",
			"git commit -am 'msg'",
			"git commit -a -m 'msg'",
			"git add . && git commit -m 'x'",
			"git add -A && git commit -m 'x'",
			"git add --all; git commit -m 'x'",
		];

		for (const cmd of dangerousCommands) {
			it(`detects dangerous: ${cmd}`, () => {
				expect(isDangerousGitCommand(cmd)).toBe(true);
			});
		}

		const safeCommands = [
			"git status",
			"git add src/owned.ts",
			"git add -- src/owned.ts",
			"npm test",
			"ls -la",
			"git commit -m 'test'",
		];

		for (const cmd of safeCommands) {
			it(`allows safe: ${cmd}`, () => {
				expect(isDangerousGitCommand(cmd)).toBe(false);
			});
		}
	});

	describe("hasDangerousGitCommandInHistory", () => {
		it("detects dangerous command in history", () => {
			expect(hasDangerousGitCommandInHistory(["npm test", "git add src/owned.ts", "git add ."])).toBe(true);
		});

		it("returns false for clean history", () => {
			expect(hasDangerousGitCommandInHistory(["npm test", "git status"])).toBe(false);
		});

		it("returns false for empty history", () => {
			expect(hasDangerousGitCommandInHistory([])).toBe(false);
		});
	});

	// =======================================================================
	// Section 2: Completion gate blocks on dangerous commands
	// =======================================================================

	describe("completion gate dangerous git command detection", () => {
		it("blocks completion when dangerous git command is detected by recordCommand", () => {
			const registry = new CompletionGateRegistry();
			const ws = createTestWorkspace("ws-1", ["src/owned.ts"]);

			// Record a dangerous git command
			registry.recordCommand("plan-1", "ws-1", "git add .");
			registry.markImplementationFinished("plan-1", "ws-1");

			const result = registry.evaluateWorkspace("plan-1", "ws-1", ws);
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("Dangerous git command"))).toBe(true);
		});

		it("blocks completion when dangerous git command is in recordCompletion", () => {
			const registry = new CompletionGateRegistry();
			const ws = createTestWorkspace("ws-1", ["src/owned.ts"]);

			registry.markImplementationFinished("plan-1", "ws-1");
			registry.recordCompletion("plan-1", "ws-1", 0, false, "git add -A");

			const result = registry.evaluateWorkspace("plan-1", "ws-1", ws);
			expect(result.canComplete).toBe(false);
		});

		it("allows completion with safe commands only", () => {
			const registry = new CompletionGateRegistry();
			const ws = createTestWorkspace("ws-1", ["src/owned.ts"]);

			registry.recordCommand("plan-1", "ws-1", "npm test");
			registry.recordCompletion("plan-1", "ws-1", 0, true, "npm test");
			registry.markImplementationFinished("plan-1", "ws-1");

			const result = registry.evaluateWorkspace("plan-1", "ws-1", ws);
			expect(result.canComplete).toBe(true);
		});
	});

	// =======================================================================
	// Section 3: WorkspaceCommitGate staged file validation
	// =======================================================================

	describe("WorkspaceCommitGate staged file validation", () => {
		it("blocks completion when unrelated file is staged", async () => {
			const registry = new CompletionGateRegistry();
			const _ws = createTestWorkspace("ws-1", ["src/owned.ts"]);

			// Stage an unrelated file
			writeFile(repo.dir, "README.md", "modified readme");
			gitAdd(repo.dir, "README.md");

			// Validate commit safety
			const reasons = await registry.validateCommitSafety({
				repoRoot: repo.dir,
				workspaceId: "ws-1",
				allowedWriteSet: ["src/owned.ts"],
				allowDeletedOwnedFiles: true,
				forbidBulkGitAdd: true,
				forbidCommitAll: true,
			});

			expect(reasons.length).toBeGreaterThan(0);
			expect(reasons[0]).toContain("README.md");
		});

		it("passes commit safety when only owned files are staged", async () => {
			const registry = new CompletionGateRegistry();
			const _ws = createTestWorkspace("ws-1", ["src/owned.ts"]);

			// Modify and stage owned file only
			writeFile(repo.dir, "src/owned.ts", "modified owned");
			gitAdd(repo.dir, "src/owned.ts");

			const reasons = await registry.validateCommitSafety({
				repoRoot: repo.dir,
				workspaceId: "ws-1",
				allowedWriteSet: ["src/owned.ts"],
				allowDeletedOwnedFiles: true,
				forbidBulkGitAdd: true,
				forbidCommitAll: true,
			});

			expect(reasons).toHaveLength(0);
		});

		it("passes with no staged files at all", async () => {
			const registry = new CompletionGateRegistry();

			const reasons = await registry.validateCommitSafety({
				repoRoot: repo.dir,
				workspaceId: "ws-1",
				allowedWriteSet: ["src/owned.ts"],
				allowDeletedOwnedFiles: true,
				forbidBulkGitAdd: true,
				forbidCommitAll: true,
			});

			expect(reasons).toHaveLength(0);
		});
	});

	// =======================================================================
	// Section 4: Temp repo smoke scenarios
	// =======================================================================

	describe("temp repo smoke scenarios", () => {
		it("scenario 1: dangerous git add . blocks completion via WorkspaceCommitGate", async () => {
			const gate = new WorkspaceCommitGate({
				repoRoot: repo.dir,
				workspaceId: "ws-1",
				allowedWriteSet: ["src/owned.ts"],
			});

			// git add . is dangerous
			const result = gate.validateCommand("git add .");
			expect(result.allowed).toBe(false);
		});

		it("scenario 2: unrelated staged file blocks completion via commit safety", async () => {
			// Modify and stage unrelated file
			writeFile(repo.dir, "README.md", "modified");
			gitAdd(repo.dir, "README.md");

			const gate = new WorkspaceCommitGate({
				repoRoot: repo.dir,
				workspaceId: "ws-1",
				allowedWriteSet: ["src/owned.ts"],
			});

			const state = await gate.inspectGitState();
			expect(state.allowed).toBe(false);
			expect(state.unexpectedStagedFiles).toContain("README.md");
		});

		it("scenario 3: scoped owned-file staging and commit passes", async () => {
			// Modify owned file
			writeFile(repo.dir, "src/owned.ts", "modified owned content");

			// Stage owned file only
			gitAdd(repo.dir, "src/owned.ts");

			// Keep README.md dirty but not staged
			writeFile(repo.dir, "README.md", "modified readme (unstaged)");

			// Validate commit safety
			const gate = new WorkspaceCommitGate({
				repoRoot: repo.dir,
				workspaceId: "ws-1",
				allowedWriteSet: ["src/owned.ts"],
			});

			const state = await gate.inspectGitState();
			expect(state.allowed).toBe(true);
			expect(state.stagedFiles).toContain("src/owned.ts");
			expect(state.unexpectedStagedFiles).toHaveLength(0);

			// Commit
			const commitResult = await gate.createScopedCommit("P43.8A smoke: update owned.ts");
			expect(commitResult.allowed).toBe(true);

			// Verify only owned file is committed
			const committed = committedFiles(repo.dir);
			expect(committed).toContain("src/owned.ts");
			expect(committed).not.toContain("README.md");
		});

		it("scenario 4: git commit -a detected as dangerous by completion gate", async () => {
			const registry = new CompletionGateRegistry();
			const ws = createTestWorkspace("ws-1", ["src/owned.ts"]);

			// Modify owned and unowned files
			writeFile(repo.dir, "src/owned.ts", "modified");
			writeFile(repo.dir, "src/unowned.ts", "modified unowned");

			// Record dangerous command
			registry.recordCommand("plan-1", "ws-1", "git commit -a -m 'test'");
			registry.markImplementationFinished("plan-1", "ws-1");

			const result = registry.evaluateWorkspace("plan-1", "ws-1", ws);
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("git commit -a"))).toBe(true);
		});

		it("scenario 5: unrelated dirty unstaged file does not block scoped commit", async () => {
			// Modify owned file
			writeFile(repo.dir, "src/owned.ts", "modified owned");

			// Leave README.md dirty but unstaged
			writeFile(repo.dir, "README.md", "dirty readme (unstaged)");

			// Stage only owned file
			gitAdd(repo.dir, "src/owned.ts");

			// Commit via WorkspaceCommitGate
			const gate = new WorkspaceCommitGate({
				repoRoot: repo.dir,
				workspaceId: "ws-1",
				allowedWriteSet: ["src/owned.ts"],
			});

			const commitResult = await gate.createScopedCommit("P43.8A: owned only");
			expect(commitResult.allowed).toBe(true);

			// Verify only owned file is committed
			const committed = committedFiles(repo.dir);
			expect(committed).toContain("src/owned.ts");
			expect(committed).not.toContain("README.md");
		});
	});

	// =======================================================================
	// Section 5: Write-set drift defaults
	// =======================================================================

	describe("write-set drift defaults", () => {
		it("DEFAULT_WRITE_SET_DRIFT_CONFIG has onDriftDetected=block_integration", async () => {
			const { DEFAULT_WRITE_SET_DRIFT_CONFIG } = await import("../src/core/write-set-drift.js");
			expect(DEFAULT_WRITE_SET_DRIFT_CONFIG.onDriftDetected).toBe("block_integration");
			expect(DEFAULT_WRITE_SET_DRIFT_CONFIG.driftThresholdFiles).toBe(0);
		});
	});
});
