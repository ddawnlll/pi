/**
 * Tree index builder.
 *
 * Builds a directory tree index from discovered file entries.
 * Produces deterministic (sorted) output for easy diffing.
 */

import { dirname, resolve } from "node:path";
import { hashSortedStrings } from "./hash.js";
import { SCHEMA_VERSION } from "./paths.js";
import type { DirectoryEntry, ProjectFileEntry, ProjectTreeIndex } from "./types.js";

/**
 * Build a tree index from a flat files map.
 * Paths are repo-relative POSIX strings.
 */
export function buildTreeIndex(
	rootDir: string,
	files: Record<string, ProjectFileEntry>,
	_sourceFileCount: number,
): ProjectTreeIndex {
	const dirs = new Map<string, DirectoryEntry>();

	// Collect directory entries
	for (const [relPath, entry] of Object.entries(files)) {
		const dir = dirname(relPath);
		if (dir === ".") continue; // root-level file, not a directory

		let dirEntry = dirs.get(dir);
		if (!dirEntry) {
			dirEntry = {
				path: dir,
				childDirs: [],
				files: [],
				fileCount: 0,
				sourceFileCount: 0,
				totalBytes: 0,
			};
			dirs.set(dir, dirEntry);
		}

		dirEntry.files.push(relPath);
		dirEntry.fileCount++;
		if (entry.isSource || entry.isConfig) {
			dirEntry.sourceFileCount++;
		}
		dirEntry.totalBytes += entry.sizeBytes;
	}

	// Build child directory lists
	for (const [dirPath, _entry] of dirs) {
		const parent = dirname(dirPath);
		if (parent !== ".") {
			const parentEntry = dirs.get(parent);
			if (parentEntry) {
				parentEntry.childDirs.push(dirPath);
			}
		}
	}

	// Sort all arrays for deterministic output
	const directories: Record<string, DirectoryEntry> = {};
	const sortedDirPaths = [...dirs.keys()].sort();

	for (const dirPath of sortedDirPaths) {
		const entry = dirs.get(dirPath)!;
		entry.files.sort();
		entry.childDirs.sort();
		directories[dirPath] = entry;
	}

	// Compute tree hash from all directory paths and file lists
	const hashInput: string[] = [];
	for (const [dirPath, entry] of Object.entries(directories)) {
		hashInput.push(dirPath);
		hashInput.push(...entry.files);
		hashInput.push(...entry.childDirs);
	}
	const treeHash = hashSortedStrings(hashInput);

	return {
		schemaVersion: SCHEMA_VERSION,
		rootDir: resolvePath(rootDir),
		generatedAt: new Date().toISOString(),
		treeHash,
		directories,
	};
}

function resolvePath(p: string): string {
	return resolve(p);
}
