/**
 * P37.HOTFIX — CompletionGate Equivalent Command Validation
 *
 * Tests that the completion gate accepts equivalent commands when the
 * exact targetCommand was not executed, but an accepted equivalent or
 * validationRequirement.testFile-based command passed.
 *
 * Acceptance criteria:
 * - exact targetCommand passed -> canComplete true
 * - targetCommand missing but accepted equivalent command passed -> canComplete true
 * - targetCommand missing and no equivalent passed -> blocked
 * - equivalent command failed with non-zero exit -> blocked
 * - watch-mode equivalent command attempted -> blocked
 * - validationRequirement.testFile passed through low-memory script -> canComplete true
 */

import { describe, expect, it } from "vitest";
import {
	appendCommandHistory,
	type CommandHistoryEntry,
	createWorkspaceValidationState,
	evaluateWorkspaceCompletion,
	isEquivalentValidationSatisfied,
	recordCommandCompletion,
	recordValidationCommand,
	type WorkspaceValidationState,
} from "../../src/core/completion-gate.js";
import type { Workspace } from "../../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a basic workspace for testing. */
function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "P37.A",
		title: "Test Workspace",
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 3,
		...overrides,
	};
}

/** Create a validation state with pre-populated command history. */
function makeStateWithHistory(
	planExecId: string = "plan-p37",
	workspaceId: string = "P37.A",
	history: CommandHistoryEntry[] = [],
	overrides: Partial<WorkspaceValidationState> = {},
): WorkspaceValidationState {
	return {
		...createWorkspaceValidationState(planExecId, workspaceId),
		implementationFinished: true,
		commandHistory: history,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Helper: appendCommandHistory
// ---------------------------------------------------------------------------

describe("appendCommandHistory", () => {
	it("appends entries up to max", () => {
		const entries: CommandHistoryEntry[] = [];
		for (let i = 0; i < 25; i++) {
			entries.push({ command: `cmd-${i}`, exitCode: 0 });
		}
		// Add the rest one at a time (simulating accumulate)
		let history: CommandHistoryEntry[] = [];
		for (const e of entries) {
			history = appendCommandHistory(history, e);
		}
		expect(history.length).toBeLessThanOrEqual(20);
		// Should have the last 20 entries
		expect(history[0].command).toBe("cmd-5");
		expect(history[history.length - 1].command).toBe("cmd-24");
	});
});

// ---------------------------------------------------------------------------
// 1. exact targetCommand passed -> canComplete true
// ---------------------------------------------------------------------------

describe("equivalent-command: exact targetCommand passed", () => {
	it("returns canComplete true when targetCommandPassed is true", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
		});
		const state = makeStateWithHistory("plan-p37", "P37.A", [], {
			targetCommandPassed: true,
			implementationFinished: true,
		});
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(true);
		expect(result.blockReasons).toHaveLength(0);
	});

	it("isEquivalentValidationSatisfied returns true when targetCommandPassed is true", () => {
		const workspace = makeWorkspace({ targetCommand: "npm test" });
		const state = makeStateWithHistory("plan-p37", "P37.A", [], {
			targetCommandPassed: true,
		});
		expect(isEquivalentValidationSatisfied(state, workspace)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 2. targetCommand missing but accepted equivalent command passed -> canComplete true
// ---------------------------------------------------------------------------

describe("equivalent-command: accepted equivalent passed", () => {
	it("returns canComplete true when acceptedEquivalentCommands has matching entry with exit 0", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
			acceptedEquivalentCommands: [
				"npm --prefix packages/coding-agent run test:patch-coordinator",
				"npx vitest run packages/coding-agent/test/execution/patch-coordinator.test.ts --maxWorkers=1",
			],
		});
		const history: CommandHistoryEntry[] = [
			{
				command: "npm --prefix packages/coding-agent run test:patch-coordinator",
				exitCode: 0,
				finishedAt: Date.now(),
			},
		];
		const state = makeStateWithHistory("plan-p37", "P37.A", history, {
			// targetCommand NOT passed explicitly
			targetCommandPassed: null,
		});
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(true);
		expect(result.blockReasons).toHaveLength(0);
	});

	it("returns canComplete true when second equivalent command matches", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
			acceptedEquivalentCommands: [
				"npm --prefix packages/coding-agent run test:patch-coordinator",
				"npx vitest run packages/coding-agent/test/execution/patch-coordinator.test.ts --maxWorkers=1",
			],
		});
		const history: CommandHistoryEntry[] = [
			{
				command: "npx vitest run packages/coding-agent/test/execution/patch-coordinator.test.ts --maxWorkers=1",
				exitCode: 0,
				finishedAt: Date.now(),
			},
		];
		const state = makeStateWithHistory("plan-p37", "P37.A", history, {
			targetCommandPassed: null,
		});
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(true);
	});

	it("returns canComplete true when targetCommand itself is in history with exit 0", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
		});
		const history: CommandHistoryEntry[] = [
			{
				command: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
				exitCode: 0,
				finishedAt: Date.now(),
			},
		];
		const state = makeStateWithHistory("plan-p37", "P37.A", history, {
			targetCommandPassed: null,
		});
		// Even though targetCommandPassed is null, the command is in history with exit 0
		// and targetCommand is auto-included in acceptedCommands set
		expect(isEquivalentValidationSatisfied(state, workspace)).toBe(true);
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 3. targetCommand missing and no equivalent passed -> blocked
// ---------------------------------------------------------------------------

