/**
 * Goal Store — P15.B
 *
 * Durable JSON-file-backed persistence for goals, preferences, autonomy
 * profiles, and drift reports with index-based fast lookup, atomic writes,
 * and thread-safe operations.
 *
 * Directory structure under basePath:
 * ```
 * brain/
 *   goals/
 *     index.json              # Master index for fast lookups
 *     goal_{id}.json           # Individual goal records
 *     pref_{id}.json           # Preference records
 *     profile_{userId}.json    # Autonomy profiles
 *     drift/
 *       {id}.json             # Drift reports
 * ```
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
	ALL_GOAL_PRIORITIES,
	ALL_GOAL_STATUSES,
	ALL_PREFERENCE_CATEGORIES,
	type AutonomyProfile,
	computeGoalsStats,
	deserializeAutonomyProfile,
	deserializeGoalDriftReport,
	deserializeGoalRecord,
	deserializePreferenceRecord,
	type GoalDriftReport,
	type GoalPriority,
	type GoalRecord,
	type GoalStatus,
	type GoalsStats,
	type PreferenceCategory,
	type PreferenceRecord,
	serializeAutonomyProfile,
	serializeGoalDriftReport,
	serializeGoalRecord,
	serializePreferenceRecord,
	validateAutonomyProfile,
	validateGoalDriftReport,
	validateGoalRecord,
	validatePreferenceRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the GoalStore.
 */
export interface GoalStoreConfig {
	/** Base directory for goal storage. Default: <.pi/brain/goals> relative to project root */
	basePath: string;
	/** Path to the index file. Default: <basePath>/index.json */
	indexPath: string;
	/** Maximum file size in bytes for a single record file (safety limit). Default: 1 MiB */
	maxFileSizeBytes: number;
}

const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MiB
const GOALS_DIR = "brain/goals";
const DRIFT_DIR = "drift";

// ---------------------------------------------------------------------------
// Index Types
// ---------------------------------------------------------------------------

/**
 * A lightweight index entry for a goal record.
 *
 * Used by the master index for fast filtering without deserializing
 * the full record file.
 */
export interface GoalIndexEntry {
	id: string;
	status: GoalStatus;
	priority: GoalPriority;
	category: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * The on-disk index structure for the GoalStore.
 */
export interface GoalIndex {
	/** Index entries keyed by record ID */
	byId: Record<string, GoalIndexEntry>;
	/** Goal ID lists keyed by GoalStatus */
	byStatus: Record<GoalStatus, string[]>;
	/** Goal ID lists keyed by GoalPriority */
	byPriority: Record<GoalPriority, string[]>;
	/** Goal ID lists keyed by category string */
	byCategory: Record<string, string[]>;
	/** Preference ID lists keyed by PreferenceCategory */
	preferencesByCategory: Record<PreferenceCategory, string[]>;
	/** Drift report ID lists keyed by goalId */
	driftByGoalId: Record<string, string[]>;
	/** ISO 8601 timestamp of the last index update */
	lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Default Config Helper
// ---------------------------------------------------------------------------

function resolveDefaultBasePath(): string {
	const configDir = process.env.PI_CONFIG_DIR ?? ".pi";
	return path.resolve(process.cwd(), configDir, GOALS_DIR);
}

// ---------------------------------------------------------------------------
// Goal Store
// ---------------------------------------------------------------------------

/**
 * Durable JSON-file-backed goal store.
 *
 * Provides CRUD operations for goals, preferences, autonomy profiles,
 * and drift reports with index-based fast lookup and atomic writes.
 *
 * Thread-safe: all mutations are serialized through a write lock.
 */
export class GoalStore {
	private config: GoalStoreConfig;
	private index: GoalIndex;
	private writeLock: Promise<void>;
	private initialized: boolean;

