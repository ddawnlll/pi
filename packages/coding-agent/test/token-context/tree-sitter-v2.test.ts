/**
 * P43 Smart Read v2 — Tree-sitter WASM Provider Tests
 *
 * Tests the tree-sitter WASM loader, Python/Rust extractors,
 * provider priority, mutation safety, runtime gates, and preflight.
 *
 * Because CI may not have web-tree-sitter installed, we use a mock
 * loader approach for the provider, and conditional real parsing tests
 * when web-tree-sitter is available.
 *
 * Core safety tests always run regardless of environment.
 */

import { describe, expect, it } from "vitest";
import { PythonAdapter } from "../../src/core/token-context/adapters/python.js";
import { RustAdapter } from "../../src/core/token-context/adapters/rust.js";
import { TreeSitterWasmProvider } from "../../src/core/token-context/providers/tree-sitter-wasm-provider.js";
import { TypeScriptCompilerProvider } from "../../src/core/token-context/providers/typescript-compiler-provider.js";
import { SmartReadCore } from "../../src/core/token-context/smart-read-core.js";
import { SMART_READ_CONFIDENCE } from "../../src/core/token-context/types.js";

// ============================================================================
// Fake loader for deterministic testing
// ============================================================================

function makeFakeNode(
	type: string,
	startRow: number,
	startCol: number,
	endRow: number,
	endCol: number,
	startIdx: number,
	endIdx: number,
	children: any[] = [],
): any {
	return {
		type,
		namedChildren: children,
		startPosition: { row: startRow, column: startCol },
		endPosition: { row: endRow, column: endCol },
		startIndex: startIdx,
		endIndex: endIdx,
	};
}

// ============================================================================
// Test A: Tree-sitter loader does not throw when package missing
// ============================================================================

describe("Tree-sitter WASM loader — fail open", () => {
	it("does not crash when web-tree-sitter is not installed", async () => {
		const provider = new TreeSitterWasmProvider();
		expect(() => provider.isAvailable()).not.toThrow();
		expect(() => provider.getCapabilities()).not.toThrow();
	});

	it("returns fallback result when unavailable", async () => {
		const provider = new TreeSitterWasmProvider();
		// If tree-sitter is actually available, skip the unavailability tests
		if (provider.isAvailable()) return;

		const outlineResult = await provider.outline("test", "test.py");
		expect(outlineResult.isFallback).toBe(true);

		const symbolResult = await provider.symbolExact("test", "test.py", "foo");
		expect(symbolResult.isFallback).toBe(true);
	});

	it("preflight reports tree-sitter availability honestly", async () => {
		const { runSmartReadProviderPreflight } = await import("../../src/core/token-context/grammar-preflight.js");
		const report = runSmartReadProviderPreflight();
		expect(report.providerPlan.python).toBeDefined();
		expect(report.providerPlan.rust).toBeDefined();
		// Primary mentions tree-sitter-wasm when available, or regex fallback when not
		if (report.treeSitterWasmAvailable) {
			expect(report.providerPlan.python.primary).toContain("tree-sitter-wasm");
			expect(report.providerPlan.rust.primary).toContain("tree-sitter-wasm");
			expect(report.providerPlan.python.mutationSafeExact).toBe(true);
			expect(report.providerPlan.rust.mutationSafeExact).toBe(true);
		} else {
			// Preflight must be honest: fallback to regex when tree-sitter unavailable
			expect(report.providerPlan.python.primary).toContain("python-regex-fallback");
			expect(report.providerPlan.rust.primary).toContain("rust-regex-fallback");
			expect(report.providerPlan.python.mutationSafeExact).toBe(false);
			expect(report.providerPlan.rust.mutationSafeExact).toBe(false);
		}
	});

	it("does not recommend cargo/rustup/pip installs", async () => {
		const { runSmartReadProviderPreflight } = await import("../../src/core/token-context/grammar-preflight.js");
		const report = runSmartReadProviderPreflight();
		for (const warning of report.warnings) {
			expect(warning.toLowerCase()).not.toContain("install cargo");
			expect(warning.toLowerCase()).not.toContain("install rustup");
			expect(warning.toLowerCase()).not.toContain("pip install");
		}
		for (const [, entry] of Object.entries(report.providerPlan)) {
			expect(entry.npmOnly).toBe(true);
		}
	});
});

// ============================================================================
// Test B: Provider priority
// ============================================================================

