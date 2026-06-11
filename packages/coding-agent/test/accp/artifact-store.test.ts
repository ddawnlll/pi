/**
 * ACCP Artifact Store Tests (P49.27)
 */
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { AccpCompileResult, AccpGateVerdict, AccpRouteSignal } from "@earendil-works/pi-execution-contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccpArtifactStore } from "../../src/core/accp-artifact-store.js";

const TEST_PLAN_ID = "P49_TEST";
const TEST_ROOT = resolve("reports", "accp", TEST_PLAN_ID);

describe("ACCP Artifact Store", () => {
	const store = new AccpArtifactStore({ rootDir: "reports/accp", planId: TEST_PLAN_ID });

	beforeEach(() => {
		// Clean up before each test
		if (existsSync(TEST_ROOT)) {
			rmSync(TEST_ROOT, { recursive: true, force: true });
		}
	});

	afterEach(() => {
		if (existsSync(TEST_ROOT)) {
			rmSync(TEST_ROOT, { recursive: true, force: true });
		}
	});

	it("should save and read a compiled result", () => {
		const result: AccpCompileResult = {
			status: "compiled",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [],
			hasBlockingFindings: false,
		};

		const path = store.saveCompiled("TEST_001", result);
		expect(path).toContain("compiled/TEST_001.compiled.json");

		const read = store.readCompiled("TEST_001");
		expect(read).not.toBeNull();
		expect(read!.status).toBe("compiled");
	});

	it("should save and read a route signal", () => {
		const signal: AccpRouteSignal = {
			sourceReportId: "TEST_001",
			sourceReportType: "TVR",
			recommendedNextAction: "promotion_readiness",
			recommendedNextRoute: "PRR",
			confidence: "high",
			isAdvisory: true,
			mutationPolicyNeeded: "validation_only",
			targetResolved: true,
		};

		const path = store.saveRouteSignal("TEST_001", signal);
		expect(path).toContain("route/TEST_001.route-signal.json");

		const read = store.readRouteSignal("TEST_001");
		expect(read).not.toBeNull();
		expect(read!.isAdvisory).toBe(true);
	});

	it("should save and read a gate verdict", () => {
		const verdict: AccpGateVerdict = {
			reportId: "TEST_001",
			reportType: "TVR",
			valid: true,
			fatalErrors: [],
			warnings: [],
			blockingFindings: [],
			findingCount: 0,
			promotionReady: true,
			evidenceStatus: "complete",
		};

		const path = store.saveGateVerdict("TEST_001", verdict);
		expect(path).toContain("verdict/TEST_001.gate-verdict.json");

		const read = store.readGateVerdict("TEST_001");
		expect(read).not.toBeNull();
		expect(read!.valid).toBe(true);
	});

	it("should return null for non-existent artifacts", () => {
		expect(store.readCompiled("NONEXISTENT")).toBeNull();
		expect(store.readRouteSignal("NONEXISTENT")).toBeNull();
		expect(store.readGateVerdict("NONEXISTENT")).toBeNull();
	});
});
