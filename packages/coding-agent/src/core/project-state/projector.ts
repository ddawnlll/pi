/**
 * ProjectStateProjector — PSS-MEGA-02
 *
 * Applies events from the journal idempotently to persisted state.
 * Loads unapplied events, sorts by sequence, applies rules,
 * writes updated state atomically, and updates lastAppliedSequence.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectStateEventJournal } from "./event-journal.js";
import type { ProjectStateEventEnvelope } from "./event-types.js";
import { getStateDir } from "./paths.js";
import type { ProjectStateStore } from "./store.js";
import type { ProjectFileEntry, ProjectFilesState, ProjectStateManifest, ProjectTreeIndex } from "./types.js";

/** Projector lock file */
const PROJECTOR_LOCK_FILE = "projector.lock";

/** Lock timeout (ms) */
const LOCK_TIMEOUT_MS = 10_000;

/** Stale lock threshold */
const STALE_LOCK_MS = 15_000;

/**
 * Result of a projector run.
 */
export interface ProjectorResult {
	appliedCount: number;
	failedCount: number;
	newLastAppliedSequence: number;
	errors: Array<{ eventId: string; error: string }>;
}

/**
 * Applies events idempotently to project state.
 */
export class ProjectStateProjector {
	private store: ProjectStateStore;
	private journal: ProjectStateEventJournal;
	private lockPath: string;

	constructor(store: ProjectStateStore, journal: ProjectStateEventJournal) {
		this.store = store;
		this.journal = journal;
		this.lockPath = join(getStateDir(store.getRootDir()), PROJECTOR_LOCK_FILE);
	}

	/**
	 * Apply all unapplied events from the journal.
	 * Thread-safe via projector lock.
	 */
	applyAll(): ProjectorResult {
		const lockAcquired = this.acquireLock();
		if (!lockAcquired) {
			return { appliedCount: 0, failedCount: 0, newLastAppliedSequence: this.getLastAppliedSequence(), errors: [] };
		}

		try {
			const manifest = this.store.loadManifest();
			if (!manifest) {
				return { appliedCount: 0, failedCount: 0, newLastAppliedSequence: 0, errors: [] };
			}

			const lastApplied = manifest.lastAppliedSequence ?? 0;
			const events = this.journal.loadUnappliedEvents(lastApplied);

			if (events.length === 0) {
				return { appliedCount: 0, failedCount: 0, newLastAppliedSequence: lastApplied, errors: [] };
			}

			// Load current state
			const filesState = this.store.loadFilesState();
			const treeIndex = this.store.loadTreeIndex();
			const errors: Array<{ eventId: string; error: string }> = [];
			let appliedCount = 0;
			let maxSequence = lastApplied;

			for (const envelope of events) {
				if (envelope.sequence <= lastApplied) continue;

				try {
					this.applyEvent(envelope, manifest, filesState, treeIndex);
					maxSequence = envelope.sequence;
					appliedCount++;
				} catch (err) {
					errors.push({
						eventId: envelope.eventId,
						error: (err as Error).message,
					});
				}
			}

			// Save updated state if changes were applied
			if (appliedCount > 0) {
				manifest.lastAppliedSequence = maxSequence;
				this.store.saveManifest(manifest);
				if (filesState) this.store.saveFilesState(filesState);
				if (treeIndex) this.store.saveTreeIndex(treeIndex);
			}

			return { appliedCount, failedCount: errors.length, newLastAppliedSequence: maxSequence, errors };
		} finally {
			this.releaseLock();
		}
	}

