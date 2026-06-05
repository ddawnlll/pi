/**
 * P44.02 — EvidenceLedger
 *
 * Stores and queries evidence artifacts that support or contradict
 * acceptance criteria. Each entry tracks a piece of evidence with
 * type, verdict, confidence, and links to criteria.
 *
 * The ledger integrates with:
 * - AcceptanceCriteriaRegistry (P44.01) for traceability links
 * - WorkerReportContract (P44.06) for reporting results
 * - CompletionGate for blocking completion when evidence is insufficient
 *
 * Contract Schema: 4.1.1
 */

import type {
	EvidenceLedgerEntry,
	EvidenceFilter,
	EvidenceSummary,
} from "./evidence-types.js";
import { computeEvidenceSummary, meetsMinConfidence } from "./evidence-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for the evidence ledger.
 */
export const EVIDENCE_LEDGER_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// EvidenceLedger
// ---------------------------------------------------------------------------

/**
 * In-memory evidence ledger that stores, queries, and serializes
 * evidence entries for a workspace or plan execution.
 *
 * The ledger is the single source of truth for evidence during
 * a P44 verified completion flow.
 */
export class EvidenceLedger {
	private entries: Map<string, EvidenceLedgerEntry> = new Map();
	private readonly scopeId: string;

	/**
	 * @param scopeId - Identifier for the scope (e.g., "P44.01" or "plan-P44")
	 */
	constructor(scopeId: string) {
		this.scopeId = scopeId;
	}

	/**
	 * Get the scope identifier.
	 */
	get scope(): string {
		return this.scopeId;
	}

	/**
	 * Get the number of entries in the ledger.
	 */
	get size(): number {
		return this.entries.size;
	}

	/**
	 * Add one or more evidence entries to the ledger.
	 * If an entry with the same ID already exists, it is overwritten
	 * (updated in place).
	 *
	 * @param newEntries - Entries to add
	 */
	add(...newEntries: EvidenceLedgerEntry[]): void {
		for (const entry of newEntries) {
			this.entries.set(entry.id, { ...entry, timestamp: entry.timestamp || Date.now() });
		}
	}

	/**
	 * Get an evidence entry by ID.
	 *
	 * @param id - Evidence entry ID
	 * @returns The entry, or undefined if not found
	 */
	get(id: string): EvidenceLedgerEntry | undefined {
		return this.entries.get(id);
	}

	/**
	 * Check whether an entry exists in the ledger.
	 *
	 * @param id - Evidence entry ID
	 * @returns True if the entry exists
	 */
	has(id: string): boolean {
		return this.entries.has(id);
	}

	/**
	 * Remove an evidence entry from the ledger.
	 *
	 * @param id - Evidence entry ID to remove
	 * @returns True if the entry was removed, false if it didn't exist
	 */
	remove(id: string): boolean {
		return this.entries.delete(id);
	}

	/**
	 * Get all evidence entries in the ledger.
	 */
	getAll(): EvidenceLedgerEntry[] {
		return Array.from(this.entries.values());
	}

	/**
	 * Query evidence entries by filter criteria.
	 * All specified filter criteria are ANDed together.
	 *
	 * @param filter - Filter criteria
	 * @returns Filtered array of evidence entries
	 */
	query(filter: EvidenceFilter = {}): EvidenceLedgerEntry[] {
		let results = this.getAll();

		if (filter.type) {
			results = results.filter((e) => e.type === filter.type);
		}
		if (filter.verdict) {
			results = results.filter((e) => e.verdict === filter.verdict);
		}
		if (filter.minConfidence) {
			results = results.filter((e) => meetsMinConfidence(e.confidence, filter.minConfidence!));
		}
		if (filter.producedBy) {
			results = results.filter((e) => e.producedBy === filter.producedBy);
		}
		if (filter.criterionId) {
			results = results.filter((e) => e.criterionIds.includes(filter.criterionId!));
		}
		if (filter.after !== undefined) {
			results = results.filter((e) => e.timestamp >= filter.after!);
		}
		if (filter.before !== undefined) {
			results = results.filter((e) => e.timestamp <= filter.before!);
		}

		// Apply pagination
		const offset = filter.offset ?? 0;
		const limit = filter.limit ?? results.length;
		return results.slice(offset, offset + limit);
	}

	/**
	 * Get all entries linked to a specific criterion.
	 *
	 * @param criterionId - Criterion ID to filter by
	 * @returns Array of matching evidence entries
	 */
	getByCriterion(criterionId: string): EvidenceLedgerEntry[] {
		return this.query({ criterionId });
	}

	/**
	 * Get entries by verdict.
	 *
	 * @param verdict - Verdict to filter by
	 * @returns Array of matching evidence entries
	 */
	getByVerdict(verdict: EvidenceLedgerEntry["verdict"]): EvidenceLedgerEntry[] {
		return this.query({ verdict });
	}

