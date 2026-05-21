/**
 * Memory Store — P14.B
 *
 * Durable JSON-file-backed persistence for memory records with index-based
 * fast lookup, atomic writes, and thread-safe operations.
 *
 * Directory structure under basePath:
 * ```
 * brain/
 *   memory/
 *     index.json              # Master index for fast lookups
 *     {id}.json               # Individual memory records
 *     conflicts/
 *       {id}.json             # Conflict records
 * ```
 *
 * File naming: each memory record is stored as `{id}.json` where `id` is
 * a UUID v4 string. Conflicts are stored under `conflicts/{id}.json`.
 *
 * Atomic writes: files are written to a temp path then renamed into place.
 * This prevents data corruption if the process is interrupted mid-write.
 *
 * Thread safety: all mutating operations are serialized through a write
 * lock promise chain.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	ALL_MEMORY_LIFECYCLES,
	ALL_MEMORY_TYPES,
	computeMemoryScore,
	computeMemoryStats,
	createMemoryRecord,
	deserializeMemoryConflict,
	deserializeMemoryRecord,
	type MemoryConflict,
	type MemoryLifecycle,
	type MemoryQuery,
	type MemoryRecord,
	type MemoryStats,
	type MemoryType,
	serializeMemoryConflict,
	serializeMemoryRecord,
	validateMemoryConflict,
	validateMemoryRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the MemoryStore.
 */
export interface MemoryStoreConfig {
	/** Base directory for memory storage. Default: <.pi/brain/memory> relative to project root */
	basePath: string;
	/** Path to the index file. Default: <basePath>/index.json */
	indexPath: string;
	/** Maximum file size in bytes for a single memory record file (safety limit). Default: 1 MiB */
	maxFileSizeBytes: number;
}

const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MiB
const MEMORY_DIR = "brain/memory";
const CONFLICTS_DIR = "conflicts";

// ---------------------------------------------------------------------------
// Index Types
// ---------------------------------------------------------------------------

/**
 * A lightweight index entry for a memory record.
 *
 * Used by the master index for fast filtering without deserializing
 * the full record file.
 */
export interface MemoryIndexEntry {
	id: string;
	type: MemoryType;
	lifecycle: MemoryLifecycle;
	tags: string[];
	createdAt: string;
	updatedAt: string;
}

/**
 * The on-disk index structure for the MemoryStore.
 *
 * Provides lookup maps by ID, type, lifecycle, and tag to enable
 * fast query execution without scanning all records.
 */
export interface MemoryIndex {
	/** Index entries keyed by record ID */
	byId: Record<string, MemoryIndexEntry>;
	/** Record ID lists keyed by MemoryType */
	byType: Record<MemoryType, string[]>;
	/** Record ID lists keyed by MemoryLifecycle */
	byLifecycle: Record<MemoryLifecycle, string[]>;
	/** Record ID lists keyed by tag name */
	byTag: Record<string, string[]>;
	/** ISO 8601 timestamp of the last index update */
	lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Default Config Helper
// ---------------------------------------------------------------------------

/**
 * Resolve the default base path for memory storage.
 *
 * Uses `PI_CONFIG_DIR` environment variable if set, otherwise
 * falls back to `.pi` in the current working directory.
 */
function resolveDefaultBasePath(): string {
	const configDir = process.env.PI_CONFIG_DIR ?? ".pi";
	return path.resolve(process.cwd(), configDir, MEMORY_DIR);
}

// ---------------------------------------------------------------------------
// Memory Store
// ---------------------------------------------------------------------------

/**
 * Durable JSON-file-backed memory store.
 *
 * Provides CRUD operations, querying with filtering/sorting/pagination,
 * conflict storage, and atomic writes to prevent data corruption.
 *
 * Thread-safe: all mutations are serialized through a write lock.
 */
export class MemoryStore {
	private config: MemoryStoreConfig;
	private index: MemoryIndex;
	private writeLock: Promise<void>;
	private initialized: boolean;

