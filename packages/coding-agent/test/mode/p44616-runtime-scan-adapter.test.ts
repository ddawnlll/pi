import { describe, expect, it } from "vitest";
import { EngineMode } from "../../src/core/mode/engine-mode.js";
import { createTaskIntentEnvelope } from "../../src/core/mode/task-intent-envelope.js";
import { runProductionScan } from "../../src/execution-runtime/runtime-scan-adapter.js";

describe("runProductionScan", () => {
	it("runs through production adapter path for write", () => {
		const config = {
			mode: EngineMode.Write as const,
			targetPath: "/tmp/new.ts",
			overwritePolicy: "fail_if_exists" as const,
		};
		const result = runProductionScan(config as any, createTaskIntentEnvelope("create file"));
		expect(result.productionPathUsed).toBe(true);
		expect(result.degradedMode).toBeNull();
		expect(result.adapterResult).not.toBeNull();
	});

	it("reports operation blocked without degradation", () => {
		const config = { mode: EngineMode.Write as const, targetPath: "", overwritePolicy: "fail_if_exists" as const };
		const result = runProductionScan(config as any, createTaskIntentEnvelope("create"));
		expect(result.productionPathUsed).toBe(true);
		expect(result.adapterResult?.authorized).toBe(false);
	});

	it("reports degraded mode on adapter error", () => {
		// Pass invalid config to trigger gate error
		const config = {} as any;
		const result = runProductionScan(config, createTaskIntentEnvelope("test"));
		expect(result.productionPathUsed).toBe(false);
		expect(result.degradedMode).not.toBeNull();
		expect(result.degradedMode?.blocking).toBe(true);
	});
});
