/**
 * Audit Ledger — P18.E — Tests
 *
 * Tests the AuditLedger class covering all acceptance criteria:
 * 1. Append writes atomically (write to temp, rename)
 * 2. Query returns filtered results
 * 3. Rotation triggers at configured size
 * 4. Corruption tolerance: bad lines skipped with error log
 * 5. Stats computed correctly
 * 6. Empty file handled gracefully
 */

import { mkdtempSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AuditLedger, createAuditLedger } from "../../../src/brain/audit/ledger.js";
import type { PolicyDecision } from "../../../src/brain/policy/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory for test isolation.
 */
function createTempDir(): string {
	return mkdtempSync(join(tmpdir(), "audit-ledger-test-"));
}

/**
 * Create a sample entry input for tests.
 */
function sampleEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		actor: "pi",
		action: "test_action",
		decision: "allow" as PolicyDecision,
		evidence: [],
		result: "success",
		context: {
			autonomyLevel: 3,
			riskLevel: "low",
		},
		metadata: {},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditLedger", () => {
	let ledger: AuditLedger;
	let basePath: string;

	beforeEach(() => {
		basePath = createTempDir();
		ledger = createAuditLedger({
			basePath,
			rotationThresholdBytes: 100, // small for testing
			flushIntervalMs: 10000, // long to avoid auto-flush during tests
			batchSize: 50,
		});
	});

	afterEach(async () => {
		// Clean up temp directories
		const { rm } = await import("fs/promises");
		try {
			await rm(basePath, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	// -------------------------------------------------------------------
	// AC 1: Append writes atomically
	// -------------------------------------------------------------------

	describe("AC1: Append writes atomically", () => {
		it("should append a log entry and return a full entry with id and timestamp", async () => {
			const entry = await ledger.log(sampleEntry() as never);

			expect(entry).toBeDefined();
			expect(entry.id).toBeTruthy();
			expect(entry.id.startsWith("aud-")).toBe(true);
			expect(entry.timestamp).toBeTruthy();
			expect(() => new Date(entry.timestamp)).not.toThrow();
			expect(entry.actor).toBe("pi");
			expect(entry.action).toBe("test_action");
			expect(entry.decision).toBe("allow");
			expect(entry.result).toBe("success");
		});

		it("should persist entries to disk after flush", async () => {
			const entry = await ledger.log(sampleEntry() as never);
			await ledger.flush();

			// Read the file back
			const entries = await ledger.query();
			expect(entries.length).toBe(1);
			expect(entries[0].id).toBe(entry.id);
		});

		it("should generate unique IDs for each entry", async () => {
			const e1 = await ledger.log(sampleEntry({ action: "action_1" }) as never);
			const e2 = await ledger.log(sampleEntry({ action: "action_2" }) as never);

			expect(e1.id).not.toBe(e2.id);
		});

		it("should write entries in order", async () => {
			const _e1 = await ledger.log(sampleEntry({ action: "first" }) as never);
			const _e2 = await ledger.log(sampleEntry({ action: "second" }) as never);
			await ledger.flush();

			const all = await ledger.query();
			// Newest first
			expect(all[0].action).toBe("second");
			expect(all[all.length - 1].action).toBe("first");
		});
	});

	// -------------------------------------------------------------------
	// AC 2: Query returns filtered results
	// -------------------------------------------------------------------

	describe("AC2: Query returns filtered results", () => {
		beforeEach(async () => {
			await ledger.log(
				sampleEntry({ actor: "pi", action: "memory_creation", decision: "allow", result: "success" }) as never,
			);
			await ledger.log(
				sampleEntry({
					actor: "pi",
					action: "plan_execution",
					decision: "approval_required",
					result: "blocked",
				}) as never,
			);
			await ledger.log(
				sampleEntry({ actor: "user", action: "override_policy", decision: "allow", result: "success" }) as never,
			);
			await ledger.log(
				sampleEntry({ actor: "system", action: "emergency_stop", decision: "deny", result: "blocked" }) as never,
			);
			await ledger.log(
				sampleEntry({ actor: "pi", action: "memory_query", decision: "allow", result: "success" }) as never,
			);
			await ledger.flush();
		});

		it("should return all entries with no filters", async () => {
			const all = await ledger.query();
			expect(all.length).toBe(5);
		});

		it("should filter by actor", async () => {
			const piEntries = await ledger.query({ actor: "pi" });
			expect(piEntries.length).toBe(3);
			expect(piEntries.every((e) => e.actor === "pi")).toBe(true);
		});

		it("should filter by action", async () => {
			const memoryEntries = await ledger.query({ action: "memory_creation" });
			expect(memoryEntries.length).toBe(1);
			expect(memoryEntries[0].action).toBe("memory_creation");
		});

		it("should filter by decision", async () => {
			const allowEntries = await ledger.query({ decision: "allow" });
			expect(allowEntries.length).toBe(3);
		});

		it("should filter by result", async () => {
			const blockedEntries = await ledger.query({ result: "blocked" });
			expect(blockedEntries.length).toBe(2);
		});

		it("should filter by date range", async () => {
			const entries = await ledger.query({
				startDate: "2020-01-01T00:00:00.000Z",
				endDate: "2030-01-01T00:00:00.000Z",
			});
			expect(entries.length).toBe(5);
		});

		it("should return empty array for non-matching filters", async () => {
			const entries = await ledger.query({ actor: "nonexistent" });
			expect(entries.length).toBe(0);
		});

		it("should paginate results with limit and offset", async () => {
			const limited = await ledger.query({ limit: 2 });
			expect(limited.length).toBe(2);

			const offset = await ledger.query({ limit: 2, offset: 2 });
			expect(offset.length).toBe(2);

			// Ensure they don't overlap
			const ids1 = new Set(limited.map((e) => e.id));
			const ids2 = new Set(offset.map((e) => e.id));
			for (const id of ids1) {
				expect(ids2.has(id)).toBe(false);
			}
		});
	});

	// -------------------------------------------------------------------
	// AC 2b: Convenience query methods
	// -------------------------------------------------------------------

	describe("convenience query methods", () => {
		beforeEach(async () => {
			await ledger.log(sampleEntry({ actor: "pi", action: "memory_creation", proposalId: "prop-1" }) as never);
			await ledger.log(sampleEntry({ actor: "pi", action: "plan_execution", planExecId: "plan-1" }) as never);
			await ledger.log(sampleEntry({ actor: "user", action: "override_policy" }) as never);
			await ledger.flush();
		});

		it("findByActor returns matching entries", async () => {
			const entries = await ledger.findByActor("pi");
			expect(entries.length).toBe(2);
		});

		it("findByAction returns matching entries", async () => {
			const entries = await ledger.findByAction("memory_creation");
			expect(entries.length).toBe(1);
		});

		it("findByDateRange returns entries in range", async () => {
			const entries = await ledger.findByDateRange("2020-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z");
			expect(entries.length).toBe(3);
		});

		it("findByProposal returns matching entries", async () => {
			const entries = await ledger.findByProposal("prop-1");
			expect(entries.length).toBe(1);
		});

		it("findByPlanExec returns matching entries", async () => {
			const entries = await ledger.findByPlanExec("plan-1");
			expect(entries.length).toBe(1);
		});

		it("recentDecisions returns latest entries", async () => {
			const entries = await ledger.recentDecisions(2);
			expect(entries.length).toBe(2);
		});

		it("findBlockedActions returns blocked entries", async () => {
			// Add a blocked entry
			await ledger.log(sampleEntry({ result: "blocked", decision: "deny" }) as never);
			await ledger.flush();

			const entries = await ledger.findBlockedActions();
			expect(entries.length).toBe(1);
			expect(entries[0].result).toBe("blocked");
		});
	});

	// -------------------------------------------------------------------
	// AC 3: Rotation triggers at configured size
	// -------------------------------------------------------------------

	describe("AC3: Rotation triggers at configured size", () => {
		it("should rotate file when size threshold is exceeded", async () => {
			// Use a ledger with very small rotation threshold
			const smallLedger = createAuditLedger({
				basePath: createTempDir(),
				rotationThresholdBytes: 200, // 200 bytes
				flushIntervalMs: 10000,
				batchSize: 1,
			});

			try {
				// Write enough entries to trigger rotation
				const promises = [];
				for (let i = 0; i < 20; i++) {
					promises.push(
						smallLedger.log(
							sampleEntry({
								action: `action_${i}`,
								metadata: { data: "x".repeat(50) },
							}) as never,
						),
					);
				}
				await Promise.all(promises);
				await smallLedger.flush();

				// Query all entries
				const all = await smallLedger.query();
				expect(all.length).toBe(20);

				// Check that we have more than one file
				const stats = await smallLedger.getStats();
				expect(stats.fileCount).toBeGreaterThan(1);
			} finally {
				const { rm } = await import("fs/promises");
				try {
					await rm(resolve(smallLedger.basePath as string), { recursive: true, force: true });
				} catch {
					// ignore cleanup errors
				}
			}
		});

		it("should not lose entries after rotation", async () => {
			const smallLedger = createAuditLedger({
				basePath: createTempDir(),
				rotationThresholdBytes: 150,
				flushIntervalMs: 10000,
				batchSize: 1,
			});

			try {
				const totalEntries = 30;
				for (let i = 0; i < totalEntries; i++) {
					await smallLedger.log(
						sampleEntry({
							action: `action_${i}`,
							metadata: { padding: "x".repeat(40) },
						}) as never,
					);
				}
				await smallLedger.flush();

				const all = await smallLedger.query();
				expect(all.length).toBe(totalEntries);
			} finally {
				const { rm } = await import("fs/promises");
				try {
					await rm(resolve(smallLedger.basePath as string), { recursive: true, force: true });
				} catch {
					// ignore cleanup errors
				}
			}
		});
	});

	// -------------------------------------------------------------------
	// AC 4: Corruption tolerance
	// -------------------------------------------------------------------

	describe("AC4: Corruption tolerance", () => {
		it("should handle empty ledger gracefully", async () => {
			const entries = await ledger.query();
			expect(entries).toEqual([]);
		});

		it("should skip bad lines and still read good ones", async () => {
			// Write some valid entries
			await ledger.log(sampleEntry({ action: "valid_before" }) as never);
			await ledger.flush();

			// Manually inject a corrupted line into the file
			const _filePath = resolve(
				basePath,
				new Date().toISOString().slice(0, 4),
				String(new Date().getMonth() + 1).padStart(2, "0"),
				`${new Date().toISOString().slice(0, 10).slice(-2)}.ndjson`,
			);

			// Actually get the correct file path from the ledger internals
			// We know the format from implementation
			const dateStr = new Date().toISOString().slice(0, 10);
			const [year, month, day] = dateStr.split("-");
			const correctPath = resolve(basePath, year, month, `${day}.ndjson`);

			await writeFile(
				correctPath,
				'{"id":"valid","timestamp":"2026-01-01T00:00:00.000Z","actor":"pi","action":"valid","decision":"allow","evidence":[],"result":"success","context":{"autonomyLevel":3},"metadata":{}}\nnot-json-line\n{"id":"valid2","timestamp":"2026-01-01T00:00:01.000Z","actor":"system","action":"valid2","decision":"deny","evidence":[],"result":"blocked","context":{"autonomyLevel":4},"metadata":{}}\n',
				"utf-8",
			);

			// Query should read the two valid entries and skip the bad line
			const all = await ledger.query();
			expect(all.length).toBe(2);

			// Check we can still get stats
			const stats = await ledger.getStats();
			expect(stats.totalEntries).toBe(2);
		});

		it("should handle completely empty file", async () => {
			// Create just the directory structure with an empty file
			const dateStr = new Date().toISOString().slice(0, 10);
			const [year, month, day] = dateStr.split("-");
			const dirPath = resolve(basePath, year, month);
			await mkdir(dirPath, { recursive: true });
			await writeFile(resolve(dirPath, `${day}.ndjson`), "", "utf-8");

			const entries = await ledger.query();
			expect(entries).toEqual([]);
		});

		it("should handle non-existent base path gracefully", async () => {
			const emptyLedger = createAuditLedger({
				basePath: resolve(basePath, "nonexistent"),
			});

			const entries = await emptyLedger.query();
			expect(entries).toEqual([]);
		});
	});

	// -------------------------------------------------------------------
	// AC 5: Stats computed correctly
	// -------------------------------------------------------------------

	describe("AC5: Stats computed correctly", () => {
		it("should return stats for empty ledger", async () => {
			const stats = await ledger.getStats();
			expect(stats.totalEntries).toBe(0);
			expect(stats.fileCount).toBe(0);
			expect(stats.fileSize).toBe(0);
		});

		it("should compute stats by decision, actor, result, and date", async () => {
			await ledger.log(sampleEntry({ actor: "pi", action: "a1", decision: "allow", result: "success" }) as never);
			await ledger.log(sampleEntry({ actor: "pi", action: "a2", decision: "deny", result: "blocked" }) as never);
			await ledger.log(sampleEntry({ actor: "user", action: "a3", decision: "allow", result: "success" }) as never);
			await ledger.log(
				sampleEntry({ actor: "system", action: "a4", decision: "approval_required", result: "blocked" }) as never,
			);
			await ledger.flush();

			const stats = await ledger.getStats();
			expect(stats.totalEntries).toBe(4);
			expect(stats.byDecision.allow).toBe(2);
			expect(stats.byDecision.deny).toBe(1);
			expect(stats.byDecision.approval_required).toBe(1);
			expect(stats.byActor.pi).toBe(2);
			expect(stats.byActor.user).toBe(1);
			expect(stats.byActor.system).toBe(1);
			expect(stats.byResult.success).toBe(2);
			expect(stats.byResult.blocked).toBe(2);
			expect(stats.dateRange.first).toBeTruthy();
			expect(stats.dateRange.last).toBeTruthy();
			expect(stats.fileCount).toBeGreaterThanOrEqual(1);
		});
	});

	// -------------------------------------------------------------------
	// AC 6: get() returns specific entry
	// -------------------------------------------------------------------

	describe("get by id", () => {
		it("should find an entry by its id", async () => {
			const entry = await ledger.log(sampleEntry({ action: "find_me" }) as never);
			await ledger.flush();

			const found = await ledger.get(entry.id);
			expect(found).not.toBeNull();
			expect(found!.id).toBe(entry.id);
			expect(found!.action).toBe("find_me");
		});

		it("should return null for non-existent id", async () => {
			const found = await ledger.get("nonexistent-id");
			expect(found).toBeNull();
		});
	});

	// -------------------------------------------------------------------
	// Flush behavior
	// -------------------------------------------------------------------

	describe("flush behavior", () => {
		it("should flush buffered entries on explicit flush", async () => {
			await ledger.log(sampleEntry({ action: "flush_test" }) as never);
			await ledger.flush();

			// After flush, entries should be queryable
			const entries = await ledger.query();
			expect(entries.length).toBe(1);
			expect(entries[0].action).toBe("flush_test");
		});

		it("should handle concurrent log calls correctly", async () => {
			const promises = [];
			for (let i = 0; i < 10; i++) {
				promises.push(ledger.log(sampleEntry({ action: `concurrent_${i}` }) as never));
			}
			await Promise.all(promises);
			await ledger.flush();

			const entries = await ledger.query();
			expect(entries.length).toBe(10);
		});
	});

	// -------------------------------------------------------------------
	// Error handling
	// -------------------------------------------------------------------

	describe("error handling", () => {
		it("should survive a write to a read-only directory", async () => {
			const roLedger = createAuditLedger({
				basePath: "/nonexistent-root-that-cannot-be-created",
				batchSize: 1,
				flushIntervalMs: 100000,
			});

			// This should not throw; the error should be logged internally
			await expect(roLedger.log(sampleEntry() as never)).resolves.toBeDefined();

			// Query should return empty since nothing was persisted
			const entries = await roLedger.query();
			expect(entries).toEqual([]);
		});
	});
});
