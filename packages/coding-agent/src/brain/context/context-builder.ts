/**
 * Context Builder — V5.04
 *
 * Assembles the context pack used by query, proposal, draft, and plan
 * generation. The context pack includes memory retrieval results, evidence
 * assessments, temporal context, and source tracking.
 *
 * Following V4 ExecutionKernel doctrine: the context builder reads from
 * existing stores and indices but never mutates execution state directly.
 * It emits context_pack_built events through the V5EventSink instead of
 * pushing data directly to generators.
 *
 * The context pack is designed to satisfy:
 * AC1: Generated plan drafts include memoryRetrievalReport and evidence pack summary
 * AC4: No generated content can claim memory support without included evidence refs
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import type { EvidencePack, EvidencePackSummary } from "../evidence/pack.js";
import { buildEvidencePack, buildEvidencePackSummary, createEmptyEvidencePack } from "../evidence/pack.js";
import type { EvidenceRef, EvidenceResolution } from "../evidence/types.js";
import { assessEvidenceConfidence } from "../evidence/types.js";
import type { MemoryRetrievalReport, MemoryRetrievalResult } from "../memory/retrieval.js";
import type { V5EventSink } from "../v5/types.js";
import type { ContextBuildOptions, ContextPack, ContextSource, StuckItemSummary, TemporalContext } from "./types.js";

// =========================================================================
// Context Builder
// =========================================================================

/**
 * Context builder — assembles context packs for downstream generators.
 *
 * The builder gathers context from:
 * 1. Memory retrieval (MemoryRetrievalV2)
 * 2. Evidence index (EvidenceApi)
 * 3. Temporal journal (TemporalEngine)
 *
 * Each source is tracked in the pack's sources array with confidence
 * metadata so generators can weigh inputs appropriately.
 *
 * Usage:
 * ```typescript
 * const builder = new ContextBuilder(options);
 * const pack = await builder.build({
 *   scope: "ws-123",
 *   memoryLimit: 10,
 * });
 * ```
 */
export class ContextBuilder {
	/** Function to retrieve memories by query. */
	private readonly retrieveMemories: (query: {
		types?: string[];
		searchText?: string;
		tags?: string[];
		limit?: number;
		offset?: number;
	}) => Promise<MemoryRetrievalResult>;

	/** Function to resolve evidence refs. */
	private readonly resolveEvidence: (refs: EvidenceRef[]) => Promise<EvidenceResolution[]>;

	/** Function to query evidence. */
	private readonly queryEvidence: (query: {
		types?: string[];
		search?: string;
		minConfidence?: number;
		createdAfter?: string;
		createdBefore?: string;
		limit?: number;
		offset?: number;
		sortBy?: string;
		sortOrder?: string;
	}) => Promise<{ items: EvidenceRef[]; total: number }>;

	/** Function to query temporal events (optional). */
	private readonly queryTemporalEvents?: (query: {
		since?: string;
		until?: string;
		entityId?: string;
		eventTypes?: string[];
		limit?: number;
		offset?: number;
	}) => Promise<{ items: unknown[]; total: number }>;

	/** Function to query stuck items (optional). */
	private readonly queryStuckItems?: (
		since: string,
		until: string,
		entityId?: string,
	) => Promise<{ items: unknown[]; total: number; period: { since: string; until: string } }>;

	/** Optional V5 event sink for emitting context_pack_built events. */
	private readonly eventSink?: V5EventSink;

