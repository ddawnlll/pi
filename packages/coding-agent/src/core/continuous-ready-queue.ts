/**
 * Continuous Ready Queue — P12.5.E
 *
 * Deterministic readiness determination for plan queue entries.
 *
 * Given a list of plan queue entries and the current execution state,
 * classifies each entry as one of:
 *
 * - **ready**: The entry is eligible to execute immediately.
 * - **waiting**: The entry is pending but cannot execute yet, with an
 *   explanation of why (e.g., prior plan for same project is active).
 * - **blocked**: The entry is permanently blocked, with a reason why.
 *
 * All classifications are **deterministic**: the same inputs always
 * produce the same output.
 *
 * Acceptance Criteria:
 *   1. Ready entries are deterministic.
 *   2. Waiting reasons are emitted.
 *   3. Blocked reasons are emitted.
 */

import { type PlanQueueEntry, PlanQueueEntryStatus } from "./plan-queue-runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Readiness classification for a single queue entry.
 */
export type EntryReadiness = "ready" | "waiting" | "blocked";

/**
 * A single queue entry with its readiness classification and reason.
 */
export interface ReadyQueueEntry {
	/** The queue entry */
	entry: PlanQueueEntry;
	/** Readiness classification */
	readiness: EntryReadiness;
	/**
	 * Human-readable reason for the classification.
	 * - For "waiting": explains what the entry is waiting for.
	 * - For "blocked": explains why the entry is blocked.
	 * - For "ready": undefined (no reason needed).
	 */
	reason?: string;
}

/**
 * Result of a readiness determination run.
 */
export interface ReadyQueueDetermination {
	/** Entries that are ready to execute, in queue order */
	ready: ReadyQueueEntry[];
	/** Entries that are waiting (not yet ready), with reasons */
	waiting: ReadyQueueEntry[];
	/** Entries that are blocked, with reasons */
	blocked: ReadyQueueEntry[];
}

/**
 * External state snapshot used to determine readiness.
 *
 * Passed explicitly so the function is pure and deterministic:
 * the same state always produces the same classification.
 */
export interface ReadyQueueState {
	/**
	 * Whether the working tree has uncommitted changes.
	 * When true, no entries can become ready (they become waiting or blocked).
	 */
	isDirty: boolean;

	/**
	 * Whether the integration queue has unresolved dirty entries.
	 * When true, the next plan cannot start.
	 */
	hasDirtyIntegrationEntries: boolean;

	/**
	 * IDs of entries that are currently in "active" execution status.
	 * Used to enforce the one-active-plan-per-project constraint.
	 */
	activeEntryIds: string[];

