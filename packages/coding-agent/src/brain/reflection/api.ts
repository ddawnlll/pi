/**
 * Brain Reflection API — P17.G
 *
 * High-level API service for reflection operations.
 *
 * Wraps ReflectionEngine into a unified service interface used by
 * the web-server routes. Handles listing, reading, stats, and
 * extraction of memory proposals and future suggestions from
 * stored reflection reports.
 *
 * V5.10 additions:
 * - Evidence-backed claims with confidence (AC1/AC2)
 * - Correct/reject reflections with audit trail (AC3)
 * - No execution state mutation (AC4)
 *
 * This service is stateless: it delegates all storage and generation
 * to the injected ReflectionEngine instance.
 *
 * @packageDocumentation
 */

import type { ReflectionAuditService } from "./audit.js";
import { ReflectionEngine } from "./engine.js";
import type {
	EvidenceClaim,
	FuturePhaseSuggestion,
	MemoryProposalSuggestion,
	ReflectionAuditEntry,
	ReflectionInput,
	ReflectionReport,
	SourceRef,
} from "./types.js";

// ---------------------------------------------------------------------------
// Reflection API Query Types
// ---------------------------------------------------------------------------

/**
 * Query parameters for listing reflections.
 */
export interface ReflectionListQuery {
	/** Filter by plan execution ID (exact match) */
	planExecId?: string;
	/** Filter by plan title (substring match, case-insensitive) */
	planTitle?: string;
	/** Maximum number of results to return (1-1000, default 100) */
	limit?: number;
	/** Number of results to skip (default 0) */
	offset?: number;
	/** Only include reflections created at or after this ISO 8601 timestamp */
	since?: string;
	/** Only include reflections created at or before this ISO 8601 timestamp */
	until?: string;
}

/**
 * Aggregate statistics for stored reflections.
 */
export interface ReflectionStats {
	/** Total number of reflections stored */
	total: number;
	/** Number of reflections per plan execution ID */
	byPlan: Record<string, number>;
	/** Average confidence across all reflections */
	avgConfidence: number;
}

/**
 * Result of a reflection generate operation.
 */
export interface ReflectionGenerateResult {
	success: boolean;
	report?: ReflectionReport;
	error?: string;
	regenerated?: boolean;
}

// ---------------------------------------------------------------------------
// V5.10 Correction/Rejection Result Types
// ---------------------------------------------------------------------------

/**
 * Result of a reflection correction operation.
 */
export interface ReflectionCorrectionResult {
	success: boolean;
	report?: ReflectionReport;
	entry?: ReflectionAuditEntry;
	error?: string;
}

/**
 * Result of a reflection rejection operation.
 */
export interface ReflectionRejectionResult {
	success: boolean;
	entry?: ReflectionAuditEntry;
	error?: string;
}

/**
 * Audit trail query result.
 */
export interface AuditTrailResult {
	entries: ReflectionAuditEntry[];
	total: number;
}

// ---------------------------------------------------------------------------
// Brain Reflection API
// ---------------------------------------------------------------------------

/**
 * High-level service for reflection API operations.
 *
 * Provides methods for listing, reading, generating, correcting, rejecting,
 * and extracting data from reflection reports. All methods return
 * serializable results suitable for REST API responses.
 *
 * V5.10 additions:
 * - `correctClaim()` / `correctSummary()` / `correctConfidence()` — Correct
 *   individual claims or metadata with audit trail (AC3)
 * - `rejectClaim()` / `rejectReport()` — Reject claims or entire reports (AC3)
 * - `getAuditTrail()` — Query the audit trail for a reflection (AC3)
 * - `getClaims()` — Extract evidence-backed claims from a report (AC1/AC2)
 * - `registerClaimsAsEvidence()` — Register reflection claims in the
 *   evidence index for provenance (AC2)
 *
 * Following V4 ExecutionKernel doctrine: these methods never mutate
 * execution state directly. Corrections update in-memory reports only,
 * and audit entries are stored separately.
 *
 * Usage:
 * ```typescript
 * const engine = new ReflectionEngine();
 * const auditService = new ReflectionAuditService(new InMemoryReflectionAuditStore());
 * const api = new BrainReflectionApi(engine, auditService);
 *
 * // List all reflections
 * const { reflections, total } = await api.listReflections({ limit: 10 });
 *
 * // Get a specific reflection
 * const report = await api.getReflection("plan-exec-123");
 *
 * // Generate a new reflection
 * const result = await api.generateReflection(input, { force: true });
 *
 * // Correct a claim (V5.10 AC3)
 * const correction = await api.correctClaim("plan-exec-123", claimId, "Corrected statement", "Was inaccurate");
 *
 * // Get audit trail (V5.10 AC3)
 * const audit = await api.getAuditTrail("plan-exec-123");
 *
 * // Get evidence-backed claims (V5.10 AC1/AC2)
 * const claims = await api.getClaims("plan-exec-123");
 * ```
 */
