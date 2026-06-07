/**
 * Global Smart Read Disk Cache
 *
 * Persists smart read outline results to disk so they survive process restarts
 * and are shared across sessions. Uses file content hash as the lookup key.
 *
 * Cache structure (per project root):
 *   .pi/smart-read-cache/<content-hash>.json
 *
 * Each cache entry:
 *   {
 *     fileHash: string;        // SHA-256 of file content
 *     filePath: string;        // Absolute path (for diagnostics)
 *     outline: string;         // The smart read outline content
 *     mode: SmartReadMode;
 *     adapterName: string;
 *     adapterConfidence: number;
 *     parseSource: SmartReadParseSource;
 *     fileSize: number;
 *     mtimeMs: number;         // File mtime at cache time
 *     cachedAt: number;        // When cached
 *   }
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { SmartReadMode, SmartReadParseSource, SmartReadResult } from "./types.js";

export interface SmartReadCacheEntry {
	/** SHA-256 of file content */
	fileHash: string;
	/** Absolute file path (for diagnostics / invalidation) */
	filePath: string;
	/** Cached smart read outline */
	outline: string;
	/** Mode used */
	mode: SmartReadMode;
	/** Adapter name */
	adapterName: string;
	/** Adapter confidence */
	adapterConfidence: number;
	/** Parse source */
	parseSource?: SmartReadParseSource;
	/** File size when cached */
	fileSize: number;
	/** File mtime when cached */
	mtimeMs: number;
	/** When the cache entry was created */
	cachedAt: number;
	/** Unique entry ID */
	id: string;
}

export interface SmartReadDiskCacheOptions {
	/** Project root directory. Cache stored at <root>/.pi/smart-read-cache/ */
	projectRoot?: string;
	/** Custom cache directory (overrides projectRoot) */
	cacheDir?: string;
}

export class SmartReadDiskCache {
	private entries = new Map<string, SmartReadCacheEntry>();
	/** Cache directory path (public for snapshot service) */
	cacheDir: string;

	constructor(options: SmartReadDiskCacheOptions = {}) {
		if (options.cacheDir) {
			this.cacheDir = options.cacheDir;
		} else if (options.projectRoot) {
			this.cacheDir = join(options.projectRoot, ".pi", "smart-read-cache");
		} else {
			// No project root: use ~/.pi/smart-read-cache/
			const home = process.env.HOME || process.env.USERPROFILE || ".";
			this.cacheDir = join(home, ".pi", "smart-read-cache");
		}

		// Ensure cache directory exists
		if (!existsSync(this.cacheDir)) {
			try {
				mkdirSync(this.cacheDir, { recursive: true });
			} catch {
				// Fail silently — cache is best-effort
			}
		}

		this.loadAllEntries();
	}

	/**
	 * Check if a cache entry exists and is valid for the given content.
	 */
	has(filePath: string, content: string): boolean {
		const hash = this.hashContent(content);
		const entry = this.entries.get(hash) ?? this.loadEntry(hash);
		if (!entry) return false;
		if (!this.isFileUnchanged(filePath, entry)) {
			this.entries.delete(hash);
			this.deleteCacheFile(hash);
			return false;
		}
		return true;
	}

	/**
	 * Get a cached outline for a file. Returns undefined if:
	 * - No cache entry exists for this file hash
	 * - The file has been modified since cache (hash mismatch)
	 * - The file's mtime has changed (external modification)
	 */
	get(filePath: string, content: string): SmartReadCacheEntry | undefined {
		const hash = this.hashContent(content);

		// Check in-memory cache first
		const memEntry = this.entries.get(hash);
		if (memEntry) {
			// Verify file hasn't been modified externally
			if (this.isFileUnchanged(filePath, memEntry)) {
				return memEntry;
			}
			// File changed, remove stale entry
			this.entries.delete(hash);
			this.deleteCacheFile(hash);
			return undefined;
		}

		// Check disk cache
		const diskEntry = this.loadEntry(hash);
		if (diskEntry) {
			// Verify file hasn't been modified externally
			if (this.isFileUnchanged(filePath, diskEntry)) {
				this.entries.set(hash, diskEntry);
				return diskEntry;
			}
			// File changed, remove stale entry
			this.deleteCacheFile(hash);
			return undefined;
		}

		return undefined;
	}

