/**
 * Proposal Inbox — P16.E Top-3 Inbox Logic tests.
 *
 * Covers:
 * - Inbox configuration defaults and merging
 * - Ranking by score descending
 * - Type diversification (max 2 per type)
 * - Top-3 selection
 * - Recommendation labels (auto_approve, review, reject)
 * - Expiry of old pending proposals
 * - Inbox stats
 * - Edge cases (empty inbox, single proposal, ties)
 */

import { describe, expect, test } from "vitest";
import { DEFAULT_INBOX_CONFIG, ProposalInbox } from "../../../src/brain/proposals/inbox.js";
import {
	ALL_PROPOSAL_STATUSES,
	ALL_PROPOSAL_TYPES,
	createProposal,
	createProposalCreateInput,
	type Proposal,
	type ProposalCreateInput,
	type ProposalEvidence,
	type ProposalQuery,
	type ProposalRiskAssessment,
	type ProposalStats,
	type ProposalStatus,
	type ProposalStore,
	type ProposalType,
	type ProposalUpdateInput,
} from "../../../src/brain/proposals/types.js";

// ---------------------------------------------------------------------------
// In-Memory Proposal Store (test double)
// ---------------------------------------------------------------------------

class InMemoryProposalStore implements ProposalStore {
	private proposals: Map<string, Proposal> = new Map();

	async create(input: ProposalCreateInput): Promise<Proposal> {
		const proposal = createProposal(input);
		this.proposals.set(proposal.id, proposal);
		return proposal;
	}

	async getById(id: string): Promise<Proposal | null> {
		return this.proposals.get(id) ?? null;
	}

	async update(id: string, input: ProposalUpdateInput): Promise<Proposal> {
		const existing = this.proposals.get(id);
		if (!existing) throw new Error(`Proposal "${id}" not found`);

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

	async delete(id: string): Promise<void> {
		this.proposals.delete(id);
	}

	async list(query?: ProposalQuery): Promise<Proposal[]> {
		let results = Array.from(this.proposals.values());

		if (query?.status && query.status.length > 0) {
			results = results.filter((p) => query.status!.includes(p.status as ProposalStatus));
		}

		if (query?.type && query.type.length > 0) {
			results = results.filter((p) => query.type!.includes(p.type as ProposalType));
		}

		if (query?.tag) {
			results = results.filter((p) => p.tags.includes(query.tag!));
		}

		if (query?.relatedGoalId) {
			results = results.filter((p) => p.relatedGoalIds.includes(query.relatedGoalId!));
		}

		if (query?.minScore !== undefined) {
			results = results.filter((p) => p.score.total >= query.minScore!);
		}

		if (query?.maxScore !== undefined) {
			results = results.filter((p) => p.score.total <= query.maxScore!);
		}

		if (query?.createdAfter) {
			const after = new Date(query.createdAfter).getTime();
			results = results.filter((p) => new Date(p.createdAt).getTime() >= after);
		}

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
				if (p.status === "approved") approvedCount++;
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

	/** Helper: seed the store with proposals for testing */
	seed(...proposals: Proposal[]): void {
		for (const p of proposals) {
			this.proposals.set(p.id, p);
		}
	}

	/** Helper: clear all proposals */
	clear(): void {
		this.proposals.clear();
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(overrides?: Partial<ProposalEvidence>): ProposalEvidence {
	return {
		memoryIds: overrides?.memoryIds ?? ["mem-001"],
		observationIds: overrides?.observationIds ?? [],
		sourceRefs: overrides?.sourceRefs ?? [],
		confidence: overrides?.confidence ?? 0.8,
		evidenceSummary: overrides?.evidenceSummary ?? "Test evidence summary",
	};
}

function makeRisk(overrides?: Partial<ProposalRiskAssessment>): ProposalRiskAssessment {
	return {
		level: overrides?.level ?? "low",
		factors: overrides?.factors ?? ["factor-1"],
		mitigation: overrides?.mitigation ?? ["mitigation-1"],
		affectedSystems: overrides?.affectedSystems ?? ["system-a"],
		impactDescription: overrides?.impactDescription ?? "Low impact",
	};
}

function makeProposal(
	overrides?: Partial<ProposalCreateInput> & {
		createdAt?: string;
		status?: ProposalStatus;
		id?: string;
		scoreTotal?: number;
		scoreNovelty?: number;
		scoreConfidence?: number;
		scoreUrgency?: number;
		scoreFeasibility?: number;
	},
): Proposal {
	const input = createProposalCreateInput({
		type: overrides?.type ?? "memory_proposal",
		title: overrides?.title ?? "Test proposal",
		description: overrides?.description ?? "A test proposal for unit testing",
		evidence: overrides?.evidence ?? makeEvidence(),
		risk: overrides?.risk ?? makeRisk(),
		relatedGoalIds: overrides?.relatedGoalIds,
		tags: overrides?.tags,
		metadata: overrides?.metadata,
	});

	return createProposal(input, {
		id: overrides?.id,
		createdAt: overrides?.createdAt ?? new Date().toISOString(),
		status: overrides?.status ?? "pending_approval",
		score: {
			total: overrides?.scoreTotal ?? 0.5,
			novelty: overrides?.scoreNovelty ?? 0.5,
			confidence: overrides?.scoreConfidence ?? 0.5,
			urgency: overrides?.scoreUrgency ?? 0.5,
			feasibility: overrides?.scoreFeasibility ?? 0.5,
		},
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProposalInbox config defaults", () => {
	test("constructor without config uses defaults", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);
		const config = inbox.getConfig();
		expect(config.topCount).toBe(DEFAULT_INBOX_CONFIG.topCount);
		expect(config.maxPerType).toBe(DEFAULT_INBOX_CONFIG.maxPerType);
		expect(config.includeExpiring).toBe(DEFAULT_INBOX_CONFIG.includeExpiring);
		expect(config.expirePendingDays).toBe(DEFAULT_INBOX_CONFIG.expirePendingDays);
	});

	test("constructor with partial config merges correctly", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store, { topCount: 5 });
		const config = inbox.getConfig();
		expect(config.topCount).toBe(5);
		expect(config.maxPerType).toBe(DEFAULT_INBOX_CONFIG.maxPerType);
	});

	test("setConfig updates only provided fields", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);
		inbox.setConfig({ maxPerType: 3 });
		const config = inbox.getConfig();
		expect(config.topCount).toBe(DEFAULT_INBOX_CONFIG.topCount);
		expect(config.maxPerType).toBe(3);
	});
});