describe("Tree-sitter WASM provider priority", () => {
	it("has priority 80", () => {
		const provider = new TreeSitterWasmProvider();
		expect(provider.priority).toBe(80);
	});

	it("handles .py and .rs extensions", () => {
		const provider = new TreeSitterWasmProvider();
		expect(provider.extensions).toContain(".py");
		expect(provider.extensions).toContain(".rs");
	});

	it("TypeScript compiler has higher priority for .ts files", () => {
		const tsProvider = new TypeScriptCompilerProvider();
		const tsWasmProvider = new TreeSitterWasmProvider();
		expect(tsProvider.priority).toBeGreaterThan(tsWasmProvider.priority);
	});

	it("is selected before regex fallback for Python when available", async () => {
		const core = new SmartReadCore();
		const tsProvider = new TreeSitterWasmProvider();
		core.registerProvider(tsProvider);
		core.registerAdapter(new PythonAdapter());

		const providers = await core.getProviders("test.py");
		if (await tsProvider.isAvailable()) {
			expect(providers.length).toBeGreaterThan(0);
			expect(providers[0].name).toBe("tree-sitter-wasm");
		} else {
			// When tree-sitter is unavailable, getProviders returns empty
			// and smartRead falls back to adapter
			expect(providers.length).toBe(0);
		}
	});

	it("is selected before regex fallback for Rust when available", async () => {
		const core = new SmartReadCore();
		const tsProvider = new TreeSitterWasmProvider();
		core.registerProvider(tsProvider);
		core.registerAdapter(new RustAdapter());

		const providers = await core.getProviders("test.rs");
		if (await tsProvider.isAvailable()) {
			expect(providers.length).toBeGreaterThan(0);
			expect(providers[0].name).toBe("tree-sitter-wasm");
		} else {
			expect(providers.length).toBe(0);
		}
	});

	it("TypeScript compiler is still selected over tree-sitter for .ts", async () => {
		const core = new SmartReadCore();
		core.registerProvider(new TypeScriptCompilerProvider());
		core.registerProvider(new TreeSitterWasmProvider());

		const providers = await core.getProviders("test.ts");
		expect(providers.length).toBeGreaterThan(0);

		const tsCompilerAvailable = providers.some((p) => p.name === "typescript-compiler" && p.isAvailable());

		if (tsCompilerAvailable) {
			expect(providers[0].name).toBe("typescript-compiler");
		}
	});
});

// ============================================================================
// Test C: Mutation safety
// ============================================================================

describe("Tree-sitter mutation safety", () => {
	it("tree-sitter outline is never mutation safe", async () => {
		const provider = new TreeSitterWasmProvider();
		if (!provider.isAvailable()) return;

		const result = await provider.outline("def foo(): pass\n", "test.py");
		expect(result.mutationSafe).toBe(false);
	});

	it("tree-sitter symbols are never mutation safe", async () => {
		const provider = new TreeSitterWasmProvider();
		if (!provider.isAvailable()) return;

		const result = await provider.symbols("def foo(): pass\n", "test.py");
		expect(result.mutationSafe).toBe(false);
	});

	it("tree-sitter range_exact is mutation safe", async () => {
		const provider = new TreeSitterWasmProvider();
		const result = await provider.rangeExact("line1\nline2\nline3\n", "test.py", 1, 2);
		expect(result.mutationSafe).toBe(true);
		expect(result.adapterConfidence).toBe(SMART_READ_CONFIDENCE.RAW);
	});

	it("regex symbol_exact remains mutationSafe=false", async () => {
		const adapter = new PythonAdapter();
		const result = await adapter.symbolExact("def foo(): pass\n", "test.py", "foo");
		expect(result.mutationSafe).toBe(false);
		expect(result.parseSource).toBe("regex_fallback");

		const rustAdapter = new RustAdapter();
		const rustResult = await rustAdapter.symbolExact("fn foo() {}\n", "test.rs", "foo");
		expect(rustResult.mutationSafe).toBe(false);
		expect(rustResult.parseSource).toBe("regex_fallback");
	});

	it("generic symbol_exact remains mutationSafe=false", async () => {
		const { GenericFallbackAdapter } = await import("../../src/core/token-context/adapters/fallback.js");
		const adapter = new GenericFallbackAdapter();
		const result = await adapter.symbolExact("some text foo bar\n", "test.txt", "foo");
		expect(result.mutationSafe).toBe(false);
	});
});

// ============================================================================
// Test D: Python extractor (unit test)
// ============================================================================

