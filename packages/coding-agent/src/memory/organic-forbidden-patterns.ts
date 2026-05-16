/**
 * Organic Forbidden Patterns - P11.F
 *
 * Defines forbidden file and content patterns that are blocked
 * before memory ingestion. This prevents sensitive or dangerous
 * content from being stored in the organic memory store.
 *
 * Patterns are matched against:
 * - File paths (for file-scoped memory)
 * - Content text (for direct content ingestion)
 * - Source pointers (for provenance-scoped memory)
 *
 * Two categories of patterns:
 * - Hard blocks: Never allowed (secrets, keys, binaries, vendor dirs)
 * - Soft blocks: Blocked by default but can be overridden
 */

import { minimatch } from "minimatch";

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

/**
 * A forbidden pattern with metadata.
 */
export interface ForbiddenPattern {
	/** Glob pattern or regex string to match */
	pattern: string;
	/** Whether this is a file path pattern (glob) or content pattern (regex) */
	type: "glob" | "regex";
	/** Why this pattern is blocked */
	reason: string;
	/** Whether this is a hard block (cannot be overridden) */
	hard: boolean;
	/** Severity level for classification when matched */
	severity: "forbidden" | "unsafe" | "caution";
}

// ---------------------------------------------------------------------------
// Default forbidden patterns
// ---------------------------------------------------------------------------

/**
 * Default set of forbidden patterns.
 *
 * These cover:
 * - Secret files and keys (*.key, *.pem, *.p12, secrets*)
 * - Credential files (.env, .env.*, credentials, .netrc)
 * - Vendor directories (node_modules, vendor, .git)
 * - Build artifacts (dist, build, .next, out)
 * - Binary/lock files (*.lock, *.exe, *.dll, *.so)
 * - System files (.DS_Store, Thumbs.db)
 * - Sensitive config files (config with secrets patterns)
 */
