/**
 * File classification helpers.
 *
 * Determines whether a file path represents source, test, config, generated,
 * or ignored content using simple heuristics.
 */

import { basename, sep } from "node:path";
import {
	CONFIG_FILE_PATTERNS,
	SECRET_FILE_PATTERNS,
	SMART_READ_ELIGIBLE_EXTENSIONS,
	SMART_READ_UNSUPPORTED_EXTENSIONS,
} from "./paths.js";

/**
 * Classification result for a single file.
 */
export interface FileClassification {
	isSource: boolean;
	isTest: boolean;
	isConfig: boolean;
	isGenerated: boolean;
	isIgnored: boolean;
	language?: string;
}

// ============================================================================
// Language mapping
// ============================================================================

const EXT_TO_LANGUAGE: Record<string, string> = {
	".ts": "typescript",
	".tsx": "typescriptreact",
	".js": "javascript",
	".jsx": "javascriptreact",
	".json": "json",
	".py": "python",
	".rs": "rust",
	".go": "go",
	".md": "markdown",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
};

// ============================================================================
// Heuristics
// ============================================================================

/**
 * Check if a filename matches a pattern with wildcard support.
 */
function filenameMatches(name: string, pattern: string): boolean {
	if (pattern.endsWith("*")) {
		const prefix = pattern.slice(0, -1);
		return name.startsWith(prefix);
	}
	return name === pattern;
}

/**
 * Default classification for non-special files.
 */

/**
 * Classify a file given its repo-relative path.
 */
export function classifyFile(relPath: string, ext: string): FileClassification {
	const lowerPath = relPath.toLowerCase();
	const fileName = basename(relPath);
	const dirPart = relPath.includes(sep) ? relPath.slice(0, relPath.lastIndexOf(sep)) : "";
	const language = EXT_TO_LANGUAGE[ext] ?? undefined;
	const dirEndsTest =
		dirPart === "test" || dirPart === "tests" || dirPart.endsWith("/test") || dirPart.endsWith("/tests");
	const isTest = fileName.includes(".test.") || fileName.includes(".spec.") || dirEndsTest;

	// Check ignored/secret patterns
	for (const secret of SECRET_FILE_PATTERNS) {
		if (secret.startsWith(".") && fileName.startsWith(secret)) {
			return { isSource: false, isTest: false, isConfig: false, isGenerated: false, isIgnored: true, language };
		}
		if (fileName === secret) {
			return { isSource: false, isTest: false, isConfig: false, isGenerated: false, isIgnored: true, language };
		}
	}

	// Check generated markers
	if (fileName.includes(".generated.") || lowerPath.includes("/generated/") || fileName === "models.generated.ts") {
		return { isSource: true, isTest: false, isConfig: false, isGenerated: true, isIgnored: false, language };
	}

	// Check config
	for (const pattern of CONFIG_FILE_PATTERNS) {
		if (filenameMatches(fileName, pattern) || fileName.startsWith(pattern)) {
			return { isSource: false, isTest: false, isConfig: true, isGenerated: false, isIgnored: false, language };
		}
	}

	// Default: source/test classification based on extension and path
	const isSource = SMART_READ_ELIGIBLE_EXTENSIONS.has(ext) || SMART_READ_UNSUPPORTED_EXTENSIONS.has(ext);
	return {
		isSource,
		isTest,
		isConfig: false,
		isGenerated: false,
		isIgnored: false,
		language,
	};
}

/**
 * Check if an extension is eligible for Smart Read warmup.
 */
export function isSmartReadEligible(ext: string): boolean {
	return SMART_READ_ELIGIBLE_EXTENSIONS.has(ext);
}
