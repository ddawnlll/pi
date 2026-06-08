/**
 * ProjectStateSnapshotService
 *
 * Main snapshot service that orchestrates file discovery, hashing,
 * Smart Read cache warmup, tree building, package/git state capture,
 * and atomic persistence of all state files.
 *
 * Supports resume via SnapshotRunStore, bounded concurrency,
 * and progress reporting.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import type { SmartReadCore } from "../token-context/smart-read-core.js";
import type { SmartReadDiskCache } from "../token-context/smart-read-disk-cache.js";
import { classifyCommand } from "./bash-classifier.js";
import { buildFilesState, discoverFiles } from "./discovery.js";
import { ProjectStateEventJournal } from "./event-journal.js";
import type {
	ProjectStateEvent,
	ProjectStateEventEnvelope,
	ProjectStateQueryResult,
	QueryRenderOptions,
} from "./event-types.js";
import { buildGitState } from "./git-snapshot.js";
import { hashContent } from "./hash.js";
import { MutationWindowStore } from "./mutation-window-store.js";
import { buildPackageState } from "./package-snapshot.js";
import {
	DEFAULT_CONCURRENCY_FACTOR,
	DEFAULT_INCLUDED_EXTENSIONS,
	MAX_CONCURRENCY,
	MIN_CONCURRENCY,
	PROGRESS_THROTTLE_MS,
	SCHEMA_VERSION,
} from "./paths.js";
import { ProjectStateProjector } from "./projector.js";
import { QueryService } from "./query-service.js";
import { ReadTimeVerifier } from "./read-time-verifier.js";
import { DEFAULT_BOUNDED_TREE_STAT_LIMIT, ReconcileScanner } from "./reconcile-scanner.js";
import { SmartReadBridge } from "./smart-read-bridge.js";
import { SnapshotRunStore } from "./snapshot-run-store.js";
import { ProjectStateStore } from "./store.js";
import { buildTreeIndex } from "./tree-builder.js";
import type {
	ProjectFileEntry,
	ProjectFilesState,
	ProjectStateManifest,
	ProjectTreeIndex,
	SnapshotOptions,
	SnapshotProgress,
	SnapshotResult,
	SnapshotRunState,
	SnapshotStatusReport,
} from "./types.js";

/**
 * ProjectStateSnapshotService
 *
 * Main entry point for project state snapshot operations.
 */
export class ProjectStateSnapshotService {
	private store: ProjectStateStore;
	private runStore: SnapshotRunStore;
	private smartReadBridge: SmartReadBridge;
	private readTimeVerifier: ReadTimeVerifier;
	private defaultExtensions: string[];

	constructor(options?: {
		store?: ProjectStateStore;
		smartReadDiskCache?: SmartReadDiskCache;
		/** If true, also run PSS-MEGA-02 background processes */
		live?: boolean;
		smartReadCore?: SmartReadCore;
		extensions?: string[];
	}) {
		const rootDir = options?.store?.getRootDir() ?? process.cwd();
		this.store = options?.store ?? new ProjectStateStore(rootDir);
		this.runStore = new SnapshotRunStore(rootDir);
		this.smartReadBridge = new SmartReadBridge({
			diskCache: options?.smartReadDiskCache,
			smartReadCore: options?.smartReadCore,
		});
		this.readTimeVerifier = new ReadTimeVerifier(this.store, options?.smartReadDiskCache);
		this.defaultExtensions = options?.extensions ?? [...DEFAULT_INCLUDED_EXTENSIONS];
	}

	/**
	 * Update the store's root directory.
	 */
	setRootDir(rootDir: string): void {
		const newStore = new ProjectStateStore(rootDir);
		this.store = newStore;
		this.runStore = new SnapshotRunStore(rootDir);
		this.readTimeVerifier.setStore(newStore);
	}

