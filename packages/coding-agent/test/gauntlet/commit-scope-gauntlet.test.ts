/**
 * P44.11 — Commit Scope Gauntlet
 *
 * Scenarios that test WorkspaceCommitGate enforcement of write-set boundaries.
 * Ensures workers can only stage and commit files belonging to their workspace
 * write-set, and that dangerous git commands are blocked.
 *
 * Uses real git repos in temp directories for accurate git state inspection.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceCommitGateConfig } from "../../src/core/workspace-commit-gate.js";
import { WorkspaceCommitGate } from "../../src/core/workspace-commit-gate.js";

// ---------------------------------------------------------------------------
// Test Fixture Setup
// ---------------------------------------------------------------------------

function initRepo(): string {
	const dir = fs.mkdtempSync("csg-test-");
	execSync("git init", { cwd: dir, stdio: "pipe" });
	execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
	execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
	fs.writeFileSync(path.join(dir, ".gitkeep"), "", "utf-8");
	execSync("git add .gitkeep", { cwd: dir, stdio: "pipe" });
	execSync("git commit -m init", { cwd: dir, stdio: "pipe" });
	return dir;
}

function createGate(
	tempDir: string,
	allowedWriteSet: string[],
	overrides: Partial<WorkspaceCommitGateConfig> = {},
): WorkspaceCommitGate {
	return new WorkspaceCommitGate({
		repoRoot: tempDir,
		workspaceId: "test-ws",
		allowedWriteSet,
		...overrides,
	});
}

function writeFile(tempDir: string, relativePath: string, content = "test"): void {
	const fullPath = path.join(tempDir, relativePath);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content, "utf-8");
}

function deleteFile(tempDir: string, relativePath: string): void {
	fs.unlinkSync(path.join(tempDir, relativePath));
}

function gitAdd(tempDir: string, ...files: string[]): void {
	execSync(`git add -- ${files.map((f) => `'${f}'`).join(" ")}`, { cwd: tempDir, stdio: "pipe" });
}

function gitCommit(tempDir: string, message: string): void {
	execSync(`git commit -m '${message}'`, { cwd: tempDir, stdio: "pipe" });
}

function getCommittedFiles(tempDir: string): string[] {
	const output = execSync("git show --name-only --pretty=format: HEAD", {
		cwd: tempDir,
		encoding: "utf-8",
	});
	return output.trim().split("\n").filter(Boolean);
}

// ---------------------------------------------------------------------------
// Scenario IDs: CS = Commit Scope
// ---------------------------------------------------------------------------

describe("P44.11 — Commit Scope Gauntlet", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = initRepo();
	});

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// temp cleanup
		}
	});

	// =========================================================================
	// Section A: Write-Set Boundary Enforcement
	// =========================================================================

	describe("A — Write-Set Boundary Enforcement", () => {
		it("CS-A-001 — Allows staging a file within the write-set", async () => {
			writeFile(tempDir, "src/owned.ts");
			const gate = createGate(tempDir, ["src/owned.ts"]);

			const cmdResult = gate.validateCommand("git add src/owned.ts");
			expect(cmdResult.allowed).toBe(true);

			gitAdd(tempDir, "src/owned.ts");
			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(true);
			expect(state.stagedFiles).toContain("src/owned.ts");
		});

		it("CS-A-002 — Blocks staging a file outside the write-set", async () => {
			writeFile(tempDir, "src/owned.ts");
			writeFile(tempDir, "secret.env");
			gitAdd(tempDir, "src/owned.ts", "secret.env");
			const gate = createGate(tempDir, ["src/owned.ts"]);

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(false);
			expect(state.unexpectedStagedFiles).toContain("secret.env");
		});

		it("CS-A-003 — Blocks commit when unexpected file staged alongside allowed file", async () => {
			writeFile(tempDir, "src/owned.ts");
			writeFile(tempDir, "other.ts");
			gitAdd(tempDir, "src/owned.ts", "other.ts");
			const gate = createGate(tempDir, ["src/owned.ts"]);

			const result = await gate.createScopedCommit("should fail");
			expect(result.allowed).toBe(false);
		});

		it("CS-A-004 — Allows commit when only write-set files are staged", async () => {
			writeFile(tempDir, "src/owned.ts", "content");
			gitAdd(tempDir, "src/owned.ts");
			const gate = createGate(tempDir, ["src/owned.ts"]);

			const result = await gate.createScopedCommit("scoped commit");
			expect(result.allowed).toBe(true);
			expect(getCommittedFiles(tempDir)).toContain("src/owned.ts");
		});

		it("CS-A-005 — Allows dirty but unstaged files outside write-set to remain untouched", async () => {
			writeFile(tempDir, "src/owned.ts", "content");
			writeFile(tempDir, "other.ts", "dirty");
			gitAdd(tempDir, "src/owned.ts");
			const gate = createGate(tempDir, ["src/owned.ts"]);

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(true);
			expect(state.unexpectedStagedFiles).toHaveLength(0);

			const result = await gate.createScopedCommit("scoped commit");
			expect(result.allowed).toBe(true);
			expect(getCommittedFiles(tempDir)).toContain("src/owned.ts");
			expect(getCommittedFiles(tempDir)).not.toContain("other.ts");
		});
	});

	// =========================================================================
	// Section B: Dangerous Git Command Blocking
	// =========================================================================

	describe("B — Dangerous Git Command Blocking", () => {
		it("CS-B-001 — Blocks 'git add .'", () => {
			const gate = createGate(tempDir, ["src/owned.ts"]);
			const result = gate.validateCommand("git add .");
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("WorkspaceCommitGate blocked dangerous git command");
			expect(result.blockedCommands).toContain("git add .");
		});

		it("CS-B-002 — Blocks 'git add -A'", () => {
			const gate = createGate(tempDir, ["src/owned.ts"]);
			const result = gate.validateCommand("git add -A");
			expect(result.allowed).toBe(false);
		});

		it("CS-B-003 — Blocks 'git add --all'", () => {
			const gate = createGate(tempDir, ["src/owned.ts"]);
			const result = gate.validateCommand("git add --all");
			expect(result.allowed).toBe(false);
		});

		it("CS-B-004 — Blocks 'git commit -a'", () => {
			const gate = createGate(tempDir, ["src/owned.ts"]);
			const result = gate.validateCommand("git commit -a -m test");
			expect(result.allowed).toBe(false);
		});

		it("CS-B-005 — Blocks 'git commit --all'", () => {
			const gate = createGate(tempDir, ["src/owned.ts"]);
			const result = gate.validateCommand("git commit --all -m test");
			expect(result.allowed).toBe(false);
		});

		it("CS-B-006 — Blocks 'git commit -a'", () => {
			const gate = createGate(tempDir, ["src/owned.ts"]);
			const result = gate.validateCommand("git commit -a -m test");
			expect(result.allowed).toBe(false);
		});

		it("CS-B-007 — Allows 'git add <specific file>' for write-set file", () => {
			writeFile(tempDir, "src/owned.ts");
			const gate = createGate(tempDir, ["src/owned.ts"]);
			const result = gate.validateCommand("git add src/owned.ts");
			expect(result.allowed).toBe(true);
		});

		it("CS-B-008 — Blocks 'git add <specific file>' for non-write-set file", () => {
			writeFile(tempDir, "secret.env");
			const gate = createGate(tempDir, ["src/owned.ts"]);
			const result = gate.validateCommand("git add secret.env");
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("secret.env");
		});
	});

	// =========================================================================
	// Section C: Glob and Pattern Support
	// =========================================================================

	describe("C — Glob Pattern Write-Sets", () => {
		it("CS-C-001 — Supports *.ts glob pattern", async () => {
			writeFile(tempDir, "src/a.ts");
			writeFile(tempDir, "src/b.ts");
			writeFile(tempDir, "src/c.json");
			gitAdd(tempDir, "src/a.ts", "src/b.ts");
			const gate = createGate(tempDir, ["src/*.ts"]);

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(true);
			expect(state.stagedFiles).toContain("src/a.ts");
			expect(state.stagedFiles).toContain("src/b.ts");
		});

		it("CS-C-002 — Blocks *.ts glob for non-matching files", async () => {
			writeFile(tempDir, "src/data.json");
			gitAdd(tempDir, "src/data.json");
			const gate = createGate(tempDir, ["src/*.ts"]);

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(false);
			expect(state.unexpectedStagedFiles).toContain("src/data.json");
		});

		it("CS-C-003 — Supports directory-wide ** patterns", async () => {
			writeFile(tempDir, "src/sub/a.ts");
			writeFile(tempDir, "src/sub/b.ts");
			gitAdd(tempDir, "src/sub/a.ts", "src/sub/b.ts");
			const gate = createGate(tempDir, ["src/sub/**"]);

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(true);
		});

		it("CS-C-004 — Directory pattern blocks files outside directory", async () => {
			writeFile(tempDir, "other/c.ts");
			gitAdd(tempDir, "other/c.ts");
			const gate = createGate(tempDir, ["src/sub/**"]);

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(false);
		});

		it("CS-C-005 — Supports multiple write-set globs", async () => {
			writeFile(tempDir, "src/feature.ts");
			writeFile(tempDir, "tests/feature.test.ts");
			gitAdd(tempDir, "src/feature.ts", "tests/feature.test.ts");
			const gate = createGate(tempDir, ["src/**", "tests/**"]);

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(true);
		});
	});

	// =========================================================================
	// Section D: Deleted File Handling
	// =========================================================================

	describe("D — Deleted File Handling", () => {
		it("CS-D-001 — Allows staging deletion of owned file", async () => {
			writeFile(tempDir, "src/owned.ts");
			gitAdd(tempDir, "src/owned.ts");
			gitCommit(tempDir, "add owned");
			deleteFile(tempDir, "src/owned.ts");
			execSync("git add src/owned.ts", { cwd: tempDir, stdio: "pipe" });
			const gate = createGate(tempDir, ["src/owned.ts"]);

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(true);
		});

		it("CS-D-002 — Blocks staging deletion of unowned file", async () => {
			writeFile(tempDir, "src/owned.ts");
			writeFile(tempDir, "other.txt");
			gitAdd(tempDir, "src/owned.ts", "other.txt");
			gitCommit(tempDir, "add both");
			deleteFile(tempDir, "other.txt");
			execSync("git add other.txt", { cwd: tempDir, stdio: "pipe" });
			const gate = createGate(tempDir, ["src/owned.ts"]);

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(false);
			expect(state.unexpectedStagedFiles).toContain("other.txt");
		});

		it("CS-D-003 — Blocks deletion of unowned file even when allowDeletedOwnedFiles=true", async () => {
			writeFile(tempDir, "other.txt");
			gitAdd(tempDir, "other.txt");
			gitCommit(tempDir, "add other");
			deleteFile(tempDir, "other.txt");
			execSync("git add other.txt", { cwd: tempDir, stdio: "pipe" });
			const gate = createGate(tempDir, ["src/owned.ts"], {
				allowDeletedOwnedFiles: true,
			});

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(false);
		});
	});

	// =========================================================================
	// Section E: Generated Artifact Handling
	// =========================================================================

	describe("E — Generated Artifact Handling", () => {
		it("CS-E-001 — Blocks artifact by default when not in write-set", () => {
			writeFile(tempDir, "package-lock.json");
			const gate = createGate(tempDir, ["src/owned.ts"]);
			const result = gate.validateCommand("git add package-lock.json");
			expect(result.allowed).toBe(false);
		});

		it("CS-E-002 — Allows artifact when configured with allowGeneratedArtifacts", () => {
			writeFile(tempDir, "package-lock.json");
			const gate = createGate(tempDir, ["package-lock.json"], {
				allowGeneratedArtifacts: true,
				generatedArtifactGlobs: ["package-lock.json"],
			});
			const result = gate.validateCommand("git add package-lock.json");
			expect(result.allowed).toBe(true);
		});
	});

	// =========================================================================
	// Section F: Path Traversal Protection
	// =========================================================================

	describe("F — Path Traversal Protection", () => {
		it("CS-F-001 — Blocks git add with path traversal", () => {
			const gate = createGate(tempDir, ["src/owned.ts"]);
			const result = gate.validateCommand("git add ../outside-repo.ts");
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("not in writeSet");
		});

		it("CS-F-002 — Blocks git add of /absolute/path file", () => {
			const gate = createGate(tempDir, ["src/owned.ts"]);
			const result = gate.validateCommand("git add /etc/passwd");
			expect(result.allowed).toBe(false);
		});
	});

	// =========================================================================
	// Section G: stageAllowedFiles Utility
	// =========================================================================

	describe("G — stageAllowedFiles Utility", () => {
		it("CS-G-001 — Stages only write-set files from dirty working tree", async () => {
			// Track a file first, then modify it so stageAllowedFiles can detect it
			writeFile(tempDir, "src/owned.ts", "original");
			gitAdd(tempDir, "src/owned.ts");
			gitCommit(tempDir, "add owned");
			writeFile(tempDir, "src/owned.ts", "modified");
			writeFile(tempDir, "other.ts", "other");

			const gate = createGate(tempDir, ["src/owned.ts"]);

			const result = await gate.stageAllowedFiles();
			expect(result.allowed).toBe(true);
			expect(result.unexpectedStagedFiles).toHaveLength(0);
			expect(result.stagedFiles).not.toContain("other.ts");
		});

		it("CS-G-002 — Reports empty stagedFiles when no write-set files are dirty", async () => {
			writeFile(tempDir, "other.ts", "other");
			const gate = createGate(tempDir, ["src/owned.ts"]);

			const result = await gate.stageAllowedFiles();
			expect(result.allowed).toBe(true);
			expect(result.stagedFiles).toHaveLength(0);
		});
	});

	// =========================================================================
	// Section H: Error Reporting
	// =========================================================================

	describe("H — Error Reporting", () => {
		it("CS-H-001 — Reports unexpectedStagedFiles clearly in reason", async () => {
			writeFile(tempDir, "src/owned.ts");
			writeFile(tempDir, "secret.env");
			gitAdd(tempDir, "src/owned.ts", "secret.env");
			const gate = createGate(tempDir, ["src/owned.ts"]);

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(false);
			expect(state.unexpectedStagedFiles).toHaveLength(1);
			expect(state.unexpectedStagedFiles[0]).toBe("secret.env");
			expect(state.reason).toContain("secret.env");
		});

		it("CS-H-002 — Reports allowedFiles in validation result", async () => {
			writeFile(tempDir, "src/owned.ts");
			gitAdd(tempDir, "src/owned.ts");
			const gate = createGate(tempDir, ["src/owned.ts"]);

			const state = await gate.validateStagedFiles();
			expect(state.allowed).toBe(true);
			expect(state.allowedFiles).toContain("src/owned.ts");
		});

		it("CS-H-003 — Shell-escaped file paths are handled correctly", () => {
			writeFile(tempDir, "src/my file.ts");
			const gate = createGate(tempDir, ["src/my file.ts"]);
			const result = gate.validateCommand("git add src/my\\ file.ts");
			expect(result.allowed).toBe(true);
		});
	});

	// =========================================================================
	// Section I: Inspection State Accuracy
	// =========================================================================

	describe("I — Git State Inspection", () => {
		it("CS-I-001 — Empty repo returns empty staged and modified lists", async () => {
			const gate = createGate(tempDir, ["src/**"]);
			const state = await gate.inspectGitState();
			expect(state.allowed).toBe(true);
			expect(state.stagedFiles).toHaveLength(0);
			expect(state.unstagedModifiedFiles).toHaveLength(0);
		});

		it("CS-I-002 — Only modified files appear in unstagedModifiedFiles", async () => {
			// First commit a file to make it tracked, then modify it
			writeFile(tempDir, "src/modified.ts", "original");
			gitAdd(tempDir, "src/modified.ts");
			gitCommit(tempDir, "add modified");
			writeFile(tempDir, "src/modified.ts", "modified content");
			const gate = createGate(tempDir, ["src/**"]);
			const state = await gate.inspectGitState();
			expect(state.unstagedModifiedFiles).toContain("src/modified.ts");
			expect(state.stagedFiles).not.toContain("src/modified.ts");
		});

		it("CS-I-003 — Committed file does not appear as modified", async () => {
			writeFile(tempDir, "src/committed.ts", "content");
			gitAdd(tempDir, "src/committed.ts");
			gitCommit(tempDir, "add committed");
			const gate = createGate(tempDir, ["src/**"]);
			const state = await gate.inspectGitState();
			expect(state.stagedFiles).not.toContain("src/committed.ts");
			expect(state.unstagedModifiedFiles).not.toContain("src/committed.ts");
		});
	});
});
