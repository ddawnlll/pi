/**
 * Audit Ledger — P18.E
 *
 * Append-only, immutable decision log for every policy evaluation.
 *
 * Features:
 * - Append-only: no in-place updates or deletion
 * - Line-delimited JSON (.ndjson) for easy tailing
 * - Auto-rotate at configurable size (default 100MB)
 * - Query by actor, action, decision, date range
 * - Thread-safe writes (single writer with lock)
 * - Corruption-tolerant reader (skip unparseable lines, log error)
 *
 * File Structure:
 *   .pi/brain/audit/
 *   ├── 2026/
 *   │   ├── 05/
 *   │   │   ├── 19.ndjson
 *   │   │   ├── 19.rotated.1.ndjson
 *   │   │   └── 19.rotated.2.ndjson
 *   │   └── 06/
 *   │       └── 01.ndjson
 *   └── current.ndjson (symlink or active file)
 */

import { existsSync } from "fs";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "fs/promises";
import { join, resolve } from "path";
import type { AutonomyLevel } from "../goals/types.js";
import type { AuditQuery, AuditStats, AuditEntry as PolicyAuditEntry, PolicyDecision } from "../policy/types.js";
import type { RiskLevel } from "../proposals/types.js";
import type { SourceRef } from "../reflection/types.js";

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------

export type { AuditQuery, AuditStats, PolicyDecision, AutonomyLevel, RiskLevel, SourceRef };

/**
 * Audit entry shape used by the AuditLedger.
 * Mirrors the PolicyAuditEntry from policy types but uses Omit to allow
 * id and timestamp to be auto-generated.
 */
export type AuditEntryInput = Omit<PolicyAuditEntry, "id" | "timestamp">;

/**
 * Full audit entry including auto-generated id and timestamp.
 */
export interface AuditEntry extends PolicyAuditEntry {}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_PATH = ".pi/brain/audit";
const DEFAULT_ROTATION_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100MB
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// AuditLedger
// ---------------------------------------------------------------------------

/**
 * Append-only, immutable decision log for every policy evaluation.
 *
 * Writes are serialised through a promise chain to guarantee ordering.
 * Entries are buffered and flushed periodically or on explicit flush().
 * Files are rotated when they exceed the configured size threshold.
 * Corrupted lines during reads are skipped with an error log.
 */
export class AuditLedger {
	private readonly basePath: string;
	private readonly rotationThresholdBytes: number;
	private readonly flushIntervalMs: number;
	private readonly batchSize: number;

	private buffer: AuditEntry[] = [];
	private writeLock: Promise<void> = Promise.resolve();
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private currentDate: string = "";
	private currentFilePath: string = "";
	private writeStreamInitialised: boolean = false;
	private errorsLogged: number = 0;

	constructor(options?: {
		basePath?: string;
		rotationThresholdBytes?: number;
		flushIntervalMs?: number;
		batchSize?: number;
	}) {
		this.basePath = resolve(options?.basePath ?? DEFAULT_BASE_PATH);
		this.rotationThresholdBytes = options?.rotationThresholdBytes ?? DEFAULT_ROTATION_THRESHOLD_BYTES;
		this.flushIntervalMs = options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
		this.batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
	}

	// -----------------------------------------------------------------------
	// Append
	// -----------------------------------------------------------------------

	/**
	 * Append an audit entry to the ledger.
	 *
	 * Writes are serialised: each call waits for the previous write to complete.
	 * The entry gets an auto-generated ULID-style ID and ISO timestamp.
	 *
	 * @param entry - The entry data (without id/timestamp)
	 * @returns The full entry with generated id and timestamp
	 */
	async log(entry: AuditEntryInput): Promise<AuditEntry> {
		const fullEntry: AuditEntry = {
			...entry,
			id: this.generateId(),
			timestamp: new Date().toISOString(),
		};

		// Serialise writes through the promise chain
		const previousLock = this.writeLock;
		this.writeLock = previousLock.then(async () => {
			this.buffer.push(fullEntry);

			if (this.buffer.length >= this.batchSize) {
				await this.flushBuffer();
			} else {
				this.scheduleFlush();
			}
		});

		await this.writeLock;
		return fullEntry;
	}

