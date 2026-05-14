/**
 * Local Repo Index - P1 Workstream 5.5.D
 *
 * Indexes repository files for fast retrieval of relevant code snippets.
 * Uses simple keyword-based scoring, respects .gitignore and file policies,
 * caps output by token budget, and logs retrieval reasons.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import ignore from "ignore";
import { minimatch } from "minimatch";
import { estimateTokensFromString } from "../core/token-metering.js";
import { PiLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single indexed file entry
 */
export interface IndexedFile {
	/** Relative path from repo root (posix) */
	path: string;
	/** Full file content */
	content: string;
	/** Number of lines */
	lines: number;
	/** Estimated token count */
	tokens: number;
}

/**
 * A snippet returned from a retrieval query
 */
export interface RetrievalSnippet {
	/** File path relative to repo root */
	file: string;
	/** Snippet content */
	content: string;
	/** Line range (1-indexed) */
	lines: { start: number; end: number };
	/** Relevance score (higher = more relevant) */
	relevanceScore: number;
	/** Human-readable reason why this snippet was retrieved */
	reason: string;
}

/**
 * Configuration for a retrieval query
 */
export interface RetrievalQuery {
	/** Free-text search query */
	query: string;
	/** Maximum estimated tokens for all returned snippets combined */
	maxTokens: number;
	/** Glob patterns for files that are allowed (empty = all allowed) */
	allowedFiles?: string[];
	/** Glob patterns for files that are forbidden */
	forbiddenFiles?: string[];
	/** Maximum number of snippets to return */
	maxSnippets?: number;
}

/**
 * Result of a retrieval operation
 */
export interface RetrievalResult {
	/** Retrieved snippets sorted by relevance (most relevant first) */
	snippets: RetrievalSnippet[];
	/** Total estimated tokens for the result */
	totalTokens: number;
	/** Whether the result was truncated due to token budget */
	truncated: boolean;
	/** Log of retrieval decisions */
	log: RetrievalLogEntry[];
}

/**
 * A single log entry documenting a retrieval decision
 */
export interface RetrievalLogEntry {
	/** When the decision was made */
	timestamp: string;
	/** What action was taken */
	action: string;
	/** Details about the decision */
	detail: string;
	/** Optional file path involved */
	file?: string;
}

/**
 * Configuration for the repo indexer
 */
export interface LocalRepoIndexConfig {
	/** Root directory of the repository */
	rootDir: string;
	/** Maximum file size in bytes to index (default: 1MB) */
	maxFileSize?: number;
	/** File extensions to include (default: common source code extensions) */
	includeExtensions?: string[];
	/** Binary file extensions to skip */
	skipExtensions?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1MB

const DEFAULT_INCLUDE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
	".md",
	".yml",
	".yaml",
	".toml",
	".css",
	".scss",
	".less",
	".html",
	".vue",
	".svelte",
	".py",
	".rb",
	".go",
	".rs",
	".java",
	".kt",
	".swift",
	".c",
	".cpp",
	".h",
	".hpp",
	".sh",
	".bash",
	".zsh",
	".fish",
	".ps1",
	".sql",
	".graphql",
	".proto",
	".xml",
	".svg",
	".txt",
	".env.example",
	".gitignore",
	".dockerfile",
	".editorconfig",
]);

const DEFAULT_SKIP_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".svg",
	".woff",
	".woff2",
	".ttf",
	".eot",
	".pdf",
	".zip",
	".tar",
	".gz",
	".bz2",
	".7z",
	".rar",
	".mp3",
	".mp4",
	".avi",
	".mov",
	".wasm",
	".o",
	".obj",
	".dll",
	".so",
	".dylib",
	".exe",
]);

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

