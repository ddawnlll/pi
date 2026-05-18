/**
 * Tests for Queue Domain Model — P12.5.A
 *
 * Covers:
 * - Two-layer queue model type definitions
 * - Clean/dirty state classification for plan queue statuses
 * - Clean/dirty state classification for integration queue statuses
 * - Per-entry clean/dirty checks
 * - Aggregate queue clean/dirty checks
 */

import { describe, expect, it } from "vitest";
import type { IntegrationQueueEntry, IntegrationQueueStatus } from "../src/integration/queue-domain.js";
import {
	INTEGRATION_CLEAN_STATES,
	INTEGRATION_DIRTY_STATES,
	isIntegrationEntryClean,
	isIntegrationEntryDirty,
	isIntegrationQueueClean,
	isIntegrationQueueDirty,
	isIntegrationStatusClean,
	isIntegrationStatusDirty,
	isPlanEntryClean,
	isPlanEntryDirty,
	isPlanQueueClean,
	isPlanQueueDirty,
	isPlanStatusClean,
	isPlanStatusDirty,
	PLAN_CLEAN_STATES,
	PLAN_DIRTY_STATES,
	type PlanQueueEntry,
	PlanQueueEntryStatus,
} from "../src/integration/queue-domain.js";

// =========================================================================
// Plan Queue Status Classification
// =========================================================================

describe("PlanQueueStatus classification", () => {
	describe("PLAN_CLEAN_STATES", () => {
		it("includes Complete", () => {
			expect(PLAN_CLEAN_STATES.has(PlanQueueEntryStatus.Complete)).toBe(true);
		});

		it("includes Failed", () => {
			expect(PLAN_CLEAN_STATES.has(PlanQueueEntryStatus.Failed)).toBe(true);
		});

		it("includes Skipped", () => {
			expect(PLAN_CLEAN_STATES.has(PlanQueueEntryStatus.Skipped)).toBe(true);
		});

		it("includes Blocked", () => {
			expect(PLAN_CLEAN_STATES.has(PlanQueueEntryStatus.Blocked)).toBe(true);
		});

		it("excludes Pending", () => {
			expect(PLAN_CLEAN_STATES.has(PlanQueueEntryStatus.Pending)).toBe(false);
		});

		it("excludes Active", () => {
			expect(PLAN_CLEAN_STATES.has(PlanQueueEntryStatus.Active)).toBe(false);
		});

		it("contains exactly 4 clean states", () => {
			expect(PLAN_CLEAN_STATES.size).toBe(4);
		});
	});

	describe("PLAN_DIRTY_STATES", () => {
		it("includes Pending", () => {
			expect(PLAN_DIRTY_STATES.has(PlanQueueEntryStatus.Pending)).toBe(true);
		});

		it("includes Active", () => {
			expect(PLAN_DIRTY_STATES.has(PlanQueueEntryStatus.Active)).toBe(true);
		});

		it("excludes Complete", () => {
			expect(PLAN_DIRTY_STATES.has(PlanQueueEntryStatus.Complete)).toBe(false);
		});

		it("excludes Failed", () => {
			expect(PLAN_DIRTY_STATES.has(PlanQueueEntryStatus.Failed)).toBe(false);
		});

		it("excludes Skipped", () => {
			expect(PLAN_DIRTY_STATES.has(PlanQueueEntryStatus.Skipped)).toBe(false);
		});

		it("excludes Blocked", () => {
			expect(PLAN_DIRTY_STATES.has(PlanQueueEntryStatus.Blocked)).toBe(false);
		});

		it("contains exactly 2 dirty states", () => {
			expect(PLAN_DIRTY_STATES.size).toBe(2);
		});
	});

	describe("isPlanStatusClean()", () => {
		it("returns true for Complete", () => {
			expect(isPlanStatusClean(PlanQueueEntryStatus.Complete)).toBe(true);
		});

		it("returns true for Failed", () => {
			expect(isPlanStatusClean(PlanQueueEntryStatus.Failed)).toBe(true);
		});

		it("returns true for Skipped", () => {
			expect(isPlanStatusClean(PlanQueueEntryStatus.Skipped)).toBe(true);
		});

		it("returns true for Blocked", () => {
			expect(isPlanStatusClean(PlanQueueEntryStatus.Blocked)).toBe(true);
		});

		it("returns false for Pending", () => {
			expect(isPlanStatusClean(PlanQueueEntryStatus.Pending)).toBe(false);
		});

		it("returns false for Active", () => {
			expect(isPlanStatusClean(PlanQueueEntryStatus.Active)).toBe(false);
		});
	});

	describe("isPlanStatusDirty()", () => {
		it("returns true for Pending", () => {
			expect(isPlanStatusDirty(PlanQueueEntryStatus.Pending)).toBe(true);
		});

		it("returns true for Active", () => {
			expect(isPlanStatusDirty(PlanQueueEntryStatus.Active)).toBe(true);
		});

		it("returns false for Complete", () => {
			expect(isPlanStatusDirty(PlanQueueEntryStatus.Complete)).toBe(false);
		});

		it("returns false for Failed", () => {
			expect(isPlanStatusDirty(PlanQueueEntryStatus.Failed)).toBe(false);
		});

		it("returns false for Skipped", () => {
			expect(isPlanStatusDirty(PlanQueueEntryStatus.Skipped)).toBe(false);
		});

		it("returns false for Blocked", () => {
			expect(isPlanStatusDirty(PlanQueueEntryStatus.Blocked)).toBe(false);
		});
	});

	describe("clean and dirty are complementary for plan statuses", () => {
		const allStatuses = Object.values(PlanQueueEntryStatus);

		for (const status of allStatuses) {
			it(`status "${status}" is either clean or dirty (not both, not neither)`, () => {
				const clean = isPlanStatusClean(status);
				const dirty = isPlanStatusDirty(status);
				expect(clean || dirty).toBe(true);
				expect(clean && dirty).toBe(false);
			});
		}
	});
});

