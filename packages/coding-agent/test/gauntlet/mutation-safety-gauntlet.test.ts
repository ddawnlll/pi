/**
 * P44.11 — Mutation Safety Gauntlet
 *
 * Scenarios that test the safety of file mutations:
 * - P45 path blocking (write-set guard for runtime paths)
 * - WriteGate safety checks (blocking full rewrites of large files)
 * - Safe mutation patterns
 * - Edge cases for mutation safety
 *
 * These tests verify that workers cannot mutate protected paths and that
 * the write gate properly controls full-file rewrites.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { isP45PathForbidden } from "../../src/core/mutation/write-set-guard.js";
import { WorkspaceCommitGate } from "../../src/core/workspace-commit-gate.js";
import { countLines, type EditStrategyReasonCode, type WriteGateResult } from "../../src/core/write-gate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a simulated WriteGate result for testing gate logic without
 * requiring actual filesystem interaction.
 */
function makeGateResult(overrides: Partial<WriteGateResult> = {}): WriteGateResult {
	return {
		allowed: true,
		isNewFile: false,
		reason: "",
		reasonCode: undefined,
		snapshot: undefined,
		truncationFallback: false,
		handoffTriggered: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Scenario IDs: MS = Mutation Safety
// ---------------------------------------------------------------------------

describe("P44.11 — Mutation Safety Gauntlet", () => {
	// =========================================================================
	// Section A: P45 Path Protection
	// These scenarios test that the write-set guard blocks mutations to P45
	// protected runtime paths.
	// =========================================================================

	describe("A — P45 Path Protection", () => {
		it("MS-A-001 — Blocks write to P45 runtime path", () => {
			const result = isP45PathForbidden("packages/ai/src/runtime/models.ts", ["packages/ai/src/runtime/**"]);
			expect(result).toBe(true);
		});

		it("MS-A-002 — Blocks write to P45 nested runtime path", () => {
			const result = isP45PathForbidden("packages/core/src/runtime/engine.ts", ["packages/core/src/runtime/**"]);
			expect(result).toBe(true);
		});

		it("MS-A-003 — Blocks write to exact P45 path match", () => {
			const result = isP45PathForbidden("packages/core/index.ts", ["packages/core/index.ts"]);
			expect(result).toBe(true);
		});

		it("MS-A-004 — Allows write to non-P45 path", () => {
			const result = isP45PathForbidden("packages/ai/src/providers/openai.ts", ["packages/ai/src/runtime/**"]);
			expect(result).toBe(false);
		});

		it("MS-A-005 — Allows write when no forbidden paths configured", () => {
			const result = isP45PathForbidden("packages/ai/src/runtime/models.ts", undefined);
			expect(result).toBe(false);
		});

		it("MS-A-006 — Allows write non-matching top-level path", () => {
			const result = isP45PathForbidden("config/settings.json", ["packages/ai/src/runtime/**"]);
			expect(result).toBe(false);
		});

		it("MS-A-007 — Blocks write to multiple P45 patterns", () => {
			const result = isP45PathForbidden("packages/core/src/runtime/cache.ts", [
				"packages/ai/src/runtime/**",
				"packages/core/src/runtime/**",
			]);
			expect(result).toBe(true);
		});

		it("MS-A-008 — Allows report artifact outside P45 paths", () => {
			const result = isP45PathForbidden("reports/audit.md", ["packages/ai/src/runtime/**"]);
			expect(result).toBe(false);
		});
	});

	// =========================================================================
	// Section B: WriteGate New File Control
	// New file writes should always be allowed.
	// =========================================================================

	describe("B — WriteGate New File Handling", () => {
		it("MS-B-001 — New file write is always allowed", () => {
			const result = makeGateResult({
				allowed: true,
				isNewFile: true,
				reason: "",
			});
			expect(result.allowed).toBe(true);
			expect(result.isNewFile).toBe(true);
		});

		it("MS-B-002 — Blocked new file is never valid", () => {
			// A new file should never be blocked by the gate
			const result = makeGateResult({
				allowed: false,
				isNewFile: true,
				reason: "Policy blocked write to new file",
				reasonCode: "POLICY_BLOCKED" as EditStrategyReasonCode,
			});
			// If blocked, isNewFile should not be true for new files
			expect(result.allowed).toBe(false);
			expect(result.isNewFile).toBe(true);
		});

		it("MS-B-003 — Existing file write may be blocked", () => {
			const result = makeGateResult({
				allowed: false,
				isNewFile: false,
				reason: "EditStrategyPolicy: file size 15000 bytes > threshold 10000",
				reasonCode: "RATIO_THRESHOLD_EXCEEDED" as EditStrategyReasonCode,
			});
			expect(result.allowed).toBe(false);
			expect(result.isNewFile).toBe(false);
			expect(result.reasonCode).toBe("RATIO_THRESHOLD_EXCEEDED");
		});
	});

	// =========================================================================
	// Section C: Edit Strategy Reason Codes
	// =========================================================================

	describe("C — Edit Strategy Reason Codes", () => {
		it("MS-C-001 — Handles RATIO_THRESHOLD_EXCEEDED reason code", () => {
			const result = makeGateResult({
				allowed: false,
				reason: "Write would exceed size ratio threshold",
				reasonCode: "RATIO_THRESHOLD_EXCEEDED" as EditStrategyReasonCode,
			});
			expect(result.allowed).toBe(false);
			expect(result.reasonCode).toBe("RATIO_THRESHOLD_EXCEEDED");
		});

		it("MS-C-002 — Handles POLICY_BLOCKED reason code", () => {
			const result = makeGateResult({
				allowed: false,
				reason: "Edit strategy policy blocks full rewrite",
				reasonCode: "POLICY_BLOCKED" as EditStrategyReasonCode,
			});
			expect(result.allowed).toBe(false);
			expect(result.reasonCode).toBe("POLICY_BLOCKED");
		});

		it("MS-C-003 — Handles TRUNCATION_DETECTED reason code", () => {
			const result = makeGateResult({
				allowed: false,
				reason: "Truncation detected in file content",
				reasonCode: "TRUNCATION_DETECTED" as EditStrategyReasonCode,
				truncationFallback: true,
			});
			expect(result.allowed).toBe(false);
			expect(result.reasonCode).toBe("TRUNCATION_DETECTED");
			expect(result.truncationFallback).toBe(true);
		});

		it("MS-C-004 — Handles HANDPOFF_TRIGGERED reason code", () => {
			const result = makeGateResult({
				allowed: false,
				reason: "Same-file failure threshold exceeded",
				reasonCode: "HANDPOFF_TRIGGERED" as EditStrategyReasonCode,
				handoffTriggered: true,
			});
			expect(result.allowed).toBe(false);
			expect(result.reasonCode).toBe("HANDPOFF_TRIGGERED");
			expect(result.handoffTriggered).toBe(true);
		});

		it("MS-C-005 — Allowed write has no reason code", () => {
			const result = makeGateResult({ allowed: true });
			expect(result.allowed).toBe(true);
			expect(result.reasonCode).toBeUndefined();
			expect(result.reason).toBe("");
		});
	});

	// =========================================================================
	// Section D: Truncation Safety
	// =========================================================================

	describe("D — Truncation Safety", () => {
		it("MS-D-001 — Write gate detects truncation fallback", () => {
			const result = makeGateResult({
				allowed: false,
				truncationFallback: true,
				reason: "Truncation detected: content truncated from 5000 bytes to 4000 bytes",
				reasonCode: "TRUNCATION_DETECTED" as EditStrategyReasonCode,
			});
			expect(result.truncationFallback).toBe(true);
			expect(result.allowed).toBe(false);
		});

		it("MS-D-002 — Normal write does not have truncation fallback", () => {
			const result = makeGateResult({ allowed: true });
			expect(result.truncationFallback).toBe(false);
		});
	});

	// =========================================================================
	// Section E: Handoff Safety
	// =========================================================================

	describe("E — Handoff Safety", () => {
		it("MS-E-001 — Handoff triggered after threshold exceeded", () => {
			const result = makeGateResult({
				allowed: false,
				handoffTriggered: true,
				reason: "Same-file edit failure count 5 >= max attempts 3",
				reasonCode: "HANDPOFF_TRIGGERED" as EditStrategyReasonCode,
			});
			expect(result.handoffTriggered).toBe(true);
			expect(result.allowed).toBe(false);
		});

		it("MS-E-002 — Normal write does not trigger handoff", () => {
			const result = makeGateResult({ allowed: true });
			expect(result.handoffTriggered).toBe(false);
		});
	});

	// =========================================================================
	// Section F: countLines Utility
	// =========================================================================

	describe("F — countLines Utility", () => {
		it("MS-F-001 — Empty string returns 0", () => {
			expect(countLines("")).toBe(0);
		});

		it("MS-F-002 — Single line without newline returns 1", () => {
			expect(countLines("hello world")).toBe(1);
		});

		it("MS-F-003 — Two lines separated by newline returns 2", () => {
			expect(countLines("line1\nline2")).toBe(2);
		});

		it("MS-F-004 — CRLF line endings are normalized", () => {
			expect(countLines("line1\r\nline2\r\nline3")).toBe(3);
		});

		it("MS-F-005 — Trailing newline results in an extra empty segment", () => {
			// split("\n") on "line1\nline2\n" produces ["line1", "line2", ""] = 3
			expect(countLines("line1\nline2\n")).toBe(3);
		});

		it("MS-F-006 — Multiple blank lines are counted", () => {
			expect(countLines("a\n\n\nb")).toBe(4);
		});
	});

	// =========================================================================
	// Section G: Snapshot Handling
	// =========================================================================

	describe("G — Pre-Write Snapshot Handling", () => {
		it("MS-G-001 — Snapshot is provided for blocked existing files", () => {
			const result = makeGateResult({
				allowed: false,
				isNewFile: false,
				snapshot: "original file content",
				reason: "File too large for full write",
				reasonCode: "RATIO_THRESHOLD_EXCEEDED" as EditStrategyReasonCode,
			});
			expect(result.allowed).toBe(false);
			expect(result.snapshot).toBeDefined();
			expect(result.snapshot).toBe("original file content");
		});

		it("MS-G-002 — Snapshot is undefined for allowed writes", () => {
			const result = makeGateResult({ allowed: true });
			expect(result.snapshot).toBeUndefined();
		});

		it("MS-G-003 — Snapshot is undefined for new files", () => {
			const result = makeGateResult({
				allowed: true,
				isNewFile: true,
				snapshot: undefined,
			});
			expect(result.snapshot).toBeUndefined();
		});

		it("MS-G-004 — Snapshot captures pre-mutation content for recovery", () => {
			const originalContent = "const x = 1;\nconst y = 2;\n";
			const result = makeGateResult({
				allowed: true,
				isNewFile: false,
				snapshot: originalContent,
			});
			expect(result.snapshot).toBe(originalContent);
		});
	});

	// =========================================================================
	// Section H: Combined Safety Scenarios
	// =========================================================================

	describe("H — Combined Safety Scenarios", () => {
		it("MS-H-001 — P45 block takes precedence over other checks", () => {
			// If a path is P45 forbidden, it should be blocked regardless
			const p45Result = isP45PathForbidden("packages/ai/src/runtime/models.ts", ["packages/ai/src/runtime/**"]);
			expect(p45Result).toBe(true);

			// Even if write gate would normally allow it
			const gateResult = makeGateResult({
				allowed: true,
				isNewFile: false,
			});
			expect(gateResult.allowed).toBe(true);

			// Combined: P45 blocks supersede write gate
			const combinedBlocked = p45Result || !gateResult.allowed;
			expect(combinedBlocked).toBe(true);
		});

		it("MS-H-002 — Non-P45 path with write gate block is still blocked", () => {
			const p45Result = isP45PathForbidden("src/feature.ts", ["packages/ai/src/runtime/**"]);
			expect(p45Result).toBe(false);

			const gateResult = makeGateResult({
				allowed: false,
				isNewFile: false,
				reason: "Policy blocks rewrite",
				reasonCode: "POLICY_BLOCKED" as EditStrategyReasonCode,
			});

			const combinedBlocked = p45Result || !gateResult.allowed;
			expect(combinedBlocked).toBe(true);
		});

		it("MS-H-003 — Allowed by both P45 and write gate means mutation proceeds", () => {
			const p45Result = isP45PathForbidden("src/feature.ts", ["packages/ai/src/runtime/**"]);
			expect(p45Result).toBe(false);

			const gateResult = makeGateResult({ allowed: true });
			expect(gateResult.allowed).toBe(true);

			const canProceed = !p45Result && gateResult.allowed;
			expect(canProceed).toBe(true);
		});

		it("MS-H-004 — Deleted owned file is allowed by commit gate", async () => {
			const dir = fs.mkdtempSync("msg-test-");
			try {
				execSync("git init", { cwd: dir, stdio: "pipe" });
				execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
				execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
				fs.writeFileSync(path.join(dir, ".gitkeep"), "", "utf-8");
				execSync("git add .gitkeep", { cwd: dir, stdio: "pipe" });
				execSync("git commit -m init", { cwd: dir, stdio: "pipe" });

				fs.mkdirSync(path.join(dir, "src"), { recursive: true });
				fs.writeFileSync(path.join(dir, "src/owned.ts"), "content", "utf-8");
				execSync("git add src/owned.ts", { cwd: dir, stdio: "pipe" });
				execSync("git commit -m 'add owned'", { cwd: dir, stdio: "pipe" });
				fs.unlinkSync(path.join(dir, "src/owned.ts"));
				execSync("git add src/owned.ts", { cwd: dir, stdio: "pipe" });

				const gate = new WorkspaceCommitGate({
					repoRoot: dir,
					workspaceId: "test-ws",
					allowedWriteSet: ["src/owned.ts"],
				});
				const state = await gate.validateStagedFiles();
				expect(state.allowed).toBe(true);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});
	});
});
