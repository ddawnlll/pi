/**
 * Tests for Auto Commit - P2 Workstream 7.I
 */

import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutoCommit, createAutoCommit } from "../src/core/auto-commit.js";
import type { WorkspaceState } from "../src/core/plan-state.js";
import type { Workspace } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

const execAsync = promisify(exec);
const TEST_DIR = path.join(process.cwd(), ".test-auto-commit");

describe("AutoCommit", () => {
	let autoCommit: AutoCommit;

	beforeEach(async () => {
		// Create test directory
		await fs.mkdir(TEST_DIR, { recursive: true });

		// Initialize git repo
		await execAsync("git init", { cwd: TEST_DIR });
		await execAsync('git config user.email "test@example.com"', { cwd: TEST_DIR });
		await execAsync('git config user.name "Test User"', { cwd: TEST_DIR });

		// Create initial commit
		await fs.writeFile(path.join(TEST_DIR, "README.md"), "# Test\n", "utf-8");
		await execAsync("git add README.md", { cwd: TEST_DIR });
		await execAsync('git commit -m "Initial commit"', { cwd: TEST_DIR });

		autoCommit = new AutoCommit(TEST_DIR);
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	const mockWorkspace: Workspace = {
		id: "7.A",
		title: "Test Workspace",
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 3,
		capabilities: {
			canEdit: ["src/*.ts"],
			cannotEdit: ["node_modules/*", ".env"],
			canRun: [],
			cannotRun: [],
		},
	};

	const mockCompleteState: WorkspaceState = {
		workspaceId: "7.A",
		stage: WorkspaceStage.Complete,
		attempts: 1,
	};

	describe("validation", () => {
		it("should allow commit for complete workspace", async () => {
			// Create a change
			await fs.mkdir(path.join(TEST_DIR, "src"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "src", "app.ts"), "console.log('test');", "utf-8");

			const validation = await autoCommit.validateCommit(mockWorkspace, mockCompleteState);

			expect(validation.allowed).toBe(true);
			expect(validation.filesToCommit).toContain("src/app.ts");
		});

		it("should block commit for non-complete workspace", async () => {
			const pendingState: WorkspaceState = {
				...mockCompleteState,
				stage: WorkspaceStage.Pending,
			};

			const validation = await autoCommit.validateCommit(mockWorkspace, pendingState);

			expect(validation.allowed).toBe(false);
			expect(validation.reason).toContain("not complete");
		});

		it("should block commit for workspace with exhausted retries", async () => {
			const exhaustedState: WorkspaceState = {
				...mockCompleteState,
				attempts: 3,
				error: "Test failed",
			};

			const validation = await autoCommit.validateCommit(mockWorkspace, exhaustedState);

			expect(validation.allowed).toBe(false);
			expect(validation.reason).toContain("exhausted retries");
		});

		it("should block commit when no changes exist", async () => {
			const validation = await autoCommit.validateCommit(mockWorkspace, mockCompleteState);

			expect(validation.allowed).toBe(false);
			expect(validation.reason).toContain("No changes");
		});

		it("should block commit for forbidden file modifications", async () => {
			// Modify a forbidden file
			await fs.writeFile(path.join(TEST_DIR, ".env"), "SECRET=test", "utf-8");

			const validation = await autoCommit.validateCommit(mockWorkspace, mockCompleteState);

			expect(validation.allowed).toBe(false);
			expect(validation.reason).toContain("Forbidden files are dirty");
			expect(validation.forbiddenFilesDirty).toContain(".env");
		});

		it("should exclude files not in canEdit list from commit", async () => {
			// Create a file outside allowed scope
			await fs.writeFile(path.join(TEST_DIR, "config.json"), "{}", "utf-8");

			const validation = await autoCommit.validateCommit(mockWorkspace, mockCompleteState);

			// Files outside canEdit are not blocked; they are just excluded
			expect(validation.allowed).toBe(true);
			expect(validation.filesToCommit).not.toContain("config.json");
		});

		it("should allow all files when canEdit is empty", async () => {
			const workspaceNoRestrictions: Workspace = {
				...mockWorkspace,
				capabilities: {
					canEdit: [],
					cannotEdit: [".env"],
					canRun: [],
					cannotRun: [],
				},
			};

			// Create various files
			await fs.mkdir(path.join(TEST_DIR, "src"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "src", "app.ts"), "test", "utf-8");
			await fs.writeFile(path.join(TEST_DIR, "config.json"), "{}", "utf-8");

			const validation = await autoCommit.validateCommit(workspaceNoRestrictions, mockCompleteState);

			expect(validation.allowed).toBe(true);
			expect(validation.filesToCommit).toContain("src/app.ts");
			expect(validation.filesToCommit).toContain("config.json");
		});

		it("should allow commit when no capability manifest exists", async () => {
			const workspaceNoCapabilities: Workspace = {
				...mockWorkspace,
				capabilities: undefined,
			};

			// Create a change
			await fs.writeFile(path.join(TEST_DIR, "test.txt"), "test", "utf-8");

			const validation = await autoCommit.validateCommit(workspaceNoCapabilities, mockCompleteState);

			expect(validation.allowed).toBe(true);
			expect(validation.filesToCommit).toContain("test.txt");
		});
	});

	describe("commit execution", () => {
		it("should successfully commit allowed files", async () => {
			// Create allowed change
			await fs.mkdir(path.join(TEST_DIR, "src"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "src", "app.ts"), "console.log('test');", "utf-8");

			const result = await autoCommit.commit(mockWorkspace, mockCompleteState);

			expect(result.success).toBe(true);
			expect(result.commitHash).toBeDefined();
			expect(result.committedFiles).toContain("src/app.ts");
		});

		it("should use correct commit message format", async () => {
			// Create allowed change
			await fs.mkdir(path.join(TEST_DIR, "src"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "src", "app.ts"), "test", "utf-8");

			await autoCommit.commit(mockWorkspace, mockCompleteState);

			// Check commit message
			const { stdout } = await execAsync("git log -1 --pretty=%B", { cwd: TEST_DIR });
			expect(stdout.trim()).toContain("feat(p2): complete workspace 7.A");
			expect(stdout.trim()).toContain("\u2014");
			expect(stdout.trim()).toContain("Test Workspace");
		});

		it("should truncate long titles in commit message", async () => {
			const longTitleWorkspace: Workspace = {
				...mockWorkspace,
				title: "This is a very long workspace title that should be truncated to fit within reasonable limits",
			};

			// Create allowed change
			await fs.mkdir(path.join(TEST_DIR, "src"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "src", "app.ts"), "test", "utf-8");

			await autoCommit.commit(longTitleWorkspace, mockCompleteState);

			// Check commit message
			const { stdout } = await execAsync("git log -1 --pretty=%B", { cwd: TEST_DIR });
			const message = stdout.trim();
			expect(message.length).toBeLessThan(100);
		});

		it("should fail commit for validation errors", async () => {
			// Try to commit with no changes
			const result = await autoCommit.commit(mockWorkspace, mockCompleteState);

			expect(result.success).toBe(false);
			expect(result.reason).toBeDefined();
		});

		it("should fail commit for forbidden files", async () => {
			// Modify forbidden file
			await fs.writeFile(path.join(TEST_DIR, ".env"), "SECRET=test", "utf-8");

			const result = await autoCommit.commit(mockWorkspace, mockCompleteState);

			expect(result.success).toBe(false);
			expect(result.reason).toContain("Forbidden files");
		});

		it("should only commit files matching capability manifest", async () => {
			await fs.mkdir(path.join(TEST_DIR, "src"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "src", "app.ts"), "test", "utf-8");
			await fs.writeFile(path.join(TEST_DIR, "other.txt"), "test", "utf-8");

			const result = await autoCommit.commit(mockWorkspace, mockCompleteState);

			expect(result.success).toBe(true);
			expect(result.committedFiles).toContain("src/app.ts");
			expect(result.committedFiles).not.toContain("other.txt");

			const { stdout } = await execAsync("git status --porcelain", { cwd: TEST_DIR });
			expect(stdout).toContain("other.txt");
		});
	});

	describe("pattern matching", () => {
		it("should match wildcard patterns", async () => {
			await fs.mkdir(path.join(TEST_DIR, "src"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "src", "app.ts"), "test", "utf-8");
			await fs.writeFile(path.join(TEST_DIR, "src", "utils.ts"), "test", "utf-8");

			const validation = await autoCommit.validateCommit(mockWorkspace, mockCompleteState);

			expect(validation.allowed).toBe(true);
			expect(validation.filesToCommit).toContain("src/app.ts");
			expect(validation.filesToCommit).toContain("src/utils.ts");
		});

		it("should match exact file names", async () => {
			const exactFileWorkspace: Workspace = {
				...mockWorkspace,
				capabilities: {
					canEdit: ["README.md"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			};

			await fs.writeFile(path.join(TEST_DIR, "README.md"), "updated", "utf-8");

			const validation = await autoCommit.validateCommit(exactFileWorkspace, mockCompleteState);

			expect(validation.allowed).toBe(true);
			expect(validation.filesToCommit).toContain("README.md");
		});
	});

	describe("createAutoCommit", () => {
		it("should create auto commit instance", () => {
			const instance = createAutoCommit(TEST_DIR);
			expect(instance).toBeInstanceOf(AutoCommit);
		});
	});

	describe("edge cases", () => {
		it("should handle deleted files", async () => {
			// Create and commit a file first
			await fs.mkdir(path.join(TEST_DIR, "src"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "src", "old.ts"), "test", "utf-8");
			await execAsync("git add src/old.ts", { cwd: TEST_DIR });
			await execAsync('git commit -m "Add old file"', { cwd: TEST_DIR });

			// Delete the file
			await fs.unlink(path.join(TEST_DIR, "src", "old.ts"));

			const validation = await autoCommit.validateCommit(mockWorkspace, mockCompleteState);

			expect(validation.allowed).toBe(true);
			expect(validation.filesToCommit).toContain("src/old.ts");
		});

		it("should handle modified files", async () => {
			// Modify existing file
			await fs.writeFile(path.join(TEST_DIR, "README.md"), "# Updated\n", "utf-8");

			const workspaceAllowReadme: Workspace = {
				...mockWorkspace,
				capabilities: {
					canEdit: ["README.md"],
					cannotEdit: [],
					canRun: [],
					cannotRun: [],
				},
			};

			const validation = await autoCommit.validateCommit(workspaceAllowReadme, mockCompleteState);

			expect(validation.allowed).toBe(true);
			expect(validation.filesToCommit).toContain("README.md");
		});
	});

	describe("commitPlan", () => {
		it("should create a rollup commit with plan message format", async () => {
			// Create some changes
			await fs.mkdir(path.join(TEST_DIR, "src"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "src", "a.ts"), "// A", "utf-8");
			await fs.writeFile(path.join(TEST_DIR, "src", "b.ts"), "// B", "utf-8");
			await execAsync("git add src/a.ts", { cwd: TEST_DIR });
			await execAsync('git commit -m "WIP"', { cwd: TEST_DIR });
			await fs.writeFile(path.join(TEST_DIR, "src", "b.ts"), "// B updated", "utf-8");
			await fs.writeFile(path.join(TEST_DIR, "src", "c.ts"), "// C", "utf-8");

			const result = await autoCommit.commitPlan("2", "My Plan");

			expect(result.success).toBe(true);
			expect(result.commitHash).toBeDefined();
			expect(result.committedFiles).toContain("src/b.ts");
			expect(result.committedFiles).toContain("src/c.ts");

			const { stdout } = await execAsync("git log -1 --pretty=%B", { cwd: TEST_DIR });
			expect(stdout.trim()).toContain("feat(p2): complete plan");
			expect(stdout.trim()).toContain("\u2014");
			expect(stdout.trim()).toContain("My Plan");
		});

		it("should return failure when no changes exist", async () => {
			const result = await autoCommit.commitPlan("2", "Empty Plan");

			expect(result.success).toBe(false);
			expect(result.reason).toContain("No changes");
		});

		it("should accept optional phase parameter", async () => {
			await fs.writeFile(path.join(TEST_DIR, "phase-test.txt"), "phase", "utf-8");

			const result = await autoCommit.commitPlan("99", "Phase 99");

			expect(result.success).toBe(true);

			const { stdout } = await execAsync("git log -1 --pretty=%B", { cwd: TEST_DIR });
			expect(stdout.trim()).toContain("feat(p99): complete plan");
		});
	});
});
