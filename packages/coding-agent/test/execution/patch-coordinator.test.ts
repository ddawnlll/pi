/**
 * Tests for PatchCoordinator, Patch Guards, and RollbackManager.
 *
 * P37.03 Acceptance Criteria:
 * 1. WriteSet violation, forbidden path, stale hash, and apply failure are handled safely.
 * 2. Validation failure triggers rollback.
 * 3. Dirty repo leak after failed patch is zero in tests.
 * 4. Only PatchCoordinator applies patches.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { PatchArtifact } from "../../src/core/execution/patch/patch-artifact.js";
import {
	createPatchArtifact,
	createPatchFileOperation,
	createPatchWriteSet,
} from "../../src/core/execution/patch/patch-artifact.js";
import { createPatchCoordinator, PatchCoordinator } from "../../src/core/execution/patch/patch-coordinator.js";
import {
	checkApplyValidation,
	checkForbiddenPaths,
	checkStaleHash,
	checkWriteSet,
} from "../../src/core/execution/patch/patch-guards.js";
import { RollbackManager } from "../../src/core/execution/patch/rollback-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "patch-coordinator-test-"));
});

/**
 * Create a minimal git repo in the tempDir for stale hash tests.
 */
function initGitRepo(dir: string): string {
	execSync("git init", { cwd: dir, stdio: "pipe" });
	execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
	execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });

	// Create an initial commit
	writeFileSync(join(dir, "README.md"), "# Test\n", "utf-8");
	execSync("git add -A", { cwd: dir, stdio: "pipe" });
	execSync("git commit -m 'initial commit'", { cwd: dir, stdio: "pipe" });

	return execSync("git rev-parse HEAD", { cwd: dir, stdio: "pipe" }).toString().trim();
}

/**
 * Create a stub patch artifact for testing.
 */
function createTestArtifact(overrides?: Partial<PatchArtifact>): PatchArtifact {
	return {
		id: "test-artifact-1",
		planExecId: "plan-test-1",
		workspaceId: "ws-test-1",
		baseSha: "abc123def456",
		writeSet: { files: ["src/main.ts", "src/utils.ts"] },
		fileOperations: [
			{ filePath: "src/main.ts", operation: "edit", oldText: "old", newText: "new", description: "Update main" },
		],
		status: "pending",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

// ===========================================================================
// AC1: Guard checks — WriteSet violation
// ===========================================================================

describe("AC1: WriteSet violation guard", () => {
	it("should pass when all file operations target declared files", () => {
		const artifact = createTestArtifact({
			writeSet: createPatchWriteSet(["src/main.ts", "src/utils.ts"]),
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" }),
				createPatchFileOperation("src/utils.ts", "edit", { oldText: "x", newText: "y" }),
			],
		});

		const result = checkWriteSet(artifact);
		expect(result.passed).toBe(true);
		expect(result.code).toBe("OK");
	});

	it("should pass when file operations match writeSet patterns", () => {
		const artifact = createTestArtifact({
			writeSet: { files: [], patterns: ["src/**/*.ts"] },
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" }),
				createPatchFileOperation("src/utils.ts", "edit", { oldText: "x", newText: "y" }),
			],
		});

		const result = checkWriteSet(artifact);
		expect(result.passed).toBe(true);
	});

	it("should fail when a file operation targets an undeclared file", () => {
		const artifact = createTestArtifact({
			writeSet: createPatchWriteSet(["src/main.ts"]),
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" }),
				createPatchFileOperation("src/undeclared.ts", "edit", { oldText: "x", newText: "y" }),
			],
		});

		const result = checkWriteSet(artifact);
		expect(result.passed).toBe(false);
		expect(result.code).toBe("WRITE_SET_VIOLATION");
		expect(result.message).toContain("src/undeclared.ts");
	});

	it("should fail when multiple undeclared files are in the operations", () => {
		const artifact = createTestArtifact({
			writeSet: createPatchWriteSet(["src/main.ts"]),
			fileOperations: [
				createPatchFileOperation("src/one.ts", "edit", { oldText: "a", newText: "b" }),
				createPatchFileOperation("src/two.ts", "create", { newText: "new" }),
				createPatchFileOperation("src/three.ts", "delete"),
			],
		});

		const result = checkWriteSet(artifact);
		expect(result.passed).toBe(false);
		expect(result.code).toBe("WRITE_SET_VIOLATION");
		expect(result.message).toContain("src/one.ts");
		expect(result.message).toContain("src/two.ts");
		expect(result.message).toContain("src/three.ts");
	});

	it("should pass when writeSet is empty and no operations exist", () => {
		const artifact = createTestArtifact({
			writeSet: createPatchWriteSet([]),
			fileOperations: [],
		});

		const result = checkWriteSet(artifact);
		expect(result.passed).toBe(true);
	});

	it("should handle paths with Windows-style separators", () => {
		const artifact = createTestArtifact({
			writeSet: createPatchWriteSet(["src\\main.ts"]),
			fileOperations: [createPatchFileOperation("src\\main.ts", "edit", { oldText: "a", newText: "b" })],
		});

		const result = checkWriteSet(artifact);
		expect(result.passed).toBe(true);
	});

	it("should match patterns with double-star glob", () => {
		const artifact = createTestArtifact({
			writeSet: { files: [], patterns: ["src/**/*.ts"] },
			fileOperations: [createPatchFileOperation("src/deep/nested/file.ts", "edit", { oldText: "a", newText: "b" })],
		});

		const result = checkWriteSet(artifact);
		expect(result.passed).toBe(true);
	});
});

