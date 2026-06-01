/**
 * WorkerAdapter Boundary Tests — P40 Platform / Agent Separation
 */
import { describe, expect, it, vi } from "vitest";
import { LocalPiWorkerAdapter } from "../src/worker-adapter/local-pi-worker-adapter.js";
import type { WorkerAdapter, WorkerRunResult } from "../src/worker-adapter/types.js";

describe("WorkerAdapter boundary", () => {
	it("WorkerAdapter interface is satisfied by LocalPiWorkerAdapter", () => {
		const adapter: WorkerAdapter = new LocalPiWorkerAdapter({
			createExecutor: () => {
				throw new Error("not implemented");
			},
		});
		expect(adapter).toBeDefined();
		expect(typeof adapter.run).toBe("function");
		expect(typeof adapter.abort).toBe("function");
		expect(typeof adapter.getCapabilities).toBe("function");
	});

	it("WorkerRunResult has no transition authority", () => {
		const result: WorkerRunResult = {
			verdict: "complete",
			events: [],
			changedFiles: [],
			commandHistory: [],
			report: "done",
		};
		expect(result).not.toHaveProperty("transitionWorkspace");
		expect(result).not.toHaveProperty("mutateState");
		expect(result).not.toHaveProperty("markComplete");
		expect(result.verdict).toBeDefined();
	});

	it("WorkerAdapter can be mocked", () => {
		const mockAdapter: WorkerAdapter = {
			run: vi.fn().mockResolvedValue({
				verdict: "complete",
				events: [],
				changedFiles: [],
				commandHistory: [],
				report: "mock",
			}),
			abort: vi.fn().mockResolvedValue(undefined),
			getCapabilities: vi.fn().mockReturnValue({
				name: "mock",
				version: "0.0.0",
				supportsWorktree: false,
				supportsPatchTransaction: false,
				maxConcurrent: 1,
			}),
		};
		expect(mockAdapter.run).toBeDefined();
	});
});

describe("WorkerAdapter forbidden imports", () => {
	it("worker-adapter/types.ts does not import transition-router", async () => {
		const fs = await import("node:fs/promises");
		const content = await fs.readFile(new URL("../src/worker-adapter/types.ts", import.meta.url), "utf-8");
		expect(content).not.toContain("transition-router");
	});

	it("worker-adapter/local-pi-worker-adapter.ts does not call transitionWorkspace", async () => {
		const fs = await import("node:fs/promises");
		const content = await fs.readFile(
			new URL("../src/worker-adapter/local-pi-worker-adapter.ts", import.meta.url),
			"utf-8",
		);
		expect(content).not.toContain("transitionWorkspace");
	});
});
