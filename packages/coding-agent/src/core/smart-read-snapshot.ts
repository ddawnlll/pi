/**
 * Smart Read Snapshot Service
 *
 * Recursively scans source files in a directory, generates Smart Read
 * outline cache entries in parallel, and persists them to the global
 * disk cache. Lets future Smart Read operations reuse cached outlines
 * for unchanged files without re-parsing.
 *
 * /snapshot slash command integration:
 *   /snapshot                          — scan current project dir
 *   /snapshot ./packages               — scan specific dir
 *   /snapshot --concurrency 16         — set parallel workers
 *   /snapshot --force                  — regenerate all entries
 *   /snapshot --json                   — machine-readable output
 *   /snapshot ./dir --concurrency 8 --force
 */

import { createHash, randomUUID } from "node:crypto";
import { type Dirent, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join, relative, resolve } from "node:path";
import { SmartReadCore } from "./token-context/smart-read-core.js";
import { SmartReadDiskCache } from "./token-context/smart-read-disk-cache.js";
import type { SmartReadResult } from "./token-context/types.js";

// ============================================================================
// Types
// ============================================================================

export type SnapshotProgressCallback = (progress: SmartReadSnapshotProgress) => void;

/**
 * Snapshot controller for pause/resume/cancel.
 * Pass to snapshot options to enable keyboard controls.
 */
export interface SnapshotController {
	/** Pause the snapshot */
	pause: () => void;
	/** Resume the snapshot */
	resume: () => void;
	/** Cancel the snapshot */
	cancel: () => void;
	/** Whether the snapshot is paused */
	isPaused: () => boolean;
	/** Whether the snapshot is cancelled */
	isCancelled: () => boolean;
}

export function createSnapshotController(): SnapshotController {
	let paused = false;
	let cancelled = false;
	let pauseResolve: (() => void) | null = null;

	return {
		pause() {
			paused = true;
		},
		resume() {
			paused = false;
			if (pauseResolve) {
				pauseResolve();
				pauseResolve = null;
			}
		},
		cancel() {
			cancelled = true;
			paused = false;
			if (pauseResolve) {
				pauseResolve();
				pauseResolve = null;
			}
		},
		isPaused: () => paused,
		isCancelled: () => cancelled,
	};
}

export interface SmartReadSnapshotOptions {
	/** Root directory to scan */
	rootDir: string;
	/** Number of parallel workers (default: min(16, cpuCount * 2)) */
	concurrency?: number;
	/** Force regenerate even if cache exists */
	force?: boolean;
	/** Print machine-readable JSON summary */
	json?: boolean;
	/** Dry-run mode: scan and report but do not cache */
	dryRun?: boolean;
	/** Abort signal for cancellation */
	signal?: AbortSignal;
	/** Controller for pause/resume/cancel */
	controller?: SnapshotController;
	/** File extensions to include (default: TS/TSX/JS/JSX/JSON/PY/RS) */
	extensions?: string[];
	/** Callback for progress updates */
	onProgress?: SnapshotProgressCallback;
	/** Existing SmartReadCore instance to reuse */
	smartReadCore?: SmartReadCore;
}

export interface SmartReadSnapshotProgress {
	scanned: number;
	total: number;
	cached: number;
	skipped: number;
	failed: number;
	currentFile?: string;
	/** Current action on the current file */
	currentAction?: "reading" | "parsing" | "caching" | "saving" | "paused";
	rawBytes: number;
	compactBytes: number;
	estimatedTokensSaved: number;
	percent: number;
}

export interface SmartReadSnapshotFileEntry {
	contentHash: string;
	sizeBytes: number;
	mtimeMs: number;
	cacheKey: string;
	rawBytes: number;
	compactBytes: number;
}

export interface SmartReadSnapshotManifest {
	version: 1;
	rootDir: string;
	createdAt: string;
	updatedAt: string;
	files: Record<string, SmartReadSnapshotFileEntry>;
}

