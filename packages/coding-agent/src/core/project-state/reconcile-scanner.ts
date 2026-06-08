/**
 * ReconcileScanner — PSS-MEGA-02
 *
 * Verifies watcher/classifier hints by stat-ing candidate paths and comparing
 * with persisted files.json state. Produces verified events for the projector.
 *
 * Supports bounded tree scan with a stat-call cap.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type {
	ProjectStateEvent,
	ProjectStateEventEnvelope,
	ProjectStateFsChange,
	ReconcileLevel,
	ReconcileOptions,
	ReconcileResult,
} from "./event-types.js";
import { hashContent } from "./hash.js";
import type { ProjectStateStore } from "./store.js";
import type { ProjectFileEntry, ProjectFilesState } from "./types.js";

/** Default bounded tree stat limit */
export const DEFAULT_BOUNDED_TREE_STAT_LIMIT = 50_000;

/**
 * Amount of time (ms) within which same mtime is considered "same content"
 * when the exact mtime differs by less than this tolerance.
 */
const MTIME_TOLERANCE_MS = 100;

/**
 * ReconcileScanner
 *
 * Compares filesystem state with persisted snapshot state and produces
 * verified ProjectStateEventEnvelope array.
 */
export class ReconcileScanner {
	private store: ProjectStateStore;

	constructor(store: ProjectStateStore) {
		this.store = store;
	}

	/**
	 * Run reconcile for the given candidate paths at the given level.
	 */
	reconcile(options: ReconcileOptions): ReconcileResult {
		const { rootDir, candidatePaths, level } = options;
		const statLimit = options.statLimit ?? DEFAULT_BOUNDED_TREE_STAT_LIMIT;
		const absRoot = resolve(rootDir);
		const filesState = this.store.loadFilesState();
		const manifest = this.store.loadManifest();

		const events: ProjectStateEventEnvelope[] = [];
		let statCalls = 0;
		let hashCalls = 0;
		let exceededLimit = false;
		const markedUnknown = false;
		const failures: Array<{ path: string; error: string }> = [];

		const knownFiles = new Set(filesState ? Object.keys(filesState.files) : []);

		// Helper to create an event envelope
		const makeEvent = (event: ProjectStateEvent): ProjectStateEventEnvelope => ({
			eventId: randomUUID().slice(0, 12),
			sequence: 0, // Assigned by journal
			timestamp: new Date().toISOString(),
			sessionId: "reconcile",
			cwd: rootDir,
			source: "reconcile",
			event,
		});

		// Process candidate paths
		for (const relPath of candidatePaths) {
			if (statCalls >= statLimit) {
				exceededLimit = true;
				break;
			}

			const absPath = join(absRoot, relPath);
			const existedBefore = knownFiles.has(relPath);
			statCalls++;

			try {
				const stat = statSync(absPath);

				if (!existedBefore) {
					// File was created
					events.push(makeEvent({ type: "file_written", path: relPath }));
				} else {
					// File existed — check for changes
					const oldEntry = filesState?.files[relPath];
					if (oldEntry) {
						const sizeChanged = stat.size !== oldEntry.sizeBytes;
						const mtimeChanged = Math.abs(stat.mtimeMs - oldEntry.mtimeMs) > MTIME_TOLERANCE_MS;

						if (sizeChanged || mtimeChanged) {
							// Hash to confirm
							hashCalls++;
							try {
								const content = readFileSync(absPath, "utf-8");
								const currentHash = hashContent(content);
								const oldHash = oldEntry.contentHash;

								if (currentHash !== oldHash) {
									events.push(
										makeEvent({
											type: "file_edited",
											path: relPath,
											oldHash,
											newHash: currentHash,
										}),
									);
								} else {
									// Content unchanged — just metadata change
									events.push(makeEvent({ type: "file_touched", path: relPath }));
								}
							} catch {
								failures.push({ path: relPath, error: "Failed to hash file" });
							}
						}
					}
				}
			} catch {
				// File doesn't exist on disk
				if (existedBefore) {
					events.push(
						makeEvent({ type: "file_deleted", path: relPath, oldHash: filesState?.files[relPath]?.contentHash }),
					);
				}
			}
		}

		// If level is bounded_tree or higher, also scan for files that exist on disk but not in state
		if (level === "bounded_tree" || level === "full_tree") {
			const discovered = this.scanNewFiles(absRoot, knownFiles, statLimit - statCalls);
			statCalls += discovered.statCalls;
			for (const newPath of discovered.newFiles) {
				if (!knownFiles.has(newPath)) {
					events.push(makeEvent({ type: "file_written", path: newPath }));
				}
			}
			if (discovered.exceededLimit) {
				exceededLimit = true;
			}
		}

		return {
			events,
			statCalls,
			hashCalls,
			exceededLimit,
			markedUnknown,
			failures,
		};
	}

	/**
	 * Quick stat-only check for a single path.
	 * Compares size+mtime with the snapshot entry. Returns true if file is unchanged.
	 */
	quickCheck(relPath: string): "unchanged" | "changed" | "missing" {
		const filesState = this.store.loadFilesState();
		if (!filesState) return "missing";

		const entry = filesState.files[relPath];
		if (!entry) return "missing";

		const absRoot = this.store.getRootDir();
		const absPath = join(resolve(absRoot), relPath);

		try {
			const stat = statSync(absPath);
			const sizeMatch = stat.size === entry.sizeBytes;
			const mtimeMatch = Math.abs(stat.mtimeMs - entry.mtimeMs) < MTIME_TOLERANCE_MS;
			return sizeMatch && mtimeMatch ? "unchanged" : "changed";
		} catch {
			return "missing";
		}
	}

	// ============================================================================
	// Internal
	// ============================================================================

	/**
	 * Scan for files on disk that aren't in the known set.
	 * Only does stat calls (no content reads).
	 */
	private scanNewFiles(
		absRoot: string,
		knownFiles: Set<string>,
		remainingBudget: number,
	): { newFiles: string[]; statCalls: number; exceededLimit: boolean } {
		const result: string[] = [];
		let statCalls = 0;
		let exceededLimit = false;

		try {
			const entries = readdirSync(absRoot);
			for (const name of entries) {
				if (statCalls >= remainingBudget) {
					exceededLimit = true;
					break;
				}
				if (name.startsWith(".")) continue;

				const fullPath = join(absRoot, name);
				try {
					const stat = statSync(fullPath);
					statCalls++;
					if (stat.isDirectory()) continue;

					const relPath = name;
					if (!knownFiles.has(relPath)) {
						result.push(relPath);
					}
				} catch {
					// skip
				}
			}
		} catch {
			// skip
		}

		return { newFiles: result, statCalls, exceededLimit };
	}
}
