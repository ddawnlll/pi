/**
 * P45.00 — ACCP-Native Baseline Parallelism Audit and Preflight
 *
 * Measures DAG parallelism potential.
 * Produces machine-readable baseline data for the adaptive concurrency governor.
 *
 * Usage:
 *   npx tsx scripts/measure-dag-parallelism.ts --output reports/p45-baseline/dag-audit.json
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// =============================================================================
// Types
// =============================================================================

interface DagNode {
	path: string;
	dependencies: string[];
	dependents: string[];
}

interface DagAudit {
	schemaVersion: string;
	generatedAt: string;
	repoRoot: string;
	totalNodes: number;
	totalEdges: number;
	maxDepth: number;
	bottleneckNodes: string[];
	parallelismOpportunities: number;
	namespaceSuggestion: string[];
}

// =============================================================================
// DAG Construction
// =============================================================================

const IMPORT_REGEX = /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;

function findTsFiles(dir: string): string[] {
	const files: string[] = [];
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
				files.push(...findTsFiles(fullPath));
			} else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
				files.push(fullPath);
			}
		}
	} catch {
		// Skip inaccessible directories
	}
	return files;
}

function extractImports(filePath: string, repoRoot: string): string[] {
	try {
		const content = readFileSync(filePath, "utf-8");
		const imports: string[] = [];
		let match: RegExpExecArray | null;
		while ((match = IMPORT_REGEX.exec(content)) !== null) {
			const importPath = match[1];
			if (importPath.startsWith(".")) {
				// Relative import — resolve to absolute
				const resolved = join(filePath, "..", importPath);
				// Try .ts, .tsx, /index.ts
				for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
					const candidate = resolved + ext;
					if (existsSync(candidate)) {
						imports.push(relative(repoRoot, candidate));
						break;
					}
				}
			}
		}
		return imports;
	} catch {
		return [];
	}
}

// =============================================================================
// Analysis
// =============================================================================

function buildDag(repoRoot: string, targetDir: string): Map<string, DagNode> {
	const absTarget = join(repoRoot, targetDir);
	const tsFiles = findTsFiles(absTarget).map((f) => relative(repoRoot, f));
	const nodes = new Map<string, DagNode>();

	for (const file of tsFiles) {
		nodes.set(file, { path: file, dependencies: [], dependents: [] });
	}

	// Build dependency edges
	for (const file of tsFiles) {
		const absPath = join(repoRoot, file);
		const deps = extractImports(absPath, repoRoot);
		const node = nodes.get(file)!;
		for (const dep of deps) {
			if (nodes.has(dep)) {
				node.dependencies.push(dep);
				nodes.get(dep)!.dependents.push(file);
			}
		}
	}

	return nodes;
}

function computeDepth(nodes: Map<string, DagNode>): Map<string, number> {
	const depths = new Map<string, number>();

	function dfs(node: string, visited: Set<string>): number {
		if (depths.has(node)) return depths.get(node)!;
		if (visited.has(node)) return 0; // cycle
		visited.add(node);

		const n = nodes.get(node);
		if (!n || n.dependencies.length === 0) {
			depths.set(node, 0);
			return 0;
		}

		let maxDepDepth = 0;
		for (const dep of n.dependencies) {
			maxDepDepth = Math.max(maxDepDepth, dfs(dep, new Set(visited)));
		}

		const depth = maxDepDepth + 1;
		depths.set(node, depth);
		return depth;
	}

	for (const [node] of nodes) {
		dfs(node, new Set());
	}

	return depths;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const outputIdx = args.indexOf("--output");
	const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : "reports/p45-baseline/dag-audit.json";

	const repoRoot = process.cwd();
	const targetDir = "packages/coding-agent/src/core/assembly";

	const nodes = buildDag(repoRoot, targetDir);
	const depths = computeDepth(nodes);

	// Find bottleneck nodes (most dependents)
	const bottleneckNodes = [...nodes.entries()]
		.sort((a, b) => b[1].dependents.length - a[1].dependents.length)
		.slice(0, 5)
		.map(([path]) => path);

	// Count parallelism opportunities (nodes at same depth with no conflicts)
	const depthGroups = new Map<number, string[]>();
	for (const [node, depth] of depths) {
		if (!depthGroups.has(depth)) depthGroups.set(depth, []);
		depthGroups.get(depth)!.push(node);
	}

	let parallelismOpportunities = 0;
	for (const [, group] of depthGroups) {
		if (group.length > 1) {
			parallelismOpportunities += group.length - 1;
		}
	}

	const maxDepth = Math.max(0, ...depths.values());

	const audit: DagAudit = {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		repoRoot,
		totalNodes: nodes.size,
		totalEdges: [...nodes.values()].reduce((sum, n) => sum + n.dependencies.length, 0),
		maxDepth,
		bottleneckNodes,
		parallelismOpportunities,
		namespaceSuggestion: generateNamespaceSuggestions(nodes, 6),
	};

	mkdirSync(outputPath.substring(0, outputPath.lastIndexOf("/")), { recursive: true });
	writeFileSync(outputPath, JSON.stringify(audit, null, 2));
	console.log(`DAG audit written to ${outputPath}`);
	console.log(`Nodes: ${audit.totalNodes}, Edges: ${audit.totalEdges}, Max Depth: ${audit.maxDepth}`);
	console.log(`Parallelism opportunities: ${audit.parallelismOpportunities}`);
}

function generateNamespaceSuggestions(nodes: Map<string, DagNode>, targetCount: number): string[] {
	// Simple grouping by directory prefix
	const groups = new Map<string, string[]>();
	for (const [path] of nodes) {
		const prefix = path.split("/").slice(0, 3).join("/");
		if (!groups.has(prefix)) groups.set(prefix, []);
		groups.get(prefix)!.push(path);
	}

	return [...groups.entries()]
		.sort((a, b) => b[1].length - a[1].length)
		.slice(0, targetCount)
		.map(([prefix]) => prefix);
}

main().catch((err) => {
	console.error("DAG audit failed:", err);
	process.exit(1);
});
