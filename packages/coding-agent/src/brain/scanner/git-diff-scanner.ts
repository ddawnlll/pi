/**
 * Git Diff Scanner — V5.05
 *
 * Analyzes git diffs to identify risky/unusual changes using only
 * read-only git operations. Never calls git push or any mutation.
 *
 * Risk heuristics:
 * - Large total change size (lines added + removed > threshold)
 * - Touching many files or multiple functional areas
 * - High churn (near-equal add/remove suggesting rewrite)
 * - Touching both implementation and test files in suspicious proportions
 *
 * @packageDocumentation
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

import type { EvidenceRef } from "../evidence/types.js";
import type { RiskyDiff, ScannerOptions } from "./types.js";
import { DEFAULT_SCANNER_OPTIONS, riskScoreToSeverity } from "./types.js";

// =========================================================================
// Git Diff Scanner
// =========================================================================

/**
 * Read-only git diff scanner.
 *
 * Performs all git operations with read-only commands:
 * - git diff (without --cached or staged changes)
 * - git log (for commit metadata)
 * - git show (for individual commit diffs)
 *
 * Never calls: git push, git add, git commit, git checkout, or any
 * command that mutates repo state.
 */
export class GitDiffScanner {
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
	 * Scan the project's recent commit history for risky diffs.
	 *
	 * Analyzes the N most recent commits and flags those that exceed
	 * the configured risk threshold.
	 *
	 * @returns Array of risky diffs, sorted by risk score descending
	 */
	async scanRecentCommits(): Promise<RiskyDiff[]> {
		const riskyDiffs: RiskyDiff[] = [];

		try {
			// Get the N most recent commit hashes
			const commitHashes = await this.gitLogCommitHashes(this.options.hotspotCommitWindow);
			if (commitHashes.length === 0) return [];

			const evidence: EvidenceRef = {
				type: "git_file",
				id: `git-log:${commitHashes[0]}..${commitHashes[commitHashes.length - 1]}`,
				label: "Git commit log analysis",
				description: `Analyzed ${commitHashes.length} recent commits for risk patterns`,
				timestamp: new Date().toISOString(),
				confidence: 0.9,
			};

			for (const hash of commitHashes) {
				try {
					const diffInfo = await this.analyzeCommitRisk(hash);
					if (diffInfo) {
						diffInfo.evidence.push(evidence);
						riskyDiffs.push(diffInfo);
					}
				} catch {
					// Skip individual commit failures; non-fatal
				}
			}

			// Sort by risk score descending and limit results
			riskyDiffs.sort((a, b) => b.riskScore - a.riskScore);
			return riskyDiffs.slice(0, this.options.maxResults);
		} catch (_error) {
			// If git is not available or not a git repo, return empty
			return [];
		}
	}

	/**
	 * Scan uncommitted changes for risk.
	 *
	 * Analyzes the working tree diff (git diff HEAD) for risky patterns
	 * in uncommitted changes.
	 *
	 * @returns A single RiskyDiff for uncommitted changes, or null if clean
	 */
	async scanUncommittedChanges(): Promise<RiskyDiff | null> {
		try {
			const diffStatOutput = await this.execGit(["diff", "HEAD", "--stat", `--diff-filter=AMR`]);

			if (!diffStatOutput || diffStatOutput.trim().length === 0) {
				return null; // No uncommitted changes
			}

			const filesChanged = this.parseDiffStatFiles(diffStatOutput);
			const lineCounts = this.parseDiffStatLineCounts(diffStatOutput);

			if (filesChanged.length === 0) {
				return null;
			}

			const evidence: EvidenceRef = {
				type: "git_file",
				id: "uncommitted-diff",
				label: "Uncommitted changes diff",
				description: `Analyzed uncommitted changes across ${filesChanged.length} file(s)`,
				timestamp: new Date().toISOString(),
				confidence: 0.9,
				sourcePath: this.projectRoot,
			};

			const totalChanges = lineCounts.added + lineCounts.removed;
			const touchesMultipleAreas = this.detectsMultipleAreas(filesChanged);
			const churnRatio = lineCounts.added > 0 ? Math.min(lineCounts.removed / lineCounts.added, 1) : 0;

			const riskScore = this.computeRiskScore(totalChanges, filesChanged.length, touchesMultipleAreas, churnRatio);

			const riskyDiff: RiskyDiff = {
				commitHash: "uncommitted",
				commitMessage: "Uncommitted working tree changes",
				filesChanged,
				linesAdded: lineCounts.added,
				linesRemoved: lineCounts.removed,
				totalChanges,
				touchesMultipleAreas,
				riskScore,
				severity: riskScoreToSeverity(riskScore),
				evidence: [evidence],
				summary: this.buildRiskyDiffSummary("uncommitted", filesChanged.length, totalChanges, riskScore),
				metadata: {
					churnRatio,
					fileCount: filesChanged.length,
				},
			};

			return riskScore >= this.options.riskThreshold ? riskyDiff : null;
		} catch {
			return null;
		}
	}

