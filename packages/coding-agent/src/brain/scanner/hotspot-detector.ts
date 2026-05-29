/**
 * Hotspot Detector — V5.05
 *
 * Identifies files and directories with high change frequency (hotspots)
 * by analyzing git log history.
 *
 * Hotspots indicate code churn areas that may benefit from refactoring,
 * additional test coverage, or architectural review. The detector uses
 * only read-only git operations and never mutates repo state.
 *
 * @packageDocumentation
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

import type { EvidenceRef } from "../evidence/types.js";
import type { Hotspot, ScannerOptions } from "./types.js";
import { DEFAULT_SCANNER_OPTIONS, hotspotSeverity } from "./types.js";

// =========================================================================
// File Change Record
// =========================================================================

/** Internal record of changes detected for a file. */
interface FileChangeRecord {
	/** File path relative to project root. */
	path: string;
	/** Number of commits that touched this file. */
	changeCount: number;
	/** Unique authors who touched this file. */
	authors: Set<string>;
	/** Lines added across all changes. */
	linesAdded: number;
	/** Lines removed across all changes. */
	linesRemoved: number;
}

// =========================================================================
// Hotspot Detector
// =========================================================================

/**
 * Detects hotspots by analyzing git log for high-change-frequency files.
 *
 * Algorithm:
 * 1. Run `git log --numstat` for the configured commit window
 * 2. Parse per-file change counts, authors, and line changes
 * 3. Filter files exceeding the hotspot threshold
 * 4. Group co-located files into directory-level hotspots
 * 5. Rank by change count and severity
 */
export class HotspotDetector {
	private readonly projectRoot: string;
	private readonly options: Required<Omit<ScannerOptions, "projectRoot" | "piDir">>;

	constructor(options: ScannerOptions) {
		this.projectRoot = options.projectRoot;
		this.options = {
			gitPath: options.gitPath ?? DEFAULT_SCANNER_OPTIONS.gitPath!,
			hotspotMinChanges: options.hotspotMinChanges ?? DEFAULT_SCANNER_OPTIONS.hotspotMinChanges!,
			hotspotCommitWindow: options.hotspotCommitWindow ?? DEFAULT_SCANNER_OPTIONS.hotspotCommitWindow!,
			riskThreshold: options.riskThreshold ?? DEFAULT_SCANNER_OPTIONS.riskThreshold!,
			largeDiffThreshold: options.largeDiffThreshold ?? DEFAULT_SCANNER_OPTIONS.largeDiffThreshold!,
			staleThresholdDays: options.staleThresholdDays ?? DEFAULT_SCANNER_OPTIONS.staleThresholdDays!,
			correlationMinFailures: options.correlationMinFailures ?? DEFAULT_SCANNER_OPTIONS.correlationMinFailures!,
			maxResults: options.maxResults ?? DEFAULT_SCANNER_OPTIONS.maxResults!,
		};
	}

	// =======================================================================
	// Public API
	// =======================================================================

	/**
	 * Scan the project for hotspots.
	 *
	 * Analyzes the recent commit history and returns files and directories
	 * with unusually high change frequency.
	 *
	 * @returns Array of hotspots sorted by change count descending
	 */
	async scan(): Promise<Hotspot[]> {
		try {
			const records = await this.collectChangeRecords();
			if (records.size === 0) return [];

			const hotspots = this.rankHotspots(records);

			// Build evidence for the analysis
			const evidence: EvidenceRef = {
				type: "git_file",
				id: `hotspot-analysis:${this.options.hotspotCommitWindow}commits`,
				label: "Git log hotspot analysis",
				description: `Analyzed ${this.options.hotspotCommitWindow} recent commits for change frequency patterns`,
				timestamp: new Date().toISOString(),
				confidence: 0.85,
			};

			// Attach evidence to each hotspot and sort
			return hotspots.map((h) => ({
				...h,
				evidence: [evidence, ...h.evidence],
			}));
		} catch (_error) {
			// Not a git repo or git not available
			return [];
		}
	}

	// =======================================================================
	// Data Collection
	// =======================================================================

	/**
	 * Collect per-file change records from git log.
	 */
	private async collectChangeRecords(): Promise<Map<string, FileChangeRecord>> {
		const records = new Map<string, FileChangeRecord>();

		// Use git log with numstat for per-file change counts
		// Format: <added>\t<removed>\t<filepath>
		const output = await this.execGit([
			"log",
			`-${this.options.hotspotCommitWindow}`,
			"--format=commit %H",
			"--numstat",
		]);

		if (!output) return records;

		const lines = output.split("\n");
		let currentCommit: string | null = null;

		for (const line of lines) {
			// Commit header
			if (line.startsWith("commit ")) {
				currentCommit = line.slice(7).trim();
				continue;
			}

			// numstat line: <added>\t<removed>\t<filepath>
			const numstatMatch = line.match(/^(\d+)\t(\d+)\t(.+)$/);
			if (!numstatMatch || !currentCommit) continue;

			const added = parseInt(numstatMatch[1], 10);
			const removed = parseInt(numstatMatch[2], 10);
			const filePath = numstatMatch[3];

			// Skip binary files and git directory
			if (filePath.startsWith(".git/") || filePath === "-") continue;

			const existing = records.get(filePath);
			if (existing) {
				existing.changeCount++;
				existing.linesAdded += added;
				existing.linesRemoved += removed;
			} else {
				records.set(filePath, {
					path: filePath,
					changeCount: 1,
					authors: new Set(),
					linesAdded: added,
					linesRemoved: removed,
				});
			}
		}

		// Get author info per file using git log --follow
		// We do this in batch for all files above the threshold
		const thresholdRecords = Array.from(records.values()).filter(
			(r) => r.changeCount >= this.options.hotspotMinChanges,
		);

		for (const record of thresholdRecords) {
			try {
				const authorOutput = await this.execGit([
					"log",
					`-${this.options.hotspotCommitWindow}`,
					"--format=%ae",
					"--follow",
					"--",
					record.path,
				]);
				if (authorOutput) {
					const authors = authorOutput.split("\n").filter((a) => a.length > 0);
					for (const author of authors) {
						record.authors.add(author);
					}
				}
			} catch {
				// Non-fatal; author count will be unavailable for this file
			}
		}

		return records;
	}

