/**
 * Failure Correlator — V5.05
 *
 * Correlates execution failures with specific files and areas in the
 * repository by cross-referencing execution journal entries with git
 * blame information and error patterns.
 *
 * All operations are read-only: reads the execution journal from disk
 * and uses git blame (read-only) to identify files touched by failed
 * workspaces. Never mutates repo state or calls git push.
 *
 * @packageDocumentation
 */

import { execFile as execFileCb } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

import type { EvidenceRef } from "../evidence/types.js";
import type { FailureCorrelation, ScannerOptions } from "./types.js";
import { correlationSeverity, DEFAULT_SCANNER_OPTIONS } from "./types.js";

// =========================================================================
// Execution Journal Entry (local minimal type)
// =========================================================================

/** A single entry in the execution journal NDJSON file. */
interface JournalEntry {
	type: string;
	timestamp: string;
	workspaceId?: string;
	planExecId?: string;
	role?: string;
	attempt?: number;
	verdict?: string;
	error?: string;
	duration?: number;
	[key: string]: unknown;
}

// =========================================================================
// Parsed Failure Record
// =========================================================================

/** Internal record of a failure extracted from the execution journal. */
interface FailureRecord {
	workspaceId: string;
	planExecId?: string;
	error: string;
	errorKey: string;
	timestamp: string;
	attempt: number;
	role?: string;
	/** Files implicated via git blame, populated lazily. */
	implicatedFiles?: string[];
}

// =========================================================================
// Failure Correlator
// =========================================================================

/**
 * Correlates execution failures with repository files.
 *
 * Process:
 * 1. Read `.pi/execution-journal.ndjson` for failed workspace entries
 * 2. For each failure, extract error message and affected workspace files
 * 3. Cross-reference with git blame to identify files changed in the workspace
 * 4. Aggregate correlations: count failures per file, extract error patterns
 * 5. Compute confidence based on failure count and error consistency
 */
export class FailureCorrelator {
	private readonly projectRoot: string;
	private readonly piDir: string;
	private readonly options: Required<Omit<ScannerOptions, "projectRoot" | "piDir">>;

