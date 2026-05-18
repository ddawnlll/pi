/**
 * Tests for Continuous Ready Queue — P12.5.E
 *
 * Acceptance Criteria:
 * 1. Ready entries are deterministic.
 * 2. Waiting reasons are emitted.
 * 3. Blocked reasons are emitted.
 */

import { describe, expect, it } from "vitest";
import {
	BLOCKED_REASON_DRAFT_GATE,
	determineReadyEntries,
	getEntryWaitingBlockedReason,
	isEntryReady,
	type ReadyQueueState,
	WAITING_REASON_DIRTY_INTEGRATION,
	WAITING_REASON_DIRTY_TREE,
	WAITING_REASON_PRIOR_BLOCKED,
	WAITING_REASON_PRIOR_FAILED,
	WAITING_REASON_SAME_PROJECT_ACTIVE,
} from "../src/core/continuous-ready-queue.js";
import { type PlanQueueEntry, PlanQueueEntryStatus } from "../src/core/plan-queue-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
	id: string,
	projectId: string,
	status: PlanQueueEntryStatus,
	overrides: Partial<PlanQueueEntry> = {},
): PlanQueueEntry {
	return {
		id,
		projectId,
		planPath: `/plans/${id}.md`,
		status,
		queuedAt: 1000,
		...overrides,
	};
}

const EMPTY_STATE: ReadyQueueState = {
	isDirty: false,
	hasDirtyIntegrationEntries: false,
	activeEntryIds: [],
	draftGateBlocked: new Map(),
};

// =========================================================================
// AC1: Ready entries are deterministic
// =========================================================================

describe("AC1: Ready entries are deterministic", () => {
	it("should produce the same result for the same inputs", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Pending),
			makeEntry("e2", "proj-2", PlanQueueEntryStatus.Pending),
		];

		const result1 = determineReadyEntries(entries, EMPTY_STATE);
		const result2 = determineReadyEntries(entries, EMPTY_STATE);

		// Same input → same output (deterministic)
		expect(result1.ready).toEqual(result2.ready);
		expect(result1.waiting).toEqual(result2.waiting);
		expect(result1.blocked).toEqual(result2.blocked);

		// Both should be ready
		expect(result1.ready).toHaveLength(2);
		expect(result1.waiting).toHaveLength(0);
		expect(result1.blocked).toHaveLength(0);
	});

	it("should produce the same result regardless of execution order", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Pending),
			makeEntry("e2", "proj-1", PlanQueueEntryStatus.Active),
		];

		const resultA = determineReadyEntries(entries, EMPTY_STATE);
		const resultB = determineReadyEntries([...entries].reverse(), EMPTY_STATE);

		// The classification should be deterministic for the same logical state
		// regardless of the order we present entries; results should still
		// have the same classifications
		expect(resultA.waiting).toHaveLength(1);
		expect(resultB.waiting).toHaveLength(1);
		expect(resultA.ready).toHaveLength(1);
		expect(resultB.ready).toHaveLength(1);
	});

	it("should classify single pending entry as ready in clean state", () => {
		const entries = [makeEntry("e1", "proj-1", PlanQueueEntryStatus.Pending)];
		const result = determineReadyEntries(entries, EMPTY_STATE);

		expect(result.ready).toHaveLength(1);
		expect(result.ready[0].entry.id).toBe("e1");
		expect(result.ready[0].readiness).toBe("ready");
		expect(result.waiting).toHaveLength(0);
		expect(result.blocked).toHaveLength(0);
	});

	it("should classify multiple pending entries from different projects as ready", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Pending),
			makeEntry("e2", "proj-2", PlanQueueEntryStatus.Pending),
			makeEntry("e3", "proj-3", PlanQueueEntryStatus.Pending),
		];
		const result = determineReadyEntries(entries, EMPTY_STATE);

		expect(result.ready).toHaveLength(3);
		expect(result.waiting).toHaveLength(0);
		expect(result.blocked).toHaveLength(0);
	});

	it("should handle empty entry list deterministically", () => {
		const result1 = determineReadyEntries([], EMPTY_STATE);
		const result2 = determineReadyEntries([], EMPTY_STATE);

		expect(result1).toEqual(result2);
		expect(result1.ready).toHaveLength(0);
		expect(result1.waiting).toHaveLength(0);
		expect(result1.blocked).toHaveLength(0);
	});

	it("should not include terminal entries in ready/waiting/blocked", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Complete),
			makeEntry("e2", "proj-2", PlanQueueEntryStatus.Failed),
			makeEntry("e3", "proj-3", PlanQueueEntryStatus.Skipped),
			makeEntry("e4", "proj-4", PlanQueueEntryStatus.Pending),
		];
		const result = determineReadyEntries(entries, EMPTY_STATE);

		expect(result.ready).toHaveLength(1);
		expect(result.ready[0].entry.id).toBe("e4");
	});
});