	// =======================================================================
	// Hotspot Ranking
	// =======================================================================

	/**
	 * Rank collected records into hotspots.
	 *
	 * Returns both file-level hotspots (above threshold) and directory-level
	 * hotspots (directories where aggregate change count is high).
	 */
	private rankHotspots(records: Map<string, FileChangeRecord>): Hotspot[] {
		const hotspots: Hotspot[] = [];
		const threshold = this.options.hotspotMinChanges;

		// 1. File-level hotspots
		const fileRecords = Array.from(records.values())
			.filter((r) => r.changeCount >= threshold)
			.sort((a, b) => b.changeCount - a.changeCount);

		for (const record of fileRecords) {
			const severity = hotspotSeverity(record.changeCount, threshold);
			hotspots.push({
				path: record.path,
				entityType: "file",
				changeCount: record.changeCount,
				contributorCount: record.authors.size > 0 ? record.authors.size : undefined,
				linesAdded: record.linesAdded,
				linesRemoved: record.linesRemoved,
				severity,
				evidence: [],
				summary: `Hotspot (${record.changeCount} changes): ${record.path}`,
				metadata: {
					authors: record.authors.size > 0 ? Array.from(record.authors) : undefined,
				},
			});
		}

		// 2. Directory-level hotspots
		const dirAggregates = this.aggregateByDirectory(fileRecords);
		for (const [dirPath, aggregate] of dirAggregates) {
			if (aggregate.totalChanges >= threshold * 2) {
				const severity = hotspotSeverity(aggregate.totalChanges, threshold);
				hotspots.push({
					path: dirPath,
					entityType: "directory",
					changeCount: aggregate.totalChanges,
					contributorCount: aggregate.uniqueAuthors.size > 0 ? aggregate.uniqueAuthors.size : undefined,
					severity,
					evidence: [],
					summary: `Directory hotspot (${aggregate.totalChanges} changes across ${aggregate.fileCount} files): ${dirPath}`,
					metadata: {
						fileCount: aggregate.fileCount,
						topFiles: aggregate.topFiles,
					},
				});
			}
		}

		// Sort: critical first, then by change count
		hotspots.sort((a, b) => {
			const severityOrder = { critical: 0, warning: 1, info: 2 };
			const aOrder = severityOrder[a.severity];
			const bOrder = severityOrder[b.severity];
			if (aOrder !== bOrder) return aOrder - bOrder;
			return b.changeCount - a.changeCount;
		});

		return hotspots.slice(0, this.options.maxResults);
	}

	/**
	 * Aggregate file-level hotspots by directory.
	 */
	private aggregateByDirectory(
		fileRecords: FileChangeRecord[],
	): Map<string, { totalChanges: number; fileCount: number; uniqueAuthors: Set<string>; topFiles: string[] }> {
		const dirs = new Map<
			string,
			{
				totalChanges: number;
				fileCount: number;
				uniqueAuthors: Set<string>;
				files: Array<{ path: string; count: number }>;
			}
		>();

		for (const record of fileRecords) {
			const dirPath = this.getTopLevelDirectory(record.path);
			const existing = dirs.get(dirPath) || {
				totalChanges: 0,
				fileCount: 0,
				uniqueAuthors: new Set<string>(),
				files: [],
			};

			existing.totalChanges += record.changeCount;
			existing.fileCount++;
			for (const author of record.authors) {
				existing.uniqueAuthors.add(author);
			}
			existing.files.push({ path: record.path, count: record.changeCount });
			dirs.set(dirPath, existing);
		}

		const result = new Map<
			string,
			{ totalChanges: number; fileCount: number; uniqueAuthors: Set<string>; topFiles: string[] }
		>();

		for (const [dirPath, data] of dirs) {
			const topFiles = data.files
				.sort((a, b) => b.count - a.count)
				.slice(0, 5)
				.map((f) => f.path);
			result.set(dirPath, {
				totalChanges: data.totalChanges,
				fileCount: data.fileCount,
				uniqueAuthors: data.uniqueAuthors,
				topFiles,
			});
		}

		return result;
	}

	/**
	 * Extract the top-level directory from a file path.
	 * For root-level files, returns "root".
	 */
	private getTopLevelDirectory(filePath: string): string {
		const parts = filePath.split("/");
		return parts.length > 1 ? parts[0] : "root";
	}

	// =======================================================================
	// Git Operations (Read-only)
	// =======================================================================

	/**
	 * Execute a git command. Only read-only commands are used.
	 */
	private async execGit(args: string[]): Promise<string> {
		const { stdout } = await execFileAsync(this.options.gitPath, args, {
			cwd: this.projectRoot,
			encoding: "utf-8",
			timeout: 60_000,
		});
		return stdout.trim();
	}
}

// =========================================================================
// Factory
// =========================================================================

/**
 * Create a HotspotDetector instance.
 *
 * @param options - Scanner options including project root
 * @returns A new HotspotDetector
 */
export function createHotspotDetector(options: ScannerOptions): HotspotDetector {
	return new HotspotDetector(options);
}