export interface SmartReadSnapshotResult {
	rootDir: string;
	startedAt: string;
	completedAt: string;
	durationMs: number;
	filesScanned: number;
	filesCached: number;
	filesSkipped: number;
	filesFailed: number;
	rawBytes: number;
	compactBytes: number;
	estimatedTokensSaved: number;
	failures: Array<{ file: string; error: string }>;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".py", ".rs"]);

const EXCLUDED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"coverage",
	".next",
	".turbo",
	".venv",
	"venv",
	"target",
	".cache",
]);

/** Max file size to cache (5 MB) */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Max JSON file size for snapshot (500KB - avoids hanging on large JSON) */
const MAX_JSON_BYTES = 500 * 1024;

// ============================================================================
// Snapshot Service
// ============================================================================

export class SmartReadSnapshotService {
	private diskCache: SmartReadDiskCache;
	private smartRead: SmartReadCore;
	private extensions: Set<string>;
	private manifestPath: string;
	private manifestDir: string;

	constructor(options?: { diskCache?: SmartReadDiskCache; smartReadCore?: SmartReadCore }) {
		this.diskCache = options?.diskCache ?? new SmartReadDiskCache();
		this.smartRead = options?.smartReadCore ?? new SmartReadCore();
		this.extensions = DEFAULT_EXTENSIONS;
		this.manifestDir = this.diskCache.cacheDir;
		this.manifestPath = join(this.manifestDir, "snapshot-manifest.json");
	}

	/**
	 * Run a snapshot for the given directory.
	 */
	async run(options: SmartReadSnapshotOptions): Promise<SmartReadSnapshotResult> {
		const rootDir = resolve(options.rootDir);
		const concurrency = options.concurrency ?? Math.min(4, (cpus()?.length ?? 4) * 2);
		const force = options.force ?? false;
		const dryRun = options.dryRun ?? false;
		const signal = options.signal;
		const controller = options.controller;
		const extFilter = options.extensions ?? [...DEFAULT_EXTENSIONS];
		const extSet = new Set(extFilter.map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase()));

		const startedAt = new Date().toISOString();
		const startMs = Date.now();

		// Discover files recursively
		const files = await this.discoverFiles(rootDir, extSet);

		// Load existing manifest (if any) for skip detection
		const manifest = this.loadManifest(rootDir);

		// Progress state
		const progress: SmartReadSnapshotProgress = {
			scanned: 0,
			total: files.length,
			cached: 0,
			skipped: 0,
			failed: 0,
			rawBytes: 0,
			compactBytes: 0,
			estimatedTokensSaved: 0,
			percent: 0,
		};

		const failures: Array<{ file: string; error: string }> = [];

		// Process files in concurrency-limited batches
		const emitProgress = () => options.onProgress?.({ ...progress });