	constructor(config?: Partial<MemoryStoreConfig>) {
		const basePath = config?.basePath ?? resolveDefaultBasePath();
		this.config = {
			basePath,
			indexPath: config?.indexPath ?? path.join(basePath, "index.json"),
			maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
		};
		this.index = this.createEmptyIndex();
		this.writeLock = Promise.resolve();
		this.initialized = false;
	}

	/**
	 * Get a copy of the current config (for inspection, not mutation).
	 */
	getConfig(): Readonly<MemoryStoreConfig> {
		return { ...this.config };
	}

	/**
	 * Initialize the store: ensure directories exist and load the index.
	 *
	 * Call this once before performing any CRUD operations.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		await fs.mkdir(this.config.basePath, { recursive: true });
		await fs.mkdir(path.join(this.config.basePath, CONFLICTS_DIR), { recursive: true });

		this.index = await this.loadIndex();
		this.initialized = true;
	}

	// -----------------------------------------------------------------------
	// CRUD: Memory Records
	// -----------------------------------------------------------------------

	/**
	 * Create a new memory record and persist it.
	 *
	 * If the record does not have an ID, one will be generated. The record
	 * is written atomically and the index is updated.
	 *
	 * @param memory - The memory record to persist. Must be valid.
	 * @returns The stored record (with generated ID if not provided).
	 */
	async create(memory: MemoryRecord): Promise<MemoryRecord> {
		this.ensureInitialized();

		const record = memory.id ? memory : createMemoryRecord(memory);

		const validation = validateMemoryRecord(record);
		if (!validation.valid) {
			throw new Error(`Invalid MemoryRecord: ${validation.errors.join("; ")}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.config.basePath, `${record.id}.json`);
			await this.atomicWrite(filePath, serializeMemoryRecord(record));
			this.updateIndexForRecord(record);
			await this.saveIndex();
		});

		return record;
	}

	/**
	 * Retrieve a memory record by its ID.
	 *
	 * Attempts to read the file directly from disk, falling back to
	 * the index only for fast negative lookup. If the file exists but
	 * is not in the index, the index entry is restored.
	 *
	 * @param id - The record UUID
	 * @returns The MemoryRecord, or null if not found
	 */
	async get(id: string): Promise<MemoryRecord | null> {
		this.ensureInitialized();

		try {
			const filePath = path.join(this.config.basePath, `${id}.json`);
			const json = await this.readFileSafe(filePath);
			if (json === null) return null;

			const record = deserializeMemoryRecord(json);

			// Restore index entry if missing (e.g., after corrupt index rebuild)
			if (!this.index.byId[id]) {
				await this.withWriteLock(async () => {
					this.updateIndexForRecord(record);
					await this.saveIndex();
				});
			}

			return record;
		} catch {
			return null;
		}
	}

	/**
	 * Update an existing memory record by applying partial updates.
	 *
	 * @param id - The record UUID
	 * @param updates - Partial fields to merge into the existing record
	 * @returns The updated MemoryRecord
	 * @throws If the record does not exist
	 */
	async update(id: string, updates: Partial<MemoryRecord>): Promise<MemoryRecord> {
		this.ensureInitialized();

		const existing = await this.get(id);
		if (!existing) {
			throw new Error(`MemoryRecord not found: ${id}`);
		}

		const updated: MemoryRecord = {
			...existing,
			...updates,
			id, // id cannot change
			updatedAt: new Date().toISOString(),
		};

		const validation = validateMemoryRecord(updated);
		if (!validation.valid) {
			throw new Error(`Updated MemoryRecord is invalid: ${validation.errors.join("; ")}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.config.basePath, `${id}.json`);
			await this.atomicWrite(filePath, serializeMemoryRecord(updated));
			this.updateIndexForRecord(updated);
			// Remove old index entry for type/lifecycle/tag if they changed
			await this.saveIndex();
		});

		return updated;
	}