export const DEFAULT_FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
	// --- Hard blocks: secrets and credentials ---
	{ pattern: "**/*.key", type: "glob", reason: "Private key file", hard: true, severity: "forbidden" },
	{ pattern: "**/*.pem", type: "glob", reason: "Certificate or private key", hard: true, severity: "forbidden" },
	{ pattern: "**/*.p12", type: "glob", reason: "PKCS#12 keystore", hard: true, severity: "forbidden" },
	{ pattern: "**/*.pfx", type: "glob", reason: "PFX certificate", hard: true, severity: "forbidden" },
	{ pattern: "**/*.jks", type: "glob", reason: "Java keystore", hard: true, severity: "forbidden" },
	{ pattern: "**/secrets*", type: "glob", reason: "Secrets file", hard: true, severity: "forbidden" },
	{ pattern: "**/*secret*", type: "glob", reason: "File with 'secret' in name", hard: true, severity: "forbidden" },
	{
		pattern: "**/.env",
		type: "glob",
		reason: "Environment file (may contain secrets)",
		hard: true,
		severity: "forbidden",
	},
	{ pattern: "**/.env.*", type: "glob", reason: "Environment variant file", hard: true, severity: "forbidden" },
	{ pattern: "**/credentials*", type: "glob", reason: "Credentials file", hard: true, severity: "forbidden" },
	{ pattern: "**/.netrc", type: "glob", reason: "Netrc credentials file", hard: true, severity: "forbidden" },
	{
		pattern: "**/*.npmrc",
		type: "glob",
		reason: "NPM config (may contain tokens)",
		hard: true,
		severity: "forbidden",
	},

	// --- Hard blocks: vendor / dependency directories ---
	{
		pattern: "**/node_modules/**",
		type: "glob",
		reason: "Node.js dependencies directory",
		hard: true,
		severity: "forbidden",
	},
	{ pattern: "**/.git/**", type: "glob", reason: "Git internal directory", hard: true, severity: "forbidden" },
	{
		pattern: "**/vendor/**",
		type: "glob",
		reason: "Vendor dependencies directory",
		hard: true,
		severity: "forbidden",
	},
	{ pattern: "**/.yarn/**", type: "glob", reason: "Yarn internals", hard: true, severity: "forbidden" },

	// --- Hard blocks: binary / lock files ---
	{ pattern: "**/*.exe", type: "glob", reason: "Windows executable (binary)", hard: true, severity: "forbidden" },
	{ pattern: "**/*.dll", type: "glob", reason: "Dynamic link library (binary)", hard: true, severity: "forbidden" },
	{ pattern: "**/*.so", type: "glob", reason: "Shared object (binary)", hard: true, severity: "forbidden" },
	{ pattern: "**/*.dylib", type: "glob", reason: "Dynamic library (binary)", hard: true, severity: "forbidden" },
	{ pattern: "**/*.bin", type: "glob", reason: "Binary file", hard: true, severity: "forbidden" },
	{
		pattern: "**/package-lock.json",
		type: "glob",
		reason: "Package lock (auto-generated, large)",
		hard: true,
		severity: "forbidden",
	},
	{
		pattern: "**/yarn.lock",
		type: "glob",
		reason: "Yarn lock (auto-generated, large)",
		hard: true,
		severity: "forbidden",
	},

	// --- Hard blocks: build artifacts ---
	{ pattern: "**/dist/**", type: "glob", reason: "Build output directory", hard: true, severity: "forbidden" },
	{ pattern: "**/build/**", type: "glob", reason: "Build output directory", hard: true, severity: "forbidden" },
	{ pattern: "**/.next/**", type: "glob", reason: "Next.js build output", hard: true, severity: "forbidden" },
	{ pattern: "**/out/**", type: "glob", reason: "Build output directory", hard: true, severity: "forbidden" },
	{
		pattern: "**/target/**",
		type: "glob",
		reason: "Build output directory (Rust/Java)",
		hard: true,
		severity: "forbidden",
	},
	{ pattern: "**/.cache/**", type: "glob", reason: "Cache directory", hard: true, severity: "forbidden" },

	// --- Soft blocks: system / config files ---
	{ pattern: "**/.DS_Store", type: "glob", reason: "macOS metadata file", hard: false, severity: "unsafe" },
	{ pattern: "**/Thumbs.db", type: "glob", reason: "Windows thumbnail cache", hard: false, severity: "unsafe" },
	{ pattern: "**/.gitignore", type: "glob", reason: "Git ignore (project config)", hard: false, severity: "caution" },

	// --- Content patterns (regex) ---
	{
		pattern: "-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----",
		type: "regex",
		reason: "Private key content detected",
		hard: true,
		severity: "forbidden",
	},
	{
		pattern: "ghp_[A-Za-z0-9]{36}",
		type: "regex",
		reason: "GitHub personal access token",
		hard: true,
		severity: "forbidden",
	},
	{
		pattern: "gho_[A-Za-z0-9]{36}",
		type: "regex",
		reason: "GitHub OAuth access token",
		hard: true,
		severity: "forbidden",
	},
	{
		pattern: "sk-[A-Za-z0-9]{32,}",
		type: "regex",
		reason: "OpenAI API key",
		hard: true,
		severity: "forbidden",
	},
	{
		pattern: "AKIA[0-9A-Z]{16}",
		type: "regex",
		reason: "AWS access key ID",
		hard: true,
		severity: "forbidden",
	},
	{
		pattern: "-----BEGIN CERTIFICATE-----",
		type: "regex",
		reason: "Certificate content detected",
		hard: true,
		severity: "forbidden",
	},
];

// ---------------------------------------------------------------------------
// Check result
// ---------------------------------------------------------------------------

/**
 * Result of a forbidden pattern check.
 */
export interface ForbiddenCheckResult {
	/** Whether the item is blocked */
	blocked: boolean;
	/** Whether the block is hard (cannot be overridden) */
	hard: boolean;
	/** Matched patterns (if any) */
	matchedPatterns: ForbiddenPattern[];
	/** Reason summary if blocked */
	reason?: string;
	/** Safety severity if blocked */
	severity?: "forbidden" | "unsafe" | "caution";
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

/**
 * Checker for forbidden patterns.
 *
 * Examines file paths and content against configured patterns
 * and returns whether the item should be blocked from ingestion.
 */
export class ForbiddenPatternChecker {
	private patterns: ForbiddenPattern[];

