import { describe, expect, it } from "vitest";
import {
	canRunParallel,
	type SemanticConflict,
	SemanticConflictAnalyzer,
} from "../../src/core/assembly/semantic-conflict-analyzer.js";

// =============================================================================
// Helpers
// =============================================================================

function makeConflict(overrides?: Partial<SemanticConflict>): SemanticConflict {
	return {
		id: `sc-${Math.random().toString(36).slice(2, 8)}`,
		namespaces: ["ns-a", "ns-b"],
		kind: "type_export_dependency",
		severity: "low",
		source: "src/shared/types.ts",
		description: "Shared type export between namespaces",
		staticDetection: true,
		resolved: false,
		...overrides,
	};
}

// =============================================================================
// Positive Path Tests
// =============================================================================

describe("SemanticConflictAnalyzer — positive path", () => {
	it("registers a single conflict", () => {
		const analyzer = new SemanticConflictAnalyzer();
		const result = analyzer.register(makeConflict({ id: "c1" }));
		expect(result.success).toBe(true);
	});

	it("registers multiple distinct conflicts", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register(makeConflict({ id: "c1", namespaces: ["ns-a", "ns-b"] }));
		analyzer.register(makeConflict({ id: "c2", namespaces: ["ns-b", "ns-c"] }));
		analyzer.register(makeConflict({ id: "c3", namespaces: ["ns-a", "ns-c"] }));

		const matrix = analyzer.buildMatrix();
		expect(matrix.totalConflicts).toBe(3);
	});

	it("buildMatrix computes correct counts", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register(makeConflict({ id: "c1", severity: "high" }));
		analyzer.register(makeConflict({ id: "c2", severity: "medium" }));
		analyzer.register(makeConflict({ id: "c3", severity: "low" }));

		const matrix = analyzer.buildMatrix();
		expect(matrix.totalConflicts).toBe(3);
		expect(matrix.bySeverity.high).toHaveLength(1);
		expect(matrix.bySeverity.medium).toHaveLength(1);
		expect(matrix.bySeverity.low).toHaveLength(1);
	});

	it("unresolved high severity conflicts set hasBlockingConflicts", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register(makeConflict({ id: "c1", severity: "high" }));

		const matrix = analyzer.buildMatrix();
		expect(matrix.hasBlockingConflicts).toBe(true);
	});

	it("resolved high severity conflicts do not block", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register(makeConflict({ id: "c1", severity: "high" }));
		analyzer.resolve("c1");

		const matrix = analyzer.buildMatrix();
		expect(matrix.hasBlockingConflicts).toBe(false);
	});

	it("no conflicts yields zero risk", () => {
		const analyzer = new SemanticConflictAnalyzer();
		const matrix = analyzer.buildMatrix();
		expect(matrix.asyncRiskScore).toBe(0);
		expect(matrix.hasBlockingConflicts).toBe(false);
	});

	it("getConflictsForNamespace filters correctly", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register(makeConflict({ id: "c1", namespaces: ["ns-a", "ns-b"] }));
		analyzer.register(makeConflict({ id: "c2", namespaces: ["ns-a", "ns-c"] }));
		analyzer.register(makeConflict({ id: "c3", namespaces: ["ns-b", "ns-c"] }));

		expect(analyzer.getConflictsForNamespace("ns-a")).toHaveLength(2);
		expect(analyzer.getConflictsForNamespace("ns-b")).toHaveLength(2);
		expect(analyzer.getConflictsForNamespace("ns-c")).toHaveLength(2);
		expect(analyzer.getConflictsForNamespace("ns-d")).toHaveLength(0);
	});

	it("getConflictsBetween filters for specific pair", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register(makeConflict({ id: "c1", namespaces: ["ns-a", "ns-b"] }));
		analyzer.register(makeConflict({ id: "c2", namespaces: ["ns-a", "ns-b"] }));
		analyzer.register(makeConflict({ id: "c3", namespaces: ["ns-b", "ns-c"] }));

		expect(analyzer.getConflictsBetween("ns-a", "ns-b")).toHaveLength(2);
		expect(analyzer.getConflictsBetween("ns-b", "ns-a")).toHaveLength(2); // symmetric
	});

	it("canRunParallel returns safe when no conflicts", () => {
		const analyzer = new SemanticConflictAnalyzer();
		const matrix = analyzer.buildMatrix();
		const result = canRunParallel(matrix, "ns-a", "ns-b");
		expect(result.safe).toBe(true);
	});

	it("canRunParallel blocks with high-severity conflict", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register(makeConflict({ id: "c1", namespaces: ["ns-a", "ns-b"], severity: "high" }));
		const matrix = analyzer.buildMatrix();
		const result = canRunParallel(matrix, "ns-a", "ns-b");
		expect(result.safe).toBe(false);
		expect(result.reason).toContain("high-severity");
	});

	it("canRunParallel blocks with >=3 medium-severity conflicts", () => {
		const analyzer = new SemanticConflictAnalyzer();
		for (let i = 0; i < 3; i++) {
			analyzer.register(makeConflict({ id: `c${i}`, namespaces: ["ns-a", "ns-b"], severity: "medium" }));
		}
		const matrix = analyzer.buildMatrix();
		const result = canRunParallel(matrix, "ns-a", "ns-b");
		expect(result.safe).toBe(false);
	});

	it("canRunParallel allows 2 medium-severity conflicts", () => {
		const analyzer = new SemanticConflictAnalyzer();
		for (let i = 0; i < 2; i++) {
			analyzer.register(makeConflict({ id: `c${i}`, namespaces: ["ns-a", "ns-b"], severity: "medium" }));
		}
		const matrix = analyzer.buildMatrix();
		const result = canRunParallel(matrix, "ns-a", "ns-b");
		expect(result.safe).toBe(true);
	});

	it("asyncRiskScore scales with severity counts", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register(makeConflict({ id: "c1", severity: "high" }));
		analyzer.register(makeConflict({ id: "c2", severity: "high" }));
		analyzer.register(makeConflict({ id: "c3", severity: "medium" }));

		const matrix = analyzer.buildMatrix();
		// 2*0.3 + 1*0.15 = 0.75
		expect(matrix.asyncRiskScore).toBe(0.75);
	});

	it("asyncRiskScore caps at 1.0", () => {
		const analyzer = new SemanticConflictAnalyzer();
		for (let i = 0; i < 10; i++) {
			analyzer.register(makeConflict({ id: `c${i}`, severity: "high" }));
		}
		const matrix = analyzer.buildMatrix();
		expect(matrix.asyncRiskScore).toBe(1.0);
	});
});