const FORBIDDEN_PATTERNS = [
	".env*",
	"**/*.pem",
	"**/*.key",
	"**/credentials/**",
	"**/secrets/**",
	"node_modules/**",
	".git/**",
	"dist/**",
	"build/**",
	".next/**",
	"__pycache__/**",
	"*.pyc",
	".pytest_cache/**",
	"target/**",
	"vendor/**",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const log = new PiLogger({ module: "local-repo-index" });

function toPosixPath(p: string): string {
	return p.split(sep).join("/");
}

function isTextFile(ext: string, includeExtensions: Set<string>, skipExtensions: Set<string>): boolean {
	if (skipExtensions.has(ext)) return false;
	if (includeExtensions.size > 0) return includeExtensions.has(ext);
	return true;
}

function isForbidden(relPath: string, forbiddenPatterns: string[]): boolean {
	for (const pattern of forbiddenPatterns) {
		if (minimatch(relPath, pattern, { dot: true, matchBase: false })) return true;
	}
	return false;
}

function isAllowed(relPath: string, allowedPatterns: string[]): boolean {
	if (allowedPatterns.length === 0) return true;
	for (const pattern of allowedPatterns) {
		if (minimatch(relPath, pattern, { dot: true, matchBase: false })) return true;
	}
	return false;
}

/**
 * Add ignore rules from .gitignore, .ignore, .fdignore files in a directory hierarchy
 */
function addIgnoreRules(ig: ReturnType<typeof ignore>, dir: string, rootDir: string): void {
	const relativeDir = relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";

	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = resolve(dir, filename);
		if (!existsSync(ignorePath)) continue;
		try {
			const content = readFileSync(ignorePath, "utf-8");
			const patterns = content
				.split(/\r?\n/)
				.map((line) => {
					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith("#")) return "";
					// Prepend directory prefix for subdirectory ignore files
					if (prefix) {
						// If the pattern starts with /, it's anchored to the root of the ignore file
						if (trimmed.startsWith("/")) {
							return `${prefix}${trimmed.slice(1)}`;
						}
						return `${prefix}${trimmed}`;
					}
					return trimmed;
				})
				.filter((line): line is string => Boolean(line));
			if (patterns.length > 0) {
				ig.add(patterns);
			}
		} catch {
			// Skip unreadable ignore files
		}
	}
}

/**
 * Collect files from a directory recursively, respecting ignore rules
 */
function collectFiles(
	dir: string,
	rootDir: string,
	ig: ReturnType<typeof ignore>,
	includeExtensions: Set<string>,
	skipExtensions: Set<string>,
	maxFileSize: number,
): string[] {
	const files: string[] = [];
	if (!existsSync(dir)) return files;

	addIgnoreRules(ig, dir, rootDir);

	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = resolve(dir, entry.name);

			// Skip symlinks
			if (entry.isSymbolicLink()) continue;

			if (entry.isDirectory()) {
				const relDir = toPosixPath(relative(rootDir, fullPath));
				const ignorePath = `${relDir}/`;
				if (ig.ignores(ignorePath)) continue;
				files.push(...collectFiles(fullPath, rootDir, ig, includeExtensions, skipExtensions, maxFileSize));
			} else if (entry.isFile()) {
				const relPath = toPosixPath(relative(rootDir, fullPath));
				if (ig.ignores(relPath)) continue;

				const ext = entry.name.includes(".") ? `.${entry.name.split(".").slice(1).join(".").toLowerCase()}` : "";
				if (!isTextFile(ext, includeExtensions, skipExtensions)) continue;

				// Check file size
				try {
					const stats = statSync(fullPath);
					if (stats.size > maxFileSize) continue;
				} catch {
					continue;
				}

				files.push(fullPath);
			}
		}
	} catch {
		// Skip directories we can't read
	}

	return files;
}

/**
 * Compute a simple keyword relevance score for a snippet against a query.
 *
 * Uses term frequency scoring with bonus for:
 * - Exact phrase matches in file paths
 * - Term matches in file names
 * - Term frequency in content
 * - Proximity of matching lines
 */
