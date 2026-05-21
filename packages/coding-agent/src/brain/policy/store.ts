/**
 * Rule Store — P18.B
 *
 * Durable JSON-file-backed persistence for policy rules with index-based
 * fast lookup, atomic writes, and thread-safe operations.
 *
 * Directory structure under basePath:
 * ```
 * brain/
 *   policy/
 *     index.json              # Master index for fast lookups
 *     rules/
 *       {id}.json             # Individual policy rules
 * ```
 *
 * File naming: each rule is stored as `{id}.json` under the rules/
 * subdirectory where `id` is a UUID v4 string.
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
	type PolicyDecision,
	type PolicyRule,
	type RuleConflict,
	type RuleStoreConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_POLICY_DECISIONS: PolicyDecision[] = ["allow", "deny", "approval_required", "forbidden"];
const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MiB
const POLICY_DIR = "brain/policy";
const RULES_DIR = "rules";

// ---------------------------------------------------------------------------
// Index Types
// ---------------------------------------------------------------------------

/**
 * A lightweight index entry for a policy rule.
 *
 * Used by the master index for fast filtering without deserializing
 * the full rule file.
 */
export interface RuleIndexEntry {
	id: string;
	action: string;
	decision: PolicyDecision;
	priority: number;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

/**
 * The on-disk index structure for the RuleStore.
 *
 * Provides lookup maps by ID, action, decision, and enabled state to
 * enable fast query execution without scanning all rules.
 */
export interface RuleIndex {
	/** Index entries keyed by rule ID */
	byId: Record<string, RuleIndexEntry>;
	/** Rule ID lists keyed by action (case-insensitive) */
	byAction: Record<string, string[]>;
	/** Rule ID lists keyed by PolicyDecision */
	byDecision: Record<PolicyDecision, string[]>;
	/** List of rule IDs that are enabled */
	enabled: string[];
	/** List of rule IDs that are disabled */
	disabled: string[];
	/** ISO 8601 timestamp of the last index update */
	lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Query Types
// ---------------------------------------------------------------------------

export interface RuleQuery {
	action?: string;
	decision?: PolicyDecision;
	enabled?: boolean;
	minPriority?: number;
	maxPriority?: number;
	limit?: number;
	offset?: number;
	sortBy?: "priority" | "createdAt" | "updatedAt";
	sortOrder?: "asc" | "desc";
}

export interface PolicyRuleStats {
	totalRules: number;
	byDecision: Record<PolicyDecision, number>;
	enabledCount: number;
	disabledCount: number;
	averagePriority: number;
	minPriority: number;
	maxPriority: number;
	conflictCount: number;
}

// ---------------------------------------------------------------------------
// Default Config Helper
// ---------------------------------------------------------------------------

/**
 * Resolve the default base path for policy storage.
 *
 * Uses `PI_CONFIG_DIR` environment variable if set, otherwise
 * falls back to `.pi` in the current working directory.
 */
function resolveDefaultBasePath(): string {
	const configDir = process.env.PI_CONFIG_DIR ?? ".pi";
	return path.resolve(process.cwd(), configDir, POLICY_DIR);
}

// ---------------------------------------------------------------------------
// Rule Store
// ---------------------------------------------------------------------------

/**
 * Durable JSON-file-backed policy rule store.
 *
 * Provides CRUD operations, querying with filtering/sorting/pagination,
 * conflict detection, and atomic writes to prevent data corruption.
 *
 * Thread-safe: all mutations are serialized through a write lock.
 */
export class RuleStore {
	private config: RuleStoreConfig;
	private index: RuleIndex;
	private writeLock: Promise<void>;
	private initialized: boolean;

	constructor(config?: Partial<RuleStoreConfig>) {
		const basePath = config?.basePath ?? resolveDefaultBasePath();
		this.config = {
			basePath,
			autoSave: config?.autoSave ?? true,
			backupOnSave: config?.backupOnSave ?? true,
		};
		this.index = this.createEmptyIndex();
		this.writeLock = Promise.resolve();
		this.initialized = false;
	}

