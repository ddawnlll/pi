import { describe, expect, it } from "vitest";
import type { AccpCapabilityProbeResult } from "../../src/core/p49_5/accp-capability-probe.js";
import { evaluateP45Readiness } from "../../src/core/p49_5/p45-readiness-certificate.js";
import type { P49ArtifactInventory } from "../../src/core/p49_5/p49-completion-inventory.js";

function mockInventory(missing: number = 0): P49ArtifactInventory {
	return {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		repoRoot: "/test",
		artifacts: {},
		summary: { total: 10, existing: 10 - missing, missing },
	};
}

function mockProbe(allGreen: boolean = true): AccpCapabilityProbeResult {
	return {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		compilerAvailable: allGreen,
		compilerCompilesValidFixture: allGreen,
		compilerRejectsInvalidFixture: allGreen,
		gateVerdictAvailable: allGreen,
		routeSignalAvailable: allGreen,
		artifactWriterAvailable: allGreen,
		reportValidatorAvailable: allGreen,
		evidenceLedgerAvailable: allGreen,
		completionGateV2Available: allGreen,
		modeReportValidatorAvailable: allGreen,
		runtimeReadsCompiledJsonOnly: allGreen,
		rawYamlNotAuthoritative: true,
		markdownNotAuthoritative: true,
		details: [],
	};
}

describe("P45ReadinessCertificate", () => {
	it("allows P45 when all green and dirty acceptable", () => {
		const result = evaluateP45Readiness({
			inventory: mockInventory(0),
			probe: mockProbe(true),
			dirtyRuntimeStatus: "acceptable",
			largePlanGuardedAllowed: true,
		});
		expect(result.decision).toBe("allow_p45");
		expect(result.blockingReasons).toEqual([]);
	});

	it("blocks P45 when P49 artifacts missing", () => {
		const result = evaluateP45Readiness({
			inventory: mockInventory(3),
			probe: mockProbe(true),
			dirtyRuntimeStatus: "acceptable",
			largePlanGuardedAllowed: true,
		});
		expect(result.decision).toBe("block_p45");
		expect(result.blockingReasons.length).toBeGreaterThan(0);
	});

	it("blocks P45 when compiler unavailable", () => {
		const result = evaluateP45Readiness({
			inventory: mockInventory(0),
			probe: mockProbe(false),
			dirtyRuntimeStatus: "acceptable",
			largePlanGuardedAllowed: true,
		});
		expect(result.decision).toBe("block_p45");
	});

	it("emits allow_fixture_only when dirty runtime unknown", () => {
		const result = evaluateP45Readiness({
			inventory: mockInventory(0),
			probe: mockProbe(true),
			dirtyRuntimeStatus: "unknown",
			largePlanGuardedAllowed: true,
		});
		expect(result.decision).toBe("allow_fixture_only");
	});

	it("emits block_p45 when dirty runtime blocking", () => {
		const result = evaluateP45Readiness({
			inventory: mockInventory(0),
			probe: mockProbe(true),
			dirtyRuntimeStatus: "blocking",
			largePlanGuardedAllowed: true,
		});
		expect(result.decision).toBe("block_p45");
	});

	it("includes evidence hashes", () => {
		const result = evaluateP45Readiness({
			inventory: mockInventory(0),
			probe: mockProbe(true),
			dirtyRuntimeStatus: "acceptable",
			largePlanGuardedAllowed: true,
		});
		expect(result.evidenceHashes.inventoryHash).toBeTruthy();
		expect(result.evidenceHashes.probeHash).toBeTruthy();
	});
});