	/**
	 * Create a new ForbiddenPatternChecker.
	 *
	 * @param patterns - Array of forbidden patterns (defaults to DEFAULT_FORBIDDEN_PATTERNS)
	 */
	constructor(patterns?: ForbiddenPattern[]) {
		this.patterns = patterns ?? [...DEFAULT_FORBIDDEN_PATTERNS];
	}

	/**
	 * Check a file path against the forbidden patterns.
	 *
	 * @param filePath - The file path to check (relative or absolute)
	 * @returns ForbiddenCheckResult with match details
	 */
	checkFilePath(filePath: string): ForbiddenCheckResult {
		const matched: ForbiddenPattern[] = [];

		for (const fp of this.patterns) {
			if (fp.type === "glob" && minimatch(filePath, fp.pattern, { dot: true })) {
				matched.push(fp);
			}
		}

		return this.buildResult(matched);
	}

	/**
	 * Check content text against regex forbidden patterns.
	 *
	 * @param content - The text content to check
	 * @returns ForbiddenCheckResult with match details
	 */
	checkContent(content: string): ForbiddenCheckResult {
		const matched: ForbiddenPattern[] = [];

		for (const fp of this.patterns) {
			if (fp.type === "regex") {
				try {
					const re = new RegExp(fp.pattern);
					if (re.test(content)) {
						matched.push(fp);
					}
				} catch {
					// Skip invalid regex patterns silently
				}
			}
		}

		return this.buildResult(matched);
	}

	/**
	 * Comprehensive check: file path + content.
	 * This is the primary method to use before ingesting memory.
	 *
	 * @param filePath - Optional file path to check
	 * @param content - Optional text content to check
	 * @returns ForbiddenCheckResult (blocked == true if any hard pattern matched)
	 */
	checkComprehensive(filePath?: string, content?: string): ForbiddenCheckResult {
		const matched: ForbiddenPattern[] = [];

		if (filePath) {
			const fileResult = this.checkFilePath(filePath);
			matched.push(...fileResult.matchedPatterns);
		}

		if (content) {
			const contentResult = this.checkContent(content);
			matched.push(...contentResult.matchedPatterns);
		}

		return this.buildResult(matched);
	}

	/**
	 * Get a copy of the current patterns.
	 */
	getPatterns(): ForbiddenPattern[] {
		return [...this.patterns];
	}

	/**
	 * Add a custom forbidden pattern.
	 *
	 * @param pattern - The pattern to add
	 */
	addPattern(pattern: ForbiddenPattern): void {
		this.patterns.push(pattern);
	}

	/**
	 * Remove a pattern by its glob/regex string.
	 *
	 * @param patternStr - The pattern string to remove
	 * @returns True if a pattern was removed
	 */
	removePattern(patternStr: string): boolean {
		const idx = this.patterns.findIndex((p) => p.pattern === patternStr);
		if (idx !== -1) {
			this.patterns.splice(idx, 1);
			return true;
		}
		return false;
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	private buildResult(matched: ForbiddenPattern[]): ForbiddenCheckResult {
		if (matched.length === 0) {
			return { blocked: false, hard: false, matchedPatterns: [] };
		}

		const hardMatched = matched.filter((m) => m.hard);
		const blocked = hardMatched.length > 0;
		const hard = hardMatched.length > 0;

		// Determine the highest severity
		let highestSeverity: "forbidden" | "unsafe" | "caution" = "caution";
		for (const m of matched) {
			if (m.severity === "forbidden") {
				highestSeverity = "forbidden";
				break;
			}
			if (m.severity === "unsafe") highestSeverity = "unsafe";
		}

		const reasons = matched.map((m) => m.reason);
		const uniqueReasons = [...new Set(reasons)];

		return {
			blocked,
			hard,
			matchedPatterns: matched,
			reason: uniqueReasons.join("; "),
			severity: highestSeverity,
		};
	}
}
