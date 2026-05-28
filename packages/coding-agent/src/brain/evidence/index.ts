/**
 * Evidence Index — V5.02
 *
 * In-memory evidence index with optional JSON file persistence.
 *
 * The evidence index is a read-only cache (with respect to execution state)
 * that collects and indexes evidence references from across the system.
 * It follows V4 ExecutionKernel doctrine: it never mutates execution state
 * directly — it only stores lightweight reference + content-snapshot entries.
 *
 * Features:
 * - Unified index covering all evidence types (git, validation, journal, etc.)
 * - Query with filters (type, confidence, time range, text search)
 * - Confidence assessment with automatic downgrading for missing evidence
 * - Batch registration for bulk indexing
 * - Optional JSON file persistence
 * - Thread-safe through promise-chain mutex
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
	EvidenceQuery,
	EvidenceQueryResult,
	EvidenceRef,
	EvidenceRefType,
	EvidenceResolution,
	EvidenceSource,
	EvidenceStats,
	IEvidenceIndex,
} from "./types.js";
import {
	assessEvidenceConfidence,
	HIGH_CONFIDENCE_THRESHOLD,
	LOW_CONFIDENCE_THRESHOLD,
	validateEvidenceSource,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal Entry
// ---------------------------------------------------------------------------

/**
 * Internal index entry wrapping an EvidenceRef with optional content.
 */
interface IndexEntry {
	ref: EvidenceRef;
	content?: string;
	registeredAt: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PERSISTENCE_PATH = ".pi/brain/evidence/index.json";

// ---------------------------------------------------------------------------
// EvidenceIndex
// ---------------------------------------------------------------------------

/**
 * In-memory evidence index with optional JSON file persistence.
 *
 * The evidence index is read-only with respect to execution state:
 * it stores only lightweight reference + content-snapshot entries and
 * never calls state mutators on execution kernel components.
 *
 * Thread safety is guaranteed through a promise-chain mutex that
 * serializes all read and write operations.
 */
export class EvidenceIndex implements IEvidenceIndex {
	/** Internal index entries keyed by `${type}:${id}`. */
	private entries: Map<string, IndexEntry> = new Map();
	/** Registered timestamps for chronological ordering. */
	private timestamps: string[] = [];

	/** Promise-chain mutex serialising all index operations. */
	private mutex: Promise<void> = Promise.resolve();

	/** Optional persistence path. */
	private readonly persistencePath: string;

	constructor(persistencePath?: string) {
		this.persistencePath = persistencePath ? resolve(persistencePath) : resolve(DEFAULT_PERSISTENCE_PATH);
	}

	// -----------------------------------------------------------------------
	// Mutex
	// -----------------------------------------------------------------------

	/**
	 * Acquire the mutex to serialise concurrent access.
	 */
	private async withMutex<T>(fn: () => Promise<T>): Promise<T> {
		const prev = this.mutex;
		let release: () => void;
		this.mutex = new Promise<void>((resolve) => {
			release = resolve;
		});
		await prev;
		try {
			return await fn();
		} finally {
			release!();
		}
	}

	// -----------------------------------------------------------------------
	// Register
	// -----------------------------------------------------------------------

	/**
	 * Register a single evidence source in the index.
	 *
	 * If an entry with the same `${type}:${id}` key already exists,
	 * it is overwritten with the new source data (this allows updating
	 * evidence as new information arrives).
	 *
	 * @param source - The evidence source to register
	 * @returns The registered EvidenceRef
	 */
	async register(source: EvidenceSource): Promise<EvidenceRef> {
		return this.withMutex(async () => {
			const validationErrors = validateEvidenceSource(source);
			if (validationErrors.length > 0) {
				throw new Error(`Invalid evidence source: ${validationErrors.join("; ")}`);
			}

			const id = source.id ?? randomUUID();
			const key = `${source.type}:${id}`;
			const timestamp = source.timestamp ?? new Date().toISOString();

			const ref: EvidenceRef = {
				type: source.type,
				id,
				label: source.label,
				description: source.description,
				timestamp,
				sourcePath: source.sourcePath,
				confidence: source.confidence ?? 0.5,
				metadata: source.metadata,
			};

			const entry: IndexEntry = {
				ref,
				content: source.content,
				registeredAt: new Date().toISOString(),
			};

			// If this key is new, record the timestamp for ordering
			if (!this.entries.has(key)) {
				this.timestamps.push(timestamp);
			}

			this.entries.set(key, entry);

			return ref;
		});
	}

