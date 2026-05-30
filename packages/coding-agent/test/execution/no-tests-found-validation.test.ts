import { describe, expect, it } from "vitest";
import type { CommandHistoryEntry } from "../../src/core/completion-gate.js";
import { createWorkspaceValidationState, evaluateWorkspaceCompletion } from "../../src/core/completion-gate.js";
import type { Workspace } from "../../src/core/workspace-schema.js";

function workspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "P37.NO_TESTS",
		title: "No tests found validation",
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 3,
		...overrides,
	};
}

describe("targeted validation no-tests-found handling", () => {
	it("no_tests_found_exit_zero_fails_targeted_test", () => {
		const command = "npx vitest run packages/coding-agent/test/execution/missing.test.ts --maxWorkers=1";
		const history: CommandHistoryEntry[] = [
			{
				command,
				exitCode: 0,
				outputSummary: "No test files found, exiting with code 0",
				noTestsFoundDetected: true,
			},
		];
		const state = {
			...createWorkspaceValidationState("plan", "P37.NO_TESTS"),
			implementationFinished: true,
			commandHistory: history,
		};
		const result = evaluateWorkspaceCompletion(
			state,
			workspace({
				targetCommand: command,
				validationRequirement: {
					kind: "targeted_test",
					testFile: "packages/coding-agent/test/execution/missing.test.ts",
					mustPass: true,
					acceptedEquivalentCommands: [command],
					noTestsFoundIsFailure: true,
				},
			}),
		);

		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.join("\n")).toContain("No test files found");
	});
});
