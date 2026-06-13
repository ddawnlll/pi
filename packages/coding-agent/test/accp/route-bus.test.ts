/**
 * ACCP Route Bus Tests (P49.24)
 *
 * Covers:
 * - Basic pub/sub delivery and history
 * - Multi-agent artifact handoff chain
 * - Authority boundary enforcement
 * - Delivery chain tracking
 * - Negative tests: unresolved targets, promotion with blockers,
 *   mutation without authority, missing evidence
 */

import type {
	AccpCompileResult,
	AccpGateVerdict,
	AccpRouteSignal,
} from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";
import {
	REPORT_TYPE_TO_ROLE,
	buildHandoffChain,
	createAuthorityBoundaryGuard,
	createDefaultSubscriptions,
	getNextReportType,
	resolveTargetRole,
	resolveTargetRoleFromCompileResult,
} from "../../src/core/accp-artifact-subscriptions.js";
import {
	AccpRouteBus,
	getAccpRouteBus,
	resetAccpRouteBus,
	type AccpBusDelivery,
	type ArtifactIntegrityError,
} from "../../src/core/accp-route-bus.js";

// =============================================================================
// Helpers
// =============================================================================

function makeCompileResult(overrides: Partial<AccpCompileResult> = {}): AccpCompileResult {
	return {
		status: "compiled",
		reportId: "TEST_001",
		reportType: "TVR",
		diagnostics: [],
		hasBlockingFindings: false,
		...overrides,
	};
}

function makeRouteSignal(overrides: Partial<AccpRouteSignal> = {}): AccpRouteSignal {
	return {
		sourceReportId: "TEST_001",
		sourceReportType: "TVR",
		recommendedNextAction: "validate_implementation",
		recommendedNextRoute: "TVR",
		confidence: "high",
		isAdvisory: true,
		mutationPolicyNeeded: "validation_only",
		targetResolved: true,
		...overrides,
	};
}

function makeGateVerdict(overrides: Partial<AccpGateVerdict> = {}): AccpGateVerdict {
	return {
		reportId: "TEST_001",
		reportType: "TVR",
		valid: true,
		fatalErrors: [],
		warnings: [],
		blockingFindings: [],
		findingCount: 0,
		promotionReady: true,
		evidenceStatus: "complete",
		...overrides,
	};
}

function makeDelivery(overrides: Partial<AccpBusDelivery> = {}): AccpBusDelivery {
	return {
		deliveryId: "DEL_001",
		sourceRole: "scout",
		targetRole: "validator",
		compileResult: makeCompileResult(),
		diagnostics: [],
		timestamp: Date.now(),
		...overrides,
	};
}

// =============================================================================
// Basic route bus tests
// =============================================================================