	/**
	 * Entries that are blocked due to draft gate failures.
	 * Maps entry ID to the blocked reason string.
	 */
	draftGateBlocked: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Reason string emitted when an entry is waiting because another plan
 * for the same project is currently active.
 */
export const WAITING_REASON_SAME_PROJECT_ACTIVE =
	"Waiting for active plan in same project to complete";

/**
 * Reason string emitted when an entry is waiting because the working
 * tree is dirty.
 */
export const WAITING_REASON_DIRTY_TREE =
	"Waiting for working tree to become clean (uncommitted changes)";

/**
 * Reason string emitted when an entry is waiting because the integration
 * queue has unresolved dirty entries.
 */
export const WAITING_REASON_DIRTY_INTEGRATION =
	"Waiting for integration queue to resolve";

/**
 * Reason string emitted when an entry is waiting because a prior plan
 * in the same project failed and stopOnFailure is enabled.
 */
export const WAITING_REASON_PRIOR_FAILED =
	"Waiting: prior plan in same project failed (stop-on-failure)";

/**
 * Reason string emitted when an entry is waiting because a prior plan
 * in the same project is blocked.
 */
export const WAITING_REASON_PRIOR_BLOCKED =
	"Waiting: prior plan in same project is blocked";

/**
 * Reason string emitted when an entry is blocked by the draft gate.
 */
export const BLOCKED_REASON_DRAFT_GATE =
	"Blocked by draft execution gate";

// ---------------------------------------------------------------------------
// Deterministic Readiness Determination
// ---------------------------------------------------------------------------

/**
 * Determine the readiness of all entries in a plan queue.
 *
 * This function is **deterministic**: the same `entries` and `state`
 * arguments always produce the same `ReadyQueueDetermination` result.
 *
 * Classification rules (in order of evaluation):
 *
 * 1. **Blocked** entries (status === Blocked) → classified as "blocked"
 *    with their existing blockReason.
 *
 * 2. **Complete / Failed / Skipped** entries → excluded from the result
 *    (they are terminal and no longer relevant to readiness).
 *
 * 3. **Active** entries → classified as "ready" (they are already running).
 *
 * 4. **Pending** entries are classified as follows:
 *    a. If the draft gate blocks this entry → "blocked".
 *    b. If the working tree is dirty → "waiting" with dirty-tree reason.
 *    c. If the integration queue has dirty entries → "waiting" with
 *       integration-queue reason.
 *    d. If another entry for the same project is active → "waiting" with
 *       same-project-active reason.
 *    e. If a prior entry for the same project is blocked or failed
 *       (and stop-on-failure would apply) → "waiting" with prior-failed
 *       or prior-blocked reason.
 *    f. Otherwise → "ready".
 *
 * If none of the blocking/waiting conditions apply and the entry is
 * Pending, it is classified as "ready".
 *
 * @param entries - All plan queue entries, in queue order.
 * @param state   - External state snapshot for deterministic evaluation.
 * @returns Deterministic readiness classification.
 */
export function determineReadyEntries(
	entries: PlanQueueEntry[],
	state: ReadyQueueState,
): ReadyQueueDetermination {
	const ready: ReadyQueueEntry[] = [];
	const waiting: ReadyQueueEntry[] = [];
	const blocked: ReadyQueueEntry[] = [];

	// Track project-level constraints: for each project, track the status
	// of prior entries that may block later ones.
	const projectPriorFailed = new Map<string, boolean>();
	const projectPriorBlocked = new Map<string, boolean>();
	const projectHasActiveEntry = new Map<string, boolean>();

	// First pass: determine active entries per project
	for (const entry of entries) {
		if (entry.status === PlanQueueEntryStatus.Active) {
			projectHasActiveEntry.set(entry.projectId, true);
		}
	}

	// Second pass: classify each entry deterministically
	for (const entry of entries) {
		// Track prior-entry status for project-level constraints
		// BEFORE skipping terminal entries — we need to know if a prior
		// plan failed/blocked even when those entries are not in the result.
		if (entry.status === PlanQueueEntryStatus.Failed) {
			projectPriorFailed.set(entry.projectId, true);
		}
		if (entry.status === PlanQueueEntryStatus.Blocked) {
			projectPriorBlocked.set(entry.projectId, true);
		}

		// Skip terminal entries (not relevant to readiness output)
		if (
			entry.status === PlanQueueEntryStatus.Complete ||
			entry.status === PlanQueueEntryStatus.Failed ||
			entry.status === PlanQueueEntryStatus.Skipped
		) {
			continue;
		}

		// Blocked entries (already tracked above for projectPriorBlocked)
		if (entry.status === PlanQueueEntryStatus.Blocked) {
			blocked.push({
				entry,
				readiness: "blocked",
				reason: entry.blockReason ?? "Blocked (no reason provided)",
			});
			continue;
		}

		// Active entries are running
		if (entry.status === PlanQueueEntryStatus.Active) {
			ready.push({
				entry,
				readiness: "ready",
			});
			continue;
		}

		// Pending entries — evaluate conditions
		if (entry.status === PlanQueueEntryStatus.Pending) {
			// Check draft gate
			const draftReason = state.draftGateBlocked.get(entry.id);
			if (draftReason) {
				blocked.push({
					entry,
					readiness: "blocked",
					reason: draftReason,
				});
				projectPriorBlocked.set(entry.projectId, true);
				continue;
			}

			// Check dirty working tree
			if (state.isDirty) {
				waiting.push({
					entry,
					readiness: "waiting",
					reason: WAITING_REASON_DIRTY_TREE,
				});
				projectPriorBlocked.set(entry.projectId, true);
				continue;
			}

			// Check integration queue
			if (state.hasDirtyIntegrationEntries) {
				waiting.push({
					entry,
					readiness: "waiting",
					reason: WAITING_REASON_DIRTY_INTEGRATION,
				});
				projectPriorBlocked.set(entry.projectId, true);
				continue;
			}

			// Check if another entry for the same project is active
			if (projectHasActiveEntry.get(entry.projectId)) {
				waiting.push({
					entry,
					readiness: "waiting",
					reason: WAITING_REASON_SAME_PROJECT_ACTIVE,
				});
				continue;
			}

			// Check if a prior entry for the same project failed or blocked
			if (projectPriorFailed.get(entry.projectId)) {
				waiting.push({
					entry,
					readiness: "waiting",
					reason: WAITING_REASON_PRIOR_FAILED,
				});
				continue;
			}

			if (projectPriorBlocked.get(entry.projectId)) {
				waiting.push({
					entry,
					readiness: "waiting",
					reason: WAITING_REASON_PRIOR_BLOCKED,
				});
				continue;
			}

			// Otherwise, the entry is ready
			ready.push({
				entry,
				readiness: "ready",
			});
			continue;
		}

		// Fallback: any other status is treated as waiting
		waiting.push({
			entry,
			readiness: "waiting",
			reason: `Unknown status: ${entry.status}`,
		});
	}

	return { ready, waiting, blocked };
}

/**
 * Deterministically check whether a specific entry is ready to execute.
 *
 * This is a convenience wrapper around `determineReadyEntries` that
 * checks a single entry by looking at its classification in the full
 * queue context.
 *
 * @param entry    - The entry to check.
 * @param entries  - All queue entries (for context).
 * @param state    - External state snapshot.
 * @returns The readiness classification for the entry.
 */
export function isEntryReady(
	entry: PlanQueueEntry,
	entries: PlanQueueEntry[],
	state: ReadyQueueState,
): boolean {
	const result = determineReadyEntries(entries, state);
	return result.ready.some((r) => r.entry.id === entry.id);
}

/**
 * Get the reason an entry is waiting or blocked.
 *
 * @param entry    - The entry to check.
 * @param entries  - All queue entries (for context).
 * @param state    - External state snapshot.
 * @returns The reason string, or undefined if the entry is ready.
 */
export function getEntryWaitingBlockedReason(
	entry: PlanQueueEntry,
	entries: PlanQueueEntry[],
	state: ReadyQueueState,
): string | undefined {
	const result = determineReadyEntries(entries, state);
	const found = [...result.waiting, ...result.blocked].find((r) => r.entry.id === entry.id);
	return found?.reason;
}
