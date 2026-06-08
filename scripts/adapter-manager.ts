#!/usr/bin/env node

/**
 * P43 Smart Read Adapter Management
 *
 * adapter-install: Installs optional providers based on platform detection.
 *   Automatically handles macOS (Homebrew), Linux (apt/pacman), and Windows (winget/choco).
 *   npm-only providers (typescript, jsonc-parser, yaml, web-tree-sitter) are
 *   already installed via package.json. This script installs system-level
 *   providers: pyright, rust-analyzer, and tree-sitter CLI.
 *
 * adapter-doctor: Diagnoses all providers and reports status, versions,
 *   file type coverage, mutation safety, and confidence per language.
 *
 * Usage:
 *   node adapter-manager.mjs install        # Install all available providers
 *   node adapter-manager.mjs doctor         # Check provider status
 *   node adapter-manager.mjs doctor --json  # Machine-readable output
 */

import { execSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { arch, platform } from "os";
import { createRequire } from "module";
import { fileURLToPath } from "url";

// createRequire needs a file URL. In tsx/ESM, import.meta.url is available.
// Fallback to cwd + dummy file if unavailable.
const _moduleUrl = typeof import.meta.url === "string" && import.meta.url.startsWith("file://")
	? import.meta.url
	: `file://${process.cwd()}/adapter-manager.js`;
const _require = createRequire(_moduleUrl);
const cwd = process.cwd();

// ======================================================================
// Platform detection
// ======================================================================

const PLATFORM = platform(); // darwin | linux | win32
const ARCH = arch();        // arm64 | x64

function getPlatformName(): string {
	switch (PLATFORM) {
		case "darwin": return ARCH === "arm64" ? "macOS (Apple Silicon)" : "macOS (Intel)";
		case "linux": return "Linux";
		case "win32": return "Windows";
		default: return `Unknown (${PLATFORM})`;
	}
}

function which(cmd: string): string | null {
	try {
		const result = PLATFORM === "win32"
			? execSync(`where ${cmd}`, { stdio: "pipe" })
			: execSync(`which ${cmd}`, { stdio: "pipe" });
		return result.toString().trim().split("\n")[0] || null;
	} catch {
		return null;
	}
}

function cmdExists(cmd: string): boolean {
	return which(cmd) !== null;
}

function runQuiet(cmd: string, args: string[]): { ok: boolean; output: string } {
	const result = spawnSync(cmd, args, { cwd, stdio: "pipe", timeout: 60_000 });
	return {
		ok: result.status === 0,
		output: (result.stdout?.toString() ?? "") + (result.stderr?.toString() ?? ""),
	};
}

function checkVersion(cmd: string, versionArg: string): string | null {
	const result = spawnSync(cmd, [versionArg], { cwd, stdio: "pipe", timeout: 10_000 });
	if (result.status === 0) {
		const out = (result.stdout?.toString() ?? "").trim().split("\n")[0];
		return out.replace(new RegExp(`^${cmd}\\s*`, "i"), "").replace(/^v/, "").trim() || "installed";
	}
	return null;
}

// ======================================================================
// Provider definitions
// ======================================================================

interface ProviderCheck {
	name: string;
	displayName: string;
	category: "npm" | "system-binary" | "optional";
	languages: string[];
	description: string;
	available: boolean;
	version?: string;
	path?: string;
	installInstructions: Record<string, string>; // platform -> install command
	warning?: string;
}

function checkNpmProvider(pkgName: string): boolean {
	try {
		_require.resolve(pkgName);
		return true;
	} catch {
		return false;
	}
}

function checkProviders(): ProviderCheck[] {
	const brew = PLATFORM === "darwin";
	const apt = PLATFORM === "linux" && (cmdExists("apt") || cmdExists("apt-get"));
	const pacman = PLATFORM === "linux" && cmdExists("pacman");
	const winget = PLATFORM === "win32" && cmdExists("winget");
	const choco = PLATFORM === "win32" && cmdExists("choco");

	const providers: ProviderCheck[] = [
		// ---- npm providers (already in package.json) ----
		{
			name: "typescript",
			displayName: "TypeScript Compiler API",
			category: "npm",
			languages: ["typescript", "javascript", "tsx", "jsx"],
			description: "AST-backed symbol extraction via the TypeScript compiler. Provides exact ranges, mutation-safe symbol_exact, and semantic analysis. Confidence: 0.88-0.96.",
			available: checkNpmProvider("typescript"),
			installInstructions: {
				default: "npm install typescript",
			},
		},
		{
			name: "jsonc-parser",
			displayName: "JSON/JSONC Native Parser",
			category: "npm",
			languages: ["json", "jsonc", "json5"],
			description: "Native JSON parser with exact path lookups and mutation-safe range reads. Confidence: 0.96.",
			available: checkNpmProvider("jsonc-parser"),
			installInstructions: {
				default: "npm install jsonc-parser",
			},
		},
		{
			name: "yaml",
			displayName: "YAML Native Parser",
			category: "npm",
			languages: ["yaml", "yml"],
			description: "Native YAML parser via the 'yaml' npm package. Provides AST-backed key extraction. Confidence: 0.85.",
			available: checkNpmProvider("yaml"),
			installInstructions: {
				default: "npm install yaml",
			},
		},
		{
			name: "web-tree-sitter",
			displayName: "Tree-sitter WASM",
			category: "npm",
			languages: ["python", "rust", "typescript", "javascript", "json", "yaml"],
			description: "Syntax-level AST via tree-sitter WASM for Python, Rust, TS, JS, JSON, YAML. Exact ranges and mutation-safe symbol_exact for all supported languages. Confidence: 0.80-0.92.",
			available: checkNpmProvider("web-tree-sitter"),
			installInstructions: {
				default: "npm install web-tree-sitter tree-sitter-wasms",
			},
		},
		// ---- System binaries ----
		{
			name: "pyright",
			displayName: "Pyright LSP",
			category: "system-binary",
			languages: ["python"],
			description: "Microsoft Pyright type-checker. Provides full semantic analysis for Python with exact ranges and mutation-safe reads. Confidence: 0.92-0.96.",
			available: cmdExists("pyright") || cmdExists("pyright-langserver"),
			installInstructions: {
				darwin: brew ? "brew install pyright" : "npm install -g pyright",
				linux: pacman ? "yay -S pyright" : apt ? "npm install -g pyright" : "npm install -g pyright",
				win32: winget ? "winget install Microsoft.Pyright" : choco ? "choco install pyright" : "npm install -g pyright",
				default: "npm install -g pyright",
			},
		},
		{
			name: "rust-analyzer",
			displayName: "rust-analyzer LSP",
			category: "system-binary",
			languages: ["rust"],
			description: "Rust language server. Provides full semantic analysis with exact ranges and mutation-safe reads. Confidence: 0.94-0.98. Disabled by default; opt-in required.",
			available: cmdExists("rust-analyzer") || cmdExists("rustup"),
			installInstructions: {
				darwin: brew ? "brew install rust-analyzer" : "rustup component add rust-analyzer",
				linux: pacman ? "pacman -S rust-analyzer" : apt ? "apt-get install rust-analyzer" : "rustup component add rust-analyzer",
				win32: "rustup component add rust-analyzer",
				default: "rustup component add rust-analyzer",
			},
		},
		{
			name: "tree-sitter-cli",
			displayName: "tree-sitter CLI",
			category: "optional",
			languages: ["*"],
			description: "Tree-sitter CLI for grammar compilation and debugging. Not needed for smart read (uses WASM), but useful for grammar development. Optional.",
			available: cmdExists("tree-sitter"),
			installInstructions: {
				darwin: brew ? "brew install tree-sitter" : "npm install -g tree-sitter-cli",
				linux: pacman ? "pacman -S tree-sitter" : apt ? "npm install -g tree-sitter-cli" : "npm install -g tree-sitter-cli",
				win32: "npm install -g tree-sitter-cli",
				default: "npm install -g tree-sitter-cli",
			},
		},
	];

	// Resolve versions for available providers
	for (const p of providers) {
		if (!p.available) continue;
		if (p.name === "typescript") {
			try { p.version = _require("typescript/package.json").version; } catch {}
		} else if (p.name === "jsonc-parser") {
			try { p.version = _require("jsonc-parser/package.json").version; } catch {}
		} else if (p.name === "yaml") {
			try { p.version = _require("yaml/package.json").version; } catch {}
		} else if (p.name === "web-tree-sitter") {
			try { p.version = _require("web-tree-sitter/package.json").version; } catch {}
		} else if (p.name === "pyright") {
			p.version = checkVersion("pyright", "--version") || undefined;
		} else if (p.name === "rust-analyzer") {
			p.version = checkVersion("rust-analyzer", "--version") || undefined;
		} else if (p.name === "tree-sitter-cli") {
			p.version = checkVersion("tree-sitter", "--version") || undefined;
		}
		if (p.available) {
			p.path = which(p.name) ?? undefined;
		}
	}

	return providers;
}

// ======================================================================
// File type coverage matrix
// ======================================================================

interface LanguageCoverage {
	language: string;
	extensions: string[];
	providers: string[];
	bestProvider: string | null;
	npmOnly: boolean;
	mutationSafeExact: boolean;
	confidenceRange: string;
	status: "full" | "partial" | "regex-only";
}

function buildCoverageMatrix(providers: ProviderCheck[]): LanguageCoverage[] {
	const npmAvail = (name: string) => providers.find(p => p.name === name)?.available ?? false;
	const sysAvail = (name: string) => providers.find(p => p.name === name)?.available ?? false;

	return [
		{
			language: "TypeScript",
			extensions: [".ts", ".tsx", ".mts", ".cts"],
			providers: ["typescript", "web-tree-sitter", "typescript-regex-fallback"],
			bestProvider: npmAvail("typescript") ? "typescript-compiler" : npmAvail("web-tree-sitter") ? "tree-sitter-wasm" : "typescript-regex-fallback",
			npmOnly: true,
			mutationSafeExact: npmAvail("typescript") || npmAvail("web-tree-sitter"),
			confidenceRange: npmAvail("typescript") ? "0.88-0.96" : npmAvail("web-tree-sitter") ? "0.80-0.92" : "0.30-0.45",
			status: npmAvail("typescript") ? "full" : npmAvail("web-tree-sitter") ? "full" : "regex-only",
		},
		{
			language: "JavaScript",
			extensions: [".js", ".jsx", ".mjs", ".cjs"],
			providers: ["typescript", "web-tree-sitter", "typescript-regex-fallback"],
			bestProvider: npmAvail("typescript") ? "typescript-compiler" : npmAvail("web-tree-sitter") ? "tree-sitter-wasm" : "typescript-regex-fallback",
			npmOnly: true,
			mutationSafeExact: npmAvail("typescript") || npmAvail("web-tree-sitter"),
			confidenceRange: npmAvail("typescript") ? "0.88-0.96" : npmAvail("web-tree-sitter") ? "0.80-0.92" : "0.30-0.45",
			status: npmAvail("typescript") ? "full" : npmAvail("web-tree-sitter") ? "full" : "regex-only",
		},
		{
			language: "JSON",
			extensions: [".json", ".jsonc", ".json5"],
			providers: ["jsonc-parser", "web-tree-sitter", "json-yaml-regex-fallback"],
			bestProvider: npmAvail("jsonc-parser") ? "json-native" : npmAvail("web-tree-sitter") ? "tree-sitter-wasm" : "json-yaml-regex-fallback",
			npmOnly: true,
			mutationSafeExact: npmAvail("jsonc-parser") || npmAvail("web-tree-sitter"),
			confidenceRange: npmAvail("jsonc-parser") ? "0.96" : npmAvail("web-tree-sitter") ? "0.80-0.92" : "0.30-0.45",
			status: npmAvail("jsonc-parser") ? "full" : npmAvail("web-tree-sitter") ? "full" : "regex-only",
		},
		{
			language: "YAML",
			extensions: [".yaml", ".yml"],
			providers: ["yaml", "web-tree-sitter", "json-yaml-regex-fallback"],
			bestProvider: npmAvail("yaml") ? "yaml-native" : npmAvail("web-tree-sitter") ? "tree-sitter-wasm" : "json-yaml-regex-fallback",
			npmOnly: true,
			mutationSafeExact: false, // YAML exact range depends on parser output
			confidenceRange: npmAvail("yaml") ? "0.85" : npmAvail("web-tree-sitter") ? "0.80-0.92" : "0.30-0.45",
			status: npmAvail("yaml") ? "full" : npmAvail("web-tree-sitter") ? "full" : "regex-only",
		},
		{
			language: "Python",
			extensions: [".py", ".pyw"],
			providers: ["pyright", "web-tree-sitter", "python-regex-fallback"],
			bestProvider: sysAvail("pyright") ? "pyright" : npmAvail("web-tree-sitter") ? "tree-sitter-wasm" : "python-regex-fallback",
			npmOnly: !sysAvail("pyright"),
			mutationSafeExact: sysAvail("pyright") || npmAvail("web-tree-sitter"),
			confidenceRange: sysAvail("pyright") ? "0.92-0.96" : npmAvail("web-tree-sitter") ? "0.80-0.90" : "0.30-0.45",
			status: sysAvail("pyright") ? "full" : npmAvail("web-tree-sitter") ? "full" : "regex-only",
		},
		{
			language: "Rust",
			extensions: [".rs"],
			providers: ["rust-analyzer (disabled by default)", "web-tree-sitter", "rust-regex-fallback"],
			bestProvider: npmAvail("web-tree-sitter") ? "tree-sitter-wasm" : "rust-regex-fallback",
			npmOnly: true, // rust-analyzer disabled by default
			mutationSafeExact: npmAvail("web-tree-sitter"),
			confidenceRange: npmAvail("web-tree-sitter") ? "0.80-0.92" : "0.30-0.45",
			status: npmAvail("web-tree-sitter") ? "full" : "regex-only",
		},
		{
			language: "Unknown/Markdown",
			extensions: [".md", ".txt", ".html", "*"],
			providers: ["generic", "llm-fallback"],
			bestProvider: "generic",
			npmOnly: true,
			mutationSafeExact: false,
			confidenceRange: "0.20-0.55",
			status: "regex-only",
		},
	];
}

// ======================================================================
// CLI: adapter-doctor
// ======================================================================

function doctor(json: boolean): void {
	const providers = checkProviders();
	const coverage = buildCoverageMatrix(providers);
	const npmOk = providers.filter(p => p.category === "npm" && p.available).length;
	const npmTotal = providers.filter(p => p.category === "npm").length;
	const sysOk = providers.filter(p => p.category === "system-binary" && p.available).length;
	const sysTotal = providers.filter(p => p.category === "system-binary").length;

	if (json) {
		console.log(JSON.stringify({
			platform: getPlatformName(),
			arch: ARCH,
			providers: providers.map(p => ({
				name: p.name,
				available: p.available,
				version: p.version ?? null,
				path: p.path ?? null,
				category: p.category,
				languages: p.languages,
			})),
			coverage: coverage.map(c => ({
				language: c.language,
				extensions: c.extensions,
				bestProvider: c.bestProvider,
				mutationSafeExact: c.mutationSafeExact,
				confidenceRange: c.confidenceRange,
				status: c.status,
			})),
			summary: {
				npmProviders: `${npmOk}/${npmTotal}`,
				systemProviders: `${sysOk}/${sysTotal}`,
				languagesFullCoverage: coverage.filter(c => c.status === "full").length,
				languagesPartialCoverage: coverage.filter(c => c.status === "partial").length,
				languagesRegexOnly: coverage.filter(c => c.status === "regex-only").length,
			},
		}, null, 2));
		return;
	}

	// ---- Text report ----
	const lines: string[] = [];
	lines.push("=== P43 Smart Read Adapter Doctor ===");
	lines.push("");
	lines.push(`Platform: ${getPlatformName()} (${ARCH})`);
	lines.push(`Node.js:  ${process.version}`);
	lines.push(`Directory: ${cwd}`);
	lines.push("");

	lines.push("--- Providers ---");
	for (const p of providers) {
		const status = p.available ? "OK" : "MISSING";
		const ver = p.version ? ` v${p.version}` : "";
		const line = `  [${status.padEnd(7)}] ${p.displayName.padEnd(28)} ${ver.padEnd(16)} ${p.languages.join(", ")}`;
		lines.push(line);
		if (!p.available && p.category !== "optional") {
			const key = PLATFORM in p.installInstructions ? PLATFORM : "default";
			lines.push(`         Install: ${p.installInstructions[key]}`);
		}
	}

	lines.push("");
	lines.push("--- Language Coverage ---");
	for (const c of coverage) {
		const icon = c.status === "full" ? "FULL" : c.status === "partial" ? "PART" : "REX";
		const mu = c.mutationSafeExact ? "mutation-safe" : "not mutation-safe";
		lines.push(`  [${icon.padEnd(4)}] ${c.language.padEnd(14)} ${c.extensions.join(", ").padEnd(30)} ${(c.bestProvider ?? "none").padEnd(25)} ${c.confidenceRange.padEnd(14)} ${mu}`);
	}

	lines.push("");
	lines.push("--- Summary ---");
	lines.push(`  npm providers:         ${npmOk}/${npmTotal} available`);
	lines.push(`  system providers:      ${sysOk}/${sysTotal} available`);
	lines.push(`  languages (full):       ${coverage.filter(c => c.status === "full").length}`);
	lines.push(`  languages (regex only): ${coverage.filter(c => c.status === "regex-only").length}`);

	lines.push("");
	lines.push("--- Install Commands ---");
	const missingSystem = providers.filter(p => !p.available && p.category === "system-binary");
	if (missingSystem.length === 0) {
		lines.push("  All system providers are installed.");
	} else {
		// Group by platform
		const key = PLATFORM in missingSystem[0]?.installInstructions ? PLATFORM : "default";
		for (const p of missingSystem) {
			lines.push(`  # ${p.displayName}`);
			lines.push(`  ${p.installInstructions[key] ?? p.installInstructions.default}`);
		}
	}
	if (npmOk < npmTotal) {
		lines.push("  # npm providers (should already be in package.json)");
		lines.push("  npm install");
	}
	lines.push("");
	lines.push("Run 'make adapter-install' to install all recommended providers.");

	console.log(lines.join("\n"));
}

// ======================================================================
// CLI: adapter-install
// ======================================================================

async function install(): Promise<void> {
	const providers = checkProviders();
	const missing = providers.filter(p => !p.available && p.category !== "optional");

	if (missing.length === 0) {
		console.log("All recommended providers are already installed.");
		console.log("Run 'make adapter-doctor' for detailed status.");
		return;
	}

	console.log(`Installing ${missing.length} missing provider(s)...`);
	console.log("");

	for (const p of missing) {
		const key = PLATFORM in p.installInstructions ? PLATFORM : "default";
		const cmd = p.installInstructions[key] ?? p.installInstructions.default;
		console.log(`[${p.displayName}]`);
		console.log(`  $ ${cmd}`);

		// Safety: don't auto-execute; print instructions
		if (p.category === "npm") {
			// npm install is safe to auto-run
			const parts = cmd.split(" ");
			const result = spawnSync(parts[0], parts.slice(1), { cwd, stdio: "inherit", timeout: 120_000 });
			if (result.status === 0) {
				console.log(`  OK: ${p.displayName} installed`);
			} else {
				console.log(`  FAILED: ${p.displayName} could not be installed (error ${result.status})`);
			}
		} else {
			// System packages: don't auto-run, just print the command
			console.log(`  (system package — run manually or use package manager)`);
		}
		console.log("");
	}

	console.log("Done. Run 'make adapter-doctor' to verify installation.");
}

// ======================================================================
// Main
// ======================================================================

const args = process.argv.slice(2);
const command = args[0];
const jsonFlag = args.includes("--json");

if (command === "doctor") {
	doctor(jsonFlag);
} else if (command === "install") {
	await install();
} else {
	console.log("Usage: node adapter-manager.mjs <command>");
	console.log("  doctor     Check provider status");
	console.log("  doctor --json  Machine-readable status");
	console.log("  install    Install recommended providers");
	process.exit(1);
}