	/**
	 * Scan a specific commit by hash for risk.
	 *
	 * @param commitHash - The git commit hash to analyze
	 * @returns A RiskyDiff if the commit exceeds the risk threshold, or null
	 */
	async scanCommit(commitHash: string): Promise<RiskyDiff | null> {
		try {
			return await this.analyzeCommitRisk(commitHash);
		} catch {
			return null;
		}
	}

	// =======================================================================
	// Internal Analysis
	// =======================================================================

	/**
	 * Analyze a single commit for risk.
	 *
	 * @param commitHash - The commit hash
	 * @returns A RiskyDiff if risk exceeds threshold, or null
	 */
	private async analyzeCommitRisk(commitHash: string): Promise<RiskyDiff | null> {
		const diffStatOutput = await this.execGit([
			"diff",
			`${commitHash}^..${commitHash}`,
			"--stat",
			"--diff-filter=AMR",
		]);

		if (!diffStatOutput || diffStatOutput.trim().length === 0) {
			return null;
		}

		// Get commit message
		const commitMessage = await this.getCommitMessage(commitHash);

		const filesChanged = this.parseDiffStatFiles(diffStatOutput);
		const lineCounts = this.parseDiffStatLineCounts(diffStatOutput);

		if (filesChanged.length === 0) {
			return null;
		}

		const evidence: EvidenceRef = {
			type: "git_file",
			id: `commit:${commitHash}`,
			label: `Commit ${commitHash.slice(0, 8)} diff`,
			description: `Analyzed commit ${commitHash.slice(0, 8)}: ${commitMessage || "no message"}`,
			timestamp: new Date().toISOString(),
			confidence: 0.9,
		};

		const totalChanges = lineCounts.added + lineCounts.removed;
		const touchesMultipleAreas = this.detectsMultipleAreas(filesChanged);
		const churnRatio = lineCounts.added > 0 ? Math.min(lineCounts.removed / lineCounts.added, 1) : 0;

		const riskScore = this.computeRiskScore(totalChanges, filesChanged.length, touchesMultipleAreas, churnRatio);

		const riskyDiff: RiskyDiff = {
			commitHash,
			commitMessage: commitMessage || undefined,
			filesChanged,
			linesAdded: lineCounts.added,
			linesRemoved: lineCounts.removed,
			totalChanges,
			touchesMultipleAreas,
			riskScore,
			severity: riskScoreToSeverity(riskScore),
			evidence: [evidence],
			summary: this.buildRiskyDiffSummary(commitHash.slice(0, 8), filesChanged.length, totalChanges, riskScore),
			metadata: {
				churnRatio,
				fileCount: filesChanged.length,
			},
		};

		return riskScore >= this.options.riskThreshold ? riskyDiff : null;
	}

	// =======================================================================
	// Risk Score Computation
	// =======================================================================

