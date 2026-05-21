/**
 * Proposal Inbox — P16.E Top-3 Inbox Logic
 *
 * Selects, ranks, and diversifies pending proposals for user-facing
 * display. The inbox shows the top 3 (configurable) highest-scoring
 * proposals, with at most 2 of the same type, each accompanied by
 * an evidence summary and a recommendation label.
 *
 * ## Selection Algorithm (in order)
 *
 * 1. **Fetch**: Retrieve all pending_approval proposals from the store
 * 2. **Rank**: Sort by score.total descending, then by urgency descending
 * 3. **Diversify**: Allow at most `maxPerType` proposals of the same type
 * 4. **Limit**: Take the top `topCount` proposals
 * 5. **Recommend**: Classify each as auto_approve, review, or reject
 *    - auto_approve: score.total >= 0.7 AND score.confidence >= 0.6
 *    - reject: score.total < 0.3
 *    - review: everything else
 *
 * ## Expiry
 *
 * Proposals older than `expirePendingDays` are auto-expired on refresh.
 *
 * ## Acceptance Criteria
 * 1. Returns exactly top 3 (or fewer if not enough)
 * 2. No more than 2 of same type
 * 3. Sorted by score descending
 * 4. Each entry has evidence summary
 * 5. Clear recommendation label
 * 6. Updates on accept/reject
 *
 * @packageDocumentation
 */

import type { InboxEntry, InboxView, Proposal, ProposalStore } from "./types.js";
import { DEFAULT_AUTO_QUEUE_CONFIDENCE_MIN, DEFAULT_AUTO_QUEUE_TOTAL_THRESHOLD } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Proposal Inbox.
 */
export interface InboxConfig {
	/** Maximum number of proposals to display (default: 3) */
	topCount: number;
	/** Maximum proposals of the same type (default: 2) */
	maxPerType: number;
	/** Whether to include proposals nearing expiry (default: true) */
	includeExpiring: boolean;
	/** Days after which a pending proposal auto-expires (default: 7) */
	expirePendingDays: number;
}

/**
 * Default inbox configuration.
 */
export const DEFAULT_INBOX_CONFIG: InboxConfig = {
	topCount: 3,
	maxPerType: 2,
	includeExpiring: true,
	expirePendingDays: 7,
};

// ---------------------------------------------------------------------------
// Inbox Stats
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics for the proposal inbox.
 */
export interface InboxStats {
	/** Number of proposals currently pending approval */
	totalPending: number;
	/** Number of pending proposals that would auto-approve */
	autoApproved: number;
	/** Number of pending proposals flagged as urgent */
	urgentCount: number;
	/** Number of proposals expired in the last refresh */
	expiredCount: number;
}

// ---------------------------------------------------------------------------
// ProposalInbox
// ---------------------------------------------------------------------------

/**
 * Inbox for selecting, ranking, and presenting top proposals to the user.
 *
 * The inbox queries the ProposalStore for pending_approval proposals,
 * applies scoring-based ranking with type diversification, generates
 * recommendation labels and evidence-backed reasons, and tracks expiry.
 *
 * Usage:
 * ```typescript
 * const inbox = new ProposalInbox(store);
 * const view = await inbox.getInbox();
 * // view.entries[0].recommendation === "auto_approve"
 * ```
 */
export class ProposalInbox {
	private config: InboxConfig;
	private store: ProposalStore;

