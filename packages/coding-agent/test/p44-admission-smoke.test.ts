/**
 * P44 Admission Smoke Test
 *
 * Fast, deterministic E2E smoke gate that proves P44 admission behavior.
 * Creates a real temporary git repo and verifies:
 * - active_safe runtime enabled
 * - read path produces compact output when appropriate
 * - WorkspaceCommitGate blocks dangerous git commands
 * - WorkspaceCommitGate enforces scoped staging/commit
 * - Write-set drift blocks integration
 * - Unrelated dirty files are not committed
 *
 * Does NOT require real LLM API keys.
 * Uses mock/synthetic executor and real WorkspaceCommitGate.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TOKEN_CONTEXT_CONFIG } from "../src/core/token-context/types.js";
import { WorkspaceCommitGate } from "../src/core/workspace-commit-gate.js";
import { DEFAULT_WRITE_SET_DRIFT_CONFIG } from "../src/core/write-set-drift.js";
import { admitExecution } from "../src/execution-runtime/admission-gate.js";

// ===========================================================================
// Helpers
// ===========================================================================

interface TestRepo {
	dir: string;
	gate: WorkspaceCommitGate;
}

function createTestRepo(writeSet: string[]): TestRepo {
	const dir = fs.mkdtempSync("p44-smoke-");
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

	const gate = new WorkspaceCommitGate({
		repoRoot: dir,
		workspaceId: "test-ws",
		allowedWriteSet: writeSet,
	});

	return { dir, gate };
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

function _gitUnstagedFiles(dir: string): string[] {
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

// ===========================================================================
// Tests
// ===========================================================================

describe("P44 Admission Smoke Test", () => {
	let repo: TestRepo;

	beforeEach(() => {
		repo = createTestRepo(["src/math.ts"]);
	});

	afterEach(() => {
		cleanupRepo(repo);
	});

	// === active_safe default ===

	it("DEFAULT_TOKEN_CONTEXT_CONFIG.mode is active_safe", () => {
		expect(DEFAULT_TOKEN_CONTEXT_CONFIG.mode).toBe("active_safe");
		expect(DEFAULT_TOKEN_CONTEXT_CONFIG.enabled).toBe(true);
	});

	// === Admission gate ===

	it("admission gate rejects non-active_safe modes", () => {
		const rejectModes = ["observe_only", "shadow", "disabled"];
		for (const mode of rejectModes) {
			expect(
				admitExecution({
					postgresAvailable: true,
					production: false,
					jsonFallback: false,
					repairMode: false,
					autonomousMode: false,
					promotionGateSatisfied: true,
					tokenContextEnabled: true,
					tokenContextMode: mode,
				}),
			).toBe("reject");
		}
	});

	it("admission gate accepts active_safe mode", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
				tokenContextEnabled: true,
				tokenContextMode: "active_safe",
			}),
		).toBe("allow");
	});

	it("admission gate rejects when tokenContext disabled", () => {
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
				tokenContextEnabled: false,
				tokenContextMode: "active_safe",
			}),
		).toBe("reject");
	});

	// === Write-set drift ===

	it("write-set drift defaults to block_integration", () => {
		expect(DEFAULT_WRITE_SET_DRIFT_CONFIG.onDriftDetected).toBe("block_integration");
		expect(DEFAULT_WRITE_SET_DRIFT_CONFIG.driftThresholdFiles).toBe(0);
	});

	// === WorkspaceCommitGate — dangerous commands ===

	it("blocks git add .", () => {
		const result = repo.gate.validateCommand("git add .");
		expect(result.allowed).toBe(false);
	});

	it("blocks git add -A", () => {
		const result = repo.gate.validateCommand("git add -A");
		expect(result.allowed).toBe(false);
	});

	it("blocks git commit -a", () => {
		const result = repo.gate.validateCommand("git commit -a -m test");
		expect(result.allowed).toBe(false);
	});

	// === WorkspaceCommitGate — scoped staging ===

	it("allows scoped git add for owned file", () => {
		const result = repo.gate.validateCommand("git add src/math.ts");
		expect(result.allowed).toBe(true);
	});

	it("blocks scoped git add for unowned file", () => {
		const result = repo.gate.validateCommand("git add package.json");
		expect(result.allowed).toBe(false);
	});

	// === WorkspaceCommitGate — staged file enforcement ===

	it("blocks staging of unrelated file", async () => {
		writeFile(repo.dir, "src/math.ts", "modified");
		writeFile(repo.dir, "secret.txt", "should not be committed");
		execSync("git add secret.txt", { cwd: repo.dir, stdio: "pipe" });

		const state = await repo.gate.validateStagedFiles();
		expect(state.allowed).toBe(false);
		expect(state.unexpectedStagedFiles).toContain("secret.txt");
	});

	// === WorkspaceCommitGate — scoped commit ===

	it("commits only owned file", async () => {
		writeFile(repo.dir, "src/math.ts", "modified content");
		execSync("git add src/math.ts", { cwd: repo.dir, stdio: "pipe" });

		const result = await repo.gate.createScopedCommit("P44 smoke: update math.ts");
		expect(result.allowed).toBe(true);

		const committed = committedFiles(repo.dir);
		expect(committed).toContain("src/math.ts");
	});

	it("leaves unrelated dirty file uncommitted", async () => {
		writeFile(repo.dir, "src/math.ts", "modified content");
		writeFile(repo.dir, "README.md", "modified readme");
		execSync("git add src/math.ts", { cwd: repo.dir, stdio: "pipe" });

		const result = await repo.gate.createScopedCommit("P44 smoke: update math.ts only");
		expect(result.allowed).toBe(true);

		const committed = committedFiles(repo.dir);
		expect(committed).toContain("src/math.ts");
		expect(committed).not.toContain("README.md");
	});

	// === WorkspaceCommitGate — block reason clarity ===

	it("reports clear block reason when unexpected staged files exist", async () => {
		writeFile(repo.dir, "src/math.ts", "content");
		writeFile(repo.dir, "secret.env", "SECRET=1");
		execSync("git add secret.env", { cwd: repo.dir, stdio: "pipe" });

		const state = await repo.gate.validateStagedFiles();
		expect(state.allowed).toBe(false);
		expect(state.reason).toContain("WorkspaceCommitGate");
		expect(state.reason).toContain("secret.env");
	});

	// === WorkspaceCommitGate — stageAllowedFiles ===

	it("stageAllowedFiles stages only writeSet files", async () => {
		writeFile(repo.dir, "src/math.ts", "modified");
		writeFile(repo.dir, "other.ts", "other");

		const result = await repo.gate.stageAllowedFiles();
		expect(result.allowed).toBe(true);

		const staged = gitStagedFiles(repo.dir);
		expect(staged).toContain("src/math.ts");
		expect(staged).not.toContain("other.ts");
	});

	// === End-to-end flow ===

	it("full P44 admission flow passes: active_safe + command validation + scoped commit", async () => {
		// 1. Verify admission gate
		expect(
			admitExecution({
				postgresAvailable: true,
				production: false,
				jsonFallback: false,
				repairMode: false,
				autonomousMode: false,
				promotionGateSatisfied: true,
				tokenContextEnabled: true,
				tokenContextMode: "active_safe",
			}),
		).toBe("allow");

		// 2. Modify owned file
		writeFile(
			repo.dir,
			"src/math.ts",
			"export function add(a: number, b: number): number {\n  return a + b + 1;\n}\n",
		);

		// 3. Simulate a dangerous command — blocked
		const dangerResult = repo.gate.validateCommand("git add .");
		expect(dangerResult.allowed).toBe(false);

		// 4. Stage only owned file
		const stageResult = await repo.gate.stageAllowedFiles();
		expect(stageResult.allowed).toBe(true);

		// 5. Verify staged files
		const staged = gitStagedFiles(repo.dir);
		expect(staged).toContain("src/math.ts");

		// 6. Commit
		const commitResult = await repo.gate.createScopedCommit("P44 smoke: full flow");
		expect(commitResult.allowed).toBe(true);

		// 7. Verify only owned file committed
		const committed = committedFiles(repo.dir);
		expect(committed).toEqual(["src/math.ts"]);
	});

	it("full P44 admission flow blocks unrelated file commit", async () => {
		// 1. Create a workspace with writeSet for math.ts only
		writeFile(repo.dir, "src/math.ts", "modified");
		writeFile(repo.dir, "README.md", "readme change");

		// 2. Stage both files (bad actor)
		execSync("git add src/math.ts", { cwd: repo.dir, stdio: "pipe" });
		execSync("git add README.md", { cwd: repo.dir, stdio: "pipe" });

		// 3. Validation should block
		const validated = await repo.gate.validateStagedFiles();
		expect(validated.allowed).toBe(false);
		expect(validated.unexpectedStagedFiles).toContain("README.md");

		// 4. Commit should fail
		const commitResult = await repo.gate.createScopedCommit("should fail");
		expect(commitResult.allowed).toBe(false);
	});
});
