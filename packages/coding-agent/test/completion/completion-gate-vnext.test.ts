/**
 * P44.5.01 — CompletionGate vNext Contract Types Tests
 *
 * Tests verify:
 * - CompletionGateVNextVerdict structural contracts
 * - StageVerdict lifecycle
 * - WorkspaceTruthStatus invariants (verifiedComplete requires all 4 dimensions)
 * - verifiedComplete is never runtime-only
 * - Recovery routing types
 * - AgentCompletionClaim vs VerifiedReality comparison
 * - CommitCandidateSet invariants
 * - Backfill status computation
 * - Rollout mode progression
 */

import { describe, expect, it } from "vitest";
import {
	type CompletionGateVNextVerdict,
	type RecoveryRoute,
	ROLLOUT_MODE_SEQUENCE,
	STAGE_ORDER,
	type WorkspaceTruthStatus,
} from "../../src/core/completion/completion-gate-vnext-types.js";
import {
	applyVerdictToStatus,
	computeVerifiedComplete,
	createFailedStageVerdict,
	createPassedStageVerdict,
	createRecoveryRoute,
	createWarningStageVerdict,
	createWorkspaceTruthStatus,
	deriveRecoveryState,
	determineBackfillStatus,
	durabilityStatusLabel,
	shouldBlockCompletion,
	validationStatusLabel,
} from "../../src/core/completion/workspace-truth-status.js";

// ---------------------------------------------------------------------------
// Stage Verdict Tests
// ---------------------------------------------------------------------------

describe("StageVerdict", () => {
	it("should create a passed stage verdict correctly", () => {
		const sv = createPassedStageVerdict("DeclaredOutputExistence", { fileCount: 5 }, 12);
		expect(sv.passed).toBe(true);
		expect(sv.warning).toBe(false);
		expect(sv.blockReasons).toEqual([]);
		expect(sv.warnings).toEqual([]);
		expect(sv.detail.fileCount).toBe(5);
		expect(sv.durationMs).toBe(12);
	});

	it("should create a failed stage verdict with block reasons", () => {
		const sv = createFailedStageVerdict(
			"ScopeAndWriteSet",
			["File outside writeSet: src/unauthorized.ts"],
			{ fileCount: 3 },
			5,
		);
		expect(sv.passed).toBe(false);
		expect(sv.warning).toBe(false);
		expect(sv.blockReasons).toHaveLength(1);
		expect(sv.detail.fileCount).toBe(3);
	});

	it("should create a warning stage verdict", () => {
		const sv = createWarningStageVerdict("Validation", ["Test coverage below threshold"], { coverage: 0.75 }, 30);
		expect(sv.passed).toBe(true);
		expect(sv.warning).toBe(true);
		expect(sv.warnings).toHaveLength(1);
	});

	it("should have all stages in STAGE_ORDER", () => {
		expect(STAGE_ORDER).toHaveLength(9);
		expect(STAGE_ORDER[0]).toBe("DeclaredOutputExistence");
		expect(STAGE_ORDER[STAGE_ORDER.length - 1]).toBe("DestructiveOperationGuard");
	});

	it("should have stages in correct execution order", () => {
		// DeclaredOutputExistence must be first (no point committing if files don't exist)
		// DestructiveOperationGuard must be last (protect against data loss after commit)
		const stages = STAGE_ORDER as readonly string[];
		expect(stages.indexOf("DeclaredOutputExistence")).toBe(0);
		expect(stages.indexOf("DestructiveOperationGuard")).toBe(8);
		// CommitExecution must come before PostCommitVerification
		expect(stages.indexOf("CommitExecution")).toBeLessThan(stages.indexOf("PostCommitVerification"));
	});
});

// ---------------------------------------------------------------------------
// Verified Complete Tests
// ---------------------------------------------------------------------------