function scoreSnippet(content: string, filePath: string, query: string): number {
	const queryLower = query.toLowerCase();
	const queryTerms = queryLower.split(/\s+/).filter(Boolean);
	if (queryTerms.length === 0) return 0;

	let score = 0;

	// Bonus for matching file path
	const pathLower = filePath.toLowerCase();
	for (const term of queryTerms) {
		// Exact path segment match
		if (pathLower.includes(term)) {
			score += 10;
		}
		// File name match (basename without ext)
		const fileName = filePath.split("/").pop()?.toLowerCase() ?? "";
		if (fileName.includes(term)) {
			score += 5;
		}
	}

	// Score based on content matches
	const lines = content.split("\n");
	const matchedLineIndices: number[] = [];

	for (let i = 0; i < lines.length; i++) {
		const lineLower = lines[i].toLowerCase();
		let lineScore = 0;

		for (const term of queryTerms) {
			if (lineLower.includes(term)) {
				lineScore += 1;
				matchedLineIndices.push(i);
			}
		}

		// Bonus for imports/exports/definitions
		if (lineScore > 0) {
			const trimmed = lines[i].trimStart();
			if (
				trimmed.startsWith("import ") ||
				trimmed.startsWith("export ") ||
				trimmed.startsWith("function ") ||
				trimmed.startsWith("class ") ||
				trimmed.startsWith("interface ") ||
				trimmed.startsWith("type ") ||
				trimmed.startsWith("const ") ||
				trimmed.startsWith("let ") ||
				trimmed.startsWith("var ") ||
				trimmed.startsWith("def ") ||
				trimmed.startsWith("pub ") ||
				trimmed.startsWith("fn ")
			) {
				lineScore += 3;
			}
		}

		score += lineScore;
	}

	// Bonus for proximity of matching lines (dense matches = more relevant)
	if (matchedLineIndices.length > 1) {
		const sorted = [...matchedLineIndices].sort((a, b) => a - b);
		let proximityBonus = 0;
		for (let i = 1; i < sorted.length; i++) {
			const gap = sorted[i] - sorted[i - 1];
			if (gap <= 3) {
				proximityBonus += 2;
			} else if (gap <= 10) {
				proximityBonus += 1;
			}
		}
		score += proximityBonus;
	}

	// Normalize by content length (prefer concise matches)
	const normalizedScore = score > 0 ? score / Math.max(1, Math.log(content.length + 1)) : 0;

	return normalizedScore;
}

// ---------------------------------------------------------------------------
// LocalRepoIndex
// ---------------------------------------------------------------------------

/**
 * Indexes a local repository for keyword-based code retrieval.
 *
 * Walks the repository directory, respecting .gitignore and file policies,
 * indexes file contents, and provides search/retrieval capabilities with
 * relevance scoring, token budget capping, and decision logging.
 */
export class LocalRepoIndex {
	private config: Required<LocalRepoIndexConfig>;
	private files: IndexedFile[] | null = null;

	constructor(config: LocalRepoIndexConfig) {
		this.config = {
			rootDir: resolve(config.rootDir),
			maxFileSize: config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
			includeExtensions: config.includeExtensions ?? [...DEFAULT_INCLUDE_EXTENSIONS],
			skipExtensions: config.skipExtensions ?? [...DEFAULT_SKIP_EXTENSIONS],
		};
	}

	/**
	 * Index the repository. This walks the file system and caches indexed files.
	 *
	 * @returns Array of indexed files
	 */
	index(): IndexedFile[] {
		const { rootDir, maxFileSize, includeExtensions, skipExtensions } = this.config;
		const includeExtSet = new Set(includeExtensions);
		const skipExtSet = new Set(skipExtensions);
		const ig = ignore();
		const indexedFiles: IndexedFile[] = [];

		log.info(`Indexing repository at ${rootDir}`);

		const filePaths = collectFiles(rootDir, rootDir, ig, includeExtSet, skipExtSet, maxFileSize);

		let forbiddenSkipped = 0;
		for (const filePath of filePaths) {
			try {
				const content = readFileSync(filePath, "utf-8");
				const relPath = toPosixPath(relative(rootDir, filePath));

				// Skip files matching forbidden patterns during indexing
				if (isForbidden(relPath, FORBIDDEN_PATTERNS)) {
					forbiddenSkipped++;
					continue;
				}

				const lines = content.split("\n");
				indexedFiles.push({
					path: relPath,
					content,
					lines: lines.length,
					tokens: estimateTokensFromString(content),
				});
			} catch {
				// Skip unreadable files
			}
		}

		if (forbiddenSkipped > 0) {
			log.info(`Skipped ${forbiddenSkipped} files matching forbidden patterns during indexing`);
		}

		this.files = indexedFiles;
		log.info(`Indexed ${indexedFiles.length} files`);
		return indexedFiles;
	}

