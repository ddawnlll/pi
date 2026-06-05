/**
 * P44.01 — Acceptance Criteria & Traceability Schema Tests
 *
 * Tests for the AcceptanceCriteriaRegistry, criterion creation,
 * aggregation, traceability links, and serialization.
 */

import { describe, expect, it } from "vitest";
import {
	AcceptanceCriteriaRegistry,
	AcceptanceCriterion,
	createCriterion,
	formatCriterionId,
	isCriterionBlocking,
	aggregateCriterionStatus,
	getBlockingCriteria,
	formatBlockingReasons,
	buildTraceabilityReport,
	createRegistryFromPlan,
	parseRawCriteria,
	createTraceabilityLink,
} from "../src/core/completion/acceptance-criteria.js";
import type { EvidenceLedgerEntry } from "../src/core/completion/evidence-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidenceEntry(id: string, description: string): EvidenceLedgerEntry {
	return {
		id,
		type: "test_run",
		description,
		source: "test",
		timestamp: Date.now(),
		verdict: "pass",
		confidence: "high",
		content: "test output",
		criterionIds: [],
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P44.01 — Acceptance Criteria & Traceability Schema", () => {
	describe("formatCriterionId", () => {
		it("should format a criterion ID from a scope prefix", () => {
			expect(formatCriterionId("P4401", 1)).toBe("AC-P4401-001");
			expect(formatCriterionId("P44.01", 1)).toBe("AC-P4401-001");
			expect(formatCriterionId("p44_02", 12)).toBe("AC-P4402-012");
			expect(formatCriterionId("P44.01", 123)).toBe("AC-P4401-123");
		});
	});

	describe("createCriterion", () => {
		it("should create a criterion with default values", () => {
			const c = createCriterion("AC-P4401-001", "Test criterion");
			expect(c.id).toBe("AC-P4401-001");
			expect(c.description).toBe("Test criterion");
			expect(c.level).toBe("required");
			expect(c.category).toBe("functional");
			expect(c.evidenceRequired).toBe(true);
			expect(c.verificationStatus).toBe("unverified");
			expect(c.evidenceIds).toEqual([]);
			expect(c.verifiedAt).toBeNull();
		});

		it("should create a criterion with overrides", () => {
			const c = createCriterion("AC-P4401-002", "Blocking criterion", {
				level: "blocking",
				category: "safety",
			});
			expect(c.level).toBe("blocking");
			expect(c.category).toBe("safety");
		});
	});

	describe("isCriterionBlocking", () => {
		it("should block if verification status is failed", () => {
			const c = createCriterion("AC-P4401-001", "Failed criterion", {
				verificationStatus: "failed",
			});
			expect(isCriterionBlocking(c)).toBe(true);
		});

		it("should block if level is blocking and not satisfied", () => {
			const c = createCriterion("AC-P4401-002", "Blocking criterion", {
				level: "blocking",
				verificationStatus: "unverified",
			});
			expect(isCriterionBlocking(c)).toBe(true);
		});

		it("should block if level is required and not satisfied", () => {
			const c = createCriterion("AC-P4401-003", "Required criterion", {
				level: "required",
				verificationStatus: "unverified",
			});
			expect(isCriterionBlocking(c)).toBe(true);
		});

		it("should not block if satisfied", () => {
			const c = createCriterion("AC-P4401-004", "Satisfied criterion", {
				verificationStatus: "satisfied",
			});
			expect(isCriterionBlocking(c)).toBe(false);
		});

		it("should not block nice_to_have unverified", () => {
			const c = createCriterion("AC-P4401-005", "Nice to have", {
				level: "nice_to_have",
				verificationStatus: "unverified",
			});
			expect(isCriterionBlocking(c)).toBe(false);
		});
	});

	describe("aggregateCriterionStatus", () => {
		it("should return failed if any required criterion failed", () => {
			const criteria = [
				createCriterion("AC-P4401-001", "Pass", { verificationStatus: "satisfied" }),
				createCriterion("AC-P4401-002", "Fail", { verificationStatus: "failed" }),
			];
			expect(aggregateCriterionStatus(criteria)).toBe("failed");
		});

		it("should return satisfied if all are satisfied", () => {
			const criteria = [
				createCriterion("AC-P4401-001", "Pass", { verificationStatus: "satisfied" }),
				createCriterion("AC-P4401-002", "Pass", { verificationStatus: "satisfied" }),
			];
			expect(aggregateCriterionStatus(criteria)).toBe("satisfied");
		});

		it("should return in_progress if any is in progress", () => {
			const criteria = [
				createCriterion("AC-P4401-001", "Pass", { verificationStatus: "satisfied" }),
				createCriterion("AC-P4401-002", "In progress", { verificationStatus: "in_progress" }),
			];
			expect(aggregateCriterionStatus(criteria)).toBe("in_progress");
		});

		it("should return unverified if any evidence-required criterion is unverified", () => {
			const criteria = [
				createCriterion("AC-P4401-001", "Unverified", { verificationStatus: "unverified" }),
			];
			expect(aggregateCriterionStatus(criteria)).toBe("unverified");
		});

		it("should ignore nice_to_have unverified criteria", () => {
			const criteria = [
				createCriterion("AC-P4401-001", "Required satisfied", { verificationStatus: "satisfied" }),
				createCriterion("AC-P4401-002", "Nice to have", {
					level: "nice_to_have",
					verificationStatus: "unverified",
				}),
			];
			expect(aggregateCriterionStatus(criteria)).toBe("satisfied");
		});
	});

	describe("getBlockingCriteria", () => {
		it("should return only blocking criteria", () => {
			const criteria = [
				createCriterion("AC-P4401-001", "Satisfied", { verificationStatus: "satisfied" }),
				createCriterion("AC-P4401-002", "Failed", { verificationStatus: "failed" }),
				createCriterion("AC-P4401-003", "Unverified", { verificationStatus: "unverified" }),
			];
			const blocking = getBlockingCriteria(criteria);
			expect(blocking).toHaveLength(2);
			expect(blocking.map((c) => c.id)).toEqual(["AC-P4401-002", "AC-P4401-003"]);
		});
	});

	describe("formatBlockingReasons", () => {
		it("should format human-readable block reasons", () => {
			const criteria = [
				createCriterion("AC-P4401-001", "Something failed", { verificationStatus: "failed" }),
				createCriterion("AC-P4401-002", "Not checked", { verificationStatus: "unverified" }),
			];
			const reasons = formatBlockingReasons(criteria);
			expect(reasons).toHaveLength(2);
			expect(reasons[0]).toContain("Something failed");
			expect(reasons[1]).toContain("Not checked");
		});
	});

	describe("AcceptanceCriteriaRegistry", () => {
		it("should register criteria and retrieve them", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(
				createCriterion("AC-P4401-001", "First criterion"),
				createCriterion("AC-P4401-002", "Second criterion"),
			);
			expect(registry.getAll()).toHaveLength(2);
			expect(registry.get("AC-P4401-001")?.description).toBe("First criterion");
		});

		it("should throw on duplicate registration", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(createCriterion("AC-P4401-001", "First"));
			expect(() => registry.register(createCriterion("AC-P4401-001", "Duplicate"))).toThrow();
		});

		it("should update verification status", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(createCriterion("AC-P4401-001", "Test"));
			registry.updateStatus("AC-P4401-001", "satisfied", "All good", "tester");
			const c = registry.get("AC-P4401-001")!;
			expect(c.verificationStatus).toBe("satisfied");
			expect(c.verifierNotes).toBe("All good");
			expect(c.verifiedBy).toBe("tester");
			expect(c.verifiedAt).not.toBeNull();
		});

		it("should mark satisfied with evidence link", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(createCriterion("AC-P4401-001", "Test"));
			registry.markSatisfied("AC-P4401-001", "EV-P4401-001", "Proven by test", "tester");
			const c = registry.get("AC-P4401-001")!;
			expect(c.verificationStatus).toBe("satisfied");
			expect(c.evidenceIds).toContain("EV-P4401-001");
		});

		it("should mark failed", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(createCriterion("AC-P4401-001", "Test"));
			registry.markFailed("AC-P4401-001", "Did not pass", "tester");
			const c = registry.get("AC-P4401-001")!;
			expect(c.verificationStatus).toBe("failed");
		});

		it("should filter by level", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(
				createCriterion("AC-P4401-001", "Required"),
				createCriterion("AC-P4401-002", "Nice", { level: "nice_to_have" }),
				createCriterion("AC-P4401-003", "Blocking", { level: "blocking" }),
			);
			expect(registry.getByLevel("required")).toHaveLength(1);
			expect(registry.getByLevel("blocking")).toHaveLength(1);
			expect(registry.getByLevel("nice_to_have")).toHaveLength(1);
		});

		it("should filter by status", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(
				createCriterion("AC-P4401-001", "Done", { verificationStatus: "satisfied" }),
				createCriterion("AC-P4401-002", "Pending"),
			);
			expect(registry.getByStatus("satisfied")).toHaveLength(1);
			expect(registry.getByStatus("unverified")).toHaveLength(1);
		});

		it("should manage traceability links", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(createCriterion("AC-P4401-001", "Test"));
			registry.register(createCriterion("AC-P4401-002", "Test 2"));

			const link = createTraceabilityLink("AC-P4401-001", "EV-P4401-001", "proves", "Test evidence");
			registry.addTraceabilityLink(link);

			expect(registry.getTraceabilityLinks()).toHaveLength(1);

			const criterionLinks = registry.getLinksForCriterion("AC-P4401-001");
			expect(criterionLinks).toHaveLength(1);
			expect(criterionLinks[0].evidenceId).toBe("EV-P4401-001");

			expect(registry.getLinksForCriterion("AC-P4401-002")).toHaveLength(0);
		});

		it("should report aggregate status and completeness", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(
				createCriterion("AC-P4401-001", "One", { verificationStatus: "satisfied" }),
				createCriterion("AC-P4401-002", "Two", { verificationStatus: "satisfied" }),
			);
			expect(registry.getAggregateStatus()).toBe("satisfied");
			expect(registry.isComplete()).toBe(true);
		});

		it("should report blocking reasons", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(
				createCriterion("AC-P4401-001", "Good", { verificationStatus: "satisfied" }),
				createCriterion("AC-P4401-002", "Bad", { verificationStatus: "failed" }),
			);
			const reasons = registry.getBlockingReasons();
			expect(reasons).toHaveLength(1);
			expect(reasons[0]).toContain("Bad");
		});

		it("should serialize to JSON", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(
				createCriterion("AC-P4401-001", "Test", { verificationStatus: "satisfied" }),
			);
			const json = registry.toJSON();
			expect(json.scopeId).toBe("P44.01");
			expect(json.total).toBe(1);
			expect(json.satisfied).toBe(1);
			expect(json.complete).toBe(true);
			expect(json.criteria).toHaveLength(1);
		});

		it("should clear all data", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.01");
			registry.register(createCriterion("AC-P4401-001", "Test"));
			registry.addTraceabilityLink(createTraceabilityLink("AC-P4401-001", "EV-001", "proves"));
			registry.clear();
			expect(registry.getAll()).toHaveLength(0);
			expect(registry.getTraceabilityLinks()).toHaveLength(0);
		});
	});

	describe("createRegistryFromPlan", () => {
		it("should create a registry from string criteria", () => {
			const registry = createRegistryFromPlan("P44.01", [
				"Acceptance criterion 1",
				"Acceptance criterion 2",
			]);
			const all = registry.getAll();
			expect(all).toHaveLength(2);
			expect(all[0].description).toBe("Acceptance criterion 1");
			expect(all[0].level).toBe("required");
		});
	});

	describe("parseRawCriteria", () => {
		it("should parse string criteria", () => {
			const criteria = parseRawCriteria("P44.01", ["Do the thing", "Do the other thing"]);
			expect(criteria).toHaveLength(2);
			expect(criteria[0].id).toBe("AC-P4401-001");
			expect(criteria[1].id).toBe("AC-P4401-002");
		});

		it("should parse partial object criteria", () => {
			const criteria = parseRawCriteria("P44.01", [
				{ description: "Custom", level: "blocking" },
			]);
			expect(criteria).toHaveLength(1);
			expect(criteria[0].level).toBe("blocking");
		});
	});

	describe("buildTraceabilityReport", () => {
		it("should build a formatted traceability report", () => {
			const criteria = [createCriterion("AC-P4401-001", "Test criterion")];
			const evidence = [makeEvidenceEntry("EV-P4401-001", "Test evidence")];
			const links = [createTraceabilityLink("AC-P4401-001", "EV-P4401-001", "proves", "Evidence proves criterion")];

			const report = buildTraceabilityReport(criteria, evidence, links);
			expect(report).toContain("Traceability Report");
			expect(report).toContain("AC-P4401-001");
			expect(report).toContain("EV-P4401-001");
		});

		it("should handle missing evidence entries", () => {
			const criteria = [createCriterion("AC-P4401-001", "Test criterion")];
			const links = [createTraceabilityLink("AC-P4401-001", "EV-MISSING", "proves")];

			const report = buildTraceabilityReport(criteria, [], links);
			expect(report).toContain("(unknown)");
		});
	});
});
