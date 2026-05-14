/**
 * False-Positive Tracker - P8.D
 *
 * Tracks and manages false-positive detections from the detection engine.
 * Provides methods to record false positives, query known false positives,
 * suppress known FP patterns, and compute false-positive rates.
 *
 * Acceptance Criteria:
 * - False-positive handling is tracked.
 * - Known false-positive patterns are suppressed in future detections.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DetectionCategory, DetectionResult, FalsePositiveInfo, FalsePositiveSummary } from "./detection-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A recorded false positive in the tracking system.
 */
export interface FalsePositiveRecord {
	/** Detection ID */
	detectionId: string;
	/** Detection category */
	category: DetectionCategory;
	/** Detection title */
	title: string;
	/** Detection description */
	description: string;
	/** False-positive details */
	falsePositiveInfo: FalsePositiveInfo;
	/** Whether this record is currently suppressed */
	suppressed: boolean;
	/** Hash of the detection for deduplication */
	contentHash: string;
}

/**
 * A pattern that identifies known false positives for suppression.
 */
export interface SuppressionPattern {
	/** Unique identifier for this suppression */
	id: string;
	/** Category to suppress (or "*" for all) */
	category: DetectionCategory | "*";
	/** Regex pattern to match against detection title/description */
	pattern: string;
	/** Reason for suppression */
	reason: string;
	/** When this suppression was added */
	createdAt: number;
	/** Whether the suppression is active */
	active: boolean;
}

/**
 * Configuration for the false-positive tracker.
 */
export interface FalsePositiveTrackerConfig {
	/** Directory for persistence */
	storageDir?: string;
	/** Maximum number of records to keep in memory */
	maxRecords?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RECORDS = 1000;

// ---------------------------------------------------------------------------
// FalsePositiveTracker
// ---------------------------------------------------------------------------

/**
 * Tracks and manages false-positive detections.
 *
 * Provides persistence, query, and suppression capabilities to
 * reduce false-positive rates over time as the system learns from
 * user feedback and detection outcomes.
 */
export class FalsePositiveTracker {
	/** Known false-positive records */
	private records: Map<string, FalsePositiveRecord> = new Map();
	/** Active suppression patterns */
	private suppressions: SuppressionPattern[] = [];
	/** Storage directory path */
	private storageDir: string;
	/** Max records in memory */
	private maxRecords: number;
	/** Whether the tracker is initialized */
	private initialized = false;

	constructor(config: FalsePositiveTrackerConfig = {}) {
		this.storageDir = config.storageDir ?? ".pi/detections";
		this.maxRecords = config.maxRecords ?? DEFAULT_MAX_RECORDS;
	}

	/**
	 * Initialize the false-positive tracker.
	 *
	 * Loads known false positives and suppression patterns from disk.
	 * Must be called before any other operations.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		await fs.mkdir(this.storageDir, { recursive: true });

		// Load false-positive records
		await this.loadRecords();

		// Load suppression patterns
		await this.loadSuppressions();

		this.initialized = true;
	}

	/**
	 * Record a detection as a false positive.
	 *
	 * @param detection - The detection that was a false positive
	 * @param info - False-positive details
	 * @returns The created record
	 */
	async recordFalsePositive(detection: DetectionResult, info: FalsePositiveInfo): Promise<FalsePositiveRecord> {
		if (!this.initialized) {
			await this.initialize();
		}

		const contentHash = this.computeContentHash(detection);

		// Check if already recorded
		const existingId = this.findRecordByHash(contentHash);
		if (existingId) {
			const existing = this.records.get(existingId)!;
			existing.falsePositiveInfo = info;
			existing.suppressed = info.suppressFuture;
			await this.saveRecords();
			return existing;
		}

		const record: FalsePositiveRecord = {
			detectionId: detection.id,
			category: detection.category,
			title: detection.title,
			description: detection.description,
			falsePositiveInfo: info,
			suppressed: info.suppressFuture,
			contentHash,
		};

		this.records.set(detection.id, record);

		// Enforce max records
		if (this.records.size > this.maxRecords) {
			const oldest = [...this.records.entries()].sort(
				([, a], [, b]) => a.falsePositiveInfo.identifiedAt - b.falsePositiveInfo.identifiedAt,
			);
			const toRemove = this.records.size - this.maxRecords;
			for (let i = 0; i < toRemove; i++) {
				this.records.delete(oldest[i][0]);
			}
		}

		await this.saveRecords();

		return record;
	}

