/**
 * Forbidden patterns unit tests.
 *
 * Tests for the forbidden file pattern blocking logic used
 * during memory ingestion. Covers:
 * - Provenance: patterns correctly match expected paths
 * - Forbidden-source exclusion: sensitive paths are blocked
 * - Warnings vs hard blocks
 * - Custom patterns
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { checkForbiddenPatterns, type ForbiddenPattern, filterForbiddenPaths } from "../src/forbidden-patterns.js";

describe("checkForbiddenPatterns", () => {
	// -----------------------------------------------------------------------
	// Blocked patterns
	// -----------------------------------------------------------------------

	it("blocks .env files", () => {
		const result = checkForbiddenPatterns(".env");
		assert.strictEqual(result.blocked, true);
		assert.strictEqual(result.warning, false);
	});

	it("blocks .env.local files", () => {
		const result = checkForbiddenPatterns(".env.local");
		assert.strictEqual(result.blocked, true);
	});

	it("blocks node_modules paths", () => {
		const result = checkForbiddenPatterns("node_modules/foo/bar.js");
		assert.strictEqual(result.blocked, true);
	});

	it("blocks nested node_modules", () => {
		const result = checkForbiddenPatterns("packages/db/node_modules/kysely/index.js");
		assert.strictEqual(result.blocked, true);
	});

	it("blocks dist directory", () => {
		const result = checkForbiddenPatterns("dist/index.js");
		assert.strictEqual(result.blocked, true);
	});

	it("blocks nested dist directory", () => {
		const result = checkForbiddenPatterns("packages/db/dist/index.js");
		assert.strictEqual(result.blocked, true);
	});

	it("blocks .git internals", () => {
		const result = checkForbiddenPatterns(".git/HEAD");
		assert.strictEqual(result.blocked, true);
	});

	it("blocks private key files", () => {
		const result = checkForbiddenPatterns("keys/private.pem");
		assert.strictEqual(result.blocked, true);
	});

	it("blocks binary image files", () => {
		const result = checkForbiddenPatterns("assets/logo.png");
		assert.strictEqual(result.blocked, true);
	});

	it("blocks package-lock.json", () => {
		const result = checkForbiddenPatterns("package-lock.json");
		assert.strictEqual(result.blocked, true);
	});

	it("blocks coverage reports", () => {
		const result = checkForbiddenPatterns("coverage/index.html");
		assert.strictEqual(result.blocked, true);
	});

	it("blocks source map files", () => {
		const result = checkForbiddenPatterns("dist/bundle.js.map");
		assert.strictEqual(result.blocked, true);
	});

	// -----------------------------------------------------------------------
	// Warning patterns (not hard-blocked)
	// -----------------------------------------------------------------------

	it("warns on SVG files but does not block", () => {
		const result = checkForbiddenPatterns("assets/icon.svg");
		assert.strictEqual(result.blocked, false);
		assert.strictEqual(result.warning, true);
	});

	it("warns on .vscode settings", () => {
		const result = checkForbiddenPatterns(".vscode/settings.json");
		assert.strictEqual(result.blocked, false);
		assert.strictEqual(result.warning, true);
	});

	// -----------------------------------------------------------------------
	// Allowed patterns (no match)
	// -----------------------------------------------------------------------

	it("allows source code files", () => {
		const result = checkForbiddenPatterns("src/index.ts");
		assert.strictEqual(result.blocked, false);
		assert.strictEqual(result.warning, false);
	});

	it("allows README.md", () => {
		const result = checkForbiddenPatterns("README.md");
		assert.strictEqual(result.blocked, false);
	});

	it("allows deeply nested source files", () => {
		const result = checkForbiddenPatterns("packages/db/src/repositories/memory-vector.ts");
		assert.strictEqual(result.blocked, false);
	});

	it("allows test files", () => {
		const result = checkForbiddenPatterns("packages/db/test/forbidden-patterns.test.ts");
		assert.strictEqual(result.blocked, false);
	});

	// -----------------------------------------------------------------------
	// Custom patterns
	// -----------------------------------------------------------------------

	it("supports custom pattern overrides", () => {
		const customPatterns: ForbiddenPattern[] = [
			{ pattern: "**/*.secret", reason: "Custom secret extension", severity: "block" },
		];

		const result = checkForbiddenPatterns("data.secret", customPatterns);
		assert.strictEqual(result.blocked, true);
		assert.strictEqual(result.matchingPattern?.reason, "Custom secret extension");
	});

	it("does not block files when custom patterns don't match", () => {
		const customPatterns: ForbiddenPattern[] = [
			{ pattern: "**/*.secret", reason: "Custom secret extension", severity: "block" },
		];

		const result = checkForbiddenPatterns("normal-file.ts", customPatterns);
		assert.strictEqual(result.blocked, false);
	});
});

describe("filterForbiddenPaths", () => {
	const testPaths = [
		"src/index.ts",
		".env",
		"README.md",
		"node_modules/foo/index.js",
		"assets/icon.svg",
		"packages/db/src/repositories/memory-vector.ts",
	];

	it("filters out blocked paths and warns on warned paths", () => {
		const result = filterForbiddenPaths(testPaths);

		assert.ok(result.allowed.includes("src/index.ts"));
		assert.ok(result.allowed.includes("README.md"));
		assert.ok(result.allowed.includes("packages/db/src/repositories/memory-vector.ts"));

		// SVG is allowed but warned
		assert.ok(result.allowed.includes("assets/icon.svg"));
		assert.ok(result.warned.some((w) => w.path === "assets/icon.svg"));

		// Blocked paths
		assert.ok(result.blocked.some((b) => b.path === ".env"));
		assert.ok(result.blocked.some((b) => b.path === "node_modules/foo/index.js"));
	});

	it("returns empty blocked/warned when all paths are clean", () => {
		const result = filterForbiddenPaths(["src/index.ts", "README.md"]);
		assert.strictEqual(result.allowed.length, 2);
		assert.strictEqual(result.blocked.length, 0);
		assert.strictEqual(result.warned.length, 0);
	});
});
