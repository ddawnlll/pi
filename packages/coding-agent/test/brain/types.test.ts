/**
 * Brain Domain Model — type definitions, validation, and serialization tests.
 *
 * Covers:
 * - Type correctness (compile-time)
 * - Factory functions produce valid objects
 * - Validation rejects invalid objects
 * - Serialization / deserialization round-trips
 * - Test fixtures deserialize correctly
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	ALL_EVENT_SOURCES,
	ALL_SEVERITIES,
	ALL_SIGNAL_TYPES,
	ALL_SOURCE_REF_TYPES,
	ALL_TIMELINE_EVENT_TYPES,
	type BrainObservation,
	type BrainSignal,
	type BrainTimelineEvent,
	createBrainObservation,
	createBrainSignal,
	createBrainTimelineEvent,
	deserializeBrainObservation,
	deserializeBrainSignal,
	deserializeBrainTimelineEvent,
	serializeBrainObservation,
	serializeBrainSignal,
	serializeBrainTimelineEvent,
	validateBrainObservation,
	validateBrainSignal,
	validateBrainTimelineEvent,
} from "../../src/brain/index.js";

// ── Helpers ────────────────────────────────────────────────────────────

function makeValidObservation() {
	return {
		source: "queue" as const,
		signalType: "queue_blocked" as const,
		severity: "warning" as const,
		title: "Test observation",
		description: "A test observation for unit testing",
		provenance: {
			observationSources: [{ type: "queue" as const, path: ".pi/test.json" }],
			derivationChain: [],
			confidence: 0.9,
			validatedBy: "system",
		},
	};
}

const MINIMAL_VALID_SIGNAL = {
	observationIds: ["obs-1", "obs-2"],
	pattern: "test_pattern:unit",
	summary: "A test signal for unit testing",
	confidence: 0.75,
	severity: "info" as const,
};

const MINIMAL_VALID_TIMELINE_EVENT = {
	eventType: "daemon_heartbeat" as const,
	severity: "info" as const,
	data: { uptimeMs: 1000 },
};

// ── Enum / Const Lists ─────────────────────────────────────────────────

describe("enum constant lists", () => {
	test("ALL_SIGNAL_TYPES contains all expected values", () => {
		expect(ALL_SIGNAL_TYPES).toContain("retry_hotspot");
		expect(ALL_SIGNAL_TYPES).toContain("failure_pattern");
		expect(ALL_SIGNAL_TYPES).toContain("queue_blocked");
		expect(ALL_SIGNAL_TYPES).toContain("integration_dirty");
		expect(ALL_SIGNAL_TYPES).toContain("validation_failure");
		expect(ALL_SIGNAL_TYPES).toContain("memory_conflict");
		expect(ALL_SIGNAL_TYPES).toContain("goal_drift");
		expect(ALL_SIGNAL_TYPES).toContain("proposal_generated");
		expect(ALL_SIGNAL_TYPES.length).toBe(8);
	});

	test("ALL_SEVERITIES contains all expected values", () => {
		expect(ALL_SEVERITIES).toContain("info");
		expect(ALL_SEVERITIES).toContain("warning");
		expect(ALL_SEVERITIES).toContain("critical");
		expect(ALL_SEVERITIES.length).toBe(3);
	});

	test("ALL_EVENT_SOURCES contains all expected values", () => {
		expect(ALL_EVENT_SOURCES).toContain("queue");
		expect(ALL_EVENT_SOURCES).toContain("execution");
		expect(ALL_EVENT_SOURCES).toContain("integration");
		expect(ALL_EVENT_SOURCES).toContain("validation");
		expect(ALL_EVENT_SOURCES).toContain("user");
		expect(ALL_EVENT_SOURCES).toContain("system");
		expect(ALL_EVENT_SOURCES.length).toBe(6);
	});

	test("ALL_TIMELINE_EVENT_TYPES contains all expected values", () => {
		expect(ALL_TIMELINE_EVENT_TYPES).toContain("observation");
		expect(ALL_TIMELINE_EVENT_TYPES).toContain("signal");
		expect(ALL_TIMELINE_EVENT_TYPES).toContain("reflection");
		expect(ALL_TIMELINE_EVENT_TYPES).toContain("daemon_heartbeat");
		expect(ALL_TIMELINE_EVENT_TYPES).toContain("daemon_start");
		expect(ALL_TIMELINE_EVENT_TYPES).toContain("daemon_stop");
		expect(ALL_TIMELINE_EVENT_TYPES).toContain("daemon_error");
		expect(ALL_TIMELINE_EVENT_TYPES.length).toBe(7);
	});

	test("ALL_SOURCE_REF_TYPES contains all expected values", () => {
		expect(ALL_SOURCE_REF_TYPES).toContain("file");
		expect(ALL_SOURCE_REF_TYPES).toContain("journal");
		expect(ALL_SOURCE_REF_TYPES).toContain("queue");
		expect(ALL_SOURCE_REF_TYPES).toContain("memory");
		expect(ALL_SOURCE_REF_TYPES).toContain("proposal");
		expect(ALL_SOURCE_REF_TYPES).toContain("plan");
		expect(ALL_SOURCE_REF_TYPES).toContain("workspace");
		expect(ALL_SOURCE_REF_TYPES.length).toBe(7);
	});
});

// ── Factory Functions ──────────────────────────────────────────────────

describe("createBrainObservation", () => {
	test("creates a valid observation with given overrides", () => {
		const obs = createBrainObservation(makeValidObservation());

		expect(obs.id).toBeDefined();
		expect(typeof obs.id).toBe("string");
		expect(obs.timestamp).toBeDefined();
		expect(obs.source).toBe("queue");
		expect(obs.signalType).toBe("queue_blocked");
		expect(obs.severity).toBe("warning");
		expect(obs.title).toBe("Test observation");
		expect(obs.description).toBe("A test observation for unit testing");
		expect(obs.evidence).toEqual([]);
		expect(obs.provenance.confidence).toBe(0.9);
		expect(obs.provenance.validatedBy).toBe("system");
		expect(obs.metadata).toEqual({});
	});

	test("passes validation after creation", () => {
		const obs = createBrainObservation(makeValidObservation());
		const result = validateBrainObservation(obs);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	test("accepts optional evidence and metadata overrides", () => {
		const obs = createBrainObservation({
			...makeValidObservation(),
			evidence: [{ type: "file", path: "src/test.ts", lineStart: 1, lineEnd: 10 }],
			metadata: { key: "value" },
		});

		expect(obs.evidence).toHaveLength(1);
		expect(obs.evidence[0].type).toBe("file");
		expect(obs.metadata).toEqual({ key: "value" });
	});
});

describe("createBrainSignal", () => {
	test("creates a valid signal with given overrides", () => {
		const signal = createBrainSignal(MINIMAL_VALID_SIGNAL);

		expect(signal.id).toBeDefined();
		expect(typeof signal.id).toBe("string");
		expect(signal.createdAt).toBeDefined();
		expect(signal.observationIds).toEqual(["obs-1", "obs-2"]);
		expect(signal.pattern).toBe("test_pattern:unit");
		expect(signal.summary).toBe("A test signal for unit testing");
		expect(signal.confidence).toBe(0.75);
		expect(signal.severity).toBe("info");
		expect(signal.metadata).toEqual({});
	});

	test("passes validation after creation", () => {
		const signal = createBrainSignal(MINIMAL_VALID_SIGNAL);
		const result = validateBrainSignal(signal);
		expect(result.valid).toBe(true);
	});
});

describe("createBrainTimelineEvent", () => {
	test("creates a valid timeline event with given overrides", () => {
		const event = createBrainTimelineEvent(MINIMAL_VALID_TIMELINE_EVENT);

		expect(event.id).toBeDefined();
		expect(typeof event.id).toBe("string");
		expect(event.timestamp).toBeDefined();
		expect(event.eventType).toBe("daemon_heartbeat");
		expect(event.severity).toBe("info");
		expect(event.data).toEqual({ uptimeMs: 1000 });
	});

	test("passes validation after creation", () => {
		const event = createBrainTimelineEvent(MINIMAL_VALID_TIMELINE_EVENT);
		const result = validateBrainTimelineEvent(event);
		expect(result.valid).toBe(true);
	});

	test("accepts optional workspaceId and planExecId", () => {
		const event = createBrainTimelineEvent({
			...MINIMAL_VALID_TIMELINE_EVENT,
			workspaceId: "ws-1",
			planExecId: "plan-1",
		});

		expect(event.workspaceId).toBe("ws-1");
		expect(event.planExecId).toBe("plan-1");
	});
});

// ── Validation ─────────────────────────────────────────────────────────

describe("validateBrainObservation", () => {
	test("rejects null/undefined", () => {
		expect(validateBrainObservation(null).valid).toBe(false);
		expect(validateBrainObservation(undefined).valid).toBe(false);
		expect(validateBrainObservation("string").valid).toBe(false);
	});

	test("rejects missing required fields", () => {
		const result = validateBrainObservation({});
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	test("rejects invalid signalType", () => {
		const invalid = createBrainObservation(makeValidObservation());
		(invalid as unknown as Record<string, unknown>).signalType = "invalid_type";
		const result = validateBrainObservation(invalid);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("signalType"))).toBe(true);
	});

	test("rejects invalid severity", () => {
		const invalid = createBrainObservation(makeValidObservation());
		(invalid as unknown as Record<string, unknown>).severity = "extreme";
		const result = validateBrainObservation(invalid);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("severity"))).toBe(true);
	});

	test("rejects missing provenance fields", () => {
		const invalid = createBrainObservation(makeValidObservation());
		invalid.provenance = {} as never;
		const result = validateBrainObservation(invalid);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("provenance"))).toBe(true);
	});

	test("rejects invalid provenance confidence", () => {
		const invalid = createBrainObservation(makeValidObservation());
		invalid.provenance.confidence = 1.5;
		const result = validateBrainObservation(invalid);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("confidence"))).toBe(true);
	});
});

describe("validateBrainSignal", () => {
	test("rejects null/undefined", () => {
		expect(validateBrainSignal(null).valid).toBe(false);
	});

	test("rejects empty observationIds", () => {
		const invalid = createBrainSignal({ ...MINIMAL_VALID_SIGNAL, observationIds: [] });
		const result = validateBrainSignal(invalid);
		expect(result.valid).toBe(false);
	});

	test("rejects invalid confidence", () => {
		const invalid = createBrainSignal({ ...MINIMAL_VALID_SIGNAL, confidence: -0.1 });
		const result = validateBrainSignal(invalid);
		expect(result.valid).toBe(false);
	});

	test("rejects invalid severity", () => {
		const invalid = createBrainSignal({ ...MINIMAL_VALID_SIGNAL });
		(invalid as unknown as Record<string, unknown>).severity = "unknown";
		const result = validateBrainSignal(invalid);
		expect(result.valid).toBe(false);
	});
});

describe("validateBrainTimelineEvent", () => {
	test("rejects null/undefined", () => {
		expect(validateBrainTimelineEvent(null).valid).toBe(false);
	});

	test("rejects invalid eventType", () => {
		const invalid = createBrainTimelineEvent(MINIMAL_VALID_TIMELINE_EVENT);
		(invalid as unknown as Record<string, unknown>).eventType = "invalid_event";
		const result = validateBrainTimelineEvent(invalid);
		expect(result.valid).toBe(false);
	});

	test("rejects invalid severity", () => {
		const invalid = createBrainTimelineEvent(MINIMAL_VALID_TIMELINE_EVENT);
		(invalid as unknown as Record<string, unknown>).severity = "fatal";
		const result = validateBrainTimelineEvent(invalid);
		expect(result.valid).toBe(false);
	});
});

// ── Serialization / Deserialization ────────────────────────────────────

describe("serialization round-trip", () => {
	test("BrainObservation serializes and deserializes correctly", () => {
		const obs = createBrainObservation(makeValidObservation());
		const json = serializeBrainObservation(obs);
		const parsed = deserializeBrainObservation(json);

		expect(parsed).toEqual(obs);
		expect(parsed.id).toBe(obs.id);
		expect(typeof json).toBe("string");
	});

	test("BrainSignal serializes and deserializes correctly", () => {
		const signal = createBrainSignal(MINIMAL_VALID_SIGNAL);
		const json = serializeBrainSignal(signal);
		const parsed = deserializeBrainSignal(json);

		expect(parsed).toEqual(signal);
	});

	test("BrainTimelineEvent serializes and deserializes correctly", () => {
		const event = createBrainTimelineEvent(MINIMAL_VALID_TIMELINE_EVENT);
		const json = serializeBrainTimelineEvent(event);
		const parsed = deserializeBrainTimelineEvent(json);

		expect(parsed).toEqual(event);
	});
});

describe("deserialization rejects invalid data", () => {
	test("deserializeBrainObservation throws on invalid JSON", () => {
		expect(() => deserializeBrainObservation("not json")).toThrow();
	});

	test("deserializeBrainObservation throws on valid JSON but invalid structure", () => {
		expect(() => deserializeBrainObservation(JSON.stringify({}))).toThrow();
	});

	test("deserializeBrainSignal throws on invalid JSON", () => {
		expect(() => deserializeBrainSignal("not json")).toThrow();
	});

	test("deserializeBrainTimelineEvent throws on invalid JSON", () => {
		expect(() => deserializeBrainTimelineEvent("not json")).toThrow();
	});

	test("deserializeBrainTimelineEvent throws on valid JSON but invalid structure", () => {
		expect(() => deserializeBrainTimelineEvent(JSON.stringify({ id: "test" }))).toThrow();
	});
});

// ── Fixture Integration ────────────────────────────────────────────────

describe("fixture deserialization", () => {
	test("observation-queue-blocked.json deserializes correctly", () => {
		const fixturePath = join(__dirname, "../fixtures/brain/observation-queue-blocked.json");
		const json = readFileSync(fixturePath, "utf-8");
		const obs = deserializeBrainObservation(json);

		expect(obs.source).toBe("queue");
		expect(obs.signalType).toBe("queue_blocked");
		expect(obs.severity).toBe("warning");
		expect(obs.evidence).toHaveLength(1);
		expect(obs.provenance.confidence).toBe(0.95);
		expect(obs.metadata.queueSize).toBe(3);
	});

	test("signal-retry-hotspot.json deserializes correctly", () => {
		const fixturePath = join(__dirname, "../fixtures/brain/signal-retry-hotspot.json");
		const json = readFileSync(fixturePath, "utf-8");
		const signal = deserializeBrainSignal(json);

		expect(signal.observationIds).toHaveLength(2);
		expect(signal.pattern).toBe("retry_hotspot:workspace:3+");
		expect(signal.confidence).toBe(0.85);
		expect(signal.severity).toBe("warning");
	});

	test("timeline-event-daemon-heartbeat.json deserializes correctly", () => {
		const fixturePath = join(__dirname, "../fixtures/brain/timeline-event-daemon-heartbeat.json");
		const json = readFileSync(fixturePath, "utf-8");
		const event = deserializeBrainTimelineEvent(json);

		expect(event.eventType).toBe("daemon_heartbeat");
		expect(event.severity).toBe("info");
		expect(event.data.uptimeMs).toBe(3600000);
	});
});

// ── Type-level correctness (compile-time checks only) ─────────────────

describe("type correctness (compile-time)", () => {
	test("BrainObservation can be created with all fields", () => {
		const obs: BrainObservation = {
			id: "test-id",
			timestamp: "2026-01-01T00:00:00.000Z",
			source: "execution",
			signalType: "failure_pattern",
			severity: "critical",
			title: "Test",
			description: "Desc",
			evidence: [
				{
					type: "file",
					path: "/path/to/file",
					lineStart: 1,
					lineEnd: 10,
					commit: "abc123",
					timestamp: "2026-01-01T00:00:00.000Z",
					id: "ref-1",
				},
			],
			provenance: {
				observationSources: [],
				derivationChain: [],
				confidence: 1,
				validatedBy: "system",
			},
			metadata: { key: "value" },
		};
		expect(obs.source).toBe("execution");
	});

	test("BrainSignal can be created with optional fields", () => {
		const signal: BrainSignal = {
			id: "test-id",
			observationIds: ["obs-1"],
			pattern: "test",
			summary: "Test signal",
			confidence: 0.5,
			severity: "info",
			createdAt: "2026-01-01T00:00:00.000Z",
			resolvedAt: "2026-01-02T00:00:00.000Z",
			metadata: {},
		};
		expect(signal.resolvedAt).toBeDefined();
	});

	test("BrainTimelineEvent can be created with optional context fields", () => {
		const event: BrainTimelineEvent = {
			id: "test-id",
			eventType: "observation",
			timestamp: "2026-01-01T00:00:00.000Z",
			data: {},
			workspaceId: "ws-1",
			planExecId: "plan-1",
			severity: "info",
		};
		expect(event.workspaceId).toBe("ws-1");
		expect(event.planExecId).toBe("plan-1");
	});

	test("all severity values are assignable to Severity type", () => {
		const severities: string[] = ALL_SEVERITIES;
		expect(severities).toContain("info");
		expect(severities).toContain("warning");
		expect(severities).toContain("critical");
	});
});
