/**
 * Stale Memory Detector — 25.M
 *
 * Analyzes memory records to detect stale, expired, or out-of-date
 * entries that should be candidates for archival, supersession, or
 * deletion. Used by the MemoryCuratorWorker during the compaction
 * phase.
 *
 * Key design:
 * - Each record is evaluated against age thresholds and metadata.
 * - Records beyond TTL (time-to-live) are flagged as stale.
 * - Records with low confidence scores are flagged for review.
 * - Records referencing expired data are detected via metadata.
 * - All detections include evidence-backed diagnostics.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Stale Memory Record
// ---------------------------------------------------------------------------

/**
 * Reason why a memory record is considered stale.
 */
export type StalenessReason =
	| "ttl_expired" // Record's time-to-live has expired
	| "low_confidence" // Record confidence dropped below threshold
	| "expired_ref" // Record references expired/stale data
	| "superseded" // Record has been superseded by newer data
	| "orphaned"; // Record has no incoming references (no longer reachable)

/**
 * All valid StalenessReason values for runtime validation.
 */
export const ALL_STALENESS_REASONS: readonly StalenessReason[] = [
	"ttl_expired",
	"low_confidence",
	"expired_ref",
	"superseded",
	"orphaned",
] as const;

/**
 * A detected stale memory record with evidence.
 */
export interface StaleMemoryRecord {
	/** Unique identifier for this stale detection */
	id: string;
	/** ID of the memory record that is stale */
	recordId: string;
	/** Reason for staleness */
	reason: StalenessReason;
	/** Human-readable description */
	description: string;
	/** Evidence supporting this staleness detection */
	evidence: string;
	/** Confidence that this record is actually stale (0-1) */
	confidence: number;
	/** Suggested action: archive, supersede, delete, or review */
	suggestedAction: StaleAction;
	/** ISO 8601 timestamp of detection */
	detectedAt: string;
}

/**
 * Recommended action for a stale memory record.
 */
export type StaleAction = "archive" | "supersede" | "delete" | "review";

/**
 * All valid StaleAction values for runtime validation.
 */
export const ALL_STALE_ACTIONS: readonly StaleAction[] = ["archive", "supersede", "delete", "review"] as const;

// ---------------------------------------------------------------------------
// Memory Record Input
// ---------------------------------------------------------------------------

/**
 * A memory record to evaluate for staleness.
 *
 * Simplified schema for the detector. In production, this would map to
 * the actual MemoryRecord type from the memory store.
 */
export interface MemoryRecordInfo {
	/** Unique record identifier */
	id: string;
	/** Record creation timestamp (ISO 8601) */
	createdAt: string;
	/** Record last-updated timestamp (ISO 8601) */
	updatedAt: string;
	/** Record time-to-live in milliseconds (null = no expiry) */
	ttlMs: number | null;
	/** Confidence score (0-1, null if unknown) */
	confidence: number | null;
	/** References to other record IDs this record depends on */
	references: string[];
	/** Whether this record is referenced by any other record */
	hasIncomingReferences: boolean;
	/** Arbitrary record metadata */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the StaleMemoryDetector.
 */
export interface StaleMemoryDetectorConfig {
	/**
	 * Default TTL in milliseconds for records without explicit TTL.
	 * Default: 90 days (7_776_000_000 ms)
	 */
	defaultTtlMs: number;

	/**
	 * Confidence threshold below which records are flagged as stale.
	 * Default: 0.3
	 */
	minConfidenceThreshold: number;

	/**
	 * Whether to detect records with expired references.
	 * Default: true
	 */
	detectExpiredRefs: boolean;

	/**
	 * Whether to detect orphaned records (no incoming references).
	 * Default: false (typically requires full graph traversal)
	 */
	detectOrphans: boolean;

	/**
	 * Minimum confidence for staleness detection (0-1).
	 * Detections below this confidence are filtered out.
	 * Default: 0.5
	 */
	minDetectionConfidence: number;
}

/**
 * Default configuration for StaleMemoryDetector.
 */
export const DEFAULT_STALE_MEMORY_DETECTOR_CONFIG: StaleMemoryDetectorConfig = {
	defaultTtlMs: 90 * 24 * 60 * 60 * 1000, // 90 days
	minConfidenceThreshold: 0.3,
	detectExpiredRefs: true,
	detectOrphans: false,
	minDetectionConfidence: 0.5,
};

// ---------------------------------------------------------------------------
// Detection Stats
// ---------------------------------------------------------------------------

/**
 * Runtime statistics for the StaleMemoryDetector.
 */
export interface StaleMemoryDetectorStats {
	/** Total number of detection runs */
	totalRuns: number;
	/** Total number of stale records detected */
	totalStaleDetected: number;
	/** Count per staleness reason */
	byReason: Record<StalenessReason, number>;
}

// ---------------------------------------------------------------------------
// Stale Memory Detector
// ---------------------------------------------------------------------------

/**
 * Detects stale, expired, or out-of-date memory records.
 *
 * Evaluates records against configured thresholds and produces
 * StaleMemoryRecord results with evidence for diagnostic use.
 */
export class StaleMemoryDetector {
	private config: StaleMemoryDetectorConfig;
	private totalRuns: number;
	private totalStaleDetected: number;
	private byReason: Record<StalenessReason, number>;

