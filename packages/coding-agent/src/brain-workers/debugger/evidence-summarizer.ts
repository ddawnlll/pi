/**
 * Debugger Worker — Evidence Summarizer — 25.I
 *
 * Collects, categorizes, and summarizes debug evidence from execution
 * failures, logs, stack traces, and worker diagnostics. Produces
 * structured evidence summaries for root cause analysis.
 *
 * Key design:
 * - Evidence sources are tagged with type and confidence level.
 * - Summaries include direct evidence and inferred context.
 * - All evidence carries refs for audit trail / observability.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Evidence Types
// ---------------------------------------------------------------------------

/**
 * Category of a single piece of debug evidence.
 */
export type EvidenceType =
	| "stack_trace"
	| "error_message"
	| "execution_log"
	| "worker_diagnostic"
	| "state_snapshot"
	| "output_diff"
	| "timing_data"
	| "dependency_graph"
	| "configuration"
	| "user_report"
	| "system_metric"
	| "other";

/**
 * All valid EvidenceType values for runtime validation.
 */
export const ALL_EVIDENCE_TYPES: readonly EvidenceType[] = [
	"stack_trace",
	"error_message",
	"execution_log",
	"worker_diagnostic",
	"state_snapshot",
	"output_diff",
	"timing_data",
	"dependency_graph",
	"configuration",
	"user_report",
	"system_metric",
	"other",
] as const;

/**
 * Confidence level for an evidence item.
 */
export type EvidenceConfidence = "high" | "medium" | "low" | "speculative";

/**
 * All valid EvidenceConfidence values.
 */
export const ALL_EVIDENCE_CONFIDENCES: readonly EvidenceConfidence[] = [
	"high",
	"medium",
	"low",
	"speculative",
] as const;

// ---------------------------------------------------------------------------
// Evidence Item
// ---------------------------------------------------------------------------

/**
 * A single piece of evidence collected during debugging.
 *
 * Each piece carries its source, content, type, confidence, and
 * reference links for traceability.
 */
export interface EvidenceItem {
	/** Unique evidence identifier */
	id: string;

	/** ISO 8601 timestamp of when this evidence was collected */
	timestamp: string;

	/** Category of evidence */
	type: EvidenceType;

	/** Human-readable label for this evidence */
	label: string;

	/** The evidence content (structured or free text) */
	content: string;

	/** Confidence in this evidence's accuracy / relevance */
	confidence: EvidenceConfidence;

	/** Source identifier (e.g., file path, worker ID, log stream) */
	source: string;

	/** Reference URIs for provenance and audit trail */
	refs: string[];

	/** Key-value metadata attached to this evidence */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Evidence Summary
// ---------------------------------------------------------------------------

/**
 * A condensed summary of all evidence collected for a single debug session.
 *
 * Groups evidence by category, highlights key findings, and tracks
 * coverage across evidence types. Used as input to root cause analysis.
 */
export interface EvidenceSummary {
	/** Unique summary identifier */
	id: string;

	/** ISO 8601 timestamp of summary creation */
	createdAt: string;

	/** Correlation / debug session identifier */
	sessionId: string;

	/** Number of evidence items collected */
	evidenceCount: number;

	/** Evidence items grouped by type */
	evidenceByType: Partial<Record<EvidenceType, EvidenceItem[]>>;

	/** Key findings extracted from evidence (free-text summaries) */
	keyFindings: string[];

	/** Highest-confidence evidence items (top N) */
	topEvidence: EvidenceItem[];

	/** Coverage summary — how many items of each type were collected */
	coverage: Record<EvidenceType, number>;

	/** Sources that contributed evidence (deduplicated) */
	sources: string[];

	/** Whether the summary is considered complete for analysis */
	isComplete: boolean;

	/** Gaps identified — evidence types with no or insufficient data */
	gaps: string[];
}

// ---------------------------------------------------------------------------
// Evidential Link
// ---------------------------------------------------------------------------

/**
 * Links a piece of evidence to a root cause finding.
 *
 * Used to build the evidence chain connecting raw data to conclusions.
 */
export interface EvidentialLink {
	/** Evidence item ID */
	evidenceId: string;

	/** How this evidence supports or refutes the finding */
	relationship: "supports" | "refutes" | "contextual";

	/** Strength of the link */
	strength: EvidenceConfidence;

	/** Optional explanatory note */
	note?: string;
}

// ---------------------------------------------------------------------------
// Summarizer Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the EvidenceSummarizer.
 */
export interface EvidenceSummarizerConfig {
	/**
	 * Maximum number of evidence items to retain in a summary.
	 * Default: 200.
	 */
	maxEvidenceItems: number;

