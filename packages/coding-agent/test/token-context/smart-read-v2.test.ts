/**
 * P43 Smart Read v2 Tests
 *
 * Tests provider selection, confidence caps, mutation safety,
 * runtime acceptance gates, and provider plan.
 */

import { describe, expect, it } from "vitest";
import { GenericFallbackAdapter } from "../../src/core/token-context/adapters/fallback.js";
import { JsonYamlAdapter } from "../../src/core/token-context/adapters/json-yaml.js";
import { PythonAdapter } from "../../src/core/token-context/adapters/python.js";
import { RustAdapter } from "../../src/core/token-context/adapters/rust.js";
import { TypeScriptAdapter } from "../../src/core/token-context/adapters/typescript.js";
import { JsonNativeProvider } from "../../src/core/token-context/providers/json-native-provider.js";
import { PyrightProvider } from "../../src/core/token-context/providers/pyright-provider.js";
import { TreeSitterWasmProvider } from "../../src/core/token-context/providers/tree-sitter-wasm-provider.js";
import { TypeScriptCompilerProvider } from "../../src/core/token-context/providers/typescript-compiler-provider.js";
import { YamlNativeProvider } from "../../src/core/token-context/providers/yaml-native-provider.js";
import { createTokenContextRuntime } from "../../src/core/token-context/runtime.js";
import { SmartReadCore } from "../../src/core/token-context/smart-read-core.js";
import {
	DEFAULT_TOKEN_CONTEXT_CONFIG,
	isMutationSafeSmartReadResult,
	SMART_READ_CONFIDENCE,
	type SmartReadResult,
	withProviderTimeout,
} from "../../src/core/token-context/types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeConfig(overrides?: Partial<typeof DEFAULT_TOKEN_CONTEXT_CONFIG>) {
	return { ...DEFAULT_TOKEN_CONTEXT_CONFIG, ...overrides, enabled: true, mode: "active_safe" as const };
}

// ============================================================================
// Test 1: TypeScript provider detects multiline function
// ============================================================================

describe("TypeScript compiler provider", () => {
	it("detects multiline async function with exact range", async () => {
		const provider = new TypeScriptCompilerProvider();
		if (!provider.isAvailable()) return; // Skip if typescript not available

		const content = `import { something } from "./something.js";

export async function createRuntime(
	config: TokenContextConfig,
	options?: RuntimeOptions,
): Promise<TokenContextRuntime> {
	return buildRuntime(config, options);
}

function otherFunction() {
	return 42;
}
`;

		const result = await provider.symbolExact(content, "test.ts", "createRuntime");
		expect(result.mode).toBe("symbol_exact");
		expect(result.parseSource).toBe("typescript_compiler");
		expect(result.exactRange).toBeDefined();
		expect(result.mutationSafe).toBe(true);
		expect(result.adapterConfidence).toBeGreaterThanOrEqual(0.9);
		expect(result.isFallback).toBe(false);
		// Should not include otherFunction
		expect(result.content).not.toContain("otherFunction");
	});

	it("detects class methods with container name", async () => {
		const provider = new TypeScriptCompilerProvider();
		if (!provider.isAvailable()) return;

		const content = `export class SmartReadCore {
	registerProvider(provider: SmartReadProvider): void {
		this.providers.push(provider);
	}

	async smartRead(
		content: string,
		filePath: string,
		mode: SmartReadMode,
	): Promise<SmartReadResult> {
		return this.rawFallback(content, "no provider");
	}
}
`;

		const symbolsResult = await provider.symbols(content, "test.ts");
		expect(symbolsResult.content).toContain("class SmartReadCore");
		expect(symbolsResult.content).toContain("registerProvider");
		expect(symbolsResult.content).toContain("smartRead");
	});

	it("exact range does not include next function", async () => {
		const provider = new TypeScriptCompilerProvider();
		if (!provider.isAvailable()) return;

		const content = `export function target() {
	return "hello";
}

export function nextFunction() {
	return "world";
}
`;

		const result = await provider.symbolExact(content, "test.ts", "target");
		expect(result.exactRange).toBeDefined();
		if (result.exactRange) {
			expect(result.exactRange.endLine).toBeLessThanOrEqual(4);
		}
		expect(result.content).toContain("target");
		expect(result.content).not.toContain("nextFunction");
	});
});