describe("Python AST extraction (mocked)", () => {
	it("extractPythonSymbols handles empty content", async () => {
		const { extractPythonSymbols, buildPythonOutline } = await import(
			"../../src/core/token-context/providers/tree-sitter-python-extractor.js"
		);

		const fakeResult = {
			tree: { rootNode: makeFakeNode("module", 0, 0, 0, 0, 0, 0, []) },
			languageId: "python",
			content: "",
		};

		const symbols = extractPythonSymbols(fakeResult);
		expect(Array.isArray(symbols)).toBe(true);
		expect(symbols.length).toBe(0);

		const outline = buildPythonOutline(symbols);
		expect(outline).toBe("No symbols found.");
	});

	it("buildPythonOutline produces expected format", async () => {
		const { buildPythonOutline } = await import(
			"../../src/core/token-context/providers/tree-sitter-python-extractor.js"
		);

		const symbols = [
			{
				name: "User",
				kind: "class",
				languageId: "python",
				startLine: 1,
				endLine: 5,
				startColumn: 0,
				endColumn: 1,
				startOffset: 0,
				endOffset: 100,
				isExported: true,
				fullName: "User",
			},
			{
				name: "display_name",
				kind: "function",
				languageId: "python",
				startLine: 4,
				endLine: 5,
				startColumn: 4,
				endColumn: 1,
				startOffset: 50,
				endOffset: 100,
				containerName: "User",
				fullName: "User.display_name",
				isExported: false,
			},
		];

		const outline = buildPythonOutline(symbols);
		expect(outline).toContain("Symbol Outline:");
		expect(outline).toContain("[class] User");
		expect(outline).toContain("[function] User.display_name");
	});

	it("findPythonSymbol resolves fullName and name", async () => {
		const { findPythonSymbol } = await import(
			"../../src/core/token-context/providers/tree-sitter-python-extractor.js"
		);

		const symbols = [
			{
				name: "User",
				kind: "class",
				languageId: "python",
				startLine: 1,
				endLine: 5,
				startColumn: 0,
				endColumn: 1,
				startOffset: 0,
				endOffset: 100,
				isExported: true,
				fullName: "User",
			},
			{
				name: "display_name",
				kind: "function",
				languageId: "python",
				startLine: 4,
				endLine: 5,
				startColumn: 4,
				endColumn: 1,
				startOffset: 50,
				endOffset: 100,
				containerName: "User",
				fullName: "User.display_name",
				isExported: false,
			},
			{
				name: "fetch_user",
				kind: "function",
				languageId: "python",
				startLine: 7,
				endLine: 8,
				startColumn: 0,
				endColumn: 1,
				startOffset: 200,
				endOffset: 300,
				isExported: true,
				fullName: "fetch_user",
			},
		];

		expect(findPythonSymbol(symbols, "User")?.name).toBe("User");
		expect(findPythonSymbol(symbols, "fetch_user")?.name).toBe("fetch_user");
		expect(findPythonSymbol(symbols, "User.display_name")?.name).toBe("display_name");
		expect(findPythonSymbol(symbols, "display_name")?.name).toBe("display_name");
		expect(findPythonSymbol(symbols, "NonExistent")).toBeUndefined();
	});

	it("pythonSymbolExact validates range", async () => {
		const { pythonSymbolExact } = await import(
			"../../src/core/token-context/providers/tree-sitter-python-extractor.js"
		);

		const content = "class User:\n    pass\n";
		const fakeResult = {
			tree: { rootNode: null },
			languageId: "python",
			content,
		};

		const goodSymbol = {
			name: "User",
			kind: "class",
			languageId: "python",
			startLine: 1,
			endLine: 2,
			startColumn: 0,
			endColumn: 1,
			startOffset: 0,
			endOffset: content.length,
			isExported: true,
			fullName: "User",
		};

		const exact = pythonSymbolExact(fakeResult, goodSymbol);
		expect(exact).toBeDefined();
		expect(exact!.content).toBe(content);
		expect(exact!.startLine).toBe(1);

		const badSymbol = { ...goodSymbol, startOffset: 100, endOffset: 50 };
		expect(pythonSymbolExact(fakeResult, badSymbol)).toBeUndefined();
	});
});

// ============================================================================
// Test E: Rust extractor (unit test)
// ============================================================================