	constructor(options: ScannerOptions) {
		this.projectRoot = options.projectRoot;
		this.piDir = options.piDir ?? DEFAULT_SCANNER_OPTIONS.piDir!;
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
	 * Scan for failure correlations.
	 *
	 * Reads the execution journal and cross-references failures with files
	 * to identify correlation patterns.
	 *
	 * @returns Array of failure correlations sorted by confidence descending
	 */
	async scan(): Promise<FailureCorrelation[]> {
		try {
			// 1. Read execution journal and extract failures
			const failures = this.readExecutionJournal();
			if (failures.length === 0) return [];

			// 2. For each failure, attempt to identify implicated files
			await this.populateImplicatedFiles(failures);

			// 3. Aggregate by file path
			const fileCorrelations = this.aggregateCorrelations(failures);

			// 4. Filter by minimum failure count and sort
			const minFailures = this.options.correlationMinFailures;
			const correlations = Array.from(fileCorrelations.values())
				.filter((c) => c.failureCount >= minFailures)
				.sort((a, b) => b.correlationConfidence - a.correlationConfidence);

			return correlations.slice(0, this.options.maxResults);
		} catch {
			return [];
		}
	}

	// =======================================================================
	// Execution Journal Reader
	// =======================================================================

	/**
	 * Read the execution journal and extract failure records.
	 */
	private readExecutionJournal(): FailureRecord[] {
		const journalPath = join(this.projectRoot, this.piDir, "execution-journal.ndjson");

		if (!existsSync(journalPath)) {
			return [];
		}

		const failures: FailureRecord[] = [];

		try {
			const content = readFileSync(journalPath, "utf-8");
			const lines = content.split("\n").filter((l) => l.trim().length > 0);

			for (const line of lines) {
				try {
					const entry = JSON.parse(line) as JournalEntry;
					if (
						(entry.type === "workspace_complete" && entry.verdict === "failed") ||
						entry.type === "workspace_retry" ||
						(entry.type === "retry" && entry.error)
					) {
						const error = entry.error || "unknown error";
						failures.push({
							workspaceId: entry.workspaceId || "unknown",
							planExecId: entry.planExecId,
							error,
							errorKey: this.normalizeError(error),
							timestamp: entry.timestamp,
							attempt: entry.attempt || 1,
							role: entry.role,
						});
					}
				} catch {
					// Skip corrupted lines
				}
			}
		} catch {
			// Cannot read journal
		}

		return failures;
	}

	// =======================================================================
	// Git Blame-Based File Implication
	// =======================================================================

	/**
	 * For each failure, identify files that may be implicated.
	 *
	 * Uses the workspaceId to look up files that were modified around the
	 * time of failure, using git diff (read-only) and git log.
	 */
	private async populateImplicatedFiles(failures: FailureRecord[]): Promise<void> {
		// Get recently changed files in the repo (git diff HEAD~10 --name-only)
		let recentFiles: string[] = [];
		try {
			const output = await this.execGit(["log", "-20", "--name-only", "--format=", "--diff-filter=AMR"]);
			if (output) {
				recentFiles = [...new Set(output.split("\n").filter((f) => f.length > 0 && !f.startsWith(".git/")))];
			}
		} catch {
			// Git not available; use workspaceId heuristic
		}

		for (const failure of failures) {
			// If we have recent files, correlate by matching workspaceId patterns
			if (recentFiles.length > 0) {
				// Match workspace IDs to file paths that contain the workspaceId
				// or are in a directory with a matching name
				const implicated = recentFiles.filter((f) => this.fileMatchesWorkspace(f, failure.workspaceId));

				failure.implicatedFiles = implicated.length > 0 ? implicated : recentFiles.slice(0, 5);
			} else {
				// No git data: use empty list
				failure.implicatedFiles = [];
			}
		}
	}

	/**
	 * Check if a file path is plausibly related to a workspace.
	 *
	 * Heuristic: file path contains the workspaceId string, or the
	 * workspace directory name appears in the path.
	 */
	private fileMatchesWorkspace(filePath: string, workspaceId: string): boolean {
		const lowerPath = filePath.toLowerCase();
		const lowerId = workspaceId.toLowerCase();

		// Direct path containment
		if (lowerPath.includes(lowerId)) return true;

		// Workspace ID often encodes the plan area; check if directory matches
		const idParts = lowerId.split(/[-_/]/);
		for (const part of idParts) {
			if (part.length > 3 && lowerPath.includes(part)) return true;
		}

		return false;
	}

	// =======================================================================
	// Correlation Aggregation
	// =======================================================================

	/**
	 * Aggregate failure records into per-file failure correlations.
	 */
	private aggregateCorrelations(failures: FailureRecord[]): Map<string, FailureCorrelation> {
		const correlations = new Map<string, FailureCorrelation>();

		// Track per-file: failure count and error patterns
		const fileFailures = new Map<string, { count: number; errors: Map<string, number>; workspaceIds: Set<string> }>();

		for (const failure of failures) {
			const files = failure.implicatedFiles?.length ? failure.implicatedFiles : [];

			if (files.length === 0) {
				// Use a generic "unknown" path for failures with no file correlation
				const key = "unknown";
				const existing = fileFailures.get(key) || { count: 0, errors: new Map(), workspaceIds: new Set() };
				existing.count++;
				existing.errors.set(failure.errorKey, (existing.errors.get(failure.errorKey) || 0) + 1);
				existing.workspaceIds.add(failure.workspaceId);
				fileFailures.set(key, existing);
				continue;
			}

			for (const file of files) {
				const existing = fileFailures.get(file) || { count: 0, errors: new Map(), workspaceIds: new Set() };
				existing.count++;
				existing.errors.set(failure.errorKey, (existing.errors.get(failure.errorKey) || 0) + 1);
				existing.workspaceIds.add(failure.workspaceId);
				fileFailures.set(file, existing);
			}
		}

		// Build FailureCorrelation objects
		const evidence: EvidenceRef = {
			type: "execution_journal",
			id: "failure-correlation-analysis",
			label: "Failure correlation from execution journal",
			description: `Correlated ${failures.length} failure records from execution journal with repository files`,
			timestamp: new Date().toISOString(),
			confidence: 0.8,
			sourcePath: join(this.piDir, "execution-journal.ndjson"),
		};

		for (const [path, data] of fileFailures) {
			if (data.count === 0) continue;

			const sortedErrors = Array.from(data.errors.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([error]) => error);

			// Confidence: more failures with consistent error patterns = higher confidence
			const errorConsistency = data.errors.size > 0 ? 1 / data.errors.size : 0;
			const countFactor = Math.min(data.count / 10, 1);
			const correlationConfidence = Math.min(countFactor * 0.6 + errorConsistency * 0.4, 0.95);

			const severity = correlationSeverity(data.count, correlationConfidence);

			correlations.set(path, {
				path: path === "unknown" ? "(unable to correlate)" : path,
				failureCount: data.count,
				errorPatterns: sortedErrors,
				correlationConfidence: Math.round(correlationConfidence * 100) / 100,
				severity,
				evidence: [evidence],
				summary: `${data.count} failure(s) correlated with '${path}' — top error: ${sortedErrors[0] || "unknown"}`,
				metadata: {
					uniqueWorkspaceIds: Array.from(data.workspaceIds),
					errorCount: data.errors.size,
					errorConsistency: Math.round(errorConsistency * 100) / 100,
				},
			});
		}

		return correlations;
	}

	// =======================================================================
	// Error Normalization
	// =======================================================================

	/**
	 * Normalize an error message to a stable key for grouping.
	 *
	 * Strips variable parts (timestamps, numbers, paths) to group
	 * similar errors together.
	 */
	private normalizeError(error: string): string {
		// Remove timestamps
		let normalized = error.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, "<timestamp>");

		// Remove file paths (Unix and Windows)
		normalized = normalized.replace(/\/[\w./-]+\.[a-z]+/g, "<path>");
		normalized = normalized.replace(/[A-Z]:\\[\w.-]+\.[a-z]+/g, "<path>");

		// Remove numbers
		normalized = normalized.replace(/\d+/g, "<N>");

		// Remove commit hashes
		normalized = normalized.replace(/[a-f0-9]{7,40}/g, "<hash>");

		// Truncate to 200 chars
		return normalized.slice(0, 200);
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
			timeout: 30_000,
		});
		return stdout.trim();
	}
}

// =========================================================================
// Factory
// =========================================================================

/**
 * Create a FailureCorrelator instance.
 *
 * @param options - Scanner options including project root
 * @returns A new FailureCorrelator
 */
export function createFailureCorrelator(options: ScannerOptions): FailureCorrelator {
	return new FailureCorrelator(options);
}
