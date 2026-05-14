/**
 * Tests for the Validation Planner (P5.5.F).
 *
 * Acceptance criteria:
 * 1. Planner chooses targeted validation based on changed files
 * 2. Full validation remains when required by targetCommand/risk
 * 3. Watch mode commands are rejected
 * 4. Validation lock wraps heavy commands
 * 5. Validation planner tests pass
 */

import { describe, expect, it } from "vitest";
import { isValidationCommand } from "../src/core/validation-lock.js";
import type { Workspace } from "../src/core/workspace-schema.js";
import {
	type ChangedFile,
	planContainsWatchMode,
	planValidation,
	rejectWatchMode,
	type ValidationPlan,
} from "../src/validation/validation-planner.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal workspace factory. */
function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "test-workspace",
		title: "Test Workspace",
		dependencies: [],
		roleBudget: "worker",
		maxRetries: 3,
		...overrides,
	};
}

/** No changed files. */
const NO_CHANGES: ChangedFile[] = [];

/** A single test file change. */
const TEST_FILE_CHANGE: ChangedFile[] = [{ path: "src/foo.test.ts", status: "modified" }];

/** A source file change. */
const SOURCE_FILE_CHANGE: ChangedFile[] = [{ path: "src/bar.ts", status: "modified" }];

/** Multiple mixed changed files. */
const MIXED_CHANGES: ChangedFile[] = [
	{ path: "src/foo.test.ts", status: "modified" },
	{ path: "src/bar.ts", status: "modified" },
	{ path: "src/baz.spec.ts", status: "added" },
	{ path: "src/utils/helper.ts", status: "modified" },
];

// ---------------------------------------------------------------------------
// 1. Targeted validation based on changed files
// ---------------------------------------------------------------------------

describe("targeted validation based on changed files", () => {
	it("returns targeted commands when test files are changed", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.scope).toBe("targeted");
		expect(plan.commands.length).toBeGreaterThan(0);
		expect(plan.commands[0].command).toBe("vitest --run src/foo.test.ts");
		expect(plan.reason).toContain("targeted validation");
	});

	it("returns targeted commands for spec files", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [{ path: "src/bar.spec.ts", status: "modified" }],
		});

		expect(plan.scope).toBe("targeted");
		expect(plan.commands[0].command).toBe("vitest --run src/bar.spec.ts");
	});

	it("returns targeted commands for __tests__ directory changes", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [{ path: "__tests__/integration.test.ts", status: "modified" }],
		});

		expect(plan.scope).toBe("targeted");
		expect(plan.commands[0].command).toBe("vitest --run __tests__/integration.test.ts");
	});

	it("derives test commands from changed source files", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: SOURCE_FILE_CHANGE,
		});

		expect(plan.scope).toBe("targeted");
		// Should derive test file from src/bar.ts -> src/bar.test.ts
		expect(plan.commands.some((c) => c.command === "vitest --run src/bar.test.ts")).toBe(true);
	});

	it("handles mixed changes (test + source files)", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: MIXED_CHANGES,
		});

		expect(plan.scope).toBe("targeted");
		expect(plan.commands.length).toBeGreaterThanOrEqual(4);

		// Should include all direct test file commands
		expect(plan.commands.some((c) => c.command === "vitest --run src/foo.test.ts")).toBe(true);
		expect(plan.commands.some((c) => c.command === "vitest --run src/baz.spec.ts")).toBe(true);

		// Should include derived test commands for source files
		expect(plan.commands.some((c) => c.command === "vitest --run src/bar.test.ts")).toBe(true);
		expect(plan.commands.some((c) => c.command === "vitest --run src/utils/helper.test.ts")).toBe(true);
	});

	it("deduplicates identical commands from multiple changes", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [
				{ path: "src/util.test.ts", status: "modified" },
				{ path: "src/util.ts", status: "modified" },
			],
		});

		// Both the direct test file and the derived from source file would produce
		// "vitest --run src/util.test.ts" — should only appear once
		const utilTestCommands = plan.commands.filter((c) => c.command === "vitest --run src/util.test.ts");
		expect(utilTestCommands.length).toBe(1);
	});

	it("does not derive targeted commands from deleted test files", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [
				{ path: "src/deleted.test.ts", status: "deleted" },
				{ path: "src/other.ts", status: "modified" },
			],
		});

		// Should NOT include a command for the deleted test file
		expect(plan.commands.some((c) => c.command === "vitest --run src/deleted.test.ts")).toBe(false);
		// But SHOULD derive from the modified source file
		expect(plan.commands.some((c) => c.command === "vitest --run src/other.test.ts")).toBe(true);
	});

	it("falls back to full validation when no targeted commands can be derived", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [{ path: "README.md", status: "modified" }],
		});

		expect(plan.scope).toBe("full");
		expect(plan.commands.length).toBe(1);
		expect(plan.commands[0].command).toBe("npm test && npm run typecheck");
	});

	it("falls back to full validation when no files changed", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: NO_CHANGES,
		});

		expect(plan.scope).toBe("full");
		expect(plan.commands.length).toBe(1);
	});

	it("skips targeted validation when preferTargeted is false", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: TEST_FILE_CHANGE,
			preferTargeted: false,
		});

		expect(plan.scope).toBe("full");
		expect(plan.commands[0].command).toBe("npm test && npm run typecheck");
	});
});

