/**
 * writeSet Drift Detection (P23 W5)
 *
 * Records empirical writeSets post-execution via git diff, compares against
 * declared writeSet, flags drift when threshold is exceeded, and feeds
 * empirical data back into the optimizer.
 *
 * Key concepts:
 * - After each workspace completes, git diff --name-only HEAD captures all changed files
 * - Empirical writeSet is compared against declared conflictScope
 * - Drift beyond threshold (default: 3 files) flags the entry
 * - Drift mode: warn_and_flag_integration (default) or block_integration (opt-in)
 * - Drift report persisted as artifact
 * - Empirical data feeds PlanIntakeAnalyzer autoOptimizationProposal
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createGitRunner } from "@earendil-works/pi-execution-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for writeSet drift detection.
 */
export interface WriteSetDriftConfig {
	/** Whether drift detection is enabled */
	enabled: boolean;
	/** Number of undeclared files allowed before flagging drift */
	driftThresholdFiles: number;
	/** What to do when drift is detected */
	onDriftDetected: "warn_and_flag_integration" | "block_integration";
	/** Whether to compare declared vs empirical after execution */
	compareAfterExecution: boolean;
	/** Whether to feed empirical data to the optimizer */
	feedToOptimizer: boolean;
}

/**
 * Default writeSet drift configuration.
 */
export const DEFAULT_WRITE_SET_DRIFT_CONFIG: WriteSetDriftConfig = {
	enabled: true,
	driftThresholdFiles: 0,
	onDriftDetected: "block_integration",
	compareAfterExecution: true,
	feedToOptimizer: true,
};

/**
 * Result of a drift comparison.
 */
export interface WriteSetDriftResult {
	/** Workspace ID */
	workspaceId: string;
	/** Plan execution ID */
	planExecId: string;
	/** Files that were actually changed (empirical) */
	empiricalWriteSet: string[];
	/** Files declared in conflictScope */
	declaredWriteSet: string[];
	/** Files that were written but not declared */
	undeclaredWrites: string[];
	/** Number of undeclared writes */
	undeclaredWriteCount: number;
	/** Whether drift was flagged */
	driftFlagged: boolean;
	/** Whether the integration is blocked */
	integrationBlocked: boolean;
	/** Whether the entry requires human review */
	requiresHumanReview: boolean;
	/** Timestamp */
	timestamp: number;
}

/**
 * Drift report persisted to disk.
 */
export interface WriteSetDriftReport {
	/** Workspace ID */
	workspaceId: string;
	/** Plan execution ID */
	planExecId: string;
	/** Empirical write set */
	empiricalWriteSet: string[];
	/** Declared conflict scope patterns */
	declaredConflictScope: string[];
	/** Drift result */
	result: WriteSetDriftResult;
	/** Timestamp */
	generatedAt: number;
}

// ---------------------------------------------------------------------------
// WriteSetDriftDetector
// ---------------------------------------------------------------------------

/**
 * Detects drift between declared and empirical writeSets.
 */
export class WriteSetDriftDetector {
	private config: WriteSetDriftConfig;
	private workspaceRoot: string;

	constructor(config: Partial<WriteSetDriftConfig>, workspaceRoot: string) {
		this.config = { ...DEFAULT_WRITE_SET_DRIFT_CONFIG, ...config };
		this.workspaceRoot = workspaceRoot;
	}

	/**
	 * Record the empirical writeSet for a workspace.
	 *
	 * @param planExecId - Plan execution ID
	 * @param workspaceId - Workspace ID
	 * @param worktreeDir - Worktree directory to run git diff in
	 * @param declaredConflictScope - Declared conflict scope patterns
	 * @param baseCommit - Optional base commit to diff against. If not provided,
	 *                     compares against HEAD (useful for uncommitted work).
	 * @returns Drift result
	 */
	async recordAndCompare(
		planExecId: string,
		workspaceId: string,
		worktreeDir: string,
		declaredConflictScope: string[],
		baseCommit?: string,
	): Promise<WriteSetDriftResult> {
		if (!this.config.enabled || !this.config.compareAfterExecution) {
			return {
				workspaceId,
				planExecId,
				empiricalWriteSet: [],
				declaredWriteSet: declaredConflictScope,
				undeclaredWrites: [],
				undeclaredWriteCount: 0,
				driftFlagged: false,
				integrationBlocked: false,
				requiresHumanReview: false,
				timestamp: Date.now(),
			};
		}

		// Run git diff to capture all changed files since the base commit
		const empiricalWriteSet = await this.getChangedFiles(worktreeDir, baseCommit);

		// Compare empirical vs declared
		const result = this.compare(workspaceId, planExecId, empiricalWriteSet, declaredConflictScope);

		// Persist drift report
		await this.persistDriftReport(result, planExecId, workspaceId);

		return result;
	}