describe("ProposalInbox ranking", () => {
	test("rankProposals sorts by score descending", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const low = makeProposal({ scoreTotal: 0.3, title: "Low" });
		const high = makeProposal({ scoreTotal: 0.9, title: "High" });
		const mid = makeProposal({ scoreTotal: 0.6, title: "Mid" });

		const ranked = inbox.rankProposals([low, high, mid]);
		expect(ranked[0].title).toBe("High");
		expect(ranked[1].title).toBe("Mid");
		expect(ranked[2].title).toBe("Low");
	});

	test("rankProposals uses urgency as tie-breaker", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const a = makeProposal({ scoreTotal: 0.5, scoreUrgency: 0.9, title: "Urgent" });
		const b = makeProposal({ scoreTotal: 0.5, scoreUrgency: 0.3, title: "Not urgent" });

		const ranked = inbox.rankProposals([b, a]);
		expect(ranked[0].title).toBe("Urgent");
		expect(ranked[1].title).toBe("Not urgent");
	});

	test("rankProposals uses createdAt as final tie-breaker", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const older = makeProposal({
			scoreTotal: 0.5,
			scoreUrgency: 0.5,
			title: "Older",
			createdAt: "2025-01-01T00:00:00.000Z",
		});
		const newer = makeProposal({
			scoreTotal: 0.5,
			scoreUrgency: 0.5,
			title: "Newer",
			createdAt: "2025-06-01T00:00:00.000Z",
		});

		const ranked = inbox.rankProposals([older, newer]);
		expect(ranked[0].title).toBe("Newer");
		expect(ranked[1].title).toBe("Older");
	});
});

