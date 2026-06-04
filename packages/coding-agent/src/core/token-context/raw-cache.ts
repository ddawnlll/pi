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
	/**
	 * Map insertion order doubles as LRU order.
	 * delete(id) + set(id, handle) promotes to most-recent in O(1).
	 */
	private entries = new Map<string, RawCacheHandle>();
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
	 * Eviction uses Map insertion order (oldest-first) for O(1) LRU.
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

		// Evict if needed — iterate Map in insertion order (oldest first), O(1) per eviction
		let safetyGuard = 0;
		while (this.totalBytes + sizeBytes > this.maxBytes && this.entries.size > 0) {
			const firstEntry = this.entries.entries().next();
			if (firstEntry.done) break;
			const [evictId, evictHandle] = firstEntry.value;
			this.onEviction?.(evictHandle);
			this.entries.delete(evictId);
			this.totalBytes -= evictHandle.sizeBytes;
			this.evictionCount++;
			if (++safetyGuard > 100000) break; // Safety: prevent infinite loop
		}

		// Still can't fit? Store anyway but warn
		if (this.totalBytes + sizeBytes > this.maxBytes) {
			if (!this.fullWarningEmitted) {
				this.fullWarningEmitted = true;
				this.onFull?.(this.getStats());
			}
		}

		this.entries.set(id, handle);
		this.totalBytes += sizeBytes;

		return handle;
	}

	/**
	 * Look up raw content by handle ID.
	 * O(1) — delete+set promotes to most-recent in Map insertion order.
	 */
	lookup(id: string): RawCacheHandle | undefined {
		const handle = this.entries.get(id);
		if (handle) {
			this.hitCount++;
			// Promote to MRU: delete+re-insert moves to end of insertion order
			this.entries.delete(id);
			this.entries.set(id, handle);
		} else {
			this.missCount++;
		}
		return handle;
	}

	/**
	 * Look up raw content by file path (most recent).
	 */
	lookupByPath(filePath: string): RawCacheHandle | undefined {
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
			// Promote to MRU
			this.entries.delete(best.id);
			this.entries.set(best.id, best);
		} else {
			this.missCount++;
		}
		return best;
	}

	/**
	 * Evict a specific entry (O(1)).
	 */
	evict(id: string): boolean {
		const handle = this.entries.get(id);
		if (!handle) return false;
		this.onEviction?.(handle);
		this.entries.delete(id);
		this.totalBytes -= handle.sizeBytes;
		this.evictionCount++;
		return true;
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
		this.totalBytes = 0;
		this.hitCount = 0;
		this.missCount = 0;
		this.fullWarningEmitted = false;
	}

	/**
	 * Check if an entry exists (O(1)).
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
}