describe("equivalent-command: no equivalent passed", () => {
	it("blocks when targetCommand not passed and no equivalent in history", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
		});
		const state = makeStateWithHistory("plan-p37", "P37.A", [], {
			targetCommandPassed: null,
			implementationFinished: true,
		});
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("Target command has not been executed"))).toBe(true);
	});

	it("blocks when history has commands but none match accepted equivalents", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
			acceptedEquivalentCommands: ["npm --prefix packages/coding-agent run test:patch-coordinator"],
		});
		const history: CommandHistoryEntry[] = [
			{
				command: "npx vitest run some-other-test.test.ts",
				exitCode: 0,
				finishedAt: Date.now(),
			},
		];
		const state = makeStateWithHistory("plan-p37", "P37.A", history, {
			targetCommandPassed: null,
		});
		expect(isEquivalentValidationSatisfied(state, workspace)).toBe(false);
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 4. equivalent command failed with non-zero exit -> blocked
// ---------------------------------------------------------------------------

describe("equivalent-command: non-zero exit", () => {
	it("blocks when equivalent command has non-zero exit code", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
			acceptedEquivalentCommands: ["npm --prefix packages/coding-agent run test:patch-coordinator"],
		});
		const history: CommandHistoryEntry[] = [
			{
				command: "npm --prefix packages/coding-agent run test:patch-coordinator",
				exitCode: 1,
				finishedAt: Date.now(),
			},
		];
		const state = makeStateWithHistory("plan-p37", "P37.A", history, {
			targetCommandPassed: null,
		});
		expect(isEquivalentValidationSatisfied(state, workspace)).toBe(false);
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
	});

	it("blocks when targetCommand itself has non-zero exit in history", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
		});
		const history: CommandHistoryEntry[] = [
			{
				command: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
				exitCode: 1,
				finishedAt: Date.now(),
			},
		];
		const state = makeStateWithHistory("plan-p37", "P37.A", history, {
			targetCommandPassed: null,
		});
		// Non-zero exitCode should NOT satisfy equivalence
		expect(isEquivalentValidationSatisfied(state, workspace)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 5. watch-mode equivalent command attempted -> blocked
// ---------------------------------------------------------------------------

describe("equivalent-command: watch-mode blocked", () => {
	it("blocks when equivalent command is watch-mode", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
			acceptedEquivalentCommands: ["vitest --watch"],
		});
		const history: CommandHistoryEntry[] = [
			{
				command: "vitest --watch",
				exitCode: 0,
				finishedAt: Date.now(),
			},
		];
		const state = makeStateWithHistory("plan-p37", "P37.A", history, {
			targetCommandPassed: null,
		});
		// isWatchModeCommand("vitest --watch") should return true, causing equivalence to fail
		expect(isEquivalentValidationSatisfied(state, workspace)).toBe(false);
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(false);
	});

	it("still blocks even if watch-mode command exited 0", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test",
			acceptedEquivalentCommands: ["npm run dev"],
		});
		const history: CommandHistoryEntry[] = [
			{
				command: "npm run dev",
				exitCode: 0,
				finishedAt: Date.now(),
			},
		];
		const state = makeStateWithHistory("plan-p37", "P37.A", history, {
			targetCommandPassed: null,
		});
		// npm run dev is a watch-mode command
		expect(isEquivalentValidationSatisfied(state, workspace)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 6. validationRequirement.testFile passed through low-memory script -> canComplete true
// ---------------------------------------------------------------------------

describe("equivalent-command: validationRequirement.testFile", () => {
	it("accepts when test file appears in command that exited 0", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
			validationRequirement: {
				kind: "targeted_test",
				testFile: "packages/coding-agent/test/execution/patch-coordinator.test.ts",
				mustPass: true,
			},
		});
		const history: CommandHistoryEntry[] = [
			{
				command:
					"NODE_OPTIONS=--max-old-space-size=1024 vitest run packages/coding-agent/test/execution/patch-coordinator.test.ts --maxWorkers=1",
				exitCode: 0,
				finishedAt: Date.now(),
			},
		];
		const state = makeStateWithHistory("plan-p37", "P37.A", history, {
			targetCommandPassed: null,
		});
		// The command contains the testFile path and exited 0
		expect(isEquivalentValidationSatisfied(state, workspace)).toBe(true);
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(true);
	});

	it("blocks when test file appears in command but exit code is non-zero", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
			validationRequirement: {
				kind: "targeted_test",
				testFile: "packages/coding-agent/test/execution/patch-coordinator.test.ts",
				mustPass: true,
			},
		});
		const history: CommandHistoryEntry[] = [
			{
				command:
					"NODE_OPTIONS=--max-old-space-size=1024 vitest run packages/coding-agent/test/execution/patch-coordinator.test.ts --maxWorkers=1",
				exitCode: 1,
				finishedAt: Date.now(),
			},
		];
		const state = makeStateWithHistory("plan-p37", "P37.A", history, {
			targetCommandPassed: null,
		});
		expect(isEquivalentValidationSatisfied(state, workspace)).toBe(false);
	});

	it("blocks when test file not referenced in any command", () => {
		const workspace = makeWorkspace({
			targetCommand: "npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts",
			validationRequirement: {
				kind: "targeted_test",
				testFile: "packages/coding-agent/test/execution/patch-coordinator.test.ts",
				mustPass: true,
			},
		});
		const history: CommandHistoryEntry[] = [
			{
				command: "npm run build",
				exitCode: 0,
				finishedAt: Date.now(),
			},
		];
		const state = makeStateWithHistory("plan-p37", "P37.A", history, {
			targetCommandPassed: null,
		});
		expect(isEquivalentValidationSatisfied(state, workspace)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 7. No targetCommand or equivalence -> no block
// ---------------------------------------------------------------------------

describe("equivalent-command: no validation required", () => {
	it("passes when no targetCommand and no equivalence fields", () => {
		const workspace = makeWorkspace({}); // No targetCommand
		const state = makeStateWithHistory("plan-p37", "P37.A", [], {
			targetCommandPassed: null,
			implementationFinished: true,
		});
		const result = evaluateWorkspaceCompletion(state, workspace);
		expect(result.canComplete).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 8. recordCommandCompletion with command string preserves identity
// ---------------------------------------------------------------------------

describe("equivalent-command: recordCommandCompletion", () => {
	it("records command string and updates history", () => {
		const state = createWorkspaceValidationState("plan-p37", "P37.A");
		const withCmd = recordValidationCommand(
			state,
			"npm --prefix packages/coding-agent run test:patch-coordinator",
			"plan-p37",
			"P37.A",
		);
		expect(withCmd.commandHistory.length).toBe(1);
		expect(withCmd.commandHistory[0].command).toBe("npm --prefix packages/coding-agent run test:patch-coordinator");
		expect(withCmd.commandHistory[0].exitCode).toBeNull();

		const completed = recordCommandCompletion(
			withCmd,
			0,
			false,
			"plan-p37",
			"P37.A",
			"npm --prefix packages/coding-agent run test:patch-coordinator",
		);
		expect(completed.commandHistory.length).toBe(1);
		expect(completed.commandHistory[0].exitCode).toBe(0);
		expect(completed.lastCommandExitCode).toBe(0);
	});

	it("records target command with isTargetCommand flag", () => {
		const state = createWorkspaceValidationState("plan-p37", "P37.A");
		const started = recordValidationCommand(state, "npm test -- test/foo.test.ts", "plan-p37", "P37.A");
		const completed = recordCommandCompletion(started, 0, true, "plan-p37", "P37.A", "npm test -- test/foo.test.ts");
		expect(completed.commandHistory.length).toBe(1);
		expect(completed.commandHistory[0].isTargetCommand).toBe(true);
		expect(completed.targetCommandPassed).toBe(true);
	});

	it("records non-target command without isTargetCommand flag", () => {
		const state = createWorkspaceValidationState("plan-p37", "P37.A");
		const started = recordValidationCommand(state, "npm run build", "plan-p37", "P37.A");
		const completed = recordCommandCompletion(started, 0, false, "plan-p37", "P37.A", "npm run build");
		expect(completed.commandHistory.length).toBe(1);
		// isTargetCommand should be false (default)
		expect(completed.commandHistory[0].isTargetCommand).toBeFalsy();
		expect(completed.targetCommandPassed).toBeNull(); // Not updated
	});
});