	/**
	 * Return the currently indexed files, or null if not yet indexed.
	 */
	getIndexedFiles(): IndexedFile[] | null {
		return this.files;
	}

	/**
	 * Return the total estimated tokens of all indexed files.
	 */
	getTotalTokens(): number {
		if (!this.files) return 0;
		return this.files.reduce((sum, f) => sum + f.tokens, 0);
	}

	/**
	 * Retrieve relevant snippets from the index based on a query.
	 *
	 * @param query - Retrieval query parameters
	 * @returns Retrieval result with snippets, capped by token budget
	 */
	retrieve(query: RetrievalQuery): RetrievalResult {
		const logEntries: RetrievalLogEntry[] = [];
		const now = () => new Date().toISOString();

		logEntries.push({
			timestamp: now(),
			action: "query",
			detail: `Query: "${query.query}" (maxTokens=${query.maxTokens}, maxSnippets=${query.maxSnippets ?? "unlimited"})`,
		});

		// Index if not already indexed
		const files = this.files ?? this.index();

		if (files.length === 0) {
			logEntries.push({
				timestamp: now(),
				action: "result",
				detail: "No files indexed, returning empty result",
			});
			return { snippets: [], totalTokens: 0, truncated: false, log: logEntries };
		}

		// Apply allowed/forbidden patterns
		const allowedFiles = query.allowedFiles ?? [];
		const forbiddenPatterns = [...FORBIDDEN_PATTERNS, ...(query.forbiddenFiles ?? [])];

		let candidateFiles = files;

		// Filter forbidden files
		const beforeForbiddenCount = candidateFiles.length;
		candidateFiles = candidateFiles.filter((f) => !isForbidden(f.path, forbiddenPatterns));
		const forbiddenSkipped = beforeForbiddenCount - candidateFiles.length;
		if (forbiddenSkipped > 0) {
			logEntries.push({
				timestamp: now(),
				action: "filter",
				detail: `Skipped ${forbiddenSkipped} files matching forbidden patterns`,
			});
		}

		// Filter allowed files
		if (allowedFiles.length > 0) {
			const beforeAllowedCount = candidateFiles.length;
			candidateFiles = candidateFiles.filter((f) => isAllowed(f.path, allowedFiles));
			const allowedSkipped = beforeAllowedCount - candidateFiles.length;
			if (allowedSkipped > 0) {
				logEntries.push({
					timestamp: now(),
					action: "filter",
					detail: `Skipped ${allowedSkipped} files not matching allowed patterns`,
				});
			}
		}

		log.info(`Query "${query.query}": evaluating ${candidateFiles.length} candidate files`);

		// Score and rank all candidates
		const scoredSnippets: RetrievalSnippet[] = [];

		for (const file of candidateFiles) {
			const score = scoreSnippet(file.content, file.path, query.query);

			if (score <= 0) continue;

			// Find the best matching lines to extract as a snippet
			const lines = file.content.split("\n");
			const queryTerms = query.query.toLowerCase().split(/\s+/).filter(Boolean);

			// Collect line indices with matches
			const matchIndices: number[] = [];
			for (let i = 0; i < lines.length; i++) {
				const lineLower = lines[i].toLowerCase();
				if (queryTerms.some((t) => lineLower.includes(t))) {
					matchIndices.push(i);
				}
			}

			// Group matching lines into snippets with context
			if (matchIndices.length > 0) {
				const sortedMatches = [...new Set(matchIndices)].sort((a, b) => a - b);

				// Create snippets from clusters of matching lines (max 30 lines each)
				let clusterStart = Math.max(0, sortedMatches[0] - 3);
				let clusterEnd = Math.min(lines.length, sortedMatches[0] + 3);

				for (let i = 1; i < sortedMatches.length; i++) {
					const gap = sortedMatches[i] - sortedMatches[i - 1];
					if (gap <= 10) {
						// Extend cluster
						clusterEnd = Math.min(lines.length, sortedMatches[i] + 3);
					} else {
						// Finalize current cluster and start new one
						const snippetLines = lines.slice(clusterStart, clusterEnd);
						const content = snippetLines.join("\n");
						const snippetScore = scoreSnippet(content, file.path, query.query);
						if (snippetScore > 0) {
							scoredSnippets.push({
								file: file.path,
								content,
								lines: { start: clusterStart + 1, end: clusterEnd },
								relevanceScore: snippetScore,
								reason: `Found ${sortedMatches.length} matching line(s) for query terms: "${query.query}"`,
							});
						}

						clusterStart = Math.max(0, sortedMatches[i] - 3);
						clusterEnd = Math.min(lines.length, sortedMatches[i] + 3);
					}
				}

				// Add final cluster
				const snippetLines = lines.slice(clusterStart, clusterEnd);
				const content = snippetLines.join("\n");
				const snippetScore = scoreSnippet(content, file.path, query.query);
				if (snippetScore > 0) {
					scoredSnippets.push({
						file: file.path,
						content,
						lines: { start: clusterStart + 1, end: clusterEnd },
						relevanceScore: snippetScore,
						reason: `Found ${sortedMatches.length} matching line(s) for query terms: "${query.query}"`,
					});
				}
			} else {
				// No specific line matches but path matched - include first few lines
				const snippetLines = lines.slice(0, Math.min(15, lines.length));
				scoredSnippets.push({
					file: file.path,
					content: snippetLines.join("\n"),
					lines: { start: 1, end: snippetLines.length },
					relevanceScore: score,
					reason: `Path matched query terms: "${query.query}"`,
				});
			}
		}

		// Sort by relevance (descending)
		scoredSnippets.sort((a, b) => b.relevanceScore - a.relevanceScore);

		logEntries.push({
			timestamp: now(),
			action: "score",
			detail: `Found ${scoredSnippets.length} matching snippets from ${candidateFiles.length} candidate files`,
		});

		// Apply maxSnippets limit
		const maxSnippets = query.maxSnippets ?? scoredSnippets.length;
		const selectedSnippets = scoredSnippets.slice(0, maxSnippets);

		// Cap by token budget (remove lowest-scoring items first)
		let totalTokens = 0;
		let truncated = false;
		const finalSnippets: RetrievalSnippet[] = [];

		for (const snippet of selectedSnippets) {
			const snippetTokens = estimateTokensFromString(snippet.content);
			if (totalTokens + snippetTokens > query.maxTokens) {
				logEntries.push({
					timestamp: now(),
					action: "truncate",
					detail: `Skipped snippet from ${snippet.file} (${snippetTokens} tokens) - exceeds remaining budget of ${query.maxTokens - totalTokens} tokens`,
					file: snippet.file,
				});
				truncated = true;
				continue;
			}
			finalSnippets.push(snippet);
			totalTokens += snippetTokens;
		}

		logEntries.push({
			timestamp: now(),
			action: "result",
			detail: `Returning ${finalSnippets.length} snippets (${totalTokens} tokens${truncated ? ", truncated" : ""})`,
		});

		// Log reason for each returned snippet
		for (const snippet of finalSnippets) {
			log.info(
				`Retrieved ${snippet.file}:${snippet.lines.start}-${snippet.lines.end} (score=${snippet.relevanceScore.toFixed(2)}): ${snippet.reason}`,
			);
		}

		return {
			snippets: finalSnippets,
			totalTokens,
			truncated,
			log: logEntries,
		};
	}
}

/**
 * Create a local repo index for the given directory.
 *
 * @param config - Index configuration
 * @returns LocalRepoIndex instance
 */
export function createLocalRepoIndex(config: LocalRepoIndexConfig): LocalRepoIndex {
	return new LocalRepoIndex(config);
}