	// -----------------------------------------------------------------------
	// Query
	// -----------------------------------------------------------------------

	/**
	 * Query the ledger with optional filters.
	 *
	 * Scans all ndjson files under the base path, parses them, and returns
	 * matching entries sorted newest-first.
	 *
	 * @param filters - Optional query filters
	 * @returns Array of matching audit entries
	 */
	async query(filters: AuditQuery = {}): Promise<AuditEntry[]> {
		// Flush any buffered entries first so queries see them
		await this.flush();

		const allEntries = await this.readAllEntries();

		let results = allEntries;

		if (filters.actor) {
			results = results.filter((e) => e.actor === filters.actor);
		}
		if (filters.action) {
			results = results.filter((e) => e.action === filters.action);
		}
		if (filters.decision) {
			results = results.filter((e) => e.decision === filters.decision);
		}
		if (filters.result) {
			results = results.filter((e) => e.result === filters.result);
		}
		if (filters.startDate) {
			results = results.filter((e) => e.timestamp >= filters.startDate!);
		}
		if (filters.endDate) {
			results = results.filter((e) => e.timestamp <= filters.endDate!);
		}
		if (filters.proposalId) {
			results = results.filter((e) => e.proposalId === filters.proposalId);
		}
		if (filters.planExecId) {
			results = results.filter((e) => e.planExecId === filters.planExecId);
		}

		// Sort newest-first, tiebreak by ID (monotonic)
		results.sort((a, b) => {
			const tsCmp = b.timestamp.localeCompare(a.timestamp);
			if (tsCmp !== 0) return tsCmp;
			return b.id.localeCompare(a.id); // secondary: newest ID first
		});

		// Pagination
		const offset = filters.offset ?? 0;
		const limit = filters.limit ?? results.length;
		return results.slice(offset, offset + limit);
	}

	/**
	 * Get a single entry by ID.
	 *
	 * @param id - The entry ID to look up
	 * @returns The entry or null if not found
	 */
	async get(id: string): Promise<AuditEntry | null> {
		await this.flush();
		const allEntries = await this.readAllEntries();
		return allEntries.find((e) => e.id === id) ?? null;
	}

	// -----------------------------------------------------------------------
	// Convenience Queries
	// -----------------------------------------------------------------------

	async findByActor(actor: string, limit?: number): Promise<AuditEntry[]> {
		return this.query({ actor, limit });
	}

	async findByAction(action: string, limit?: number): Promise<AuditEntry[]> {
		return this.query({ action, limit });
	}

	async findByDateRange(start: string, end: string): Promise<AuditEntry[]> {
		return this.query({ startDate: start, endDate: end });
	}

	async findByProposal(proposalId: string): Promise<AuditEntry[]> {
		return this.query({ proposalId });
	}

	async findByPlanExec(planExecId: string): Promise<AuditEntry[]> {
		return this.query({ planExecId });
	}

	async recentDecisions(count: number = 10): Promise<AuditEntry[]> {
		return this.query({ limit: count });
	}

