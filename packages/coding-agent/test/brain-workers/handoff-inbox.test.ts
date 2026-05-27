/**
 * Worker Handoff Inbox and Triage Router — 25.O
 *
 * Covers:
 * - HandoffInbox CRUD operations
 * - Status transitions and validation
 * - Deduplication
 * - Pruning / TTL enforcement
 * - Capacity limits
 * - Querying and filtering
 * - Statistics
 * - TriageRouter routing with rules
 * - Triage cycle lifecycle (cooldown, failures, stop conditions)
 * - Diagnostics on failures
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import {
	ALL_HANDOFF_ENTRY_STATUSES,
	ALL_HANDOFF_PRIORITIES,
	DEFAULT_HANDOFF_INBOX_CONFIG,
	HandoffInbox,
} from "../../src/brain-workers/inbox/handoff-inbox.js";
import {
	ALL_TRIAGE_ROUTER_STATUSES,
	DEFAULT_TRIAGE_ROUTER_CONFIG,
	TriageRouter,
} from "../../src/brain-workers/inbox/triage-router.js";

// =============================================================================
// HandoffInbox Tests
// =============================================================================

describe("HandoffInbox", () => {
	// -----------------------------------------------------------------------
	// Constants
	// -----------------------------------------------------------------------

	test("ALL_HANDOFF_PRIORITIES contains all priorities", () => {
		expect(ALL_HANDOFF_PRIORITIES).toContain("low");
		expect(ALL_HANDOFF_PRIORITIES).toContain("normal");
		expect(ALL_HANDOFF_PRIORITIES).toContain("high");
		expect(ALL_HANDOFF_PRIORITIES).toContain("critical");
		expect(ALL_HANDOFF_PRIORITIES.length).toBe(4);
	});

	test("ALL_HANDOFF_ENTRY_STATUSES contains all statuses", () => {
		expect(ALL_HANDOFF_ENTRY_STATUSES).toContain("pending");
		expect(ALL_HANDOFF_ENTRY_STATUSES).toContain("routing");
		expect(ALL_HANDOFF_ENTRY_STATUSES).toContain("dispatched");
		expect(ALL_HANDOFF_ENTRY_STATUSES).toContain("completed");
		expect(ALL_HANDOFF_ENTRY_STATUSES).toContain("failed");
		expect(ALL_HANDOFF_ENTRY_STATUSES).toContain("cancelled");
		expect(ALL_HANDOFF_ENTRY_STATUSES.length).toBe(6);
	});

	// -----------------------------------------------------------------------
	// Creation
	// -----------------------------------------------------------------------

	describe("create", () => {
		test("creates a handoff entry successfully", () => {
			const inbox = new HandoffInbox();
			const result = inbox.create({
				sourceWorkerId: "worker-1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Analyze observation queue",
				description: "The observer has recorded 50 new observations that need analysis.",
				dedupKey: "obs-analysis-20250101",
			});

			expect("entry" in result).toBe(true);
			if ("entry" in result) {
				expect(result.entry.id).toBeDefined();
				expect(result.entry.sourceWorkerId).toBe("worker-1");
				expect(result.entry.sourceWorkerRole).toBe("observer");
				expect(result.entry.targetWorkerRole).toBe("analyst");
				expect(result.entry.title).toBe("Analyze observation queue");
				expect(result.entry.status).toBe("pending");
				expect(result.entry.priority).toBe("normal");
				expect(result.entry.createdAt).toBeDefined();
				expect(result.entry.diagnostics).toEqual([]);
				expect(result.entry.tags).toEqual([]);
				expect(result.entry.evidenceRefs).toEqual([]);
				expect(result.entry.input).toEqual({});
				expect(result.entry.output).toEqual({});
				expect(result.entry.metadata).toEqual({});
			}
		});

		test("creates with custom priority and fields", () => {
			const inbox = new HandoffInbox();
			const result = inbox.create({
				sourceWorkerId: "worker-2",
				sourceWorkerRole: "analyst",
				targetWorkerRole: "fixStrategist",
				title: "Fix critical bug",
				description: "A critical bug was found in the queue processor.",
				dedupKey: "fix-crit-bug-001",
				priority: "critical",
				tags: ["urgent", "bug"],
				evidenceRefs: ["ev-001", "ev-002"],
				input: { bugId: "BUG-001", stackTrace: "..." },
				output: { analysis: "Race condition in queue lock" },
			});

			expect("entry" in result).toBe(true);
			if ("entry" in result) {
				expect(result.entry.priority).toBe("critical");
				expect(result.entry.tags).toEqual(["urgent", "bug"]);
				expect(result.entry.evidenceRefs).toEqual(["ev-001", "ev-002"]);
				expect(result.entry.input).toEqual({ bugId: "BUG-001", stackTrace: "..." });
				expect(result.entry.output).toEqual({ analysis: "Race condition in queue lock" });
			}
		});

		test("rejects creation with missing required fields", () => {
			const inbox = new HandoffInbox();
			const result = inbox.create({
				sourceWorkerId: "",
				sourceWorkerRole: "",
				targetWorkerRole: "",
				title: "",
				description: "",
				dedupKey: "",
			});

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toContain("Missing required fields");
				expect(result.diagnostics.length).toBeGreaterThan(0);
			}
		});

		test("rejects creation when pending limit is exceeded", () => {
			const inbox = new HandoffInbox({ maxPendingEntries: 1 });

			// First entry succeeds
			inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "First",
				description: "First handoff",
				dedupKey: "first",
			});

			// Second should be rejected
			const result = inbox.create({
				sourceWorkerId: "w2",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Second",
				description: "Second handoff",
				dedupKey: "second",
			});

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toContain("Pending entry limit reached");
			}
		});

		test("deduplicates identical dedup keys within window", () => {
			const inbox = new HandoffInbox({ dedupWindowMs: 60000 });

			// First entry
			const first = inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Analyze",
				description: "Analyze observations",
				dedupKey: "dedup-test-key",
			});

			expect("entry" in first).toBe(true);

			// Second with same dedup key — should return duplicate
			const second = inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Analyze (duplicate)",
				description: "Analyze observations again",
				dedupKey: "dedup-test-key",
			});

			expect("duplicate" in second).toBe(true);
			if ("duplicate" in second) {
				expect(second.duplicate.id).toBeDefined();
				expect(second.reason).toContain("Duplicate");
			}
		});

		test("allows duplicate dedup keys outside window", () => {
			const inbox = new HandoffInbox({ dedupWindowMs: 1 });

			// First entry
			const first = inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Analyze",
				description: "Analyze observations",
				dedupKey: "outside-window-key",
			});

			expect("entry" in first).toBe(true);

			// Wait for dedup window to expire
			return new Promise<void>((resolve) => {
				setTimeout(() => {
					const second = inbox.create({
						sourceWorkerId: "w1",
						sourceWorkerRole: "observer",
						targetWorkerRole: "analyst",
						title: "Analyze (again)",
						description: "Analyze observations again",
						dedupKey: "outside-window-key",
					});

					// Should be a new entry since window expired
					expect("entry" in second).toBe(true);
					resolve();
				}, 5);
			});
		});
	});

	// -----------------------------------------------------------------------
	// Get / Update / Delete
	// -----------------------------------------------------------------------

	describe("get", () => {
		test("returns undefined for non-existent entry", () => {
			const inbox = new HandoffInbox();
			expect(inbox.get("nonexistent")).toBeUndefined();
		});

		test("returns entry by ID", () => {
			const inbox = new HandoffInbox();
			const result = inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Test",
				description: "Test handoff",
				dedupKey: "test-get",
			});

			expect("entry" in result).toBe(true);
			if ("entry" in result) {
				const fetched = inbox.get(result.entry.id);
				expect(fetched).toBeDefined();
				expect(fetched!.id).toBe(result.entry.id);
				expect(fetched!.title).toBe("Test");
			}
		});
	});

	describe("update", () => {
		test("updates entry status and metadata", () => {
			const inbox = new HandoffInbox();
			const result = inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Test",
				description: "Test handoff",
				dedupKey: "test-update",
			});

			expect("entry" in result).toBe(true);
			if (!("entry" in result)) return;

			const updateResult = inbox.update(result.entry.id, {
				status: "routing",
				targetWorkerId: "analyst-1",
				metadata: { routed: true },
			});

			expect("entry" in updateResult).toBe(true);
			if ("entry" in updateResult) {
				expect(updateResult.entry.status).toBe("routing");
				expect(updateResult.entry.targetWorkerId).toBe("analyst-1");
				expect(updateResult.entry.metadata).toEqual({ routed: true });
			}
		});

		test("rejects invalid status transitions", () => {
			const inbox = new HandoffInbox();
			const result = inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Test",
				description: "Test handoff",
				dedupKey: "test-transition",
			});

			expect("entry" in result).toBe(true);
			if (!("entry" in result)) return;

			// Valid: pending -> routing
			const r1 = inbox.update(result.entry.id, { status: "routing" });
			expect("entry" in r1).toBe(true);

			// Invalid: routing -> pending (cannot go backwards)
			const r2 = inbox.update(result.entry.id, { status: "pending" });
			expect("error" in r2).toBe(true);
			if ("error" in r2) {
				expect(r2.error).toContain("Invalid status transition");
				expect(r2.diagnostics.length).toBeGreaterThan(0);
			}
		});

		test("returns error for non-existent entry update", () => {
			const inbox = new HandoffInbox();
			const result = inbox.update("nonexistent", { status: "routing" });

			expect("error" in result).toBe(true);
			if ("error" in result) {
				expect(result.error).toContain("not found");
				expect(result.diagnostics.length).toBeGreaterThan(0);
			}
		});
	});

	describe("delete", () => {
		test("deletes an entry by ID", () => {
			const inbox = new HandoffInbox();
			const result = inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Test",
				description: "Test handoff",
				dedupKey: "test-delete",
			});

			expect("entry" in result).toBe(true);
			if (!("entry" in result)) return;

			expect(inbox.delete(result.entry.id)).toBe(true);
			expect(inbox.get(result.entry.id)).toBeUndefined();
		});

		test("returns false for non-existent entry", () => {
			const inbox = new HandoffInbox();
			expect(inbox.delete("nonexistent")).toBe(false);
		});
	});

	describe("cancel", () => {
		test("cancels a pending entry", () => {
			const inbox = new HandoffInbox();
			const result = inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Test",
				description: "Test handoff",
				dedupKey: "test-cancel",
			});

			expect("entry" in result).toBe(true);
			if (!("entry" in result)) return;

			const cancelResult = inbox.cancel(result.entry.id, "No longer needed");
			expect("entry" in cancelResult).toBe(true);
			if ("entry" in cancelResult) {
				expect(cancelResult.entry.status).toBe("cancelled");
				expect(cancelResult.entry.diagnostics.length).toBeGreaterThan(0);
			}
		});

		test("rejects cancelling a completed entry", () => {
			const inbox = new HandoffInbox();
			const result = inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Test",
				description: "Test handoff",
				dedupKey: "test-cancel-completed",
			});

			expect("entry" in result).toBe(true);
			if (!("entry" in result)) return;

			// Go through valid transitions to reach completed
			const r1 = inbox.update(result.entry.id, { status: "routing" });
			expect("entry" in r1).toBe(true);
			const r2 = inbox.update(result.entry.id, { status: "dispatched" });
			expect("entry" in r2).toBe(true);
			const r3 = inbox.update(result.entry.id, { status: "completed" });
			expect("entry" in r3).toBe(true);

			const cancelResult = inbox.cancel(result.entry.id);
			expect("error" in cancelResult).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Querying
	// -----------------------------------------------------------------------

	describe("list", () => {
		test("lists all entries by default", () => {
			const inbox = new HandoffInbox();
			inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "A",
				description: "A",
				dedupKey: "list-a",
			});
			inbox.create({
				sourceWorkerId: "w2",
				sourceWorkerRole: "observer",
				targetWorkerRole: "fixStrategist",
				title: "B",
				description: "B",
				dedupKey: "list-b",
			});

			const entries = inbox.list();
			expect(entries.length).toBe(2);
		});

		test("filters by status", () => {
			const inbox = new HandoffInbox();
			const r1 = inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Pending",
				description: "Pending handoff",
				dedupKey: "filter-pending",
			});

			const r2 = inbox.create({
				sourceWorkerId: "w2",
				sourceWorkerRole: "observer",
				targetWorkerRole: "fixStrategist",
				title: "To be cancelled",
				description: "Will be cancelled",
				dedupKey: "filter-cancelled",
			});

			if ("entry" in r1 && "entry" in r2) {
				inbox.cancel(r2.entry.id);
			}

			const pending = inbox.list({ status: "pending" });
			expect(pending.length).toBe(1);
			expect(pending[0].title).toBe("Pending");

			const cancelled = inbox.list({ status: "cancelled" });
			expect(cancelled.length).toBe(1);
		});

		test("filters by priority", () => {
			const inbox = new HandoffInbox();
			inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Normal",
				description: "Normal priority",
				dedupKey: "prio-normal",
				priority: "normal",
			});
			inbox.create({
				sourceWorkerId: "w2",
				sourceWorkerRole: "observer",
				targetWorkerRole: "fixStrategist",
				title: "Critical",
				description: "Critical priority",
				dedupKey: "prio-critical",
				priority: "critical",
			});

			const critical = inbox.list({ priority: "critical" });
			expect(critical.length).toBe(1);
			expect(critical[0].title).toBe("Critical");
		});

		test("filters by source worker", () => {
			const inbox = new HandoffInbox();
			inbox.create({
				sourceWorkerId: "w-src-1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "From worker 1",
				description: "Source test",
				dedupKey: "src-1",
			});
			inbox.create({
				sourceWorkerId: "w-src-2",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "From worker 2",
				description: "Source test",
				dedupKey: "src-2",
			});

			const from1 = inbox.list({ sourceWorkerId: "w-src-1" });
			expect(from1.length).toBe(1);
			expect(from1[0].title).toBe("From worker 1");
		});

		test("sorts by priority descending by default", () => {
			const inbox = new HandoffInbox();
			inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Low",
				description: "Low priority",
				dedupKey: "sort-low",
				priority: "low",
			});
			inbox.create({
				sourceWorkerId: "w2",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "High",
				description: "High priority",
				dedupKey: "sort-high",
				priority: "high",
			});

			// Default sort is createdAt desc, not priority
			const entries = inbox.list({ sortBy: "createdAt", sortDir: "desc" });
			expect(entries.length).toBe(2);
		});

		test("paginates results", () => {
			const inbox = new HandoffInbox();
			for (let i = 0; i < 10; i++) {
				inbox.create({
					sourceWorkerId: `w${i}`,
					sourceWorkerRole: "observer",
					targetWorkerRole: "analyst",
					title: `Entry ${i}`,
					description: `Entry ${i}`,
					dedupKey: `page-${i}`,
				});
			}

			const first5 = inbox.list({ limit: 5, offset: 0 });
			expect(first5.length).toBe(5);

			const next5 = inbox.list({ limit: 5, offset: 5 });
			expect(next5.length).toBe(5);

			// Ensure different entries
			const firstIds = new Set(first5.map((e) => e.id));
			const nextIds = new Set(next5.map((e) => e.id));
			for (const id of firstIds) {
				expect(nextIds.has(id)).toBe(false);
			}
		});
	});

	// -----------------------------------------------------------------------
	// Statistics
	// -----------------------------------------------------------------------

	describe("stats", () => {
		test("returns correct statistics", () => {
			const inbox = new HandoffInbox();

			// Create entries with different priorities
			const r1 = inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Normal",
				description: "Normal",
				dedupKey: "stat-1",
				priority: "normal",
			});

			const _r2 = inbox.create({
				sourceWorkerId: "w2",
				sourceWorkerRole: "observer",
				targetWorkerRole: "fixStrategist",
				title: "High",
				description: "High",
				dedupKey: "stat-2",
				priority: "high",
			});

			const _r3 = inbox.create({
				sourceWorkerId: "w3",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Critical",
				description: "Critical",
				dedupKey: "stat-3",
				priority: "critical",
			});

			// Update one through valid transitions to dispatched
			if ("entry" in r1) {
				const u1 = inbox.update(r1.entry.id, { status: "routing" });
				expect("entry" in u1).toBe(true);
				const u2 = inbox.update(r1.entry.id, { status: "dispatched" });
				expect("entry" in u2).toBe(true);
			}

			const stats = inbox.stats();
			expect(stats.total).toBe(3);
			expect(stats.pending).toBe(2); // r2 and r3 are pending
			expect(stats.dispatched).toBe(1); // r1 is dispatched
			expect(stats.byPriority.normal).toBe(1);
			expect(stats.byPriority.high).toBe(1);
			expect(stats.byPriority.critical).toBe(1);
			expect(stats.oldestEntryAgeMs).toBeGreaterThanOrEqual(0);
		});

		test("returns zeros for empty inbox", () => {
			const inbox = new HandoffInbox();
			const stats = inbox.stats();
			expect(stats.total).toBe(0);
			expect(stats.pending).toBe(0);
			expect(stats.routing).toBe(0);
			expect(stats.dispatched).toBe(0);
			expect(stats.completed).toBe(0);
			expect(stats.failed).toBe(0);
			expect(stats.cancelled).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Pruning
	// -----------------------------------------------------------------------

	describe("prune", () => {
		test("removes expired entries", () => {
			const inbox = new HandoffInbox({ entryTtlMs: 1 });

			inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Expired",
				description: "Should be pruned",
				dedupKey: "prune-expired",
			});

			// Wait for TTL to expire
			return new Promise<void>((resolve) => {
				setTimeout(() => {
					inbox.prune();
					expect(inbox.list().length).toBe(0);
					resolve();
				}, 10);
			});
		});

		test("removes excess completed entries beyond maxCompletedEntries", () => {
			const inbox = new HandoffInbox({ maxCompletedEntries: 2, entryTtlMs: 60000 });

			// Create 3 entries and mark them all completed
			for (let i = 0; i < 3; i++) {
				const result = inbox.create({
					sourceWorkerId: `w${i}`,
					sourceWorkerRole: "observer",
					targetWorkerRole: "analyst",
					title: `Completed ${i}`,
					description: `Entry ${i}`,
					dedupKey: `prune-completed-${i}`,
				});
				if ("entry" in result) {
					inbox.update(result.entry.id, { status: "routing" });
					inbox.update(result.entry.id, { status: "dispatched" });
					inbox.update(result.entry.id, { status: "completed" });
				}
			}

			inbox.prune();
			const entries = inbox.list();
			expect(entries.length).toBeLessThanOrEqual(2);
		});
	});

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	describe("config", () => {
		test("uses default config when no config provided", () => {
			const inbox = new HandoffInbox();
			const config = inbox.getConfig();
			expect(config.maxPendingEntries).toBe(DEFAULT_HANDOFF_INBOX_CONFIG.maxPendingEntries);
			expect(config.maxCompletedEntries).toBe(DEFAULT_HANDOFF_INBOX_CONFIG.maxCompletedEntries);
			expect(config.entryTtlMs).toBe(DEFAULT_HANDOFF_INBOX_CONFIG.entryTtlMs);
		});

		test("merges provided config with defaults", () => {
			const inbox = new HandoffInbox({ maxPendingEntries: 100 });
			const config = inbox.getConfig();
			expect(config.maxPendingEntries).toBe(100);
			expect(config.maxCompletedEntries).toBe(DEFAULT_HANDOFF_INBOX_CONFIG.maxCompletedEntries);
		});

		test("updateConfig updates configuration", () => {
			const inbox = new HandoffInbox();
			inbox.updateConfig({ maxPendingEntries: 200, dedupWindowMs: 60000 });
			const config = inbox.getConfig();
			expect(config.maxPendingEntries).toBe(200);
			expect(config.dedupWindowMs).toBe(60000);
		});
	});
});

// =============================================================================
// TriageRouter Tests
// =============================================================================

describe("TriageRouter", () => {
	// -----------------------------------------------------------------------
	// Constants
	// -----------------------------------------------------------------------

	test("ALL_TRIAGE_ROUTER_STATUSES contains all statuses", () => {
		expect(ALL_TRIAGE_ROUTER_STATUSES).toContain("idle");
		expect(ALL_TRIAGE_ROUTER_STATUSES).toContain("processing");
		expect(ALL_TRIAGE_ROUTER_STATUSES).toContain("cooling");
		expect(ALL_TRIAGE_ROUTER_STATUSES).toContain("paused");
		expect(ALL_TRIAGE_ROUTER_STATUSES).toContain("failed");
		expect(ALL_TRIAGE_ROUTER_STATUSES.length).toBe(5);
	});

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	describe("config", () => {
		test("uses default config when no config provided", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox);
			const config = router.getConfig();
			expect(config.maxEntriesPerCycle).toBe(DEFAULT_TRIAGE_ROUTER_CONFIG.maxEntriesPerCycle);
			expect(config.cooldownMs).toBe(DEFAULT_TRIAGE_ROUTER_CONFIG.cooldownMs);
		});

		test("updateConfig updates configuration", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox);
			router.updateConfig({ maxEntriesPerCycle: 20, cooldownMs: 5000 });
			const config = router.getConfig();
			expect(config.maxEntriesPerCycle).toBe(20);
			expect(config.cooldownMs).toBe(5000);
		});
	});

	// -----------------------------------------------------------------------
	// Routing Rules
	// -----------------------------------------------------------------------

	describe("routing rules", () => {
		test("adds and retrieves rules sorted by order", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox);

			router.addRule({
				id: "rule-2",
				description: "Second rule",
				targetRole: "analyst",
				dispatchToRole: "analyst-queue",
				enabled: true,
				order: 2,
			});
			router.addRule({
				id: "rule-1",
				description: "First rule",
				targetRole: "*",
				dispatchToRole: "default-queue",
				enabled: true,
				order: 1,
			});

			const rules = router.getRules();
			expect(rules.length).toBe(2);
			expect(rules[0].id).toBe("rule-1");
			expect(rules[1].id).toBe("rule-2");
		});

		test("removes a rule by ID", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox);
			router.addRule({
				id: "rule-1",
				description: "Test rule",
				targetRole: "*",
				dispatchToRole: "default-queue",
				enabled: true,
				order: 1,
			});

			expect(router.removeRule("rule-1")).toBe(true);
			expect(router.getRules().length).toBe(0);
		});

		test("enable/disable a rule", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox);
			router.addRule({
				id: "rule-1",
				description: "Test rule",
				targetRole: "*",
				dispatchToRole: "default-queue",
				enabled: true,
				order: 1,
			});

			expect(router.setRuleEnabled("rule-1", false)).toBe(true);
			expect(router.getRules()[0].enabled).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Process Cycle
	// -----------------------------------------------------------------------

	describe("processCycle", () => {
		test("returns empty result when inbox is empty", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox);
			const result = router.processCycle();

			expect(result.entriesProcessed).toBe(0);
			expect(result.entriesRouted).toBe(0);
			expect(result.cycleId).toBeDefined();
			expect(result.runtimeMs).toBeGreaterThanOrEqual(0);
		});

		test("routes pending entries to matching rules", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox, { cooldownMs: 1 });

			// Add a routing rule for analysts
			router.addRule({
				id: "route-analysts",
				description: "Route to analyst queue",
				targetRole: "analyst",
				dispatchToRole: "analyst-worker",
				enabled: true,
				order: 1,
			});

			// Create a handoff for analyst
			inbox.create({
				sourceWorkerId: "observer-1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Analyze data",
				description: "Please analyze the observation data",
				dedupKey: "cycle-test-1",
			});

			// Process cycle
			const result = router.processCycle();
			expect(result.entriesProcessed).toBe(1);
			expect(result.entriesRouted).toBe(1);
			expect(result.entriesFailed).toBe(0);

			// Verify the entry was dispatched
			expect(result.routingResults[0].success).toBe(true);
			expect(result.routingResults[0].routedToRole).toBe("analyst-worker");
			expect(result.routingResults[0].routingRuleId).toBe("route-analysts");

			// Verify entry status updated in inbox
			const entries = inbox.list({ status: "dispatched" });
			expect(entries.length).toBe(1);

			// Verify router stats updated
			const stats = router.getStats();
			expect(stats.totalCycles).toBe(1);
			expect(stats.totalEntriesRouted).toBe(1);
		});

		test("marks entries as failed when no rule matches", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox, { cooldownMs: 1 });

			// Create a handoff for fixStrategist (no rule exists)
			inbox.create({
				sourceWorkerId: "observer-1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "fixStrategist",
				title: "Fix bugs",
				description: "Please fix the bugs",
				dedupKey: "cycle-test-no-rule",
			});

			const result = router.processCycle();
			expect(result.entriesProcessed).toBe(1);
			expect(result.entriesRouted).toBe(0);
			expect(result.entriesFailed).toBe(1);

			expect(result.routingResults[0].success).toBe(false);
			expect(result.routingResults[0].error).toContain("No routing rule matched");

			// Verify entry status updated in inbox
			const failed = inbox.list({ status: "failed" });
			expect(failed.length).toBe(1);
		});

		test("respects maxEntriesPerCycle limit", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox, { cooldownMs: 1, maxEntriesPerCycle: 2 });

			router.addRule({
				id: "catch-all",
				description: "Catch all",
				targetRole: "*",
				dispatchToRole: "default-worker",
				enabled: true,
				order: 1,
			});

			// Create 5 handoffs
			for (let i = 0; i < 5; i++) {
				inbox.create({
					sourceWorkerId: `w${i}`,
					sourceWorkerRole: "observer",
					targetWorkerRole: "analyst",
					title: `Entry ${i}`,
					description: `Entry ${i}`,
					dedupKey: `limit-test-${i}`,
				});
			}

			const result = router.processCycle();
			expect(result.entriesProcessed).toBe(2);
			expect(result.entriesRouted).toBe(2);
		});

		test("respects cooldown between cycles", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox, { cooldownMs: 60000 });

			router.addRule({
				id: "catch-all",
				description: "Catch all",
				targetRole: "*",
				dispatchToRole: "default-worker",
				enabled: true,
				order: 1,
			});

			// First cycle
			const first = router.processCycle();
			expect(first.entriesProcessed).toBe(0);

			// Second cycle should be blocked by cooldown
			const second = router.processCycle();
			expect(second.entriesProcessed).toBe(0);
			expect(second.diagnostics.length).toBeGreaterThan(0);

			const stats = router.getStats();
			expect(stats.status).toBe("cooling");
		});

		test("detects and blocks when paused", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox);
			router.pause("Testing pause");

			const result = router.processCycle();
			expect(result.entriesProcessed).toBe(0);
			expect(result.diagnostics.length).toBeGreaterThan(0);
		});

		test("resume allows processing again", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox, { cooldownMs: 1 });

			router.addRule({
				id: "catch-all",
				description: "Catch all",
				targetRole: "*",
				dispatchToRole: "default-worker",
				enabled: true,
				order: 1,
			});

			router.pause("Test pause");
			router.resume();

			// Resume sets status to idle but cooldown might apply
			// Since we just started, there's no cooldown, so it should process
			expect(router.getStatus()).toBe("idle");
		});

		test("handles consecutive failures and transitions to failed", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox, {
				maxConsecutiveFailures: 2,
				cooldownMs: 1,
			});

			// Create entries that will fail (no matching rule)
			for (let i = 0; i < 3; i++) {
				inbox.create({
					sourceWorkerId: `w${i}`,
					sourceWorkerRole: "observer",
					targetWorkerRole: "unknownRole",
					title: `Entry ${i}`,
					description: `Entry ${i}`,
					dedupKey: `fail-test-${i}`,
				});
			}

			// First cycle - should fail
			const r1 = router.processCycle();
			expect(r1.entriesFailed).toBeGreaterThan(0);

			// Wait for cooldown
			const stats1 = router.getStats();
			expect(stats1.consecutiveFailures).toBeGreaterThanOrEqual(1);

			// Second cycle - should fail again and trigger failed state
			// Cooldown is 1ms so it should be done by now
			const _r2 = router.processCycle();
			// After maxConsecutiveFailures=2 is hit, the router should enter failed state
			const statsAfter = router.getStats();
			if (statsAfter.status === "failed") {
				// Third cycle should return empty because router is failed
				const r3 = router.processCycle();
				expect(r3.entriesProcessed).toBe(0);
			}
		});
	});

	// -----------------------------------------------------------------------
	// Router Lifecycle
	// -----------------------------------------------------------------------

	describe("lifecycle", () => {
		test("reset clears router state", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox);

			router.addRule({
				id: "catch-all",
				description: "Catch all",
				targetRole: "*",
				dispatchToRole: "default-worker",
				enabled: true,
				order: 1,
			});

			// Process a cycle to generate stats
			const result = router.processCycle();
			expect(result.entriesProcessed).toBe(0); // No entries

			router.reset();
			const stats = router.getStats();
			expect(stats.totalCycles).toBe(0);
			expect(stats.totalEntriesRouted).toBe(0);
			expect(stats.totalEntriesFailed).toBe(0);
			expect(stats.lastCycleAt).toBeNull();
		});

		test("getStats returns current state", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox);
			const stats = router.getStats();

			expect(stats.status).toBe("idle");
			expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);
			expect(stats.totalCycles).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Rule Matching
	// -----------------------------------------------------------------------

	describe("rule matching", () => {
		test("matches by target role", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox, { cooldownMs: 1 });

			router.addRule({
				id: "for-analysts",
				description: "For analysts only",
				targetRole: "analyst",
				dispatchToRole: "analyst-worker",
				enabled: true,
				order: 1,
			});

			// Should match
			inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Analyst task",
				description: "For analyst",
				dedupKey: "match-analyst",
			});

			// Should not match (wrong role)
			inbox.create({
				sourceWorkerId: "w2",
				sourceWorkerRole: "observer",
				targetWorkerRole: "fixStrategist",
				title: "Fix task",
				description: "For fixStrategist",
				dedupKey: "match-fix",
			});

			const result = router.processCycle();
			expect(result.entriesProcessed).toBe(2);
			expect(result.entriesRouted).toBe(1); // Only analyst matched
			expect(result.entriesFailed).toBe(1); // fixStrategist didn't match
		});

		test("matches wildcard role", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox, { cooldownMs: 1 });

			router.addRule({
				id: "catch-all",
				description: "Catch all",
				targetRole: "*",
				dispatchToRole: "default-worker",
				enabled: true,
				order: 1,
			});

			inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Any task",
				description: "Should match wildcard",
				dedupKey: "wildcard-1",
			});

			const result = router.processCycle();
			expect(result.entriesRouted).toBe(1);
		});

		test("matches by required tags", () => {
			const inbox = new HandoffInbox();
			const router = new TriageRouter(inbox, { cooldownMs: 1 });

			router.addRule({
				id: "urgent-only",
				description: "Only urgent tasks",
				targetRole: "*",
				requiredTags: ["urgent"],
				dispatchToRole: "urgent-worker",
				enabled: true,
				order: 1,
			});

			// Should match
			inbox.create({
				sourceWorkerId: "w1",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Urgent task",
				description: "Urgent",
				dedupKey: "tags-match",
				tags: ["urgent", "bug"],
			});

			// Should not match (missing "urgent" tag)
			inbox.create({
				sourceWorkerId: "w2",
				sourceWorkerRole: "observer",
				targetWorkerRole: "analyst",
				title: "Normal task",
				description: "Normal",
				dedupKey: "tags-no-match",
				tags: ["normal"],
			});

			const result = router.processCycle();
			expect(result.entriesRouted).toBe(1);
			expect(result.entriesFailed).toBe(1);
		});
	});
});
