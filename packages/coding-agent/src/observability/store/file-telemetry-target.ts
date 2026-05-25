/**
 * File-based telemetry flush target (25.B).
 *
 * Provides local persistence for telemetry events by flushing to a JSON file.
 * This enables telemetry data to survive process restarts without requiring
 * a PostgreSQL database.
 *
 * The file store is append-friendly: new events are prepended to the array
 * in the file on each flush. On read, the file is loaded and parsed.
 *
 * @module observability/store/file-telemetry-target
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ObservabilityEvent } from "../types.js";
import type { TelemetryFlushTarget } from "../telemetry-store.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Configuration for the file-based telemetry target.
 */
export interface FileTelemetryTargetConfig {
	/** Path to the telemetry data file (default: ~/.pi/telemetry/events.json) */
	filePath: string;
	/** Maximum file size in bytes before rotation (default: 50 MB) */
	maxFileSizeBytes: number;
	/** Maximum number of backup files to keep (default: 2) */
	maxBackups: number;
	/** Whether to gzip compress the file (default: false) */
	compress: boolean;
}

/**
 * Default configuration for the file-based telemetry target.
 */
export const DEFAULT_FILE_TELEMETRY_TARGET_CONFIG: FileTelemetryTargetConfig = {
	filePath: "",
	maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB
	maxBackups: 2,
	compress: false,
};

// ─────────────────────────────────────────────────────────────────────
// FileTelemetryFlushTarget
// ─────────────────────────────────────────────────────────────────────

/**
 * File-based flush target for telemetry events.
 *
 * Persists events to a JSON file, one array per file. Supports file rotation
 * when the file exceeds the configured maximum size.
 */
export class FileTelemetryFlushTarget implements TelemetryFlushTarget {
	private config: FileTelemetryTargetConfig;
	private flushWriteCount = 0;
	private flushReadCount = 0;
	private loadErrorCount = 0;

	constructor(config?: Partial<FileTelemetryTargetConfig>) {
		this.config = {
			...DEFAULT_FILE_TELEMETRY_TARGET_CONFIG,
			...config,
		};
		if (!this.config.filePath) {
			const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
			this.config.filePath = resolve(homeDir, ".pi", "telemetry", "events.json");
		}
		// Ensure parent directory exists
		const dir = dirname(this.config.filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): FileTelemetryTargetConfig {
		return { ...this.config };
	}

	/**
	 * Update configuration at runtime.
	 */
	updateConfig(config: Partial<FileTelemetryTargetConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Flush events to the file.
	 *
	 * Appends the batch of events to the existing file's JSON array.
	 * If the file exceeds maxFileSizeBytes, it is rotated.
	 *
	 * @param events - Events to persist
	 * @returns Number of successfully persisted events
	 */
	async flush(events: ObservabilityEvent[]): Promise<number> {
		if (events.length === 0) return 0;

		try {
			// Load existing events
			let existing: ObservabilityEvent[] = [];
			if (existsSync(this.config.filePath)) {
				try {
					const raw = readFileSync(this.config.filePath, "utf-8");
					existing = JSON.parse(raw) as ObservabilityEvent[];
					if (!Array.isArray(existing)) {
						existing = [];
					}
				} catch {
					// File corrupt - start fresh
					this.loadErrorCount++;
					existing = [];
				}
			}

			// Merge new events (prepend newest first)
			const merged = [...events, ...existing];
			const serialized = JSON.stringify(merged);

			// Check file size and rotate if needed
			if (serialized.length > this.config.maxFileSizeBytes) {
				this.rotateFile(merged);
			} else {
				writeFileSync(this.config.filePath, serialized, "utf-8");
			}

			this.flushWriteCount += events.length;
			return events.length;
		} catch (err) {
			throw new Error(`FileTelemetryFlushTarget flush failed: ${(err as Error).message}`);
		}
	}

	/**
	 * Load all stored events from the file.
	 *
	 * @returns Array of stored events
	 */
	load(): ObservabilityEvent[] {
		if (!existsSync(this.config.filePath)) return [];

		try {
			const raw = readFileSync(this.config.filePath, "utf-8");
			const parsed = JSON.parse(raw) as ObservabilityEvent[];
			if (!Array.isArray(parsed)) return [];
			this.flushReadCount += parsed.length;
			return parsed;
		} catch {
			this.loadErrorCount++;
			return [];
		}
	}

	/**
	 * Get diagnostics about the file target.
	 */
	getDiagnostics(): {
		filePath: string;
		exists: boolean;
		flushWrites: number;
		flushReads: number;
		loadErrors: number;
	} {
		return {
			filePath: this.config.filePath,
			exists: existsSync(this.config.filePath),
			flushWrites: this.flushWriteCount,
			flushReads: this.flushReadCount,
			loadErrors: this.loadErrorCount,
		};
	}

	/**
	 * Clear all stored events (delete the file).
	 */
	clear(): void {
		try {
			if (existsSync(this.config.filePath)) {
				unlinkSync(this.config.filePath);
			}
			// Also remove backup files
			for (let i = 1; i <= this.config.maxBackups; i++) {
				const backupPath = `${this.config.filePath}.${i}`;
				if (existsSync(backupPath)) {
					unlinkSync(backupPath);
				}
			}
		} catch {
			// Ignore cleanup errors
		}
	}

	// ── Private ──────────────────────────────────────────────────────

	/**
	 * Rotate the telemetry file when it exceeds max size.
	 *
	 * Renames current file to .1, .1 to .2, etc., then writes trimmed data.
	 */
	private rotateFile(events: ObservabilityEvent[]): void {
		// Trim events to fit within max file size by keeping only the most recent
		let trimmed = [...events];
		let serialized = JSON.stringify(trimmed);

		while (serialized.length > this.config.maxFileSizeBytes && trimmed.length > 1) {
			// Remove oldest events (last in array since newest are prepended)
			trimmed = trimmed.slice(0, Math.floor(trimmed.length / 2));
			serialized = JSON.stringify(trimmed);
		}

		// Rotate backup files
		for (let i = this.config.maxBackups - 1; i >= 0; i--) {
			const currentPath = i === 0 ? this.config.filePath : `${this.config.filePath}.${i}`;
			const nextPath = `${this.config.filePath}.${i + 1}`;
			if (existsSync(currentPath)) {
				renameSync(currentPath, nextPath);
			}
		}

		// Write trimmed data
		writeFileSync(this.config.filePath, serialized, "utf-8");
	}
}