	/**
	 * Run a snapshot for the given directory options.
	 */
	async run(options: SnapshotOptions): Promise<SnapshotResult> {
		const rootDir = resolve(options.rootDir);
		this.setRootDir(rootDir);

		const concurrency = this.resolveConcurrency(options.concurrency);
		const force = options.force ?? false;
		const includeMd = options.includeMd ?? false;
		const maxFiles = options.maxFiles ?? 0;
		const noSmartRead = options.noSmartRead ?? false;

		const startedAt = new Date().toISOString();
		const startMs = Date.now();
		const snapshotId = randomUUID().slice(0, 12);
		const failures: Array<{ path: string; error: string }> = [];

		this.smartReadBridge.setForce(force);

		// Ensure state directory exists
		this.store.ensureStateDir();

		// Progress tracking
		const progress: SnapshotProgress = {
			phase: "discovering",
			scanned: 0,
			total: 0,
			cached: 0,
			skipped: 0,
			failed: 0,
			rawBytes: 0,
			compactBytes: 0,
			estimatedTokensSaved: 0,
			percent: 0,
		};

		const emitProgress = () => options.onProgress?.({ ...progress });

		// Phase 1: File discovery
		progress.phase = "discovering";
		emitProgress();

		// Determine extensions
		const extensions = includeMd ? this.defaultExtensions : this.defaultExtensions.filter((e) => e !== ".md");

		const discovery = discoverFiles(rootDir, { extensions, maxFiles });

		progress.total = discovery.fileCount;
		progress.scanned = 0;
		emitProgress();

		// Prepare run state for resume support
		const allRelPaths = Object.keys(discovery.files).sort();
		const runState = this.runStore.createRunState(allRelPaths);

		// Phase 2: Hash eligible files and warm Smart Read cache
		progress.phase = "hashing";
		this.runStore.updatePhase(runState, "hashing");
		emitProgress();

		let lastProgressEmit = 0;
		const files: Record<string, ProjectFileEntry> = {};
		let rawBytes = 0;
		let compactBytes = 0;
		let estimatedTokensSaved = 0;

		// Process files with bounded concurrency
		const worker = async (relPath: string): Promise<void> => {
			const entry = discovery.files[relPath];

			// Compute content hash for source/config files
			if ((entry.isSource || entry.isConfig) && !entry.isIgnored) {
				try {
					const fullPath = resolve(rootDir, relPath);
					const content = readFileSync(fullPath, "utf-8");
					entry.contentHash = hashContent(content);
					entry.lineCount = content.split("\n").length;
				} catch {
					// Hash failure is non-fatal
				}
			}

			// Warm Smart Read cache for eligible files (unless --no-smart-read or dry-run)
			if (!noSmartRead && entry.isSource && !entry.isIgnored && !entry.isGenerated && entry.contentHash) {
				const warmResult = await this.smartReadBridge.warmFile(rootDir, relPath, entry.contentHash, entry);

				if (warmResult.status === "warm") {
					files[relPath] = warmResult.entry;
					rawBytes += warmResult.rawBytes;
					compactBytes += warmResult.compactBytes;
					progress.cached++;
				} else if (warmResult.status === "skipped") {
					files[relPath] = warmResult.entry;
					rawBytes += warmResult.rawBytes;
					progress.skipped++;
				} else if (warmResult.status === "failed") {
					failures.push({ path: relPath, error: warmResult.error ?? "Unknown error" });
					files[relPath] = warmResult.entry;
					progress.failed++;
				} else {
					files[relPath] = entry;
					progress.skipped++;
				}
			} else {
				files[relPath] = entry;
				progress.skipped++;
			}

			rawBytes += entry.sizeBytes;
			progress.scanned++;
			progress.percent = Math.round((progress.scanned / progress.total) * 100);
			estimatedTokensSaved += Math.max(0, rawBytes - compactBytes) / 4;

			// Throttle progress updates
			const now = Date.now();
			if (now - lastProgressEmit > PROGRESS_THROTTLE_MS) {
				lastProgressEmit = now;
				emitProgress();
			}

			// Record progress in run state
			this.runStore.addCompletedFile(runState, relPath);
		};

		await this.runConcurrent(allRelPaths, concurrency, worker);

		// Mark run state completion for the processing phase
		runState.rawBytes = rawBytes;
		runState.compactBytes = compactBytes;
		runState.estimatedTokensSaved = Math.round(estimatedTokensSaved);
		this.runStore.saveRunState(runState);

		// Phase 3: Build tree index
		progress.phase = "building-tree";
		this.runStore.updatePhase(runState, "building-tree");
		emitProgress();

		const sourceFileCount = discovery.sourceFileCount;
		const treeIndex = buildTreeIndex(rootDir, files, sourceFileCount);

		// Phase 4: Build package state
		progress.phase = "building-packages";
		this.runStore.updatePhase(runState, "building-packages");
		emitProgress();

		const packageState = buildPackageState(rootDir);

		// Phase 5: Build git state
		progress.phase = "building-git";
		this.runStore.updatePhase(runState, "building-git");
		emitProgress();

		const gitState = buildGitState(rootDir);

		// Phase 6: Write state files
		progress.phase = "writing-state";
		this.runStore.updatePhase(runState, "writing-state");
		emitProgress();

		// Build files state (with content hashes already computed)
		const filesState: ProjectFilesState = {
			schemaVersion: SCHEMA_VERSION,
			rootDir: resolve(rootDir),
			generatedAt: new Date().toISOString(),
			files,
		};

		// Create manifest
		const manifest = this.store.createManifest(Object.keys(files).length, sourceFileCount, treeIndex.treeHash);

		// Update validity
		manifest.validity = {
			tree: "valid",
			files: "valid",
			packages: packageState.validity,
			git: gitState.validity,
			commands: "stale",
			smartRead: progress.failed > 0 ? "dirty" : "valid",
		};

		// Atomic writes
		this.store.saveManifest(manifest);
		this.store.saveFilesState(filesState);
		this.store.saveTreeIndex(treeIndex);
		this.store.savePackageState(packageState);
		this.store.saveGitState(gitState);

		// Mark run as completed
		this.runStore.markCompleted(runState);

		// Final progress
		progress.phase = "complete";
		progress.percent = 100;
		progress.rawBytes = rawBytes;
		progress.compactBytes = compactBytes;
		progress.estimatedTokensSaved = Math.round(estimatedTokensSaved);
		emitProgress();

		const durationMs = Date.now() - startMs;

		return {
			rootDir: resolve(rootDir),
			snapshotId: manifest.snapshotId,
			startedAt,
			completedAt: new Date().toISOString(),
			durationMs,
			filesScanned: progress.total,
			sourceFiles: sourceFileCount,
			filesCached: progress.cached,
			filesSkipped: progress.skipped,
			filesFailed: progress.failed,
			rawBytes,
			compactBytes,
			estimatedTokensSaved: Math.round(estimatedTokensSaved),
			manifestPath: storeManifestPath(rootDir),
			failures,
		};
	}

