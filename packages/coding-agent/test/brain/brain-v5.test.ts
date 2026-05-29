/**
 * Brain V5 — V5 Contract, Flags & Safety Doctrine Tests.
 *
 * Covers:
 * 1. Mode derivation from capability flags (OFF → OPERATOR_READY)
 * 2. Mutation guard event validation (direct state mutation prevention)
 * 3. Plan doctor advisory reporting
 * 4. Operator gate checking
 * 5. Mode comparison (brainV5ModeAtLeast)
 *
 * @packageDocumentation
 */

import { describe, expect, it } from "vitest";
import {
	BRAIN_V5_MODE_RANK,
	BRAIN_V5_MODES,
	brainV5ModeAtLeast,
	buildV5DoctorReport,
	canV5EmitEvents,
	canV5Push,
	canV5RunOvernight,
	checkV5OperatorGates,
	deriveBrainV5Mode,
	isV5Enabled,
	V5_ALLOWED_ACTOR_EVENT_TYPES,
	V5_FORBIDDEN_ACTOR_EVENT_TYPES,
	V5MutationGuard,
} from "../../src/brain/v5/index.js";
import type { BrainV5Config, BrainV5Mode, V5AllowedEvent } from "../../src/brain/v5/types.js";

// =========================================================================
// Mock implementations
// =========================================================================

/** Simple in-memory timeline store for testing. */
class MockTimelineStore {
	private events: unknown[] = [];

	async append(event: unknown): Promise<void> {
		this.events.push(event);
	}

	getEvents(): unknown[] {
		return this.events;
	}
}

/** Simple in-memory actor event sink for testing. */
class MockActorSink {
	private events: unknown[] = [];

	async emit(event: unknown): Promise<void> {
		this.events.push(event);
	}

	getEvents(): unknown[] {
		return this.events;
	}
}

// =========================================================================
// Test Config
// =========================================================================

function makeConfig(overrides: Partial<BrainV5Config> & { mode: BrainV5Mode }): BrainV5Config {
	return {
		enabled: false,
		readOnlyMode: true,
		pushEnabled: false,
		overnightOperatorEnabled: false,
		...overrides,
	};
}

// =========================================================================
// AC 1 & 2: Settings represenation and mode derivation
// =========================================================================

describe("Brain V5 — Mode Derivation", () => {
	// Verify AC 1: BRAIN_V5_ENABLED, BRAIN_V5_READ_ONLY_MODE, BRAIN_V5_PUSH_ENABLED,
	// BRAIN_V5_OVERNIGHT_OPERATOR_ENABLED=false are represented in settings/config.
	it("should represent all four BRAIN_V5 flags in mode derivation", () => {
		// OFF: enabled = false (regardless of other flags)
		expect(deriveBrainV5Mode(false, false, true, true)).toBe("OFF");
		expect(deriveBrainV5Mode(false, true, false, false)).toBe("OFF");
		expect(deriveBrainV5Mode(false, false, false, false)).toBe("OFF");
		expect(deriveBrainV5Mode(false, true, true, true)).toBe("OFF");

		// READ_ONLY: enabled = true, readOnlyMode = true
		expect(deriveBrainV5Mode(true, true, false, false)).toBe("READ_ONLY");
		expect(deriveBrainV5Mode(true, true, true, false)).toBe("READ_ONLY");
		expect(deriveBrainV5Mode(true, true, false, true)).toBe("READ_ONLY");
		expect(deriveBrainV5Mode(true, true, true, true)).toBe("READ_ONLY");

		// ADVISORY: enabled = true, readOnlyMode = false, pushEnabled = false
		expect(deriveBrainV5Mode(true, false, false, false)).toBe("ADVISORY");
		expect(deriveBrainV5Mode(true, false, false, true)).toBe("ADVISORY");

		// DRAFTING: enabled = true, readOnlyMode = false, pushEnabled = true, overnight = false
		expect(deriveBrainV5Mode(true, false, true, false)).toBe("DRAFTING");

		// OPERATOR_READY: all flags enabled
		expect(deriveBrainV5Mode(true, false, true, true)).toBe("OPERATOR_READY");
	});

	// Verify AC 2: Brain V5 code paths can determine all five states
	it("should determine all five V5 operating states", () => {
		expect(BRAIN_V5_MODES).toEqual([
			"OFF",
			"READ_ONLY",
			"ADVISORY",
			"DRAFTING",
			"OPERATOR_READY",
		] satisfies BrainV5Mode[]);
	});

	it("should rank modes in increasing capability order", () => {
		expect(BRAIN_V5_MODE_RANK.OFF).toBe(0);
		expect(BRAIN_V5_MODE_RANK.READ_ONLY).toBe(1);
		expect(BRAIN_V5_MODE_RANK.ADVISORY).toBe(2);
		expect(BRAIN_V5_MODE_RANK.DRAFTING).toBe(3);
		expect(BRAIN_V5_MODE_RANK.OPERATOR_READY).toBe(4);
	});
});

