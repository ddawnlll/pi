/**
 * Proposal Deduplication & Cooldown — P16.D
 *
 * Prevents duplicate proposals using content hashing and similarity
 * comparison. Enforces type-based cooldown periods to avoid flooding
 * the user with the same type of proposal too frequently.
 *
 * ## Deduplication
 *
 * Two levels of duplicate detection:
 *   1. Exact match via SHA-256 content hash (proposal type + title +
 *      description + evidence IDs)
 *   2. Similarity-based detection when configured with `similarity`
 *      algorithm (Jaccard word overlap + type match)
 *
 * ## Cooldown
 *
 * Prevents the same proposal type from being generated too frequently.
 * Cooldown periods are configurable per type:
 *   - memory_proposal:               12 hours
 *   - plan_proposal:                 24 hours
 *   - goal_revision_proposal:        24 hours
 *   - autonomy_adjustment_proposal:  48 hours
 *   - reflection_proposal:           12 hours
 *   - safety_proposal:                0 hours (no cooldown)
 *
 * Proposals with different evidence references can bypass cooldown
 * (new evidence = new insight, even within the cooldown window).
 *
 * All suppressed proposals are logged for audit via the suppression log.
 *
 * ## Usage (with ProposalGenerator)
 *
 * The class implements the generator's `ProposalDeduplication` interface
 * (string-based hash methods) while also exposing a richer API for
 * standalone use with full ProposalCreateInput objects.
 *
 * ```typescript
 * const dedup = new ProposalDeduplication();
 * const dupResult = dedup.checkDuplicate(newProposal, recentProposals);
 * const cdResult = dedup.checkCooldown(newProposal, recentProposals);
 * ```
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import type { Proposal, ProposalCreateInput, ProposalType } from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Configuration for the Proposal Deduplication engine.
 */
export interface DedupConfig {
	/** Cooldown periods in hours for each proposal type */
	cooldowns: Record<ProposalType, number>;
	/** Similarity threshold for fuzzy dedup (0-1, default 0.8) */
	similarityThreshold: number;
	/** Whether dedup/cooldown logic is active */
	enabled: boolean;
	/** Hash algorithm: 'sha256' for exact matching, 'similarity' for fuzzy */
	hashAlgorithm: "sha256" | "similarity";
}

/**
 * Partial input for DedupConfig.
 *
 * Cooldowns can be provided as a partial record, allowing callers to
 * override only specific proposal type cooldowns without specifying all.
 */
export interface DedupConfigInput {
	/** Cooldown periods in hours for each proposal type (partial) */
	cooldowns?: Partial<Record<ProposalType, number>>;
	/** Similarity threshold for fuzzy dedup (0-1, default 0.8) */
	similarityThreshold?: number;
	/** Whether dedup/cooldown logic is active */
	enabled?: boolean;
	/** Hash algorithm: 'sha256' for exact matching, 'similarity' for fuzzy */
	hashAlgorithm?: "sha256" | "similarity";
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default cooldown periods per proposal type (in hours).
 *
 * - memory_proposal: 12 hours (frequent memory updates are fine)
 * - plan_proposal: 24 hours (plans are resource-intensive)
 * - goal_revision_proposal: 24 hours (goals change infrequently)
 * - autonomy_adjustment_proposal: 48 hours (rarely needed)
 * - reflection_proposal: 12 hours (reflections after each plan)
 * - safety_proposal: 0 hours (safety should never be suppressed)
 */
export const DEFAULT_COOLDOWNS: Record<ProposalType, number> = {
	memory_proposal: 12,
	plan_proposal: 24,
	goal_revision_proposal: 24,
	autonomy_adjustment_proposal: 48,
	reflection_proposal: 12,
	safety_proposal: 0,
};

/**
 * Default dedup configuration.
 *
 * - Similarity threshold of 0.8 means a proposal must be at least 80%
 *   similar to be considered a duplicate.
 * - Both dedup and cooldown are enabled by default.
 * - SHA-256 is the default hash algorithm for exact matching.
 */
export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
	cooldowns: { ...DEFAULT_COOLDOWNS },
	similarityThreshold: 0.8,
	enabled: true,
	hashAlgorithm: "sha256",
};

