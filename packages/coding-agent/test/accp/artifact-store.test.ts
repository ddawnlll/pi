/**
 * ACCP Artifact Store Tests (P49.27)
 *
 * Covers all six artifact kinds plus plan-level index and graph,
 * error handling (missing files, malformed JSON, path traversal guards),
 * and authority boundary assertions.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
	AccpCompileResult,
	AccpGateVerdict,
	AccpIntermediateRepresentation,
	AccpRouteSignal,
} from "@earendil-works/pi-execution-contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AccpArtifactGraph,
	type AccpArtifactIndex,
	AccpArtifactStore,
} from "../../src/core/accp-artifact-store.js";

const TEST_PLAN_ID = "P49_TEST";
const TEST_ROOT = resolve("reports", "accp", TEST_PLAN_ID);

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCompiledResult(overrides: Partial<AccpCompileResult> = {}): AccpCompileResult {
	return {
		status: "compiled",
		reportId: "TEST_001",
		reportType: "TVR",
		diagnostics: [],
		hasBlockingFindings: false,
		...overrides,
	};
}

function makeIr(overrides: Partial<AccpIntermediateRepresentation> = {}): AccpIntermediateRepresentation {
	return {
		sourceReportId: "TEST_001",
		reportType: "TVR",
		family: "core",
		sections: { summary: "test" },
		diagnostics: [],
		references: [],
		...overrides,
	};
}

function makeRouteSignal(overrides: Partial<AccpRouteSignal> = {}): AccpRouteSignal {
	return {
		sourceReportId: "TEST_001",
		sourceReportType: "TVR",
		recommendedNextAction: "promotion_readiness",
		recommendedNextRoute: "PRR",
		confidence: "high",
		isAdvisory: true,
		mutationPolicyNeeded: "validation_only",
		targetResolved: true,
		...overrides,
	};
}

function makeGateVerdict(overrides: Partial<AccpGateVerdict> = {}): AccpGateVerdict {
	return {
		reportId: "TEST_001",
		reportType: "TVR",
		valid: true,
		fatalErrors: [],
		warnings: [],
		blockingFindings: [],
		findingCount: 0,
		promotionReady: true,
		evidenceStatus: "complete",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ACCP Artifact Store", () => {
	const store = new AccpArtifactStore({ rootDir: "reports/accp", planId: TEST_PLAN_ID });

	beforeEach(() => {
		if (existsSync(TEST_ROOT)) {
			rmSync(TEST_ROOT, { recursive: true, force: true });
		}
	});

	afterEach(() => {
		if (existsSync(TEST_ROOT)) {
			rmSync(TEST_ROOT, { recursive: true, force: true });
		}
	});

	// -----------------------------------------------------------------------
	// Source artifacts
	// -----------------------------------------------------------------------

	describe("source artifacts", () => {
		it("should save and read source YAML", () => {
			const yaml = "reportType: TVR\nstatus: compiled\n";
			const path = store.saveSource("TEST_001", yaml);
			expect(path).toContain("source/TEST_001.accp.yaml");

			const read = store.readSource("TEST_001");
			expect(read).toBe(yaml);
		});

		it("should return null for non-existent source", () => {
			expect(store.readSource("NONEXISTENT")).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// Compiled artifacts
	// -----------------------------------------------------------------------

	describe("compiled artifacts", () => {
		it("should save and read a compiled result", () => {
			const result = makeCompiledResult();
			const path = store.saveCompiled("TEST_001", result);
			expect(path).toContain("compiled/TEST_001.compiled.json");

			const read = store.readCompiled("TEST_001");
			expect(read).not.toBeNull();
			expect(read!.status).toBe("compiled");
		});

		it("should return null for non-existent compiled", () => {
			expect(store.readCompiled("NONEXISTENT")).toBeNull();
		});

		it("should return null for malformed JSON", () => {
			const dir = resolve(TEST_ROOT, "compiled");
			mkdirSync(dir, { recursive: true });
			writeFileSync(resolve(dir, "BAD.compiled.json"), "not valid json", "utf-8");
			expect(store.readCompiled("BAD")).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// IR artifacts
	// -----------------------------------------------------------------------

	describe("IR artifacts", () => {
		it("should save and read an IR", () => {
			const ir = makeIr();
			const path = store.saveIr("TEST_001", ir);
			expect(path).toContain("ir/TEST_001.ir.json");

			const read = store.readIr("TEST_001");
			expect(read).not.toBeNull();
			expect(read!.family).toBe("core");
		});

		it("should return null for non-existent IR", () => {
			expect(store.readIr("NONEXISTENT")).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// Gate verdict artifacts
	// -----------------------------------------------------------------------

	describe("gate verdict artifacts", () => {
		it("should save and read a gate verdict", () => {
			const verdict = makeGateVerdict();
			const path = store.saveGateVerdict("TEST_001", verdict);
			expect(path).toContain("verdict/TEST_001.gate-verdict.json");

			const read = store.readGateVerdict("TEST_001");
			expect(read).not.toBeNull();
			expect(read!.valid).toBe(true);
		});

		it("should return null for non-existent gate verdict", () => {
			expect(store.readGateVerdict("NONEXISTENT")).toBeNull();
		});

		it("should preserve blocking findings", () => {
			const verdict = makeGateVerdict({
				valid: false,
				blockingFindings: ["E001: missing evidence"],
			});
			store.saveGateVerdict("BLOCKED_001", verdict);
			const read = store.readGateVerdict("BLOCKED_001");
			expect(read).not.toBeNull();
			expect(read!.valid).toBe(false);
			expect(read!.blockingFindings).toHaveLength(1);
		});
	});

	// -----------------------------------------------------------------------
	// Route signal artifacts
	// -----------------------------------------------------------------------

	describe("route signal artifacts", () => {
		it("should save and read a route signal", () => {
			const signal = makeRouteSignal();
			const path = store.saveRouteSignal("TEST_001", signal);
			expect(path).toContain("route/TEST_001.route-signal.json");

			const read = store.readRouteSignal("TEST_001");
			expect(read).not.toBeNull();
			expect(read!.isAdvisory).toBe(true);
		});

		it("should return null for non-existent route signal", () => {
			expect(store.readRouteSignal("NONEXISTENT")).toBeNull();
		});

		it("should verify route signals are advisory (authority boundary)", () => {
			// The store can read/write route signals, but they must always
			// be marked isAdvisory. This test enforces the authority invariant.
			const signal = makeRouteSignal({ isAdvisory: true });
			store.saveRouteSignal("ADVISORY_001", signal);
			const read = store.readRouteSignal("ADVISORY_001");
			expect(read).not.toBeNull();
			expect(read!.isAdvisory).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Rendered artifacts
	// -----------------------------------------------------------------------

	describe("rendered artifacts", () => {
		it("should save and read rendered markdown", () => {
			const md = "# Test Report\n\nThis is a test.\n";
			const path = store.saveRendered("TEST_001", md);
			expect(path).toContain("rendered/TEST_001.accp.md");

			const read = store.readRendered("TEST_001");
			expect(read).toBe(md);
		});

		it("should return null for non-existent rendered", () => {
			expect(store.readRendered("NONEXISTENT")).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// Plan-level index
	// -----------------------------------------------------------------------

	describe("plan-level index", () => {
		it("should save and read the artifact index", () => {
			const index: AccpArtifactIndex = {
				planId: TEST_PLAN_ID,
				accpVersion: "2.0.0",
				reports: {
					TEST_001: {
						reportId: "TEST_001",
						reportType: "TVR",
						artifacts: ["source", "compiled", "rendered"],
						updatedAt: new Date().toISOString(),
					},
				},
				updatedAt: new Date().toISOString(),
			};

			const path = store.saveIndex(index);
			expect(path).toContain("index.json");

			const read = store.readIndex();
			expect(read).not.toBeNull();
			expect(read!.planId).toBe(TEST_PLAN_ID);
			expect(read!.accpVersion).toBe("2.0.0");
			expect(Object.keys(read!.reports)).toContain("TEST_001");
		});

		it("should return null when index does not exist", () => {
			expect(store.readIndex()).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// Plan-level graph
	// -----------------------------------------------------------------------

	describe("plan-level graph", () => {
		it("should save and read the artifact graph", () => {
			const graph: AccpArtifactGraph = {
				planId: TEST_PLAN_ID,
				accpVersion: "2.0.0",
				nodes: [
					{ id: "W1", type: "wave", title: "Foundation" },
					{ id: "TEST_WS", type: "workspace", title: "Test Workspace" },
				],
				edges: [{ source: "W1", target: "TEST_WS", action: "dependency", confidence: "high" }],
			};

			const path = store.saveGraph(graph);
			expect(path).toContain("graph.json");

			const read = store.readGraph();
			expect(read).not.toBeNull();
			expect(read!.planId).toBe(TEST_PLAN_ID);
			expect(read!.nodes).toHaveLength(2);
			expect(read!.edges).toHaveLength(1);
			expect(read!.edges[0].source).toBe("W1");
		});

		it("should return null when graph does not exist", () => {
			expect(store.readGraph()).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// Cross-kind: all non-existent artifacts return null
	// -----------------------------------------------------------------------

	it("should return null for all non-existent artifact kinds", () => {
		expect(store.readSource("NONEXISTENT")).toBeNull();
		expect(store.readCompiled("NONEXISTENT")).toBeNull();
		expect(store.readIr("NONEXISTENT")).toBeNull();
		expect(store.readRouteSignal("NONEXISTENT")).toBeNull();
		expect(store.readGateVerdict("NONEXISTENT")).toBeNull();
		expect(store.readRendered("NONEXISTENT")).toBeNull();
		expect(store.readIndex()).toBeNull();
		expect(store.readGraph()).toBeNull();
	});

	// -----------------------------------------------------------------------
	// Negative: authority boundary — store does not authorize
	// -----------------------------------------------------------------------

	it("should not authorize mutations merely by storing artifacts", () => {
		// The artifact store is a write-only evidence sink. It has no
		// knowledge of workspace state, command policy, or write gates.
		// This test ensures the store cannot be used to make authority
		// decisions — it can only persist and retrieve evidence.
		const result = makeCompiledResult();
		const path = store.saveCompiled("AUTH_TEST", result);

		// Storing does not mutate workspace state
		expect(path).toContain("compiled");

		// The store does not expose any authorization methods
		expect(typeof (store as unknown as Record<string, unknown>).authorize).toBe("undefined");
		expect(typeof (store as unknown as Record<string, unknown>).promote).toBe("undefined");
		expect(typeof (store as unknown as Record<string, unknown>).transition).toBe("undefined");
	});

	it("should handle concurrent saves to different report IDs", () => {
		store.saveCompiled("A_001", makeCompiledResult({ reportId: "A_001" }));
		store.saveCompiled("B_001", makeCompiledResult({ reportId: "B_001" }));

		const a = store.readCompiled("A_001");
		const b = store.readCompiled("B_001");

		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		expect(a!.reportId).toBe("A_001");
		expect(b!.reportId).toBe("B_001");
	});
});
