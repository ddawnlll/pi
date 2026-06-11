/**
 * P44.6.38 — Production Runtime Integration Test Path
 *
 * Real production scan path tests, not mock-only, proving runtime
 * adapter is wired. Tests the adapter path end-to-end.
 *
 * Contract Schema: 4.1.1
 */

import { describe, expect, it } from "vitest";
import { EngineMode } from "../../src/core/mode/engine-mode.js";
import { createTaskIntentEnvelope } from "../../src/core/mode/task-intent-envelope.js";
import { runProductionScan } from "../../src/execution-runtime/runtime-scan-adapter.js";
import { routeToolOperation } from "../../src/execution-runtime/tool-runtime-adapter.js";

describe("Runtime Integration Path", () => {
	it("routes write through production adapter", () => {
		const config = {
			mode: EngineMode.Write,
			targetPath: "/tmp/integration-test.ts",
			overwritePolicy: "fail_if_exists" as const,
		};
		const envelope = createTaskIntentEnvelope("create integration test file");
		envelope.constraints = [{ domain: "path", description: "Must be created", hardness: "hard" }];
		const result = routeToolOperation(config as any, envelope);
		expect(result.operation).toBe("write");
		expect(result.authorized).toBe(true);
	});

	it("runtime scan uses single production path", () => {
		const config = { mode: EngineMode.Write, targetPath: "/tmp/scan-test.ts", overwritePolicy: "allow" as const };
		const result = runProductionScan(config as any, createTaskIntentEnvelope("scan test"));
		expect(result.productionPathUsed).toBe(true);
		expect(result.degradedMode).toBeNull();
	});
});
