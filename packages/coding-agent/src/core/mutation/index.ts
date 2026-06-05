/**
 * Mutation Guard — P43.8C Smart Mutation Engine
 *
 * Guards for edit/write tool integration.
 */

export {
	atomicWriteFile,
	computeFileHash,
	computeFileHashFromPath,
	createBackup,
	restoreBackup,
} from "./atomic-file-writer.js";
export * from "./mutation-types.js";
export { validateFileContent } from "./parser-validation.js";
export { SmartMutationEngine } from "./smart-mutation-engine.js";
export { checkWriteSet, isAllowedByWriteSet, normalizeRepoPath } from "./write-set-guard.js";