// ---------------------------------------------------------------------------
// Suppression Log
// ---------------------------------------------------------------------------

/**
 * A single entry in the suppression log.
 *
 * Records every proposal that was suppressed (either as duplicate or
 * cooldown) for audit purposes.
 */
export interface SuppressionLogEntry {
	/** Content hash of the suppressed proposal */
	contentHash: string;
	/** Type of the suppressed proposal */
	type: ProposalType;
	/** Title of the suppressed proposal */
	title: string;
	/** Reason for suppression */
	reason: string;
	/** ISO 8601 timestamp of suppression */
	timestamp: string;
	/** ID of the similar proposal (for duplicate matches) */
	similarProposalId?: string;
}

// ---------------------------------------------------------------------------
// ProposalDeduplication
// ---------------------------------------------------------------------------

/**
 * Engine for proposal deduplication and cooldown enforcement.
 *
 * ## Generator Interface Compatibility
 *
 * The class provides three methods matching the generator's
 * `ProposalDeduplication` interface:
 * - `isDuplicate(contentHash)` — checks if a hash was already registered
 * - `register(contentHash, type, generatedAt)` — records a generated
 *   proposal for future dedup/cooldown checks
 * - `isInCooldown(type)` — checks if a proposal type is in cooldown
 *
 * ## Rich API (for standalone use)
 *
 * In addition to the generator interface, the class provides methods
 * that work with full `ProposalCreateInput` and `Proposal` objects:
 * - `checkDuplicate(proposal, recentProposals)` — full duplicate check
 *   with similarity comparison
 * - `checkCooldown(proposal, recentProposals)` — cooldown check with
 *   evidence override (different evidence bypasses cooldown)
 * - `shouldSuppress(proposal, recentProposals)` — combined check
 * - `hashProposal(proposal)` — compute deterministic content hash
 * - `calculateSimilarity(a, b)` — Jaccard-based similarity score
 */
export class ProposalDeduplication {
	private config: DedupConfig;
	private readonly registeredHashes: Set<string> = new Set();
	/** History keyed by content hash (for rich API getHistory/clearHistory) */
	private readonly hashHistory: Map<string, { contentHash: string; type: ProposalType; timestamp: string }[]> =
		new Map();
	/** History keyed by proposal type (for cooldown tracking) */
	private readonly typeHistory: Map<string, { contentHash: string; type: ProposalType; timestamp: string }[]> =
		new Map();
	private readonly suppressionLog: SuppressionLogEntry[] = [];

	/**
	 * Create a new deduplication engine.
	 *
	 * @param config - Optional partial config overrides
	 */
	constructor(config?: DedupConfigInput) {
		this.config = {
			cooldowns: { ...DEFAULT_COOLDOWNS, ...config?.cooldowns },
			similarityThreshold: config?.similarityThreshold ?? DEFAULT_DEDUP_CONFIG.similarityThreshold,
			enabled: config?.enabled ?? DEFAULT_DEDUP_CONFIG.enabled,
			hashAlgorithm: config?.hashAlgorithm ?? DEFAULT_DEDUP_CONFIG.hashAlgorithm,
		};
	}

	// -----------------------------------------------------------------------
	// Generator Interface Compatibility
	//
	// These methods match the ProposalDeduplication interface used by
	// the ProposalGenerator (P16.B). They work with string hashes
	// rather than full proposal objects.
	// -----------------------------------------------------------------------

	/**
	 * Check if a content hash has already been registered (duplicate).
	 *
	 * This matches the generator's `ProposalDeduplication` interface.
	 *
	 * @param contentHash - SHA-256 content hash of a proposal
	 * @returns True if the hash is already registered
	 */
	isDuplicate(contentHash: string): boolean {
		return this.registeredHashes.has(contentHash);
	}