describe("ProposalInbox diversification", () => {
	test("diversifyProposals limits same type to maxPerType", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposals = [
			makeProposal({ type: "memory_proposal", scoreTotal: 0.9, title: "Mem A" }),
			makeProposal({ type: "memory_proposal", scoreTotal: 0.8, title: "Mem B" }),
			makeProposal({ type: "memory_proposal", scoreTotal: 0.7, title: "Mem C" }),
			makeProposal({ type: "plan_proposal", scoreTotal: 0.6, title: "Plan A" }),
		];

		const diversified = inbox.diversifyProposals(proposals);
		expect(diversified.length).toBe(3);
		expect(diversified.filter((p) => p.type === "memory_proposal").length).toBe(2);
		expect(diversified.filter((p) => p.type === "plan_proposal").length).toBe(1);
	});

	test("diversifyProposals limits each type to maxPerType", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposals = [
			makeProposal({ type: "memory_proposal", scoreTotal: 0.9, title: "Mem A" }),
			makeProposal({ type: "plan_proposal", scoreTotal: 0.8, title: "Plan A" }),
			makeProposal({ type: "memory_proposal", scoreTotal: 0.7, title: "Mem B" }),
			makeProposal({ type: "safety_proposal", scoreTotal: 0.6, title: "Safety A" }),
		];

		const diversified = inbox.diversifyProposals(proposals);
		// All 4 pass through since each type stays <= 2
		expect(diversified.length).toBe(4);
		expect(diversified[0].title).toBe("Mem A");
		expect(diversified[1].title).toBe("Plan A");
		expect(diversified[2].title).toBe("Mem B");
		expect(diversified[3].title).toBe("Safety A");
	});

	test("diversifyProposals drops excess when a type exceeds maxPerType", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposals = [
			makeProposal({ type: "memory_proposal", scoreTotal: 0.9, title: "Mem A" }),
			makeProposal({ type: "memory_proposal", scoreTotal: 0.8, title: "Mem B" }),
			makeProposal({ type: "memory_proposal", scoreTotal: 0.7, title: "Mem C" }),
		];

		const diversified = inbox.diversifyProposals(proposals);
		expect(diversified.length).toBe(2);
		expect(diversified[0].title).toBe("Mem A");
		expect(diversified[1].title).toBe("Mem B");
	});

	test("diversifyProposals with no type conflicts returns all", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposals = [
			makeProposal({ type: "memory_proposal", title: "Mem" }),
			makeProposal({ type: "plan_proposal", title: "Plan" }),
			makeProposal({ type: "safety_proposal", title: "Safety" }),
		];

		const diversified = inbox.diversifyProposals(proposals);
		expect(diversified.length).toBe(3);
	});
});

describe("ProposalInbox selectTopProposals", () => {
	test("selects exactly topCount proposals", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposals = [
			makeProposal({ scoreTotal: 0.9, type: "memory_proposal", title: "A" }),
			makeProposal({ scoreTotal: 0.8, type: "plan_proposal", title: "B" }),
			makeProposal({ scoreTotal: 0.7, type: "safety_proposal", title: "C" }),
			makeProposal({ scoreTotal: 0.6, type: "reflection_proposal", title: "D" }),
		];

		const selected = inbox.selectTopProposals(proposals);
		expect(selected.length).toBe(3);
		expect(selected[0].title).toBe("A");
		expect(selected[1].title).toBe("B");
		expect(selected[2].title).toBe("C");
	});

	test("returns fewer if not enough proposals", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposals = [makeProposal({ scoreTotal: 0.9, title: "Only" })];

		const selected = inbox.selectTopProposals(proposals);
		expect(selected.length).toBe(1);
		expect(selected[0].title).toBe("Only");
	});

	test("returns empty array for no proposals", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const selected = inbox.selectTopProposals([]);
		expect(selected.length).toBe(0);
	});
});

describe("ProposalInbox recommendation", () => {
	test("auto_approve for high score and confidence", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposal = makeProposal({ scoreTotal: 0.85, scoreConfidence: 0.8 });
		expect(inbox.recommend(proposal)).toBe("auto_approve");
	});

	test("reject for very low score", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposal = makeProposal({ scoreTotal: 0.2, scoreConfidence: 0.5 });
		expect(inbox.recommend(proposal)).toBe("reject");
	});

	test("review for medium score", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposal = makeProposal({ scoreTotal: 0.5, scoreConfidence: 0.5 });
		expect(inbox.recommend(proposal)).toBe("review");
	});

	test("review for high score but low confidence", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposal = makeProposal({ scoreTotal: 0.85, scoreConfidence: 0.3 });
		expect(inbox.recommend(proposal)).toBe("review");
	});
});