	/**
	 * Check if a detection matches a known false-positive pattern.
	 *
	 * @param detection - The detection to check
	 * @returns False-positive info if matched, undefined otherwise
	 */
	async isKnownFalsePositive(detection: DetectionResult): Promise<FalsePositiveInfo | undefined> {
		if (!this.initialized) {
			await this.initialize();
		}

		// Check by content hash
		const contentHash = this.computeContentHash(detection);
		const existingByHash = this.findRecordByHash(contentHash);
		if (existingByHash) {
			const record = this.records.get(existingByHash)!;
			if (record.suppressed) {
				return record.falsePositiveInfo;
			}
		}

		// Check suppression patterns
		for (const suppression of this.suppressions) {
			if (!suppression.active) continue;

			const categoryMatches = suppression.category === "*" || suppression.category === detection.category;
			if (!categoryMatches) continue;

			try {
				const regex = new RegExp(suppression.pattern, "i");
				if (regex.test(detection.title) || regex.test(detection.description)) {
					return {
						identifiedAt: suppression.createdAt,
						identifiedBy: "system",
						reason: suppression.reason,
						suppressFuture: true,
						tags: ["suppressed"],
					};
				}
			} catch {
				// Invalid regex in suppression pattern - skip
			}
		}

		return undefined;
	}