describe("ACCP Route Bus", () => {
	it("should deliver artifacts to subscribed agents", async () => {
		const bus = new AccpRouteBus();
		const received: string[] = [];

		bus.subscribe("validator", async (delivery) => {
			received.push(delivery.deliveryId);
		});

		const compileResult = makeCompileResult();
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
		const compileResult = makeCompileResult();

		await bus.deliver(makeDelivery({ compileResult }));
		expect(bus.getAllHistory()).toHaveLength(1);
	});

	it("should not notify unsubscribed agents", async () => {
		const bus = new AccpRouteBus();
		const received: string[] = [];

		bus.subscribe("reviewer", async (delivery) => {
			received.push(delivery.deliveryId);
		});

		const compileResult = makeCompileResult();
		await bus.deliver(makeDelivery({ compileResult, targetRole: "validator" }));

		expect(received).toHaveLength(0);
	});

	it("should filter history by report ID", async () => {
		const bus = new AccpRouteBus();

		await bus.deliver(
			makeDelivery({ deliveryId: "D1", compileResult: makeCompileResult({ reportId: "R1" }) }),
		);
		await bus.deliver(
			makeDelivery({ deliveryId: "D2", compileResult: makeCompileResult({ reportId: "R2" }) }),
		);
		await bus.deliver(
			makeDelivery({ deliveryId: "D3", compileResult: makeCompileResult({ reportId: "R1" }) }),
		);

		const forR1 = bus.getHistoryForReport("R1");
		expect(forR1).toHaveLength(2);
		expect(forR1.map((d) => d.deliveryId)).toEqual(["D1", "D3"]);
	});

	it("should filter history by role", async () => {
		const bus = new AccpRouteBus();

		await bus.deliver(makeDelivery({ deliveryId: "D1", targetRole: "scout" }));
		await bus.deliver(makeDelivery({ deliveryId: "D2", targetRole: "validator" }));
		await bus.deliver(makeDelivery({ deliveryId: "D3", targetRole: "validator" }));

		expect(bus.getHistoryForRole("validator")).toHaveLength(2);
		expect(bus.getHistoryForRole("scout")).toHaveLength(1);
		expect(bus.getHistoryForRole("coordinator")).toHaveLength(0);
	});

	it("should unsubscribe handlers", async () => {
		const bus = new AccpRouteBus();
		const received: string[] = [];
		const handler = async (d: AccpBusDelivery) => {
			received.push(d.deliveryId);
		};

		bus.subscribe("validator", handler);
		await bus.deliver(makeDelivery({ deliveryId: "D1", targetRole: "validator" }));
		expect(received).toContain("D1");

		bus.unsubscribe("validator", handler);
		await bus.deliver(makeDelivery({ deliveryId: "D2", targetRole: "validator" }));
		expect(received).not.toContain("D2");
	});

	it("should clear history", async () => {
		const bus = new AccpRouteBus();
		await bus.deliver(makeDelivery());
		expect(bus.getAllHistory()).toHaveLength(1);

		bus.clearHistory();
		expect(bus.getAllHistory()).toHaveLength(0);
	});

	it("should clear subscriptions", async () => {
		const bus = new AccpRouteBus();
		const received: string[] = [];
		bus.subscribe("validator", async (d) => received.push(d.deliveryId));

		await bus.deliver(makeDelivery({ targetRole: "validator" }));
		expect(received).toHaveLength(1);

		bus.clearSubscriptions();
		await bus.deliver(makeDelivery({ deliveryId: "D2", targetRole: "validator" }));
		expect(received).toHaveLength(1); // No new deliveries received
	});

	// ---------------------------------------------------------------------------
	// routeBySignal tests
	// ---------------------------------------------------------------------------

	it("should route by signal and resolve target role", async () => {
		const bus = new AccpRouteBus();
		const received: AccpBusDelivery[] = [];

		bus.subscribe("validator", async (d) => received.push(d));

		const signal = makeRouteSignal({
			recommendedNextAction: "validate_implementation",
		});
		const compileResult = makeCompileResult({ reportType: "FPR" });

		const delivery = await bus.routeBySignal(
			"DEL_SIG_001",
			compileResult,
			signal,
			resolveTargetRole,
			"fixer",
		);

		expect(delivery.targetRole).toBe("validator");
		expect(received).toHaveLength(1);
		expect(received[0].routeSignal).toBe(signal);
		expect(received[0].sourceRole).toBe("fixer");
	});

	it("should route to coordinator for unknown action in signal", async () => {
		const bus = new AccpRouteBus();
		const received: AccpBusDelivery[] = [];

		bus.subscribe("coordinator", async (d) => received.push(d));

		const signal = makeRouteSignal({
			recommendedNextAction: "unknown_action",
			targetResolved: false,
		});
		const compileResult = makeCompileResult();

		const delivery = await bus.routeBySignal(
			"DEL_UNK",
			compileResult,
			signal,
			resolveTargetRole,
			"scout",
		);

		expect(delivery.targetRole).toBe("coordinator");
		expect(received).toHaveLength(1);
	});
});

// =============================================================================
// Singleton tests
// =============================================================================