	constructor(config?: Partial<GoalStoreConfig>) {
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
	getConfig(): Readonly<GoalStoreConfig> {
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
		await fs.mkdir(path.join(this.config.basePath, DRIFT_DIR), { recursive: true });

		this.index = await this.loadIndex();
		this.initialized = true;
	}

	// -----------------------------------------------------------------------
	// CRUD: Goals
	// -----------------------------------------------------------------------

	/**
	 * Create a new goal record and persist it.
	 *
	 * @param goal - The goal record to persist. Must be valid.
	 * @returns The stored goal record.
	 */
	async createGoal(goal: GoalRecord): Promise<GoalRecord> {
		this.ensureInitialized();

		const validation = validateGoalRecord(goal);
		if (!validation.valid) {
			throw new Error(`Invalid GoalRecord: ${validation.errors.join("; ")}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.config.basePath, `goal_${goal.id}.json`);
			await this.atomicWrite(filePath, serializeGoalRecord(goal));
			this.updateGoalIndexEntry(goal);
			await this.saveIndex();
		});

		return goal;
	}

	/**
	 * Retrieve a goal record by its ID.
	 *
	 * @param id - The goal record ID
	 * @returns The GoalRecord, or null if not found
	 */
	async getGoal(id: string): Promise<GoalRecord | null> {
		this.ensureInitialized();

		try {
			const filePath = path.join(this.config.basePath, `goal_${id}.json`);
			const json = await this.readFileSafe(filePath);
			if (json === null) return null;

			const record = deserializeGoalRecord(json);

			// Restore index entry if missing
			if (!this.index.byId[id]) {
				await this.withWriteLock(async () => {
					this.updateGoalIndexEntry(record);
					await this.saveIndex();
				});
			}

			return record;
		} catch {
			return null;
		}
	}

	/**
	 * Update an existing goal record by applying partial updates.
	 *
	 * @param id - The goal record ID
	 * @param updates - Partial fields to merge into the existing record
	 * @returns The updated GoalRecord
	 * @throws If the record does not exist
	 */
	async updateGoal(id: string, updates: Partial<GoalRecord>): Promise<GoalRecord> {
		this.ensureInitialized();

		const existing = await this.getGoal(id);
		if (!existing) {
			throw new Error(`GoalRecord not found: ${id}`);
		}

		const updated: GoalRecord = {
			...existing,
			...updates,
			id, // id cannot change
			updatedAt: new Date().toISOString(),
		};

		const validation = validateGoalRecord(updated);
		if (!validation.valid) {
			throw new Error(`Updated GoalRecord is invalid: ${validation.errors.join("; ")}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.config.basePath, `goal_${id}.json`);
			await this.atomicWrite(filePath, serializeGoalRecord(updated));
			this.updateGoalIndexEntry(updated);
			await this.saveIndex();
		});

		return updated;
	}

	/**
	 * Delete a goal record by its ID.
	 *
	 * @param id - The goal record ID
	 * @throws If the record does not exist
	 */
	async deleteGoal(id: string): Promise<void> {
		this.ensureInitialized();

		if (!this.index.byId[id]) {
			throw new Error(`GoalRecord not found: ${id}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.config.basePath, `goal_${id}.json`);
			try {
				await fs.unlink(filePath);
			} catch {
				// File might already be missing; proceed
			}
			this.removeGoalIndexEntry(id);
			await this.saveIndex();
		});
	}

	/**
	 * List goal records with optional filters.
	 *
	 * Uses the index for fast filtering by status, priority, and category.
	 *
	 * @param filters - Optional filters (status, priority, category)
	 * @returns Array of matching GoalRecords
	 */
	async listGoals(filters?: {
		status?: GoalStatus;
		priority?: GoalPriority;
		category?: string;
	}): Promise<GoalRecord[]> {
		this.ensureInitialized();

		let candidateIds: Set<string> | null = null;

		if (filters?.status) {
			const ids = new Set(this.index.byStatus[filters.status] ?? []);
			candidateIds = this.intersectSets(candidateIds, ids);
		}

		if (filters?.priority) {
			const ids = new Set(this.index.byPriority[filters.priority] ?? []);
			candidateIds = this.intersectSets(candidateIds, ids);
		}

		if (filters?.category) {
			const ids = new Set(this.index.byCategory[filters.category] ?? []);
			candidateIds = this.intersectSets(candidateIds, ids);
		}

		if (candidateIds === null) {
			candidateIds = new Set(Object.keys(this.index.byId));
		}

		const records: GoalRecord[] = [];
		for (const id of candidateIds) {
			try {
				const record = await this.getGoal(id);
				if (record) {
					records.push(record);
				}
			} catch {
				// Skip corrupt or missing records
			}
		}

		// Sort by createdAt descending (most recent first)
		records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

		return records;
	}

	// -----------------------------------------------------------------------
	// CRUD: Preferences
	// -----------------------------------------------------------------------

	/**
	 * Create a new preference record and persist it.
	 *
	 * @param preference - The preference record to persist
	 * @returns The stored preference record
	 */
	async createPreference(preference: PreferenceRecord): Promise<PreferenceRecord> {
		this.ensureInitialized();

		const validation = validatePreferenceRecord(preference);
		if (!validation.valid) {
			throw new Error(`Invalid PreferenceRecord: ${validation.errors.join("; ")}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.config.basePath, `pref_${preference.id}.json`);
			await this.atomicWrite(filePath, serializePreferenceRecord(preference));
			this.updatePreferenceIndexEntry(preference);
			await this.saveIndex();
		});

