/**
 * P44.08 — WorkspaceCommitGate Completion Subsystem Tests
 *
 * Tests verify:
 * - Re-exports core WorkspaceCommitGate correctly
 * - toCompletionCommitGateResult wraps results properly
 * - WorkspaceWriteSet types and helpers
 * - isFileInWriteSet pattern matching
 * - computeEmpiricalWriteSet from git state
 * - classifyEmpiricalWriteSet classification
 * - compareWriteSets comparison logic
 * - formatWriteSetComparison formatting
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	toCompletionCommitGateResult,
	WorkspaceCommitGate,
	type WorkspaceCommitGateConfig,
} from "../../src/core/completion/workspace-commit-gate.js";
import {
	buildWorkspaceWriteSet,
	classifyEmpiricalWriteSet,
	compareWriteSets,
	computeEmpiricalWriteSet,
	formatWriteSetComparison,
	isAllowedArtifact,
	isFileInWriteSet,
	WRITE_SET_SCHEMA_VERSION,
	type WriteSetComparisonResult,
	type WriteSetFileEntry,
} from "../../src/core/completion/workspace-write-set.js";

// ---------------------------------------------------------------------------
// Test Repo Setup
// ---------------------------------------------------------------------------

let tempDir: string;

function initRepo(): string {
	const dir = fs.mkdtempSync("wcg-compl-test-");
	execSync("git init", { cwd: dir, stdio: "pipe" });
	execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
	execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
	fs.writeFileSync(path.join(dir, ".gitkeep"), "", "utf-8");
	execSync("git add .gitkeep", { cwd: dir, stdio: "pipe" });
	execSync("git commit -m init", { cwd: dir, stdio: "pipe" });
	return dir;
}

function writeFile(relativePath: string, content = "test"): void {
	const fullPath = path.join(tempDir, relativePath);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content, "utf-8");
}

function deleteFile(relativePath: string): void {
	fs.unlinkSync(path.join(tempDir, relativePath));
}

function gitAdd(...files: string[]): void {
	execSync(`git add -- ${files.map((f) => `'${f}'`).join(" ")}`, { cwd: tempDir, stdio: "pipe" });
}

function gitAddAll(): void {
	execSync("git add -A", { cwd: tempDir, stdio: "pipe" });
}

function gitCommit(message: string): void {
	execSync(`git commit -m '${message}'`, { cwd: tempDir, stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// Tests: Re-exports & Completion Integration
// ---------------------------------------------------------------------------

describe("P44.08 — WorkspaceCommitGate (Completion Subsystem)", () => {
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

	describe("re-exports", () => {
		it("re-exports WorkspaceCommitGate class from core", () => {
			const gate = new WorkspaceCommitGate({
				repoRoot: tempDir,
				workspaceId: "test-ws",
				allowedWriteSet: ["src/owned.ts"],
			});
			expect(gate).toBeInstanceOf(WorkspaceCommitGate);
		});

		it("re-exports WorkspaceCommitGateConfig type", () => {
			const config: WorkspaceCommitGateConfig = {
				repoRoot: tempDir,
				workspaceId: "test-ws",
				allowedWriteSet: ["src/*.ts"],
			};
			expect(config.repoRoot).toBe(tempDir);
		});

		it("createScopedCommit works via re-exported class", async () => {
			writeFile("src/owned.ts", "content");
			gitAdd("src/owned.ts");
			const gate = new WorkspaceCommitGate({
				repoRoot: tempDir,
				workspaceId: "test-ws",
				allowedWriteSet: ["src/owned.ts"],
			});

			const result = await gate.createScopedCommit("test commit");
			expect(result.allowed).toBe(true);
			expect(result.stagedFiles).toContain("src/owned.ts");
		});

		it("blocks dangerous git add . via re-exported class", () => {
			const gate = new WorkspaceCommitGate({
				repoRoot: tempDir,
				workspaceId: "test-ws",
				allowedWriteSet: ["src/owned.ts"],
			});

			const result = gate.validateCommand("git add .");
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain("dangerous git command");
		});
	});

	describe("toCompletionCommitGateResult", () => {
		it("returns passed=true for allowed result", () => {
			const gate = new WorkspaceCommitGate({
				repoRoot: tempDir,
				workspaceId: "test-ws",
				allowedWriteSet: ["src/owned.ts"],
			});

			const raw = gate.validateCommand("git add src/owned.ts");
			const result = toCompletionCommitGateResult(raw);
			expect(result.passed).toBe(true);
			expect(result.blockReasons).toEqual([]);
		});

		it("returns passed=false with block reasons for blocked result", () => {
			const gate = new WorkspaceCommitGate({
				repoRoot: tempDir,
				workspaceId: "test-ws",
				allowedWriteSet: ["src/owned.ts"],
			});

			const raw = gate.validateCommand("git add .");
			const result = toCompletionCommitGateResult(raw);
			expect(result.passed).toBe(false);
			expect(result.blockReasons.length).toBeGreaterThan(0);
		});

		it("includes unexpectedStagedFiles in block reasons", () => {
			const raw = {
				allowed: false,
				reason: "WorkspaceCommitGate blocked: unexpected staged files outside writeSet: secret.env",
				stagedFiles: ["secret.env"],
				unstagedModifiedFiles: [],
				unexpectedStagedFiles: ["secret.env"],
				unexpectedModifiedFiles: [],
				allowedFiles: [],
			};

			const result = toCompletionCommitGateResult(raw);
			expect(result.passed).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("secret.env"))).toBe(true);
		});

		it("includes blockedCommands in block reasons", () => {
			const raw = {
				allowed: false,
				reason: "WorkspaceCommitGate blocked dangerous git command",
				stagedFiles: [],
				unstagedModifiedFiles: [],
				unexpectedStagedFiles: [],
				unexpectedModifiedFiles: [],
				allowedFiles: [],
				blockedCommands: ["git add ."],
			};

			const result = toCompletionCommitGateResult(raw);
			expect(result.passed).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("git add ."))).toBe(true);
		});

		it("preserves rawResult", () => {
			const gate = new WorkspaceCommitGate({
				repoRoot: tempDir,
				workspaceId: "test-ws",
				allowedWriteSet: ["src/owned.ts"],
			});

			const raw = gate.validateCommand("git add .");
			const result = toCompletionCommitGateResult(raw);
			expect(result.rawResult).toEqual(raw);
		});

		it("provides default reason when no specific reason is given", () => {
			const raw = {
				allowed: false,
				stagedFiles: [],
				unstagedModifiedFiles: [],
				unexpectedStagedFiles: [],
				unexpectedModifiedFiles: [],
				allowedFiles: [],
			};

			const result = toCompletionCommitGateResult(raw);
			expect(result.passed).toBe(false);
			expect(result.blockReasons).toContain("WorkspaceCommitGate check failed");
		});
	});
});

// ---------------------------------------------------------------------------
// Tests: WorkspaceWriteSet
// ---------------------------------------------------------------------------

describe("P44.08 — WorkspaceWriteSet", () => {
	describe("WRITE_SET_SCHEMA_VERSION", () => {
		it("is a string constant", () => {
			expect(typeof WRITE_SET_SCHEMA_VERSION).toBe("string");
			expect(WRITE_SET_SCHEMA_VERSION).toBe("1.0.0");
		});
	});

	describe("isFileInWriteSet", () => {
		it("matches exact file paths", () => {
			expect(isFileInWriteSet("src/main.ts", ["src/main.ts"])).toBe(true);
		});

		it("does not match non-matching exact file paths", () => {
			expect(isFileInWriteSet("src/other.ts", ["src/main.ts"])).toBe(false);
		});

		it("matches directory prefix patterns", () => {
			expect(isFileInWriteSet("src/core/foo.ts", ["src/core/"])).toBe(true);
		});

		it("matches directory glob patterns: dir/**", () => {
			expect(isFileInWriteSet("src/sub/foo.ts", ["src/sub/**"])).toBe(true);
		});

		it("matches the directory itself with dir/** pattern", () => {
			expect(isFileInWriteSet("src/sub", ["src/sub/**"])).toBe(true);
		});

		it("matches extension globs: *.ts", () => {
			expect(isFileInWriteSet("foo.ts", ["*.ts"])).toBe(true);
		});

		it("does not match extension glob for wrong extension", () => {
			expect(isFileInWriteSet("foo.js", ["*.ts"])).toBe(false);
		});

		it("matches general glob: src/*.ts", () => {
			expect(isFileInWriteSet("src/foo.ts", ["src/*.ts"])).toBe(true);
		});

		it("does not match nested paths with single-level glob: src/*.ts", () => {
			expect(isFileInWriteSet("src/sub/foo.ts", ["src/*.ts"])).toBe(false);
		});

		it("matches recursive glob with **", () => {
			expect(isFileInWriteSet("src/a/b/c.ts", ["src/**"])).toBe(true);
		});

		it("handles backslash-normalized paths", () => {
			expect(isFileInWriteSet("src\\main.ts", ["src/main.ts"])).toBe(true);
		});

		it("returns false for empty patterns", () => {
			expect(isFileInWriteSet("src/main.ts", [])).toBe(false);
		});

		it("matches any pattern if multiple are provided", () => {
			expect(isFileInWriteSet("src/other.js", ["*.ts", "*.js"])).toBe(true);
		});
	});

	describe("isAllowedArtifact", () => {
		it("returns true when file matches artifact pattern", () => {
			expect(isAllowedArtifact("package-lock.json", ["package-lock.json"])).toBe(true);
		});

		it("returns false when file does not match artifact pattern", () => {
			expect(isAllowedArtifact("src/main.ts", ["package-lock.json"])).toBe(false);
		});

		it("returns true for matching artifact glob patterns", () => {
			expect(isAllowedArtifact("dist/bundle.js", ["dist/**"])).toBe(true);
		});
	});

	describe("classifyEmpiricalWriteSet", () => {
		it("marks files matching declared patterns as declared", () => {
			const files: WriteSetFileEntry[] = [
				{ path: "src/owned.ts", status: "modified", size: 100, declared: false },
				{ path: "other.ts", status: "modified", size: 50, declared: false },
			];

			const classified = classifyEmpiricalWriteSet(files, ["src/owned.ts"]);
			expect(classified[0].declared).toBe(true);
			expect(classified[0].status).toBe("modified");
			expect(classified[1].declared).toBe(false);
			expect(classified[1].status).toBe("unexpected");
		});

		it("marks files matching artifact patterns as artifacts", () => {
			const files: WriteSetFileEntry[] = [
				{ path: "package-lock.json", status: "modified", size: 500, declared: false },
			];

			const classified = classifyEmpiricalWriteSet(files, ["src/*.ts"], ["package-lock.json"]);
			expect(classified[0].declared).toBe(false);
			expect(classified[0].artifact).toBe(true);
			expect(classified[0].status).toBe("modified"); // artifact files keep their status
		});

		it("handles empty empirical set gracefully", () => {
			const classified = classifyEmpiricalWriteSet([], ["src/*.ts"]);
			expect(classified).toEqual([]);
		});
	});

	describe("compareWriteSets", () => {
		it("returns covered=true when all files are declared", () => {
			const files: WriteSetFileEntry[] = [
				{ path: "src/owned.ts", status: "modified", size: 100, declared: true },
				{ path: "src/utils.ts", status: "created", size: 50, declared: true },
			];

			const result = compareWriteSets(files, ["src/owned.ts", "src/utils.ts"]);
			expect(result.covered).toBe(true);
			expect(result.matched).toHaveLength(2);
			expect(result.unexpected).toHaveLength(0);
		});

		it("returns covered=false with unexpected files", () => {
			const files: WriteSetFileEntry[] = [
				{ path: "src/owned.ts", status: "modified", size: 100, declared: true },
				{ path: "secret.env", status: "unexpected", size: 50, declared: false },
			];

			const result = compareWriteSets(files, ["src/owned.ts"]);
			expect(result.covered).toBe(false);
			expect(result.matched).toHaveLength(1);
			expect(result.unexpected).toHaveLength(1);
			expect(result.unexpected[0].path).toBe("secret.env");
		});

		it("lists unused declared patterns", () => {
			const files: WriteSetFileEntry[] = [{ path: "src/used.ts", status: "modified", size: 100, declared: true }];

			const result = compareWriteSets(files, ["src/used.ts", "src/unused.ts"]);
			expect(result.covered).toBe(true);
			expect(result.unused).toHaveLength(1);
			expect(result.unused[0].path).toBe("src/unused.ts");
		});

		it("handles artifact files as matched", () => {
			const files: WriteSetFileEntry[] = [
				{ path: "src/owned.ts", status: "modified", size: 100, declared: true },
				{ path: "package-lock.json", status: "modified", size: 500, declared: false, artifact: true },
			];

			const result = compareWriteSets(files, ["src/owned.ts"]);
			expect(result.covered).toBe(true);
			expect(result.matched).toHaveLength(2);
			expect(result.unexpected).toHaveLength(0);
		});

		it("returns empty result for empty input", () => {
			const result = compareWriteSets([], []);
			expect(result.covered).toBe(true);
			expect(result.matched).toEqual([]);
			expect(result.unexpected).toEqual([]);
			expect(result.unused).toEqual([]);
		});
	});

	describe("formatWriteSetComparison", () => {
		it("returns a formatted summary string", () => {
			const result: WriteSetComparisonResult = {
				matched: [{ path: "src/owned.ts", status: "modified", size: 100, declared: true }],
				unexpected: [],
				unused: [],
				covered: true,
				summary: "All 1 changed files are within the declared write set",
			};

			const formatted = formatWriteSetComparison(result);
			expect(formatted).toContain("Matched: 1 files");
			expect(formatted).toContain("Unexpected: 0 files");
		});

		it("includes unexpected files in output", () => {
			const result: WriteSetComparisonResult = {
				matched: [],
				unexpected: [{ path: "secret.env", status: "unexpected", size: 50, declared: false }],
				unused: [],
				covered: false,
				summary: "1 file(s) changed outside the declared write set",
			};

			const formatted = formatWriteSetComparison(result);
			expect(formatted).toContain("Unexpected: 1 files");
			expect(formatted).toContain("secret.env");
		});

		it("includes unused patterns in output", () => {
			const result: WriteSetComparisonResult = {
				matched: [],
				unexpected: [],
				unused: [{ path: "src/unused.ts", status: "unchanged", size: 0, declared: true }],
				covered: true,
				summary: "All 0 changed files are within the declared write set",
			};

			const formatted = formatWriteSetComparison(result);
			expect(formatted).toContain("Unused declared patterns: 1");
			expect(formatted).toContain("src/unused.ts");
		});
	});

	describe("computeEmpiricalWriteSet", () => {
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

		it("returns empty array for clean repo", () => {
			const entries = computeEmpiricalWriteSet(tempDir);
			expect(entries).toEqual([]);
		});

		it("detects created files", () => {
			writeFile("src/new.ts", "hello");
			const entries = computeEmpiricalWriteSet(tempDir);
			expect(entries.some((e) => e.path === "src/new.ts" && e.status === "created")).toBe(true);
		});

		it("detects modified files", () => {
			writeFile("src/existing.ts", "v1");
			gitAddAll();
			gitCommit("add existing");

			writeFile("src/existing.ts", "v2");
			const entries = computeEmpiricalWriteSet(tempDir, "HEAD");
			expect(entries.some((e) => e.path === "src/existing.ts" && e.status === "modified")).toBe(true);
		});

		it("detects deleted files", () => {
			writeFile("src/to-delete.ts", "content");
			gitAddAll();
			gitCommit("add to-delete");

			deleteFile("src/to-delete.ts");
			const entries = computeEmpiricalWriteSet(tempDir, "HEAD");
			expect(entries.some((e) => e.path === "src/to-delete.ts" && e.status === "deleted")).toBe(true);
		});

		it("handles non-existent repo gracefully", () => {
			const entries = computeEmpiricalWriteSet("/nonexistent/path");
			expect(entries).toEqual([]);
		});
	});

	describe("buildWorkspaceWriteSet", () => {
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

		it("builds a write set snapshot with classified files", () => {
			writeFile("src/owned.ts", "content");
			writeFile("other.ts", "other");

			const ws = buildWorkspaceWriteSet("ws-1", "plan-1", ["src/*.ts"], [], "HEAD", tempDir);

			expect(ws.workspaceId).toBe("ws-1");
			expect(ws.planExecId).toBe("plan-1");
			expect(ws.declaredPatterns).toEqual(["src/*.ts"]);
			expect(ws.files.length).toBeGreaterThan(0);

			const ownedFile = ws.files.find((f) => f.path === "src/owned.ts");
			expect(ownedFile).toBeDefined();
			expect(ownedFile!.declared).toBe(true);

			const otherFile = ws.files.find((f) => f.path === "other.ts");
			expect(otherFile).toBeDefined();
			if (otherFile) {
				// other.ts is not in the declared write set, so it's unexpected
				expect(otherFile.status).toBe("unexpected");
			}
		});
	});
});
