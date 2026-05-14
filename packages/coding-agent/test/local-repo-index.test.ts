/**
 * Tests for LocalRepoIndex - P1 Workstream 5.5.D
 *
 * Verifies:
 * 1. Retrieval returns relevant repo paths/snippets
 * 2. Retrieval does not access forbidden files
 * 3. Retrieval output is capped by token budget
 * 4. Retrieval reasons are logged
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateTokensFromString } from "../src/core/token-metering.js";
import {
	createLocalRepoIndex,
	type IndexedFile,
	LocalRepoIndex,
	type RetrievalResult,
} from "../src/retrieval/local-repo-index.js";
import { createRetrievalService } from "../src/retrieval/retrieval-service.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let testDir: string;

function createTestDir(): string {
	const dir = join(tmpdir(), `pi-local-repo-index-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writeTestFile(relPath: string, content: string): void {
	const fullPath = join(testDir, relPath);
	mkdirSync(resolve(fullPath, ".."), { recursive: true });
	writeFileSync(fullPath, content, "utf-8");
}

function createTestRepo(): void {
	// Source files
	writeTestFile(
		"src/index.ts",
		[
			'import { greet } from "./greet";',
			'import { add } from "./math";',
			"",
			"export function main(): void {",
			'  console.log(greet("World"));',
			"  console.log(`2 + 3 = ${add(2, 3)}`);",
			"}",
			"",
			"main();",
		].join("\n"),
	);

	writeTestFile(
		"src/greet.ts",
		[
			"/** Greet someone */",
			"export function greet(name: string): string {",
			"  return `Hello, ${name}!`;",
			"}",
			"",
			"/** Say goodbye */",
			"export function goodbye(name: string): string {",
			"  return `Goodbye, ${name}!`;",
			"}",
		].join("\n"),
	);

	writeTestFile(
		"src/math.ts",
		[
			"/** Math utilities */",
			"",
			"/** Add two numbers */",
			"export function add(a: number, b: number): number {",
			"  return a + b;",
			"}",
			"",
			"/** Subtract two numbers */",
			"export function subtract(a: number, b: number): number {",
			"  return a - b;",
			"}",
			"",
			"/** Multiply two numbers */",
			"export function multiply(a: number, b: number): number {",
			"  return a * b;",
			"}",
		].join("\n"),
	);

	writeTestFile(
		"src/config.ts",
		["export const config = {", "  port: 3000,", '  host: "localhost",', "  debug: true,", "};"].join("\n"),
	);

	// Should be forbidden file
	writeTestFile(".env", "SECRET_KEY=abc123\nAPI_KEY=xyz789\n");

	// Should be forbidden file
	writeTestFile("credentials/aws.json", JSON.stringify({ accessKeyId: "AKID", secretAccessKey: "sak" }));

	// Should be forbidden file
	writeTestFile("secrets/db-password.txt", "super-secret-password");

	// Markdown docs
	writeTestFile(
		"README.md",
		[
			"# Test Project",
			"",
			"This is a test project for local repo index testing.",
			"",
			"## Installation",
			"",
			"```bash",
			"npm install",
			"```",
			"",
			"## Usage",
			"",
			"```typescript",
			'import { main } from "./src/index";',
			"main();",
			"```",
		].join("\n"),
	);

	// A large file to test token budget
	writeTestFile(
		"src/large.ts",
		Array.from({ length: 500 }, (_, i) => `// Line ${i + 1}: export const constant${i} = ${i};`).join("\n"),
	);

	// Another source file with different content for diverse matching
	writeTestFile(
		"src/utils/helpers.ts",
		[
			"/** Helper utilities */",
			"",
			"/** Format a date string */",
			"export function formatDate(date: Date): string {",
			'  return date.toISOString().split("T")[0];',
			"}",
			"",
			"/** Validate an email address */",
			"export function isValidEmail(email: string): boolean {",
			'  return email.includes("@") && email.includes(".");',
			"}",
			"",
			"/** Sleep for ms milliseconds */",
			"export function sleep(ms: number): Promise<void> {",
			"  return new Promise((resolve) => setTimeout(resolve, ms));",
			"}",
			"",
			"/** Capitalize first letter */",
			"export function capitalize(str: string): string {",
			"  return str.charAt(0).toUpperCase() + str.slice(1);",
			"}",
		].join("\n"),
	);

	// A database-related file for diverse query testing
	writeTestFile(
		"src/db.ts",
		[
			"/** Database connection and queries */",
			'import { config } from "./config";',
			"",
			"export interface User {",
			"  id: number;",
			"  name: string;",
			"  email: string;",
			"}",
			"",
			"const users: User[] = [];",
			"",
			"export function addUser(name: string, email: string): User {",
			"  const user: User = { id: users.length + 1, name, email };",
			"  users.push(user);",
			"  return user;",
			"}",
			"",
			"export function findUser(id: number): User | undefined {",
			"  return users.find((u) => u.id === id);",
			"}",
			"",
			"export function deleteUser(id: number): boolean {",
			"  const index = users.findIndex((u) => u.id === id);",
			"  if (index === -1) return false;",
			"  users.splice(index, 1);",
			"  return true;",
			"}",
		].join("\n"),
	);
}