	async findBlockedActions(limit?: number): Promise<AuditEntry[]> {
		return this.query({ result: "blocked", limit });
	}

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	/**
	 * Compute statistics from all ledger entries.
	 *
	 * @returns AuditStats object
	 */
	async getStats(): Promise<AuditStats> {
		await this.flush();
		const allEntries = await this.readAllEntries();

		const byDecision: Record<string, number> = {};
		const byActor: Record<string, number> = {};
		const byResult: Record<string, number> = {};
		const byDate: Record<string, number> = {};

		let firstTimestamp = allEntries.length > 0 ? allEntries[0].timestamp : "";
		let lastTimestamp = allEntries.length > 0 ? allEntries[allEntries.length - 1].timestamp : "";

		for (const entry of allEntries) {
			byDecision[entry.decision] = (byDecision[entry.decision] ?? 0) + 1;
			byActor[entry.actor] = (byActor[entry.actor] ?? 0) + 1;
			byResult[entry.result] = (byResult[entry.result] ?? 0) + 1;

			const dateKey = entry.timestamp.slice(0, 10); // YYYY-MM-DD
			byDate[dateKey] = (byDate[dateKey] ?? 0) + 1;

			if (entry.timestamp < firstTimestamp) firstTimestamp = entry.timestamp;
			if (entry.timestamp > lastTimestamp) lastTimestamp = entry.timestamp;
		}

		// Compute file size and count
		let fileSize = 0;
		let fileCount = 0;
		try {
			const filePaths = await this.collectNdjsonFiles();
			fileCount = filePaths.length;
			for (const fp of filePaths) {
				try {
					const st = await stat(fp);
					fileSize += st.size;
				} catch {
					// skip files that disappear
				}
			}
		} catch {
			// base path may not exist
		}

		return {
			totalEntries: allEntries.length,
			byDecision: byDecision as Record<PolicyDecision, number>,
			byActor,
			byResult,
			byDate,
			dateRange: {
				first: firstTimestamp,
				last: lastTimestamp,
			},
			fileSize,
			fileCount,
		};
	}

	// -----------------------------------------------------------------------
	// Flush
	// -----------------------------------------------------------------------

	/**
	 * Flush buffered entries to disk immediately.
	 */
	async flush(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (this.buffer.length > 0) {
			await this.flushBuffer();
		}
	}

	// -----------------------------------------------------------------------
	// Internal: Flush
	// -----------------------------------------------------------------------

	private scheduleFlush(): void {
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(async () => {
			this.flushTimer = null;
			if (this.buffer.length > 0) {
				await this.flushBuffer();
			}
		}, this.flushIntervalMs);
	}

	private async flushBuffer(): Promise<void> {
		if (this.buffer.length === 0) return;

		const entries = this.buffer.splice(0);
		const serialised = `${entries.map((e) => this.serializeEntry(e)).join("\n")}\n`;

		try {
			const filePath = await this.ensureCurrentFilePath();

			// Check rotation before writing
			await this.rotateIfNeeded();

			// Append write — atomic at the file system level for single-line writes
			await appendFile(filePath, serialised, "utf-8");
		} catch (err) {
			// Put entries back into buffer on failure
			this.buffer.unshift(...entries);
			this.logError(`Failed to flush audit entries: ${err}`);
		}
	}

	// -----------------------------------------------------------------------
	// Internal: File Management
	// -----------------------------------------------------------------------

	private async ensureCurrentFilePath(): Promise<string> {
		const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
		if (this.writeStreamInitialised && today === this.currentDate && this.currentFilePath) {
			return this.currentFilePath;
		}

		this.currentDate = today;
		this.currentFilePath = this.computeDailyFilePath(today);
		this.writeStreamInitialised = true;

		// Ensure directory exists
		await mkdir(join(this.basePath, today.slice(0, 4), today.slice(5, 7)), { recursive: true });

		return this.currentFilePath;
	}

	private computeDailyFilePath(dateStr: string): string {
		// dateStr is YYYY-MM-DD
		const [year, month, day] = dateStr.split("-");
		return join(this.basePath, year, month, `${day}.ndjson`);
	}

	private async collectNdjsonFiles(): Promise<string[]> {
		if (!existsSync(this.basePath)) return [];

		const files: string[] = [];
		const { readdir } = await import("fs/promises");

		async function walk(dir: string): Promise<void> {
			try {
				const entries = await readdir(dir, { withFileTypes: true });
				for (const entry of entries) {
					const fullPath = join(dir, entry.name);
					if (entry.isDirectory()) {
						await walk(fullPath);
					} else if (entry.name.endsWith(".ndjson")) {
						files.push(fullPath);
					}
				}
			} catch {
				// skip inaccessible directories
			}
		}

		await walk(this.basePath);
		return files.sort();
	}