		const worker = async (filePath: string): Promise<void> => {
			// Check for cancellation
			if (signal?.aborted) {
				return;
			}
			if (controller?.isCancelled()) {
				return;
			}

			// Pause support
			if (controller?.isPaused()) {
				progress.currentAction = "paused";
				emitProgress();
				await new Promise<void>((resolve) => {
					const check = setInterval(() => {
						if (!controller.isPaused() || controller.isCancelled()) {
							clearInterval(check);
							resolve();
						}
					}, 200);
				});
				if (controller?.isCancelled()) {
					return;
				}
			}

			const relPath = relative(rootDir, filePath);
			progress.currentFile = relPath;
			progress.currentAction = "reading";
			emitProgress();

			try {
				const READ_TIMEOUT_MS = 5000; // 5s per file read
				const content = await Promise.race([
					readFile(filePath, "utf-8"),
					new Promise<string>((_, reject) =>
						setTimeout(() => reject(new Error(`Read timeout after ${READ_TIMEOUT_MS / 1000}s`)), READ_TIMEOUT_MS),
					),
				]);
				if (content.length > MAX_FILE_BYTES) {
					progress.skipped++;
					return;
				}

				// Skip large JSON files to avoid blocking the event loop
				const isJson = filePath.endsWith(".json") || filePath.endsWith(".jsonc");
				if (isJson && content.length > MAX_JSON_BYTES) {
					progress.skipped++;
					return;
				}

				const contentHash = this.hashContent(content);

				// Check existing cache
				if (!force) {
					const cachedEntry = this.diskCache.get(filePath, content);
					if (cachedEntry) {
						// Already cached and unchanged
						progress.skipped++;
						progress.rawBytes += content.length;
						progress.compactBytes += cachedEntry.outline.length;
						progress.estimatedTokensSaved += Math.max(0, content.length - cachedEntry.outline.length) / 4;
						return;
					}

					// Check manifest for quick skip
					const manifestEntry = manifest?.files[relPath];
					if (manifestEntry && manifestEntry.contentHash === contentHash) {
						progress.skipped++;
						progress.rawBytes += manifestEntry.rawBytes;
						progress.compactBytes += manifestEntry.compactBytes;
						progress.estimatedTokensSaved += Math.max(0, manifestEntry.rawBytes - manifestEntry.compactBytes) / 4;
						return;
					}
				}

				// Generate Smart Read outline with timeout
				progress.currentAction = "parsing";
				emitProgress();
				const PARSE_TIMEOUT_MS = 15000; // 15s per file (reduced since JSON/YAML are now fast)
				let result: SmartReadResult | undefined;
				try {
					result = await Promise.race([
						this.smartRead.smartRead(content, filePath, "outline"),
						new Promise<never>((_, reject) =>
							setTimeout(
								() => reject(new Error(`Parse timeout after ${PARSE_TIMEOUT_MS / 1000}s`)),
								PARSE_TIMEOUT_MS,
							),
						),
					]);
				} catch (err) {
					progress.failed++;
					failures.push({ file: relPath, error: (err as Error).message });
					return;
				}

				if (!result || result.isFallback || !result.content || result.content.length >= content.length) {
					// Can't produce a meaningful outline — skip caching
					progress.skipped++;
					return;
				}

				// Write to disk cache (skip in dry-run mode)
				progress.currentAction = "caching";
				emitProgress();
				if (!dryRun) {
					this.diskCache.set(filePath, content, result);
				}
				progress.cached++;
				progress.rawBytes += content.length;
				progress.compactBytes += result.content.length;
				progress.estimatedTokensSaved += Math.max(0, content.length - result.content.length) / 4;
			} catch (error) {
				progress.failed++;
				failures.push({
					file: relPath,
					error: (error as Error).message,
				});
			} finally {
				progress.scanned++;
				progress.percent = Math.round((progress.scanned / progress.total) * 100);
				progress.currentFile = undefined;
				options.onProgress?.({ ...progress });
				// Yield to let UI process input
				await new Promise((r) => setImmediate(r));
			}
		};

		// Run with limited concurrency
		await this.runConcurrent(files, concurrency, worker);

		// Update and persist manifest
		this.saveManifest(rootDir, this.diskCache);

		const durationMs = Date.now() - startMs;

