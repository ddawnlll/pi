/**
 * Forbidden file patterns for memory ingestion.
 *
 * Defines patterns that are blocked before memory ingestion to prevent
 * sensitive, temporary, or build-related files from being stored as memory.
 *
 * Workspace P11.F — Organic vector memory store and schema.
 */

/**
 * A single forbidden file pattern definition.
 */
export interface ForbiddenPattern {
	/** Glob-like pattern string (matched against relative file paths) */
	pattern: string;
	/** Human-readable reason why this pattern is blocked */
	reason: string;
	/** Severity level */
	severity: "block" | "warn";
}

// ---------------------------------------------------------------------------
// Default forbidden patterns
// ---------------------------------------------------------------------------

/**
 * Default set of forbidden file patterns.
 *
 * These patterns protect against memory ingestion of:
 * - Hidden files and directories (dotfiles)
 * - Node_modules and dependency directories
 * - Build artifacts (dist, build, .next, etc.)
 * - Environment and secret files (.env, .env.local, etc.)
 * - Git internals (.git/)
 * - Lock files (package-lock.json, yarn.lock)
 * - Binary and media files (images, audio, video)
 * - Large data files
 * - IDE and editor config files
 * - System files
 * - Compiled binaries
 * - Source maps
 * - Coverage reports
 * - Cache directories
 */
export const DEFAULT_FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
	// Secret and environment files
	{ pattern: "**/.env*", reason: "Environment files may contain secrets", severity: "block" },
	{ pattern: "**/*.pem", reason: "Private key / certificate files", severity: "block" },
	{ pattern: "**/*.key", reason: "Private key files", severity: "block" },
	{ pattern: "**/*.cert", reason: "Certificate files", severity: "block" },
	{ pattern: "**/credentials*", reason: "Credential files", severity: "block" },
	{ pattern: "**/secrets*", reason: "Secrets files", severity: "block" },
	{ pattern: "**/.auth*", reason: "Authentication files", severity: "block" },

	// Dependency directories
	{ pattern: "**/node_modules/**", reason: "Third-party dependency files", severity: "block" },
	{ pattern: "**/.pnp.*", reason: "Yarn PnP files", severity: "block" },

	// Build and output directories
	{ pattern: "**/dist/**", reason: "Build output directory", severity: "block" },
	{ pattern: "**/build/**", reason: "Build output directory", severity: "block" },
	{ pattern: "**/.next/**", reason: "Next.js build output", severity: "block" },
	{ pattern: "**/.nuxt/**", reason: "Nuxt build output", severity: "block" },
	{ pattern: "**/out/**", reason: "Build output directory", severity: "block" },

	// Cache directories
	{ pattern: "**/.cache/**", reason: "Cache directory", severity: "block" },
	{ pattern: "**/.turbo/**", reason: "Turborepo cache", severity: "block" },
	{ pattern: "**/__pycache__/**", reason: "Python cache directory", severity: "block" },
	{ pattern: "**/*.tsbuildinfo", reason: "TypeScript build info", severity: "block" },

	// Lock files
	{ pattern: "**/package-lock.json", reason: "Package lock file (auto-generated)", severity: "block" },
	{ pattern: "**/yarn.lock", reason: "Yarn lock file (auto-generated)", severity: "block" },
	{ pattern: "**/pnpm-lock.yaml", reason: "pnpm lock file (auto-generated)", severity: "block" },

	// Binary and large data files
	{ pattern: "**/*.png", reason: "Binary image file", severity: "block" },
	{ pattern: "**/*.jpg", reason: "Binary image file", severity: "block" },
	{ pattern: "**/*.jpeg", reason: "Binary image file", severity: "block" },
	{ pattern: "**/*.gif", reason: "Binary image file", severity: "block" },
	{ pattern: "**/*.ico", reason: "Binary icon file", severity: "block" },
	{ pattern: "**/*.svg", reason: "SVG file", severity: "warn" },
	{ pattern: "**/*.woff*", reason: "Font file", severity: "block" },
	{ pattern: "**/*.ttf", reason: "Font file", severity: "block" },
	{ pattern: "**/*.eot", reason: "Font file", severity: "block" },
	{ pattern: "**/*.mp3", reason: "Audio file", severity: "block" },
	{ pattern: "**/*.mp4", reason: "Video file", severity: "block" },
	{ pattern: "**/*.zip", reason: "Archive file", severity: "block" },
	{ pattern: "**/*.tar*", reason: "Archive file", severity: "block" },
	{ pattern: "**/*.gz", reason: "Compressed file", severity: "block" },
	{ pattern: "**/*.bin", reason: "Binary file", severity: "block" },
	{ pattern: "**/*.exe", reason: "Executable binary", severity: "block" },
	{ pattern: "**/*.dll", reason: "Dynamic link library", severity: "block" },
	{ pattern: "**/*.dylib", reason: "Dynamic library", severity: "block" },
	{ pattern: "**/*.so", reason: "Shared object", severity: "block" },
	{ pattern: "**/*.wasm", reason: "WebAssembly binary", severity: "block" },

	// Coverage reports
	{ pattern: "**/coverage/**", reason: "Code coverage report", severity: "block" },

	// Source maps
	{ pattern: "**/*.map", reason: "Source map file", severity: "block" },

	// IDE and editor files
	{ pattern: "**/.vscode/**", reason: "VS Code settings", severity: "warn" },
	{ pattern: "**/.idea/**", reason: "JetBrains IDE settings", severity: "block" },
	{ pattern: "**/*.swp", reason: "Vim swap file", severity: "block" },
	{ pattern: "**/*.swo", reason: "Vim swap file", severity: "block" },
	{ pattern: "**/.DS_Store", reason: "macOS system file", severity: "block" },
	{ pattern: "**/Thumbs.db", reason: "Windows thumbnail cache", severity: "block" },

	// Git internals
	{ pattern: "**/.git/**", reason: "Git internal directory", severity: "block" },
	{ pattern: "**/.gitattributes", reason: "Git attributes file", severity: "warn" },
	{ pattern: "**/.gitignore", reason: "Git ignore file", severity: "warn" },
	{ pattern: "**/.gitmodules", reason: "Git submodules config", severity: "warn" },
];