// =========================================================================
// AC2: Waiting reasons are emitted
// =========================================================================

describe("AC2: Waiting reasons are emitted", () => {
	it("should emit waiting reason when another plan for same project is active", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Active),
			makeEntry("e2", "proj-1", PlanQueueEntryStatus.Pending),
		];
		const result = determineReadyEntries(entries, EMPTY_STATE);

		expect(result.waiting).toHaveLength(1);
		expect(result.waiting[0].entry.id).toBe("e2");
		expect(result.waiting[0].readiness).toBe("waiting");
		expect(result.waiting[0].reason).toBe(WAITING_REASON_SAME_PROJECT_ACTIVE);
	});

	it("should emit waiting reason when working tree is dirty", () => {
		const entries = [makeEntry("e1", "proj-1", PlanQueueEntryStatus.Pending)];
		const state: ReadyQueueState = {
			...EMPTY_STATE,
			isDirty: true,
		};
		const result = determineReadyEntries(entries, state);

		expect(result.waiting).toHaveLength(1);
		expect(result.waiting[0].entry.id).toBe("e1");
		expect(result.waiting[0].reason).toBe(WAITING_REASON_DIRTY_TREE);
	});

	it("should emit waiting reason when integration queue has dirty entries", () => {
		const entries = [makeEntry("e1", "proj-1", PlanQueueEntryStatus.Pending)];
		const state: ReadyQueueState = {
			...EMPTY_STATE,
			hasDirtyIntegrationEntries: true,
		};
		const result = determineReadyEntries(entries, state);

		expect(result.waiting).toHaveLength(1);
		expect(result.waiting[0].entry.id).toBe("e1");
		expect(result.waiting[0].reason).toBe(WAITING_REASON_DIRTY_INTEGRATION);
	});

	it("should emit waiting reason when prior plan in same project failed", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Failed),
			makeEntry("e2", "proj-1", PlanQueueEntryStatus.Pending),
		];
		const result = determineReadyEntries(entries, EMPTY_STATE);

		// e1 is terminal (Failed) → excluded
		// e2 is pending after a failed entry in the same project → waiting
		expect(result.waiting).toHaveLength(1);
		expect(result.waiting[0].entry.id).toBe("e2");
		expect(result.waiting[0].reason).toBe(WAITING_REASON_PRIOR_FAILED);
		expect(result.ready).toHaveLength(0);
	});

	it("should emit waiting reason when prior plan in same project is blocked", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Blocked),
			makeEntry("e2", "proj-1", PlanQueueEntryStatus.Pending),
		];
		const result = determineReadyEntries(entries, EMPTY_STATE);

		// e1 is blocked → classified as blocked
		// e2 is pending after a blocked entry in the same project → waiting
		expect(result.blocked).toHaveLength(1);
		expect(result.blocked[0].entry.id).toBe("e1");
		expect(result.waiting).toHaveLength(1);
		expect(result.waiting[0].entry.id).toBe("e2");
		expect(result.waiting[0].reason).toBe(WAITING_REASON_PRIOR_BLOCKED);
	});

	it("should emit waiting reasons with proper reasons for each waiting entry", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Active),
			makeEntry("e2", "proj-1", PlanQueueEntryStatus.Pending),
			makeEntry("e3", "proj-2", PlanQueueEntryStatus.Pending),
		];
		const state: ReadyQueueState = {
			...EMPTY_STATE,
			isDirty: true,
		};
		const result = determineReadyEntries(entries, state);

		// e1 is active → ready
		// e2 is pending but same project active → waiting (same project active)
		// e3 is pending but tree is dirty → waiting (dirty tree)

		// Since dirty tree is checked before same-project-active,
		// both e2 and e3 get dirty-tree reason
		expect(result.waiting).toHaveLength(2);
		for (const w of result.waiting) {
			expect(w.reason).toBeTruthy();
		}
	});
});