		return {
			rootDir,
			startedAt,
			completedAt: new Date().toISOString(),
			durationMs,
			filesScanned: progress.total,
			filesCached: progress.cached,
			filesSkipped: progress.skipped,
			filesFailed: progress.failed,
			rawBytes: progress.rawBytes,
			compactBytes: progress.compactBytes,
			estimatedTokensSaved: Math.round(progress.estimatedTokensSaved),
			failures,
		};
	}

	/**
	 * Recursively discover eligible source files.
	 */
	async discoverFiles(rootDir: string, extensions: Set<string>): Promise<string[]> {
		const results: string[] = [];

		async function walk(dir: string): Promise<void> {
			let entries: Dirent[];
			try {
				entries = (await readdir(dir, { withFileTypes: true })) as unknown as Dirent[];
			} catch {
				return;
			}

			for (const entry of entries) {
				if (EXCLUDED_DIRS.has(entry.name)) continue;
				if (entry.name.startsWith(".") && entry.name !== ".") continue;

				const fullPath = join(dir, entry.name);

				if (entry.isDirectory()) {
					await walk(fullPath);
				} else if (entry.isFile()) {
					const ext = fullPath.substring(fullPath.lastIndexOf(".")).toLowerCase();
					if (extensions.has(ext)) {
						results.push(fullPath);
					}
				}
			}
		}

		await walk(rootDir);
		return results;
	}

	/**
	 * Format a human-readable summary string.
	 */
	formatSummary(result: SmartReadSnapshotResult): string {
		const lines: string[] = [];
		lines.push("Snapshot complete");
		lines.push(`Root: ${result.rootDir}`);
		lines.push(`Files scanned: ${result.filesScanned}`);
		lines.push(`Cached: ${result.filesCached}`);
		lines.push(`Skipped: ${result.filesSkipped}`);
		lines.push(`Failed: ${result.filesFailed}`);
		lines.push(`Raw size: ${this.formatBytes(result.rawBytes)}`);
		lines.push(`Compact size: ${this.formatBytes(result.compactBytes)}`);
		lines.push(`Estimated saved: ${(result.estimatedTokensSaved / 1000).toFixed(1)}K tokens`);
		lines.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);

		if (result.failures.length > 0) {
			lines.push("");
			lines.push(`Failures (${result.failures.length}):`);
			for (const f of result.failures.slice(0, 5)) {
				lines.push(`  ${f.file}: ${f.error}`);
			}
			if (result.failures.length > 5) {
				lines.push(`  ... and ${result.failures.length - 5} more`);
			}
		}

		return lines.join("\n");
	}

	/**
	 * Format progress as inline progress bar.
	 */
	formatProgress(p: SmartReadSnapshotProgress): string {
		const barWidth = 20;
		const filled = Math.round((p.percent / 100) * barWidth);
		const empty = barWidth - filled;
		const bar = `[${"#".repeat(filled)}${".".repeat(empty)}]`;
		const savedTokens = Math.round(p.estimatedTokensSaved / 1000);
		return `${bar} ${p.percent}% ${p.scanned}/${p.total} cached=${p.cached} skipped=${p.skipped} failed=${p.failed} saved\u2248${savedTokens}K tokens`;
	}

	// ============================================================================
	// Manifest
	// ============================================================================

	private loadManifest(_rootDir: string): SmartReadSnapshotManifest | undefined {
		try {
			if (!existsSync(this.manifestPath)) return undefined;
			const data = readFileSync(this.manifestPath, "utf-8");
			return JSON.parse(data) as SmartReadSnapshotManifest;
		} catch {
			return undefined;
		}
	}

	private saveManifest(rootDir: string, _cache: SmartReadDiskCache): void {
		try {
			if (!existsSync(this.manifestDir)) {
				mkdirSync(this.manifestDir, { recursive: true });
			}

			// Build manifest from current cache state
			const files: Record<string, SmartReadSnapshotFileEntry> = {};
			// We iterate entries via internal data; for now rebuild from cache stats
			// A full entry list would require scanning all cache files — skip for now

			const manifest: SmartReadSnapshotManifest = {
				version: 1,
				rootDir,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				files,
			};

			// Atomic write
			const tmpPath = `${this.manifestPath}.${randomUUID().slice(0, 8)}.tmp`;
			writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
			renameSync(tmpPath, this.manifestPath);
		} catch {
			// Best-effort manifest
		}
	}

	// ============================================================================
	// Helpers
	// ============================================================================

	private hashContent(content: string): string {
		return createHash("sha256").update(content, "utf-8").digest("hex");
	}

	private formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	private async runConcurrent<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
		const queue = [...items];
		let idx = 0;

		const next = async (): Promise<void> => {
			while (idx < queue.length) {
				const item = queue[idx++];
				await worker(item);
			}
		};

		const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => next());
		await Promise.all(workers);
	}
}
