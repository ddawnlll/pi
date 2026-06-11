/**
 * P45.S1 — Spec Quality Ledger
 *
 * Records every predicted contract outcome for historical quality tracking.
 *
 * Outcome types:
 * - matched: prediction exactly matched the actual outcome
 * - compatible_drift: prediction differed but was compatible (non-breaking)
 * - breaking_drift: prediction was wrong in a breaking way
 * - missing: contract was needed but not predicted
 * - unused: contract was predicted but never used
 * - overpredicted: prediction was more specific/optimistic than reality
 *
 * The ledger exposes derived risk metrics consumed by the PredictiveSpecQualityGate:
 * - precision: matched / (matched + compatible_drift + unused + overpredicted)
 * - recall: matched / (matched + breaking_drift + missing)
 * - driftRatio: (breaking_drift + compatible_drift) / total
 * - breakingDriftRatio: breaking_drift / total
 * - overpredictionRatio: overpredicted / total
 *
 * LLM confidence is never stored as authority. The ledger records only
 * evidence-class outcomes: static_confirmation, human_approval,
 * historical_pattern_confirmation, llm_only, unknown.
 */

// =============================================================================
// Types
// =============================================================================

export type SpecOutcomeType =
	| "matched"
	| "compatible_drift"
	| "breaking_drift"
	| "missing"
	| "unused"
	| "overpredicted";

export type EvidenceClass =
	| "static_confirmation"
	| "human_approval"
	| "historical_pattern_confirmation"
	| "llm_only"
	| "unknown";

export interface SpecQualityEntry {
	/** Unique entry identifier. */
	id: string;
	/** Contract name or path. */
	contract: string;
	/** Namespace or workspace that produced the prediction. */
	namespace: string;
	/** The predicted outcome classification. */
	predictedOutcome: SpecOutcomeType;
	/** The actual measured outcome. */
	actualOutcome: SpecOutcomeType;
	/** Evidence class for the actual outcome (never LLM confidence). */
	evidenceClass: EvidenceClass;
	/** ISO timestamp of the record. */
	recordedAt: string;
	/** SHA or version of the spec this entry refers to. */
	specVersion?: string;
	/** Human-readable notes (not machine authority). */
	notes?: string;
}

export interface SpecQualityMetrics {
	/** Total number of recorded outcomes. */
	totalEntries: number;
	/** Count by outcome type. */
	outcomeCounts: Record<SpecOutcomeType, number>;
	/** Count by evidence class. */
	evidenceClassCounts: Record<EvidenceClass, number>;
	/** Precision: matched / (matched + compatible_drift + unused + overpredicted). */
	precision: number;
	/** Recall: matched / (matched + breaking_drift + missing). */
	recall: number;
	/** Drift ratio: (breaking_drift + compatible_drift) / total. */
	driftRatio: number;
	/** Breaking drift ratio: breaking_drift / total. */
	breakingDriftRatio: number;
	/** Overprediction ratio: overpredicted / total. */
	overpredictionRatio: number;
	/** Ratio of llm_only evidence to all evidence classes. */
	llmOnlyRatio: number;
}

// =============================================================================
// Spec Quality Ledger
// =============================================================================

export class SpecQualityLedger {
	private entries: SpecQualityEntry[] = [];

	/**
	 * Record a new quality entry.
	 * Duplicate IDs are rejected to prevent silent overwrites.
	 */
	record(entry: SpecQualityEntry): { success: true } | { success: false; reason: string } {
		if (this.entries.some((e) => e.id === entry.id)) {
			return { success: false, reason: `Duplicate entry ID: ${entry.id}` };
		}
		this.entries.push({ ...entry });
		return { success: true };
	}

	/**
	 * Record a batch of entries. Returns count of accepted vs rejected.
	 */
	recordBatch(entries: SpecQualityEntry[]): { accepted: number; rejected: number } {
		let accepted = 0;
		let rejected = 0;
		for (const entry of entries) {
			const result = this.record(entry);
			if (result.success) {
				accepted++;
			} else {
				rejected++;
			}
		}
		return { accepted, rejected };
	}

	/**
	 * Get all recorded entries (shallow copy).
	 */
	getEntries(): SpecQualityEntry[] {
		return [...this.entries];
	}

	/**
	 * Get entries filtered by namespace.
	 */
	getEntriesByNamespace(namespace: string): SpecQualityEntry[] {
		return this.entries.filter((e) => e.namespace === namespace);
	}

	/**
	 * Get entries filtered by evidence class.
	 */
	getEntriesByEvidenceClass(evidenceClass: EvidenceClass): SpecQualityEntry[] {
		return this.entries.filter((e) => e.evidenceClass === evidenceClass);
	}