// =========================================================================
// Integration Queue Status Classification
// =========================================================================

describe("IntegrationQueueStatus classification", () => {
	describe("INTEGRATION_CLEAN_STATES", () => {
		it('includes "merged"', () => {
			expect(INTEGRATION_CLEAN_STATES.has("merged")).toBe(true);
		});

		it('includes "failed"', () => {
			expect(INTEGRATION_CLEAN_STATES.has("failed")).toBe(true);
		});

		it('includes "blocked"', () => {
			expect(INTEGRATION_CLEAN_STATES.has("blocked")).toBe(true);
		});

		it('includes "conflict"', () => {
			expect(INTEGRATION_CLEAN_STATES.has("conflict")).toBe(true);
		});

		it('excludes "queued"', () => {
			expect(INTEGRATION_CLEAN_STATES.has("queued")).toBe(false);
		});

		it('excludes "merging"', () => {
			expect(INTEGRATION_CLEAN_STATES.has("merging")).toBe(false);
		});

		it('excludes "validating"', () => {
			expect(INTEGRATION_CLEAN_STATES.has("validating")).toBe(false);
		});

		it("contains exactly 4 clean states", () => {
			expect(INTEGRATION_CLEAN_STATES.size).toBe(4);
		});
	});

	describe("INTEGRATION_DIRTY_STATES", () => {
		it('includes "queued"', () => {
			expect(INTEGRATION_DIRTY_STATES.has("queued")).toBe(true);
		});

		it('includes "merging"', () => {
			expect(INTEGRATION_DIRTY_STATES.has("merging")).toBe(true);
		});

		it('includes "validating"', () => {
			expect(INTEGRATION_DIRTY_STATES.has("validating")).toBe(true);
		});

		it('excludes "merged"', () => {
			expect(INTEGRATION_DIRTY_STATES.has("merged")).toBe(false);
		});

		it('excludes "failed"', () => {
			expect(INTEGRATION_DIRTY_STATES.has("failed")).toBe(false);
		});

		it('excludes "blocked"', () => {
			expect(INTEGRATION_DIRTY_STATES.has("blocked")).toBe(false);
		});

		it('excludes "conflict"', () => {
			expect(INTEGRATION_DIRTY_STATES.has("conflict")).toBe(false);
		});

		it("contains exactly 3 dirty states", () => {
			expect(INTEGRATION_DIRTY_STATES.size).toBe(3);
		});
	});

	describe("isIntegrationStatusClean()", () => {
		it('returns true for "merged"', () => {
			expect(isIntegrationStatusClean("merged")).toBe(true);
		});

		it('returns true for "failed"', () => {
			expect(isIntegrationStatusClean("failed")).toBe(true);
		});

		it('returns true for "blocked"', () => {
			expect(isIntegrationStatusClean("blocked")).toBe(true);
		});

		it('returns true for "conflict"', () => {
			expect(isIntegrationStatusClean("conflict")).toBe(true);
		});

		it('returns false for "queued"', () => {
			expect(isIntegrationStatusClean("queued")).toBe(false);
		});

		it('returns false for "merging"', () => {
			expect(isIntegrationStatusClean("merging")).toBe(false);
		});

		it('returns false for "validating"', () => {
			expect(isIntegrationStatusClean("validating")).toBe(false);
		});
	});

	describe("isIntegrationStatusDirty()", () => {
		it('returns true for "queued"', () => {
			expect(isIntegrationStatusDirty("queued")).toBe(true);
		});

		it('returns true for "merging"', () => {
			expect(isIntegrationStatusDirty("merging")).toBe(true);
		});

		it('returns true for "validating"', () => {
			expect(isIntegrationStatusDirty("validating")).toBe(true);
		});

		it('returns false for "merged"', () => {
			expect(isIntegrationStatusDirty("merged")).toBe(false);
		});

		it('returns false for "failed"', () => {
			expect(isIntegrationStatusDirty("failed")).toBe(false);
		});

		it('returns false for "blocked"', () => {
			expect(isIntegrationStatusDirty("blocked")).toBe(false);
		});

		it('returns false for "conflict"', () => {
			expect(isIntegrationStatusDirty("conflict")).toBe(false);
		});
	});

	describe("clean and dirty are complementary for integration statuses", () => {
		const allStatuses: IntegrationQueueStatus[] = [
			"queued",
			"merging",
			"validating",
			"merged",
			"failed",
			"blocked",
			"conflict",
		];

		for (const status of allStatuses) {
			it(`status "${status}" is either clean or dirty (not both, not neither)`, () => {
				const clean = isIntegrationStatusClean(status);
				const dirty = isIntegrationStatusDirty(status);
				expect(clean || dirty).toBe(true);
				expect(clean && dirty).toBe(false);
			});
		}
	});
});

