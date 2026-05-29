/**
 * Repo Scanner v2 — V5.05
 *
 * Main scanner orchestrator that coordinates sub-scanners and produces
 * a unified ScanResult.
 *
 * The scanner performs read-only analysis of a project repository:
 * - Git diff scanning for risky changes
 * - Hotspot detection for high-churn areas
 * - Failure correlation from execution journal
 * - Stale plan area detection
 * - Proposal candidate generation from all signals
 *
 * Design principles:
 * - All operations are read-only (never calls git push or mutates state)
 * - All output is evidence-backed via EvidenceRef
 * - Follows V4 ExecutionKernel doctrine (observes only, never mutates)
 * - Safe to run in any context (CI, background, user-initiated)
 *
 * @packageDocumentation
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

import type { EvidenceRef } from "../evidence/types.js";
import { FailureCorrelator } from "./failure-correlator.js";
import { GitDiffScanner } from "./git-diff-scanner.js";
import { HotspotDetector } from "./hotspot-detector.js";
import { ProposalCandidateGenerator } from "./proposal-candidate-generator.js";
import { StaleAreaDetector } from "./stale-area-detector.js";
import type { ScannerOptions, ScanRequest, ScanResult } from "./types.js";
import { DEFAULT_SCANNER_OPTIONS } from "./types.js";

// =========================================================================
// Main Scanner
// =========================================================================

/**
 * Main repo scanner orchestrator.
 *
 * Coordinates all sub-scanners to produce a comprehensive scan result.
 * The scanner is fully read-only and never mutates repo state.
 */
export class RepoScanner {
	private readonly options: ScannerOptions;
	private readonly gitDiffScanner: GitDiffScanner;
	private readonly hotspotDetector: HotspotDetector;
	private readonly failureCorrelator: FailureCorrelator;
	private readonly staleAreaDetector: StaleAreaDetector;
	private readonly proposalGenerator: ProposalCandidateGenerator;

	constructor(options: ScannerOptions) {
		this.options = {
			...DEFAULT_SCANNER_OPTIONS,
			...options,
			projectRoot: options.projectRoot,
		};

		this.gitDiffScanner = new GitDiffScanner(this.options);
		this.hotspotDetector = new HotspotDetector(this.options);
		this.failureCorrelator = new FailureCorrelator(this.options);
		this.staleAreaDetector = new StaleAreaDetector(this.options);
		this.proposalGenerator = new ProposalCandidateGenerator(5);
	}

	// =======================================================================
	// Public API
	// =======================================================================

	/**
	 * Scan a project based on the provided request.
	 *
	 * @param request - Scan request parameters
	 * @returns A comprehensive ScanResult
	 */
	async scan(request: ScanRequest): Promise<ScanResult> {
		const startTime = Date.now();
		const errors: string[] = [];
		const allEvidence: EvidenceRef[] = [];

		// Run all sub-scanners with independent error handling
		const [hotspots, riskyDiffs, failureCorrelations, stalePlanAreas] = await Promise.all([
			this.runHotspotScan(errors, allEvidence),
			this.runDiffScan(request, errors, allEvidence),
			this.runFailureCorrelation(errors, allEvidence),
			this.runStaleAreaScan(errors, allEvidence),
		]);

		// Generate proposal candidates from all findings
		const proposalCandidates = this.proposalGenerator.generate(
			hotspots,
			riskyDiffs,
			failureCorrelations,
			stalePlanAreas,
		);

		// Add proposal candidate evidence to the aggregate
		for (const candidate of proposalCandidates) {
			allEvidence.push(...candidate.evidence);
		}

		// Compute overall confidence based on how many scanners succeeded
		const subScannerCount = 4;
		const failedScanners = errors.filter((e) => e.includes("failed") || e.includes("error")).length;
		const confidence = Math.max(0, 1 - failedScanners / subScannerCount);

		const durationMs = Date.now() - startTime;

		return {
			scannedAt: new Date().toISOString(),
			target: request.target,
			durationMs,
			hotspots,
			riskyDiffs,
			failureCorrelations,
			stalePlanAreas,
			proposalCandidates,
			evidence: allEvidence,
			errors,
			confidence,
		};
	}

	/**
	 * Quick health check — returns true if the scanner can operate
	 * (i.e., the project root exists and is accessible).
	 */
	async healthCheck(): Promise<boolean> {
		try {
			const { existsSync } = await import("node:fs");
			return existsSync(this.options.projectRoot);
		} catch {
			return false;
		}
	}

	// =======================================================================
	// Sub-scanner runners
	// =======================================================================