		return preference;
	}

	/**
	 * Retrieve a preference record by its ID.
	 *
	 * @param id - The preference record ID
	 * @returns The PreferenceRecord, or null if not found
	 */
	async getPreference(id: string): Promise<PreferenceRecord | null> {
		this.ensureInitialized();

		try {
			const filePath = path.join(this.config.basePath, `pref_${id}.json`);
			const json = await this.readFileSafe(filePath);
			if (json === null) return null;
			return deserializePreferenceRecord(json);
		} catch {
			return null;
		}
	}

	/**
	 * Update an existing preference record.
	 *
	 * @param id - The preference record ID
	 * @param updates - Partial fields to merge
	 * @returns The updated PreferenceRecord
	 * @throws If the record does not exist
	 */
	async updatePreference(id: string, updates: Partial<PreferenceRecord>): Promise<PreferenceRecord> {
		this.ensureInitialized();

		const existing = await this.getPreference(id);
		if (!existing) {
			throw new Error(`PreferenceRecord not found: ${id}`);
		}

		const updated: PreferenceRecord = {
			...existing,
			...updates,
			id, // id cannot change
			updatedAt: new Date().toISOString(),
		};

		const validation = validatePreferenceRecord(updated);
		if (!validation.valid) {
			throw new Error(`Updated PreferenceRecord is invalid: ${validation.errors.join("; ")}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.config.basePath, `pref_${id}.json`);
			await this.atomicWrite(filePath, serializePreferenceRecord(updated));
			this.updatePreferenceIndexEntry(updated);
			await this.saveIndex();
		});

		return updated;
	}

	/**
	 * Delete a preference record by its ID.
	 *
	 * @param id - The preference record ID
	 * @throws If the record does not exist
	 */
	async deletePreference(id: string): Promise<void> {
		this.ensureInitialized();

		// We need the entry to remove from category index, so load it first
		const existing = await this.getPreference(id);
		if (!existing) {
			throw new Error(`PreferenceRecord not found: ${id}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.config.basePath, `pref_${id}.json`);
			try {
				await fs.unlink(filePath);
			} catch {
				// File might already be missing; proceed
			}
			this.removePreferenceIndexEntry(id, existing.category);
			await this.saveIndex();
		});
	}

	/**
	 * List preference records with optional category filter.
	 *
	 * @param category - Optional category filter
	 * @returns Array of matching PreferenceRecords
	 */
	async listPreferences(category?: PreferenceCategory): Promise<PreferenceRecord[]> {
		this.ensureInitialized();

		let ids: string[];
		if (category) {
			ids = this.index.preferencesByCategory[category] ?? [];
		} else {
			ids = [];
			for (const cat of ALL_PREFERENCE_CATEGORIES) {
				const catIds = this.index.preferencesByCategory[cat] ?? [];
				ids.push(...catIds);
			}
		}

		const records: PreferenceRecord[] = [];
		for (const id of ids) {
			try {
				const record = await this.getPreference(id);
				if (record) {
					records.push(record);
				}
			} catch {
				// Skip corrupt or missing records
			}
		}

		return records;
	}

