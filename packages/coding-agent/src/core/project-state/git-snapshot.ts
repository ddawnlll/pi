/**
 * Git state snapshot.
 *
 * Executes safe read-only git commands to capture branch, HEAD SHA,
 * and status of dirty/untracked/staged files.
 *
 * Tolerates non-git directories gracefully.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { SCHEMA_VERSION } from "./paths.js";
import type { GitStateSummary, SnapshotValidity } from "./types.js";

/**
 * Safely execute a git command and return stdout or null on failure.
 */
function gitCmd(args: string[], cwd: string): string | null {
	try {
		const result = spawnSync("git", args, {
			cwd,
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (result.error) return null;
		if (result.status !== 0) return null;
		return result.stdout.trim();
	} catch {
		return null;
	}
}

/**
 * Build git state summary for a directory.
 */
export function buildGitState(rootDir: string): GitStateSummary {
	const absRoot = resolve(rootDir);

	// Check if inside a git repo
	const isInside = gitCmd(["rev-parse", "--is-inside-work-tree"], absRoot);

	if (isInside !== "true") {
		return {
			schemaVersion: SCHEMA_VERSION,
			isGitRepo: false,
			lastCheckedAt: new Date().toISOString(),
			validity: "unknown",
			dirtyFiles: [],
			untrackedFiles: [],
			stagedFiles: [],
		};
	}

	// Get branch name
	const branch = gitCmd(["rev-parse", "--abbrev-ref", "HEAD"], absRoot) ?? undefined;

	// Get HEAD SHA
	const headSha = gitCmd(["rev-parse", "HEAD"], absRoot) ?? undefined;

	// Get status
	const statusPorcelain = gitCmd(["status", "--porcelain"], absRoot) ?? "";
	const lines = statusPorcelain ? statusPorcelain.split("\n").filter(Boolean) : [];

	const dirtyFiles: string[] = [];
	const untrackedFiles: string[] = [];
	const stagedFiles: string[] = [];

	for (const line of lines) {
		if (line.length < 3) continue;
		const code = line.slice(0, 2);
		const filePath = line.slice(3).trim();

		if (code === "??") {
			untrackedFiles.push(filePath);
		} else if (code.includes("M") || code.includes("A") || code.includes("D") || code.includes("R")) {
			if (code[0] !== " ") {
				stagedFiles.push(filePath);
			}
			if (code[1] !== " ") {
				dirtyFiles.push(filePath);
			}
		}
	}

	// Deduplicate: a file can be both staged and dirty (modified after staging)
	const allChanged = new Set([...dirtyFiles, ...stagedFiles, ...untrackedFiles]);
	const validity: SnapshotValidity = allChanged.size > 0 ? "dirty" : "valid";

	return {
		schemaVersion: SCHEMA_VERSION,
		isGitRepo: true,
		branch: branch ?? undefined,
		headSha: headSha ?? undefined,
		statusPorcelain,
		dirtyFiles,
		untrackedFiles,
		stagedFiles,
		lastCheckedAt: new Date().toISOString(),
		validity,
	};
}
