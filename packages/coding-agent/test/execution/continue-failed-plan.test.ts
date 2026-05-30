import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runnerSource = readFileSync("packages/web-server/src/plan-runner.ts", "utf-8");
const routeSource = readFileSync("packages/web-server/src/index.ts", "utf-8");
const executorSource = readFileSync("packages/coding-agent/src/core/autonomous-executor.ts", "utf-8");

describe("continue_failed_plan_resumes_running", () => {
	it("uses terminal recovery, preserves snapshots, and reports unrecoverable continue states", () => {
		expect(runnerSource).toContain("continuePlanExecution");
		expect(runnerSource).toContain("allowTerminal: true");
		expect(runnerSource).toContain("preserving snapshots for manual continue");
		expect(routeSource).toContain("continue_no_resettable_workspaces");
		expect(routeSource).toContain("continue_failed_queue_missing");
		expect(executorSource).toContain("previousStage: WorkspaceStage.Failed");
		expect(executorSource).toContain("await this.stateStore.resumePlan(planExecutionId)");
	});
});
