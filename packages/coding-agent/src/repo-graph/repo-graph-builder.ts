/**
 * Repo Graph Builder - P2 Workstream 6.I
 *
 * Analyzes repository files to build a RepoSymbolGraph by:
 * - Parsing import/export statements
 * - Detecting test associations by convention
 * - Resolving import paths to concrete files
 * - Skipping forbidden files
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import ignore from "ignore";
import { estimateTokensFromString } from "../core/token-metering.js";
import { PiLogger } from "../utils/logger.js";
import {
	classifyFile,
	DEFAULT_FORBIDDEN_PATTERNS,
	deriveTestPath,
	type ExportedSymbol,
	type FileClassification,
	type ImportReference,
	isForbiddenPath,
	RepoSymbolGraph,
	type RepoSymbolGraphConfig,
	type SymbolNode,
	toPosixPath,
} from "./repo-symbol-graph.js";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = new PiLogger({ module: "repo-graph-builder" });

// ---------------------------------------------------------------------------
// Default extensions to scan
// ---------------------------------------------------------------------------

const DEFAULT_SCAN_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
	".py",
	".go",
	".rs",
	".java",
	".kt",
	".swift",
]);

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

// ---------------------------------------------------------------------------
// RepoGraphBuilder
// ---------------------------------------------------------------------------

/**
 * Builds a RepoSymbolGraph by scanning repository files.
 *
 * Usage:
 * ```ts
 * const builder = new RepoGraphBuilder({ rootDir: "/path/to/repo" });
 * const graph = builder.build();
 * ```
 */
export class RepoGraphBuilder {
	private config: Required<RepoSymbolGraphConfig>;
	private ig: ReturnType<typeof ignore>;

	constructor(config: RepoSymbolGraphConfig) {
		this.config = {
			rootDir: resolve(config.rootDir),
			forbiddenPatterns: config.forbiddenPatterns ?? DEFAULT_FORBIDDEN_PATTERNS,
			skipTokenEstimation: config.skipTokenEstimation ?? false,
		};
		this.ig = ignore();
	}

	/**
	 * Build the repo symbol graph by scanning all files in the repository.
	 *
	 * @returns A fully populated RepoSymbolGraph
	 */
	build(): RepoSymbolGraph {
		log.info(`Building repo symbol graph for ${this.config.rootDir}`);

		// Reset ignore rules
		this.ig = ignore();

		// Collect all files
		const filePaths = this._collectFiles(this.config.rootDir, this.config.rootDir);

		// Parse each file into a symbol node
		const nodes: SymbolNode[] = [];
		for (const filePath of filePaths) {
			const node = this._parseFile(filePath);
			if (node) {
				nodes.push(node);
			}
		}

		// Resolve import paths to concrete files
		this._resolveImports(nodes);

		// Build test associations by convention
		this._buildTestAssociations(nodes);

		// Build and return the graph
		const graph = new RepoSymbolGraph(this.config);
		graph.setNodes(nodes);

		log.info(
			`Built repo symbol graph: ${nodes.length} nodes, ` +
				`${nodes.filter((n) => n.classification === "source").length} source, ` +
				`${nodes.filter((n) => n.classification === "test").length} test files`,
		);

		return graph;
	}

	/**
	 * Build graph from an explicit list of file paths (useful for partial rebuilds).
	 */
	buildFromFiles(filePaths: string[]): RepoSymbolGraph {
		const nodes: SymbolNode[] = [];

		for (const filePath of filePaths) {
			const absPath = resolve(this.config.rootDir, filePath);
			if (!existsSync(absPath)) continue;
			const node = this._parseFile(absPath);
			if (node) nodes.push(node);
		}

		this._resolveImports(nodes);
		this._buildTestAssociations(nodes);

		const graph = new RepoSymbolGraph(this.config);
		graph.setNodes(nodes);
		return graph;
	}

	// -----------------------------------------------------------------------
	// File collection
	// -----------------------------------------------------------------------

