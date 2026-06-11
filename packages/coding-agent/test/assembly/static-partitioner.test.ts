import { describe, expect, it } from "vitest";
import { buildOwnershipManifest, canEditFile } from "../../src/core/assembly/ownership-manifest.js";
import { estimatePartitionCosts } from "../../src/core/assembly/partition-cost-model.js";
import type { PredictiveSpec } from "../../src/core/assembly/predictive-spec-input.js";
import { computePartitionCost, partitionNamespaces } from "../../src/core/assembly/static-partitioner.js";

// =============================================================================
// Helpers
// =============================================================================

function makeSpec(overrides?: Partial<PredictiveSpec>): PredictiveSpec {
	return {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		factBundleHash: "fake",
		namespaces: [
			{ namespace: "ns-0", files: ["a.ts", "b.ts"], contracts: [] },
			{ namespace: "ns-1", files: ["c.ts", "d.ts"], contracts: [] },
			{ namespace: "ns-2", files: ["e.ts"], contracts: [] },
		],
		sharedIntegrationFiles: ["index.ts"],
		assemblerOnlyFiles: ["assembly.ts"],
		contractPredictions: [],
		coverageBreakdown: { staticCount: 0, humanCount: 0, historicalCount: 0, llmOnlyCount: 0, unknownCount: 0 },
		...overrides,
	};
}

// =============================================================================
// Static Partitioner Tests
// =============================================================================

describe("StaticPartitioner", () => {
	it("partitions disjoint namespaces successfully", () => {
		const spec = makeSpec();
		const result = partitionNamespaces(spec);
		expect(result.success).toBe(true);
		expect(result.namespaces).toHaveLength(3);
	});

	it("detects overlapping namespace assignments", () => {
		const spec = makeSpec({
			namespaces: [
				{ namespace: "ns-0", files: ["a.ts", "b.ts"], contracts: [] },
				{ namespace: "ns-1", files: ["b.ts", "c.ts"], contracts: [] },
			],
		});
		const result = partitionNamespaces(spec);
		expect(result.success).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0]).toContain("overlap");
	});

	it("computes cost model for valid partition", () => {
		const spec = makeSpec();
		const result = partitionNamespaces(spec);
		const cost = computePartitionCost(result);
		expect(cost.totalFiles).toBe(5);
		expect(cost.namespaceCount).toBe(3);
		expect(cost.largestNamespaceSize).toBe(2);
	});
});

// =============================================================================
// Ownership Manifest Tests
// =============================================================================

describe("OwnershipManifest", () => {
	it("builds manifest from namespaces", () => {
		const spec = makeSpec();
		const manifest = buildOwnershipManifest(spec.namespaces, spec.sharedIntegrationFiles, spec.assemblerOnlyFiles);
		expect(manifest.entries.length).toBeGreaterThanOrEqual(5);
	});

	it("worker can edit its own files", () => {
		const spec = makeSpec();
		const manifest = buildOwnershipManifest(spec.namespaces, spec.sharedIntegrationFiles, spec.assemblerOnlyFiles);
		const result = canEditFile(manifest, "a.ts", "ns-0");
		expect(result.allowed).toBe(true);
	});

	it("worker cannot edit another namespace's files", () => {
		const spec = makeSpec();
		const manifest = buildOwnershipManifest(spec.namespaces, spec.sharedIntegrationFiles, spec.assemblerOnlyFiles);
		const result = canEditFile(manifest, "a.ts", "ns-1");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("belongs to namespace");
	});

	it("no one can edit assembler-only files", () => {
		const spec = makeSpec({ assemblerOnlyFiles: ["a.ts"] });
		const manifest = buildOwnershipManifest(spec.namespaces, spec.sharedIntegrationFiles, spec.assemblerOnlyFiles);
		const result = canEditFile(manifest, "a.ts", "ns-0");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("assembler-only");
	});
});

// =============================================================================
// Partition Cost Model Tests
// =============================================================================

describe("PartitionCostModel", () => {
	it("estimates costs for valid partition", () => {
		const spec = makeSpec();
		const result = partitionNamespaces(spec);
		const model = estimatePartitionCosts(result);
		expect(model.costs).toHaveLength(3);
		expect(model.totalReplayCost).toBeGreaterThan(0);
	});
});