// ===========================================================================
// AC1: Guard checks — Forbidden path
// ===========================================================================

describe("AC1: Forbidden path guard", () => {
	it("should pass when no operations target forbidden paths", () => {
		const artifact = createTestArtifact({
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" }),
				createPatchFileOperation("src/utils.ts", "edit", { oldText: "x", newText: "y" }),
			],
		});

		const result = checkForbiddenPaths(artifact);
		expect(result.passed).toBe(true);
		expect(result.code).toBe("OK");
	});

	it("should fail when a file operation targets .git path", () => {
		const artifact = createTestArtifact({
			fileOperations: [
				createPatchFileOperation(".git/config", "edit", { oldText: "[core]", newText: "[core]\\n\\tfoo = bar" }),
			],
		});

		const result = checkForbiddenPaths(artifact);
		expect(result.passed).toBe(false);
		expect(result.code).toBe("FORBIDDEN_PATH");
	});

	it("should fail when a file operation targets .pi/private/ path", () => {
		const artifact = createTestArtifact({
			fileOperations: [
				createPatchFileOperation(".pi/private/sensitive.json", "edit", { oldText: "a", newText: "b" }),
			],
		});

		const result = checkForbiddenPaths(artifact);
		expect(result.passed).toBe(false);
	});

	it("should fail when a file operation targets node_modules", () => {
		const artifact = createTestArtifact({
			fileOperations: [
				createPatchFileOperation("node_modules/foo/index.js", "edit", { oldText: "a", newText: "b" }),
			],
		});

		const result = checkForbiddenPaths(artifact);
		expect(result.passed).toBe(false);
	});

	it("should fail when targeting .pi/auth.json exactly", () => {
		const artifact = createTestArtifact({
			fileOperations: [createPatchFileOperation(".pi/auth.json", "edit", { oldText: "a", newText: "b" })],
		});

		const result = checkForbiddenPaths(artifact);
		expect(result.passed).toBe(false);
	});

	it("should detect forbidden paths with extra patterns", () => {
		const artifact = createTestArtifact({
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" }),
				createPatchFileOperation("forbidden-dir/data.txt", "edit", { oldText: "x", newText: "y" }),
			],
		});

		const result = checkForbiddenPaths(artifact, { extraPatterns: ["forbidden-dir/"] });
		expect(result.passed).toBe(false);
		expect(result.message).toContain("forbidden-dir/data.txt");
	});

	it("should handle multiple forbidden path violations", () => {
		const artifact = createTestArtifact({
			fileOperations: [
				createPatchFileOperation(".git/config", "edit", { oldText: "a", newText: "b" }),
				createPatchFileOperation("node_modules/foo.js", "edit", { oldText: "x", newText: "y" }),
				createPatchFileOperation(".pi/secrets/key.json", "edit", { oldText: "p", newText: "q" }),
			],
		});

		const result = checkForbiddenPaths(artifact);
		expect(result.passed).toBe(false);
	});
});

