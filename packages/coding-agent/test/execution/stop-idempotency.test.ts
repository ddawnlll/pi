import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("packages/coding-agent/src/core/autonomous-executor.ts", "utf-8");

describe("stop_is_idempotent", () => {
	it("serializes stop drain and prevents new scheduling while stopping", () => {
		expect(source).toContain("private stopMutex = new AsyncMutex()");
		expect(source).toContain("return this.stopMutex.runExclusive");
		expect(source).toContain("this.isStopping = true");
		expect(source).toContain("if (this.isStopping)");
		expect(source).toContain("await this.stateStore.clearControlRequest(planExecutionId)");
	});
});