	/**
	 * Apply a single event to the in-memory state.
	 * Idempotent: same event applied twice should produce same result.
	 */
	private applyEvent(
		envelope: ProjectStateEventEnvelope,
		manifest: ProjectStateManifest,
		filesState: ProjectFilesState | undefined,
		_treeIndex: ProjectTreeIndex | undefined,
	): void {
		const event = envelope.event;
		const _absRoot = this.store.getRootDir();

		switch (event.type) {
			case "file_written":
			case "file_edited": {
				if (!filesState) break;
				const oldEntry = filesState.files[event.path];
				const hash = event.newHash;
				if (hash !== undefined && oldEntry?.contentHash === hash) {
					// Same content — skip
					break;
				}
				if (hash !== undefined && oldEntry?.contentHash !== undefined && oldEntry.contentHash !== hash) {
					// Causal mismatch — mark dirty
					filesState.files[event.path] = {
						...(oldEntry ?? {
							path: event.path,
							ext: extFromPath(event.path),
							isSource: false,
							isTest: false,
							isConfig: false,
							isGenerated: false,
							isIgnored: false,
						}),
						contentHash: hash,
						sizeBytes: 0,
						mtimeMs: Date.now(),
						smartReadStatus: "stale",
						lastChangedSequence: manifest.lastAppliedSequence + 1,
					};
				} else {
					// Update metadata
					filesState.files[event.path] = {
						...(oldEntry ?? {
							path: event.path,
							ext: extFromPath(event.path),
							isSource: smartReadEligible(extFromPath(event.path)),
							isTest: event.path.includes(".test.") || event.path.includes(".spec."),
							isConfig: event.path.includes("package.json") || event.path.includes("tsconfig"),
							isGenerated: false,
							isIgnored: false,
						}),
						contentHash: hash,
						smartReadStatus:
							oldEntry?.smartReadStatus === "warm" ? "stale" : (oldEntry?.smartReadStatus ?? "missing"),
						lastChangedSequence: manifest.lastAppliedSequence + 1,
					};
				}
				break;
			}

			case "file_deleted": {
				if (!filesState) break;
				delete filesState.files[event.path];
				break;
			}

			case "file_moved": {
				if (!filesState) break;
				const srcEntry = filesState.files[event.from];
				if (srcEntry) {
					const destEntry: ProjectFileEntry = {
						...srcEntry,
						path: event.to,
						ext: extFromPath(event.to),
						smartReadStatus: "missing",
						lastChangedSequence: manifest.lastAppliedSequence + 1,
					};
					delete filesState.files[event.from];
					filesState.files[event.to] = destEntry;
				}
				break;
			}

			case "directory_created":
			case "directory_deleted": {
				// Tree updates — for now mark tree dirty
				manifest.validity.tree = "dirty";
				break;
			}

			case "package_manifest_changed": {
				manifest.validity.packages = "dirty";
				break;
			}

			case "config_file_changed": {
				manifest.validity.packages = "dirty";
				break;
			}

			case "git_head_changed":
			case "git_worktree_changed": {
				manifest.validity.git = "dirty";
				manifest.validity.tree = "dirty";
				manifest.validity.files = "dirty";
				break;
			}

			case "state_marked_dirty": {
				for (const scope of event.scope) {
					switch (scope) {
						case "tree":
							manifest.validity.tree = "dirty";
							break;
						case "files":
							manifest.validity.files = "dirty";
							break;
						case "packages":
							manifest.validity.packages = "dirty";
							break;
						case "git":
							manifest.validity.git = "dirty";
							break;
						case "smartRead":
							manifest.validity.smartRead = "dirty";
							break;
					}
				}
				break;
			}

			case "state_marked_unknown": {
				for (const scope of event.scope) {
					switch (scope) {
						case "tree":
							manifest.validity.tree = "unknown";
							break;
						case "files":
							manifest.validity.files = "unknown";
							break;
						case "packages":
							manifest.validity.packages = "unknown";
							break;
						case "git":
							manifest.validity.git = "unknown";
							break;
						case "smartRead":
							manifest.validity.smartRead = "unknown";
							break;
					}
				}
				break;
			}
		}
	}

	// ============================================================================
	// Helpers
	// ============================================================================

	getLastAppliedSequence(): number {
		const manifest = this.store.loadManifest();
		return manifest?.lastAppliedSequence ?? 0;
	}

	/**
	 * Get pending event count.
	 */
	getPendingCount(): number {
		return this.journal.getLastSequence() - this.getLastAppliedSequence();
	}

	/**
	 * Acquire projector lock with timeout and stale detection.
	 */
	private acquireLock(): boolean {
		const start = Date.now();
		while (Date.now() - start < LOCK_TIMEOUT_MS) {
			try {
				if (existsSync(this.lockPath)) {
					try {
						const stat = require("node:fs").statSync(this.lockPath);
						if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
							require("node:fs").rmSync(this.lockPath, { force: true });
						}
					} catch {
						// ignore
					}
				}

				const fd = require("node:fs").openSync(this.lockPath, "wx");
				writeLockFile(fd);
				require("node:fs").closeSync(fd);
				return true;
			} catch {
				const waitMs = 50 + Math.random() * 50;
				const deadline = Date.now() + waitMs;
				while (Date.now() < deadline) {
					// busy wait
				}
			}
		}
		return false;
	}

	/**
	 * Release the projector lock.
	 */
	private releaseLock(): void {
		try {
			if (existsSync(this.lockPath)) {
				require("node:fs").rmSync(this.lockPath, { force: true });
			}
		} catch {
			// best-effort
		}
	}
}

function extFromPath(p: string): string {
	const idx = p.lastIndexOf(".");
	return idx >= 0 ? p.slice(idx).toLowerCase() : "";
}

function smartReadEligible(ext: string): boolean {
	return [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go"].includes(ext);
}

function writeLockFile(fd: number): void {
	const buf = Buffer.from(JSON.stringify({ pid: process.pid, time: Date.now() }), "utf-8");
	require("node:fs").writeSync(fd, buf);
}
