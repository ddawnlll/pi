import { describe, expect, it } from "vitest";
import {
	applyIntentV4ToQueue,
	deriveExecutionProfile,
	normalizeLegacyPlanToIntentV4,
} from "../src/core/execution-profile.js";
import type { WorkspaceQueue } from "../src/core/workspace-schema.js";

describe("execution profile deriver", () => {
	it("derives strict parallel 6 profile deterministically", () => {
		const profile = deriveExecutionProfile({
			parallelism: 6,
			safetyLevel: "strict",
			conflictRisk: "high",
			executionEnvironment: { mode: "trusted_local" },
			deadlines: {},
		});
		expect(profile.worktreeRequired).toBe(true);
		expect(profile.integrationQueueRequired).toBe(true);
		expect(profile.eventJournalRequired).toBe(true);
		expect(profile.admissionGateMode).toBe("strict");
		expect(profile.writeSetDriftBlockOnConflict).toBe(true);
	});

	it("rejects impossible relaxed multi-parallel intent", () => {
		expect(() =>
			deriveExecutionProfile({
				parallelism: 2,
				safetyLevel: "relaxed",
				conflictRisk: "low",
				executionEnvironment: { mode: "trusted_local" },
				deadlines: {},
			}),
		).toThrow("relaxed safetyLevel");
	});

	it("normalizes legacy v3 hints into fresh authoritative intent", () => {
		const normalized = normalizeLegacyPlanToIntentV4({
			maxParallelWorkspaces: 6,
			planExecution: { scale: { selectedMode: "experimental_6" } },
			worktreeRequired: true,
		});
		expect(normalized.intent.parallelism).toBe(6);
		expect(normalized.intent.safetyLevel).toBe("strict");
		expect(normalized.warnings[0]).toContain("deprecated");
	});

	it("applies v4 intent to queue using derived profile", () => {
		const queue = applyIntentV4ToQueue(
			{ phase: "P1", title: "x", maxParallelWorkspaces: 1, workspaces: [] } as WorkspaceQueue,
			{
				parallelism: 4,
				safetyLevel: "strict",
				conflictRisk: "medium",
				executionEnvironment: { mode: "local_sandbox" },
				deadlines: {},
			},
		);
		expect(queue.contractVersion).toBe("4.0.0");
		expect(queue.maxParallelWorkspaces).toBe(4);
		expect(queue.planExecution?.worktree?.enabled).toBe(true);
		expect(queue.derivedProfile?.sandboxRequirements).toContain("network_policy_required");
	});
});