	/**
	 * Calculate derived quality metrics from current entries.
	 * Returns null if no entries exist (not an error — just no data).
	 */
	computeMetrics(): SpecQualityMetrics | null {
		if (this.entries.length === 0) {
			return null;
		}

		const outcomeCounts: Record<SpecOutcomeType, number> = {
			matched: 0,
			compatible_drift: 0,
			breaking_drift: 0,
			missing: 0,
			unused: 0,
			overpredicted: 0,
		};

		const evidenceClassCounts: Record<EvidenceClass, number> = {
			static_confirmation: 0,
			human_approval: 0,
			historical_pattern_confirmation: 0,
			llm_only: 0,
			unknown: 0,
		};

		for (const entry of this.entries) {
			outcomeCounts[entry.actualOutcome]++;
			evidenceClassCounts[entry.evidenceClass]++;
		}

		const total = this.entries.length;
		const matched = outcomeCounts.matched;
		const compatible = outcomeCounts.compatible_drift;
		const breaking = outcomeCounts.breaking_drift;
		const missing = outcomeCounts.missing;
		const unused = outcomeCounts.unused;
		const overpredicted = outcomeCounts.overpredicted;

		const precision = matched > 0 ? matched / (matched + compatible + unused + overpredicted) : 0;

		const recallDenom = matched + breaking + missing;
		const recall = recallDenom > 0 ? matched / recallDenom : 0;

		const driftRatio = total > 0 ? (breaking + compatible) / total : 0;
		const breakingDriftRatio = total > 0 ? breaking / total : 0;
		const overpredictionRatio = total > 0 ? overpredicted / total : 0;
		const llmOnlyRatio = total > 0 ? evidenceClassCounts.llm_only / total : 0;

		return {
			totalEntries: total,
			outcomeCounts,
			evidenceClassCounts,
			precision: round3(precision),
			recall: round3(recall),
			driftRatio: round3(driftRatio),
			breakingDriftRatio: round3(breakingDriftRatio),
			overpredictionRatio: round3(overpredictionRatio),
			llmOnlyRatio: round3(llmOnlyRatio),
		};
	}

	/**
	 * Check if the ledger has enough data for reliable quality assessment.
	 * Requires a minimum number of entries across at least 2 evidence classes.
	 */
	isReliable(minEntries = 10, minEvidenceClasses = 2): boolean {
		if (this.entries.length < minEntries) return false;
		const classesWithData = new Set(this.entries.map((e) => e.evidenceClass));
		return classesWithData.size >= minEvidenceClasses;
	}

	/**
	 * Clear all entries (used for testing or reset).
	 */
	clear(): void {
		this.entries = [];
	}
}

// =============================================================================
// Helpers
// =============================================================================

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/**
 * Create a default empty ledger.
 */
export function createSpecQualityLedger(): SpecQualityLedger {
	return new SpecQualityLedger();
}

/**
 * Serialize the ledger entries for persistence (JSONL format).
 */
export function serializeLedgerEntries(ledger: SpecQualityLedger): string {
	return (
		ledger
			.getEntries()
			.map((e) => JSON.stringify(e))
			.join("\n") + "\n"
	);
}

/**
 * Parse ledger entries from JSONL content.
 * Skips malformed lines (does not fail entirely).
 */
export function parseLedgerEntries(jsonl: string): { entries: SpecQualityEntry[]; errors: string[] } {
	const entries: SpecQualityEntry[] = [];
	const errors: string[] = [];
	const lines = jsonl.split("\n").filter((l) => l.trim().length > 0);

	for (let i = 0; i < lines.length; i++) {
		try {
			const entry = JSON.parse(lines[i]) as SpecQualityEntry;
			if (!isValidSpecQualityEntry(entry)) {
				errors.push(`Line ${i + 1}: invalid SpecQualityEntry structure`);
				continue;
			}
			entries.push(entry);
		} catch {
			errors.push(`Line ${i + 1}: invalid JSON`);
		}
	}

	return { entries, errors };
}

/** Validate a SpecQualityEntry has all required fields with correct types. */
function isValidSpecQualityEntry(value: unknown): value is SpecQualityEntry {
	if (typeof value !== "object" || value === null) return false;
	const e = value as Record<string, unknown>;
	const validOutcomes: SpecOutcomeType[] = [
		"matched",
		"compatible_drift",
		"breaking_drift",
		"missing",
		"unused",
		"overpredicted",
	];
	const validClasses: EvidenceClass[] = [
		"static_confirmation",
		"human_approval",
		"historical_pattern_confirmation",
		"llm_only",
		"unknown",
	];
	return (
		typeof e.id === "string" &&
		typeof e.contract === "string" &&
		typeof e.namespace === "string" &&
		validOutcomes.includes(e.predictedOutcome as SpecOutcomeType) &&
		validOutcomes.includes(e.actualOutcome as SpecOutcomeType) &&
		validClasses.includes(e.evidenceClass as EvidenceClass) &&
		typeof e.recordedAt === "string"
	);
}