export class BrainReflectionApi {
	private engine: ReflectionEngine;
	private auditService?: ReflectionAuditService;

	/**
	 * @param engine - An optional ReflectionEngine instance (default: created fresh)
	 * @param auditService - An optional ReflectionAuditService (default: none, corrections unavailable)
	 */
	constructor(engine?: ReflectionEngine, auditService?: ReflectionAuditService) {
		this.engine = engine ?? new ReflectionEngine();
		this.auditService = auditService;
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Get the underlying ReflectionEngine instance.
	 */
	getEngine(): ReflectionEngine {
		return this.engine;
	}

	/**
	 * Get the underlying ReflectionAuditService instance.
	 * Returns undefined if no audit service was configured.
	 */
	getAuditService(): ReflectionAuditService | undefined {
		return this.auditService;
	}

	/**
	 * Set the audit service after construction.
	 */
	setAuditService(auditService: ReflectionAuditService): void {
		this.auditService = auditService;
	}

	// -----------------------------------------------------------------------
	// List / Read
	// -----------------------------------------------------------------------

	/**
	 * List reflections with optional filtering and pagination.
	 *
	 * Filters:
	 * - `planExecId`: exact match on plan execution ID
	 * - `planTitle`: case-insensitive substring match on plan title
	 * - `since`: ISO 8601 timestamp, only reflections created at or after this time
	 * - `until`: ISO 8601 timestamp, only reflections created at or before this time
	 *
	 * Pagination:
	 * - `limit`: max results (1-1000, default 100)
	 * - `offset`: skip N results (default 0)
	 *
	 * @param query - Query parameters (all optional)
	 * @returns Filtered and paginated list with total count
	 */
	async listReflections(query?: ReflectionListQuery): Promise<{
		reflections: ReflectionReport[];
		total: number;
	}> {
		const q = query ?? {};
		let all = this.engine.listReflections();

		// Filter by planExecId (exact match)
		if (q.planExecId) {
			all = all.filter((r) => r.planExecId === q.planExecId);
		}

		// Filter by planTitle (case-insensitive substring)
		if (q.planTitle) {
			const lower = q.planTitle.toLowerCase();
			all = all.filter((r) => (r.planTitle ?? "").toLowerCase().includes(lower));
		}

		// Filter by createdAt timestamp (since)
		if (q.since) {
			const sinceMs = new Date(q.since).getTime();
			all = all.filter((r) => new Date(r.createdAt).getTime() >= sinceMs);
		}

		// Filter by createdAt timestamp (until)
		if (q.until) {
			const untilMs = new Date(q.until).getTime();
			all = all.filter((r) => new Date(r.createdAt).getTime() <= untilMs);
		}

		const total = all.length;

		// Apply pagination
		const limit = q.limit ? Math.max(1, Math.min(q.limit, 1000)) : 100;
		const offset = q.offset ? Math.max(0, q.offset) : 0;

		const paginated = all.slice(offset, offset + limit);

		return {
			reflections: paginated,
			total,
		};
	}

	/**
	 * Get a single reflection report by plan execution ID.
	 *
	 * @param planExecId - The plan execution ID
	 * @returns The reflection report, or null if not found
	 */
	async getReflection(planExecId: string): Promise<ReflectionReport | null> {
		return this.engine.getReflection(planExecId) ?? null;
	}

	/**
	 * Generate a reflection report from execution data.
	 *
	 * Takes a complete ReflectionInput and delegates to the engine's
	 * generateReflection method. If a reflection already exists for
	 * the given planExecId and force is false (default), it returns
	 * the existing report instead of regenerating.
	 *
	 * @param input - The complete reflection input data
	 * @param options - Generation options
	 * @param options.force - If true, overwrite any existing reflection (default: false)
	 * @returns Result with the generated report or error
	 */
	async generateReflection(input: ReflectionInput, options?: { force?: boolean }): Promise<ReflectionGenerateResult> {
		const force = options?.force ?? false;

		try {
			// Check if a reflection already exists
			const existing = this.engine.getReflection(input.planExecId);
			if (existing && !force) {
				return {
					success: true,
					report: existing,
					regenerated: false,
				};
			}

			// Generate the reflection
			const report = await this.engine.generateReflection(input);

			// Record regeneration in audit trail if we're overwriting an existing report
			if (existing && this.auditService) {
				await this.auditService.recordRegeneration(
					report.id,
					existing.id,
					"Regenerated from updated execution data",
				);
			}

			return {
				success: true,
				report,
				regenerated: !!existing,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to generate reflection",
			};
		}
	}

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	/**
	 * Compute aggregate statistics from all stored reflections.
	 *
	 * Returns:
	 * - total: number of reflections
	 * - byPlan: count of reflections per plan execution ID
	 * - avgConfidence: average confidence score across all reflections
	 *
	 * @returns Aggregate statistics
	 */
	async getStats(): Promise<ReflectionStats> {
		const all = this.engine.listReflections();
		const total = all.length;

		// Count per plan
		const byPlan: Record<string, number> = {};
		for (const r of all) {
			byPlan[r.planExecId] = (byPlan[r.planExecId] ?? 0) + 1;
		}

		// Average confidence
		const avgConfidence = total > 0 ? all.reduce((sum, r) => sum + r.confidence, 0) / total : 0;

		return { total, byPlan, avgConfidence };
	}

	// -----------------------------------------------------------------------
	// V5.10: Evidence-backed claims (AC1/AC2)
	// -----------------------------------------------------------------------

	/**
	 * Get evidence-backed claims from a stored reflection report.
	 *
	 * V5.10 AC2: Reflection claims are evidence-backed and include confidence.
	 *
	 * @param planExecId - The plan execution ID
	 * @returns Claims array, or null if the reflection is not found
	 */
	async getClaims(planExecId: string): Promise<{ claims: EvidenceClaim[] } | null> {
		const report = this.engine.getReflection(planExecId);
		if (!report) return null;
		return { claims: report.claims ?? [] };
	}

	/**
	 * Register reflection claims as evidence references in an evidence API.
	 *
	 * V5.10 AC2: Registers each claim as an evidence source in the evidence
	 * index, allowing downstream consumers to trace reflection findings.
	 *
	 * @param planExecId - The plan execution ID
	 * @param evidenceApi - An object with a `registerEvidence` method
	 * @returns Array of registered evidence refs, or null if reflection not found
	 */
	async registerClaimsAsEvidence(
		planExecId: string,
		evidenceApi: {
			registerEvidence: (
				type: string,
				id: string,
				label: string,
				description: string,
				confidence: number,
				content?: string,
			) => Promise<unknown>;
		},
	): Promise<unknown[] | null> {
		const report = this.engine.getReflection(planExecId);
		if (!report) return null;

		const refs: unknown[] = [];
		for (const claim of report.claims ?? []) {
			const ref = await evidenceApi.registerEvidence(
				"reflection",
				`claim-${claim.id}`,
				`Reflection claim: ${claim.statement.slice(0, 80)}`,
				claim.statement,
				claim.confidence,
				JSON.stringify(claim),
			);
			refs.push(ref);
		}

		return refs;
	}

	// -----------------------------------------------------------------------
	// V5.10: Corrections (AC3)
	// -----------------------------------------------------------------------

	/**
	 * Correct a specific claim in a reflection report.
	 *
	 * V5.10 AC3: Rejected/corrected reflections are auditable.
	 *
	 * @param planExecId - The plan execution ID
	 * @param claimId - The ID of the claim to correct
	 * @param correctedValue - The corrected statement
	 * @param reason - Reason for the correction
	 * @param correctedBy - Who made the correction ("user" or "system")
	 * @param sourceRefs - Optional source refs supporting the correction
	 * @returns Result with updated report and audit entry
	 */
	async correctClaim(
		planExecId: string,
		claimId: string,
		correctedValue: string,
		reason: string,
		correctedBy: string = "user",
		sourceRefs?: SourceRef[],
	): Promise<ReflectionCorrectionResult> {
		if (!this.auditService) {
			return { success: false, error: "Audit service not configured" };
		}

		try {
			const report = this.engine.getReflection(planExecId);
			if (!report) {
				return { success: false, error: `Reflection not found: ${planExecId}` };
			}

			const result = await this.auditService.correctClaim(
				report,
				claimId,
				correctedValue,
				reason,
				correctedBy,
				sourceRefs,
			);

			return {
				success: true,
				report: result.report,
				entry: result.entry,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to correct claim",
			};
		}
	}

	/**
	 * Correct the summary of a reflection report.
	 *
	 * V5.10 AC3: Rejected/corrected reflections are auditable.
	 *
	 * @param planExecId - The plan execution ID
	 * @param correctedSummary - The corrected summary text
	 * @param reason - Reason for the correction
	 * @param correctedBy - Who made the correction
	 * @returns Result with updated report and audit entry
	 */
	async correctSummary(
		planExecId: string,
		correctedSummary: string,
		reason: string,
		correctedBy: string = "user",
	): Promise<ReflectionCorrectionResult> {
		if (!this.auditService) {
			return { success: false, error: "Audit service not configured" };
		}

		try {
			const report = this.engine.getReflection(planExecId);
			if (!report) {
				return { success: false, error: `Reflection not found: ${planExecId}` };
			}

			const result = await this.auditService.correctSummary(report, correctedSummary, reason, correctedBy);

			return {
				success: true,
				report: result.report,
				entry: result.entry,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to correct summary",
			};
		}
	}

	/**
	 * Correct the confidence score of a reflection report.
	 *
	 * V5.10 AC3: Auditable correction of confidence.
	 *
	 * @param planExecId - The plan execution ID
	 * @param correctedConfidence - The corrected confidence (0-1)
	 * @param reason - Reason for the correction
	 * @param correctedBy - Who made the correction
	 * @returns Result with updated report and audit entry
	 */
	async correctConfidence(
		planExecId: string,
		correctedConfidence: number,
		reason: string,
		correctedBy: string = "user",
	): Promise<ReflectionCorrectionResult> {
		if (!this.auditService) {
			return { success: false, error: "Audit service not configured" };
		}

		try {
			const report = this.engine.getReflection(planExecId);
			if (!report) {
				return { success: false, error: `Reflection not found: ${planExecId}` };
			}

			const result = await this.auditService.correctConfidence(report, correctedConfidence, reason, correctedBy);

			return {
				success: true,
				report: result.report,
				entry: result.entry,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to correct confidence",
			};
		}
	}

	// -----------------------------------------------------------------------
	// V5.10: Rejections (AC3)
	// -----------------------------------------------------------------------

	/**
	 * Reject a specific claim in a reflection report.
	 *
	 * V5.10 AC3: Claims can be rejected with audit trail preserved.
	 *
	 * @param planExecId - The plan execution ID
	 * @param claimId - The ID of the claim to reject
	 * @param reason - Reason for rejection
	 * @param rejectedBy - Who rejected ("user" or "system")
	 * @returns Result with audit entry
	 */
	async rejectClaim(
		planExecId: string,
		claimId: string,
		reason: string,
		rejectedBy: string = "user",
	): Promise<ReflectionRejectionResult> {
		if (!this.auditService) {
			return { success: false, error: "Audit service not configured" };
		}

		try {
			const report = this.engine.getReflection(planExecId);
			if (!report) {
				return { success: false, error: `Reflection not found: ${planExecId}` };
			}

			const entry = await this.auditService.rejectClaim(report, claimId, reason, rejectedBy);

			return {
				success: true,
				entry,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to reject claim",
			};
		}
	}

	/**
	 * Reject an entire reflection report.
	 *
	 * V5.10 AC3: Reports can be rejected with audit trail preserved.
	 *
	 * @param planExecId - The plan execution ID
	 * @param reason - Reason for rejection
	 * @param rejectedBy - Who rejected
	 * @returns Result with audit entry
	 */
	async rejectReport(
		planExecId: string,
		reason: string,
		rejectedBy: string = "user",
	): Promise<ReflectionRejectionResult> {
		if (!this.auditService) {
			return { success: false, error: "Audit service not configured" };
		}

		try {
			const report = this.engine.getReflection(planExecId);
			if (!report) {
				return { success: false, error: `Reflection not found: ${planExecId}` };
			}

			const entry = await this.auditService.rejectReport(report, reason, rejectedBy);

			return {
				success: true,
				entry,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to reject report",
			};
		}
	}

	// -----------------------------------------------------------------------
	// V5.10: Audit Trail (AC3)
	// -----------------------------------------------------------------------

	/**
	 * Get the audit trail for a specific reflection report.
	 *
	 * V5.10 AC3: Rejected/corrected reflections are auditable.
	 *
	 * @param planExecId - The plan execution ID (not report ID)
	 * @returns Audit entries for the reflection
	 */
	async getAuditTrail(planExecId: string): Promise<AuditTrailResult> {
		if (!this.auditService) {
			return { entries: [], total: 0 };
		}

		const report = this.engine.getReflection(planExecId);
		if (!report) {
			return { entries: [], total: 0 };
		}

		const entries = await this.auditService.getStore().getByReportId(report.id);
		return { entries, total: entries.length };
	}

	/**
	 * Get all audit entries with pagination.
	 *
	 * @param limit - Maximum results (default: 100)
	 * @param offset - Pagination offset (default: 0)
	 * @returns Paginated audit entries
	 */
	async listAuditEntries(limit?: number, offset?: number): Promise<AuditTrailResult> {
		if (!this.auditService) {
			return { entries: [], total: 0 };
		}

		return this.auditService.getStore().list(limit, offset);
	}

	// -----------------------------------------------------------------------
	// Memories & Future (extracted from a stored report)
	// -----------------------------------------------------------------------

	/**
	 * Get memory proposals from a stored reflection report.
	 *
	 * Extracts the `memoriesToCreate` array from the reflection
	 * with the given planExecId.
	 *
	 * V5.10 AC1: Post-run reflection can generate memory candidates with source refs.
	 *
	 * @param planExecId - The plan execution ID
	 * @returns Memory proposals, or null if the reflection is not found
	 */
	async getMemories(planExecId: string): Promise<{ memories: MemoryProposalSuggestion[] } | null> {
		const report = this.engine.getReflection(planExecId);
		if (!report) return null;
		return { memories: report.memoriesToCreate };
	}

	/**
	 * Get future phase suggestions from a stored reflection report.
	 *
	 * Extracts the `futurePhaseSuggestions` array from the reflection
	 * with the given planExecId.
	 *
	 * V5.10 AC1: Post-run reflection can generate future proposals with source refs.
	 *
	 * @param planExecId - The plan execution ID
	 * @returns Future suggestions, or null if the reflection is not found
	 */
	async getFuture(planExecId: string): Promise<{ suggestions: FuturePhaseSuggestion[] } | null> {
		const report = this.engine.getReflection(planExecId);
		if (!report) return null;
		return { suggestions: report.futurePhaseSuggestions };
	}
}
