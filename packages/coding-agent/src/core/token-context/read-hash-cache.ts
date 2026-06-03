/**
 * P43 Read Hash Cache - W007
 *
 * Avoids re-emitting unchanged content when safe.
 * Tracks fileHash, snapshotId, dirty detection, external mutation detection.
 * Integrates with ACR for active context checks.
 */

import { createHash, randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import type { ActiveContextRegistry } from "./active-context-registry.js";
import type { RawCache } from "./raw-cache.js";
import type { ReadSnapshot } from "./types.js";

export interface ReadHashCacheOptions {
	/** Associated raw cache for storing content */
	rawCache?: RawCache;
	/** Associated ACR for context state checks */
	acr?: ActiveContextRegistry;
}

export class ReadHashCache {
	private snapshots = new Map<string, ReadSnapshot>();
	private rawCache?: RawCache;
	private acr?: ActiveContextRegistry;

	constructor(options: ReadHashCacheOptions = {}) {
		this.rawCache = options.rawCache;
		this.acr = options.acr;
	}

	/**
	 * Take a snapshot of a file at read time.
	 */
	takeSnapshot(filePath: string, content: string): ReadSnapshot {
		const stat = statSync(filePath);
		const snapshot: ReadSnapshot = {
			id: this.generateId(),
			filePath,
			contentHash: this.hashContent(content),
			fileSize: stat.size,
			mtimeMs: stat.mtimeMs,
			rawContent: content,
			timestamp: Date.now(),
		};

		// Store raw content in raw cache if available
		if (this.rawCache) {
			const handle = this.rawCache.store(filePath, content);
			snapshot.rawHandle = handle.id;
		}

		this.snapshots.set(filePath, snapshot);

		// Update ACR
		if (this.acr) {
			this.acr.markActive(filePath, snapshot.id);
		}

		return snapshot;
	}

	/**
	 * Get the latest snapshot for a file.
	 */
	getSnapshot(filePath: string): ReadSnapshot | undefined {
		return this.snapshots.get(filePath);
	}

	/**
	 * Check if a file is unchanged from the last snapshot.
	 * Also checks for external mutations.
	 */
	isUnchanged(snapshot: ReadSnapshot): boolean {
		try {
			const stat = statSync(snapshot.filePath);
			// Same mtime and size means likely unchanged
			if (stat.mtimeMs !== snapshot.mtimeMs || stat.size !== snapshot.fileSize) {
				// Mark external mutation in ACR
				if (this.acr) {
					this.acr.detectExternalMutation(snapshot.filePath, snapshot.mtimeMs, snapshot.fileSize);
				}
				return false;
			}
			return true;
		} catch {
			// File may have been deleted
			if (this.acr) {
				this.acr.markChanged(snapshot.filePath);
			}
			return false;
		}
	}

	/**
	 * Check if content is unchanged by comparing hashes.
	 */
	isContentUnchanged(filePath: string, currentContent: string): boolean {
		const snapshot = this.snapshots.get(filePath);
		if (!snapshot) return false;
		const currentHash = this.hashContent(currentContent);
		return snapshot.contentHash === currentHash;
	}

	/**
	 * Get raw content from the cache (fallback).
	 */
	getRawContent(filePath: string): string | undefined {
		const snapshot = this.snapshots.get(filePath);
		if (!snapshot) return undefined;

		// Try raw cache first
		if (snapshot.rawHandle && this.rawCache) {
			const handle = this.rawCache.lookup(snapshot.rawHandle);
			if (handle) return handle.content;
		}

		// Fall back to in-memory content
		return snapshot.rawContent;
	}

	/**
	 * Mark a snapshot as dirty (file modified by tools).
	 */
	markDirty(filePath: string): void {
		if (this.acr) {
			this.acr.markDirty(filePath);
		}
	}

	/**
	 * Invalidate a snapshot.
	 */
	invalidate(filePath: string): void {
		this.snapshots.delete(filePath);
	}

	/**
	 * Clear all snapshots.
	 */
	clear(): void {
		this.snapshots.clear();
	}

	private generateId(): string {
		return `snap_${randomUUID().slice(0, 8)}`;
	}

	private hashContent(content: string): string {
		return createHash("sha256").update(content, "utf-8").digest("hex");
	}
}
