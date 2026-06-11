/**
 * ACCP Report Registry Tests
 *
 * Verifies the 24-type registry, support matrix, and lookup helpers.
 */

import type { AccpReportType } from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";
import {
	ACCP_REPORT_REGISTRY,
	ACCP_REPORT_REGISTRY_BY_TYPE,
	getGateCriticalReportTypes,
	getReportTypesByFamily,
	getReportTypesBySupportLevel,
	isKnownReportType,
	lookupReportType,
} from "../src/registry/report-registry.js";
import { ACCP_GATE_CRITICAL_TYPES, getSupportLevel } from "../src/registry/support-matrix.js";

describe("ACCP Report Registry", () => {
	// ---------------------------------------------------------------------------
	// Positive tests
	// ---------------------------------------------------------------------------

	it("should have exactly 24 report types", () => {
		expect(ACCP_REPORT_REGISTRY.length).toBe(24);
	});

	it("should include all core report types", () => {
		const core = getReportTypesByFamily("core");
		const codes = core.map((e) => e.type);
		expect(codes).toContain("RIR");
		expect(codes).toContain("PIR");
		expect(codes).toContain("IPR");
		expect(codes).toContain("TVR");
		expect(codes).toContain("HIR");
		expect(codes).toContain("RAR");
		expect(codes).toContain("PRR");
		expect(codes).toContain("CAR");
		expect(core.length).toBe(8);
	});

	it("should include all bugfix report types", () => {
		const bugfix = getReportTypesByFamily("bugfix");
		const codes = bugfix.map((e) => e.type);
		expect(codes).toContain("BSR");
		expect(codes).toContain("BRR");
		expect(codes).toContain("RCA");
		expect(codes).toContain("FPR");
		expect(codes).toContain("FVR");
		expect(bugfix.length).toBe(5);
	});

	it("should include all feature report types", () => {
		const feature = getReportTypesByFamily("feature");
		expect(feature.length).toBe(5);
	});

	it("should include all writing report types", () => {
		const writing = getReportTypesByFamily("writing");
		expect(writing.length).toBe(4);
	});

	it("should include all coordination report types", () => {
		const coord = getReportTypesByFamily("coordination");
		expect(coord.length).toBe(2);
	});

	it("should look up by type code", () => {
		const entry = lookupReportType("TVR");
		expect(entry).toBeDefined();
		expect(entry!.name).toBe("Test Validation Report");
		expect(entry!.family).toBe("core");
	});

	it("should create a map with all 24 entries", () => {
		expect(ACCP_REPORT_REGISTRY_BY_TYPE.size).toBe(24);
	});

	it("should recognize known report types", () => {
		expect(isKnownReportType("BSR")).toBe(true);
		expect(isKnownReportType("PRR")).toBe(true);
		expect(isKnownReportType("ECR")).toBe(true);
	});

	it("should find gate-critical types", () => {
		const critical = getGateCriticalReportTypes();
		expect(critical.length).toBeGreaterThanOrEqual(6);
		expect(critical.some((e) => e.type === "TVR")).toBe(true);
		expect(critical.some((e) => e.type === "PRR")).toBe(true);
	});

	it("should find types by support level", () => {
		const strict = getReportTypesBySupportLevel("schema_strict");
		expect(strict.length).toBeGreaterThanOrEqual(6);
		const lite = getReportTypesBySupportLevel("schema_lite");
		expect(lite.length).toBeGreaterThanOrEqual(5);
	});

	it("should have 6 gate-critical strict types in support matrix", () => {
		expect(ACCP_GATE_CRITICAL_TYPES.length).toBe(6);
		expect(ACCP_GATE_CRITICAL_TYPES).toContain("BSR");
		expect(ACCP_GATE_CRITICAL_TYPES).toContain("FPR");
		expect(ACCP_GATE_CRITICAL_TYPES).toContain("TVR");
		expect(ACCP_GATE_CRITICAL_TYPES).toContain("PRR");
		expect(ACCP_GATE_CRITICAL_TYPES).toContain("HIR");
		expect(ACCP_GATE_CRITICAL_TYPES).toContain("CAR");
	});

	it("should get support level", () => {
		expect(getSupportLevel("TVR")).toBe("schema_strict");
		expect(getSupportLevel("RIR")).toBe("schema_lite");
		expect(getSupportLevel("FER")).toBe("template_available");
	});

	// ---------------------------------------------------------------------------
	// Negative tests
	// ---------------------------------------------------------------------------

	it("should return undefined for unknown type codes", () => {
		expect(lookupReportType("UNKNOWN")).toBeUndefined();
		expect(lookupReportType("XYZ")).toBeUndefined();
	});

	it("should not recognize unknown type codes", () => {
		expect(isKnownReportType("INVALID")).toBe(false);
		expect(isKnownReportType("")).toBe(false);
	});

	it("should return undefined support level for unknown types", () => {
		expect(getSupportLevel("UNKNOWN" as AccpReportType)).toBeUndefined();
	});

	it("should not have feature types as gate-critical", () => {
		const feature = getReportTypesByFamily("feature");
		for (const entry of feature) {
			expect(entry.gateCritical).toBe(false);
		}
	});

	it("should not have writing types as gate-critical", () => {
		const writing = getReportTypesByFamily("writing");
		for (const entry of writing) {
			expect(entry.gateCritical).toBe(false);
		}
	});
});
