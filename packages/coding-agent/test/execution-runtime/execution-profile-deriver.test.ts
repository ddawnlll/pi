import { describe, expect, it } from "vitest";
import { deriveExecutionProfile } from "../../src/execution-runtime/execution-profile-deriver.js";

describe("execution-profile-deriver", () => {
	it("parallelism=1 relaxed/low -> minimal requirements", () => {
		const profile = deriveExecutionProfile({
			parallelism: 1,
			safetyLevel: "relaxed",
			conflictRisk: "low",
			executionEnvironment: { mode: "trusted_local" },
		});
		expect(profile.worktreeRequired).toBe(false);
		expect(profile.integrationQueueRequired).toBe(false);
		expect(profile.eventJournalRequired).toBe(false);
		expect(profile.admissionGateMode).toBe("normal");
	});

	it("parallelism=6 strict/high -> full requirements", () => {
		const profile = deriveExecutionProfile({
			parallelism: 6,
			safetyLevel: "strict",
			conflictRisk: "high",
			executionEnvironment: { mode: "local_sandbox" },
		});
		expect(profile.worktreeRequired).toBe(true);
		expect(profile.integrationQueueRequired).toBe(true);
		expect(profile.validationLanesRequired).toBe(true);
		expect(profile.eventJournalRequired).toBe(true);
		expect(profile.attemptScopedArtifactsRequired).toBe(true);
		expect(profile.writeSetDriftDetectionRequired).toBe(true);
		expect(profile.writeSetDriftBlockOnConflict).toBe(true);
		expect(profile.jsonRuntimeFallbackForbidden).toBe(true);
		expect(profile.admissionGateMode).toBe("strict");
	});

	it("parallelism=7-8 requires explicit approval", () => {
		const profile = deriveExecutionProfile({
			parallelism: 8,
			safetyLevel: "strict",
			conflictRisk: "high",
			executionEnvironment: { mode: "cloud_sandbox" },
		});
		expect(profile.explicitApprovalRequired).toBe(true);
		expect(profile.worktreeRequired).toBe(true);
		expect(profile.integrationQueueRequired).toBe(true);
		expect(profile.eventJournalRequired).toBe(true);
	});

	it("parallelism=2-3 medium risk -> conditional worktree", () => {
		const profile = deriveExecutionProfile({
			parallelism: 2,
			safetyLevel: "normal",
			conflictRisk: "medium",
			executionEnvironment: { mode: "trusted_local" },
		});
		expect(profile.worktreeRequired).toBe(true); // risk=medium for p>=2
		expect(profile.integrationQueueRequired).toBe(true);
		expect(profile.writeSetDriftDetectionRequired).toBe(true);
	});

	it("throws for parallelism out of range", () => {
		expect(() =>
			deriveExecutionProfile({
				parallelism: 0,
				safetyLevel: "normal",
				conflictRisk: "low",
				executionEnvironment: { mode: "trusted_local" },
			}),
		).toThrow("must be between 1 and 8");
	});

	it("throws for relaxed safety with high parallelism", () => {
		expect(() =>
			deriveExecutionProfile({
				parallelism: 3,
				safetyLevel: "relaxed",
				conflictRisk: "low",
				executionEnvironment: { mode: "trusted_local" },
			}),
		).toThrow("relaxed safetyLevel is only allowed for parallelism <= 1");
	});

	it("cloud_sandbox adds egress and ephemeral requirements", () => {
		const profile = deriveExecutionProfile({
			parallelism: 3,
			safetyLevel: "normal",
			conflictRisk: "low",
			executionEnvironment: { mode: "cloud_sandbox" },
		});
		expect(profile.sandboxRequirements).toContain("egress_firewall_required");
		expect(profile.sandboxRequirements).toContain("ephemeral_credentials_required");
		expect(profile.sandboxRequirements).toContain("per_attempt_container_vm_required");
	});

	it("trusted_local warns about untrusted code", () => {
		const profile = deriveExecutionProfile({
			parallelism: 1,
			safetyLevel: "normal",
			conflictRisk: "none",
			executionEnvironment: { mode: "trusted_local" },
		});
		expect(profile.sandboxRequirements).toContain("warn: trusted_local not safe for untrusted code");
	});

	it("has explanations for parallelism=1", () => {
		const profile = deriveExecutionProfile({
			parallelism: 1,
			safetyLevel: "normal",
			conflictRisk: "low",
			executionEnvironment: { mode: "trusted_local" },
		});
		expect(profile.explanations.length).toBeGreaterThan(0);
		expect(profile.explanations.some((e) => e.includes("parallelism=1"))).toBe(true);
	});
});