	/**
	 * Resume from the latest interrupted snapshot run.
	 */
	async resume(options: Omit<SnapshotOptions, "rootDir"> & { rootDir?: string }): Promise<SnapshotResult | null> {
		const rootDir = options.rootDir ? resolve(options.rootDir) : this.store.getRootDir();
		this.setRootDir(rootDir);

		const runState = this.runStore.findLatestResumableRun();
		if (!runState) {
			return null;
		}

		// Verify completed files are still valid (stat check)
		const validCompleted: string[] = [];
		const needsReprocess: string[] = [];

		for (const relPath of runState.completedFiles) {
			try {
				const fullPath = resolve(rootDir, relPath);
				const stat = statSync(fullPath);
				// Quick stat check — if file still exists, assume completed work is valid
				validCompleted.push(relPath);
			} catch {
				needsReprocess.push(relPath);
			}
		}

		// Build pending list from original pending + reprocess needed
		const pendingFiles = [...runState.pendingFiles, ...needsReprocess].filter((f) => !validCompleted.includes(f));

		if (pendingFiles.length === 0) {
			// All done — just update status
			this.runStore.markCompleted(runState);
			return null;
		}

		// Resume with remaining files
		const resumeOptions: SnapshotOptions = {
			rootDir,
			concurrency: options.concurrency,
			force: options.force,
			json: options.json,
			noSmartRead: options.noSmartRead,
			includeMd: options.includeMd,
			maxFiles: options.maxFiles,
			onProgress: options.onProgress,
		};

		return this.run(resumeOptions);
	}

