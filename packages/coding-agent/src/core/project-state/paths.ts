/**
 * Project State — Paths & Constants
 *
 * Defines file paths under .pi/project-state/ and default config values.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ============================================================================
// Constants
// ============================================================================

/** Schema version for all state files */
export const SCHEMA_VERSION = 1;

/** State directory name under repo root */
export const PROJECT_STATE_DIR = ".pi/project-state";

/** Snapshot runs subdirectory */
export const SNAPSHOT_RUNS_DIR = "snapshot-runs";

/** Default excluded directories (never discovered) */
export const HARD_EXCLUDED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"coverage",
	".next",
	".turbo",
	".venv",
	"venv",
	"target",
	".cache",
	".pi/project-state",
	".pi/smart-read-cache",
]);

/** Default included source/config extensions */
export const DEFAULT_INCLUDED_EXTENSIONS = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".json",
	".py",
	".rs",
	".go",
	".md",
	".yaml",
	".yml",
	".toml",
];

/** Extensions eligible for Smart Read warmup */
export const SMART_READ_ELIGIBLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go"]);

/** Extensions always excluded from Smart Read */
export const SMART_READ_UNSUPPORTED_EXTENSIONS = new Set([".md", ".yaml", ".yml", ".toml"]);

/** Max file size for Smart Read warmup (5 MB) */
export const MAX_SMART_READ_FILE_BYTES = 5 * 1024 * 1024;

/** Max JSON file size for scanning (500 KB) */
export const MAX_JSON_SCAN_BYTES = 500 * 1024;

/** Progress throttle interval in ms */
export const PROGRESS_THROTTLE_MS = 250;

/** Max concurrency cap */
export const MAX_CONCURRENCY = 64;

/** Min concurrency */
export const MIN_CONCURRENCY = 1;

/** Default concurrency factor */
export const DEFAULT_CONCURRENCY_FACTOR = 2;

/** Files considered secrets (never content-cached) */
export const SECRET_FILE_PATTERNS = [
	".env",
	".env.",
	".env.local",
	".env.production",
	".pem",
	".key",
	"id_rsa",
	"id_ed25519",
	".npmrc",
	"credentials",
	"secrets",
	"oauth",
];

/** Config file name patterns */
export const CONFIG_FILE_PATTERNS = [
	"package.json",
	"tsconfig",
	"vite.config.",
	"vitest.config.",
	"jest.config.",
	"eslintrc",
	".eslintrc",
	"prettierrc",
	".prettierrc",
	".prettierrc.",
	"pnpm-workspace.yaml",
	"turbo.json",
];

/** Test file patterns */
export const TEST_PATTERNS = [".test.", ".spec.", "/test/", "/tests/"];

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Get the absolute path to the project state directory for a given root.
 */
export function getStateDir(rootDir: string): string {
	return resolve(join(rootDir, PROJECT_STATE_DIR));
}

/**
 * Get the absolute path to a specific state file.
 */
export function getStateFilePath(rootDir: string, filename: string): string {
	return join(getStateDir(rootDir), filename);
}

/**
 * Get the absolute path to the snapshot runs directory.
 */
export function getSnapshotRunsDir(rootDir: string): string {
	return join(getStateDir(rootDir), SNAPSHOT_RUNS_DIR);
}

/**
 * Get the absolute path to a specific snapshot run file.
 */
export function getSnapshotRunFilePath(rootDir: string, runId: string): string {
	return join(getSnapshotRunsDir(rootDir), `${runId}.json`);
}

/**
 * Ensure a directory exists (recursive). Returns true if created, false if already exists.
 */
export function ensureDir(dir: string): boolean {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
		return true;
	}
	return false;
}

// ============================================================================
// State file names
// ============================================================================

export const STATE_FILES = {
	MANIFEST: "manifest.json",
	FILES: "files.json",
	TREE: "tree.json",
	PACKAGES: "packages.json",
	GIT: "git.json",
	DIRTY: "dirty.json",
} as const;
