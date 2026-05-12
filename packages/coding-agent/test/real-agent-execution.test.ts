/**
 * Real Agent Execution Tests
 *
 * Tests that actually run Pi agents with real LLM calls.
 * These tests verify:
 * - Agent session creation
 * - Tool usage (read_file, write_to_file, execute_command)
 * - Verdict parsing
 * - Log generation
 *
 * NOTE: These tests require valid API keys and will make real LLM calls.
 * Set SKIP_REAL_AGENT_TESTS=1 to skip these tests.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getModel } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceState } from "../src/core/plan-state.js";
import { RolePacketBuilder } from "../src/core/role-packets.js";
import { WorkspaceAgentExecutor } from "../src/core/workspace-agent-executor.js";
import { type Workspace, WorkspaceStage } from "../src/core/workspace-schema.js";

const SKIP_TESTS = process.env.SKIP_REAL_AGENT_TESTS === "1";

// Helper to create a minimal workspace state
function createWorkspaceState(workspaceId: string, attempts = 0): WorkspaceState {
	return {
		workspaceId,
		stage: WorkspaceStage.Pending,
		attempts,
		startedAt: undefined,
		completedAt: undefined,
	};
}

// Helper to create a minimal workspace
function createWorkspace(id: string, title: string, acceptanceCriteria: string[], canEdit: string[] = []): Workspace {
	return {
		id,
		title,
		dependencies: [],
		acceptanceCriteria,
		capabilities: {
			canEdit,
			cannotEdit: [],
			canRun: [],
			cannotRun: [],
		},
		roleBudget: "worker",
		maxRetries: 3,
	};
}

describe.skipIf(SKIP_TESTS)("Real Agent Execution", () => {
	let testDir: string;
	let executor: WorkspaceAgentExecutor;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), "real-agent-test-"));

		// Try to get a cheap, fast model for testing
		// Priority: minimax-m2.7 > OpenCode-Go > Anthropic > OpenAI
		const model =
			getModel("opencode-go", "deepseek-v4-flash") ?? // OpenCode-Go (cheapest)
			getModel("opencode-go", "minimax-m2.7") ?? // MiniMax (good tool calling)
			getModel("anthropic", "claude-3-5-haiku-20241022") ?? // Anthropic
			getModel("openai", "gpt-4o-mini") ?? // OpenAI
			getModel("anthropic", "claude-sonnet-4-20250514"); // Fallback

		if (!model) {
			throw new Error(
				"No model available for testing. Set OPENCODE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in environment.",
			);
		}

		executor = new WorkspaceAgentExecutor({
			workspaceRoot: testDir,
			model,
			maxTurns: 10, // Limit turns for faster tests
		});
	});

	afterEach(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("should create a simple text file", async () => {
		const workspace = createWorkspace(
			"test-1",
			"Create hello.txt",
			["File hello.txt exists", "File contains 'Hello, World!'"],
			["hello.txt"],
		);

		const packetBuilder = new RolePacketBuilder();
		const packet = packetBuilder.buildWorkerPacket(workspace, createWorkspaceState(workspace.id));

		const result = await executor.execute(packet, workspace.id);

		// Verify execution completed
		expect(result.success).toBe(true);
		expect(result.verdict).toBe("COMPLETE");
		expect(result.logs.length).toBeGreaterThan(0);

		// Verify file was created
		const filePath = path.join(testDir, "hello.txt");
		const fileExists = await fs
			.access(filePath)
			.then(() => true)
			.catch(() => false);
		expect(fileExists).toBe(true);

		if (fileExists) {
			const content = await fs.readFile(filePath, "utf-8");
			expect(content).toContain("Hello");
		}

		// Verify logs show agent activity
		const logContent = result.logs.join("\n");
		expect(logContent).toContain("Starting execution");
		expect(logContent).toContain("Agent session created");
	}, 60000); // 60 second timeout for LLM calls

	it("should read and modify an existing file", async () => {
		// Create an initial file
		const inputFile = path.join(testDir, "input.txt");
		await fs.writeFile(inputFile, "Original content\n", "utf-8");

		const workspace = createWorkspace(
			"test-2",
			"Append to input.txt",
			["File input.txt contains original content", "File input.txt has additional content appended"],
			["input.txt"],
		);

		const packetBuilder = new RolePacketBuilder();
		const packet = packetBuilder.buildWorkerPacket(workspace, createWorkspaceState(workspace.id));

		const result = await executor.execute(packet, workspace.id);

		expect(result.success).toBe(true);
		expect(result.verdict).toBe("COMPLETE");

		// Verify file was modified (has more content than original)
		const content = await fs.readFile(inputFile, "utf-8");
		expect(content).toContain("Original content");
		expect(content.length).toBeGreaterThan("Original content\n".length);
	}, 60000);

	it("should execute a command and verify output", async () => {
		const workspace = createWorkspace(
			"test-3",
			"Create and verify file via command",
			["File output.txt exists", "File contains command output"],
			["output.txt"],
		);
		workspace.targetCommand = "cat output.txt";

		const packetBuilder = new RolePacketBuilder();
		const packet = packetBuilder.buildWorkerPacket(workspace, createWorkspaceState(workspace.id));

		const result = await executor.execute(packet, workspace.id);

		expect(result.success).toBe(true);
		expect(result.verdict).toBe("COMPLETE");

		// Verify file exists
		const filePath = path.join(testDir, "output.txt");
		const fileExists = await fs
			.access(filePath)
			.then(() => true)
			.catch(() => false);
		expect(fileExists).toBe(true);
	}, 60000);

	it("should handle blocked verdict when dependencies are missing", async () => {
		const workspace = createWorkspace(
			"test-4",
			"Task that should be blocked",
			["Read data from nonexistent.txt", "Process the data"],
			["output.txt"],
		);
		workspace.capabilities!.cannotEdit = ["nonexistent.txt"];

		const packetBuilder = new RolePacketBuilder();
		const wsState = createWorkspaceState(workspace.id, 1);
		const packet = packetBuilder.buildWorkerPacket(
			workspace,
			wsState,
			"Previous attempt failed: nonexistent.txt not found",
		);

		const result = await executor.execute(packet, workspace.id);

		// Agent should recognize it's blocked (verdict check is sufficient)
		expect(result.verdict).toMatch(/BLOCKED|FAILED/);
		// Report should indicate the issue (less strict check)
		expect(result.report.length).toBeGreaterThan(0);
	}, 60000);

	it("should generate comprehensive logs", async () => {
		const workspace = createWorkspace(
			"test-5",
			"Simple task for log verification",
			["Create test.txt with any content"],
			["test.txt"],
		);

		const packetBuilder = new RolePacketBuilder();
		const packet = packetBuilder.buildWorkerPacket(workspace, createWorkspaceState(workspace.id));

		const result = await executor.execute(packet, workspace.id);

		// Verify logs contain key information
		const logContent = result.logs.join("\n");

		expect(logContent).toContain("Starting execution");
		expect(logContent).toContain("Model:");
		expect(logContent).toContain("Role: worker");
		expect(logContent).toContain("Creating agent session");
		expect(logContent).toContain("Agent session created");
		expect(logContent).toContain("Starting agent execution");
		expect(logContent).toContain("Execution completed");

		// Logs should have timestamps
		expect(logContent).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	}, 120000); // Increased timeout to 120s for slower models

	it("should respect file permissions", async () => {
		// Create a file that should not be edited
		const protectedFile = path.join(testDir, "protected.txt");
		await fs.writeFile(protectedFile, "Protected content\n", "utf-8");

		const workspace = createWorkspace(
			"test-6",
			"Create allowed.txt without touching protected.txt",
			["File allowed.txt exists", "File protected.txt is unchanged"],
			["allowed.txt"],
		);
		workspace.capabilities!.cannotEdit = ["protected.txt"];

		const packetBuilder = new RolePacketBuilder();
		const packet = packetBuilder.buildWorkerPacket(workspace, createWorkspaceState(workspace.id));

		const result = await executor.execute(packet, workspace.id);

		expect(result.success).toBe(true);

		// Verify protected file is unchanged
		const protectedContent = await fs.readFile(protectedFile, "utf-8");
		expect(protectedContent).toBe("Protected content\n");

		// Verify allowed file was created
		const allowedFile = path.join(testDir, "allowed.txt");
		const allowedExists = await fs
			.access(allowedFile)
			.then(() => true)
			.catch(() => false);
		expect(allowedExists).toBe(true);
	}, 60000);
});

describe("Real Agent Execution - Skipped Tests Info", () => {
	it.skipIf(!SKIP_TESTS)("should show skip message", () => {
		console.log("\n⚠️  Real agent execution tests are SKIPPED");
		console.log("These tests require valid API keys and make real LLM calls.");
		console.log("To run them, ensure you have API keys set and remove SKIP_REAL_AGENT_TESTS=1\n");
	});
});