describe("Rust AST extraction (mocked)", () => {
	it("extractRustSymbols handles empty content", async () => {
		const { extractRustSymbols, buildRustOutline } = await import(
			"../../src/core/token-context/providers/tree-sitter-rust-extractor.js"
		);

		const fakeResult = {
			tree: { rootNode: makeFakeNode("source_file", 0, 0, 0, 0, 0, 0, []) },
			languageId: "rust",
			content: "",
		};

		const symbols = extractRustSymbols(fakeResult);
		expect(Array.isArray(symbols)).toBe(true);
		expect(symbols.length).toBe(0);

		const outline = buildRustOutline(symbols);
		expect(outline).toBe("No symbols found.");
	});

	it("buildRustOutline produces expected format", async () => {
		const { buildRustOutline } = await import("../../src/core/token-context/providers/tree-sitter-rust-extractor.js");

		const symbols = [
			{
				name: "User",
				kind: "struct",
				languageId: "rust",
				startLine: 1,
				endLine: 4,
				startColumn: 0,
				endColumn: 1,
				startOffset: 0,
				endOffset: 100,
				isExported: true,
				fullName: "User",
			},
			{
				name: "impl User",
				kind: "impl",
				languageId: "rust",
				startLine: 6,
				endLine: 16,
				startColumn: 0,
				endColumn: 1,
				startOffset: 100,
				endOffset: 500,
				isExported: true,
				fullName: "impl User",
			},
			{
				name: "new",
				kind: "method",
				languageId: "rust",
				startLine: 7,
				endLine: 10,
				startColumn: 4,
				endColumn: 1,
				startOffset: 120,
				endOffset: 250,
				containerName: "User",
				fullName: "User.new",
				isExported: true,
			},
		];

		const outline = buildRustOutline(symbols);
		expect(outline).toContain("Symbol Outline:");
		expect(outline).toContain("[struct] User");
		expect(outline).toContain("[impl] impl User");
		expect(outline).toContain("[method] User.new");
	});

	it("findRustSymbol resolves by fullName and name", async () => {
		const { findRustSymbol } = await import("../../src/core/token-context/providers/tree-sitter-rust-extractor.js");

		const symbols = [
			{
				name: "User",
				kind: "struct",
				languageId: "rust",
				startLine: 1,
				endLine: 4,
				startColumn: 0,
				endColumn: 1,
				startOffset: 0,
				endOffset: 100,
				isExported: true,
				fullName: "User",
			},
			{
				name: "new",
				kind: "method",
				languageId: "rust",
				startLine: 7,
				endLine: 10,
				startColumn: 4,
				endColumn: 1,
				startOffset: 120,
				endOffset: 250,
				containerName: "User",
				fullName: "User.new",
				isExported: true,
			},
		];

		expect(findRustSymbol(symbols, "User")?.name).toBe("User");
		expect(findRustSymbol(symbols, "User.new")?.name).toBe("new");
		expect(findRustSymbol(symbols, "new")?.name).toBe("new");
		expect(findRustSymbol(symbols, "NonExistent")).toBeUndefined();
	});

	it("rustSymbolExact validates range", async () => {
		const { rustSymbolExact } = await import("../../src/core/token-context/providers/tree-sitter-rust-extractor.js");

		const content = "struct User {\n    id: u64,\n}\n";
		const fakeResult = {
			tree: { rootNode: null },
			languageId: "rust",
			content,
		};

		const goodSymbol = {
			name: "User",
			kind: "struct",
			languageId: "rust",
			startLine: 1,
			endLine: 3,
			startColumn: 0,
			endColumn: 1,
			startOffset: 0,
			endOffset: content.length,
			isExported: true,
			fullName: "User",
		};

		const exact = rustSymbolExact(fakeResult, goodSymbol);
		expect(exact).toBeDefined();
		expect(exact!.content).toBe(content);
		expect(exact!.startLine).toBe(1);

		const badSymbol = { ...goodSymbol, startOffset: -1 };
		expect(rustSymbolExact(fakeResult, badSymbol)).toBeUndefined();
	});
});

// ============================================================================
// Test F: TypeScript secondary extractor
// ============================================================================

describe("TypeScript secondary tree-sitter extractor", () => {
	it("extractTypeScriptSymbols handles empty content", async () => {
		const { extractTypeScriptSymbols } = await import(
			"../../src/core/token-context/providers/tree-sitter-typescript-extractor.js"
		);

		const fakeResult = {
			tree: { rootNode: makeFakeNode("program", 0, 0, 0, 0, 0, 0, []) },
			languageId: "typescript",
			content: "",
		};

		const symbols = extractTypeScriptSymbols(fakeResult);
		expect(Array.isArray(symbols)).toBe(true);
		expect(symbols.length).toBe(0);
	});

	it("buildTypeScriptOutline format", async () => {
		const { buildTypeScriptOutline } = await import(
			"../../src/core/token-context/providers/tree-sitter-typescript-extractor.js"
		);

		const symbols = [
			{
				name: "MyClass",
				kind: "class",
				languageId: "typescript",
				startLine: 1,
				endLine: 10,
				startColumn: 0,
				endColumn: 1,
				startOffset: 0,
				endOffset: 200,
				isExported: true,
				fullName: "MyClass",
			},
		];

		const outline = buildTypeScriptOutline(symbols);
		expect(outline).toContain("[class] MyClass");
	});
});

