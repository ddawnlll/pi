import { describe, expect, it } from "vitest";
import { normalizeCriteria } from "../../src/core/mode/acceptance-criteria-normalizer.js";
import { EngineMode } from "../../src/core/mode/engine-mode.js";

describe("normalizeCriteria", () => {
	it("returns criteria for write mode", () => {
		const result = normalizeCriteria(EngineMode.Write);
		expect(result.criteria.length).toBeGreaterThan(0);
		expect(result.criteria[0].id).toContain("AC-WRITE");
		expect(result.success).toBe(true);
	});

	it("returns criteria for edit mode", () => {
		const result = normalizeCriteria(EngineMode.Edit);
		expect(result.criteria.length).toBeGreaterThan(0);
		expect(result.criteria.some((c) => c.id === "AC-EDIT-001")).toBe(true);
	});

	it("returns criteria for smart_write mode", () => {
		const result = normalizeCriteria(EngineMode.SmartWrite);
		expect(result.criteria.some((c) => c.id === "AC-SMWRITE-001")).toBe(true);
	});

	it("returns criteria for smart_edit mode", () => {
		const result = normalizeCriteria(EngineMode.SmartEdit);
		expect(result.criteria.some((c) => c.id === "AC-SMEDIT-001")).toBe(true);
	});

	it("merges custom criteria", () => {
		const result = normalizeCriteria(EngineMode.Write, [
			{ id: "AC-CUSTOM-001", title: "Custom check", description: "Verify output" },
		]);
		expect(result.criteria.some((c) => c.id === "AC-CUSTOM-001")).toBe(true);
	});

	it("warns on custom criteria without ID", () => {
		const result = normalizeCriteria(EngineMode.Write, [
			{ title: "No ID" } as Partial<
				import("../../src/core/mode/acceptance-criteria-normalizer.js").NormalizedCriterion
			>,
		]);
		expect(result.diagnostics.length).toBeGreaterThan(0);
	});
});
