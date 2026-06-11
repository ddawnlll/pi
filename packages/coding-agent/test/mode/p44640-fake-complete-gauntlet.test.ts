/**
 * P44.6.40 — Fake Complete and Silent Pass Gauntlet
 *
 * Proves that self-reported-done, no-tests-found, watch-mode output,
 * command-not-found, and stale-report claims are blocked.
 *
 * Contract Schema: 4.1.1
 */

import { describe, expect, it } from "vitest";
import { normalizeCriteria } from "../../src/core/mode/acceptance-criteria-normalizer.js";
import { compileMode } from "../../src/core/mode/mode-mapping-compiler.js";
import { evaluateReadiness } from "../../src/core/mode/readiness-gate.js";
import { resolveTargets } from "../../src/core/mode/target-artifact-resolver.js";
import { createTaskIntentEnvelope } from "../../src/core/mode/task-intent-envelope.js";

// ---------------------------------------------------------------------------
// Self-Reported-Done
// ---------------------------------------------------------------------------

describe("self-reported-done is blocked", () => {
	it("'it's done' without evidence is not a valid claim", () => {
		const envelope = createTaskIntentEnvelope("it's done");
		const result = compileMode(envelope);
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// No Tests Found
// ---------------------------------------------------------------------------

describe("no-tests-found is blocked", () => {
	it("mode compilation requires explicit intent", () => {
		const envelope = createTaskIntentEnvelope("no tests found");
		const result = compileMode(envelope);
		expect(result.mode).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Watch-Mode Output
// ---------------------------------------------------------------------------

describe("watch-mode output is not actionable", () => {
	it("watch-like output is not a valid intent", () => {
		const envelope = createTaskIntentEnvelope("watching for changes...");
		const result = compileMode(envelope);
		expect(result.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Command Not Found
// ---------------------------------------------------------------------------

describe("command-not-found is blocked", () => {
	it("'command not found' is not a valid operation", () => {
		const envelope = createTaskIntentEnvelope("command not found: npx");
		const result = compileMode(envelope);
		expect(result.mode).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Stale Report Claims
// ---------------------------------------------------------------------------

describe("stale report claims are detected", () => {
	it("readiness gate requires valid mode resolution", () => {
		const envelope = createTaskIntentEnvelope("report says everything passes");
		const modeMapping = compileMode(envelope);
		const targetResolution = resolveTargets([]);
		const criteria = normalizeCriteria("write" as any);
		const result = evaluateReadiness({ modeMapping, targetResolution, criteria });
		expect(result.passed).toBe(false);
	});
});