	/**
	 * Get snapshot status by reading persisted state files.
	 */
	getStatus(rootDir?: string): SnapshotStatusReport {
		const dir = rootDir ? resolve(rootDir) : this.store.getRootDir();
		const store = new ProjectStateStore(dir);

		const manifest = store.loadManifest();
		const filesState = store.loadFilesState();
		const _treeIndex = store.loadTreeIndex();
		const _packageState = store.loadPackageState();
		const _gitState = store.loadGitState();
		const runStore = new SnapshotRunStore(dir);
		const latestRuns = runStore.listAllRuns();

		// Determine overall validity
		let overall: SnapshotStatusReport["overall"] = "missing";
		if (manifest) {
			const validities = [
				manifest.validity?.tree,
				manifest.validity?.files,
				manifest.validity?.packages,
				manifest.validity?.git,
			];
			const isPartial = validities.some((v) => v === "unknown" || v === "stale");
			const anyValid = validities.some((v) => v === "valid" || v === "dirty");
			if (anyValid && isPartial) overall = "partial";
			else if (anyValid) overall = manifest.validity?.git === "dirty" ? "dirty" : "valid";
			else overall = "stale";
		}

		// Count Smart Read warm/failed
		let smartReadWarmCount = 0;
		let smartReadFailedCount = 0;
		if (filesState) {
			for (const entry of Object.values(filesState.files)) {
				if (entry.smartReadStatus === "warm") smartReadWarmCount++;
				if (entry.smartReadStatus === "failed") smartReadFailedCount++;
			}
		}

		// Estimated token savings
		let estimatedTokenSavings = 0;
		if (filesState) {
			for (const entry of Object.values(filesState.files)) {
				if (entry.isSource && entry.contentHash) {
					estimatedTokenSavings += Math.max(0, entry.sizeBytes) / 4;
				}
			}
		}

		return {
			overall,
			rootDir: dir,
			manifestPath: manifest ? storeManifestPath(dir) : "",
			fileCount: manifest?.fileCount ?? 0,
			sourceFileCount: manifest?.sourceFileCount ?? 0,
			treeValidity: manifest?.validity?.tree ?? "unknown",
			filesValidity: manifest?.validity?.files ?? "unknown",
			smartReadWarmCount,
			smartReadFailedCount,
			packageValidity: manifest?.validity?.packages ?? "unknown",
			gitValidity: manifest?.validity?.git ?? "unknown",
			lastUpdated: manifest?.updatedAt,
			estimatedTokenSavings,
			latestRun:
				latestRuns.length > 0
					? {
							snapshotRunId: latestRuns[0].snapshotRunId,
							status: latestRuns[0].status,
							startedAt: latestRuns[0].startedAt,
						}
					: undefined,
		};
	}

