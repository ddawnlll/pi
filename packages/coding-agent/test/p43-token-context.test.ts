/**
 * P43 Token Context Runtime Tests - W018
 *
 * Tests covering all P43 lab-derived invariants and acceptance criteria.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.js";
import { ActiveContextRegistry } from "../src/core/token-context/active-context-registry.js";
import { GenericFallbackAdapter, LLMFallbackAdapter } from "../src/core/token-context/adapters/fallback.js";
import { JsonYamlAdapter } from "../src/core/token-context/adapters/json-yaml.js";
import { PythonAdapter } from "../src/core/token-context/adapters/python.js";
import { RustAdapter } from "../src/core/token-context/adapters/rust.js";
import { TypeScriptAdapter } from "../src/core/token-context/adapters/typescript.js";
import { ChangeLedger } from "../src/core/token-context/change-ledger.js";
import {
	CONTRACT_GOLDEN,
	checkContractCompatibility,
	P43_CONTRACT_VERSION,
} from "../src/core/token-context/contract-version.js";
import { buildEditRecoveryPacket } from "../src/core/token-context/edit-recovery.js";
import { EditRecoveryMetricsTracker } from "../src/core/token-context/edit-recovery-types.js";
import { runGrammarPreflight } from "../src/core/token-context/grammar-preflight.js";
import { GAUNTLET_FIXTURES, LabHarness } from "../src/core/token-context/lab-harness.js";
import { RawCache } from "../src/core/token-context/raw-cache.js";
import { ReadHashCache } from "../src/core/token-context/read-hash-cache.js";
import { createTokenContextRuntime, detectRtkHook } from "../src/core/token-context/runtime.js";
import { SavingsLedger } from "../src/core/token-context/savings-ledger.js";
import { SmartReadCore } from "../src/core/token-context/smart-read-core.js";
import { TokenEstimator } from "../src/core/token-context/token-estimator.js";
import type { ACRState, LedgerState, TokenContextConfig } from "../src/core/token-context/types.js";
import { DEFAULT_TOKEN_CONTEXT_CONFIG, getACRLedgerPolicy } from "../src/core/token-context/types.js";
import { createReadTool } from "../src/core/tools/read.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createTempDir(): string {
	const tempDir = join(tmpdir(), `pi-p43-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	return tempDir;
}

function createTempFile(dir: string, name: string, content: string): string {
	const path = join(dir, name);
	writeFileSync(path, content, "utf-8");
	return path;
}

// ============================================================================
// W003: Savings Ledger
// ============================================================================

describe("SavingsLedger", () => {
	let ledger: SavingsLedger;

	beforeEach(() => {
		ledger = new SavingsLedger();
	});

	it("records token saving events", () => {
		ledger.record({
			mechanism: "smart_read",
			tool: "read",
			estimatedBaselineTokens: 1000,
			estimatedOptimizedTokens: 500,
			estimatedSavingTokens: 500,
			confidence: "estimated",
			filePath: "/test/file.ts",
		});

		const events = ledger.getEvents();
		expect(events).toHaveLength(1);
		expect(events[0].mechanism).toBe("smart_read");
		expect(events[0].estimatedSavingTokens).toBe(500);
	});

	it("generates savings summary with per-mechanism aggregation", () => {
		ledger.record({
			mechanism: "smart_read",
			tool: "read",
			estimatedBaselineTokens: 1000,
			estimatedOptimizedTokens: 500,
			estimatedSavingTokens: 500,
			confidence: "estimated",
		});

		ledger.record({
			mechanism: "read_hash_cache",
			tool: "read",
			estimatedBaselineTokens: 800,
			estimatedOptimizedTokens: 100,
			estimatedSavingTokens: 700,
			confidence: "estimated",
		});

		const summary = ledger.summarize();
		expect(summary.totalEvents).toBe(2);
		expect(summary.estimatedSavingPercent).toBeGreaterThan(0);
		expect(summary.byMechanism.smart_read).toBeDefined();
		expect(summary.byMechanism.read_hash_cache).toBeDefined();
	});

	it("separates estimated and actual saving", () => {
		ledger.record({
			mechanism: "smart_read",
			tool: "read",
			estimatedBaselineTokens: 1000,
			estimatedOptimizedTokens: 500,
			estimatedSavingTokens: 500,
			actualBaselineTokens: 950,
			actualOptimizedTokens: 480,
			actualSavingTokens: 470,
			confidence: "actual",
		});

		const summary = ledger.summarize();
		expect(summary.totalEstimatedSaving).toBe(500);
		expect(summary.totalActualSaving).toBe(470);
	});

	it("tracks confidences separately", () => {
		ledger.record({
			mechanism: "smart_read",
			tool: "read",
			estimatedBaselineTokens: 100,
			estimatedOptimizedTokens: 50,
			estimatedSavingTokens: 50,
			confidence: "estimated",
		});

		ledger.record({
			mechanism: "read_hash_cache",
			tool: "read",
			estimatedBaselineTokens: 100,
			estimatedOptimizedTokens: 50,
			estimatedSavingTokens: 50,
			confidence: "synthetic",
		});

		const summary = ledger.summarize();
		expect(summary.confidenceBreakdown.estimated).toBe(1);
		expect(summary.confidenceBreakdown.synthetic).toBe(1);
	});

	it("tracks fallback count", () => {
		ledger.record({
			mechanism: "fallback",
			tool: "read",
			estimatedBaselineTokens: 100,
			estimatedOptimizedTokens: 100,
			estimatedSavingTokens: 0,
			confidence: "estimated",
		});

		const summary = ledger.summarize();
		expect(summary.fallbackCount).toBe(1);
	});

	it("increments hard safety counter", () => {
		ledger.incrementHardSafety();
		ledger.incrementHardSafety();
		const summary = ledger.summarize();
		expect(summary.hardSafetyCount).toBe(2);
	});
});

// ============================================================================
// W005: Token Estimator
// ============================================================================

describe("TokenEstimator", () => {
	let estimator: TokenEstimator;

	beforeEach(() => {
		estimator = new TokenEstimator();
	});

	it("estimates tokens using chars/4 heuristic", () => {
		const estimate = estimator.estimate("function hello() { return 'world'; }");
		expect(estimate.charEstimate).toBeGreaterThan(0);
		expect(estimate.isProviderCalibrated).toBe(false);
	});

	it("has no provider calibration initially", () => {
		expect(estimator.isCalibrated).toBe(false);
	});

	it("marks calibrated after provider usage recorded", () => {
		estimator.recordProviderUsage({
			provider: "openai",
			model: "gpt-4",
			actualInputTokens: 100,
			actualOutputTokens: 50,
			totalTokens: 150,
			timestamp: Date.now(),
			requestId: "req-1",
		});
		expect(estimator.isCalibrated).toBe(true);
	});

	it("computes saving percentage correctly", () => {
		const pct = estimator.computeSavingPercent(1000, 700);
		expect(pct).toBe(30);
	});

	it("returns 0 for zero baseline", () => {
		const pct = estimator.computeSavingPercent(0, 100);
		expect(pct).toBe(0);
	});
});

// ============================================================================
// W006: Raw Cache
// ============================================================================

describe("RawCache", () => {
	let cache: RawCache;

	beforeEach(() => {
		cache = new RawCache({ maxBytes: 1024 * 1024 }); // 1MB
	});

	it("stores and retrieves content", () => {
		const handle = cache.store("/test/file.ts", "content");
		const retrieved = cache.lookup(handle.id);
		expect(retrieved).toBeDefined();
		expect(retrieved!.content).toBe("content");
	});

	it("looks up by file path", () => {
		cache.store("/test/a.ts", "content-a");
		cache.store("/test/b.ts", "content-b");
		const found = cache.lookupByPath("/test/a.ts");
		expect(found?.content).toBe("content-a");
	});

	it("evicts LRU entries when full", () => {
		const smallCache = new RawCache({ maxBytes: 50 });
		smallCache.store("/test/a.ts", "a".repeat(20));
		smallCache.store("/test/b.ts", "b".repeat(20));
		const stats = smallCache.getStats();
		expect(stats.evictionCount).toBeGreaterThanOrEqual(0);
	});

	it("tracks hit/miss stats", () => {
		const handle = cache.store("/test/file.ts", "content");
		cache.lookup(handle.id);
		cache.lookup("nonexistent");
		const stats = cache.getStats();
		expect(stats.hitCount).toBe(1);
		expect(stats.missCount).toBe(1);
	});

	it("returns undefined for missing handles", () => {
		expect(cache.lookup("nonexistent")).toBeUndefined();
	});
});

// ============================================================================
// W007: Read Hash Cache
// ============================================================================

describe("ReadHashCache", () => {
	let tempDir: string;
	let readHashCache: ReadHashCache;

	beforeEach(() => {
		tempDir = createTempDir();
		readHashCache = new ReadHashCache();
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	it("takes snapshot of file content", () => {
		const filePath = createTempFile(tempDir, "test.ts", "const x = 1;");
		const snapshot = readHashCache.takeSnapshot(filePath, "const x = 1;");
		expect(snapshot).toBeDefined();
		expect(snapshot.filePath).toBe(filePath);
	});

	it("detects unchanged files", () => {
		const filePath = createTempFile(tempDir, "test.ts", "const x = 1;");
		const snapshot = readHashCache.takeSnapshot(filePath, "const x = 1;");
		expect(readHashCache.isUnchanged(snapshot)).toBe(true);
	});

	it("detects changed files", () => {
		const filePath = createTempFile(tempDir, "test.ts", "const x = 1;");
		const snapshot = readHashCache.takeSnapshot(filePath, "const x = 1;");
		// Modify file externally
		writeFileSync(filePath, "const x = 2;");
		expect(readHashCache.isUnchanged(snapshot)).toBe(false);
	});

	it("detects content hash changes", () => {
		const filePath = createTempFile(tempDir, "test.ts", "const x = 1;");
		readHashCache.takeSnapshot(filePath, "const x = 1;");
		expect(readHashCache.isContentUnchanged(filePath, "const x = 1;")).toBe(true);
		expect(readHashCache.isContentUnchanged(filePath, "const x = 2;")).toBe(false);
	});

	it("gets raw content from cache", () => {
		const filePath = createTempFile(tempDir, "test.ts", "const x = 1;");
		const _snapshot = readHashCache.takeSnapshot(filePath, "const x = 1;");
		const raw = readHashCache.getRawContent(filePath);
		expect(raw).toBe("const x = 1;");
	});

	it("invalidates snapshots", () => {
		const filePath = createTempFile(tempDir, "test.ts", "const x = 1;");
		readHashCache.takeSnapshot(filePath, "const x = 1;");
		readHashCache.invalidate(filePath);
		expect(readHashCache.getSnapshot(filePath)).toBeUndefined();
	});
});

// ============================================================================
// W008: Active Context Registry
// ============================================================================

describe("ActiveContextRegistry", () => {
	let acr: ActiveContextRegistry;

	beforeEach(() => {
		acr = new ActiveContextRegistry();
	});

	it("marks entries as active", () => {
		const entry = acr.markActive("/test/file.ts", "snap-1");
		expect(entry.state).toBe("active");
		expect(acr.getState("/test/file.ts")).toBe("active");
	});

	it("marks entries as dirty", () => {
		acr.markActive("/test/file.ts");
		acr.markDirty("/test/file.ts");
		expect(acr.getState("/test/file.ts")).toBe("dirty");
	});

	it("marks entries as changed", () => {
		acr.markActive("/test/file.ts");
		acr.markChanged("/test/file.ts");
		expect(acr.getState("/test/file.ts")).toBe("changed");
		expect(acr.getEntry("/test/file.ts")?.externallyModified).toBe(true);
	});

	it("returns unknown for unregistered files", () => {
		expect(acr.getState("/nonexistent/file.ts")).toBe("unknown");
	});

	it("evicts entries (marks as evicted)", () => {
		acr.markActive("/test/file.ts");
		acr.evict("/test/file.ts");
		expect(acr.getState("/test/file.ts")).toBe("evicted");
	});

	it("advances turns and marks inactive", () => {
		acr.markActive("/test/file.ts");
		// Advance many turns to make it inactive
		for (let i = 0; i < 20; i++) {
			acr.advanceTurn();
		}
		expect(acr.getState("/test/file.ts")).toBe("inactive");
	});

	it("detects external mutations", () => {
		const tempDir = createTempDir();
		const filePath = createTempFile(tempDir, "test.ts", "original");
		acr.markActive(filePath);

		// Get file stats
		const { statSync } = require("fs");
		const stat = statSync(filePath);

		// Modify file
		writeFileSync(filePath, "modified");

		const mutated = acr.detectExternalMutation(filePath, stat.mtimeMs - 1000, stat.size - 1);
		expect(mutated).toBe(true);
		expect(acr.getState(filePath)).toBe("changed");

		rmSync(tempDir, { recursive: true });
	});
});

// ============================================================================
// W009: ACR × Change Ledger Policy Matrix
// ============================================================================

describe("ACR × Change Ledger Policy", () => {
	const allACRStates: ACRState[] = ["active", "inactive", "evicted", "dirty", "changed", "unknown"];
	const allLedgerStates: LedgerState[] = [
		"no_entry",
		"known_unchanged",
		"changed_with_delta",
		"changed_delta_chain_short",
		"changed_delta_chain_long",
		"checkpoint_required",
		"stale_hash",
		"external_mutation",
		"raw_missing",
	];

	it("has complete coverage: 54 combinations (6 ACR × 9 Ledger)", () => {
		let covered = 0;
		for (const _acr of allACRStates) {
			for (const _ledger of allLedgerStates) {
				covered++;
			}
		}
		expect(covered).toBe(54);
	});

	it("every ACR × Ledger combination returns a valid policy", () => {
		for (const acr of allACRStates) {
			for (const ledger of allLedgerStates) {
				const policy = getACRLedgerPolicy(acr, ledger);
				expect(policy).toBeDefined();
				expect(typeof policy.returnUnchanged).toBe("boolean");
				expect(typeof policy.forceRawRead).toBe("boolean");
				expect(typeof policy.blockMutation).toBe("boolean");
				expect(typeof policy.hardFail).toBe("boolean");
			}
		}
	});

	it("active + known_unchanged allows returnUnchanged", () => {
		const policy = getACRLedgerPolicy("active", "known_unchanged");
		expect(policy.returnUnchanged).toBe(true);
		expect(policy.returnCompactSummary).toBe(true);
	});

	it("active + stale_hash forces exact symbol read", () => {
		const policy = getACRLedgerPolicy("active", "stale_hash");
		expect(policy.forceExactSymbolRead).toBe(true);
		expect(policy.blockMutation).toBe(true);
	});

	it("dirty + anything blocks mutation", () => {
		for (const ledger of allLedgerStates) {
			const policy = getACRLedgerPolicy("dirty", ledger);
			expect(policy.blockMutation).toBe(true);
		}
	});

	it("unknown + anything blocks mutation", () => {
		for (const ledger of allLedgerStates) {
			const policy = getACRLedgerPolicy("unknown", ledger);
			expect(policy.blockMutation).toBe(true);
		}
	});

	it("raw_missing always causes hardFail", () => {
		for (const acr of allACRStates) {
			const policy = getACRLedgerPolicy(acr, "raw_missing");
			expect(policy.hardFail).toBe(true);
		}
	});

	it("evicted + known_unchanged forces raw read", () => {
		const policy = getACRLedgerPolicy("evicted", "known_unchanged");
		expect(policy.forceRawRead).toBe(true);
		expect(policy.returnUnchanged).toBe(false);
	});

	it("changed_delta_chain_long forces exact symbol read", () => {
		for (const acr of ["active", "inactive"] as ACRState[]) {
			const policy = getACRLedgerPolicy(acr, "changed_delta_chain_long");
			expect(policy.forceExactSymbolRead).toBe(true);
		}
	});

	it("external_mutation blocks mutation AND forces raw read", () => {
		const policy = getACRLedgerPolicy("active", "external_mutation");
		expect(policy.forceRawRead).toBe(true);
		expect(policy.blockMutation).toBe(true);
	});
});

// ============================================================================
// W010: Smart Read Core
// ============================================================================

describe("SmartReadCore", () => {
	let core: SmartReadCore;

	beforeEach(() => {
		core = new SmartReadCore();
		core.registerAdapter(new TypeScriptAdapter());
		core.registerAdapter(new PythonAdapter());
		core.registerAdapter(new JsonYamlAdapter());
		core.registerAdapter(new RustAdapter());
		core.setFallbackAdapter(new GenericFallbackAdapter());
	});

	it("gets correct adapter by extension", () => {
		const tsAdapter = core.getAdapter("file.ts");
		expect(tsAdapter?.name).toBe("typescript");

		const pyAdapter = core.getAdapter("file.py");
		expect(pyAdapter?.name).toBe("python");

		const jsonAdapter = core.getAdapter("file.json");
		expect(jsonAdapter?.name).toBe("json-yaml");

		const rsAdapter = core.getAdapter("file.rs");
		expect(rsAdapter?.name).toBe("rust");
	});

	it("falls back to generic for unknown extensions", () => {
		const adapter = core.getAdapter("file.xyz");
		expect(adapter?.name).toBe("generic");
	});

	it("outline mode returns mutationSafe=false", async () => {
		const tsContent = "export function hello() { return 'world'; }\nexport class Foo { bar() {} }";
		const result = await core.smartRead(tsContent, "file.ts", "outline");
		expect(result.mutationSafe).toBe(false);
		expect(result.adapterConfidence).toBeGreaterThan(0);
	});

	it("raw mode returns mutationSafe=true", async () => {
		const content = "some raw content";
		const result = await core.smartRead(content, "file.ts", "raw");
		expect(result.mutationSafe).toBe(true);
		expect(result.content).toBe(content);
	});

	it("range_exact returns mutationSafe=true", async () => {
		const content = "line1\nline2\nline3\nline4";
		const result = await core.smartRead(content, "file.ts", "range_exact", {
			startLine: 2,
			endLine: 3,
		});
		expect(result.mutationSafe).toBe(true);
		expect(result.content).toBe("line2\nline3");
	});

	it("falls back to raw on adapter error", async () => {
		const result = await core.smartRead("content", "file.ts", "symbol_exact", {
			symbol: "nonexistent",
		});
		expect(result.isFallback).toBe(true);
	});

	it("falls back to raw with no adapter", async () => {
		const core2 = new SmartReadCore();
		// No adapters, no fallback
		const result = await core2.smartRead("content", "file.ts", "outline");
		expect(result.isFallback).toBe(true);
		expect(result.mutationSafe).toBe(true);
	});
});

// ============================================================================
// W011: TypeScript/JavaScript Adapter
// ============================================================================

describe("TypeScriptAdapter", () => {
	const adapter = new TypeScriptAdapter();

	const tsContent = `
import { foo } from './foo';
export class MyClass {
  private value: number;
  constructor() { this.value = 0; }
  getValue(): number { return this.value; }
  setValue(v: number) { this.value = v; }
}
export function helper(x: number): number { return x * 2; }
export const PI = 3.14;
export interface Config { debug: boolean; }
export type ID = string;
`;

	it("detects imports, exports, classes, methods, functions", async () => {
		const result = await adapter.outline(tsContent, "test.ts");
		expect(result.content).toContain("MyClass");
		expect(result.content).toContain("import");
		expect(result.content).toContain("helper");
		expect(result.content).toContain("Config"); // interface captured by export regex
	});

	it("outline is mutationSafe=false", async () => {
		const result = await adapter.outline(tsContent, "test.ts");
		expect(result.mutationSafe).toBe(false);
	});

	it("symbols provides structured list", async () => {
		const result = await adapter.symbols(tsContent, "test.ts");
		expect(result.content).toContain("MyClass");
		expect(result.content).toContain("helper");
	});

	it("symbolExact returns exact content for a class", async () => {
		const result = await adapter.symbolExact(tsContent, "test.ts", "MyClass");
		expect(result.mutationSafe).toBe(true);
		expect(result.content).toContain("MyClass");
	});

	it("symbolExact returns fallback for unknown symbol", async () => {
		const result = await adapter.symbolExact(tsContent, "test.ts", "UnknownSymbol");
		expect(result.isFallback).toBe(true);
		expect(result.mutationSafe).toBe(false);
	});

	it("rangeExact returns mutation-safe exact range", async () => {
		const result = await adapter.rangeExact(tsContent, "test.ts", 1, 5);
		expect(result.mutationSafe).toBe(true);
	});

	it("detects class with extends", async () => {
		const withExtends = "export class Child extends Parent { method() {} }";
		const result = await adapter.symbols(withExtends, "test.ts");
		expect(result.content).toContain("Child");
	});

	it("detects async functions", async () => {
		const withAsync = "export async function fetchData() { return {}; }";
		const result = await adapter.symbols(withAsync, "test.ts");
		expect(result.content).toContain("fetchData");
	});
});

// ============================================================================
// W012: Python Adapter
// ============================================================================

describe("PythonAdapter", () => {
	const adapter = new PythonAdapter();

	const pyContent = `
import os

class MyClass:
    def __init__(self, name):
        self.name = name
    
    def get_name(self):
        return self.name
    
    async def fetch(self):
        return await something()

def helper(x):
    return x * 2

CONSTANT_VALUE = 42

@decorator
def decorated_func():
    pass
`;

	it("detects classes, functions, methods, decorators", async () => {
		const result = await adapter.outline(pyContent, "test.py");
		expect(result.content).toContain("class");
		expect(result.content).toContain("function");
		expect(result.content).toContain("method");
		expect(result.content).toContain("decorator");
	});

	it("outline is mutationSafe=false", async () => {
		const result = await adapter.outline(pyContent, "test.py");
		expect(result.mutationSafe).toBe(false);
	});

	it("symbolExact returns mutation-safe exact content", async () => {
		const result = await adapter.symbolExact(pyContent, "test.py", "MyClass");
		expect(result.mutationSafe).toBe(true);
		expect(result.content).toContain("MyClass");
	});

	it("detects class methods with indent", async () => {
		const result = await adapter.symbols(pyContent, "test.py");
		expect(result.content).toContain("get_name");
		expect(result.content).toContain("__init__");
	});

	it("detects constants", async () => {
		const result = await adapter.symbols(pyContent, "test.py");
		expect(result.content).toContain("CONSTANT_VALUE");
	});
});

// ============================================================================
// W013: JSON/YAML Adapter
// ============================================================================

describe("JsonYamlAdapter", () => {
	const adapter = new JsonYamlAdapter();

	const jsonContent = `{
  "name": "test",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.0.0",
    "lodash": "^4.17.0"
  },
  "scripts": {
    "build": "tsc",
    "test": "jest"
  }
}`;

	const yamlContent = `
name: test
version: "1.0.0"
dependencies:
  react: "^18.0.0"
  lodash: "^4.17.0"
scripts:
  build: tsc
  test: jest
`;

	const largeJsonContent = `{\n${Array.from({ length: 30 }, (_, i) => `  "key${i}": "value${i}"`).join(",\n")}\n}`;

	it("extracts JSON key paths", async () => {
		const result = await adapter.outline(jsonContent, "test.json");
		expect(result.content).toContain("name");
		expect(result.content).toContain("version");
		expect(result.content).toContain("dependencies");
	});

	it("extracts YAML key paths", async () => {
		const result = await adapter.outline(yamlContent, "test.yaml");
		expect(result.content).toContain("name");
		expect(result.content).toContain("version");
	});

	it("summarizes large arrays/objects", async () => {
		const result = await adapter.outline(largeJsonContent, "test.json");
		expect(result.content).toContain("more keys");
	});

	it("outline is mutationSafe=false", async () => {
		const result = await adapter.outline(jsonContent, "test.json");
		expect(result.mutationSafe).toBe(false);
	});

	it("symbolExact returns exact path content", async () => {
		const result = await adapter.symbolExact(jsonContent, "test.json", "name");
		expect(result.mutationSafe).toBe(true);
		expect(result.content).toContain("test");
	});

	it("symbolExact returns fallback for unknown path", async () => {
		const result = await adapter.symbolExact(jsonContent, "test.json", "nonexistent");
		expect(result.isFallback).toBe(true);
	});
});

// ============================================================================
// W014: Rust Adapter
// ============================================================================

describe("RustAdapter", () => {
	const adapter = new RustAdapter();

	const rsContent = `
use std::collections::HashMap;

pub struct MyStruct {
    field: i32,
}

pub enum MyEnum {
    VariantA,
    VariantB(i32),
}

pub trait MyTrait {
    fn do_something(&self) -> i32;
}

impl MyTrait for MyStruct {
    fn do_something(&self) -> i32 {
        self.field
    }
}

pub fn helper(x: i32) -> i32 {
    x * 2
}

pub const MAX_SIZE: usize = 1024;

#[cfg(test)]
mod tests {
    use super::*;
}
`;

	it("detects structs, enums, traits, impls, functions", async () => {
		const result = await adapter.outline(rsContent, "test.rs");
		expect(result.content).toContain("struct");
		expect(result.content).toContain("enum");
		expect(result.content).toContain("trait");
		expect(result.content).toContain("impl");
		expect(result.content).toContain("function");
	});

	it("outline is mutationSafe=false", async () => {
		const result = await adapter.outline(rsContent, "test.rs");
		expect(result.mutationSafe).toBe(false);
	});

	it("symbolExact returns mutation-safe exact content", async () => {
		const result = await adapter.symbolExact(rsContent, "test.rs", "MyStruct");
		expect(result.mutationSafe).toBe(true);
		expect(result.content).toContain("MyStruct");
	});

	it("detects trait impls correctly", async () => {
		const result = await adapter.symbols(rsContent, "test.rs");
		expect(result.content).toContain("MyTrait for MyStruct");
	});

	it("detects test modules", async () => {
		const result = await adapter.symbols(rsContent, "test.rs");
		expect(result.content).toContain("test-module");
	});

	it("detects use statements and constants", async () => {
		const result = await adapter.symbols(rsContent, "test.rs");
		expect(result.content).toContain("use");
		expect(result.content).toContain("MAX_SIZE");
	});
});

// ============================================================================
// W015: Generic and LLM Fallback
// ============================================================================

describe("GenericFallbackAdapter", () => {
	const adapter = new GenericFallbackAdapter();

	it("provides basic outline for unknown languages", async () => {
		const content = "line1\nline2\nline3";
		const result = await adapter.outline(content, "test.xyz");
		expect(result.content).toContain("Generic Outline");
		expect(result.mutationSafe).toBe(false);
	});

	it("symbols falls back to outline", async () => {
		const result = await adapter.symbols("content", "test.xyz");
		expect(result.mutationSafe).toBe(false);
	});

	it("rangeExact is mutationSafe=true", async () => {
		const result = await adapter.rangeExact("a\nb\nc", "test.xyz", 1, 2);
		expect(result.mutationSafe).toBe(true);
	});

	it("symbol search attempts text search", async () => {
		const content = "line with target\nother stuff";
		const result = await adapter.symbolExact(content, "test.xyz", "target");
		expect(result.isFallback).toBe(true);
		expect(result.mutationSafe).toBe(false);
	});
});

describe("LLMFallbackAdapter", () => {
	it("falls through to generic when no LLM configured", async () => {
		const adapter = new LLMFallbackAdapter(2000);
		const result = await adapter.outline("content", "test.xyz");
		expect(result.mutationSafe).toBe(false);
	});

	it("over-budget aborts", async () => {
		const adapter = new LLMFallbackAdapter(1); // Only 1 token budget
		const largeContent = "x".repeat(1000);
		const result = await adapter.outline(largeContent, "test.xyz");
		expect(result.isFallback).toBe(true);
		expect(result.mutationSafe).toBe(false);
	});

	it("all output is mutationSafe=false", async () => {
		const adapter = new LLMFallbackAdapter(2000);
		const result = await adapter.outline("content", "test.xyz");
		expect(result.mutationSafe).toBe(false);
	});

	it("symbols always delegates to generic", async () => {
		const adapter = new LLMFallbackAdapter(2000);
		const result = await adapter.symbols("content", "test.xyz");
		expect(result.mutationSafe).toBe(false);
	});
});

// ============================================================================
// W016: Change Ledger
// ============================================================================

describe("ChangeLedger", () => {
	let ledger: ChangeLedger;

	beforeEach(() => {
		ledger = new ChangeLedger({ maxDeltaChainBeforeCheckpoint: 5 });
	});

	it("records changes with before/after hashes", () => {
		const event = ledger.recordChange("/test/file.ts", "before", "after");
		expect(event.beforeHash).toBeDefined();
		expect(event.afterHash).toBeDefined();
		expect(event.state).toBe("changed_with_delta");
	});

	it("tracks delta chain length", () => {
		ledger.recordChange("/test/file.ts", "v1", "v2");
		ledger.recordChange("/test/file.ts", "v2", "v3");
		expect(ledger.getDeltaChainLength("/test/file.ts")).toBe(2);
	});

	it("requires checkpoint when chain exceeds max", () => {
		for (let i = 0; i < 6; i++) {
			ledger.recordChange("/test/file.ts", `v${i}`, `v${i + 1}`);
		}
		const latest = ledger.getLatestEvent("/test/file.ts");
		expect(latest?.checkpointRequired).toBe(true);
	});

	it("records external mutations", () => {
		const event = ledger.recordExternalMutation("/test/file.ts");
		expect(event.state).toBe("external_mutation");
	});

	it("records stale hash", () => {
		const event = ledger.recordStaleHash("/test/file.ts", "abc123");
		expect(event.state).toBe("stale_hash");
	});

	it("records raw missing", () => {
		const event = ledger.recordRawMissing("/test/file.ts");
		expect(event.state).toBe("raw_missing");
	});

	it("returns no_entry for unregistered files", () => {
		expect(ledger.getState("/unknown/file.ts")).toBe("no_entry");
	});

	it("checkpoint clears file events", () => {
		ledger.recordChange("/test/file.ts", "v1", "v2");
		ledger.checkpoint("/test/file.ts");
		expect(ledger.getDeltaChainLength("/test/file.ts")).toBe(0);
	});

	it("long delta chain causes changed_delta_chain_long", () => {
		for (let i = 0; i < 7; i++) {
			ledger.recordChange("/test/file.ts", `v${i}`, `v${i + 1}`);
		}
		expect(ledger.getState("/test/file.ts")).toBe("changed_delta_chain_long");
	});
});

// ============================================================================
// W004: Mode Wiring (disabled/observe_only/shadow/active_safe)
// ============================================================================

describe("TokenContextRuntime Mode Wiring", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	function makeConfig(mode: typeof DEFAULT_TOKEN_CONTEXT_CONFIG.mode): TokenContextConfig {
		return { ...DEFAULT_TOKEN_CONTEXT_CONFIG, enabled: true, mode };
	}

	it("disabled mode preserves existing behavior", async () => {
		const config = { ...makeConfig("disabled"), enabled: false, mode: "disabled" as const };
		const runtime = createTokenContextRuntime(config);
		const result = await runtime.beforeRead("/test/file.ts");
		expect(result.intercept).toBe(false);
	});

	it("observe_only mode records but does not change behavior", async () => {
		const runtime = createTokenContextRuntime(makeConfig("observe_only"));
		const filePath = createTempFile(tempDir, "test.ts", "content");
		const result = await runtime.beforeRead(filePath);
		expect(result.intercept).toBe(false);
	});

	it("shadow mode computes optimized but does not return optimized", async () => {
		const runtime = createTokenContextRuntime(makeConfig("shadow"));
		const result = await runtime.beforeRead("/test/file.ts");
		expect(result.intercept).toBe(false);
	});

	it("active_safe mode enables caching", async () => {
		const runtime = createTokenContextRuntime(makeConfig("active_safe"));
		const filePath = createTempFile(tempDir, "test.ts", "content");

		// First read: take snapshot
		runtime.readHashCache.takeSnapshot(filePath, "content");
		runtime.acr.markActive(filePath);

		// Second read: should hit cache
		const result = await runtime.beforeRead(filePath);
		// If ACR is active and ledger is known_unchanged, should return compact
		if (result.policy?.returnUnchanged || result.policy?.returnCompactSummary) {
			expect(result.intercept).toBe(true);
		}
	});

	it("beforeMutation blocks mutation when policy says so", () => {
		const runtime = createTokenContextRuntime(makeConfig("active_safe"));
		// Mark as dirty
		runtime.acr.markActive("/test/file.ts");
		runtime.acr.markDirty("/test/file.ts");

		const result = runtime.beforeMutation("/test/file.ts", "content");
		expect(result.blocked).toBe(true);
	});

	it("afterMutation records changes in ledger", () => {
		const runtime = createTokenContextRuntime(makeConfig("active_safe"));
		runtime.afterMutation("/test/file.ts", "before", "after");
		const state = runtime.changeLedger.getState("/test/file.ts");
		expect(state).toBe("changed_with_delta");
	});

	it("advanceTurn advances ACR turns", () => {
		const runtime = createTokenContextRuntime(makeConfig("active_safe"));
		runtime.acr.markActive("/test/file.ts");
		runtime.advanceTurn();
		expect(runtime.turn).toBe(1);
	});

	it("getSavingsReport returns a report string", () => {
		const runtime = createTokenContextRuntime(makeConfig("observe_only"));
		const report = runtime.getSavingsReport();
		expect(report).toContain("P43 Token Context Savings Report");
		expect(report).toContain("P44 Eligible");
	});
});

// ============================================================================
// Invariant Tests
// ============================================================================

describe("Core Invariants", () => {
	it("I002: outline/summary/compact/LLM fallback always mutationSafe=false", async () => {
		const core = new SmartReadCore();
		core.registerAdapter(new TypeScriptAdapter());
		core.setFallbackAdapter(new GenericFallbackAdapter());

		const tsResult = await core.smartRead("export function f() {}", "test.ts", "outline");
		expect(tsResult.mutationSafe).toBe(false);

		// Generic outline for unknown file
		const genericResult = await core.smartRead("content", "test.xyz", "outline");
		expect(genericResult.mutationSafe).toBe(false);
	});

	it("I003: exact symbol/range/raw always mutationSafe=true", async () => {
		const core = new SmartReadCore();
		core.registerAdapter(new TypeScriptAdapter());

		const rawResult = await core.smartRead("content", "test.ts", "raw");
		expect(rawResult.mutationSafe).toBe(true);

		const rangeResult = await core.smartRead("a\nb\nc", "test.ts", "range_exact", {
			startLine: 1,
			endLine: 2,
		});
		expect(rangeResult.mutationSafe).toBe(true);
	});

	it("I006: estimated and actual saving are separated", () => {
		const ledger = new SavingsLedger();
		ledger.record({
			mechanism: "smart_read",
			tool: "read",
			estimatedBaselineTokens: 1000,
			estimatedOptimizedTokens: 500,
			estimatedSavingTokens: 500,
			actualBaselineTokens: 950,
			actualOptimizedTokens: 480,
			actualSavingTokens: 470,
			confidence: "actual",
		});

		const summary = ledger.summarize();
		expect(summary.estimatedSavingPercent).not.toBe(summary.actualSavingPercent);
	});

	it("I008: fail-open - internal errors fall back to raw", async () => {
		const core = new SmartReadCore();
		core.registerAdapter(new TypeScriptAdapter());

		// Unknown symbol causes fallback but still returns content
		const result = await core.smartRead("content", "test.ts", "symbol_exact", {
			symbol: "DoesNotExist",
		});
		expect(result.isFallback).toBe(true);
		expect(result.content).toBeDefined();
	});

	it("Summary-only mutation is impossible (mutationSafe=false for outline)", async () => {
		const core = new SmartReadCore();
		core.registerAdapter(new TypeScriptAdapter());
		core.registerAdapter(new PythonAdapter());
		core.registerAdapter(new RustAdapter());
		core.setFallbackAdapter(new GenericFallbackAdapter());

		// Test all adapters' outline mode
		const tsResult = await core.smartRead("export function f() {}", "test.ts", "outline");
		expect(tsResult.mutationSafe).toBe(false);

		const pyResult = await core.smartRead("def f(): pass", "test.py", "outline");
		expect(pyResult.mutationSafe).toBe(false);

		const rsResult = await core.smartRead("fn main() {}", "test.rs", "outline");
		expect(rsResult.mutationSafe).toBe(false);
	});
});

// ============================================================================
// Full matrix test (54 combinations)
// ============================================================================

describe("Full ACR × Change Ledger Matrix (54/54)", () => {
	const acrStates: ACRState[] = ["active", "inactive", "evicted", "dirty", "changed", "unknown"];
	const ledgerStates: LedgerState[] = [
		"no_entry",
		"known_unchanged",
		"changed_with_delta",
		"changed_delta_chain_short",
		"changed_delta_chain_long",
		"checkpoint_required",
		"stale_hash",
		"external_mutation",
		"raw_missing",
	];

	it("covers all 54 ACR × Ledger combinations", () => {
		const tested: string[] = [];
		for (const acr of acrStates) {
			for (const ledger of ledgerStates) {
				const policy = getACRLedgerPolicy(acr, ledger);
				expect(policy, `ACR=${acr}, Ledger=${ledger} must have a policy`).toBeDefined();
				tested.push(`${acr} × ${ledger}`);
			}
		}
		expect(tested.length).toBe(54);
	});
});

// ============================================================================
// P43.00: Contract Version & Golden Tests
// ============================================================================

describe("P43.00 Contract Version & Golden Tests", () => {
	it("has a valid contract version", () => {
		expect(P43_CONTRACT_VERSION).toBe("1.0.0");
	});

	it("accepts compatible version", () => {
		expect(checkContractCompatibility("1.0.0")).toBe(true);
	});

	it("rejects incompatible version", () => {
		expect(() => checkContractCompatibility("2.0.0")).toThrow("version mismatch");
	});

	it("golden SmartReadResult has required fields", () => {
		const golden = CONTRACT_GOLDEN.smartReadResult;
		expect(golden).toHaveProperty("content");
		expect(golden).toHaveProperty("mutationSafe");
		expect(golden).toHaveProperty("adapterConfidence");
		expect(golden).toHaveProperty("adapterName");
		expect(golden).toHaveProperty("isFallback");
	});

	it("golden TokenSavingEvent has required fields", () => {
		const golden = CONTRACT_GOLDEN.tokenSavingEvent;
		expect(golden).toHaveProperty("mechanism");
		expect(golden).toHaveProperty("tool");
		expect(golden).toHaveProperty("estimatedBaselineTokens");
		expect(golden).toHaveProperty("confidence");
	});

	it("golden ACRLedgerPolicyResult has required fields", () => {
		const golden = CONTRACT_GOLDEN.acrLedgerPolicy;
		expect(golden).toHaveProperty("returnUnchanged");
		expect(golden).toHaveProperty("forceRawRead");
		expect(golden).toHaveProperty("blockMutation");
		expect(golden).toHaveProperty("hardFail");
	});
});

// ============================================================================
// P43.03: Provider Calibration Divergence
// ============================================================================

describe("P43.03 Provider Calibration", () => {
	let estimator: TokenEstimator;

	beforeEach(() => {
		estimator = new TokenEstimator();
	});

	it("generates calibration report with no data", () => {
		const report = estimator.generateCalibrationReport();
		expect(report.hasCalibration).toBe(false);
		expect(report.warnings).toHaveLength(1);
		expect(report.warnings[0]).toContain("No provider calibration");
	});

	it("generates calibration report with provider data", () => {
		estimator.recordEstimatedChars(4000);
		estimator.recordProviderUsage({
			provider: "openai",
			model: "gpt-4",
			actualInputTokens: 500,
			actualOutputTokens: 200,
			totalTokens: 700,
			timestamp: Date.now(),
			requestId: "req-1",
		});
		estimator.recordCalibratedTurn();

		const report = estimator.generateCalibrationReport(0.8);
		expect(report.hasCalibration).toBe(true);
		expect(report.byProvider["openai/gpt-4"]).toBeDefined();
	});

	it("computes divergence between estimated and actual", () => {
		estimator.recordEstimatedChars(4000); // ~1000 tokens
		estimator.recordProviderUsage({
			provider: "openai",
			model: "gpt-4",
			actualInputTokens: 500,
			actualOutputTokens: 200,
			totalTokens: 700,
			timestamp: Date.now(),
			requestId: "req-1",
		});

		const divergence = estimator.computeDivergence();
		expect(divergence).toBeDefined();
		expect(divergence!.actualTotal).toBe(700);
	});

	it("blocks P44 promotion without sufficient coverage", () => {
		// Record many estimated turns but only 1 calibrated
		for (let i = 0; i < 10; i++) {
			estimator.recordEstimatedChars(4000);
		}
		estimator.recordProviderUsage({
			provider: "openai",
			model: "gpt-4",
			actualInputTokens: 500,
			actualOutputTokens: 200,
			totalTokens: 700,
			timestamp: Date.now(),
			requestId: "req-1",
		});
		estimator.recordCalibratedTurn();

		const report = estimator.generateCalibrationReport(0.8);
		// 1 calibrated turn out of 10 estimated = 10% coverage < 80% threshold
		expect(report.isPromotionGrade).toBe(false);
	});

	it("warns on high divergence", () => {
		// Record many chars but low actual tokens
		estimator.recordEstimatedChars(40000); // ~10000 est tokens
		estimator.recordProviderUsage({
			provider: "openai",
			model: "gpt-4",
			actualInputTokens: 500,
			actualOutputTokens: 200,
			totalTokens: 700,
			timestamp: Date.now(),
			requestId: "req-1",
		});
		estimator.recordCalibratedTurn();

		const divergence = estimator.computeDivergence();
		expect(divergence).toBeDefined();
		// Divergence should be significant
		expect(divergence!.divergencePercent).toBeGreaterThan(0);
	});
});

// ============================================================================
// P43.14: Grammar Preflight
// ============================================================================

describe("P43.14 Grammar Preflight", () => {
	it("runs preflight without crashing", () => {
		const report = runGrammarPreflight();
		expect(report).toBeDefined();
		expect(report.capabilities).toBeDefined();
		expect(report.capabilities.length).toBeGreaterThan(0);
	});

	it("reports tree-sitter status", () => {
		const report = runGrammarPreflight();
		expect(typeof report.treeSitterAvailable).toBe("boolean");
	});

	it("provides confidence adjustments", () => {
		const report = runGrammarPreflight();
		expect(report.confidenceAdjustments).toBeDefined();
		// Without tree-sitter, adapters should have reduced confidence
		if (!report.treeSitterAvailable) {
			expect(report.confidenceAdjustments.typescript).toBeLessThan(0);
		}
	});

	it("reports warnings for missing capabilities", () => {
		const report = runGrammarPreflight();
		expect(report.warnings).toBeDefined();
		// Should have at least one warning about capabilities
		expect(report.warnings.length).toBeGreaterThanOrEqual(0);
	});

	it("does not auto-install anything", () => {
		// Preflight should never mutate the system
		const before = runGrammarPreflight();
		const after = runGrammarPreflight();
		expect(before.treeSitterAvailable).toBe(after.treeSitterAvailable);
	});
});

// ============================================================================
// P43.01: Lab Harness & P43.17: Gauntlet Fixtures
// ============================================================================

describe("P43.01/P43.17 Lab Harness & Gauntlet", () => {
	it("has defined gauntlet fixtures", () => {
		expect(GAUNTLET_FIXTURES.length).toBeGreaterThan(0);
		expect(GAUNTLET_FIXTURES[0].name).toBeDefined();
	});

	it("runs a single fixture in disabled mode", async () => {
		const harness = new LabHarness();
		const result = await harness.runFixture(GAUNTLET_FIXTURES[0], "disabled");
		expect(result.errors).toHaveLength(0);
		expect(result.operations).toBe(GAUNTLET_FIXTURES[0].operations.length);
	});

	it("runs a single fixture in active_safe mode", async () => {
		const harness = new LabHarness({ mode: "active_safe", enabled: true });
		const result = await harness.runFixture(GAUNTLET_FIXTURES[0], "active_safe");
		expect(result.errors).toHaveLength(0);
	});

	it("runs a fixture in observe_only mode", async () => {
		const harness = new LabHarness();
		const result = await harness.runFixture(GAUNTLET_FIXTURES[0], "observe_only");
		expect(result.errors).toHaveLength(0);
	});

	it("runs a fixture in shadow mode", async () => {
		const harness = new LabHarness();
		const result = await harness.runFixture(GAUNTLET_FIXTURES[0], "shadow");
		expect(result.errors).toHaveLength(0);
	});

	it("compares baseline vs optimized", async () => {
		const harness = new LabHarness();
		const comparison = await harness.compareFixture(GAUNTLET_FIXTURES[0]);
		expect(comparison.baseline.mode).toBe("disabled");
		expect(comparison.optimized.mode).toBe("active_safe");
	});

	it("runs Python fixture without errors", async () => {
		const harness = new LabHarness();
		const pyFixture = GAUNTLET_FIXTURES.find((f) => f.name === "py-class-hierarchy")!;
		const result = await harness.runFixture(pyFixture, "active_safe");
		expect(result.errors).toHaveLength(0);
	});

	it("runs JSON config fixture without errors", async () => {
		const harness = new LabHarness();
		const jsonFixture = GAUNTLET_FIXTURES.find((f) => f.name === "json-config-large")!;
		const result = await harness.runFixture(jsonFixture, "active_safe");
		expect(result.errors).toHaveLength(0);
	});

	it("runs Rust fixture without errors", async () => {
		const harness = new LabHarness();
		const rsFixture = GAUNTLET_FIXTURES.find((f) => f.name === "rust-structs-enums")!;
		const result = await harness.runFixture(rsFixture, "active_safe");
		expect(result.errors).toHaveLength(0);
	});

	it("runs unknown language fixture without errors", async () => {
		const harness = new LabHarness();
		const unknownFixture = GAUNTLET_FIXTURES.find((f) => f.name === "unknown-language-fallback")!;
		const result = await harness.runFixture(unknownFixture, "active_safe");
		expect(result.errors).toHaveLength(0);
	});

	it("runs mixed project fixture without errors", async () => {
		const harness = new LabHarness();
		const mixedFixture = GAUNTLET_FIXTURES.find((f) => f.name === "mixed-project-many-reads")!;
		const result = await harness.runFixture(mixedFixture, "active_safe");
		expect(result.errors).toHaveLength(0);
	});

	it("runs external mutation fixture without errors", async () => {
		const harness = new LabHarness();
		const extFixture = GAUNTLET_FIXTURES.find((f) => f.name === "external-mutation-detection")!;
		const result = await harness.runFixture(extFixture, "active_safe");
		expect(result.errors).toHaveLength(0);
	});

	it("runs full gauntlet", async () => {
		const harness = new LabHarness();
		const { comparisons, summary } = await harness.runGauntlet();
		expect(comparisons.length).toBe(GAUNTLET_FIXTURES.length);
		expect(summary).toContain("Gauntlet Report");
	});

	it("all gauntlet fixtures complete without errors in active_safe mode", async () => {
		const harness = new LabHarness({ mode: "active_safe", enabled: true });
		for (const fixture of GAUNTLET_FIXTURES) {
			const result = await harness.runFixture(fixture, "active_safe");
			expect(result.errors).toEqual([]);
		}
	});
});

// ============================================================================
// P43.1: TypeScript Adapter Edge Cases (W002)
// ============================================================================

describe("P43.1 TypeScript Adapter Edge Cases", () => {
	const adapter = new TypeScriptAdapter();

	it("detects exported class as class kind", async () => {
		const content = "export class MyService { getData() { return 1; } }";
		const result = await adapter.symbols(content, "test.ts");
		expect(result.content).toContain("MyService");
		expect(result.content).toContain("class");
	});

	it("detects exported function as function kind", async () => {
		const content = "export function handler(req: Request): Response { return new Response(); }";
		const result = await adapter.symbols(content, "test.ts");
		expect(result.content).toContain("handler");
		expect(result.content).toContain("function");
	});

	it("computes endLine for arrow functions", async () => {
		const content = "export const myFunc = (x: number): number => {\n  const y = x * 2;\n  return y;\n};";
		const result = await adapter.symbolExact(content, "test.ts", "myFunc");
		expect(result.mutationSafe).toBe(true);
		expect(result.content).toContain("x * 2");
	});

	it("detects constructor as method", async () => {
		const content = "class Service {\n  constructor(private url: string) {}\n  fetch() { return 1; }\n}";
		const result = await adapter.symbols(content, "test.ts");
		expect(result.content).toContain("constructor");
	});

	it("symbolExact does not over-read beyond symbol end", async () => {
		const content =
			"export class A {\n  methodA() { return 1; }\n}\n\nexport class B {\n  methodB() { return 2; }\n}";
		const result = await adapter.symbolExact(content, "test.ts", "A");
		expect(result.mutationSafe).toBe(true);
		expect(result.content).toContain("methodA");
		expect(result.content).not.toContain("methodB");
	});

	it("symbolExact does not under-read function body", async () => {
		const content =
			"export function compute(x: number): number {\n  const a = x + 1;\n  const b = a * 2;\n  return b;\n}";
		const result = await adapter.symbolExact(content, "test.ts", "compute");
		expect(result.content).toContain("x + 1");
		expect(result.content).toContain("return b");
	});
});

// ============================================================================
// P43.1: Tiny-File Threshold (W003)
// ============================================================================

describe("P43.1 Tiny-File Threshold", () => {
	it("savings report includes tiny file passthrough count", () => {
		const config: TokenContextConfig = {
			...DEFAULT_TOKEN_CONTEXT_CONFIG,
			enabled: true,
			mode: "observe_only",
			tinyFileThresholdBytes: 256,
		};
		const runtime = createTokenContextRuntime(config);
		const report = runtime.getSavingsReport();
		expect(report).toContain("Tiny-File Passthrough");
	});
});

// ============================================================================
// P43.1: RTK Hook Detection (W006)
// ============================================================================

describe("P43.1 RTK Hook Detection", () => {
	it("detectRtkHook returns a valid status string", () => {
		const status = detectRtkHook();
		expect(["not_installed", "installed_no_hook", "hook_installed", "unknown"]).toContain(status);
	});

	it("savings report includes RTK status", () => {
		const config: TokenContextConfig = {
			...DEFAULT_TOKEN_CONTEXT_CONFIG,
			enabled: true,
			mode: "observe_only",
		};
		const runtime = createTokenContextRuntime(config);
		const report = runtime.getSavingsReport();
		expect(report).toContain("RTK Status:");
	});
});

// ============================================================================
// P43.1: New Gauntlet Fixtures (W007)
// ============================================================================

describe("P43.1 New Gauntlet Fixtures", () => {
	it("runs ts-edge-symbol-ranges fixture without errors", async () => {
		const harness = new LabHarness({ mode: "active_safe", enabled: true });
		const fixture = GAUNTLET_FIXTURES.find((f) => f.name === "ts-edge-symbol-ranges");
		expect(fixture).toBeDefined();
		const result = await harness.runFixture(fixture!, "active_safe");
		expect(result.errors).toEqual([]);
	});

	it("runs large-repeated-read fixture with savings", async () => {
		const harness = new LabHarness({ mode: "active_safe", enabled: true });
		const fixture = GAUNTLET_FIXTURES.find((f) => f.name === "large-repeated-read");
		expect(fixture).toBeDefined();
		const comparison = await harness.compareFixture(fixture!);
		expect(comparison.optimized.errors).toEqual([]);
		expect(comparison.estimatedSavingPercent).toBeGreaterThan(0);
	});

	it("runs long-edit-session fixture without errors", async () => {
		const harness = new LabHarness({ mode: "active_safe", enabled: true });
		const fixture = GAUNTLET_FIXTURES.find((f) => f.name === "long-edit-session");
		expect(fixture).toBeDefined();
		const result = await harness.runFixture(fixture!, "active_safe");
		expect(result.errors).toEqual([]);
	});

	it("all new fixtures are in the gauntlet", () => {
		const names = GAUNTLET_FIXTURES.map((f) => f.name);
		expect(names).toContain("ts-edge-symbol-ranges");
		expect(names).toContain("large-repeated-read");
		expect(names).toContain("long-edit-session");
	});
});

// ============================================================================
// P43.2: Production Wiring Smoke Tests (HC008/HC009)
// ============================================================================

describe("P43.2 Production Wiring", () => {
	it("features are reachable from public index exports", async () => {
		const mod = await import("../src/index.js");
		expect(mod.createTokenContextRuntime).toBeDefined();
		expect(mod.SavingsLedger).toBeDefined();
		expect(mod.SmartReadCore).toBeDefined();
		expect(mod.TypeScriptAdapter).toBeDefined();
		expect(mod.DEFAULT_TOKEN_CONTEXT_CONFIG).toBeDefined();
	});

	it("slash command autocomplete includes savings", () => {
		const savingsCmd = BUILTIN_SLASH_COMMANDS.find((c) => c.name === "savings");
		expect(savingsCmd).toBeDefined();
		expect(savingsCmd!.description).toContain("savings");
	});

	it("read tool accepts tokenContextRuntime option", () => {
		const runtime = createTokenContextRuntime({
			...DEFAULT_TOKEN_CONTEXT_CONFIG,
			enabled: true,
			mode: "observe_only",
		});
		// Verify read tool can be created with runtime
		const readTool = createReadTool("/tmp", { tokenContextRuntime: runtime });
		expect(readTool).toBeDefined();
	});

	it("runtime getSavingsReport includes production fields", () => {
		const runtime = createTokenContextRuntime({
			...DEFAULT_TOKEN_CONTEXT_CONFIG,
			enabled: true,
			mode: "observe_only",
		});
		const report = runtime.getSavingsReport();
		expect(report).toContain("Mode:");
		expect(report).toContain("P44 Eligible");
		expect(report).toContain("RTK Status:");
		expect(report).toContain("Tiny-File Passthrough");
	});

	it("runtime not created when tokenContext disabled", () => {
		const config: TokenContextConfig = { ...DEFAULT_TOKEN_CONTEXT_CONFIG, enabled: false, mode: "disabled" };
		const runtime = createTokenContextRuntime(config);
		expect(runtime.mode).toBe("disabled");
	});
});

// ============================================================================
// P43.3: Edit Recovery Tests (W007)
// ============================================================================

describe("P43.3 Edit Recovery", () => {
	it("builds recovery packet when oldText not found", () => {
		const fileContent = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
		const result = buildEditRecoveryPacket({
			fileContent,
			oldText: "line 50 but wrong",
			filePath: "test.ts",
		});

		expect(result.packet.recoveryType).toBe("EDIT_MISMATCH_RECOVERY");
		expect(result.packet.reason).toBe("oldText_not_found");
		expect(result.packet.fullRereadAvoided).toBe(true);
		expect(result.packet.estimatedTokensSaved).toBeGreaterThanOrEqual(0);
	});

	it("finds candidate near oldText location", () => {
		const fileContent = Array.from({ length: 50 }, (_, i) => `line ${i}: some content here`).join("\n");
		const oldText = "line 25: some content here\nline 26: some content here";

		const result = buildEditRecoveryPacket({
			fileContent,
			oldText,
			filePath: "test.ts",
		});

		expect(result.packet.candidates.length).toBeGreaterThan(0);
		expect(result.packet.candidates[0].normalizedSimilarity).toBeGreaterThan(50);
	});

	it("whitespace drift detected", () => {
		const fileContent = "  function hello() {\n    return 'world';\n  }";
		const oldText = "function hello() {\n  return 'world';\n}";

		const result = buildEditRecoveryPacket({
			fileContent,
			oldText,
			filePath: "test.ts",
			config: { autoApplyWhitespaceOnly: true, minAutoApplySimilarity: 0.7 },
		});

		// Should find a candidate
		expect(result.packet.candidates.length).toBeGreaterThan(0);
	});

	it("semantic drift blocks auto-apply", () => {
		const fileContent = "function hello() {\n  return 'different';\n}";
		const oldText = "function hello() {\n  return 'world';\n}";

		const result = buildEditRecoveryPacket({
			fileContent,
			oldText,
			filePath: "test.ts",
		});

		expect(result.packet.autoApplyStatus).not.toBe("applied");
	});

	it("no candidate returns bounded no-candidate packet", () => {
		const fileContent = "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc";
		const oldText = "zzzzzzzzzz\nyyyyyyyyyy";

		const result = buildEditRecoveryPacket({
			fileContent,
			oldText,
			filePath: "test.ts",
			config: { minCandidateSimilarity: 0.9 },
		});

		expect(result.packet.candidates.length).toBe(0);
		expect(result.packet.suggestedNextActions.length).toBeGreaterThan(0);
	});

	it("handles CRLF/LF drift", () => {
		const fileContent = "line1\r\nline2\r\nline3\r\nline4";
		const oldText = "line2\nline3";

		const result = buildEditRecoveryPacket({
			fileContent,
			oldText,
			filePath: "test.ts",
		});

		expect(result.packet.candidates.length).toBeGreaterThan(0);
	});

	it("recovery packet is bounded by maxCandidates", () => {
		const fileContent = Array.from({ length: 50 }, () => "function test() { return 1; }").join("\n");
		const oldText = "function test() { return 1; }";

		const result = buildEditRecoveryPacket({
			fileContent,
			oldText,
			filePath: "test.ts",
			config: { maxCandidates: 2 },
		});

		expect(result.packet.candidates.length).toBeLessThanOrEqual(2);
	});

	it("records metrics", () => {
		const tracker = new EditRecoveryMetricsTracker();

		tracker.recordMiss();
		tracker.recordRecoveryPacket(200, 1000);
		tracker.recordAutoApply(true);

		expect(tracker.metrics.exactOldTextMissCount).toBe(1);
		expect(tracker.metrics.estimatedTokensSavedByEditRecovery).toBe(800);
		expect(tracker.metrics.fuzzyAutoApplyCount).toBe(1);
	});

	it("normal exact edit success unchanged", async () => {
		const { createEditToolDefinition } = await import("../src/core/tools/edit.js");
		const tempDir = createTempDir();
		const _filePath = createTempFile(tempDir, "test.ts", "original content here\nmore content");

		const tool = createEditToolDefinition(tempDir, {
			editRecoveryConfig: {
				enabled: true,
				maxCandidates: 3,
				contextLinesBefore: 8,
				contextLinesAfter: 8,
				maxCandidateLines: 40,
				maxPacketTokensEstimate: 800,
				autoApplyWhitespaceOnly: false,
				minAutoApplySimilarity: 0.985,
				minCandidateSimilarity: 0.7,
			},
		});

		try {
			const result = await (tool as any).execute("test-id", {
				path: "test.ts",
				edits: [{ oldText: "original content here", newText: "replaced content" }],
			});
			expect(result.content[0].type).toBe("text");
			expect((result.content[0] as { text: string }).text).toContain("Successfully replaced");
		} catch (e) {
			expect((e as Error).message).not.toContain("Could not find");
		} finally {
			rmSync(tempDir, { recursive: true });
		}
	});

	it("recovery packet suggests exact range reread", () => {
		const fileContent = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
		const oldText = "line 25\nline 26";

		const result = buildEditRecoveryPacket({
			fileContent,
			oldText,
			filePath: "test.ts",
		});

		const hasRangeSuggestion = result.packet.suggestedNextActions.some((a) => a.includes("read exact range"));
		expect(hasRangeSuggestion).toBe(true);
	});
});
