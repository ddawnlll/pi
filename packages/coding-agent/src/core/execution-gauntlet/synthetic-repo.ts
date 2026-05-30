/**
 * Synthetic Repo — P38.1
 *
 * Provides a temporary workspace directory structure for synthetic workers.
 * Creates isolated temp dirs per plan execution. Cleanup is responsibility
 * of the gauntlet runner.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyntheticRepo {
	/** Root directory for this synthetic repo */
	rootDir: string;
	/** Workspace directories keyed by workspace ID */
	workspaces: Map<string, string>;
	/** Cleanup function */
	cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a synthetic repo with a temp root directory.
 * Does NOT create workspace subdirectories — those are created
 * on demand when workers run.
 */
export async function createSyntheticRepo(runId: string): Promise<SyntheticRepo> {
	const rootDir = path.join(os.tmpdir(), `pi-gauntlet-${runId}`);

	// Clean up any leftover from previous runs with same id
	try {
		await fs.rm(rootDir, { recursive: true, force: true });
	} catch {
		// ignore
	}

	await fs.mkdir(rootDir, { recursive: true });

	return {
		rootDir,
		workspaces: new Map(),
		cleanup: async () => {
			try {
				await fs.rm(rootDir, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
		},
	};
}

/**
 * Get or create a workspace subdirectory within a synthetic repo.
 */
export async function ensureWorkspaceDir(repo: SyntheticRepo, workspaceId: string): Promise<string> {
	let dir = repo.workspaces.get(workspaceId);
	if (!dir) {
		dir = path.join(repo.rootDir, workspaceId);
		await fs.mkdir(dir, { recursive: true });
		repo.workspaces.set(workspaceId, dir);
	}
	return dir;
}

/**
 * Check if a file exists in the workspace dir.
 */
export async function fileExists(workspaceDir: string, relativePath: string): Promise<boolean> {
	try {
		await fs.access(path.join(workspaceDir, relativePath));
		return true;
	} catch {
		return false;
	}
}

/**
 * Get all file paths in a workspace directory recursively.
 */
export async function listFiles(workspaceDir: string): Promise<string[]> {
	const result: string[] = [];
	async function walk(dir: string) {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
			} else {
				result.push(full);
			}
		}
	}
	await walk(workspaceDir);
	return result;
}
