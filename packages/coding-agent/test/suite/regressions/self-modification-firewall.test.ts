/**
 * Tests for the Self-Modification Firewall (P8.F)
 *
 * Acceptance Criteria:
 * 1. Protected systems are declared and enforced.
 * 2. Self-modifying proposals require explicit approval beyond normal approval.
 * 3. No autonomous execution can modify protected systems.
 */

import { describe, expect, it } from "vitest";
import {
	createSelfModificationFirewall,
	type SelfModificationReport,
} from "../../../src/core/self-modification-firewall.js";
import type { Workspace } from "../../../src/core/workspace-schema.js";

describe("SelfModificationFirewall", () => {
	const testCwd = "/Users/hootie/src/pi";

	describe("AC1: Protected systems are declared and enforced", () => {
		it("should declare built-in protected systems", () => {
			const firewall = createSelfModificationFirewall(testCwd, false);
			const systems = firewall.getProtectedSystems();

			expect(systems.length).toBeGreaterThan(0);

			// Should include pi source code protection
			const sourceSystem = systems.find((s) => s.id === "pi-source-code");
			expect(sourceSystem).toBeDefined();
			expect(sourceSystem!.patterns).toContain("packages/**/*");

			// Should include agent config protection
			const agentConfig = systems.find((s) => s.id === "pi-agent-config");
			expect(agentConfig).toBeDefined();
		});

		it("should detect protected file paths", () => {
			const firewall = createSelfModificationFirewall(testCwd, false);

			// Source code files should be protected
			const result1 = firewall.checkFilePath("packages/coding-agent/src/core/agent-session.ts");
			expect(result1.isProtected).toBe(true);
			expect(result1.matchedSystem?.id).toBe("pi-source-code");
			expect(result1.blocked).toBe(false); // Interactive mode
			expect(result1.requiresEnhancedApproval).toBe(true);

			// Agent config files should be protected
			const result2 = firewall.checkFilePath(".pi/agent/AGENTS.md");
			expect(result2.isProtected).toBe(true);
			expect(result2.matchedSystem?.id).toBe("pi-agent-config");

			// Settings files should be protected
			const result3 = firewall.checkFilePath(".pi/settings.json");
			expect(result3.isProtected).toBe(true);
			expect(result3.matchedSystem?.id).toBe("pi-settings");
		});

		it("should NOT flag non-protected files", () => {
			const firewall = createSelfModificationFirewall(testCwd, false);

			const result1 = firewall.checkFilePath("src/main.ts");
			expect(result1.isProtected).toBe(false);

			const result2 = firewall.checkFilePath("README.md");
			expect(result2.isProtected).toBe(false);

			const result3 = firewall.checkFilePath("test/fixtures/sample.ts");
			expect(result3.isProtected).toBe(false);
		});

		it("should support custom protected systems", () => {
			const firewall = createSelfModificationFirewall(testCwd, false, [
				{
					id: "custom-config",
					name: "Custom Config",
					patterns: [".custom/config.yml"],
					reason: "Custom configuration file.",
				},
			]);

			const result = firewall.checkFilePath(".custom/config.yml");
			expect(result.isProtected).toBe(true);
			expect(result.matchedSystem?.id).toBe("custom-config");
		});
	});

	describe("AC2: Self-modifying proposals require enhanced approval", () => {
		it("should flag tool calls targeting protected systems in interactive mode", () => {
			const firewall = createSelfModificationFirewall(testCwd, false);

			const report = firewall.checkToolCall("write", {
				path: "packages/coding-agent/src/core/agent-session.ts",
				content: "modified content",
			});

			expect(report.hasSelfModification).toBe(true);
			expect(report.protectedPaths.length).toBe(1);
			expect(report.affectedSystems.length).toBeGreaterThan(0);
			expect(report.anyBlocked).toBe(false);
			expect(report.summary).toContain("Enhanced approval required");
		});

		it("should flag edit tool calls targeting protected systems", () => {
			const firewall = createSelfModificationFirewall(testCwd, false);

			const report = firewall.checkToolCall("edit", {
				path: "packages/ai/src/index.ts",
				edits: [{ oldText: "foo", newText: "bar" }],
			});

			expect(report.hasSelfModification).toBe(true);
			expect(report.protectedPaths.length).toBe(1);
		});

		it("should NOT flag tool calls targeting non-protected files", () => {
			const firewall = createSelfModificationFirewall(testCwd, false);

			const report = firewall.checkToolCall("write", {
				path: "src/main.ts",
				content: "new content",
			});

			expect(report.hasSelfModification).toBe(false);
		});

		it("should flag workspaces targeting protected systems", () => {
			const firewall = createSelfModificationFirewall(testCwd, false);

			const workspace: Workspace = {
				id: "P8.F",
				title: "Implement self-modification firewall",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 2,
				capabilities: {
					canEdit: [
						"packages/coding-agent/src/core/self-modification-firewall.ts",
						"packages/coding-agent/src/core/agent-session.ts",
					],
					canRun: ["npx tsx test.ts"],
				},
			};

			const report = firewall.checkWorkspace(workspace);
			expect(report.hasSelfModification).toBe(true);
			expect(report.protectedPaths.length).toBe(2);
			expect(report.affectedSystems.length).toBeGreaterThan(0);
		});

		it("should NOT flag workspaces that don't target protected systems", () => {
			const firewall = createSelfModificationFirewall(testCwd, false);

			const workspace: Workspace = {
				id: "test",
				title: "Test workspace",
				dependencies: [],
				roleBudget: "worker",
				maxRetries: 2,
				capabilities: {
					canEdit: ["src/components/button.tsx"],
					canRun: ["npm test"],
				},
			};

			const report = firewall.checkWorkspace(workspace);
			expect(report.hasSelfModification).toBe(false);
		});

		it("should aggregate multiple workspaces", () => {
			const firewall = createSelfModificationFirewall(testCwd, false);

			const workspaces: Workspace[] = [
				{
					id: "safe",
					title: "Safe workspace",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 2,
					capabilities: {
						canEdit: ["src/main.ts"],
						canRun: ["npm test"],
					},
				},
				{
					id: "risky",
					title: "Risky workspace",
					dependencies: [],
					roleBudget: "worker",
					maxRetries: 2,
					capabilities: {
						canEdit: ["packages/coding-agent/src/core/agent-session.ts"],
						canRun: ["npm test"],
					},
				},
			];

			const report = firewall.checkWorkspaces(workspaces);
			expect(report.hasSelfModification).toBe(true);
			expect(report.protectedPaths.length).toBe(1);
		});
	});

	describe("AC3: Autonomous execution cannot modify protected systems", () => {
		it("should block modifications to protected systems in autonomous mode", () => {
			const firewall = createSelfModificationFirewall(testCwd, true);

			const result = firewall.checkFilePath("packages/coding-agent/src/core/agent-session.ts");
			expect(result.isProtected).toBe(true);
			expect(result.blocked).toBe(true);
			expect(result.requiresEnhancedApproval).toBe(false); // Blocked entirely, no approval possible

			const report = firewall.checkToolCall("write", {
				path: "packages/coding-agent/src/core/agent-session.ts",
				content: "modified content",
			});
			expect(report.hasSelfModification).toBe(true);
			expect(report.anyBlocked).toBe(true);
		});

		it("should allow non-protected files in autonomous mode", () => {
			const firewall = createSelfModificationFirewall(testCwd, true);

			const result = firewall.checkFilePath("src/main.ts");
			expect(result.isProtected).toBe(false);
			expect(result.blocked).toBe(false);
		});

		it("should generate appropriate blocked error messages in autonomous mode", () => {
			const firewall = createSelfModificationFirewall(testCwd, true);

			const report = firewall.checkToolCall("edit", {
				path: "packages/ai/src/index.ts",
				edits: [{ oldText: "foo", newText: "bar" }],
			});

			expect(report.hasSelfModification).toBe(true);
			expect(report.anyBlocked).toBe(true);

			const formatted = firewall.formatReport(report);
			expect(formatted).toContain("BLOCKED");
			expect(formatted).toContain("autonomous execution cannot modify protected systems");
		});
	});

	describe("formatReport", () => {
		it("should return empty string for non-self-modification reports", () => {
			const firewall = createSelfModificationFirewall(testCwd, false);

			const report: SelfModificationReport = {
				hasSelfModification: false,
				protectedPaths: [],
				affectedSystems: [],
				summary: "",
				anyBlocked: false,
			};

			const formatted = firewall.formatReport(report);
			expect(formatted).toBe("");
		});

		it("should include affected systems, paths, and action in interactive mode", () => {
			const firewall = createSelfModificationFirewall(testCwd, false);

			const report = firewall.checkToolCall("write", {
				path: "packages/coding-agent/src/core/agent-session.ts",
				content: "modified",
			});

			const formatted = firewall.formatReport(report);
			expect(formatted).toContain("Self-Modification Firewall");
			expect(formatted).toContain("Pi Source Code");
			expect(formatted).toContain("Enhanced approval required");
			expect(formatted).toContain("agent-session.ts");
		});
	});
});

describe("Safety Doctor integration", () => {
	it("should have SelfModification safety issue type", async () => {
		// Verify the SafetyIssueType enum includes SelfModification
		const { SafetyIssueType } = await import("../../../src/core/safety-doctor.js");
		expect(SafetyIssueType.SelfModification).toBe("self_modification");
	});
});
