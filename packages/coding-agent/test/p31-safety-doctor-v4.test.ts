import { describe, expect, it } from "vitest";
import { SafetyDoctor, SafetyIssueSeverity } from "../src/core/safety-doctor.js";

describe("P31 safety doctor v4", () => {
	it("warns on deprecated mechanism hints and validates derived profile", () => {
		const doctor = new SafetyDoctor();
		const report = doctor.validateQueue({
			phase: "P31",
			title: "x",
			maxParallelWorkspaces: 3,
			contractVersion: "4.0.0",
			intent: {
				parallelism: 3,
				safetyLevel: "normal",
				conflictRisk: "medium",
				executionEnvironment: { mode: "trusted_local" },
				deadlines: {},
			},
			derivedProfile: {
				worktreeRequired: true,
				integrationQueueRequired: true,
				validationLaneRequired: true,
				gitRunnerQueueRequired: true,
				eventJournalRequired: false,
				writeSetDriftDetectionRequired: true,
				writeSetDriftBlockOnConflict: false,
				admissionGateMode: "normal",
				explicitApprovalRequired: false,
				sandboxRequirements: [],
				explanations: [],
			},
			deprecatedMechanismHints: ["worktreeRequired is deprecated and treated as a hint only"],
			planExecution: {
				worktree: { enabled: true },
				integrationQueue: { enabled: true },
				validation: { globalValidationLockRequired: true },
			},
			workspaces: [],
		});
		expect(report.warnings.some((w) => w.message.includes("deprecated"))).toBe(true);
	});

	it("rejects impossible intent", () => {
		const doctor = new SafetyDoctor();
		const report = doctor.validateQueue({
			phase: "P31",
			title: "x",
			maxParallelWorkspaces: 2,
			contractVersion: "4.0.0",
			intent: {
				parallelism: 2,
				safetyLevel: "relaxed",
				conflictRisk: "low",
				executionEnvironment: { mode: "trusted_local" },
				deadlines: {},
			},
			workspaces: [],
		});
		expect(report.critical.some((c) => c.severity === SafetyIssueSeverity.Critical)).toBe(true);
	});
});