	/**
	 * Set a cache entry for a file.
	 */
	set(filePath: string, content: string, result: SmartReadResult): SmartReadCacheEntry {
		const hash = this.hashContent(content);
		let fileSize = 0;
		let mtimeMs = 0;
		try {
			const stat = statSync(filePath);
			fileSize = stat.size;
			mtimeMs = stat.mtimeMs;
		} catch {
			fileSize = Buffer.byteLength(content, "utf-8");
			mtimeMs = Date.now();
		}

		const entry: SmartReadCacheEntry = {
			id: randomUUID().slice(0, 12),
			fileHash: hash,
			filePath,
			outline: result.content,
			mode: result.mode,
			adapterName: result.adapterName,
			adapterConfidence: result.adapterConfidence,
			parseSource: result.parseSource,
			fileSize,
			mtimeMs,
			cachedAt: Date.now(),
		};

		// Store in memory
		this.entries.set(hash, entry);

		// Persist to disk
		this.persistEntry(hash, entry);

		return entry;
	}

	/**
	 * Invalidate a cache entry for a specific file path.
	 */
	invalidate(filePath: string): void {
		// Find by filePath in entries and remove
		for (const [hash, entry] of this.entries) {
			if (entry.filePath === filePath) {
				this.entries.delete(hash);
				this.deleteCacheFile(hash);
			}
		}
	}

	/**
	 * Clear all cache entries.
	 */
	clear(): void {
		this.entries.clear();
		try {
			const files = readdirSafe(this.cacheDir);
			for (const f of files) {
				if (f.endsWith(".json")) {
					try {
						const fp = join(this.cacheDir, f);
						rmSync(fp);
					} catch {
						// best-effort
					}
				}
			}
		} catch {
			// best-effort
		}
	}

	/**
	 * Get cache statistics.
	 */
	getStats(): { entryCount: number; cacheDir: string; diskFilesExist: boolean } {
		let diskFilesExist = false;
		try {
			const files = readdirSafe(this.cacheDir);
			diskFilesExist = files.some((f) => f.endsWith(".json"));
		} catch {
			// No directory
		}
		return {
			entryCount: this.entries.size,
			cacheDir: this.cacheDir,
			diskFilesExist,
		};
	}

	// ============================================================================
	// Internal helpers
	// ============================================================================

	private hashContent(content: string): string {
		return createHash("sha256").update(content, "utf-8").digest("hex");
	}

	private cacheFilePath(hash: string): string {
		return join(this.cacheDir, `${hash}.json`);
	}

	private isFileUnchanged(filePath: string, entry: SmartReadCacheEntry): boolean {
		try {
			const stat = statSync(filePath);
			// Same mtime and size = unchanged
			if (stat.mtimeMs !== entry.mtimeMs || stat.size !== entry.fileSize) {
				return false;
			}
			return true;
		} catch {
			// File may have been deleted
			return false;
		}
	}

	private loadAllEntries(): void {
		try {
			const files = readdirSafe(this.cacheDir);
			for (const f of files) {
				if (!f.endsWith(".json")) continue;
				const hash = basename(f, ".json");
				try {
					const data = readFileSync(join(this.cacheDir, f), "utf-8");
					const entry = JSON.parse(data) as SmartReadCacheEntry;
					this.entries.set(hash, entry);
				} catch {
					// Corrupt entry, skip
				}
			}
		} catch {
			// No directory yet
		}
	}

	private loadEntry(hash: string): SmartReadCacheEntry | undefined {
		try {
			const fp = this.cacheFilePath(hash);
			if (!existsSync(fp)) return undefined;
			const data = readFileSync(fp, "utf-8");
			return JSON.parse(data) as SmartReadCacheEntry;
		} catch {
			return undefined;
		}
	}

	private persistEntry(hash: string, entry: SmartReadCacheEntry): void {
		try {
			if (!existsSync(this.cacheDir)) {
				mkdirSync(this.cacheDir, { recursive: true });
			}
			writeFileSync(this.cacheFilePath(hash), JSON.stringify(entry, null, 2), "utf-8");
		} catch {
			// Best-effort cache
		}
	}

	private deleteCacheFile(hash: string): void {
		try {
			const fp = this.cacheFilePath(hash);
			if (existsSync(fp)) {
				rmSync(fp);
			}
		} catch {
			// Best-effort
		}
	}
}

/**
 * Safe readdir — returns empty array on error.
 */
function readdirSafe(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}