// =========================================================================
// Per-Entry Classification
// =========================================================================

describe("PlanQueueEntry classification", () => {
	function makeEntry(overrides: Partial<PlanQueueEntry> = {}): PlanQueueEntry {
		return {
			id: "test-entry",
			projectId: "test-project",
			planPath: "/tmp/test-plan.json",
			status: PlanQueueEntryStatus.Pending,
			queuedAt: Date.now(),
			...overrides,
		};
	}

	describe("isPlanEntryClean()", () => {
		it("returns true for a Complete entry", () => {
			const entry = makeEntry({ status: PlanQueueEntryStatus.Complete });
			expect(isPlanEntryClean(entry)).toBe(true);
		});

		it("returns true for a Failed entry", () => {
			const entry = makeEntry({ status: PlanQueueEntryStatus.Failed });
			expect(isPlanEntryClean(entry)).toBe(true);
		});

		it("returns true for a Blocked entry", () => {
			const entry = makeEntry({ status: PlanQueueEntryStatus.Blocked });
			expect(isPlanEntryClean(entry)).toBe(true);
		});

		it("returns false for a Pending entry", () => {
			const entry = makeEntry({ status: PlanQueueEntryStatus.Pending });
			expect(isPlanEntryClean(entry)).toBe(false);
		});

		it("returns false for an Active entry", () => {
			const entry = makeEntry({ status: PlanQueueEntryStatus.Active });
			expect(isPlanEntryClean(entry)).toBe(false);
		});
	});

	describe("isPlanEntryDirty()", () => {
		it("returns true for a Pending entry", () => {
			const entry = makeEntry({ status: PlanQueueEntryStatus.Pending });
			expect(isPlanEntryDirty(entry)).toBe(true);
		});

		it("returns true for an Active entry", () => {
			const entry = makeEntry({ status: PlanQueueEntryStatus.Active });
			expect(isPlanEntryDirty(entry)).toBe(true);
		});

		it("returns false for a Complete entry", () => {
			const entry = makeEntry({ status: PlanQueueEntryStatus.Complete });
			expect(isPlanEntryDirty(entry)).toBe(false);
		});
	});
});

