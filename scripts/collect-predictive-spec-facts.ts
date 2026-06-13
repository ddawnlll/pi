/**
 * P45.01 — Predictive Spec Fact Collection
 *
 * Collects routes, exports, types, API shapes, files, workspace intents, and
 * ownership candidates as machine-readable facts for the predictive spec generator.
 *
 * Usage:
 *   npx tsx scripts/collect-predictive-spec-facts.ts --output reports/p45-spec/facts.json
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

// =============================================================================
// Types
// =============================================================================

interface ExportFact {
	name: string;
	kind: "function" | "class" | "type" | "interface" | "const" | "enum" | "namespace";
	file: string;
	isDefault: boolean;
}

interface RouteFact {
	path: string;
	method: string;
	file: string;
	handler: string;
}

interface FileFact {
	path: string;
	sizeBytes: number;
	lastModified: string;
	exports: ExportFact[];
}

interface SpecFactBundle {
	schemaVersion: string;
	generatedAt: string;
	repoRoot: string;
	targetDir: string;
	totalFiles: number;
	totalExports: number;
	totalRoutes: number;
	files: FileFact[];
	routes: RouteFact[];
	namespaceCandidates: string[][];
}

// =============================================================================
// Scanners
// =============================================================================

function findTsFiles(dir: string): string[] {
	const files: string[] = [];
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist") {
				files.push(...findTsFiles(fullPath));
			} else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !entry.name.endsWith(".test.ts")) {
				files.push(fullPath);
			}
		}
	} catch {
		// Skip inaccessible
	}
	return files;
}

const EXPORT_REGEX = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|namespace|let|var)\s+(\w+)/g;

function extractExports(filePath: string): ExportFact[] {
	try {
		const content = readFileSync(filePath, "utf-8");
		const exports: ExportFact[] = [];
		let match: RegExpExecArray | null;
		while ((match = EXPORT_REGEX.exec(content)) !== null) {
			const fullMatch = match[0];
			let kind: ExportFact["kind"] = "function";
			if (fullMatch.includes("class")) kind = "class";
			else if (fullMatch.includes("interface")) kind = "interface";
			else if (fullMatch.includes("type ")) kind = "type";
			else if (fullMatch.includes("enum")) kind = "enum";
			else if (fullMatch.includes("namespace")) kind = "namespace";
			else if (fullMatch.includes("const") || fullMatch.includes("let") || fullMatch.includes("var")) kind = "const";

			exports.push({
				name: match[1],
				kind,
				file: "",
				isDefault: fullMatch.includes("default"),
			});
		}
		return exports;
	} catch {
		return [];
	}
}

function extractRoutes(filePath: string, relPath: string): RouteFact[] {
	try {
		const content = readFileSync(filePath, "utf-8");
		const routes: RouteFact[] = [];
		// Simple route detection: common patterns like router.get('/path', handler)
		const routeRegex = /(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
		let match: RegExpExecArray | null;
		while ((match = routeRegex.exec(content)) !== null) {
			routes.push({
				path: match[2],
				method: match[1].toUpperCase(),
				file: relPath,
				handler: "unknown",
			});
		}
		return routes;
	} catch {
		return [];
	}
}

// =============================================================================
// Namespace Suggestion
// =============================================================================

function suggestNamespaces(files: string[]): string[][] {
	// Group by top-level directory under src/core
	const groups = new Map<string, string[]>();
	for (const file of files) {
		const parts = file.split("/");
		// Find "src/core/assembly" or similar
		const srcIdx = parts.indexOf("src");
		if (srcIdx >= 0 && srcIdx + 2 < parts.length) {
			const key = parts.slice(0, srcIdx + 3).join("/");
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(file);
		}
	}
	return [...groups.values()].filter((g) => g.length > 0).slice(0, 6);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const outputIdx = args.indexOf("--output");
	const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : "reports/p45-spec/facts.json";

	const repoRoot = process.cwd();
	const targetDir = "packages/coding-agent/src/core/assembly";

	const absTarget = join(repoRoot, targetDir);
	const tsFiles = findTsFiles(absTarget).map((f) => relative(repoRoot, f));

	const files: FileFact[] = [];
	const routes: RouteFact[] = [];

	for (const relPath of tsFiles) {
		const absPath = join(repoRoot, relPath);
		const stats = statSync(absPath);
		const exports = extractExports(absPath).map((e) => ({ ...e, file: relPath }));
		const fileRoutes = extractRoutes(absPath, relPath);

		files.push({
			path: relPath,
			sizeBytes: stats.size,
			lastModified: stats.mtime.toISOString(),
			exports,
		});

		routes.push(...fileRoutes);
	}

	const totalExports = files.reduce((sum, f) => sum + f.exports.length, 0);

	const bundle: SpecFactBundle = {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		repoRoot,
		targetDir,
		totalFiles: files.length,
		totalExports,
		totalRoutes: routes.length,
		files,
		routes,
		namespaceCandidates: suggestNamespaces(tsFiles),
	};

	mkdirSync(outputPath.substring(0, outputPath.lastIndexOf("/")), { recursive: true });
	writeFileSync(outputPath, JSON.stringify(bundle, null, 2));
	console.log(`Fact collection written to ${outputPath}`);
	console.log(`Files: ${bundle.totalFiles}, Exports: ${bundle.totalExports}, Routes: ${bundle.totalRoutes}`);
}

main().catch((err) => {
	console.error("Fact collection failed:", err);
	process.exit(1);
});