	/**
	 * Get a copy of the current config (for inspection, not mutation).
	 */
	getConfig(): Readonly<RuleStoreConfig> {
		return { ...this.config };
	}

	/**
	 * Initialize the store: ensure directories exist and load the index.
	 *
	 * Call this once before performing any CRUD operations.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		const indexPath = path.join(this.config.basePath, "index.json");
		await fs.mkdir(this.config.basePath, { recursive: true });
		await fs.mkdir(this.rulesDir(), { recursive: true });

		this.index = await this.loadIndex(indexPath);
		this.initialized = true;
	}

	// -----------------------------------------------------------------------
	// CRUD: Policy Rules
	// -----------------------------------------------------------------------

	/**
	 * Create a new policy rule and persist it.
	 *
	 * If the rule does not have an ID, one must be provided. The rule
	 * is written atomically and the index is updated.
	 *
	 * @param rule - The policy rule to persist. Must have an id.
	 * @returns The stored rule.
	 */
	async createRule(rule: PolicyRule): Promise<PolicyRule> {
		this.ensureInitialized();

		if (!rule.id) {
			throw new Error("PolicyRule must have an id");
		}

		const validation = this.validateRule(rule);
		if (!validation.valid) {
			throw new Error(`Invalid PolicyRule: ${validation.errors.join("; ")}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.rulesDir(), `${rule.id}.json`);
			await this.atomicWrite(filePath, JSON.stringify(rule, null, 2));
			this.updateIndexForRule(rule);
			await this.saveIndex();
		});

		return rule;
	}

	/**
	 * Retrieve a policy rule by its ID.
	 *
	 * Reads the file directly from disk. If the file exists but
	 * is not in the index, the index entry is restored.
	 *
	 * @param id - The rule ID
	 * @returns The PolicyRule, or null if not found
	 */
	async getRule(id: string): Promise<PolicyRule | null> {
		this.ensureInitialized();

		try {
			const filePath = path.join(this.rulesDir(), `${id}.json`);
			const json = await this.readFileSafe(filePath);
			if (json === null) return null;

			const rule = JSON.parse(json) as PolicyRule;

			// Restore index entry if missing (e.g., after corrupt index rebuild)
			if (!this.index.byId[id]) {
				await this.withWriteLock(async () => {
					this.updateIndexForRule(rule);
					await this.saveIndex();
				});
			}

			return rule;
		} catch {
			return null;
		}
	}

	/**
	 * Update an existing policy rule by applying partial updates.
	 *
	 * @param id - The rule ID
	 * @param updates - Partial fields to merge into the existing rule
	 * @returns The updated PolicyRule
	 * @throws If the rule does not exist
	 */
	async updateRule(id: string, updates: Partial<PolicyRule>): Promise<PolicyRule> {
		this.ensureInitialized();

		const existing = await this.getRule(id);
		if (!existing) {
			throw new Error(`PolicyRule not found: ${id}`);
		}

		const updated: PolicyRule = {
			...existing,
			...updates,
			id, // id cannot change
			updatedAt: new Date().toISOString(),
		};

		const validation = this.validateRule(updated);
		if (!validation.valid) {
			throw new Error(`Updated PolicyRule is invalid: ${validation.errors.join("; ")}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.rulesDir(), `${id}.json`);
			await this.atomicWrite(filePath, JSON.stringify(updated, null, 2));
			this.updateIndexForRule(updated);
			await this.saveIndex();
		});

		return updated;
	}

	/**
	 * Delete a policy rule by its ID.
	 *
	 * @param id - The rule ID
	 * @throws If the rule does not exist
	 */
	async deleteRule(id: string): Promise<void> {
		this.ensureInitialized();

		if (!this.index.byId[id]) {
			throw new Error(`PolicyRule not found: ${id}`);
		}

		await this.withWriteLock(async () => {
			const filePath = path.join(this.rulesDir(), `${id}.json`);
			try {
				await fs.unlink(filePath);
			} catch {
				// File might already be missing; proceed
			}
			this.removeIndexForRule(id);
			await this.saveIndex();
		});
	}

	// -----------------------------------------------------------------------
	// Queries
	// -----------------------------------------------------------------------

