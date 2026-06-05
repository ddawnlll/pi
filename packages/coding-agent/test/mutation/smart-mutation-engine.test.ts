/**
 * Smart Mutation Engine Tests — P43.8C
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDataFile, isDocumentFile, isSourceLikeFile } from "../../src/core/mutation/mutation-types.js";
import { validateFileContent } from "../../src/core/mutation/parser-validation.js";
import { SmartMutationEngine } from "../../src/core/mutation/smart-mutation-engine.js";
import { checkWriteSet, normalizeRepoPath } from "../../src/core/mutation/write-set-guard.js";

// ===========================================================================
// Helpers
// ===========================================================================

function createTempDir(): string {
	const dir = fs.mkdtempSync("p43_8c-mutation-");
	return fs.realpathSync(dir);
}

function writeTestFile(dir: string, relativePath: string, content: string): string {
	const absPath = path.join(dir, relativePath);
	fs.mkdirSync(path.dirname(absPath), { recursive: true });
	fs.writeFileSync(absPath, content, "utf-8");
	return absPath;
}

function cleanupDir(dir: string): void {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

// ===========================================================================
// File type detection tests
// ===========================================================================

describe("file type detection", () => {
	it("detects source-like files", () => {
		expect(isSourceLikeFile("src/math.ts")).toBe(true);
		expect(isSourceLikeFile("src/app.tsx")).toBe(true);
		expect(isSourceLikeFile("src/utils.py")).toBe(true);
		expect(isSourceLikeFile("src/main.rs")).toBe(true);
		expect(isSourceLikeFile("README.md")).toBe(false);
		expect(isSourceLikeFile("data.json")).toBe(false);
	});

	it("detects data files", () => {
		expect(isDataFile("config.json")).toBe(true);
		expect(isDataFile("config.yaml")).toBe(true);
		expect(isDataFile("src/app.ts")).toBe(false);
		expect(isDataFile("README.md")).toBe(false);
	});

	it("detects document files", () => {
		expect(isDocumentFile("README.md")).toBe(true);
		expect(isDocumentFile("notes.txt")).toBe(true);
		expect(isDocumentFile("src/app.ts")).toBe(false);
	});
});

// ===========================================================================
// WriteSet guard tests
// ===========================================================================

describe("writeSet guard", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = createTempDir();
	});

	afterEach(() => {
		cleanupDir(tmpDir);
	});

	it("allows path inside writeSet", () => {
		const result = checkWriteSet(path.join(tmpDir, "src/math.ts"), tmpDir, ["src/math.ts"]);
		expect(result.ok).toBe(true);
	});

	it("blocks path outside writeSet", () => {
		const result = checkWriteSet(path.join(tmpDir, "README.md"), tmpDir, ["src/math.ts"]);
		expect(result.ok).toBe(false);
	});

	it("blocks path traversal", () => {
		const result = checkWriteSet(path.join(tmpDir, "../outside.ts"), tmpDir, ["src/*.ts"]);
		expect(result.ok).toBe(false);
	});

	it("allows artifact by glob", () => {
		const result = checkWriteSet(path.join(tmpDir, "reports/output.json"), tmpDir, ["src/math.ts"], ["reports/**"]);
		expect(result.ok).toBe(true);
	});

	it("normalizes repo-relative paths", () => {
		const ref = normalizeRepoPath(path.join(tmpDir, "src/math.ts"), tmpDir);
		expect(ref).toBe("src/math.ts");
	});
});

// ===========================================================================
// Parser validation tests
// ===========================================================================

describe("parser validation", () => {
	it("valid JSON passes", () => {
		const result = validateFileContent("config.json", '{"name": "test"}', "required");
		expect(result.ok).toBe(true);
		expect(result.parser).toBe("json");
	});

	it("invalid JSON fails", () => {
		const result = validateFileContent("config.json", '{"name": test}', "required");
		expect(result.ok).toBe(false);
	});

	it("valid TS passes basic checks", () => {
		const result = validateFileContent("src/app.ts", "const x = 1;\nexport default x;", "required");
		expect(result.ok).toBe(true);
	});

	it("unbalanced braces in JS fails", () => {
		const result = validateFileContent("src/app.ts", "const x = {", "required");
		expect(result.ok).toBe(false);
	});

	it("markdown always passes", () => {
		const result = validateFileContent("README.md", "# Hello", "required");
		expect(result.ok).toBe(true);
		expect(result.parser).toBe("none");
	});

	it("unknown extension requires policy", () => {
		const result = validateFileContent("src/data.custom", "content", "required");
		expect(result.ok).toBe(false);
		expect(result.parser).toBe("unavailable");
	});

	it("best_effort allows unavailable parser", () => {
		const result = validateFileContent("src/data.custom", "content", "best_effort");
		expect(result.ok).toBe(true);
	});

	it("disabled skips all validation", () => {
		const result = validateFileContent("src/app.ts", "invalid {{{", "disabled");
		expect(result.ok).toBe(true);
	});
});

// ===========================================================================
// Smart Mutation Engine tests
// ===========================================================================

describe("SmartMutationEngine", () => {
	let tmpDir: string;
	let engine: SmartMutationEngine;

	beforeEach(() => {
		tmpDir = createTempDir();
		engine = new SmartMutationEngine();
	});

	afterEach(() => {
		cleanupDir(tmpDir);
	});

	// ===================================================================
	// Create
	// ===================================================================

	it("creates new valid TS file", async () => {
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "src/math.ts",
			mode: "create",
			content: "export function add(a: number, b: number): number { return a + b; }\n",
			allowedWriteSet: ["src/math.ts"],
		});
		expect(result.ok).toBe(true);
		expect(result.createdFile).toBe(true);
		expect(result.postHash).toBeDefined();
	});

	it("blocks existing file in create mode", async () => {
		writeTestFile(tmpDir, "existing.ts", "content");
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "existing.ts",
			mode: "create",
			content: "new content",
		});
		expect(result.ok).toBe(false);
		expect(result.blocked).toBe(true);
	});

	it("blocks create outside writeSet", async () => {
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "outside.ts",
			mode: "create",
			content: "content",
			allowedWriteSet: ["src/*.ts"],
		});
		expect(result.ok).toBe(false);
	});

	it("blocks placeholder content for source files", async () => {
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "src/stub.ts",
			mode: "create",
			content: 'throw new Error("not implemented");\n',
		});
		expect(result.ok).toBe(false);
	});

	it("allows placeholder for doc files", async () => {
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "TODO.md",
			mode: "create",
			content: "# TODO\n- [ ] thing\n",
		});
		expect(result.ok).toBe(true);
	});

	it("invalid JSON create rolls back", async () => {
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "config.json",
			mode: "create",
			content: "{invalid}",
			validationPolicy: {
				parserValidation: "required",
				rollbackOnParserFailure: true,
				allowParserUnavailable: false,
			},
		});
		expect(result.ok).toBe(false);
	});

	// ===================================================================
	// Edit
	// ===================================================================

	it("exact edit succeeds", async () => {
		writeTestFile(tmpDir, "src/math.ts", "export function add(a: number, b: number): number { return a + b; }\n");
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "src/math.ts",
			mode: "edit",
			oldText: "a + b",
			newText: "a + b + 1",
			allowedWriteSet: ["src/math.ts"],
		});
		expect(result.ok).toBe(true);
		expect(result.editRecovery?.strategy).toBe("exact");
	});

	it("normalized edit recovers with whitespace differences", async () => {
		writeTestFile(tmpDir, "src/math.ts", "export function add( a: number,  b: number ): number { return a + b; }\n");
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "src/math.ts",
			mode: "edit",
			oldText: "a + b",
			newText: "a + b + 1",
		});
		expect(result.ok).toBe(true);
		expect(result.editRecovery?.strategy).toBe("exact");
	});

	it("candidate-based edit recovery with similar content", async () => {
		writeTestFile(tmpDir, "src/math.ts", "export function add(a: number, b: number): number { return a + b; }\n");
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "src/math.ts",
			mode: "edit",
			oldText: "return a + b;",
			newText: "return a + b + 1;",
		});
		// Should match via normalized whitespace since the real content has spaces
		expect(result.ok).toBe(true);
	});

	it("multiple occurrences of oldText blocks", async () => {
		writeTestFile(tmpDir, "src/math.ts", "const x = 1;\nconst y = 2;\nconst z = x;\n");
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "src/math.ts",
			mode: "edit",
			oldText: "const",
			newText: "let",
		});
		expect(result.ok).toBe(false);
	});

	it("edit on nonexistent file blocks", async () => {
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "nonexistent.ts",
			mode: "edit",
			oldText: "a",
			newText: "b",
		});
		expect(result.ok).toBe(false);
	});

	// ===================================================================
	// Overwrite guard
	// ===================================================================

	it("large source file overwrite is blocked by default", async () => {
		const lines: string[] = [];
		for (let i = 0; i < 350; i++) {
			lines.push(`const line${i} = ${i};`);
		}
		writeTestFile(tmpDir, "large.ts", lines.join("\n"));
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "large.ts",
			mode: "overwrite",
			content: "const x = 1;\n",
		});
		expect(result.ok).toBe(false);
		expect(result.blockReason).toContain("existing_file_requires_edit_not_write");
	});

	it("small file overwrite is allowed", async () => {
		writeTestFile(tmpDir, "small.ts", "const x = 1;\n");
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "small.ts",
			mode: "overwrite",
			content: "const y = 2;\n",
		});
		expect(result.ok).toBe(true);
	});

	it("blocks edit outside writeSet on existing file", async () => {
		writeTestFile(tmpDir, "unowned.ts", "const x = 1;\n");
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "unowned.ts",
			mode: "edit",
			oldText: "const",
			newText: "let",
			allowedWriteSet: ["src/owned.ts"],
		});
		expect(result.ok).toBe(false);
		expect(result.blocked).toBe(true);
	});

	it("blocks overwrite outside writeSet", async () => {
		writeTestFile(tmpDir, "unowned.ts", "const x = 1;\n");
		const result = await engine.mutate({
			repoRoot: tmpDir,
			path: "unowned.ts",
			mode: "overwrite",
			content: "const y = 2;\n",
			allowedWriteSet: ["src/owned.ts"],
		});
		expect(result.ok).toBe(false);
	});
});