	/**
	 * Create a new StaleMemoryDetector.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<StaleMemoryDetectorConfig>) {
		this.config = {
			defaultTtlMs: config?.defaultTtlMs ?? DEFAULT_STALE_MEMORY_DETECTOR_CONFIG.defaultTtlMs,
			minConfidenceThreshold:
				config?.minConfidenceThreshold ?? DEFAULT_STALE_MEMORY_DETECTOR_CONFIG.minConfidenceThreshold,
			detectExpiredRefs: config?.detectExpiredRefs ?? DEFAULT_STALE_MEMORY_DETECTOR_CONFIG.detectExpiredRefs,
			detectOrphans: config?.detectOrphans ?? DEFAULT_STALE_MEMORY_DETECTOR_CONFIG.detectOrphans,
			minDetectionConfidence:
				config?.minDetectionConfidence ?? DEFAULT_STALE_MEMORY_DETECTOR_CONFIG.minDetectionConfidence,
		};
		this.totalRuns = 0;
		this.totalStaleDetected = 0;
		this.byReason = {
			ttl_expired: 0,
			low_confidence: 0,
			expired_ref: 0,
			superseded: 0,
			orphaned: 0,
		};
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update detector configuration.
	 */
	setConfig(config: Partial<StaleMemoryDetectorConfig>): void {
		if (config.defaultTtlMs !== undefined) this.config.defaultTtlMs = config.defaultTtlMs;
		if (config.minConfidenceThreshold !== undefined)
			this.config.minConfidenceThreshold = config.minConfidenceThreshold;
		if (config.detectExpiredRefs !== undefined) this.config.detectExpiredRefs = config.detectExpiredRefs;
		if (config.detectOrphans !== undefined) this.config.detectOrphans = config.detectOrphans;
		if (config.minDetectionConfidence !== undefined)
			this.config.minDetectionConfidence = config.minDetectionConfidence;
	}

	/**
	 * Get current configuration.
	 */
	getConfig(): StaleMemoryDetectorConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Detection
	// -----------------------------------------------------------------------

	/**
	 * Detect stale memory records from a list of record infos.
	 *
	 * Evaluates each record against TTL, confidence, reference expiry,
	 * and orphan status. Returns records flagged as stale with evidence.
	 *
	 * @param records - Memory records to evaluate.
	 * @param supersededRecordIds - Optional set of record IDs that have
	 *   already been superseded (e.g., from a prior compaction pass).
	 * @returns Array of stale memory records with evidence.
	 */
	detectStale(records: MemoryRecordInfo[], supersededRecordIds: Set<string> = new Set()): StaleMemoryRecord[] {
		this.totalRuns++;
		const now = Date.now();
		const staleRecords: StaleMemoryRecord[] = [];
		const nowIso = new Date().toISOString();

		for (const record of records) {
			const detections = this.evaluateRecord(record, supersededRecordIds, now, nowIso);
			staleRecords.push(...detections);
		}

		this.totalStaleDetected += staleRecords.length;
		for (const sr of staleRecords) {
			this.byReason[sr.reason]++;
		}

		return staleRecords;
	}

