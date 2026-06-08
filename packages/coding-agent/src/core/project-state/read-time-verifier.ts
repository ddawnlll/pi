/**
 * ReadTimeVerifier
 *
 * Verifies Smart Read cache validity at read time by comparing file metadata
 * and content hashes against the snapshot state.
 *
 * Prevents serving stale Smart Read cache when files have changed externally.
 */

import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { SmartReadDiskCache } from "../token-context/smart-read-disk-cache.js";
import { isSmartReadEligible } from "./classify-file.js";
import { hashContent } from "./hash.js";
import type { ProjectStateStore } from "./store.js";
import type { ProjectFileEntry, ProjectFilesState, SnapshotValidity } from "./types.js";

/**
 * Result of read-time verification.
 */
export interface VerificationResult {
	/**
	 * Whether the Smart Read cache can be used for this file.
	 */
	canUseCache: boolean;
	/**
	 * Updated file entry with refreshed metadata (if changed).
	 */
	entry?: ProjectFileEntry;
	/**
	 * Reason for cache invalidation.
	 */
	reason?: string;
	/**
	 * Whether the file content is confirmed unchanged (hash match).
	 */
	contentUnchanged: boolean;
}

/**
 * ReadTimeVerifier
 *
 * Verifies Smart Read cache at read time.
 * Checks mtime/size first, then content hash if mismatch found.
 */
export class ReadTimeVerifier {
	private store: ProjectStateStore;
	private diskCache: SmartReadDiskCache;

	constructor(store: ProjectStateStore, diskCache?: SmartReadDiskCache) {
		this.store = store;
		this.diskCache = diskCache ?? new SmartReadDiskCache();
	}

	/**
	 * Set a different store (for different root dirs).
	 */
	setStore(store: ProjectStateStore): void {
		this.store = store;
	}

	/**
	 * Verify a file's cache entry at read time.
	 *
	 * @param relPath - repo-relative file path
	 * @returns VerificationResult
	 */
	verify(relPath: string): VerificationResult {
		const rootDir = this.store.getRootDir();
		const absPath = join(resolve(rootDir), relPath);
		const ext = extname(relPath).toLowerCase();

		// If file extension is not Smart Read eligible, no cache to verify
		if (!isSmartReadEligible(ext)) {
			return { canUseCache: false, contentUnchanged: false, reason: "Extension not eligible for Smart Read" };
		}

		// Stat the current file
		let currentStat: ReturnType<typeof statSync>;
		try {
			currentStat = statSync(absPath);
		} catch {
			return { canUseCache: false, contentUnchanged: false, reason: "File not found or inaccessible" };
		}

		// Load the file entry from snapshot state
		const filesState = this.store.loadFilesState();
		if (!filesState) {
			return { canUseCache: false, contentUnchanged: false, reason: "No snapshot files state available" };
		}

		const manifest = this.store.loadManifest();
		if (!manifest) {
			return { canUseCache: false, contentUnchanged: false, reason: "No snapshot manifest available" };
		}

		const fileEntry = filesState.files[relPath];
		if (!fileEntry) {
			return { canUseCache: false, contentUnchanged: false, reason: "File not in snapshot" };
		}

		// Step 1: Check mtime + size (fast path)
		const mtimeMatch = Math.abs(currentStat.mtimeMs - fileEntry.mtimeMs) < 100; // 100ms tolerance for filesystem precision
		const sizeMatch = currentStat.size === fileEntry.sizeBytes;

		if (mtimeMatch && sizeMatch) {
			// Fast path: file is unchanged
			return { canUseCache: true, entry: fileEntry, contentUnchanged: true };
		}

		// Step 2: Hash comparison (slower but authoritative)
		try {
			const content = readFileSync(absPath, "utf-8");
			const currentHash = hashContent(content);

			const snapshotHash = fileEntry.contentHash;
			if (snapshotHash && currentHash === snapshotHash) {
				// Content is unchanged, but metadata changed (e.g., mtime from git checkout)
				// Refresh the file entry metadata
				const updatedEntry: ProjectFileEntry = {
					...fileEntry,
					sizeBytes: currentStat.size,
					mtimeMs: currentStat.mtimeMs,
					lastVerifiedAt: new Date().toISOString(),
				};

				// Persist updated metadata
				filesState.files[relPath] = updatedEntry;
				this.store.saveFilesState(filesState);

				return { canUseCache: true, entry: updatedEntry, contentUnchanged: true };
			}

			// Content changed — invalidate cache
			this.diskCache.invalidate(absPath);
			const staleEntry: ProjectFileEntry = {
				...fileEntry,
				contentHash: currentHash,
				smartReadStatus: "stale",
				lastVerifiedAt: new Date().toISOString(),
			};
			filesState.files[relPath] = staleEntry;
			this.store.saveFilesState(filesState);

			return {
				canUseCache: false,
				entry: staleEntry,
				contentUnchanged: false,
				reason: "File content changed since snapshot",
			};
		} catch (error) {
			return {
				canUseCache: false,
				contentUnchanged: false,
				reason: `Verification error: ${(error as Error).message}`,
			};
		}
	}

	/**
	 * Quick check if a file is likely cacheable without performing full verification.
	 * Uses manifest lastAppliedSequence as a hint — if no mutations have been applied
	 * since snapshot, cache is likely still valid.
	 */
	quickCheck(relPath: string): boolean {
		const manifest = this.store.loadManifest();
		if (!manifest) return false;
		return manifest.lastAppliedSequence === 0;
	}
}

function extname(p: string): string {
	const idx = p.lastIndexOf(".");
	return idx >= 0 ? p.slice(idx).toLowerCase() : "";
}
