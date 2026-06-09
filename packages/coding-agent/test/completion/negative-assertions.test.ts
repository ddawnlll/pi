/**
 * Unit tests for Negative Assertion Scanner (P44.05).
 *
 * Covers:
 * - Grep negative check passes/fails
 * - Forbidden shortcut detection (fake/stub, || true, git add . / -A)
 * - Evidence ledger integration
 * - Machine-readable JSON output
 */

import { describe, expect, it } from "vitest";
import {
	blockedByForbiddenShortcuts,
	type ForbiddenShortcutScanResult,
	forbiddenShortcutScanFromJson,
	forbiddenShortcutScanToJson,
	forbiddenShortcutsToEvidenceEntries,
	forbiddenShortcutToEvidenceEntry,
	getBlockingShortcuts,
	scanCompletion,
	scanForbiddenShortcuts,
} from "../../src/core/completion/forbidden-shortcut-scanner.js";
import {
	checkNegativeAssertionPresent,
	DEFAULT_NEGATIVE_PATTERNS,
	grepNegativeCheck,
	type NegativeAssertionPattern,
	type NegativeAssertionResult,
	type NegativeAssertionScanResult,
	negativeAssertionScanFromJson,
	negativeAssertionScanToJson,
	negativeAssertionsToEvidenceEntries,
	negativeAssertionToEvidenceEntry,
	scanNegativeAssertions,
} from "../../src/core/completion/negative-assertions.js";

// ===========================================================================
// Negative Assertion Scanner Tests
// ===========================================================================

