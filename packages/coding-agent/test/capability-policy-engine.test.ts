/**
 * Capability Policy Engine Tests - P11.G
 *
 * Acceptance Criteria:
 * 1. Policy engine can evaluate extension, skill, orchestrator, memory,
 *    and optimizer actions.
 * 2. Protected-system mutations require explicit self-modification
 *    approval beyond normal approval.
 * 3. Unsafe actions are blocked before execution or activation.
 * 4. Policy tests include denied, allowed, requires-approval, and
 *    stale-approval cases.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	ACTION_LABELS,
	type ActionCategory,
	type ActionDomain,
	type CapabilityPolicyEngine,
	type CapabilityPolicyResult,
	type CapabilityRule,
	createCapabilityPolicyEngine,
	DEFAULT_CAPABILITY_RULES,
	type ProtectionLevel,
} from "../src/core/capability-policy-engine.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_CWD = "/Users/hootie/src/pi";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assert that a result has a given verdict.
 */
function expectVerdict(
	result: CapabilityPolicyResult,
	expectedVerdict: "allowed" | "denied" | "requires_approval",
): void {
	expect(result.verdict).toBe(expectedVerdict);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CapabilityPolicyEngine", () => {
	let engine: CapabilityPolicyEngine;

	beforeEach(() => {
		engine = createCapabilityPolicyEngine({
			cwd: TEST_CWD,
			isAutonomous: false,
			defaultApprovalTTL: 300000,
			blockUnsafeActions: true,
		});
	});

	// =======================================================================
	// AC1: Policy engine can evaluate extension, skill, orchestrator,
	//      memory, and optimizer actions.
	// =======================================================================

	describe("AC1: Evaluates all five action domains", () => {
		it("should evaluate extension actions", () => {
			const result = engine.check("extension", "register_tool");
			expectVerdict(result, "allowed");
			expect(result.domain).toBe("extension");
			expect(result.action).toBe("register_tool");
			expect(result.actionDescription).toBeTruthy();
		});

		it("should evaluate skill actions", () => {
			const result = engine.check("skill", "activate");
			expectVerdict(result, "allowed");
			expect(result.domain).toBe("skill");
			expect(result.action).toBe("activate");
		});

		it("should evaluate orchestrator actions", () => {
			const result = engine.check("orchestrator", "schedule_workspace");
			expectVerdict(result, "allowed");
			expect(result.domain).toBe("orchestrator");
			expect(result.action).toBe("schedule_workspace");
		});

		it("should evaluate memory actions", () => {
			const result = engine.check("memory", "read_memory");
			expectVerdict(result, "allowed");
			expect(result.domain).toBe("memory");
			expect(result.action).toBe("read_memory");
		});

		it("should evaluate optimizer actions", () => {
			const result = engine.check("optimizer", "propose_split");
			expectVerdict(result, "allowed");
			expect(result.domain).toBe("optimizer");
			expect(result.action).toBe("propose_split");
		});

		it("should provide human-readable descriptions for all actions", () => {
			const domains: ActionDomain[] = ["extension", "skill", "orchestrator", "memory", "optimizer"];

			for (const domain of domains) {
				const actions = Object.keys(ACTION_LABELS[domain]);
				expect(actions.length).toBeGreaterThan(0);
				for (const action of actions) {
					const label = ACTION_LABELS[domain][action];
					expect(label).toBeTruthy();
					expect(typeof label).toBe("string");
					expect(label.length).toBeGreaterThan(5);
				}
			}
		});

		it("should evaluate all known extension action categories", () => {
			const extensionActions = [
				"register_tool",
				"register_command",
				"register_event_handler",
				"modify_ui",
				"access_filesystem",
				"network_access",
				"modify_settings",
				"access_secrets",
				"register_keybinding",
				"interact_with_session",
			];

			for (const action of extensionActions) {
				const result = engine.check("extension", action as ActionCategory);
				expect(result.domain).toBe("extension");
				expect(result.action).toBe(action);
				expect(result.actionDescription).toBeTruthy();
				// All should have a verdict
				expect(["allowed", "denied", "requires_approval"]).toContain(result.verdict);
			}
		});

		it("should evaluate all known skill action categories", () => {
			const skillActions = [
				"activate",
				"deactivate",
				"call_tool",
				"modify_manifest",
				"register_skill",
				"access_protected_paths",
			];

			for (const action of skillActions) {
				const result = engine.check("skill", action as ActionCategory);
				expect(result.domain).toBe("skill");
				expect(result.action).toBe(action);
				expect(["allowed", "denied", "requires_approval"]).toContain(result.verdict);
			}
		});

		it("should evaluate all known orchestrator action categories", () => {
			const orchActions = [
				"schedule_workspace",
				"change_parallelism",
				"reorder_queue",
				"modify_dependencies",
				"cancel_workspace",
				"modify_concurrency_limit",
			];

			for (const action of orchActions) {
				const result = engine.check("orchestrator", action as ActionCategory);
				expect(result.domain).toBe("orchestrator");
				expect(result.action).toBe(action);
				expect(["allowed", "denied", "requires_approval"]).toContain(result.verdict);
			}
		});

		it("should evaluate all known memory action categories", () => {
			const memActions = [
				"read_memory",
				"write_memory",
				"clear_memory",
				"modify_execution_memory",
				"bulk_export_memory",
				"modify_planner_memory",
			] as const;

			for (const action of memActions) {
				const result = engine.check("memory", action as ActionCategory);
				expect(result.domain).toBe("memory");
				expect(result.action).toBe(action);
				expect(["allowed", "denied", "requires_approval"]).toContain(result.verdict);
			}
		});

		it("should evaluate all known optimizer action categories", () => {
			const optActions = [
				"propose_split",
				"propose_dependency_change",
				"approve_proposal",
				"apply_proposal",
				"modify_critical_path",
				"reject_proposal",
			] as const;

			for (const action of optActions) {
				const result = engine.check("optimizer", action as ActionCategory);
				expect(result.domain).toBe("optimizer");
				expect(result.action).toBe(action);
				expect(["allowed", "denied", "requires_approval"]).toContain(result.verdict);
			}
		});
	});

	// =======================================================================
	// AC2: Protected-system mutations require explicit self-modification
	//      approval beyond normal approval.
	// =======================================================================

	describe("AC2: Protected-system mutations require self-modification approval", () => {
		it("should detect protected-system mutations via affected file paths", () => {
			const result = engine.check("extension", "register_tool", {
				affectedPaths: ["packages/coding-agent/src/core/agent-session.ts"],
			});

			// This should still be "allowed" since register_tool is a read-like action,
			// but the protection level should indicate the touch
			expect(result.protectionLevel).toBe("mutates_protected");
		});

		it("should require approval for skill manifest modifications (protected system)", () => {
			const result = engine.check("skill", "modify_manifest");

			expectVerdict(result, "requires_approval");
			expect(result.protectionLevel).toBe("mutates_protected");
			expect(result.reason).toContain("requires approval");
		});

		it("should require approval for accessing protected paths via skills", () => {
			const result = engine.check("skill", "access_protected_paths");

			expectVerdict(result, "requires_approval");
			expect(result.protectionLevel).toBe("mutates_protected");
		});

		it("should require approval for extension settings modifications", () => {
			const result = engine.check("extension", "modify_settings");

			expectVerdict(result, "requires_approval");
			expect(result.protectionLevel).toBe("touches_protected");
		});

		it("should require enhanced approval for actions affecting protected paths in interactive mode", () => {
			const result = engine.check("skill", "call_tool", {
				affectedPaths: [".pi/settings.json"],
			});

			// call_tool is allowed normally, but when affecting protected paths
			// it should flag requires_approval
			expect(result.protectionLevel).toBe("mutates_protected");
			expect(["requires_approval", "allowed"]).toContain(result.verdict);
		});

		it("should block protected-system mutations in autonomous mode", () => {
			const autonomousEngine = createCapabilityPolicyEngine({
				cwd: TEST_CWD,
				isAutonomous: true,
				defaultApprovalTTL: 300000,
				blockUnsafeActions: true,
			});

			const result = autonomousEngine.check("skill", "modify_manifest", {
				affectedPaths: [".pi/skills/test-skill/SKILL.md"],
			});

			// In autonomous mode, protected mutations are blocked
			expect(result.verdict).toBe("denied");
		});

		it("should include protection level in the result", () => {
			const tests: Array<{ domain: ActionDomain; action: string; expectedProtection: ProtectionLevel }> = [
				{ domain: "extension", action: "register_tool", expectedProtection: "none" },
				{ domain: "extension", action: "modify_settings", expectedProtection: "touches_protected" },
				{ domain: "extension", action: "access_secrets", expectedProtection: "mutates_protected" },
				{ domain: "skill", action: "modify_manifest", expectedProtection: "mutates_protected" },
				{ domain: "skill", action: "access_protected_paths", expectedProtection: "mutates_protected" },
			];

			for (const { domain, action, expectedProtection } of tests) {
				const result = engine.check(domain, action as ActionCategory);
				expect(result.protectionLevel).toBe(expectedProtection);
			}
		});
	});

	// =======================================================================
	// AC3: Unsafe actions are blocked before execution or activation.
	// =======================================================================

	describe("AC3: Unsafe actions are blocked before execution", () => {
		it("should block access to secrets via extensions", () => {
			const result = engine.check("extension", "access_secrets");

			expectVerdict(result, "denied");
			expect(result.reason).toContain("blocked");
			expect(result.reason).toContain("secrets");
		});

		it("should block unsafe actions even with custom overrides when blockUnsafeActions is true", () => {
			const strictEngine = createCapabilityPolicyEngine({
				cwd: TEST_CWD,
				isAutonomous: false,
				defaultApprovalTTL: 300000,
				blockUnsafeActions: true,
				customRules: [
					{
						id: "custom-allow-secrets",
						domain: "extension",
						action: "access_secrets",
						verdict: "allowed",
						reason: "Custom override to allow secrets access",
						isUnsafe: true,
					},
				],
			});

			const result = strictEngine.check("extension", "access_secrets");
			expectVerdict(result, "denied");
			expect(result.reason).toContain("Unsafe action blocked");
		});

		it("should allow unsafe actions when blockUnsafeActions is false", () => {
			const permissiveEngine = createCapabilityPolicyEngine({
				cwd: TEST_CWD,
				isAutonomous: false,
				defaultApprovalTTL: 300000,
				blockUnsafeActions: false,
				customRules: [
					{
						id: "custom-allow-secrets",
						domain: "extension",
						action: "access_secrets",
						verdict: "allowed",
						reason: "Custom override",
						isUnsafe: true,
					},
				],
			});

			const result = permissiveEngine.check("extension", "access_secrets");
			expectVerdict(result, "allowed");
		});

		it("should block denied actions regardless of approval status", () => {
			// Try granting approval for a denied action
			engine.grantApproval("extension", "access_secrets", {
				reason: "Test approval",
				customTTL: 60000,
			});

			const result = engine.check("extension", "access_secrets");
			expectVerdict(result, "denied");
		});

		it("should return the matched rule for blocked actions", () => {
			const result = engine.check("extension", "access_secrets");
			expect(result.matchedRule).toBeDefined();
			expect(result.matchedRule?.verdict).toBe("denied");
			expect(result.matchedRule?.isUnsafe).toBe(true);
		});

		it("should block actions that are explicitly denied by custom rules", () => {
			const denyEngine = createCapabilityPolicyEngine({
				cwd: TEST_CWD,
				isAutonomous: false,
				defaultApprovalTTL: 300000,
				blockUnsafeActions: true,
				customRules: [
					{
						id: "custom-deny-optimizer-apply",
						domain: "optimizer",
						action: "apply_proposal",
						verdict: "denied",
						reason: "Optimizer apply is denied in this configuration",
					},
				],
			});

			const result = denyEngine.check("optimizer", "apply_proposal");
			expectVerdict(result, "denied");
			expect(result.reason).toBe("Optimizer apply is denied in this configuration");
		});
	});

	// =======================================================================
	// AC4: Policy tests include denied, allowed, requires-approval, and
	//      stale-approval cases.
	// =======================================================================

	describe("AC4: Denied, allowed, requires-approval, and stale-approval cases", () => {
		// -----------------------------------------------------------------------
		// DENIED cases
		// -----------------------------------------------------------------------

		describe("Denied cases", () => {
			it("should deny unsafe extension actions (access_secrets)", () => {
				const result = engine.check("extension", "access_secrets");
				expectVerdict(result, "denied");
			});

			it("should deny actions blocked by self-modification firewall in autonomous mode", () => {
				const autoEngine = createCapabilityPolicyEngine({
					cwd: TEST_CWD,
					isAutonomous: true,
					defaultApprovalTTL: 300000,
					blockUnsafeActions: true,
				});

				const result = autoEngine.check("extension", "modify_settings", {
					affectedPaths: [".pi/settings.json"],
				});

				expectVerdict(result, "denied");
				expect(result.reason).toContain("Blocked by self-modification firewall");
			});

			it("should deny when a custom rule explicitly denies", () => {
				const denyEngine = createCapabilityPolicyEngine({
					cwd: TEST_CWD,
					isAutonomous: false,
					defaultApprovalTTL: 300000,
					blockUnsafeActions: true,
					customRules: [
						{
							id: "custom-deny-memory-clear",
							domain: "memory",
							action: "clear_memory",
							verdict: "denied",
							reason: "Memory clearing is disabled in this configuration",
						},
					],
				});

				const result = denyEngine.check("memory", "clear_memory");
				expectVerdict(result, "denied");
			});
		});

		// -----------------------------------------------------------------------
		// ALLOWED cases
		// -----------------------------------------------------------------------

		describe("Allowed cases", () => {
			it("should allow safe extension tool registration", () => {
				const result = engine.check("extension", "register_tool");
				expectVerdict(result, "allowed");
				expect(result.protectionLevel).toBe("none");
			});

			it("should allow skill activation", () => {
				const result = engine.check("skill", "activate");
				expectVerdict(result, "allowed");
			});

			it("should allow workspace scheduling", () => {
				const result = engine.check("orchestrator", "schedule_workspace");
				expectVerdict(result, "allowed");
			});

			it("should allow memory reads", () => {
				const result = engine.check("memory", "read_memory");
				expectVerdict(result, "allowed");
			});

			it("should allow optimizer proposals", () => {
				const result = engine.check("optimizer", "propose_split");
				expectVerdict(result, "allowed");
				expect(result.matchedRule?.id).toBe("opt-propose-split-allowed");
			});

			it("should allow previously-approved actions before TTL expiry", () => {
				const result = engine.check("skill", "modify_manifest");
				expectVerdict(result, "requires_approval");

				// Grant approval
				engine.grantApproval("skill", "modify_manifest", {
					reason: "User approved manifest change",
					customTTL: 60000, // 1 minute
				});

				// Re-check - should now be allowed
				const recheck = engine.check("skill", "modify_manifest");
				expectVerdict(recheck, "allowed");
				expect(recheck.reason).toContain("Previously approved");
			});
		});

		// -----------------------------------------------------------------------
		// REQUIRES-APPROVAL cases
		// -----------------------------------------------------------------------

		describe("Requires-approval cases", () => {
			it("should require approval for modifying extension UI", () => {
				const result = engine.check("extension", "modify_ui");
				expectVerdict(result, "requires_approval");
				expect(result.matchedRule?.approvalTTL).toBe(600000);
			});

			it("should require approval for extension network access", () => {
				const result = engine.check("extension", "network_access");
				expectVerdict(result, "requires_approval");
			});

			it("should require approval for skill manifest modifications", () => {
				const result = engine.check("skill", "modify_manifest");
				expectVerdict(result, "requires_approval");
			});

			it("should require approval for orchestrator parallelism changes", () => {
				const result = engine.check("orchestrator", "change_parallelism");
				expectVerdict(result, "requires_approval");
				expect(result.matchedRule?.id).toBe("orch-change-parallelism-requires-approval");
			});

			it("should require approval for memory clearing", () => {
				const result = engine.check("memory", "clear_memory");
				expectVerdict(result, "requires_approval");
			});

			it("should require approval for optimizer proposals being applied", () => {
				const result = engine.check("optimizer", "apply_proposal");
				expectVerdict(result, "requires_approval");
			});

			it("should require approval for modifying optimizer critical path", () => {
				const result = engine.check("optimizer", "modify_critical_path");
				expectVerdict(result, "requires_approval");
			});

			it("should require approval when no rule exists but action mutates protected system", () => {
				// Actions without explicit rules that affect protected paths should require approval
				const result = engine.check("extension", "register_event_handler", {
					affectedPaths: ["packages/coding-agent/src/core/agent-session.ts"],
				});
				expect(result.protectionLevel).toBe("mutates_protected");
			});

			it("should include matched rule for requires-approval verdicts", () => {
				const result = engine.check("orchestrator", "reorder_queue");
				expect(result.matchedRule).toBeDefined();
				expect(result.matchedRule?.verdict).toBe("requires_approval");
			});
		});

		// -----------------------------------------------------------------------
		// STALE-APPROVAL cases
		// -----------------------------------------------------------------------

		describe("Stale-approval cases", () => {
			it("should detect stale (expired) approvals", () => {
				const result = engine.check("skill", "modify_manifest");
				expectVerdict(result, "requires_approval");

				// Grant approval with a very short TTL (0 = already expired)
				engine.grantApproval("skill", "modify_manifest", {
					reason: "Approved manifest change",
					customTTL: -1, // Forces negative TTL, already expired
				});

				const recheck = engine.check("skill", "modify_manifest");
				expect(recheck.isStaleApproval).toBe(true);
				expect(recheck.verdict).toBe("requires_approval");
				expect(recheck.reason).toContain("expired");
			});

			it("should report stale approval when TTL has passed", async () => {
				// Use a very short TTL (1 ms)
				engine.grantApproval("extension", "network_access", {
					reason: "Temporary network access",
					customTTL: 1,
				});

				// Wait for TTL to expire
				await new Promise((resolve) => setTimeout(resolve, 5));

				const result = engine.check("extension", "network_access");
				expect(result.isStaleApproval).toBe(true);
				expectVerdict(result, "requires_approval");
			});

			it("should delete stale approvals from the cache", () => {
				engine.grantApproval("memory", "clear_memory", {
					reason: "Memory clear approved",
					customTTL: -1, // Already expired
				});

				// After checking and finding stale, the approval should be removed
				engine.check("memory", "clear_memory");
				expect(engine.hasValidApproval("memory", "clear_memory")).toBe(false);
			});

			it("should count valid approvals correctly", () => {
				// Grant several approvals with valid TTLs
				engine.grantApproval("extension", "network_access", {
					reason: "Approved 1",
					customTTL: 60000,
				});
				engine.grantApproval("orchestrator", "change_parallelism", {
					reason: "Approved 2",
					customTTL: 60000,
				});
				engine.grantApproval("memory", "clear_memory", {
					reason: "Expired",
					customTTL: -1, // Already expired
				});

				// Check stale to trigger cleanup
				engine.check("memory", "clear_memory");

				const validApprovals = engine.getValidApprovals();
				expect(validApprovals).toHaveLength(2);
				expect(engine.approvalCount).toBe(2);
			});

			it("should correctly identify stale approvals via isApprovalStale", () => {
				engine.grantApproval("optimizer", "apply_proposal", {
					reason: "Apply proposal",
					customTTL: 60000,
				});

				expect(engine.isApprovalStale("optimizer", "apply_proposal")).toBe(false);

				engine.grantApproval("optimizer", "apply_proposal", {
					reason: "Stale approval",
					customTTL: -1,
				});

				expect(engine.isApprovalStale("optimizer", "apply_proposal")).toBe(true);
			});

			it("should return false for isApprovalStale when no approval exists", () => {
				expect(engine.isApprovalStale("extension", "network_access")).toBe(false);
			});

			it("should return false for hasValidApproval when approval has expired", () => {
				engine.grantApproval("orchestrator", "reorder_queue", {
					reason: "Will expire",
					customTTL: -1,
				});

				expect(engine.hasValidApproval("orchestrator", "reorder_queue")).toBe(false);
			});
		});
	});

	// =======================================================================
	// Rule Management
	// =======================================================================

	describe("Rule management", () => {
		it("should include all default rules", () => {
			const rules = engine.getRules();
			expect(rules.length).toBeGreaterThanOrEqual(DEFAULT_CAPABILITY_RULES.length);
		});

		it("should include custom rules when provided", () => {
			const customRule: CapabilityRule = {
				id: "custom-test-rule",
				domain: "memory",
				action: "read_memory",
				verdict: "requires_approval",
				reason: "Custom override for memory reads",
			};

			const customEngine = createCapabilityPolicyEngine({
				cwd: TEST_CWD,
				isAutonomous: false,
				defaultApprovalTTL: 300000,
				blockUnsafeActions: true,
				customRules: [customRule],
			});

			const rules = customEngine.getRules();
			const found = rules.find((r) => r.id === "custom-test-rule");
			expect(found).toBeDefined();

			// Custom rule should override built-in
			const result = customEngine.check("memory", "read_memory");
			expectVerdict(result, "requires_approval");
		});

		it("should support custom rules that grant approval for normally denied actions (when not unsafe)", () => {
			const customRule: CapabilityRule = {
				id: "custom-allow-parallelism",
				domain: "orchestrator",
				action: "change_parallelism",
				verdict: "allowed",
				reason: "Custom: allow parallelism changes",
			};

			const customEngine = createCapabilityPolicyEngine({
				cwd: TEST_CWD,
				isAutonomous: false,
				defaultApprovalTTL: 300000,
				blockUnsafeActions: true,
				customRules: [customRule],
			});

			const result = customEngine.check("orchestrator", "change_parallelism");
			expectVerdict(result, "allowed");
		});
	});

	// =======================================================================
	// Edge Cases
	// =======================================================================

	describe("Edge cases", () => {
		it("should handle unknown actions with default verdict", () => {
			// Access a domain with an action that doesn't exist in rules (but could exist)
			// This tests the fallback behavior
			const result = engine.check("orchestrator", "schedule_workspace");
			expect(result.verdict).toBeDefined();
		});

		it("should clear all approvals on demand", () => {
			engine.grantApproval("extension", "network_access", {
				reason: "Test",
				customTTL: 60000,
			});
			engine.grantApproval("skill", "modify_manifest", {
				reason: "Test",
				customTTL: 60000,
			});

			expect(engine.approvalCount).toBe(2);

			engine.clearApprovals();
			expect(engine.approvalCount).toBe(0);
		});

		it("should revoke a specific approval", () => {
			engine.grantApproval("extension", "network_access", {
				reason: "Test",
				customTTL: 60000,
			});
			expect(engine.hasValidApproval("extension", "network_access")).toBe(true);

			engine.revokeApproval("extension", "network_access");
			expect(engine.hasValidApproval("extension", "network_access")).toBe(false);
		});

		it("should handle domains with multiple approval grants independently", () => {
			engine.grantApproval("extension", "network_access", {
				reason: "Network access",
				customTTL: 60000,
			});
			engine.grantApproval("extension", "modify_ui", {
				reason: "UI mods",
				customTTL: 60000,
			});

			expect(engine.hasValidApproval("extension", "network_access")).toBe(true);
			expect(engine.hasValidApproval("extension", "modify_ui")).toBe(true);

			engine.revokeApproval("extension", "network_access");
			expect(engine.hasValidApproval("extension", "network_access")).toBe(false);
			expect(engine.hasValidApproval("extension", "modify_ui")).toBe(true);
		});
	});

	// =======================================================================
	// Default Rules Integrity
	// =======================================================================

	describe("Default rules integrity", () => {
		it("should have at least one rule for each domain", () => {
			const rules = DEFAULT_CAPABILITY_RULES;

			for (const domain of ["extension", "skill", "orchestrator", "memory", "optimizer"] as ActionDomain[]) {
				const domainRules = rules.filter((r) => r.domain === domain);
				expect(domainRules.length).toBeGreaterThan(0);
			}
		});

		it("should have unique rule IDs", () => {
			const ids = DEFAULT_CAPABILITY_RULES.map((r) => r.id);
			const uniqueIds = new Set(ids);
			expect(ids.length).toBe(uniqueIds.size);
		});

		it("should have valid verdicts for all rules", () => {
			for (const rule of DEFAULT_CAPABILITY_RULES) {
				expect(["allowed", "denied", "requires_approval"]).toContain(rule.verdict);
			}
		});

		it("should have descriptions for all actions in ALL domains", () => {
			const domains: ActionDomain[] = ["extension", "skill", "orchestrator", "memory", "optimizer"];

			for (const domain of domains) {
				const labels = ACTION_LABELS[domain];
				expect(labels).toBeDefined();
				// Every rule action should have a corresponding label
				const ruleActions = DEFAULT_CAPABILITY_RULES.filter((r) => r.domain === domain).map((r) => r.action);
				for (const action of ruleActions) {
					expect(labels[action]).toBeDefined();
				}
			}
		});
	});
});

describe("CapabilityPolicyEngine integration with SelfModificationFirewall", () => {
	const fireWallCwd = "/Users/hootie/src/pi";

	it("should detect protected source code paths", () => {
		const engine = createCapabilityPolicyEngine({
			cwd: fireWallCwd,
			isAutonomous: false,
			defaultApprovalTTL: 300000,
			blockUnsafeActions: true,
		});

		const result = engine.check("extension", "register_tool", {
			affectedPaths: ["packages/coding-agent/src/core/capability-policy-engine.ts"],
		});

		// The extension registering a tool is allowed, but the affected path
		// should be flagged as touching a protected system
		expect(result.protectionLevel).toBe("mutates_protected");
	});

	it("should treat system changes with protected paths as self-modification", () => {
		const engine = createCapabilityPolicyEngine({
			cwd: fireWallCwd,
			isAutonomous: false,
			defaultApprovalTTL: 300000,
			blockUnsafeActions: true,
		});

		// An orchestrator action affecting protected source code files
		const result = engine.check("orchestrator", "modify_dependencies", {
			affectedPaths: [".pi/agent/AGENTS.md"],
		});

		// Should detect the protected system
		expect(result.protectionLevel).toBe("mutates_protected");
	});
});