describe("AccpRouteBus singleton", () => {
	it("should return the same instance from getAccpRouteBus", () => {
		resetAccpRouteBus();
		const bus1 = getAccpRouteBus();
		const bus2 = getAccpRouteBus();
		expect(bus1).toBe(bus2);
	});

	it("should be independent after reset", () => {
		resetAccpRouteBus();
		const bus1 = getAccpRouteBus();
		resetAccpRouteBus();
		const bus2 = getAccpRouteBus();
		expect(bus1).not.toBe(bus2);
	});
});

// =============================================================================
// Integrity check tests
// =============================================================================

describe("Route bus integrity checks", () => {
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

		const compileResult = makeCompileResult({
			status: "failed",
			diagnostics: [],
			hasBlockingFindings: true,
		});

		await bus.deliver(
			makeDelivery({
				deliveryId: "DEL_BAD",
				compileResult,
			}),
		);

		expect(integrityError).not.toBeNull();
		expect(integrityError!.artifactPath).toBe("TEST_001");
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

		const compileResult = makeCompileResult({
			diagnostics: [],
			hasBlockingFindings: false,
		});

		await bus.deliver(makeDelivery({ deliveryId: "DEL_OK", compileResult }));
		expect(integrityError).toBeNull();
		expect(received).toContain("DEL_OK");
	});

	it("should reject gate verdict with promotionReady=true but fatalErrors present", async () => {
		const bus = new AccpRouteBus();
		let integrityError: ArtifactIntegrityError | null = null;

		bus.setIntegrityErrorHandler((err) => {
			integrityError = err;
		});

		const gateVerdict = makeGateVerdict({
			promotionReady: true,
			fatalErrors: ["MISSING_EVIDENCE", "BLOCKING_FINDING"],
		});

		await bus.deliver(makeDelivery({ deliveryId: "DEL_BAD", gateVerdict }));

		expect(integrityError).not.toBeNull();
		expect(integrityError!.message).toContain("promotionReady=true requires zero fatalErrors");
	});

	it("should reject route signal with isAdvisory=false", async () => {
		const bus = new AccpRouteBus();
		let integrityError: ArtifactIntegrityError | null = null;

		bus.setIntegrityErrorHandler((err) => {
			integrityError = err;
		});

		const routeSignal = makeRouteSignal({ isAdvisory: false });

		await bus.deliver(makeDelivery({ deliveryId: "DEL_BAD", routeSignal }));

		expect(integrityError).not.toBeNull();
		expect(integrityError!.message).toContain("isAdvisory must be true");
	});
});

// =============================================================================
// Delivery chain tests
// =============================================================================

describe("Delivery chain tracking", () => {
	it("should build delivery chain from parent references", async () => {
		const bus = new AccpRouteBus();

		// Simulate a multi-agent chain: scout(BSR) → fixer(FPR) → validator(TVR) → reviewer(PRR)
		await bus.routeBySignal(
			"CHAIN_BSR",
			makeCompileResult({ reportId: "BSR_001", reportType: "BSR" }),
			makeRouteSignal({ recommendedNextAction: "resolve_blockers" }),
			resolveTargetRole,
			"scout",
		);

		await bus.routeBySignal(
			"CHAIN_FPR",
			makeCompileResult({ reportId: "FPR_001", reportType: "FPR" }),
			makeRouteSignal({ recommendedNextAction: "validate_fix" }),
			resolveTargetRole,
			"fixer",
			"CHAIN_BSR",
		);

		await bus.routeBySignal(
			"CHAIN_TVR",
			makeCompileResult({ reportId: "TVR_001", reportType: "TVR" }),
			makeRouteSignal({ recommendedNextAction: "promotion_readiness" }),
			resolveTargetRole,
			"validator",
			"CHAIN_FPR",
		);

		const chain = bus.getDeliveryChain("CHAIN_TVR");
		expect(chain).not.toBeNull();
		expect(chain!.deliveries).toHaveLength(3);
		expect(chain!.deliveries.map((d) => d.deliveryId)).toEqual([
			"CHAIN_BSR",
			"CHAIN_FPR",
			"CHAIN_TVR",
		]);
		expect(chain!.reachedCoordinator).toBe(false);
	});

	it("should detect coordinator as terminal chain node", async () => {
		const bus = new AccpRouteBus();

		await bus.routeBySignal(
			"CHAIN_START",
			makeCompileResult({ reportId: "TVR_001", reportType: "TVR" }),
			makeRouteSignal({ recommendedNextAction: "promote" }),
			resolveTargetRole,
			"validator",
		);

		// Route to coordinator
		await bus.routeBySignal(
			"CHAIN_END",
			makeCompileResult({ reportId: "CAR_001", reportType: "CAR" }),
			makeRouteSignal({ recommendedNextAction: "conflict_resolution" }),
			resolveTargetRole,
			"reviewer",
			"CHAIN_START",
		);

		const chain = bus.getDeliveryChain("CHAIN_END");
		expect(chain).not.toBeNull();
		expect(chain!.reachedCoordinator).toBe(true);
	});

	it("should return null for unknown delivery", () => {
		const bus = new AccpRouteBus();
		expect(bus.getDeliveryChain("NONEXISTENT")).toBeNull();
	});
});

