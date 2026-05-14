/**
 * Tests for the Test Impact Analyzer (P6.G - Test Impact Analysis v1).
 *
 * Acceptance Criteria:
 * 1. Analyzer maps dashboard component changes to dashboard tests/build
 * 2. Analyzer maps coding-agent core changes to coding-agent tests/typecheck
 * 3. Low confidence uses broader validation
 * 4. Test impact result is logged and visible
 * 5. Tests cover common repo areas
 */

import { describe, expect, it } from "vitest";
import type { Workspace } from "../src/core/workspace-schema.js";
import { analyzeTestImpact, formatImpactResult, logImpactResult } from "../src/validation/test-impact-analyzer.js";
import { planValidation } from "../src/validation/validation-planner.js";

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

// ---------------------------------------------------------------------------
// 1. Dashboard component changes → dashboard tests/build
// ---------------------------------------------------------------------------

describe("dashboard component changes map to dashboard build", () => {
	it("maps dashboard source changes to dashboard build command", () => {
		const result = analyzeTestImpact(["packages/web-ui/dashboard/src/components/ArtifactList.tsx"]);

		const dashboardImpact = result.components.find((c) => c.name === "dashboard");
		expect(dashboardImpact).toBeDefined();
		expect(dashboardImpact!.changedFiles).toHaveLength(1);
		expect(dashboardImpact!.buildCommands).toContain("npm --prefix packages/web-ui run build");
		expect(result.useBroaderValidation).toBe(false);
	});

	it("maps multiple dashboard file changes to a single component", () => {
		const result = analyzeTestImpact([
			"packages/web-ui/dashboard/src/hooks/useArtifacts.ts",
			"packages/web-ui/dashboard/src/components/LogTerminal.tsx",
			"packages/web-ui/dashboard/src/index.ts",
		]);

		const dashboardImpact = result.components.find((c) => c.name === "dashboard");
		expect(dashboardImpact).toBeDefined();
		expect(dashboardImpact!.changedFiles).toHaveLength(3);
		expect(dashboardImpact!.confidence).toBe(0.9);
	});

	it("dashboard changes alone do not trigger broader validation", () => {
		const result = analyzeTestImpact(["packages/web-ui/dashboard/src/components/ArtifactList.tsx"]);

		expect(result.useBroaderValidation).toBe(false);
		expect(result.overallConfidence).toBeGreaterThanOrEqual(0.7);
	});
});

// ---------------------------------------------------------------------------
// 2. Coding-agent core changes → coding-agent tests/typecheck
// ---------------------------------------------------------------------------

describe("coding-agent core changes map to tests/typecheck", () => {
	it("maps core source changes to coding-agent test and typecheck commands", () => {
		const result = analyzeTestImpact(["packages/coding-agent/src/core/workspace-schema.ts"]);

		const coreImpact = result.components.find((c) => c.name === "coding-agent-core");
		expect(coreImpact).toBeDefined();
		expect(coreImpact!.changedFiles).toHaveLength(1);
		expect(coreImpact!.buildCommands).toContain("npm --prefix packages/coding-agent run typecheck");
		expect(coreImpact!.testCommands.length).toBeGreaterThan(0);
		// Should derive test command from workspace-schema.ts → workspace-schema.test.ts
		expect(coreImpact!.testCommands.some((tc) => tc.includes("workspace-schema.test.ts"))).toBe(true);
	});

	it("maps validation source changes to coding-agent test and typecheck commands", () => {
		const result = analyzeTestImpact(["packages/coding-agent/src/validation/validation-planner.ts"]);

		const validationImpact = result.components.find((c) => c.name === "coding-agent-validation");
		expect(validationImpact).toBeDefined();
		expect(validationImpact!.changedFiles).toHaveLength(1);
		expect(validationImpact!.buildCommands).toContain("npm --prefix packages/coding-agent run typecheck");
		expect(validationImpact!.testCommands.some((tc) => tc.includes("validation-planner.test.ts"))).toBe(true);
	});

	it("maps CLI source changes to coding-agent test and typecheck commands", () => {
		const result = analyzeTestImpact(["packages/coding-agent/src/cli/args.ts"]);

		const cliImpact = result.components.find((c) => c.name === "coding-agent-cli");
		expect(cliImpact).toBeDefined();
		expect(cliImpact!.buildCommands).toContain("npm --prefix packages/coding-agent run typecheck");
		expect(cliImpact!.testCommands.some((tc) => tc.includes("args.test.ts"))).toBe(true);
	});

	it("maps test file changes directly", () => {
		const result = analyzeTestImpact(["packages/coding-agent/test/validation-planner.test.ts"]);

		const testImpact = result.components.find((c) => c.name === "coding-agent-tests");
		expect(testImpact).toBeDefined();
		expect(testImpact!.changedFiles).toHaveLength(1);
		// Test files should have a direct vitest command
		expect(testImpact!.testCommands.some((tc) => tc.includes("validation-planner.test.ts"))).toBe(true);
	});

	it("coding-agent core changes alone produce targeted validation", () => {
		const result = analyzeTestImpact(["packages/coding-agent/src/core/workspace-schema.ts"]);

		expect(result.useBroaderValidation).toBe(false);
		expect(result.overallConfidence).toBeGreaterThanOrEqual(0.7);
	});
});