	/**
	 * Format a human-readable status string.
	 */
	formatStatus(status: SnapshotStatusReport): string {
		const lines: string[] = [];
		lines.push(`Project snapshot: ${status.overall}`);
		lines.push(`Root: ${status.rootDir}`);
		lines.push(`Manifest: ${status.manifestPath || "not found"}`);
		lines.push(`Files: ${status.fileCount}`);
		lines.push(`Source files: ${status.sourceFileCount}`);
		lines.push(`Tree: ${status.treeValidity}`);
		lines.push(`File manifest: ${status.filesValidity}`);
		lines.push(`Smart Read warm: ${status.smartReadWarmCount}`);
		lines.push(`Smart Read failed: ${status.smartReadFailedCount}`);
		lines.push(`Package state: ${status.packageValidity}`);
		lines.push(`Git state: ${status.gitValidity}`);

		if (status.lastUpdated) {
			const ago = Math.round((Date.now() - new Date(status.lastUpdated).getTime()) / 1000);
			lines.push(`Last updated: ${ago}s ago`);
		}

		lines.push(`Estimated saved: ${(status.estimatedTokenSavings / 1000).toFixed(0)}K tokens`);

		if (status.latestRun) {
			lines.push(`Latest run: ${status.latestRun.snapshotRunId} (${status.latestRun.status})`);
		}

		if (status.overall === "missing") {
			lines.push("");
			lines.push("Run /snapshot to create one.");
		}

		return lines.join("\n");
	}

	/**
	 * Format human-readable snapshot summary.
	 */
	formatSummary(result: SnapshotResult): string {
		const lines: string[] = [];
		lines.push("Snapshot complete");
		lines.push(`Root: ${result.rootDir}`);
		lines.push(`Files scanned: ${result.filesScanned}`);
		lines.push(`Source files: ${result.sourceFiles}`);
		lines.push(`Smart Read warm: ${result.filesCached}`);
		lines.push(`Smart Read skipped: ${result.filesSkipped}`);
		lines.push(`Failed: ${result.filesFailed}`);
		lines.push(`Raw size: ${this.formatBytes(result.rawBytes)}`);
		lines.push(`Compact size: ${this.formatBytes(result.compactBytes)}`);
		lines.push(`Estimated saved: ${(result.estimatedTokensSaved / 1000).toFixed(0)}K tokens`);

		if (result.failures.length > 0) {
			lines.push("");
			lines.push(`Failures (${result.failures.length}):`);
			for (const f of result.failures.slice(0, 5)) {
				lines.push(`  ${f.path}: ${f.error}`);
			}
			if (result.failures.length > 5) {
				lines.push(`  ... and ${result.failures.length - 5} more`);
			}
		}

		lines.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
		return lines.join("\n");
	}

	/**
	 * Format inline progress bar.
	 */
	formatProgress(p: SnapshotProgress): string {
		const barWidth = 20;
		const filled = Math.round((p.percent / 100) * barWidth);
		const empty = barWidth - filled;
		const bar = `[${"#".repeat(filled)}${".".repeat(empty)}]`;
		const savedTokens = Math.round(p.estimatedTokensSaved / 1000);
		const phase = p.phase ? ` ${p.phase}` : "";
		return `${bar} ${p.percent}% ${p.scanned}/${p.total} cached=${p.cached} skipped=${p.skipped} failed=${p.failed} saved\u2248${savedTokens}K tokens${phase}`;
	}

	// ============================================================================
	// Helpers
	// ============================================================================