// =============================================================================
// Multi-agent artifact handoff tests
// =============================================================================

describe("Multi-agent artifact handoff", () => {
	it("should complete full bugfix pipeline: scout(BSR) → fixer(FPR) → validator(TVR) → reviewer(PRR) → coordinator(CAR)", async () => {
		const bus = new AccpRouteBus();
		const handoffSteps: string[] = [];

		// Set up publishNext callback that records handoff steps
		createDefaultSubscriptions(bus, (nextReportType, delivery) => {
			handoffSteps.push(`${delivery.compileResult.reportType}→${nextReportType ?? "TERMINAL"}`);
		});

		// Step 1: Scout produces BSR, routes to fixer
		await bus.routeBySignal(
			"H_BSR",
			makeCompileResult({ reportId: "BSR_001", reportType: "BSR" }),
			makeRouteSignal({
				sourceReportType: "BSR",
				recommendedNextAction: "resolve_blockers",
				targetResolved: true,
			}),
			resolveTargetRole,
			"scout",
		);

		// Step 2: Fixer produces FPR, routes to validator
		await bus.routeBySignal(
			"H_FPR",
			makeCompileResult({ reportId: "FPR_001", reportType: "FPR" }),
			makeRouteSignal({
				sourceReportType: "FPR",
				recommendedNextAction: "validate_fix",
				targetResolved: true,
			}),
			resolveTargetRole,
			"fixer",
			"H_BSR",
		);

		// Step 3: Validator produces TVR (promotion ready), routes to reviewer
		await bus.routeBySignal(
			"H_TVR",
			makeCompileResult({ reportId: "TVR_001", reportType: "TVR" }),
			makeRouteSignal({
				sourceReportType: "TVR",
				recommendedNextAction: "promotion_readiness",
				targetResolved: true,
			}),
			resolveTargetRole,
			"validator",
			"H_FPR",
		);

		// Step 4: Reviewer produces PRR, routes to coordinator
		await bus.routeBySignal(
			"H_PRR",
			makeCompileResult({ reportId: "PRR_001", reportType: "PRR" }),
			makeRouteSignal({
				sourceReportType: "PRR",
				recommendedNextAction: "promote",
				targetResolved: true,
			}),
			resolveTargetRole,
			"reviewer",
			"H_TVR",
		);

		// Step 5: Coordinator receives DCR/CAR
		await bus.routeBySignal(
			"H_CAR",
			makeCompileResult({ reportId: "CAR_001", reportType: "CAR" }),
			makeRouteSignal({
				sourceReportType: "CAR",
				recommendedNextAction: "conflict_resolution",
				targetResolved: true,
			}),
			resolveTargetRole,
			"coordinator",
			"H_PRR",
		);

		// Verify the complete chain
		const chain = bus.getDeliveryChain("H_CAR");
		expect(chain).not.toBeNull();
		expect(chain!.deliveries).toHaveLength(5);
		expect(chain!.reachedCoordinator).toBe(true);

		// Verify delivery order
		const reportTypes = chain!.deliveries.map((d) => d.compileResult.reportType);
		expect(reportTypes).toEqual(["BSR", "FPR", "TVR", "PRR", "CAR"]);
	});

	it("should route unresolved targets to coordinator", async () => {
		const bus = new AccpRouteBus();
		const published: string[] = [];

		createDefaultSubscriptions(bus, (nextType, _delivery) => {
			published.push(nextType ?? "TERMINAL");
		});

		// Scout produces BSR with unresolved target
		await bus.routeBySignal(
			"H_UNRESOLVED",
			makeCompileResult({ reportId: "BSR_002", reportType: "BSR" }),
			makeRouteSignal({
				sourceReportType: "BSR",
				recommendedNextAction: "resolve_blockers",
				targetResolved: false,
				unresolvedRefs: ["UNKNOWN_REF"],
			}),
			resolveTargetRole,
			"scout",
		);

		// Should publish DCR to coordinator
		expect(published).toContain("DCR");
	});
});