// =========================================================================
// AC3: Blocked reasons are emitted
// =========================================================================

describe("AC3: Blocked reasons are emitted", () => {
	it("should emit blocked reason for entries with Blocked status", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Blocked, {
				blockReason: "Dirty working tree: uncommitted changes detected",
			}),
		];
		const result = determineReadyEntries(entries, EMPTY_STATE);

		expect(result.blocked).toHaveLength(1);
		expect(result.blocked[0].entry.id).toBe("e1");
		expect(result.blocked[0].readiness).toBe("blocked");
		expect(result.blocked[0].reason).toBe("Dirty working tree: uncommitted changes detected");
	});

	it("should emit blocked reason with fallback when blockReason is not set", () => {
		const entries = [makeEntry("e1", "proj-1", PlanQueueEntryStatus.Blocked)];
		const result = determineReadyEntries(entries, EMPTY_STATE);

		expect(result.blocked).toHaveLength(1);
		expect(result.blocked[0].reason).toBe("Blocked (no reason provided)");
	});

	it("should emit blocked reason for draft gate blocked entries", () => {
		const entries = [makeEntry("e1", "proj-1", PlanQueueEntryStatus.Pending)];
		const state: ReadyQueueState = {
			...EMPTY_STATE,
			draftGateBlocked: new Map([["e1", "Draft plan cannot be executed by non-lead agent"]]),
		};
		const result = determineReadyEntries(entries, state);

		expect(result.blocked).toHaveLength(1);
		expect(result.blocked[0].entry.id).toBe("e1");
		expect(result.blocked[0].reason).toBe("Draft plan cannot be executed by non-lead agent");
	});

	it("should include draft gate blocked reason constant", () => {
		expect(BLOCKED_REASON_DRAFT_GATE).toBe("Blocked by draft execution gate");
	});

	it("should emit blocked reason that stops downstream entries", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Blocked, {
				blockReason: "Integration queue not clean",
			}),
			makeEntry("e2", "proj-1", PlanQueueEntryStatus.Pending),
		];
		const result = determineReadyEntries(entries, EMPTY_STATE);

		// e1 is blocked with its reason
		expect(result.blocked).toHaveLength(1);
		expect(result.blocked[0].reason).toBe("Integration queue not clean");

		// e2 is waiting (downstream of a blocked entry in same project)
		expect(result.waiting).toHaveLength(1);
		expect(result.waiting[0].reason).toBe(WAITING_REASON_PRIOR_BLOCKED);
	});
});

// =========================================================================
// Edge Cases
// =========================================================================

describe("Edge cases", () => {
	it("should handle mixed statuses correctly", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Complete),
			makeEntry("e2", "proj-1", PlanQueueEntryStatus.Active),
			makeEntry("e3", "proj-1", PlanQueueEntryStatus.Pending),
			makeEntry("e4", "proj-2", PlanQueueEntryStatus.Pending),
			makeEntry("e5", "proj-2", PlanQueueEntryStatus.Failed),
		];
		const result = determineReadyEntries(entries, EMPTY_STATE);

		// e1: Complete → excluded
		// e2: Active → ready
		// e3: Pending, same project as Active → waiting
		// e4: Pending, different project → ready
		// e5: Failed → excluded
		expect(result.ready).toHaveLength(2);
		expect(result.ready.map((r) => r.entry.id).sort()).toEqual(["e2", "e4"]);
		expect(result.waiting).toHaveLength(1);
		expect(result.waiting[0].entry.id).toBe("e3");
	});

	it("should handle entries with unknown status as waiting", () => {
		const entry = makeEntry("e1", "proj-1", "unknown" as PlanQueueEntryStatus);
		const result = determineReadyEntries([entry], EMPTY_STATE);

		expect(result.waiting).toHaveLength(1);
		expect(result.waiting[0].reason).toContain("Unknown status");
	});

	it("dirty tree overrides same-project-active for Pending entries", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Active),
			makeEntry("e2", "proj-1", PlanQueueEntryStatus.Pending),
		];
		const state: ReadyQueueState = {
			...EMPTY_STATE,
			isDirty: true,
		};
		const result = determineReadyEntries(entries, state);

		// Dirty tree is checked first, so e2 gets dirty-tree reason
		// rather than same-project-active reason
		expect(result.waiting).toHaveLength(1);
		expect(result.waiting[0].reason).toBe(WAITING_REASON_DIRTY_TREE);
	});

	it("draft gate blocked takes priority over dirty tree", () => {
		const entries = [makeEntry("e1", "proj-1", PlanQueueEntryStatus.Pending)];
		const state: ReadyQueueState = {
			isDirty: true,
			hasDirtyIntegrationEntries: false,
			activeEntryIds: [],
			draftGateBlocked: new Map([["e1", "Not authorized"]]),
		};
		const result = determineReadyEntries(entries, state);

		// Draft gate is checked first, so e1 is blocked, not waiting
		expect(result.blocked).toHaveLength(1);
		expect(result.waiting).toHaveLength(0);
	});
});

