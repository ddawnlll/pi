/**
 * Unit tests for Acceptance Criteria & Traceability Schema.
 *
 * These tests cover the core types, helper functions, and the
 * AcceptanceCriteriaRegistry. Integration with the EvidenceLedger
 * and WorkerReportContract is tested in their respective test files.
 */

import { describe, expect, it } from "vitest";
import {
	ACCEPTANCE_CRITERIA_SCHEMA_VERSION,
	AcceptanceCriteriaRegistry,
	aggregateCriterionStatus,
	buildTraceabilityReport,
	createCriterion,
	createRegistryFromPlan,
	createTraceabilityLink,
	formatBlockingReasons,
	formatCriterionId,
	getBlockingCriteria,
	isCriterionBlocking,
	parseRawCriteria,
} from "../../src/core/completion/acceptance-criteria.js";
import type { EvidenceLedgerEntry } from "../../src/core/completion/evidence-types.js";

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
// Schema Constants
// ---------------------------------------------------------------------------

describe("Schema Constants", () => {
	it("should export schema version constant", () => {
		expect(ACCEPTANCE_CRITERIA_SCHEMA_VERSION).toBe("1.0.0");
	});
});

// ---------------------------------------------------------------------------
// formatCriterionId
// ---------------------------------------------------------------------------

describe("formatCriterionId", () => {
	it("should generate IDs with AC prefix and zero-padded sequence", () => {
		expect(formatCriterionId("P4401", 1)).toBe("AC-P4401-001");
		expect(formatCriterionId("P44.01", 1)).toBe("AC-P4401-001");
		expect(formatCriterionId("p44_02", 12)).toBe("AC-P4402-012");
		expect(formatCriterionId("P44.01", 123)).toBe("AC-P4401-123");
	});

	it("should normalize non-alphanumeric characters", () => {
		expect(formatCriterionId("P44-01", 1)).toBe("AC-P4401-001");
		expect(formatCriterionId("P$44.01!", 1)).toBe("AC-P4401-001");
	});

	it("should uppercase the prefix", () => {
		expect(formatCriterionId("p44.01", 1)).toBe("AC-P4401-001");
	});
});

// ---------------------------------------------------------------------------
// createCriterion
// ---------------------------------------------------------------------------

describe("createCriterion", () => {
	it("should create a criterion with defaults", () => {
		const c = createCriterion("AC-P4401-001", "Default criterion");
		expect(c.id).toBe("AC-P4401-001");
		expect(c.description).toBe("Default criterion");
		expect(c.level).toBe("required");
		expect(c.category).toBe("functional");
		expect(c.evidenceRequired).toBe(true);
		expect(c.verificationStatus).toBe("unverified");
		expect(c.evidenceIds).toEqual([]);
		expect(c.verifierNotes).toBe("");
		expect(c.verifiedAt).toBeNull();
		expect(c.verifiedBy).toBe("");
	});

	it("should apply overrides", () => {
		const c = createCriterion("AC-P4401-002", "Custom criterion", {
			level: "blocking",
			category: "safety",
			evidenceRequired: false,
			metadata: { custom: true },
		});
		expect(c.level).toBe("blocking");
		expect(c.category).toBe("safety");
		expect(c.evidenceRequired).toBe(false);
		expect(c.metadata).toEqual({ custom: true });
	});

	it("should accept partial overrides keeping defaults for others", () => {
		const c = createCriterion("AC-P4401-003", "Partial override", { level: "nice_to_have" });
		expect(c.level).toBe("nice_to_have");
		expect(c.category).toBe("functional"); // default
		expect(c.evidenceRequired).toBe(true); // default
	});
});

// ---------------------------------------------------------------------------
// isCriterionBlocking
// ---------------------------------------------------------------------------

