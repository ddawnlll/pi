/**
 * Project State — Barrel exports
 *
 * PSS-MEGA-01: Baseline Snapshot
 */

export { atomicWriteJson, readJsonFile } from "./atomic-write.js";
// PSS-MEGA-02 exports
export { classifyCommand } from "./bash-classifier.js";
export { classifyFile, isSmartReadEligible } from "./classify-file.js";
export { buildFilesState, type DiscoveryResult, discoverFiles } from "./discovery.js";
export { ProjectStateEventJournal } from "./event-journal.js";
export type {
	CommandClassification,
	CommandStateEffect,
	FsChangeFlushReason,
	MutationWindow,
	ProjectStateEvent,
	ProjectStateEventEnvelope,
	ProjectStateFsChange,
	ProjectStateQueryResult,
	QueryRenderOptions,
	ReconcileLevel,
	ReconcileOptions,
	ReconcileResult,
} from "./event-types.js";
export { buildGitState } from "./git-snapshot.js";
export { hashContent, hashFile, hashSortedStrings } from "./hash.js";
export { MutationWindowStore } from "./mutation-window-store.js";
export { buildPackageState } from "./package-snapshot.js";
export {
	CONFIG_FILE_PATTERNS,
	DEFAULT_INCLUDED_EXTENSIONS,
	ensureDir,
	getSnapshotRunFilePath,
	getSnapshotRunsDir,
	getStateDir,
	getStateFilePath,
	HARD_EXCLUDED_DIRS,
	MAX_JSON_SCAN_BYTES,
	MAX_SMART_READ_FILE_BYTES,
	PROJECT_STATE_DIR,
	SCHEMA_VERSION,
	SECRET_FILE_PATTERNS,
	SMART_READ_ELIGIBLE_EXTENSIONS,
	SNAPSHOT_RUNS_DIR,
	STATE_FILES,
} from "./paths.js";
export { ProjectStateProjector } from "./projector.js";
export { QueryService } from "./query-service.js";
export { ReadTimeVerifier, type VerificationResult } from "./read-time-verifier.js";
export { DEFAULT_BOUNDED_TREE_STAT_LIMIT, ReconcileScanner } from "./reconcile-scanner.js";
export { SmartReadBridge, type SmartReadWarmResult } from "./smart-read-bridge.js";
export { SnapshotRunStore } from "./snapshot-run-store.js";
export { ProjectStateSnapshotService } from "./snapshot-service.js";
export { type ProjectStateBundle, ProjectStateStore } from "./store.js";
export { ToolEventEmitter } from "./tool-event-emitter.js";
export { buildTreeIndex } from "./tree-builder.js";
export type {
	DirectoryEntry,
	GitStateSummary,
	PackageEntry,
	PackageState,
	ProjectDirtyState,
	ProjectFileEntry,
	ProjectFilesState,
	ProjectStateManifest,
	ProjectTreeIndex,
	SnapshotOptions,
	SnapshotProgress,
	SnapshotResult,
	SnapshotRunState,
	SnapshotStatusReport,
	SnapshotValidity,
} from "./types.js";
export { ProjectStateWatcher } from "./watcher.js";
