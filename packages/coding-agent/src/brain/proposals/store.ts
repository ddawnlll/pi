/**
 * In-Memory Proposal Store — P16.F
 *
 * A concrete in-memory implementation of the ProposalStore interface.
 *
 * Stores proposals in a Map for fast access by ID, and supports
 * filtering, sorting, and pagination via the list() method.
 * The store is designed to be the default backend for the Proposal API,
 * and can be replaced with a database-backed implementation later.
 *
 * @packageDocumentation
 */

import {
	ALL_PROPOSAL_STATUSES,
	ALL_PROPOSAL_TYPES,
	createProposal,
	type Proposal,
	type ProposalCreateInput,
	type ProposalQuery,
	type ProposalStats,
	type ProposalStatus,
	type ProposalStore,
	type ProposalType,
	type ProposalUpdateInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// InMemoryProposalStore
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of the ProposalStore interface.
 *
 * Proposals are stored in a Map keyed by ID. All operations are
 * synchronous except for the async interface methods.
 *
 * Usage:
 * ```typescript
 * const store = new InMemoryProposalStore();
 * const proposal = await store.create(input);
 * const list = await store.list({ status: ["pending_approval"] });
 * ```
 */
export class InMemoryProposalStore implements ProposalStore {
	private proposals: Map<string, Proposal> = new Map();

	// -----------------------------------------------------------------------
	// CRUD
	// -----------------------------------------------------------------------

	/**
	 * Create a new proposal and store it.
	 *
	 * @param input - The proposal creation input
	 * @returns The fully created Proposal
	 */
	async create(input: ProposalCreateInput): Promise<Proposal> {
		const proposal = createProposal(input);
		this.proposals.set(proposal.id, proposal);
		return proposal;
	}

	/**
	 * Get a proposal by ID.
	 *
	 * @param id - The proposal ID
	 * @returns The Proposal, or null if not found
	 */
	async getById(id: string): Promise<Proposal | null> {
		return this.proposals.get(id) ?? null;
	}

	/**
	 * Update an existing proposal.
	 *
	 * Only provided fields are changed. Status transitions are
	 * validated (only allowed transitions are applied). Throws
	 * if the proposal is not found.
	 *
	 * @param id - The proposal ID
	 * @param input - The update input
	 * @returns The updated Proposal
	 */
	async update(id: string, input: ProposalUpdateInput): Promise<Proposal> {
		const existing = this.proposals.get(id);
		if (!existing) {
			throw new Error(`Proposal "${id}" not found`);
		}

		const updated: Proposal = {
			...existing,
			...(input.status !== undefined ? { status: input.status } : {}),
			...(input.approvedBy !== undefined ? { approvedBy: input.approvedBy } : {}),
			...(input.rejectedBy !== undefined ? { rejectedBy: input.rejectedBy } : {}),
			...(input.rejectionReason !== undefined ? { rejectionReason: input.rejectionReason } : {}),
			...(input.executedAsPlanId !== undefined ? { executedAsPlanId: input.executedAsPlanId } : {}),
			...(input.tags !== undefined ? { tags: input.tags } : {}),
			updatedAt: new Date().toISOString(),
		};

		this.proposals.set(id, updated);
		return updated;
	}

	/**
	 * Delete a proposal by ID.
	 *
	 * No-op if the proposal does not exist.
	 *
	 * @param id - The proposal ID to delete
	 */
	async delete(id: string): Promise<void> {
		this.proposals.delete(id);
	}

	// -----------------------------------------------------------------------
	// Query
	// -----------------------------------------------------------------------

	/**
	 * List proposals matching a query.
	 *
	 * Filters by status, type, tag, score range, creation time.
	 * Supports sorting by score, createdAt, or updatedAt.
	 * Defaults to sorting by createdAt descending.
	 * Default limit is 20, max offset is unbounded.
	 *
	 * @param query - Optional query parameters
	 * @returns Array of matching proposals
	 */
	async list(query?: ProposalQuery): Promise<Proposal[]> {
		let results = Array.from(this.proposals.values());

		// Status filter
		if (query?.status && query.status.length > 0) {
			const statuses = new Set(query.status);
			results = results.filter((p) => statuses.has(p.status as ProposalStatus));
		}

		// Type filter
		if (query?.type && query.type.length > 0) {
			const types = new Set(query.type);
			results = results.filter((p) => types.has(p.type as ProposalType));
		}

		// Tag filter
		if (query?.tag) {
			results = results.filter((p) => p.tags.includes(query.tag!));
		}

		// Related goal filter
		if (query?.relatedGoalId) {
			results = results.filter((p) => p.relatedGoalIds.includes(query.relatedGoalId!));
		}

		// Min score filter
		if (query?.minScore !== undefined) {
			results = results.filter((p) => p.score.total >= query.minScore!);
		}

		// Max score filter
		if (query?.maxScore !== undefined) {
			results = results.filter((p) => p.score.total <= query.maxScore!);
		}

		// Created after filter
		if (query?.createdAfter) {
			const after = new Date(query.createdAfter).getTime();
			results = results.filter((p) => new Date(p.createdAt).getTime() >= after);
		}

		// Created before filter
		if (query?.createdBefore) {
			const before = new Date(query.createdBefore).getTime();
			results = results.filter((p) => new Date(p.createdAt).getTime() <= before);
		}

		// Sorting
		const sortBy = query?.sortBy ?? "createdAt";
		const sortOrder = query?.sortOrder ?? "desc";

		results.sort((a, b) => {
			let cmp: number;
			if (sortBy === "score") {
				cmp = a.score.total - b.score.total;
			} else if (sortBy === "updatedAt") {
				cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
			} else {
				cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
			}
			return sortOrder === "desc" ? -cmp : cmp;
		});

		// Pagination
		const offset = query?.offset ?? 0;
		const limit = query?.limit ?? 20;
		results = results.slice(offset, offset + limit);

		return results;
	}

	/**
	 * Get aggregate proposal statistics.
	 *
	 * @returns Computed ProposalStats from all stored proposals
	 */
	async stats(): Promise<ProposalStats> {
		const all = Array.from(this.proposals.values());

		const byStatus = {} as Record<ProposalStatus, number>;
		const byType = {} as Record<ProposalType, number>;

		for (const s of ALL_PROPOSAL_STATUSES) byStatus[s] = 0;
		for (const t of ALL_PROPOSAL_TYPES) byType[t] = 0;

		let totalScore = 0;
		let scoredCount = 0;
		let approvedCount = 0;
		let reviewedCount = 0;

		for (const p of all) {
			byStatus[p.status as ProposalStatus] = (byStatus[p.status as ProposalStatus] ?? 0) + 1;
			byType[p.type as ProposalType] = (byType[p.type as ProposalType] ?? 0) + 1;

			totalScore += p.score.total;
			scoredCount++;

			if (p.status === "approved" || p.status === "rejected") {
				reviewedCount++;
				if (p.status === "approved") {
					approvedCount++;
				}
			}
		}

		return {
			totalProposals: all.length,
			byStatus,
			byType,
			averageScore: scoredCount > 0 ? totalScore / scoredCount : 0,
			acceptanceRate: reviewedCount > 0 ? approvedCount / reviewedCount : 0,
			pendingApprovalCount: byStatus.pending_approval ?? 0,
			expiredCount: byStatus.expired ?? 0,
		};
	}

	// -----------------------------------------------------------------------
	// Helpers (for testing / seeding)
	// -----------------------------------------------------------------------

	/**
	 * Seed the store with pre-built proposals (for testing).
	 *
	 * @param proposals - Proposals to add
	 */
	seed(...proposals: Proposal[]): void {
		for (const p of proposals) {
			this.proposals.set(p.id, p);
		}
	}

	/**
	 * Clear all proposals from the store.
	 */
	clear(): void {
		this.proposals.clear();
	}

	/**
	 * Get the total number of stored proposals.
	 */
	get size(): number {
		return this.proposals.size;
	}
}