	/**
	 * Create a new ContextBuilder.
	 *
	 * @param options - Configuration for the context builder
	 */
	constructor(options: {
		retrieveMemories: (query: {
			types?: string[];
			searchText?: string;
			tags?: string[];
			limit?: number;
			offset?: number;
		}) => Promise<MemoryRetrievalResult>;
		resolveEvidence: (refs: EvidenceRef[]) => Promise<EvidenceResolution[]>;
		queryEvidence: (query: {
			types?: string[];
			search?: string;
			minConfidence?: number;
			createdAfter?: string;
			createdBefore?: string;
			limit?: number;
			offset?: number;
			sortBy?: string;
			sortOrder?: string;
		}) => Promise<{ items: EvidenceRef[]; total: number }>;
		queryTemporalEvents?: (query: {
			since?: string;
			until?: string;
			entityId?: string;
			eventTypes?: string[];
			limit?: number;
			offset?: number;
		}) => Promise<{ items: unknown[]; total: number }>;
		queryStuckItems?: (
			since: string,
			until: string,
			entityId?: string,
		) => Promise<{ items: unknown[]; total: number; period: { since: string; until: string } }>;
		eventSink?: V5EventSink;
	}) {
		this.retrieveMemories = options.retrieveMemories;
		this.resolveEvidence = options.resolveEvidence;
		this.queryEvidence = options.queryEvidence;
		this.queryTemporalEvents = options.queryTemporalEvents;
		this.queryStuckItems = options.queryStuckItems;
		this.eventSink = options.eventSink;
	}

	// -------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------

	/**
	 * Build a context pack for the given scope.
	 *
	 * The pack is assembled from all available sources and emitted
	 * as a context_pack_built event if a V5 event sink is configured.
	 *
	 * @param options - Build options specifying scope and limits
	 * @returns A fully populated ContextPack
	 */
	async build(options: ContextBuildOptions): Promise<ContextPack> {
		const startedAt = Date.now();
		const sources: ContextSource[] = [];
		const memoryRetrievalReports: MemoryRetrievalReport[] = [];
		const evidenceRefs: EvidenceRef[] = [];

		// 1. Gather memory retrieval context
		const memorySource = await this.gatherMemoryContext(options, memoryRetrievalReports, evidenceRefs);
		if (memorySource) {
			sources.push(memorySource);
		}

		// 2. Gather evidence pack
		const evidenceSource = await this.gatherEvidenceContext(options, evidenceRefs);
		if (evidenceSource) {
			sources.push(evidenceSource);
		}

		// 3. Gather temporal context (if available and requested)
		let temporalContext: TemporalContext | undefined;
		if (options.includeTemporalContext !== false && this.queryTemporalEvents) {
			const temporalResult = await this.gatherTemporalContext(options);
			temporalContext = temporalResult.context;
			if (temporalResult.source) {
				sources.push(temporalResult.source);
			}
		}

		// 4. Build evidence pack from all gathered refs
		let evidencePack: EvidencePack;
		if (evidenceRefs.length > 0) {
			evidencePack = await buildEvidencePack(options.scope, evidenceRefs, this.resolveEvidence, {
				title: `Context Evidence Pack for ${options.scope}`,
				metadata: {
					sourceCount: sources.length,
					buildDurationMs: Date.now() - startedAt,
				},
			});
		} else {
			evidencePack = createEmptyEvidencePack(options.scope, `Context Evidence Pack for ${options.scope}`);
		}

		const evidencePackSummary = buildEvidencePackSummary(evidencePack);

		// 5. Compute overall confidence
		const overallAssessment = assessEvidenceConfidence(
			evidenceRefs.map((ref) => ({
				ref,
				resolved: true,
				resolvedAt: new Date().toISOString(),
			})),
		);

		// 6. Build the context pack
		const pack: ContextPack = {
			id: randomUUID(),
			title: `Context Pack for ${options.scope}`,
			scope: options.scope,
			createdAt: new Date().toISOString(),
			sources,
			memoryRetrievalReports,
			evidencePackSummary,
			temporalContext,
			overallConfidenceLevel: overallAssessment.level,
			overallConfidence: overallAssessment.confidence,
			summary: this.buildPackSummary(sources, evidencePackSummary, temporalContext),
			evidenceRefs,
		};

		// 7. Emit event if sink is configured (V4 doctrine: actors emit events only)
		if (this.eventSink) {
			await this.eventSink.emit({
				kind: "timeline",
				event: {
					id: randomUUID(),
					eventType: "observation",
					timestamp: new Date().toISOString(),
					data: {
						kind: "context_pack_built",
						pack,
					} as Record<string, unknown>,
					severity: "info",
				},
			});
		}

		return pack;
	}

