/**
 * RuleStore Tests — P18.B
 *
 * Comprehensive tests for the RuleStore class.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuleStore } from "../../../src/brain/policy/store.js";
import type { PolicyRule } from "../../../src/brain/policy/types.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), ".pi-test", `policy-store-${Date.now()}`);

function makeRuleStore(basePath?: string): RuleStore {
	return new RuleStore({
		basePath: basePath ?? path.join(TEST_DIR, "brain", "policy"),
		autoSave: true,
		backupOnSave: false,
	});
}

function validRule(overrides?: Partial<PolicyRule>): PolicyRule {
	const now = new Date().toISOString();
	return {
		id: `rule-${Math.random().toString(36).slice(2, 10)}`,
		name: "test-rule",
		description: "A test policy rule",
		condition: {
			action: "test_action",
		},
		decision: "deny",
		priority: 100,
		enabled: true,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
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

describe("RuleStore", () => {
	let store: RuleStore;

	beforeEach(async () => {
		await cleanTestDir();
		store = makeRuleStore();
		await store.initialize();
	});

	afterEach(async () => {
		await cleanTestDir();
	});

	// -----------------------------------------------------------------------
	// Initialization
	// -----------------------------------------------------------------------

	describe("initialization", () => {
		it("should create directories on initialize", async () => {
			const basePath = path.join(TEST_DIR, "init-test");
			await fs.rm(basePath, { recursive: true, force: true });

			const s = makeRuleStore(basePath);
			expect(s.getConfig().basePath).toBe(basePath);

			await s.initialize();

			// Check directories exist
			const rulesDir = path.join(basePath, "rules");
			await expect(fs.access(basePath)).resolves.toBeUndefined();
			await expect(fs.access(rulesDir)).resolves.toBeUndefined();
		});

		it("should be idempotent when calling initialize multiple times", async () => {
			await store.initialize();
			await store.initialize(); // Should not throw
		});
	});

	// -----------------------------------------------------------------------
	// Uninitialized Guard
	// -----------------------------------------------------------------------

	describe("uninitialized guard", () => {
		it("should throw on operations before initialize", async () => {
			const fresh = makeRuleStore();

			await expect(fresh.createRule(validRule())).rejects.toThrow("not initialized");
			await expect(fresh.getRule("x")).rejects.toThrow("not initialized");
			await expect(fresh.updateRule("x", {})).rejects.toThrow("not initialized");
			await expect(fresh.deleteRule("x")).rejects.toThrow("not initialized");
			await expect(fresh.listRules()).rejects.toThrow("not initialized");
			await expect(fresh.findByAction("test")).rejects.toThrow("not initialized");
			await expect(fresh.findByDecision("allow")).rejects.toThrow("not initialized");
			await expect(fresh.findEnabled()).rejects.toThrow("not initialized");
			await expect(fresh.findDisabled()).rejects.toThrow("not initialized");
			await expect(fresh.detectConflicts()).rejects.toThrow("not initialized");
			await expect(fresh.getStats()).rejects.toThrow("not initialized");
			await expect(fresh.rebuildIndex()).rejects.toThrow("not initialized");
		});
	});

	// -----------------------------------------------------------------------
	// Rules CRUD
	// -----------------------------------------------------------------------

	describe("rules CRUD", () => {
		it("should create a rule", async () => {
			const rule = validRule();
			const created = await store.createRule(rule);

			expect(created.id).toBe(rule.id);
			expect(created.name).toBe("test-rule");
			expect(created.decision).toBe("deny");
			expect(created.enabled).toBe(true);
		});

		it("should reject a rule without an id", async () => {
			const invalid = validRule({ id: "" });
			await expect(store.createRule(invalid)).rejects.toThrow("PolicyRule must have an id");
		});

		it("should reject a rule with invalid decision", async () => {
			const invalid = validRule({ decision: "invalid" as PolicyRule["decision"] });
			await expect(store.createRule(invalid)).rejects.toThrow("decision must be one of");
		});

		it("should reject a rule without a name", async () => {
			const invalid = validRule({ name: "" });
			await expect(store.createRule(invalid)).rejects.toThrow("name must be a non-empty string");
		});

		it("should reject a rule without a condition action", async () => {
			const invalid = validRule({ condition: { action: "" } });
			await expect(store.createRule(invalid)).rejects.toThrow("condition.action must be a non-empty string");
		});

		it("should get a rule by id", async () => {
			const rule = validRule();
			await store.createRule(rule);

			const retrieved = await store.getRule(rule.id);
			expect(retrieved).not.toBeNull();
			expect(retrieved!.id).toBe(rule.id);
			expect(retrieved!.name).toBe("test-rule");
		});

		it("should return null for non-existent rule", async () => {
			const retrieved = await store.getRule("non-existent");
			expect(retrieved).toBeNull();
		});

		it("should update a rule", async () => {
			const rule = validRule();
			await store.createRule(rule);

			const updated = await store.updateRule(rule.id, { name: "updated-name", priority: 200 });
			expect(updated.name).toBe("updated-name");
			expect(updated.priority).toBe(200);
			expect(typeof updated.updatedAt).toBe("string");
			expect(updated.updatedAt.length).toBeGreaterThan(0);
		});

		it("should update a rule decision", async () => {
			const rule = validRule({ decision: "deny" });
			await store.createRule(rule);

			const updated = await store.updateRule(rule.id, { decision: "allow" });
			expect(updated.decision).toBe("allow");
		});

		it("should update a rule to toggle enabled state", async () => {
			const rule = validRule({ enabled: true });
			await store.createRule(rule);

			const updated = await store.updateRule(rule.id, { enabled: false });
			expect(updated.enabled).toBe(false);
		});

		it("should throw when updating non-existent rule", async () => {
			await expect(store.updateRule("non-existent", { name: "new" })).rejects.toThrow("not found");
		});

		it("should reject invalid updates", async () => {
			const rule = validRule();
			await store.createRule(rule);

			await expect(store.updateRule(rule.id, { decision: "invalid" as PolicyRule["decision"] })).rejects.toThrow(
				"decision must be one of",
			);
		});

		it("should delete a rule", async () => {
			const rule = validRule();
			await store.createRule(rule);

			await store.deleteRule(rule.id);
			const retrieved = await store.getRule(rule.id);
			expect(retrieved).toBeNull();
		});

		it("should throw when deleting non-existent rule", async () => {
			await expect(store.deleteRule("non-existent")).rejects.toThrow("not found");
		});

		it("should allow creating multiple rules", async () => {
			const r1 = validRule({ name: "rule-1" });
			const r2 = validRule({ name: "rule-2" });
			const r3 = validRule({ name: "rule-3" });
			await store.createRule(r1);
			await store.createRule(r2);
			await store.createRule(r3);

			const rules = await store.listRules();
			expect(rules).toHaveLength(3);
		});
	});

	// -----------------------------------------------------------------------
	// Queries
	// -----------------------------------------------------------------------

	describe("queries", () => {
		it("should list all rules", async () => {
			const r1 = validRule({ name: "rule-1" });
			const r2 = validRule({ name: "rule-2" });
			await store.createRule(r1);
			await store.createRule(r2);

			const rules = await store.listRules();
			expect(rules).toHaveLength(2);
		});

		it("should filter by action (case-insensitive)", async () => {
			const r1 = validRule({ name: "action-rule", condition: { action: "file_write" } });
			const r2 = validRule({ name: "other-rule", condition: { action: "network_access" } });
			await store.createRule(r1);
			await store.createRule(r2);

			const results = await store.listRules({ action: "FILE_WRITE" });
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(r1.id);
		});

		it("should filter by decision", async () => {
			const r1 = validRule({ name: "allow-rule", decision: "allow" });
			const r2 = validRule({ name: "deny-rule", decision: "deny" });
			await store.createRule(r1);
			await store.createRule(r2);

			const allows = await store.listRules({ decision: "allow" });
			expect(allows).toHaveLength(1);
			expect(allows[0].id).toBe(r1.id);

			const denies = await store.listRules({ decision: "deny" });
			expect(denies).toHaveLength(1);
			expect(denies[0].id).toBe(r2.id);
		});

		it("should filter by enabled state", async () => {
			const r1 = validRule({ name: "enabled-rule", enabled: true });
			const r2 = validRule({ name: "disabled-rule", enabled: false });
			await store.createRule(r1);
			await store.createRule(r2);

			const enabled = await store.listRules({ enabled: true });
			expect(enabled).toHaveLength(1);
			expect(enabled[0].id).toBe(r1.id);

			const disabled = await store.listRules({ enabled: false });
			expect(disabled).toHaveLength(1);
			expect(disabled[0].id).toBe(r2.id);
		});

		it("should combine multiple filters", async () => {
			const r1 = validRule({
				name: "target-rule",
				condition: { action: "file_write" },
				decision: "deny",
				enabled: true,
			});
			const r2 = validRule({
				name: "other-rule",
				condition: { action: "file_write" },
				decision: "allow",
				enabled: true,
			});
			await store.createRule(r1);
			await store.createRule(r2);

			const filtered = await store.listRules({ action: "file_write", decision: "deny" });
			expect(filtered).toHaveLength(1);
			expect(filtered[0].id).toBe(r1.id);
		});

		it("should filter by minPriority", async () => {
			const r1 = validRule({ name: "high", priority: 200 });
			const r2 = validRule({ name: "low", priority: 50 });
			await store.createRule(r1);
			await store.createRule(r2);

			const high = await store.listRules({ minPriority: 100 });
			expect(high).toHaveLength(1);
			expect(high[0].id).toBe(r1.id);
		});

		it("should filter by maxPriority", async () => {
			const r1 = validRule({ name: "high", priority: 200 });
			const r2 = validRule({ name: "low", priority: 50 });
			await store.createRule(r1);
			await store.createRule(r2);

			const low = await store.listRules({ maxPriority: 100 });
			expect(low).toHaveLength(1);
			expect(low[0].id).toBe(r2.id);
		});

		it("should filter by priority range", async () => {
			const r1 = validRule({ name: "high", priority: 200 });
			const r2 = validRule({ name: "mid", priority: 100 });
			const r3 = validRule({ name: "low", priority: 50 });
			await store.createRule(r1);
			await store.createRule(r2);
			await store.createRule(r3);

			const mids = await store.listRules({ minPriority: 75, maxPriority: 150 });
			expect(mids).toHaveLength(1);
			expect(mids[0].id).toBe(r2.id);
		});

		it("should sort by priority descending by default", async () => {
			const r1 = validRule({ name: "low", priority: 50 });
			const r2 = validRule({ name: "high", priority: 200 });
			const r3 = validRule({ name: "mid", priority: 100 });
			await store.createRule(r1);
			await store.createRule(r2);
			await store.createRule(r3);

			const rules = await store.listRules();
			expect(rules).toHaveLength(3);
			expect(rules[0].priority).toBe(200);
			expect(rules[1].priority).toBe(100);
			expect(rules[2].priority).toBe(50);
		});

		it("should sort by priority ascending", async () => {
			const r1 = validRule({ name: "low", priority: 50 });
			const r2 = validRule({ name: "high", priority: 200 });
			await store.createRule(r1);
			await store.createRule(r2);

			const rules = await store.listRules({ sortBy: "priority", sortOrder: "asc" });
			expect(rules[0].priority).toBe(50);
			expect(rules[1].priority).toBe(200);
		});

		it("should sort by createdAt", async () => {
			const r1 = validRule({ name: "first" });
			await store.createRule(r1);
			const r2 = validRule({ name: "second" });
			await store.createRule(r2);

			const rules = await store.listRules({ sortBy: "createdAt", sortOrder: "asc" });
			expect(rules[0].name).toBe("first");
			expect(rules[1].name).toBe("second");
		});

		it("should sort by updatedAt", async () => {
			const r1 = validRule({ name: "first" });
			await store.createRule(r1);
			const r2 = validRule({ name: "second" });
			await store.createRule(r2);
			await store.updateRule(r1.id, { name: "first-updated" });

			const rules = await store.listRules({ sortBy: "updatedAt", sortOrder: "desc" });
			expect(rules[0].name).toBe("first-updated");
		});

		it("should paginate results", async () => {
			for (let i = 0; i < 10; i++) {
				await store.createRule(validRule({ name: `rule-${i}`, priority: i }));
			}

			const page1 = await store.listRules({ limit: 3, offset: 0 });
			expect(page1).toHaveLength(3);

			const page2 = await store.listRules({ limit: 3, offset: 3 });
			expect(page2).toHaveLength(3);

			// Verify no overlap
			const page1Ids = new Set(page1.map((r) => r.id));
			const page2Ids = new Set(page2.map((r) => r.id));
			for (const id of page1Ids) {
				expect(page2Ids.has(id)).toBe(false);
			}
		});

		it("should handle empty results", async () => {
			const results = await store.listRules({ action: "non_existent" });
			expect(results).toHaveLength(0);
		});
	});

	// -----------------------------------------------------------------------
	// Convenience Finders
	// -----------------------------------------------------------------------

	describe("convenience finders", () => {
		it("findByAction should find rules by action (case-insensitive)", async () => {
			const r1 = validRule({ condition: { action: "file_write" } });
			const r2 = validRule({ condition: { action: "network_access" } });
			await store.createRule(r1);
			await store.createRule(r2);

			const results = await store.findByAction("FILE_WRITE");
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(r1.id);
		});

		it("findByDecision should find rules by decision", async () => {
			const r1 = validRule({ decision: "allow" });
			const r2 = validRule({ decision: "deny" });
			await store.createRule(r1);
			await store.createRule(r2);

			const allows = await store.findByDecision("allow");
			expect(allows).toHaveLength(1);
			expect(allows[0].id).toBe(r1.id);
		});

		it("findEnabled should return only enabled rules", async () => {
			const r1 = validRule({ enabled: true });
			const r2 = validRule({ enabled: false });
			const r3 = validRule({ enabled: true });
			await store.createRule(r1);
			await store.createRule(r2);
			await store.createRule(r3);

			const enabled = await store.findEnabled();
			expect(enabled).toHaveLength(2);
		});

		it("findDisabled should return only disabled rules", async () => {
			const r1 = validRule({ enabled: true });
			const r2 = validRule({ enabled: false });
			await store.createRule(r1);
			await store.createRule(r2);

			const disabled = await store.findDisabled();
			expect(disabled).toHaveLength(1);
			expect(disabled[0].id).toBe(r2.id);
		});

		it("findByAction should return empty array when no match", async () => {
			const results = await store.findByAction("non_existent");
			expect(results).toHaveLength(0);
		});
	});

	// -----------------------------------------------------------------------
	// Conflict Detection
	// -----------------------------------------------------------------------

	describe("conflict detection", () => {
		it("should detect different_decision conflict on same action", async () => {
			const r1 = validRule({ condition: { action: "file_write" }, decision: "allow" });
			const r2 = validRule({ condition: { action: "file_write" }, decision: "deny" });
			await store.createRule(r1);
			await store.createRule(r2);

			const conflicts = await store.detectConflicts();
			expect(conflicts).toHaveLength(1);
			expect(conflicts[0].conflictType).toBe("different_decision");
			expect(conflicts[0].matchAction).toBe("file_write");
		});

		it("should detect overlap conflict on same priority", async () => {
			const r1 = validRule({ condition: { action: "file_write" }, priority: 100 });
			const r2 = validRule({ condition: { action: "file_write" }, priority: 100 });
			await store.createRule(r1);
			await store.createRule(r2);

			const conflicts = await store.detectConflicts();
			const overlaps = conflicts.filter((c) => c.conflictType === "overlap");
			expect(overlaps).toHaveLength(1);
		});

		it("should detect redundant rules", async () => {
			const r1 = validRule({
				condition: { action: "file_write", riskLevel: "low" },
				decision: "deny",
				priority: 50,
			});
			const r2 = validRule({
				condition: { action: "file_write", riskLevel: "low" },
				decision: "deny",
				priority: 100,
			});
			await store.createRule(r1);
			await store.createRule(r2);

			const conflicts = await store.detectConflicts();
			const redundants = conflicts.filter((c) => c.conflictType === "redundant");
			expect(redundants.length).toBeGreaterThanOrEqual(1);

			// The redundant rule should be the lower-priority one
			if (redundants.length > 0) {
				expect(redundants[0].ruleA.priority).toBeLessThan(redundants[0].ruleB.priority);
			}
		});

		it("should not flag rules on different actions as conflicts", async () => {
			const r1 = validRule({ condition: { action: "file_write" }, decision: "allow" });
			const r2 = validRule({ condition: { action: "network_access" }, decision: "deny" });
			await store.createRule(r1);
			await store.createRule(r2);

			const conflicts = await store.detectConflicts();
			expect(conflicts).toHaveLength(0);
		});

		it("should detect conflicts for a specific rule", async () => {
			const r1 = validRule({ condition: { action: "file_write" }, decision: "allow" });
			const r2 = validRule({ condition: { action: "file_write" }, decision: "deny" });
			const r3 = validRule({ condition: { action: "network_access" }, decision: "deny" });
			await store.createRule(r1);
			await store.createRule(r2);
			await store.createRule(r3);

			// Check conflicts for r1
			const conflicts = await store.detectConflictsForRule(r1);
			expect(conflicts).toHaveLength(1);
			expect(conflicts[0].conflictType).toBe("different_decision");

			// Check conflicts for r3 (no conflicts)
			const noConflicts = await store.detectConflictsForRule(r3);
			expect(noConflicts).toHaveLength(0);
		});

		it("should return empty array when no conflicts exist", async () => {
			const r1 = validRule({ condition: { action: "file_write" }, decision: "allow" });
			const r2 = validRule({ condition: { action: "network_access" }, decision: "deny" });
			await store.createRule(r1);
			await store.createRule(r2);

			const conflicts = await store.detectConflicts();
			expect(conflicts).toHaveLength(0);
		});

		it("should handle conflict detection with many rules", async () => {
			const rules = [
				validRule({ condition: { action: "a" }, decision: "allow" }),
				validRule({ condition: { action: "a" }, decision: "deny" }),
				validRule({ condition: { action: "b" }, decision: "allow" }),
				validRule({ condition: { action: "b" }, decision: "deny" }),
				validRule({ condition: { action: "c" }, decision: "allow" }),
			];
			for (const r of rules) {
				await store.createRule(r);
			}

			const conflicts = await store.detectConflicts();
			// a: allow vs deny → different_decision
			// b: allow vs deny → different_decision
			expect(conflicts).toHaveLength(2);
		});
	});

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	describe("stats", () => {
		it("should return empty stats when no rules exist", async () => {
			const stats = await store.getStats();
			expect(stats.totalRules).toBe(0);
			expect(stats.enabledCount).toBe(0);
			expect(stats.disabledCount).toBe(0);
			expect(stats.averagePriority).toBe(0);
			expect(stats.minPriority).toBe(0);
			expect(stats.maxPriority).toBe(0);
			expect(stats.conflictCount).toBe(0);
		});

		it("should compute correct stats from rules", async () => {
			const r1 = validRule({
				name: "allow-rule",
				condition: { action: "allow_action" },
				decision: "allow",
				enabled: true,
				priority: 100,
			});
			const r2 = validRule({
				name: "deny-rule",
				condition: { action: "deny_action" },
				decision: "deny",
				enabled: true,
				priority: 200,
			});
			const r3 = validRule({
				name: "forbid-rule",
				condition: { action: "forbid_action" },
				decision: "forbidden",
				enabled: false,
				priority: 300,
			});
			await store.createRule(r1);
			await store.createRule(r2);
			await store.createRule(r3);

			const stats = await store.getStats();
			expect(stats.totalRules).toBe(3);
			expect(stats.enabledCount).toBe(2);
			expect(stats.disabledCount).toBe(1);
			expect(stats.averagePriority).toBe(200);
			expect(stats.minPriority).toBe(100);
			expect(stats.maxPriority).toBe(300);
			expect(stats.conflictCount).toBe(0);

			expect(stats.byDecision.allow).toBe(1);
			expect(stats.byDecision.deny).toBe(1);
			expect(stats.byDecision.forbidden).toBe(1);
		});

		it("should include conflict count in stats", async () => {
			const r1 = validRule({ condition: { action: "file_write" }, decision: "allow" });
			const r2 = validRule({ condition: { action: "file_write" }, decision: "deny" });
			await store.createRule(r1);
			await store.createRule(r2);

			const stats = await store.getStats();
			expect(stats.conflictCount).toBe(1);
		});

		it("should cover all decision types in stats", async () => {
			const r1 = validRule({ decision: "allow" });
			const r2 = validRule({ decision: "deny" });
			const r3 = validRule({ decision: "approval_required" });
			const r4 = validRule({ decision: "forbidden" });
			await store.createRule(r1);
			await store.createRule(r2);
			await store.createRule(r3);
			await store.createRule(r4);

			const stats = await store.getStats();
			expect(stats.byDecision.allow).toBe(1);
			expect(stats.byDecision.deny).toBe(1);
			expect(stats.byDecision.approval_required).toBe(1);
			expect(stats.byDecision.forbidden).toBe(1);
			expect(stats.totalRules).toBe(4);
		});
	});

	// -----------------------------------------------------------------------
	// Index Management
	// -----------------------------------------------------------------------

	describe("index management", () => {
		it("should rebuild index from on-disk files", async () => {
			const r1 = validRule({ condition: { action: "file_write" }, decision: "deny" });
			const r2 = validRule({ condition: { action: "network_access" }, decision: "allow" });
			await store.createRule(r1);
			await store.createRule(r2);

			// Corrupt the index by deleting it
			const indexPath = path.join(store.getConfig().basePath, "index.json");
			await fs.unlink(indexPath);

			// Rebuild
			await store.rebuildIndex();

			// Verify lookups work after rebuild
			const rules = await store.listRules();
			expect(rules).toHaveLength(2);

			const fileWrites = await store.listRules({ action: "file_write" });
			expect(fileWrites).toHaveLength(1);
		});

		it("should rebuild index with all index categories populated", async () => {
			const r1 = validRule({
				condition: { action: "a" },
				decision: "allow",
				enabled: true,
				priority: 100,
			});
			const r2 = validRule({
				condition: { action: "b" },
				decision: "deny",
				enabled: false,
				priority: 200,
			});
			await store.createRule(r1);
			await store.createRule(r2);

			// Delete the index
			const indexPath = path.join(store.getConfig().basePath, "index.json");
			await fs.unlink(indexPath);

			// Rebuild
			await store.rebuildIndex();

			// Verify by action
			const aRules = await store.findByAction("a");
			expect(aRules).toHaveLength(1);

			const bRules = await store.findByAction("b");
			expect(bRules).toHaveLength(1);

			// Verify by decision
			const allows = await store.findByDecision("allow");
			expect(allows).toHaveLength(1);

			const denies = await store.findByDecision("deny");
			expect(denies).toHaveLength(1);

			// Verify enabled/disabled
			const enabled = await store.findEnabled();
			expect(enabled).toHaveLength(1);

			const disabled = await store.findDisabled();
			expect(disabled).toHaveLength(1);
		});

		it("should handle empty rules directory during rebuild", async () => {
			// No rules created, rebuild should not throw
			await expect(store.rebuildIndex()).resolves.toBeUndefined();

			const stats = await store.getStats();
			expect(stats.totalRules).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Persistence
	// -----------------------------------------------------------------------

	describe("persistence", () => {
		it("should persist rules across store instances", async () => {
			const basePath = path.join(TEST_DIR, "persist-test");
			const s1 = makeRuleStore(basePath);
			await s1.initialize();

			const rule = validRule();
			await s1.createRule(rule);

			// Create a new store instance pointing to the same path
			const s2 = makeRuleStore(basePath);
			await s2.initialize();

			const retrieved = await s2.getRule(rule.id);
			expect(retrieved).not.toBeNull();
			expect(retrieved!.id).toBe(rule.id);
			expect(retrieved!.name).toBe(rule.name);
		});

		it("should persist index across store instances", async () => {
			const basePath = path.join(TEST_DIR, "persist-index");
			const s1 = makeRuleStore(basePath);
			await s1.initialize();

			const r1 = validRule({ condition: { action: "file_write" }, decision: "allow" });
			const r2 = validRule({ condition: { action: "network_access" }, decision: "deny" });
			await s1.createRule(r1);
			await s1.createRule(r2);

			// New store instance
			const s2 = makeRuleStore(basePath);
			await s2.initialize();

			// Queries should work via the persisted index
			const fileWrites = await s2.findByAction("file_write");
			expect(fileWrites).toHaveLength(1);

			const denies = await s2.findByDecision("deny");
			expect(denies).toHaveLength(1);
		});
	});

	// -----------------------------------------------------------------------
	// Edge Cases
	// -----------------------------------------------------------------------

	describe("edge cases", () => {
		it("should handle action with different casing", async () => {
			const rule = validRule({ condition: { action: "FileWrite" } });
			await store.createRule(rule);

			// Look up with different case
			const results = await store.findByAction("filewrite");
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(rule.id);

			const results2 = await store.findByAction("FILEWRITE");
			expect(results2).toHaveLength(1);
		});

		it("should handle updating index when action changes", async () => {
			const rule = validRule({ condition: { action: "original_action" } });
			await store.createRule(rule);

			await store.updateRule(rule.id, { condition: { ...rule.condition, action: "new_action" } });

			const oldAction = await store.findByAction("original_action");
			expect(oldAction).toHaveLength(0);

			const newAction = await store.findByAction("new_action");
			expect(newAction).toHaveLength(1);
		});

		it("should handle updating index when decision changes", async () => {
			const rule = validRule({ decision: "deny" });
			await store.createRule(rule);

			await store.updateRule(rule.id, { decision: "allow" });

			const denys = await store.findByDecision("deny");
			expect(denys).toHaveLength(0);

			const allows = await store.findByDecision("allow");
			expect(allows).toHaveLength(1);
		});

		it("should handle updating index when enabled state changes", async () => {
			const rule = validRule({ enabled: true });
			await store.createRule(rule);

			await store.updateRule(rule.id, { enabled: false });

			const enabled = await store.findEnabled();
			expect(enabled).toHaveLength(0);

			const disabled = await store.findDisabled();
			expect(disabled).toHaveLength(1);
		});

		it("should handle rules with complex condition objects", async () => {
			const rule = validRule({
				condition: {
					action: "api_call",
					actionType: "plan_proposal",
					riskLevel: ["high", "critical"],
					minAutonomyLevel: 3,
					affectedArea: "system",
					contextMatch: { env: "production" },
				},
			});
			await store.createRule(rule);

			const retrieved = await store.getRule(rule.id);
			expect(retrieved).not.toBeNull();
			expect(retrieved!.condition.riskLevel).toEqual(["high", "critical"]);
			expect(retrieved!.condition.contextMatch).toEqual({ env: "production" });
		});

		it("should handle rules with metadata", async () => {
			const rule = validRule({
				metadata: {
					source: "user-defined",
					tags: ["critical", "security"],
					version: 1,
				},
			});
			await store.createRule(rule);

			const retrieved = await store.getRule(rule.id);
			expect(retrieved!.metadata.source).toBe("user-defined");
			expect(retrieved!.metadata.tags).toEqual(["critical", "security"]);
		});

		it("should not leave temp files behind after writes", async () => {
			const rule = validRule();
			await store.createRule(rule);

			const rulesDir = path.join(store.getConfig().basePath, "rules");
			const files = await fs.readdir(rulesDir);
			const tmpFiles = files.filter((f) => f.includes(".tmp."));
			expect(tmpFiles).toHaveLength(0);
		});

		it("should handle empty rules list", async () => {
			const rules = await store.listRules();
			expect(rules).toHaveLength(0);
		});

		it("should handle large priority values", async () => {
			const rule = validRule({ priority: Number.MAX_SAFE_INTEGER });
			await store.createRule(rule);

			const retrieved = await store.getRule(rule.id);
			expect(retrieved!.priority).toBe(Number.MAX_SAFE_INTEGER);
		});
	});

	// -----------------------------------------------------------------------
	// Model Updates and Index Consistency
	// -----------------------------------------------------------------------

	describe("index consistency", () => {
		it("should maintain index consistency across create-update-delete cycle", async () => {
			// Create
			const rule = validRule({ condition: { action: "test" } });
			await store.createRule(rule);

			let rules = await store.listRules();
			expect(rules).toHaveLength(1);

			// Update
			await store.updateRule(rule.id, { condition: { action: "changed" } });
			rules = await store.listRules({ action: "test" });
			expect(rules).toHaveLength(0);

			rules = await store.listRules({ action: "changed" });
			expect(rules).toHaveLength(1);

			// Delete
			await store.deleteRule(rule.id);
			rules = await store.listRules();
			expect(rules).toHaveLength(0);
		});

		it("should maintain enabled/disabled counts correctly after toggling", async () => {
			const rule = validRule({ enabled: true });
			await store.createRule(rule);

			// Toggle off
			await store.updateRule(rule.id, { enabled: false });
			let stats = await store.getStats();
			expect(stats.enabledCount).toBe(0);
			expect(stats.disabledCount).toBe(1);

			// Toggle back on
			await store.updateRule(rule.id, { enabled: true });
			stats = await store.getStats();
			expect(stats.enabledCount).toBe(1);
			expect(stats.disabledCount).toBe(0);
		});

		it("should handle finding a rule that was restored from disk (missed index)", async () => {
			const rule = validRule();
			await store.createRule(rule);

			// Manually remove from index (simulate corruption)
			const indexPath = path.join(store.getConfig().basePath, "index.json");
			await fs.writeFile(indexPath, JSON.stringify(store.createEmptyIndex()), "utf-8");
			store.index = store.createEmptyIndex();

			// getRule should still work and restore the index entry
			const retrieved = await store.getRule(rule.id);
			expect(retrieved).not.toBeNull();
			expect(retrieved!.id).toBe(rule.id);

			// Index should be restored
			const rules = await store.listRules();
			expect(rules).toHaveLength(1);
		});
	});
});