	/**
	 * Maximum number of key findings to extract.
	 * Default: 20.
	 */
	maxKeyFindings: number;

	/**
	 * Number of top-confidence evidence items to include.
	 * Default: 10.
	 */
	topEvidenceCount: number;

	/**
	 * Whether to automatically flag evidence gaps (missing types).
	 * Default: true.
	 */
	flagGaps: boolean;

	/**
	 * Evidence types required for a summary to be considered "complete".
	 * Default: ["error_message", "stack_trace", "execution_log", "worker_diagnostic"].
	 */
	requiredTypes: EvidenceType[];
}

/**
 * Default configuration for the EvidenceSummarizer.
 */
export const DEFAULT_EVIDENCE_SUMMARIZER_CONFIG: EvidenceSummarizerConfig = {
	maxEvidenceItems: 200,
	maxKeyFindings: 20,
	topEvidenceCount: 10,
	flagGaps: true,
	requiredTypes: ["error_message", "stack_trace", "execution_log", "worker_diagnostic"],
};

// ---------------------------------------------------------------------------
// Evidence Summarizer
// ---------------------------------------------------------------------------

/**
 * Collects, categorizes, and summarizes debug evidence.
 *
 * Provides methods for adding evidence items, building summaries,
 * extracting key findings, and identifying evidence gaps.
 */
export class EvidenceSummarizer {
	private config: EvidenceSummarizerConfig;
	private evidence: Map<string, EvidenceItem>;

	/**
	 * Create a new EvidenceSummarizer.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<EvidenceSummarizerConfig>) {
		this.config = {
			maxEvidenceItems: config?.maxEvidenceItems ?? DEFAULT_EVIDENCE_SUMMARIZER_CONFIG.maxEvidenceItems,
			maxKeyFindings: config?.maxKeyFindings ?? DEFAULT_EVIDENCE_SUMMARIZER_CONFIG.maxKeyFindings,
			topEvidenceCount: config?.topEvidenceCount ?? DEFAULT_EVIDENCE_SUMMARIZER_CONFIG.topEvidenceCount,
			flagGaps: config?.flagGaps ?? DEFAULT_EVIDENCE_SUMMARIZER_CONFIG.flagGaps,
			requiredTypes: config?.requiredTypes ?? [...DEFAULT_EVIDENCE_SUMMARIZER_CONFIG.requiredTypes],
		};
		this.evidence = new Map();
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the summarizer configuration.
	 */
	setConfig(config: Partial<EvidenceSummarizerConfig>): void {
		if (config.maxEvidenceItems !== undefined) this.config.maxEvidenceItems = config.maxEvidenceItems;
		if (config.maxKeyFindings !== undefined) this.config.maxKeyFindings = config.maxKeyFindings;
		if (config.topEvidenceCount !== undefined) this.config.topEvidenceCount = config.topEvidenceCount;
		if (config.flagGaps !== undefined) this.config.flagGaps = config.flagGaps;
		if (config.requiredTypes !== undefined) this.config.requiredTypes = [...config.requiredTypes];
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): EvidenceSummarizerConfig {
		return { ...this.config, requiredTypes: [...this.config.requiredTypes] };
	}

	// -----------------------------------------------------------------------
	// Evidence Management
	// -----------------------------------------------------------------------

	/**
	 * Add a piece of evidence.
	 *
	 * @param evidence - The evidence item to add (id is auto-generated if omitted).
	 * @returns The stored evidence item.
	 */
	addEvidence(evidence: Omit<EvidenceItem, "id" | "timestamp"> & { id?: string; timestamp?: string }): EvidenceItem {
		const item: EvidenceItem = {
			id: evidence.id ?? randomUUID(),
			timestamp: evidence.timestamp ?? new Date().toISOString(),
			type: evidence.type,
			label: evidence.label,
			content: evidence.content,
			confidence: evidence.confidence,
			source: evidence.source,
			refs: evidence.refs ?? [],
			metadata: evidence.metadata ?? {},
		};

		// Enforce max evidence items by removing oldest
		if (this.evidence.size >= this.config.maxEvidenceItems) {
			const oldestKey = this.evidence.keys().next().value;
			if (oldestKey !== undefined) {
				this.evidence.delete(oldestKey);
			}
		}

		this.evidence.set(item.id, item);
		return item;
	}

	/**
	 * Add multiple evidence items at once.
	 *
	 * @param items - Array of evidence items to add.
	 * @returns The number of items added.
	 */
	addEvidenceBatch(
		items: Array<Omit<EvidenceItem, "id" | "timestamp"> & { id?: string; timestamp?: string }>,
	): number {
		let count = 0;
		for (const item of items) {
			this.addEvidence(item);
			count++;
		}
		return count;
	}

