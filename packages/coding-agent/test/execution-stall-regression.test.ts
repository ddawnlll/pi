import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AutonomousExecutor } from "../src/core/autonomous-executor.js";
import { JsonStateStore } from "../src/core/json-state-store.js";
import { setSystemMemoryLimitBytes } from "../src/core/worker-memory-guard.js";
import { WorkspaceAgentExecutor } from "../src/core/workspace-agent-executor.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";
import { WorkspaceStage } from "../src/core/workspace-schema.js";

describe("execution stall regressions", () => {
	afterEach(() => {
		setSystemMemoryLimitBytes(Infinity);
	});

	it("does not emit retry_attempt for initial execution", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-retry-regression-"));
		try {
			setSystemMemoryLimitBytes(Infinity);
			const stateStore = new JsonStateStore(tmpDir);
			const executor = new AutonomousExecutor(stateStore, {
				workspaceRoot: tmpDir,
				maxWorkers: 1,
				projectId: "test-project",
				skipProjectManagement: true,
			});
			const queue: WorkspaceQueue = {
				phase: "P25",
				title: "Retry Regression",
				maxParallelWorkspaces: 1,
				workspaces: [
					{
						id: "P25.A",
						title: "Initial attempt",
						dependencies: [],
						roleBudget: "worker",
						maxRetries: 3,
					},
				],
			};

			const planExecutionId = await executor.initialize(queue);
			await executor.executeWorkspace(queue.workspaces[0]);

			const journal = await stateStore.readJournal(planExecutionId);
			const retryEvents = journal.filter((e) => e.workspaceId === "P25.A" && e.type === "retry_attempt");
			expect(retryEvents).toHaveLength(0);

			const finalState = executor.getState()?.workspaces.get("P25.A");
			expect(finalState?.stage).toBe(WorkspaceStage.Complete);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	it("contains first-event stall watchdog diagnostics", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-watchdog-regression-"));
		try {
			const executor = new WorkspaceAgentExecutor({
				workspaceRoot: tmpDir,
				model: { provider: "test", id: "test-model" } as never,
				worktree: { enabled: false },
			});

			expect((executor as unknown as { firstAgentEventTimeoutMs: number }).firstAgentEventTimeoutMs).toBeGreaterThan(
				0,
			);

			const source = await fs.readFile(require.resolve("../src/core/workspace-agent-executor.ts"), "utf-8");
			expect(source).toContain("stalled_waiting_for_first_event");
			expect(source).toContain("First agent event observed");
			expect(source).toContain("Failure diagnostics:");
			expect(source).toContain("Execution diagnostics:");
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});
});