	private _collectFiles(dir: string, rootDir: string): string[] {
		const files: string[] = [];
		if (!existsSync(dir)) return files;

		this._addIgnoreRules(this.ig, dir, rootDir);

		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = resolve(dir, entry.name);

				if (entry.isSymbolicLink()) continue;

				if (entry.isDirectory()) {
					const relDir = toPosixPath(relative(rootDir, fullPath));
					if (this.ig.ignores(`${relDir}/`)) continue;
					files.push(...this._collectFiles(fullPath, rootDir));
				} else if (entry.isFile()) {
					const relPath = toPosixPath(relative(rootDir, fullPath));
					if (this.ig.ignores(relPath)) continue;

					// Skip forbidden files
					if (isForbiddenPath(relPath, this.config.forbiddenPatterns)) continue;

					// Only scan relevant extensions for the graph
					const ext = extname(entry.name).toLowerCase();
					if (!DEFAULT_SCAN_EXTENSIONS.has(ext)) continue;

					files.push(fullPath);
				}
			}
		} catch {
			// Skip directories we cannot read
		}

		return files;
	}

	private _addIgnoreRules(ig: ReturnType<typeof ignore>, dir: string, rootDir: string): void {
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
						if (prefix) {
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

	// -----------------------------------------------------------------------
	// File parsing
	// -----------------------------------------------------------------------

	private _parseFile(absPath: string): SymbolNode | null {
		try {
			const content = readFileSync(absPath, "utf-8");
			const relPath = toPosixPath(relative(this.config.rootDir, absPath));
			const classification = classifyFile(relPath);

			const exports = this._parseExports(content, classification);
			const imports = this._parseImports(content, relPath);
			const tokens = this.config.skipTokenEstimation ? 0 : estimateTokensFromString(content);

			return {
				path: relPath,
				classification,
				exports,
				imports,
				associatedTests: [],
				testTargets: [],
				tokenCount: tokens,
			};
		} catch {
			// Skip unreadable files
			return null;
		}
	}

	/**
	 * Parse export statements from file content.
	 *
	 * Handles:
	 * - export function/class/interface/type/const/let/var
	 * - export default function/class
	 * - export { name1, name2 }
	 * - export { name1 as alias }
	 */
	private _parseExports(content: string, _classification: FileClassification): ExportedSymbol[] {
		const exports: ExportedSymbol[] = [];
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			// Skip comments and empty lines
			if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

			// export function/class/interface/type/const/let/var
			const namedExportMatch = trimmed.match(
				/^export\s+(default\s+)?(function|class|interface|type|enum|const|let|var|abstract\s+class)\s+(\w+)/,
			);
			if (namedExportMatch) {
				const name = namedExportMatch[3];
				const isType = namedExportMatch[2] === "type" || namedExportMatch[2] === "interface";
				exports.push({
					name,
					kind: isType ? "type" : "value",
					line: i + 1,
				});
				continue;
			}

			// export { name1, name2 }
			const braceExportMatch = trimmed.match(/^export\s+\{\s*([^}]+)\s*\}/);
			if (braceExportMatch) {
				const names = braceExportMatch[1].split(",").map((s) => {
					const part = s
						.trim()
						.split(/\s+as\s+/)[0]
						.trim();
					return part;
				});
				for (const name of names) {
					exports.push({ name, kind: "value", line: i + 1 });
				}
				continue;
			}

			// export type { name }
			const typeExportMatch = trimmed.match(/^export\s+type\s+\{\s*([^}]+)\s*\}/);
			if (typeExportMatch) {
				const names = typeExportMatch[1].split(",").map((s) =>
					s
						.trim()
						.split(/\s+as\s+/)[0]
						.trim(),
				);
				for (const name of names) {
					exports.push({ name, kind: "type", line: i + 1 });
				}
			}

			// export * from "..." (wildcard re-export)
			// Not included as named export, but handled in import parsing
		}

		// Deduplicate exports by name
		const seen = new Set<string>();
		return exports.filter((exp) => {
			if (seen.has(exp.name)) return false;
			seen.add(exp.name);
			return true;
		});
	}

	/**
	 * Parse import statements from file content.
	 *
	 * Handles:
	 * - import { name } from "module"
	 * - import type { name } from "module"
	 * - import name from "module"
	 * - import * as name from "module"
	 * - import "module" (side-effect import)
	 * - dynamic import: import("module")
	 * - require("module")
	 */
	private _parseImports(content: string, sourcePath: string): ImportReference[] {
		const imports: ImportReference[] = [];
		const lines = content.split("\n");

		// Multi-line import handling: collect lines that belong to the same import
		let inMultiLineImport = false;
		let multiLineBuffer = "";
		const _multiLineStart = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			if (inMultiLineImport) {
				multiLineBuffer += ` ${trimmed}`;
				if (trimmed.includes(")") || trimmed.includes("}")) {
					// End of multi-line import
					inMultiLineImport = false;
					this._processImportLine(multiLineBuffer, sourcePath, imports);
					multiLineBuffer = "";
				}
				continue;
			}

			// Single-line import
			if (trimmed.startsWith("import ") || trimmed.startsWith("import type ") || trimmed.startsWith("import {")) {
				// Check if it spans multiple lines
				if (trimmed.includes("(") && !trimmed.includes(")")) {
					inMultiLineImport = true;
					multiLineBuffer = trimmed;
				} else if (trimmed.includes("{") && !trimmed.includes("}")) {
					inMultiLineImport = true;
					multiLineBuffer = trimmed;
				} else {
					this._processImportLine(trimmed, sourcePath, imports);
				}
				continue;
			}

			// Dynamic import: import("module") (single line)
			const dynamicMatch = trimmed.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
			if (dynamicMatch) {
				const moduleSpec = dynamicMatch[1];
				const resolvedTarget = this._resolveImportPath(moduleSpec, sourcePath);
				imports.push({
					source: moduleSpec,
					targetPath: resolvedTarget,
					importedNames: [],
					typeOnly: false,
					dynamic: true,
				});
				continue;
			}

			// require("module")
			const requireMatch = trimmed.match(/(?:const|let|var)\s+.*?=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
			if (requireMatch) {
				const moduleSpec = requireMatch[1];
				const resolvedTarget = this._resolveImportPath(moduleSpec, sourcePath);
				imports.push({
					source: moduleSpec,
					targetPath: resolvedTarget,
					importedNames: [],
					typeOnly: false,
					dynamic: false,
				});
			}
		}

		return imports;
	}

	private _processImportLine(trimmed: string, sourcePath: string, imports: ImportReference[]): void {
		// Determine if type-only import
		const isTypeOnly = trimmed.startsWith("import type ");

		// Extract "from" clause
		const fromMatch = trimmed.match(/from\s+['"]([^'"]+)['"]/);
		if (!fromMatch) return;

		const moduleSpec = fromMatch[1];

		// Skip external modules (npm packages, node built-ins)
		if (!moduleSpec.startsWith(".") && !moduleSpec.startsWith("/") && !moduleSpec.startsWith("..")) {
			// Could still be a workspace internal import, skip for now
			return;
		}

		const resolvedTarget = this._resolveImportPath(moduleSpec, sourcePath);

		// Extract imported names
		const importedNames: string[] = [];
		const namesMatch = trimmed.match(/import\s+(?:type\s+)?\{\s*([^}]+)\s*\}/);
		if (namesMatch) {
			const parts = namesMatch[1].split(",");
			for (const part of parts) {
				const name = part
					.trim()
					.split(/\s+as\s+/)[0]
					.trim();
				if (name) importedNames.push(name);
			}
		}

		// import defaultExport from "module"
		const defaultMatch = trimmed.match(/^import\s+(?:type\s+)?(\w+)(?:\s*,\s*\{[^}]+\})?\s+from\s+/);
		if (defaultMatch && !trimmed.includes("{")) {
			importedNames.push(defaultMatch[1]);
		}

		// import * as name from "module"
		const starMatch = trimmed.match(/import\s+(?:\w+\s*,\s*)?\*\s+as\s+(\w+)\s+from\s+/);
		if (starMatch) {
			importedNames.push(`* as ${starMatch[1]}`);
		}

		imports.push({
			source: moduleSpec,
			targetPath: resolvedTarget,
			importedNames,
			typeOnly: isTypeOnly,
			dynamic: false,
		});
	}

	/**
	 * Resolve an import path to a concrete file path relative to the repo root.
	 *
	 * Tries:
	 * 1. Exact path (with extension)
	 * 2. Path + .ts/.tsx/.js/.jsx etc.
	 * 3. Path/index.ts, etc.
	 */
	private _resolveImportPath(moduleSpec: string, sourcePath: string): string {
		const sourceDir = dirname(sourcePath);
		const rootDir = this.config.rootDir;

		// Absolute paths (/src/foo) -> relative to repo root
		let resolved: string;
		if (moduleSpec.startsWith("/")) {
			resolved = moduleSpec.slice(1); // Remove leading /
		} else {
			// Relative path
			const abs = resolve(rootDir, sourceDir, moduleSpec);
			resolved = relative(rootDir, abs);
		}

		resolved = toPosixPath(resolved);

		// Try to find the actual file
		const candidates = this._resolveFileCandidates(resolved);
		for (const candidate of candidates) {
			const fullPath = resolve(rootDir, candidate);
			if (existsSync(fullPath)) {
				return candidate;
			}
		}

		// Return the best guess even if file doesn't exist yet
		return resolved;
	}

	/**
	 * Generate candidate file paths for an unresolved import path.
	 */
	private _resolveFileCandidates(basePath: string): string[] {
		const candidates: string[] = [];
		const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"];

		// Check if already has an extension
		const ext = extname(basePath).toLowerCase();
		if (ext && extensions.includes(ext)) {
			candidates.push(basePath);
			return candidates;
		}

		// Try with each extension
		for (const ext of extensions) {
			candidates.push(`${basePath}${ext}`);
		}

		// Try as a directory with index file
		for (const ext of extensions) {
			candidates.push(`${basePath}/index${ext}`);
		}

		return candidates;
	}

	// -----------------------------------------------------------------------
	// Import resolution across nodes
	// -----------------------------------------------------------------------

	/**
	 * Resolve import target paths against actual node paths.
	 *
	 * After initial parsing, import targetPath might point to files that
	 * don't exist. This pass cross-references them with the actual nodes
	 * to find the best match (e.g. case-insensitive, extension variants).
	 */
	private _resolveImports(nodes: SymbolNode[]): void {
		const nodePaths = new Set(nodes.map((n) => n.path));

		for (const node of nodes) {
			for (const imp of node.imports) {
				if (nodePaths.has(imp.targetPath)) continue;

				// Try to find a matching node
				const match = this._findBestMatch(imp.targetPath, nodePaths);
				if (match) {
					imp.targetPath = match;
				}
			}
		}
	}

	private _findBestMatch(targetPath: string, availablePaths: Set<string>): string | null {
		// Try exact match
		if (availablePaths.has(targetPath)) return targetPath;

		// Try case-insensitive
		const targetLower = targetPath.toLowerCase();
		for (const p of availablePaths) {
			if (p.toLowerCase() === targetLower) return p;
		}

		return null;
	}

	// -----------------------------------------------------------------------
	// Test association building
	// -----------------------------------------------------------------------

	/**
	 * Build test associations between source files and test files by convention.
	 *
	 * For each source file, finds its test counterpart(s) using:
	 * 1. Sibling convention: foo.ts / foo.test.ts
	 * 2. Mirrored convention: src/foo.ts / test/foo.test.ts
	 * 3. Import-based: test files importing the source file
	 */
	private _buildTestAssociations(nodes: SymbolNode[]): void {
		// Build a map: base name -> node paths
		const testNodes = nodes.filter((n) => n.classification === "test");
		const sourceNodes = nodes.filter((n) => n.classification === "source");

		// Convention-based: for each source node, find test counterparts
		for (const source of sourceNodes) {
			const expectedTestPath = deriveTestPath(source.path);
			if (!expectedTestPath) continue;

			const testNode = nodes.find((n) => n.path === expectedTestPath);
			if (testNode && testNode.classification === "test") {
				source.associatedTests.push(testNode.path);
				testNode.testTargets.push(source.path);
			}
		}

		// Import-based: for each test node, find source files it imports from
		for (const test of testNodes) {
			for (const imp of test.imports) {
				const targetNode = nodes.find((n) => n.path === imp.targetPath);
				if (targetNode && targetNode.classification === "source") {
					if (!test.testTargets.includes(targetNode.path)) {
						test.testTargets.push(targetNode.path);
					}
					if (!targetNode.associatedTests.includes(test.path)) {
						targetNode.associatedTests.push(test.path);
					}
				}
			}
		}
	}
}

/**
 * Create a repo graph builder for the given root directory.
 */
export function createRepoGraphBuilder(config: RepoSymbolGraphConfig): RepoGraphBuilder {
	return new RepoGraphBuilder(config);
}