describe("Brain V5 — Mode Comparison", () => {
	it("should compare modes with brainV5ModeAtLeast", () => {
		// OFF is the minimum
		expect(brainV5ModeAtLeast("OFF", "OFF")).toBe(true);
		expect(brainV5ModeAtLeast("READ_ONLY", "OFF")).toBe(true);
		expect(brainV5ModeAtLeast("ADVISORY", "OFF")).toBe(true);
		expect(brainV5ModeAtLeast("DRAFTING", "OFF")).toBe(true);
		expect(brainV5ModeAtLeast("OPERATOR_READY", "OFF")).toBe(true);

		// OFF is less than anything else
		expect(brainV5ModeAtLeast("OFF", "READ_ONLY")).toBe(false);
		expect(brainV5ModeAtLeast("OFF", "ADVISORY")).toBe(false);
		expect(brainV5ModeAtLeast("OFF", "DRAFTING")).toBe(false);
		expect(brainV5ModeAtLeast("OFF", "OPERATOR_READY")).toBe(false);

		// Same level
		expect(brainV5ModeAtLeast("ADVISORY", "ADVISORY")).toBe(true);
		expect(brainV5ModeAtLeast("DRAFTING", "DRAFTING")).toBe(true);
		expect(brainV5ModeAtLeast("OPERATOR_READY", "OPERATOR_READY")).toBe(true);

		// Higher meets lower requirement
		expect(brainV5ModeAtLeast("DRAFTING", "ADVISORY")).toBe(true);
		expect(brainV5ModeAtLeast("OPERATOR_READY", "READ_ONLY")).toBe(true);
		expect(brainV5ModeAtLeast("OPERATOR_READY", "DRAFTING")).toBe(true);
	});
});

describe("Brain V5 — Capability Checks", () => {
	it("isV5Enabled should return true when enabled is set", () => {
		expect(isV5Enabled(makeConfig({ enabled: true, mode: "ADVISORY" }))).toBe(true);
		expect(isV5Enabled(makeConfig({ enabled: false, mode: "OFF" }))).toBe(false);
	});

	it("canV5EmitEvents should be true for ADVISORY and above", () => {
		expect(canV5EmitEvents(makeConfig({ enabled: false, mode: "OFF" }))).toBe(false);
		expect(canV5EmitEvents(makeConfig({ enabled: true, readOnlyMode: true, mode: "READ_ONLY" }))).toBe(false);
		expect(
			canV5EmitEvents(makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: false, mode: "ADVISORY" })),
		).toBe(true);
		expect(
			canV5EmitEvents(makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: true, mode: "DRAFTING" })),
		).toBe(true);
		expect(
			canV5EmitEvents(
				makeConfig({
					enabled: true,
					readOnlyMode: false,
					pushEnabled: true,
					overnightOperatorEnabled: true,
					mode: "OPERATOR_READY",
				}),
			),
		).toBe(true);
	});

	it("canV5Push should be true for DRAFTING and OPERATOR_READY", () => {
		expect(canV5Push(makeConfig({ mode: "OFF" }))).toBe(false);
		expect(canV5Push(makeConfig({ mode: "READ_ONLY" }))).toBe(false);
		expect(canV5Push(makeConfig({ mode: "ADVISORY" }))).toBe(false);
		expect(canV5Push(makeConfig({ mode: "DRAFTING" }))).toBe(true);
		expect(canV5Push(makeConfig({ mode: "OPERATOR_READY" }))).toBe(true);
	});

	it("canV5RunOvernight should be true only for OPERATOR_READY", () => {
		expect(canV5RunOvernight(makeConfig({ mode: "OFF" }))).toBe(false);
		expect(canV5RunOvernight(makeConfig({ mode: "READ_ONLY" }))).toBe(false);
		expect(canV5RunOvernight(makeConfig({ mode: "ADVISORY" }))).toBe(false);
		expect(canV5RunOvernight(makeConfig({ mode: "DRAFTING" }))).toBe(false);
		expect(canV5RunOvernight(makeConfig({ mode: "OPERATOR_READY" }))).toBe(true);
	});
});