// =============================================================================
// Negative Path Tests
// =============================================================================

describe("SemanticConflictAnalyzer — negative path", () => {
	it("rejects duplicate conflict IDs", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register(makeConflict({ id: "c1" }));
		const result = analyzer.register(makeConflict({ id: "c1" }));
		expect(result.success).toBe(false);
		expect("reason" in result && result.reason).toContain("Duplicate");
	});

	it("batch register reports rejected duplicates", () => {
		const analyzer = new SemanticConflictAnalyzer();
		const result = analyzer.registerBatch([
			makeConflict({ id: "c1" }),
			makeConflict({ id: "c1" }),
			makeConflict({ id: "c2" }),
		]);
		expect(result.accepted).toBe(2);
		expect(result.rejected).toBe(1);
	});

	it("resolving non-existent conflict returns false", () => {
		const analyzer = new SemanticConflictAnalyzer();
		expect(analyzer.resolve("nonexistent")).toBe(false);
	});

	it("clear removes all conflicts", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register(makeConflict({ id: "c1" }));
		analyzer.register(makeConflict({ id: "c2" }));
		analyzer.clear();
		expect(analyzer.buildMatrix().totalConflicts).toBe(0);
	});

	it("resolved conflicts don't block parallel execution", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register(makeConflict({ id: "c1", namespaces: ["ns-a", "ns-b"], severity: "high" }));
		analyzer.resolve("c1");
		const matrix = analyzer.buildMatrix();
		const result = canRunParallel(matrix, "ns-a", "ns-b");
		expect(result.safe).toBe(true);
	});
});
