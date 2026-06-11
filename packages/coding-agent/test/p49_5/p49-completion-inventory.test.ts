import path from "node:path";
import { describe, expect, it } from "vitest";
import type { P49ArtifactInventory } from "../../src/core/p49_5/p49-completion-inventory.js";
import { buildP49ArtifactInventory, isP49Ready } from "../../src/core/p49_5/p49-completion-inventory.js";

// Repo root is 2 levels up from packages/coding-agent
const repoRoot = path.resolve(process.cwd(), "../..");

describe("P49CompletionInventory", () => {
	it("builds inventory from repo root", async () => {
		const inventory = await buildP49ArtifactInventory(repoRoot);
		expect(inventory.schemaVersion).toBe("1.0.0");
		expect(inventory.summary.total).toBeGreaterThan(0);
		// At minimum, the ACCP compiler index should exist
		const accpEntry = inventory.artifacts.accpCompilerIndex;
		expect(accpEntry).toBeDefined();
	});

	it("isP49Ready returns true when all critical artifacts exist", () => {
		const inventory: P49ArtifactInventory = {
			schemaVersion: "1.0.0",
			generatedAt: new Date().toISOString(),
			repoRoot: "/test",
			artifacts: {
				accpCompilerIndex: { path: "ok", exists: true },
				accpRouteCompiler: { path: "ok", exists: true },
				accpGateStageRunner: { path: "ok", exists: true },
				accpArtifactStore: { path: "ok", exists: true },
				accpPromptRenderer: { path: "ok", exists: true },
				accpRouteBus: { path: "ok", exists: true },
				accpReportValidator: { path: "ok", exists: true },
				completionGateV2: { path: "ok", exists: true },
				evidenceLedger: { path: "ok", exists: true },
				acceptanceCriteria: { path: "ok", exists: true },
			},
			summary: { total: 10, existing: 10, missing: 0 },
		};
		expect(isP49Ready(inventory)).toBe(true);
	});

	it("isP49Ready returns false when critical artifact is missing", () => {
		const inventory: P49ArtifactInventory = {
			schemaVersion: "1.0.0",
			generatedAt: new Date().toISOString(),
			repoRoot: "/test",
			artifacts: {
				accpCompilerIndex: { path: "missing", exists: false },
				accpRouteCompiler: { path: "ok", exists: true },
				accpGateStageRunner: { path: "ok", exists: true },
			},
			summary: { total: 3, existing: 2, missing: 1 },
		};
		expect(isP49Ready(inventory)).toBe(false);
	});
});