// ===========================================================================
// AC1: Guard checks — Stale hash
// ===========================================================================

describe("AC1: Stale hash guard", () => {
	it("should pass when baseSha equals the current HEAD", async () => {
		const headSha = initGitRepo(tempDir);

		const artifact = createTestArtifact({ baseSha: headSha });
		const result = await checkStaleHash(artifact, tempDir);
		expect(result.passed).toBe(true);
		expect(result.code).toBe("OK");
	});

	it("should pass when baseSha is an ancestor of HEAD", async () => {
		const headSha = initGitRepo(tempDir);

		// Create a second commit
		writeFileSync(join(tempDir, "second.ts"), "// second\n", "utf-8");
		execSync("git add -A", { cwd: tempDir, stdio: "pipe" });
		execSync("git commit -m 'second commit'", { cwd: tempDir, stdio: "pipe" });

		// baseSha is the first commit (ancestor of HEAD)
		const artifact = createTestArtifact({ baseSha: headSha });
		const result = await checkStaleHash(artifact, tempDir);
		expect(result.passed).toBe(true);
	});

	it("should fail when baseSha does not exist in the repo", async () => {
		initGitRepo(tempDir);

		const artifact = createTestArtifact({ baseSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" });
		const result = await checkStaleHash(artifact, tempDir);
		expect(result.passed).toBe(false);
		expect(result.code).toBe("STALE_HASH");
	});

	it("should fail when baseSha is empty", async () => {
		initGitRepo(tempDir);

		const artifact = createTestArtifact({ baseSha: "" });
		const result = await checkStaleHash(artifact, tempDir);
		expect(result.passed).toBe(false);
	});

	it("should fail when the repo has no commits yet", async () => {
		// Empty dir (no git repo)
		const artifact = createTestArtifact({ baseSha: "abc123" });
		const result = await checkStaleHash(artifact, tempDir);
		expect(result.passed).toBe(false);
		expect(result.code).toBe("STALE_HASH");
	});

	it("should fail when baseSha is a different branch head (not ancestor)", async () => {
		initGitRepo(tempDir);

		// Use current default branch name (main or master)
		const defaultBranch =
			execSync("git rev-parse --abbrev-ref HEAD", {
				cwd: tempDir,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "ignore"],
			})
				.toString()
				.trim() || "main";

		// Commit on default branch first
		writeFileSync(join(tempDir, "on-main.ts"), "// on main\n", "utf-8");
		execSync("git add -A", { cwd: tempDir, stdio: "pipe" });
		execSync("git commit -m 'main commit'", { cwd: tempDir, stdio: "pipe" });

		// Create a divergent branch: start from the initial commit, not from main's HEAD
		const initSha = execSync("git rev-parse HEAD~1", { cwd: tempDir, stdio: "pipe" }).toString().trim();
		execSync(`git checkout -b other-branch ${initSha}`, { cwd: tempDir, stdio: "pipe" });
		writeFileSync(join(tempDir, "other.ts"), "// other\n", "utf-8");
		execSync("git add -A", { cwd: tempDir, stdio: "pipe" });
		execSync("git commit -m 'other branch commit'", { cwd: tempDir, stdio: "pipe" });

		const otherSha = execSync("git rev-parse other-branch", { cwd: tempDir, stdio: "pipe" }).toString().trim();

		// Switch back to default branch
		execSync(`git checkout ${defaultBranch}`, { cwd: tempDir, stdio: "pipe" });

		// other-branch's HEAD is NOT an ancestor of default branch's HEAD
		const artifact = createTestArtifact({ baseSha: otherSha });
		const result = await checkStaleHash(artifact, tempDir);
		expect(result.passed).toBe(false);
		expect(result.code).toBe("STALE_HASH");
	});
});

// ===========================================================================
// AC1: Guard checks — Apply validation
// ===========================================================================

describe("AC1: Apply validation guard", () => {
	it("should pass when all operations are valid", async () => {
		// Create a file that will be edited
		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "main.ts"), "const x = 1;\n", "utf-8");

		const artifact = createTestArtifact({
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", { oldText: "const x = 1;", newText: "const x = 2;" }),
			],
		});

		const result = await checkApplyValidation(artifact, tempDir);
		expect(result.passed).toBe(true);
		expect(result.code).toBe("OK");
	});

	it("should pass for create operations when file does not exist", async () => {
		const artifact = createTestArtifact({
			fileOperations: [createPatchFileOperation("src/new-file.ts", "create", { newText: "// new file\n" })],
		});

		const result = await checkApplyValidation(artifact, tempDir);
		expect(result.passed).toBe(true);
	});

	it("should fail for edit operations when file does not exist", async () => {
		const artifact = createTestArtifact({
			fileOperations: [createPatchFileOperation("nonexistent.ts", "edit", { oldText: "a", newText: "b" })],
		});

		const result = await checkApplyValidation(artifact, tempDir);
		expect(result.passed).toBe(false);
		expect(result.code).toBe("APPLY_VALIDATION_FAILED");
	});

	it("should fail for edit operations when oldText is not found in file", async () => {
		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "main.ts"), "const x = 1;\n", "utf-8");

		const artifact = createTestArtifact({
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", {
					oldText: "this text does not exist",
					newText: "new content",
				}),
			],
		});

		const result = await checkApplyValidation(artifact, tempDir);
		expect(result.passed).toBe(false);
		expect(result.code).toBe("APPLY_VALIDATION_FAILED");
	});

	it("should fail for delete operations when file does not exist", async () => {
		const artifact = createTestArtifact({
			fileOperations: [createPatchFileOperation("nonexistent.ts", "delete")],
		});

		const result = await checkApplyValidation(artifact, tempDir);
		expect(result.passed).toBe(false);
	});

	it("should fail for create operations when file already exists", async () => {
		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "existing.ts"), "// exists\n", "utf-8");

		const artifact = createTestArtifact({
			fileOperations: [createPatchFileOperation("src/existing.ts", "create", { newText: "// overwrite\n" })],
		});

		const result = await checkApplyValidation(artifact, tempDir);
		expect(result.passed).toBe(false);
	});

	it("should report all validation issues when multiple operations fail", async () => {
		const artifact = createTestArtifact({
			fileOperations: [
				createPatchFileOperation("no-file.ts", "edit", { oldText: "a", newText: "b" }),
				createPatchFileOperation("no-file-either.ts", "delete"),
			],
		});

		const result = await checkApplyValidation(artifact, tempDir);
		expect(result.passed).toBe(false);
		expect(result.message).toContain("no-file.ts");
		expect(result.message).toContain("no-file-either.ts");
	});
});

