/**
 * Schema Validator Tests
 *
 * Verifies common and report-specific schema validation.
 */
import { describe, expect, it } from "vitest";
import type { AccpParsedReport } from "../src/parser/yaml-parser.js";
import { validateCommonSchema } from "../src/validation/common-schema-validator.js";
import { validateReportSchema } from "../src/validation/report-schema-validator.js";

describe("ACCP Schema Validator", () => {
	// ---------------------------------------------------------------------------
	// Common schema — positive
	// ---------------------------------------------------------------------------

	it("should validate a minimal valid parsed report", () => {
		const parsed: AccpParsedReport = {
			accpVersion: "2.0.0",
			sourceFormat: "ACCP-YAML",
			report: { id: "TEST_001", type: "TVR", family: "core" },
			sections: {},
		};
		const diagnostics = validateCommonSchema(parsed);
		expect(diagnostics).toHaveLength(0);
	});

	// ---------------------------------------------------------------------------
	// Common schema — negative
	// ---------------------------------------------------------------------------

	it("should reject invalid accp_version", () => {
		const parsed: AccpParsedReport = {
			accpVersion: "1.0.0",
			sourceFormat: "ACCP-YAML",
			report: { id: "TEST_001", type: "TVR", family: "core" },
			sections: {},
		};
		const diagnostics = validateCommonSchema(parsed);
		expect(diagnostics.some((d) => d.fatal)).toBe(true);
		expect(diagnostics[0].code).toBe("ACCP_SCHEMA_INVALID_ACCP_VERSION");
	});

	it("should reject invalid source_format", () => {
		const parsed: AccpParsedReport = {
			accpVersion: "2.0.0",
			sourceFormat: "MARKDOWN",
			report: { id: "TEST_001", type: "TVR", family: "core" },
			sections: {},
		};
		const diagnostics = validateCommonSchema(parsed);
		expect(diagnostics.some((d) => d.fatal)).toBe(true);
	});

	it("should reject missing report.id", () => {
		const parsed: AccpParsedReport = {
			accpVersion: "2.0.0",
			sourceFormat: "ACCP-YAML",
			report: { id: "", type: "TVR", family: "core" },
			sections: {},
		};
		const diagnostics = validateCommonSchema(parsed);
		expect(diagnostics.some((d) => d.code === "ACCP_SCHEMA_REPORT_ID_MISSING")).toBe(true);
	});

	// ---------------------------------------------------------------------------
	// Report-specific schema — positive
	// ---------------------------------------------------------------------------

	it("should pass TVR validation with required sections", () => {
		const diagnostics = validateReportSchema("TVR", {
			validation_summary: { status: "passed" },
			command_results: [{ commandRef: "CMD-TEST" }],
		});
		expect(diagnostics.some((d) => d.fatal)).toBe(false);
	});

	it("should pass PRR validation with required section", () => {
		const diagnostics = validateReportSchema("PRR", {
			promotion_decision: { status: "ready" },
		});
		expect(diagnostics.some((d) => d.fatal)).toBe(false);
	});

	it("should pass for non-strict types with no sections", () => {
		const diagnostics = validateReportSchema("FER", {});
		expect(diagnostics.some((d) => d.fatal)).toBe(false);
	});

	// ---------------------------------------------------------------------------
	// Report-specific schema — negative
	// ---------------------------------------------------------------------------

	it("should reject TVR report missing validation_summary", () => {
		const diagnostics = validateReportSchema("TVR", {
			command_results: [],
		});
		expect(diagnostics.some((d) => d.fatal)).toBe(true);
		expect(diagnostics.some((d) => d.message.includes("validation_summary"))).toBe(true);
	});

	it("should reject TVR report missing command_results", () => {
		const diagnostics = validateReportSchema("TVR", {
			validation_summary: { status: "passed" },
		});
		expect(diagnostics.some((d) => d.fatal)).toBe(true);
	});

	it("should reject PRR report missing promotion_decision", () => {
		const diagnostics = validateReportSchema("PRR", {});
		expect(diagnostics.some((d) => d.fatal)).toBe(true);
	});

	it("should emit a warning (not fatal) for BSR without bug_findings", () => {
		const diagnostics = validateReportSchema("BSR", {});
		expect(diagnostics.some((d) => d.fatal === false)).toBe(true);
	});
});
