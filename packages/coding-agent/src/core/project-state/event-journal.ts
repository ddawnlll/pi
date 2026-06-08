/**
 * ProjectStateEventJournal — PSS-MEGA-02
 *
 * Monotonic NDJSON event journal with lock-based append.
 * Stores events under .pi/project-state/event-journal.ndjson.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProjectStateEvent, ProjectStateEventEnvelope } from "./event-types.js";
import { getStateDir } from "./paths.js";

/** Journal file name */
const JOURNAL_FILE = "event-journal.ndjson";

/** Lock file name */
const LOCK_FILE = "event-journal.lock";

/** Default lock timeout (ms) */
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;

/** Stale lock threshold (ms) — if lock is older than this, it's considered stale */
const STALE_LOCK_MS = 10_000;

/** Compaction threshold: if journal exceeds this size or event count, recommend compaction */
const COMPACTION_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const COMPACTION_EVENT_COUNT = 10_000;

export interface JournalStats {
	totalEvents: number;
	lastSequence: number;
	journalPath: string;
	journalSizeBytes: number;
	needsCompaction: boolean;
}

/**
 * Event journal with monotonic NDJSON append and lock-based concurrency.
 */
export class ProjectStateEventJournal {
	private rootDir: string;
	private journalPath: string;
	private lockPath: string;
	private archivesDir: string;
	private sessionId: string;
	private _lastSequence: number;

	constructor(rootDir: string, sessionId?: string) {
		this.rootDir = resolve(rootDir);
		const stateDir = getStateDir(this.rootDir);
		this.journalPath = join(stateDir, JOURNAL_FILE);
		this.lockPath = join(stateDir, LOCK_FILE);
		this.archivesDir = join(stateDir, "archives");
		this.sessionId = sessionId ?? "unknown";
		this._lastSequence = this.readLastSequence();

		// Ensure state directory exists
		if (!existsSync(stateDir)) {
			mkdirSync(stateDir, { recursive: true });
		}
	}

	/**
	 * Append an event to the journal with a monotonic sequence number.
	 * Returns the assigned sequence number, or -1 if locking failed.
	 */
	append(
		event: ProjectStateEvent,
		source: ProjectStateEventEnvelope["source"],
		metadata?: {
			planExecutionId?: string;
			workspaceId?: string;
			toolCallId?: string;
			cwd?: string;
		},
	): number {
		const lockAcquired = this.acquireLock();
		if (!lockAcquired) {
			return -1;
		}

		try {
			const sequence = this._lastSequence + 1;
			const envelope: ProjectStateEventEnvelope = {
				eventId: randomUUID().slice(0, 12),
				sequence,
				timestamp: new Date().toISOString(),
				sessionId: this.sessionId,
				...metadata,
				cwd: metadata?.cwd ?? this.rootDir,
				source,
				event,
			};

			// Append NDJSON line
			writeFileSync(this.journalPath, JSON.stringify(envelope) + "\n", { encoding: "utf-8", flag: "a" });

			this._lastSequence = sequence;
			return sequence;
		} finally {
			this.releaseLock();
		}
	}

	/**
	 * Load all events with sequence > minSequence.
	 * Returns sorted by sequence.
	 */
	loadEvents(minSequence = 0): ProjectStateEventEnvelope[] {
		try {
			if (!existsSync(this.journalPath)) return [];

			const content = readFileSync(this.journalPath, "utf-8");
			const lines = content.trim().split("\n").filter(Boolean);
			const events: ProjectStateEventEnvelope[] = [];

			for (let i = 0; i < lines.length; i++) {
				try {
					const envelope = JSON.parse(lines[i]) as ProjectStateEventEnvelope;
					if (envelope.sequence > minSequence) {
						events.push(envelope);
					}
				} catch {
					// Skip malformed lines
				}
			}

			return events.sort((a, b) => a.sequence - b.sequence);
		} catch {
			return [];
		}
	}

	/**
	 * Load all events since the given sequence.
	 */
	loadUnappliedEvents(lastAppliedSequence: number): ProjectStateEventEnvelope[] {
		return this.loadEvents(lastAppliedSequence);
	}

	/**
	 * Get journal statistics.
	 */
	getStats(): JournalStats {
		let journalSizeBytes = 0;
		try {
			const stat = require("node:fs").statSync(this.journalPath);
			journalSizeBytes = stat.size;
		} catch {
			// File may not exist
		}

		const totalEvents = this._lastSequence;
		return {
			totalEvents,
			lastSequence: this._lastSequence,
			journalPath: this.journalPath,
			journalSizeBytes,
			needsCompaction: journalSizeBytes > COMPACTION_SIZE_BYTES || totalEvents > COMPACTION_EVENT_COUNT,
		};
	}

