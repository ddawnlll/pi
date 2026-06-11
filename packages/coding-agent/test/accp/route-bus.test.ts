/**
 * ACCP Route Bus Tests (P49.24)
 */

import type { AccpCompileResult, AccpRouteSignal } from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";
import { resolveTargetRole } from "../../src/core/accp-artifact-subscriptions.js";
import { AccpRouteBus, type ArtifactIntegrityError } from "../../src/core/accp-route-bus.js";

describe("ACCP Route Bus", () => {
	it("should deliver artifacts to subscribed agents", async () => {
		const bus = new AccpRouteBus();
		const received: string[] = [];

		bus.subscribe("validator", async (delivery) => {
			received.push(delivery.deliveryId);
		});

		const compileResult: AccpCompileResult = {
			status: "compiled",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [],
			hasBlockingFindings: false,
		};

		await bus.deliver({
			deliveryId: "DEL_001",
			sourceRole: "scout",
			targetRole: "validator",
			compileResult,
			diagnostics: [],
			timestamp: Date.now(),
		});

		expect(received).toContain("DEL_001");
	});

	it("should track delivery history", async () => {
		const bus = new AccpRouteBus();
		const compileResult: AccpCompileResult = {
			status: "compiled",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [],
			hasBlockingFindings: false,
		};

		await bus.deliver({
			deliveryId: "DEL_001",
			sourceRole: "scout",
			targetRole: "validator",
			compileResult,
			diagnostics: [],
			timestamp: Date.now(),
		});

		expect(bus.getAllHistory()).toHaveLength(1);
	});

	it("should not notify unsubscribed agents", async () => {
		const bus = new AccpRouteBus();
		const received: string[] = [];

		bus.subscribe("reviewer", async (delivery) => {
			received.push(delivery.deliveryId);
		});

		const compileResult: AccpCompileResult = {
			status: "compiled",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [],
			hasBlockingFindings: false,
		};

		await bus.deliver({
			deliveryId: "DEL_001",
			sourceRole: "scout",
			targetRole: "validator",
			compileResult,
			diagnostics: [],
			timestamp: Date.now(),
		});

		expect(received).toHaveLength(0);
	});

	it("should resolve target role from route signal action", () => {
		const signal: AccpRouteSignal = {
			sourceReportId: "TEST_001",
			sourceReportType: "TVR",
			recommendedNextAction: "validate_implementation",
			recommendedNextRoute: "TVR",
			confidence: "high",
			isAdvisory: true,
			mutationPolicyNeeded: "validation_only",
			targetResolved: true,
		};
		expect(resolveTargetRole(signal)).toBe("validator");
	});

	it("should default to coordinator for unknown actions", () => {
		const signal: AccpRouteSignal = {
			sourceReportId: "TEST_001",
			sourceReportType: "TVR",
			recommendedNextAction: "unknown_action",
			recommendedNextRoute: "",
			confidence: "low",
			isAdvisory: true,
			mutationPolicyNeeded: "none",
			targetResolved: false,
		};
		expect(resolveTargetRole(signal)).toBe("coordinator");
	});

	// ---------------------------------------------------------------------------
	// Hash verification tests
	// ---------------------------------------------------------------------------

	it("should reject delivery with inconsistent hasBlockingFindings when integrity handler is set", async () => {
		const bus = new AccpRouteBus();
		let integrityError: ArtifactIntegrityError | null = null;

		bus.setIntegrityErrorHandler((err) => {
			integrityError = err;
		});

		const received: string[] = [];
		bus.subscribe("validator", async (delivery) => {
			received.push(delivery.deliveryId);
		});

		// Inconsistent: hasBlockingFindings=true but no fatal diagnostics
		const compileResult: AccpCompileResult = {
			status: "failed",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [],
			hasBlockingFindings: true,
		};

		await bus.deliver({
			deliveryId: "DEL_BAD",
			sourceRole: "scout",
			targetRole: "validator",
			compileResult,
			diagnostics: [],
			timestamp: Date.now(),
		});

		expect(integrityError).not.toBeNull();
		expect(integrityError!.artifactPath).toBe("TEST_001");
		// Subscribers must not be notified
		expect(received).toHaveLength(0);
	});

	it("should pass delivery when integrity check passes", async () => {
		const bus = new AccpRouteBus();
		let integrityError: ArtifactIntegrityError | null = null;

		bus.setIntegrityErrorHandler((err) => {
			integrityError = err;
		});

		const received: string[] = [];
		bus.subscribe("validator", async (delivery) => {
			received.push(delivery.deliveryId);
		});

		// Consistent: hasBlockingFindings=false, no fatal diagnostics
		const compileResult: AccpCompileResult = {
			status: "compiled",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [],
			hasBlockingFindings: false,
		};

		await bus.deliver({
			deliveryId: "DEL_OK",
			sourceRole: "scout",
			targetRole: "validator",
			compileResult,
			diagnostics: [],
			timestamp: Date.now(),
		});

		expect(integrityError).toBeNull();
		expect(received).toContain("DEL_OK");
	});
});