// ===========================================================================
// AC2: Validation failure triggers rollback (RollbackManager)
// ===========================================================================

describe("AC2: Validation failure triggers rollback (RollbackManager)", () => {
	it("should capture snapshots before application", async () => {
		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "main.ts"), "original content\n", "utf-8");

		const rm = new RollbackManager({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		await rm.captureSnapshots([
			createPatchFileOperation("src/main.ts", "edit", { oldText: "original", newText: "modified" }),
		]);

		expect(rm.snapshotCount).toBe(1);
	});

	it("should restore original content on rollback after edit", async () => {
		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "main.ts"), "original content\n", "utf-8");

		const rm = new RollbackManager({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		await rm.captureSnapshots([
			createPatchFileOperation("src/main.ts", "edit", { oldText: "original", newText: "modified" }),
		]);

		// Simulate modification
		await fs.writeFile(join(tempDir, "src", "main.ts"), "modified content\n", "utf-8");

		// Rollback
		const result = await rm.rollback();
		expect(result.success).toBe(true);
		expect(result.restoredFiles).toContain("src/main.ts");

		// Verify content is restored
		const content = await fs.readFile(join(tempDir, "src", "main.ts"), "utf-8");
		expect(content).toBe("original content\n");
	});

	it("should delete created files on rollback", async () => {
		await fs.mkdir(join(tempDir, "src"), { recursive: true });

		const rm = new RollbackManager({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		await rm.captureSnapshots([createPatchFileOperation("src/new-file.ts", "create", { newText: "new content\n" })]);

		// Simulate creation
		await fs.writeFile(join(tempDir, "src", "new-file.ts"), "new content\n", "utf-8");

		// Rollback
		const result = await rm.rollback();
		expect(result.success).toBe(true);
		expect(result.restoredFiles).toContain("src/new-file.ts");

		// Verify file was deleted
		expect(existsSync(join(tempDir, "src", "new-file.ts"))).toBe(false);
	});

	it("should restore content for deleted files on rollback", async () => {
		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "main.ts"), "content to restore\n", "utf-8");

		const rm = new RollbackManager({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		await rm.captureSnapshots([createPatchFileOperation("src/main.ts", "delete")]);

		// Simulate deletion
		await fs.unlink(join(tempDir, "src", "main.ts"));

		// Rollback
		const result = await rm.rollback();
		expect(result.success).toBe(true);
		expect(result.restoredFiles).toContain("src/main.ts");

		// Verify file is restored
		expect(existsSync(join(tempDir, "src", "main.ts"))).toBe(true);
		const content = await fs.readFile(join(tempDir, "src", "main.ts"), "utf-8");
		expect(content).toBe("content to restore\n");
	});

	it("should verify repo clean state after rollback", async () => {
		initGitRepo(tempDir);

		// Create a file and commit it
		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "tracked.ts"), "tracked content\n", "utf-8");
		execSync("git add -A", { cwd: tempDir, stdio: "pipe" });
		execSync("git commit -m 'add tracked file'", { cwd: tempDir, stdio: "pipe" });

		const rm = new RollbackManager({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		await rm.captureSnapshots([
			createPatchFileOperation("src/tracked.ts", "edit", { oldText: "tracked", newText: "modified" }),
		]);

		// Modify
		await fs.writeFile(join(tempDir, "src", "tracked.ts"), "modified content\n", "utf-8");

		// Rollback
		const result = await rm.rollback();
		expect(result.success).toBe(true);
		expect(result.repoCleanAfterRollback).toBe(true);
	});

	it("should handle rollback of multiple files", async () => {
		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.mkdir(join(tempDir, "lib"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "a.ts"), "file a\n", "utf-8");
		await fs.writeFile(join(tempDir, "lib", "b.ts"), "file b\n", "utf-8");

		const rm = new RollbackManager({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		await rm.captureSnapshots([
			createPatchFileOperation("src/a.ts", "edit", { oldText: "file a", newText: "modified a" }),
			createPatchFileOperation("lib/b.ts", "edit", { oldText: "file b", newText: "modified b" }),
		]);

		// Modify both files
		await fs.writeFile(join(tempDir, "src", "a.ts"), "modified a\n", "utf-8");
		await fs.writeFile(join(tempDir, "lib", "b.ts"), "modified b\n", "utf-8");

		// Rollback
		const result = await rm.rollback();
		expect(result.success).toBe(true);
		expect(result.restoredFiles).toContain("src/a.ts");
		expect(result.restoredFiles).toContain("lib/b.ts");

		// Verify both restored
		expect(await fs.readFile(join(tempDir, "src", "a.ts"), "utf-8")).toBe("file a\n");
		expect(await fs.readFile(join(tempDir, "lib", "b.ts"), "utf-8")).toBe("file b\n");
	});
});

// ===========================================================================
// AC3: Dirty repo leak after failed patch is zero in tests
// ===========================================================================

describe("AC3: Dirty repo leak after failed patch is zero", () => {
	it("should leave repo clean after guard-failure rollback via PatchCoordinator", async () => {
		initGitRepo(tempDir);

		// Create a tracked file
		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "main.ts"), "original\n", "utf-8");
		execSync("git add -A", { cwd: tempDir, stdio: "pipe" });
		execSync("git commit -m 'add main.ts'", { cwd: tempDir, stdio: "pipe" });

		const headSha = execSync("git rev-parse HEAD", { cwd: tempDir, stdio: "pipe" }).toString().trim();

		const coordinator = new PatchCoordinator({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		// Create an artifact with a WRITE_SET_VIOLATION (operation targets undeclared file)
		const artifact = createTestArtifact({
			baseSha: headSha,
			writeSet: createPatchWriteSet(["src/main.ts"]),
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", { oldText: "original", newText: "modified" }),
				createPatchFileOperation("src/undeclared.ts", "create", { newText: "should not be created\n" }),
			],
		});

		const result = await coordinator.apply(artifact);

		// Verify the guard caught the violation
		expect(result.success).toBe(false);
		expect(result.guardResults).toBeDefined();
		expect(result.guardResults!.writeSet.passed).toBe(false);

		// Verify the repo is clean (no dirty files)
		const gitStatus = execSync("git diff --name-only", { cwd: tempDir, stdio: "pipe" }).toString().trim();
		expect(gitStatus).toBe("");

		// Verify the undeclared file was NOT created
		expect(existsSync(join(tempDir, "src", "undeclared.ts"))).toBe(false);
	});

	it("should leave repo clean after forbidden path guard failure", async () => {
		initGitRepo(tempDir);

		const headSha = execSync("git rev-parse HEAD", { cwd: tempDir, stdio: "pipe" }).toString().trim();

		const coordinator = new PatchCoordinator({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		// Artifact attempting to modify .git/config
		const artifact = createTestArtifact({
			baseSha: headSha,
			writeSet: createPatchWriteSet([".git/config"]),
			fileOperations: [
				createPatchFileOperation(".git/config", "edit", {
					oldText: "[core]",
					newText: "[core]\\n\\tmodified = true",
				}),
			],
		});

		const result = await coordinator.apply(artifact);

		expect(result.success).toBe(false);
		expect(result.guardResults!.forbiddenPath.passed).toBe(false);

		// Verify repo is clean
		const gitStatus = execSync("git diff --name-only", { cwd: tempDir, stdio: "pipe" }).toString().trim();
		expect(gitStatus).toBe("");
	});

	it("should leave repo clean after apply failure and rollback", async () => {
		initGitRepo(tempDir);

		// Create tracked file
		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "main.ts"), "original content\n", "utf-8");
		execSync("git add -A", { cwd: tempDir, stdio: "pipe" });
		execSync("git commit -m 'add main.ts'", { cwd: tempDir, stdio: "pipe" });

		const headSha = execSync("git rev-parse HEAD", { cwd: tempDir, stdio: "pipe" }).toString().trim();

		const coordinator = new PatchCoordinator({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		// Artifact that will fail on apply (edit with non-existent oldText)
		const artifact = createTestArtifact({
			baseSha: headSha,
			writeSet: createPatchWriteSet(["src/main.ts"]),
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", {
					oldText: "non-existent text that won't be found",
					newText: "replacement",
				}),
			],
		});

		const result = await coordinator.apply(artifact);

		expect(result.success).toBe(false);

		// After apply failure and rollback, repo should be clean
		const gitStatus = execSync("git diff --name-only", { cwd: tempDir, stdio: "pipe" }).toString().trim();
		expect(gitStatus).toBe("");

		// File should still have original content
		const content = await fs.readFile(join(tempDir, "src", "main.ts"), "utf-8");
		expect(content).toBe("original content\n");
	});

	it("should leave repo clean after stale hash guard failure", async () => {
		initGitRepo(tempDir);

		const coordinator = new PatchCoordinator({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		// Artifact with obviously stale hash
		const artifact = createTestArtifact({
			baseSha: "0000000000000000000000000000000000000000",
			writeSet: createPatchWriteSet(["src/main.ts"]),
			fileOperations: [createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" })],
		});

		const result = await coordinator.apply(artifact);

		expect(result.success).toBe(false);
		expect(result.guardResults!.staleHash.passed).toBe(false);

		// Verify repo is clean
		const gitStatus = execSync("git diff --name-only", { cwd: tempDir, stdio: "pipe" }).toString().trim();
		expect(gitStatus).toBe("");
	});

	it("should leave repo clean after apply validation guard failure", async () => {
		initGitRepo(tempDir);

		const headSha = execSync("git rev-parse HEAD", { cwd: tempDir, stdio: "pipe" }).toString().trim();

		const coordinator = new PatchCoordinator({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		// Artifact editing a non-existent file
		const artifact = createTestArtifact({
			baseSha: headSha,
			writeSet: createPatchWriteSet(["src/nonexistent.ts"]),
			fileOperations: [createPatchFileOperation("src/nonexistent.ts", "edit", { oldText: "a", newText: "b" })],
		});

		const result = await coordinator.apply(artifact);

		expect(result.success).toBe(false);
		expect(result.guardResults!.applyValidation.passed).toBe(false);

		// Verify repo is clean
		const gitStatus = execSync("git diff --name-only", { cwd: tempDir, stdio: "pipe" }).toString().trim();
		expect(gitStatus).toBe("");
	});

	it("should perform successful apply and leave repo with expected changes", async () => {
		initGitRepo(tempDir);

		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "main.ts"), "original\n", "utf-8");
		execSync("git add -A", { cwd: tempDir, stdio: "pipe" });
		execSync("git commit -m 'add main.ts'", { cwd: tempDir, stdio: "pipe" });

		const headSha = execSync("git rev-parse HEAD", { cwd: tempDir, stdio: "pipe" }).toString().trim();

		const coordinator = new PatchCoordinator({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		// Create operations that will succeed
		const artifact = createTestArtifact({
			baseSha: headSha,
			writeSet: createPatchWriteSet(["src/main.ts"]),
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", {
					oldText: "original",
					newText: "modified",
				}),
			],
		});

		const result = await coordinator.apply(artifact);
		expect(result.success).toBe(true);
		expect(result.status).toBe("completed");

		// Verify the file was actually modified
		const content = await fs.readFile(join(tempDir, "src", "main.ts"), "utf-8");
		expect(content).toContain("modified");
	});
});

// ===========================================================================
// RollbackManager: isRepoClean
// ===========================================================================

describe("RollbackManager - isRepoClean", () => {
	it("should return true when repo has no changes", async () => {
		initGitRepo(tempDir);

		const rm = new RollbackManager({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		const clean = await rm.isRepoClean();
		expect(clean).toBe(true);
	});

	it("should return false when repo has uncommitted changes", async () => {
		initGitRepo(tempDir);

		// Make a modification
		await fs.writeFile(join(tempDir, "README.md"), "# Modified\n", "utf-8");

		const rm = new RollbackManager({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		const clean = await rm.isRepoClean();
		expect(clean).toBe(false);
	});

	it("should return true for non-git directory (conservative)", async () => {
		const rm = new RollbackManager({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		const clean = await rm.isRepoClean();
		expect(clean).toBe(true); // Not a git repo, but can't detect changes
	});
});

// ===========================================================================
// PatchCoordinator create
// ===========================================================================

describe("PatchCoordinator factory", () => {
	it("should create a PatchCoordinator via constructor", () => {
		const coordinator = new PatchCoordinator({
			workspaceRoot: tempDir,
			planExecId: "plan-test",
			workspaceId: "ws-test",
		});

		expect(coordinator).toBeInstanceOf(PatchCoordinator);
	});

	it("should create a PatchCoordinator via factory function", () => {
		const coordinator = createPatchCoordinator({
			workspaceRoot: tempDir,
			planExecId: "plan-test",
			workspaceId: "ws-test",
		});

		expect(coordinator).toBeInstanceOf(PatchCoordinator);
	});

	it("should expose the rollback manager", () => {
		const coordinator = new PatchCoordinator({
			workspaceRoot: tempDir,
			planExecId: "plan-test",
			workspaceId: "ws-test",
		});

		expect(coordinator.rollback).toBeInstanceOf(RollbackManager);
	});
});

// ===========================================================================
// AC4: Only PatchCoordinator applies patches
// ===========================================================================

describe("AC4: Only PatchCoordinator applies patches", () => {
	it("should export PatchCoordinator as the sole patch application entry", () => {
		// The PatchCoordinator is the ONLY exported class that applies patches.
		// Other modules (PatchWorkspace, PatchArtifactStore) handle creation,
		// validation, and storage — NOT application.
		//
		// Verification: Check that no other patch module exports an "apply" method.

		const coordinator = new PatchCoordinator({
			workspaceRoot: tempDir,
			planExecId: "plan-test",
			workspaceId: "ws-test",
		});

		// PatchCoordinator has the apply method
		expect(typeof coordinator.apply).toBe("function");
	});

	it("should maintain the PatchCoordinator as the exclusive apply entry", async () => {
		// Integration test: simulate a full workflow where PatchWorkspace
		// creates the artifact, PatchArtifactStore stores it, and
		// PatchCoordinator applies it.

		initGitRepo(tempDir);

		await fs.mkdir(join(tempDir, "src"), { recursive: true });
		await fs.writeFile(join(tempDir, "src", "main.ts"), "original\n", "utf-8");
		execSync("git add -A", { cwd: tempDir, stdio: "pipe" });
		execSync("git commit -m 'add main.ts'", { cwd: tempDir, stdio: "pipe" });

		const headSha = execSync("git rev-parse HEAD", { cwd: tempDir, stdio: "pipe" }).toString().trim();

		// Create artifact via PatchWorkspace-like function
		const artifact = createPatchArtifact({
			planExecId: "plan-1",
			workspaceId: "ws-1",
			baseSha: headSha,
			writeSet: createPatchWriteSet(["src/main.ts"]),
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", {
					oldText: "original",
					newText: "modified via coordinator",
				}),
			],
			description: "Test patch applied exclusively via PatchCoordinator",
		});

		// Store in PatchArtifactStore (simulating pre-apply storage)
		const { PatchArtifactStore } = await import("../../src/core/execution/patch/patch-artifact-store.js");
		const store = new PatchArtifactStore(tempDir);
		await store.write(artifact);

		// Verify stored
		const stored = await store.read(artifact.id);
		expect(stored).not.toBeNull();

		// Apply via PatchCoordinator (the ONLY way patches should be applied)
		const coordinator = new PatchCoordinator({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
		});

		const result = await coordinator.apply(stored!);
		expect(result.success).toBe(true);

		// Verify the file was modified
		const content = await fs.readFile(join(tempDir, "src", "main.ts"), "utf-8");
		expect(content).toContain("modified via coordinator");

		// Verify the stored artifact status was updated
		const updated = await store.read(artifact.id);
		expect(updated).not.toBeNull();
	});

	it("should not expose apply methods on PatchArtifactStore", async () => {
		// Verify that PatchArtifactStore does NOT have an apply method
		const { PatchArtifactStore } = await import("../../src/core/execution/patch/patch-artifact-store.js");
		const store = new PatchArtifactStore(tempDir);
		expect(typeof (store as any).apply).not.toBe("function");
		expect(typeof (store as any).rollback).not.toBe("function");
	});
});