	private async readAllEntries(): Promise<AuditEntry[]> {
		const files = await this.collectNdjsonFiles();
		const entries: AuditEntry[] = [];

		for (const filePath of files) {
			try {
				const content = await readFile(filePath, "utf-8");
				const lines = content.split("\n").filter((l) => l.trim().length > 0);

				for (const line of lines) {
					const parsed = this.parseEntry(line);
					if (parsed) {
						entries.push(parsed);
					}
				}
			} catch {
				// skip unreadable files
				this.logError(`Failed to read audit file: ${filePath}`);
			}
		}

		return entries;
	}

	// -----------------------------------------------------------------------
	// Internal: Rotation
	// -----------------------------------------------------------------------

	private async needsRotation(): Promise<boolean> {
		try {
			const st = await stat(this.currentFilePath);
			return st.size >= this.rotationThresholdBytes;
		} catch {
			return false;
		}
	}

	private async rotateIfNeeded(): Promise<void> {
		if (!(await this.needsRotation())) return;

		const filePath = this.currentFilePath;
		let rotationIndex = 1;

		// Find the next available rotation index
		while (existsSync(this.rotatedFileName(filePath, rotationIndex))) {
			rotationIndex++;
		}

		const rotatedPath = this.rotatedFileName(filePath, rotationIndex);
		await rename(filePath, rotatedPath);

		// Create a fresh empty file for new entries
		await writeFile(filePath, "", "utf-8");
	}

	private rotatedFileName(originalPath: string, index: number): string {
		const ext = ".ndjson";
		const base = originalPath.endsWith(ext) ? originalPath.slice(0, -ext.length) : originalPath;
		return `${base}.rotated.${index}${ext}`;
	}

	// -----------------------------------------------------------------------
	// Internal: ID Generation
	// -----------------------------------------------------------------------

	private idCounter = 0;

	/**
	 * Generate a simple unique ID.
	 * Uses timestamp + counter for monotonic ordering.
	 */
	private generateId(): string {
		this.idCounter++;
		const now = Date.now().toString(36);
		const counter = this.idCounter.toString(36).padStart(6, "0");
		const rand = Math.random().toString(36).slice(2, 6);
		return `aud-${now}-${counter}-${rand}`;
	}

	// -----------------------------------------------------------------------
	// Internal: Serialisation / Parsing
	// -----------------------------------------------------------------------

	private serializeEntry(entry: AuditEntry): string {
		return JSON.stringify(entry);
	}

	private parseEntry(line: string): AuditEntry | null {
		try {
			const parsed = JSON.parse(line);

			// Basic validation
			if (!parsed.id || !parsed.timestamp || !parsed.actor || !parsed.action || !parsed.decision) {
				this.logError(`Skipping malformed audit entry: missing required fields`);
				return null;
			}

			return parsed as AuditEntry;
		} catch (err) {
			this.logError(`Skipping unparseable audit line: ${err}`);
			return null;
		}
	}

	// -----------------------------------------------------------------------
	// Internal: Error Logging
	// -----------------------------------------------------------------------

	/**
	 * Log an audit-related error. Throttled to avoid infinite loops.
	 */
	private logError(message: string): void {
		if (this.errorsLogged > 100) return;
		this.errorsLogged++;
		console.error(`[AuditLedger] ${message}`);
	}

	/**
	 * Reset the error counter (for testing).
	 */
	resetErrorCounter(): void {
		this.errorsLogged = 0;
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAuditLedger(options?: {
	basePath?: string;
	rotationThresholdBytes?: number;
	flushIntervalMs?: number;
	batchSize?: number;
}): AuditLedger {
	return new AuditLedger(options);
}