	/**
	 * Get changed files via git diff in a directory.
	 * If baseCommit is provided, diffs baseCommit..HEAD.
	 * Otherwise diffs HEAD (uncommitted changes only).
	 */
	private async getChangedFiles(cwd: string, baseCommit?: string): Promise<string[]> {
		try {
			const runner = createGitRunner({
				planExecId: "",
				workspaceId: "",
				leaseId: "",
				cwd,
			});
			const args = baseCommit ? ["diff", "--name-only", baseCommit, "HEAD"] : ["diff", "--name-only", "HEAD"];
			const result = await runner.read(args, { cwd });
			return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
		} catch {
			return [];
		}
	}

	/**
	 * Compare empirical writeSet against declared conflict scope.
	 */
	private compare(
		workspaceId: string,
		planExecId: string,
		empiricalWriteSet: string[],
		declaredConflictScope: string[],
	): WriteSetDriftResult {
		// Find files in empirical set that are NOT covered by any declared pattern
		const undeclaredWrites = empiricalWriteSet.filter((file) => {
			return !this.isFileCoveredByPatterns(file, declaredConflictScope);
		});

		const undeclaredWriteCount = undeclaredWrites.length;
		const driftFlagged = undeclaredWriteCount > this.config.driftThresholdFiles;
		const integrationBlocked = driftFlagged && this.config.onDriftDetected === "block_integration";
		const requiresHumanReview = driftFlagged && this.config.onDriftDetected === "warn_and_flag_integration";

		return {
			workspaceId,
			planExecId,
			empiricalWriteSet,
			declaredWriteSet: declaredConflictScope,
			undeclaredWrites,
			undeclaredWriteCount,
			driftFlagged,
			integrationBlocked,
			requiresHumanReview,
			timestamp: Date.now(),
		};
	}

	/**
	 * Check if a file path is covered by any of the declared conflict scope patterns.
	 */
	private isFileCoveredByPatterns(file: string, patterns: string[]): boolean {
		for (const pattern of patterns) {
			if (this.matchesPattern(file, pattern)) return true;
		}
		return false;
	}

	/**
	 * Match a file path against a glob-style pattern.
	 * Supports: exact paths, wildcard *, directory patterns ending with /
	 */
	private matchesPattern(filePath: string, pattern: string): boolean {
		const trimmed = pattern.trim();
		if (!trimmed) return false;

		// Pattern with wildcards (e.g., "packages/*/src/**")
		// If it ends with /** it's a directory pattern that should match anything inside
		if (trimmed.endsWith("/**")) {
			const prefix = trimmed.slice(0, -3);
			const regexStr = prefix
				.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
				.replace(/\*\*/g, "___DOUBLESTAR___")
				.replace(/\*/g, "[^/]*")
				.replace(/___DOUBLESTAR___/g, ".*");
			const regex = new RegExp(`^${regexStr}(/.*)?$`);
			return regex.test(filePath);
		}

		// Directory pattern ending with / (e.g., "src/scheduler/")
		if (trimmed.endsWith("/")) {
			const dirPrefix = trimmed.replace(/\/+$/, "");
			return filePath.startsWith(dirPrefix) || filePath.startsWith(`${dirPrefix}/`);
		}

		// Simple glob pattern with wildcards
		const regexStr = trimmed
			.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
			.replace(/\*\*/g, "___DOUBLESTAR___")
			.replace(/\*/g, "[^/]*")
			.replace(/___DOUBLESTAR___/g, ".*");

		try {
			const regex = new RegExp(`^${regexStr}$`);
			return regex.test(filePath);
		} catch {
			return false;
		}
	}

	/**
	 * Persist a drift report to disk.
	 */
	private async persistDriftReport(
		result: WriteSetDriftResult,
		planExecId: string,
		workspaceId: string,
	): Promise<void> {
		const report: WriteSetDriftReport = {
			workspaceId,
			planExecId,
			empiricalWriteSet: result.empiricalWriteSet,
			declaredConflictScope: result.declaredWriteSet,
			result,
			generatedAt: Date.now(),
		};

		const artifactDir = path.join(this.workspaceRoot, ".pi", "executions", planExecId, "worktrees");

		try {
			await fs.mkdir(artifactDir, { recursive: true });
			const artifactPath = path.join(artifactDir, `${workspaceId}.drift.json`);
			await fs.writeFile(artifactPath, JSON.stringify(report, null, 2), "utf-8");
		} catch {
			// Non-fatal
		}
	}
}

/**
 * Create a WriteSetDriftDetector instance.
 */
export function createWriteSetDriftDetector(
	config: Partial<WriteSetDriftConfig>,
	workspaceRoot: string,
): WriteSetDriftDetector {
	return new WriteSetDriftDetector(config, workspaceRoot);
}
