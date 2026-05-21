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
 * This service is stateless: it delegates all storage and generation
 * to the injected ReflectionEngine instance.
 *
 * @packageDocumentation
 */

import { ReflectionEngine } from "./engine.js";
import type {
	FuturePhaseSuggestion,
	MemoryProposalSuggestion,
	ReflectionInput,
	ReflectionReport,
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
// Brain Reflection API
// ---------------------------------------------------------------------------

/**
 * High-level service for reflection API operations.
 *
 * Provides methods for listing, reading, generating, and extracting
 * data from reflection reports. All methods return serializable
 * results suitable for REST API responses.
 *
 * Usage:
 * ```typescript
 * const engine = new ReflectionEngine();
 * const api = new BrainReflectionApi(engine);
 *
 * // List all reflections
 * const { reflections, total } = await api.listReflections({ limit: 10 });
 *
 * // Get a specific reflection
 * const report = await api.getReflection("plan-exec-123");
 *
 * // Generate a new reflection
 * const result = await api.generateReflection(input, { force: true });
 * ```
 */
export class BrainReflectionApi {
	private engine: ReflectionEngine;

	/**
	 * @param engine - An optional ReflectionEngine instance (default: created fresh)
	 */
	constructor(engine?: ReflectionEngine) {
		this.engine = engine ?? new ReflectionEngine();
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
	async generateReflection(
		input: ReflectionInput,
		options?: { force?: boolean },
	): Promise<ReflectionGenerateResult> {
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
		const avgConfidence =
			total > 0
				? all.reduce((sum, r) => sum + r.confidence, 0) / total
				: 0;

		return { total, byPlan, avgConfidence };
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
	 * @param planExecId - The plan execution ID
	 * @returns Memory proposals, or null if the reflection is not found
	 */
	async getMemories(
		planExecId: string,
	): Promise<{ memories: MemoryProposalSuggestion[] } | null> {
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
	 * @param planExecId - The plan execution ID
	 * @returns Future suggestions, or null if the reflection is not found
	 */
	async getFuture(
		planExecId: string,
	): Promise<{ suggestions: FuturePhaseSuggestion[] } | null> {
		const report = this.engine.getReflection(planExecId);
		if (!report) return null;
		return { suggestions: report.futurePhaseSuggestions };
	}
}
