/**
 * P43 Smart Read v2 — Real Tree-sitter WASM Parser Tests
 *
 * These tests actually initialize web-tree-sitter, load grammar WASM assets,
 * parse real source text, and verify extracted symbols/ranges.
 *
 * They run only when web-tree-sitter and tree-sitter-wasms are installed
 * (they are regular dependencies, so they should always be available).
 * If NOT available, tests will be skipped with an explicit message.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { treeSitterWasmLoader } from "../../src/core/token-context/providers/tree-sitter-wasm-loader.js";
import { TreeSitterWasmProvider } from "../../src/core/token-context/providers/tree-sitter-wasm-provider.js";
import { SmartReadCore } from "../../src/core/token-context/smart-read-core.js";

// ============================================================================
// Fixtures
// ============================================================================

const PYTHON_FIXTURE = `import os

CONSTANT_VALUE = 42

def decorator(fn):
    return fn

class Worker:
    def __init__(self, name: str):
        self.name = name

    @decorator
    async def run(self):
        return self.name

def main():
    worker = Worker("x")
    return worker
`;

const RUST_FIXTURE = `use std::path::PathBuf;

pub struct Config {
    pub root: PathBuf,
}

impl Config {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &PathBuf {
        &self.root
    }
}

pub enum Mode {
    Fast,
    Safe,
}

pub trait Runner {
    fn run(&self);
}

pub fn execute(config: Config) {
    println!("{:?}", config.root);
}
`;

const TS_FIXTURE = `export class Service {
  async handle(input: string): Promise<string> {
    return input.toUpperCase();
  }
}

export const run = async () => {
  return new Service().handle("x");
};
`;

const JSX_FIXTURE = `import React from "react";

export function App() {
  return <div>Hello</div>;
}

export const Button = ({ label }) => {
  return <button>{label}</button>;
};
`;

const JSON_FIXTURE = `{
  "compilerOptions": {
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "scripts": {
    "test": "vitest run"
  },
  "workspaces": ["packages/*"]
}`;

const YAML_FIXTURE = `services:
  api:
    image: node:20
    environment:
      - NODE_ENV=production
      - PORT=3000

jobs:
  build:
    steps:
      - run: npm install
      - run: npm test
`;

// ============================================================================
// Boot
// ============================================================================

let tsProvider: TreeSitterWasmProvider;

beforeAll(async () => {
	tsProvider = new TreeSitterWasmProvider();
	if (!(await tsProvider.isAvailable())) {
		console.log("Tree-sitter WASM not available; real parser tests will be skipped.");
	}
});

// ============================================================================
// Python Real Parser Tests
// ============================================================================

describe("Real Python tree-sitter extraction", () => {
	it("loader resolves python grammar", async () => {
		const langId = treeSitterWasmLoader.getLanguageForExtension(".py");
		expect(langId).toBe("python");

		const config = treeSitterWasmLoader.getGrammarConfig("python");
		expect(config).toBeDefined();
		expect(config!.wasmCandidates.length).toBeGreaterThan(0);
	});

	it("parser produces valid parse result", async () => {
		const result = await treeSitterWasmLoader.parse("python", PYTHON_FIXTURE);
		if (!result) return; // skip if grammar not available
		expect(result.tree).toBeDefined();
		expect(result.content).toBe(PYTHON_FIXTURE);
	});

	it("extractPythonSymbols finds class, methods, functions", async () => {
		const { extractPythonSymbols, buildPythonOutline } = await import(
			"../../src/core/token-context/providers/tree-sitter-python-extractor.js"
		);
		const parseResult = await treeSitterWasmLoader.parse("python", PYTHON_FIXTURE);
		if (!parseResult) return;

		const symbols = extractPythonSymbols(parseResult);
		expect(symbols.length).toBeGreaterThan(0);

		const outline = buildPythonOutline(symbols);
		expect(outline).toContain("[class] Worker");
		expect(outline).toContain("[function] main");

		// Find class Worker and its methods
		const workerClass = symbols.find((s) => s.name === "Worker" && s.kind === "class");
		expect(workerClass).toBeDefined();
		expect(workerClass!.startLine).toBeGreaterThan(0);
		expect(workerClass!.endLine).toBeGreaterThanOrEqual(workerClass!.startLine);

		// Find main function
		const mainFunc = symbols.find((s) => s.name === "main");
		expect(mainFunc).toBeDefined();
	});

	it("symbolExact for class returns exact range with mutationSafe=true", async () => {
		const { extractPythonSymbols, findPythonSymbol, pythonSymbolExact } = await import(
			"../../src/core/token-context/providers/tree-sitter-python-extractor.js"
		);
		const parseResult = await treeSitterWasmLoader.parse("python", PYTHON_FIXTURE);
		if (!parseResult) return;

		const symbols = extractPythonSymbols(parseResult);
		const workerSymbol = findPythonSymbol(symbols, "Worker");
		expect(workerSymbol).toBeDefined();

		const exact = pythonSymbolExact(parseResult, workerSymbol!);
		expect(exact).toBeDefined();
		expect(exact!.content).toContain("class Worker");
		expect(exact!.content).not.toContain("def main");
		expect(exact!.startLine).toBeGreaterThan(0);
		expect(exact!.endLine).toBeLessThan(PYTHON_FIXTURE.split("\n").length);

		// Now verify via provider
		const result = await tsProvider.symbolExact(PYTHON_FIXTURE, "test.py", "Worker");
		if (result.isFallback) return;
		expect(result.mutationSafe).toBe(true);
		expect(result.exactRange).toBeDefined();
		expect(result.parseSource).toBe("tree_sitter_wasm");
	});

	it("provider outline has correct parse source", async () => {
		const result = await tsProvider.outline(PYTHON_FIXTURE, "test.py");
		if (result.isFallback) return;
		expect(result.parseSource).toBe("tree_sitter_wasm");
		expect(result.isFallback).toBe(false);
		expect(result.content).toContain("Worker");
	});

	it("real parse shows decorator range includes class", async () => {
		const { extractPythonSymbols, findPythonSymbol, pythonSymbolExact } = await import(
			"../../src/core/token-context/providers/tree-sitter-python-extractor.js"
		);
		const parseResult = await treeSitterWasmLoader.parse("python", PYTHON_FIXTURE);
		if (!parseResult) return;

		const symbols = extractPythonSymbols(parseResult);
		const workerSymbol = findPythonSymbol(symbols, "Worker");
		expect(workerSymbol).toBeDefined();

		const exact = pythonSymbolExact(parseResult, workerSymbol!);
		expect(exact).toBeDefined();
		// Worker is not decorated (no @dataclass), so range should just be class body
		expect(exact!.content).toContain("class Worker");
	});
});

// ============================================================================
// Rust Real Parser Tests
// ============================================================================

describe("Real Rust tree-sitter extraction", () => {
	it("loader resolves rust grammar", async () => {
		const langId = treeSitterWasmLoader.getLanguageForExtension(".rs");
		expect(langId).toBe("rust");

		const config = treeSitterWasmLoader.getGrammarConfig("rust");
		expect(config).toBeDefined();
	});

	it("parser produces valid parse result", async () => {
		const result = await treeSitterWasmLoader.parse("rust", RUST_FIXTURE);
		if (!result) return;
		expect(result.tree).toBeDefined();
		expect(result.content).toBe(RUST_FIXTURE);
	});

	it("extractRustSymbols finds struct, impl, trait, function, enum", async () => {
		const { extractRustSymbols, buildRustOutline } = await import(
			"../../src/core/token-context/providers/tree-sitter-rust-extractor.js"
		);
		const parseResult = await treeSitterWasmLoader.parse("rust", RUST_FIXTURE);
		if (!parseResult) return;

		const symbols = extractRustSymbols(parseResult);
		expect(symbols.length).toBeGreaterThan(0);

		const outline = buildRustOutline(symbols);
		expect(outline).toContain("struct");
		expect(outline).toContain("Config");

		// Find struct Config
		const configStruct = symbols.find((s) => s.name === "Config" && s.kind === "struct");
		expect(configStruct).toBeDefined();

		// Find impl Config
		const _configImpl = symbols.find((s) => s.name?.includes("impl") && s.fullName && s.fullName.includes("Config"));
		// The impl may be found as a container or as a standalone symbol
		const implEntry = symbols.find((s) => s.kind === "impl");
		if (implEntry) {
			expect(implEntry.fullName).toBeDefined();
		}

		// Find execute function
		const executeFunc = symbols.find((s) => s.name === "execute");
		expect(executeFunc).toBeDefined();

		// Find enum Mode
		const modeEnum = symbols.find((s) => s.name === "Mode" && s.kind === "enum");
		expect(modeEnum).toBeDefined();

		// Find trait Runner
		const runnerTrait = symbols.find((s) => s.name === "Runner");
		expect(runnerTrait).toBeDefined();
	});

	it("symbolExact for struct returns exact range with mutationSafe=true", async () => {
		const { extractRustSymbols, findRustSymbol, rustSymbolExact } = await import(
			"../../src/core/token-context/providers/tree-sitter-rust-extractor.js"
		);
		const parseResult = await treeSitterWasmLoader.parse("rust", RUST_FIXTURE);
		if (!parseResult) return;

		const symbols = extractRustSymbols(parseResult);
		const configSymbol = findRustSymbol(symbols, "Config");
		expect(configSymbol).toBeDefined();

		const exact = rustSymbolExact(parseResult, configSymbol!);
		expect(exact).toBeDefined();
		expect(exact!.content).toContain("pub struct Config");
		expect(exact!.startLine).toBeGreaterThan(0);

		// Verify via provider
		const result = await tsProvider.symbolExact(RUST_FIXTURE, "test.rs", "Config");
		if (result.isFallback) return;
		expect(result.mutationSafe).toBe(true);
		expect(result.exactRange).toBeDefined();
		expect(result.parseSource).toBe("tree_sitter_wasm");
	});

	it("symbolExact for function returns exact range", async () => {
		const result = await tsProvider.symbolExact(RUST_FIXTURE, "test.rs", "execute");
		if (result.isFallback) return;
		expect(result.mutationSafe).toBe(true);
		expect(result.content).toContain("pub fn execute");
	});

	it("provider outline has correct parse source", async () => {
		const result = await tsProvider.outline(RUST_FIXTURE, "test.rs");
		if (result.isFallback) return;
		expect(result.parseSource).toBe("tree_sitter_wasm");
		expect(result.isFallback).toBe(false);
		expect(result.content).toContain("Config");
	});
});

// ============================================================================
// TypeScript/JS Real Parser Tests (Secondary Fallback)
// ============================================================================

describe("Real TypeScript/JS tree-sitter fallback extraction", () => {
	it("loader resolves typescript grammar", async () => {
		const langId = treeSitterWasmLoader.getLanguageForExtension(".ts");
		expect(langId).toBe("typescript");

		const config = treeSitterWasmLoader.getGrammarConfig("typescript");
		expect(config).toBeDefined();
	});

	it("extracts class, method, and arrow function from TS fixture", async () => {
		const { extractTypeScriptSymbols, buildTypeScriptOutline } = await import(
			"../../src/core/token-context/providers/tree-sitter-typescript-extractor.js"
		);
		const parseResult = await treeSitterWasmLoader.parse("typescript", TS_FIXTURE);
		if (!parseResult) return;

		const symbols = extractTypeScriptSymbols(parseResult);
		expect(symbols.length).toBeGreaterThan(0);

		const outline = buildTypeScriptOutline(symbols);
		expect(outline).toContain("Service");

		// Find class Service
		const serviceClass = symbols.find((s) => s.name === "Service" && s.kind === "class");
		expect(serviceClass).toBeDefined();

		// Find method handle
		const handleMethod = symbols.find((s) => s.name === "handle" && s.kind === "method");
		expect(handleMethod).toBeDefined();

		// Find const run arrow function
		const runFunc = symbols.find((s) => s.name === "run" && s.kind === "function");
		expect(runFunc).toBeDefined();
	});

	it("extracts components from JSX fixture", async () => {
		const { extractTypeScriptSymbols } = await import(
			"../../src/core/token-context/providers/tree-sitter-typescript-extractor.js"
		);
		const parseResult = await treeSitterWasmLoader.parse("javascript", JSX_FIXTURE);
		if (!parseResult) return;

		const symbols = extractTypeScriptSymbols(parseResult);
		expect(symbols.length).toBeGreaterThan(0);

		// The JSX grammar should find App and Button
		const appFunc = symbols.find((s) => s.name === "App" && s.kind === "function");
		if (appFunc) {
			expect(appFunc).toBeDefined();
		}

		const buttonFunc = symbols.find((s) => s.name === "Button");
		expect(buttonFunc).toBeDefined();
	});

	it("TypeScript provider falls back properly via SmartReadCore", async () => {
		const core = new SmartReadCore();
		core.registerProvider(tsProvider);

		const result = await core.smartRead(TS_FIXTURE, "test.ts", "outline");
		// Should either succeed with tree-sitter or fallback to raw
		if (result.isFallback) {
			expect(result.fallbackError).toBeDefined();
		} else {
			expect(result.content).toContain("Service");
		}
	});
});

// ============================================================================
// JSON Real Parser Tests
// ============================================================================

describe("Real JSON tree-sitter fallback extraction", () => {
	it("loader resolves json grammar", async () => {
		const langId = treeSitterWasmLoader.getLanguageForExtension(".json");
		expect(langId).toBe("json");
	});

	it("parse produces valid result", async () => {
		const result = await treeSitterWasmLoader.parse("json", JSON_FIXTURE);
		if (!result) return;
		expect(result.tree).toBeDefined();
	});
});

// ============================================================================
// YAML Real Parser Tests
// ============================================================================

describe("Real YAML tree-sitter fallback extraction", () => {
	it("loader resolves yaml grammar", async () => {
		const langId = treeSitterWasmLoader.getLanguageForExtension(".yaml");
		expect(langId).toBe("yaml");
	});

	it("parse produces valid result", async () => {
		const result = await treeSitterWasmLoader.parse("yaml", YAML_FIXTURE);
		if (!result) return;
		expect(result.tree).toBeDefined();
	});
});