	/**
	 * Add a suppression pattern to automatically suppress known false positives.
	 *
	 * @param pattern - The suppression pattern
	 */
	async addSuppression(pattern: Omit<SuppressionPattern, "id" | "createdAt">): Promise<SuppressionPattern> {
		if (!this.initialized) {
			await this.initialize();
		}

		const suppression: SuppressionPattern = {
			...pattern,
			id: `sup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
			createdAt: Date.now(),
		};

		this.suppressions.push(suppression);
		await this.saveSuppressions();

		return suppression;
	}

	/**
	 * Remove a suppression pattern.
	 *
	 * @param suppressionId - The suppression pattern ID
	 * @returns True if removed
	 */
	async removeSuppression(suppressionId: string): Promise<boolean> {
		if (!this.initialized) {
			await this.initialize();
		}

		const index = this.suppressions.findIndex((s) => s.id === suppressionId);
		if (index === -1) return false;

		this.suppressions.splice(index, 1);
		await this.saveSuppressions();

		return true;
	}

	/**
	 * Get all active suppression patterns.
	 */
	getSuppressions(): SuppressionPattern[] {
		return [...this.suppressions];
	}

	/**
	 * Compute a false-positive summary from a set of detections.
	 *
	 * @param detections - The detections to summarize
	 * @returns False-positive summary
	 */
	async computeSummary(detections: DetectionResult[]): Promise<FalsePositiveSummary> {
		if (!this.initialized) {
			await this.initialize();
		}

		const totalDetections = detections.length;
		const falsePositives = detections.filter((d) => d.isFalsePositive);
		const falsePositiveCount = falsePositives.length;
		const falsePositiveRate = totalDetections > 0 ? falsePositiveCount / totalDetections : 0;

		const byCategory: Record<string, { total: number; falsePositives: number; rate: number }> = {};

		const allCategories = new Set<DetectionCategory>();
		for (const d of detections) {
			allCategories.add(d.category);
		}

		for (const category of allCategories) {
			const catDetections = detections.filter((d) => d.category === category);
			const catFalsePositives = catDetections.filter((d) => d.isFalsePositive);
			byCategory[category] = {
				total: catDetections.length,
				falsePositives: catFalsePositives.length,
				rate: catDetections.length > 0 ? catFalsePositives.length / catDetections.length : 0,
			};
		}

		return {
			totalDetections,
			falsePositiveCount,
			falsePositiveRate,
			byCategory: byCategory as FalsePositiveSummary["byCategory"],
			suppressedPatterns: this.suppressions.filter((s) => s.active).map((s) => s.pattern),
		};
	}

	/**
	 * Get all false-positive records.
	 */
	getRecords(): FalsePositiveRecord[] {
		return [...this.records.values()];
	}

	/**
	 * Clear all records and suppressions.
	 */
	async reset(): Promise<void> {
		this.records.clear();
		this.suppressions = [];
		await this.saveRecords();
		await this.saveSuppressions();
	}

	// =========================================================================
	// Persistence
	// =========================================================================

	/**
	 * Load false-positive records from disk.
	 */
	private async loadRecords(): Promise<void> {
		const recordsPath = path.join(this.storageDir, "false-positives.json");
		try {
			const content = await fs.readFile(recordsPath, "utf-8");
			const parsed = JSON.parse(content);
			if (Array.isArray(parsed.records)) {
				for (const record of parsed.records) {
					this.records.set(record.detectionId, record as FalsePositiveRecord);
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				// File doesn't exist yet - first use
			}
		}
	}

	/**
	 * Save false-positive records to disk.
	 */
	private async saveRecords(): Promise<void> {
		const recordsPath = path.join(this.storageDir, "false-positives.json");
		const tempPath = `${recordsPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
		const serializable = {
			updatedAt: Date.now(),
			records: Array.from(this.records.values()),
		};
		await fs.writeFile(tempPath, JSON.stringify(serializable, null, 2), "utf-8");
		await fs.rename(tempPath, recordsPath);
	}

	/**
	 * Load suppression patterns from disk.
	 */
	private async loadSuppressions(): Promise<void> {
		const suppressionsPath = path.join(this.storageDir, "suppressions.json");
		try {
			const content = await fs.readFile(suppressionsPath, "utf-8");
			const parsed = JSON.parse(content);
			if (Array.isArray(parsed.suppressions)) {
				this.suppressions = parsed.suppressions as SuppressionPattern[];
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				// File doesn't exist yet - first use
			}
		}
	}

	/**
	 * Save suppression patterns to disk.
	 */
	private async saveSuppressions(): Promise<void> {
		const suppressionsPath = path.join(this.storageDir, "suppressions.json");
		const tempPath = `${suppressionsPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
		const serializable = {
			updatedAt: Date.now(),
			suppressions: this.suppressions,
		};
		await fs.writeFile(tempPath, JSON.stringify(serializable, null, 2), "utf-8");
		await fs.rename(tempPath, suppressionsPath);
	}

	// =========================================================================
	// Helpers
	// =========================================================================

	/**
	 * Compute a content hash for a detection for deduplication.
	 */
	private computeContentHash(detection: DetectionResult): string {
		const content = `${detection.category}|${detection.title}|${detection.description}`;
		let hash = 0;
		for (let i = 0; i < content.length; i++) {
			const char = content.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return hash.toString(36);
	}

	/**
	 * Find a record by content hash.
	 */
	private findRecordByHash(hash: string): string | undefined {
		for (const [id, record] of this.records) {
			if (record.contentHash === hash) return id;
		}
		return undefined;
	}
}

/**
 * Create a false-positive tracker instance.
 *
 * @param config - Optional configuration
 * @returns False-positive tracker instance
 */
export function createFalsePositiveTracker(config?: FalsePositiveTrackerConfig): FalsePositiveTracker {
	return new FalsePositiveTracker(config);
}
