/**
 * P44.09 — Scoped Commit Integration Tests
 *
 * Tests for the ScopedCommitIntegration module that bridges
 * WorkspaceCommitGate into the auto-commit workflow.
 *
 * Creates a real temporary git repo and verifies:
 * - Scoped commit stages and commits only allowed files
 * - Scoped commit leaves unrelated dirty files uncommitted
 * - Validation detects unexpected dirty files
 * - Stage-allowed-files stages only write-set files
 * - Factory helpers correctly extract canEdit from workspace
 * - Error handling for empty write sets and empty commits
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createScopedCommitIntegration,
	createScopedIntegrationFromWorkspace,
	ScopedCommitIntegration,
} from "../../src/core/completion/scoped-commit-integration.js";
import type { Workspace } from "../../src/core/workspace-schema.js";

// ===========================================================================
// Helpers
// ===========================================================================

interface TestRepo {
	dir: string;
	integration: ScopedCommitIntegration;
}

function createTestRepo(writeSet: string[]): TestRepo {
	const dir = fs.mkdtempSync("scoped-commit-");
	execSync("git init", { cwd: dir, stdio: "pipe" });
	execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
	execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });

	// Create initial structure
	const files: Record<string, string> = {
		"package.json": JSON.stringify({ name: "test" }),
		"src/index.ts": 'console.log("hello");\n',
		"src/math.ts": "export function add(a: number, b: number): number { return a + b; }\n",
		"README.md": "# Test Project\n",
	};

	for (const [filePath, content] of Object.entries(files)) {
		const fullPath = path.join(dir, filePath);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, content, "utf-8");
	}

	execSync("git add -A", { cwd: dir, stdio: "pipe" });
	execSync("git commit -m 'initial commit'", { cwd: dir, stdio: "pipe" });

	const integration = new ScopedCommitIntegration({
		repoRoot: dir,
		workspaceId: "test-ws",
		allowedWriteSet: writeSet,
	});

	return { dir, integration };
}

function cleanupRepo(repo: TestRepo): void {
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

function gitStagedFiles(dir: string): string[] {
	try {
		const output = execSync("git diff --cached --name-only", {
			cwd: dir,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		});
		return output
			.trim()
			.split("\n")
			.filter((f) => f.length > 0);
	} catch {
		return [];
	}
}

function gitUnstagedFiles(dir: string): string[] {
	try {
		const output = execSync("git diff --name-only", {
			cwd: dir,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		});
		return output
			.trim()
			.split("\n")
			.filter((f) => f.length > 0);
	} catch {
		return [];
	}
}

// ===========================================================================
// Tests
// ===========================================================================

describe("P44.09 — Scoped Commit Integration", () => {
	describe("ScopedCommitIntegration", () => {
		let repo: TestRepo;
		let dir: string;

		beforeEach(() => {
			repo = createTestRepo(["src/math.ts"]);
			dir = repo.dir;
		});

		afterEach(() => {
			cleanupRepo(repo);
		});

		// ------------------------------------------------------------------
		// Scoped commit — allowed file only
		// ------------------------------------------------------------------

		it("createScopedCommit commits only allowed file", async () => {
			// Modify allowed file
			writeFile(dir, "src/math.ts", "export function add(a: number, b: number): number { return a + b + 1; }\n");

			// Modify non-allowed file
			writeFile(dir, "README.md", "# Modified\n");

			const result = await repo.integration.createScopedCommit("scoped commit: math.ts");

			expect(result.success).toBe(true);
			expect(result.committedFiles).toContain("src/math.ts");
			expect(result.committedFiles).not.toContain("README.md");

			// Verify only math.ts was committed
			const committed = committedFiles(dir);
			expect(committed).toContain("src/math.ts");
			expect(committed).not.toContain("README.md");

			// README.md should remain as unstaged modification
			const unstaged = gitUnstagedFiles(dir);
			expect(unstaged).toContain("README.md");
		});

		// ------------------------------------------------------------------
		// Scoped commit — leaves unrelated dirty files alone
		// ------------------------------------------------------------------

		it("createScopedCommit leaves unrelated dirty files uncommitted and unstaged", async () => {
			// Stage the non-allowed file first (simulates it being pre-staged)
			writeFile(dir, "README.md", "# Modified README\n");
			execSync("git add README.md", { cwd: dir, stdio: "pipe" });

			// Modify allowed file
			writeFile(dir, "src/math.ts", "export function add(a: number, b: number): number { return a + b + 2; }\n");

			const result = await repo.integration.createScopedCommit("scoped commit");

			// Should fail because unexpected files are staged
			expect(result.success).toBe(false);
			expect(result.reason).toContain("unexpected staged files");

			// README.md should remain staged and math.ts unchanged
			const staged = gitStagedFiles(dir);
			expect(staged).toContain("README.md");
		});

		// ------------------------------------------------------------------
		// Validation — detects unexpected modified files
		// ------------------------------------------------------------------

		it("validateScopedCommit detects unexpected dirty files", async () => {
			// No changes yet — should be allowed
			let validation = await repo.integration.validateScopedCommit();
			expect(validation.allowed).toBe(true);

			// Modify non-allowed file
			writeFile(dir, "package.json", '{"name": "hacked"}');
			execSync("git add package.json", { cwd: dir, stdio: "pipe" });

			validation = await repo.integration.validateScopedCommit();
			expect(validation.allowed).toBe(false);
			expect(validation.unexpectedStagedFiles).toContain("package.json");
		});

		// ------------------------------------------------------------------
		// Stage allowed files
		// ------------------------------------------------------------------

		it("stageAllowedFiles stages only write-set files", async () => {
			// Modify allowed and non-allowed files
			writeFile(dir, "src/math.ts", "export function add(a: number, b: number): number { return a + b + 3; }\n");
			writeFile(dir, "package.json", '{"name": "modified"}');

			const result = await repo.integration.stageAllowedFiles();

			expect(result.allowed).toBe(true);
			expect(result.stagedFiles).toContain("src/math.ts");
			expect(result.stagedFiles).not.toContain("package.json");

			// Verify git state
			const staged = gitStagedFiles(dir);
			expect(staged).toContain("src/math.ts");
			expect(staged).not.toContain("package.json");
		});

		// ------------------------------------------------------------------
		// Inspect state
		// ------------------------------------------------------------------

		it("inspectState returns current git state with allowed files filtered", async () => {
			writeFile(dir, "src/math.ts", "export function add(a: number, b: number): number { return a + b + 4; }\n");
			writeFile(dir, "README.md", "# Modified\n");

			const state = await repo.integration.inspectState();
			expect(state.allowedFiles).toContain("src/math.ts");
			expect(state.unexpectedModifiedFiles).toContain("README.md");
		});

		// ------------------------------------------------------------------
		// getModifiedWriteSetFiles
		// ------------------------------------------------------------------

		it("getModifiedWriteSetFiles returns only write-set files that are modified", async () => {
			writeFile(dir, "src/math.ts", "export function add(a: number, b: number): number { return a + b + 5; }\n");
			writeFile(dir, "README.md", "# Modified\n");

			const files = await repo.integration.getModifiedWriteSetFiles();
			expect(files).toContain("src/math.ts");
			expect(files).not.toContain("README.md");
		});

		// ------------------------------------------------------------------
		// Empty commit guard
		// ------------------------------------------------------------------

		it("createScopedCommit returns success=false when nothing to commit", async () => {
			const result = await repo.integration.createScopedCommit("nothing to commit");
			expect(result.success).toBe(false);
			expect(result.reason).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// Factory helpers
	// -----------------------------------------------------------------------

	describe("createScopedIntegrationFromWorkspace", () => {
		let dir: string;

		beforeEach(() => {
			dir = fs.mkdtempSync("scoped-factory-");
			execSync("git init", { cwd: dir, stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
			execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
			writeFile(dir, "README.md", "# Test\n");
			writeFile(dir, "src/index.ts", 'console.log("index");\n');
			writeFile(dir, "src/app.ts", 'console.log("app");\n');
			execSync("git add -A", { cwd: dir, stdio: "pipe" });
			execSync("git commit -m 'initial'", { cwd: dir, stdio: "pipe" });
		});

		afterEach(() => {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// cleanup only
			}
		});

		it("extracts canEdit patterns as allowedWriteSet", () => {
			const workspace: Workspace = {
				id: "test-ws",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: ["src/**", "*.ts"],
					canRun: [],
					cannotRun: [],
				},
			};

			const integration = createScopedIntegrationFromWorkspace(dir, "test-ws", workspace);
			expect(integration).toBeInstanceOf(ScopedCommitIntegration);
		});

		it("uses default patterns when canEdit is empty", () => {
			const workspace: Workspace = {
				id: "test-ws",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
			};

			const integration = createScopedIntegrationFromWorkspace(dir, "test-ws", workspace);
			expect(integration).toBeInstanceOf(ScopedCommitIntegration);
		});

		it("commits workspace files matching canEdit patterns", async () => {
			const workspace: Workspace = {
				id: "test-ws",
				title: "Test",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 3,
				capabilities: {
					canEdit: ["src/**"],
					canRun: [],
					cannotRun: [],
				},
			};

			const integration = createScopedIntegrationFromWorkspace(dir, "test-ws", workspace);

			// Modify existing tracked file within write set
			writeFile(dir, "src/app.ts", 'console.log("modified app");\n');
			// Modify existing tracked file outside write set
			writeFile(dir, "README.md", "# Modified\n");

			const result = await integration.createScopedCommit("feat: modify app.ts");
			expect(result.success).toBe(true);
			expect(result.committedFiles).toContain("src/app.ts");
			expect(result.committedFiles).not.toContain("README.md");
		});
	});

	describe("createScopedCommitIntegration", () => {
		let dir: string;

		beforeEach(() => {
			dir = fs.mkdtempSync("scoped-create-");
			execSync("git init", { cwd: dir, stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
			execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
			writeFile(dir, "README.md", "# Test\n");
			writeFile(dir, "src/app.ts", 'console.log("app");\n');
			writeFile(dir, "dist/out.js", 'console.log("out");\n');
			execSync("git add -A", { cwd: dir, stdio: "pipe" });
			execSync("git commit -m 'initial'", { cwd: dir, stdio: "pipe" });
		});

		afterEach(() => {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// cleanup only
			}
		});

		it("creates an integration with explicit write set", () => {
			const integration = createScopedCommitIntegration(dir, "test-ws", ["src/**", "*.ts"]);
			expect(integration).toBeInstanceOf(ScopedCommitIntegration);
		});

		it("commits only files matching explicit write set", async () => {
			const integration = createScopedCommitIntegration(dir, "test-ws", ["src/**"]);

			// Modify existing tracked file within write set
			writeFile(dir, "src/app.ts", 'console.log("modified app");\n');
			// Modify existing tracked file outside write set
			writeFile(dir, "dist/out.js", 'console.log("modified out");\n');

			const result = await integration.createScopedCommit("feat: modify app");
			expect(result.success).toBe(true);
			expect(result.committedFiles).toContain("src/app.ts");
			expect(result.committedFiles).not.toContain("dist/out.js");
		});
	});

	// -----------------------------------------------------------------------
	// Edge cases
	// -----------------------------------------------------------------------

	describe("edge cases", () => {
		let dir: string;
		let _integration: ScopedCommitIntegration;

		beforeEach(() => {
			dir = fs.mkdtempSync("scoped-edge-");
			execSync("git init", { cwd: dir, stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
			execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
			writeFile(dir, "README.md", "# Test\n");
			writeFile(dir, "src/app.ts", 'console.log("app");\n');
			writeFile(dir, "dist/bundle.js", 'console.log("bundle");\n');
			execSync("git add -A", { cwd: dir, stdio: "pipe" });
			execSync("git commit -m 'initial'", { cwd: dir, stdio: "pipe" });

			_integration = new ScopedCommitIntegration({
				repoRoot: dir,
				workspaceId: "edge-ws",
				allowedWriteSet: ["*.ts", "src/**"],
			});
		});

		afterEach(() => {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// cleanup only
			}
		});

		it("handles empty write set gracefully", async () => {
			const emptyIntegration = new ScopedCommitIntegration({
				repoRoot: dir,
				workspaceId: "empty-ws",
				allowedWriteSet: [],
			});

			// Modify a tracked file that is NOT in the empty write set
			writeFile(dir, "src/app.ts", 'console.log("modified app");\n');

			const result = await emptyIntegration.createScopedCommit("empty ws");
			expect(result.success).toBe(false);
		});

		it("handles allowGeneratedArtifacts option", async () => {
			const genIntegration = new ScopedCommitIntegration({
				repoRoot: dir,
				workspaceId: "gen-ws",
				allowedWriteSet: ["src/**"],
				allowGeneratedArtifacts: true,
				generatedArtifactGlobs: ["dist/**"],
			});

			// Modify existing tracked file within write set
			writeFile(dir, "src/app.ts", 'console.log("modified app");\n');

			const result = await genIntegration.createScopedCommit("feat: with generated artifacts");
			expect(result.success).toBe(true);
			expect(result.committedFiles).toContain("src/app.ts");
		});
	});
});
