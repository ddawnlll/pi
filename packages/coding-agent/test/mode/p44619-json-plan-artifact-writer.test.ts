import { describe, expect, it } from "vitest";
import { createTaskIntentEnvelope } from "../../src/core/mode/task-intent-envelope.js";
import { writePlanArtifact } from "../../src/core/smart-write/json-plan-artifact-writer.js";

describe("writePlanArtifact", () => {
	it("writes a planspec_v5 artifact", () => {
		const envelope = createTaskIntentEnvelope("create implementation plan");
		const result = writePlanArtifact(envelope, "planspec_v5", "/tmp/plan.json");
		expect(result.written).toBe(true);
		expect(result.artifact?.kind).toBe("planspec_v5");
		expect(result.artifact?.fromMarkdown).toBe(false);
	});

	it("rejects unknown schema", () => {
		const envelope = createTaskIntentEnvelope("create");
		const result = writePlanArtifact(envelope, "unknown", "/tmp/out.json");
		expect(result.written).toBe(false);
	});
});