// ============================================================================
// Test 4: Regex fallback confidence cap
// ============================================================================

describe("regex fallback confidence caps", () => {
	it("typescript regex fallback confidence <= 0.45", async () => {
		const adapter = new TypeScriptAdapter();
		const result = await adapter.outline("const x = 1;\nfunction foo() {}\n", "test.ts");
		expect(result.adapterConfidence).toBeLessThanOrEqual(SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX);
		expect(result.parseSource).toBe("regex_fallback");
		expect(result.isFallback).toBe(true);
	});

	it("python regex fallback confidence <= 0.45", async () => {
		const adapter = new PythonAdapter();
		const result = await adapter.outline("def foo(): pass\n", "test.py");
		expect(result.adapterConfidence).toBeLessThanOrEqual(SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX);
		expect(result.parseSource).toBe("regex_fallback");
	});

	it("rust regex fallback confidence <= 0.45", async () => {
		const adapter = new RustAdapter();
		const result = await adapter.outline("fn foo() {}\n", "test.rs");
		expect(result.adapterConfidence).toBeLessThanOrEqual(SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX);
		expect(result.parseSource).toBe("regex_fallback");
	});

	it("json-yaml regex fallback confidence <= 0.45", async () => {
		const adapter = new JsonYamlAdapter();
		const result = await adapter.outline('{"key": "value"}', "test.json");
		expect(result.adapterConfidence).toBeLessThanOrEqual(SMART_READ_CONFIDENCE.REGEX_FALLBACK_MAX);
		expect(result.parseSource).toBe("regex_fallback");
	});
});

// ============================================================================
// Test 5: Regex symbol exact never mutation safe
// ============================================================================

describe("regex symbol exact mutation safety", () => {
	it("typescript regex symbol_exact mutationSafe=false", async () => {
		const adapter = new TypeScriptAdapter();
		const content = `function foo() { return 1; }\nfunction bar() { return 2; }\n`;
		const result = await adapter.symbolExact(content, "test.ts", "foo");
		expect(result.mode).toBe("symbol_exact");
		expect(result.mutationSafe).toBe(false);
		expect(result.parseSource).toBe("regex_fallback");
	});

	it("python regex symbol_exact mutationSafe=false", async () => {
		const adapter = new PythonAdapter();
		const result = await adapter.symbolExact("def foo(): pass\n", "test.py", "foo");
		expect(result.mutationSafe).toBe(false);
	});

	it("rust regex symbol_exact mutationSafe=false", async () => {
		const adapter = new RustAdapter();
		const result = await adapter.symbolExact("fn foo() {}\n", "test.rs", "foo");
		expect(result.mutationSafe).toBe(false);
	});
});

// ============================================================================
// Test 6: Range exact still mutation safe
// ============================================================================

describe("range exact mutation safety", () => {
	it("typescript adapter range_exact mutationSafe=true", async () => {
		const adapter = new TypeScriptAdapter();
		const result = await adapter.rangeExact("line1\nline2\nline3\n", "test.ts", 1, 2);
		expect(result.mode).toBe("range_exact");
		expect(result.mutationSafe).toBe(true);
		expect(result.adapterConfidence).toBe(1.0);
	});

	it("generic fallback range_exact mutationSafe=true", async () => {
		const adapter = new GenericFallbackAdapter();
		const result = await adapter.rangeExact("line1\nline2\nline3\n", "test.txt", 1, 2);
		expect(result.mutationSafe).toBe(true);
		expect(result.adapterConfidence).toBe(1.0);
	});

	it("python regex range_exact mutationSafe=true", async () => {
		const adapter = new PythonAdapter();
		const result = await adapter.rangeExact("line1\nline2\n", "test.py", 1, 2);
		expect(result.mutationSafe).toBe(true);
	});
});