	/**
	 * Register a proposal for dedup and cooldown tracking.
	 *
	 * This matches the generator's `ProposalDeduplication` interface.
	 * Called by the generator after a proposal is created.
	 *
	 * @param contentHash - SHA-256 content hash of the proposal
	 * @param type - Proposal type string
	 * @param generatedAt - ISO 8601 timestamp of generation
	 */
	register(contentHash: string, type: string, generatedAt: string): void {
		this.registeredHashes.add(contentHash);
		const pType = type as ProposalType;

		// Track per-type cooldown via typeHistory
		const typeEntries = this.typeHistory.get(type) ?? [];
		typeEntries.push({ contentHash, type: pType, timestamp: generatedAt });
		this.typeHistory.set(type, typeEntries);

		// Track by content hash for history management
		const hashEntries = this.hashHistory.get(contentHash) ?? [];
		hashEntries.push({ contentHash, type: pType, timestamp: generatedAt });
		this.hashHistory.set(contentHash, hashEntries);
	}

	/**
	 * Check if a proposal type is currently in cooldown.
	 *
	 * This matches the generator's `ProposalDeduplication` interface.
	 *
	 * @param type - Proposal type to check
	 * @returns True if this type is in cooldown
	 */
	isInCooldown(type: string): boolean {
		const pType = type as ProposalType;
		const cooldownHours = this.getCooldownForType(pType);
		if (cooldownHours <= 0) {
			return false;
		}
		const entries = this.typeHistory.get(type);
		if (!entries || entries.length === 0) {
			return false;
		}
		// Find the most recent entry of this type
		const sorted = [...entries].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		const mostRecent = sorted[0];
		const elapsedHours = (Date.now() - new Date(mostRecent.timestamp).getTime()) / (1000 * 60 * 60);
		return elapsedHours < cooldownHours;
	}

	// -----------------------------------------------------------------------
	// Rich API — Full-Object Methods
	// -----------------------------------------------------------------------

	/**
	 * Compute a deterministic content hash for a proposal input.
	 *
	 * The hash is based on type + title + description + evidence IDs.
	 * This is the same algorithm used by the ProposalGenerator for
	 * hash-based duplicate detection.
	 *
	 * @param proposal - The proposal to hash
	 * @returns SHA-256 hex digest
	 */
	hashProposal(proposal: ProposalCreateInput): string {
		const hash = createHash("sha256");
		hash.update(proposal.type);
		hash.update("|");
		hash.update(proposal.title.trim().toLowerCase());
		hash.update("|");
		hash.update(proposal.description.trim().toLowerCase());
		hash.update("|");
		hash.update((proposal.evidence.memoryIds ?? []).sort().join(","));
		hash.update("|");
		hash.update((proposal.evidence.observationIds ?? []).sort().join(","));
		return hash.digest("hex");
	}

	/**
	 * Calculate similarity between two proposal inputs.
	 *
	 * Uses Jaccard word overlap on title and description, plus type
	 * match and evidence ID overlap. Returns a value between 0
	 * (completely different) and 1 (identical).
	 *
	 * Weight breakdown:
	 *   - Type match: 0.2
	 *   - Title Jaccard similarity: 0.4
	 *   - Description Jaccard similarity: 0.3
	 *   - Evidence ID overlap: 0.1
	 *
	 * @param a - First proposal
	 * @param b - Second proposal
	 * @returns Similarity score 0-1
	 */
	calculateSimilarity(a: ProposalCreateInput, b: ProposalCreateInput): number {
		let score = 0;

		// Type match (weight: 0.2)
		if (a.type === b.type) {
			score += 0.2;
		}

		// Title similarity via Jaccard (weight: 0.4)
		const titleOverlap = this.jaccardSimilarity(this.tokenize(a.title), this.tokenize(b.title));
		score += 0.4 * titleOverlap;

		// Description similarity via Jaccard (weight: 0.3)
		const descOverlap = this.jaccardSimilarity(this.tokenize(a.description), this.tokenize(b.description));
		score += 0.3 * descOverlap;

		// Evidence ID overlap (weight: 0.1)
		const evidenceOverlap = this.evidenceIdSimilarity(a.evidence, b.evidence);
		score += 0.1 * evidenceOverlap;

		return Math.max(0, Math.min(1, score));
	}