// =========================================================================
// AC 3: Direct execution-state mutation is rejected
// =========================================================================

describe("Brain V5 — Mutation Guard (AC 3: No Direct State Mutation)", () => {
	it("should reject all events in OFF mode", async () => {
		const guard = new V5MutationGuard(
			makeConfig({ enabled: false, mode: "OFF" }),
			new MockTimelineStore() as never,
			new MockActorSink() as never,
		);

		const timelineEvent: V5AllowedEvent = {
			kind: "timeline",
			event: {
				id: "test-1",
				eventType: "observation",
				timestamp: new Date().toISOString(),
				data: { key: "value" },
				severity: "info",
			},
		};

		const result = await guard.emit(timelineEvent);
		expect(result.ok).toBe(false);
		expect((result as { code: string }).code).toBe("MODE_OFF");
	});

	it("should reject all events in READ_ONLY mode", async () => {
		const guard = new V5MutationGuard(
			makeConfig({ enabled: true, readOnlyMode: true, mode: "READ_ONLY" }),
			new MockTimelineStore() as never,
			new MockActorSink() as never,
		);

		const timelineEvent: V5AllowedEvent = {
			kind: "timeline",
			event: {
				id: "test-2",
				eventType: "observation",
				timestamp: new Date().toISOString(),
				data: {},
				severity: "info",
			},
		};

		const result = await guard.emit(timelineEvent);
		expect(result.ok).toBe(false);
		expect((result as { code: string }).code).toBe("MODE_READ_ONLY");
	});

	it("should allow timeline events in ADVISORY mode", async () => {
		const store = new MockTimelineStore();
		const guard = new V5MutationGuard(
			makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: false, mode: "ADVISORY" }),
			store as never,
			new MockActorSink() as never,
		);

		const timelineEvent: V5AllowedEvent = {
			kind: "timeline",
			event: {
				id: "test-3",
				eventType: "observation",
				timestamp: new Date().toISOString(),
				data: { observation: "test" },
				severity: "info",
			},
		};

		const result = await guard.emit(timelineEvent);
		expect(result.ok).toBe(true);
		expect(store.getEvents()).toHaveLength(1);
	});

	it("should reject actor events in ADVISORY mode (needs DRAFTING+)", async () => {
		const store = new MockTimelineStore();
		const actorSink = new MockActorSink();
		const guard = new V5MutationGuard(
			makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: false, mode: "ADVISORY" }),
			store as never,
			actorSink as never,
		);

		const actorEvent: V5AllowedEvent = {
			kind: "actor",
			event: {
				id: "actor-1",
				type: "proposal_submitted",
				timestamp: new Date().toISOString(),
				data: { proposal: "test-proposal" },
				source: "brain-v5",
			},
		};

		const result = await guard.emit(actorEvent);
		expect(result.ok).toBe(false);
		expect((result as { code: string }).code).toBe("MODE_NO_PUSH");
		expect(actorSink.getEvents()).toHaveLength(0);
	});

	it("should allow allowed actor events in DRAFTING+ mode", async () => {
		const store = new MockTimelineStore();
		const actorSink = new MockActorSink();
		const guard = new V5MutationGuard(
			makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: true, mode: "DRAFTING" }),
			store as never,
			actorSink as never,
		);

		const actorEvent: V5AllowedEvent = {
			kind: "actor",
			event: {
				id: "actor-2",
				type: "proposal_submitted",
				timestamp: new Date().toISOString(),
				data: { proposal: "test-proposal" },
				source: "brain-v5",
			},
		};

		const result = await guard.emit(actorEvent);
		expect(result.ok).toBe(true);
		expect(actorSink.getEvents()).toHaveLength(1);
	});

	it("should reject forbidden actor event types", async () => {
		const store = new MockTimelineStore();
		const actorSink = new MockActorSink();
		const guard = new V5MutationGuard(
			makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: true, mode: "DRAFTING" }),
			store as never,
			actorSink as never,
		);

		const forbiddenEvent: V5AllowedEvent = {
			kind: "actor",
			event: {
				id: "actor-3",
				type: "validation_passed",
				timestamp: new Date().toISOString(),
				data: {},
				source: "brain-v5",
			},
		};

		const result = await guard.emit(forbiddenEvent);
		expect(result.ok).toBe(false);
		expect((result as { code: string }).code).toBe("FORBIDDEN_EVENT_TYPE");
		expect(actorSink.getEvents()).toHaveLength(0);
	});

	it("checkDirectMutation should always return false (V4 doctrine)", () => {
		const guard = new V5MutationGuard(
			makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: true, mode: "DRAFTING" }),
			new MockTimelineStore() as never,
			new MockActorSink() as never,
		);

		const result = guard.checkDirectMutation("execution-state", "transition");
		expect(result.ok).toBe(false);
		expect((result as { code: string }).code).toBe("FORBIDDEN_EVENT_TYPE");
	});

	it("should allow all allowed actor event types and reject forbidden ones", () => {
		// Verify the allowed set includes the correct types
		const allowedTypes = new Set([...V5_ALLOWED_ACTOR_EVENT_TYPES]);
		expect(allowedTypes.has("proposal_submitted")).toBe(true);
		expect(allowedTypes.has("proposal_evidence_recorded")).toBe(true);
		expect(allowedTypes.has("workspace_started")).toBe(true);
		expect(allowedTypes.has("workspace_running")).toBe(true);
		expect(allowedTypes.has("tool_event")).toBe(true);

		// Verify forbidden types are excluded
		expect(V5_ALLOWED_ACTOR_EVENT_TYPES.has("retry_requested")).toBe(false);
		expect(V5_ALLOWED_ACTOR_EVENT_TYPES.has("validation_started")).toBe(false);
		expect(V5_ALLOWED_ACTOR_EVENT_TYPES.has("validation_passed")).toBe(false);
		expect(V5_ALLOWED_ACTOR_EVENT_TYPES.has("validation_failed")).toBe(false);
		expect(V5_ALLOWED_ACTOR_EVENT_TYPES.has("lease_stale_detected")).toBe(false);
		expect(V5_ALLOWED_ACTOR_EVENT_TYPES.has("cleanup_completed")).toBe(false);
		expect(V5_ALLOWED_ACTOR_EVENT_TYPES.has("llm_timeout")).toBe(false);

		// Verify V5_FORBIDDEN_ACTOR_EVENT_TYPES matches
		for (const forbidden of V5_FORBIDDEN_ACTOR_EVENT_TYPES) {
			expect(V5_ALLOWED_ACTOR_EVENT_TYPES.has(forbidden)).toBe(false);
		}
	});
});