// ============================================================================
// Test 7: Runtime rejects regex compact for code
// ============================================================================

describe("runtime rejects regex compact for code", () => {
	it("trySmartRead returns undefined when only regex available for code file", async () => {
		const tsProvider = new TypeScriptCompilerProvider();
		if (tsProvider.isAvailable()) return; // Skip if TS compiler available (need regex-only path)

		const config = makeConfig();
		const runtime = createTokenContextRuntime(config);

		const content = "function foo() { return 1; }\nfunction bar() { return 2; }\n";
		const result = await runtime.trySmartRead("test.ts", content);
		// When TS compiler is unavailable, regex fallback is rejected for code files
		expect(result).toBeUndefined();
		const audit = runtime.lastReadAudit;
		expect(audit?.fallbackReason).toBeDefined();
	});
});

// ============================================================================
// Test 8: Runtime accepts TypeScript compiler compact
// ============================================================================

describe("runtime accepts typescript compiler compact", () => {
	it("trySmartRead accepts typescript compiler outline", async () => {
		const provider = new TypeScriptCompilerProvider();
		if (!provider.isAvailable()) return;

		const config = makeConfig();
		const runtime = createTokenContextRuntime(config);

		const content = `export class TestClass {
	method1() { return 1; }
	method2() { return 2; }
}
`;
		const result = await runtime.trySmartRead("test.ts", content);
		// Should be accepted if TS compiler is available
		if (result) {
			expect(result.mechanism).toBe("smart_read");
			expect(result.adapterName).toBe("typescript-compiler");
			expect(result.adapterConfidence).toBeGreaterThanOrEqual(0.75);
		}
	});
});

// ============================================================================
// Test 9: Missing tree-sitter fails open
// ============================================================================

describe("tree-sitter WASM fails open", () => {
	it("missing packages do not crash", async () => {
		const provider = new TreeSitterWasmProvider();
		// Should not throw even though web-tree-sitter may not be installed
		expect(() => provider.isAvailable()).not.toThrow();
	});

	it("preflight reports tree-sitter availability", async () => {
		const { runSmartReadProviderPreflight } = await import("../../src/core/token-context/grammar-preflight.js");
		const providerReport = runSmartReadProviderPreflight();
		expect(providerReport.treeSitterWasmAvailable).toBeDefined();
	});
});

// ============================================================================
// Test 10: JSON nested path exact read
// ============================================================================

describe("JSON native provider", () => {
	it("extracts nested path", async () => {
		const provider = new JsonNativeProvider();
		if (!provider.isAvailable()) return;

		const content = JSON.stringify(
			{
				compilerOptions: {
					paths: {
						"@/*": ["src/*"],
					},
				},
			},
			null,
			2,
		);
		const result = await provider.symbolExact(content, "test.json", "compilerOptions");
		expect(result.mode).toBe("symbol_exact");
		expect(result.parseSource).toBe("native_parser");
		if (result.exactRange) {
			expect(result.mutationSafe).toBe(true);
		}
	});
});

// ============================================================================
// Test 11: YAML exact range safety
// ============================================================================

describe("YAML native provider", () => {
	it("provides outline for YAML content", async () => {
		const provider = new YamlNativeProvider();
		if (!provider.isAvailable()) return;

		const content = "name: test\nversion: 1.0\n";
		const result = await provider.outline(content, "test.yaml");
		expect(result.mode).toBe("outline");
		expect(result.parseSource).toBe("native_parser");
	});

	it("symbol_exact may not have exact range for unknown paths", async () => {
		const provider = new YamlNativeProvider();
		if (!provider.isAvailable()) return;

		const result = await provider.symbolExact("name: test\n", "test.yaml", "nonexistent");
		expect(result.isFallback).toBe(true);
		expect(result.mutationSafe).toBe(false);
	});
});