	/**
	 * Full duplicate check against recent proposals.
	 *
	 * Two levels of detection:
	 *   1. Exact content hash match against registered hashes
	 *   2. (When algorithm is `similarity`) Fuzzy comparison with
	 *      similarity threshold
	 *
	 * @param proposal - The new proposal to check
	 * @param recentProposals - Previously created proposals for comparison
	 * @returns Result with isDuplicate flag, reason, and similar proposal ID
	 */
	checkDuplicate(
		proposal: ProposalCreateInput,
		recentProposals: Proposal[],
	): { isDuplicate: boolean; matchReason?: string; similarProposalId?: string } {
		if (!this.config.enabled) {
			return { isDuplicate: false };
		}

		// Level 1: Exact content hash match
		const contentHash = this.hashProposal(proposal);
		if (this.registeredHashes.has(contentHash)) {
			return { isDuplicate: true, matchReason: "Exact content hash match from registered proposals" };
		}

		// Level 2: Similarity-based matching (only when configured)
		if (this.config.hashAlgorithm === "similarity") {
			const existingInputs = recentProposals.map((p) => this.toCreateInput(p));

			for (let i = 0; i < existingInputs.length; i++) {
				const similarity = this.calculateSimilarity(proposal, existingInputs[i]);
				if (similarity >= this.config.similarityThreshold) {
					return {
						isDuplicate: true,
						matchReason: `Similarity ${similarity.toFixed(2)} >= threshold ${this.config.similarityThreshold}`,
						similarProposalId: recentProposals[i].id,
					};
				}
			}
		}

		return { isDuplicate: false };
	}

	/**
	 * Full cooldown check against recent proposals.
	 *
	 * Proposals with different evidence references bypass cooldown:
	 * if the new proposal references different memory or observation IDs
	 * than the most recent same-type proposal, it is considered new
	 * evidence and allowed.
	 *
	 * @param proposal - The new proposal to check
	 * @param recentProposals - Previously created proposals for comparison
	 * @returns Result with isInCooldown flag and remaining hours
	 */
	checkCooldown(
		proposal: ProposalCreateInput,
		recentProposals: Proposal[],
	): { isInCooldown: boolean; remainingHours?: number } {
		const cooldownHours = this.getCooldownForType(proposal.type);
		if (cooldownHours <= 0) {
			return { isInCooldown: false };
		}

		// Find recent proposals of the same type, sorted newest first
		const sameTypeProposals = recentProposals
			.filter((p) => p.type === proposal.type)
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

		if (sameTypeProposals.length === 0) {
			return { isInCooldown: false };
		}

		const mostRecent = sameTypeProposals[0];
		const elapsedHours = (Date.now() - new Date(mostRecent.createdAt).getTime()) / (1000 * 60 * 60);

		if (elapsedHours >= cooldownHours) {
			return { isInCooldown: false };
		}

		// Check if the new proposal has different evidence (bypasses cooldown)
		if (this.hasDifferentEvidence(proposal, mostRecent)) {
			return { isInCooldown: false };
		}

		return {
			isInCooldown: true,
			remainingHours: Math.round((cooldownHours - elapsedHours) * 10) / 10,
		};
	}

	/**
	 * Combined suppression check (duplicate OR cooldown).
	 *
	 * Returns `suppress: true` with a reason if the proposal should
	 * not be generated. Logs suppressed proposals to the suppression
	 * log automatically.
	 *
	 * @param proposal - The new proposal to check
	 * @param recentProposals - Previously created proposals for comparison
	 * @returns Suppression result with reason
	 */
	shouldSuppress(proposal: ProposalCreateInput, recentProposals: Proposal[]): { suppress: boolean; reason?: string } {
		if (!this.config.enabled) {
			return { suppress: false };
		}

		// Check duplicate first
		const dup = this.checkDuplicate(proposal, recentProposals);
		if (dup.isDuplicate) {
			this.logSuppression(proposal, dup.matchReason ?? "Duplicate detected", dup.similarProposalId);
			return { suppress: true, reason: dup.matchReason ?? "Duplicate detected" };
		}

		// Check cooldown
		const cd = this.checkCooldown(proposal, recentProposals);
		if (cd.isInCooldown) {
			const reason = `Type ${proposal.type} in cooldown (${cd.remainingHours}h remaining)`;
			this.logSuppression(proposal, reason);
			return { suppress: true, reason };
		}

		return { suppress: false };
	}