// =========================================================================
// AC 4: Plan Doctor Advisory Report
// =========================================================================

describe("Brain V5 — Plan Doctor (AC 4: Advisory Report)", () => {
	it("should report OFF mode correctly", () => {
		const report = buildV5DoctorReport(makeConfig({ enabled: false, mode: "OFF" }), {
			pushEnabled: false,
			overnightOperatorEnabled: false,
			safetyProfileAllows: false,
			executionContextAllows: false,
			allGatesPassed: false,
		});

		expect(report.mode).toBe("OFF");
		expect(report.canSuggest).toBe(false);
		expect(report.operatorGatesPassed).toBe(false);
		expect(report.summary).toContain("disabled");
		expect(report.details.length).toBeGreaterThan(0);
	});

	it("should report READ_ONLY mode correctly", () => {
		const report = buildV5DoctorReport(makeConfig({ enabled: true, readOnlyMode: true, mode: "READ_ONLY" }), {
			pushEnabled: false,
			overnightOperatorEnabled: false,
			safetyProfileAllows: false,
			executionContextAllows: false,
			allGatesPassed: false,
		});

		expect(report.mode).toBe("READ_ONLY");
		expect(report.canSuggest).toBe(false);
		expect(report.operatorGatesPassed).toBe(false);
		expect(report.summary).toContain("read-only");
	});

	it("should report ADVISORY mode and note that operator gates must pass", () => {
		const report = buildV5DoctorReport(
			makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: false, mode: "ADVISORY" }),
			{
				pushEnabled: false,
				overnightOperatorEnabled: false,
				safetyProfileAllows: false,
				executionContextAllows: false,
				allGatesPassed: false,
			},
		);

		expect(report.mode).toBe("ADVISORY");
		expect(report.canSuggest).toBe(true);
		expect(report.operatorGatesPassed).toBe(false);
		expect(report.summary).toContain("advisory");
		expect(report.summary).toContain("cannot push");

		// Should detail which gates failed
		const detailText = report.details.join(" ");
		expect(detailText).toContain("ADVISORY");
	});

	it("should report ADVISORY mode but note gates pass when all gates pass", () => {
		const report = buildV5DoctorReport(
			makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: false, mode: "ADVISORY" }),
			{
				pushEnabled: false,
				overnightOperatorEnabled: false,
				safetyProfileAllows: true,
				executionContextAllows: true,
				allGatesPassed: true,
			},
		);

		expect(report.mode).toBe("ADVISORY");
		expect(report.operatorGatesPassed).toBe(true);
		expect(report.details.some((d) => d.includes("All operator gates pass"))).toBe(true);
	});

	it("should report DRAFTING mode correctly", () => {
		const report = buildV5DoctorReport(
			makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: true, mode: "DRAFTING" }),
			{
				pushEnabled: true,
				overnightOperatorEnabled: false,
				safetyProfileAllows: true,
				executionContextAllows: true,
				allGatesPassed: true,
			},
		);

		expect(report.mode).toBe("DRAFTING");
		expect(report.canSuggest).toBe(true);
		expect(report.operatorGatesPassed).toBe(true);
		expect(report.summary).toContain("drafting");
		expect(report.details.some((d) => d.includes("BRAIN_V5_PUSH_ENABLED is true"))).toBe(true);
	});

	it("should report OPERATOR_READY mode correctly", () => {
		const report = buildV5DoctorReport(
			makeConfig({
				enabled: true,
				readOnlyMode: false,
				pushEnabled: true,
				overnightOperatorEnabled: true,
				mode: "OPERATOR_READY",
			}),
			{
				pushEnabled: true,
				overnightOperatorEnabled: true,
				safetyProfileAllows: true,
				executionContextAllows: true,
				allGatesPassed: true,
			},
		);

		expect(report.mode).toBe("OPERATOR_READY");
		expect(report.canSuggest).toBe(true);
		expect(report.operatorGatesPassed).toBe(true);
		expect(report.summary).toContain("fully operational");
		expect(report.details.some((d) => d.includes("BRAIN_V5_OVERNIGHT_OPERATOR_ENABLED is true"))).toBe(true);
	});
});