// ============================================================================
// Test 12: Preflight provider plan
// ============================================================================

describe("preflight provider plan", () => {
	it("includes all expected languages", async () => {
		const { runSmartReadProviderPreflight } = await import("../../src/core/token-context/grammar-preflight.js");
		const providerReport = runSmartReadProviderPreflight();
		const plan = providerReport.providerPlan;
		expect(plan.typescript).toBeDefined();
		expect(plan.javascript).toBeDefined();
		expect(plan.python).toBeDefined();
		expect(plan.rust).toBeDefined();
		expect(plan.json).toBeDefined();
		expect(plan.yaml).toBeDefined();
		expect(plan.generic).toBeDefined();
	});

	it("rust plan warns about rust-analyzer", async () => {
		const { runSmartReadProviderPreflight } = await import("../../src/core/token-context/grammar-preflight.js");
		const providerReport = runSmartReadProviderPreflight();
		const rustPlan = providerReport.providerPlan.rust;
		expect(rustPlan.warnings.some((w) => w.toLowerCase().includes("rust-analyzer"))).toBe(true);
	});
});

// ============================================================================
// Mutation safety helper tests
// ============================================================================

describe("isMutationSafeSmartReadResult", () => {
	it("raw is mutation safe", () => {
		const result: SmartReadResult = {
			content: "raw content",
			mode: "raw",
			mutationSafe: true,
			adapterConfidence: 1.0,
			adapterName: "test",
			isFallback: false,
		};
		expect(isMutationSafeSmartReadResult(result)).toBe(true);
	});

	it("range_exact is mutation safe", () => {
		const result: SmartReadResult = {
			content: "line1\nline2",
			mode: "range_exact",
			mutationSafe: true,
			adapterConfidence: 1.0,
			adapterName: "test",
			isFallback: false,
		};
		expect(isMutationSafeSmartReadResult(result)).toBe(true);
	});

	it("symbol_exact with compiler parse source and exactRange is mutation safe", () => {
		const result: SmartReadResult = {
			content: "function foo() {}",
			mode: "symbol_exact",
			mutationSafe: true,
			adapterConfidence: 0.96,
			adapterName: "typescript-compiler",
			isFallback: false,
			parseSource: "typescript_compiler",
			exactRange: { startLine: 1, endLine: 1 },
		};
		expect(isMutationSafeSmartReadResult(result)).toBe(true);
	});

	it("symbol_exact with regex fallback is NOT mutation safe", () => {
		const result: SmartReadResult = {
			content: "function foo() {}",
			mode: "symbol_exact",
			mutationSafe: false,
			adapterConfidence: 0.35,
			adapterName: "typescript-regex-fallback",
			isFallback: true,
			parseSource: "regex_fallback",
			fallbackError: "regex cannot guarantee exact boundaries",
		};
		expect(isMutationSafeSmartReadResult(result)).toBe(false);
	});

	it("symbol_exact without exactRange is NOT mutation safe even with good parse source", () => {
		const result: SmartReadResult = {
			content: "function foo() {}",
			mode: "symbol_exact",
			mutationSafe: true,
			adapterConfidence: 0.96,
			adapterName: "typescript-compiler",
			isFallback: false,
			parseSource: "typescript_compiler",
		};
		expect(isMutationSafeSmartReadResult(result)).toBe(false);
	});

	it("outline is never mutation safe", () => {
		const result: SmartReadResult = {
			content: "outline content",
			mode: "outline",
			mutationSafe: false,
			adapterConfidence: 0.9,
			adapterName: "test",
			isFallback: false,
		};
		expect(isMutationSafeSmartReadResult(result)).toBe(false);
	});
});

// ============================================================================
// Provider selection tests
// ============================================================================