describe("Negative Assertion Scanner", () => {
	// -----------------------------------------------------------------------
	// grep negative check passes when pattern absent
	// -----------------------------------------------------------------------

	describe("grepNegativeCheck", () => {
		it("grep negative check passes when pattern absent", () => {
			const content = "The system shall validate all inputs before processing.";
			// 'must not' pattern should be absent
			const result = grepNegativeCheck(content, "must-not", DEFAULT_NEGATIVE_PATTERNS);
			expect(result).toBe(true);

			// Also test via scanNegativeAssertions directly
			const scanResult = scanNegativeAssertions(content);
			const mustNotResult = scanResult.results.find((r) => r.patternId === "must-not");
			expect(mustNotResult).toBeDefined();
			expect(mustNotResult!.found).toBe(false);
		});

		it("grep negative check fails when pattern present", () => {
			const content = "The system must not modify protected files without approval.";
			// 'must not' pattern should be present
			const result = grepNegativeCheck(content, "must-not", DEFAULT_NEGATIVE_PATTERNS);
			expect(result).toBe(false);

			// Also test via scanNegativeAssertions
			const scanResult = scanNegativeAssertions(content);
			const mustNotResult = scanResult.results.find((r) => r.patternId === "must-not");
			expect(mustNotResult).toBeDefined();
			expect(mustNotResult!.found).toBe(true);
			expect(mustNotResult!.match).toBe("must not");
		});

		it("should detect multiple negative patterns in same content", () => {
			const content = "The system must not fail silently. It should not proceed without validation.";
			const scanResult = scanNegativeAssertions(content);

			const mustNot = scanResult.results.find((r) => r.patternId === "must-not");
			expect(mustNot!.found).toBe(true);

			const shouldNot = scanResult.results.find((r) => r.patternId === "should-not");
			expect(shouldNot!.found).toBe(true);
		});

		it("should return pass=false when any error-severity assertion is found", () => {
			const content = "The system must not bypass the approval gate.";
			const scanResult = scanNegativeAssertions(content);
			expect(scanResult.pass).toBe(false);
			expect(scanResult.summary.violations).toBeGreaterThan(0);
		});

		it("should return pass=true when no error-severity assertions are found", () => {
			const content = "The system validates all inputs and produces correct output.";
			const scanResult = scanNegativeAssertions(content);
			expect(scanResult.pass).toBe(true);
			expect(scanResult.summary.violations).toBe(0);
		});

		it("should handle empty content gracefully", () => {
			const scanResult = scanNegativeAssertions("");
			expect(scanResult.pass).toBe(true);
			expect(scanResult.results.length).toBe(DEFAULT_NEGATIVE_PATTERNS.length);
			scanResult.results.forEach((r) => {
				expect(r.found).toBe(false);
			});
		});

		it("should use custom patterns when provided", () => {
			const customPatterns: NegativeAssertionPattern[] = [
				{ id: "custom-ban", description: "Custom forbidden word", pattern: /\bforbidden\b/i, severity: "error" },
			];
			const content = "This action is forbidden.";
			const scanResult = scanNegativeAssertions(content, { patterns: customPatterns });
			expect(scanResult.results).toHaveLength(1);
			expect(scanResult.results[0].found).toBe(true);
			expect(scanResult.pass).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Evidence ledger integration
	// -----------------------------------------------------------------------

	describe("Evidence ledger integration", () => {
		it("negative check creates evidence ledger item", () => {
			const content = "The system must not expose secrets.";
			const scanResult = scanNegativeAssertions(content);

			const entries = negativeAssertionsToEvidenceEntries(scanResult, "P44.05");

			// Should produce one entry per pattern checked
			expect(entries.length).toBe(scanResult.results.length);

			// Find the entry for the must-not violation (description contains the pattern description)
			const violationEntry = entries.find((e) => e.description.includes("must not"));
			expect(violationEntry).toBeDefined();
			expect(violationEntry!.verdict).toBe("fail");
			expect(violationEntry!.type).toBe("automated_analysis");
			expect(violationEntry!.source).toBe("negative-assertions.ts");
			expect(violationEntry!.producedBy).toBe("P44.05");
		});

		it("negative assertion pass produces pass verdict", () => {
			const content = "The system validates all inputs.";
			const scanResult = scanNegativeAssertions(content);
			const entries = negativeAssertionsToEvidenceEntries(scanResult, "P44.05");

			// All entries should have pass verdict since no assertions found
			const passEntries = entries.filter((e) => e.verdict === "pass");
			expect(passEntries.length).toBe(entries.length);
		});

		it("evidence entry has valid ID format", () => {
			const result: NegativeAssertionResult = {
				patternId: "must-not",
				description: 'Contains "must not" assertion',
				found: true,
				match: "must not",
				line: 3,
				severity: "error",
			};
			const entry = negativeAssertionToEvidenceEntry(result, "P44.05", 1);
			expect(entry.id).toMatch(/^EV-P4405-\d{3}$/);
			expect(entry.id).toBe("EV-P4405-001");
		});

		it("evidence entry has timestamp", () => {
			const result: NegativeAssertionResult = {
				patternId: "never",
				description: 'Contains "never" assertion',
				found: false,
				severity: "warning",
			};
			const entry = negativeAssertionToEvidenceEntry(result, "P44.05", 1);
			expect(entry.timestamp).toBeGreaterThan(0);
			expect(typeof entry.timestamp).toBe("number");
		});
	});

	// -----------------------------------------------------------------------
	// Machine-readable JSON
	// -----------------------------------------------------------------------

	describe("Machine-readable JSON", () => {
		it("scanner results are machine-readable JSON", () => {
			const content = "The system must not modify core components.";
			const scanResult = scanNegativeAssertions(content);

			const json = negativeAssertionScanToJson(scanResult);
			expect(typeof json).toBe("string");

			// Verify it's valid JSON
			const parsed = JSON.parse(json) as NegativeAssertionScanResult;
			expect(parsed.pass).toBe(false);
			expect(parsed.schemaVersion).toBe("1.0.0");
			expect(parsed.results.length).toBe(DEFAULT_NEGATIVE_PATTERNS.length);
			expect(parsed.summary.total).toBe(DEFAULT_NEGATIVE_PATTERNS.length);
		});

		it("can round-trip through JSON serialization", () => {
			const content = "The system should not log secrets.";
			const original = scanNegativeAssertions(content);

			const json = negativeAssertionScanToJson(original);
			const restored = negativeAssertionScanFromJson(json);

			expect(restored.pass).toBe(original.pass);
			expect(restored.schemaVersion).toBe(original.schemaVersion);
			expect(restored.summary.total).toBe(original.summary.total);
			expect(restored.summary.violations).toBe(original.summary.violations);
			expect(restored.results.length).toBe(original.results.length);

			// Verify must-not is not found (should-not pattern is present)
			const shouldNot = restored.results.find((r) => r.patternId === "should-not");
			expect(shouldNot).toBeDefined();
			expect(shouldNot!.found).toBe(true);
		});

		it("contains schema version in JSON output", () => {
			const scanResult = scanNegativeAssertions("All clear.");
			const json = negativeAssertionScanToJson(scanResult);
			expect(json).toContain("1.0.0");
			const parsed = JSON.parse(json);
			expect(parsed.schemaVersion).toBe("1.0.0");
		});

		it("contains pass/fail in JSON output", () => {
			const violating = scanNegativeAssertions("must not fail");
			const passing = scanNegativeAssertions("all good");

			const violatingJson = JSON.parse(negativeAssertionScanToJson(violating));
			const passingJson = JSON.parse(negativeAssertionScanToJson(passing));

			expect(violatingJson.pass).toBe(false);
			expect(passingJson.pass).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// checkNegativeAssertionPresent
	// -----------------------------------------------------------------------

	describe("checkNegativeAssertionPresent", () => {
		it("returns true when pattern is present", () => {
			expect(checkNegativeAssertionPresent("must not do that", "must-not")).toBe(true);
			expect(checkNegativeAssertionPresent("should not do that", "should-not")).toBe(true);
			expect(checkNegativeAssertionPresent("cannot do that", "cannot")).toBe(true);
			expect(checkNegativeAssertionPresent("never do that", "never")).toBe(true);
		});

		it("returns false when pattern is absent", () => {
			expect(checkNegativeAssertionPresent("all good here", "must-not")).toBe(false);
		});

		it("returns false for unknown pattern ID", () => {
			expect(checkNegativeAssertionPresent("anything", "nonexistent")).toBe(false);
		});
	});
});

// ===========================================================================
// Forbidden Shortcut Scanner Tests
// ===========================================================================

describe("Forbidden Shortcut Scanner", () => {
	// -----------------------------------------------------------------------
	// forbidden fake/static/stub shortcut blocks completion
	// -----------------------------------------------------------------------

	describe("Fake completion detection", () => {
		it("forbidden fake/static/stub shortcut blocks completion", () => {
			const content = `# Results
The implementation is done. [COMPLETE]`;
			const scanResult = scanForbiddenShortcuts(content);
			expect(scanResult.blocked).toBe(true);

			const fakeResult = scanResult.results.find((r) => r.type === "fake_completion");
			expect(fakeResult).toBeDefined();
			expect(fakeResult!.found).toBe(true);
			expect(fakeResult!.blocked).toBe(true);
		});

		it("detects static stub patterns", () => {
			const content = "TODO: implement the actual logic";
			const scanResult = scanForbiddenShortcuts(content);
			const stubResult = scanResult.results.find((r) => r.type === "static_stub");
			expect(stubResult).toBeDefined();
			expect(stubResult!.found).toBe(true);
			expect(stubResult!.blocked).toBe(true);
		});

		it("detects silent pass guard", () => {
			const content = "silently skip errors";
			const scanResult = scanForbiddenShortcuts(content);
			const guardResult = scanResult.results.find((r) => r.type === "silent_pass_guard");
			expect(guardResult).toBeDefined();
			expect(guardResult!.found).toBe(true);
		});

		it("fake completion blocks even alongside other patterns", () => {
			const content = `git add . && git commit -m "done" [COMPLETE]`;
			const scanResult = scanForbiddenShortcuts(content);
			expect(scanResult.blocked).toBe(true);
			// fake_completion + git_add_dot = at least 2 violations
			expect(scanResult.summary.violations).toBeGreaterThanOrEqual(2);
		});

		it("clean content has no blocking shortcuts", () => {
			const content = "npm run build && npm run test";
			const scanResult = scanForbiddenShortcuts(content);
			expect(scanResult.blocked).toBe(false);
			expect(scanResult.summary.violations).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// forbidden || true in validation command blocks completion
	// -----------------------------------------------------------------------

	describe("|| true detection", () => {
		it("forbidden `|| true` in validation command blocks completion", () => {
			const content = "npm run validate || true";
			const scanResult = scanForbiddenShortcuts(content);
			expect(scanResult.blocked).toBe(true);

			const orTrueResult = scanResult.results.find((r) => r.type === "or_true_validation");
			expect(orTrueResult).toBeDefined();
			expect(orTrueResult!.found).toBe(true);
			expect(orTrueResult!.match).toBe("|| true");
		});

		it('detects "|| true" in multi-command chains', () => {
			const content = "npm test || true && npm run build";
			const scanResult = scanForbiddenShortcuts(content);
			const orTrueResult = scanResult.results.find((r) => r.type === "or_true_validation");
			expect(orTrueResult).toBeDefined();
			expect(orTrueResult!.found).toBe(true);
		});

		it("does not flag commands without || true", () => {
			const content = "npm run validate";
			const scanResult = scanForbiddenShortcuts(content);
			const orTrueResult = scanResult.results.find((r) => r.type === "or_true_validation");
			expect(orTrueResult).toBeDefined();
			expect(orTrueResult!.found).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// forbidden git add . in worker path blocks completion
	// -----------------------------------------------------------------------

	describe("git add . detection", () => {
		it("forbidden `git add .` in worker path blocks completion", () => {
			const content = "cd /workspace && git add . && git commit -m 'done'";
			const scanResult = scanForbiddenShortcuts(content);
			expect(scanResult.blocked).toBe(true);

			const addDotResult = scanResult.results.find((r) => r.type === "git_add_dot");
			expect(addDotResult).toBeDefined();
			expect(addDotResult!.found).toBe(true);
			expect(addDotResult!.blocked).toBe(true);

			// Also check git_add_A is not mistakenly triggered for 'git add .'
			const addAResult = scanResult.results.find((r) => r.type === "git_add_A");
			expect(addAResult).toBeDefined();
			expect(addAResult!.found).toBe(false);
		});

		it("detects `git add .` as standalone command", () => {
			const content = "git add .";
			const scanResult = scanForbiddenShortcuts(content);
			const addDotResult = scanResult.results.find((r) => r.type === "git_add_dot");
			expect(addDotResult).toBeDefined();
			expect(addDotResult!.found).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// forbidden git add -A in worker path blocks completion
	// -----------------------------------------------------------------------

	describe("git add -A detection", () => {
		it("forbidden `git add -A` in worker path blocks completion", () => {
			const content = "git add -A && git commit -m 'update'";
			const scanResult = scanForbiddenShortcuts(content);
			expect(scanResult.blocked).toBe(true);

			const addAResult = scanResult.results.find((r) => r.type === "git_add_A");
			expect(addAResult).toBeDefined();
			expect(addAResult!.found).toBe(true);
			expect(addAResult!.blocked).toBe(true);
		});

		it("detects `git add --all` as alias for -A", () => {
			const content = "git add --all && git commit";
			const scanResult = scanForbiddenShortcuts(content);
			const addAResult = scanResult.results.find((r) => r.type === "git_add_A");
			expect(addAResult).toBeDefined();
			expect(addAResult!.found).toBe(true);
			expect(addAResult!.match).toMatch(/--all/);
		});

		it("detects `git commit -a` as forbidden shortcut", () => {
			const content = "git commit -a -m 'bulk update'";
			const scanResult = scanForbiddenShortcuts(content);
			const commitAResult = scanResult.results.find((r) => r.type === "git_commit_a");
			expect(commitAResult).toBeDefined();
			expect(commitAResult!.found).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Evidence ledger integration
	// -----------------------------------------------------------------------

	describe("Evidence ledger integration", () => {
		it("negative check creates evidence ledger item [via forbidden shortcut]", () => {
			const content = "git add .";
			const scanResult = scanForbiddenShortcuts(content);

			const entries = forbiddenShortcutsToEvidenceEntries(scanResult, "P44.05");

			// Should produce one entry per pattern checked
			expect(entries.length).toBe(scanResult.results.length);

			// Find the entry for the git_add_dot violation (description contains the shortcut description)
			const violationEntry = entries.find((e) => e.description.includes("git add ."));
			expect(violationEntry).toBeDefined();
			expect(violationEntry!.verdict).toBe("fail");
			expect(violationEntry!.type).toBe("security_scan");
			expect(violationEntry!.source).toBe("forbidden-shortcut-scanner.ts");
			expect(violationEntry!.producedBy).toBe("P44.05");

			// Entries for non-violations should have pass verdict
			const passEntries = entries.filter((e) => e.description.includes("not found"));
			expect(passEntries.length).toBeGreaterThan(0);
		});

		it("forbidden shortcut evidence entry has valid ID format", () => {
			const scanResult = scanForbiddenShortcuts("git add .");
			const entry = forbiddenShortcutToEvidenceEntry(scanResult.results[0], "P44.05", 1);
			expect(entry.id).toMatch(/^EV-P4405-\d{3}$/);
		});
	});

	// -----------------------------------------------------------------------
	// Machine-readable JSON
	// -----------------------------------------------------------------------

	describe("Machine-readable JSON", () => {
		it("scanner results are machine-readable JSON [forbidden shortcuts]", () => {
			const content = "npm run validate || true";
			const scanResult = scanForbiddenShortcuts(content);

			const json = forbiddenShortcutScanToJson(scanResult);
			expect(typeof json).toBe("string");

			// Verify it's valid JSON
			const parsed = JSON.parse(json) as ForbiddenShortcutScanResult;
			expect(parsed.blocked).toBe(true);
			expect(parsed.schemaVersion).toBe("1.0.0");

			const orTrueResult = parsed.results.find((r) => r.type === "or_true_validation");
			expect(orTrueResult).toBeDefined();
			expect(orTrueResult!.found).toBe(true);
		});

		it("can round-trip forbidden shortcut results through JSON", () => {
			const content = "git add -A && git commit -a -m 'update'";
			const original = scanForbiddenShortcuts(content);

			const json = forbiddenShortcutScanToJson(original);
			const restored = forbiddenShortcutScanFromJson(json);

			expect(restored.blocked).toBe(true);
			expect(restored.summary.violations).toBe(original.summary.violations);
			expect(restored.results.length).toBe(original.results.length);

			const addA = restored.results.find((r) => r.type === "git_add_A");
			expect(addA).toBeDefined();
			expect(addA!.found).toBe(true);

			const commitA = restored.results.find((r) => r.type === "git_commit_a");
			expect(commitA).toBeDefined();
			expect(commitA!.found).toBe(true);
		});

		it("contains schema version in shortcut JSON output", () => {
			const scanResult = scanForbiddenShortcuts("clean content");
			const json = forbiddenShortcutScanToJson(scanResult);
			expect(json).toContain("1.0.0");
			const parsed = JSON.parse(json);
			expect(parsed.schemaVersion).toBe("1.0.0");
		});
	});

	// -----------------------------------------------------------------------
	// Helper functions
	// -----------------------------------------------------------------------

	describe("Helper functions", () => {
		it("blockedByForbiddenShortcuts returns true when blocked", () => {
			const result = scanForbiddenShortcuts("[COMPLETE]");
			expect(blockedByForbiddenShortcuts(result)).toBe(true);
		});

		it("blockedByForbiddenShortcuts returns false when not blocked", () => {
			const result = scanForbiddenShortcuts("all clean");
			expect(blockedByForbiddenShortcuts(result)).toBe(false);
		});

		it("getBlockingShortcuts returns only blocking findings", () => {
			const result = scanForbiddenShortcuts("git add . && echo done");
			const blocking = getBlockingShortcuts(result);
			// git_add_dot should be a blocking finding
			expect(blocking.length).toBeGreaterThan(0);
			blocking.forEach((r) => {
				expect(r.blocked).toBe(true);
				expect(r.found).toBe(true);
			});
		});

		it("getBlockingShortcuts returns empty array when no violations", () => {
			const result = scanForbiddenShortcuts("npm run build");
			const blocking = getBlockingShortcuts(result);
			expect(blocking).toHaveLength(0);
		});
	});

	// -----------------------------------------------------------------------
	// Edge cases
	// -----------------------------------------------------------------------

	describe("Edge cases", () => {
		it("should handle empty content", () => {
			const result = scanForbiddenShortcuts("");
			expect(result.blocked).toBe(false);
			expect(result.summary.violations).toBe(0);
		});

		it("should skip specified types", () => {
			const content = "git add . && git add -A";
			const skipTypes = new Set(["git_add_dot"] as const);
			const result = scanForbiddenShortcuts(content, { skipTypes });
			const addDotResult = result.results.find((r) => r.type === "git_add_dot");
			expect(addDotResult).toBeUndefined();
			const addAResult = result.results.find((r) => r.type === "git_add_A");
			expect(addAResult).toBeDefined();
			expect(addAResult!.found).toBe(true);
		});

		it("should handle custom patterns", () => {
			const content = "forbidden operation detected";
			const customPatterns = [
				{ type: "custom_block", description: "Custom blocked pattern", pattern: /\bforbidden\b/i, blocked: true },
			];
			const result = scanForbiddenShortcuts(content, { customPatterns });
			expect(result.blocked).toBe(true);
			const custom = result.results[result.results.length - 1]; // custom patterns appended last
			expect(custom).toBeDefined();
			expect(custom!.found).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Combined Scanner
	// -----------------------------------------------------------------------

	describe("Combined scanCompletion", () => {
		it("should combine negative assertion and forbidden shortcut results", () => {
			const content = "must not fail. [COMPLETE]";
			const result = scanCompletion(content);
			expect(result.blocked).toBe(true);
			expect(result.negativeAssertions.pass).toBe(false);
			expect(result.forbiddenShortcuts.blocked).toBe(true);
		});

		it("should pass when content is clean", () => {
			const content = "npm run build && npm run test";
			const result = scanCompletion(content);
			expect(result.blocked).toBe(false);
			expect(result.negativeAssertions.pass).toBe(true);
		});

		it("should set blocked=true when forbidden shortcut is found but negative assertions pass", () => {
			const content = "git add . # staging changes";
			const result = scanCompletion(content);
			expect(result.blocked).toBe(true);
			expect(result.negativeAssertions.pass).toBe(true);
			const addDot = result.forbiddenShortcuts.results.find((r) => r.type === "git_add_dot");
			expect(addDot).toBeDefined();
			expect(addDot!.found).toBe(true);
		});

		it("should set blocked=false when only warnings are found", () => {
			const content = "The system should not do this (warning only)";
			const result = scanCompletion(content);
			// should-not is a warning severity, not blocking
			expect(result.blocked).toBe(false);
			expect(result.negativeAssertions.pass).toBe(true);
		});
	});
});
