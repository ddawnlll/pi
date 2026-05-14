/**
 * Repo Symbol Graph - P2 Workstream 6.I
 *
 * Maps files to related tests by convention, tracks import/export relationships,
 * and helps detect likely cross-workspace conflicts. Used by the scheduler,
 * test impact analysis, and retrieval systems.
 */

import { sep } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Classification of a file in the repository
 */
export type FileClassification =
	| "source" // Implementation source code (.ts, .js, etc.)
	| "test" // Test file (.test.ts, .spec.ts)
	| "config" // Configuration file (json, yaml, etc.)
	| "documentation" // Documentation (.md, .txt)
	| "other"; // Everything else

/**
 * A symbol exported from a module
 */
export interface ExportedSymbol {
	/** Name of the export (e.g. class name, function name, interface name) */
	name: string;
	/** Kind of export: type, value, or both */
	kind: "type" | "value" | "both";
	/** Source location: file line number (1-indexed), 0 if unknown */
	line: number;
}

/**
 * An import reference from one module to another
 */
export interface ImportReference {
	/** Module specifier from the import statement (e.g. "../core/foo.js") */
	source: string;
	/** The resolved target file path (relative to repo root, posix) */
	targetPath: string;
	/** Names imported from the target module */
	importedNames: string[];
	/** Whether this is a type-only import */
	typeOnly: boolean;
	/** Whether this is a dynamic import (import()) */
	dynamic: boolean;
}

/**
 * A node in the symbol graph representing a single file
 */
export interface SymbolNode {
	/** File path relative to repo root (posix) */
	path: string;
	/** File classification */
	classification: FileClassification;
	/** Symbols exported from this file */
	exports: ExportedSymbol[];
	/** Import references to other files */
	imports: ImportReference[];
	/** Test file paths associated with this file (by convention or detected) */
	associatedTests: string[];
	/** Source file paths that this test file tests (inverse of associatedTests) */
	testTargets: string[];
	/** Estimated token count */
	tokenCount: number;
}

/**
 * Edge types in the symbol graph
 */
export type SymbolEdgeType =
	| "imports" // File A imports from File B
	| "test_of" // File A is a test of File B
	| "dependency"; // File A depends on File B (indirect)

/**
 * An edge in the symbol graph
 */
export interface SymbolEdge {
	/** Source node path */
	source: string;
	/** Target node path */
	target: string;
	/** Edge type */
	type: SymbolEdgeType;
	/** Metadata about the relationship */
	metadata?: Record<string, unknown>;
}

/**
 * Configuration for the repo symbol graph builder
 */
export interface RepoSymbolGraphConfig {
	/** Root directory of the repository */
	rootDir: string;
	/** Glob patterns for files that are forbidden (never included in graph) */
	forbiddenPatterns?: string[];
	/** Whether to skip token estimation (faster, default: false) */
	skipTokenEstimation?: boolean;
}

/**
 * Conflict report for a set of workspaces
 */
export interface CrossWorkspaceConflict {
	/** Source file path involved in the conflict */
	filePath: string;
	/** Category of conflict */
	category: "shared_import" | "shared_export" | "test_target_split" | "indirect_dependency";
	/** Description of the conflict */
	description: string;
	/** Workspace IDs involved */
	workspaceIds: string[];
	/** Other file paths involved */
	relatedPaths: string[];
}

/**
 * Impact analysis result for a set of changed files
 */
export interface TestImpactResult {
	/** Directly affected test files */
	directlyAffectedTests: string[];
	/** Transitively affected test files (tests of files that import changed files) */
	transitivelyAffectedTests: string[];
	/** All changed source files */
	changedFiles: string[];
	/** Total number of tests that should be run */
	totalTestCount: number;
}

/**
 * Query result for finding nodes by symbol name
 */
export interface SymbolQueryResult {
	/** Symbol name matched */
	symbol: string;
	/** Nodes that export this symbol */
	exporters: SymbolNode[];
	/** Nodes that import this symbol */
	importers: SymbolNode[];
}

// ---------------------------------------------------------------------------
// Default forbidden patterns
// ---------------------------------------------------------------------------

