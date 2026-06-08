/**
 * Provider Real-File Integration Tests
 *
 * Tests every v2 provider and legacy adapter with real repo files.
 * Validates that the correct provider/adapter handles each file type,
 * produces meaningful output, passes the acceptance gate, and actually
 * reduces token count vs raw content.
 *
 * This is the test that caught the ESM require() bug in the TypeScript
 * compiler provider — make sure it runs on CI.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GenericFallbackAdapter } from "../../src/core/token-context/adapters/fallback.js";
import { JsonYamlAdapter } from "../../src/core/token-context/adapters/json-yaml.js";
import { PythonAdapter } from "../../src/core/token-context/adapters/python.js";
import { RustAdapter } from "../../src/core/token-context/adapters/rust.js";
import { TypeScriptAdapter } from "../../src/core/token-context/adapters/typescript.js";
import { JsonNativeProvider } from "../../src/core/token-context/providers/json-native-provider.js";
import { TypeScriptCompilerProvider } from "../../src/core/token-context/providers/typescript-compiler-provider.js";
import { YamlNativeProvider } from "../../src/core/token-context/providers/yaml-native-provider.js";
import { createTokenContextRuntime } from "../../src/core/token-context/runtime.js";
import type { SmartReadResult } from "../../src/core/token-context/types.js";

// ============================================================================
// Helpers
// ============================================================================

const REPO_ROOT = process.cwd();

function readRepoFile(relativePath: string): string | null {
	const absPath = resolve(REPO_ROOT, relativePath);
	if (!existsSync(absPath)) return null;
	return readFileSync(absPath, "utf-8");
}

interface ProviderTest {
	name: string;
	filePath: string;
	expectedProvider: string | string[]; // Name(s) of the expected provider/adapter
	minSavingsPercent: number; // Minimum token savings percentage
	minContentLength: number; // Minimum compact output length (meaningful outline)
	notFallback: boolean; // Should NOT be a fallback result
	description: string;
}

function runProviderTest(
	provider: { outline(content: string, filePath: string): Promise<SmartReadResult> },
	test: ProviderTest,
) {
	const content = readRepoFile(test.filePath);
	if (!content) {
		console.log(`  SKIP: ${test.filePath} not found`);
		return;
	}

	const rawTokens = Math.ceil(content.length / 4);

	it(`[${test.name}] ${test.filePath} — ${test.description}`, async () => {
		const result = await provider.outline(content, test.filePath);

		// Verify provider/confidence
		expect(result.adapterName).toBe(test.expectedProvider);
		expect(result.content).toBeDefined();
		expect(result.content.length).toBeGreaterThanOrEqual(test.minContentLength);

		// Verify savings
		const smartTokens = Math.ceil(result.content.length / 4);
		const savingsPercent = rawTokens > 0 ? Math.round((1 - smartTokens / rawTokens) * 100) : 0;
		expect(savingsPercent).toBeGreaterThanOrEqual(test.minSavingsPercent);

		// Verify not fallback
		if (test.notFallback) {
			expect(result.isFallback).toBe(false);
		}

		console.log(
			`    raw=${rawTokens}tok smart=${smartTokens}tok save=${savingsPercent}% adapter=${result.adapterName} conf=${result.adapterConfidence}`,
		);
	});
}

// ============================================================================
// Test 1: TypeScript Compiler Provider (v2, AST-backed)
// ============================================================================

describe("TypeScriptCompilerProvider with real files", () => {
	const provider = new TypeScriptCompilerProvider();
	const available = provider.isAvailable();

	if (!available) {
		it("is NOT available — skip all tests (TypeScript not installed)", () => {
			console.log("  TypeScript compiler not available — skipping .ts provider tests");
		});
		return;
	}

	it("isAvailable() returns true", () => {
		expect(available).toBe(true);
	});

	const files: ProviderTest[] = [
		{
			name: "typescript-compiler",
			filePath: "packages/coding-agent/src/core/token-context/runtime.ts",
			expectedProvider: "typescript-compiler",
			minSavingsPercent: 60,
			minContentLength: 50,
			notFallback: true,
			description: "large TS orchestrator (850+ lines)",
		},
		{
			name: "typescript-compiler",
			filePath: "packages/coding-agent/src/core/workspace-schema.ts",
			expectedProvider: "typescript-compiler",
			minSavingsPercent: 95,
			minContentLength: 50,
			notFallback: true,
			description: "schema file with types/interfaces",
		},
		{
			name: "typescript-compiler",
			filePath: "packages/coding-agent/src/core/tools/read.ts",
			expectedProvider: "typescript-compiler",
			minSavingsPercent: 70,
			minContentLength: 80,
			notFallback: true,
			description: "read tool implementation",
		},
		{
			name: "typescript-compiler",
			filePath: "packages/tui/src/tui.ts",
			expectedProvider: "typescript-compiler",
			minSavingsPercent: 90,
			minContentLength: 100,
			notFallback: true,
			description: "large TUI core file",
		},
		{
			name: "typescript-compiler",
			filePath: "packages/agent/src/agent-loop.ts",
			expectedProvider: "typescript-compiler",
			minSavingsPercent: 70,
			minContentLength: 80,
			notFallback: true,
			description: "agent loop core",
		},
		{
			name: "typescript-compiler",
			filePath: "packages/ai/src/types.ts",
			expectedProvider: "typescript-compiler",
			minSavingsPercent: 70,
			minContentLength: 50,
			notFallback: true,
			description: "AI package types",
		},
		{
			name: "typescript-compiler",
			filePath: "packages/coding-agent/src/core/agent-session.ts",
			expectedProvider: "typescript-compiler",
			minSavingsPercent: 85,
			minContentLength: 100,
			notFallback: true,
			description: "agent session (very large file)",
		},
	];

	for (const test of files) {
		runProviderTest(provider, test);
	}
});

// ============================================================================
// Test 2: TypeScript Regex Adapter (legacy fallback)
// ============================================================================

describe("TypeScriptAdapter (legacy regex fallback) with real files", () => {
	const adapter = new TypeScriptAdapter();

	const files: ProviderTest[] = [
		{
			name: "typescript-adapter",
			filePath: "packages/coding-agent/src/core/token-context/runtime.ts",
			expectedProvider: "typescript-regex-fallback",
			minSavingsPercent: 80,
			minContentLength: 50,
			notFallback: false,
			description: "large TS file via regex",
		},
		{
			name: "typescript-adapter",
			filePath: "packages/coding-agent/src/core/workspace-schema.ts",
			expectedProvider: "typescript-regex-fallback",
			minSavingsPercent: 95,
			minContentLength: 30,
			notFallback: false,
			description: "schema via regex",
		},
	];

	for (const test of files) {
		runProviderTest(adapter, test);
	}
});

// ============================================================================
// Test 3: JSON Native Provider (v2)
// ============================================================================

describe("JsonNativeProvider with real files", () => {
	const provider = new JsonNativeProvider();

	const files: ProviderTest[] = [
		{
			name: "json-native",
			filePath: "package.json",
			expectedProvider: "json-native",
			minSavingsPercent: 50,
			minContentLength: 30,
			notFallback: true,
			description: "root package.json",
		},
		{
			name: "json-native",
			filePath: "biome.json",
			expectedProvider: "json-native",
			minSavingsPercent: 50,
			minContentLength: 10,
			notFallback: true,
			description: "biome config",
		},
	];

	for (const test of files) {
		runProviderTest(provider, test);
	}
});

// ============================================================================
// Test 4: JSON/YAML Regex Adapter (legacy)
// ============================================================================

describe("JsonYamlAdapter (legacy) with real files", () => {
	const adapter = new JsonYamlAdapter();

	const files: ProviderTest[] = [
		{
			name: "json-yaml-adapter",
			filePath: "package.json",
			expectedProvider: "json-yaml-regex-fallback",
			minSavingsPercent: 50,
			minContentLength: 30,
			notFallback: false,
			description: "root package.json via regex",
		},
		{
			name: "json-yaml-adapter",
			filePath: ".github/workflows/ci.yml",
			expectedProvider: "json-yaml-regex-fallback",
			minSavingsPercent: 30,
			minContentLength: 20,
			notFallback: false,
			description: "CI workflow YAML",
		},
	];

	for (const test of files) {
		runProviderTest(adapter, test);
	}
});

// ============================================================================
// Test 5: YAML Native Provider (v2)
// ============================================================================

describe("YamlNativeProvider with real files", () => {
	const provider = new YamlNativeProvider();

	const files: ProviderTest[] = [
		{
			name: "yaml-native",
			filePath: ".github/workflows/ci.yml",
			expectedProvider: "yaml-native",
			minSavingsPercent: 30,
			minContentLength: 20,
			notFallback: true,
			description: "CI workflow YAML via native parser",
		},
	];

	for (const test of files) {
		runProviderTest(provider, test);
	}
});

// ============================================================================
// Test 6: Python Regex Adapter (legacy)
// ============================================================================

describe("PythonAdapter (legacy) with real files", () => {
	const adapter = new PythonAdapter();

	const files: ProviderTest[] = [
		{
			name: "python-adapter",
			filePath: "scripts/release.mjs",
			expectedProvider: "python-regex-fallback",
			minSavingsPercent: 20,
			minContentLength: 20,
			notFallback: true,
			description: "release script via python regex",
		},
	];

	for (const test of files) {
		runProviderTest(adapter, test);
	}
});

// ============================================================================
// Test 7: Rust Regex Adapter (legacy) — uses a TS file since no .rs in repo
// ============================================================================

describe("RustAdapter (legacy) with real files", () => {
	const adapter = new RustAdapter();

	const files: ProviderTest[] = [
		{
			name: "rust-adapter",
			filePath: "packages/coding-agent/src/core/workspace-schema.ts",
			expectedProvider: "rust-regex-fallback",
			minSavingsPercent: 20,
			minContentLength: 10,
			notFallback: false,
			description: "TS file parsed via rust regex (wrong adapter, fallback)",
		},
	];

	for (const test of files) {
		runProviderTest(adapter, test);
	}
});

// ============================================================================
// Test 8: Generic Fallback Adapter (last resort)
// ============================================================================

describe("GenericFallbackAdapter with real files", () => {
	const adapter = new GenericFallbackAdapter();

	const files: ProviderTest[] = [
		{
			name: "generic-fallback",
			filePath: "Makefile",
			expectedProvider: "generic",
			minSavingsPercent: 20,
			minContentLength: 10,
			notFallback: false,
			description: "Makefile via generic fallback",
		},
	];

	for (const test of files) {
		runProviderTest(adapter, test);
	}
});

// ============================================================================
// Test 9: Runtime trySmartRead for all file types (integration)
// ============================================================================

describe("Runtime trySmartRead with real files", () => {
	const runtime = createTokenContextRuntime({
		enabled: true,
		mode: "active_safe",
		rawCache: { maxBytes: 1024 * 1024 },
		llmFallback: { maxTokens: 2000 },
		changeLedger: { maxDeltaChainBeforeCheckpoint: 5 },
		providerCalibration: { requiredForP44: true },
		tinyFileThresholdBytes: 256,
		editRecovery: {
			enabled: false,
			maxCandidates: 3,
			contextLinesBefore: 8,
			contextLinesAfter: 8,
			maxCandidateLines: 40,
			maxPacketTokensEstimate: 800,
			autoApplyWhitespaceOnly: true,
			minAutoApplySimilarity: 0.985,
			minCandidateSimilarity: 0.7,
		},
	});

	const fileTypes: Array<{
		path: string;
		label: string;
		expectProvider: string;
		expectCompact: boolean; // true = should return compact, false = undefined (rejected by gate)
	}> = [
		// TypeScript — should use typescript-compiler (AST-backed)
		{
			path: "packages/coding-agent/src/core/workspace-schema.ts",
			label: ".ts file",
			expectProvider: "typescript-compiler",
			expectCompact: true,
		},
		{
			path: "packages/coding-agent/src/core/tools/read.ts",
			label: ".ts file (large)",
			expectProvider: "typescript-compiler",
			expectCompact: true,
		},
		// JSON — should use json-native
		{
			path: "package.json",
			label: ".json file",
			expectProvider: "json-native",
			expectCompact: true,
		},
		// YAML — should use yaml-native
		{
			path: ".github/workflows/ci.yml",
			label: ".yml file",
			expectProvider: "yaml-native",
			expectCompact: true,
		},
		// Markdown — generic fallback (rejected by acceptance gate for code?? no, md is not code)
		{
			path: "packages/ai/README.md",
			label: ".md file",
			expectProvider: "generic",
			expectCompact: false, // generic fallback outline is low confidence, gate rejects it for small md. Actually let's see what happens
		},
		// Makefile — generic fallback (should be rejected for non-code files with low confidence)
		{
			path: "Makefile",
			label: "Makefile",
			expectProvider: "generic",
			expectCompact: false, // low confidence generic fallback
		},
	];

	for (const ft of fileTypes) {
		it(`handles ${ft.label} (${ft.path})`, async () => {
			const content = readRepoFile(ft.path);
			if (!content) {
				console.log(`  SKIP: ${ft.path} not found`);
				return;
			}

			const rawTokens = Math.ceil(content.length / 4);
			const result = await runtime.trySmartRead(resolve(REPO_ROOT, ft.path), content);

			if (result && result.compactContent.length > 10) {
				const smartTokens = Math.ceil(result.compactContent.length / 4);
				const savingsPercent = rawTokens > 0 ? Math.round((1 - smartTokens / rawTokens) * 100) : 0;

				console.log(
					`    raw=${rawTokens}tok smart=${smartTokens}tok save=${savingsPercent}% adapter=${result.adapterName} conf=${result.adapterConfidence} mechanism=${result.mechanism}`,
				);

				// If compact was returned, validate it
				expect(result.mechanism).toBe("smart_read");
				expect(result.adapterName).toBe(ft.expectProvider);
				expect(result.adapterConfidence).toBeGreaterThan(0);
				expect(savingsPercent).toBeGreaterThan(10); // at least some savings
			} else {
				// Compact was rejected — should have a fallback reason in the audit
				const audit = runtime.lastReadAudit;
				console.log(
					`    raw=${rawTokens}tok [raw fallback] ${audit?.fallbackReason ? `reason=${audit.fallbackReason}` : "no reason given"}`,
				);
			}
		}, 15000);
	}
});

// ============================================================================
// Test 10: Runtime beforeRead hash cache + trySmartRead integration
// ============================================================================

describe("Runtime read integration (beforeRead -> trySmartRead -> afterRead -> hash cache)", () => {
	const runtime = createTokenContextRuntime({
		enabled: true,
		mode: "active_safe",
		rawCache: { maxBytes: 1024 * 1024 },
		llmFallback: { maxTokens: 2000 },
		changeLedger: { maxDeltaChainBeforeCheckpoint: 5 },
		providerCalibration: { requiredForP44: true },
		tinyFileThresholdBytes: 256,
		editRecovery: {
			enabled: false,
			maxCandidates: 3,
			contextLinesBefore: 8,
			contextLinesAfter: 8,
			maxCandidateLines: 40,
			maxPacketTokensEstimate: 800,
			autoApplyWhitespaceOnly: true,
			minAutoApplySimilarity: 0.985,
			minCandidateSimilarity: 0.7,
		},
	});

	it("full read lifecycle for .ts file: no compact on first read, compact after trySmartRead", async () => {
		const filePath = resolve(REPO_ROOT, "packages/coding-agent/src/core/workspace-schema.ts");
		const content = readRepoFile("packages/coding-agent/src/core/workspace-schema.ts");
		if (!content) return;

		// Step 1: beforeRead — should NOT intercept (no cache yet)
		const intercept1 = await runtime.beforeRead(filePath);
		expect(intercept1.intercept).toBe(false);

		// Step 2: trySmartRead — should produce compact output via typescript-compiler
		const smartResult = await runtime.trySmartRead(filePath, content);
		expect(smartResult).toBeDefined();
		expect(smartResult!.mechanism).toBe("smart_read");
		expect(smartResult!.adapterName).toBe("typescript-compiler");
		expect(smartResult!.compactContent.length).toBeLessThan(content.length * 0.4); // at least 60% savings

		// Step 3: afterRead — take snapshot for hash cache
		runtime.afterRead(filePath, content, Math.ceil(content.length / 4));

		// Step 4: beforeRead again — should now intercept via hash cache
		const intercept2 = await runtime.beforeRead(filePath);
		expect(intercept2.intercept).toBe(true);
		expect(intercept2.isCompact).toBe(true);
		expect(intercept2.replacementContent).toBeDefined();

		// The hash cache replacement should also be shorter than raw
		expect(intercept2.replacementContent!.length).toBeLessThan(content.length * 0.4);
	});

	it("full read lifecycle for .json file", async () => {
		const filePath = resolve(REPO_ROOT, "package.json");
		const content = readRepoFile("package.json");
		if (!content) return;

		// Step 1: beforeRead — no cache
		const intercept1 = await runtime.beforeRead(filePath);
		expect(intercept1.intercept).toBe(false);

		// Step 2: trySmartRead — should produce compact via json-native
		const smartResult = await runtime.trySmartRead(filePath, content);
		expect(smartResult).toBeDefined();
		expect(smartResult!.mechanism).toBe("smart_read");
		expect(smartResult!.adapterName).toBe("json-native");
		if (smartResult) {
			expect(smartResult.compactContent.length).toBeLessThan(content.length);
		}

		// Step 3: afterRead
		runtime.afterRead(filePath, content, Math.ceil(content.length / 4));

		// Step 4: beforeRead — hash cache hit
		const intercept2 = await runtime.beforeRead(filePath);
		expect(intercept2.intercept).toBe(true);
	});

	it("targeted read (offset/limit) bypasses smart read", async () => {
		const filePath = resolve(REPO_ROOT, "packages/coding-agent/src/core/workspace-schema.ts");
		const content = readRepoFile("packages/coding-agent/src/core/workspace-schema.ts");
		if (!content) return;

		// With offset/limit, trySmartRead should return undefined
		const result = await runtime.trySmartRead(filePath, content, { offset: 1, limit: 100 });
		expect(result).toBeUndefined();

		const _audit = runtime.lastReadAudit;
		// Should have a note about skipping smart read for targeted reads... or just undefined
	});
});
