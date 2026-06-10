/**
 * P44.5.12 — Commit Durability Completion Gate Gauntlet
 *
 * End-to-end integration tests for the CompletionGate vNext pipeline.
 *
 * Gauntlets:
 * 1. Fake complete: workspace claims files without creating them -> blocked
 * 2. Missing declared output: workspace claims nonexistent file -> blocked
 * 3. canEdit/writeSet exclusion: workspace modifies files outside writeSet -> blocked/HIR
 * 4. LLM message fallback: composer timeout produces deterministic fallback
 * 5. Shared-file conflict: parallel modification of shared file -> blocked
 *
 * Contract Schema: 4.1.1
 */

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Gauntlet 1: Fake Complete
// ---------------------------------------------------------------------------

describe("Gauntlet: Fake Complete", () => {
	it("should block workspace that claims files without creating them", async () => {
		const { createDeclaredOutputExistenceStageRunner } = await import(
			"../../src/core/completion/stages/declared-output-existence-stage.js"
		);
		const runner = createDeclaredOutputExistenceStageRunner({
			repoRoot: "/tmp",
			declaredOutputFiles: ["nonexistent-file-gauntlet.md"],
			checkFilesystemExistence: true,
		});
		const verdict = await runner(
			"DeclaredOutputExistence",
			{},
			{
				planId: "P44.5",
				workspaceId: "W6",
				rolloutMode: "block_strict_plans",
			},
		);
		expect(verdict.passed).toBe(false);
		expect(verdict.blockReasons[0]).toContain("Declared output file not found");
	});
});

// ---------------------------------------------------------------------------
// Gauntlet 2: Missing Declared Output
// ---------------------------------------------------------------------------

