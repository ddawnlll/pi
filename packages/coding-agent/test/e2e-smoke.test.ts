/**
 * End-to-End Smoke Test
 *
 * Tests complete autonomous plan execution from start to finish.
 * This test:
 * - Parses a real plan
 * - Creates an autonomous executor
 * - Runs the full execution loop
 * - Verifies all workspaces complete
 * - Checks that actual files were created/modified
 *
 * NOTE: This test requires valid API keys and will make real LLM calls.
 * Set SKIP_E2E_SMOKE_TEST=1 to skip this test.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getModel } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAutonomousExecutor } from "../src/core/autonomous-executor.js";
import { createStateStore } from "../src/core/state-store.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";

const SKIP_TEST = process.env.SKIP_E2E_SMOKE_TEST === "1";

describe.skipIf(SKIP_TEST)("End-to-End Smoke Test", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-smoke-test-"));
	});

	afterEach(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("should execute a complete plan autonomously", async () => {
		// Create a simple plan with 3 workspaces
		const queue: WorkspaceQueue = {
			phase: "TEST",
			title: "E2E Smoke Test Plan",
			maxParallelWorkspaces: 2,
			workspaces: [
				{
					id: "ws-1",
					title: "Create README.md",
					dependencies: [],
					acceptanceCriteria: ["File README.md exists", "File contains project title"],
					capabilities: {
						canEdit: ["README.md"],
						cannotEdit: [],
						canRun: [],
						cannotRun: [],
					},
					roleBudget: "worker",
					maxRetries: 3,
				},
				{
					id: "ws-2",
					title: "Create package.json",
					dependencies: [],
					acceptanceCriteria: [
						"File package.json exists",
						"File is valid JSON",
						"File has name and version fields",
					],
					capabilities: {
						canEdit: ["package.json"],
						cannotEdit: [],
						canRun: [],
						cannotRun: [],
					},
					roleBudget: "worker",
					maxRetries: 3,
				},
				{
					id: "ws-3",
					title: "Create index.js that uses package info",
					dependencies: ["ws-1", "ws-2"],
					acceptanceCriteria: ["File index.js exists", "File reads from package.json", "File logs a message"],
					capabilities: {
						canEdit: ["index.js"],
						cannotEdit: [],
						canRun: ["node index.js"],
						cannotRun: [],
					},
					roleBudget: "worker",
					maxRetries: 3,
					targetCommand: "node index.js",
				},
			],
		};

		// Get a model for execution
		// Priority: OpenCode-Go (if OPENCODE_API_KEY set) > Anthropic > OpenAI
		const model =
			getModel("opencode-go", "deepseek-v4-flash") ??
			getModel("anthropic", "claude-3-5-haiku-20241022") ??
			getModel("openai", "gpt-4o-mini") ??
			getModel("anthropic", "claude-sonnet-4-20250514");

		if (!model) {
			throw new Error(
				"No model available for testing. Set OPENCODE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in environment.",
			);
		}

		// Create state store
		const stateStore = createStateStore({
			backend: "json",
			workspaceRoot: testDir,
		});

		// Create executor with real execution enabled
		const _executor = createAutonomousExecutor(testDir, 2);
		// Enable real execution by creating a new executor with the flag
		const { AutonomousExecutor } = await import("../src/core/autonomous-executor.js");
		const realExecutor = new AutonomousExecutor(stateStore, {
			workspaceRoot: testDir,
			maxWorkers: 2,
			enableRealExecution: true,
			model,
		});

		// Initialize execution
		const planExecId = await realExecutor.initialize(queue);
		expect(planExecId).toBeDefined();

		// Run execution loop
		let iteration = 0;
		const maxIterations = 20; // Safety limit

		while (!realExecutor.isExecutionComplete() && iteration < maxIterations) {
			iteration++;
			console.log(`\n=== Iteration ${iteration} ===`);

			const stats = realExecutor.getStatistics();
			console.log(
				`Stats: pending=${stats?.pending}, active=${stats?.active}, complete=${stats?.complete}, failed=${stats?.failed}`,
			);

			// Get next workspaces to execute
			const nextWorkspaces = await realExecutor.getNextWorkspaces(queue.workspaces);
			console.log(`Next workspaces: ${nextWorkspaces.map((w) => w.id).join(", ")}`);

			if (nextWorkspaces.length === 0) {
				// Wait for active workspaces to complete
				if (stats && stats.active > 0) {
					console.log(`Waiting for ${stats.active} active workspace(s)...`);
					await new Promise((resolve) => setTimeout(resolve, 1000));
					continue;
				}
				// No workspaces to schedule and none active
				break;
			}

			// Execute workspaces in parallel
			const results = await Promise.all(nextWorkspaces.map((ws) => realExecutor.executeWorkspace(ws)));

			for (const result of results) {
				console.log(`  ${result.workspaceId}: ${result.verdict} (success=${result.success})`);
				if (result.error) {
					console.log(`    Error: ${result.error}`);
				}
			}
		}

		// Verify execution completed
		expect(realExecutor.isExecutionComplete()).toBe(true);
		expect(iteration).toBeLessThan(maxIterations);

		// Complete the plan
		await realExecutor.completePlan();

		// Verify final state
		const finalState = realExecutor.getState();
		expect(finalState?.status).toBe("complete");

		// Verify all workspaces completed
		for (const workspace of queue.workspaces) {
			const wsState = finalState?.workspaces.get(workspace.id);
			expect(wsState?.stage).toBe("complete");
		}

		// Verify files were actually created
		const readmePath = path.join(testDir, "README.md");
		const packagePath = path.join(testDir, "package.json");
		const indexPath = path.join(testDir, "index.js");

		const readmeExists = await fs
			.access(readmePath)
			.then(() => true)
			.catch(() => false);
		const packageExists = await fs
			.access(packagePath)
			.then(() => true)
			.catch(() => false);
		const indexExists = await fs
			.access(indexPath)
			.then(() => true)
			.catch(() => false);

		expect(readmeExists).toBe(true);
		expect(packageExists).toBe(true);
		expect(indexExists).toBe(true);

		// Verify file contents
		if (readmeExists) {
			const readmeContent = await fs.readFile(readmePath, "utf-8");
			expect(readmeContent.length).toBeGreaterThan(0);
			console.log("\n✅ README.md created:", readmeContent.substring(0, 100));
		}

		if (packageExists) {
			const packageContent = await fs.readFile(packagePath, "utf-8");
			const packageJson = JSON.parse(packageContent);
			expect(packageJson.name).toBeDefined();
			expect(packageJson.version).toBeDefined();
			console.log("\n✅ package.json created:", JSON.stringify(packageJson, null, 2));
		}

		if (indexExists) {
			const indexContent = await fs.readFile(indexPath, "utf-8");
			expect(indexContent.length).toBeGreaterThan(0);
			console.log("\n✅ index.js created:", indexContent.substring(0, 100));
		}

		// Verify execution logs were written
		const logPath = path.join(testDir, ".pi", `execution-${planExecId}.log`);
		const logExists = await fs
			.access(logPath)
			.then(() => true)
			.catch(() => false);

		if (logExists) {
			const logContent = await fs.readFile(logPath, "utf-8");
			expect(logContent).toContain("Starting execution");
			expect(logContent).toContain("Execution completed");
			console.log("\n✅ Execution log written:", logPath);
		}

		console.log("\n🎉 End-to-end smoke test PASSED!");
		console.log(`   Completed ${queue.workspaces.length} workspaces in ${iteration} iterations`);
	}, 300000); // 5 minute timeout for full plan execution

	it("should handle workspace dependencies correctly", async () => {
		// Create a plan where ws-2 depends on ws-1
		const queue: WorkspaceQueue = {
			phase: "TEST",
			title: "Dependency Test Plan",
			maxParallelWorkspaces: 3,
			workspaces: [
				{
					id: "dep-1",
					title: "Create data.txt",
					dependencies: [],
					acceptanceCriteria: ["File data.txt exists with content"],
					capabilities: {
						canEdit: ["data.txt"],
						cannotEdit: [],
						canRun: [],
						cannotRun: [],
					},
					roleBudget: "worker",
					maxRetries: 3,
				},
				{
					id: "dep-2",
					title: "Read and process data.txt",
					dependencies: ["dep-1"],
					acceptanceCriteria: ["File data.txt is read", "File processed.txt is created with processed data"],
					capabilities: {
						canEdit: ["processed.txt"],
						cannotEdit: [],
						canRun: [],
						cannotRun: [],
					},
					roleBudget: "worker",
					maxRetries: 3,
				},
			],
		};

		const model =
			getModel("opencode-go", "deepseek-v4-flash") ??
			getModel("anthropic", "claude-3-5-haiku-20241022") ??
			getModel("openai", "gpt-4o-mini") ??
			getModel("anthropic", "claude-sonnet-4-20250514");

		if (!model) {
			throw new Error("No model available. Set OPENCODE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY");
		}

		const stateStore = createStateStore({
			backend: "json",
			workspaceRoot: testDir,
		});

		const { AutonomousExecutor } = await import("../src/core/autonomous-executor.js");
		const executor = new AutonomousExecutor(stateStore, {
			workspaceRoot: testDir,
			maxWorkers: 3,
			enableRealExecution: true,
			model,
		});

		await executor.initialize(queue);

		// First iteration should only schedule dep-1
		const firstBatch = await executor.getNextWorkspaces(queue.workspaces);
		expect(firstBatch.length).toBe(1);
		expect(firstBatch[0].id).toBe("dep-1");

		// Execute dep-1
		await executor.executeWorkspace(firstBatch[0]);

		// Second iteration should schedule dep-2
		const secondBatch = await executor.getNextWorkspaces(queue.workspaces);
		expect(secondBatch.length).toBe(1);
		expect(secondBatch[0].id).toBe("dep-2");

		// Execute dep-2
		await executor.executeWorkspace(secondBatch[0]);

		// Verify both files exist
		const dataPath = path.join(testDir, "data.txt");
		const processedPath = path.join(testDir, "processed.txt");

		const dataExists = await fs
			.access(dataPath)
			.then(() => true)
			.catch(() => false);
		const processedExists = await fs
			.access(processedPath)
			.then(() => true)
			.catch(() => false);

		expect(dataExists).toBe(true);
		expect(processedExists).toBe(true);

		console.log("\n✅ Dependency ordering test PASSED!");
	}, 180000); // 3 minute timeout
});

describe("End-to-End Smoke Test - Skipped Test Info", () => {
	it.skipIf(!SKIP_TEST)("should show skip message", () => {
		console.log("\n⚠️  End-to-end smoke test is SKIPPED");
		console.log("This test requires valid API keys and makes real LLM calls.");
		console.log("It runs a complete autonomous plan execution.");
		console.log("To run it, ensure you have API keys set and remove SKIP_E2E_SMOKE_TEST=1\n");
	});
});