describe("IntegrationQueueEntry classification", () => {
	function makeEntry(overrides: Partial<IntegrationQueueEntry> = {}): IntegrationQueueEntry {
		return {
			workspaceId: "test-ws",
			status: "queued",
			commitHash: "abc123",
			queuedAt: Date.now(),
			...overrides,
		};
	}

	describe("isIntegrationEntryClean()", () => {
		it('returns true for a "merged" entry', () => {
			const entry = makeEntry({ status: "merged" });
			expect(isIntegrationEntryClean(entry)).toBe(true);
		});

		it('returns true for a "failed" entry', () => {
			const entry = makeEntry({ status: "failed" });
			expect(isIntegrationEntryClean(entry)).toBe(true);
		});

		it('returns true for a "blocked" entry', () => {
			const entry = makeEntry({ status: "blocked" });
			expect(isIntegrationEntryClean(entry)).toBe(true);
		});

		it('returns true for a "conflict" entry', () => {
			const entry = makeEntry({ status: "conflict" });
			expect(isIntegrationEntryClean(entry)).toBe(true);
		});

		it('returns false for a "queued" entry', () => {
			const entry = makeEntry({ status: "queued" });
			expect(isIntegrationEntryClean(entry)).toBe(false);
		});

		it('returns false for a "merging" entry', () => {
			const entry = makeEntry({ status: "merging" });
			expect(isIntegrationEntryClean(entry)).toBe(false);
		});

		it('returns false for a "validating" entry', () => {
			const entry = makeEntry({ status: "validating" });
			expect(isIntegrationEntryClean(entry)).toBe(false);
		});
	});

	describe("isIntegrationEntryDirty()", () => {
		it('returns true for a "queued" entry', () => {
			const entry = makeEntry({ status: "queued" });
			expect(isIntegrationEntryDirty(entry)).toBe(true);
		});

		it('returns true for a "merging" entry', () => {
			const entry = makeEntry({ status: "merging" });
			expect(isIntegrationEntryDirty(entry)).toBe(true);
		});

		it('returns true for a "validating" entry', () => {
			const entry = makeEntry({ status: "validating" });
			expect(isIntegrationEntryDirty(entry)).toBe(true);
		});

		it('returns false for a "merged" entry', () => {
			const entry = makeEntry({ status: "merged" });
			expect(isIntegrationEntryDirty(entry)).toBe(false);
		});

		it('returns false for a "failed" entry', () => {
			const entry = makeEntry({ status: "failed" });
			expect(isIntegrationEntryDirty(entry)).toBe(false);
		});
	});
});

// =========================================================================
// Aggregate Queue Classification
// =========================================================================

