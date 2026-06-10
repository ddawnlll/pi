/**
 * P44.11 — Fake Complete Gauntlet
 *
 * Scenarios that test detection of fake/stub completion claims by workers.
 * Uses ForbiddenShortcutScanner to scan for patterns that indicate a worker
 * is attempting to shortcut the completion process.
 *
 * Each scenario provides a block of text (simulated worker output or code)
 * and verifies the scanner catches the forbidden shortcut.
 */

import { describe, expect, it } from "vitest";
import type { ForbiddenShortcutType } from "../../src/core/completion/forbidden-shortcut-scanner.js";
import {
	blockedByForbiddenShortcuts,
	getBlockingShortcuts,
	scanForbiddenShortcuts,
} from "../../src/core/completion/forbidden-shortcut-scanner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeCompleteScenario {
	id: string;
	description: string;
	content: string;
	expectedBlocked: boolean;
	expectedTypes: ForbiddenShortcutType[];
	/** Types that should NOT be detected */
	expectedCleanTypes?: ForbiddenShortcutType[];
}

function runScenario(scenario: FakeCompleteScenario): void {
	it(`${scenario.id} — ${scenario.description}`, () => {
		const result = scanForbiddenShortcuts(scenario.content);
		expect(result.blocked).toBe(scenario.expectedBlocked);

		if (scenario.expectedBlocked) {
			expect(blockedByForbiddenShortcuts(result)).toBe(true);
			const blocking = getBlockingShortcuts(result);
			for (const t of scenario.expectedTypes) {
				expect(blocking.some((r) => r.type === t)).toBe(true);
			}
		}

		if (scenario.expectedCleanTypes) {
			const blocking = getBlockingShortcuts(result);
			for (const t of scenario.expectedCleanTypes) {
				expect(blocking.every((r) => r.type !== t)).toBe(true);
			}
		}
	});
}

