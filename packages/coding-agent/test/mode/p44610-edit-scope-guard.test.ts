import { describe, expect, it } from "vitest";
import { type EditConfig, EngineMode } from "../../src/core/mode/engine-mode.js";
import { createTaskIntentEnvelope } from "../../src/core/mode/task-intent-envelope.js";
import { evaluateEditScope } from "../../src/core/write-gate/edit-scope-guard.js";

describe("evaluateEditScope", () => {
	it("authorizes edit with target and preserve constraints", () => {
		const config: EditConfig = { mode: EngineMode.Edit, targetPath: "/tmp/file.ts", preserveConstraints: ["header"] };
		const result = evaluateEditScope(config, createTaskIntentEnvelope("edit the file"));
		expect(result.authorized).toBe(true);
	});

	it("rejects non-edit mode", () => {
		const config = { mode: EngineMode.Write, targetPath: "/tmp/n.ts" } as any;
		const result = evaluateEditScope(config, createTaskIntentEnvelope("write"));
		expect(result.authorized).toBe(false);
	});

	it("blocks when target path is missing", () => {
		const config: EditConfig = { mode: EngineMode.Edit, targetPath: "" };
		const result = evaluateEditScope(config, createTaskIntentEnvelope("edit"));
		expect(result.authorized).toBe(false);
	});

	it("selects replace_block strategy by default", () => {
		const config: EditConfig = { mode: EngineMode.Edit, targetPath: "/tmp/file.ts" };
		const result = evaluateEditScope(config, createTaskIntentEnvelope("fix the code"));
		expect(result.patchStrategy).toBe("replace_block");
	});

	it("selects append strategy from prompt", () => {
		const config: EditConfig = { mode: EngineMode.Edit, targetPath: "/tmp/file.ts" };
		const result = evaluateEditScope(config, createTaskIntentEnvelope("append a new function"));
		expect(result.patchStrategy).toBe("append");
	});
});