	/**
	 * Register multiple evidence sources atomically.
	 *
	 * All sources are validated before any are registered. If any
	 * source is invalid, none are registered.
	 *
	 * @param sources - The evidence sources to register
	 * @returns Array of registered EvidenceRefs
	 */
	async registerBatch(sources: EvidenceSource[]): Promise<EvidenceRef[]> {
		return this.withMutex(async () => {
			// Validate all sources first
			for (const source of sources) {
				const errors = validateEvidenceSource(source);
				if (errors.length > 0) {
					throw new Error(`Invalid evidence source "${source.label}": ${errors.join("; ")}`);
				}
			}

			const refs: EvidenceRef[] = [];
			for (const source of sources) {
				const id = source.id ?? randomUUID();
				const key = `${source.type}:${id}`;
				const timestamp = source.timestamp ?? new Date().toISOString();

				const ref: EvidenceRef = {
					type: source.type,
					id,
					label: source.label,
					description: source.description,
					timestamp,
					sourcePath: source.sourcePath,
					confidence: source.confidence ?? 0.5,
					metadata: source.metadata,
				};

				const entry: IndexEntry = {
					ref,
					content: source.content,
					registeredAt: new Date().toISOString(),
				};

				if (!this.entries.has(key)) {
					this.timestamps.push(timestamp);
				}

				this.entries.set(key, entry);
				refs.push(ref);
			}

			return refs;
		});
	}

	// -----------------------------------------------------------------------
	// Query
	// -----------------------------------------------------------------------

	/**
	 * Query evidence references with optional filters.
	 *
	 * Supports filtering by type, text search (label/description/id),
	 * minimum confidence, and time range. Results are paginated and
	 * sorted by the specified field and order.
	 *
	 * @param query - Query parameters
	 * @returns Query result with matching items and total count
	 */
	async query(query: EvidenceQuery): Promise<EvidenceQueryResult> {
		return this.withMutex(async () => {
			let results = Array.from(this.entries.values());

			// Filter by type
			if (query.types && query.types.length > 0) {
				results = results.filter((e) => query.types!.includes(e.ref.type));
			}

			// Filter by text search (case-insensitive)
			if (query.search) {
				const searchLower = query.search.toLowerCase();
				results = results.filter(
					(e) =>
						e.ref.label.toLowerCase().includes(searchLower) ||
						e.ref.description.toLowerCase().includes(searchLower) ||
						e.ref.id.toLowerCase().includes(searchLower),
				);
			}

			// Filter by minimum confidence
			if (query.minConfidence !== undefined) {
				results = results.filter((e) => e.ref.confidence >= query.minConfidence!);
			}

			// Filter by time range
			if (query.createdAfter) {
				results = results.filter((e) => e.ref.timestamp >= query.createdAfter!);
			}
			if (query.createdBefore) {
				results = results.filter((e) => e.ref.timestamp <= query.createdBefore!);
			}

			// Sort
			const sortBy = query.sortBy ?? "timestamp";
			const sortOrder = query.sortOrder ?? "desc";
			results.sort((a, b) => {
				let cmp: number;
				switch (sortBy) {
					case "confidence":
						cmp = a.ref.confidence - b.ref.confidence;
						break;
					case "label":
						cmp = a.ref.label.localeCompare(b.ref.label);
						break;
					default:
						cmp = a.ref.timestamp.localeCompare(b.ref.timestamp);
						break;
				}
				return sortOrder === "asc" ? cmp : -cmp;
			});

			const total = results.length;
			const offset = query.offset ?? 0;
			const limit = query.limit ?? 50;
			const items = results.slice(offset, offset + limit).map((e) => e.ref);

			return { items, total, query };
		});
	}

	// -----------------------------------------------------------------------
	// Resolve
	// -----------------------------------------------------------------------

	/**
	 * Resolve one or more evidence refs to their stored content.
	 *
	 * Each ref is looked up in the index by its `${type}:${id}` key.
	 * If found, the resolution includes the content snapshot. If not
	 * found, the resolution indicates failure with an error message.
	 *
	 * This is a pure read operation — it never mutates state.
	 *
	 * @param refs - The evidence references to resolve
	 * @returns Array of resolutions (one per input ref, in the same order)
	 */
	async resolve(refs: EvidenceRef[]): Promise<EvidenceResolution[]> {
		return this.withMutex(async () => {
			const now = new Date().toISOString();
			return refs.map((ref) => {
				const key = `${ref.type}:${ref.id}`;
				const entry = this.entries.get(key);

				if (!entry) {
					return {
						ref,
						resolved: false,
						error: `Evidence not found in index: type="${ref.type}", id="${ref.id}"`,
						resolvedAt: now,
					};
				}

				return {
					ref: entry.ref,
					resolved: true,
					content: entry.content,
					resolvedAt: now,
				};
			});
		});
	}

	// -----------------------------------------------------------------------
	// Assess
	// -----------------------------------------------------------------------

	/**
	 * Assess confidence for a set of evidence refs.
	 *
	 * Resolves each ref and computes an overall confidence assessment.
	 * Missing critical evidence types (validation, execution_journal,
	 * approval) will block confident claims entirely.
	 *
	 * This is a pure read operation — it never mutates state.
	 *
	 * @param refs - The evidence references to assess
	 * @returns Assessment with confidence level, score, and recommendations
	 */
	async assess(refs: EvidenceRef[]): Promise<EvidenceAssessment> {
		const resolutions = await this.resolve(refs);
		return assessEvidenceConfidence(resolutions);
	}