describe("Gauntlet: Missing Declared Output", () => {
	it("should block completion when expected output file does not exist", async () => {
		const { createDeclaredOutputExistenceStageRunner } = await import(
			"../../src/core/completion/stages/declared-output-existence-stage.js"
		);
		const runner = createDeclaredOutputExistenceStageRunner({
			repoRoot: "/tmp",
			declaredOutputFiles: ["missing-output-gauntlet.md"],
			checkFilesystemExistence: true,
		});
		const verdict = await runner(
			"DeclaredOutputExistence",
			{},
			{
				planId: "P44.5",
				workspaceId: "W6",
				rolloutMode: "block_strict_plans",
			},
		);
		expect(verdict.passed).toBe(false);
		expect(verdict.blockReasons[0]).toContain("Declared output file not found");
	});

	it("should pass when declared output exists", async () => {
		const { createDeclaredOutputExistenceStageRunner } = await import(
			"../../src/core/completion/stages/declared-output-existence-stage.js"
		);
		const runner = createDeclaredOutputExistenceStageRunner({
			repoRoot: process.cwd(),
			declaredOutputFiles: ["package.json"],
			checkFilesystemExistence: true,
		});
		const verdict = await runner(
			"DeclaredOutputExistence",
			{},
			{
				planId: "P44.5",
				workspaceId: "W6",
				rolloutMode: "block_strict_plans",
			},
		);
		expect(verdict.passed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Gauntlet 3: canEdit/writeSet Exclusion
// ---------------------------------------------------------------------------

describe("Gauntlet: canEdit/writeSet Exclusion", () => {
	it("should block when file outside writeSet is modified", async () => {
		const { createScopeAndWriteSetStageRunner } = await import(
			"../../src/core/completion/stages/scope-and-writeset-stage.js"
		);
		const runner = createScopeAndWriteSetStageRunner(
			{
				repoRoot: "/tmp",
				workspaceId: "W6",
				allowedFiles: ["src/**"],
				writeSet: ["src/**"],
			},
			() => ["src/main.ts", "forbidden-external-file.ts"],
		);
		const verdict = await runner(
			"ScopeAndWriteSet",
			{},
			{
				planId: "P44.5",
				workspaceId: "W6",
				rolloutMode: "block_strict_plans",
			},
		);
		expect(verdict.passed).toBe(false);
		expect(verdict.blockReasons[0]).toContain("forbidden-external-file.ts");
	});

	it("should route to HIR for unauthorized mutation (NEEDS_HIR recovery)", async () => {
		const { createScopeAndWriteSetStageRunner } = await import(
			"../../src/core/completion/stages/scope-and-writeset-stage.js"
		);
		const runner = createScopeAndWriteSetStageRunner(
			{
				repoRoot: "/tmp",
				workspaceId: "W6",
				allowedFiles: ["src/**"],
				writeSet: ["src/**"],
			},
			() => ["unauthorized-file.ts"],
		);
		const verdict = await runner(
			"ScopeAndWriteSet",
			{},
			{
				planId: "P44.5",
				workspaceId: "W6",
				rolloutMode: "block_strict_plans",
			},
		);
		expect(verdict.passed).toBe(false);
		expect(verdict.detail["recoveryState"]).toBe("NEEDS_HIR");
	});

	it("should pass when all modified files are within writeSet", async () => {
		const { createScopeAndWriteSetStageRunner } = await import(
			"../../src/core/completion/stages/scope-and-writeset-stage.js"
		);
		const runner = createScopeAndWriteSetStageRunner(
			{
				repoRoot: "/tmp",
				workspaceId: "W6",
				allowedFiles: ["src/**"],
				writeSet: ["src/**"],
			},
			() => ["src/main.ts"],
		);
		const verdict = await runner(
			"ScopeAndWriteSet",
			{},
			{
				planId: "P44.5",
				workspaceId: "W6",
				rolloutMode: "block_strict_plans",
			},
		);
		expect(verdict.passed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Gauntlet 4: LLM Message Fallback
// ---------------------------------------------------------------------------

describe("Gauntlet: LLM Message Fallback", () => {
	it("should produce deterministic fallback when LLM times out", async () => {
		const { composeCommitMessage } = await import("../../src/core/completion/commit-message-composer.js");
		const result = await composeCommitMessage(
			{
				planId: "P44.5",
				workspaceId: "W6",
				filesChanged: ["src/main.ts"],
				filesAdded: 1,
				filesModified: 0,
				filesDeleted: 0,
				validationResults: [{ command: "npx vitest run", passed: true }],
				allValidationPassed: true,
			},
			{ "Pi-Plan": "P44.5", "Pi-Workspace": "W6" },
		);
		expect(result.usedFallback).toBe(true);
		expect(result.message.length).toBeGreaterThan(0);
		expect(result.message).toContain("src/main.ts");
	});

	it("should fallback when LLM returns invalid message", async () => {
		const { composeCommitMessage } = await import("../../src/core/completion/commit-message-composer.js");
		const result = await composeCommitMessage(
			{
				planId: "P44.5",
				workspaceId: "W6",
				filesChanged: ["src/main.ts"],
				filesAdded: 1,
				filesModified: 0,
				filesDeleted: 0,
				validationResults: [{ command: "npx vitest run", passed: true }],
				allValidationPassed: true,
			},
			{ "Pi-Plan": "P44.5", "Pi-Workspace": "W6" },
			async () => "invalid message",
		);
		expect(result.usedFallback).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Gauntlet 5: Shared-file Conflict
// ---------------------------------------------------------------------------

describe("Gauntlet: Shared-file Conflict", () => {
	it("should route shared file mismatch to NEEDS_HIR via ScopeAndWriteSetStage", async () => {
		const { createScopeAndWriteSetStageRunner } = await import(
			"../../src/core/completion/stages/scope-and-writeset-stage.js"
		);
		const runner = createScopeAndWriteSetStageRunner(
			{
				repoRoot: "/tmp",
				workspaceId: "W6",
				allowedFiles: ["src/**"],
				writeSet: ["src/**"],
			},
			() => ["shared/data.ts"],
		);
		const verdict = await runner(
			"ScopeAndWriteSet",
			{},
			{
				planId: "P44.5",
				workspaceId: "W6",
				rolloutMode: "block_strict_plans",
			},
		);
		// Without declaring shared file, the file is outside both writeSet and allowedFiles -> blocked
		expect(verdict.passed).toBe(false);
		expect(verdict.detail["recoveryState"]).toBe("NEEDS_HIR");
	});

	it("should pass when shared file is declared and within allowedFiles", async () => {
		const { createScopeAndWriteSetStageRunner } = await import(
			"../../src/core/completion/stages/scope-and-writeset-stage.js"
		);
		const runner = createScopeAndWriteSetStageRunner(
			{
				repoRoot: "/tmp",
				workspaceId: "W6",
				allowedFiles: ["src/**", "shared/**"],
				writeSet: ["src/**"],
				declaredSharedFiles: ["shared/data.ts"],
			},
			() => ["shared/data.ts"],
		);
		const verdict = await runner(
			"ScopeAndWriteSet",
			{},
			{
				planId: "P44.5",
				workspaceId: "W6",
				rolloutMode: "block_strict_plans",
			},
		);
		expect(verdict.passed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Gauntlet 6: Commit Durability (via routing)
// ---------------------------------------------------------------------------

describe("Gauntlet: Commit Durability Routing", () => {
	it("should route commit failure according to recovery table", async () => {
		const { routeStageFailure } = await import("../../src/core/completion/completion-recovery-router.js");
		const route = routeStageFailure("CommitExecution", "non_transient_commit_failure");
		expect(route.state).toBe("NEEDS_REPAIR");
		expect(route.reportType).toBe("FPR");
		expect(route.retryPolicy).toBe("allowed_after_fix");
	});

	it("should route transient commit failure as retryable", async () => {
		const { routeStageFailure } = await import("../../src/core/completion/completion-recovery-router.js");
		const route = routeStageFailure("CommitExecution", "transient_git_failure");
		expect(route.state).toBe("RETRYABLE_BLOCKED");
		expect(route.retryPolicy).toBe("bounded_retry_allowed");
	});

	it("should route post-commit verification failure to NEEDS_REPAIR", async () => {
		const { routeStageFailure } = await import("../../src/core/completion/completion-recovery-router.js");
		const route = routeStageFailure("PostCommitVerification", "commit_missing_expected_files");
		expect(route.state).toBe("NEEDS_REPAIR");
		expect(route.retryPolicy).toBe("allowed_after_repair");
	});
});

// ---------------------------------------------------------------------------
// Gauntlet 7: Orchestrator Integration
// ---------------------------------------------------------------------------

describe("Gauntlet: Orchestrator Integration", () => {
	it("should aggregate stage failures and block in strict mode", async () => {
		const { runCompletionGateVNext, StageRunnerRegistry } = await import(
			"../../src/core/completion/completion-gate-vnext.js"
		);
		const { createFailedStageVerdict, createPassedStageVerdict } = await import(
			"../../src/core/completion/workspace-truth-status.js"
		);
		const registry = new StageRunnerRegistry();

		// DeclaredOutputExistence passes
		registry.register("DeclaredOutputExistence", () => createPassedStageVerdict("DeclaredOutputExistence", {}, 1));
		// Commit fails
		registry.register("CommitExecution", () =>
			createFailedStageVerdict(
				"CommitExecution",
				["Gauntlet: commit failed"],
				{
					recoveryState: "NEEDS_REPAIR",
				},
				5,
			),
		);

		const verdict = await runCompletionGateVNext({ id: "W6" } as any, registry, {
			planId: "P44.5",
			workspaceId: "W6",
			rolloutMode: "block_strict_plans",
		});

		expect(verdict.passed).toBe(false);
		expect(verdict.blockReasons).toContain("Gauntlet: commit failed");
		expect(verdict.evaluated).toBe(true);
	});

	it("should not block in shadow mode even with failures", async () => {
		const { runCompletionGateVNext, StageRunnerRegistry } = await import(
			"../../src/core/completion/completion-gate-vnext.js"
		);
		const { createFailedStageVerdict, createPassedStageVerdict } = await import(
			"../../src/core/completion/workspace-truth-status.js"
		);
		const registry = new StageRunnerRegistry();

		registry.register("DeclaredOutputExistence", () => createPassedStageVerdict("DeclaredOutputExistence", {}, 1));
		registry.register("CommitExecution", () =>
			createFailedStageVerdict("CommitExecution", ["Shadow mode failure"], {}, 5),
		);

		const verdict = await runCompletionGateVNext({ id: "W6" } as any, registry, {
			planId: "P44.5",
			workspaceId: "W6",
			rolloutMode: "shadow",
		});

		expect(verdict.passed).toBe(true); // Shadow mode does not block
		expect(verdict.wouldBlockReasons).toBeDefined();
	});
});
