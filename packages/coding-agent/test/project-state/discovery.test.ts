/**
 * File discovery tests
 *
 * Verifies recursive file discovery, exclusions, and classification.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyFile } from "../../src/core/project-state/classify-file.js";
import { discoverFiles } from "../../src/core/project-state/discovery.js";
import { DEFAULT_INCLUDED_EXTENSIONS, HARD_EXCLUDED_DIRS } from "../../src/core/project-state/paths.js";

describe("discoverFiles", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-disc-test-"));
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		mkdirSync(join(tmpDir, "node_modules"), { recursive: true });
		mkdirSync(join(tmpDir, ".git"), { recursive: true });
		mkdirSync(join(tmpDir, "dist"), { recursive: true });
		mkdirSync(join(tmpDir, "coverage"), { recursive: true });
		mkdirSync(join(tmpDir, "target"), { recursive: true });
		mkdirSync(join(tmpDir, ".cache"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("discovers eligible source files recursively", () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		writeFileSync(join(tmpDir, "src", "b.tsx"), "const y = 2;\n", "utf-8");
		writeFileSync(join(tmpDir, "src", "c.js"), "const z = 3;\n", "utf-8");

		const result = discoverFiles(tmpDir);
		expect(result.fileCount).toBe(3);
		expect(result.files["src/a.ts"]).toBeDefined();
		expect(result.files["src/b.tsx"]).toBeDefined();
		expect(result.files["src/c.js"]).toBeDefined();
	});

	it("excludes node_modules", () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		writeFileSync(join(tmpDir, "node_modules", "ignored.ts"), "module.exports = {};\n", "utf-8");

		const result = discoverFiles(tmpDir);
		expect(result.fileCount).toBe(1);
		expect(result.files["src/a.ts"]).toBeDefined();
		expect(result.files["node_modules/ignored.ts"]).toBeUndefined();
	});

	it("excludes .git", () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		writeFileSync(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf-8");

		const result = discoverFiles(tmpDir);
		expect(result.fileCount).toBe(1);
	});

	it("excludes dist, build, coverage, target", () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		writeFileSync(join(tmpDir, "dist", "output.ts"), "console.log('built');\n", "utf-8");
		writeFileSync(join(tmpDir, "coverage", "report.ts"), "// report\n", "utf-8");
		writeFileSync(join(tmpDir, "target", "gen.rs"), "// generated\n", "utf-8");

		const result = discoverFiles(tmpDir);
		expect(result.fileCount).toBe(1);
	});

	it("uses POSIX relative paths", () => {
		mkdirSync(join(tmpDir, "src", "deep"), { recursive: true });
		writeFileSync(join(tmpDir, "src", "deep", "a.ts"), "const x = 1;\n", "utf-8");

		const result = discoverFiles(tmpDir);
		expect(result.files["src/deep/a.ts"]).toBeDefined();
	});

	it("classifies test files", () => {
		writeFileSync(join(tmpDir, "src", "a.test.ts"), "it('works', () => {});\n", "utf-8");
		writeFileSync(join(tmpDir, "src", "a.spec.ts"), "it('works', () => {});\n", "utf-8");
		mkdirSync(join(tmpDir, "test"), { recursive: true });
		writeFileSync(join(tmpDir, "test", "b.ts"), "it('works', () => {});\n", "utf-8");

		const result = discoverFiles(tmpDir);
		expect(result.files["src/a.test.ts"]?.isTest).toBe(true);
		expect(result.files["src/a.spec.ts"]?.isTest).toBe(true);
		expect(result.files["test/b.ts"]?.isTest).toBe(true);
	});

	it("classifies config files", () => {
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
		writeFileSync(join(tmpDir, "tsconfig.json"), "{}", "utf-8");

		const result = discoverFiles(tmpDir);
		expect(result.files["package.json"]?.isConfig).toBe(true);
		expect(result.files["tsconfig.json"]?.isConfig).toBe(true);
	});

	it("detects source file count", () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		writeFileSync(join(tmpDir, "src", "a.test.ts"), "it('works', () => {});\n", "utf-8");
		writeFileSync(join(tmpDir, "README.md"), "# Readme\n", "utf-8");

		const result = discoverFiles(tmpDir);
		expect(result.sourceFileCount).toBeGreaterThanOrEqual(2); // .ts + .md
	});

	it("deterministic ordering", () => {
		writeFileSync(join(tmpDir, "b.ts"), "const b = 2;\n", "utf-8");
		writeFileSync(join(tmpDir, "a.ts"), "const a = 1;\n", "utf-8");
		writeFileSync(join(tmpDir, "c.ts"), "const c = 3;\n", "utf-8");

		const result1 = discoverFiles(tmpDir);
		const result2 = discoverFiles(tmpDir);

		expect(Object.keys(result1.files)).toEqual(Object.keys(result2.files));
	});
});

describe("classifyFile", () => {
	it("classifies .ts as source", () => {
		const cls = classifyFile("src/a.ts", ".ts");
		expect(cls.isSource).toBe(true);
		expect(cls.isTest).toBe(false);
	});

	it("classifies test files", () => {
		expect(classifyFile("src/a.test.ts", ".ts").isTest).toBe(true);
		expect(classifyFile("src/a.spec.ts", ".ts").isTest).toBe(true);
		expect(classifyFile("test/a.ts", ".ts").isTest).toBe(true);
	});

	it("classifies config files", () => {
		expect(classifyFile("package.json", ".json").isConfig).toBe(true);
		expect(classifyFile("tsconfig.json", ".json").isConfig).toBe(true);
		expect(classifyFile("vite.config.ts", ".ts").isConfig).toBe(true);
	});

	it("marks .env as ignored", () => {
		const cls = classifyFile(".env", "");
		expect(cls.isIgnored).toBe(true);
	});

	it("marks .env.local as ignored", () => {
		const cls = classifyFile(".env.local", "");
		expect(cls.isIgnored).toBe(true);
	});

	it("marks generated files", () => {
		const cls = classifyFile("src/models.generated.ts", ".ts");
		expect(cls.isGenerated).toBe(true);
	});
});