describe("ProposalInbox buildReason", () => {
	test("buildReason includes recommendation context", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposal = makeProposal({ scoreTotal: 0.85, scoreConfidence: 0.8 });
		const reason = inbox.buildReason(proposal);
		expect(reason).toContain("auto-approval");
	});

	test("buildReason includes score information", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposal = makeProposal({ scoreTotal: 0.85, scoreConfidence: 0.8, scoreUrgency: 0.9 });
		const reason = inbox.buildReason(proposal);
		expect(reason).toContain("score=0.85");
		expect(reason).toContain("urgent");
	});

	test("buildReason for low score mentions rejection", () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);

		const proposal = makeProposal({ scoreTotal: 0.2, scoreConfidence: 0.3 });
		const reason = inbox.buildReason(proposal);
		expect(reason).toContain("rejection");
	});
});

describe("ProposalInbox getInbox", () => {
	test("returns pending_approval proposals ranked and diversified", async () => {
		const store = new InMemoryProposalStore();

		// Seed with mixed proposals
		const p1 = makeProposal({ type: "memory_proposal", scoreTotal: 0.9, scoreConfidence: 0.8, title: "Mem High" });
		const p2 = makeProposal({ type: "plan_proposal", scoreTotal: 0.8, scoreConfidence: 0.7, title: "Plan High" });
		const p3 = makeProposal({ type: "memory_proposal", scoreTotal: 0.7, scoreConfidence: 0.6, title: "Mem Mid" });
		const p4 = makeProposal({ type: "safety_proposal", scoreTotal: 0.6, scoreConfidence: 0.5, title: "Safety" });

		store.seed(p1, p2, p3, p4);

		const inbox = new ProposalInbox(store);
		const view = await inbox.getInbox();

		expect(view.entries.length).toBe(3);
		expect(view.totalPending).toBe(4);
		expect(view.entries[0].rank).toBe(1);
		expect(view.entries[1].rank).toBe(2);
		expect(view.entries[2].rank).toBe(3);

		// Round-robin selection: Mem High (mem #1), Plan High (plan #1), Safety (safety #1)
		// Mem Mid is the second memory, which comes after one round of each type
		expect(view.entries[0].proposal.title).toBe("Mem High");
		expect(view.entries[1].proposal.title).toBe("Plan High");
		expect(view.entries[2].proposal.title).toBe("Safety");

		// Recommendation labels
		expect(view.entries[0].recommendation).toBe("auto_approve");
		expect(view.entries[1].recommendation).toBe("auto_approve");
	});

	test("returns pending_approval proposals with round-robin when many of same type", async () => {
		const store = new InMemoryProposalStore();

		// 4 memory proposals + 1 unique type
		const memA = makeProposal({ type: "memory_proposal", scoreTotal: 0.95, title: "Mem A" });
		const memB = makeProposal({ type: "memory_proposal", scoreTotal: 0.85, title: "Mem B" });
		const plan = makeProposal({ type: "plan_proposal", scoreTotal: 0.8, title: "Plan" });
		const memC = makeProposal({ type: "memory_proposal", scoreTotal: 0.75, title: "Mem C" });
		const memD = makeProposal({ type: "memory_proposal", scoreTotal: 0.7, title: "Mem D" });

		store.seed(memA, memB, plan, memC, memD);

		const inbox = new ProposalInbox(store);
		const view = await inbox.getInbox();

		// Round-robin with topCount=3, maxPerType=2:
		// Round 1: Mem A (mem), Plan (plan) - 2 collected
		// Round 2: Mem B (mem) - 3 collected -> stop
		// Result: Mem A, Plan, Mem B
		expect(view.entries.length).toBe(3);
		expect(view.entries[0].proposal.title).toBe("Mem A");
		expect(view.entries[1].proposal.title).toBe("Plan");
		expect(view.entries[2].proposal.title).toBe("Mem B");
	});

	test("excludes approved and rejected proposals", async () => {
		const store = new InMemoryProposalStore();

		const pending = makeProposal({ status: "pending_approval", scoreTotal: 0.9, title: "Pending" });
		const approved = makeProposal({ status: "approved", scoreTotal: 0.9, title: "Approved" });
		const rejected = makeProposal({ status: "rejected", scoreTotal: 0.9, title: "Rejected" });

		store.seed(pending, approved, rejected);

		const inbox = new ProposalInbox(store);
		const view = await inbox.getInbox();

		expect(view.entries.length).toBe(1);
		expect(view.entries[0].proposal.title).toBe("Pending");
	});

	test("returns empty inbox when no pending proposals", async () => {
		const store = new InMemoryProposalStore();
		const inbox = new ProposalInbox(store);
		const view = await inbox.getInbox();

		expect(view.entries.length).toBe(0);
		expect(view.totalPending).toBe(0);
		expect(view.lastUpdated).toBeTruthy();
	});

	test("entries have evidence-related fields", async () => {
		const store = new InMemoryProposalStore();
		const p = makeProposal({ scoreTotal: 0.9, title: "Test" });
		store.seed(p);

		const inbox = new ProposalInbox(store);
		const view = await inbox.getInbox();

		expect(view.entries[0].reason).toBeTruthy();
		expect(typeof view.entries[0].reason).toBe("string");
		expect(Array.isArray(view.entries[0].relatedMemorySummaries)).toBe(true);
		expect(Array.isArray(view.entries[0].relatedObservationSummaries)).toBe(true);
	});
});