	/**
	 * List policy rules with optional filters, sorting, and pagination.
	 *
	 * Uses the index for fast filtering by action, decision, and enabled state.
	 * Supports sorting by priority, createdAt, or updatedAt.
	 *
	 * @param query - Optional query parameters
	 * @returns Array of matching PolicyRules
	 */
	async listRules(query?: RuleQuery): Promise<PolicyRule[]> {
		this.ensureInitialized();

		// Step 1: Filter IDs using index
		let candidateIds: Set<string> | null = null;

		// Filter by action (case-insensitive)
		if (query?.action) {
			const actionKey = query.action.toLowerCase();
			const ids = new Set(this.index.byAction[actionKey] ?? []);
			candidateIds = this.intersectSets(candidateIds, ids);
		}

		// Filter by decision
		if (query?.decision) {
			const ids = new Set(this.index.byDecision[query.decision] ?? []);
			candidateIds = this.intersectSets(candidateIds, ids);
		}

		// Filter by enabled state
		if (query?.enabled !== undefined) {
			const ids = query.enabled
				? new Set(this.index.enabled)
				: new Set(this.index.disabled);
			candidateIds = this.intersectSets(candidateIds, ids);
		}

		// If no filters, start with all IDs
		if (candidateIds === null) {
			candidateIds = new Set(Object.keys(this.index.byId));
		}

		// Step 2: Load full rules for candidate IDs
		const rules: PolicyRule[] = [];
		for (const id of candidateIds) {
			try {
				const rule = await this.getRule(id);
				if (rule) {
					rules.push(rule);
				}
			} catch {
				// Skip corrupt or missing rules
			}
		}

		// Step 3: Apply minPriority and maxPriority filters (need full records)
		let filtered = rules;
		if (query?.minPriority !== undefined) {
			filtered = filtered.filter((r) => r.priority >= query.minPriority!);
		}
		if (query?.maxPriority !== undefined) {
			filtered = filtered.filter((r) => r.priority <= query.maxPriority!);
		}

		// Step 4: Sort
		const sortBy = query?.sortBy ?? "priority";
		const sortOrder = query?.sortOrder ?? "desc";
		filtered.sort((a, b) => {
			let cmp: number;
			switch (sortBy) {
				case "priority":
					cmp = a.priority - b.priority;
					break;
				case "createdAt":
					cmp = a.createdAt.localeCompare(b.createdAt);
					break;
				case "updatedAt":
					cmp = a.updatedAt.localeCompare(b.updatedAt);
					break;
				default:
					cmp = a.priority - b.priority;
			}
			return sortOrder === "asc" ? cmp : -cmp;
		});

		// Step 5: Paginate
		const limit = query?.limit ?? 50;
		const offset = query?.offset ?? 0;
		return filtered.slice(offset, offset + limit);
	}

	/**
	 * Find rules by action (case-insensitive).
	 *
	 * Uses the index for fast lookup.
	 *
	 * @param action - The action to filter by
	 * @returns Array of matching PolicyRules
	 */
	async findByAction(action: string): Promise<PolicyRule[]> {
		return this.listRules({ action });
	}

	/**
	 * Find rules by policy decision type.
	 *
	 * @param decision - The decision type to filter by
	 * @returns Array of matching PolicyRules
	 */
	async findByDecision(decision: PolicyDecision): Promise<PolicyRule[]> {
		return this.listRules({ decision });
	}

	/**
	 * Find all enabled (active) rules.
	 *
	 * @returns Array of enabled PolicyRules
	 */
	async findEnabled(): Promise<PolicyRule[]> {
		return this.listRules({ enabled: true });
	}

	/**
	 * Find all disabled (inactive) rules.
	 *
	 * @returns Array of disabled PolicyRules
	 */
	async findDisabled(): Promise<PolicyRule[]> {
		return this.listRules({ enabled: false });
	}

	// -----------------------------------------------------------------------
	// Conflict Detection
	// -----------------------------------------------------------------------