	/**
	 * Record a proposal in the history for future dedup/cooldown checks.
	 *
	 * Unlike `register()` (which is called by the generator with a
	 * pre-computed hash), this method computes the hash internally
	 * from the proposal object.
	 *
	 * @param proposal - The proposal to record
	 */
	recordHistory(proposal: ProposalCreateInput): void {
		const contentHash = this.hashProposal(proposal);
		this.registeredHashes.add(contentHash);

		// Track by content hash
		const hashEntries = this.hashHistory.get(contentHash) ?? [];
		hashEntries.push({ contentHash, type: proposal.type, timestamp: new Date().toISOString() });
		this.hashHistory.set(contentHash, hashEntries);

		// Track by type for cooldown
		const typeEntries = this.typeHistory.get(proposal.type) ?? [];
		typeEntries.push({ contentHash, type: proposal.type, timestamp: new Date().toISOString() });
		this.typeHistory.set(proposal.type, typeEntries);
	}

	/**
	 * Get a copy of the dedup history, optionally filtered by type.
	 *
	 * @param type - Optional proposal type filter
	 * @returns Map of content hash to history entries
	 */
	getHistory(type?: ProposalType): Map<string, { contentHash: string; type: ProposalType; timestamp: string }[]> {
		if (type) {
			const filtered = new Map<string, { contentHash: string; type: ProposalType; timestamp: string }[]>();
			for (const [hash, entries] of this.hashHistory) {
				const typeEntries = entries.filter((e) => e.type === type);
				if (typeEntries.length > 0) {
					filtered.set(hash, typeEntries);
				}
			}
			return filtered;
		}
		return new Map(this.hashHistory);
	}

	/**
	 * Clear history entries older than a given timestamp.
	 *
	 * @param before - ISO 8601 timestamp; entries before this are removed
	 */
	clearHistory(before: string): void {
		const beforeTime = new Date(before).getTime();

		// Clean hashHistory
		for (const [hash, entries] of this.hashHistory) {
			const remaining = entries.filter((e) => new Date(e.timestamp).getTime() >= beforeTime);
			if (remaining.length === 0) {
				this.hashHistory.delete(hash);
				this.registeredHashes.delete(hash);
			} else {
				this.hashHistory.set(hash, remaining);
			}
		}

		// Clean typeHistory
		for (const [type, entries] of this.typeHistory) {
			const remaining = entries.filter((e) => new Date(e.timestamp).getTime() >= beforeTime);
			if (remaining.length === 0) {
				this.typeHistory.delete(type);
			} else {
				this.typeHistory.set(type, remaining);
			}
		}
	}

	/**
	 * Update the engine configuration.
	 *
	 * Only provided fields are changed; others keep their current values.
	 *
	 * @param config - Partial configuration to apply
	 */
	setConfig(config: DedupConfigInput): void {
		this.config = {
			...this.config,
			...config,
			cooldowns: { ...this.config.cooldowns, ...config.cooldowns },
		};
	}

	/**
	 * Get the cooldown period for a specific proposal type.
	 *
	 * @param type - The proposal type
	 * @returns Cooldown in hours (0 = no cooldown)
	 */
	getCooldownForType(type: ProposalType): number {
		return this.config.cooldowns[type] ?? 24;
	}

	/**
	 * Get the current dedup configuration (read-only snapshot).
	 *
	 * @returns A shallow copy of the current config
	 */
	getConfig(): DedupConfig {
		return {
			...this.config,
			cooldowns: { ...this.config.cooldowns },
		};
	}

	/**
	 * Get the suppression log (all suppressed proposals for audit).
	 *
	 * @returns Array of suppression log entries
	 */
	getSuppressionLog(): SuppressionLogEntry[] {
		return [...this.suppressionLog];
	}