describe("ProposalInbox expiry", () => {
	test("checkExpired finds old pending proposals", async () => {
		const store = new InMemoryProposalStore();

		const oldProposal = makeProposal({
			status: "pending_approval",
			title: "Old",
			createdAt: "2020-01-01T00:00:00.000Z",
		});
		const freshProposal = makeProposal({
			status: "pending_approval",
			title: "Fresh",
			createdAt: new Date().toISOString(),
		});

		store.seed(oldProposal, freshProposal);

		const inbox = new ProposalInbox(store);
		const expired = await inbox.checkExpired();

		expect(expired.length).toBe(1);
		expect(expired[0].title).toBe("Old");
	});

	test("expireOldProposals transitions old proposals to expired", async () => {
		const store = new InMemoryProposalStore();

		const oldProposal = makeProposal({
			id: "prop-old",
			status: "pending_approval",
			title: "Old",
			createdAt: "2020-01-01T00:00:00.000Z",
		});
		const freshProposal = makeProposal({
			id: "prop-fresh",
			status: "pending_approval",
			title: "Fresh",
			createdAt: new Date().toISOString(),
		});

		store.seed(oldProposal, freshProposal);

		const inbox = new ProposalInbox(store);
		const count = await inbox.expireOldProposals();

		expect(count).toBe(1);

		const updated = await store.getById("prop-old");
		expect(updated?.status).toBe("expired");

		const fresh = await store.getById("prop-fresh");
		expect(fresh?.status).toBe("pending_approval");
	});

	test("getInbox auto-expires old proposals before returning", async () => {
		const store = new InMemoryProposalStore();

		const oldProposal = makeProposal({
			id: "prop-old",
			status: "pending_approval",
			title: "Old",
			createdAt: "2020-01-01T00:00:00.000Z",
		});
		store.seed(oldProposal);

		const inbox = new ProposalInbox(store);
		const view = await inbox.getInbox();

		expect(view.entries.length).toBe(0);

		const updated = await store.getById("prop-old");
		expect(updated?.status).toBe("expired");
	});
});

describe("ProposalInbox stats", () => {
	test("getInboxStats returns correct counts", async () => {
		const store = new InMemoryProposalStore();

		const proposals = [
			makeProposal({ scoreTotal: 0.85, scoreConfidence: 0.8, title: "Auto" }),
			makeProposal({ scoreTotal: 0.9, scoreConfidence: 0.7, title: "Urgent", scoreUrgency: 0.9 }),
			makeProposal({ scoreTotal: 0.5, scoreConfidence: 0.5, title: "Review" }),
		];

		store.seed(...proposals);

		const inbox = new ProposalInbox(store);
		const stats = await inbox.getInboxStats();

		expect(stats.totalPending).toBe(3);
		expect(stats.autoApproved).toBe(2);
		expect(stats.urgentCount).toBe(1);
		expect(stats.expiredCount).toBe(0);
	});

	test("getInboxStats with expired proposals", async () => {
		const store = new InMemoryProposalStore();

		const old = makeProposal({
			status: "pending_approval",
			title: "Old",
			createdAt: "2020-01-01T00:00:00.000Z",
		});
		const fresh = makeProposal({ status: "pending_approval", title: "Fresh" });

		store.seed(old, fresh);

		const inbox = new ProposalInbox(store);
		const stats = await inbox.getInboxStats();

		expect(stats.totalPending).toBe(2);
		expect(stats.expiredCount).toBe(1);
	});
});
