/**
 * PlanSpec ACCP v2.0 Authority Boundary Extension Tests
 *
 * Verifies the ACCP types, defaults, and authority semantics.
 * Negative tests ensure route signals cannot bypass PlanSpec authority.
 */

import type { AccpMode, PlanSpecAccpExtension, PlanSpecAccpRequirements } from "@earendil-works/pi-execution-contracts";
import {
	DEFAULT_ACCP_EXTENSION,
	DEFAULT_ACCP_MODE_POLICY,
	DEFAULT_ACCP_PROTOCOL,
	DEFAULT_ACCP_REQUIREMENTS,
	DEFAULT_REPORT_REQUIREMENTS,
} from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";

describe("ACCP PlanSpec Authority Boundary", () => {
	// ---------------------------------------------------------------------------
	// Positive tests — types and defaults
	// ---------------------------------------------------------------------------

	it("should define ACCP modes as union type", () => {
		const off: AccpMode = "off";
		const warn: AccpMode = "warn";
		const required: AccpMode = "required";
		expect([off, warn, required]).toContain("off");
		expect([off, warn, required]).toContain("warn");
		expect([off, warn, required]).toContain("required");
	});

	it("should have a default mode policy with required as initial default", () => {
		expect(DEFAULT_ACCP_MODE_POLICY.default).toBe("required");
	});

	it("should allow warn and required in the default policy", () => {
		expect(DEFAULT_ACCP_MODE_POLICY.allowed).not.toContain("off");
		expect(DEFAULT_ACCP_MODE_POLICY.allowed).toContain("warn");
		expect(DEFAULT_ACCP_MODE_POLICY.allowed).toContain("required");
	});

	it("should require operator approval and gauntlet pass for promotion to required", () => {
		expect(DEFAULT_ACCP_MODE_POLICY.promotionToRequiredRequires).toContain("operator_approval");
		expect(DEFAULT_ACCP_MODE_POLICY.promotionToRequiredRequires).toContain("all_waves_passed");
		expect(DEFAULT_ACCP_MODE_POLICY.promotionToRequiredRequires).toContain("e2e_gauntlets_passed");
	});

	it("should default to route signals being advisory", () => {
		expect(DEFAULT_ACCP_REQUIREMENTS.routeSignalsAreAdvisory).toBe(true);
	});

	it("should default to runtime authority required", () => {
		expect(DEFAULT_ACCP_REQUIREMENTS.runtimeAuthorityRequired).toBe(true);
	});

	it("should not force ACCP compilation by default", () => {
		expect(DEFAULT_ACCP_REQUIREMENTS.compileRequired).toBe(false);
	});

	it("should have ACCP 2.0.0 as the default protocol", () => {
		expect(DEFAULT_ACCP_PROTOCOL.protocol).toBe("ACCP");
		expect(DEFAULT_ACCP_PROTOCOL.version).toBe("2.0.0");
		expect(DEFAULT_ACCP_PROTOCOL.sourceFormat).toBe("ACCP-YAML");
	});

	it("should include ACCP mechanisms in the default extension", () => {
		expect(DEFAULT_ACCP_EXTENSION.accpMechanisms).toContain("accp_v2_yaml_parser");
		expect(DEFAULT_ACCP_EXTENSION.accpMechanisms).toContain("accp_route_signal_compiler");
	});

	it("should include ACCP diagnostic families", () => {
		expect(DEFAULT_ACCP_EXTENSION.accpDiagnosticFamilies).toContain("ACCP_PARSE");
		expect(DEFAULT_ACCP_EXTENSION.accpDiagnosticFamilies).toContain("ACCP_AUTHORITY");
		expect(DEFAULT_ACCP_EXTENSION.accpDiagnosticFamilies).toContain("ACCP_GATE");
	});

	it("should not require any reports by default", () => {
		expect(DEFAULT_REPORT_REQUIREMENTS.required).toEqual([]);
	});

	it("should not block completion by default", () => {
		expect(DEFAULT_REPORT_REQUIREMENTS.blocksCompletion).toBe(false);
	});

	// ---------------------------------------------------------------------------
	// Negative tests — authority boundaries
	// ---------------------------------------------------------------------------

	it("should enforce that PlanSpec does NOT choose the next ACCP mode", () => {
		// The extension fields have no nextMode or nextRoute property.
		// This test verifies structural absence of routing fields.
		const ext: PlanSpecAccpRequirements = DEFAULT_ACCP_REQUIREMENTS;
		expect("nextMode" in ext).toBe(false);
		expect("nextRoute" in ext).toBe(false);
		expect("recommendedNextAction" in ext).toBe(false);
	});

	it("should enforce that route signals do NOT authorize mutation by themselves", () => {
		// The extension does not declare any mutation authorization field.
		const ext: PlanSpecAccpExtension = DEFAULT_ACCP_EXTENSION;
		expect("routeSignalAuthorizesMutation" in ext).toBe(false);
		expect("routeSignalAuthorizesExecution" in ext).toBe(false);
	});

	it("should require route signals be advisory when runtimeAuthorityRequired is true", () => {
		// If runtimeAuthorityRequired is true, routeSignalsAreAdvisory must also be true
		// for the configuration to be internally consistent.
		if (DEFAULT_ACCP_REQUIREMENTS.runtimeAuthorityRequired) {
			expect(DEFAULT_ACCP_REQUIREMENTS.routeSignalsAreAdvisory).toBe(true);
		}
	});

	it("should not promote to required without operator approval gate", () => {
		// Remove operator_approval from the requirements list — should not happen
		// with the default config.
		expect(DEFAULT_ACCP_MODE_POLICY.promotionToRequiredRequires.some((r: string) => r === "operator_approval")).toBe(
			true,
		);
		expect(DEFAULT_ACCP_MODE_POLICY.promotionToRequiredRequires.some((r: string) => r === "all_waves_passed")).toBe(
			true,
		);
	});
});