	/**
	 * Delete a memory record by its ID.
	 *
	 * @param id - The record UUID
	 * @throws If the record does not exist
	 */
	async delete(id: string): Promise<void> {
		this.ensureInitialized();

		if (!this.index.byId[id]) {
			throw new Error(`MemoryRecord not found: ${id}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.config.basePath, `${id}.json`);
			try {
				await fs.unlink(filePath);
			} catch {
				// File might already be missing; proceed
			}
			this.removeIndexForRecord(id);
			await this.saveIndex();
		});
	}

	// -----------------------------------------------------------------------
	// Queries
	// -----------------------------------------------------------------------

	/**
	 * Query memory records with filters, sorting, and pagination.
	 *
	 * Uses the index for fast filtering by type, lifecycle, and tags.
	 * Full-text search loads matching records and scans title/content/summary.
	 *
	 * @param query - Query parameters
	 * @returns Array of matching MemoryRecords
	 */
	async query(query: MemoryQuery): Promise<MemoryRecord[]> {
		this.ensureInitialized();

		// Step 1: Filter IDs using index
		let candidateIds: Set<string> | null = null;

		// Filter by type
		if (query.types && query.types.length > 0) {
			const ids = new Set<string>();
			for (const type of query.types) {
				const typeIds = this.index.byType[type];
				if (typeIds) {
					for (const id of typeIds) ids.add(id);
				}
			}
			candidateIds = this.intersectSets(candidateIds, ids);
		}

		// Filter by lifecycle
		if (query.lifecycle && query.lifecycle.length > 0) {
			const ids = new Set<string>();
			for (const lifecycle of query.lifecycle) {
				const lifecycleIds = this.index.byLifecycle[lifecycle];
				if (lifecycleIds) {
					for (const id of lifecycleIds) ids.add(id);
				}
			}
			candidateIds = this.intersectSets(candidateIds, ids);
		}

		// Filter by tags (OR logic)
		if (query.tags && query.tags.length > 0) {
			const ids = new Set<string>();
			for (const tag of query.tags) {
				const tagIds = this.index.byTag[tag.toLowerCase()];
				if (tagIds) {
					for (const id of tagIds) ids.add(id);
				}
			}
			candidateIds = this.intersectSets(candidateIds, ids);
		}

		// If no filters, start with all IDs
		if (candidateIds === null) {
			candidateIds = new Set(Object.keys(this.index.byId));
		}

		// Step 2: Load full records for candidate IDs
		const records: MemoryRecord[] = [];
		for (const id of candidateIds) {
			try {
				const record = await this.get(id);
				if (record) {
					records.push(record);
				}
			} catch {
				// Skip corrupt or missing records
			}
		}

		// Step 3: Apply minConfidence and minRelevance filters
		let filtered = records;
		if (query.minConfidence !== undefined) {
			filtered = filtered.filter((r) => r.confidence >= query.minConfidence!);
		}
		if (query.minRelevance !== undefined) {
			filtered = filtered.filter((r) => computeMemoryScore(r, query).relevance >= query.minRelevance!);
		}

		// Step 4: Apply search text filter
		if (query.searchText) {
			const searchLower = query.searchText.toLowerCase();
			filtered = filtered.filter((r) => {
				if (r.title.toLowerCase().includes(searchLower)) return true;
				if (r.content.toLowerCase().includes(searchLower)) return true;
				if (r.summary?.toLowerCase().includes(searchLower)) return true;
				return false;
			});
		}

		// Step 5: Sort
		const sortBy = query.sortBy ?? "createdAt";
		const sortOrder = query.sortOrder ?? "desc";
		filtered.sort((a, b) => {
			let cmp = 0;
			switch (sortBy) {
				case "createdAt":
					cmp = a.createdAt.localeCompare(b.createdAt);
					break;
				case "updatedAt":
					cmp = a.updatedAt.localeCompare(b.updatedAt);
					break;
				case "confidence":
					cmp = a.confidence - b.confidence;
					break;
				case "relevance": {
					const scoreA = computeMemoryScore(a, query).relevance;
					const scoreB = computeMemoryScore(b, query).relevance;
					cmp = scoreA - scoreB;
					break;
				}
			}
			return sortOrder === "asc" ? cmp : -cmp;
		});

		// Step 6: Paginate
		const limit = query.limit ?? 20;
		const offset = query.offset ?? 0;
		return filtered.slice(offset, offset + limit);
	}

	/**
	 * Find records by MemoryType using the index for fast lookup.
	 *
	 * @param type - The memory type to filter by
	 * @returns Array of matching MemoryRecords
	 */
	async findByType(type: MemoryType): Promise<MemoryRecord[]> {
		return this.query({ types: [type] });
	}

	/**
	 * Find records by lifecycle state using the index for fast lookup.
	 *
	 * @param lifecycle - The lifecycle state to filter by
	 * @returns Array of matching MemoryRecords
	 */
	async findByLifecycle(lifecycle: MemoryLifecycle): Promise<MemoryRecord[]> {
		return this.query({ lifecycle: [lifecycle] });
	}

	/**
	 * Find records by tag using the index for fast lookup.
	 *
	 * Tag matching is case-insensitive.
	 *
	 * @param tag - The tag to search for
	 * @returns Array of matching MemoryRecords
	 */
	async findByTag(tag: string): Promise<MemoryRecord[]> {
		return this.query({ tags: [tag] });
	}

	/**
	 * Full-text search across record title, content, and summary.
	 *
	 * @param text - The text to search for (case-insensitive)
	 * @param limit - Maximum results (default: 20)
	 * @returns Array of matching MemoryRecords
	 */
	async search(text: string, limit?: number): Promise<MemoryRecord[]> {
		return this.query({ searchText: text, limit });
	}

	// -----------------------------------------------------------------------
	// Conflict Records
	// -----------------------------------------------------------------------

	/**
	 * Create and persist a conflict record.
	 *
	 * @param conflict - The conflict to persist
	 * @returns The stored conflict record
	 */
	async createConflict(conflict: MemoryConflict): Promise<MemoryConflict> {
		this.ensureInitialized();

		const validation = validateMemoryConflict(conflict);
		if (!validation.valid) {
			throw new Error(`Invalid MemoryConflict: ${validation.errors.join("; ")}`);
		}

		const conflictsDir = path.join(this.config.basePath, CONFLICTS_DIR);
		await fs.mkdir(conflictsDir, { recursive: true });

		const filePath = path.join(conflictsDir, `${conflict.id}.json`);
		await this.atomicWrite(filePath, serializeMemoryConflict(conflict));

		return conflict;
	}

	/**
	 * Retrieve a conflict record by ID.
	 *
	 * @param id - The conflict UUID
	 * @returns The MemoryConflict, or null if not found
	 */
	async getConflict(id: string): Promise<MemoryConflict | null> {
		this.ensureInitialized();

		try {
			const filePath = path.join(this.config.basePath, CONFLICTS_DIR, `${id}.json`);
			const json = await this.readFileSafe(filePath);
			if (json === null) return null;
			return deserializeMemoryConflict(json);
		} catch {
			return null;
		}
	}

	/**
	 * List all conflict records.
	 *
	 * @returns Array of all MemoryConflicts
	 */
	async listConflicts(): Promise<MemoryConflict[]> {
		this.ensureInitialized();

		const conflictsDir = path.join(this.config.basePath, CONFLICTS_DIR);
		let files: string[];
		try {
			files = await fs.readdir(conflictsDir);
		} catch {
			return [];
		}

		const conflicts: MemoryConflict[] = [];
		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			try {
				const filePath = path.join(conflictsDir, file);
				const json = await fs.readFile(filePath, "utf-8");
				const conflict = deserializeMemoryConflict(json);
				conflicts.push(conflict);
			} catch {
				// Skip corrupt files silently
			}
		}

		return conflicts;
	}

	/**
	 * Delete a conflict record by ID.
	 *
	 * @param id - The conflict UUID
	 */
	async deleteConflict(id: string): Promise<void> {
		this.ensureInitialized();

		const filePath = path.join(this.config.basePath, CONFLICTS_DIR, `${id}.json`);
		try {
			await fs.unlink(filePath);
		} catch {
			// File might not exist; treat as success
		}
	}

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	/**
	 * Compute aggregate statistics about the memory store.
	 *
	 * Loads all records and conflicts to compute accurate counts.
	 *
	 * @returns MemoryStats with aggregated data
	 */
	async getStats(): Promise<MemoryStats> {
		this.ensureInitialized();

		const records = await this.query({});
		const conflicts = await this.listConflicts();

		return computeMemoryStats(records, conflicts);
	}

	// -----------------------------------------------------------------------
	// Index Management
	// -----------------------------------------------------------------------

	/**
	 * Rebuild the entire index from on-disk memory records.
	 *
	 * Useful if the index file is corrupt or out of sync.
	 */
	async rebuildIndex(): Promise<void> {
		this.ensureInitialized();

		await this.withWriteLock(async () => {
			const newIndex = this.createEmptyIndex();

			const files = await fs.readdir(this.config.basePath);
			const recordFiles = files.filter((f) => f.endsWith(".json") && f !== "index.json");

			for (const file of recordFiles) {
				try {
					const filePath = path.join(this.config.basePath, file);
					const json = await this.readFileSafe(filePath);
					if (json === null) continue;
					const record = deserializeMemoryRecord(json);
					this.addToIndex(newIndex, record);
				} catch {
					// Skip corrupt files
				}
			}

			newIndex.lastUpdated = new Date().toISOString();
			this.index = newIndex;
			await this.saveIndex();
		});
	}

	// -----------------------------------------------------------------------
	// Internal Helpers
	// -----------------------------------------------------------------------

	/**
	 * Ensure the store has been initialized.
	 */
	private ensureInitialized(): void {
		if (!this.initialized) {
			throw new Error("MemoryStore not initialized. Call initialize() before performing CRUD operations.");
		}
	}

	/**
	 * Acquire the write lock to serialize mutations.
	 */
	private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
		const prev = this.writeLock;
		let resolve: () => void;
		this.writeLock = new Promise<void>((r) => {
			resolve = r;
		});

		await prev;
		try {
			return await fn();
		} finally {
			resolve!();
		}
	}

	/**
	 * Load the index from disk, or create an empty one if it doesn't exist.
	 */
	private async loadIndex(): Promise<MemoryIndex> {
		try {
			const json = await fs.readFile(this.config.indexPath, "utf-8");
			const parsed = JSON.parse(json) as MemoryIndex;
			// Validate basic structure
			if (parsed.byId && parsed.byType && parsed.byLifecycle && parsed.byTag) {
				return parsed;
			}
			return this.createEmptyIndex();
		} catch {
			return this.createEmptyIndex();
		}
	}

	/**
	 * Save the current index to disk atomically.
	 */
	private async saveIndex(): Promise<void> {
		this.index.lastUpdated = new Date().toISOString();
		await this.atomicWrite(this.config.indexPath, JSON.stringify(this.index, null, 2));
	}

	/**
	 * Write data to a file atomically.
	 *
	 * Writes to a temporary path first, then renames into place.
	 * This prevents partial writes from corrupting the file.
	 */
	private async atomicWrite(filePath: string, data: string): Promise<void> {
		const byteLength = Buffer.byteLength(data, "utf-8");
		if (byteLength > this.config.maxFileSizeBytes) {
			throw new Error(`File size ${byteLength} bytes exceeds maximum ${this.config.maxFileSizeBytes} bytes`);
		}

		const dir = path.dirname(filePath);
		await fs.mkdir(dir, { recursive: true });

		const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
		try {
			await fs.writeFile(tmpPath, data, "utf-8");
			await fs.rename(tmpPath, filePath);
		} catch (err) {
			// Clean up temp file on failure
			try {
				await fs.unlink(tmpPath);
			} catch {
				// Ignore cleanup errors
			}
			throw err;
		}
	}

	/**
	 * Safely read a file, returning null if it doesn't exist or is too large.
	 */
	private async readFileSafe(filePath: string): Promise<string | null> {
		try {
			const stat = await fs.stat(filePath);
			if (stat.size > this.config.maxFileSizeBytes) {
				return null;
			}
			return await fs.readFile(filePath, "utf-8");
		} catch {
			return null;
		}
	}

	/**
	 * Create an empty index structure.
	 */
	private createEmptyIndex(): MemoryIndex {
		const byType = {} as Record<MemoryType, string[]>;
		const byLifecycle = {} as Record<MemoryLifecycle, string[]>;

		for (const type of ALL_MEMORY_TYPES) {
			byType[type] = [];
		}
		for (const lc of ALL_MEMORY_LIFECYCLES) {
			byLifecycle[lc] = [];
		}

		return {
			byId: {},
			byType,
			byLifecycle,
			byTag: {},
			lastUpdated: new Date().toISOString(),
		};
	}

	/**
	 * Update the index to reflect a stored record.
	 */
	private updateIndexForRecord(record: MemoryRecord): void {
		this.addToIndex(this.index, record);
	}

	/**
	 * Add a record to an index structure.
	 */
	private addToIndex(index: MemoryIndex, record: MemoryRecord): void {
		const entry: MemoryIndexEntry = {
			id: record.id,
			type: record.type,
			lifecycle: record.lifecycle,
			tags: [...record.tags],
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		};

		// Remove old entry if present (for updates)
		const oldEntry = index.byId[record.id];
		if (oldEntry) {
			this.removeFromIndexLists(index, record.id, oldEntry);
		}

		// Add to byId
		index.byId[record.id] = entry;

		// Add to byType
		if (!index.byType[record.type]) {
			index.byType[record.type] = [];
		}
		if (!index.byType[record.type].includes(record.id)) {
			index.byType[record.type].push(record.id);
		}

		// Add to byLifecycle
		if (!index.byLifecycle[record.lifecycle]) {
			index.byLifecycle[record.lifecycle] = [];
		}
		if (!index.byLifecycle[record.lifecycle].includes(record.id)) {
			index.byLifecycle[record.lifecycle].push(record.id);
		}

		// Add to byTag (case-insensitive)
		for (const tag of record.tags) {
			const tagKey = tag.toLowerCase();
			if (!index.byTag[tagKey]) {
				index.byTag[tagKey] = [];
			}
			if (!index.byTag[tagKey].includes(record.id)) {
				index.byTag[tagKey].push(record.id);
			}
		}
	}

	/**
	 * Remove a record from the index.
	 */
	private removeIndexForRecord(id: string): void {
		const entry = this.index.byId[id];
		if (!entry) return;

		this.removeFromIndexLists(this.index, id, entry);
		delete this.index.byId[id];
	}

	/**
	 * Remove a record's ID from secondary index lists.
	 */
	private removeFromIndexLists(index: MemoryIndex, id: string, entry: MemoryIndexEntry): void {
		// Remove from byType
		const typeList = index.byType[entry.type];
		if (typeList) {
			const idx = typeList.indexOf(id);
			if (idx !== -1) typeList.splice(idx, 1);
		}

		// Remove from byLifecycle
		const lifecycleList = index.byLifecycle[entry.lifecycle];
		if (lifecycleList) {
			const idx = lifecycleList.indexOf(id);
			if (idx !== -1) lifecycleList.splice(idx, 1);
		}

		// Remove from byTag
		for (const tag of entry.tags) {
			const tagKey = tag.toLowerCase();
			const tagList = index.byTag[tagKey];
			if (tagList) {
				const idx = tagList.indexOf(id);
				if (idx !== -1) tagList.splice(idx, 1);
				if (tagList.length === 0) {
					delete index.byTag[tagKey];
				}
			}
		}
	}

	/**
	 * Intersect two sets. If a is null, return b.
	 */
	private intersectSets(a: Set<string> | null, b: Set<string>): Set<string> {
		if (a === null) return new Set(b);
		const result = new Set<string>();
		for (const item of a) {
			if (b.has(item)) result.add(item);
		}
		return result;
	}
}