// =============================================================================
// Authority boundary tests
// =============================================================================

describe("Authority boundary enforcement", () => {
	it("should deny mutation without external authority grant", () => {
		const guard = createAuthorityBoundaryGuard();
		const delivery = makeDelivery({
			routeSignal: makeRouteSignal({ mutationPolicyNeeded: "mutation_allowed" }),
		});

		const result = guard("mutate_files", delivery);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("no external authority");
	});

	it("should deny command execution without external authority", () => {
		const guard = createAuthorityBoundaryGuard();
		const delivery = makeDelivery({
			routeSignal: makeRouteSignal({ mutationPolicyNeeded: "mutation_allowed" }),
		});

		const result = guard("execute_command", delivery);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("no external authority");
	});

	it("should deny mutation when signal does not recommend it", () => {
		const guard = createAuthorityBoundaryGuard();
		const delivery = makeDelivery({
			routeSignal: makeRouteSignal({ mutationPolicyNeeded: "none" }),
		});

		const result = guard("mutate_files", delivery);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("mutationPolicyNeeded is 'none'");
	});

	it("should deny mutation when no route signal present", () => {
		const guard = createAuthorityBoundaryGuard();
		const delivery = makeDelivery();

		const result = guard("mutate_files", delivery);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("mutationPolicyNeeded is 'absent'");
	});

	it("should deny workspace transition without authority grant", () => {
		const guard = createAuthorityBoundaryGuard();
		const delivery = makeDelivery({
			gateVerdict: makeGateVerdict({ valid: true }),
		});

		const result = guard("transition_workspace", delivery);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("no external authority");
	});

	it("should deny promotion when gate verdict has blockers", () => {
		const guard = createAuthorityBoundaryGuard();
		const delivery = makeDelivery({
			gateVerdict: makeGateVerdict({
				promotionReady: false,
				fatalErrors: ["BLOCKING_FINDING"],
			}),
		});

		const result = guard("promote_plan", delivery);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("promotionReady=false");
	});

	it("should deny promotion without external authority even when gate is ready", () => {
		const guard = createAuthorityBoundaryGuard();
		const delivery = makeDelivery({
			gateVerdict: makeGateVerdict({ promotionReady: true }),
		});

		const result = guard("promote_plan", delivery);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("no external authority");
	});

	it("should allow read-only actions", () => {
		const guard = createAuthorityBoundaryGuard();
		const delivery = makeDelivery();

		expect(guard("read_report", delivery).allowed).toBe(true);
		expect(guard("inspect_artifact", delivery).allowed).toBe(true);
		expect(guard("resolve_target", delivery).allowed).toBe(true);
	});

	it("should fail closed for unknown actions", () => {
		const guard = createAuthorityBoundaryGuard();
		const delivery = makeDelivery();

		const result = guard("some_unknown_action", delivery);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("fail-closed");
	});

	it("should allow mutation when external authority grants permission", () => {
		const guard = createAuthorityBoundaryGuard((_action, _delivery) => {
			// Simulates PlanSpec + command policy granting permission
			return true;
		});
		const delivery = makeDelivery({
			routeSignal: makeRouteSignal({ mutationPolicyNeeded: "mutation_allowed" }),
		});

		const result = guard("mutate_files", delivery);
		expect(result.allowed).toBe(true);
	});

	it("should allow transition and promotion with external authority", () => {
		const guard = createAuthorityBoundaryGuard(() => true);
		const delivery = makeDelivery({
			gateVerdict: makeGateVerdict({ promotionReady: true }),
		});

		expect(guard("transition_workspace", delivery).allowed).toBe(true);
		expect(guard("promote_plan", delivery).allowed).toBe(true);
	});
});

