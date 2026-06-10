/**
 * P44.02 — EvidenceLedger and Artifact Evidence Model Tests
 *
 * Tests for the EvidenceLedger class, evidence entry management,
 * query/filter, summary statistics, serialization, reporting,
 * and the Artifact Evidence Model helper.
 */

import { describe, expect, it } from "vitest";
import { EvidenceLedger } from "../../src/core/completion/evidence-ledger.js";
import type { EvidenceLedgerEntry } from "../../src/core/completion/evidence-types.js";
import {
	computeEvidenceSummary,
	createArtifactEvidence,
	formatEvidenceId,
	meetsMinConfidence,
} from "../../src/core/completion/evidence-types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(id: string, overrides: Partial<EvidenceLedgerEntry> = {}): EvidenceLedgerEntry {
	return {
		id,
		type: "test_run",
		description: `Evidence ${id}`,
		source: "test",
		timestamp: Date.now(),
		verdict: "pass",
		confidence: "high",
		content: "test output",
		criterionIds: [],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Helper: formatEvidenceId
// ---------------------------------------------------------------------------

describe("formatEvidenceId", () => {
	it("should format evidence IDs from a prefix and sequence number", () => {
		expect(formatEvidenceId("P4401", 1)).toBe("EV-P4401-001");
		expect(formatEvidenceId("P44.01", 1)).toBe("EV-P4401-001");
		expect(formatEvidenceId("p44_02", 12)).toBe("EV-P4402-012");
		expect(formatEvidenceId("P44.01", 123)).toBe("EV-P4401-123");
	});

	it("should handle unusual characters in prefix", () => {
		expect(formatEvidenceId("my-scope!", 5)).toBe("EV-MYSCOPE-005");
	});
});

// ---------------------------------------------------------------------------
// Helper: meetsMinConfidence
// ---------------------------------------------------------------------------

describe("meetsMinConfidence", () => {
	it("should return true when confidence meets or exceeds threshold", () => {
		expect(meetsMinConfidence("high", "high")).toBe(true);
		expect(meetsMinConfidence("high", "medium")).toBe(true);
		expect(meetsMinConfidence("high", "low")).toBe(true);
		expect(meetsMinConfidence("medium", "medium")).toBe(true);
		expect(meetsMinConfidence("low", "low")).toBe(true);
		expect(meetsMinConfidence("unknown", "unknown")).toBe(true);
	});

	it("should return false when confidence is below threshold", () => {
		expect(meetsMinConfidence("medium", "high")).toBe(false);
		expect(meetsMinConfidence("low", "high")).toBe(false);
		expect(meetsMinConfidence("low", "medium")).toBe(false);
		expect(meetsMinConfidence("unknown", "high")).toBe(false);
	});

	it("should return false for unknown confidence values", () => {
		expect(meetsMinConfidence("invalid" as any, "high")).toBe(false);
		expect(meetsMinConfidence("high", "invalid" as any)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Helper: computeEvidenceSummary
// ---------------------------------------------------------------------------

describe("computeEvidenceSummary", () => {
	it("should compute summary statistics from entries", () => {
		const entries = [
			makeEntry("EV-001", { verdict: "pass", confidence: "high" }),
			makeEntry("EV-002", { verdict: "pass", confidence: "high" }),
			makeEntry("EV-003", { verdict: "fail", confidence: "medium" }),
		];
		const summary = computeEvidenceSummary(entries);
		expect(summary.total).toBe(3);
		expect(summary.byVerdict.pass).toBe(2);
		expect(summary.byVerdict.fail).toBe(1);
		expect(summary.passRate).toBeCloseTo(2 / 3);
	});

	it("should handle empty array", () => {
		const summary = computeEvidenceSummary([]);
		expect(summary.total).toBe(0);
		expect(summary.passRate).toBe(0);
	});

	it("should group counts by type, verdict, and confidence", () => {
		const entries = [
			makeEntry("EV-001", { type: "test_run", verdict: "pass", confidence: "high" }),
			makeEntry("EV-002", { type: "test_run", verdict: "pass", confidence: "high" }),
			makeEntry("EV-003", { type: "source_file", verdict: "fail", confidence: "low" }),
		];
		const summary = computeEvidenceSummary(entries);
		expect(summary.byType.test_run).toBe(2);
		expect(summary.byType.source_file).toBe(1);
		expect(summary.byConfidence.high).toBe(2);
		expect(summary.byConfidence.low).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Helper: createArtifactEvidence (Artifact Evidence Model)
// ---------------------------------------------------------------------------

describe("createArtifactEvidence", () => {
	it("should create an artifact evidence entry with defaults", () => {
		const entry = createArtifactEvidence({
			id: "EV-P4402-001",
			description: "Build output",
			source: "dist/output.js",
			verdict: "pass",
		});

		expect(entry.id).toBe("EV-P4402-001");
		expect(entry.type).toBe("artifact");
		expect(entry.description).toBe("Build output");
		expect(entry.source).toBe("dist/output.js");
		expect(entry.verdict).toBe("pass");
		expect(entry.confidence).toBe("medium");
		expect(entry.content).toBe("");
		expect(entry.criterionIds).toEqual([]);
		expect(entry.timestamp).toBeGreaterThan(0);
		expect(entry.metadata).toEqual({});
	});

	it("should store artifact-specific metadata", () => {
		const entry = createArtifactEvidence({
			id: "EV-P4402-002",
			description: "Compiled binary",
			source: "build/app.wasm",
			fileSize: 1024,
			mimeType: "application/wasm",
			fileHash: "abc123",
			metadata: { compiler: "rustc 1.75" },
		});

		expect(entry.metadata).toEqual({
			fileSize: 1024,
			mimeType: "application/wasm",
			fileHash: "abc123",
			compiler: "rustc 1.75",
		});
	});

	it("should accept criterion IDs and producedBy", () => {
		const entry = createArtifactEvidence({
			id: "EV-P4402-003",
			description: "Test report",
			source: "reports/test-output.xml",
			criterionIds: ["AC-P4402-001", "AC-P4402-002"],
			producedBy: "worker-build",
		});

		expect(entry.criterionIds).toEqual(["AC-P4402-001", "AC-P4402-002"]);
		expect(entry.producedBy).toBe("worker-build");
	});

	it("should accept lock hashes for v5 ACCP mode", () => {
		const entry = createArtifactEvidence({
			id: "EV-P4402-004",
			description: "Lock-verified artifact",
			source: "output.txt",
			planLockHash: "plan-hash-001",
			workspaceLockHash: "ws-hash-001",
		});

		expect(entry.planLockHash).toBe("plan-hash-001");
		expect(entry.workspaceLockHash).toBe("ws-hash-001");
	});
});

// ---------------------------------------------------------------------------
// EvidenceLedger
// ---------------------------------------------------------------------------

describe("EvidenceLedger", () => {
	describe("construction and basic properties", () => {
		it("should create an empty ledger with the given scope", () => {
			const ledger = new EvidenceLedger("P44.02");
			expect(ledger.scope).toBe("P44.02");
			expect(ledger.size).toBe(0);
		});
	});

	describe("add and get", () => {
		it("should add entries and retrieve them by ID", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"));
			expect(ledger.size).toBe(1);
			expect(ledger.get("EV-001")).toBeDefined();
			expect(ledger.get("EV-001")?.id).toBe("EV-001");
		});

		it("should add multiple entries in one call", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"), makeEntry("EV-002"), makeEntry("EV-003"));
			expect(ledger.size).toBe(3);
		});

		it("should return undefined for non-existent entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			expect(ledger.get("EV-NONEXISTENT")).toBeUndefined();
		});

		it("should overwrite entries with the same ID (update-in-place)", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001", { description: "Original" }));
			ledger.add(makeEntry("EV-001", { description: "Updated", verdict: "fail" }));
			expect(ledger.size).toBe(1);
			const entry = ledger.get("EV-001")!;
			expect(entry.description).toBe("Updated");
			expect(entry.verdict).toBe("fail");
		});

		it("should set a timestamp if none is provided", () => {
			const ledger = new EvidenceLedger("P44.02");
			const entry = makeEntry("EV-001", { timestamp: 0 });
			entry.timestamp = 0 as any;
			ledger.add(entry);
			const stored = ledger.get("EV-001")!;
			expect(stored.timestamp).toBeGreaterThan(0);
		});
	});

	describe("has", () => {
		it("should check existence of entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"));
			expect(ledger.has("EV-001")).toBe(true);
			expect(ledger.has("EV-999")).toBe(false);
		});
	});

	describe("remove", () => {
		it("should remove existing entries and return true", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"));
			expect(ledger.remove("EV-001")).toBe(true);
			expect(ledger.size).toBe(0);
		});

		it("should return false when removing non-existent entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			expect(ledger.remove("EV-999")).toBe(false);
		});
	});

	describe("getAll", () => {
		it("should return all entries as an array", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"), makeEntry("EV-002"));
			expect(ledger.getAll()).toHaveLength(2);
		});
	});

	describe("query", () => {
		it("should return all entries with no filter", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"), makeEntry("EV-002"));
			expect(ledger.query()).toHaveLength(2);
		});

		it("should filter by type", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { type: "test_run" }),
				makeEntry("EV-002", { type: "source_file" }),
				makeEntry("EV-003", { type: "manual_review" }),
			);
			expect(ledger.query({ type: "test_run" })).toHaveLength(1);
			expect(ledger.query({ type: "source_file" })).toHaveLength(1);
			expect(ledger.query({ type: "artifact" })).toHaveLength(0);
		});

		it("should filter by verdict", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001", { verdict: "pass" }), makeEntry("EV-002", { verdict: "fail" }));
			expect(ledger.query({ verdict: "pass" })).toHaveLength(1);
			expect(ledger.query({ verdict: "fail" })).toHaveLength(1);
			expect(ledger.query({ verdict: "inconclusive" })).toHaveLength(0);
		});

		it("should filter by minimum confidence", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { confidence: "high" }),
				makeEntry("EV-002", { confidence: "medium" }),
				makeEntry("EV-003", { confidence: "low" }),
			);
			expect(ledger.query({ minConfidence: "high" })).toHaveLength(1);
			expect(ledger.query({ minConfidence: "medium" })).toHaveLength(2);
			expect(ledger.query({ minConfidence: "low" })).toHaveLength(3);
		});

		it("should filter by producedBy", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { producedBy: "worker-1" }),
				makeEntry("EV-002", { producedBy: "worker-2" }),
				makeEntry("EV-003", { producedBy: "worker-1" }),
			);
			expect(ledger.query({ producedBy: "worker-1" })).toHaveLength(2);
			expect(ledger.query({ producedBy: "worker-2" })).toHaveLength(1);
			expect(ledger.query({ producedBy: "worker-3" })).toHaveLength(0);
		});

		it("should filter by criterion ID", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { criterionIds: ["AC-P4401-001"] }),
				makeEntry("EV-002", { criterionIds: ["AC-P4402-001"] }),
				makeEntry("EV-003", { criterionIds: ["AC-P4401-001", "AC-P4402-002"] }),
			);
			expect(ledger.query({ criterionId: "AC-P4401-001" })).toHaveLength(2);
			expect(ledger.query({ criterionId: "AC-P4402-001" })).toHaveLength(1);
			expect(ledger.query({ criterionId: "AC-NONE" })).toHaveLength(0);
		});

		it("should filter by timestamp range", () => {
			const ledger = new EvidenceLedger("P44.02");
			const early = makeEntry("EV-001", { timestamp: 1000 });
			const middle = makeEntry("EV-002", { timestamp: 2000 });
			const late = makeEntry("EV-003", { timestamp: 3000 });
			ledger.add(early, middle, late);

			expect(ledger.query({ after: 1500 })).toHaveLength(2);
			expect(ledger.query({ before: 1500 })).toHaveLength(1);
			expect(ledger.query({ after: 500, before: 2500 })).toHaveLength(2);
			expect(ledger.query({ after: 3500 })).toHaveLength(0);
			expect(ledger.query({ before: 500 })).toHaveLength(0);
		});

		it("should support pagination with offset and limit", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"), makeEntry("EV-002"), makeEntry("EV-003"), makeEntry("EV-004"));
			expect(ledger.query({ offset: 0, limit: 2 })).toHaveLength(2);
			expect(ledger.query({ offset: 2, limit: 2 })).toHaveLength(2);
			expect(ledger.query({ offset: 10, limit: 5 })).toHaveLength(0);
		});

		it("should combine multiple filter criteria with AND", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { type: "test_run", verdict: "pass", confidence: "high" }),
				makeEntry("EV-002", { type: "test_run", verdict: "fail", confidence: "high" }),
				makeEntry("EV-003", { type: "source_file", verdict: "pass", confidence: "high" }),
				makeEntry("EV-004", { type: "test_run", verdict: "pass", confidence: "low" }),
			);

			// type=test_run AND verdict=pass
			const result = ledger.query({ type: "test_run", verdict: "pass" });
			expect(result).toHaveLength(2);
			expect(result.map((e) => e.id).sort()).toEqual(["EV-001", "EV-004"]);

			// type=test_run AND verdict=pass AND minConfidence=high
			const strict = ledger.query({ type: "test_run", verdict: "pass", minConfidence: "high" });
			expect(strict).toHaveLength(1);
			expect(strict[0].id).toBe("EV-001");
		});
	});

	describe("convenience getters", () => {
		it("getByCriterion should return entries for a criterion", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { criterionIds: ["AC-P4401-001"] }),
				makeEntry("EV-002", { criterionIds: ["AC-P4402-001"] }),
				makeEntry("EV-003", { criterionIds: ["AC-P4401-001", "AC-P4401-002"] }),
			);
			expect(ledger.getByCriterion("AC-P4401-001")).toHaveLength(2);
			expect(ledger.getByCriterion("AC-P4401-002")).toHaveLength(1);
		});

		it("getByVerdict should return entries by verdict", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { verdict: "pass" }),
				makeEntry("EV-002", { verdict: "fail" }),
				makeEntry("EV-003", { verdict: "inconclusive" }),
			);
			expect(ledger.getByVerdict("pass")).toHaveLength(1);
			expect(ledger.getByVerdict("fail")).toHaveLength(1);
			expect(ledger.getByVerdict("inconclusive")).toHaveLength(1);
			expect(ledger.getByVerdict("not_evaluated")).toHaveLength(0);
		});

		it("getByType should return entries by type", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { type: "test_run" }),
				makeEntry("EV-002", { type: "manual_review" }),
				makeEntry("EV-003", { type: "test_run" }),
			);
			expect(ledger.getByType("test_run")).toHaveLength(2);
			expect(ledger.getByType("manual_review")).toHaveLength(1);
		});
	});

	describe("summary methods", () => {
		it("getSummary should compute stats for all entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { verdict: "pass" }),
				makeEntry("EV-002", { verdict: "pass" }),
				makeEntry("EV-003", { verdict: "fail" }),
			);
			const summary = ledger.getSummary();
			expect(summary.total).toBe(3);
			expect(summary.passRate).toBeCloseTo(2 / 3);
		});

		it("getFilteredSummary should compute stats for filtered entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { type: "test_run", verdict: "pass" }),
				makeEntry("EV-002", { type: "test_run", verdict: "fail" }),
				makeEntry("EV-003", { type: "source_file", verdict: "pass" }),
			);
			const summary = ledger.getFilteredSummary({ type: "test_run" });
			expect(summary.total).toBe(2);
			expect(summary.passRate).toBe(0.5);
		});

		it("getPassRate should return 1 for empty ledger", () => {
			const ledger = new EvidenceLedger("P44.02");
			expect(ledger.getPassRate()).toBe(1);
		});

		it("getPassRate should return 0 when all entries fail", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001", { verdict: "fail" }), makeEntry("EV-002", { verdict: "fail" }));
			expect(ledger.getPassRate()).toBe(0);
		});
	});

	describe("getFailures", () => {
		it("should return entries with fail verdict", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { verdict: "pass" }),
				makeEntry("EV-002", { verdict: "fail" }),
				makeEntry("EV-003", { verdict: "fail" }),
			);
			const failures = ledger.getFailures();
			expect(failures).toHaveLength(2);
			expect(failures.every((e) => e.verdict === "fail")).toBe(true);
		});
	});

	describe("getHighConfidenceEvidence", () => {
		it("should return entries with high confidence", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { confidence: "high" }),
				makeEntry("EV-002", { confidence: "medium" }),
				makeEntry("EV-003", { confidence: "high" }),
			);
			const highConf = ledger.getHighConfidenceEvidence();
			expect(highConf).toHaveLength(2);
			expect(highConf.every((e) => e.confidence === "high")).toBe(true);
		});
	});

	describe("clear", () => {
		it("should remove all entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"), makeEntry("EV-002"), makeEntry("EV-003"));
			expect(ledger.size).toBe(3);
			ledger.clear();
			expect(ledger.size).toBe(0);
			expect(ledger.getAll()).toHaveLength(0);
		});
	});

	describe("serialization", () => {
		it("toJSON should produce a complete snapshot", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001", { verdict: "pass", confidence: "high" }));
			const snapshot = ledger.toJSON();

			expect(snapshot.scopeId).toBe("P44.02");
			expect(snapshot.schemaVersion).toBe("1.0.0");
			expect(snapshot.total).toBe(1);
			expect(snapshot.generatedAt).toBeGreaterThan(0);
			expect(snapshot.summary.total).toBe(1);
			expect(snapshot.entries).toHaveLength(1);
			expect(snapshot.entries[0].id).toBe("EV-001");
		});

		it("fromJSON should restore a ledger from snapshot", () => {
			const original = new EvidenceLedger("P44.02");
			original.add(makeEntry("EV-001", { verdict: "pass" }));
			original.add(makeEntry("EV-002", { verdict: "fail", confidence: "medium" }));
			const snapshot = original.toJSON();

			const restored = EvidenceLedger.fromJSON(snapshot);
			expect(restored.scope).toBe("P44.02");
			expect(restored.size).toBe(2);
			expect(restored.get("EV-001")?.verdict).toBe("pass");
			expect(restored.get("EV-002")?.verdict).toBe("fail");
			expect(restored.get("EV-002")?.confidence).toBe("medium");
		});

		it("fromJSON should work with empty ledger", () => {
			const original = new EvidenceLedger("P44.02");
			const snapshot = original.toJSON();
			const restored = EvidenceLedger.fromJSON(snapshot);
			expect(restored.size).toBe(0);
		});

		it("serialization round-trip should preserve all data", () => {
			const original = new EvidenceLedger("P44.02");
			original.add(
				makeEntry("EV-001", {
					type: "test_run",
					verdict: "pass",
					confidence: "high",
					source: "test/suite.ts",
					content: "All tests passed",
					producedBy: "worker-1",
					criterionIds: ["AC-P4402-001"],
				}),
				makeEntry("EV-002", {
					type: "artifact",
					verdict: "pass",
					confidence: "medium",
					source: "dist/output.js",
					description: "Build artifact",
					metadata: { fileSize: 1024 },
				}),
			);

			const snapshot = original.toJSON();
			const restored = EvidenceLedger.fromJSON(snapshot);

			expect(restored.size).toBe(2);
			const ev1 = restored.get("EV-001")!;
			expect(ev1.type).toBe("test_run");
			expect(ev1.producedBy).toBe("worker-1");
			expect(ev1.metadata).toBeUndefined();

			const ev2 = restored.get("EV-002")!;
			expect(ev2.type).toBe("artifact");
			expect(ev2.metadata).toEqual({ fileSize: 1024 });
		});
	});

	describe("buildReport", () => {
		it("should generate a complete human-readable report", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", {
					description: "Test run passed",
					type: "test_run",
					verdict: "pass",
				}),
			);
			const report = ledger.buildReport();
			expect(report).toContain("Evidence Ledger Report");
			expect(report).toContain("Scope: P44.02");
			expect(report).toContain("EV-001");
			expect(report).toContain("Test run passed");
			expect(report).toContain("Pass rate");
		});

		it("should handle empty ledger", () => {
			const ledger = new EvidenceLedger("P44.02");
			const report = ledger.buildReport();
			expect(report).toContain("No evidence entries");
		});

		it("should include criteria references when present", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", {
					criterionIds: ["AC-P4402-001", "AC-P4402-002"],
				}),
			);
			const report = ledger.buildReport();
			expect(report).toContain("AC-P4402-001");
			expect(report).toContain("AC-P4402-002");
		});

		it("should include producedBy when present", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001", { producedBy: "worker-build" }));
			const report = ledger.buildReport();
			expect(report).toContain("worker-build");
		});

		it("should truncate long content in report", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001", { content: "x".repeat(500) }));
			const report = ledger.buildReport();
			expect(report).toContain("...");
			expect(report.length).toBeLessThan(1000);
		});

		it("should support filtered reports", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(
				makeEntry("EV-001", { type: "test_run", verdict: "pass" }),
				makeEntry("EV-002", { type: "source_file", verdict: "pass" }),
			);
			const report = ledger.buildReport({ type: "test_run" });
			expect(report).toContain("EV-001");
			expect(report).not.toContain("EV-002");
		});
	});
});