describe("isCriterionBlocking", () => {
	it("should return true for failed criteria regardless of level", () => {
		expect(isCriterionBlocking(createCriterion("AC-001", "fail", { verificationStatus: "failed" }))).toBe(true);
		expect(
			isCriterionBlocking(
				createCriterion("AC-002", "fail nice", {
					level: "nice_to_have",
					verificationStatus: "failed",
				}),
			),
		).toBe(true);
	});

	it("should return true for blocking-level unverified", () => {
		const c = createCriterion("AC-003", "blocking", { level: "blocking", verificationStatus: "unverified" });
		expect(isCriterionBlocking(c)).toBe(true);
	});

	it("should return true for required-level unverified", () => {
		const c = createCriterion("AC-004", "required", { level: "required", verificationStatus: "unverified" });
		expect(isCriterionBlocking(c)).toBe(true);
	});

	it("should return false for satisfied criteria", () => {
		const c = createCriterion("AC-005", "satisfied", { verificationStatus: "satisfied" });
		expect(isCriterionBlocking(c)).toBe(false);
	});

	it("should return false for nice_to_have unverified", () => {
		const c = createCriterion("AC-006", "nice", {
			level: "nice_to_have",
			verificationStatus: "unverified",
		});
		expect(isCriterionBlocking(c)).toBe(false);
	});

	it("should return false for nice_to_have in_progress", () => {
		const c = createCriterion("AC-007", "in progress nice", {
			level: "nice_to_have",
			verificationStatus: "in_progress",
		});
		expect(isCriterionBlocking(c)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// aggregateCriterionStatus
// ---------------------------------------------------------------------------

describe("aggregateCriterionStatus", () => {
	it("should return satisfied when all criteria are satisfied", () => {
		const criteria = [
			createCriterion("AC-001", "a", { verificationStatus: "satisfied" }),
			createCriterion("AC-002", "b", { verificationStatus: "satisfied" }),
		];
		expect(aggregateCriterionStatus(criteria)).toBe("satisfied");
	});

	it("should return failed when a required criterion fails", () => {
		const criteria = [
			createCriterion("AC-001", "pass", { verificationStatus: "satisfied" }),
			createCriterion("AC-002", "fail", { verificationStatus: "failed" }),
		];
		expect(aggregateCriterionStatus(criteria)).toBe("failed");
	});

	it("should return failed when a blocking criterion fails", () => {
		const criteria = [
			createCriterion("AC-001", "fail", {
				level: "blocking",
				verificationStatus: "failed",
			}),
		];
		expect(aggregateCriterionStatus(criteria)).toBe("failed");
	});

	it("should NOT return failed for nice_to_have failed criteria", () => {
		const criteria = [
			createCriterion("AC-001", "required pass", { verificationStatus: "satisfied" }),
			createCriterion("AC-002", "nice fail", {
				level: "nice_to_have",
				verificationStatus: "failed",
			}),
		];
		expect(aggregateCriterionStatus(criteria)).toBe("satisfied");
	});

	it("should return in_progress when any criterion is in progress", () => {
		const criteria = [
			createCriterion("AC-001", "done", { verificationStatus: "satisfied" }),
			createCriterion("AC-002", "in prog", { verificationStatus: "in_progress" }),
		];
		expect(aggregateCriterionStatus(criteria)).toBe("in_progress");
	});

	it("should return unverified when an evidence-required criterion is unverified", () => {
		const criteria = [createCriterion("AC-001", "unverified", { verificationStatus: "unverified" })];
		expect(aggregateCriterionStatus(criteria)).toBe("unverified");
	});

	it("should ignore nice_to_have unverified criteria", () => {
		const criteria = [
			createCriterion("AC-001", "required satisfied", { verificationStatus: "satisfied" }),
			createCriterion("AC-002", "nice to have", {
				level: "nice_to_have",
				verificationStatus: "unverified",
			}),
		];
		expect(aggregateCriterionStatus(criteria)).toBe("satisfied");
	});

	it("should ignore nice_to_have unverified even with evidence required", () => {
		const criteria = [
			createCriterion("AC-001", "done", { verificationStatus: "satisfied" }),
			createCriterion("AC-002", "nice unverified", {
				level: "nice_to_have",
				verificationStatus: "unverified",
				evidenceRequired: true,
			}),
		];
		expect(aggregateCriterionStatus(criteria)).toBe("satisfied");
	});

	it("should return satisfied for empty criteria array", () => {
		expect(aggregateCriterionStatus([])).toBe("satisfied");
	});
});

// ---------------------------------------------------------------------------
// getBlockingCriteria
// ---------------------------------------------------------------------------

describe("getBlockingCriteria", () => {
	it("should return only blocking criteria", () => {
		const criteria = [
			createCriterion("AC-001", "satisfied", { verificationStatus: "satisfied" }),
			createCriterion("AC-002", "failed", { verificationStatus: "failed" }),
			createCriterion("AC-003", "unverified", { verificationStatus: "unverified" }),
			createCriterion("AC-004", "nice", {
				level: "nice_to_have",
				verificationStatus: "unverified",
			}),
		];
		const blocking = getBlockingCriteria(criteria);
		expect(blocking).toHaveLength(2);
		expect(blocking.map((c) => c.id)).toEqual(["AC-002", "AC-003"]);
	});

	it("should return empty array when nothing is blocking", () => {
		const criteria = [createCriterion("AC-001", "done", { verificationStatus: "satisfied" })];
		expect(getBlockingCriteria(criteria)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// formatBlockingReasons
// ---------------------------------------------------------------------------

describe("formatBlockingReasons", () => {
	it("should format failed reasons", () => {
		const criteria = [createCriterion("AC-001", "It broke", { verificationStatus: "failed" })];
		const reasons = formatBlockingReasons(criteria);
		expect(reasons[0]).toContain("AC-001");
		expect(reasons[0]).toContain("failed");
		expect(reasons[0]).toContain("It broke");
	});

	it("should format unverified reasons", () => {
		const criteria = [createCriterion("AC-002", "Not checked", { verificationStatus: "unverified" })];
		const reasons = formatBlockingReasons(criteria);
		expect(reasons[0]).toContain("unverified");
		expect(reasons[0]).toContain("Not checked");
	});

	it("should return empty array for non-blocking criteria", () => {
		const criteria = [
			createCriterion("AC-003", "done", { verificationStatus: "satisfied" }),
			createCriterion("AC-004", "nice", {
				level: "nice_to_have",
				verificationStatus: "unverified",
			}),
		];
		expect(formatBlockingReasons(criteria)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Traceability Links (from traceability-schema)
// ---------------------------------------------------------------------------

describe("createTraceabilityLink", () => {
	it("should create a link with defaults", () => {
		const link = createTraceabilityLink("AC-001", "EV-001");
		expect(link.criterionId).toBe("AC-001");
		expect(link.evidenceId).toBe("EV-001");
		expect(link.relationship).toBe("proves");
		expect(link.explanation).toBe("");
		expect(link.createdAt).toBeGreaterThan(0);
	});

	it("should create a link with custom relationship and explanation", () => {
		const link = createTraceabilityLink("AC-001", "EV-001", "supports", "Partially proves");
		expect(link.relationship).toBe("supports");
		expect(link.explanation).toBe("Partially proves");
	});
});

// ---------------------------------------------------------------------------
// buildTraceabilityReport
// ---------------------------------------------------------------------------

describe("buildTraceabilityReport", () => {
	it("should build a report with criteria, evidence and links", () => {
		const criteria = [createCriterion("AC-P4401-001", "Test criterion")];
		const evidence = [makeEvidenceEntry("EV-P4401-001", "Test evidence")];
		const links = [createTraceabilityLink("AC-P4401-001", "EV-P4401-001", "proves", "Evidence proves criterion")];

		const report = buildTraceabilityReport(criteria, evidence, links);
		expect(report).toContain("Traceability Report");
		expect(report).toContain("AC-P4401-001");
		expect(report).toContain("Test criterion");
		expect(report).toContain("EV-P4401-001");
		expect(report).toContain("proves");
	});

	it("should handle missing evidence entries", () => {
		const criteria = [createCriterion("AC-P4401-001", "Test criterion")];
		const links = [createTraceabilityLink("AC-P4401-001", "EV-MISSING", "proves")];

		const report = buildTraceabilityReport(criteria, [], links);
		expect(report).toContain("(unknown)");
	});

	it("should handle criteria with no links", () => {
		const criteria = [createCriterion("AC-P4401-001", "No links")];
		const report = buildTraceabilityReport(criteria, [], []);
		expect(report).toContain("No traceability links");
	});

	it("should handle empty criteria", () => {
		const report = buildTraceabilityReport([], [], []);
		expect(report).toContain("Traceability Report");
		expect(report).toContain("Criteria: 0");
	});
});

// ---------------------------------------------------------------------------
// AcceptanceCriteriaRegistry
// ---------------------------------------------------------------------------

describe("AcceptanceCriteriaRegistry", () => {
	it("should create registry with scope", () => {
		const registry = new AcceptanceCriteriaRegistry("test-scope");
		expect(registry.scope).toBe("test-scope");
	});

	it("should register and retrieve criteria", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(createCriterion("AC-001", "First"));
		expect(registry.get("AC-001")?.description).toBe("First");
		expect(registry.getAll()).toHaveLength(1);
	});

	it("should reject duplicate IDs", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(createCriterion("AC-001", "First"));
		expect(() => registry.register(createCriterion("AC-001", "Duplicate"))).toThrow("already registered");
	});

	it("should update verification status", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(createCriterion("AC-001", "Test"));
		registry.updateStatus("AC-001", "satisfied", "All good", "tester");
		const c = registry.get("AC-001")!;
		expect(c.verificationStatus).toBe("satisfied");
		expect(c.verifierNotes).toBe("All good");
		expect(c.verifiedBy).toBe("tester");
		expect(c.verifiedAt).not.toBeNull();
	});

	it("should throw on update for unknown ID", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		expect(() => registry.updateStatus("AC-MISSING", "satisfied")).toThrow("not found");
	});

	it("should mark satisfied with evidence link", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(createCriterion("AC-001", "Test"));
		registry.markSatisfied("AC-001", "EV-001", "Proven", "tester");
		const c = registry.get("AC-001")!;
		expect(c.verificationStatus).toBe("satisfied");
		expect(c.evidenceIds).toContain("EV-001");
	});

	it("should mark failed", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(createCriterion("AC-001", "Test"));
		registry.markFailed("AC-001", "Reason", "tester");
		const c = registry.get("AC-001")!;
		expect(c.verificationStatus).toBe("failed");
		expect(c.verifierNotes).toBe("Reason");
	});

	it("should add evidence link without duplication", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(createCriterion("AC-001", "Test"));
		registry.addEvidenceLink("AC-001", "EV-001");
		registry.addEvidenceLink("AC-001", "EV-001"); // duplicate
		expect(registry.get("AC-001")!.evidenceIds).toHaveLength(1);
	});

	it("should throw on addEvidenceLink for unknown ID", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		expect(() => registry.addEvidenceLink("AC-MISSING", "EV-001")).toThrow("not found");
	});

	it("should filter by level", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(
			createCriterion("AC-001", "Required"),
			createCriterion("AC-002", "Nice", { level: "nice_to_have" }),
			createCriterion("AC-003", "Blocking", { level: "blocking" }),
		);
		expect(registry.getByLevel("required")).toHaveLength(1);
		expect(registry.getByLevel("blocking")).toHaveLength(1);
		expect(registry.getByLevel("nice_to_have")).toHaveLength(1);
	});

	it("should filter by status", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(
			createCriterion("AC-001", "Done", { verificationStatus: "satisfied" }),
			createCriterion("AC-002", "Pending", { verificationStatus: "unverified" }),
			createCriterion("AC-003", "Fail", { verificationStatus: "failed" }),
		);
		expect(registry.getByStatus("satisfied")).toHaveLength(1);
		expect(registry.getByStatus("unverified")).toHaveLength(1);
		expect(registry.getByStatus("failed")).toHaveLength(1);
	});

	it("should manage traceability links", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(createCriterion("AC-001", "Test"), createCriterion("AC-002", "Test 2"));

		const link = createTraceabilityLink("AC-001", "EV-001", "proves", "Evidence link");
		registry.addTraceabilityLink(link);

		expect(registry.getTraceabilityLinks()).toHaveLength(1);
		expect(registry.getLinksForCriterion("AC-001")).toHaveLength(1);
		expect(registry.getLinksForCriterion("AC-002")).toHaveLength(0);
	});

	it("should detect blocking criteria", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(
			createCriterion("AC-001", "Good", { verificationStatus: "satisfied" }),
			createCriterion("AC-002", "Bad", { verificationStatus: "failed" }),
		);
		expect(registry.getBlocking()).toHaveLength(1);
		expect(registry.getAggregateStatus()).toBe("failed");
		expect(registry.isComplete()).toBe(false);
	});

	it("should report completeness correctly", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(
			createCriterion("AC-001", "One", { verificationStatus: "satisfied" }),
			createCriterion("AC-002", "Two", { verificationStatus: "satisfied" }),
		);
		expect(registry.isComplete()).toBe(true);
		expect(registry.getBlockingReasons()).toHaveLength(0);
	});

	it("should serialize to JSON with correct structure", () => {
		const registry = new AcceptanceCriteriaRegistry("test-scope");
		registry.register(createCriterion("AC-001", "Test", { verificationStatus: "satisfied" }));
		const json = registry.toJSON();
		expect(json.scopeId).toBe("test-scope");
		expect(json.schemaVersion).toBe("1.0.0");
		expect(json.total).toBe(1);
		expect(json.satisfied).toBe(1);
		expect(json.failed).toBe(0);
		expect(json.unverified).toBe(0);
		expect(json.inProgress).toBe(0);
		expect(json.blocking).toBe(0);
		expect(json.complete).toBe(true);
		expect(json.aggregateStatus).toBe("satisfied");
		expect(json.criteria).toHaveLength(1);
		expect(json.traceabilityLinks).toEqual([]);
	});

	it("should build a traceability report from registry state", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(createCriterion("AC-001", "Test", { verificationStatus: "satisfied" }));
		const evidence = [makeEvidenceEntry("EV-001", "Evidence")];
		registry.addTraceabilityLink(createTraceabilityLink("AC-001", "EV-001", "proves"));

		const report = registry.buildReport(evidence);
		expect(report).toContain("AC-001");
		expect(report).toContain("EV-001");
	});

	it("should clear all state", () => {
		const registry = new AcceptanceCriteriaRegistry("test");
		registry.register(createCriterion("AC-001", "Test"));
		registry.addTraceabilityLink(createTraceabilityLink("AC-001", "EV-001", "proves"));
		registry.clear();
		expect(registry.getAll()).toHaveLength(0);
		expect(registry.getTraceabilityLinks()).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Factory Helpers
// ---------------------------------------------------------------------------

describe("createRegistryFromPlan", () => {
	it("should create registry from string array", () => {
		const registry = createRegistryFromPlan("P44.01", ["AC 1", "AC 2"]);
		expect(registry.getAll()).toHaveLength(2);
		expect(registry.getAll()[0].level).toBe("required");
		expect(registry.getAll()[0].category).toBe("functional");
	});

	it("should handle empty array", () => {
		const registry = createRegistryFromPlan("P44.01", []);
		expect(registry.getAll()).toHaveLength(0);
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
		const criteria = parseRawCriteria("P44.01", [{ description: "Custom", level: "blocking" }]);
		expect(criteria).toHaveLength(1);
		expect(criteria[0].id).toBe("AC-P4401-001");
		expect(criteria[0].description).toBe("Custom");
		expect(criteria[0].level).toBe("blocking");
	});

	it("should parse mixed string and object criteria", () => {
		const criteria = parseRawCriteria("P44.01", ["Simple", { description: "Complex", category: "quality" }]);
		expect(criteria).toHaveLength(2);
		expect(criteria[0].id).toBe("AC-P4401-001");
		expect(criteria[1].id).toBe("AC-P4401-002");
		expect(criteria[0].description).toBe("Simple");
		expect(criteria[1].description).toBe("Complex");
		expect(criteria[1].category).toBe("quality");
	});

	it("should use custom start sequence", () => {
		const criteria = parseRawCriteria("P44.01", ["First"], 10);
		expect(criteria[0].id).toBe("AC-P4401-010");
	});
});