// =============================================================================
// Target role resolution tests
// =============================================================================

describe("Target role resolution", () => {
	it("should resolve target role from route signal action", () => {
		const signal = makeRouteSignal({ recommendedNextAction: "validate_implementation" });
		expect(resolveTargetRole(signal)).toBe("validator");
	});

	it("should resolve fixer role for resolve_blockers", () => {
		const signal = makeRouteSignal({ recommendedNextAction: "resolve_blockers" });
		expect(resolveTargetRole(signal)).toBe("fixer");
	});

	it("should resolve reviewer role for promotion_readiness", () => {
		const signal = makeRouteSignal({ recommendedNextAction: "promotion_readiness" });
		expect(resolveTargetRole(signal)).toBe("reviewer");
	});

	it("should resolve coordinator role for promote", () => {
		const signal = makeRouteSignal({ recommendedNextAction: "promote" });
		expect(resolveTargetRole(signal)).toBe("coordinator");
	});

	it("should default to coordinator for unknown actions", () => {
		const signal = makeRouteSignal({
			recommendedNextAction: "unknown_action",
			targetResolved: false,
		});
		expect(resolveTargetRole(signal)).toBe("coordinator");
	});

	it("should resolve from compile result when no signal", () => {
		const cr = makeCompileResult({ reportType: "BSR" });
		expect(resolveTargetRoleFromCompileResult(undefined, cr)).toBe("scout");
	});

	it("should prefer signal over compile result for resolution", () => {
		const signal = makeRouteSignal({ recommendedNextAction: "promote" });
		const cr = makeCompileResult({ reportType: "BSR" });
		expect(resolveTargetRoleFromCompileResult(signal, cr)).toBe("coordinator");
	});
});

// =============================================================================
// Report type mapping tests
// =============================================================================

describe("Report type mappings", () => {
	it("should map all 24 report types to roles", () => {
		const allTypes = Object.keys(REPORT_TYPE_TO_ROLE);
		expect(allTypes).toHaveLength(24);
		for (const type of allTypes) {
			expect(["scout", "fixer", "validator", "reviewer", "coordinator"]).toContain(
				REPORT_TYPE_TO_ROLE[type as keyof typeof REPORT_TYPE_TO_ROLE],
			);
		}
	});

	it("should build bugfix handoff chain: BSR → FPR → TVR → PRR → CAR", () => {
		const chain = buildHandoffChain("BSR");
		expect(chain).toEqual(["BSR", "FPR", "TVR", "PRR", "CAR"]);
	});

	it("should build feature handoff chain: FER → FDR → FCR → FIR → FGR → CAR", () => {
		const chain = buildHandoffChain("FER");
		expect(chain).toEqual(["FER", "FDR", "FCR", "FIR", "FGR", "CAR"]);
	});

	it("should build writing handoff chain: WBR → WDR → WER → WQR", () => {
		const chain = buildHandoffChain("WBR");
		expect(chain).toEqual(["WBR", "WDR", "WER", "WQR"]);
	});

	it("should return single element chain for terminal type", () => {
		const chain = buildHandoffChain("CAR");
		expect(chain).toEqual(["CAR"]);
	});

	it("should get next report type for chained types", () => {
		expect(getNextReportType("BSR")).toBe("FPR");
		expect(getNextReportType("FPR")).toBe("TVR");
		expect(getNextReportType("TVR")).toBe("PRR");
		expect(getNextReportType("PRR")).toBe("CAR");
	});

	it("should return undefined for terminal types", () => {
		expect(getNextReportType("CAR")).toBeUndefined();
		expect(getNextReportType("DCR")).toBeUndefined();
		expect(getNextReportType("WQR")).toBeUndefined();
	});
});

