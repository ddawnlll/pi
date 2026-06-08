/**
 * Recursive file discovery using Node.js filesystem APIs.
 *
 * No shell commands used. Excludes hard-coded directories.
 * Returns repo-relative POSIX paths.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { classifyFile } from "./classify-file.js";
import { hashContent } from "./hash.js";
import { DEFAULT_INCLUDED_EXTENSIONS, HARD_EXCLUDED_DIRS, MAX_JSON_SCAN_BYTES, SCHEMA_VERSION } from "./paths.js";
import type { ProjectFileEntry, ProjectFilesState } from "./types.js";

/**
 * Result of file discovery.
 */
export interface DiscoveryResult {
	files: Record<string, ProjectFileEntry>;
	fileCount: number;
	sourceFileCount: number;
}

/**
 * Recursively discover eligible files under rootDir.
 * Returns a map of repo-relative POSIX paths to file entries.
 */
export function discoverFiles(
	rootDir: string,
	options?: {
		extensions?: string[];
		includeMd?: boolean;
		maxFiles?: number;
	},
): DiscoveryResult {
	const files: Record<string, ProjectFileEntry> = {};
	const extSet = new Set(
		(options?.extensions ?? DEFAULT_INCLUDED_EXTENSIONS)
			.filter((e) => options?.includeMd || e !== ".md")
			.map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase()),
	);
	const maxFiles = options?.maxFiles ?? 0;
	const absRoot = resolve(rootDir);

	function walk(currentDir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(currentDir);
		} catch {
			return;
		}

		// Sort for deterministic ordering
		entries.sort();

		for (const name of entries) {
			if (Object.keys(files).length >= maxFiles && maxFiles > 0) {
				return;
			}

			// Skip hidden files/dirs (except .pi itself is allowed for config discovery)
			if (name.startsWith(".") && name !== ".") {
				// Allow .pi to be entered for project state, but skip the state dir itself
				continue;
			}

			const fullPath = join(currentDir, name);
			let stat: ReturnType<typeof statSync>;
			try {
				stat = statSync(fullPath);
			} catch {
				continue;
			}

			if (stat.isDirectory()) {
				// Check hard excludes (check against the directory name and full relative path)
				const relDir = relative(absRoot, fullPath).replace(/\\/g, "/");
				if (HARD_EXCLUDED_DIRS.has(name) || HARD_EXCLUDED_DIRS.has(relDir)) {
					continue;
				}
				walk(fullPath);
			} else if (stat.isFile()) {
				const ext = extname(name).toLowerCase();
				if (!extSet.has(ext)) continue;

				const relPath = relative(absRoot, fullPath).replace(/\\/g, "/");
				const classification = classifyFile(relPath, ext);

				// Skip large JSON files
				if ((ext === ".json" || ext === ".jsonc") && stat.size > MAX_JSON_SCAN_BYTES) {
					continue;
				}

				const entry: ProjectFileEntry = {
					path: relPath,
					ext,
					language: classification.language,
					sizeBytes: stat.size,
					mtimeMs: stat.mtimeMs,
					isSource: classification.isSource,
					isTest: classification.isTest,
					isConfig: classification.isConfig,
					isGenerated: classification.isGenerated,
					isIgnored: classification.isIgnored,
					smartReadStatus: "missing",
				};

				files[relPath] = entry;
			}
		}
	}

	walk(absRoot);

	// Count
	let sourceFileCount = 0;
	for (const entry of Object.values(files)) {
		if (entry.isSource || entry.isConfig) {
			sourceFileCount++;
		}
	}

	return { files, fileCount: Object.keys(files).length, sourceFileCount };
}

/**
 * Build ProjectFilesState from discovered files.
 * Optionally computes content hashes for eligible files.
 */
export function buildFilesState(rootDir: string, discovery: DiscoveryResult, computeHashes = false): ProjectFilesState {
	const absRoot = resolve(rootDir);
	const files: Record<string, ProjectFileEntry> = {};

	for (const [relPath, entry] of Object.entries(discovery.files)) {
		const fileEntry: ProjectFileEntry = { ...entry };

		if (computeHashes && !entry.isIgnored) {
			try {
				const fullPath = join(absRoot, relPath);
				const content = readFileSync(fullPath, "utf-8");
				fileEntry.contentHash = hashContent(content);
				fileEntry.lineCount = content.split("\n").length;
			} catch {
				// Skip hash on error
			}
		}

		files[relPath] = fileEntry;
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		rootDir: absRoot,
		generatedAt: new Date().toISOString(),
		files,
	};
}
