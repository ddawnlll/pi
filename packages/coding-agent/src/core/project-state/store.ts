/**
 * ProjectStateStore
 *
 * Persists project state files atomically under .pi/project-state/.
 * Handles read/load with graceful fallback on corruption.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { atomicWriteJson, readJsonFile } from "./atomic-write.js";
import { hashContent } from "./hash.js";
import { ensureDir, getStateDir, getStateFilePath, SCHEMA_VERSION, STATE_FILES } from "./paths.js";
import type {
	GitStateSummary,
	PackageState,
	ProjectDirtyState,
	ProjectFilesState,
	ProjectStateManifest,
	ProjectTreeIndex,
} from "./types.js";

/**
 * Loaded project state (all segments).
 */
export interface ProjectStateBundle {
	manifest?: ProjectStateManifest;
	files?: ProjectFilesState;
	tree?: ProjectTreeIndex;
	packages?: PackageState;
	git?: GitStateSummary;
	dirty?: ProjectDirtyState;
}

/**
 * ProjectStateStore
 *
 * Handles all I/O for project state files under a given root directory.
 */
export class ProjectStateStore {
	private rootDir: string;
	private stateDir: string;

	constructor(rootDir: string) {
		this.rootDir = resolve(rootDir);
		this.stateDir = getStateDir(this.rootDir);
	}

	/**
	 * Get the state directory path.
	 */
	getStateDir(): string {
		return this.stateDir;
	}

	/**
	 * Ensure the state directory exists.
	 */
	ensureStateDir(): boolean {
		return ensureDir(this.stateDir);
	}

	// ========================================================================
	// Manifest
	// ========================================================================

	/**
	 * Create a new manifest with defaults.
	 */
	createManifest(fileCount: number, sourceFileCount: number, treeHash: string): ProjectStateManifest {
		return {
			schemaVersion: SCHEMA_VERSION,
			snapshotId: randomUUID().slice(0, 12),
			rootDir: this.rootDir,
			normalizedRootHash: hashContent(this.rootDir.toLowerCase().replace(/\\/g, "/")),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			treeHash,
			fileCount,
			sourceFileCount,
			lastAppliedSequence: 0,
			validity: {
				tree: "unknown",
				files: "unknown",
				packages: "unknown",
				git: "unknown",
				commands: "stale",
				smartRead: "unknown",
			},
		};
	}

	/**
	 * Save manifest atomically.
	 */
	saveManifest(manifest: ProjectStateManifest): void {
		manifest.updatedAt = new Date().toISOString();
		atomicWriteJson(manifest, getStateFilePath(this.rootDir, STATE_FILES.MANIFEST));
	}

	/**
	 * Load manifest. Returns undefined if missing or malformed.
	 */
	loadManifest(): ProjectStateManifest | undefined {
		const data = readJsonFile<ProjectStateManifest>(getStateFilePath(this.rootDir, STATE_FILES.MANIFEST));
		if (data && data.schemaVersion === SCHEMA_VERSION && data.rootDir === this.rootDir) {
			return data;
		}
		return undefined;
	}

	// ========================================================================
	// Files
	// ========================================================================

	/**
	 * Save files state atomically.
	 */
	saveFilesState(filesState: ProjectFilesState): void {
		atomicWriteJson(filesState, getStateFilePath(this.rootDir, STATE_FILES.FILES));
	}

	/**
	 * Load files state. Returns undefined if missing or malformed.
	 */
	loadFilesState(): ProjectFilesState | undefined {
		const data = readJsonFile<ProjectFilesState>(getStateFilePath(this.rootDir, STATE_FILES.FILES));
		if (data && data.schemaVersion === SCHEMA_VERSION) {
			return data;
		}
		return undefined;
	}

	// ========================================================================
	// Tree
	// ========================================================================

	/**
	 * Save tree index atomically.
	 */
	saveTreeIndex(treeIndex: ProjectTreeIndex): void {
		atomicWriteJson(treeIndex, getStateFilePath(this.rootDir, STATE_FILES.TREE));
	}

	/**
	 * Load tree index. Returns undefined if missing or malformed.
	 */
	loadTreeIndex(): ProjectTreeIndex | undefined {
		const data = readJsonFile<ProjectTreeIndex>(getStateFilePath(this.rootDir, STATE_FILES.TREE));
		if (data && data.schemaVersion === SCHEMA_VERSION) {
			return data;
		}
		return undefined;
	}

	// ========================================================================
	// Packages
	// ========================================================================

	/**
	 * Save package state atomically.
	 */
	savePackageState(packageState: PackageState): void {
		atomicWriteJson(packageState, getStateFilePath(this.rootDir, STATE_FILES.PACKAGES));
	}

	/**
	 * Load package state. Returns undefined if missing or malformed.
	 */
	loadPackageState(): PackageState | undefined {
		const data = readJsonFile<PackageState>(getStateFilePath(this.rootDir, STATE_FILES.PACKAGES));
		if (data && data.schemaVersion === SCHEMA_VERSION) {
			return data;
		}
		return undefined;
	}

	// ========================================================================
	// Git
	// ========================================================================

	/**
	 * Save git state atomically.
	 */
	saveGitState(gitState: GitStateSummary): void {
		atomicWriteJson(gitState, getStateFilePath(this.rootDir, STATE_FILES.GIT));
	}

	/**
	 * Load git state. Returns undefined if missing or malformed.
	 */
	loadGitState(): GitStateSummary | undefined {
		const data = readJsonFile<GitStateSummary>(getStateFilePath(this.rootDir, STATE_FILES.GIT));
		if (data && data.schemaVersion === SCHEMA_VERSION) {
			return data;
		}
		return undefined;
	}

	// ========================================================================
	// Dirty
	// ========================================================================

	/**
	 * Save dirty state atomically.
	 */
	saveDirtyState(dirtyState: ProjectDirtyState): void {
		atomicWriteJson(dirtyState, getStateFilePath(this.rootDir, STATE_FILES.DIRTY));
	}

	/**
	 * Load dirty state. Returns undefined if missing or malformed.
	 */
	loadDirtyState(): ProjectDirtyState | undefined {
		return readJsonFile<ProjectDirtyState>(getStateFilePath(this.rootDir, STATE_FILES.DIRTY));
	}

	// ========================================================================
	// Bundle
	// ========================================================================

	/**
	 * Load all available state segments. Missing/corrupt segments are undefined.
	 */
	loadBundle(): ProjectStateBundle {
		return {
			manifest: this.loadManifest(),
			files: this.loadFilesState(),
			tree: this.loadTreeIndex(),
			packages: this.loadPackageState(),
			git: this.loadGitState(),
			dirty: this.loadDirtyState(),
		};
	}

	/**
	 * Check if any state files exist.
	 */
	hasAnyState(): boolean {
		return Object.values(STATE_FILES).some((name) => {
			const fp = getStateFilePath(this.rootDir, name);
			return existsSync(fp);
		});
	}

	/**
	 * Get the root directory for this store.
	 */
	getRootDir(): string {
		return this.rootDir;
	}
}
