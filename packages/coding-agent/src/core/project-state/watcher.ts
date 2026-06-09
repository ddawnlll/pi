/**
 * ProjectStateWatcher — PSS-MEGA-02
 *
 * Filesystem watcher for detecting external changes.
 * Uses Node.js fs.watch API (no chokidar dependency).
 *
 * Advisory only — never validates cache directly.
 * Events must go through reconcile or dirty marking.
 */

import { type FSWatcher, watch } from "node:fs";
import { resolve } from "node:path";
import type { FsChangeFlushReason, ProjectStateFsChange } from "./event-types.js";
import { HARD_EXCLUDED_DIRS } from "./paths.js";

/** Debounce interval for batching rapid changes (ms) */
const DEFAULT_DEBOUNCE_MS = 300;

/** Max events before forced flush */
const MAX_BUFFERED_EVENTS = 500;

/** Watcher unavailable message */
const WATCHER_UNAVAILABLE_WARNING =
	"Filesystem watcher unavailable. External changes will only be detected at read time or on next snapshot.";

export type FsWatcherEvent = { type: "change"; path: string } | { type: "rename"; path: string };

export interface ProjectStateWatcherOptions {
	debounceMs?: number;
	/** Directories to exclude (name-only match for now) */
	excludedDirs?: Set<string>;
}

/**
 * Filesystem watcher adapter.
 */
export class ProjectStateWatcher {
	private rootDir: string;
	private watcher: FSWatcher | null;
	private buffer: ProjectStateFsChange[];
	private debounceTimer: ReturnType<typeof setTimeout> | null;
	private debounceMs: number;
	private excludedDirs: Set<string>;
	private _isRunning: boolean;
	private flushResolver: (() => void) | null;
	private error: string | null;

	constructor(rootDir: string, options?: ProjectStateWatcherOptions) {
		this.rootDir = resolve(rootDir);
		this.watcher = null;
		this.buffer = [];
		this.debounceTimer = null;
		this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		this.excludedDirs = options?.excludedDirs ?? new Set(HARD_EXCLUDED_DIRS);
		this._isRunning = false;
		this.flushResolver = null;
		this.error = null;
	}

	/**
	 * Start watching the directory tree.
	 * Uses fs.watch on the root directory (recursive if supported).
	 */
	async start(): Promise<void> {
		if (this._isRunning) return;

		try {
			// Check if recursive watch is supported
			let recursive = false;
			try {
				const testWatcher = watch(this.rootDir, { recursive: true });
				testWatcher.close();
				recursive = true;
			} catch {
				recursive = false;
			}

			this.watcher = watch(this.rootDir, { recursive }, (eventType: string, filename: string | null) => {
				if (!filename) return;

				// Normalize path and check exclusions
				const normalizedPath = filename.replace(/\\/g, "/");
				if (this.isExcluded(normalizedPath)) return;

				const relPath = normalizedPath;
				const change: ProjectStateFsChange =
					eventType === "rename"
						? { type: "fs_unknown_change", path: relPath }
						: { type: "fs_file_changed", path: relPath };

				this.buffer.push(change);

				// Debounce or flush on overflow
				if (this.buffer.length >= MAX_BUFFERED_EVENTS) {
					this.flushNow();
				} else {
					this.scheduleFlush();
				}
			});

			this.watcher.on("error", (err) => {
				this.error = `Watcher error: ${(err as Error).message}`;
				this.stop();
			});

			this._isRunning = true;
			this.error = null;
		} catch (_err) {
			this._isRunning = false;
			this.error = WATCHER_UNAVAILABLE_WARNING;
		}
	}

	/**
	 * Stop watching.
	 */
	async stop(): Promise<void> {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (this.watcher) {
			try {
				this.watcher.close();
			} catch {
				// best-effort
			}
			this.watcher = null;
		}
		this._isRunning = false;
	}

	/**
	 * Pause watching (flushes pending events).
	 */
	pause(): void {
		this.flushNow();
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	/**
	 * Resume watching.
	 */
	resume(): void {
		if (!this._isRunning) {
			this.start();
		}
	}

	/**
	 * Flush pending events and return them as a batch.
	 */
	async flush(_reason: FsChangeFlushReason): Promise<{ changes: ProjectStateFsChange[]; batchId: string }> {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		const changes = [...this.buffer];
		this.buffer = [];

		if (this.flushResolver) {
			this.flushResolver();
			this.flushResolver = null;
		}

		return {
			changes,
			batchId: `fs-batch-${Date.now()}`,
		};
	}

	/**
	 * Check if the watcher is running.
	 */
	isRunning(): boolean {
		return this._isRunning;
	}

	/**
	 * Get the current error message, if any.
	 */
	getError(): string | null {
		return this.error;
	}

	/**
	 * Get watcher status string.
	 */
	getStatus(): "running" | "stopped" | "unavailable" {
		if (this.error) return "unavailable";
		if (this._isRunning) return "running";
		return "stopped";
	}

	// ============================================================================
	// Internal
	// ============================================================================

	private isExcluded(relPath: string): boolean {
		const parts = relPath.split("/");
		for (const part of parts) {
			if (this.excludedDirs.has(part)) return true;
		}
		// Also check the full relative path for nested exclusions
		if (this.excludedDirs.has(relPath)) return true;
		return false;
	}

	private scheduleFlush(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.flushNow();
		}, this.debounceMs);
	}

	private flushNow(): void {
		if (this.flushResolver) {
			this.flushResolver();
			this.flushResolver = null;
		}
	}
}