// ============================================================================
// Test G: Preflight integration
// ============================================================================

describe("Tree-sitter preflight integration", () => {
	it("preflight includes python provider plan", async () => {
		const { runSmartReadProviderPreflight } = await import("../../src/core/token-context/grammar-preflight.js");
		const report = runSmartReadProviderPreflight();
		const plan = report.providerPlan;
		expect(plan.python).toBeDefined();
		if (report.treeSitterWasmAvailable) {
			expect(plan.python.primary).toContain("tree-sitter-wasm");
		} else {
			expect(plan.python.primary).toContain("python-regex-fallback");
		}
		expect(plan.python.fallbackChain).toBeDefined();
		expect(plan.python.npmOnly).toBe(true);
	});

	it("preflight includes rust provider plan", async () => {
		const { runSmartReadProviderPreflight } = await import("../../src/core/token-context/grammar-preflight.js");
		const report = runSmartReadProviderPreflight();
		const plan = report.providerPlan;
		expect(plan.rust).toBeDefined();
		if (report.treeSitterWasmAvailable) {
			expect(plan.rust.primary).toContain("tree-sitter-wasm");
		} else {
			expect(plan.rust.primary).toContain("rust-regex-fallback");
		}
		expect(plan.rust.fallbackChain).toBeDefined();
		expect(plan.rust.npmOnly).toBe(true);
	});

	it("mutationSafeExact for python is true when tree-sitter available", async () => {
		const { runSmartReadProviderPreflight } = await import("../../src/core/token-context/grammar-preflight.js");
		const report = runSmartReadProviderPreflight();
		if (report.treeSitterWasmAvailable) {
			expect(report.providerPlan.python.mutationSafeExact).toBe(true);
			expect(report.providerPlan.rust.mutationSafeExact).toBe(true);
		}
	});
});

// ============================================================================
// Test H: Confidence caps
// ============================================================================

describe("Tree-sitter confidence caps", () => {
	it("regex fallback confidence remains <= 0.45", async () => {
		const pythonAdapter = new PythonAdapter();
		const result = await pythonAdapter.outline("def foo(): pass\nclass Bar: pass\n", "test.py");
		expect(result.adapterConfidence).toBeLessThanOrEqual(SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX);

		const rustAdapter = new RustAdapter();
		const rustResult = await rustAdapter.outline("fn foo() {}\n", "test.rs");
		expect(rustResult.adapterConfidence).toBeLessThanOrEqual(SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX);
	});
});

// ============================================================================
// Test I: Runtime gate behavior
// ============================================================================

describe("Runtime tree-sitter acceptance gates", () => {
	it("raw fallback when no provider available", async () => {
		const core = new SmartReadCore();
		const result = await core.smartRead("some content\n", "test.py", "outline");
		expect(result.mode).toBe("raw");
		expect(result.mutationSafe).toBe(true);
		expect(result.isFallback).toBe(true);
	});

	it("provider plan available when tree-sitter registered", async () => {
		const core = new SmartReadCore();
		core.registerProvider(new TreeSitterWasmProvider());

		const plan = await core.getProviderPlan("test.py");
		expect(plan.extension).toBe(".py");
		expect(plan.providers.length).toBeGreaterThan(0);
		const tsProvider = plan.providers.find((p) => p.name === "tree-sitter-wasm");
		expect(tsProvider).toBeDefined();
		expect(tsProvider!.parseSource).toBe("tree_sitter_wasm");
	});
});

// ============================================================================
// Test J: Tree-sitter WASM loader abstraction
// ============================================================================