	// -----------------------------------------------------------------------
	// Get By Ref
	// -----------------------------------------------------------------------

	/**
	 * Get a single evidence ref by type and id.
	 *
	 * @param type - The evidence type
	 * @param id - The evidence ID within the type domain
	 * @returns The evidence ref, or null if not found
	 */
	async getByRef(type: EvidenceRefType, id: string): Promise<EvidenceRef | null> {
		return this.withMutex(async () => {
			const key = `${type}:${id}`;
			const entry = this.entries.get(key);
			return entry?.ref ?? null;
		});
	}

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	/**
	 * Get aggregate statistics about the evidence index.
	 *
	 * @returns Computed EvidenceStats
	 */
	async stats(): Promise<EvidenceStats> {
		return this.withMutex(async () => {
			const entries = Array.from(this.entries.values());
			const totalRefs = entries.length;

			const byType = {} as Record<EvidenceRefType, number>;
			for (const type of ALL_EVIDENCE_REF_TYPES_FOR_STATS) {
				byType[type] = 0;
			}
			for (const e of entries) {
				byType[e.ref.type] = (byType[e.ref.type] ?? 0) + 1;
			}

			let totalConfidence = 0;
			let highConfidenceCount = 0;
			let lowConfidenceCount = 0;
			for (const e of entries) {
				totalConfidence += e.ref.confidence;
				if (e.ref.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
					highConfidenceCount++;
				}
				if (e.ref.confidence < LOW_CONFIDENCE_THRESHOLD) {
					lowConfidenceCount++;
				}
			}

			const timestamps = entries.map((e) => e.ref.timestamp).sort();
			const earliestTimestamp = timestamps.length > 0 ? timestamps[0] : null;
			const latestTimestamp = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;

			return {
				totalRefs,
				byType,
				averageConfidence: totalRefs > 0 ? totalConfidence / totalRefs : 0,
				highConfidenceCount,
				lowConfidenceCount,
				earliestTimestamp,
				latestTimestamp,
			};
		});
	}

	// -----------------------------------------------------------------------
	// Clear
	// -----------------------------------------------------------------------

	/**
	 * Clear all references from the index.
	 *
	 * Used for testing and reset scenarios. Not intended for production use.
	 */
	async clear(): Promise<void> {
		return this.withMutex(async () => {
			this.entries.clear();
			this.timestamps = [];
		});
	}

	// -----------------------------------------------------------------------
	// Persistence
	// -----------------------------------------------------------------------

	/**
	 * Persist the index to a JSON file.
	 *
	 * @param filePath - Optional path override (defaults to constructor path)
	 */
	async save(filePath?: string): Promise<void> {
		return this.withMutex(async () => {
			const targetPath = filePath ? resolve(filePath) : this.persistencePath;
			const data = {
				entries: Array.from(this.entries.entries()).map(([key, entry]) => ({
					key,
					ref: entry.ref,
					content: entry.content,
					registeredAt: entry.registeredAt,
				})),
				timestamps: this.timestamps,
			};

			await mkdir(dirname(targetPath), { recursive: true });
			await writeFile(targetPath, JSON.stringify(data, null, 2), "utf-8");
		});
	}

	/**
	 * Load the index from a JSON file.
	 *
	 * Replaces any existing in-memory entries.
	 * Silently returns if no file exists.
	 *
	 * @param filePath - Optional path override (defaults to constructor path)
	 * @returns Number of entries loaded
	 */
	async load(filePath?: string): Promise<number> {
		return this.withMutex(async () => {
			const targetPath = filePath ? resolve(filePath) : this.persistencePath;

			if (!existsSync(targetPath)) return 0;

			try {
				const content = await readFile(targetPath, "utf-8");
				const data = JSON.parse(content) as {
					entries: Array<{
						key: string;
						ref: EvidenceRef;
						content?: string;
						registeredAt: string;
					}>;
					timestamps: string[];
				};

				this.entries.clear();
				for (const entry of data.entries ?? []) {
					this.entries.set(entry.key, {
						ref: entry.ref,
						content: entry.content,
						registeredAt: entry.registeredAt,
					});
				}
				this.timestamps = data.timestamps ?? [];

				return this.entries.size;
			} catch (err) {
				console.error(`[EvidenceIndex] Failed to load persistence file: ${err}`);
				return 0;
			}
		});
	}

	// -----------------------------------------------------------------------
	// Size
	// -----------------------------------------------------------------------

	/**
	 * Get the number of entries in the index.
	 */
	async size(): Promise<number> {
		return this.withMutex(async () => {
			return this.entries.size;
		});
	}
}

/**
 * Imported here for stats computation (avoids circular dependency issues).
 */
import { ALL_EVIDENCE_REF_TYPES as ALL_EVIDENCE_REF_TYPES_FOR_STATS } from "./types.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an EvidenceIndex instance.
 *
 * @param persistencePath - Optional path for JSON file persistence
 * @returns EvidenceIndex instance
 */
export function createEvidenceIndex(persistencePath?: string): EvidenceIndex {
	return new EvidenceIndex(persistencePath);
}