// ---------------------------------------------------------------------------
// Forbidden patterns checker
// ---------------------------------------------------------------------------

/**
 * Result of checking a file path against forbidden patterns.
 */
export interface ForbiddenCheckResult {
	/** Whether the file is blocked from ingestion */
	blocked: boolean;
	/** Whether the file triggers a warning */
	warning: boolean;
	/** The matching pattern, if any */
	matchingPattern?: ForbiddenPattern;
	/** Human-readable message */
	message?: string;
}

/**
 * Convert a glob-like pattern to a RegExp.
 *
 * Supports:
 * - `**` (match any number of path segments)
 * - `*` (match within a single path segment)
 * - `?` (match a single character)
 */
function patternToRegex(pattern: string): RegExp {
	let regexStr = "^";

	let i = 0;
	while (i < pattern.length) {
		if (pattern.startsWith("**/", i) || pattern.startsWith("/**", i)) {
			// Handle ** pattern
			if (pattern.startsWith("**/", i)) {
				regexStr += "(?:.*/)?";
				i += 3;
			} else if (pattern.startsWith("/**", i)) {
				regexStr += "(?:/.*)?";
				i += 3;
			}
		} else if (pattern[i] === "*") {
			// Single * - match within segment
			regexStr += "[^/]*";
			i++;
		} else if (pattern[i] === "?") {
			// ? - match single char
			regexStr += "[^/]";
			i++;
		} else if (pattern[i] === ".") {
			// Escape dot
			regexStr += "\\.";
			i++;
		} else {
			// Literal character
			regexStr += pattern[i];
			i++;
		}
	}

	regexStr += "$";
	return new RegExp(regexStr);
}

/**
 * Check if a file path matches any forbidden pattern.
 *
 * @param filePath - Relative file path to check
 * @param patterns - Optional custom patterns (defaults to DEFAULT_FORBIDDEN_PATTERNS)
 * @returns Check result with block/warning status
 */
export function checkForbiddenPatterns(
	filePath: string,
	patterns: ForbiddenPattern[] = DEFAULT_FORBIDDEN_PATTERNS,
): ForbiddenCheckResult {
	for (const fp of patterns) {
		const regex = patternToRegex(fp.pattern);
		if (regex.test(filePath)) {
			return {
				blocked: fp.severity === "block",
				warning: fp.severity === "warn",
				matchingPattern: fp,
				message: `File "${filePath}" matches forbidden pattern "${fp.pattern}": ${fp.reason}`,
			};
		}
	}

	return { blocked: false, warning: false };
}

/**
 * Filter a list of file paths, returning only those that pass the forbidden pattern check.
 *
 * @param filePaths - Array of relative file paths
 * @param patterns - Optional custom patterns
 * @returns Filtered array of allowed file paths, plus blocked/warned results
 */
export function filterForbiddenPaths(
	filePaths: string[],
	patterns: ForbiddenPattern[] = DEFAULT_FORBIDDEN_PATTERNS,
): {
	allowed: string[];
	blocked: { path: string; reason: string }[];
	warned: { path: string; reason: string }[];
} {
	const allowed: string[] = [];
	const blocked: { path: string; reason: string }[] = [];
	const warned: { path: string; reason: string }[] = [];

	for (const filePath of filePaths) {
		const result = checkForbiddenPatterns(filePath, patterns);
		if (result.blocked) {
			blocked.push({ path: filePath, reason: result.message ?? "Blocked by forbidden pattern" });
		} else if (result.warning) {
			warned.push({ path: filePath, reason: result.message ?? "Warning from forbidden pattern" });
			allowed.push(filePath);
		} else {
			allowed.push(filePath);
		}
	}

	return { allowed, blocked, warned };
}