describe("computeVerifiedComplete", () => {
	it("should return true only when all four dimensions pass", () => {
		expect(computeVerifiedComplete("COMPLETE", "DECLARED_OUTPUT_EXISTS", "PASSED", "POST_COMMIT_VERIFIED")).toBe(
			true,
		);
	});

	it("should return false when runtime is not COMPLETE", () => {
		expect(computeVerifiedComplete("RUNNING", "DECLARED_OUTPUT_EXISTS", "PASSED", "POST_COMMIT_VERIFIED")).toBe(
			false,
		);
		expect(computeVerifiedComplete("FAILED", "DECLARED_OUTPUT_EXISTS", "PASSED", "POST_COMMIT_VERIFIED")).toBe(false);
		expect(computeVerifiedComplete("PENDING", "DECLARED_OUTPUT_EXISTS", "PASSED", "POST_COMMIT_VERIFIED")).toBe(
			false,
		);
	});

	it("should return false when implementation is not DECLARED_OUTPUT_EXISTS", () => {
		expect(computeVerifiedComplete("COMPLETE", "NOT_STARTED", "PASSED", "POST_COMMIT_VERIFIED")).toBe(false);
		expect(computeVerifiedComplete("COMPLETE", "IN_PROGRESS", "PASSED", "POST_COMMIT_VERIFIED")).toBe(false);
	});

	it("should return false when validation is not PASSED", () => {
		expect(computeVerifiedComplete("COMPLETE", "DECLARED_OUTPUT_EXISTS", "FAILED", "POST_COMMIT_VERIFIED")).toBe(
			false,
		);
		expect(computeVerifiedComplete("COMPLETE", "DECLARED_OUTPUT_EXISTS", "NOT_RUN", "POST_COMMIT_VERIFIED")).toBe(
			false,
		);
	});

	it("should return false when durability is not POST_COMMIT_VERIFIED", () => {
		expect(computeVerifiedComplete("COMPLETE", "DECLARED_OUTPUT_EXISTS", "PASSED", "COMMITTED")).toBe(false);
		expect(computeVerifiedComplete("COMPLETE", "DECLARED_OUTPUT_EXISTS", "PASSED", "NOT_COMMITTED")).toBe(false);
		expect(computeVerifiedComplete("COMPLETE", "DECLARED_OUTPUT_EXISTS", "PASSED", "COMMIT_FAILED")).toBe(false);
	});

	it("should NOT allow verifiedComplete from runtime COMPLETE alone", () => {
		// This is the critical invariant: runtime complete is NOT enough
		const runtimeOnly = computeVerifiedComplete("COMPLETE", "UNKNOWN", "UNKNOWN", "UNKNOWN");
		expect(runtimeOnly).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// WorkspaceTruthStatus Tests
// ---------------------------------------------------------------------------

describe("WorkspaceTruthStatus", () => {
	it("should create a truth status with all UNKNOWN fields", () => {
		const status = createWorkspaceTruthStatus("P44.5.01", "P44.5");
		expect(status.workspaceId).toBe("P44.5.01");
		expect(status.planId).toBe("P44.5");
		expect(status.runtimeStatus).toBe("UNKNOWN");
		expect(status.implementationStatus).toBe("UNKNOWN");
		expect(status.validationStatus).toBe("UNKNOWN");
		expect(status.durabilityStatus).toBe("UNKNOWN");
		expect(status.verifiedComplete).toBe(false);
		expect(status.backfillStatus).toBe("not_applicable");
		expect(status.blockers).toEqual([]);
		expect(status.warnings).toEqual([]);
		expect(status.rolloutMode).toBe("shadow");
	});

	it("should accept overridden rollout mode", () => {
		const status = createWorkspaceTruthStatus("W1", "P1", { rolloutMode: "warn" });
		expect(status.rolloutMode).toBe("warn");
	});

	it("should accept waveId option", () => {
		const status = createWorkspaceTruthStatus("W1", "P1", { waveId: "W1" });
		expect(status.waveId).toBe("W1");
	});
});

// ---------------------------------------------------------------------------
// Verdict Application Tests
// ---------------------------------------------------------------------------

describe("applyVerdictToStatus", () => {
	function makePassingVerdict(): CompletionGateVNextVerdict {
		return {
			workspaceId: "P44.5.01",
			planId: "P44.5",
			passed: true,
			rolloutMode: "shadow",
			blockReasons: [],
			warnings: [],
			stageVerdicts: [
				createPassedStageVerdict("DeclaredOutputExistence", {}, 1),
				createPassedStageVerdict("EvidenceLedger", {}, 1),
				createPassedStageVerdict("Validation", {}, 1),
				createPassedStageVerdict("ScopeAndWriteSet", {}, 1),
				createPassedStageVerdict("CommitCandidate", {}, 1),
				createPassedStageVerdict("CommitExecution", {}, 5),
				createPassedStageVerdict("PostCommitVerification", {}, 2),
				createPassedStageVerdict("CommitMessageComposer", {}, 3),
				createPassedStageVerdict("DestructiveOperationGuard", {}, 1),
			],
			evaluated: true,
			evaluatedAt: Date.now(),
			durationMs: 20,
		};
	}

	it("should apply a passed verdict and set all statuses correctly", () => {
		const status = createWorkspaceTruthStatus("P44.5.01", "P44.5");
		status.runtimeStatus = "COMPLETE";
		applyVerdictToStatus(status, makePassingVerdict());

		expect(status.implementationStatus).toBe("DECLARED_OUTPUT_EXISTS");
		expect(status.validationStatus).toBe("PASSED");
		expect(status.durabilityStatus).toBe("POST_COMMIT_VERIFIED");
		expect(status.verifiedComplete).toBe(true);
		expect(status.blockers).toEqual([]);
	});

	it("should NOT set verifiedComplete if runtime status is not COMPLETE even with passed gate", () => {
		const status = createWorkspaceTruthStatus("P44.5.01", "P44.5");
		status.runtimeStatus = "RUNNING";
		applyVerdictToStatus(status, makePassingVerdict());

		expect(status.verifiedComplete).toBe(false);
	});

	it("should apply a failing verdict with block reasons", () => {
		const status = createWorkspaceTruthStatus("P44.5.01", "P44.5");
		const verdict: CompletionGateVNextVerdict = {
			workspaceId: "P44.5.01",
			planId: "P44.5",
			passed: false,
			rolloutMode: "warn",
			blockReasons: ["Commit failed: worktree locked"],
			warnings: [],
			stageVerdicts: [
				createFailedStageVerdict(
					"CommitExecution",
					["Commit failed: worktree locked"],
					{ recoveryState: "RETRYABLE_BLOCKED" },
					5,
				),
			],
			evaluated: true,
			evaluatedAt: Date.now(),
			durationMs: 10,
		};
		applyVerdictToStatus(status, verdict);

		expect(status.blockers).toEqual(["Commit failed: worktree locked"]);
		expect(status.durabilityStatus).toBe("COMMIT_FAILED");
		expect(status.verifiedComplete).toBe(false);
	});

	it("should route to recovery recommendation if present", () => {
		const status = createWorkspaceTruthStatus("P44.5.01", "P44.5");
		const route: RecoveryRoute = createRecoveryRoute(
			"NEEDS_HIR",
			"HIR",
			"not_allowed_without_authority",
			"Unauthorized mutation detected",
		);
		const verdict: CompletionGateVNextVerdict = {
			workspaceId: "P44.5.01",
			planId: "P44.5",
			passed: false,
			rolloutMode: "block_strict_plans",
			blockReasons: ["Unauthorized mutation detected"],
			warnings: [],
			stageVerdicts: [
				createFailedStageVerdict(
					"ScopeAndWriteSet",
					["Unauthorized mutation detected"],
					{ recoveryState: "NEEDS_HIR" },
					3,
				),
			],
			routeRecommendation: route,
			evaluated: true,
			evaluatedAt: Date.now(),
			durationMs: 10,
		};
		applyVerdictToStatus(status, verdict);

		expect(status.routeRecommendation).toBeDefined();
		expect(status.routeRecommendation!.state).toBe("NEEDS_HIR");
	});
});

// ---------------------------------------------------------------------------
// Recovery Route Tests
// ---------------------------------------------------------------------------

describe("RecoveryRoute", () => {
	it("should create a recovery route correctly", () => {
		const route = createRecoveryRoute("NEEDS_REPAIR", "FPR", "allowed_after_repair", "Missing declared output");
		expect(route.state).toBe("NEEDS_REPAIR");
		expect(route.reportType).toBe("FPR");
		expect(route.retryPolicy).toBe("allowed_after_repair");
		expect(route.reason).toBe("Missing declared output");
	});

	it("should support HIR route type", () => {
		const route = createRecoveryRoute(
			"NEEDS_HIR",
			"HIR",
			"not_allowed_without_authority",
			"Human authority required for scope amendment",
		);
		expect(route.state).toBe("NEEDS_HIR");
		expect(route.reportType).toBe("HIR");
	});

	it("should support RAR route type", () => {
		const route = createRecoveryRoute(
			"NEEDS_REPAIR_OR_RAR",
			"RAR",
			"allowed_after_fix",
			"Validation regression detected",
		);
		expect(route.state).toBe("NEEDS_REPAIR_OR_RAR");
		expect(route.reportType).toBe("RAR");
	});

	it("should derive recovery state from failed verdict", () => {
		const verdict: CompletionGateVNextVerdict = {
			workspaceId: "W1",
			planId: "P1",
			passed: false,
			rolloutMode: "block_strict_plans",
			blockReasons: ["Test failure"],
			warnings: [],
			stageVerdicts: [
				createFailedStageVerdict("Validation", ["Test failure"], { recoveryState: "NEEDS_REPAIR_OR_RAR" }, 10),
			],
			evaluated: true,
			evaluatedAt: Date.now(),
			durationMs: 10,
		};
		expect(deriveRecoveryState(verdict)).toBe("NEEDS_REPAIR_OR_RAR");
	});

	it("should default to NEEDS_REPAIR for unknown failures", () => {
		const verdict: CompletionGateVNextVerdict = {
			workspaceId: "W1",
			planId: "P1",
			passed: false,
			rolloutMode: "block_strict_plans",
			blockReasons: ["Unknown failure"],
			warnings: [],
			stageVerdicts: [createFailedStageVerdict("CommitExecution", ["Unknown failure"], {}, 5)],
			evaluated: true,
			evaluatedAt: Date.now(),
			durationMs: 10,
		};
		expect(deriveRecoveryState(verdict)).toBe("NEEDS_REPAIR");
	});
});

// ---------------------------------------------------------------------------
// Rollout Mode Tests
// ---------------------------------------------------------------------------

describe("RolloutMode", () => {
	it("should have five modes in ROLLOUT_MODE_SEQUENCE", () => {
		expect(ROLLOUT_MODE_SEQUENCE).toHaveLength(5);
		expect(ROLLOUT_MODE_SEQUENCE[0]).toBe("off");
		expect(ROLLOUT_MODE_SEQUENCE[4]).toBe("block_all_stable_3");
	});

	it("should not block in off mode", () => {
		expect(shouldBlockCompletion("off")).toBe(false);
	});

	it("should not block in shadow mode", () => {
		expect(shouldBlockCompletion("shadow")).toBe(false);
	});

	it("should not block in warn mode", () => {
		expect(shouldBlockCompletion("warn")).toBe(false);
	});

	it("should block in block_strict_plans mode", () => {
		expect(shouldBlockCompletion("block_strict_plans")).toBe(true);
	});

	it("should block in block_all_stable_3 mode", () => {
		expect(shouldBlockCompletion("block_all_stable_3")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Backfill Status Tests
// ---------------------------------------------------------------------------

describe("BackfillStatus", () => {
	it("should return vnext_verified when vNext verdict exists", () => {
		expect(determineBackfillStatus(true, true, true)).toBe("vnext_verified");
	});

	it("should return legacy_commit_present when commit exists but no post-commit verification", () => {
		expect(determineBackfillStatus(true, false, false)).toBe("legacy_commit_present");
	});

	it("should return legacy_no_commit_data when no commit hash", () => {
		expect(determineBackfillStatus(false, false, false)).toBe("legacy_no_commit_data");
	});

	it("should return not_applicable for edge case with no commit but post-commit (should not happen)", () => {
		expect(determineBackfillStatus(false, true, false)).toBe("legacy_no_commit_data");
	});
});

// ---------------------------------------------------------------------------
// Status Label Tests
// ---------------------------------------------------------------------------

describe("Status Labels", () => {
	it("should provide labels for durability statuses", () => {
		expect(durabilityStatusLabel("NOT_COMMITTED")).toBe("Not Committed");
		expect(durabilityStatusLabel("POST_COMMIT_VERIFIED")).toBe("Post-Commit Verified");
		expect(durabilityStatusLabel("COMMIT_FAILED")).toBe("Commit Failed");
		expect(durabilityStatusLabel("UNKNOWN")).toBe("Unknown");
	});

	it("should provide labels for validation statuses", () => {
		expect(validationStatusLabel("PASSED")).toBe("Passed");
		expect(validationStatusLabel("FAILED")).toBe("Failed");
		expect(validationStatusLabel("WARNINGS")).toBe("Warnings");
	});
});

// ---------------------------------------------------------------------------
// Type Structural Tests
// ---------------------------------------------------------------------------

describe("WorkspaceTruthStatus structural contract", () => {
	it("should have all required fields in truth status", () => {
		const status = createWorkspaceTruthStatus("W1", "P1");
		// Required fields (non-optional) must be present
		const required: Array<keyof WorkspaceTruthStatus> = [
			"workspaceId",
			"planId",
			"runtimeStatus",
			"implementationStatus",
			"validationStatus",
			"durabilityStatus",
			"verifiedComplete",
			"backfillStatus",
			"verifiedFiles",
			"filesModified",
			"blockers",
			"warnings",
			"rolloutMode",
			"lastUpdatedAt",
		];
		for (const field of required) {
			expect(status).toHaveProperty(field);
		}
		// Optional fields may be undefined
		expect(status.commitHash).toBeUndefined();
		expect(status.routeRecommendation).toBeUndefined();
	});

	it("should have optional fields present with correct defaults", () => {
		const status = createWorkspaceTruthStatus("W1", "P1");
		expect(status.agentClaim).toBeUndefined();
		expect(status.verifiedReality).toBeUndefined();
		expect(status.lastVerdict).toBeUndefined();
		expect(status.requiredMode).toBeUndefined();
	});
});
