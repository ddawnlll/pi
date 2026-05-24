/**
 * File Explorer Routes — P22.D File Explorer for Live Worktrees
 *
 * Provides REST API endpoints for browsing files inside active worktree
 * directories. Worktrees are stored under `.pi/worktrees/{planExecId}/{workspaceId}/`.
 *
 * Endpoints:
 *   GET /api/projects/:projectId/plans/:planExecId/worktrees
 *       — List active worktree directories for a plan execution
 *
 *   GET /api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/files
 *       — List files in a worktree (recursive with directory nesting)
 *
 *   GET /api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/files/:path(*)
 *       — Read a single file's content from a worktree
 *
 *   GET /api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/diff
 *       — Get git diff for a worktree
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { getWorkspaceRoot } from "./state-store-provider.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file content returned in a single read (1 MB) */
const MAX_FILE_BYTES = 1024 * 1024;

/** Maximum number of files to return in a listing */
const MAX_FILES_LISTING = 10000;

/** Directories to exclude when listing worktree files */
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".cache", "__pycache__", "target", "dist", ".next", "build"]);

/** Files to exclude by extension */
const EXCLUDED_EXTENSIONS = new Set([
	".o",
	".obj",
	".pyc",
	".class",
	".jar",
	".war",
	".so",
	".dylib",
	".dll",
	".exe",
	".bin",
	".wasm",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the worktree root directory for a given plan execution.
 *
 * Worktrees are stored under: {workspaceRoot}/.pi/worktrees/{planExecId}/{workspaceId}/
 */
function getPlanWorktreesDir(workspaceRoot: string, planExecId: string): string {
	return resolve(workspaceRoot, ".pi", "worktrees", planExecId);
}

/**
 * Resolve the absolute path to a specific worktree directory.
 */
function getWorktreeDir(workspaceRoot: string, planExecId: string, workspaceId: string): string {
	return resolve(workspaceRoot, ".pi", "worktrees", planExecId, workspaceId);
}

/**
 * Check if a worktree directory exists and is valid (has a .git file).
 */
function isValidWorktree(worktreeDir: string): boolean {
	try {
		const gitFile = join(worktreeDir, ".git");
		if (!existsSync(gitFile)) return false;
		const content = readFileSync(gitFile, "utf-8");
		return content.startsWith("gitdir:");
	} catch {
		return false;
	}
}

/**
 * Recursively list files in a directory, returning a flat array of
 * entries with path, name, extension, and size.
 */
interface FileEntry {
	path: string; // Relative path from worktree root
	name: string; // File/dir name
	isDir: boolean;
	ext: string; // File extension (empty for directories)
	size: number; // File size in bytes
}

function listFilesRecursive(dir: string, basePath: string, maxResults: number = MAX_FILES_LISTING): FileEntry[] {
	const results: FileEntry[] = [];

	function walk(currentDir: string) {
		if (results.length >= maxResults) return;

		let entries: string[];
		try {
			entries = readdirSync(currentDir);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (results.length >= maxResults) return;

			const fullPath = join(currentDir, entry);
			let isDir = false;
			let size = 0;

			try {
				const st = statSync(fullPath);
				isDir = st.isDirectory();
				size = st.isFile() ? st.size : 0;
			} catch {
				continue;
			}

			if (isDir) {
				// Skip excluded directories
				if (EXCLUDED_DIRS.has(entry)) continue;
				// Skip hidden directories (except .env*)
				if (entry.startsWith(".") && entry !== ".env" && entry !== ".env.example") continue;

				const relPath = relative(basePath, fullPath);
				results.push({
					path: relPath,
					name: entry,
					isDir: true,
					ext: "",
					size: 0,
				});

				walk(fullPath);
			} else {
				// Skip excluded extensions
				const ext = entry.includes(".") ? entry.split(".").pop()!.toLowerCase() : "";
				if (ext && EXCLUDED_EXTENSIONS.has(`.${ext}`)) continue;
				// Skip hidden files
				if (entry.startsWith(".") && entry !== ".env" && entry !== ".env.example") continue;
				// Skip binary-like files (check if extension is unknown binary type)
				if (entry.length > 256) continue; // Sanity check on filename length

				const relPath = relative(basePath, fullPath);
				results.push({
					path: relPath,
					name: entry,
					isDir: false,
					ext,
					size,
				});
			}
		}
	}

	walk(dir);

	// Sort: directories first, then files, alphabetical
	results.sort((a, b) => {
		if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
		return a.path.localeCompare(b.path);
	});

	return results;
}

/**
 * Build a tree structure from a flat list of file entries.
 * Returns nested entries where directories contain children arrays.
 */
interface TreeEntry extends FileEntry {
	children?: TreeEntry[];
}

function buildFileTree(entries: FileEntry[]): TreeEntry[] {
	const root: TreeEntry[] = [];
	const dirMap = new Map<string, TreeEntry>();

	// First pass: create all directory entries
	for (const entry of entries) {
		if (!entry.isDir) continue;
		const parts = entry.path.split("/");
		for (let i = 0; i < parts.length; i++) {
			const prefix = parts.slice(0, i + 1).join("/");
			if (!dirMap.has(prefix)) {
				dirMap.set(prefix, {
					path: prefix,
					name: parts[i],
					isDir: true,
					ext: "",
					size: 0,
					children: [],
				});
			}
		}
	}

	// Second pass: add children to their parents
	for (const [, dir] of dirMap) {
		const parentPath = dir.path.includes("/") ? dir.path.slice(0, dir.path.lastIndexOf("/")) : "";
		if (parentPath === "") {
			root.push(dir);
		} else {
			const parent = dirMap.get(parentPath);
			if (parent?.children) {
				parent.children.push(dir);
			} else {
				root.push(dir);
			}
		}
	}

	// Third pass: add file entries to their parent directories
	for (const entry of entries) {
		if (entry.isDir) continue;
		const parentPath = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
		if (parentPath === "") {
			root.push(entry);
		} else {
			const parent = dirMap.get(parentPath);
			if (parent?.children) {
				parent.children.push(entry);
			} else {
				root.push(entry);
			}
		}
	}

	// Sort children within each directory
	const sortChildren = (items: TreeEntry[]) => {
		items.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
		for (const item of items) {
			if (item.children) {
				sortChildren(item.children);
			}
		}
	};

	sortChildren(root);

	return root;
}

/**
 * Detect the programming language or file type from an extension.
 */
function detectLanguage(ext: string): string {
	const langMap: Record<string, string> = {
		ts: "typescript",
		tsx: "typescriptreact",
		js: "javascript",
		jsx: "javascriptreact",
		json: "json",
		md: "markdown",
		css: "css",
		html: "html",
		py: "python",
		rb: "ruby",
		go: "go",
		rs: "rust",
		java: "java",
		kt: "kotlin",
		swift: "swift",
		c: "c",
		cpp: "cpp",
		h: "c",
		hpp: "cpp",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		yaml: "yaml",
		yml: "yaml",
		toml: "toml",
		xml: "xml",
		sql: "sql",
		graphql: "graphql",
		gql: "graphql",
		dockerfile: "dockerfile",
		mjs: "javascript",
		cjs: "javascript",
		mts: "typescript",
		cts: "typescript",
		svelte: "svelte",
		vue: "vue",
	};
	return langMap[ext] || "plaintext";
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

/**
 * Register file explorer routes on the given Fastify instance.
 */
export async function registerFileExplorerRoutes(fastify: FastifyInstance): Promise<void> {
	/**
	 * GET /api/projects/:projectId/plans/:planExecId/worktrees
	 *
	 * Lists all active worktree directories for a plan execution.
	 * Scans the .pi/worktrees/{planExecId}/ directory for workspace subdirectories
	 * and returns their metadata.
	 */
	fastify.get<{
		Params: { projectId: string; planExecId: string };
	}>("/api/projects/:projectId/plans/:planExecId/worktrees", async (request, reply) => {
		const { planExecId } = request.params;

		try {
			const workspaceRoot = getWorkspaceRoot();
			const planWorktreesDir = getPlanWorktreesDir(workspaceRoot, planExecId);

			if (!existsSync(planWorktreesDir)) {
				return { worktrees: [] };
			}

			const worktreeDirs = readdirSync(planWorktreesDir, { withFileTypes: true });
			const worktrees: Array<{
				workspaceId: string;
				path: string;
				valid: boolean;
				fileCount: number;
				lastModified: string | null;
			}> = [];

			for (const dirent of worktreeDirs) {
				if (!dirent.isDirectory()) continue;

				const workspaceId = dirent.name;
				const absPath = resolve(planWorktreesDir, workspaceId);
				const valid = isValidWorktree(absPath);

				// Count files
				let fileCount = 0;
				let lastModified: string | null = null;
				if (valid && existsSync(absPath)) {
					try {
						const files = listFilesRecursive(absPath, absPath);
						fileCount = files.filter((f) => !f.isDir).length;
						const stats = statSync(absPath);
						lastModified = stats.mtime.toISOString();
					} catch {
						// Ignore
					}
				}

				worktrees.push({
					workspaceId,
					path: absPath,
					valid,
					fileCount,
					lastModified,
				});
			}

			// Sort by workspace ID
			worktrees.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));

			return { worktrees };
		} catch (error) {
			fastify.log.error({ error }, "Failed to list worktrees");
			return reply.code(500).send({ error: "Failed to list worktrees", message: String(error) });
		}
	});

	/**
	 * GET /api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/files
	 *
	 * Lists files in a worktree. Returns a tree structure with nested directories.
	 * Supports ?flat=true to return a flat list instead.
	 */
	fastify.get<{
		Params: { projectId: string; planExecId: string; workspaceId: string };
		Querystring: { flat?: string; tree?: string };
	}>("/api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/files", async (request, reply) => {
		const { planExecId, workspaceId } = request.params;
		const flat = request.query.flat === "true";
		const tree = request.query.tree !== "false"; // Default: tree=true

		try {
			const workspaceRoot = getWorkspaceRoot();
			const worktreeDir = getWorktreeDir(workspaceRoot, planExecId, workspaceId);

			if (!existsSync(worktreeDir)) {
				return reply.code(404).send({ error: "Worktree directory not found" });
			}

			if (!isValidWorktree(worktreeDir)) {
				return reply.code(400).send({ error: "Worktree is not a valid git worktree" });
			}

			const entries = listFilesRecursive(worktreeDir, worktreeDir);

			if (flat) {
				return { files: entries, worktreePath: worktreeDir };
			}

			const treeData = tree ? buildFileTree(entries) : entries;

			return {
				files: treeData,
				worktreePath: worktreeDir,
				totalCount: entries.length,
				displayCount: treeData.length,
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to list worktree files");
			return reply.code(500).send({ error: "Failed to list worktree files", message: String(error) });
		}
	});

	/**
	 * GET /api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/files/:path(*)
	 *
	 * Reads and returns a single file's content from a worktree.
	 * The path is a wildcard (e.g., src/index.ts) that is resolved relative
	 * to the worktree root.
	 *
	 * Query params:
	 *   maxBytes — maximum bytes to read (default: 1 MB, max: 5 MB)
	 */
	fastify.get<{
		Params: { projectId: string; planExecId: string; workspaceId: string; path: string };
		Querystring: { maxBytes?: string };
	}>("/api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/files/:path(*)", async (request, reply) => {
		const { planExecId, workspaceId, path: filePath } = request.params;
		const maxBytes = Math.min(5 * 1024 * 1024, Number.parseInt(request.query.maxBytes ?? "", 10) || MAX_FILE_BYTES);

		if (!filePath || filePath.trim() === "") {
			return reply.code(400).send({ error: "File path is required" });
		}

		try {
			const workspaceRoot = getWorkspaceRoot();
			const worktreeDir = getWorktreeDir(workspaceRoot, planExecId, workspaceId);

			if (!existsSync(worktreeDir)) {
				return reply.code(404).send({ error: "Worktree directory not found" });
			}

			// Prevent path traversal — resolve against the worktree root and ensure
			// the resolved path is still within the worktree directory.
			const resolvedPath = resolve(worktreeDir, filePath);
			if (!resolvedPath.startsWith(`${worktreeDir}/`) && resolvedPath !== worktreeDir) {
				return reply.code(403).send({ error: "Path traversal detected" });
			}

			if (!existsSync(resolvedPath)) {
				return reply.code(404).send({ error: "File not found" });
			}

			const stats = statSync(resolvedPath);
			if (stats.isDirectory()) {
				return reply.code(400).send({ error: "Path is a directory, not a file" });
			}

			// Check file size
			if (stats.size > maxBytes) {
				return reply.code(413).send({
					error: "File too large",
					size: stats.size,
					maxBytes,
					message: `File is ${stats.size} bytes, max is ${maxBytes} bytes. Use maxBytes query param to increase the limit.`,
				});
			}

			// Detect if file is likely binary
			const ext = filePath.includes(".") ? filePath.split(".").pop()!.toLowerCase() : "";
			const binaryExts = new Set([
				"png",
				"jpg",
				"jpeg",
				"gif",
				"ico",
				"svg",
				"woff",
				"woff2",
				"ttf",
				"eot",
				"zip",
				"gz",
				"tar",
				"bz2",
				"pdf",
				"doc",
				"docx",
				"xls",
				"xlsx",
				"mp3",
				"mp4",
				"avi",
				"mov",
				"ico",
				"icns",
			]);
			const isBinary = binaryExts.has(ext);

			let content: string;
			let base64Content: string | null = null;

			if (isBinary) {
				// Read binary file as base64
				const buf = readFileSync(resolvedPath);
				base64Content = buf.toString("base64");
				content = "";
			} else {
				// Read as UTF-8 text with truncation
				const buf = readFileSync(resolvedPath, "utf-8");
				content = buf.length > maxBytes ? buf.slice(0, maxBytes) : buf;
			}

			return {
				path: relative(worktreeDir, resolvedPath),
				name: basename(filePath),
				ext,
				language: detectLanguage(ext),
				size: stats.size,
				modifiedAt: stats.mtime.toISOString(),
				content,
				base64Content,
				isBinary,
				truncated: stats.size > maxBytes,
				maxBytes,
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to read worktree file");
			return reply.code(500).send({ error: "Failed to read worktree file", message: String(error) });
		}
	});

	/**
	 * GET /api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/diff
	 *
	 * Returns the git diff for a worktree, showing all uncommitted changes
	 * relative to the worktree's base commit (HEAD).
	 */
	fastify.get<{
		Params: { projectId: string; planExecId: string; workspaceId: string };
		Querystring: { format?: string; maxLines?: string };
	}>("/api/projects/:projectId/plans/:planExecId/worktrees/:workspaceId/diff", async (request, reply) => {
		const { planExecId, workspaceId } = request.params;
		const { format } = request.query;
		const maxLines = Number.parseInt(request.query.maxLines ?? "", 10) || 500;

		try {
			const workspaceRoot = getWorkspaceRoot();
			const worktreeDir = getWorktreeDir(workspaceRoot, planExecId, workspaceId);

			if (!existsSync(worktreeDir)) {
				return reply.code(404).send({ error: "Worktree directory not found" });
			}

			if (!isValidWorktree(worktreeDir)) {
				return reply.code(400).send({ error: "Worktree is not a valid git worktree" });
			}

			const { execSync } = await import("node:child_process");

			// Check if git is available
			try {
				execSync("git --version", { encoding: "utf-8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
			} catch {
				return { filesChanged: [], diff: "", error: "Git not available" };
			}

			// Get diff --name-status for file listing
			let nameStatus = "";
			try {
				nameStatus = execSync("git diff --name-status HEAD", {
					cwd: worktreeDir,
					encoding: "utf-8",
					timeout: 5000,
					stdio: ["ignore", "pipe", "ignore"],
				}).trim();
			} catch {
				// No diff yet
			}

			let stagedNameStatus = "";
			try {
				stagedNameStatus = execSync("git diff --cached --name-status HEAD", {
					cwd: worktreeDir,
					encoding: "utf-8",
					timeout: 5000,
					stdio: ["ignore", "pipe", "ignore"],
				}).trim();
			} catch {
				// No staged changes
			}

			// Parse file changes
			const filesChanged: Array<{
				path: string;
				status: string;
				additions: number;
				deletions: number;
			}> = [];

			const allNameStatus = [...nameStatus.split("\n"), ...stagedNameStatus.split("\n")].filter(Boolean);

			const statusMap = new Map<string, string>();
			for (const line of allNameStatus) {
				const match = line.match(/^(\S+)\t(.+)$/);
				if (match) {
					statusMap.set(match[2], match[1]);
				}
			}

			// Get numstat for per-file additions/deletions
			let numstat = "";
			try {
				numstat = execSync("git diff --numstat HEAD", {
					cwd: worktreeDir,
					encoding: "utf-8",
					timeout: 5000,
					stdio: ["ignore", "pipe", "ignore"],
				}).trim();
			} catch {
				// No changes
			}

			let stagedNumstat = "";
			try {
				stagedNumstat = execSync("git diff --cached --numstat HEAD", {
					cwd: worktreeDir,
					encoding: "utf-8",
					timeout: 5000,
					stdio: ["ignore", "pipe", "ignore"],
				}).trim();
			} catch {
				// No staged changes
			}

			const fileStats = new Map<string, { additions: number; deletions: number }>();
			for (const ns of [numstat, stagedNumstat]) {
				for (const line of ns.split("\n")) {
					if (!line.trim()) continue;
					const parts = line.split("\t");
					if (parts.length < 3) continue;
					const [addStr, delStr, ...pathParts] = parts;
					const filePath = pathParts.join("\t");
					const additions = Number(addStr) || 0;
					const deletions = Number(delStr) || 0;
					const existing = fileStats.get(filePath);
					if (existing) {
						existing.additions += additions;
						existing.deletions += deletions;
					} else {
						fileStats.set(filePath, { additions, deletions });
					}
				}
			}

			for (const [filePath, stats] of fileStats) {
				filesChanged.push({
					path: filePath,
					status: statusMap.get(filePath) || "M",
					additions: stats.additions,
					deletions: stats.deletions,
				});
			}

			filesChanged.sort((a, b) => a.path.localeCompare(b.path));

			// Get full diff (unified format)
			let diffOutput = "";
			if (format === "patch" || format === "unified") {
				try {
					diffOutput = execSync("git diff HEAD", {
						cwd: worktreeDir,
						encoding: "utf-8",
						timeout: 10000,
						stdio: ["ignore", "pipe", "ignore"],
					}).trim();

					// Also include staged changes
					const stagedDiff = execSync("git diff --cached HEAD", {
						cwd: worktreeDir,
						encoding: "utf-8",
						timeout: 10000,
						stdio: ["ignore", "pipe", "ignore"],
					}).trim();

					if (stagedDiff) {
						diffOutput = diffOutput ? `${diffOutput}\n${stagedDiff}` : stagedDiff;
					}
				} catch {
					// No diff output
				}

				// Truncate if too many lines
				if (diffOutput) {
					const lines = diffOutput.split("\n");
					if (lines.length > maxLines) {
						diffOutput = lines.slice(0, maxLines).join("\n");
					}
				}
			}

			return {
				filesChanged,
				diff: diffOutput || undefined,
				worktreePath: worktreeDir,
				fileCount: filesChanged.length,
				totalAdditions: filesChanged.reduce((sum, f) => sum + f.additions, 0),
				totalDeletions: filesChanged.reduce((sum, f) => sum + f.deletions, 0),
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to get worktree diff");
			return reply.code(500).send({ error: "Failed to get worktree diff", message: String(error) });
		}
	});
}
