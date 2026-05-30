/**
 * Boundary Import Guards — P40 Platform / Agent Separation
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = path.resolve(import.meta.dirname, "../src");
async function readFile(relPath: string): Promise<string> { return fs.readFile(path.join(SRC_DIR, relPath), "utf-8"); }

describe("WorkerAdapter boundary imports", () => {
	it("worker-adapter/types.ts does not import transition-router", async () => {
		const content = await readFile("worker-adapter/types.ts");
		expect(content).not.toContain("transition-router");
	});

	it("worker-adapter/local-pi-worker-adapter.ts does not import state-writer", async () => {
		const content = await readFile("worker-adapter/local-pi-worker-adapter.ts");
		expect(content).not.toContain("state-writer");
	});

	it("worker-adapter/local-pi-worker-adapter.ts does not call transitionWorkspace", async () => {
		const content = await readFile("worker-adapter/local-pi-worker-adapter.ts");
		expect(content).not.toContain("transitionWorkspace");
	});
});

describe("Brain boundary imports", () => {
	it("brain/boundary.ts does not import transition-router", async () => {
		const content = await readFile("brain/boundary.ts");
		expect(content).not.toContain("transition-router");
	});

	it("brain/boundary.ts does not import autonomous-executor", async () => {
		const content = await readFile("brain/boundary.ts");
		expect(content).not.toContain("autonomous-executor");
	});

	it("brain/execution-read-client.ts does not import state-writer", async () => {
		const content = await readFile("brain/execution-read-client.ts");
		expect(content).not.toContain("state-writer");
	});
});

describe("execution-core boundary exports", () => {
	it("execution-core/index.ts exports ExecutionCommand types", async () => {
		const content = await readFile("execution-core/index.ts");
		expect(content).toContain("ExecutionCommand");
	});

	it("execution-core/index.ts exports ExecutionReadModel", async () => {
		const content = await readFile("execution-core/index.ts");
		expect(content).toContain("ExecutionReadModel");
	});

	it("execution-core/index.ts exports BrainProposal", async () => {
		const content = await readFile("execution-core/index.ts");
		expect(content).toContain("BrainProposal");
	});
});

describe("execution-service boundary exports", () => {
	it("execution-service/index.ts exports command handler", async () => {
		const content = await readFile("execution-service/index.ts");
		expect(content).toContain("handleExecutionCommand");
	});

	it("execution-service/index.ts exports query handler", async () => {
		const content = await readFile("execution-service/index.ts");
		expect(content).toContain("createExecutionReadModel");
	});
});
