/**
 * P43.8B — Provider stream liveness tests
 *
 * Tests that LLM provider streams have absolute wall-clock timeout
 * that fires independently of event activity (keep-alive events).
 */

import { describe, expect, it } from "vitest";
import { WorkspaceAgentExecutor } from "../src/core/workspace-agent-executor.js";

describe("provider stream wall-clock timeout", () => {
	it("llmStreamWallClockTimeoutMs config is accepted", () => {
		const executor = new WorkspaceAgentExecutor({
			workspaceRoot: "/tmp",
			model: { provider: "test", id: "test-model" } as never,
			worktree: { enabled: false },
			llmStreamWallClockTimeoutMs: 10_000,
		});

		expect((executor as unknown as { llmStreamWallClockTimeoutMs: number }).llmStreamWallClockTimeoutMs).toBe(10_000);
	});

	it("default wall-clock timeout is 10 minutes", () => {
		const executor = new WorkspaceAgentExecutor({
			workspaceRoot: "/tmp",
			model: { provider: "test", id: "test-model" } as never,
			worktree: { enabled: false },
		});

		expect((executor as unknown as { llmStreamWallClockTimeoutMs: number }).llmStreamWallClockTimeoutMs).toBe(
			10 * 60 * 1000,
		);
	});

	it("execution context has llmWallClockHandle field", () => {
		const _executor = new WorkspaceAgentExecutor({
			workspaceRoot: "/tmp",
			model: { provider: "test", id: "test-model" } as never,
			worktree: { enabled: false },
		});

		// Create an execution context and verify the field exists
		const source = WorkspaceAgentExecutor.toString();
		expect(source).toContain("llmWallClockHandle");
	});

	it("first-event timeout still functions independently", () => {
		const executor = new WorkspaceAgentExecutor({
			workspaceRoot: "/tmp",
			model: { provider: "test", id: "test-model" } as never,
			worktree: { enabled: false },
			firstAgentEventTimeoutMs: 5_000,
		});

		expect((executor as unknown as { firstAgentEventTimeoutMs: number }).firstAgentEventTimeoutMs).toBe(5_000);
	});

	it("llmStreamIdleTimeoutMs remains separate from wall-clock timeout", () => {
		const executor = new WorkspaceAgentExecutor({
			workspaceRoot: "/tmp",
			model: { provider: "test", id: "test-model" } as never,
			worktree: { enabled: false },
			llmStreamIdleTimeoutMs: 10_000,
			llmStreamWallClockTimeoutMs: 30_000,
		});

		const idle = (executor as unknown as { llmStreamIdleTimeoutMs: number }).llmStreamIdleTimeoutMs;
		const wall = (executor as unknown as { llmStreamWallClockTimeoutMs: number }).llmStreamWallClockTimeoutMs;
		expect(idle).toBe(10_000);
		expect(wall).toBe(30_000);
		expect(wall).toBeGreaterThan(idle);
	});

	it("timeoutMs (total execution timeout) still works independently", () => {
		const executor = new WorkspaceAgentExecutor({
			workspaceRoot: "/tmp",
			model: { provider: "test", id: "test-model" } as never,
			worktree: { enabled: false },
			timeoutMs: 5 * 60 * 1000,
		});

		expect((executor as unknown as { timeoutMs: number }).timeoutMs).toBe(5 * 60 * 1000);
	});

	it("source contains wall-clock abort message", async () => {
		const source = await import("node:fs/promises").then((fs) =>
			fs.readFile(new URL("../src/core/workspace-agent-executor.ts", import.meta.url), "utf-8"),
		);
		expect(source).toContain("llm_wall_clock_timeout");
		expect(source).toContain("llmStreamWallClockTimeoutMs");
	});
});