describe("Plan queue aggregate clean/dirty", () => {
	it("isPlanQueueClean returns true for an empty array", () => {
		expect(isPlanQueueClean([])).toBe(true);
	});

	it("isPlanQueueClean returns true when all entries are clean", () => {
		const entries: PlanQueueEntry[] = [
			{ id: "1", projectId: "p1", planPath: "/a", status: PlanQueueEntryStatus.Complete, queuedAt: 1 },
			{ id: "2", projectId: "p1", planPath: "/b", status: PlanQueueEntryStatus.Failed, queuedAt: 2 },
			{ id: "3", projectId: "p1", planPath: "/c", status: PlanQueueEntryStatus.Skipped, queuedAt: 3 },
			{ id: "4", projectId: "p1", planPath: "/d", status: PlanQueueEntryStatus.Blocked, queuedAt: 4 },
		];
		expect(isPlanQueueClean(entries)).toBe(true);
		expect(isPlanQueueDirty(entries)).toBe(false);
	});

	it("isPlanQueueDirty returns true when any entry is dirty", () => {
		const entries: PlanQueueEntry[] = [
			{ id: "1", projectId: "p1", planPath: "/a", status: PlanQueueEntryStatus.Complete, queuedAt: 1 },
			{ id: "2", projectId: "p1", planPath: "/b", status: PlanQueueEntryStatus.Pending, queuedAt: 2 },
		];
		expect(isPlanQueueDirty(entries)).toBe(true);
		expect(isPlanQueueClean(entries)).toBe(false);
	});

	it("isPlanQueueDirty returns true when an entry is Active", () => {
		const entries: PlanQueueEntry[] = [
			{ id: "1", projectId: "p1", planPath: "/a", status: PlanQueueEntryStatus.Active, queuedAt: 1 },
		];
		expect(isPlanQueueDirty(entries)).toBe(true);
		expect(isPlanQueueClean(entries)).toBe(false);
	});

	it("isPlanQueueDirty and isPlanQueueClean are complementary for non-empty arrays", () => {
		const entries: PlanQueueEntry[] = [
			{ id: "1", projectId: "p1", planPath: "/a", status: PlanQueueEntryStatus.Pending, queuedAt: 1 },
			{ id: "2", projectId: "p1", planPath: "/b", status: PlanQueueEntryStatus.Complete, queuedAt: 2 },
		];
		expect(isPlanQueueDirty(entries)).toBe(!isPlanQueueClean(entries));
	});
});

describe("Integration queue aggregate clean/dirty", () => {
	it("isIntegrationQueueClean returns true for an empty array", () => {
		expect(isIntegrationQueueClean([])).toBe(true);
	});

	it("isIntegrationQueueClean returns true when all entries are clean", () => {
		const entries: IntegrationQueueEntry[] = [
			{ workspaceId: "a", status: "merged", commitHash: "a1", queuedAt: 1 },
			{ workspaceId: "b", status: "failed", commitHash: "b1", queuedAt: 2 },
			{ workspaceId: "c", status: "blocked", commitHash: "c1", queuedAt: 3 },
			{ workspaceId: "d", status: "conflict", commitHash: "d1", queuedAt: 4 },
		];
		expect(isIntegrationQueueClean(entries)).toBe(true);
		expect(isIntegrationQueueDirty(entries)).toBe(false);
	});

	it("isIntegrationQueueDirty returns true when any entry is dirty", () => {
		const entries: IntegrationQueueEntry[] = [
			{ workspaceId: "a", status: "merged", commitHash: "a1", queuedAt: 1 },
			{ workspaceId: "b", status: "queued", commitHash: "b1", queuedAt: 2 },
		];
		expect(isIntegrationQueueDirty(entries)).toBe(true);
		expect(isIntegrationQueueClean(entries)).toBe(false);
	});

	it("isIntegrationQueueDirty returns true for a merging entry", () => {
		const entries: IntegrationQueueEntry[] = [{ workspaceId: "a", status: "merging", commitHash: "a1", queuedAt: 1 }];
		expect(isIntegrationQueueDirty(entries)).toBe(true);
	});

	it("isIntegrationQueueDirty returns true for a validating entry", () => {
		const entries: IntegrationQueueEntry[] = [
			{ workspaceId: "a", status: "validating", commitHash: "a1", queuedAt: 1 },
		];
		expect(isIntegrationQueueDirty(entries)).toBe(true);
	});

	it("isIntegrationQueueDirty and isIntegrationQueueClean are complementary for non-empty arrays", () => {
		const entries: IntegrationQueueEntry[] = [
			{ workspaceId: "a", status: "queued", commitHash: "a1", queuedAt: 1 },
			{ workspaceId: "b", status: "merged", commitHash: "b1", queuedAt: 2 },
		];
		expect(isIntegrationQueueDirty(entries)).toBe(!isIntegrationQueueClean(entries));
	});
});
