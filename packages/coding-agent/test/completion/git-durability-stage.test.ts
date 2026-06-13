/**
 * P44.5.04 — Git Durability Stage Tests
 *
 * Tests for:
 * - ScopeAndWriteSetStage (P44.5.04)
 * - CommitCandidateStage (P44.5.04)
 * - CommitExecutionStage (P44.5.04)
 * - PostCommitVerificationStage (P44.5.05)
 *
 * Contract Schema: 4.1.1
 */

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// ScopeAndWriteSetStage Tests
// ---------------------------------------------------------------------------

describe("ScopeAndWriteSetStage", () => {
	describe("createScopeAndWriteSetStageRunner", () => {
		it("should pass when no files are modified", async () => {
			const { createScopeAndWriteSetStageRunner } = await import(
				"../../src/core/completion/stages/scope-and-writeset-stage.js"
			);
			const runner = createScopeAndWriteSetStageRunner(
				{
					repoRoot: "/tmp",
					workspaceId: "W1",
					allowedFiles: ["src/**"],
					writeSet: ["src/**"],
				},
				() => [],
			);
			const verdict = await runner(
				"ScopeAndWriteSet",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(true);
		});

		it("should pass when modified files are within writeSet", async () => {
			const { createScopeAndWriteSetStageRunner } = await import(
				"../../src/core/completion/stages/scope-and-writeset-stage.js"
			);
			const runner = createScopeAndWriteSetStageRunner(
				{
					repoRoot: "/tmp",
					workspaceId: "W1",
					allowedFiles: ["src/**"],
					writeSet: ["src/**"],
				},
				() => ["src/main.ts", "src/utils.ts"],
			);
			const verdict = await runner(
				"ScopeAndWriteSet",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(true);
		});

		it("should block when files are modified outside writeSet", async () => {
			const { createScopeAndWriteSetStageRunner } = await import(
				"../../src/core/completion/stages/scope-and-writeset-stage.js"
			);
			const runner = createScopeAndWriteSetStageRunner(
				{
					repoRoot: "/tmp",
					workspaceId: "W1",
					allowedFiles: ["src/**"],
					writeSet: ["src/**"],
				},
				() => ["src/main.ts", "unauthorized-file.ts"],
			);
			const verdict = await runner(
				"ScopeAndWriteSet",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(false);
			expect(verdict.blockReasons[0]).toContain("unauthorized-file.ts");
		});

		it("should block forbidden files", async () => {
			const { createScopeAndWriteSetStageRunner } = await import(
				"../../src/core/completion/stages/scope-and-writeset-stage.js"
			);
			const runner = createScopeAndWriteSetStageRunner(
				{
					repoRoot: "/tmp",
					workspaceId: "W1",
					allowedFiles: ["src/**"],
					writeSet: ["src/**"],
					forbiddenFiles: [".env"],
				},
				() => ["src/main.ts", ".env"],
			);
			const verdict = await runner(
				"ScopeAndWriteSet",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(false);
			expect(verdict.blockReasons[0]).toContain(".env");
		});

		it("should route to NEEDS_HIR for unauthorized mutation", async () => {
			const { createScopeAndWriteSetStageRunner } = await import(
				"../../src/core/completion/stages/scope-and-writeset-stage.js"
			);
			const runner = createScopeAndWriteSetStageRunner(
				{
					repoRoot: "/tmp",
					workspaceId: "W1",
					allowedFiles: ["src/**"],
					writeSet: ["src/**"],
				},
				() => ["unauthorized.ts"],
			);
			const verdict = await runner(
				"ScopeAndWriteSet",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.detail.recoveryState).toBe("NEEDS_HIR");
		});

		it("should pass with shared files", async () => {
			const { createScopeAndWriteSetStageRunner } = await import(
				"../../src/core/completion/stages/scope-and-writeset-stage.js"
			);
			const runner = createScopeAndWriteSetStageRunner(
				{
					repoRoot: "/tmp",
					workspaceId: "W1",
					allowedFiles: ["src/**", "shared/**"],
					writeSet: ["src/**"],
					declaredSharedFiles: ["shared/data.ts"],
				},
				() => ["src/main.ts", "shared/data.ts"],
			);
			const verdict = await runner(
				"ScopeAndWriteSet",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// CommitCandidate Stage Tests
// ---------------------------------------------------------------------------

describe("CommitCandidateStage", () => {
	describe("createCommitCandidateStageRunner", () => {
		it("should pass when files are staged", async () => {
			const { createCommitCandidateStageRunner } = await import(
				"../../src/core/completion/stages/commit-candidate-stage.js"
			);
			const runner = createCommitCandidateStageRunner({
				writeSet: ["src/**"],
				requireStagedFiles: true,
				getCandidateInfo: () => ({
					stagedFiles: ["src/main.ts"],
					unstagedFiles: [],
					writeSetFiles: ["src/main.ts"],
				}),
			});
			const verdict = await runner(
				"CommitCandidate",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(true);
		});

		it("should block when no files are changed", async () => {
			const { createCommitCandidateStageRunner } = await import(
				"../../src/core/completion/stages/commit-candidate-stage.js"
			);
			const runner = createCommitCandidateStageRunner({
				writeSet: ["src/**"],
				getCandidateInfo: () => ({
					stagedFiles: [],
					unstagedFiles: [],
					writeSetFiles: [],
				}),
			});
			const verdict = await runner(
				"CommitCandidate",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(false);
			expect(verdict.blockReasons[0]).toContain("No files changed");
		});

		it("should block when requireStagedFiles is true and nothing is staged", async () => {
			const { createCommitCandidateStageRunner } = await import(
				"../../src/core/completion/stages/commit-candidate-stage.js"
			);
			const runner = createCommitCandidateStageRunner({
				writeSet: ["src/**"],
				requireStagedFiles: true,
				getCandidateInfo: () => ({
					stagedFiles: [],
					unstagedFiles: ["src/unstaged.ts"],
					writeSetFiles: ["src/unstaged.ts"],
				}),
			});
			const verdict = await runner(
				"CommitCandidate",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(false);
			expect(verdict.blockReasons[0]).toContain("No files staged");
		});
	});
});

// ---------------------------------------------------------------------------
// CommitExecution Stage Tests
// ---------------------------------------------------------------------------

describe("CommitExecutionStage", () => {
	describe("createCommitExecutionStageRunner", () => {
		it("should pass on successful commit", async () => {
			const { createCommitExecutionStageRunner } = await import(
				"../../src/core/completion/stages/commit-execution-stage.js"
			);
			const runner = createCommitExecutionStageRunner({
				executeCommit: async () => ({
					success: true,
					commitHash: "abc123",
					committedFiles: ["src/main.ts"],
				}),
			});
			const verdict = await runner(
				"CommitExecution",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(true);
			expect(verdict.detail.commitHash).toBe("abc123");
		});

		it("should block on transient git failure with RETRYABLE_BLOCKED", async () => {
			const { createCommitExecutionStageRunner } = await import(
				"../../src/core/completion/stages/commit-execution-stage.js"
			);
			const runner = createCommitExecutionStageRunner({
				executeCommit: async () => ({
					success: false,
					error: "Worktree locked",
					isTransient: true,
				}),
			});
			const verdict = await runner(
				"CommitExecution",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(false);
			expect(verdict.detail.recoveryState).toBe("RETRYABLE_BLOCKED");
		});

		it("should block on non-transient commit failure with NEEDS_REPAIR", async () => {
			const { createCommitExecutionStageRunner } = await import(
				"../../src/core/completion/stages/commit-execution-stage.js"
			);
			const runner = createCommitExecutionStageRunner({
				executeCommit: async () => ({
					success: false,
					error: "Non-fast-forward: rejected",
				}),
			});
			const verdict = await runner(
				"CommitExecution",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(false);
			expect(verdict.detail.recoveryState).toBe("NEEDS_REPAIR");
		});
	});
});

// ---------------------------------------------------------------------------
// PostCommitVerification Stage Tests
// ---------------------------------------------------------------------------

describe("PostCommitVerificationStage", () => {
	describe("createPostCommitVerificationStageRunner", () => {
		it("should pass when commit verification succeeds", async () => {
			const { createPostCommitVerificationStageRunner } = await import(
				"../../src/core/completion/stages/post-commit-verification-stage.js"
			);
			const runner = createPostCommitVerificationStageRunner({
				commitHash: "abc123",
				expectedAuthorName: "Pi Agent W1",
				expectedAuthorEmail: "pi-agent@local.invalid",
				expectedFiles: ["src/main.ts"],
				repoRoot: "/tmp",
				requiredTrailers: ["Pi-Plan", "Pi-Workspace"],
				verifyCommit: () => ({
					commitExists: true,
					authorName: "Pi Agent W1",
					authorEmail: "pi-agent@local.invalid",
					filesInCommit: ["src/main.ts", "src/utils.ts"],
					trailers: {
						"Pi-Plan": "P1",
						"Pi-Workspace": "W1",
						"Pi-Agent": "agent",
					},
				}),
			});
			const verdict = await runner(
				"PostCommitVerification",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(true);
		});

		it("should block when commit does not exist", async () => {
			const { createPostCommitVerificationStageRunner } = await import(
				"../../src/core/completion/stages/post-commit-verification-stage.js"
			);
			const runner = createPostCommitVerificationStageRunner({
				commitHash: "nonexistent",
				repoRoot: "/tmp",
				expectedFiles: [],
				verifyCommit: () => ({
					commitExists: false,
					filesInCommit: [],
					trailers: {},
				}),
			});
			const verdict = await runner(
				"PostCommitVerification",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(false);
			expect(verdict.blockReasons[0]).toContain("does not exist");
		});

		it("should block when author name mismatches", async () => {
			const { createPostCommitVerificationStageRunner } = await import(
				"../../src/core/completion/stages/post-commit-verification-stage.js"
			);
			const runner = createPostCommitVerificationStageRunner({
				commitHash: "abc123",
				expectedAuthorName: "Pi Agent W1",
				expectedAuthorEmail: "pi-agent@local.invalid",
				expectedFiles: ["src/main.ts"],
				repoRoot: "/tmp",
				verifyCommit: () => ({
					commitExists: true,
					authorName: "Wrong User",
					authorEmail: "wrong@example.com",
					filesInCommit: ["src/main.ts"],
					trailers: {},
				}),
			});
			const verdict = await runner(
				"PostCommitVerification",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(false);
			expect(verdict.blockReasons.some((r) => r.includes("Author name"))).toBe(true);
		});

		it("should block when expected files are missing from commit", async () => {
			const { createPostCommitVerificationStageRunner } = await import(
				"../../src/core/completion/stages/post-commit-verification-stage.js"
			);
			const runner = createPostCommitVerificationStageRunner({
				commitHash: "abc123",
				expectedFiles: ["expected-output.md"],
				repoRoot: "/tmp",
				requiredTrailers: [],
				verifyCommit: () => ({
					commitExists: true,
					authorName: "Agent",
					authorEmail: "agent@test",
					filesInCommit: ["other-file.ts"],
					trailers: {},
				}),
			});
			const verdict = await runner(
				"PostCommitVerification",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(false);
			expect(verdict.blockReasons.some((r) => r.includes("Expected files"))).toBe(true);
		});

		it("should block when required trailers are missing", async () => {
			const { createPostCommitVerificationStageRunner, REQUIRED_COMMIT_TRAILERS } = await import(
				"../../src/core/completion/stages/post-commit-verification-stage.js"
			);
			const runner = createPostCommitVerificationStageRunner({
				commitHash: "abc123",
				expectedFiles: [],
				repoRoot: "/tmp",
				requiredTrailers: [...REQUIRED_COMMIT_TRAILERS],
				verifyCommit: () => ({
					commitExists: true,
					authorName: "Agent",
					authorEmail: "agent@test",
					filesInCommit: ["src/main.ts"],
					trailers: { "Pi-Plan": "P1" }, // Missing other required trailers
				}),
			});
			const verdict = await runner(
				"PostCommitVerification",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.passed).toBe(false);
			expect(verdict.blockReasons.some((r) => r.includes("Required trailers"))).toBe(true);
		});

		it("should route to NEEDS_REPAIR on failure", async () => {
			const { createPostCommitVerificationStageRunner } = await import(
				"../../src/core/completion/stages/post-commit-verification-stage.js"
			);
			const runner = createPostCommitVerificationStageRunner({
				commitHash: "abc123",
				expectedFiles: ["missing.md"],
				repoRoot: "/tmp",
				requiredTrailers: [],
				verifyCommit: () => ({
					commitExists: true,
					authorName: "Agent",
					authorEmail: "agent@test",
					filesInCommit: ["src/ok.ts"],
					trailers: {},
				}),
			});
			const verdict = await runner(
				"PostCommitVerification",
				{},
				{
					planId: "P1",
					workspaceId: "W1",
					rolloutMode: "block_strict_plans",
				},
			);
			expect(verdict.detail.recoveryState).toBe("NEEDS_REPAIR");
		});
	});
});