	/**
	 * Run hotspot detection.
	 */
	private async runHotspotScan(errors: string[], evidence: EvidenceRef[]): Promise<import("./types.js").Hotspot[]> {
		try {
			const hotspots = await this.hotspotDetector.scan();
			if (hotspots.length > 0) {
				evidence.push(...hotspots.flatMap((h) => h.evidence));
			}
			return hotspots;
		} catch (error) {
			errors.push(`Hotspot detection failed: ${error instanceof Error ? error.message : String(error)}`);
			return [];
		}
	}

	/**
	 * Run git diff scan for risky changes.
	 */
	private async runDiffScan(
		request: ScanRequest,
		errors: string[],
		evidence: EvidenceRef[],
	): Promise<import("./types.js").RiskyDiff[]> {
		try {
			const riskyDiffs: import("./types.js").RiskyDiff[] = [];

			// Always scan recent commits for baseline risk assessment
			const commitDiffs = await this.gitDiffScanner.scanRecentCommits();
			riskyDiffs.push(...commitDiffs);
			for (const d of commitDiffs) evidence.push(...d.evidence);

			// Scan uncommitted changes
			const uncommitted = await this.gitDiffScanner.scanUncommittedChanges();
			if (uncommitted) {
				riskyDiffs.push(uncommitted);
				evidence.push(...uncommitted.evidence);
			}

			// If a specific commit is requested (workspace/plan target), scan it
			if (request.workspaceId) {
				try {
					const workspaceCommits = await this.findCommitsForWorkspace(request.workspaceId);
					for (const hash of workspaceCommits) {
						const diff = await this.gitDiffScanner.scanCommit(hash);
						if (diff) {
							riskyDiffs.push(diff);
							evidence.push(...diff.evidence);
						}
					}
				} catch {
					// Non-fatal
				}
			}

			// Deduplicate by commitHash
			const seen = new Set<string>();
			const unique: typeof riskyDiffs = [];
			for (const d of riskyDiffs) {
				if (!seen.has(d.commitHash)) {
					seen.add(d.commitHash);
					unique.push(d);
				}
			}

			// Sort by risk score descending
			unique.sort((a, b) => b.riskScore - a.riskScore);

			return unique.slice(0, this.options.maxResults ?? DEFAULT_SCANNER_OPTIONS.maxResults!);
		} catch (error) {
			errors.push(`Diff scan failed: ${error instanceof Error ? error.message : String(error)}`);
			return [];
		}
	}

	/**
	 * Run failure correlation analysis.
	 */
	private async runFailureCorrelation(
		errors: string[],
		evidence: EvidenceRef[],
	): Promise<import("./types.js").FailureCorrelation[]> {
		try {
			const correlations = await this.failureCorrelator.scan();
			if (correlations.length > 0) {
				evidence.push(...correlations.flatMap((c) => c.evidence));
			}
			return correlations;
		} catch (error) {
			errors.push(`Failure correlation failed: ${error instanceof Error ? error.message : String(error)}`);
			return [];
		}
	}

	/**
	 * Run stale area detection.
	 */
	private async runStaleAreaScan(
		errors: string[],
		evidence: EvidenceRef[],
	): Promise<import("./types.js").StalePlanArea[]> {
		try {
			const staleAreas = await this.staleAreaDetector.scan();
			if (staleAreas.length > 0) {
				evidence.push(...staleAreas.flatMap((a) => a.evidence));
			}
			return staleAreas;
		} catch (error) {
			errors.push(`Stale area detection failed: ${error instanceof Error ? error.message : String(error)}`);
			return [];
		}
	}

	// =======================================================================
	// Helpers
	// =======================================================================

	/**
	 * Find git commit hashes associated with a workspace.
	 *
	 * Uses git log with the workspace ID as a search term in commit messages.
	 * This is a read-only operation.
	 */
	private async findCommitsForWorkspace(workspaceId: string): Promise<string[]> {
		try {
			const { stdout } = await execFileAsync(
				this.options.gitPath ?? "git",
				["log", "--format=%H", "--grep", workspaceId, "-10"],
				{
					cwd: this.options.projectRoot,
					encoding: "utf-8",
					timeout: 15_000,
				},
			);

			return stdout
				.trim()
				.split("\n")
				.filter((h) => h.length > 0);
		} catch {
			return [];
		}
	}
}

// =========================================================================
// Factory
// =========================================================================

/**
 * Create a RepoScanner instance.
 *
 * @param options - Scanner options including project root
 * @returns A new RepoScanner
 */
export function createRepoScanner(options: ScannerOptions): RepoScanner {
	return new RepoScanner(options);
}