// ---------------------------------------------------------------------------
// Integration: Artifact Evidence Model with EvidenceLedger
// ---------------------------------------------------------------------------

describe("Artifact Evidence Model Integration", () => {
	it("should add artifact evidence created via helper to ledger", () => {
		const ledger = new EvidenceLedger("P44.02");

		const artifact = createArtifactEvidence({
			id: "EV-P4402-001",
			description: "Compiled output",
			source: "dist/app.js",
			verdict: "pass",
			confidence: "high",
			mimeType: "application/javascript",
			fileSize: 24576,
			fileHash: "sha256-abc123",
			criterionIds: ["AC-P4402-001"],
			producedBy: "worker-build",
		});

		ledger.add(artifact);
		expect(ledger.size).toBe(1);

		const stored = ledger.get("EV-P4402-001")!;
		expect(stored.type).toBe("artifact");
		expect(stored.metadata?.mimeType).toBe("application/javascript");
		expect(stored.metadata?.fileSize).toBe(24576);
	});

	it("should query artifact evidence by type", () => {
		const ledger = new EvidenceLedger("P44.02");
		ledger.add(
			makeEntry("EV-001", { type: "test_run" }),
			createArtifactEvidence({ id: "EV-002", description: "Artifact", source: "file.txt" }),
			createArtifactEvidence({ id: "EV-003", description: "Report", source: "report.xml" }),
		);

		const artifacts = ledger.getByType("artifact");
		expect(artifacts).toHaveLength(2);
		expect(artifacts.map((e) => e.id).sort()).toEqual(["EV-002", "EV-003"]);
	});

	it("should include artifact evidence in summary", () => {
		const ledger = new EvidenceLedger("P44.02");
		ledger.add(
			makeEntry("EV-001", { type: "test_run", verdict: "pass" }),
			createArtifactEvidence({
				id: "EV-002",
				description: "Build output",
				source: "dist/",
				verdict: "pass",
			}),
			createArtifactEvidence({
				id: "EV-003",
				description: "Failed report",
				source: "reports/fail.xml",
				verdict: "fail",
			}),
		);

		const summary = ledger.getSummary();
		expect(summary.total).toBe(3);
		expect(summary.byType.artifact).toBe(2);
		expect(summary.byType.test_run).toBe(1);
		expect(summary.byVerdict.pass).toBe(2);
		expect(summary.byVerdict.fail).toBe(1);
	});

	it("should serialize and restore artifact metadata", () => {
		const ledger = new EvidenceLedger("P44.02");
		ledger.add(
			createArtifactEvidence({
				id: "EV-001",
				description: "WASM module",
				source: "build/module.wasm",
				mimeType: "application/wasm",
				fileSize: 65536,
				fileHash: "sha256-xyz789",
			}),
		);

		const snapshot = ledger.toJSON();
		const restored = EvidenceLedger.fromJSON(snapshot);

		const entry = restored.get("EV-001")!;
		expect(entry.type).toBe("artifact");
		expect(entry.metadata?.mimeType).toBe("application/wasm");
		expect(entry.metadata?.fileSize).toBe(65536);
		expect(entry.metadata?.fileHash).toBe("sha256-xyz789");
	});
});
