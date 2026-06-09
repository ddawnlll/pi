/**
 * SmartReadBridge
 *
 * Integrates project state snapshots with the existing Smart Read cache.
 * Warms the Smart Read disk cache during snapshot and tracks per-file status.
 */

import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { SmartReadCore } from "../token-context/smart-read-core.js";
import { SmartReadDiskCache } from "../token-context/smart-read-disk-cache.js";
import type { SmartReadResult } from "../token-context/types.js";
import { isSmartReadEligible } from "./classify-file.js";
import { hashContent } from "./hash.js";
import { MAX_JSON_SCAN_BYTES, MAX_SMART_READ_FILE_BYTES, SMART_READ_ELIGIBLE_EXTENSIONS } from "./paths.js";
import type { ProjectFileEntry } from "./types.js";

export interface SmartReadWarmResult {
	entry: ProjectFileEntry;
	cacheKey?: string;
	status: "warm" | "skipped" | "unsupported" | "failed";
	rawBytes: number;
	compactBytes: number;
	error?: string;
}

/**
 * SmartReadBridge
 *
 * Warms Smart Read cache for eligible files during snapshot.
 * Checks existing cache before regenerating.
 */
export class SmartReadBridge {
	private diskCache: SmartReadDiskCache;
	private smartRead: SmartReadCore;
	private force: boolean;

	constructor(options?: {
		diskCache?: SmartReadDiskCache;
		smartReadCore?: SmartReadCore;
		force?: boolean;
	}) {
		this.diskCache = options?.diskCache ?? new SmartReadDiskCache();
		this.smartRead = options?.smartReadCore ?? new SmartReadCore();
		this.force = options?.force ?? false;
	}

	/**
	 * Warm Smart Read cache for a single file.
	 */
	async warmFile(
		rootDir: string,
		relPath: string,
		_contentHash: string,
		entry: ProjectFileEntry,
	): Promise<SmartReadWarmResult> {
		const ext = extname(relPath).toLowerCase();

		// Check if eligible
		if (!isSmartReadEligible(ext)) {
			return {
				entry,
				status: "unsupported",
				rawBytes: entry.sizeBytes,
				compactBytes: entry.sizeBytes,
			};
		}

		// Check file size limits
		if (entry.sizeBytes > MAX_SMART_READ_FILE_BYTES) {
			return {
				entry,
				status: "skipped",
				rawBytes: entry.sizeBytes,
				compactBytes: entry.sizeBytes,
			};
		}

		const isJson = ext === ".json" || ext === ".jsonc";
		if (isJson && entry.sizeBytes > MAX_JSON_SCAN_BYTES) {
			return {
				entry,
				status: "skipped",
				rawBytes: entry.sizeBytes,
				compactBytes: entry.sizeBytes,
			};
		}

		const absPath = join(resolve(rootDir), relPath);

		try {
			// Check existing cache
			if (!this.force) {
				// Use SmartReadDiskCache.get which verifies file unchanged
				const content = readFileSync(absPath, "utf-8");
				const cached = this.diskCache.get(absPath, content);
				if (cached) {
					return {
						entry: {
							...entry,
							smartReadCacheKey: cached.id,
							smartReadStatus: "warm",
						},
						cacheKey: cached.id,
						status: "warm",
						rawBytes: entry.sizeBytes,
						compactBytes: cached.outline.length,
					};
				}
			}

			// Generate new Smart Read outline
			const content = readFileSync(absPath, "utf-8");
			const result: SmartReadResult = await this.smartRead.smartRead(content, absPath, "outline");

			if (result.isFallback || !result.content || result.content.length >= content.length) {
				// Cannot produce a meaningful outline
				return {
					entry,
					status: "skipped",
					rawBytes: entry.sizeBytes,
					compactBytes: entry.sizeBytes,
				};
			}

			// Write to disk cache
			this.diskCache.set(absPath, content, result);

			return {
				entry: {
					...entry,
					smartReadCacheKey: hashContent(content),
					smartReadStatus: "warm",
				},
				cacheKey: hashContent(content),
				status: "warm",
				rawBytes: content.length,
				compactBytes: result.content.length,
			};
		} catch (error) {
			return {
				entry,
				status: "failed",
				rawBytes: entry.sizeBytes,
				compactBytes: entry.sizeBytes,
				error: (error as Error).message,
			};
		}
	}

	/**
	 * Check if a file's Smart Read cache is still valid.
	 * Returns the cached entry if valid, undefined if stale/missing.
	 */
	checkCache(rootDir: string, relPath: string, _entry: ProjectFileEntry): "warm" | "stale" | "missing" {
		const absPath = join(resolve(rootDir), relPath);
		const ext = extname(relPath).toLowerCase();

		if (!SMART_READ_ELIGIBLE_EXTENSIONS.has(ext)) {
			return "missing";
		}

		try {
			const content = readFileSync(absPath, "utf-8");
			const cached = this.diskCache.get(absPath, content);
			if (cached) {
				return "warm";
			}
			return "missing";
		} catch {
			return "missing";
		}
	}

	/**
	 * Set force mode for next operations.
	 */
	setForce(force: boolean): void {
		this.force = force;
	}
}