// ---------------------------------------------------------------------------
// 3. Low confidence uses broader validation
// ---------------------------------------------------------------------------

describe("low confidence triggers broader validation", () => {
	it("unrecognized file paths return low confidence and broader validation", () => {
		const result = analyzeTestImpact(["some/unrecognized/path/file.ts"]);

		expect(result.useBroaderValidation).toBe(true);
		expect(result.overallConfidence).toBeLessThan(0.7);
		const unknownImpact = result.components.find((c) => c.name === "unknown");
		expect(unknownImpact).toBeDefined();
		expect(unknownImpact!.confidence).toBe(0.3);
	});

	it("mixed recognized and unrecognized files trigger broader validation", () => {
		const result = analyzeTestImpact(["packages/coding-agent/src/core/workspace-schema.ts", "some/unknown/file.ts"]);

		expect(result.useBroaderValidation).toBe(true);
		// Should have at least 2 components
		expect(result.components.length).toBeGreaterThanOrEqual(2);
	});

	it("broader validation emits full test/typecheck commands", () => {
		const result = analyzeTestImpact(["random-file.txt"]);

		expect(result.useBroaderValidation).toBe(true);
		expect(result.testCommands).toContain("npm test");
		expect(result.buildCommands).toContain("npm run typecheck");
	});

	it("all unrecognized files grouped as unknown component", () => {
		const result = analyzeTestImpact(["foo/bar.ts", "baz/qux.js", "README.md"]);

		const unknownImpact = result.components.find((c) => c.name === "unknown");
		expect(unknownImpact).toBeDefined();
		expect(unknownImpact!.changedFiles).toHaveLength(3);
	});
});

// ---------------------------------------------------------------------------
// 4. Test impact result is logged and visible
// ---------------------------------------------------------------------------

describe("test impact result is loggable and visible", () => {
	it("result contains all required fields for visibility", () => {
		const result = analyzeTestImpact([
			"packages/coding-agent/src/core/workspace-schema.ts",
			"packages/web-ui/dashboard/src/components/ArtifactList.tsx",
		]);

		// Core structural fields
		expect(result).toHaveProperty("components");
		expect(result).toHaveProperty("overallConfidence");
		expect(result).toHaveProperty("testCommands");
		expect(result).toHaveProperty("buildCommands");
		expect(result).toHaveProperty("useBroaderValidation");
		expect(result).toHaveProperty("summary");

		// Components have detail fields
		for (const ci of result.components) {
			expect(ci).toHaveProperty("name");
			expect(ci).toHaveProperty("changedFiles");
			expect(ci).toHaveProperty("testCommands");
			expect(ci).toHaveProperty("buildCommands");
			expect(ci).toHaveProperty("confidence");
		}
	});

	it("formatImpactResult produces a readable string", () => {
		const result = analyzeTestImpact(["packages/coding-agent/src/core/workspace-schema.ts"]);

		const formatted = formatImpactResult(result);
		expect(typeof formatted).toBe("string");
		expect(formatted.length).toBeGreaterThan(0);
		expect(formatted).toContain("coding-agent-core");
		expect(formatted).toContain("Overall confidence");
		expect(formatted).toContain("Targeted validation");
	});

	it("logImpactResult runs without error", () => {
		const result = analyzeTestImpact(["packages/coding-agent/src/core/workspace-schema.ts"]);

		// Should not throw
		expect(() => logImpactResult(result)).not.toThrow();
	});

	it("summary includes component name and file list", () => {
		const result = analyzeTestImpact(["packages/coding-agent/src/core/workspace-schema.ts"]);

		expect(result.summary).toContain("coding-agent-core");
		expect(result.summary).toContain("workspace-schema.ts");
	});

	it("summary with broader validation indicates reason", () => {
		const result = analyzeTestImpact(["unknown/file.ts"]);

		expect(result.summary).toContain("broader validation required");
		expect(result.summary).toContain("Low confidence");
	});

	it("empty changes produce a clean summary", () => {
		const result = analyzeTestImpact([]);

		expect(result.components).toHaveLength(0);
		expect(result.overallConfidence).toBe(1.0);
		expect(result.useBroaderValidation).toBe(false);
		expect(result.summary).toContain("No files changed");
	});
});