	/**
	 * Detect conflicts across all stored rules.
	 *
	 * Checks for overlapping rules (same action, different decisions)
	 * and redundant rules with the same action and decision.
	 *
	 * @returns Array of detected RuleConflicts
	 */
	async detectConflicts(): Promise<RuleConflict[]> {
		this.ensureInitialized();

		const allRules = await this.listRules();
		const conflicts: RuleConflict[] = [];

		for (let i = 0; i < allRules.length; i++) {
			for (let j = i + 1; j < allRules.length; j++) {
				const conflict = this.checkConflict(allRules[i], allRules[j]);
				if (conflict) {
					conflicts.push(conflict);
				}
			}
		}

		return conflicts;
	}

	/**
	 * Detect conflicts between a given rule and all stored rules.
	 *
	 * @param rule - The rule to check against stored rules
	 * @returns Array of detected RuleConflicts
	 */
	async detectConflictsForRule(rule: PolicyRule): Promise<RuleConflict[]> {
		this.ensureInitialized();

		const allRules = await this.listRules();
		const conflicts: RuleConflict[] = [];

		for (const other of allRules) {
			if (other.id === rule.id) continue;
			const conflict = this.checkConflict(rule, other);
			if (conflict) {
				conflicts.push(conflict);
			}
		}

		return conflicts;
	}

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	/**
	 * Compute aggregate statistics about the rule store.
	 *
	 * @returns PolicyRuleStats with aggregated data
	 */
	async getStats(): Promise<PolicyRuleStats> {
		this.ensureInitialized();

		const allRules = await this.listRules();
		const conflicts = await this.detectConflicts();

		const byDecision = {} as Record<PolicyDecision, number>;
		for (const d of ALL_POLICY_DECISIONS) {
			byDecision[d] = 0;
		}

		let totalPriority = 0;
		let minPriority = Infinity;
		let maxPriority = -Infinity;
		let enabledCount = 0;
		let disabledCount = 0;

		for (const rule of allRules) {
			byDecision[rule.decision] = (byDecision[rule.decision] ?? 0) + 1;
			totalPriority += rule.priority;
			minPriority = Math.min(minPriority, rule.priority);
			maxPriority = Math.max(maxPriority, rule.priority);
			if (rule.enabled) {
				enabledCount++;
			} else {
				disabledCount++;
			}
		}

		return {
			totalRules: allRules.length,
			byDecision,
			enabledCount,
			disabledCount,
			averagePriority: allRules.length > 0 ? totalPriority / allRules.length : 0,
			minPriority: allRules.length > 0 ? minPriority : 0,
			maxPriority: allRules.length > 0 ? maxPriority : 0,
			conflictCount: conflicts.length,
		};
	}

	// -----------------------------------------------------------------------
	// Index Management
	// -----------------------------------------------------------------------

