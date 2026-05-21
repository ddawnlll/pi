/**
 * Policy Engine V0 Tests — P18.A
 *
 * Acceptance Criteria:
 * 1. Evaluates single action correctly
 * 2. Priority ordering works (higher wins)
 * 3. Glob patterns match ("memory_*" matches "memory_creation")
 * 4. Context filtering works (by autonomy level, risk level)
 * 5. Default deny when no rule matches
 * 6. Cache returns correct cached result
 * 7. All decisions produce AuditEntry
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyEngine, createPolicyEngine } from "../../../src/brain/policy/engine.js";
import { RuleStore } from "../../../src/brain/policy/store.js";
import type { AuditEntry } from "../../../src/brain/audit/ledger.js";
import type { PolicyContext, PolicyRule } from "../../../src/brain/policy/types.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), ".pi-test", `policy-engine-${Date.now()}`);

const FIXTURE_RULES_PATH = path.resolve(
	process.cwd(),
	"test/fixtures/policy/test-rules.json",
);

async function loadFixtureRules(): Promise<PolicyRule[]> {
	const json = await fs.readFile(FIXTURE_RULES_PATH, "utf-8");
	return JSON.parse(json) as PolicyRule[];
}

async function createStore(): Promise<RuleStore> {
	const store = new RuleStore({
		basePath: path.join(TEST_DIR, "brain", "policy"),
		autoSave: true,
		backupOnSave: false,
	});
	await store.initialize();

	// Load fixture rules into store
	const rules = await loadFixtureRules();
	for (const rule of rules) {
		await store.createRule(rule);
	}

	return store;
}

function makeContext(overrides?: Partial<PolicyContext>): PolicyContext {
	return {
		action: "retry_transient_failure",
		actor: "pi",
		autonomyLevel: 2,
		metadata: {},
		...overrides,
	};
}

class MockAuditLedger {
	public entries: AuditEntry[] = [];

	async append(entry: AuditEntry): Promise<void> {
		this.entries.push(entry);
	}
}

async function cleanTestDir(): Promise<void> {
	try {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	} catch {
		// Ignore
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PolicyEngine", () => {
	let store: RuleStore;
	let engine: PolicyEngine;

	beforeEach(async () => {
		await cleanTestDir();
		store = await createStore();
		engine = createPolicyEngine(store, { cacheTtlMs: 5000 });
	});

	afterEach(async () => {
		await cleanTestDir();
	});

	// =======================================================================
	// AC1: Evaluates single action correctly
	// =======================================================================

	describe("AC1: Evaluates single action correctly", () => {
		it("should return 'allow' for retry_transient_failure", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "retry_transient_failure" }),
			);

			expect(result.decision).toBe("allow");
			expect(result.matchedRule).not.toBeNull();
			expect(result.matchedRule!.id).toBe("allow_001");
			expect(result.explanation).toBeTruthy();
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
			expect(result.evaluatedAt).toBeTruthy();
		});

		it("should return 'approval_required' for execute_generated_plan", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "execute_generated_plan" }),
			);

			expect(result.decision).toBe("approval_required");
			expect(result.matchedRule).not.toBeNull();
			expect(result.matchedRule!.id).toBe("appr_001");
		});

		it("should return 'forbidden' for access_secrets", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "access_secrets" }),
			);

			expect(result.decision).toBe("forbidden");
			expect(result.matchedRule).not.toBeNull();
			expect(result.matchedRule!.id).toBe("forbid_001");
		});

		it("should return 'forbidden' for destructive_cleanup", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "destructive_cleanup" }),
			);

			expect(result.decision).toBe("forbidden");
			expect(result.matchedRule).not.toBeNull();
			expect(result.matchedRule!.id).toBe("forbid_002");
		});

		it("should return 'allowed' for generate_draft_proposal", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "generate_draft_proposal" }),
			);

			expect(result.decision).toBe("allow");
			expect(result.matchedRule).not.toBeNull();
			expect(result.matchedRule!.id).toBe("allow_002");
		});
	});

	// =======================================================================
	// AC2: Priority ordering works (higher wins)
	// =======================================================================

	describe("AC2: Priority ordering works (higher wins)", () => {
		it("should prefer higher priority rule when multiple match", async () => {
			// forbid_001 (priority 200) matches "access_secrets"
			// There shouldn't be a lower-priority rule matching the same action
			const result = await engine.evaluate(
				makeContext({ action: "access_secrets" }),
			);

			expect(result.decision).toBe("forbidden");
			expect(result.matchedRule!.priority).toBe(200);
		});

		it("should select highest priority among multiple matching rules", async () => {
			// memory_creation matches:
			//   - glob_001 (priority 95) with pattern "memory_*"
			//   - appr_003 (priority 90) with exact match "memory_creation"
			// glob_001 has higher priority, so it should win
			const result = await engine.evaluate(
				makeContext({ action: "memory_creation" }),
			);

			// Both match, but glob_001 has higher priority
			expect(result.decision).toBe("approval_required");
			expect(result.matchedRule).not.toBeNull();
		});

		it("should list all evaluated rules with match status", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "retry_transient_failure" }),
			);

			expect(result.allEvaluatedRules.length).toBeGreaterThan(0);
			const matchedEntry = result.allEvaluatedRules.find((e) => e.matched);
			expect(matchedEntry).toBeDefined();
			expect(matchedEntry!.rule.id).toBe("allow_001");
		});
	});

	// =======================================================================
	// AC3: Glob patterns match ("memory_*" matches "memory_creation")
	// =======================================================================

	describe("AC3: Glob patterns match", () => {
		it("should match exact glob pattern", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "memory_creation" }),
			);

			// glob_001 (memory_*) should match, with appr_003 (exact) also matching
			expect(result.decision).toBe("approval_required");
		});

		it("should match wildcard suffix", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "memory_query" }),
			);

			// memory_query matches both glob_001 (memory_*, priority 95)
			// and allow_005 (exact match, priority 100). Higher priority wins.
			expect(result.decision).toBe("allow");
			expect(result.matchedRule!.id).toBe("allow_005");
		});

		it("should match wildcard for any action", async () => {
			// appr_004 uses "*" pattern with riskLevel condition
			const result = await engine.evaluate(
				makeContext({ action: "any_action", riskLevel: "high" }),
			);

			expect(result.decision).toBe("approval_required");
			expect(result.matchedRule!.id).toBe("appr_004");
		});

		it("should NOT match action that doesn't match glob", async () => {
			// glob_001 matches "memory_*", so "plan_execution" should not match it
			const result = await engine.evaluate(
				makeContext({ action: "plan_execution" }),
			);

			// Should fall through to default deny since no rule matches
			expect(result.decision).toBe("deny");
			expect(result.matchedRule).toBeNull();
		});
	});

	// =======================================================================
	// AC4: Context filtering works (by autonomy level, risk level)
	// =======================================================================

	describe("AC4: Context filtering works", () => {
		it("should filter by autonomy level (min)", async () => {
			// appr_005 requires minAutonomyLevel of 4
			// At autonomy 2, should not match
			const resultAt2 = await engine.evaluate(
				makeContext({ action: "any_action", autonomyLevel: 2 }),
			);

			// Should deny by default (appr_004 needs riskLevel, appr_005 needs level 4)
			expect(resultAt2.decision).toBe("deny");
			expect(resultAt2.matchedRule).toBeNull();
		});

		it("should filter by autonomy level (max)", async () => {
			// context_001 applies to execute_generated_plan with maxAutonomyLevel 1
			// At autonomy 1, it should deny
			const resultAt1 = await engine.evaluate(
				makeContext({ action: "execute_generated_plan", autonomyLevel: 1 }),
			);

			// context_001 (priority 95, deny) should have higher priority than
			// appr_001 (priority 90, approval_required)
			expect(resultAt1.decision).toBe("deny");
			expect(resultAt1.matchedRule!.id).toBe("context_001");

			// At autonomy 2, context_001 should NOT match, and appr_001 should
			const resultAt2 = await engine.evaluate(
				makeContext({ action: "execute_generated_plan", autonomyLevel: 2 }),
			);

			expect(resultAt2.decision).toBe("approval_required");
			expect(resultAt2.matchedRule!.id).toBe("appr_001");
		});

		it("should filter by risk level", async () => {
			// appr_004 matches any action (*) with high or critical risk level
			const resultLow = await engine.evaluate(
				makeContext({ action: "some_action", riskLevel: "low" }),
			);

			// No specific rule for "some_action", and appr_004 doesn't match low risk
			expect(resultLow.decision).toBe("deny");
			expect(resultLow.matchedRule).toBeNull();

			// High risk should match appr_004
			const resultHigh = await engine.evaluate(
				makeContext({ action: "some_action", riskLevel: "high" }),
			);

			expect(resultHigh.decision).toBe("approval_required");
			expect(resultHigh.matchedRule!.id).toBe("appr_004");
		});

		it("should return deny when context has no risk level but rule requires one", async () => {
			// appr_004 requires riskLevel, but context doesn't have one
			const result = await engine.evaluate(
				makeContext({ action: "some_action", riskLevel: undefined }),
			);

			expect(result.decision).toBe("deny");
			expect(result.matchedRule).toBeNull();
		});
	});

	// =======================================================================
	// AC5: Default deny when no rule matches
	// =======================================================================

	describe("AC5: Default deny when no rule matches", () => {
		it("should return 'deny' for unknown action", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "completely_unknown_action" }),
			);

			expect(result.decision).toBe("deny");
			expect(result.matchedRule).toBeNull();
			expect(result.explanation).toContain("Defaulting to deny");
		});

		it("should return 'deny' when no enabled rule matches context", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "some_random_action", autonomyLevel: 1, riskLevel: "low" }),
			);

			expect(result.decision).toBe("deny");
			expect(result.matchedRule).toBeNull();
		});
	});

	// =======================================================================
	// AC6: Cache returns correct cached result
	// =======================================================================

	describe("AC6: Cache returns correct cached result", () => {
		it("should return cached result on repeated evaluation with same context", async () => {
			const context = makeContext({ action: "retry_transient_failure" });

			// First call
			const result1 = await engine.evaluate(context);

			// Modify store to change rule (should NOT affect cached result)
			await store.updateRule("allow_001", { decision: "deny" });

			// Second call should return cached result
			const result2 = await engine.evaluate(context);

			expect(result2.decision).toBe("allow");
			expect(result2.matchedRule!.id).toBe("allow_001");
			// Cached result should have the same evaluatedAt
			expect(result2.evaluatedAt).toBe(result1.evaluatedAt);
		});

		it("should return fresh result after cache clear", async () => {
			const context = makeContext({ action: "retry_transient_failure" });

			// First call
			await engine.evaluate(context);

			// Change rule and clear cache
			await store.updateRule("allow_001", { decision: "deny" });
			engine.clearCache();

			// Second call should return fresh result
			const result2 = await engine.evaluate(context);

			expect(result2.decision).toBe("deny");
		});

		it("should invalidate specific action cache", async () => {
			const ctxRetry = makeContext({ action: "retry_transient_failure" });
			const ctxObserve = makeContext({ action: "observe_system_state" });

			// Warm both caches
			const resultRetry1 = await engine.evaluate(ctxRetry);
			const resultObserve1 = await engine.evaluate(ctxObserve);

			// Modify rule for retry
			await store.updateRule("allow_001", { decision: "deny" });

			// Invalidate only retry cache
			engine.invalidateForAction("retry_transient_failure");

			// Retry should be fresh
			const resultRetry2 = await engine.evaluate(ctxRetry);
			expect(resultRetry2.decision).toBe("deny");

			// Observe should still be cached
			const resultObserve2 = await engine.evaluate(ctxObserve);
			expect(resultObserve2.evaluatedAt).toBe(resultObserve1.evaluatedAt);
		});

		it("should respect cache TTL", async () => {
			// Create engine with very short TTL
			const shortTtlEngine = createPolicyEngine(store, { cacheTtlMs: 1 });

			const context = makeContext({ action: "retry_transient_failure" });

			// First call
			const result1 = await shortTtlEngine.evaluate(context);

			// Change rule
			await store.updateRule("allow_001", { decision: "deny" });

			// Wait for cache to expire
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Second call should be fresh (cache expired)
			const result2 = await shortTtlEngine.evaluate(context);

			expect(result2.decision).toBe("deny");
			expect(result2.evaluatedAt).not.toBe(result1.evaluatedAt);
		});
	});

	// =======================================================================
	// AC7: All decisions produce AuditEntry
	// =======================================================================

	describe("AC7: All decisions produce AuditEntry", () => {
		it("should create audit entry for allowed action", async () => {
			const ledger = new MockAuditLedger();
			const context = makeContext({ action: "retry_transient_failure" });

			const result = await engine.evaluateWithAudit(context, ledger);

			expect(result.auditEntry).toBeDefined();
			expect(result.auditEntry.id).toBeTruthy();
			expect(result.auditEntry.action).toBe("retry_transient_failure");
			expect(result.auditEntry.decision).toBe("allow");
			expect(result.auditEntry.actor).toBe("pi");
			expect(result.auditEntry.result).toBe("success");
			expect(result.auditEntry.policyRuleId).toBe("allow_001");
			expect(result.auditEntry.policyRuleName).toBe("Retry transient failures");
			expect(result.auditEntry.timestamp).toBeTruthy();
			expect(result.auditEntry.context.autonomyLevel).toBe(2);

			expect(ledger.entries.length).toBe(1);
			expect(ledger.entries[0].id).toBe(result.auditEntry.id);
		});

		it("should create audit entry for forbidden action", async () => {
			const ledger = new MockAuditLedger();
			const context = makeContext({ action: "access_secrets" });

			const result = await engine.evaluateWithAudit(context, ledger);

			expect(result.auditEntry.decision).toBe("forbidden");
			expect(result.auditEntry.result).toBe("blocked");
			expect(result.auditEntry.policyRuleId).toBe("forbid_001");

			expect(ledger.entries.length).toBe(1);
		});

		it("should create audit entry for approval_required action", async () => {
			const ledger = new MockAuditLedger();
			const context = makeContext({ action: "execute_generated_plan" });

			const result = await engine.evaluateWithAudit(context, ledger);

			expect(result.auditEntry.decision).toBe("approval_required");
			expect(result.auditEntry.result).toBe("blocked");
			expect(result.auditEntry.policyRuleId).toBe("appr_001");

			expect(ledger.entries.length).toBe(1);
		});

		it("should create audit entry for default deny", async () => {
			const ledger = new MockAuditLedger();
			const context = makeContext({ action: "completely_unknown_action" });

			const result = await engine.evaluateWithAudit(context, ledger);

			expect(result.auditEntry.decision).toBe("deny");
			expect(result.auditEntry.result).toBe("blocked");
			expect(result.auditEntry.policyRuleId).toBeUndefined();

			expect(ledger.entries.length).toBe(1);
		});

		it("should include proposalId and planExecId in audit entry when provided", async () => {
			const ledger = new MockAuditLedger();
			const context = makeContext({
				action: "retry_transient_failure",
				proposalId: "proposal-123",
				planExecId: "plan-exec-456",
			});

			const result = await engine.evaluateWithAudit(context, ledger);

			expect(result.auditEntry.proposalId).toBe("proposal-123");
			expect(result.auditEntry.planExecId).toBe("plan-exec-456");
		});
	});

	// =======================================================================
	// Convenience Methods
	// =======================================================================

	describe("Convenience methods", () => {
		it("canAutoExecute should return true for allowed actions", async () => {
			const result = await engine.canAutoExecute(
				makeContext({ action: "retry_transient_failure" }),
			);
			expect(result).toBe(true);
		});

		it("canAutoExecute should return false for non-allowed actions", async () => {
			const result = await engine.canAutoExecute(
				makeContext({ action: "access_secrets" }),
			);
			expect(result).toBe(false);
		});

		it("requiresApproval should return true for approval_required actions", async () => {
			const result = await engine.requiresApproval(
				makeContext({ action: "execute_generated_plan" }),
			);
			expect(result).toBe(true);
		});

		it("requiresApproval should return false for allowed actions", async () => {
			const result = await engine.requiresApproval(
				makeContext({ action: "retry_transient_failure" }),
			);
			expect(result).toBe(false);
		});

		it("isForbidden should return true for forbidden actions", async () => {
			const result = await engine.isForbidden(
				makeContext({ action: "access_secrets" }),
			);
			expect(result).toBe(true);
		});

		it("isForbidden should return false for non-forbidden actions", async () => {
			const result = await engine.isForbidden(
				makeContext({ action: "retry_transient_failure" }),
			);
			expect(result).toBe(false);
		});
	});

	// =======================================================================
	// Explanation
	// =======================================================================

	describe("Explanation", () => {
		it("explain should describe matched rule", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "retry_transient_failure" }),
			);

			const explanation = engine.explain(result);
			expect(explanation).toContain("allow");
			expect(explanation).toContain("Retry transient failures");
		});

		it("explain should describe default deny", async () => {
			// Use an action that has no matching rule at all
			const result = await engine.evaluate(
				makeContext({ action: "nonexistent_action_xyz" }),
			);

			const explanation = engine.explain(result);
			expect(explanation).toContain("Default decision");
			expect(explanation).toContain("deny");
		});

		it("explainSimple should produce concise output", async () => {
			const result = await engine.evaluate(
				makeContext({ action: "retry_transient_failure" }),
			);

			const explanation = engine.explainSimple(result.decision, result.matchedRule);
			expect(explanation).toBe(
				"[ALLOW] Retry transient failures: Allow Pi to retry transient network or service failures automatically",
			);
		});

		it("explainSimple should handle null rule", async () => {
			const explanation = engine.explainSimple("deny", null);
			expect(explanation).toBe("[DENY] Default decision (no matching rule)");
		});
	});

	// =======================================================================
	// Error Handling
	// =======================================================================

	describe("Error handling", () => {
		it("should handle empty rule store gracefully", async () => {
			// Create a separate engine with empty store
			const emptyStore = new RuleStore({
				basePath: path.join(TEST_DIR, "empty", "brain", "policy"),
				autoSave: true,
				backupOnSave: false,
			});
			await emptyStore.initialize();

			const emptyEngine = createPolicyEngine(emptyStore);

			const result = await emptyEngine.evaluate(
				makeContext({ action: "any_action" }),
			);

			expect(result.decision).toBe("deny");
			expect(result.matchedRule).toBeNull();
			expect(result.allEvaluatedRules).toEqual([]);
		});

		it("should handle disabled rules correctly", async () => {
			// Disable a rule
			await store.updateRule("allow_001", { enabled: false });

			const result = await engine.evaluate(
				makeContext({ action: "retry_transient_failure" }),
			);

			// Should fall through to default deny since no enabled rule matches
			expect(result.decision).toBe("deny");
		});

		it("should not throw on invalid glob patterns", async () => {
			// Create a rule with invalid glob pattern
			await store.createRule({
				id: "bad_glob",
				name: "Bad glob",
				description: "Has invalid glob",
				condition: { action: "[invalid" },
				decision: "deny",
				priority: 50,
				enabled: true,
				metadata: {},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});

			const result = await engine.evaluate(
				makeContext({ action: "[invalid" }),
			);

			// Should match via exact match fallback
			expect(result.decision).toBe("deny");
			expect(result.matchedRule).not.toBeNull();
		});
	});
});

// =======================================================================
// Factory Function
// =======================================================================

describe("createPolicyEngine", () => {
	it("should create a PolicyEngine instance", async () => {
		const store = await createStore();
		const engine = createPolicyEngine(store);
		expect(engine).toBeInstanceOf(PolicyEngine);
	});

	it("should accept custom config", async () => {
		const store = await createStore();
		const engine = createPolicyEngine(store, { cacheTtlMs: 10000 });
		expect(engine).toBeInstanceOf(PolicyEngine);
	});
});
