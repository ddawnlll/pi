/**
 * ACCP ID, Reference, and Lineage Validator Tests
 */
import { describe, expect, it } from "vitest";
import { validateReportId, validateUniqueIds } from "../src/validation/id-validator.js";
import type { ReportLineage } from "../src/validation/lineage-validator.js";
import { validateLineage } from "../src/validation/lineage-validator.js";
import { validateReference, validateReferences } from "../src/validation/reference-validator.js";

describe("ACCP ID Validator", () => {
	it("should accept a valid report ID", () => {
		const diags = validateReportId("P49_TVR_001");
		expect(diags).toHaveLength(0);
	});

	it("should reject an empty ID", () => {
		const diags = validateReportId("");
		expect(diags.some((d) => d.fatal)).toBe(true);
	});

	it("should reject a malformed ID (lowercase)", () => {
		const diags = validateReportId("p49_tvr_001");
		expect(diags.some((d) => d.fatal)).toBe(true);
	});

	it("should accept IDs with underscores and numbers", () => {
		const diags = validateReportId("P49_01_IPR_001");
		expect(diags).toHaveLength(0);
	});

	it("should reject very long IDs", () => {
		const diags = validateReportId("A" + "X".repeat(100));
		expect(diags.some((d) => d.fatal)).toBe(true);
	});

	it("should detect duplicate IDs", () => {
		const diags = validateUniqueIds(["A", "B", "A"]);
		expect(diags.some((d) => d.code === "ACCP_ID_DUPLICATE")).toBe(true);
		expect(diags.length).toBe(1);
	});

	it("should pass unique IDs", () => {
		const diags = validateUniqueIds(["A", "B", "C"]);
		expect(diags).toHaveLength(0);
	});
});

describe("ACCP Reference Validator", () => {
	const knownIds = new Set(["P49_TVR_001", "P49_IPR_001", "P49_BSR_001"]);

	it("should accept a valid report ID reference", () => {
		const diags = validateReference("P49_TVR_001", knownIds);
		expect(diags).toHaveLength(0);
	});

	it("should reject an unresolved reference", () => {
		const diags = validateReference("UNKNOWN_REF", knownIds);
		expect(diags.some((d) => d.code === "ACCP_REF_UNRESOLVED")).toBe(true);
	});

	it("should accept a short ref that resolves", () => {
		const diags = validateReference("#TVR_001", new Set(["TVR_001"]));
		expect(diags).toHaveLength(0);
	});

	it("should reject an unresolved short ref", () => {
		const diags = validateReference("#UNKNOWN", knownIds);
		expect(diags.some((d) => d.fatal)).toBe(true);
	});

	it("should reject an empty reference", () => {
		const diags = validateReference("", knownIds);
		expect(diags.some((d) => d.fatal)).toBe(true);
	});

	it("should validate multiple references", () => {
		const diags = validateReferences(["P49_TVR_001", "UNKNOWN_REF"], knownIds);
		expect(diags.length).toBe(1);
	});
});

describe("ACCP Lineage Validator", () => {
	const knownIds = new Set(["A", "B", "C", "D"]);

	it("should pass valid lineage with no cycles", () => {
		const lineages: ReportLineage[] = [
			{ reportId: "B", parentReport: "A" },
			{ reportId: "C", parentReport: "B" },
		];
		const diags = validateLineage(lineages, knownIds);
		expect(diags).toHaveLength(0);
	});

	it("should reject self-cycle (parent)", () => {
		const lineages: ReportLineage[] = [{ reportId: "A", parentReport: "A" }];
		const diags = validateLineage(lineages, knownIds);
		expect(diags.some((d) => d.fatal)).toBe(true);
	});

	it("should reject self-cycle (supersedes)", () => {
		const lineages: ReportLineage[] = [{ reportId: "A", supersedes: "A" }];
		const diags = validateLineage(lineages, knownIds);
		expect(diags.some((d) => d.fatal)).toBe(true);
	});

	it("should reject unresolved parent reference", () => {
		const lineages: ReportLineage[] = [{ reportId: "B", parentReport: "UNKNOWN" }];
		const diags = validateLineage(lineages, knownIds);
		expect(diags.some((d) => d.code === "ACCP_REF_UNRESOLVED")).toBe(true);
	});

	it("should detect A<->B cycle", () => {
		const lineages: ReportLineage[] = [
			{ reportId: "A", parentReport: "B" },
			{ reportId: "B", parentReport: "A" },
		];
		const diags = validateLineage(lineages, knownIds);
		expect(diags.some((d) => d.fatal)).toBe(true);
	});
});