	// -------------------------------------------------------------------
	// Context Gathering Methods
	// -------------------------------------------------------------------

	/**
	 * Gather memory retrieval context for the pack.
	 */
	private async gatherMemoryContext(
		options: ContextBuildOptions,
		memoryRetrievalReports: MemoryRetrievalReport[],
		evidenceRefs: EvidenceRef[],
	): Promise<ContextSource | null> {
		const limit = options.memoryLimit ?? 10;

		try {
			// Query memories across all active types
			const result = await this.retrieveMemories({
				types: ["failure_memory", "decision_memory", "project_memory", "architecture_memory"],
				limit,
			});

			if (result.success && result.report) {
				memoryRetrievalReports.push(result.report);

				// Add memory evidence refs
				for (const entry of result.report.entries) {
					evidenceRefs.push({
						type: "memory",
						id: entry.id,
						label: entry.title,
						description: entry.summary,
						timestamp: entry.createdAt,
						confidence: entry.confidence,
						sourcePath: undefined,
					});
				}

				return {
					type: "memory_retrieval",
					label: "Memory Retrieval",
					description: `Retrieved ${result.report.entries.length} memory records (${result.report.filteredByLifecycle} excluded by lifecycle)`,
					itemCount: result.report.entries.length,
					confidenceLevel: result.report.entries.length > 0 ? "HIGH" : "LOW",
					confidence: result.report.entries.length > 0 ? 0.8 : 0.2,
					retrievedAt: new Date().toISOString(),
					metadata: {
						total: result.report.total,
						filteredByLifecycle: result.report.filteredByLifecycle,
					},
				};
			}

			return null;
		} catch {
			// If memory retrieval fails, continue without it
			return {
				type: "memory_retrieval",
				label: "Memory Retrieval",
				description: "Memory retrieval failed or unavailable",
				itemCount: 0,
				confidenceLevel: "LOW",
				confidence: 0,
				retrievedAt: new Date().toISOString(),
			};
		}
	}

	/**
	 * Gather evidence context for the pack.
	 */
	private async gatherEvidenceContext(
		options: ContextBuildOptions,
		evidenceRefs: EvidenceRef[],
	): Promise<ContextSource | null> {
		if (options.skipEvidencePack) {
			return null;
		}

		try {
			// Query recent evidence
			const evidenceResult = await this.queryEvidence({
				limit: 50,
				sortBy: "timestamp",
				sortOrder: "desc",
			});

			if (evidenceResult.items.length > 0) {
				// Merge unique evidence refs (avoid duplicates)
				const existingIds = new Set(evidenceRefs.map((r) => `${r.type}:${r.id}`));
				for (const ref of evidenceResult.items) {
					const key = `${ref.type}:${ref.id}`;
					if (!existingIds.has(key)) {
						evidenceRefs.push(ref);
						existingIds.add(key);
					}
				}

				return {
					type: "evidence_index",
					label: "Evidence Index",
					description: `Found ${evidenceResult.items.length} evidence references (${evidenceResult.total} total)`,
					itemCount: evidenceResult.items.length,
					confidenceLevel: evidenceResult.items.length > 5 ? "HIGH" : "MEDIUM",
					confidence: Math.min(0.9, evidenceResult.items.length / 50),
					retrievedAt: new Date().toISOString(),
					metadata: {
						total: evidenceResult.total,
					},
				};
			}

			return null;
		} catch {
			return {
				type: "evidence_index",
				label: "Evidence Index",
				description: "Evidence query failed or unavailable",
				itemCount: 0,
				confidenceLevel: "LOW",
				confidence: 0,
				retrievedAt: new Date().toISOString(),
			};
		}
	}