// =============================================================================
// Default subscriptions integration tests
// =============================================================================

describe("Default subscriptions", () => {
	it("should route scout BSR to fixer via publishNext", async () => {
		const bus = new AccpRouteBus();
		const published: Array<{ nextType: string | undefined; sourceType: string }> = [];

		createDefaultSubscriptions(bus, (nextType, delivery) => {
			published.push({
				nextType,
				sourceType: delivery.compileResult.reportType,
			});
		});

		await bus.routeBySignal(
			"SUB_BSR",
			makeCompileResult({ reportId: "SUB_BSR_001", reportType: "BSR" }),
			makeRouteSignal({
				sourceReportType: "BSR",
				recommendedNextAction: "resolve_blockers",
				targetResolved: true,
			}),
			resolveTargetRole,
			"scout",
		);

		expect(published).toHaveLength(1);
		expect(published[0].sourceType).toBe("BSR");
		expect(published[0].nextType).toBe("FPR");
	});

	it("should route fixer FPR to validator via publishNext", async () => {
		const bus = new AccpRouteBus();
		const published: Array<{ nextType: string | undefined; sourceType: string }> = [];

		createDefaultSubscriptions(bus, (nextType, delivery) => {
			published.push({ nextType, sourceType: delivery.compileResult.reportType });
		});

		await bus.routeBySignal(
			"SUB_FPR",
			makeCompileResult({ reportId: "SUB_FPR_001", reportType: "FPR" }),
			makeRouteSignal({
				sourceReportType: "FPR",
				recommendedNextAction: "validate_fix",
				targetResolved: true,
			}),
			resolveTargetRole,
			"fixer",
		);

		expect(published).toHaveLength(1);
		expect(published[0].sourceType).toBe("FPR");
		expect(published[0].nextType).toBe("TVR");
	});

	it("should route validator TVR to reviewer when promotion ready", async () => {
		const bus = new AccpRouteBus();
		const published: Array<{ nextType: string | undefined; sourceType: string }> = [];

		createDefaultSubscriptions(bus, (nextType, delivery) => {
			published.push({ nextType, sourceType: delivery.compileResult.reportType });
		});

		await bus.routeBySignal(
			"SUB_TVR",
			makeCompileResult({ reportId: "SUB_TVR_001", reportType: "TVR" }),
			makeRouteSignal({
				sourceReportType: "TVR",
				recommendedNextAction: "validate_implementation",
				targetResolved: true,
			}),
			resolveTargetRole,
			"validator",
		);

		// Validator with resolved signal defaults to PRR
		expect(published).toHaveLength(1);
		expect(published[0].nextType).toBe("PRR");
	});

	it("should route unresolved scout target to coordinator DCR", async () => {
		const bus = new AccpRouteBus();
		const published: Array<{ nextType: string | undefined; sourceType: string }> = [];

		createDefaultSubscriptions(bus, (nextType, delivery) => {
			published.push({ nextType, sourceType: delivery.compileResult.reportType });
		});

		await bus.routeBySignal(
			"SUB_UNRESOLVED",
			makeCompileResult({ reportId: "SUB_BSR_UNRESOLVED", reportType: "BSR" }),
			makeRouteSignal({
				sourceReportType: "BSR",
				recommendedNextAction: "resolve_blockers",
				targetResolved: false,
				unresolvedRefs: ["MISSING_DEP"],
			}),
			resolveTargetRole,
			"scout",
		);

		expect(published).toHaveLength(1);
		expect(published[0].nextType).toBe("DCR");
	});
});
