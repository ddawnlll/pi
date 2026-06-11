import { describe, expect, it } from "vitest";
import { EngineMode } from "../../src/core/mode/engine-mode.js";
import { createTaskIntentEnvelope } from "../../src/core/mode/task-intent-envelope.js";
import { routeToolOperation } from "../../src/execution-runtime/tool-runtime-adapter.js";

describe("routeToolOperation", () => {
	it("routes write operations through WriteGate", () => {
		const config = {
			mode: EngineMode.Write as const,
			targetPath: "/tmp/new.ts",
			overwritePolicy: "fail_if_exists" as const,
		};
		const result = routeToolOperation(config as any, createTaskIntentEnvelope("create new file"));
		expect(result.operation).toBe("write");
		expect(result.authorized).toBe(true);
	});

	it("blocks write when gate rejects", () => {
		const config = { mode: EngineMode.Write as const, targetPath: "", overwritePolicy: "fail_if_exists" as const };
		const result = routeToolOperation(config as any, createTaskIntentEnvelope("create"));
		expect(result.operation).toBe("blocked");
		expect(result.authorized).toBe(false);
	});

	it("routes edit operations through EditScopeGuard", () => {
		const config = { mode: EngineMode.Edit as const, targetPath: "/tmp/existing.ts" };
		const result = routeToolOperation(config as any, createTaskIntentEnvelope("edit existing file"));
		expect(result.operation).toBe("edit");
		expect(result.authorized).toBe(true);
	});

	it("routes smart operations without gate", () => {
		const config = { mode: EngineMode.SmartWrite as const, outputSchema: "artifact" as const };
		const result = routeToolOperation(config as any, createTaskIntentEnvelope("smart write"));
		expect(result.operation).toBe("smart_write");
		expect(result.authorized).toBe(true);
	});
});
