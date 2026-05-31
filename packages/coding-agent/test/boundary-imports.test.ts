/**
 * Boundary Import Guards — P40 Platform / Agent Separation
 *
 * These tests enforce package-level boundaries:
 * - execution-core must NOT import from coding-agent
 * - WorkerAdapter must come from @earendil-works/pi-execution-core
 * - LocalPiWorkerAdapter must come from @earendil-works/pi-worker-adapters
 * - execution-service must have real runtime callers
 * - web-server must use execution-service for key control paths
 * - coding-agent internal execution-core/execution-service paths must be shim-only
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = path.resolve(import.meta.dirname, "../src");
const EXECUTION_CORE_DIR = path.resolve(import.meta.dirname, "../../execution-core/src");
const EXECUTION_SERVICE_DIR = path.resolve(import.meta.dirname, "../../execution-service/src");
const WORKER_ADAPTERS_DIR = path.resolve(import.meta.dirname, "../../worker-adapters/src");
const WEB_SERVER_DIR = path.resolve(import.meta.dirname, "../../web-server/src");

async function readFile(baseDir: string, relPath: string): Promise<string> {
	return fs.readFile(path.join(baseDir, relPath), "utf-8");
}

// ===========================================================================
// 1. execution-core boundary: MUST NOT import from coding-agent
// ===========================================================================

describe("execution-core package boundary", () => {
	const files = ["index.ts", "types.ts", "commands.ts", "read-model.ts", "events.ts", "worker-adapter.ts"];

	for (const file of files) {
		it(`${file} does not import from @earendil-works/pi-coding-agent`, async () => {
			const content = await readFile(EXECUTION_CORE_DIR, file);
			// Check for actual import statements, not just mentions in comments
			const importLines = content.split("\n").filter((l) => l.trimStart().startsWith("import "));
			for (const line of importLines) {
				expect(line).not.toContain("pi-coding-agent");
			}
		});
	}

	it("package.json does not depend on @earendil-works/pi-coding-agent", async () => {
		const pkg = JSON.parse(
			await fs.readFile(path.resolve(EXECUTION_CORE_DIR, "../package.json"), "utf-8"),
		);
		expect(pkg.dependencies?.["@earendil-works/pi-coding-agent"]).toBeUndefined();
	});
});

// ===========================================================================
// 2. execution-service boundary: MUST NOT permanently depend on coding-agent
// ===========================================================================

describe("execution-service package boundary", () => {
	const files = ["index.ts", "command-handler.ts", "query-handler.ts", "execution-service.ts"];

	for (const file of files) {
		it(`${file} does not import from @earendil-works/pi-coding-agent`, async () => {
			const content = await readFile(EXECUTION_SERVICE_DIR, file);
			expect(content).not.toContain("pi-coding-agent");
		});
	}

	it("package.json does not depend on @earendil-works/pi-coding-agent", async () => {
		const pkg = JSON.parse(
			await fs.readFile(path.resolve(EXECUTION_SERVICE_DIR, "../package.json"), "utf-8"),
		);
		expect(pkg.dependencies?.["@earendil-works/pi-coding-agent"]).toBeUndefined();
	});
});

// ===========================================================================
// 3. WorkerAdapter must be defined in execution-core, not coding-agent
// ===========================================================================

describe("WorkerAdapter canonical location", () => {
	it("WorkerAdapter is defined in @earendil-works/pi-execution-core", async () => {
		const content = await readFile(EXECUTION_CORE_DIR, "worker-adapter.ts");
		expect(content).toContain("export interface WorkerAdapter");
	});

	it("WorkerAdapter is exported from execution-core index", async () => {
		const content = await readFile(EXECUTION_CORE_DIR, "index.ts");
		expect(content).toContain("WorkerAdapter");
	});

	it("autonomous-executor imports WorkerAdapter from @earendil-works/pi-execution-core", async () => {
		const content = await readFile(SRC_DIR, "core/autonomous-executor.ts");
		expect(content).toContain("@earendil-works/pi-execution-core");
		expect(content).toContain("WorkerAdapter");
	});
});

// ===========================================================================
// 4. LocalPiWorkerAdapter lives in worker-adapters package
// ===========================================================================

describe("LocalPiWorkerAdapter canonical location", () => {
	it("LocalPiWorkerAdapter is defined in @earendil-works/pi-worker-adapters", async () => {
		const content = await readFile(WORKER_ADAPTERS_DIR, "local-pi-worker-adapter.ts");
		expect(content).toContain("class LocalPiWorkerAdapter");
	});

	it("LocalPiWorkerAdapter is exported from worker-adapters index", async () => {
		const content = await readFile(WORKER_ADAPTERS_DIR, "index.ts");
		expect(content).toContain("LocalPiWorkerAdapter");
	});

	it("autonomous-executor imports LocalPiWorkerAdapter from @earendil-works/pi-worker-adapters", async () => {
		const content = await readFile(SRC_DIR, "core/autonomous-executor.ts");
		expect(content).toContain("@earendil-works/pi-worker-adapters");
		expect(content).toContain("LocalPiWorkerAdapter");
	});
});

// ===========================================================================
// 5. execution-service has real runtime callers
// ===========================================================================

describe("execution-service has real callers", () => {
	it("autonomous-executor imports handleExecutionCommand from @earendil-works/pi-execution-service", async () => {
		const content = await readFile(SRC_DIR, "core/autonomous-executor.ts");
		expect(content).toContain("@earendil-works/pi-execution-service");
		expect(content).toContain("handleExecutionCommand");
	});

	it("web-server imports handleExecutionCommand from @earendil-works/pi-execution-service", async () => {
		const content = await readFile(WEB_SERVER_DIR, "index.ts");
		expect(content).toContain("@earendil-works/pi-execution-service");
		expect(content).toContain("handleExecutionCommand");
	});
});

// ===========================================================================
// 6. coding-agent execution-core paths are shim-only
// ===========================================================================

describe("coding-agent execution-core paths are shims", () => {
	it("execution-core/index.ts re-exports from @earendil-works/pi-execution-core", async () => {
		const content = await readFile(SRC_DIR, "execution-core/index.ts");
		expect(content).toContain("@earendil-works/pi-execution-core");
		expect(content).toContain("deprecated");
	});

	it("execution-core/types.ts re-exports from @earendil-works/pi-execution-core", async () => {
		const content = await readFile(SRC_DIR, "execution-core/types.ts");
		expect(content).toContain("@earendil-works/pi-execution-core");
		expect(content).toContain("deprecated");
	});

	it("execution-service/command-handler.ts re-exports from @earendil-works/pi-execution-service", async () => {
		const content = await readFile(SRC_DIR, "execution-service/command-handler.ts");
		expect(content).toContain("@earendil-works/pi-execution-service");
		expect(content).toContain("deprecated");
	});

	it("execution-service/query-handler.ts re-exports from @earendil-works/pi-execution-service", async () => {
		const content = await readFile(SRC_DIR, "execution-service/query-handler.ts");
		expect(content).toContain("@earendil-works/pi-execution-service");
		expect(content).toContain("deprecated");
	});

	it("worker-adapter/types.ts re-exports from @earendil-works/pi-execution-core", async () => {
		const content = await readFile(SRC_DIR, "worker-adapter/types.ts");
		expect(content).toContain("@earendil-works/pi-execution-core");
		expect(content).toContain("deprecated");
	});

	it("worker-adapter/index.ts re-exports from @earendil-works/pi-worker-adapters", async () => {
		const content = await readFile(SRC_DIR, "worker-adapter/index.ts");
		expect(content).toContain("@earendil-works/pi-worker-adapters");
		expect(content).toContain("deprecated");
	});

	it("worker-adapter/local-pi-worker-adapter.ts re-exports from @earendil-works/pi-worker-adapters", async () => {
		const content = await readFile(SRC_DIR, "worker-adapter/local-pi-worker-adapter.ts");
		expect(content).toContain("@earendil-works/pi-worker-adapters");
		expect(content).toContain("deprecated");
	});

	it("execution-service/index.ts re-exports from @earendil-works/pi-execution-service", async () => {
		const content = await readFile(SRC_DIR, "execution-service/index.ts");
		expect(content).toContain("@earendil-works/pi-execution-service");
		expect(content).toContain("deprecated");
	});
});

// ===========================================================================
// 7. Legacy shim tests (existing)
// ===========================================================================

describe("WorkerAdapter boundary imports (legacy shim tests)", () => {
	it("worker-adapter/types.ts does not import transition-router", async () => {
		const content = await readFile(SRC_DIR, "worker-adapter/types.ts");
		expect(content).not.toContain("transition-router");
	});

	it("worker-adapter/local-pi-worker-adapter.ts does not import state-writer", async () => {
		const content = await readFile(SRC_DIR, "worker-adapter/local-pi-worker-adapter.ts");
		expect(content).not.toContain("state-writer");
	});

	it("worker-adapter/local-pi-worker-adapter.ts does not call transitionWorkspace", async () => {
		const content = await readFile(SRC_DIR, "worker-adapter/local-pi-worker-adapter.ts");
		expect(content).not.toContain("transitionWorkspace");
	});
});

describe("Brain boundary imports", () => {
	it("brain/boundary.ts does not import transition-router", async () => {
		const content = await readFile(SRC_DIR, "brain/boundary.ts");
		expect(content).not.toContain("transition-router");
	});

	it("brain/boundary.ts does not import autonomous-executor", async () => {
		const content = await readFile(SRC_DIR, "brain/boundary.ts");
		expect(content).not.toContain("autonomous-executor");
	});

	it("brain/execution-read-client.ts does not import state-writer", async () => {
		const content = await readFile(SRC_DIR, "brain/execution-read-client.ts");
		expect(content).not.toContain("state-writer");
	});
});