// ---------------------------------------------------------------------------
// 5. Tests cover common repo areas
// ---------------------------------------------------------------------------

describe("common repo areas are properly mapped", () => {
	it("maps AI package changes to ai-core", () => {
		const result = analyzeTestImpact(["packages/ai/src/providers/anthropic-messages.ts"]);

		const aiImpact = result.components.find((c) => c.name === "ai-core");
		expect(aiImpact).toBeDefined();
		expect(aiImpact!.buildCommands).toContain("npm --prefix packages/ai run typecheck");
	});

	it("maps TUI package changes to tui", () => {
		const result = analyzeTestImpact(["packages/tui/src/components/input.ts"]);

		const tuiImpact = result.components.find((c) => c.name === "tui");
		expect(tuiImpact).toBeDefined();
		expect(tuiImpact!.buildCommands).toContain("npm --prefix packages/tui run build");
	});

	it("maps Agent package changes to agent-core", () => {
		const result = analyzeTestImpact(["packages/agent/src/index.ts"]);

		const agentImpact = result.components.find((c) => c.name === "agent-core");
		expect(agentImpact).toBeDefined();
		expect(agentImpact!.buildCommands).toContain("npm --prefix packages/agent run typecheck");
	});

	it("maps Web Server changes", () => {
		const result = analyzeTestImpact(["packages/web-server/src/routes.ts"]);

		const wsImpact = result.components.find((c) => c.name === "web-server");
		expect(wsImpact).toBeDefined();
	});

	it("maps DB package changes", () => {
		const result = analyzeTestImpact(["packages/db/src/index.ts"]);

		const dbImpact = result.components.find((c) => c.name === "db");
		expect(dbImpact).toBeDefined();
	});

	it("maps web-ui core (non-dashboard) changes", () => {
		const result = analyzeTestImpact(["packages/web-ui/src/components/ChatMessage.tsx"]);

		const webUiImpact = result.components.find((c) => c.name === "web-ui-core");
		expect(webUiImpact).toBeDefined();
		expect(webUiImpact!.buildCommands).toContain("npm --prefix packages/web-ui run build");
	});

	it("handles files from multiple areas simultaneously", () => {
		const result = analyzeTestImpact([
			"packages/coding-agent/src/core/workspace-schema.ts",
			"packages/web-ui/dashboard/src/components/ArtifactList.tsx",
			"packages/ai/src/providers/anthropic-messages.ts",
			"packages/tui/src/components/input.ts",
		]);

		expect(result.components.length).toBeGreaterThanOrEqual(4);
		const names = result.components.map((c) => c.name);
		expect(names).toContain("coding-agent-core");
		expect(names).toContain("dashboard");
		expect(names).toContain("ai-core");
		expect(names).toContain("tui");
	});

	it("all-mapped areas produce targeted validation", () => {
		const result = analyzeTestImpact([
			"packages/coding-agent/src/core/workspace-schema.ts",
			"packages/web-ui/dashboard/src/components/ArtifactList.tsx",
		]);

		expect(result.useBroaderValidation).toBe(false);
		expect(result.overallConfidence).toBeGreaterThanOrEqual(0.7);
	});

	it("each component has unique build commands", () => {
		const result = analyzeTestImpact([
			"packages/coding-agent/src/core/workspace-schema.ts",
			"packages/coding-agent/src/validation/validation-planner.ts",
		]);

		// Both are coding-agent areas, build commands should be deduplicated
		const buildCmds = new Set(result.buildCommands);
		expect(buildCmds.size).toBe(result.buildCommands.length);
	});

	it("misc file in coding-agent/docs/ maps to coding-agent-general", () => {
		const result = analyzeTestImpact(["packages/coding-agent/docs/providers.md"]);

		const generalImpact = result.components.find((c) => c.name === "coding-agent-general");
		expect(generalImpact).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Integration with Validation Planner
// ---------------------------------------------------------------------------

describe("integration with validation planner", () => {
	it("planner uses test impact analyzer when useTestImpactAnalyzer is true", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [{ path: "packages/coding-agent/src/core/workspace-schema.ts", status: "modified" }],
			useTestImpactAnalyzer: true,
		});

		expect(plan.scope).toBe("targeted");
		expect(plan.commands.length).toBeGreaterThan(0);
		// Should include typecheck from the analyzer
		expect(plan.commands.some((c) => c.command.includes("typecheck"))).toBe(true);
	});

	it("planner falls back to full validation when analyzer recommends it", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [{ path: "unrecognized-file.ts", status: "modified" }],
			useTestImpactAnalyzer: true,
		});

		// Low confidence should cause fallback to full validation
		expect(plan.scope).toBe("full");
		expect(plan.commands.length).toBe(1);
		expect(plan.commands[0].command).toBe("npm test && npm run typecheck");
	});

	it("planner does not use analyzer when useTestImpactAnalyzer is false/undefined", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [{ path: "packages/coding-agent/src/core/workspace-schema.ts", status: "modified" }],
			useTestImpactAnalyzer: false,
		});

		// Without analyzer, uses the old-style derivation
		expect(plan.scope).toBe("targeted");
		expect(plan.commands.some((c) => c.command.includes("typecheck"))).toBe(false);
	});

	it("planner with analyzer and mixed files uses broader validation when needed", () => {
		const plan = planValidation({
			workspace: makeWorkspace(),
			changedFiles: [
				{ path: "packages/coding-agent/src/core/workspace-schema.ts", status: "modified" },
				{ path: "unknown-random-file.js", status: "modified" },
			],
			useTestImpactAnalyzer: true,
		});

		// Unrecognized file causes broader validation
		expect(plan.scope).toBe("full");
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	it("handles empty file list", () => {
		const result = analyzeTestImpact([]);

		expect(result.components).toHaveLength(0);
		expect(result.testCommands).toHaveLength(0);
		expect(result.buildCommands).toHaveLength(0);
		expect(result.useBroaderValidation).toBe(false);
	});

	it("handles files with unusual extensions", () => {
		const result = analyzeTestImpact([
			"packages/coding-agent/src/core/module.css",
			"packages/web-ui/dashboard/src/style.css",
		]);

		// Recognized paths, but no test derivation for CSS
		expect(result.components.length).toBe(2);
	});

	it("aggressive: no false matches for nested packages", () => {
		const result = analyzeTestImpact(["packages/ai/src/core/something.ts"]);

		// Should match ai-core, not coding-agent-core (different package)
		const aiImpact = result.components.find((c) => c.name === "ai-core");
		expect(aiImpact).toBeDefined();

		const caImpact = result.components.find((c) => c.name === "coding-agent-core");
		expect(caImpact).toBeUndefined();
	});

	it("handles dotfiles in paths", () => {
		const result = analyzeTestImpact([".pi/config.json", ".env.example"]);

		expect(result.useBroaderValidation).toBe(true);
	});

	it("handles deeply nested paths", () => {
		const result = analyzeTestImpact(["packages/coding-agent/src/core/subdir/deeply/nested/file.ts"]);

		const coreImpact = result.components.find((c) => c.name === "coding-agent-core");
		expect(coreImpact).toBeDefined();
		expect(coreImpact!.changedFiles).toHaveLength(1);
	});
});
