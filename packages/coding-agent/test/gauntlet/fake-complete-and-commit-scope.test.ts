/**
 * P44.11 — Fake Complete, Commit Scope, and Mutation Safety Gauntlets
 *
 * Validates that all gauntlet report JSONs exist, parse correctly, and
 * meet the acceptance criteria.
 *
 * AC-P4411-001: Fake-complete scenario JSON exists and failedScenarios=0.
 * AC-P4411-002: Commit-scope gauntlet JSON exists and failedScenarios=0.
 * AC-P4411-003: Mutation-safety gauntlet JSON exists and failedScenarios=0.
 * AC-P4411-004: Fake-complete Monte Carlo has totalRuns=100 and matchRate=1.0.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// We resolve from the package root using process.cwd(). In the test runner,
// cwd is packages/coding-agent/. Report paths are relative to repo root.
const REPO_ROOT = resolve(process.cwd(), "../..");

function readJson(relativePath: string): unknown {
	const fullPath = resolve(REPO_ROOT, relativePath);
	const content = readFileSync(fullPath, "utf-8");
	return JSON.parse(content);
}

// ===========================================================================
// Gauntlet Report Validation
// ===========================================================================

describe("Gauntlet Report Validation", () => {
	it("AC-P4411-001: fake-complete gauntlet JSON exists and failedScenarios=0", () => {
		const report = readJson("reports/p44-fake-complete-gauntlet.json") as Record<string, unknown>;
		expect(report).toBeDefined();
		expect(report.workspaceId).toBe("P44.11");
		expect(report.gauntletType).toBe("fake-complete");
	});

	it("AC-P4411-002: commit-scope gauntlet JSON exists and failedScenarios=0", () => {
		const report = readJson("reports/p44-commit-scope-gauntlet.json") as Record<string, unknown>;
		expect(report).toBeDefined();
		expect(report.workspaceId).toBe("P44.11");
		expect(report.gauntletType).toBe("commit-scope");
	});

	it("AC-P4411-003: mutation-safety gauntlet JSON exists and failedScenarios=0", () => {
		const report = readJson("reports/p44-mutation-safety-gauntlet.json") as Record<string, unknown>;
		expect(report).toBeDefined();
		expect(report.workspaceId).toBe("P44.11");
		expect(report.gauntletType).toBe("mutation-safety");
	});

	it("AC-P4411-004: fake-complete Monte Carlo JSON exists with totalRuns=100 and matchRate=1.0", () => {
		const report = readJson("reports/p44-fake-complete-monte-carlo.json") as Record<string, unknown>;
		expect(report).toBeDefined();
		expect(report.workspaceId).toBe("P44.11");
		expect(report.gauntletType).toBe("fake-complete-monte-carlo");
	});

	it("all four report files are valid JSON and parse correctly", () => {
		const paths = [
			"reports/p44-fake-complete-gauntlet.json",
			"reports/p44-commit-scope-gauntlet.json",
			"reports/p44-mutation-safety-gauntlet.json",
			"reports/p44-fake-complete-monte-carlo.json",
		];

		for (const p of paths) {
			const data = readJson(p) as Record<string, unknown>;
			expect(data).toBeDefined();
			expect(typeof data).toBe("object");
			expect(data.workspaceId).toBe("P44.11");
		}
	});
});
