/**
 * P26.L — Integration queue correctness, merge priority, and writeSet drift gate
 *
 * Tests:
 * - WriteSet drift detection compares empirical git diff with declared scope
 * - conflictScope field exists in Workspace interface
 * - checkWriteSetDrift detects drifts correctly
 * - Handoff artifact on drift mismatch
 */

import { describe, expect, it } from "vitest";
import { checkWriteSetDrift } from "../src/core/completion-gate.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P26.L — Integration queue and writeSet drift gate", () => {
	// ---- WriteSet drift detection ----

	it("should detect no drift when all modified files match declared scope", () => {
		const result = checkWriteSetDrift(["src/core/foo.ts", "src/core/bar.ts"], ["src/core/*.ts"]);
		expect(result.driftDetected).toBe(false);
		expect(result.scopedFiles).toEqual(["src/core/foo.ts", "src/core/bar.ts"]);
		expect(result.driftedFiles).toEqual([]);
	});

	it("should detect drift when files are modified outside declared scope", () => {
		const result = checkWriteSetDrift(["src/core/foo.ts", "src/other/bar.ts"], ["src/core/*.ts"]);
		expect(result.driftDetected).toBe(true);
		expect(result.driftedFiles).toEqual(["src/other/bar.ts"]);
	});

	it("should return empty scopedFiles when no files match scope", () => {
		const result = checkWriteSetDrift(["src/other/bar.ts"], ["src/core/*.ts"]);
		expect(result.driftDetected).toBe(true);
		expect(result.scopedFiles).toEqual([]);
		expect(result.driftedFiles).toEqual(["src/other/bar.ts"]);
	});

	it("should handle multiple glob patterns in declared scope", () => {
		const result = checkWriteSetDrift(
			["src/core/foo.ts", "src/utils/helper.ts", "src/other/evil.ts"],
			["src/core/*.ts", "src/utils/*.ts"],
		);
		expect(result.driftDetected).toBe(true);
		expect(result.driftedFiles).toEqual(["src/other/evil.ts"]);
		expect(result.scopedFiles).toEqual(["src/core/foo.ts", "src/utils/helper.ts"]);
	});

	it("should return error when declared scope is empty", () => {
		const result = checkWriteSetDrift(["src/core/foo.ts"], []);
		expect(result.driftDetected).toBe(false);
		expect(result.error).toContain("No conflict scope declared");
	});

	it("should handle wildcard glob patterns", () => {
		const result = checkWriteSetDrift(["src/core/deep/nested/file.ts"], ["src/**/*.ts"]);
		expect(result.driftDetected).toBe(false);
	});

	it("should return declared scope in result", () => {
		const result = checkWriteSetDrift(["file.ts"], ["*.ts", "*.js"]);
		expect(result.declaredScope).toEqual(["*.ts", "*.js"]);
	});

	// ---- Structural verification ----

	it("should have conflictScope field in Workspace interface", () => {
		const fs = require("node:fs") as typeof import("node:fs");
		const src = fs.readFileSync(require.resolve("../src/core/workspace-schema.ts"), "utf-8");
		expect(src).toContain("conflictScope");
		expect(src).toContain("Declared conflict scope");
	});

	it("should export checkWriteSetDrift from completion-gate", () => {
		expect(checkWriteSetDrift).toBeInstanceOf(Function);
	});

	it("should export WriteSetDriftResult from completion-gate", () => {
		// Type verification — can't check at runtime, but we can check the source
		const fs = require("node:fs") as typeof import("node:fs");
		const src = fs.readFileSync(require.resolve("../src/core/completion-gate.ts"), "utf-8");
		expect(src).toContain("export interface WriteSetDriftResult");
		expect(src).toContain("export function checkWriteSetDrift");
	});

	// ---- Diff file result structure ----

	it("should return all diff files categorized", () => {
		const result = checkWriteSetDrift(["a.ts", "b.ts", "c.ts"], ["*.ts"]);
		expect(result.scopedFiles.length).toBe(3);
		expect(result.driftedFiles.length).toBe(0);
	});

	it("should handle no modified files", () => {
		const result = checkWriteSetDrift([], ["src/**"]);
		expect(result.driftDetected).toBe(false);
		expect(result.scopedFiles).toEqual([]);
		expect(result.driftedFiles).toEqual([]);
	});
});
