/**
 * ACCP v2.0 Package Reference Tests
 *
 * Verifies that the typed path constants are correct and that the referenced
 * package directory exists on disk. These are contract-level tests ensuring
 * the intake module accurately reflects the filesystem layout.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ACCP_V2_PACKAGE_DESCRIPTION,
	ACCP_V2_PACKAGE_DOCS,
	ACCP_V2_PACKAGE_EXAMPLES,
	ACCP_V2_PACKAGE_PATHS,
	ACCP_V2_PACKAGE_PROMPTS,
	ACCP_V2_PACKAGE_README,
	ACCP_V2_PACKAGE_REGISTRY,
	ACCP_V2_PACKAGE_ROOT,
	ACCP_V2_PACKAGE_SCHEMAS,
} from "../src/accp-package-reference.js";

describe("ACCP v2.0 Package Reference", () => {
	// Resolve from repo root: packages/execution-contracts/test/ -> ../../../
	const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
	const resolveRoot = (p: string) => resolve(repoRoot, p);

	// ---------------------------------------------------------------------------
	// Positive tests — constants match filesystem layout
	// ---------------------------------------------------------------------------

	it("should expose the correct package root", () => {
		expect(ACCP_V2_PACKAGE_ROOT).toBe("accp_v2_0_package");
	});

	it("should reference a package root that exists on disk", () => {
		expect(existsSync(resolveRoot(ACCP_V2_PACKAGE_ROOT))).toBe(true);
	});

	it("should reference subdirectories with correct relative paths", () => {
		expect(ACCP_V2_PACKAGE_DOCS).toBe("accp_v2_0_package/docs");
		expect(ACCP_V2_PACKAGE_EXAMPLES).toBe("accp_v2_0_package/examples");
		expect(ACCP_V2_PACKAGE_PROMPTS).toBe("accp_v2_0_package/prompts");
		expect(ACCP_V2_PACKAGE_REGISTRY).toBe("accp_v2_0_package/registry");
		expect(ACCP_V2_PACKAGE_SCHEMAS).toBe("accp_v2_0_package/schemas");
	});

	it("should reference a README path", () => {
		expect(ACCP_V2_PACKAGE_README).toBe("accp_v2_0_package/README.md");
		expect(existsSync(resolveRoot(ACCP_V2_PACKAGE_README))).toBe(true);
	});

	it("should include all expected paths in the array", () => {
		expect(ACCP_V2_PACKAGE_PATHS).toContain(ACCP_V2_PACKAGE_ROOT);
		expect(ACCP_V2_PACKAGE_PATHS).toContain(ACCP_V2_PACKAGE_DOCS);
		expect(ACCP_V2_PACKAGE_PATHS).toContain(ACCP_V2_PACKAGE_EXAMPLES);
		expect(ACCP_V2_PACKAGE_PATHS).toContain(ACCP_V2_PACKAGE_PROMPTS);
		expect(ACCP_V2_PACKAGE_PATHS).toContain(ACCP_V2_PACKAGE_REGISTRY);
		expect(ACCP_V2_PACKAGE_PATHS).toContain(ACCP_V2_PACKAGE_SCHEMAS);
		expect(ACCP_V2_PACKAGE_PATHS).toContain(ACCP_V2_PACKAGE_README);
	});

	it("should expose a human-readable description", () => {
		expect(ACCP_V2_PACKAGE_DESCRIPTION).toMatch(/design-time.*fixture/i);
	});

	// ---------------------------------------------------------------------------
	// Negative tests — the package is read-only in P49
	// ---------------------------------------------------------------------------

	it("should not point to a directory under packages/ (design-time package is at repo root)", () => {
		expect(ACCP_V2_PACKAGE_ROOT).not.toMatch(/^packages\//);
		// All sub-paths share the root
		for (const p of ACCP_V2_PACKAGE_PATHS) {
			expect(p).not.toMatch(/^packages\//);
		}
	});

	it("should not contain a trailing slash on any path (consistency)", () => {
		for (const p of ACCP_V2_PACKAGE_PATHS) {
			expect(p).not.toMatch(/\/$/);
		}
	});

	it("should expose exactly 7 paths (6 subs + README)", () => {
		expect(ACCP_V2_PACKAGE_PATHS.length).toBe(7);
	});
});
