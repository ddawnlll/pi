/**
 * P44.02 — EvidenceLedger Tests
 *
 * Tests for the EvidenceLedger class, evidence entry management,
 * query/filter, summary statistics, serialization, and reporting.
 */

import { describe, expect, it } from "vitest";
import { EvidenceLedger } from "../../src/core/completion/evidence-ledger.js";
import type { EvidenceLedgerEntry } from "../../src/core/completion/evidence-types.js";
import {
	computeEvidenceSummary,
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
// Tests
// ---------------------------------------------------------------------------

describe("P44.02 — EvidenceLedger", () => {
	describe("formatEvidenceId", () => {
		it("should format evidence IDs from a prefix", () => {
			expect(formatEvidenceId("P4401", 1)).toBe("EV-P4401-001");
			expect(formatEvidenceId("P44.01", 1)).toBe("EV-P4401-001");
			expect(formatEvidenceId("p44_02", 12)).toBe("EV-P4402-012");
		});
	});

	describe("meetsMinConfidence", () => {
		it("should check confidence thresholds", () => {
			expect(meetsMinConfidence("high", "high")).toBe(true);
			expect(meetsMinConfidence("high", "medium")).toBe(true);
			expect(meetsMinConfidence("medium", "high")).toBe(false);
			expect(meetsMinConfidence("low", "low")).toBe(true);
			expect(meetsMinConfidence("unknown", "unknown")).toBe(true);
		});
	});

	describe("computeEvidenceSummary", () => {
		it("should compute summary statistics", () => {
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
	});

	describe("EvidenceLedger", () => {
		it("should create an empty ledger", () => {
			const ledger = new EvidenceLedger("P44.02");
			expect(ledger.scope).toBe("P44.02");
			expect(ledger.size).toBe(0);
		});

		it("should add and retrieve entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			const entry = makeEntry("EV-001");
			ledger.add(entry);
			expect(ledger.size).toBe(1);
			expect(ledger.get("EV-001")).toBeDefined();
			expect(ledger.get("EV-001")?.id).toBe("EV-001");
		});

		it("should overwrite entries with the same ID", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001", { description: "Original" }));
			ledger.add(makeEntry("EV-001", { description: "Updated" }));
			expect(ledger.size).toBe(1);
			expect(ledger.get("EV-001")?.description).toBe("Updated");
		});

		it("should check existence with has()", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"));
			expect(ledger.has("EV-001")).toBe(true);
			expect(ledger.has("EV-999")).toBe(false);
		});

		it("should remove entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"));
			expect(ledger.remove("EV-001")).toBe(true);
			expect(ledger.remove("EV-999")).toBe(false);
			expect(ledger.size).toBe(0);
		});

		it("should get all entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"), makeEntry("EV-002"));
			const all = ledger.getAll();
			expect(all).toHaveLength(2);
		});

		describe("query", () => {
			it("should filter by type", () => {
				const ledger = new EvidenceLedger("P44.02");
				ledger.add(makeEntry("EV-001", { type: "test_run" }), makeEntry("EV-002", { type: "source_file" }));
				expect(ledger.query({ type: "test_run" })).toHaveLength(1);
				expect(ledger.query({ type: "source_file" })).toHaveLength(1);
			});

			it("should filter by verdict", () => {
				const ledger = new EvidenceLedger("P44.02");
				ledger.add(makeEntry("EV-001", { verdict: "pass" }), makeEntry("EV-002", { verdict: "fail" }));
				expect(ledger.query({ verdict: "pass" })).toHaveLength(1);
				expect(ledger.query({ verdict: "fail" })).toHaveLength(1);
			});

			it("should filter by minimum confidence", () => {
				const ledger = new EvidenceLedger("P44.02");
				ledger.add(makeEntry("EV-001", { confidence: "high" }), makeEntry("EV-002", { confidence: "low" }));
				expect(ledger.query({ minConfidence: "high" })).toHaveLength(1);
				expect(ledger.query({ minConfidence: "low" })).toHaveLength(2);
			});

			it("should filter by producedBy", () => {
				const ledger = new EvidenceLedger("P44.02");
				ledger.add(
					makeEntry("EV-001", { producedBy: "worker-1" }),
					makeEntry("EV-002", { producedBy: "worker-2" }),
				);
				expect(ledger.query({ producedBy: "worker-1" })).toHaveLength(1);
			});

			it("should filter by criterion ID", () => {
				const ledger = new EvidenceLedger("P44.02");
				ledger.add(
					makeEntry("EV-001", { criterionIds: ["AC-P4401-001"] }),
					makeEntry("EV-002", { criterionIds: ["AC-P4402-001"] }),
				);
				expect(ledger.query({ criterionId: "AC-P4401-001" })).toHaveLength(1);
				expect(ledger.query({ criterionId: "AC-P4402-001" })).toHaveLength(1);
				expect(ledger.query({ criterionId: "AC-NONE" })).toHaveLength(0);
			});

			it("should filter by timestamp range", () => {
				const ledger = new EvidenceLedger("P44.02");
				const early = makeEntry("EV-001", { timestamp: 1000 });
				const late = makeEntry("EV-002", { timestamp: 2000 });
				ledger.add(early, late);
				expect(ledger.query({ after: 1500 })).toHaveLength(1);
				expect(ledger.query({ before: 1500 })).toHaveLength(1);
				expect(ledger.query({ after: 500, before: 2500 })).toHaveLength(2);
			});

			it("should support pagination", () => {
				const ledger = new EvidenceLedger("P44.02");
				ledger.add(makeEntry("EV-001"), makeEntry("EV-002"), makeEntry("EV-003"));
				expect(ledger.query({ offset: 0, limit: 2 })).toHaveLength(2);
				expect(ledger.query({ offset: 2, limit: 10 })).toHaveLength(1);
			});

			it("should combine multiple filters with AND", () => {
				const ledger = new EvidenceLedger("P44.02");
				ledger.add(
					makeEntry("EV-001", { type: "test_run", verdict: "pass", confidence: "high" }),
					makeEntry("EV-002", { type: "test_run", verdict: "fail", confidence: "high" }),
					makeEntry("EV-003", { type: "source_file", verdict: "pass", confidence: "high" }),
				);
				const result = ledger.query({
					type: "test_run",
					verdict: "pass",
				});
				expect(result).toHaveLength(1);
				expect(result[0].id).toBe("EV-001");
			});
		});

		describe("convenience getters", () => {
			it("getByCriterion", () => {
				const ledger = new EvidenceLedger("P44.02");
				ledger.add(
					makeEntry("EV-001", { criterionIds: ["AC-P4401-001"] }),
					makeEntry("EV-002", { criterionIds: ["AC-P4401-001", "AC-P4401-002"] }),
				);
				expect(ledger.getByCriterion("AC-P4401-001")).toHaveLength(2);
				expect(ledger.getByCriterion("AC-P4401-002")).toHaveLength(1);
			});

			it("getByVerdict", () => {
				const ledger = new EvidenceLedger("P44.02");
				ledger.add(makeEntry("EV-001", { verdict: "pass" }), makeEntry("EV-002", { verdict: "fail" }));
				expect(ledger.getByVerdict("pass")).toHaveLength(1);
				expect(ledger.getByVerdict("fail")).toHaveLength(1);
			});

			it("getByType", () => {
				const ledger = new EvidenceLedger("P44.02");
				ledger.add(makeEntry("EV-001", { type: "test_run" }), makeEntry("EV-002", { type: "manual_review" }));
				expect(ledger.getByType("test_run")).toHaveLength(1);
			});
		});

		describe("summary", () => {
			it("getSummary should return stats for all entries", () => {
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

			it("getFilteredSummary should return stats for filtered entries", () => {
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
		});

		it("getFailures should return failed entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001", { verdict: "pass" }), makeEntry("EV-002", { verdict: "fail" }));
			expect(ledger.getFailures()).toHaveLength(1);
			expect(ledger.getFailures()[0].id).toBe("EV-002");
		});

		it("getHighConfidenceEvidence should return high confidence entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001", { confidence: "high" }), makeEntry("EV-002", { confidence: "medium" }));
			expect(ledger.getHighConfidenceEvidence()).toHaveLength(1);
		});

		it("should clear all entries", () => {
			const ledger = new EvidenceLedger("P44.02");
			ledger.add(makeEntry("EV-001"), makeEntry("EV-002"));
			ledger.clear();
			expect(ledger.size).toBe(0);
		});

		describe("serialization", () => {
			it("toJSON should produce a snapshot", () => {
				const ledger = new EvidenceLedger("P44.02");
				ledger.add(makeEntry("EV-001", { verdict: "pass" }));
				const snapshot = ledger.toJSON();
				expect(snapshot.scopeId).toBe("P44.02");
				expect(snapshot.total).toBe(1);
				expect(snapshot.summary.total).toBe(1);
				expect(snapshot.entries).toHaveLength(1);
			});

			it("fromJSON should restore a ledger", () => {
				const original = new EvidenceLedger("P44.02");
				original.add(makeEntry("EV-001", { verdict: "pass" }));
				const snapshot = original.toJSON();

				const restored = EvidenceLedger.fromJSON(snapshot);
				expect(restored.scope).toBe("P44.02");
				expect(restored.size).toBe(1);
				expect(restored.get("EV-001")?.verdict).toBe("pass");
			});
		});

		describe("buildReport", () => {
			it("should generate a human-readable report", () => {
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
				expect(report).toContain("EV-001");
				expect(report).toContain("Test run passed");
				expect(report).toContain("Pass rate");
			});

			it("should handle empty ledger", () => {
				const ledger = new EvidenceLedger("P44.02");
				const report = ledger.buildReport();
				expect(report).toContain("No evidence entries");
			});
		});
	});
});
