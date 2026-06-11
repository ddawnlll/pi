import { describe, expect, it } from "vitest";
import { checkP45Boundary } from "../../src/core/boundary/p45-boundary-guard.js";

describe("checkP45Boundary", () => {
	it("allows non-forbidden paths", () => {
		const result = checkP45Boundary(["packages/coding-agent/src/core/mode/engine-mode.ts"]);
		expect(result.boundaryCrossed).toBe(false);
	});

	it("blocks p45 path violations", () => {
		const result = checkP45Boundary(["packages/coding-agent/src/p45/async-assembly.ts"]);
		expect(result.boundaryCrossed).toBe(true);
		expect(result.forbiddenPaths).toHaveLength(1);
	});

	it("blocks async-assembly path violations", () => {
		const result = checkP45Boundary(["packages/coding-agent/src/async-assembly/partitioner.ts"]);
		expect(result.boundaryCrossed).toBe(true);
	});

	it("blocks all forbidden paths", () => {
		const paths = [
			"packages/coding-agent/src/p45/runtime.ts",
			"packages/coding-agent/src/async-assembly/runner.ts",
			"packages/coding-agent/src/static-partitioner/config.ts",
			"packages/coding-agent/src/deterministic-assembler/assembler.ts",
		];
		const result = checkP45Boundary(paths);
		expect(result.boundaryCrossed).toBe(true);
		expect(result.forbiddenPaths).toHaveLength(4);
	});
});