// ---------------------------------------------------------------------------
// 2. Full validation when required by targetCommand / risk
// ---------------------------------------------------------------------------

describe("full validation when required by targetCommand / risk", () => {
	it("uses targetCommand when defined on workspace", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm run typecheck" }),
			changedFiles: TEST_FILE_CHANGE, // Even with test changes
		});

		expect(plan.scope).toBe("full");
		expect(plan.fromTargetCommand).toBe(true);
		expect(plan.commands.length).toBe(1);
		expect(plan.commands[0].command).toBe("npm run typecheck");
		expect(plan.reason).toContain("targetCommand");
	});

	it("uses targetCommand regardless of risk level", () => {
		const plan = planValidation({
			workspace: makeWorkspace({
				targetCommand: "npm test",
				riskLevel: "high",
			}),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.scope).toBe("full");
		expect(plan.fromTargetCommand).toBe(true);
		expect(plan.commands[0].command).toBe("npm test");
		// targetCommand takes priority over risk level
		expect(plan.reason).toContain("targetCommand");
	});

	it("uses targetCommand even with changed files", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm run typecheck && npm test" }),
			changedFiles: MIXED_CHANGES,
		});

		expect(plan.scope).toBe("full");
		expect(plan.fromTargetCommand).toBe(true);
		expect(plan.commands[0].command).toBe("npm run typecheck && npm test");
	});

	it("uses full validation for high-risk workspace", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ riskLevel: "high" }),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.scope).toBe("full");
		expect(plan.fromTargetCommand).toBe(false);
		expect(plan.commands[0].command).toBe("npm test && npm run typecheck");
		expect(plan.reason).toContain("high risk");
	});

	it("uses full validation for high-risk workspace even with targeted changes", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ riskLevel: "high" }),
			changedFiles: MIXED_CHANGES,
		});

		expect(plan.scope).toBe("full");
		expect(plan.commands[0].command).toBe("npm test && npm run typecheck");
	});

	it("uses full validation for high-risk workspace when preferTargeted is true", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ riskLevel: "high" }),
			changedFiles: TEST_FILE_CHANGE,
			preferTargeted: true,
		});

		expect(plan.scope).toBe("full"); // Risk overrides targeted preference
	});

	it("uses custom defaultValidationCommand for high-risk workspace", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ riskLevel: "high" }),
			changedFiles: TEST_FILE_CHANGE,
			defaultValidationCommand: "npm run typecheck",
		});

		expect(plan.commands[0].command).toBe("npm run typecheck");
	});

	it("uses medium-risk workspace for targeted validation", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ riskLevel: "medium" }),
			changedFiles: TEST_FILE_CHANGE,
		});

		// Medium risk should allow targeted validation
		expect(plan.scope).toBe("targeted");
	});

	it("uses no-risk workspace for targeted validation", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ riskLevel: "low" }),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.scope).toBe("targeted");
	});

	it("uses undefined risk workspace for targeted validation", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ riskLevel: undefined }),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.scope).toBe("targeted");
	});
});