	/**
	 * Get the last assigned sequence number.
	 */
	getLastSequence(): number {
		return this._lastSequence;
	}

	/**
	 * Check if the journal file exists.
	 */
	exists(): boolean {
		return existsSync(this.journalPath);
	}

	/**
	 * Get the journal file path.
	 */
	getJournalPath(): string {
		return this.journalPath;
	}

	/**
	 * Basic compaction: archive old events up to the given sequence.
	 * This is a placeholder for a more sophisticated compaction strategy.
	 * Returns true if compaction was performed.
	 */
	compact(upToSequence: number): boolean {
		const stats = this.getStats();
		if (!stats.needsCompaction) return false;

		const lockAcquired = this.acquireLock();
		if (!lockAcquired) return false;

		try {
			// Archive current journal
			if (!existsSync(this.archivesDir)) {
				mkdirSync(this.archivesDir, { recursive: true });
			}

			const archiveName = `event-journal-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`;
			const archivePath = join(this.archivesDir, archiveName);

			// Keep only events > upToSequence
			const allEvents = this.loadEvents(0);
			const tailEvents = allEvents.filter((e) => e.sequence > upToSequence);

			// Write archive
			if (allEvents.length > 0) {
				const archiveContent = allEvents
					.filter((e) => e.sequence <= upToSequence)
					.map((e) => JSON.stringify(e))
					.join("\n");
				writeFileSync(archivePath, archiveContent + "\n", "utf-8");
			}

			// Rewrite journal with tail events only
			const journalContent = tailEvents.map((e) => JSON.stringify(e)).join("\n");
			writeFileSync(this.journalPath, journalContent ? journalContent + "\n" : "", "utf-8");

			this._lastSequence = upToSequence;
			return true;
		} finally {
			this.releaseLock();
		}
	}

	// ============================================================================
	// Lock Implementation
	// ============================================================================

	/**
	 * Acquire the journal lock with timeout and stale detection.
	 */
	private acquireLock(): boolean {
		const start = Date.now();

		while (Date.now() - start < DEFAULT_LOCK_TIMEOUT_MS) {
			try {
				// Check for stale lock
				if (existsSync(this.lockPath)) {
					try {
						const lockStat = require("node:fs").statSync(this.lockPath);
						if (Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
							// Stale lock — remove it
							require("node:fs").rmSync(this.lockPath, { force: true });
						}
					} catch {
						// Ignore stat errors
					}
				}

				// Try to create lock file exclusively
				const fd = require("node:fs").openSync(this.lockPath, "wx");
				writeFileSync(fd, JSON.stringify({ pid: process.pid, time: Date.now() }), "utf-8");
				require("node:fs").closeSync(fd);
				return true;
			} catch {
				// Lock acquisition failed — wait and retry
				const waitMs = 50 + Math.random() * 50; // 50-100ms jitter
				require("node:timers").setTimeout(() => {}, waitMs); // not using setTimeoutSync, just busy-wait
				// Use a tighter busy-wait pattern
				const deadline = Date.now() + waitMs;
				while (Date.now() < deadline) {
					// busy wait
				}
			}
		}

		return false;
	}

	/**
	 * Release the journal lock.
	 */
	private releaseLock(): void {
		try {
			if (existsSync(this.lockPath)) {
				require("node:fs").rmSync(this.lockPath, { force: true });
			}
		} catch {
			// Best-effort lock release
		}
	}

	/**
	 * Read the last sequence from the journal file by scanning the last line.
	 */
	private readLastSequence(): number {
		try {
			if (!existsSync(this.journalPath)) return 0;

			const content = readFileSync(this.journalPath, "utf-8");
			const lines = content.trim().split("\n").filter(Boolean);
			if (lines.length === 0) return 0;

			// Try the last line first (most common)
			const lastLine = lines[lines.length - 1];
			try {
				const last = JSON.parse(lastLine) as ProjectStateEventEnvelope;
				return last.sequence;
			} catch {
				// Fall back to scanning all lines
				let maxSeq = 0;
				for (const line of lines) {
					try {
						const env = JSON.parse(line) as ProjectStateEventEnvelope;
						if (env.sequence > maxSeq) maxSeq = env.sequence;
					} catch {
						// Skip malformed
					}
				}
				return maxSeq;
			}
		} catch {
			return 0;
		}
	}
}
