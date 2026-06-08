/**
 * Project State Snapshot — Type Definitions
 *
 * PSS-MEGA-01: Baseline Snapshot types.
 * PSS-MEGA-02: Event journal / projector / classifier / watcher / reconcile / query types.
 */

// ============================================================================
// Validity
// ============================================================================

export type SnapshotValidity = "valid" | "dirty" | "stale" | "unknown";

// ============================================================================
// Manifest
// ============================================================================

export interface ProjectStateManifest {
	schemaVersion: number;
	snapshotId: string;
	rootDir: string;
	normalizedRootHash: string;
	createdAt: string;
	updatedAt: string;
	headSha?: string;
	branch?: string;
	treeHash: string;
	fileCount: number;
	sourceFileCount: number;
	lastAppliedSequence: number;
	lastCompactedSequence?: number;
	validity: {
		tree: SnapshotValidity;
		files: SnapshotValidity;
		packages: SnapshotValidity;
		git: SnapshotValidity;
		commands: SnapshotValidity;
		smartRead: SnapshotValidity;
	};
}

// ============================================================================
// File Entry
// ============================================================================

export interface ProjectFileEntry {
	path: string;
	ext: string;
	language?: string;
	sizeBytes: number;
	mtimeMs: number;
	contentHash?: string;
	lineCount?: number;
	isSource: boolean;
	isTest: boolean;
	isConfig: boolean;
	isGenerated: boolean;
	isIgnored: boolean;
	smartReadCacheKey?: string;
	smartReadStatus?: "missing" | "warm" | "stale" | "unsupported" | "failed";
	smartReadError?: string;
	lastVerifiedAt?: string;
	lastChangedSequence?: number;
}

// ============================================================================
// Files State
// ============================================================================

export interface ProjectFilesState {
	schemaVersion: number;
	rootDir: string;
	generatedAt: string;
	files: Record<string, ProjectFileEntry>;
}

// ============================================================================
// Tree State
// ============================================================================

export interface DirectoryEntry {
	path: string;
	childDirs: string[];
	files: string[];
	fileCount: number;
	sourceFileCount: number;
	totalBytes: number;
	lastChangedSequence?: number;
	lsCacheKey?: string;
}

export interface ProjectTreeIndex {
	schemaVersion: number;
	rootDir: string;
	generatedAt: string;
	treeHash: string;
	directories: Record<string, DirectoryEntry>;
}

// ============================================================================
// Package / Config State
// ============================================================================

export interface PackageEntry {
	path: string;
	name?: string;
	scripts: Record<string, string>;
	dependenciesHash?: string;
	devDependenciesHash?: string;
	packageHash: string;
}

export interface PackageState {
	schemaVersion: number;
	generatedAt: string;
	packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
	workspaceRoot?: string;
	packageFiles: Record<string, PackageEntry>;
	lockfiles: string[];
	testFrameworkHints: string[];
	configFiles: string[];
	validity: SnapshotValidity;
}

// ============================================================================
// Git State
// ============================================================================

export interface GitStateSummary {
	schemaVersion: number;
	isGitRepo: boolean;
	branch?: string;
	headSha?: string;
	statusPorcelain?: string;
	dirtyFiles: string[];
	untrackedFiles: string[];
	stagedFiles: string[];
	lastCheckedAt: string;
	validity: SnapshotValidity;
}

// ============================================================================
// Dirty State
// ============================================================================

export interface ProjectDirtyState {
	schemaVersion: number;
	generatedAt: string;
	paths: Record<string, SnapshotValidity>;
	segments: Record<string, SnapshotValidity>;
	reason?: string;
}

// ============================================================================
// Snapshot Run State (Resume)
// ============================================================================

export interface SnapshotRunState {
	snapshotRunId: string;
	rootDir: string;
	startedAt: string;
	updatedAt: string;
	status: "running" | "completed" | "failed" | "interrupted";
	phase: string;
	completedFiles: string[];
	failedFiles: Array<{ path: string; error: string }>;
	pendingFiles: string[];
	rawBytes: number;
	compactBytes: number;
	estimatedTokensSaved: number;
}

// ============================================================================
// Snapshot Result (JSON output / CLI summary)
// ============================================================================

export interface SnapshotResult {
	rootDir: string;
	snapshotId: string;
	startedAt: string;
	completedAt: string;
	durationMs: number;
	filesScanned: number;
	sourceFiles: number;
	filesCached: number;
	filesSkipped: number;
	filesFailed: number;
	rawBytes: number;
	compactBytes: number;
	estimatedTokensSaved: number;
	manifestPath: string;
	failures: Array<{ path: string; error: string }>;
}

// ============================================================================
// Snapshot Options
// ============================================================================

export interface SnapshotOptions {
	rootDir: string;
	concurrency?: number;
	force?: boolean;
	json?: boolean;
	noSmartRead?: boolean;
	includeMd?: boolean;
	maxFiles?: number;
	signal?: AbortSignal;
	onProgress?: (progress: SnapshotProgress) => void;
}

export interface SnapshotProgress {
	phase: string;
	scanned: number;
	total: number;
	cached: number;
	skipped: number;
	failed: number;
	currentFile?: string;
	rawBytes: number;
	compactBytes: number;
	estimatedTokensSaved: number;
	percent: number;
}

// ============================================================================
// Snapshot Status
// ============================================================================

export interface SnapshotStatusReport {
	overall: SnapshotValidity | "missing" | "partial";
	rootDir: string;
	manifestPath: string;
	fileCount: number;
	sourceFileCount: number;
	treeValidity: SnapshotValidity;
	filesValidity: SnapshotValidity;
	smartReadWarmCount: number;
	smartReadFailedCount: number;
	packageValidity: SnapshotValidity;
	gitValidity: SnapshotValidity;
	lastUpdated?: string;
	estimatedTokenSavings: number;
	latestRun?: {
		snapshotRunId: string;
		status: SnapshotRunState["status"];
		startedAt: string;
	};
	// PSS-MEGA-02 additions
	eventJournalPresent?: boolean;
	lastEventSequence?: number;
	lastAppliedSequence?: number;
	pendingEventCount?: number;
	watcherStatus?: "running" | "stopped" | "unavailable";
	openMutationWindows?: number;
	journalSizeBytes?: number;
	journalNeedsCompaction?: boolean;
}
