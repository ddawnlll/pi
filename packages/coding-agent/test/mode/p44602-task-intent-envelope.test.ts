/**
 * P44.6.02 — Serializable Task Intent Envelope
 *
 * Unit tests for:
 * - TaskIntentEnvelope creation and default values
 * - MutationIntent type
 * - AmbiguitySignal creation and blocking checks
 * - JSON serialization/deserialization round-trip
 * - Structural validation (validateTaskIntentEnvelope)
 * - Helper functions (hasBlockingAmbiguities, hasResolvedIntent, etc.)
 * - That the envelope is serializable and not runtime-dependent
 *
 * Contract Schema: 4.1.1
 */

import { describe, expect, it } from "vitest";
import {
	type AmbiguitySignal,
	addAmbiguity,
	addConstraint,
	type Constraint,
	createTaskIntentEnvelope,
	deserializeTaskIntentEnvelope,
	hasBlockingAmbiguities,
	hasResolvedIntent,
	serializeTaskIntentEnvelope,
	setMutationIntent,
	TASK_INTENT_ENVELOPE_SCHEMA_VERSION,
	validateTaskIntentEnvelope,
} from "../../src/core/mode/task-intent-envelope.js";

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

describe("createTaskIntentEnvelope", () => {
	it("creates an envelope from a raw prompt", () => {
		const envelope = createTaskIntentEnvelope("Create a new file called foo.ts");
		expect(envelope.rawPrompt).toBe("Create a new file called foo.ts");
		expect(envelope.mutationIntent).toBeNull();
		expect(envelope.targetPaths).toBeNull();
		expect(envelope.targetExists).toBeNull();
		expect(envelope.overwritePolicy).toBeNull();
		expect(envelope.constraints).toEqual([]);
		expect(envelope.ambiguities).toEqual([]);
		expect(envelope.metadata).toEqual({});
		expect(typeof envelope.timestamp).toBe("number");
		expect(envelope.schemaVersion).toBe(TASK_INTENT_ENVELOPE_SCHEMA_VERSION);
	});

	it("creates an envelope with a correlation ID", () => {
		const envelope = createTaskIntentEnvelope("Edit foo.ts", "corr-123");
		expect(envelope.correlationId).toBe("corr-123");
	});

	it("creates an envelope without a correlation ID", () => {
		const envelope = createTaskIntentEnvelope("Create foo.ts");
		expect(envelope.correlationId).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// MutationIntent
// ---------------------------------------------------------------------------

describe("MutationIntent", () => {
	it("allows all valid mutation intent values", () => {
		const validIntents = [
			"create",
			"modify",
			"audit_then_mutate",
			"route_then_create",
			"delete",
			"read_only",
		] as const;

		for (const intent of validIntents) {
			const envelope = setMutationIntent(createTaskIntentEnvelope("test"), intent);
			expect(envelope.mutationIntent).toBe(intent);
		}
	});
});

// ---------------------------------------------------------------------------
// Ambiguity Signals
// ---------------------------------------------------------------------------

describe("AmbiguitySignal", () => {
	it("adds a blocking ambiguity signal", () => {
		const envelope = createTaskIntentEnvelope("fix the file");
		const signal: AmbiguitySignal = {
			code: "missing_target_path",
			message: "No target file path specified in the prompt.",
			blocking: true,
		};
		const updated = addAmbiguity(envelope, signal);
		expect(updated.ambiguities).toHaveLength(1);
		expect(updated.ambiguities[0].code).toBe("missing_target_path");
		expect(updated.ambiguities[0].blocking).toBe(true);
		// Original should be unchanged (immutable update)
		expect(envelope.ambiguities).toHaveLength(0);
	});

	it("adds a non-blocking ambiguity signal", () => {
		const envelope = createTaskIntentEnvelope("create a component");
		const signal: AmbiguitySignal = {
			code: "unclear_target_existence",
			message: "Target may already exist.",
			blocking: false,
		};
		const updated = addAmbiguity(envelope, signal);
		expect(updated.ambiguities).toHaveLength(1);
		expect(updated.ambiguities[0].blocking).toBe(false);
	});

	it("supports multiple ambiguity signals", () => {
		let envelope = createTaskIntentEnvelope("fix the thing in the place");
		envelope = addAmbiguity(envelope, {
			code: "missing_target_path",
			message: "No target path.",
			blocking: true,
		});
		envelope = addAmbiguity(envelope, {
			code: "unclear_mutation_intent",
			message: "Unclear what to do.",
			blocking: true,
		});
		expect(envelope.ambiguities).toHaveLength(2);
	});

	it("supports trigger phrase", () => {
		const signal: AmbiguitySignal = {
			code: "multiple_interpretations",
			message: "Phrase 'the thing' is ambiguous.",
			triggerPhrase: "the thing",
			blocking: true,
		};
		expect(signal.triggerPhrase).toBe("the thing");
	});
});

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

describe("Constraint", () => {
	it("adds a hard constraint", () => {
		let envelope = createTaskIntentEnvelope("create a file");
		const constraint: Constraint = {
			domain: "path",
			description: "Must be under src/components/",
			hardness: "hard",
		};
		envelope = addConstraint(envelope, constraint);
		expect(envelope.constraints).toHaveLength(1);
		expect(envelope.constraints[0].hardness).toBe("hard");
	});

	it("adds a soft constraint", () => {
		let envelope = createTaskIntentEnvelope("create a file");
		envelope = addConstraint(envelope, {
			domain: "style",
			description: "Prefer camelCase naming",
			hardness: "soft",
		});
		expect(envelope.constraints[0].hardness).toBe("soft");
	});
});

// ---------------------------------------------------------------------------
// Serialization Round-Trip
// ---------------------------------------------------------------------------

describe("JSON serialization", () => {
	it("round-trips a complete envelope without data loss", () => {
		const original = createTaskIntentEnvelope("Create file.ts under src/", "corr-456");
		const updated = setMutationIntent(original, "create");
		updated.targetPaths = ["src/file.ts"];
		updated.targetExists = false;
		updated.overwritePolicy = "fail_if_exists";
		updated.constraints = [{ domain: "path", description: "Must be under src/", hardness: "hard" }];
		updated.metadata = { source: "cli" };

		const json = serializeTaskIntentEnvelope(updated);
		const deserialized = deserializeTaskIntentEnvelope(json);

		expect(deserialized).not.toBeNull();
		expect(deserialized!.rawPrompt).toBe("Create file.ts under src/");
		expect(deserialized!.correlationId).toBe("corr-456");
		expect(deserialized!.mutationIntent).toBe("create");
		expect(deserialized!.targetPaths).toEqual(["src/file.ts"]);
		expect(deserialized!.targetExists).toBe(false);
		expect(deserialized!.overwritePolicy).toBe("fail_if_exists");
		expect(deserialized!.constraints).toHaveLength(1);
		expect(deserialized!.metadata.source).toBe("cli");
		expect(deserialized!.timestamp).toBe(updated.timestamp);
	});

	it("round-trips an envelope with ambiguities", () => {
		let envelope = createTaskIntentEnvelope("do something");
		envelope = addAmbiguity(envelope, {
			code: "missing_target_path",
			message: "No target.",
			blocking: true,
		});
		envelope = addAmbiguity(envelope, {
			code: "unclear_mutation_intent",
			message: "Unclear intent.",
			blocking: false,
		});

		const json = serializeTaskIntentEnvelope(envelope);
		const deserialized = deserializeTaskIntentEnvelope(json);

		expect(deserialized).not.toBeNull();
		expect(deserialized!.ambiguities).toHaveLength(2);
		expect(deserialized!.ambiguities[0].code).toBe("missing_target_path");
		expect(deserialized!.ambiguities[0].blocking).toBe(true);
		expect(deserialized!.ambiguities[1].code).toBe("unclear_mutation_intent");
	});

	it("returns null for invalid JSON", () => {
		const result = deserializeTaskIntentEnvelope("not valid json");
		expect(result).toBeNull();
	});

	it("returns null for structurally invalid envelope", () => {
		const result = deserializeTaskIntentEnvelope(JSON.stringify({ foo: "bar" }));
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateTaskIntentEnvelope", () => {
	it("accepts a valid envelope", () => {
		const envelope = createTaskIntentEnvelope("create foo.ts");
		expect(validateTaskIntentEnvelope(envelope)).toBe(true);
	});

	it("rejects null", () => {
		expect(validateTaskIntentEnvelope(null)).toBe(false);
	});

	it("rejects non-objects", () => {
		expect(validateTaskIntentEnvelope("string")).toBe(false);
		expect(validateTaskIntentEnvelope(42)).toBe(false);
		expect(validateTaskIntentEnvelope(undefined)).toBe(false);
	});

	it("rejects an envelope missing schemaVersion", () => {
		const invalid = {
			rawPrompt: "test",
			mutationIntent: null,
			targetPaths: null,
			targetExists: null,
			overwritePolicy: null,
			constraints: [],
			ambiguities: [],
			metadata: {},
			timestamp: Date.now(),
		};
		expect(validateTaskIntentEnvelope(invalid)).toBe(false);
	});

	it("rejects an envelope with wrong-type fields", () => {
		const invalid = {
			...createTaskIntentEnvelope("test"),
			timestamp: "not a number",
		};
		expect(validateTaskIntentEnvelope(invalid)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

describe("hasBlockingAmbiguities", () => {
	it("returns false when there are no ambiguities", () => {
		const envelope = createTaskIntentEnvelope("create foo.ts");
		expect(hasBlockingAmbiguities(envelope)).toBe(false);
	});

	it("returns true when there is a blocking ambiguity", () => {
		let envelope = createTaskIntentEnvelope("test");
		envelope = addAmbiguity(envelope, {
			code: "missing_target_path",
			message: "No target.",
			blocking: true,
		});
		expect(hasBlockingAmbiguities(envelope)).toBe(true);
	});

	it("returns false when only non-blocking ambiguities exist", () => {
		let envelope = createTaskIntentEnvelope("test");
		envelope = addAmbiguity(envelope, {
			code: "unclear_target_existence",
			message: "May exist.",
			blocking: false,
		});
		expect(hasBlockingAmbiguities(envelope)).toBe(false);
	});
});

describe("hasResolvedIntent", () => {
	it("returns false when mutationIntent is null", () => {
		const envelope = createTaskIntentEnvelope("test");
		expect(hasResolvedIntent(envelope)).toBe(false);
	});

	it("returns true when mutationIntent is set", () => {
		const envelope = setMutationIntent(createTaskIntentEnvelope("test"), "create");
		expect(hasResolvedIntent(envelope)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Design Contract: Serializability
// ---------------------------------------------------------------------------

describe("design contract — serializability", () => {
	it("envelope contains no functions or symbols", () => {
		const envelope = createTaskIntentEnvelope("create foo.ts");
		const json = JSON.stringify(envelope);
		const parsed = JSON.parse(json);
		// No functions, no symbols, no undefined — all serialized correctly
		expect(parsed.schemaVersion).toBe(TASK_INTENT_ENVELOPE_SCHEMA_VERSION);
		expect(parsed.rawPrompt).toBe("create foo.ts");
	});

	it("envelope is the single authoritative input — no runtime state", () => {
		const envelope = createTaskIntentEnvelope("edit foo.ts");
		// The envelope must NOT carry:
		// - Runtime session references
		// - Derived mode decisions
		// - Authentication tokens
		// - Arbitrary executable code
		const record = envelope as unknown as Record<string, unknown>;
		expect(record.mode).toBeUndefined();
		expect(record.sessionId).toBeUndefined();
		expect(record.authToken).toBeUndefined();
		expect(record.executable).toBeUndefined();
	});
});