describe("SmartReadCore provider selection", () => {
	it("registers and selects providers by priority", async () => {
		const core = new SmartReadCore();
		const tsProvider = new TypeScriptCompilerProvider();
		const tsRegexAdapter = new TypeScriptAdapter();

		core.registerProvider(tsProvider);
		core.registerAdapter(tsRegexAdapter);

		const providers = await core.getProviders("test.ts");
		expect(providers.length).toBeGreaterThan(0);
		// TypeScript compiler should be first if available
		if (tsProvider.isAvailable()) {
			expect(providers[0].name).toBe("typescript-compiler");
		}
	});

	it("provider plan shows fallback chain", async () => {
		const core = new SmartReadCore();
		core.registerProvider(new TypeScriptCompilerProvider());
		core.registerProvider(new TreeSitterWasmProvider());

		const plan = await core.getProviderPlan("test.ts");
		expect(plan.extension).toBe(".ts");
		expect(plan.filePath).toBe("test.ts");
		expect(plan.providers.length).toBeGreaterThan(0);
	});
});

// ============================================================================
// Generic fallback confidence tests
// ============================================================================

describe("generic fallback confidence caps", () => {
	it("outline confidence <= 0.30", async () => {
		const adapter = new GenericFallbackAdapter();
		const result = await adapter.outline("plain text content\nwith no structure\n", "test.txt");
		expect(result.adapterConfidence).toBeLessThanOrEqual(SMART_READ_CONFIDENCE.GENERIC_FALLBACK_MAX);
		expect(result.parseSource).toBe("generic_fallback");
	});

	it("symbolExact confidence <= 0.20", async () => {
		const adapter = new GenericFallbackAdapter();
		const result = await adapter.symbolExact("some text foo bar\n", "test.txt", "foo");
		expect(result.adapterConfidence).toBeLessThanOrEqual(0.2);
		expect(result.parseSource).toBe("generic_fallback");
		expect(result.mutationSafe).toBe(false);
	});
});

// ============================================================================
// withProviderTimeout tests
// ============================================================================

describe("withProviderTimeout", () => {
	it("returns result when promise resolves in time", async () => {
		const result = await withProviderTimeout(Promise.resolve("ok"), 1000, "test-provider");
		expect(result).toBe("ok");
	});

	it("rejects when promise exceeds timeout", async () => {
		await expect(
			withProviderTimeout(new Promise((resolve) => setTimeout(resolve, 5000)), 10, "slow-provider"),
		).rejects.toThrow("slow-provider timed out");
	});
});

// ============================================================================
// Provider interface tests
// ============================================================================

describe("provider capabilities", () => {
	it("typescript compiler has astBacked and semantic capabilities", () => {
		const provider = new TypeScriptCompilerProvider();
		const caps = provider.getCapabilities();
		expect(caps.astBacked).toBe(true);
		expect(caps.semantic).toBe(true);
		expect(caps.mutationSafeExact).toBe(true);
		expect(caps.symbolExact).toBe(true);
	});

	it("json native has astBacked but not semantic", () => {
		const provider = new JsonNativeProvider();
		const caps = provider.getCapabilities();
		expect(caps.astBacked).toBe(true);
		expect(caps.semantic).toBe(false);
	});

	it("pyright reports all false (deferred)", () => {
		const provider = new PyrightProvider();
		const caps = provider.getCapabilities();
		expect(caps.outline).toBe(false);
		expect(provider.isAvailable()).toBe(false);
	});
});

// ============================================================================
// LLM fallback confidence
// ============================================================================

describe("LLM fallback confidence", () => {
	it("outline confidence <= 0.55", async () => {
		const { LLMFallbackAdapter } = await import("../../src/core/token-context/adapters/fallback.js");
		const adapter = new LLMFallbackAdapter(100);
		const result = await adapter.outline("test content\n", "test.txt");
		expect(result.adapterConfidence).toBeLessThanOrEqual(SMART_READ_CONFIDENCE.LLM_FALLBACK_MAX);
		if (result.parseSource) {
			// When LLM is not configured, it delegates to GenericFallbackAdapter
			expect(["generic_fallback", "llm_fallback"]).toContain(result.parseSource);
		}
	});
});
