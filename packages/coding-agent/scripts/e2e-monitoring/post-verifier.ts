/**
 * E2E Post-Execution Verifier
 *
 * Runs comprehensive correctness verification after plan execution completes:
 * - Git state: no unexpected uncommitted changes, commits are well-formed
 * - State store: workspace states consistent with filesystem
 * - Worktrees: no orphaned worktrees left behind
 * - Processes: no leftover child processes
 * - Commits: correct format, scope, no forbidden content
 * - Files: no temporary files leaked
 * - Audit: audit log completeness
 */

import * as fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type PostExecutionCheck, type PostExecutionReport } from "./types.js";
import type { Workspace, WorkspaceQueue } from "../../src/core/workspace-schema.js";
import { WorkspaceStage } from "../../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PostVerifierConfig {
	workspaceRoot: string;
	planExecId: string;
	queue: WorkspaceQueue;
	completedWorkspaceIds: Set<string>;
	failedWorkspaceIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runPostExecutionVerification(config: PostVerifierConfig): Promise<PostExecutionReport> {
	const checks: PostExecutionCheck[] = [];

	// 1. Git state verification
	checks.push(await verifyGitState(config.workspaceRoot));

	// 2. Commit format verification
	checks.push(await verifyCommitFormat(config.workspaceRoot, config.queue, config.completedWorkspaceIds));

	// 3. Worktree hygiene (no orphaned worktrees)
	checks.push(await verifyWorktreeCleanup(config.workspaceRoot, config.planExecId));

	// 4. No leftover child processes
	checks.push(verifyNoOrphanProcesses());

	// 5. No temporary files leaked outside .pi/
	checks.push(await verifyNoLeakedFiles(config.workspaceRoot));

	// 6. Workspace output files exist for completed workspaces
	checks.push(await verifyWorkspaceOutputs(config.workspaceRoot, config.planExecId, config.queue, config.completedWorkspaceIds));

	// 7. Audit log completeness
	checks.push(await verifyAuditLog(config.workspaceRoot, config.planExecId));

	const passed = checks.filter((c) => c.status === "pass").length;
	const failed = checks.filter((c) => c.status === "fail").length;
	const warned = checks.filter((c) => c.status === "warn").length;

	return {
		timestamp: Date.now(),
		totalChecks: checks.length,
		passed,
		failed,
		warned,
		checks,
		overallPassed: failed === 0,
	};
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function verifyGitState(root: string): Promise<PostExecutionCheck> {
	try {
		const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8", timeout: 10_000 });
		const lines = status.trim().split("\n").filter(Boolean);

		// Expected uncommitted paths: .pi/, reports/, .logs/
		const expectedDirs = [".pi/", "reports/", ".logs/"];
		const unexpected = lines.filter((l) => {
			const file = l.substring(3);
			return !expectedDirs.some((d) => file.startsWith(d));
		});

		if (unexpected.length === 0 && lines.length === 0) {
			return { name: "git-final-state", category: "git", status: "pass", message: "Working tree clean", detail: { totalUncommitted: 0 } };
		}

		if (unexpected.length === 0) {
			return { name: "git-final-state", category: "git", status: "pass", message: `${lines.length} uncommitted files (all in expected dirs)`, detail: { totalUncommitted: lines.length, allInSafeDirs: true } };
		}

		return { name: "git-final-state", category: "git", status: "warn", message: `${unexpected.length} unexpected uncommitted files outside .pi/reports/.logs`, detail: { totalUncommitted: lines.length, unexpectedCount: unexpected.length, sample: unexpected.slice(0, 10) } };
	} catch (err) {
		return { name: "git-final-state", category: "git", status: "fail", message: `Git check failed: ${err}` };
	}
}

async function verifyCommitFormat(root: string, queue: WorkspaceQueue, completedIds: Set<string>): Promise<PostExecutionCheck> {
	try {
		const log = execSync("git log --oneline -50", { cwd: root, encoding: "utf-8", timeout: 10_000 });
		const commits = log.trim().split("\n");

		const phase = queue.phase;
		const issues: string[] = [];

		// Check last N commits for format
		for (const commit of commits) {
			// Expected format: feat(pP-V5): complete workspace V5.00 — Title
			const match = commit.match(/^(\w+)\(([^)]+)\):\s*(.+)/);
			if (!match) {
				// Some commits might not follow this format; skip
				continue;
			}

			const [, type, scope, desc] = match;

			// Check for non-standard prefix patterns
			if (scope.startsWith("pP-") && scope !== `p${phase}`) {
				issues.push(`Non-standard scope: ${scope} (expected p${phase})`);
			}

			// Check for forbidden patterns
			if (desc.includes("review fixes") || desc.includes("miscellaneous")) {
				issues.push(`Forbidden description pattern in: ${desc}`);
			}
		}

		if (issues.length === 0) {
			return { name: "commit-format", category: "commits", status: "pass", message: `Last ${commits.length} commits look well-formed`, detail: { commitsChecked: commits.length, issues: 0 } };
		}

		return { name: "commit-format", category: "commits", status: "warn", message: `${issues.length} commit format issues`, detail: { issues } };
	} catch (err) {
		return { name: "commit-format", category: "commits", status: "fail", message: `Commit verification failed: ${err}` };
	}
}