	/**
	 * Get entries by type.
	 *
	 * @param type - Evidence type to filter by
	 * @returns Array of matching evidence entries
	 */
	getByType(type: EvidenceLedgerEntry["type"]): EvidenceLedgerEntry[] {
		return this.query({ type });
	}

	/**
	 * Compute summary statistics for all entries in the ledger.
	 */
	getSummary(): EvidenceSummary {
		return computeEvidenceSummary(this.getAll());
	}

	/**
	 * Compute summary statistics for entries matching a filter.
	 *
	 * @param filter - Filter criteria
	 * @returns Summary statistics for filtered entries
	 */
	getFilteredSummary(filter: EvidenceFilter = {}): EvidenceSummary {
		return computeEvidenceSummary(this.query(filter));
	}

	/**
	 * Get the pass rate (fraction of entries with "pass" verdict).
	 * Returns 1 if there are no entries.
	 */
	getPassRate(): number {
		const all = this.getAll();
		if (all.length === 0) return 1;
		return all.filter((e) => e.verdict === "pass").length / all.length;
	}

	/**
	 * Get all entries that have a "fail" verdict.
	 */
	getFailures(): EvidenceLedgerEntry[] {
		return this.getByVerdict("fail");
	}

	/**
	 * Get all entries with high confidence.
	 */
	getHighConfidenceEvidence(): EvidenceLedgerEntry[] {
		return this.query({ minConfidence: "high" });
	}

	/**
	 * Clear all entries from the ledger.
	 */
	clear(): void {
		this.entries.clear();
	}

	/**
	 * Serialize the ledger to a plain object for persistence/reporting.
	 */
	toJSON(): EvidenceLedgerSnapshot {
		return {
			scopeId: this.scopeId,
			schemaVersion: EVIDENCE_LEDGER_SCHEMA_VERSION,
			generatedAt: Date.now(),
			total: this.entries.size,
			summary: this.getSummary(),
			entries: this.getAll(),
		};
	}

	/**
	 * Build a human-readable evidence report string.
	 *
	 * @param filter - Optional filter to scope the report
	 * @returns Formatted evidence report
	 */
	buildReport(filter: EvidenceFilter = {}): string {
		const entries = this.query(filter);
		const summary = computeEvidenceSummary(entries);
		const lines: string[] = [];

		lines.push("# Evidence Ledger Report");
		lines.push(`Scope: ${this.scopeId}`);
		lines.push(`Generated: ${new Date().toISOString()}`);
		lines.push(`Schema: ${EVIDENCE_LEDGER_SCHEMA_VERSION}`);
		lines.push("");
		lines.push("## Summary");
		lines.push(`- Total entries: ${summary.total}`);
		lines.push(`- Pass rate: ${(summary.passRate * 100).toFixed(1)}%`);
		lines.push(`- By type: ${JSON.stringify(summary.byType)}`);
		lines.push(`- By verdict: ${JSON.stringify(summary.byVerdict)}`);
		lines.push(`- By confidence: ${JSON.stringify(summary.byConfidence)}`);
		lines.push("");

		if (entries.length === 0) {
			lines.push("No evidence entries.");
			return lines.join("\n");
		}

		lines.push("## Entries");
		for (const entry of entries) {
			lines.push(`### ${entry.id} — ${entry.description}`);
			lines.push(`- Type: ${entry.type}`);
			lines.push(`- Source: ${entry.source}`);
			lines.push(`- Timestamp: ${new Date(entry.timestamp).toISOString()}`);
			lines.push(`- Verdict: ${entry.verdict}`);
			lines.push(`- Confidence: ${entry.confidence}`);
			if (entry.producedBy) lines.push(`- Produced by: ${entry.producedBy}`);
			if (entry.criterionIds.length > 0) {
				lines.push(`- Related criteria: ${entry.criterionIds.join(", ")}`);
			}
			if (entry.content) {
				// Truncate content for readability in reports
				const truncated = entry.content.length > 200
					? entry.content.slice(0, 200) + "..."
					: entry.content;
				lines.push(`- Content: ${truncated}`);
			}
			lines.push("");
		}

		return lines.join("\n");
	}

	/**
	 * Create a ledger populated from a serialized snapshot.
	 *
	 * @param snapshot - Previously serialized ledger snapshot
	 * @returns A new EvidenceLedger with the snapshot's entries
	 */
	static fromJSON(snapshot: EvidenceLedgerSnapshot): EvidenceLedger {
		const ledger = new EvidenceLedger(snapshot.scopeId);
		for (const entry of snapshot.entries) {
			ledger.add(entry);
		}
		return ledger;
	}
}

// ---------------------------------------------------------------------------
// Snapshot Type
// ---------------------------------------------------------------------------

/**
 * Serialized snapshot of an EvidenceLedger for persistence and reporting.
 */
export interface EvidenceLedgerSnapshot {
	scopeId: string;
	schemaVersion: string;
	generatedAt: number;
	total: number;
	summary: EvidenceSummary;
	entries: EvidenceLedgerEntry[];
}