	/**
	 * Get a specific evidence item by ID.
	 *
	 * @param evidenceId - The evidence item ID.
	 * @returns The evidence item, or undefined if not found.
	 */
	getEvidence(evidenceId: string): EvidenceItem | undefined {
		return this.evidence.get(evidenceId);
	}

	/**
	 * Get all evidence items currently stored.
	 */
	getAllEvidence(): EvidenceItem[] {
		return Array.from(this.evidence.values());
	}

	/**
	 * Get evidence items filtered by type.
	 *
	 * @param type - The evidence type to filter by.
	 * @returns Matching evidence items.
	 */
	getEvidenceByType(type: EvidenceType): EvidenceItem[] {
		return this.getAllEvidence().filter((e) => e.type === type);
	}

	/**
	 * Get evidence items filtered by minimum confidence.
	 *
	 * @param minConfidence - Minimum confidence level.
	 * @returns Evidence items at or above the confidence threshold.
	 */
	getEvidenceByMinConfidence(minConfidence: EvidenceConfidence): EvidenceItem[] {
		const levels: Record<EvidenceConfidence, number> = {
			high: 4,
			medium: 3,
			low: 2,
			speculative: 1,
		};

		const minLevel = levels[minConfidence];
		return this.getAllEvidence().filter((e) => levels[e.confidence] >= minLevel);
	}

	/**
	 * Remove a specific evidence item by ID.
	 *
	 * @param evidenceId - The evidence item ID to remove.
	 * @returns true if the item was found and removed.
	 */
	removeEvidence(evidenceId: string): boolean {
		return this.evidence.delete(evidenceId);
	}

	/**
	 * Clear all stored evidence.
	 */
	clearEvidence(): void {
		this.evidence.clear();
	}

	/**
	 * Get the count of stored evidence items.
	 */
	get evidenceCount(): number {
		return this.evidence.size;
	}

	// -----------------------------------------------------------------------
	// Summary Generation
	// -----------------------------------------------------------------------

	/**
	 * Build an EvidenceSummary from all currently stored evidence.
	 *
	 * Groups evidence by type, extracts key findings, identifies gaps,
	 * and produces a structured summary ready for root cause analysis.
	 *
	 * @param sessionId - Optional session identifier. Auto-generated if omitted.
	 * @returns The generated EvidenceSummary.
	 */
	buildSummary(sessionId?: string): EvidenceSummary {
		const allEvidence = this.getAllEvidence();

		// Group by type
		const evidenceByType: Partial<Record<EvidenceType, EvidenceItem[]>> = {};
		for (const item of allEvidence) {
			if (!evidenceByType[item.type]) {
				evidenceByType[item.type] = [];
			}
			evidenceByType[item.type]!.push(item);
		}

		// Coverage counts
		const coverage = Object.fromEntries(
			ALL_EVIDENCE_TYPES.map((t) => [t, (evidenceByType[t] ?? []).length]),
		) as Record<EvidenceType, number>;

		// Top evidence by confidence (high first, then medium, etc.)
		const sortedByConfidence = [...allEvidence].sort((a, b) => {
			const levels: Record<EvidenceConfidence, number> = {
				high: 4,
				medium: 3,
				low: 2,
				speculative: 1,
			};
			return levels[b.confidence] - levels[a.confidence];
		});
		const topEvidence = sortedByConfidence.slice(0, this.config.topEvidenceCount);

		// Sources
		const sources = [...new Set(allEvidence.map((e) => e.source))];

		// Extract key findings from high-confidence evidence
		const keyFindings = this.extractKeyFindings(allEvidence);

		// Identify gaps
		const gaps: string[] = [];
		if (this.config.flagGaps) {
			for (const requiredType of this.config.requiredTypes) {
				const count = (evidenceByType[requiredType] ?? []).length;
				if (count === 0) {
					gaps.push(`Missing evidence type: ${requiredType}`);
				}
			}
		}

		// Determine completeness
		const hasRequired = this.config.requiredTypes.every((t) => (evidenceByType[t] ?? []).length > 0);
		const isComplete = hasRequired || allEvidence.length === 0;

		return {
			id: randomUUID(),
			createdAt: new Date().toISOString(),
			sessionId: sessionId ?? `debug-${randomUUID().slice(0, 8)}`,
			evidenceCount: allEvidence.length,
			evidenceByType,
			keyFindings,
			topEvidence,
			coverage,
			sources,
			isComplete,
			gaps,
		};
	}