describe("P44.11 — Fake Complete Gauntlet", () => {
	// =========================================================================
	// Section A: Direct Fake Completion Markers
	// These are explicit attempts to claim completion without doing the work.
	// =========================================================================

	describe("A — Direct Fake Completion Markers", () => {
		runScenario({
			id: "FC-A-001",
			description: "[COMPLETE] marker in output blocks",
			content: `Running tests...
All tests pass.
[COMPLETE]`,
			expectedBlocked: true,
			expectedTypes: ["fake_completion"],
		});

		runScenario({
			id: "FC-A-002",
			description: "[DONE] marker in output blocks",
			content: `Implementation finished.
[DONE]
Summary: 5 files changed`,
			expectedBlocked: true,
			expectedTypes: ["fake_completion"],
		});

		runScenario({
			id: "FC-A-003",
			description: "MARK AS COMPLETE phrase blocks",
			content: `Feature implemented. Mark as COMPLETE.`,
			expectedBlocked: true,
			expectedTypes: ["fake_completion"],
		});

		runScenario({
			id: "FC-A-004",
			description: "MARK AS DONE phrase blocks",
			content: `Refactoring done. Mark as DONE.`,
			expectedBlocked: true,
			expectedTypes: ["fake_completion"],
		});

		runScenario({
			id: "FC-A-005",
			description: "COMPLETION MARKER text blocks",
			content: `// COMPLETION MARKER: workspace done`,
			expectedBlocked: true,
			expectedTypes: ["fake_completion"],
		});

		runScenario({
			id: "FC-A-006",
			description: "Line ending with # COMPLETE blocks",
			content: `This workspace is # COMPLETE`,
			expectedBlocked: true,
			expectedTypes: ["fake_completion"],
		});

		runScenario({
			id: "FC-A-007",
			description: "Normal completion output does not block",
			content: `All 42 tests pass. Implementation verified.
Coverage: 87%.
No lint errors found.`,
			expectedBlocked: false,
			expectedTypes: [],
		});

		runScenario({
			id: "FC-A-008",
			description: "The word complete in prose context is not a marker",
			content: `The implementation is now complete. All features work as expected.`,
			expectedBlocked: false,
			expectedTypes: [],
		});
	});

	// =========================================================================
	// Section B: Static Stubs / Placeholders
	// Workers leaving placeholder implementations.
	// =========================================================================

	describe("B — Static Stubs and Placeholders", () => {
		runScenario({
			id: "FC-B-001",
			description: "TODO: implement stub detected",
			content: `function processData(input: string): Result {
	// TODO: implement
	return null as any;
}`,
			expectedBlocked: true,
			expectedTypes: ["static_stub"],
		});

		runScenario({
			id: "FC-B-002",
			description: "stub implementation function detected",
			content: `// stub implementation for testing
function calculateTotal() { return 0; }`,
			expectedBlocked: true,
			expectedTypes: ["static_stub"],
		});

		runScenario({
			id: "FC-B-003",
			description: "placeholder string detected",
			content: `const config = {
	apiKey: "placeholder",
	timeout: 30000,
};`,
			expectedBlocked: true,
			expectedTypes: ["static_stub"],
		});

		runScenario({
			id: "FC-B-004",
			description: "not really implemented detected",
			content: `This is a skeleton. Not really implemented yet.`,
			expectedBlocked: true,
			expectedTypes: ["static_stub"],
		});

		runScenario({
			id: "FC-B-005",
			description: "Real implementation is not a stub",
			content: `function processData(input: string): Result {
	const parsed = JSON.parse(input);
	return { status: "ok", data: parsed };
}`,
			expectedBlocked: false,
			expectedTypes: [],
		});

		runScenario({
			id: "FC-B-006",
			description: "jackson stubbed pattern detected",
			content: `objectMapper jackson stubbed the response`,
			expectedBlocked: true,
			expectedTypes: ["static_stub"],
		});
	});

	// =========================================================================
	// Section C: Silent Pass Guards
	// Workers that silently swallow errors to pass validation.
	// =========================================================================

	describe("C — Silent Pass Guards", () => {
		runScenario({
			id: "FC-C-001",
			description: "silently skip errors detected",
			content: `try {
	runBuild();
} catch (e) {
	// silently skip errors
}`,
			expectedBlocked: true,
			expectedTypes: ["silent_pass_guard"],
		});

		runScenario({
			id: "FC-C-002",
			description: "ignore failures detected",
			content: `# CI step that ignores failures
npm test || echo "ignore failures"`,
			expectedBlocked: true,
			expectedTypes: ["silent_pass_guard"],
		});

		runScenario({
			id: "FC-C-003",
			description: "swallow exceptions detected",
			content: `// Silently swallow exceptions in production path
try { riskyOperation(); } catch { /* noop */ }`,
			expectedBlocked: true,
			expectedTypes: ["silent_pass_guard"],
		});

		runScenario({
			id: "FC-C-004",
			description: "suppress checks detected",
			content: `suppress checks - this hides validation failures`,
			expectedBlocked: true,
			expectedTypes: ["silent_pass_guard"],
		});

		runScenario({
			id: "FC-C-005",
			description: "Legitimate try/catch with error handling is not a guard",
			content: `try {
	riskyOperation();
} catch (e) {
	console.error("Operation failed:", e.message);
	throw e;
}`,
			expectedBlocked: false,
			expectedTypes: [],
		});
	});

	// =========================================================================
	// Section D: || true in Validation Commands
	// Workers that append `|| true` to hide command failures.
	// =========================================================================

	describe("D — OR-True Validation Masking", () => {
		runScenario({
			id: "FC-D-001",
			description: "|| true appended to test command",
			content: `npm test || true`,
			expectedBlocked: true,
			expectedTypes: ["or_true_validation"],
		});

		runScenario({
			id: "FC-D-002",
			description: "|| true in CI script",
			content: `run_lint || true
run_tests || true
deploy || true`,
			expectedBlocked: true,
			expectedTypes: ["or_true_validation"],
		});

		runScenario({
			id: "FC-D-003",
			description: "Legitimate OR with actual fallback is not masked",
			content: `npm test || npm run test:ci`,
			expectedBlocked: false,
			expectedTypes: [],
		});

		runScenario({
			id: "FC-D-004",
			description: "Double pipe in string is still detected",
			content: `# In the build script: run_smoke || true`,
			expectedBlocked: true,
			expectedTypes: ["or_true_validation"],
		});
	});

	// =========================================================================
	// Section E: Compound / Mixed Scenarios
	// Workers using multiple shortcut patterns simultaneously.
	// =========================================================================

	describe("E — Compound Scenarios", () => {
		runScenario({
			id: "FC-E-001",
			description: "Fake complete marker + || true",
			content: `npm test || true
[COMPLETE]`,
			expectedBlocked: true,
			expectedTypes: ["fake_completion", "or_true_validation"],
		});

		runScenario({
			id: "FC-E-002",
			description: "Stub implementation with no real fixes",
			content: `// TODO: implement proper fix
function fixBug() {
	// stub implementation - not really fixed
	return;
}`,
			expectedBlocked: true,
			expectedTypes: ["static_stub"],
		});

		runScenario({
			id: "FC-E-003",
			description: "Legitimate completion contains no shortcuts",
			content: `Implementation complete. All 142 tests pass.
Coverage increased from 72% to 85%.
No linting errors found.
Pipeline green.`,
			expectedBlocked: false,
			expectedTypes: [],
		});
	});

	// =========================================================================
	// Section F: Edge Cases
	// Boundary conditions for forbidden shortcut detection.
	// =========================================================================

	describe("F — Edge Cases", () => {
		runScenario({
			id: "FC-F-001",
			description: "Empty content does not block",
			content: "",
			expectedBlocked: false,
			expectedTypes: [],
		});

		runScenario({
			id: "FC-F-002",
			description: "Whitespace-only content does not block",
			content: "   \n  \n  ",
			expectedBlocked: false,
			expectedTypes: [],
		});

		runScenario({
			id: "FC-F-003",
			description: "Case insensitive match for COMPLETE marker",
			content: `[complete]`,
			expectedBlocked: true,
			expectedTypes: ["fake_completion"],
		});

		runScenario({
			id: "FC-F-004",
			description: "Complete in code comment is a legitimate reference",
			content: `// The complete list of dependencies:
// - lodash
// - express`,
			expectedBlocked: false,
			expectedTypes: [],
		});

		runScenario({
			id: "FC-F-005",
			description: "Scan results contain accurate schema version",
			content: `[COMPLETE]`,
			expectedBlocked: true,
			expectedTypes: ["fake_completion"],
		});

		it("FC-F-005b — Scan result includes schema version", () => {
			const result = scanForbiddenShortcuts("[COMPLETE]");
			expect(result.schemaVersion).toBe("1.0.0");
			expect(result.summary.total).toBeGreaterThan(0);
			expect(result.summary.violations).toBeGreaterThan(0);
		});

		runScenario({
			id: "FC-F-006",
			description: "skipTypes option excludes certain checks",
			content: `npm test || true
[COMPLETE]`,
			expectedBlocked: true,
			expectedTypes: ["fake_completion", "or_true_validation"],
		});

		it("FC-F-006b — skipTypes excludes specific checks", () => {
			const result = scanForbiddenShortcuts("npm test || true\n[COMPLETE]", {
				skipTypes: new Set(["or_true_validation"] as ForbiddenShortcutType[]),
			});
			// Only fake_completion should be detected
			const blocking = getBlockingShortcuts(result);
			expect(blocking.some((r) => r.type === "fake_completion")).toBe(true);
			expect(blocking.some((r) => r.type === "or_true_validation")).toBe(false);
		});
	});

	// =========================================================================
	// Section G: Positive Control
	// Verify that output from a known-good completion does not trigger.
	// =========================================================================

	describe("G — Positive Controls", () => {
		runScenario({
			id: "FC-G-001",
			description: "Clean output with test results",
			content: `✓ src/feature.ts (5.2kb)
✓ src/utils.ts (1.1kb)
✓ tests/feature.test.ts (3.4kb)
PASS tests/feature.test.ts (42 tests)
PASS tests/utils.test.ts (18 tests)

Tests: 60 passed, 60 total
Time: 2.3s`,
			expectedBlocked: false,
			expectedTypes: [],
		});

		runScenario({
			id: "FC-G-002",
			description: "Clean output with build artifacts",
			content: `Building project...
✓ Build successful
✓ Lint passed
✓ Type check passed

Output:
dist/bundle.js (2.1MB)`,
			expectedBlocked: false,
			expectedTypes: [],
		});

		runScenario({
			id: "FC-G-003",
			description: "Worker echo with qualified completion report",
			content: `WORKER COMPLETION REPORT
ID: worker-1
Workspace: P44.11
Verdict: PASS
Criteria satisfied: 12/12
Evidence entries: 15
Mutations: 3 files created, 2 files modified
Summary: All acceptance criteria satisfied.`,
			expectedBlocked: false,
			expectedTypes: [],
		});
	});
});