	// -----------------------------------------------------------------------
	// CRUD: Autonomy Profiles
	// -----------------------------------------------------------------------

	/**
	 * Save (create or overwrite) an autonomy profile.
	 *
	 * @param profile - The autonomy profile to persist
	 * @returns The stored profile
	 */
	async saveProfile(profile: AutonomyProfile): Promise<AutonomyProfile> {
		this.ensureInitialized();

		const validation = validateAutonomyProfile(profile);
		if (!validation.valid) {
			throw new Error(`Invalid AutonomyProfile: ${validation.errors.join("; ")}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.config.basePath, `profile_${profile.userId}.json`);
			await this.atomicWrite(filePath, JSON.stringify(serializeAutonomyProfile(profile), null, 2));
		});

		return profile;
	}

	/**
	 * Retrieve an autonomy profile by user ID.
	 *
	 * @param userId - The user identifier
	 * @returns The AutonomyProfile, or null if not found
	 */
	async getProfile(userId: string): Promise<AutonomyProfile | null> {
		this.ensureInitialized();

		try {
			const filePath = path.join(this.config.basePath, `profile_${userId}.json`);
			const json = await this.readFileSafe(filePath);
			if (json === null) return null;
			return deserializeAutonomyProfile(JSON.parse(json));
		} catch {
			return null;
		}
	}

	/**
	 * Delete an autonomy profile by user ID.
	 *
	 * @param userId - The user identifier
	 */
	async deleteProfile(userId: string): Promise<void> {
		this.ensureInitialized();

		const filePath = path.join(this.config.basePath, `profile_${userId}.json`);
		try {
			await fs.unlink(filePath);
		} catch {
			// File might not exist; treat as success
		}
	}

	// -----------------------------------------------------------------------
	// CRUD: Drift Reports
	// -----------------------------------------------------------------------

	/**
	 * Create a new drift report and persist it.
	 *
	 * @param report - The drift report to persist
	 * @returns The stored drift report
	 */
	async createDriftReport(report: GoalDriftReport): Promise<GoalDriftReport> {
		this.ensureInitialized();

		const validation = validateGoalDriftReport(report);
		if (!validation.valid) {
			throw new Error(`Invalid GoalDriftReport: ${validation.errors.join("; ")}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.config.basePath, DRIFT_DIR, `${report.id}.json`);
			await this.atomicWrite(filePath, serializeGoalDriftReport(report));
			this.updateDriftIndexEntry(report);
			await this.saveIndex();
		});