async function verifyWorktreeCleanup(root: string, planExecId: string): Promise<PostExecutionCheck> {
	try {
		const list = execSync("git worktree list", { cwd: root, encoding: "utf-8", timeout: 10_000 });
		const lines = list.trim().split("\n");

		const linkedWorktrees = lines.slice(1); // first line is main
		const ourWorktrees = linkedWorktrees.filter((l) => l.includes(planExecId));

		if (ourWorktrees.length === 0) {
			return { name: "worktree-cleanup", category: "worktrees", status: "pass", message: "No orphaned worktrees for this execution", detail: { linkedTotal: linkedWorktrees.length, oursRemaining: 0 } };
		}

		return { name: "worktree-cleanup", category: "worktrees", status: "warn", message: `${ourWorktrees.length} worktree(s) still exist for this execution — may need manual cleanup`, detail: { linkedTotal: linkedWorktrees.length, oursRemaining: ourWorktrees.length, worktrees: ourWorktrees.map((l) => l.split(/\s+/)[0]) } };
	} catch {
		return { name: "worktree-cleanup", category: "worktrees", status: "skip", message: "Could not check worktree state" };
	}
}

function verifyNoOrphanProcesses(): PostExecutionCheck {
	try {
		const ps = execSync("ps aux | grep -E '(vitest|jest)' | grep -v grep | wc -l", { encoding: "utf-8", timeout: 3000 }).trim();
		const count = parseInt(ps, 10);

		if (count > 2) {
			return { name: "orphan-processes", category: "processes", status: "warn", message: `${count} leftover test processes` };
		}

		return { name: "orphan-processes", category: "processes", status: "pass", message: "No orphan processes", detail: { count } };
	} catch {
		return { name: "orphan-processes", category: "processes", status: "skip", message: "Could not check processes" };
	}
}

async function verifyNoLeakedFiles(root: string): Promise<PostExecutionCheck> {
	try {
		// Check for common temporary file patterns outside .pi/
		const leakedPatterns = [
			"*.tmp", "*.temp", "*.bak", "*.orig",
			"core", "core.*", // core dumps
		];

		const issues: string[] = [];
		for (const pattern of leakedPatterns) {
			try {
				const result = execSync(`find "${root}" -maxdepth 3 -name "${pattern}" -not -path "*/.pi/*" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null`, { encoding: "utf-8", timeout: 5000 });
				const files = result.trim().split("\n").filter(Boolean);
				for (const file of files) {
					issues.push(file);
				}
			} catch {}
		}

		if (issues.length === 0) {
			return { name: "no-leaked-files", category: "files", status: "pass", message: "No leaked temporary files" };
		}

		return { name: "no-leaked-files", category: "files", status: "warn", message: `${issues.length} potential leaked files`, detail: { files: issues.slice(0, 20) } };
	} catch {
		return { name: "no-leaked-files", category: "files", status: "skip", message: "Could not check for leaked files" };
	}
}

async function verifyWorkspaceOutputs(root: string, planExecId: string, queue: WorkspaceQueue, completedIds: Set<string>): Promise<PostExecutionCheck> {
	try {
		const missing = [];
		for (const ws of queue.workspaces) {
			if (!completedIds.has(ws.id)) continue;

			const snapshotDir = join(root, ".pi", "workspaces", ws.id);
			const reportPath = join(snapshotDir, "report.md");
			if (!existsSync(reportPath)) {
				missing.push(ws.id);
			}
		}

		if (missing.length === 0) {
			return { name: "workspace-outputs", category: "files", status: "pass", message: `All ${completedIds.size} completed workspaces have output artifacts` };
		}

		return { name: "workspace-outputs", category: "files", status: "warn", message: `${missing.length} workspace(s) missing report.md: ${missing.join(", ")}` };
	} catch {
		return { name: "workspace-outputs", category: "files", status: "skip", message: "Could not verify workspace outputs" };
	}
}

async function verifyAuditLog(root: string, planExecId: string): Promise<PostExecutionCheck> {
	try {
		const logPath = join(root, ".pi", `execution-${planExecId}.log`);
		if (!existsSync(logPath)) {
			return { name: "audit-log", category: "audit", status: "warn", message: "No execution log found" };
		}

		const content = await fs.readFile(logPath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);

		// Check for key events
		const hasStart = lines.some((l) => l.includes("Starting execution"));
		const hasCompletion = lines.some((l) => l.includes("Execution") && l.includes("COMPLETE"));
		const hasCleanup = lines.some((l) => l.includes("cleanup") || l.includes("Cleanup"));

		const missing: string[] = [];
		if (!hasStart) missing.push("execution start");
		if (!hasCompletion) missing.push("execution completion");
		if (!hasCleanup) missing.push("cleanup review");

		if (missing.length === 0) {
			return { name: "audit-log", category: "audit", status: "pass", message: `Execution log complete (${lines.length} lines)`, detail: { lines: lines.length } };
		}

		return { name: "audit-log", category: "audit", status: "warn", message: `Execution log missing events: ${missing.join(", ")}`, detail: { lines: lines.length, missing } };
	} catch {
		return { name: "audit-log", category: "audit", status: "warn", message: "Could not verify audit log" };
	}
}