// ---------------------------------------------------------------------------
// 3. Watch mode commands are rejected
// ---------------------------------------------------------------------------

describe("watch mode commands rejected", () => {
	it("detects watch-mode in targetCommand", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "vitest --watch" }),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.watchModeRejected).toBe(true);
		expect(plan.watchModeAlternative).toBe("vitest run");
		expect(plan.fromTargetCommand).toBe(true);
	});

	it("detects watch-mode: vitest watchAll", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "vitest --watchAll" }),
			changedFiles: NO_CHANGES,
		});

		expect(plan.watchModeRejected).toBe(true);
		expect(plan.watchModeAlternative).toBe("vitest run");
	});

	it("detects watch-mode: npm test -- --watch", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm test -- --watch" }),
			changedFiles: MIXED_CHANGES,
		});

		expect(plan.watchModeRejected).toBe(true);
		expect(plan.watchModeAlternative).toBe("npm test -- --run");
	});

	it("detects watch-mode: npm run dev", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm run dev" }),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.watchModeRejected).toBe(true);
		expect(plan.watchModeAlternative).toBe("npm run build");
	});

	it("detects watch-mode: jest --watch", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "jest --watch" }),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.watchModeRejected).toBe(true);
		expect(plan.watchModeAlternative).toBe("jest --ci");
	});

	it("reports not a watch-mode command when normal command is used", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm test" }),
			changedFiles: NO_CHANGES,
		});

		expect(plan.watchModeRejected).toBe(false);
		expect(plan.watchModeAlternative).toBeNull();
	});

	it("reports not a watch-mode command when no targetCommand", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.watchModeRejected).toBe(false);
		expect(plan.watchModeAlternative).toBeNull();
	});

	it("rejectWatchMode returns same plan if no watch-mode commands", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm test" }),
			changedFiles: NO_CHANGES,
		});

		const rejected = rejectWatchMode(plan);
		expect(rejected).toBe(plan); // Same reference
		expect(rejected.commands.length).toBe(1);
	});

	it("rejectWatchMode returns plan with empty commands when watch-mode detected", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "vitest --watch" }),
			changedFiles: NO_CHANGES,
		});

		const rejected = rejectWatchMode(plan);
		expect(rejected.watchModeRejected).toBe(true);
		expect(rejected.commands.length).toBe(0);
		expect(rejected.scope).toBe("none");
		expect(rejected.watchModeAlternative).toBe("vitest run");
	});

	it("rejectWatchMode includes alternative in reason when available", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "vitest --watch" }),
			changedFiles: NO_CHANGES,
		});

		const rejected = rejectWatchMode(plan);
		expect(rejected.reason).toContain("vitest run");
		expect(rejected.reason).toContain("suggested alternative");
	});

	it("rejectWatchMode reports no alternative when none available", () => {
		// Note: all current patterns have alternatives, but test the fallback
		// by creating a plan with an unknown watch-mode command
		const plan: ValidationPlan = {
			commands: [{ command: "unknown-watch --watch", useValidationLock: true }],
			scope: "full",
			reason: "test",
			watchModeRejected: false,
			watchModeAlternative: null,
			fromTargetCommand: false,
		};

		const rejected = rejectWatchMode(plan);
		// unknown-watch --watch is not recognized by our patterns, so it's not rejected
		expect(rejected.commands.length).toBe(1);
	});

	it("planContainsWatchMode detects watch mode in plan", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "vitest --watch" }),
			changedFiles: NO_CHANGES,
		});

		expect(planContainsWatchMode(plan)).toBe(true);
	});

	it("planContainsWatchMode returns false for valid commands", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm test" }),
			changedFiles: NO_CHANGES,
		});

		expect(planContainsWatchMode(plan)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 4. Validation lock wraps heavy commands
// ---------------------------------------------------------------------------

describe("validation lock wraps heavy commands", () => {
	it("all commands use validation lock by default", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: TEST_FILE_CHANGE,
		});

		for (const c of plan.commands) {
			expect(c.useValidationLock).toBe(true);
		}
	});

	it("targeted commands use validation lock", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.scope).toBe("targeted");
		for (const c of plan.commands) {
			expect(c.useValidationLock).toBe(true);
		}
	});

	it("full fallback commands use validation lock", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: NO_CHANGES,
		});

		expect(plan.commands[0].useValidationLock).toBe(true);
	});

	it("targetCommand commands use validation lock", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm run typecheck" }),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.commands[0].useValidationLock).toBe(true);
	});

	it("high-risk commands use validation lock", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ riskLevel: "high" }),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.commands[0].useValidationLock).toBe(true);
	});

	it("generated commands are recognized as validation commands", () => {
		// All vitest and npm test commands should be recognized
		const plan1 = planValidation({
			workspace: makeWorkspace(),
			changedFiles: TEST_FILE_CHANGE,
		});

		for (const c of plan1.commands) {
			expect(isValidationCommand(c.command)).toBe(true);
		}

		const plan2 = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm run typecheck" }),
			changedFiles: NO_CHANGES,
		});

		for (const c of plan2.commands) {
			expect(isValidationCommand(c.command)).toBe(true);
		}
	});

	it("validation lock integration point is properly marked", () => {
		// The useValidationLock flag exists specifically so that the
		// bash executor or plan executor can gate on it.
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm run typecheck" }),
			changedFiles: NO_CHANGES,
		});

		// Every command should have this flag
		for (const c of plan.commands) {
			expect(c).toHaveProperty("useValidationLock");
			expect(typeof c.useValidationLock).toBe("boolean");
		}
	});
});

