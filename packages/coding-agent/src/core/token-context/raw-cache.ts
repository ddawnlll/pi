/**
 * P43 Raw Cache - W006
 *
 * Stores raw content snapshots for fallback.
 * LRU eviction with maxBytes config.
 * Cache full warning. No silent eviction without ledger event.
 */

import { createHash, randomUUID } from "node:crypto";
import type { RawCacheHandle, RawCacheStats } from "./types.js";

export interface RawCacheOptions {
	maxBytes: number;
	onEviction?: (handle: RawCacheHandle) => void;
	onFull?: (stats: RawCacheStats) => void;
}

export class RawCache {
	private entries = new Map<string, RawCacheHandle>();
	private lruOrder: string[] = [];
	private totalBytes = 0;
	private maxBytes: number;
	private evictionCount = 0;
	private hitCount = 0;
	private missCount = 0;
	private onEviction?: (handle: RawCacheHandle) => void;
	private onFull?: (stats: RawCacheStats) => void;
	private fullWarningEmitted = false;

	constructor(options: RawCacheOptions) {
		this.maxBytes = options.maxBytes;
		this.onEviction = options.onEviction;
		this.onFull = options.onFull;
	}

	/**
	 * Store raw content and return a handle.
	 */
	store(filePath: string, content: string): RawCacheHandle {
		const sizeBytes = Buffer.byteLength(content, "utf-8");
		const id = this.generateId();
		const handle: RawCacheHandle = {
			id,
			filePath,
			content,
			sizeBytes,
			timestamp: Date.now(),
			contentHash: this.hashContent(content),
		};

		// Evict if needed
		while (this.totalBytes + sizeBytes > this.maxBytes && this.lruOrder.length > 0) {
			const oldestId = this.lruOrder[0];
			this.evictEntry(oldestId);
		}

		// Still can't fit? Evict more aggressively.
		if (this.totalBytes + sizeBytes > this.maxBytes) {
			// Store anyway but warn
			if (!this.fullWarningEmitted) {
				this.fullWarningEmitted = true;
				this.onFull?.(this.getStats());
			}
		}

		this.entries.set(id, handle);
		this.lruOrder.push(id);
		this.totalBytes += sizeBytes;

		return handle;
	}

	/**
	 * Look up raw content by handle ID.
	 */
	lookup(id: string): RawCacheHandle | undefined {
		const handle = this.entries.get(id);
		if (handle) {
			this.hitCount++;
			this.touch(id);
		} else {
			this.missCount++;
		}
		return handle;
	}

	/**
	 * Look up raw content by file path (most recent).
	 */
	lookupByPath(filePath: string): RawCacheHandle | undefined {
		// Find most recent entry for this path
		let best: RawCacheHandle | undefined;
		for (const handle of this.entries.values()) {
			if (handle.filePath === filePath) {
				if (!best || handle.timestamp > best.timestamp) {
					best = handle;
				}
			}
		}
		if (best) {
			this.hitCount++;
			this.touch(best.id);
		} else {
			this.missCount++;
		}
		return best;
	}

	/**
	 * Evict a specific entry.
	 */
	evict(id: string): boolean {
		return this.evictEntry(id);
	}

	/**
	 * Get cache statistics.
	 */
	getStats(): RawCacheStats {
		return {
			totalBytes: this.totalBytes,
			maxBytes: this.maxBytes,
			entryCount: this.entries.size,
			evictionCount: this.evictionCount,
			hitCount: this.hitCount,
			missCount: this.missCount,
		};
	}

	/**
	 * Clear all entries.
	 */
	clear(): void {
		this.entries.clear();
		this.lruOrder = [];
		this.totalBytes = 0;
		this.hitCount = 0;
		this.missCount = 0;
		this.fullWarningEmitted = false;
	}

	/**
	 * Check if an entry exists.
	 */
	has(id: string): boolean {
		return this.entries.has(id);
	}

	private generateId(): string {
		return `raw_${randomUUID().slice(0, 8)}`;
	}

	private hashContent(content: string): string {
		return createHash("sha256").update(content, "utf-8").digest("hex");
	}

	private touch(id: string): void {
		const idx = this.lruOrder.indexOf(id);
		if (idx !== -1) {
			this.lruOrder.splice(idx, 1);
			this.lruOrder.push(id);
		}
	}

	private evictEntry(id: string): boolean {
		const handle = this.entries.get(id);
		if (!handle) return false;

		// Fire eviction callback before removing
		this.onEviction?.(handle);

		this.entries.delete(id);
		const idx = this.lruOrder.indexOf(id);
		if (idx !== -1) {
			this.lruOrder.splice(idx, 1);
		}
		this.totalBytes -= handle.sizeBytes;
		this.evictionCount++;
		return true;
	}
}