	/**
	 * @param store - The proposal store for CRUD operations
	 * @param config - Optional partial configuration overrides
	 */
	constructor(store: ProposalStore, config?: Partial<InboxConfig>) {
		this.store = store;
		this.config = {
			...DEFAULT_INBOX_CONFIG,
			...config,
		};
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Get the current inbox configuration (read-only snapshot).
	 *
	 * @returns A shallow copy of the current config
	 */
	getConfig(): InboxConfig {
		return { ...this.config };
	}

	/**
	 * Update the inbox configuration.
	 *
	 * Only provided fields are changed; others keep their current values.
	 *
	 * @param config - Partial configuration to apply
	 */
	setConfig(config: Partial<InboxConfig>): void {
		this.config = {
			...this.config,
			...config,
		};
	}

	// -----------------------------------------------------------------------
	// Core Inbox
	// -----------------------------------------------------------------------

	/**
	 * Get the current inbox view.
	 *
	 * Fetches pending_approval proposals, ranks, diversifies, limits
	 * to topCount, generates recommendations with evidence summaries,
	 * and auto-expires stale proposals.
	 *
	 * @returns The InboxView with entries and summary stats
	 */
	async getInbox(): Promise<InboxView> {
		// 1. Auto-expire old proposals first
		await this.expireOldProposals();

		// 2. Fetch all pending_approval proposals
		const pending = await this.store.list({ status: ["pending_approval"] });

		// 3. Select top N with diversification
		const selected = this.selectTopProposals(pending);

		// 4. Build inbox entries
		const entries: InboxEntry[] = selected.map((proposal, index) => this.buildEntry(proposal, index + 1));

		return {
			entries,
			totalPending: pending.length,
			lastUpdated: new Date().toISOString(),
		};
	}

	/**
	 * Force-refresh the inbox.
	 *
	 * Equivalent to calling getInbox(), but explicitly signals
	 * that the caller intends to refresh stale data. Currently
	 * delegates to getInbox() since auto-expiry runs every time.
	 */
	async refreshInbox(): Promise<InboxView> {
		return this.getInbox();
	}

	// -----------------------------------------------------------------------
	// Selection Logic
	// -----------------------------------------------------------------------

	/**
	 * Rank proposals by score descending.
	 *
	 * Primary sort: score.total descending (highest first).
	 * Tie-breaker: score.urgency descending (most urgent first).
	 * Final tie-breaker: createdAt descending (newest first).
	 *
	 * @param proposals - Proposals to rank
	 * @returns Ranked proposals (highest score first)
	 */
	rankProposals(proposals: Proposal[]): Proposal[] {
		return [...proposals].sort((a, b) => {
			// Primary: total score descending
			const scoreDiff = b.score.total - a.score.total;
			if (scoreDiff !== 0) return scoreDiff;

			// Tie-breaker: urgency descending
			const urgencyDiff = b.score.urgency - a.score.urgency;
			if (urgencyDiff !== 0) return urgencyDiff;

			// Final tie-breaker: newest first
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
		});
	}

	/**
	 * Diversify proposals by type.
	 *
	 * Ensures at most `maxPerType` proposals of the same type appear
	 * in the result. Iterates through ranked proposals and includes
	 * each proposal if its type count hasn't reached the limit yet.
	 *
	 * Unlike selectTopProposals, this method does NOT limit the result
	 * to topCount; it only applies the per-type cap.
	 *
	 * @param proposals - Ranked proposals to diversify
	 * @returns Diversified proposals in rank order (not limited to topCount)
	 */
	diversifyProposals(proposals: Proposal[]): Proposal[] {
		const typeCount = new Map<string, number>();
		const result: Proposal[] = [];

		for (const proposal of proposals) {
			const current = typeCount.get(proposal.type) ?? 0;
			if (current < this.config.maxPerType) {
				result.push(proposal);
				typeCount.set(proposal.type, current + 1);
			}
		}

		return result;
	}

	/**
	 * Select the top N proposals from a set.
	 *
	 * Combines ranking, diversification (round-robin by type), and limiting.
	 *
	 * Algorithm:
	 * 1. Rank proposals by score descending
	 * 2. Group by type and take the top `maxPerType` per type
	 * 3. Interleave by type (round-robin) to maximize diversity
	 * 4. Take `topCount` proposals
	 *
	 * The round-robin interleaving ensures that the result set has maximal
	 * type diversity: we pick one from each type before picking a second
	 * from any type.
	 *
	 * @param proposals - Raw proposals (any status)
	 * @returns Top N diversified proposals (sorted by score within diversity constraints)
	 */
	selectTopProposals(proposals: Proposal[]): Proposal[] {
		if (proposals.length === 0) return [];

		// 1. Rank
		const ranked = this.rankProposals(proposals);

		// 2. Group by type, taking at most maxPerType per type
		const byType = new Map<string, Proposal[]>();
		for (const p of ranked) {
			const arr = byType.get(p.type) ?? [];
			if (arr.length < this.config.maxPerType) {
				arr.push(p);
				byType.set(p.type, arr);
			}
		}

		// 3. Round-robin interleave: collect type keys in a stable order
		const typeOrder = Array.from(byType.keys());
		const used = new Map<string, number>();
		for (const t of typeOrder) used.set(t, 0);

		const result: Proposal[] = [];
		while (result.length < this.config.topCount) {
			let anyAdded = false;
			for (const type of typeOrder) {
				if (result.length >= this.config.topCount) break;
				const idx = used.get(type) ?? 0;
				const candidates = byType.get(type)!;
				if (idx < candidates.length) {
					result.push(candidates[idx]);
					used.set(type, idx + 1);
					anyAdded = true;
				}
			}
			if (!anyAdded) break; // No more candidates
		}

		return result;
	}

	// -----------------------------------------------------------------------
	// Recommendation
	// -----------------------------------------------------------------------

	/**
	 * Generate a recommendation label for a proposal.
	 *
	 * Rules:
	 *   - auto_approve: score.total >= threshold AND score.confidence >= min confidence
	 *   - reject: score.total < 0.3
	 *   - review: everything else (score between 0.3 and threshold, or high score
	 *     but low confidence)
	 *
	 * @param proposal - The proposal to evaluate
	 * @returns Recommendation label
	 */
	recommend(proposal: Proposal): InboxEntry["recommendation"] {
		const { total, confidence } = proposal.score;

		if (total >= DEFAULT_AUTO_QUEUE_TOTAL_THRESHOLD && confidence >= DEFAULT_AUTO_QUEUE_CONFIDENCE_MIN) {
			return "auto_approve";
		}

		if (total < 0.3) {
			return "reject";
		}

		return "review";
	}

	/**
	 * Build a human-readable reason for why a proposal is in the inbox.
	 *
	 * The reason is based on the proposal's score dimensions, type,
	 * and recommendation. It summarises the key factors in one sentence.
	 *
	 * @param proposal - The proposal to describe
	 * @returns A short reason string
	 */
	buildReason(proposal: Proposal): string {
		const parts: string[] = [];
		const rec = this.recommend(proposal);

		// Start with recommendation context
		switch (rec) {
			case "auto_approve":
				parts.push("High-score proposal eligible for auto-approval");
				break;
			case "reject":
				parts.push("Low-scoring proposal recommended for rejection");
				break;
			case "review":
				parts.push("Proposal requires manual review");
				break;
		}

		// Add score context
		const { total, novelty, confidence, urgency, feasibility } = proposal.score;
		const scoreInfo = [`score=${total.toFixed(2)}`];
		if (urgency >= 0.8) scoreInfo.push("urgent");
		if (novelty >= 0.8) scoreInfo.push("novel");
		if (confidence >= 0.8) scoreInfo.push("high-confidence");
		if (feasibility < 0.3) scoreInfo.push("low-feasibility");
		if (urgency < 0.3) scoreInfo.push("low-urgency");

		parts.push(`(${scoreInfo.join(", ")})`);

		return parts.join(" ");
	}

	// -----------------------------------------------------------------------
	// Expiry
	// -----------------------------------------------------------------------

	/**
	 * Find proposals that have exceeded the pending expiry window.
	 *
	 * Checks all pending_approval proposals against the configured
	 * expirePendingDays threshold. Returns proposals that should be
	 * expired.
	 *
	 * @returns Array of proposals that have expired
	 */
	async checkExpired(): Promise<Proposal[]> {
		const pending = await this.store.list({ status: ["pending_approval"] });
		const now = Date.now();
		const maxAgeMs = this.config.expirePendingDays * 24 * 60 * 60 * 1000;
		const expired: Proposal[] = [];

		for (const proposal of pending) {
			const age = now - new Date(proposal.createdAt).getTime();
			if (age >= maxAgeMs) {
				expired.push(proposal);
			}
		}

		return expired;
	}

	/**
	 * Auto-expire proposals that have been pending too long.
	 *
	 * Any pending_approval proposal older than expirePendingDays
	 * is transitioned to "expired" status.
	 *
	 * @returns The number of proposals that were expired
	 */
	async expireOldProposals(): Promise<number> {
		const expired = await this.checkExpired();
		let count = 0;

		for (const proposal of expired) {
			await this.store.update(proposal.id, { status: "expired" });
			count++;
		}

		return count;
	}

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	/**
	 * Get aggregate inbox statistics.
	 *
	 * Provides quick metrics about the current state of pending proposals.
	 *
	 * @returns InboxStats with counts
	 */
	async getInboxStats(): Promise<InboxStats> {
		const pending = await this.store.list({ status: ["pending_approval"] });
		const expiredCount = (await this.checkExpired()).length;

		let autoApproved = 0;
		let urgentCount = 0;

		for (const proposal of pending) {
			const rec = this.recommend(proposal);
			if (rec === "auto_approve") autoApproved++;
			if (proposal.score.urgency >= 0.8) urgentCount++;
		}

		return {
			totalPending: pending.length,
			autoApproved,
			urgentCount,
			expiredCount,
		};
	}

	// -----------------------------------------------------------------------
	// Entry Building
	// -----------------------------------------------------------------------

	/**
	 * Build a single InboxEntry from a Proposal.
	 *
	 * Assigns rank, recommendation, reason, and collects summaries
	 * of related memory and observation records.
	 *
	 * @param proposal - The proposal to wrap
	 * @param rank - Display rank (1-based)
	 * @returns A fully populated InboxEntry
	 */
	private buildEntry(proposal: Proposal, rank: number): InboxEntry {
		return {
			proposal,
			rank,
			recommendation: this.recommend(proposal),
			reason: this.buildReason(proposal),
			relatedMemorySummaries: [], // Enriched by caller when memory store is available
			relatedObservationSummaries: [], // Enriched by caller when observation store is available
		};
	}
}
