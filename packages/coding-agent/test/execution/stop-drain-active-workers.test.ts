import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const executorSource = readFileSync("packages/coding-agent/src/core/autonomous-executor.ts", "utf-8");
const runnerSource = readFileSync("packages/web-server/src/plan-runner.ts", "utf-8");

describe("stop_drains_active_workers", () => {
	it("aborts workers, waits for in-flight work, kills processes, and is called by the runner", () => {
		expect(executorSource).toContain("drainAndTerminalizeActiveWorkspaces");
		expect(executorSource).toContain("workspace_abort_requested");
		expect(executorSource).toContain("workspace_inflight_settled");
		expect(executorSource).toContain("workspace_inflight_timeout");
		expect(executorSource).toContain("killPlanProcesses(planExecutionId");
		expect(executorSource).toContain("workspace_locks_released");
		expect(runnerSource).toContain("await executor.drainActiveWorkspacesForStop");
	});
});
