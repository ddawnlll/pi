/**
 * Evidence API — V5.02
 *
 * High-level API for V5 brain components to interact with the evidence index.
 *
 * Provides:
 * - V5EventSink integration for evidence-related events
 * - Evidence assessment for answers, proposals, memory injections, and drafts
 * - Integration with existing stores (memory, proposals, reflections, approvals)
 * - Workspace-scoped evidence queries
 *
 * Following V4 ExecutionKernel doctrine: this API reads from execution
 * artifacts but never mutates execution state directly. It records
 * evidence registration through event emission only.
 *
 * @packageDocumentation
 */

import type { EvidenceIndex } from "./index.js";
import type {
	EvidenceAssessment,
	EvidenceQuery,
	EvidenceQueryResult,
	EvidenceRef,
	EvidenceRefType,
	EvidenceResolution,
	EvidenceSource,
	EvidenceStats,
} from "./types.js";
import { createEvidenceSource } from "./types.js";

// ---------------------------------------------------------------------------
// V5 Event Sink Adapter
// ---------------------------------------------------------------------------

/**
 * Minimal event sink interface for V5 evidence events.
 *
 * V5 brain components emit evidence-related events through this sink,
 * which forwards them to the V5 mutation guard for validation.
 */
export interface EvidenceEventSink {
	emit(event: { kind: "evidence_registered"; evidence: EvidenceRef }): Promise<{ ok: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Evidence Query API
// ---------------------------------------------------------------------------

/**
 * High-level API for evidence operations used by V5 components.
 *
 * All V5 brain components (answers, proposals, memory injections, drafts)
 * use this API to:
 * - Register evidence from their outputs
 * - Query existing evidence
 * - Assess confidence before making claims
 * - Validate that required evidence exists
 *
 * This API is read-only with respect to execution state — it only reads
 * from and writes to the evidence index, never to execution kernel state.
 */
export class EvidenceApi {
	/**
	 * @param index - The evidence index backing this API
	 * @param eventSink - Optional event sink for V5 integration
	 */
	constructor(
		private readonly index: EvidenceIndex,
		private readonly eventSink?: EvidenceEventSink,
	) {}

	// -----------------------------------------------------------------------
	// Registration
	// -----------------------------------------------------------------------

	/**
	 * Register evidence from a V5 output (answer, proposal, memory injection, draft).
	 *
	 * Each V5 output type records evidence references so downstream consumers
	 * can verify provenance and assess confidence.
	 *
	 * @param type - The evidence type to register
	 * @param id - The unique identifier within the type domain
	 * @param label - Human-readable short label
	 * @param description - Description of what this evidence shows
	 * @param confidence - Confidence score (0-1)
	 * @param content - Optional content snapshot
	 * @returns The registered EvidenceRef
	 */
	async registerEvidence(
		type: EvidenceRefType,
		id: string,
		label: string,
		description: string,
		confidence: number,
		content?: string,
	): Promise<EvidenceRef> {
		const source = createEvidenceSource({
			type,
			id,
			label,
			description,
			confidence,
			content,
			timestamp: new Date().toISOString(),
		});

		const ref = await this.index.register(source);

		// Emit event if sink is available (V5 integration)
		if (this.eventSink) {
			await this.eventSink.emit({ kind: "evidence_registered", evidence: ref });
		}

		return ref;
	}

	/**
	 * Register multiple evidence sources at once.
	 *
	 * @param sources - Array of evidence sources to register
	 * @returns Array of registered EvidenceRefs
	 */
	async registerBatch(sources: EvidenceSource[]): Promise<EvidenceRef[]> {
		const refs = await this.index.registerBatch(sources);

		// Emit one event per registration (if sink available)
		if (this.eventSink) {
			for (const ref of refs) {
				await this.eventSink.emit({ kind: "evidence_registered", evidence: ref });
			}
		}

		return refs;
	}

	// -----------------------------------------------------------------------
	// Queries
	// -----------------------------------------------------------------------

	/**
	 * Query the evidence index.
	 *
	 * @param query - Query parameters
	 * @returns Matching evidence references
	 */
	async query(query: EvidenceQuery): Promise<EvidenceQueryResult> {
		return this.index.query(query);
	}

	/**
	 * Get a single evidence ref by type and id.
	 *
	 * @param type - The evidence type
	 * @param id - The evidence ID
	 * @returns The evidence ref, or null if not found
	 */
	async getByRef(type: EvidenceRefType, id: string): Promise<EvidenceRef | null> {
		return this.index.getByRef(type, id);
	}

	/**
	 * List all evidence for a specific type.
	 *
	 * @param type - The evidence type to filter by
	 * @param limit - Maximum results (default: 50)
	 * @param offset - Pagination offset (default: 0)
	 * @returns Matching evidence references
	 */
	async listByType(type: EvidenceRefType, limit?: number, offset?: number): Promise<EvidenceQueryResult> {
		return this.index.query({ types: [type], limit: limit ?? 50, offset: offset ?? 0 });
	}

	// -----------------------------------------------------------------------
	// Assessment
	// -----------------------------------------------------------------------

	/**
	 * Assess confidence for a set of evidence references.
	 *
	 * This is the primary method V5 components use to determine whether
	 * they can make confident claims. The assessment accounts for:
	 * - Missing evidence (not found in index)
	 * - Low-confidence evidence (confidence < 0.4)
	 * - Critical missing evidence (validation, execution_journal, approval)
	 *
	 * @param refs - The evidence references to assess
	 * @returns Assessment with confidence level and recommendations
	 */
	async assess(refs: EvidenceRef[]): Promise<EvidenceAssessment> {
		return this.index.assess(refs);
	}

	/**
	 * Resolve evidence references to their stored content.
	 *
	 * @param refs - The evidence references to resolve
	 * @returns Array of resolutions
	 */
	async resolve(refs: EvidenceRef[]): Promise<EvidenceResolution[]> {
		return this.index.resolve(refs);
	}

	/**
	 * Convenience: check if a set of evidence is sufficient for high-confidence claims.
	 *
	 * Returns true only if all evidence resolves and aggregate confidence >= 0.7.
	 *
	 * @param refs - The evidence references to check
	 * @returns True if evidence is sufficient for high-confidence claims
	 */
	async isSufficient(refs: EvidenceRef[]): Promise<boolean> {
		const assessment = await this.index.assess(refs);
		return assessment.level === "HIGH";
	}

	/**
	 * Convenience: check if evidence would block confident claims.
	 *
	 * Returns true if critical evidence is missing or aggregate confidence < 0.4.
	 *
	 * @param refs - The evidence references to check
	 * @returns True if evidence is insufficient for any claim
	 */
	async isBlocked(refs: EvidenceRef[]): Promise<boolean> {
		const assessment = await this.index.assess(refs);
		return assessment.level === "BLOCKED" || assessment.level === "LOW";
	}

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	/**
	 * Get aggregate statistics about the evidence index.
	 */
	async stats(): Promise<EvidenceStats> {
		return this.index.stats();
	}

	// -----------------------------------------------------------------------
	// Integration Helpers
	// -----------------------------------------------------------------------

	/**
	 * Build evidence refs for a memory record.
	 *
	 * Creates an EvidenceRef pointing to a memory record in the index.
	 *
	 * @param memoryId - The memory record ID
	 * @param label - Short label
	 * @param description - Description
	 * @param confidence - Confidence (0-1)
	 * @returns An EvidenceRef for the memory record
	 */
	memoryRef(memoryId: string, label: string, description: string, confidence: number = 0.7): EvidenceRef {
		return {
			type: "memory",
			id: memoryId,
			label,
			description,
			timestamp: new Date().toISOString(),
			confidence,
		};
	}

	/**
	 * Build evidence refs for a proposal.
	 *
	 * @param proposalId - The proposal ID
	 * @param label - Short label
	 * @param description - Description
	 * @param confidence - Confidence (0-1)
	 * @returns An EvidenceRef for the proposal
	 */
	proposalRef(proposalId: string, label: string, description: string, confidence: number = 0.8): EvidenceRef {
		return {
			type: "proposal",
			id: proposalId,
			label,
			description,
			timestamp: new Date().toISOString(),
			confidence,
		};
	}

	/**
	 * Build evidence refs for a reflection report.
	 *
	 * @param reflectionId - The reflection report ID
	 * @param label - Short label
	 * @param description - Description
	 * @param confidence - Confidence (0-1)
	 * @returns An EvidenceRef for the reflection
	 */
	reflectionRef(reflectionId: string, label: string, description: string, confidence: number = 0.8): EvidenceRef {
		return {
			type: "reflection",
			id: reflectionId,
			label,
			description,
			timestamp: new Date().toISOString(),
			confidence,
		};
	}

	/**
	 * Build evidence refs for an approval/decision record.
	 *
	 * @param approvalId - The approval request ID
	 * @param label - Short label
	 * @param description - Description
	 * @param confidence - Confidence (0-1)
	 * @returns An EvidenceRef for the approval
	 */
	approvalRef(approvalId: string, label: string, description: string, confidence: number = 0.9): EvidenceRef {
		return {
			type: "approval",
			id: approvalId,
			label,
			description,
			timestamp: new Date().toISOString(),
			confidence,
		};
	}

	/**
	 * Build evidence refs for a git file reference.
	 *
	 * @param filePath - The git-tracked file path
	 * @param label - Short label
	 * @param description - Description
	 * @param confidence - Confidence (0-1)
	 * @returns An EvidenceRef for the git file
	 */
	gitFileRef(filePath: string, label: string, description: string, confidence: number = 0.9): EvidenceRef {
		return {
			type: "git_file",
			id: filePath,
			label,
			description,
			timestamp: new Date().toISOString(),
			sourcePath: filePath,
			confidence,
		};
	}

	/**
	 * Build evidence refs for a validation result.
	 *
	 * @param validationId - The validation result ID or path
	 * @param label - Short label
	 * @param description - Description
	 * @param confidence - Confidence (0-1)
	 * @returns An EvidenceRef for the validation
	 */
	validationRef(validationId: string, label: string, description: string, confidence: number = 0.8): EvidenceRef {
		return {
			type: "validation",
			id: validationId,
			label,
			description,
			timestamp: new Date().toISOString(),
			confidence,
		};
	}

	/**
	 * Build evidence refs for an execution journal event.
	 *
	 * @param eventId - The execution journal event ID
	 * @param label - Short label
	 * @param description - Description
	 * @param confidence - Confidence (0-1)
	 * @returns An EvidenceRef for the execution journal event
	 */
	executionJournalRef(eventId: string, label: string, description: string, confidence: number = 0.8): EvidenceRef {
		return {
			type: "execution_journal",
			id: eventId,
			label,
			description,
			timestamp: new Date().toISOString(),
			confidence,
		};
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an EvidenceApi instance.
 *
 * @param index - The EvidenceIndex instance
 * @param eventSink - Optional event sink for V5 integration
 * @returns EvidenceApi instance
 */
export function createEvidenceApi(index: EvidenceIndex, eventSink?: EvidenceEventSink): EvidenceApi {
	return new EvidenceApi(index, eventSink);
}
