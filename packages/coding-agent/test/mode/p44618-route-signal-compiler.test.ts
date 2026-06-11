import { describe, expect, it } from "vitest";
import { addAmbiguity, createTaskIntentEnvelope, setMutationIntent } from "../../src/core/mode/task-intent-envelope.js";
import { compileRouteSignal } from "../../src/core/smart-write/route-signal-compiler.js";

describe("compileRouteSignal", () => {
	it("routes to PLAN_JSON for route_then_create with planspec intent", () => {
		let envelope = createTaskIntentEnvelope("create an implementation plan for the auth module");
		envelope = setMutationIntent(envelope, "route_then_create");
		const result = compileRouteSignal(envelope);
		expect(result.signal).toBe("ROUTE_TO_PLAN_JSON");
	});

	it("routes to WRITE for simple write intent", () => {
		let envelope = createTaskIntentEnvelope("create src/foo.ts");
		envelope = setMutationIntent(envelope, "create");
		envelope.targetPaths = ["src/foo.ts"];
		const result = compileRouteSignal(envelope);
		expect(result.signal).toBe("ROUTE_TO_WRITE");
	});

	it("blocks on ambiguous input", () => {
		let envelope = createTaskIntentEnvelope("do something");
		envelope = addAmbiguity(envelope, { code: "unclear_mutation_intent", message: "?", blocking: true });
		const result = compileRouteSignal(envelope);
		expect(result.signal).toBe("BLOCKED_AMBIGUOUS_MODE");
	});
});
