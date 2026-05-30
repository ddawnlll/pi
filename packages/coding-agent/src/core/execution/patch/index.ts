/**
 * Patch execution module - P4.5 Workstream + P37.03 Workstream
 *
 * Aggregates exports for the patch artifact schema, store, status, and
 * validation plan, plus P37.04 patch workspace orchestration, and
 * P37.03 PatchCoordinator, Guards, and Rollback Core.
 */

// P37.04 exports
export type {
	DiffGeneratorOptions,
	DiffResult,
} from "./diff-generator.js";
export {
	generateCreatedFileDiff,
	generateDeletedFileDiff,
	generateDiff,
	generateDirectoryDiffs,
	generateFileDiff,
} from "./diff-generator.js";
export type {
	DirectMutationCheckResult,
	DirectMutationDetectorConfig,
} from "./direct-mutation-detector.js";
export {
	createDirectMutationDetector,
	DirectMutationDetector,
} from "./direct-mutation-detector.js";
export type {
	PatchArtifact,
	PatchFileOperation,
	PatchWriteSet,
} from "./patch-artifact.js";
export {
	createPatchArtifact,
	createPatchFileOperation,
	createPatchWriteSet,
	generatePatchArtifactId,
} from "./patch-artifact.js";
export type { PatchArtifactStoreConfig } from "./patch-artifact-store.js";
export { PatchArtifactStore } from "./patch-artifact-store.js";
// P37.03 exports
export type { CoordinationResult, CoordinationStatus, PatchCoordinatorConfig } from "./patch-coordinator.js";
export { createPatchCoordinator, PatchCoordinator } from "./patch-coordinator.js";
export type { GuardErrorCode, GuardResult, PatchGuardConfig, PatchGuardResult } from "./patch-guards.js";
export {
	checkApplyValidation,
	checkForbiddenPaths,
	checkStaleHash,
	checkWriteSet,
	runAllGuards,
} from "./patch-guards.js";
export type { PatchStatus } from "./patch-status.js";
export type { PatchValidationError, PatchValidationResult } from "./patch-validation-plan.js";
export { validatePatchArtifact } from "./patch-validation-plan.js";
export type {
	PatchMode,
	PatchWorkspaceConfig,
	PatchWorkspaceResult,
} from "./patch-workspace.js";
export {
	createPatchWorkspace,
	PatchWorkspace,
} from "./patch-workspace.js";
export type { FileSnapshot, RollbackManagerConfig, RollbackResult } from "./rollback-manager.js";
export { createRollbackManager, RollbackManager } from "./rollback-manager.js";