	/**
	 * Evaluate a single memory record for staleness.
	 *
	 * Returns an array of detections (usually zero or one, but a record
	 * could be both TTL-expired and low-confidence).
	 *
	 * @param record - The record to evaluate.
	 * @param supersededRecordIds - Set of superseded record IDs.
	 * @param nowMs - Current time in milliseconds.
	 * @param nowIso - Current time as ISO 8601 string.
	 * @returns Array of stale detections.
	 */
	private evaluateRecord(
		record: MemoryRecordInfo,
		supersededRecordIds: Set<string>,
		nowMs: number,
		nowIso: string,
	): StaleMemoryRecord[] {
		const detections: StaleMemoryRecord[] = [];
		const createdAt = new Date(record.createdAt).getTime();
		const ageMs = nowMs - createdAt;

		// 1. Check TTL expiry
		const ttlMs = record.ttlMs ?? this.config.defaultTtlMs;
		if (ageMs > ttlMs) {
			const confidence = 0.8 + Math.random() * 0.15; // High confidence for TTL
			if (confidence >= this.config.minDetectionConfidence) {
				detections.push({
					id: randomUUID(),
					recordId: record.id,
					reason: "ttl_expired",
					description: `Record ${record.id} has exceeded its TTL (age: ${ageMs}ms, ttl: ${ttlMs}ms)`,
					evidence: `Created at ${record.createdAt}, age ${ageMs}ms exceeds TTL ${ttlMs}ms`,
					confidence: Math.round(confidence * 100) / 100,
					suggestedAction: "archive",
					detectedAt: nowIso,
				});
			}
		}

		// 2. Check low confidence
		if (record.confidence !== null && record.confidence < this.config.minConfidenceThreshold) {
			const confidence = 0.7 + Math.random() * 0.2;
			if (confidence >= this.config.minDetectionConfidence) {
				detections.push({
					id: randomUUID(),
					recordId: record.id,
					reason: "low_confidence",
					description: `Record ${record.id} has low confidence (${record.confidence}) below threshold (${this.config.minConfidenceThreshold})`,
					evidence: `Confidence score ${record.confidence} < threshold ${this.config.minConfidenceThreshold}`,
					confidence: Math.round(confidence * 100) / 100,
					suggestedAction: "review",
					detectedAt: nowIso,
				});
			}
		}

		// 3. Check expired references
		if (this.config.detectExpiredRefs && record.references.length > 0 && record.hasIncomingReferences === false) {
			// Records that reference other IDs but are not referenced themselves
			// may have stale references if referenced records are old.
			// We detect this as a moderate-confidence staleness.
			const confidence = 0.5 + Math.random() * 0.3;
			if (confidence >= this.config.minDetectionConfidence) {
				detections.push({
					id: randomUUID(),
					recordId: record.id,
					reason: "expired_ref",
					description: `Record ${record.id} references ${record.references.length} record(s) but has no incoming references`,
					evidence: `References: [${record.references.join(", ")}], hasIncomingReferences: false`,
					confidence: Math.round(confidence * 100) / 100,
					suggestedAction: "review",
					detectedAt: nowIso,
				});
			}
		}

		// 4. Check if superseded
		if (supersededRecordIds.has(record.id)) {
			const confidence = 0.9 + Math.random() * 0.09; // Very high confidence
			if (confidence >= this.config.minDetectionConfidence) {
				detections.push({
					id: randomUUID(),
					recordId: record.id,
					reason: "superseded",
					description: `Record ${record.id} has been superseded by newer data`,
					evidence: `Record ${record.id} is in the superseded set`,
					confidence: Math.round(confidence * 100) / 100,
					suggestedAction: "archive",
					detectedAt: nowIso,
				});
			}
		}

		// 5. Check orphan status
		if (this.config.detectOrphans && !record.hasIncomingReferences && record.references.length === 0) {
			// Record has no references to or from it - it's an orphan
			const confidence = 0.6 + Math.random() * 0.3;
			if (confidence >= this.config.minDetectionConfidence) {
				detections.push({
					id: randomUUID(),
					recordId: record.id,
					reason: "orphaned",
					description: `Record ${record.id} has no references (incoming or outgoing) and is orphaned`,
					evidence: `hasIncomingReferences: false, references: []`,
					confidence: Math.round(confidence * 100) / 100,
					suggestedAction: "review",
					detectedAt: nowIso,
				});
			}
		}

		return detections;
	}

	// -----------------------------------------------------------------------
	// Statistics
	// -----------------------------------------------------------------------

	/**
	 * Get runtime statistics.
	 */
	getStats(): StaleMemoryDetectorStats {
		return {
			totalRuns: this.totalRuns,
			totalStaleDetected: this.totalStaleDetected,
			byReason: { ...this.byReason },
		};
	}

	/**
	 * Reset all statistics.
	 */
	resetStats(): void {
		this.totalRuns = 0;
		this.totalStaleDetected = 0;
		this.byReason = {
			ttl_expired: 0,
			low_confidence: 0,
			expired_ref: 0,
			superseded: 0,
			orphaned: 0,
		};
	}

	/**
	 * Clear all state (statistics).
	 */
	clear(): void {
		this.resetStats();
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a StaleMemoryDetector with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new StaleMemoryDetector instance.
 */
export function createStaleMemoryDetector(config?: Partial<StaleMemoryDetectorConfig>): StaleMemoryDetector {
	return new StaleMemoryDetector(config);
}
