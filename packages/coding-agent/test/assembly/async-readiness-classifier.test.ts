import { describe, expect, it } from "vitest";
import { classifyAsyncReadiness } from "../../src/core/assembly/async-readiness-classifier.js";
import { SemanticConflictAnalyzer } from "../../src/core/assembly/semantic-conflict-analyzer.js";

// =============================================================================
// Positive Path Tests
// =============================================================================

describe("AsyncReadinessClassifier — positive path", () => {
	it("no conflicts with 3 namespaces = ready", () => {
		const analyzer = new SemanticConflictAnalyzer();
		const matrix = analyzer.buildMatrix();
		const result = classifyAsyncReadiness(["ns-a", "ns-b", "ns-c"], matrix);
		expect(result.class).toBe("ready");
		expect(result.asyncAllowed).toBe(true);
		expect(result.blockingReasons).toHaveLength(0);
		expect(result.canBeParallel).toEqual(["ns-a", "ns-b", "ns-c"]);
		expect(result.suggestedMaxWorkers).toBeGreaterThanOrEqual(3);
	});

	it("low severity conflicts with risk <= 0.2 = ready", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register({
			id: "c1",
			namespaces: ["ns-a", "ns-b"],
			kind: "type_export_dependency",
			severity: "low",
			source: "types.ts",
			description: "shared type",
			staticDetection: true,
			resolved: false,
		});
		const matrix = analyzer.buildMatrix();
		const result = classifyAsyncReadiness(["ns-a", "ns-b"], matrix);
		expect(result.class).toBe("ready");
		expect(result.asyncAllowed).toBe(true);
	});

	it("medium severity conflicts with risk <= 0.5 = ready_with_caveats", () => {
		const analyzer = new SemanticConflictAnalyzer();
		for (let i = 0; i < 3; i++) {
			analyzer.register({
				id: `c${i}`,
				namespaces: ["ns-a", "ns-b"],
				kind: "function_signature_dependency",
				severity: "medium",
				source: "api.ts",
				description: "api shape",
				staticDetection: true,
				resolved: false,
			});
		}
		// 3 * 0.15 = 0.45
		const matrix = analyzer.buildMatrix();
		const result = classifyAsyncReadiness(["ns-a", "ns-b"], matrix);
		expect(result.class).toBe("ready_with_caveats");
		expect(result.asyncAllowed).toBe(true);
		expect(result.suggestedMaxWorkers).toBeLessThanOrEqual(6);
	});

	it("single namespace reports not_ready", () => {
		const analyzer = new SemanticConflictAnalyzer();
		const matrix = analyzer.buildMatrix();
		const result = classifyAsyncReadiness(["ns-a"], matrix);
		expect(result.class).toBe("not_ready");
		expect(result.asyncAllowed).toBe(false);
		expect(result.blockingReasons.some((r) => r.includes("at least 2"))).toBe(true);
	});

	it("per-namespace readiness details are complete", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register({
			id: "c1",
			namespaces: ["ns-a", "ns-b"],
			kind: "barrel_file_overlap",
			severity: "high",
			source: "index.ts",
			description: "barrel overlap",
			staticDetection: true,
			resolved: false,
		});
		const matrix = analyzer.buildMatrix();
		const result = classifyAsyncReadiness(["ns-a", "ns-b", "ns-c"], matrix);

		const nsA = result.namespaces.find((n) => n.namespace === "ns-a");
		expect(nsA).toBeDefined();
		expect(nsA!.ready).toBe(false);
		expect(nsA!.unresolvedConflicts).toBe(1);

		const nsC = result.namespaces.find((n) => n.namespace === "ns-c");
		expect(nsC!.ready).toBe(true);
		expect(nsC!.unresolvedConflicts).toBe(0);
	});

	it("zero namespaces returns not_ready", () => {
		const analyzer = new SemanticConflictAnalyzer();
		const matrix = analyzer.buildMatrix();
		const result = classifyAsyncReadiness([], matrix);
		expect(result.asyncAllowed).toBe(false);
	});
});

// =============================================================================
// Negative Path Tests
// =============================================================================

describe("AsyncReadinessClassifier — negative path", () => {
	it("high severity blocking conflict = not_ready", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register({
			id: "c1",
			namespaces: ["ns-a", "ns-b"],
			kind: "implicit_runtime_dependency",
			severity: "high",
			source: "runtime.ts",
			description: "runtime dep",
			staticDetection: true,
			resolved: false,
		});
		const matrix = analyzer.buildMatrix();
		const result = classifyAsyncReadiness(["ns-a", "ns-b", "ns-c"], matrix);
		expect(result.class).toBe("not_ready");
		expect(result.asyncAllowed).toBe(false);
		expect(result.blockingReasons.length).toBeGreaterThan(0);
		expect(result.mustBeSequential).toHaveLength(1);
		expect(result.mustBeSequential[0]).toEqual(["ns-a", "ns-b"]);
	});

	it("high risk score without blocking conflicts = not_ready", () => {
		const analyzer = new SemanticConflictAnalyzer();
		for (let i = 0; i < 6; i++) {
			analyzer.register({
				id: `c${i}`,
				namespaces: ["ns-a", "ns-b"],
				kind: "read_model_assumption",
				severity: "medium",
				source: "model.ts",
				description: "model",
				staticDetection: true,
				resolved: false,
			});
		}
		// 6*0.15 = 0.9 > 0.5
		const matrix = analyzer.buildMatrix();
		expect(matrix.asyncRiskScore).toBeGreaterThan(0.5);
		// hasBlockingConflicts requires high-severity unresolved, so it's false
		expect(matrix.hasBlockingConflicts).toBe(false);

		const result = classifyAsyncReadiness(["ns-a", "ns-b", "ns-c"], matrix);
		expect(result.class).toBe("not_ready");
		expect(result.asyncAllowed).toBe(false);
	});

	it("resolved conflicts don't block", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register({
			id: "c1",
			namespaces: ["ns-a", "ns-b"],
			kind: "api_shape_dependency",
			severity: "high",
			source: "api.ts",
			description: "api shape",
			staticDetection: true,
			resolved: false,
		});
		analyzer.resolve("c1");
		const matrix = analyzer.buildMatrix();
		const result = classifyAsyncReadiness(["ns-a", "ns-b"], matrix);
		expect(result.class).toBe("ready");
		expect(result.asyncAllowed).toBe(true);
	});

	it("blocking reasons reference specific namespaces", () => {
		const analyzer = new SemanticConflictAnalyzer();
		analyzer.register({
			id: "c1",
			namespaces: ["ns-a", "ns-b"],
			kind: "type_export_dependency",
			severity: "high",
			source: "types.ts",
			description: "types",
			staticDetection: true,
			resolved: false,
		});
		const matrix = analyzer.buildMatrix();
		const result = classifyAsyncReadiness(["ns-a", "ns-b", "ns-c"], matrix);
		expect(result.blockingReasons.some((r) => r.includes("ns-a"))).toBe(true);
		expect(result.blockingReasons.some((r) => r.includes("ns-b"))).toBe(true);
	});
});