	/**
	 * Gather temporal context for the pack.
	 */
	private async gatherTemporalContext(options: ContextBuildOptions): Promise<{
		context: TemporalContext;
		source: ContextSource | null;
	}> {
		const since = options.temporalSince ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
		const until = options.temporalUntil ?? new Date().toISOString();

		try {
			// Query events
			const eventsResult = await this.queryTemporalEvents!({
				since,
				until,
				limit: 100,
			});

			// Query stuck items
			let stuckItems: StuckItemSummary[] = [];
			if (this.queryStuckItems) {
				try {
					const stuckResult = await this.queryStuckItems(since, until, options.scope);
					stuckItems = (stuckResult.items ?? []).map((item: any) => ({
						entityId: item.entityId,
						entityType: item.entityType,
						description: item.description ?? item.summary ?? "Unknown stuck item",
						duration: item.duration ?? "Unknown",
					}));
				} catch {
					// Stuck items query is optional
				}
			}

			const temporalContext: TemporalContext = {
				since,
				until,
				whatHappened: `${eventsResult.total} temporal event(s) in this period`,
				stuckItems,
				patterns: [],
				eventCount: eventsResult.total,
			};

			const source: ContextSource = {
				type: "temporal_journal",
				label: "Temporal Journal",
				description: `${eventsResult.total} events, ${stuckItems.length} stuck items`,
				itemCount: eventsResult.total + stuckItems.length,
				confidenceLevel: eventsResult.total > 0 ? "HIGH" : "LOW",
				confidence: Math.min(0.9, eventsResult.total / 100),
				retrievedAt: new Date().toISOString(),
			};

			return { context: temporalContext, source };
		} catch {
			const emptyContext: TemporalContext = {
				since,
				until,
				whatHappened: "Temporal query failed",
				stuckItems: [],
				patterns: [],
				eventCount: 0,
			};

			return {
				context: emptyContext,
				source: {
					type: "temporal_journal",
					label: "Temporal Journal",
					description: "Temporal query failed or unavailable",
					itemCount: 0,
					confidenceLevel: "LOW",
					confidence: 0,
					retrievedAt: new Date().toISOString(),
				},
			};
		}
	}

	// -------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------

	/**
	 * Build a human-readable summary string for the pack.
	 */
	private buildPackSummary(
		sources: ContextSource[],
		evidencePackSummary: EvidencePackSummary,
		temporalContext?: TemporalContext,
	): string {
		const parts: string[] = [];

		if (sources.length > 0) {
			const sourceDescriptions = sources.map((s) => `${s.label} (${s.itemCount} items)`);
			parts.push(`Context from ${sources.length} source(s): ${sourceDescriptions.join(", ")}`);
		} else {
			parts.push("No context sources available");
		}

		parts.push(
			`Evidence: ${evidencePackSummary.totalRefs} ref(s), ${evidencePackSummary.confidenceLevel} confidence`,
		);

		if (temporalContext) {
			parts.push(`Temporal: ${temporalContext.eventCount} events, ${temporalContext.stuckItems.length} stuck items`);
		}

		parts.push(`Overall: ${evidencePackSummary.confidenceLevel} confidence`);

		return parts.join(" — ");
	}
}

// =========================================================================
// Factory
// =========================================================================

/**
 * Create a ContextBuilder instance.
 *
 * @param options - Configuration for the context builder
 * @returns ContextBuilder instance
 */
export function createContextBuilder(options: {
	retrieveMemories: (query: {
		types?: string[];
		searchText?: string;
		tags?: string[];
		limit?: number;
		offset?: number;
	}) => Promise<MemoryRetrievalResult>;
	resolveEvidence: (refs: EvidenceRef[]) => Promise<EvidenceResolution[]>;
	queryEvidence: (query: {
		types?: string[];
		search?: string;
		minConfidence?: number;
		createdAfter?: string;
		createdBefore?: string;
		limit?: number;
		offset?: number;
	}) => Promise<{ items: EvidenceRef[]; total: number }>;
	queryTemporalEvents?: (query: {
		since?: string;
		until?: string;
		entityId?: string;
		eventTypes?: string[];
		limit?: number;
		offset?: number;
	}) => Promise<{ items: unknown[]; total: number }>;
	queryStuckItems?: (
		since: string,
		until: string,
		entityId?: string,
	) => Promise<{ items: unknown[]; total: number; period: { since: string; until: string } }>;
	eventSink?: V5EventSink;
}): ContextBuilder {
	return new ContextBuilder(options);
}