// ---------------------------------------------------------------------------
// 5. Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	it("handles empty changedFiles array", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [],
		});

		expect(plan.scope).toBe("full");
		expect(plan.commands.length).toBe(1);
	});

	it("handles custom defaultValidationCommand", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "custom-command" }),
			changedFiles: NO_CHANGES,
			defaultValidationCommand: "npm run lint",
		});

		// targetCommand overrides defaultValidationCommand
		expect(plan.commands[0].command).toBe("custom-command");
	});

	it("uses defaultValidationCommand in fallback", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: NO_CHANGES,
			defaultValidationCommand: "npm run lint",
		});

		expect(plan.commands[0].command).toBe("npm run lint");
	});

	it("uses defaultValidationCommand for high-risk fallback", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ riskLevel: "high" }),
			changedFiles: NO_CHANGES,
			defaultValidationCommand: "npm run lint",
		});

		expect(plan.commands[0].command).toBe("npm run lint");
	});

	it("handles js/jsx test file extensions", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [
				{ path: "src/component.test.js", status: "modified" },
				{ path: "src/component.test.jsx", status: "modified" },
			],
		});

		expect(plan.commands.some((c) => c.command === "vitest --run src/component.test.js")).toBe(true);
		expect(plan.commands.some((c) => c.command === "vitest --run src/component.test.jsx")).toBe(true);
	});

	it("handles source files with .js extension", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [{ path: "src/module.js", status: "modified" }],
		});

		expect(plan.commands.some((c) => c.command === "vitest --run src/module.test.ts")).toBe(true);
	});

	it("handles source files with .jsx extension", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [{ path: "src/component.jsx", status: "modified" }],
		});

		expect(plan.commands.some((c) => c.command === "vitest --run src/component.test.ts")).toBe(true);
	});

	it("handles added test files", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [{ path: "src/new.test.ts", status: "added" }],
		});

		expect(plan.scope).toBe("targeted");
		expect(plan.commands[0].command).toBe("vitest --run src/new.test.ts");
	});

	it("fromTargetCommand is false when no targetCommand", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.fromTargetCommand).toBe(false);
	});

	it("fromTargetCommand is true when targetCommand exists", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm test" }),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.fromTargetCommand).toBe(true);
	});

	it("sets watchModeRejected to false for non-watch targetCommand", () => {
		const plan = planValidation({
			workspace: makeWorkspace({ targetCommand: "npm test" }),
			changedFiles: TEST_FILE_CHANGE,
		});

		expect(plan.commands.length).toBe(1);
		expect(plan.watchModeRejected).toBe(false);
		expect(plan.watchModeAlternative).toBeNull();
	});
});
