/**
 * Package/Config state snapshot.
 *
 * Detects package manager, scans package.json files,
 * records config files and test framework hints.
 */

import type { Stats } from "node:fs";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { hashContent } from "./hash.js";
import { HARD_EXCLUDED_DIRS, SCHEMA_VERSION } from "./paths.js";
import type { PackageEntry, PackageState, SnapshotValidity } from "./types.js";

/**
 * Detect package manager from lockfile presence in rootDir.
 */
function detectPackageManager(rootDir: string): PackageState["packageManager"] {
	if (existsSync(join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(rootDir, "yarn.lock"))) return "yarn";
	if (existsSync(join(rootDir, "package-lock.json"))) return "npm";
	if (existsSync(join(rootDir, "bun.lockb")) || existsSync(join(rootDir, "bun.lock"))) return "bun";
	return "unknown";
}

/**
 * Check if a path component should be excluded.
 */
function isExcludedDir(relDir: string): boolean {
	const parts = relDir.replace(/\\/g, "/").split("/");
	for (const part of parts) {
		if (HARD_EXCLUDED_DIRS.has(part)) return true;
	}
	return false;
}

/**
 * Recursively find package.json files excluding ignored dirs.
 */
function findPackageFiles(rootDir: string): string[] {
	const results: string[] = [];

	function walk(dir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}

		entries.sort();
		for (const name of entries) {
			if (name.startsWith(".")) continue;
			if (HARD_EXCLUDED_DIRS.has(name)) continue;

			const fullPath = join(dir, name);
			let stat: Stats;
			try {
				stat = statSync(fullPath);
			} catch {
				continue;
			}

			if (stat.isDirectory()) {
				walk(fullPath);
			} else if (name === "package.json") {
				results.push(fullPath);
			}
		}
	}

	walk(rootDir);
	return results;
}

/**
 * Build package state for a directory.
 */
export function buildPackageState(rootDir: string): PackageState {
	const absRoot = resolve(rootDir);
	const packageManager = detectPackageManager(absRoot);
	const packageFiles: Record<string, PackageEntry> = {};

	// Find all package.json files
	const pkgPaths = findPackageFiles(absRoot);

	for (const pkgPath of pkgPaths) {
		const relPath = relative(absRoot, pkgPath).replace(/\\/g, "/");

		try {
			const content = readFileSync(pkgPath, "utf-8");
			const parsed = JSON.parse(content);
			const pkgHash = hashContent(content);

			// Compute dependency hashes
			const depContent = JSON.stringify(parsed.dependencies ?? {});
			const devDepContent = JSON.stringify(parsed.devDependencies ?? {});
			const dependenciesHash = depContent !== "{}" ? hashContent(depContent) : undefined;
			const devDependenciesHash = devDepContent !== "{}" ? hashContent(devDepContent) : undefined;

			packageFiles[relPath] = {
				path: relPath,
				name: parsed.name ?? undefined,
				scripts: parsed.scripts ?? {},
				dependenciesHash,
				devDependenciesHash,
				packageHash: pkgHash,
			};
		} catch {
			// Skip malformed package.json
		}
	}

	// Detect lockfiles
	const lockfiles: string[] = [];
	const lockfileNames = ["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb", "bun.lock", "deno.lock"];
	for (const lf of lockfileNames) {
		if (existsSync(join(absRoot, lf))) {
			lockfiles.push(lf);
		}
	}

	// Detect test framework hints
	const testFrameworkHints: string[] = [];
	const allScripts = new Set<string>();
	const allDeps = new Set<string>();

	for (const entry of Object.values(packageFiles)) {
		for (const script of Object.values(entry.scripts)) {
			allScripts.add(script);
		}
		if (entry.dependenciesHash || entry.devDependenciesHash) {
			try {
				const pkgPath = join(absRoot, entry.path);
				const content = readFileSync(pkgPath, "utf-8");
				const parsed = JSON.parse(content);
				for (const dep of Object.keys(parsed.dependencies ?? {})) {
					allDeps.add(dep);
				}
				for (const dep of Object.keys(parsed.devDependencies ?? {})) {
					allDeps.add(dep);
				}
			} catch {
				// skip
			}
		}
	}

	if (allDeps.has("vitest") || [...allScripts].some((s) => s.includes("vitest"))) {
		testFrameworkHints.push("vitest");
	}
	if (allDeps.has("jest") || [...allScripts].some((s) => s.includes("jest"))) {
		testFrameworkHints.push("jest");
	}
	if (allDeps.has("mocha") || [...allScripts].some((s) => s.includes("mocha"))) {
		testFrameworkHints.push("mocha");
	}

	// Detect config files (simple check)
	const configFiles: string[] = [];
	const configPatterns = [
		"tsconfig",
		"vite.config.",
		"vitest.config.",
		"jest.config.",
		"eslintrc",
		".eslintrc",
		"prettierrc",
		".prettierrc",
		"pnpm-workspace.yaml",
		"turbo.json",
	];
	function scanForConfig(dir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of entries) {
			if (name.startsWith(".") && !name.startsWith(".eslintrc") && !name.startsWith(".prettierrc")) continue;
			if (HARD_EXCLUDED_DIRS.has(name)) continue;
			const fullPath = join(dir, name);
			let stat: Stats;
			try {
				stat = statSync(fullPath);
			} catch {
				continue;
			}
			if (stat.isDirectory()) {
				scanForConfig(fullPath);
				continue;
			}
			for (const pattern of configPatterns) {
				if (name.includes(pattern) || name === pattern) {
					const relPath = relative(absRoot, fullPath).replace(/\\/g, "/");
					if (!configFiles.includes(relPath)) {
						configFiles.push(relPath);
					}
					break;
				}
			}
		}
	}
	scanForConfig(absRoot);
	configFiles.sort();

	const validity: SnapshotValidity = Object.keys(packageFiles).length > 0 ? "valid" : "unknown";

	return {
		schemaVersion: SCHEMA_VERSION,
		generatedAt: new Date().toISOString(),
		packageManager,
		packageFiles,
		lockfiles,
		testFrameworkHints,
		configFiles,
		validity,
	};
}
