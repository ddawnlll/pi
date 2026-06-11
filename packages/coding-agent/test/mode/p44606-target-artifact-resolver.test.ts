import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	checkOverwriteSafety,
	LARGE_FILE_THRESHOLD_BYTES,
	resolveTarget,
	resolveTargets,
} from "../../src/core/mode/target-artifact-resolver.js";

const testDir = join(tmpdir(), "p44606-test-" + Date.now());

function createTestFile(relativePath: string, size: number) {
	const fullPath = join(testDir, relativePath);
	const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(fullPath, "x".repeat(size));
	return fullPath;
}

describe("resolveTarget", () => {
	beforeAll(() => {
		if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
		createTestFile("existing.ts", 100);
		createTestFile("large.ts", LARGE_FILE_THRESHOLD_BYTES + 1);
	});

	afterAll(() => {
		try {
			unlinkSync(join(testDir, "existing.ts"));
		} catch {}
		try {
			unlinkSync(join(testDir, "large.ts"));
		} catch {}
		try {
			unlinkSync(testDir);
		} catch {}
	});

	it("resolves an existing file", () => {
		const result = resolveTarget(join(testDir, "existing.ts"));
		expect(result.existence).toBe("exists");
		expect(result.fileSizeBytes).toBe(100);
	});

	it("resolves a non-existing file", () => {
		const result = resolveTarget(join(testDir, "nonexistent.ts"));
		expect(result.existence).toBe("not_found");
	});

	it("flags large files as unsafe overwrite", () => {
		const result = resolveTarget(join(testDir, "large.ts"));
		expect(result.overwriteSafety).toBe("unsafe_large");
		expect(result.diagnostics.length).toBeGreaterThan(0);
	});
});

describe("resolveTargets", () => {
	it("returns empty for empty input", () => {
		const result = resolveTargets([]);
		expect(result.resolutions).toHaveLength(0);
	});

	it("resolves multiple targets", () => {
		createTestFile("a.ts", 10);
		createTestFile("b.ts", 10);
		const result = resolveTargets([join(testDir, "a.ts"), join(testDir, "b.ts")]);
		expect(result.resolutions).toHaveLength(2);
		expect(result.resolutions[0].isMultiFile).toBe(true);
	});
});

describe("checkOverwriteSafety", () => {
	it("returns blocking diagnostic when fail_if_exists and target exists", () => {
		createTestFile("overwrite-test.ts", 10);
		const diags = checkOverwriteSafety(join(testDir, "overwrite-test.ts"), "fail_if_exists");
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].severity).toBe("blocking");
	});
});
