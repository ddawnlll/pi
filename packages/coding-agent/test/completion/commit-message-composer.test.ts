/**
 * P44.5.06/07 — Commit Message Composer and Git Identity Tests
 *
 * Tests for:
 * - CommitMessageRenderer (P44.5.06): fallback, scope derivation, type derivation
 * - CommitMessageValidator (P44.5.06): hallucination rejection, trailer validation
 * - CommitMessageComposer (P44.5.06): circuit breaker, timeout, fallback
 * - GitActorIdentity (P44.5.07): per-workspace identity
 * - CommitTrailerBuilder (P44.5.07): structured trailers
 *
 * Contract Schema: 4.1.1
 */

import { describe, expect, it } from "vitest";
import type { RuntimeFactPacket } from "../../src/core/completion/commit-message-renderer.js";
import {
	buildCommitTrailers,
	formatTrailers,
	validateRequiredTrailers,
} from "../../src/core/completion/commit-trailer-builder.js";
import { createGitActorIdentity, formatGitIdentityArgs } from "../../src/core/completion/git-actor-identity.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFacts(overrides: Partial<RuntimeFactPacket> = {}): RuntimeFactPacket {
	return {
		planId: "P44.5",
		workspaceId: "P44.5.06",
		filesChanged: ["packages/coding-agent/src/core/completion/commit-message-composer.ts"],
		filesAdded: 1,
		filesModified: 0,
		filesDeleted: 0,
		validationResults: [{ command: "CMD-TYPECHECK-TSGO", passed: true }],
		allValidationPassed: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// CommitMessageRenderer Tests
// ---------------------------------------------------------------------------

describe("CommitMessageRenderer", () => {
	describe("deriveCommitType", () => {
		it("should return 'feat' when validation passes with changes", async () => {
			const { deriveCommitType } = await import("../../src/core/completion/commit-message-renderer.js");
			expect(deriveCommitType(makeFacts())).toBe("feat");
		});

		it("should return 'fix' when validation fails", async () => {
			const { deriveCommitType } = await import("../../src/core/completion/commit-message-renderer.js");
			expect(deriveCommitType(makeFacts({ allValidationPassed: false }))).toBe("fix");
		});

		it("should return 'chore' as default", async () => {
			const { deriveCommitType, DEFAULT_COMMIT_TYPE } = await import(
				"../../src/core/completion/commit-message-renderer.js"
			);
			expect(DEFAULT_COMMIT_TYPE).toBe("chore");
			expect(deriveCommitType(makeFacts({ filesChanged: [], allValidationPassed: true }))).toBe(DEFAULT_COMMIT_TYPE);
		});
	});

	describe("deriveScope", () => {
		it("should derive scope from packages paths", async () => {
			const { deriveScope } = await import("../../src/core/completion/commit-message-renderer.js");
			expect(
				deriveScope(
					makeFacts({
						filesChanged: ["packages/coding-agent/src/foo.ts"],
					}),
				),
			).toBe("coding-agent");
		});

		it("should return default scope when no packages path", async () => {
			const { deriveScope } = await import("../../src/core/completion/commit-message-renderer.js");
			expect(
				deriveScope(
					makeFacts({
						filesChanged: [] as string[],
					}),
				),
			).toBe("p44.5");
		});

		it("should use explicit derivedScope if provided", async () => {
			const { deriveScope } = await import("../../src/core/completion/commit-message-renderer.js");
			expect(deriveScope(makeFacts({ derivedScope: "docs" }))).toBe("docs");
		});
	});

	describe("buildFallbackCommitMessage", () => {
		it("should build a valid fallback message", async () => {
			const { buildFallbackCommitMessage } = await import("../../src/core/completion/commit-message-renderer.js");
			const result = buildFallbackCommitMessage(makeFacts(), {
				"Pi-Plan": "P44.5",
				"Pi-Workspace": "P44.5.06",
			});
			expect(result.firstLine).toContain("feat");
			expect(result.firstLine).toContain("commit-message-composer.ts");
			expect(result.fullMessage).toContain("Pi-Plan: P44.5");
			expect(result.fullMessage).toContain("Workspace: P44.5.06");
		});

		it("should include files in body", async () => {
			const { buildFallbackCommitMessage } = await import("../../src/core/completion/commit-message-renderer.js");
			const result = buildFallbackCommitMessage(makeFacts({ filesChanged: ["a.ts", "b.ts"] }), {});
			expect(result.fullMessage).toContain("a.ts");
			expect(result.fullMessage).toContain("b.ts");
		});

		it("should include outcome", async () => {
			const { buildFallbackCommitMessage } = await import("../../src/core/completion/commit-message-renderer.js");
			const result = buildFallbackCommitMessage(makeFacts(), {});
			expect(result.fullMessage).toContain("validation passed");
		});
	});

	describe("formatCommitMessageFromParts", () => {
		it("should format a full commit message from parts", async () => {
			const { formatCommitMessageFromParts } = await import("../../src/core/completion/commit-message-renderer.js");
			const message = formatCommitMessageFromParts({
				type: "feat",
				scope: "coding-agent",
				description: "add commit message composer",
				body: ["This adds the LLM-backed composer."],
				trailers: { "Pi-Plan": "P44.5" },
			});
			expect(message).toContain("feat(coding-agent): add commit message composer");
			expect(message).toContain("Pi-Plan: P44.5");
		});
	});
});

// ---------------------------------------------------------------------------
// CommitMessageValidator Tests
// ---------------------------------------------------------------------------

describe("CommitMessageValidator", () => {
	describe("validateCommitMessage", () => {
		it("should accept a valid commit message", async () => {
			const { validateCommitMessage } = await import("../../src/core/completion/commit-message-validator.js");
			const facts = makeFacts();
			const message = `feat(coding-agent): add commit message composer

Adds the LLM-backed composer with circuit breaker.

Pi-Plan: P44.5
Pi-Workspace: P44.5.06
Pi-Agent: pi-agent
Pi-Completion-Gate: vNext
Pi-Commit-Durability: durable
Pi-Validation: passed
Pi-Generated-By: pi-agent@local.invalid`;

			const result = validateCommitMessage(message, facts, [
				"Pi-Plan",
				"Pi-Workspace",
				"Pi-Agent",
				"Pi-Completion-Gate",
				"Pi-Commit-Durability",
				"Pi-Validation",
				"Pi-Generated-By",
			]);
			expect(result.valid).toBe(true);
			expect(result.useFallback).toBe(false);
		});

		it("should reject a message with invented files", async () => {
			const { validateCommitMessage } = await import("../../src/core/completion/commit-message-validator.js");
			const facts = makeFacts({ filesChanged: [] });
			const message = `feat(test): add tests

Adds main.test.ts and utils.test.ts.

Pi-Plan: P44.5
Pi-Workspace: P44.5.06`;

			const result = validateCommitMessage(message, facts, ["Pi-Plan"]);
			expect(result.valid).toBe(false);
			expect(result.reasons.some((r) => r.includes("main.test.ts"))).toBe(true);
		});

		it("should reject a message claiming tests pass when they fail", async () => {
			const { validateCommitMessage } = await import("../../src/core/completion/commit-message-validator.js");
			const facts = makeFacts({ allValidationPassed: false, filesChanged: ["test/main.test.ts"] });
			const message = `fix(test): fix tests

All tests passing now.

Pi-Plan: P44.5
Pi-Workspace: P44.5.06`;

			const result = validateCommitMessage(message, facts, ["Pi-Plan"]);
			expect(result.valid).toBe(false);
			expect(result.reasons.some((r) => r.includes("tests pass"))).toBe(true);
		});

		it("should reject empty messages", async () => {
			const { validateCommitMessage } = await import("../../src/core/completion/commit-message-validator.js");
			const result = validateCommitMessage("", makeFacts(), []);
			expect(result.valid).toBe(false);
			expect(result.reasons[0]).toContain("empty");
		});

		it("should reject messages missing required trailers", async () => {
			const { validateCommitMessage } = await import("../../src/core/completion/commit-message-validator.js");
			const message = "feat(coding-agent): change";
			const result = validateCommitMessage(message, makeFacts(), ["Pi-Plan", "Pi-Missing-Trailer"]);
			expect(result.valid).toBe(false);
			expect(result.reasons.some((r) => r.includes("Pi-Missing-Trailer"))).toBe(true);
		});

		it("should reject messages without proper format", async () => {
			const { validateCommitMessage } = await import("../../src/core/completion/commit-message-validator.js");
			const result = validateCommitMessage("bad message", makeFacts(), []);
			expect(result.valid).toBe(false);
		});
	});

	describe("extractTrailers", () => {
		it("should extract trailers from commit message", async () => {
			const { extractTrailers } = await import("../../src/core/completion/commit-message-validator.js");
			const trailers = extractTrailers(`feat: test

Pi-Plan: P44.5
Pi-Workspace: W1`);
			expect(trailers["Pi-Plan"]).toBe("P44.5");
			expect(trailers["Pi-Workspace"]).toBe("W1");
		});
	});
});

// ---------------------------------------------------------------------------
// CommitMessageComposer Tests
// ---------------------------------------------------------------------------

describe("CommitMessageComposer", () => {
	describe("composeCommitMessage", () => {
		it("should produce fallback message when no LLM generator is provided", async () => {
			const { composeCommitMessage } = await import("../../src/core/completion/commit-message-composer.js");
			const result = await composeCommitMessage(makeFacts(), {
				"Pi-Plan": "P44.5",
				"Pi-Workspace": "P44.5.06",
			});
			expect(result.message.length).toBeGreaterThan(0);
			expect(result.usedLlm).toBe(false);
			expect(result.usedFallback).toBe(true);
		});

		it("should use LLM generator when provided and valid", async () => {
			const { composeCommitMessage } = await import("../../src/core/completion/commit-message-composer.js");
			const result = await composeCommitMessage(
				makeFacts(),
				{ "Pi-Plan": "P44.5", "Pi-Workspace": "P44.5.06", "Pi-Agent": "pi-agent" },
				async () =>
					"feat(coding-agent): LLM generated message\n\nBody content\nPi-Plan: P44.5\nPi-Workspace: P44.5.06\nPi-Agent: pi-agent\nPi-Completion-Gate: vNext\nPi-Commit-Durability: durable\nPi-Validation: passed\nPi-Generated-By: pi-agent@local.invalid",
			);
			expect(result.usedLlm).toBe(true);
			expect(result.usedFallback).toBe(false);
			expect(result.message).toContain("LLM generated message");
		});

		it("should fallback when LLM returns null", async () => {
			const { composeCommitMessage } = await import("../../src/core/completion/commit-message-composer.js");
			const result = await composeCommitMessage(
				makeFacts(),
				{ "Pi-Plan": "P44.5", "Pi-Workspace": "P44.5.06" },
				async () => null,
			);
			expect(result.usedFallback).toBe(true);
		});

		it("should fallback when LLM times out", async () => {
			const { composeCommitMessage } = await import("../../src/core/completion/commit-message-composer.js");
			const result = await composeCommitMessage(
				makeFacts(),
				{ "Pi-Plan": "P44.5", "Pi-Workspace": "P44.5.06" },
				async () => {
					await new Promise((r) => setTimeout(r, 20));
					return null;
				},
			);
			expect(result.usedFallback).toBe(true);
		});

		it("should fallback when LLM produces invalid message", async () => {
			const { composeCommitMessage } = await import("../../src/core/completion/commit-message-composer.js");
			const result = await composeCommitMessage(
				makeFacts(),
				{ "Pi-Plan": "P44.5", "Pi-Workspace": "P44.5.06" },
				async () => "invalid message without format",
			);
			expect(result.usedFallback).toBe(true);
		});

		it("should handle missing runtime fact packet", async () => {
			const { composeCommitMessage } = await import("../../src/core/completion/commit-message-composer.js");
			const result = await composeCommitMessage(null as unknown as RuntimeFactPacket, {});
			expect(result.error).toBeDefined();
			expect(result.error).toContain("missing");
		});
	});
});

// ---------------------------------------------------------------------------
// CommitTrailerBuilder Tests
// ---------------------------------------------------------------------------

describe("CommitTrailerBuilder", () => {
	describe("buildCommitTrailers", () => {
		it("should build all required trailers", () => {
			const identity = createGitActorIdentity("P44.5", "P44.5.07");
			const trailers = buildCommitTrailers({
				planId: "P44.5",
				workspaceId: "P44.5.07",
				agentId: "pi-agent",
				identity,
				completionGateVersion: "vNext",
				commitDurability: "W3_identity",
				validation: "CMD-TYPECHECK-TSGO_passed",
			});

			expect(trailers["Pi-Plan"]).toBe("P44.5");
			expect(trailers["Pi-Workspace"]).toBe("P44.5.07");
			expect(trailers["Pi-Agent"]).toBe("pi-agent");
			expect(trailers["Pi-Completion-Gate"]).toBe("vNext");
			expect(trailers["Pi-Commit-Durability"]).toBe("W3_identity");
			expect(trailers["Pi-Validation"]).toBe("CMD-TYPECHECK-TSGO_passed");
			expect(trailers["Pi-Generated-By"]).toContain("@local.invalid");
		});

		it("should use default values when not specified", () => {
			const identity = createGitActorIdentity("P44.5", "P44.5.07");
			const trailers = buildCommitTrailers({
				planId: "P44.5",
				workspaceId: "P44.5.07",
				agentId: "pi-agent",
				identity,
			});

			expect(trailers["Pi-Completion-Gate"]).toBe("vNext");
			expect(trailers["Pi-Commit-Durability"]).toBe("durable");
		});
	});

	describe("validateRequiredTrailers", () => {
		it("should pass when all required trailers are present", () => {
			const result = validateRequiredTrailers({ "Pi-Plan": "P44.5", "Pi-Workspace": "W1", "Pi-Agent": "pi-agent" }, [
				"Pi-Plan",
				"Pi-Workspace",
				"Pi-Agent",
			]);
			expect(result.valid).toBe(true);
			expect(result.missing).toEqual([]);
		});

		it("should report missing trailers", () => {
			const result = validateRequiredTrailers({ "Pi-Plan": "P44.5" }, ["Pi-Plan", "Pi-Workspace", "Pi-Agent"]);
			expect(result.valid).toBe(false);
			expect(result.missing).toEqual(["Pi-Workspace", "Pi-Agent"]);
		});
	});

	describe("formatTrailers", () => {
		it("should format trailers as key-value lines", () => {
			const result = formatTrailers({ "Pi-Plan": "P44.5", "Pi-Workspace": "W1" });
			expect(result).toContain("Pi-Plan: P44.5");
			expect(result).toContain("Pi-Workspace: W1");
		});
	});
});

// ---------------------------------------------------------------------------
// GitActorIdentity Tests
// ---------------------------------------------------------------------------

describe("GitActorIdentity", () => {
	describe("createGitActorIdentity", () => {
		it("should create identity with correct user name and email", () => {
			const identity = createGitActorIdentity("P44.5", "P44.5.07");
			expect(identity.userName).toContain("Pi Agent");
			expect(identity.userName).toContain("P44.5.07");
			expect(identity.userEmail).toContain("@local.invalid");
			expect(identity.userEmail).toContain("P44.5.P44.5.07");
		});

		it("should use custom agent ID", () => {
			const identity = createGitActorIdentity("P44.5", "W1", {
				agentId: "custom-agent",
			});
			expect(identity.userEmail).toContain("custom-agent");
		});
	});

	describe("formatGitIdentityArgs", () => {
		it("should format as -c user.name and -c user.email pairs", () => {
			const identity = createGitActorIdentity("P44.5", "P44.5.07");
			const args = formatGitIdentityArgs(identity);
			expect(args).toContain("-c");
			expect(args.some((a) => a.includes("user.name"))).toBe(true);
			expect(args.some((a) => a.includes("user.email"))).toBe(true);
		});
	});
});
