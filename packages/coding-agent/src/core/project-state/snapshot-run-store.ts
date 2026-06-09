/**
 * SnapshotRunStore
 *
 * Persists snapshot run state for resume/cancel support.
 * Stores individual run files under .pi/project-state/snapshot-runs/<runId>.json
 */

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { atomicWriteJson, readJsonFile } from "./atomic-write.js";
import { ensureDir, getSnapshotRunFilePath, getSnapshotRunsDir } from "./paths.js";
import type { SnapshotRunState } from "./types.js";

/**
 * SnapshotRunStore
 *
 * Manages snapshot run persistence for resume/cancel support.
 */
export class SnapshotRunStore {
	private rootDir: string;
	private runsDir: string;

	constructor(rootDir: string) {
		this.rootDir = resolve(rootDir);
		this.runsDir = getSnapshotRunsDir(this.rootDir);
	}

	/**
	 * Ensure runs directory exists.
	 */
	ensureRunsDir(): void {
		ensureDir(this.runsDir);
	}

	/**
	 * Create a new snapshot run state.
	 */
	createRunState(pendingFiles: string[]): SnapshotRunState {
		this.ensureRunsDir();
		const runId = randomUUID().slice(0, 12);
		const runState: SnapshotRunState = {
			snapshotRunId: runId,
			rootDir: this.rootDir,
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			status: "running",
			phase: "discovering",
			completedFiles: [],
			failedFiles: [],
			pendingFiles,
			rawBytes: 0,
			compactBytes: 0,
			estimatedTokensSaved: 0,
		};
		this.saveRunState(runState);
		return runState;
	}

	/**
	 * Save a snapshot run state.
	 */
	saveRunState(runState: SnapshotRunState): void {
		runState.updatedAt = new Date().toISOString();
		atomicWriteJson(runState, getSnapshotRunFilePath(this.rootDir, runState.snapshotRunId));
	}

	/**
	 * Load a specific snapshot run state by ID.
	 */
	loadRunState(runId: string): SnapshotRunState | undefined {
		return readJsonFile<SnapshotRunState>(getSnapshotRunFilePath(this.rootDir, runId));
	}

	/**
	 * Find the latest interrupted or running snapshot run.
	 * Returns undefined if no resumable run exists.
	 */
	findLatestResumableRun(): SnapshotRunState | undefined {
		if (!existsSync(this.runsDir)) return undefined;

		let files: string[];
		try {
			files = readdirSync(this.runsDir);
		} catch {
			return undefined;
		}

		// Sort by name descending (UUID-based names sort roughly by time)
		files.sort().reverse();

		for (const f of files) {
			if (!f.endsWith(".json")) continue;
			const runId = f.replace(/\.json$/, "");
			const runState = this.loadRunState(runId);
			if (runState && (runState.status === "running" || runState.status === "interrupted")) {
				return runState;
			}
		}

		return undefined;
	}

	/**
	 * List all run states.
	 */
	listAllRuns(): SnapshotRunState[] {
		if (!existsSync(this.runsDir)) return [];

		let files: string[];
		try {
			files = readdirSync(this.runsDir);
		} catch {
			return [];
		}

		const runs: SnapshotRunState[] = [];
		for (const f of files.sort().reverse()) {
			if (!f.endsWith(".json")) continue;
			const runId = f.replace(/\.json$/, "");
			const runState = this.loadRunState(runId);
			if (runState) {
				runs.push(runState);
			}
		}
		return runs;
	}

	/**
	 * Mark a run as completed.
	 */
	markCompleted(runState: SnapshotRunState): void {
		runState.status = "completed";
		this.saveRunState(runState);
	}

	/**
	 * Mark a run as failed.
	 */
	markFailed(runState: SnapshotRunState, _error: string): void {
		runState.status = "failed";
		this.saveRunState(runState);
	}

	/**
	 * Mark a run as interrupted.
	 */
	markInterrupted(runState: SnapshotRunState): void {
		runState.status = "interrupted";
		this.saveRunState(runState);
	}

	/**
	 * Add a completed file to the run state.
	 */
	addCompletedFile(runState: SnapshotRunState, filePath: string): void {
		if (!runState.completedFiles.includes(filePath)) {
			runState.completedFiles.push(filePath);
		}
		this.saveRunState(runState);
	}

	/**
	 * Add a failed file to the run state.
	 */
	addFailedFile(runState: SnapshotRunState, filePath: string, error: string): void {
		runState.failedFiles.push({ path: filePath, error });
		this.saveRunState(runState);
	}

	/**
	 * Update run phase.
	 */
	updatePhase(runState: SnapshotRunState, phase: string): void {
		runState.phase = phase;
		this.saveRunState(runState);
	}
}