	private resolveConcurrency(requested?: number): number {
		if (requested === undefined) {
			return Math.min(
				Math.max(MIN_CONCURRENCY, (cpus()?.length ?? 4) * DEFAULT_CONCURRENCY_FACTOR),
				MAX_CONCURRENCY,
			);
		}
		return Math.min(Math.max(MIN_CONCURRENCY, requested), MAX_CONCURRENCY);
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

	/**
	 * Get the store instance (for external use).
	 */
	getStore(): ProjectStateStore {
		return this.store;
	}

	/**
	 * Get the read-time verifier.
	 */
	getReadTimeVerifier(): ReadTimeVerifier {
		return this.readTimeVerifier;
	}

	// ========================================================================
	// PSS-MEGA-02: Event Journal / Projector / Classifier / Query
	// ========================================================================

	/**
	 * Get or create the event journal for the current root.
	 */
	getEventJournal(): ProjectStateEventJournal {
		return new ProjectStateEventJournal(this.store.getRootDir());
	}

	/**
	 * Get the projector for the current root.
	 */
	getProjector(rootDir?: string): ProjectStateProjector {
		const dir = rootDir ? resolve(rootDir) : this.store.getRootDir();
		const store = new ProjectStateStore(dir);
		const journal = new ProjectStateEventJournal(dir);
		return new ProjectStateProjector(store, journal);
	}

	/**
	 * Get journal event summary for the current root.
	 */
	getEventsSummary(rootDir?: string): string {
		const dir = rootDir ? resolve(rootDir) : this.store.getRootDir();
		const journal = new ProjectStateEventJournal(dir);
		const store = new ProjectStateStore(dir);
		const projector = new ProjectStateProjector(store, journal);
		const mutWin = new MutationWindowStore(dir);

		const stats = journal.getStats();
		const pending = projector.getPendingCount();
		const lastApplied = projector.getLastAppliedSequence();
		const openWindows = mutWin.getOpenWindows();

		const lines: string[] = [];
		lines.push(`Event journal: ${journal.exists() ? "present" : "not created"}`);
		lines.push(`Path: ${stats.journalPath}`);
		lines.push(`Total events: ${stats.totalEvents}`);
		lines.push(`Last sequence: ${stats.lastSequence}`);
		lines.push(`Last applied sequence: ${lastApplied}`);
		lines.push(`Pending events: ${pending}`);
		lines.push(`Journal size: ${formatBytesSimple(stats.journalSizeBytes)}`);
		lines.push(`Needs compaction: ${stats.needsCompaction ? "yes" : "no"}`);
		lines.push(`Open mutation windows: ${openWindows.length}`);
		for (const w of openWindows.slice(0, 5)) {
			lines.push(`  [${w.id}] ${w.source}: ${w.command ?? "(no command)"} (since ${w.startedAt})`);
		}

		return lines.join("\n");
	}

	/**
	 * Classify a bash command.
	 */
	classifyCommand(command: string) {
		return classifyCommand(command);
	}

	/**
	 * Get the query service for the given root.
	 */
	getQueryService(rootDir?: string): QueryService {
		const dir = rootDir ? resolve(rootDir) : this.store.getRootDir();
		return new QueryService(new ProjectStateStore(dir));
	}

	/**
	 * Run a query (ls, rg-files, packages, git).
	 */
	query(
		type: "ls" | "rg-files" | "packages" | "git",
		path?: string,
		options?: QueryRenderOptions,
		rootDir?: string,
	): ProjectStateQueryResult {
		const qs = this.getQueryService(rootDir);
		switch (type) {
			case "ls":
				return qs.ls(path ?? ".", options);
			case "rg-files":
				return qs.rgFiles(path, options);
			case "packages":
				return qs.packages(options);
			case "git":
				return qs.git(options);
		}
	}

	/**
	 * Open a mutation window for an unknown command.
	 */
	openMutationWindow(
		source: "bash_unknown" | "git_operation" | "package_operation" | "external" | "ide",
		reason: string,
		command?: string,
	): { id: string; mutationWindowStore: MutationWindowStore } {
		const mw = new MutationWindowStore(this.store.getRootDir());
		const window = mw.open(source, reason, command);
		return { id: window.id, mutationWindowStore: mw };
	}

	/**
	 * Get the mutation window store.
	 */
	getMutationWindowStore(rootDir?: string): MutationWindowStore {
		const dir = rootDir ? resolve(rootDir) : this.store.getRootDir();
		return new MutationWindowStore(dir);
	}
}

function storeManifestPath(rootDir: string): string {
	return join(rootDir, ".pi", "project-state", "manifest.json");
}

function formatBytesSimple(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
