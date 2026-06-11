import { describe, expect, it } from "vitest";
import { normalizeCriteria } from "../../src/core/mode/acceptance-criteria-normalizer.js";
import { compileMode } from "../../src/core/mode/mode-mapping-compiler.js";
import { evaluateReadiness, type ReadinessGateInputs } from "../../src/core/mode/readiness-gate.js";
import { resolveTargets } from "../../src/core/mode/target-artifact-resolver.js";
import { createTaskIntentEnvelope, setMutationIntent } from "../../src/core/mode/task-intent-envelope.js";

describe("evaluateReadiness", () => {
	it("passes for valid write with new target", () => {
		const envelope = createTaskIntentEnvelope("create /tmp/test-create.ts");
		const updated = setMutationIntent(envelope, "create");
		updated.targetPaths = ["/tmp/test-create.ts"];
		const inputs: ReadinessGateInputs = {
			modeMapping: compileMode(updated),
			targetResolution: resolveTargets(["/tmp/test-create.ts"]),
			criteria: normalizeCriteria("write" as any),
		};

		const result = evaluateReadiness(inputs);
		expect(result.passed).toBe(true);
	});

	it("fails when mode is ambiguous", () => {
		const envelope = createTaskIntentEnvelope("");
		const inputs: ReadinessGateInputs = {
			modeMapping: compileMode(envelope),
			targetResolution: resolveTargets([]),
			criteria: normalizeCriteria("write" as any),
		};

		const result = evaluateReadiness(inputs);
		expect(result.passed).toBe(false);
		expect(result.verdict).toBe("fail");
	});

	it("fails when edit mode but target not found", () => {
		const envelope = createTaskIntentEnvelope("edit /tmp/nonexistent.ts");
		const updated = setMutationIntent(envelope, "modify");
		updated.targetPaths = ["/tmp/nonexistent.ts"];
		const inputs: ReadinessGateInputs = {
			modeMapping: compileMode(updated),
			targetResolution: resolveTargets(["/tmp/nonexistent.ts"]),
			criteria: normalizeCriteria("edit" as any),
		};

		const result = evaluateReadiness(inputs);
		expect(result.passed).toBe(false);
	});
});