		return report;
	}

	/**
	 * Retrieve a drift report by its ID.
	 *
	 * @param id - The drift report ID
	 * @returns The GoalDriftReport, or null if not found
	 */
	async getDriftReport(id: string): Promise<GoalDriftReport | null> {
		this.ensureInitialized();

		try {
			const filePath = path.join(this.config.basePath, DRIFT_DIR, `${id}.json`);
			const json = await this.readFileSafe(filePath);
			if (json === null) return null;
			return deserializeGoalDriftReport(json);
		} catch {
			return null;
		}
	}

	/**
	 * List drift reports, optionally filtered by goal ID.
	 *
	 * @param goalId - Optional goal ID filter
	 * @returns Array of matching GoalDriftReports
	 */
	async listDriftReports(goalId?: string): Promise<GoalDriftReport[]> {
		this.ensureInitialized();

		let ids: string[];
		if (goalId) {
			ids = this.index.driftByGoalId[goalId] ?? [];
		} else {
			const driftDir = path.join(this.config.basePath, DRIFT_DIR);
			let files: string[];
			try {
				files = await fs.readdir(driftDir);
			} catch {
				return [];
			}
			ids = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
		}

		const reports: GoalDriftReport[] = [];
		for (const id of ids) {
			try {
				const report = await this.getDriftReport(id);
				if (report) {
					reports.push(report);
				}
			} catch {
				// Skip corrupt or missing records
			}
		}

		// Sort by generatedAt descending (most recent first)
		reports.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

		return reports;
	}

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	/**
	 * Compute aggregate statistics about goals and drift reports.
	 *
	 * @returns GoalsStats with aggregated data
	 */
	async getStats(): Promise<GoalsStats> {
		this.ensureInitialized();

		const goals = await this.listGoals();
		const driftReports = await this.listDriftReports();

		return computeGoalsStats(goals, driftReports);
	}

	// -----------------------------------------------------------------------
	// Index Management
	// -----------------------------------------------------------------------

	/**
	 * Rebuild the entire index from on-disk goal and preference records.
	 *
	 * Useful if the index file is corrupt or out of sync.
	 */
	async rebuildIndex(): Promise<void> {
		this.ensureInitialized();

		await this.withWriteLock(async () => {
			const newIndex = this.createEmptyIndex();

			const files = await fs.readdir(this.config.basePath);
			const goalFiles = files.filter((f) => f.startsWith("goal_") && f.endsWith(".json"));
			const prefFiles = files.filter((f) => f.startsWith("pref_") && f.endsWith(".json"));

			// Rebuild goal index entries
			for (const file of goalFiles) {
				try {
					const filePath = path.join(this.config.basePath, file);
					const json = await this.readFileSafe(filePath);
					if (json === null) continue;
					const record = deserializeGoalRecord(json);
					this.addGoalToIndex(newIndex, record);
				} catch {
					// Skip corrupt files
				}
			}

			// Rebuild preference index entries
			for (const file of prefFiles) {
				try {
					const filePath = path.join(this.config.basePath, file);
					const json = await this.readFileSafe(filePath);
					if (json === null) continue;
					const record = deserializePreferenceRecord(json);
					this.addPreferenceToIndex(newIndex, record);
				} catch {
					// Skip corrupt files
				}
			}

			// Rebuild drift report index entries
			const driftDir = path.join(this.config.basePath, DRIFT_DIR);
			try {
				const driftFiles = await fs.readdir(driftDir);
				for (const file of driftFiles) {
					if (!file.endsWith(".json")) continue;
					try {
						const filePath = path.join(driftDir, file);
						const json = await this.readFileSafe(filePath);
						if (json === null) continue;
						const report = deserializeGoalDriftReport(json);
						this.addDriftToIndex(newIndex, report);
					} catch {
						// Skip corrupt files
					}
				}
			} catch {
				// Drift dir might not exist; that's fine
			}

			newIndex.lastUpdated = new Date().toISOString();
			this.index = newIndex;
			await this.saveIndex();
		});
	}

	// -----------------------------------------------------------------------
	// Internal Helpers
	// -----------------------------------------------------------------------

	private ensureInitialized(): void {
		if (!this.initialized) {
			throw new Error("GoalStore not initialized. Call initialize() before performing CRUD operations.");
		}
	}

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

	private async loadIndex(): Promise<GoalIndex> {
		try {
			const json = await fs.readFile(this.config.indexPath, "utf-8");
			const parsed = JSON.parse(json) as GoalIndex;
			if (parsed.byId && parsed.byStatus && parsed.byPriority && parsed.byCategory) {
				return parsed;
			}
			return this.createEmptyIndex();
		} catch {
			return this.createEmptyIndex();
		}
	}

	private async saveIndex(): Promise<void> {
		this.index.lastUpdated = new Date().toISOString();
		await this.atomicWrite(this.config.indexPath, JSON.stringify(this.index, null, 2));
	}

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
			try {
				await fs.unlink(tmpPath);
			} catch {
				// Ignore cleanup errors
			}
			throw err;
		}
	}

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

	private createEmptyIndex(): GoalIndex {
		const byStatus = {} as Record<GoalStatus, string[]>;
		const byPriority = {} as Record<GoalPriority, string[]>;
		const byCategory: Record<string, string[]> = {};
		const preferencesByCategory = {} as Record<PreferenceCategory, string[]>;
		const driftByGoalId: Record<string, string[]> = {};

		for (const s of ALL_GOAL_STATUSES) {
			byStatus[s] = [];
		}
		for (const p of ALL_GOAL_PRIORITIES) {
			byPriority[p] = [];
		}
		for (const c of ALL_PREFERENCE_CATEGORIES) {
			preferencesByCategory[c] = [];
		}

		return {
			byId: {},
			byStatus,
			byPriority,
			byCategory,
			preferencesByCategory,
			driftByGoalId,
			lastUpdated: new Date().toISOString(),
		};
	}

	private updateGoalIndexEntry(record: GoalRecord): void {
		this.addGoalToIndex(this.index, record);
	}

	private addGoalToIndex(index: GoalIndex, record: GoalRecord): void {
		const entry: GoalIndexEntry = {
			id: record.id,
			status: record.status,
			priority: record.priority,
			category: record.category,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		};

		// Remove old entry if present (for updates)
		const oldEntry = index.byId[record.id];
		if (oldEntry) {
			this.removeGoalFromIndexLists(index, record.id, oldEntry);
		}

		index.byId[record.id] = entry;

		// byStatus
		if (!index.byStatus[record.status]) {
			index.byStatus[record.status] = [];
		}
		if (!index.byStatus[record.status].includes(record.id)) {
			index.byStatus[record.status].push(record.id);
		}

		// byPriority
		if (!index.byPriority[record.priority]) {
			index.byPriority[record.priority] = [];
		}
		if (!index.byPriority[record.priority].includes(record.id)) {
			index.byPriority[record.priority].push(record.id);
		}

		// byCategory (case-insensitive key)
		const catKey = record.category.toLowerCase();
		if (!index.byCategory[catKey]) {
			index.byCategory[catKey] = [];
		}
		if (!index.byCategory[catKey].includes(record.id)) {
			index.byCategory[catKey].push(record.id);
		}
	}

	private removeGoalIndexEntry(id: string): void {
		const entry = this.index.byId[id];
		if (!entry) return;
		this.removeGoalFromIndexLists(this.index, id, entry);
		delete this.index.byId[id];
	}

	private removeGoalFromIndexLists(index: GoalIndex, id: string, entry: GoalIndexEntry): void {
		// byStatus
		const statusList = index.byStatus[entry.status];
		if (statusList) {
			const idx = statusList.indexOf(id);
			if (idx !== -1) statusList.splice(idx, 1);
		}

		// byPriority
		const priorityList = index.byPriority[entry.priority];
		if (priorityList) {
			const idx = priorityList.indexOf(id);
			if (idx !== -1) priorityList.splice(idx, 1);
		}

		// byCategory
		const catKey = entry.category.toLowerCase();
		const catList = index.byCategory[catKey];
		if (catList) {
			const idx = catList.indexOf(id);
			if (idx !== -1) catList.splice(idx, 1);
			if (catList.length === 0) {
				delete index.byCategory[catKey];
			}
		}
	}

	private updatePreferenceIndexEntry(record: PreferenceRecord): void {
		this.addPreferenceToIndex(this.index, record);
	}

	private addPreferenceToIndex(index: GoalIndex, record: PreferenceRecord): void {
		if (!index.preferencesByCategory[record.category]) {
			index.preferencesByCategory[record.category] = [];
		}
		if (!index.preferencesByCategory[record.category].includes(record.id)) {
			index.preferencesByCategory[record.category].push(record.id);
		}
	}

	private removePreferenceIndexEntry(id: string, category: PreferenceCategory): void {
		const catList = this.index.preferencesByCategory[category];
		if (catList) {
			const idx = catList.indexOf(id);
			if (idx !== -1) catList.splice(idx, 1);
		}
	}

	private updateDriftIndexEntry(report: GoalDriftReport): void {
		this.addDriftToIndex(this.index, report);
	}

	private addDriftToIndex(index: GoalIndex, report: GoalDriftReport): void {
		if (!index.driftByGoalId[report.goalId]) {
			index.driftByGoalId[report.goalId] = [];
		}
		if (!index.driftByGoalId[report.goalId].includes(report.id)) {
			index.driftByGoalId[report.goalId].push(report.id);
		}
	}

	private intersectSets(a: Set<string> | null, b: Set<string>): Set<string> {
		if (a === null) return new Set(b);
		const result = new Set<string>();
		for (const item of a) {
			if (b.has(item)) result.add(item);
		}
		return result;
	}
}