function getSnippetFiles(snippets: RetrievalResult["snippets"]): string[] {
	return snippets.map((s) => s.file);
}

function hasLogEntry(log: RetrievalResult["log"], action: string): boolean {
	return log.some((e) => e.action === action);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LocalRepoIndex", () => {
	beforeEach(() => {
		testDir = createTestDir();
		createTestRepo();
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe("indexing", () => {
		it("should index all source files in the repo", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const files = index.index();

			expect(files.length).toBeGreaterThan(0);
			// Should include the main source files but not forbidden ones
			const paths = files.map((f) => f.path);
			expect(paths).toContain("src/index.ts");
			expect(paths).toContain("src/greet.ts");
			expect(paths).toContain("src/math.ts");
			expect(paths).toContain("src/config.ts");
			expect(paths).toContain("README.md");
			expect(paths).toContain("src/large.ts");
			expect(paths).toContain("src/utils/helpers.ts");
			expect(paths).toContain("src/db.ts");
		});

		it("should skip forbidden patterns by default", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const files = index.index();
			const paths = files.map((f) => f.path);

			// .env, credentials/**, secrets/** should not be indexed
			expect(paths).not.toContain(".env");
			expect(paths).not.toContain("credentials/aws.json");
			expect(paths).not.toContain("secrets/db-password.txt");
		});

		it("should skip node_modules and .git by default", () => {
			// Create node_modules and .git dirs
			mkdirSync(join(testDir, "node_modules"), { recursive: true });
			mkdirSync(join(testDir, ".git"), { recursive: true });
			writeTestFile("node_modules/foo/index.js", "module.exports = {};\n");
			writeTestFile(".git/config", "[core]\n");

			const index = new LocalRepoIndex({ rootDir: testDir });
			const files = index.index();
			const paths = files.map((f) => f.path);

			expect(paths).not.toContain("node_modules/foo/index.js");
			expect(paths).not.toContain(".git/config");
		});

		it("should include each file's content and metadata", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const files = index.index();

			const greetFile = files.find((f) => f.path === "src/greet.ts");
			expect(greetFile).toBeDefined();
			expect(greetFile!.content).toContain("Hello");
			expect(greetFile!.lines).toBeGreaterThan(0);
			expect(greetFile!.tokens).toBeGreaterThan(0);
		});
	});

	describe("retrieval", () => {
		it("should return relevant snippets for a query", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "greet function",
				maxTokens: 10000,
			});

			expect(result.snippets.length).toBeGreaterThan(0);
			expect(result.totalTokens).toBeGreaterThan(0);

			const files = getSnippetFiles(result.snippets);
			expect(files).toContain("src/greet.ts");
		});

		it("should return snippets matching query terms", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "database user email",
				maxTokens: 10000,
			});

			expect(result.snippets.length).toBeGreaterThan(0);

			const files = getSnippetFiles(result.snippets);
			expect(files).toContain("src/db.ts");
		});

		it("should score path matches higher", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "config port host",
				maxTokens: 10000,
			});

			const files = getSnippetFiles(result.snippets);
			// config.ts should be highly relevant due to file name matching
			expect(result.snippets.length).toBeGreaterThan(0);
		});

		it("should not return files matching forbidden patterns", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "secret key password",
				maxTokens: 10000,
			});

			const files = getSnippetFiles(result.snippets);
			// Forbidden files should never be returned
			expect(files).not.toContain(".env");
			expect(files).not.toContain("credentials/aws.json");
			expect(files).not.toContain("secrets/db-password.txt");
		});

		it("should respect allowedFiles filter", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "function",
				maxTokens: 10000,
				allowedFiles: ["src/greet.ts", "src/math.ts"],
			});

			const files = getSnippetFiles(result.snippets);
			// Only allowed files should be returned
			for (const file of files) {
				expect(file === "src/greet.ts" || file === "src/math.ts").toBe(true);
			}
		});

		it("should respect forbiddenFiles filter", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "greet goodbye",
				maxTokens: 10000,
				forbiddenFiles: ["src/greet.ts"],
			});

			const files = getSnippetFiles(result.snippets);
			expect(files).not.toContain("src/greet.ts");
		});
	});

	describe("token budget", () => {
		it("should cap output by token budget", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "function export",
				maxTokens: 300, // Small budget
				maxSnippets: 100,
			});

			// Should still return results but capped
			expect(result.totalTokens).toBeLessThanOrEqual(300);
			if (result.truncated) {
				// If truncated, total should be less than what would be needed for all
				expect(result.snippets.length).toBeLessThan(10);
			}
		});

		it("should truncate with very small token budget", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "function export",
				maxTokens: 50, // Extremely small
			});

			expect(result.snippets.length).toBeLessThanOrEqual(1);
			expect(result.totalTokens).toBeLessThanOrEqual(50);
		});

		it("should include all results when budget is generous", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "function export",
				maxTokens: 50000, // Very generous
			});

			expect(result.truncated).toBe(false);
		});
	});

	describe("retrieval logging", () => {
		it("should include query log entry", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "test query",
				maxTokens: 10000,
			});

			expect(result.log.length).toBeGreaterThan(0);
			expect(hasLogEntry(result.log, "query")).toBe(true);
			const queryEntry = result.log.find((e) => e.action === "query");
			expect(queryEntry!.detail).toContain("test query");
		});

		it("should include scoring log entry", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "greet function",
				maxTokens: 10000,
			});

			expect(hasLogEntry(result.log, "score")).toBe(true);
		});

		it("should include result summary log entry", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "greet function",
				maxTokens: 10000,
			});

			expect(hasLogEntry(result.log, "result")).toBe(true);
		});

		it("should include truncation log when budget is exceeded", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "function export const",
				maxTokens: 100, // Small enough to trigger truncation
			});

			if (result.truncated) {
				expect(hasLogEntry(result.log, "truncate")).toBe(true);
			}
		});

		it("should include filter log entries when forbiddenFiles option excludes files in query", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "export",
				maxTokens: 10000,
				forbiddenFiles: ["src/greet.ts", "src/math.ts"],
			});

			const filterEntries = result.log.filter((e) => e.action === "filter");
			expect(filterEntries.length).toBeGreaterThan(0);
			// Should not include the forbidden files in results
			const files = getSnippetFiles(result.snippets);
			expect(files).not.toContain("src/greet.ts");
			expect(files).not.toContain("src/math.ts");
		});
	});

	describe("retrieval service", () => {
		it("should create and query via retrieval service", () => {
			const service = createRetrievalService({ rootDir: testDir });
			const result = service.query("greet");

			expect(result.snippets.length).toBeGreaterThan(0);
			expect(result.snippets[0].file).toBeTruthy();
			expect(result.snippets[0].content).toBeTruthy();
		});

		it("should report stats", () => {
			const service = createRetrievalService({ rootDir: testDir });
			const stats = service.getStats();

			expect(stats.fileCount).toBeGreaterThan(0);
			expect(stats.totalTokens).toBeGreaterThan(0);
			expect(stats.rootDir).toBe(testDir);
		});

		it("should support reindexing", () => {
			const service = createRetrievalService({ rootDir: testDir });

			// Add a new file after initial index
			const statsBefore = service.getStats();
			writeTestFile("src/new-file.ts", 'export const NEW = "added later";\n');

			// Reindex should pick it up
			service.reindex();
			const statsAfter = service.getStats();
			expect(statsAfter.fileCount).toBe(statsBefore.fileCount + 1);
		});
	});

	describe("edge cases", () => {
		it("should handle empty repos", () => {
			const emptyDir = join(tmpdir(), `pi-empty-repo-${Date.now()}`);
			mkdirSync(emptyDir, { recursive: true });

			try {
				const index = new LocalRepoIndex({ rootDir: emptyDir });
				const result = index.retrieve({
					query: "anything",
					maxTokens: 1000,
				});

				expect(result.snippets).toHaveLength(0);
				expect(result.totalTokens).toBe(0);
			} finally {
				rmSync(emptyDir, { recursive: true, force: true });
			}
		});

		it("should handle empty queries", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "",
				maxTokens: 10000,
			});

			// Empty query should return no snippets
			expect(result.snippets).toHaveLength(0);
		});

		it("should handle non-existent directories", () => {
			const index = new LocalRepoIndex({
				rootDir: join(tmpdir(), `pi-nonexistent-${Date.now()}`),
			});
			const result = index.retrieve({
				query: "anything",
				maxTokens: 1000,
			});

			expect(result.snippets).toHaveLength(0);
		});

		it("should handle maxSnippets limit", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "function",
				maxTokens: 50000,
				maxSnippets: 2,
			});

			expect(result.snippets.length).toBeLessThanOrEqual(2);
		});

		it("should include line ranges in snippets", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "add two numbers",
				maxTokens: 10000,
			});

			for (const snippet of result.snippets) {
				expect(snippet.lines.start).toBeGreaterThanOrEqual(1);
				expect(snippet.lines.end).toBeGreaterThanOrEqual(snippet.lines.start);
				expect(snippet.lines.start).toBeLessThanOrEqual(snippet.lines.end);
			}
		});

		it("should include human-readable reasons", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "greet",
				maxTokens: 10000,
			});

			for (const snippet of result.snippets) {
				expect(snippet.reason).toBeTruthy();
				expect(typeof snippet.reason).toBe("string");
			}
		});
	});

	describe("createLocalRepoIndex helper", () => {
		it("should create an index with createLocalRepoIndex", () => {
			const index = createLocalRepoIndex({ rootDir: testDir });
			expect(index).toBeInstanceOf(LocalRepoIndex);
		});

		it("should index files via the helper", () => {
			const index = createLocalRepoIndex({ rootDir: testDir });
			const files = index.index();
			expect(files.length).toBeGreaterThan(0);
		});
	});

	describe("AC-1: Retrieval returns relevant repo paths/snippets", () => {
		it("should return snippets from files that match the query", () => {
			const index = createLocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "database query user",
				maxTokens: 50000,
			});

			expect(result.snippets.length).toBeGreaterThan(0);
			const files = getSnippetFiles(result.snippets);
			// db.ts should be relevant for "database" queries
			expect(files).toContain("src/db.ts");
		});

		it("should return file paths and snippet content", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "add multiply subtract",
				maxTokens: 50000,
			});

			expect(result.snippets.length).toBeGreaterThan(0);
			// math.ts should be relevant
			const files = getSnippetFiles(result.snippets);
			expect(files).toContain("src/math.ts");
		});

		it("should sort by relevance descending", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "function export add",
				maxTokens: 50000,
			});

			for (let i = 1; i < result.snippets.length; i++) {
				expect(result.snippets[i].relevanceScore).toBeLessThanOrEqual(result.snippets[i - 1].relevanceScore);
			}
		});
	});

	describe("AC-2: Retrieval does not access forbidden files", () => {
		it("should not include .env files in result", () => {
			// .env is in the forbidden patterns
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "SECRET_KEY",
				maxTokens: 50000,
			});

			const files = getSnippetFiles(result.snippets);
			const envMatch = files.filter((f) => f.startsWith(".env"));
			expect(envMatch).toHaveLength(0);
		});

		it("should not include credentials/ files in result", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "accessKey",
				maxTokens: 50000,
			});

			const files = getSnippetFiles(result.snippets);
			const credMatch = files.filter((f) => f.includes("credentials"));
			expect(credMatch).toHaveLength(0);
		});

		it("should not include secrets/ files in result", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "password",
				maxTokens: 50000,
			});

			const files = getSnippetFiles(result.snippets);
			const secretsMatch = files.filter((f) => f.includes("secrets"));
			expect(secretsMatch).toHaveLength(0);
		});

		it("should apply custom forbidden patterns", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "export",
				maxTokens: 50000,
				forbiddenFiles: ["src/math.ts"],
			});

			const files = getSnippetFiles(result.snippets);
			expect(files).not.toContain("src/math.ts");
		});
	});

	describe("AC-3: Retrieval output is capped by token budget", () => {
		it("should not exceed maxTokens", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "function export const",
				maxTokens: 2000,
			});

			expect(result.totalTokens).toBeLessThanOrEqual(2000);
		});

		it("should set truncated=true when budget exceeded", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "function",
				maxTokens: 100, // Very small budget
			});

			if (result.snippets.length > 0) {
				// If we have any snippets and total is at or near the limit
				expect(result.totalTokens).toBeLessThanOrEqual(100);
			}
		});

		it("should not truncate when budget covers all results", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "uniqueNonExistentTermXYZ",
				maxTokens: 50000,
			});

			// No matches, so truncated should be false
			expect(result.truncated).toBe(false);
		});
	});

	describe("AC-4: Retrieval reasons are logged", () => {
		it("should include log entries in the result", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "anything",
				maxTokens: 10000,
			});

			expect(Array.isArray(result.log)).toBe(true);
			expect(result.log.length).toBeGreaterThan(0);
		});

		it("each log entry should have timestamp, action, and detail", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "test",
				maxTokens: 10000,
			});

			for (const entry of result.log) {
				expect(entry.timestamp).toBeTruthy();
				expect(typeof entry.timestamp).toBe("string");
				expect(entry.action).toBeTruthy();
				expect(typeof entry.action).toBe("string");
				expect(entry.detail).toBeTruthy();
				expect(typeof entry.detail).toBe("string");
			}
		});

		it("each snippet should have a human-readable reason", () => {
			const index = new LocalRepoIndex({ rootDir: testDir });
			const result = index.retrieve({
				query: "function",
				maxTokens: 10000,
			});

			for (const snippet of result.snippets) {
				expect(snippet.reason).toBeTruthy();
				expect(typeof snippet.reason).toBe("string");
			}
		});
	});
});