// =========================================================================
// Operator Gates
// =========================================================================

describe("Brain V5 — Operator Gates", () => {
	it("should pass all gates when push is enabled and context allows", () => {
		const config = makeConfig({
			enabled: true,
			readOnlyMode: false,
			pushEnabled: true,
			overnightOperatorEnabled: false,
			mode: "DRAFTING",
		});
		const gates = checkV5OperatorGates(config, {
			safetyProfileAllows: true,
			executionContextAllows: true,
		});

		expect(gates.allGatesPassed).toBe(true);
		expect(gates.pushEnabled).toBe(true);
		expect(gates.safetyProfileAllows).toBe(true);
		expect(gates.executionContextAllows).toBe(true);
	});

	it("should fail when push is not enabled", () => {
		const config = makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: false, mode: "ADVISORY" });
		const gates = checkV5OperatorGates(config, {
			safetyProfileAllows: true,
			executionContextAllows: true,
		});

		expect(gates.allGatesPassed).toBe(false);
		expect(gates.pushEnabled).toBe(false);
	});

	it("should fail when safety profile does not allow", () => {
		const config = makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: true, mode: "DRAFTING" });
		const gates = checkV5OperatorGates(config, {
			safetyProfileAllows: false,
			executionContextAllows: true,
		});

		expect(gates.allGatesPassed).toBe(false);
		expect(gates.safetyProfileAllows).toBe(false);
	});

	it("should fail when execution context does not allow", () => {
		const config = makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: true, mode: "DRAFTING" });
		const gates = checkV5OperatorGates(config, {
			safetyProfileAllows: true,
			executionContextAllows: false,
		});

		expect(gates.allGatesPassed).toBe(false);
		expect(gates.executionContextAllows).toBe(false);
	});

	it("should default optional context to true", () => {
		const config = makeConfig({ enabled: true, readOnlyMode: false, pushEnabled: true, mode: "DRAFTING" });
		const gates = checkV5OperatorGates(config);

		expect(gates.safetyProfileAllows).toBe(true);
		expect(gates.executionContextAllows).toBe(true);
		expect(gates.allGatesPassed).toBe(true);
	});
});