// =========================================================================
// Convenience functions
// =========================================================================

describe("isEntryReady()", () => {
	it("should return true for ready entries", () => {
		const entries = [makeEntry("e1", "proj-1", PlanQueueEntryStatus.Pending)];
		const result = isEntryReady(entries[0], entries, EMPTY_STATE);
		expect(result).toBe(true);
	});

	it("should return false for waiting entries", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Active),
			makeEntry("e2", "proj-1", PlanQueueEntryStatus.Pending),
		];
		const result = isEntryReady(entries[1], entries, EMPTY_STATE);
		expect(result).toBe(false);
	});

	it("should return false for blocked entries", () => {
		const entries = [makeEntry("e1", "proj-1", PlanQueueEntryStatus.Blocked)];
		const result = isEntryReady(entries[0], entries, EMPTY_STATE);
		expect(result).toBe(false);
	});
});

describe("getEntryWaitingBlockedReason()", () => {
	it("should return reason for waiting entries", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Active),
			makeEntry("e2", "proj-1", PlanQueueEntryStatus.Pending),
		];
		const reason = getEntryWaitingBlockedReason(entries[1], entries, EMPTY_STATE);
		expect(reason).toBe(WAITING_REASON_SAME_PROJECT_ACTIVE);
	});

	it("should return reason for blocked entries", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Blocked, {
				blockReason: "Dirty tree",
			}),
		];
		const reason = getEntryWaitingBlockedReason(entries[0], entries, EMPTY_STATE);
		expect(reason).toBe("Dirty tree");
	});

	it("should return undefined for ready entries", () => {
		const entries = [makeEntry("e1", "proj-1", PlanQueueEntryStatus.Pending)];
		const reason = getEntryWaitingBlockedReason(entries[0], entries, EMPTY_STATE);
		expect(reason).toBeUndefined();
	});
});

// =========================================================================
// Determinism verification with varying parameters
// =========================================================================

describe("Determinism across multiple runs", () => {
	it("should produce identical results across 10 repeated runs", () => {
		const entries = [
			makeEntry("e1", "proj-1", PlanQueueEntryStatus.Active),
			makeEntry("e2", "proj-1", PlanQueueEntryStatus.Pending),
			makeEntry("e3", "proj-2", PlanQueueEntryStatus.Pending),
			makeEntry("e4", "proj-1", PlanQueueEntryStatus.Blocked, {
				blockReason: "Test block",
			}),
			makeEntry("e5", "proj-3", PlanQueueEntryStatus.Pending),
		];

		// Run many times with the same state
		const state: ReadyQueueState = {
			isDirty: false,
			hasDirtyIntegrationEntries: true,
			activeEntryIds: ["e1"],
			draftGateBlocked: new Map([["e5", "Draft gate"]]),
		};

		const first = determineReadyEntries(entries, state);

		for (let i = 0; i < 10; i++) {
			const iter = determineReadyEntries(entries, state);
			expect(iter).toEqual(first);
		}
	});

	it("should produce different results for different state", () => {
		const entries = [makeEntry("e1", "proj-1", PlanQueueEntryStatus.Pending)];

		const cleanResult = determineReadyEntries(entries, EMPTY_STATE);
		const dirtyResult = determineReadyEntries(entries, { ...EMPTY_STATE, isDirty: true });

		// Different state → different results
		expect(cleanResult.ready).toHaveLength(1);
		expect(dirtyResult.waiting).toHaveLength(1);
	});
});
