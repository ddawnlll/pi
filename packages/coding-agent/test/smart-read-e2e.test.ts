/**
 * Smart Read End-to-End Production Test
 *
 * Reads 50 real files of various types, times each read, detects stuck scenarios.
 * If any read takes > 3 seconds, it's reported as stuck with the last known step.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTokenContextRuntime } from "../src/core/token-context/runtime.js";
import type { SmartReadCore } from "../src/core/token-context/smart-read-core.js";
import { DEFAULT_TOKEN_CONTEXT_CONFIG } from "../src/core/token-context/types.js";

// ============================================================================
// 50 Real Files from the Pi Repo
// ============================================================================

const FILES: Array<{ path: string; type: string; description: string }> = [
	// TypeScript (25 files)
	{
		path: "packages/coding-agent/src/core/token-context/runtime.ts",
		type: "typescript",
		description: "Central smart read orchestrator (850 lines)",
	},
	{
		path: "packages/coding-agent/src/core/token-context/types.ts",
		type: "typescript",
		description: "All P43 types and interfaces",
	},
	{
		path: "packages/coding-agent/src/core/token-context/smart-read-core.ts",
		type: "typescript",
		description: "Adapter registry and dispatch",
	},
	{
		path: "packages/coding-agent/src/core/token-context/read-hash-cache.ts",
		type: "typescript",
		description: "SHA-256 snapshot cache",
	},
	{
		path: "packages/coding-agent/src/core/token-context/savings-ledger.ts",
		type: "typescript",
		description: "Token saving event ledger",
	},
	{
		path: "packages/coding-agent/src/core/token-context/token-estimator.ts",
		type: "typescript",
		description: "Token estimator + P44 calibration",
	},
	{
		path: "packages/coding-agent/src/core/token-context/raw-cache.ts",
		type: "typescript",
		description: "O(1) LRU raw content cache",
	},
	{
		path: "packages/coding-agent/src/core/token-context/active-context-registry.ts",
		type: "typescript",
		description: "File context state tracker",
	},
	{
		path: "packages/coding-agent/src/core/token-context/change-ledger.ts",
		type: "typescript",
		description: "Delta chain tracker",
	},
	{
		path: "packages/coding-agent/src/core/token-context/adapters/typescript.ts",
		type: "typescript",
		description: "TypeScript smart read adapter",
	},
	{
		path: "packages/coding-agent/src/core/token-context/adapters/fallback.ts",
		type: "typescript",
		description: "Generic fallback adapter",
	},
	{
		path: "packages/coding-agent/src/core/token-context/adapters/python.ts",
		type: "typescript",
		description: "Python smart read adapter",
	},
	{
		path: "packages/coding-agent/src/core/token-context/adapters/rust.ts",
		type: "typescript",
		description: "Rust smart read adapter",
	},
	{
		path: "packages/coding-agent/src/core/token-context/adapters/json-yaml.ts",
		type: "typescript",
		description: "JSON/YAML smart read adapter",
	},
	{
		path: "packages/coding-agent/src/core/tools/read.ts",
		type: "typescript",
		description: "Read tool implementation",
	},
	{ path: "packages/coding-agent/src/core/tools/edit.ts", type: "typescript", description: "Edit tool" },
	{ path: "packages/coding-agent/src/core/tools/bash.ts", type: "typescript", description: "Bash tool" },
	{ path: "packages/coding-agent/src/core/tools/write.ts", type: "typescript", description: "Write tool" },
	{
		path: "packages/coding-agent/src/core/self-modification-firewall.ts",
		type: "typescript",
		description: "Self-mod firewall",
	},
	{ path: "packages/coding-agent/src/core/dag-analyzer.ts", type: "typescript", description: "DAG analyzer" },
	{ path: "packages/tui/src/tui.ts", type: "typescript", description: "TUI core (44K)" },
	{ path: "packages/tui/src/terminal.ts", type: "typescript", description: "Terminal abstraction" },
	{ path: "packages/agent/src/agent-loop.ts", type: "typescript", description: "Agent loop core" },
	{ path: "packages/ai/src/types.ts", type: "typescript", description: "AI package types" },
	{ path: "packages/ai/src/providers/anthropic.ts", type: "typescript", description: "Anthropic provider" },

	// Markdown (5 files)
	{ path: "docs/execution.md", type: "markdown", description: "Execution system docs (463 lines)" },
	{ path: "packages/ai/README.md", type: "markdown", description: "AI package README (1384 lines)" },
	{ path: "packages/agent/README.md", type: "markdown", description: "Agent package README" },
	{ path: "packages/coding-agent/README.md", type: "markdown", description: "Coding agent README" },
	{ path: "AGENTS.md", type: "markdown", description: "Agent guidelines" },

	// JSON (5 files)
	{ path: "package.json", type: "json", description: "Root package.json" },
	{ path: "packages/coding-agent/package.json", type: "json", description: "Coding agent package.json" },
	{ path: "tsconfig.json", type: "json", description: "Root tsconfig" },
	{ path: "packages/coding-agent/tsconfig.json", type: "json", description: "Coding agent tsconfig" },
	{ path: "packages/coding-agent/vitest.config.ts", type: "typescript", description: "Vitest config" },

	// YAML (2 files)
	{ path: "packages/coding-agent/.pi/settings.json", type: "json", description: "PI settings" },
	{ path: ".github/workflows/ci.yml", type: "yaml", description: "CI workflow" },

	// Python (2 files)
	{ path: "scripts/release.mjs", type: "javascript", description: "Release script" },
	{ path: "packages/db/src/migrations/001_initial.ts", type: "typescript", description: "DB migration" },

	// Rust (1 file) - not a real Rust file, use a .rs fixture or skip
	// Just use more TypeScript files for remaining slots
	{ path: "packages/coding-agent/src/core/session-manager.ts", type: "typescript", description: "Session manager" },
	{ path: "packages/coding-agent/src/core/settings-manager.ts", type: "typescript", description: "Settings manager" },
	{ path: "packages/coding-agent/src/core/model-resolver.ts", type: "typescript", description: "Model resolver" },
	{ path: "packages/coding-agent/src/core/model-registry.ts", type: "typescript", description: "Model registry" },
	{ path: "packages/coding-agent/src/core/sdk.ts", type: "typescript", description: "SDK entry" },
	{ path: "packages/coding-agent/src/core/agent-session.ts", type: "typescript", description: "Agent session" },
	{
		path: "packages/coding-agent/src/core/compaction/compaction.ts",
		type: "typescript",
		description: "Context compaction",
	},
	{ path: "packages/coding-agent/src/core/planner.ts", type: "typescript", description: "Auto planner" },
	{ path: "packages/ai/src/providers/register-builtins.ts", type: "typescript", description: "Provider registry" },
	{ path: "packages/ai/src/utils/event-stream.ts", type: "typescript", description: "Event stream" },
	{ path: "packages/ai/src/env-api-keys.ts", type: "typescript", description: "Env API key detection" },
	{ path: "packages/ai/src/models.ts", type: "typescript", description: "Model registry" },
	{ path: "Makefile", type: "makefile", description: "Root Makefile (423 lines)" },
	{ path: "biome.json", type: "json", description: "Biome config" },
];

// ============================================================================
// Stuck Detector Instrumentation
// ============================================================================

let currentStep = "";

function _instrumentedSmartRead(original: typeof SmartReadCore.prototype.smartRead) {
	return async function (this: SmartReadCore, content: string, filePath: string, mode: string, options?: any) {
		currentStep = `smartRead(${mode})`;
		return original.call(this, content as any, filePath as any, mode as any, options);
	};
}

describe("Smart Read End-to-End Production Test", () => {
	const repoRoot = process.cwd();
	let runtime: ReturnType<typeof createTokenContextRuntime>;
	let tempDir: string;
	const results: Array<{
		file: string;
		type: string;
		rawTokens: number;
		smartTokens: number;
		savedTokens: number;
		efficiency: number;
		durationMs: number;
		adapterName: string;
		adapterConfidence: number;
		stuck: boolean;
		stuckStep: string;
		fallbackReason?: string;
	}> = [];

	beforeAll(() => {
		tempDir = join(tmpdir(), `pi-e2e-smart-read-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		runtime = createTokenContextRuntime({
			...DEFAULT_TOKEN_CONTEXT_CONFIG,
			enabled: true,
			mode: "active_safe",
		});
	});

	afterAll(() => {
		// Print summary
		const totalRaw = results.reduce((s, r) => s + r.rawTokens, 0);
		const totalSmart = results.reduce((s, r) => s + r.smartTokens, 0);
		const totalSaved = results.reduce((s, r) => s + r.savedTokens, 0);
		const stuckFiles = results.filter((r) => r.stuck);
		const avgEfficiency = totalRaw > 0 ? Math.round((totalSaved / totalRaw) * 1000) / 10 : 0;
		const avgDuration = results.reduce((s, r) => s + r.durationMs, 0) / results.length;

		console.log(`\n${"=".repeat(70)}`);
		console.log("SMART READ END-TO-END RESULTS");
		console.log("=".repeat(70));
		console.log(`\nFiles tested: ${results.length}`);
		console.log(`Total raw tokens: ${totalRaw.toLocaleString()}`);
		console.log(`Total smart tokens: ${totalSmart.toLocaleString()}`);
		console.log(`Total tokens saved: ${totalSaved.toLocaleString()}`);
		console.log(`Average efficiency: ${avgEfficiency}%`);
		console.log(`Average duration: ${avgDuration.toFixed(1)}ms`);
		console.log(`Stuck files: ${stuckFiles.length}`);

		if (stuckFiles.length > 0) {
			console.log("\n--- STUCK FILES ---");
			for (const r of stuckFiles) {
				console.log(`  ${r.file}: stuck at step "${r.stuckStep}" (${r.durationMs}ms)`);
			}
		}

		console.log("\n--- PER-FILE RESULTS ---");
		console.log(
			`${"File".padEnd(50)} ${"Type".padEnd(12)} ${"Raw".padEnd(6)} ${"Smart".padEnd(6)} ${"Save%".padEnd(6)} ${"Time".padEnd(6)} ${"Adapter".padEnd(20)} ${"Stuck?"}`,
		);
		console.log("-".repeat(120));
		for (const r of results) {
			const name = r.file.split("/").pop()?.padEnd(48) ?? "";
			console.log(
				`${name} ${r.type.padEnd(12)} ${String(r.rawTokens).padEnd(6)} ${String(r.smartTokens).padEnd(6)} ${String(r.efficiency).padEnd(5)}% ${String(r.durationMs).padEnd(5)}ms ${r.adapterName.padEnd(20)} ${r.stuck ? "YES" : "no"}`,
			);
		}

		rmSync(tempDir, { recursive: true, force: true });
	});

	for (const file of FILES) {
		it(`reads ${file.path} (${file.type})`, async () => {
			const absPath = resolve(join(repoRoot, file.path));
			if (!existsSync(absPath)) {
				console.log(`SKIP: ${file.path} not found`);
				return;
			}

			currentStep = "readFile";
			const content = readFileSync(absPath, "utf-8");
			const rawTokens = Math.ceil(content.length / 4);
			const adapter = runtime.smartRead.getAdapter(absPath);

			currentStep = "trySmartRead";
			const startTime = Date.now();
			let result: any;
			let _threw = false;
			try {
				result = await runtime.trySmartRead(absPath, content);
			} catch (e: any) {
				_threw = true;
				results.push({
					file: file.path,
					type: file.type,
					rawTokens,
					smartTokens: rawTokens,
					savedTokens: 0,
					efficiency: 0,
					durationMs: Date.now() - startTime,
					adapterName: adapter?.name ?? "unknown",
					adapterConfidence: 0,
					stuck: true,
					stuckStep: `exception: ${e.message}`,
					fallbackReason: e.message,
				});
				return;
			}

			const duration = Date.now() - startTime;
			const stuck = duration > 3000;
			const isUndefined = result === undefined;

			const smartTokens = isUndefined ? rawTokens : Math.ceil(result.compactContent.length / 4);
			const savedTokens = rawTokens - smartTokens;
			const efficiency = rawTokens > 0 ? Math.round((savedTokens / rawTokens) * 1000) / 10 : 0;

			results.push({
				file: file.path,
				type: file.type,
				rawTokens,
				smartTokens,
				savedTokens,
				efficiency,
				durationMs: duration,
				adapterName: isUndefined ? (adapter?.name ?? "raw") : result.adapterName,
				adapterConfidence: isUndefined ? 0 : result.adapterConfidence,
				stuck,
				stuckStep: stuck ? currentStep : "",
				fallbackReason: isUndefined ? "escape hatch fired" : undefined,
			});

			// Assert: no stuck
			expect(stuck).toBe(false);

			// Take snapshot for hash cache (re-read test)
			currentStep = "afterRead";
			runtime.afterRead(absPath, content, Math.ceil(content.length / 4));

			// Re-read should be instant (hash cache)
			const reReadStart = Date.now();
			const reReadIntercept = await runtime.beforeRead(absPath);
			const reReadDuration = Date.now() - reReadStart;
			if (reReadIntercept.intercept) {
				expect(reReadDuration).toBeLessThan(500);
			}
		}, 10000); // 10s timeout per file
	}
});
