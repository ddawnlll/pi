/**
 * PlanSpec V5 Alpha2 Parser Tests
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePlanSpecV5Alpha2 } from "../../src/core/planspec-v5-alpha2-parser.js";

describe("PlanSpec V5 Alpha2 Parser", () => {
	const templatePath = join(
		process.cwd(),
		"../../PlanSpec_v5_alpha2_template_pack/01_planspec_v5_alpha2_template.example.json",
	);

	it("parses the alpha2 example template successfully", () => {
		const rawContent = readFileSync(templatePath, "utf-8");
		const result = parsePlanSpecV5Alpha2(rawContent);

		expect(result.valid).toBe(true);
		expect(result.errors.length).toBe(0);
		expect(result.spec).toBeDefined();
		expect(result.spec!.planSpecVersion).toBe("5.0.0-alpha2");
		expect(result.spec!.kind).toBe("ImplementationPlan");
	});

	it("validates metadata fields", () => {
		const rawContent = readFileSync(templatePath, "utf-8");
		const result = parsePlanSpecV5Alpha2(rawContent);

		expect(result.spec!.metadata.phaseId).toBeDefined();
		expect(result.spec!.metadata.title).toBeDefined();
		expect(result.spec!.metadata.status).toBeDefined();
	});

	it("validates waves array", () => {
		const rawContent = readFileSync(templatePath, "utf-8");
		const result = parsePlanSpecV5Alpha2(rawContent);

		expect(Array.isArray(result.spec!.waves)).toBe(true);
		expect(result.spec!.waves.length).toBeGreaterThan(0);
	});

	it("validates workspaces array", () => {
		const rawContent = readFileSync(templatePath, "utf-8");
		const result = parsePlanSpecV5Alpha2(rawContent);

		expect(Array.isArray(result.spec!.workspaces)).toBe(true);
		expect(result.spec!.workspaces.length).toBeGreaterThan(0);
	});

	it("rejects invalid JSON", () => {
		const result = parsePlanSpecV5Alpha2("{invalid json}");
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it("rejects wrong planSpecVersion", () => {
		const badSpec = JSON.stringify({
			planSpecVersion: "v5-rc1",
			kind: "ImplementationPlan",
		});
		const result = parsePlanSpecV5Alpha2(badSpec);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "$.planSpecVersion")).toBe(true);
	});

	it("rejects missing required fields", () => {
		const minimal = JSON.stringify({
			planSpecVersion: "5.0.0-alpha2",
			kind: "ImplementationPlan",
		});
		const result = parsePlanSpecV5Alpha2(minimal);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.code === "missing_field")).toBe(true);
	});

	it("detects duplicate wave IDs", () => {
		const dupWaves = JSON.stringify({
			planSpecVersion: "5.0.0-alpha2",
			kind: "ImplementationPlan",
			metadata: {
				phaseId: "P44",
				title: "Test",
				description: "Test",
				createdAt: "2024-01-01",
				updatedAt: "2024-01-01",
				owner: "test",
				status: "draft",
			},
			compatibility: {
				runtimeContractVersion: "1.0",
				runtimeTemplateVersion: "1.0",
				legacyTemplateCompatible: false,
			},
			intent: { goal: "test", successCriteria: [], outOfScope: [] },
			authority: {
				specification: "test",
				executionState: { mode: "strict", maxParallelWorkspaces: 1 },
				completion: {},
			},
			enforcementRegistry: { rules: [], policies: [] },
			security: {
				selfModificationFirewall: { enabled: true, protectedPaths: [] },
				dataExfiltrationGuard: { enabled: true },
				secretProtection: { enabled: true, maskInLogs: true },
			},
			waves: [
				{ id: "wave1", title: "W1", description: "", order: 1, tasks: [] },
				{ id: "wave1", title: "W1-dup", description: "", order: 2, tasks: [] },
			],
			workspaces: [{ id: "ws1", name: "WS1", rootDir: ".", canEdit: ["*"] }],
		});
		const result = parsePlanSpecV5Alpha2(dupWaves);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.code === "duplicate_id")).toBe(true);
	});
});
