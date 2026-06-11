import { describe, expect, it } from "vitest";
import { EngineMode, type WriteConfig } from "../../src/core/mode/engine-mode.js";
import { createTaskIntentEnvelope } from "../../src/core/mode/task-intent-envelope.js";
import { evaluateWriteGate } from "../../src/core/write-gate/write-gate-v2.js";

describe("evaluateWriteGate", () => {
	it("authorizes valid write with target and overwrite policy", () => {
		const config: WriteConfig = {
			mode: EngineMode.Write,
			targetPath: "/tmp/new.ts",
			overwritePolicy: "fail_if_exists",
		};
		const envelope = createTaskIntentEnvelope("create /tmp/new.ts");
		envelope.constraints = [{ domain: "path", description: "Must exist", hardness: "hard" }];
		const result = evaluateWriteGate(config, envelope);
		expect(result.authorized).toBe(true);
		expect(result.targetPath).toBe("/tmp/new.ts");
	});

	it("rejects non-write mode", () => {
		const config = { mode: EngineMode.Edit, targetPath: "/tmp/existing.ts" } as any;
		const result = evaluateWriteGate(config, createTaskIntentEnvelope("edit"));
		expect(result.authorized).toBe(false);
	});

	it("blocks when target path is missing", () => {
		const config: WriteConfig = { mode: EngineMode.Write, targetPath: "", overwritePolicy: "fail_if_exists" };
		const result = evaluateWriteGate(config, createTaskIntentEnvelope("create"));
		expect(result.authorized).toBe(false);
		expect(result.diagnostics.some((d) => d.code === "BLOCKED_MISSING_TARGET")).toBe(true);
	});

	it("determines artifact type from path", () => {
		const config: WriteConfig = {
			mode: EngineMode.Write,
			targetPath: "/tmp/component.tsx",
			overwritePolicy: "allow",
		};
		const result = evaluateWriteGate(config, createTaskIntentEnvelope("create component"));
		expect(result.artifactType).toBe("typescript_react");
	});
});
