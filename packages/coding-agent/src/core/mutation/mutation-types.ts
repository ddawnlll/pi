/**
 * Mutation Types — P43.8C Smart Mutation Engine
 *
 * Core type contracts for mutation operations.
 */

// =========================================================================
// Mutation Mode
// =========================================================================

export type MutationMode = "create" | "edit" | "overwrite" | "append" | "patch" | "delete";

export type MutationSafetyLevel = "safe" | "guarded" | "dangerous" | "blocked";

// =========================================================================
// Mutation Request
// =========================================================================

export interface MutationRequest {
	/** Root of the repository */
	repoRoot: string;
	/** Workspace identifier for audit */
	workspaceId?: string;
	/** File path (absolute or repo-relative) */
	path: string;
	/** Mutation mode */
	mode: MutationMode;
	/** Content to write (for create/overwrite) */
	content?: string;
	/** Exact old text to replace (for edit) */
	oldText?: string;
	/** New text to insert (for edit) */
	newText?: string;
	/** Allowed write-set patterns for this workspace */
	allowedWriteSet?: string[];
	/** Glob patterns for allowed generated artifacts */
	allowlistedArtifactGlobs?: string[];
	/** Whether to allow large existing file overwrite */
	allowLargeOverwrite?: boolean;
	/** Justification for destructive overwrite */
	destructiveOverwriteJustification?: string;
	/** Manifest for new file creation */
	manifest?: MutationManifest;
	/** Validation policy */
	validationPolicy?: MutationValidationPolicy;
}

export interface MutationManifest {
	purpose: string;
	expectedFileKind?: "source" | "test" | "config" | "doc" | "generated" | "report";
	shouldUpdateBarrelExport?: boolean;
	belongsToWriteSet?: boolean;
}

export interface MutationValidationPolicy {
	parserValidation: "required" | "best_effort" | "disabled";
	rollbackOnParserFailure: boolean;
	allowParserUnavailable?: boolean;
}

// =========================================================================
// Mutation Result
// =========================================================================

export interface MutationResult {
	ok: boolean;
	path: string;
	mode: MutationMode;
	safetyLevel: MutationSafetyLevel;

	blocked?: boolean;
	blockReason?: string;

	preHash?: string;
	postHash?: string;

	createdFile?: boolean;
	modifiedFile?: boolean;
	deletedFile?: boolean;

	backupPath?: string;
	rolledBack?: boolean;
	rollbackReason?: string;

	parserValidation?: ParserValidationResult;
	writeSetCheck?: WriteSetCheckResult;

	editRecovery?: EditRecoveryResult;

	lineDelta?: number;
	byteDelta?: number;
	similarity?: number;

	report?: MutationReport;
}

// =========================================================================
// Validation Sub-results
// =========================================================================

export interface ParserValidationResult {
	ok: boolean;
	parser: string;
	parseSource?: string;
	diagnostics: Array<{
		message: string;
		line?: number;
		column?: number;
		severity: "error" | "warning";
	}>;
}

export interface WriteSetCheckResult {
	ok: boolean;
	path: string;
	repoRelativePath: string;
	withinRepo: boolean;
	allowedByWriteSet: boolean;
	allowedByArtifactPolicy: boolean;
	reason?: string;
}

export interface EditRecoveryResult {
	attempted: boolean;
	strategy?: "exact" | "normalized_whitespace" | "candidate_range" | "semantic_diff" | "symbol_anchor" | "failed";
	candidateSimilarity?: number;
	range?: {
		startLine: number;
		endLine: number;
	};
	reason?: string;
}

// =========================================================================
// Mutation Report
// =========================================================================

export interface MutationReport {
	path: string;
	mode: MutationMode;
	safetyLevel: MutationSafetyLevel;
	preHash: string | null;
	postHash: string | null;
	blocked: boolean;
	blockReason: string | null;
	rolledBack: boolean;
	rollbackReason: string | null;
	editRecoveryStrategy: string | null;
	parserOk: boolean | null;
	parserName: string | null;
	writeSetOk: boolean | null;
	timestamp: string;
}

// =========================================================================
// Configuration
// =========================================================================

export interface SmartMutationEngineConfig {
	/** Line count threshold for "large" file overwrite prevention */
	largeFileLineThreshold: number;
	/** Very large file threshold */
	veryLargeFileLineThreshold: number;
	/** Huge file threshold (blocked unless strict conditions met) */
	hugeFileLineThreshold: number;
	/** Max ratio of lines dropped during overwrite (content before vs after) */
	maxOverwriteLineDropRatio: number;
	/** Max ratio of bytes dropped during overwrite */
	maxOverwriteByteDropRatio: number;
	/** Minimum candidate similarity for edit recovery */
	minCandidateSimilarity: number;
	/** Maximum file size in bytes for parser validation */
	maxParserValidationSizeBytes: number;
	/** Whether to roll back on parser failure by default */
	defaultRollbackOnParserFailure: boolean;
}

export const DEFAULT_MUTATION_ENGINE_CONFIG: SmartMutationEngineConfig = {
	largeFileLineThreshold: 300,
	veryLargeFileLineThreshold: 1000,
	hugeFileLineThreshold: 2000,
	maxOverwriteLineDropRatio: 0.4,
	maxOverwriteByteDropRatio: 0.4,
	minCandidateSimilarity: 0.95,
	maxParserValidationSizeBytes: 500_000,
	defaultRollbackOnParserFailure: true,
};

// =========================================================================
// Source-like file detection
// =========================================================================

const SOURCE_LIKE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".rs",
	".go",
	".java",
	".rb",
	".php",
	".swift",
	".kt",
	".scala",
	".hs",
]);

const DATA_FILE_EXTENSIONS = new Set([".json", ".jsonc", ".yaml", ".yml", ".toml", ".xml", ".csv"]);

export function isSourceLikeFile(filePath: string): boolean {
	const ext = filePath.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
	return SOURCE_LIKE_EXTENSIONS.has(ext);
}

export function isDataFile(filePath: string): boolean {
	const ext = filePath.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
	return DATA_FILE_EXTENSIONS.has(ext);
}

export function isDocumentFile(filePath: string): boolean {
	const ext = filePath.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
	return [".md", ".txt", ".mdx", ".rst"].includes(ext);
}