	/**
	 * Clear the suppression log.
	 */
	clearSuppressionLog(): void {
		this.suppressionLog.length = 0;
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Log a suppressed proposal for audit.
	 */
	private logSuppression(proposal: ProposalCreateInput, reason: string, similarProposalId?: string): void {
		this.suppressionLog.push({
			contentHash: this.hashProposal(proposal),
			type: proposal.type,
			title: proposal.title,
			reason,
			timestamp: new Date().toISOString(),
			similarProposalId,
		});
	}

	/**
	 * Convert a Proposal to ProposalCreateInput for similarity comparison.
	 */
	private toCreateInput(proposal: Proposal): ProposalCreateInput {
		return {
			type: proposal.type,
			title: proposal.title,
			description: proposal.description,
			evidence: proposal.evidence,
			risk: proposal.risk,
			relatedGoalIds: proposal.relatedGoalIds,
			tags: proposal.tags,
			metadata: proposal.metadata,
		};
	}

	/**
	 * Check if a proposal has substantially different evidence from an
	 * existing proposal.
	 *
	 * Evidence is considered different if:
	 *   - Different memory IDs (non-empty overlap is small)
	 *   - Different observation IDs (non-empty overlap is small)
	 *   - Different evidence summary text
	 *
	 * @param a - New proposal
	 * @param b - Existing proposal
	 * @returns True if the evidence is substantially different
	 */
	private hasDifferentEvidence(a: ProposalCreateInput, b: Proposal | ProposalCreateInput): boolean {
		// Check memory IDs
		const memA = new Set(a.evidence.memoryIds ?? []);
		const memB = new Set(b.evidence.memoryIds ?? []);
		const memOverlap = this.setIntersectionSize(memA, memB);

		// If there are new memory IDs not in the existing proposal
		if (a.evidence.memoryIds.length > 0 && memOverlap < a.evidence.memoryIds.length) {
			return true;
		}

		// Check observation IDs
		const obsA = new Set(a.evidence.observationIds ?? []);
		const obsB = new Set(b.evidence.observationIds ?? []);
		const obsOverlap = this.setIntersectionSize(obsA, obsB);

		// If there are new observation IDs not in the existing proposal
		if (a.evidence.observationIds.length > 0 && obsOverlap < a.evidence.observationIds.length) {
			return true;
		}

		// Check evidence summary (different text = different evidence)
		if (
			a.evidence.evidenceSummary.trim().toLowerCase() !== (b.evidence?.evidenceSummary ?? "").trim().toLowerCase()
		) {
			return true;
		}

		return false;
	}

	/**
	 * Compute the size of the intersection of two sets.
	 */
	private setIntersectionSize<T>(a: Set<T>, b: Set<T>): number {
		let count = 0;
		for (const item of a) {
			if (b.has(item)) {
				count++;
			}
		}
		return count;
	}

	/**
	 * Compute Jaccard similarity between two token arrays.
	 *
	 * @param a - First token array
	 * @param b - Second token array
	 * @returns Jaccard similarity between 0 and 1
	 */
	private jaccardSimilarity(a: string[], b: string[]): number {
		if (a.length === 0 && b.length === 0) {
			return 1.0;
		}
		if (a.length === 0 || b.length === 0) {
			return 0;
		}

		const setA = new Set(a);
		const setB = new Set(b);

		let intersection = 0;
		for (const word of setA) {
			if (setB.has(word)) {
				intersection++;
			}
		}

		const union = new Set([...setA, ...setB]).size;
		return intersection / union;
	}

	/**
	 * Compute evidence ID overlap similarity.
	 *
	 * Compares memoryIds and observationIds arrays using Jaccard.
	 *
	 * @param a - First evidence
	 * @param b - Second evidence
	 * @returns Similarity score 0-1
	 */
	private evidenceIdSimilarity(
		a: { memoryIds: string[]; observationIds: string[] },
		b: { memoryIds: string[]; observationIds: string[] },
	): number {
		const allA = [...(a.memoryIds ?? []), ...(a.observationIds ?? [])];
		const allB = [...(b.memoryIds ?? []), ...(b.observationIds ?? [])];
		return this.jaccardSimilarity(allA, allB);
	}

	/**
	 * Tokenize a string into lowercase word tokens.
	 *
	 * @param text - The text to tokenize
	 * @returns Array of word tokens
	 */
	private tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.replace(/[^\w\s]/g, "")
			.split(/\s+/)
			.filter((w) => w.length > 0);
	}
}