export const DEFAULT_FORBIDDEN_PATTERNS = [
	".env*",
	"**/*.pem",
	"**/*.key",
	"credentials/**",
	"**/credentials/**",
	"secrets/**",
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
// RepoSymbolGraph
// ---------------------------------------------------------------------------

/**
 * Repository symbol graph that maps files to related tests and tracks
 * symbol-level dependencies between files.
 *
 * Used by:
 * - Scheduler: to detect cross-workspace conflicts
 * - Test impact analysis: to determine which tests to run given changed files
 * - Retrieval: to find related files when querying symbols
 */
export class RepoSymbolGraph {
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: set in constructor for future use
	private config: RepoSymbolGraphConfig;

	/**
	 * All nodes in the graph, keyed by file path (posix, relative to repo root).
	 */
	private nodes: Map<string, SymbolNode> = new Map();

	/**
	 * All edges in the graph.
	 */
	private edges: SymbolEdge[] = [];

	constructor(config: RepoSymbolGraphConfig) {
		this.config = {
			rootDir: config.rootDir,
			forbiddenPatterns: config.forbiddenPatterns ?? DEFAULT_FORBIDDEN_PATTERNS,
			skipTokenEstimation: config.skipTokenEstimation ?? false,
		};
	}

	// -----------------------------------------------------------------------
	// Graph building
	// -----------------------------------------------------------------------

	/**
	 * Set the nodes of the graph (replaces any existing nodes).
	 * Also rebuilds edges from node relationships.
	 */
	setNodes(nodes: SymbolNode[]): void {
		this.nodes.clear();
		for (const node of nodes) {
			this.nodes.set(node.path, node);
		}
		this._rebuildEdges();
	}

	/**
	 * Add or replace a single node in the graph.
	 */
	setNode(node: SymbolNode): void {
		this.nodes.set(node.path, node);
		this._rebuildEdges();
	}

	/**
	 * Get a node by file path.
	 */
	getNode(path: string): SymbolNode | undefined {
		return this.nodes.get(path);
	}

	/**
	 * Get all nodes in the graph.
	 */
	getAllNodes(): SymbolNode[] {
		return Array.from(this.nodes.values());
	}

	/**
	 * Get all edges in the graph.
	 */
	getAllEdges(): SymbolEdge[] {
		return this.edges;
	}

	/**
	 * Get the number of nodes in the graph.
	 */
	get nodeCount(): number {
		return this.nodes.size;
	}

	/**
	 * Get the number of edges in the graph.
	 */
	get edgeCount(): number {
		return this.edges.length;
	}

	// -----------------------------------------------------------------------
	// Queries
	// -----------------------------------------------------------------------

	/**
	 * Find all test files associated with a given source file.
	 *
	 * Uses both explicit test associations (by convention) and inverse
	 * lookup of import edges (test files that import the source file).
	 */
	getTestsForFile(filePath: string): SymbolNode[] {
		const node = this.nodes.get(filePath);
		if (!node) return [];

		const results: SymbolNode[] = [];

		// Direct test associations
		for (const testPath of node.associatedTests) {
			const testNode = this.nodes.get(testPath);
			if (testNode) results.push(testNode);
		}

		// Inverse: find test files that import this source file
		for (const [path, other] of this.nodes) {
			if (other.classification === "test") {
				const importsTarget = other.imports.some((imp) => imp.targetPath === filePath);
				if (importsTarget && !results.find((r) => r.path === path)) {
					results.push(other);
				}
			}
		}

		return results;
	}

	/**
	 * Find all source files that a test file tests.
	 */
	getTargetsForTest(testPath: string): SymbolNode[] {
		const node = this.nodes.get(testPath);
		if (!node) return [];

		const results: SymbolNode[] = [];

		// Direct test targets
		for (const targetPath of node.testTargets) {
			const targetNode = this.nodes.get(targetPath);
			if (targetNode) results.push(targetNode);
		}

		return results;
	}

	/**
	 * Find files that export a given symbol name.
	 */
	findExporters(symbolName: string): SymbolNode[] {
		const results: SymbolNode[] = [];
		for (const node of this.nodes.values()) {
			if (node.exports.some((exp) => exp.name === symbolName)) {
				results.push(node);
			}
		}
		return results;
	}

	/**
	 * Find files that import a given symbol name.
	 */
	findImporters(symbolName: string): SymbolNode[] {
		const results: SymbolNode[] = [];
		for (const node of this.nodes.values()) {
			if (node.imports.some((imp) => imp.importedNames.includes(symbolName))) {
				results.push(node);
			}
		}
		return results;
	}

	/**
	 * Query for a symbol (find all exporters and importers).
	 */
	querySymbol(symbolName: string): SymbolQueryResult {
		return {
			symbol: symbolName,
			exporters: this.findExporters(symbolName),
			importers: this.findImporters(symbolName),
		};
	}

	/**
	 * Find all files that import from a given file (direct dependents).
	 */
	getDependents(filePath: string): SymbolNode[] {
		const results: SymbolNode[] = [];
		for (const node of this.nodes.values()) {
			if (node.imports.some((imp) => imp.targetPath === filePath)) {
				results.push(node);
			}
		}
		return results;
	}

	/**
	 * Find all files that a given file imports from (direct dependencies).
	 */
	getDependencies(filePath: string): SymbolNode[] {
		const node = this.nodes.get(filePath);
		if (!node) return [];

		const results: SymbolNode[] = [];
		for (const imp of node.imports) {
			const targetNode = this.nodes.get(imp.targetPath);
			if (targetNode) results.push(targetNode);
		}
		return results;
	}

	/**
	 * Detect potential cross-workspace conflicts given workspace-to-file mapping.
	 *
	 * @param workspaceFiles - Map of workspace ID to array of file paths in that workspace
	 * @returns Array of conflict reports
	 */
	detectCrossWorkspaceConflicts(workspaceFiles: Map<string, string[]>): CrossWorkspaceConflict[] {
		const conflicts: CrossWorkspaceConflict[] = [];

		// Build reverse map: file path -> set of workspace IDs
		const fileToWorkspaces = new Map<string, Set<string>>();
		for (const [wsId, files] of workspaceFiles) {
			for (const filePath of files) {
				const normalized = toPosixPath(filePath);
				if (!fileToWorkspaces.has(normalized)) {
					fileToWorkspaces.set(normalized, new Set());
				}
				fileToWorkspaces.get(normalized)!.add(wsId);
			}
		}

		// Check for shared imports: two workspaces both import the same file
		const importCounts = new Map<string, Set<string>>(); // target path -> workspace IDs
		for (const [wsId, files] of workspaceFiles) {
			for (const filePath of files) {
				const normalized = toPosixPath(filePath);
				const node = this.nodes.get(normalized);
				if (!node) continue;
				for (const imp of node.imports) {
					if (!importCounts.has(imp.targetPath)) {
						importCounts.set(imp.targetPath, new Set());
					}
					importCounts.get(imp.targetPath)!.add(wsId);
				}
			}
		}
		for (const [targetPath, wsSet] of importCounts) {
			if (wsSet.size > 1) {
				conflicts.push({
					filePath: targetPath,
					category: "shared_import",
					description: `File "${targetPath}" is imported by workspaces: ${Array.from(wsSet).join(", ")}`,
					workspaceIds: Array.from(wsSet),
					relatedPaths: [targetPath],
				});
			}
		}

		// Check for shared exports: two workspaces both export the same symbol
		const exportSymbolCounts = new Map<string, Set<string>>(); // symbol name -> workspace IDs
		for (const [wsId, files] of workspaceFiles) {
			for (const filePath of files) {
				const normalized = toPosixPath(filePath);
				const node = this.nodes.get(normalized);
				if (!node) continue;
				for (const exp of node.exports) {
					if (!exportSymbolCounts.has(exp.name)) {
						exportSymbolCounts.set(exp.name, new Set());
					}
					exportSymbolCounts.get(exp.name)!.add(wsId);
				}
			}
		}
		for (const [symbol, wsSet] of exportSymbolCounts) {
			if (wsSet.size > 1) {
				conflicts.push({
					filePath: "",
					category: "shared_export",
					description: `Symbol "${symbol}" is exported by workspaces: ${Array.from(wsSet).join(", ")}`,
					workspaceIds: Array.from(wsSet),
					relatedPaths: [],
				});
			}
		}

		// Check for test target split: a test file is in a different workspace from its implementation
		for (const [wsId, files] of workspaceFiles) {
			for (const filePath of files) {
				const normalized = toPosixPath(filePath);
				const node = this.nodes.get(normalized);
				if (!node || node.classification !== "test") continue;

				for (const targetPath of node.testTargets) {
					const targetWsSet = fileToWorkspaces.get(targetPath);
					if (targetWsSet) {
						// If the test target is in a different workspace, flag it
						if (!targetWsSet.has(wsId)) {
							conflicts.push({
								filePath: normalized,
								category: "test_target_split",
								description: `Test file "${normalized}" tests "${targetPath}" which is in different workspace(s): ${Array.from(targetWsSet).join(", ")}`,
								workspaceIds: [wsId, ...targetWsSet],
								relatedPaths: [targetPath],
							});
						}
					}
				}
			}
		}

		return conflicts;
	}

	/**
	 * Compute test impact analysis for a set of changed files.
	 *
	 * Given changed files, determines:
	 * - Directly affected tests (tests of the changed files)
	 * - Transitively affected tests (tests of files that import changed files)
	 *
	 * @param changedFiles - File paths that have been modified
	 * @returns Impact analysis result
	 */
	computeTestImpact(changedFiles: string[]): TestImpactResult {
		const normalizedChanged = changedFiles.map((f) => toPosixPath(f));
		const directlyAffectedTests = new Set<string>();
		const transitivelyAffectedTests = new Set<string>();

		// Direct: tests of the changed files
		for (const filePath of normalizedChanged) {
			const tests = this.getTestsForFile(filePath);
			for (const test of tests) {
				directlyAffectedTests.add(test.path);
			}
		}

		// Transitive: files that import changed files, then tests of those files
		for (const filePath of normalizedChanged) {
			const dependents = this.getDependents(filePath);
			for (const dep of dependents) {
				const depTests = this.getTestsForFile(dep.path);
				for (const test of depTests) {
					if (!directlyAffectedTests.has(test.path)) {
						transitivelyAffectedTests.add(test.path);
					}
				}
			}
		}

		return {
			directlyAffectedTests: Array.from(directlyAffectedTests).sort(),
			transitivelyAffectedTests: Array.from(transitivelyAffectedTests).sort(),
			changedFiles: normalizedChanged,
			totalTestCount: directlyAffectedTests.size + transitivelyAffectedTests.size,
		};
	}

	/**
	 * Get graph statistics.
	 */
	getStats(): RepoSymbolGraphStats {
		const byClassification: Record<FileClassification, number> = {
			source: 0,
			test: 0,
			config: 0,
			documentation: 0,
			other: 0,
		};

		let totalExports = 0;
		let totalImports = 0;
		let testFiles = 0;

		for (const node of this.nodes.values()) {
			byClassification[node.classification]++;
			totalExports += node.exports.length;
			totalImports += node.imports.length;
			if (node.classification === "test") testFiles++;
		}

		return {
			nodeCount: this.nodes.size,
			edgeCount: this.edges.length,
			byClassification,
			totalExports,
			totalImports,
			testFiles,
		};
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	/**
	 * Rebuild edges from current node data.
	 */
	private _rebuildEdges(): void {
		this.edges = [];

		for (const node of this.nodes.values()) {
			// Import edges
			for (const imp of node.imports) {
				if (this.nodes.has(imp.targetPath)) {
					this.edges.push({
						source: node.path,
						target: imp.targetPath,
						type: "imports",
						metadata: {
							importedNames: imp.importedNames,
							typeOnly: imp.typeOnly,
							dynamic: imp.dynamic,
						},
					});
				}
			}

			// Test association edges
			for (const testPath of node.associatedTests) {
				if (this.nodes.has(testPath)) {
					this.edges.push({
						source: node.path,
						target: testPath,
						type: "test_of",
					});
				}
			}

			// Inverse: test targets
			for (const targetPath of node.testTargets) {
				if (this.nodes.has(targetPath)) {
					// Only add if we don't already have this edge reversed
					const already = this.edges.some(
						(e) => e.source === targetPath && e.target === node.path && e.type === "test_of",
					);
					if (!already) {
						this.edges.push({
							source: node.path,
							target: targetPath,
							type: "test_of",
							metadata: { inverse: true },
						});
					}
				}
			}
		}
	}
}

/**
 * Statistics for the repo symbol graph
 */
export interface RepoSymbolGraphStats {
	nodeCount: number;
	edgeCount: number;
	byClassification: Record<FileClassification, number>;
	totalExports: number;
	totalImports: number;
	testFiles: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify a file by its path.
 */
export function classifyFile(filePath: string): FileClassification {
	const lower = filePath.toLowerCase();

	// Test files
	if (
		lower.endsWith(".test.ts") ||
		lower.endsWith(".test.tsx") ||
		lower.endsWith(".spec.ts") ||
		lower.endsWith(".spec.tsx") ||
		lower.endsWith(".test.js") ||
		lower.endsWith(".spec.js") ||
		lower.endsWith("_test.go") ||
		lower.startsWith("test/") ||
		lower.startsWith("tests/") ||
		lower.startsWith("__tests__/") ||
		lower.startsWith("__test__/") ||
		lower.includes("/test/") ||
		lower.includes("/tests/") ||
		lower.includes("/__tests__/") ||
		lower.includes("/__test__/")
	) {
		return "test";
	}

	// Config files
	if (
		lower.endsWith(".json") ||
		lower.endsWith(".yaml") ||
		lower.endsWith(".yml") ||
		lower.endsWith(".toml") ||
		lower.endsWith(".env.example") ||
		lower.endsWith(".editorconfig") ||
		lower.endsWith("eslintrc") ||
		lower.endsWith("prettierrc") ||
		lower.endsWith(".gitignore") ||
		lower.endsWith("tsconfig.json") ||
		lower.endsWith("package.json")
	) {
		return "config";
	}

	// Documentation
	if (lower.endsWith(".md") || lower.endsWith(".mdx") || lower.endsWith(".txt") || lower.endsWith(".rst")) {
		return "documentation";
	}

	// Source code
	if (
		lower.endsWith(".ts") ||
		lower.endsWith(".tsx") ||
		lower.endsWith(".js") ||
		lower.endsWith(".jsx") ||
		lower.endsWith(".mjs") ||
		lower.endsWith(".cjs") ||
		lower.endsWith(".mts") ||
		lower.endsWith(".cts") ||
		lower.endsWith(".py") ||
		lower.endsWith(".rb") ||
		lower.endsWith(".go") ||
		lower.endsWith(".rs") ||
		lower.endsWith(".java") ||
		lower.endsWith(".kt") ||
		lower.endsWith(".swift") ||
		lower.endsWith(".c") ||
		lower.endsWith(".cpp") ||
		lower.endsWith(".h") ||
		lower.endsWith(".hpp") ||
		lower.endsWith(".sh") ||
		lower.endsWith(".bash") ||
		lower.endsWith(".zsh") ||
		lower.endsWith(".css") ||
		lower.endsWith(".scss") ||
		lower.endsWith(".less") ||
		lower.endsWith(".sql") ||
		lower.endsWith(".graphql") ||
		lower.endsWith(".proto") ||
		lower.endsWith(".svg") ||
		lower.endsWith(".xml") ||
		lower.endsWith(".html") ||
		lower.endsWith(".vue") ||
		lower.endsWith(".svelte")
	) {
		return "source";
	}

	return "other";
}

/**
 * Normalize a path to posix-style relative path.
 */
export function toPosixPath(p: string): string {
	return p.split(sep).join("/");
}

/**
 * Check if a file path matches any of the given forbidden patterns.
 */
export function isForbiddenPath(filePath: string, patterns: string[]): boolean {
	const normalized = toPosixPath(filePath);
	for (const pattern of patterns) {
		// Simple glob matching with ** and *
		const regexStr = pattern
			.replace(/\./g, "\\.")
			.replace(/\*\*/g, "___DOUBLESTAR___")
			.replace(/\*/g, "[^/]*")
			.replace(/___DOUBLESTAR___/g, ".*");
		try {
			const regex = new RegExp(`^${regexStr}$`);
			if (regex.test(normalized)) return true;
		} catch {
			// If pattern is invalid, skip it
		}
	}
	return false;
}

/**
 * Derive a test file path from a source file path by convention.
 * Returns null if no test convention applies.
 *
 * Conventions:
 * - src/foo.ts -> src/foo.test.ts (sibling .test.ts)
 * - src/foo.ts -> test/foo.test.ts (mirror in test/ dir)
 * - src/sub/foo.ts -> test/sub/foo.test.ts
 */
export function deriveTestPath(sourcePath: string): string | null {
	const normalized = toPosixPath(sourcePath);

	// Extract extension and base name
	const dotIndex = normalized.lastIndexOf(".");
	if (dotIndex === -1) return null;

	const baseName = normalized.slice(0, dotIndex);
	const extension = normalized.slice(dotIndex);

	// Common source extensions that have test counterparts
	const sourceExts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
	if (!sourceExts.includes(extension)) return null;

	// Sibling test path: foo.ts -> foo.test.ts
	const siblingTestPath = `${baseName}.test${extension}`;

	// Mirrored test path: src/foo.ts -> test/foo.test.ts or src/sub/foo.ts -> test/sub/foo.test.ts
	let _mirroredTestPath: string | null = null;
	if (normalized.startsWith("src/")) {
		_mirroredTestPath = `test${normalized.slice(3, dotIndex)}.test${extension}`;
	}

	// Return the most specific match (prefer sibling)
	return siblingTestPath;
}

/**
 * Check if a path looks like it could be the test counterpart of a source path.
 */
export function isTestOf(sourcePath: string, testPath: string): boolean {
	const expectedTestPath = deriveTestPath(sourcePath);
	if (!expectedTestPath) return false;
	return toPosixPath(testPath) === expectedTestPath;
}