describe("Tree-sitter WASM loader abstraction", () => {
	it("exports the loader module", async () => {
		const { treeSitterWasmLoader } = await import(
			"../../src/core/token-context/providers/tree-sitter-wasm-loader.js"
		);
		expect(treeSitterWasmLoader).toBeDefined();
		expect(() => treeSitterWasmLoader.isAvailable()).not.toThrow();
	});

	it("getLanguageForExtension maps extensions correctly", async () => {
		const { treeSitterWasmLoader } = await import(
			"../../src/core/token-context/providers/tree-sitter-wasm-loader.js"
		);
		expect(treeSitterWasmLoader.getLanguageForExtension(".py")).toBe("python");
		expect(treeSitterWasmLoader.getLanguageForExtension(".rs")).toBe("rust");
		expect(treeSitterWasmLoader.getLanguageForExtension(".ts")).toBe("typescript");
		expect(treeSitterWasmLoader.getLanguageForExtension(".js")).toBe("javascript");
		expect(treeSitterWasmLoader.getLanguageForExtension(".pyw")).toBe("python");
	});

	it("getGrammarConfig returns config for known languages", async () => {
		const { treeSitterWasmLoader } = await import(
			"../../src/core/token-context/providers/tree-sitter-wasm-loader.js"
		);
		const pyConfig = treeSitterWasmLoader.getGrammarConfig("python");
		expect(pyConfig).toBeDefined();
		expect(pyConfig!.languageId).toBe("python");
		expect(pyConfig!.extensions).toContain(".py");

		const rustConfig = treeSitterWasmLoader.getGrammarConfig("rust");
		expect(rustConfig).toBeDefined();
		expect(rustConfig!.languageId).toBe("rust");
		expect(rustConfig!.extensions).toContain(".rs");
	});

	it("validateExactRange catches invalid ranges", async () => {
		const { validateExactRange } = await import("../../src/core/token-context/providers/tree-sitter-wasm-loader.js");

		const content = "hello world\n";

		expect(
			validateExactRange({ startLine: 1, endLine: 1, startOffset: 0, endOffset: content.length }, content),
		).toBeNull();

		expect(validateExactRange({ startLine: 1, endLine: 1, startOffset: -1, endOffset: 5 }, content)).not.toBeNull();

		expect(validateExactRange({ startLine: 1, endLine: 1, startOffset: 10, endOffset: 5 }, content)).not.toBeNull();

		expect(validateExactRange({ startLine: 1, endLine: 1, startOffset: 0, endOffset: 999 }, content)).not.toBeNull();
	});

	it("nodeToExactRange returns 1-based lines", async () => {
		const { nodeToExactRange } = await import("../../src/core/token-context/providers/tree-sitter-wasm-loader.js");

		const fakeNode = {
			startPosition: { row: 0, column: 0 },
			endPosition: { row: 4, column: 10 },
			startIndex: 0,
			endIndex: 100,
		};

		const range = nodeToExactRange(fakeNode);
		expect(range.startLine).toBe(1);
		expect(range.endLine).toBe(5);
		expect(range.startOffset).toBe(0);
		expect(range.endOffset).toBe(100);
	});
});

// ============================================================================
// Test K: Tree-sitter fallthrough with mock loader
// ============================================================================

describe("Tree-sitter WASM fallthrough with mock loader", () => {
	it("provider with mock loader returns fallback when parse fails", async () => {
		const mockLoader = {
			isAvailable: () => true,
			isAvailableAsync: async () => true,
			getAvailableLanguages: async () => ["python"],
			getLanguageForExtension: (_ext: string) => "python",
			getGrammarConfig: (_lang: string) => ({
				languageId: "python",
				extensions: [".py"],
				wasmCandidates: [],
			}),
			parse: async () => undefined,
			reset: () => {},
			isInitialized: () => false,
			setModule: (_mod: any) => {},
		};

		const provider = new TreeSitterWasmProvider({ loader: mockLoader as any });
		expect(provider.isAvailable()).toBe(true);

		const result = await provider.outline("def foo():\n    pass\n", "test.py");
		expect(result.isFallback).toBe(true);
		expect(result.fallbackError).toContain("parse failed");
	});

	it("provider capabilities reflect mock availability", () => {
		const mockLoader = {
			isAvailable: () => true,
			isAvailableAsync: async () => true,
			getAvailableLanguages: async () => ["python"],
			getLanguageForExtension: (_ext: string) => "python",
			getGrammarConfig: (_lang: string) => null,
			parse: async () => undefined,
			reset: () => {},
			isInitialized: () => false,
			setModule: (_mod: any) => {},
		};

		const provider = new TreeSitterWasmProvider({ loader: mockLoader as any });
		const caps = provider.getCapabilities();
		expect(caps.outline).toBe(true);
		expect(caps.astBacked).toBe(true);
		expect(caps.mutationSafeExact).toBe(true);
		expect(caps.semantic).toBe(false);
	});
});