	/**
	 * Compute a risk score 0–1 from diff characteristics.
	 *
	 * Factors:
	 * - Size factor: how large the diff is relative to the large diff threshold
	 * - Span factor: how many files are changed
	 * - Area factor: whether the diff touches multiple functional areas
	 * - Churn factor: how much of the change is churn (add ~= remove)
	 */
	private computeRiskScore(
		totalChanges: number,
		fileCount: number,
		touchesMultipleAreas: boolean,
		churnRatio: number,
	): number {
		// Size factor: logistic function centered on largeDiffThreshold
		const sizeFactor = 1 / (1 + Math.exp(-0.005 * (totalChanges - this.options.largeDiffThreshold)));

		// Span factor: files beyond 5 get increasing weight
		const spanFactor = Math.min(fileCount / 20, 1);

		// Area factor: 0.3 bonus for touching multiple areas
		const areaFactor = touchesMultipleAreas ? 0.3 : 0;

		// Churn factor: high churn (0.7–1.0) adds risk
		const churnFactor = churnRatio > 0.7 ? (churnRatio - 0.7) * 2 : 0;

		// Weighted combination
		const score = sizeFactor * 0.35 + spanFactor * 0.25 + areaFactor * 0.2 + churnFactor * 0.2;

		return Math.min(Math.max(score, 0), 1);
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

	/**
	 * Get N most recent commit hashes.
	 */
	private async gitLogCommitHashes(count: number): Promise<string[]> {
		const output = await this.execGit(["log", `-${count}`, "--format=%H"]);
		if (!output) return [];
		return output.split("\n").filter((h) => h.length > 0);
	}

	/**
	 * Get the commit message (first line) for a commit hash.
	 */
	private async getCommitMessage(hash: string): Promise<string | null> {
		try {
			return await this.execGit(["log", "-1", "--format=%s", hash]);
		} catch {
			return null;
		}
	}

	// =======================================================================
	// Parsing
	// =======================================================================

	/**
	 * Parse the list of changed files from git diff --stat output.
	 *
	 * Example input:
	 *   src/index.ts | 10 +++++-----
	 *   src/utils.ts | 2 ++
	 *   2 files changed, 8 insertions(+), 4 deletions(-)
	 */
	private parseDiffStatFiles(diffStatOutput: string): string[] {
		const lines = diffStatOutput.split("\n");
		const files: string[] = [];

		for (const line of lines) {
			// Lines with file changes contain " | "
			if (!line.includes(" | ")) continue;
			// Skip summary line like "2 files changed, 8 insertions(+), 4 deletions(-)"
			if (line.includes("file") && line.includes("changed")) continue;

			const filePath = line.split(" | ")[0].trim();
			if (filePath) {
				files.push(filePath);
			}
		}

		return files;
	}

	/**
	 * Parse total added/removed line counts from git diff --stat output.
	 */
	private parseDiffStatLineCounts(diffStatOutput: string): { added: number; removed: number } {
		const lines = diffStatOutput.split("\n");
		let totalAdded = 0;
		let totalRemoved = 0;

		for (const line of lines) {
			if (!line.includes(" | ")) continue;
			if (line.includes("file") && line.includes("changed")) continue;

			// Extract the change part after " | "
			const changePart = line.split(" | ")[1]?.trim() || "";

			// Count '+' and '-' characters in the diffstat graph
			// Also look for explicit numbers in the summary line
			for (const char of changePart) {
				if (char === "+") totalAdded++;
				if (char === "-") totalRemoved++;
			}
		}

		// Also parse the summary line for exact counts
		const summaryLine = lines.find((l) => l.includes("file") && l.includes("changed"));
		if (summaryLine) {
			const addedMatch = summaryLine.match(/(\d+)\s*insertion/);
			const removedMatch = summaryLine.match(/(\d+)\s*deletion/);
			if (addedMatch) totalAdded = Math.max(totalAdded, parseInt(addedMatch[1], 10));
			if (removedMatch) totalRemoved = Math.max(totalRemoved, parseInt(removedMatch[1], 10));
		}

		return { added: totalAdded, removed: totalRemoved };
	}

	/**
	 * Detect if changed files span multiple functional areas.
	 *
	 * Functional areas are identified by the top-level directory.
	 * Files in 3+ distinct top-level directories count as multi-area.
	 */
	private detectsMultipleAreas(files: string[]): boolean {
		const areas = new Set<string>();
		for (const file of files) {
			const topDir = file.split("/")[0];
			areas.add(topDir);
		}
		return areas.size >= 3;
	}

	/**
	 * Build a human-readable summary for a risky diff.
	 */
	private buildRiskyDiffSummary(
		commitRef: string,
		fileCount: number,
		totalChanges: number,
		riskScore: number,
	): string {
		const riskLabel = riskScore >= 0.7 ? "High risk" : riskScore >= 0.5 ? "Moderate risk" : "Low risk";
		return `${riskLabel} diff (${commitRef}): ${fileCount} file(s), ${totalChanges} total change(s), risk ${(riskScore * 100).toFixed(0)}%`;
	}
}

// =========================================================================
// Factory
// =========================================================================

/**
 * Create a GitDiffScanner instance.
 *
 * @param options - Scanner options including project root
 * @returns A new GitDiffScanner
 */
export function createGitDiffScanner(options: ScannerOptions): GitDiffScanner {
	return new GitDiffScanner(options);
}