	/**
	 * Internal: extract key findings from evidence items.
	 *
	 * Analyzes high-confidence evidence and produces concise findings.
	 * Findings are derived from error messages, diagnostics, and
	 * stack traces when available.
	 *
	 * @param allEvidence - All evidence items to analyze.
	 * @returns Array of key finding strings.
	 */
	private extractKeyFindings(allEvidence: EvidenceItem[]): string[] {
		const findings: string[] = [];
		const maxFindings = this.config.maxKeyFindings;

		// 1. Extract error messages
		const errorMessages = allEvidence
			.filter((e) => e.type === "error_message" && e.confidence !== "speculative")
			.map((e) => e.content.trim())
			.filter(Boolean);

		for (const msg of errorMessages.slice(0, 5)) {
			if (findings.length >= maxFindings) break;
			const finding = `Error: ${msg.length > 200 ? `${msg.slice(0, 200)}...` : msg}`;
			if (!findings.includes(finding)) {
				findings.push(finding);
			}
		}

		// 2. Extract worker diagnostics
		const diagnostics = allEvidence
			.filter((e) => e.type === "worker_diagnostic" && e.confidence !== "speculative")
			.map((e) => e.content.trim())
			.filter(Boolean);

		for (const diag of diagnostics.slice(0, 5)) {
			if (findings.length >= maxFindings) break;
			const finding = `Diagnostic: ${diag.length > 200 ? `${diag.slice(0, 200)}...` : diag}`;
			if (!findings.includes(finding)) {
				findings.push(finding);
			}
		}

		// 3. Extract stack trace summaries
		const stackTraces = allEvidence.filter((e) => e.type === "stack_trace");
		for (const st of stackTraces.slice(0, 3)) {
			if (findings.length >= maxFindings) break;
			const lines = st.content.split("\n").filter((l) => l.trim());
			const topFrame = lines.find((l) => l.includes("at ") || l.includes("Error") || l.includes("at "));
			if (topFrame) {
				const finding = `Stack trace: ${topFrame.trim().slice(0, 150)}`;
				if (!findings.includes(finding)) {
					findings.push(finding);
				}
			}
		}

		// 4. Execution log summaries
		const logs = allEvidence.filter((e) => e.type === "execution_log");
		for (const log of logs.slice(0, 5)) {
			if (findings.length >= maxFindings) break;
			const trimmed = log.content.trim().slice(0, 150);
			if (trimmed) {
				const finding = `Log: ${trimmed}${log.content.length > 150 ? "..." : ""}`;
				if (!findings.includes(finding)) {
					findings.push(finding);
				}
			}
		}

		// If no findings were extracted, provide a fallback
		if (findings.length === 0 && allEvidence.length > 0) {
			findings.push(`Collected ${allEvidence.length} evidence items but no high-confidence findings extracted`);
		}

		return findings;
	}

	// -----------------------------------------------------------------------
	// Evidential Links
	// -----------------------------------------------------------------------

	/**
	 * Create an evidential link between a finding and evidence.
	 *
	 * @param evidenceId - The evidence item ID.
	 * @param relationship - How the evidence relates to the finding.
	 * @param strength - Strength of the link.
	 * @param note - Optional explanatory note.
	 * @returns The EvidentialLink, or null if the evidence does not exist.
	 */
	createLink(
		evidenceId: string,
		relationship: EvidentialLink["relationship"],
		strength: EvidentialLink["strength"],
		note?: string,
	): EvidentialLink | null {
		if (!this.evidence.has(evidenceId)) {
			return null;
		}

		return {
			evidenceId,
			relationship,
			strength,
			note,
		};
	}

	// -----------------------------------------------------------------------
	// Serialization
	// -----------------------------------------------------------------------

	/**
	 * Serialize the current summarizer state (all evidence) to JSON.
	 */
	serializeEvidence(): string {
		return JSON.stringify(this.getAllEvidence(), null, 2);
	}

	/**
	 * Deserialize and load evidence from JSON.
	 *
	 * @param json - JSON string containing evidence items.
	 * @returns The number of items loaded.
	 */
	deserializeEvidence(json: string): number {
		const parsed: unknown = JSON.parse(json);
		if (!Array.isArray(parsed)) {
			throw new Error("Expected a JSON array of evidence items");
		}

		this.clearEvidence();
		let count = 0;
		for (const item of parsed) {
			if (item && typeof item === "object" && typeof (item as EvidenceItem).type === "string") {
				this.evidence.set((item as EvidenceItem).id, item as EvidenceItem);
				count++;
			}
		}
		return count;
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an EvidenceSummarizer with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new EvidenceSummarizer instance.
 */
export function createEvidenceSummarizer(config?: Partial<EvidenceSummarizerConfig>): EvidenceSummarizer {
	return new EvidenceSummarizer(config);
}
