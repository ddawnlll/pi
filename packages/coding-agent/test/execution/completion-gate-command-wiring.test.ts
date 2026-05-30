import { describe, expect, it } from "vitest";
import { CompletionGateRegistry } from "../../src/core/completion-gate.js";
import type { Workspace } from "../../src/core/workspace-schema.js";

function workspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "P37.CMD",
		title: "Command wiring",
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 3,
		...overrides,
	};
}

describe("CompletionGate command wiring", () => {
	it("bash_command_records_completion_gate_history", () => {
		const gate = new CompletionGateRegistry();
		const command = "npm --prefix packages/coding-agent run test:patch-coordinator";
		gate.markImplementationFinished("plan", "P37.CMD");
		gate.recordCommand("plan", "P37.CMD", command);
		gate.recordCompletion("plan", "P37.CMD", 0, true, command, {
			cwd: "/repo",
			startedAt: 10,
			finishedAt: 20,
			outputSummary: "1 passed",
			outputArtifactPath: "/tmp/pi-bash.log",
			matchedValidationRequirement: true,
		});

		const state = gate.get("plan", "P37.CMD");
		expect(state?.commandHistory).toHaveLength(1);
		expect(state?.commandHistory[0]).toMatchObject({
			command,
			cwd: "/repo",
			exitCode: 0,
			outputArtifactPath: "/tmp/pi-bash.log",
			isTargetCommand: true,
			matchedValidationRequirement: true,
		});
		expect(gate.evaluateWorkspace("plan", "P37.CMD", workspace({ targetCommand: command })).canComplete).toBe(true);
	});

	it("target_command_missing_but_deferred_workspace_can_complete_implementation", () => {
		const gate = new CompletionGateRegistry();
		gate.markImplementationFinished("plan", "P37.CMD");
		const result = gate.evaluateWorkspace(
			"plan",
			"P37.CMD",
			workspace({
				targetCommand: "npm test -- heavy.test.ts",
				validationPolicy: {
					mode: "deferred",
					requiredBeforeWorkspaceComplete: false,
					requiredBeforePlanComplete: true,
					finalValidationWorkspace: "P37.FINAL",
				},
			}),
		);
		expect(result.canComplete).toBe(true);
	});
});