	/**
	 * Rebuild the entire index from on-disk rule files.
	 *
	 * Useful if the index file is corrupt or out of sync.
	 */
	async rebuildIndex(): Promise<void> {
		this.ensureInitialized();

		await this.withWriteLock(async () => {
			const newIndex = this.createEmptyIndex();

			const files = await fs.readdir(this.rulesDir());
			const ruleFiles = files.filter((f) => f.endsWith(".json"));

			for (const file of ruleFiles) {
				try {
					const filePath = path.join(this.rulesDir(), file);
					const json = await this.readFileSafe(filePath);
					if (json === null) continue;
					const rule = JSON.parse(json) as PolicyRule;
					this.addToIndex(newIndex, rule);
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
			throw new Error("RuleStore not initialized. Call initialize() before performing CRUD operations.");
		}
	}

	/**
	 * Get the directory path where rule files are stored.
	 */
	private rulesDir(): string {
		return path.join(this.config.basePath, RULES_DIR);
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
	 * Get the index file path.
	 */
	private indexPath(): string {
		return path.join(this.config.basePath, "index.json");
	}

	/**
	 * Load the index from disk, or create an empty one if it doesn't exist.
	 */
	private async loadIndex(indexPath: string): Promise<RuleIndex> {
		try {
			const json = await fs.readFile(indexPath, "utf-8");
			const parsed = JSON.parse(json) as RuleIndex;
			// Validate basic structure
			if (parsed.byId && parsed.byAction && parsed.byDecision && parsed.enabled) {
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
		await this.atomicWrite(this.indexPath(), JSON.stringify(this.index, null, 2));
	}

	/**
	 * Write data to a file atomically.
	 *
	 * Writes to a temporary path first, then renames into place.
	 * This prevents partial writes from corrupting the file.
	 */
	private async atomicWrite(filePath: string, data: string): Promise<void> {
		const byteLength = Buffer.byteLength(data, "utf-8");
		if (byteLength > DEFAULT_MAX_FILE_SIZE_BYTES) {
			throw new Error(`File size ${byteLength} bytes exceeds maximum ${DEFAULT_MAX_FILE_SIZE_BYTES} bytes`);
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
			if (stat.size > DEFAULT_MAX_FILE_SIZE_BYTES) {
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
	private createEmptyIndex(): RuleIndex {
		const byDecision = {} as Record<PolicyDecision, string[]>;

		for (const d of ALL_POLICY_DECISIONS) {
			byDecision[d] = [];
		}

		return {
			byId: {},
			byAction: {},
			byDecision,
			enabled: [],
			disabled: [],
			lastUpdated: new Date().toISOString(),
		};
	}

	/**
	 * Update the index to reflect a stored rule.
	 */
	private updateIndexForRule(rule: PolicyRule): void {
		this.addToIndex(this.index, rule);
	}

	/**
	 * Add a rule to an index structure.
	 */
	private addToIndex(index: RuleIndex, rule: PolicyRule): void {
		const entry: RuleIndexEntry = {
			id: rule.id,
			action: rule.condition.action,
			decision: rule.decision,
			priority: rule.priority,
			enabled: rule.enabled,
			createdAt: rule.createdAt,
			updatedAt: rule.updatedAt,
		};

		// Remove old entry if present (for updates)
		const oldEntry = index.byId[rule.id];
		if (oldEntry) {
			this.removeFromIndexLists(index, rule.id, oldEntry);
		}

		// Add to byId
		index.byId[rule.id] = entry;

		// Add to byAction (case-insensitive key)
		const actionKey = rule.condition.action.toLowerCase();
		if (!index.byAction[actionKey]) {
			index.byAction[actionKey] = [];
		}
		if (!index.byAction[actionKey].includes(rule.id)) {
			index.byAction[actionKey].push(rule.id);
		}

		// Add to byDecision
		if (!index.byDecision[rule.decision]) {
			index.byDecision[rule.decision] = [];
		}
		if (!index.byDecision[rule.decision].includes(rule.id)) {
			index.byDecision[rule.decision].push(rule.id);
		}

		// Add to enabled or disabled list
		if (rule.enabled) {
			if (!index.enabled.includes(rule.id)) {
				index.enabled.push(rule.id);
			}
		} else {
			if (!index.disabled.includes(rule.id)) {
				index.disabled.push(rule.id);
			}
		}
	}

	/**
	 * Remove a rule from the index.
	 */
	private removeIndexForRule(id: string): void {
		const entry = this.index.byId[id];
		if (!entry) return;

		this.removeFromIndexLists(this.index, id, entry);
		delete this.index.byId[id];
	}

	/**
	 * Remove a rule's ID from secondary index lists.
	 */
	private removeFromIndexLists(index: RuleIndex, id: string, entry: RuleIndexEntry): void {
		// Remove from byAction
		const actionKey = entry.action.toLowerCase();
		const actionList = index.byAction[actionKey];
		if (actionList) {
			const idx = actionList.indexOf(id);
			if (idx !== -1) actionList.splice(idx, 1);
			if (actionList.length === 0) {
				delete index.byAction[actionKey];
			}
		}

		// Remove from byDecision
		const decisionList = index.byDecision[entry.decision];
		if (decisionList) {
			const idx = decisionList.indexOf(id);
			if (idx !== -1) decisionList.splice(idx, 1);
		}

		// Remove from enabled or disabled list
		const enabledIdx = index.enabled.indexOf(id);
		if (enabledIdx !== -1) index.enabled.splice(enabledIdx, 1);

		const disabledIdx = index.disabled.indexOf(id);
		if (disabledIdx !== -1) index.disabled.splice(disabledIdx, 1);
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

	/**
	 * Validate a PolicyRule before persisting.
	 */
	private validateRule(rule: PolicyRule): { valid: boolean; errors: string[] } {
		const errors: string[] = [];

		if (!rule.id || typeof rule.id !== "string") {
			errors.push("id must be a non-empty string");
		}
		if (!rule.name || typeof rule.name !== "string") {
			errors.push("name must be a non-empty string");
		}
		if (!rule.condition || typeof rule.condition !== "object") {
			errors.push("condition must be an object");
		} else if (!rule.condition.action || typeof rule.condition.action !== "string") {
			errors.push("condition.action must be a non-empty string");
		}
		if (!ALL_POLICY_DECISIONS.includes(rule.decision)) {
			errors.push(`decision must be one of: ${ALL_POLICY_DECISIONS.join(", ")}`);
		}
		if (typeof rule.priority !== "number" || !Number.isFinite(rule.priority)) {
			errors.push("priority must be a finite number");
		}
		if (typeof rule.enabled !== "boolean") {
			errors.push("enabled must be a boolean");
		}
		if (!rule.createdAt || typeof rule.createdAt !== "string") {
			errors.push("createdAt must be a non-empty string");
		}
		if (!rule.updatedAt || typeof rule.updatedAt !== "string") {
			errors.push("updatedAt must be a non-empty string");
		}

		return { valid: errors.length === 0, errors };
	}

	/**
	 * Check for a conflict between two rules.
	 *
	 * Returns a RuleConflict if the rules overlap on the same action
	 * with different decisions, or if they are redundant.
	 */
	private checkConflict(a: PolicyRule, b: PolicyRule): RuleConflict | null {
		// Only check rules that target the same action
		const actionA = a.condition.action.toLowerCase();
		const actionB = b.condition.action.toLowerCase();
		if (actionA !== actionB) return null;

		const matchAction = a.condition.action;

		// Different decisions on the same action is a conflict
		if (a.decision !== b.decision) {
			return {
				ruleA: a,
				ruleB: b,
				matchAction,
				conflictType: "different_decision",
			};
		}

		// Same action, same decision, overlapping scope
		if (a.priority === b.priority) {
			return {
				ruleA: a,
				ruleB: b,
				matchAction,
				conflictType: "overlap",
			};
		}

		// Same action and decision but different priority — lower-priority
		// rule is redundant if it would never be matched (higher priority wins)
		if (a.decision === b.decision) {
			const lowerPriority = a.priority < b.priority ? a : b;
			const higherPriority = a.priority < b.priority ? b : a;

			// If the higher-priority rule covers the same condition scope,
			// the lower-priority one is redundant for this action
			if (this.conditionsOverlap(a.condition, b.condition)) {
				return {
					ruleA: lowerPriority,
					ruleB: higherPriority,
					matchAction,
					conflictType: "redundant",
				};
			}
		}

		return null;
	}

	/**
	 * Check if two policy conditions overlap on their relevant attributes.
	 *
	 * Returns true if both conditions would match for the same request context.
	 */
	private conditionsOverlap(
		a: PolicyRule["condition"],
		b: PolicyRule["condition"],
	): boolean {
		// If both conditions have no additional restrictions beyond action,
		// they overlap completely
		if (!a.actionType && !b.actionType && !a.riskLevel && !b.riskLevel) {
			return true;
		}

		// Check for overlapping action types
		if (a.actionType && b.actionType && a.actionType === b.actionType) {
			return true;
		}

		// Check for overlapping risk levels
		if (a.riskLevel && b.riskLevel) {
			const aLevels = Array.isArray(a.riskLevel) ? a.riskLevel : [a.riskLevel];
			const bLevels = Array.isArray(b.riskLevel) ? b.riskLevel : [b.riskLevel];
			if (aLevels.some((l) => bLevels.includes(l))) {
				return true;
			}
		}

		return false;
	}
}
