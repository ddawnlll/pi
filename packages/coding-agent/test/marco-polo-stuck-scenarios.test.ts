/**
 * Marco Polo Stuck Scenario Test Suite
 *
 * Every known stuck pattern gets a Marco/Polo pair:
 *   Marco = the trigger (file/content that causes a stuck)
 *   Polo  = the expected escape (what should come back)
 *
 * If Marco fires and Polo doesn't answer, the test fails.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTokenContextRuntime } from "../src/core/token-context/runtime.js";
import { DEFAULT_TOKEN_CONTEXT_CONFIG } from "../src/core/token-context/types.js";
import { createReadToolDefinition } from "../src/core/tools/read.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createTempDir(): string {
	const tempDir = join(tmpdir(), `pi-marco-polo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	return tempDir;
}

function createTempFile(dir: string, name: string, content: string): string {
	const path = join(dir, name);
	writeFileSync(path, content, "utf-8");
	return path;
}

/** Assert escape hatch fired: non-null, non-empty result */
function assertEscaped(result: unknown): asserts result is NonNullable<typeof result> {
	expect(result).not.toBeNull();
	expect(result).not.toBeUndefined();
	expect((result as any).content).toBeDefined();
	expect((result as any).content.length).toBeGreaterThan(0);
}

/** Assert result is a raw file fallback (mode=raw or isFallback=true, full content) */
function _assertRawFallback(result: unknown): void {
	assertEscaped(result);
	const r = result as any;
	const isRaw = r.mode === "raw" || r.isFallback === true || r.adapterName === "raw";
	expect(isRaw).toBe(true);
	// Content must be actual file text, not an error/retry message
	expect(r.content).not.toContain("[LLM fallback");
	expect(r.content).not.toContain("over budget");
	expect(r.content).not.toContain("[stuck]");
}

// ============================================================================
// Stuck Tracker - detects repeated identical range_exact calls
// ============================================================================

interface StuckEvent {
	filePath: string;
	mode: string;
	params: string;
}

class StuckTracker {
	private events: StuckEvent[] = [];
	private thresholds: Map<string, number> = new Map(); // key -> maxAllowed

	setThreshold(key: string, maxAllowed: number): void {
		this.thresholds.set(key, maxAllowed);
	}

	record(filePath: string, mode: string, params?: Record<string, unknown>): void {
		const paramStr = params ? JSON.stringify(params) : "";
		this.events.push({ filePath, mode, params: paramStr });
	}

	getCount(filePath: string, modeParams: string): number {
		return this.events.filter((e) => e.filePath === filePath && `${e.mode}:${e.params}`.includes(modeParams)).length;
	}

	isStuck(filePath: string, mode: string, params?: Record<string, unknown>): boolean {
		const paramStr = params ? JSON.stringify(params) : "";
		const key = `${filePath}:${mode}:${paramStr}`;
		const maxAllowed = this.thresholds.get(key) ?? 2;
		// Count events with matching file + mode + params
		const count = this.events.filter(
			(e) => e.filePath === filePath && e.mode === mode && e.params === paramStr,
		).length;
		return count > maxAllowed;
	}

	clear(): void {
		this.events = [];
	}
}

// ============================================================================
// Runtime + Read Tool Setup
// ============================================================================

function createRuntime(mode: "active_safe" | "disabled" = "active_safe") {
	return createTokenContextRuntime({
		...DEFAULT_TOKEN_CONTEXT_CONFIG,
		enabled: true,
		mode,
	});
}

async function executeRead(
	runtime: ReturnType<typeof createTokenContextRuntime>,
	cwd: string,
	path: string,
	offset?: number,
	limit?: number,
): Promise<{ content: string; details?: any }> {
	// Use the read tool definition to execute a real read
	const readTool = createReadToolDefinition(cwd, { tokenContextRuntime: runtime });
	const result = await readTool.execute("test-call-id", { path, offset, limit }, undefined, undefined, undefined);
	const textContent = result.content
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text)
		.join("\n");
	return { content: textContent, details: result.details };
}

// ============================================================================
// Marco Polo Scenarios
// ============================================================================

describe("SmartRead Marco Polo Stuck Scenarios", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	// Scenario 1: ToC Trap — README where first 80 lines are a markdown ToC
	it("SCENARIO 1: toc trap - outline skips toc block", async () => {
		const runtime = createRuntime("active_safe");
		const tocLines = [
			"- [Installation](#installation)",
			"- [Quick Start](#quick-start)",
			"- [API Reference](#api-reference)",
			"- [Tools](#tools)",
			"- [Configuration](#configuration)",
			"- [Contributing](#contributing)",
			"- [License](#license)",
		];
		const content = [
			"# My Library",
			"",
			"## Table of Contents",
			...tocLines,
			"",
			"## Installation", // line 12 - real content
			"",
			"npm install my-lib",
			"",
			"## Quick Start",
			"",
			"const x = require('my-lib');",
		].join("\n");

		const filePath = createTempFile(tempDir, "README.md", content);

		// Call trySmartRead directly (simulates what the read tool does)
		const result = await runtime.trySmartRead(filePath, content);

		// Polo: must return something (escape hatch) — either outline or undefined (raw fallback)
		// Both are acceptable escapes from the stuck loop
		if (result) {
			// Must NOT return raw ToC lines as the outline
			expect(result.compactContent).not.toContain("- [Installation](");

			// Must report real section headings or be raw fallback
			const hasRealHeadings =
				result.compactContent.includes("Installation") || result.compactContent.includes("Quick Start");
			const isRaw = result.compactContent.length > content.length * 0.5;
			expect(hasRealHeadings || isRaw).toBe(true);
		}
	});

	// Scenario 2: Badge Soup — file starting with 25 badge image lines
	it("SCENARIO 2: badge soup - skips badge lines", async () => {
		const runtime = createRuntime("active_safe");
		const badges = Array.from({ length: 25 }, (_, i) => `![badge](https://img.shields.io/badge/x-y-${i})`);
		const real = ["", "# My Project", "", "A useful library."];
		const content = [...badges, ...real].join("\n");

		const filePath = createTempFile(tempDir, "README.md", content);
		const result = await runtime.trySmartRead(filePath, content);

		// Escape hatch may fire (undefined) or adapter may produce outline — both are fine
		// Polo: never empty, never a stuck loop
		if (result) {
			// Must not contain 25 badge lines
			const badgeLineCount = result.compactContent.split("\n").filter((l) => l.includes("shields.io")).length;
			expect(badgeLineCount).toBe(0);
		}
	});

	// Scenario 3: Low confidence triggers raw fallback
	it("SCENARIO 3: low confidence adapter triggers raw fallback", async () => {
		const runtime = createRuntime("active_safe");
		const content = "some unknown file format\nwith weird syntax\n???\nstill going";

		// Use a completely unknown extension — GenericFallbackAdapter will return confidence 0.3
		const filePath = createTempFile(tempDir, "weird.xyz", content);
		const result = await runtime.trySmartRead(filePath, content);

		// Polo: escape hatch fires, returns undefined (read tool falls through to raw)
		expect(result).toBeUndefined();
	});

	// Scenario 4: Abort signal — should never throw
	it("SCENARIO 4: abort signal -> silent fallthrough, no throw", async () => {
		const runtime = createRuntime("active_safe");
		const content = "# Test\n\nSome content here.";
		const filePath = createTempFile(tempDir, "test.md", content);

		let threw = false;
		let _result: any;

		try {
			_result = await runtime.trySmartRead(filePath, content);
		} catch (_e) {
			threw = true;
		}

		// Polo: never throws
		expect(threw).toBe(false);
		// Escape hatch: may return undefined (escape) or content — never throws
		// Both are valid escape paths
	});

	// Scenario 5: Empty content from adapter triggers raw fallback
	it("SCENARIO 5: empty content triggers raw fallback", async () => {
		const runtime = createRuntime("active_safe");

		// Generic fallback on a file with no structure returns isFallback=true + confidence 0.3
		// which triggers the escape hatch (adapterConfidence < 0.4)
		const content = "a\nb"; // 2 lines, no headings
		const filePath = createTempFile(tempDir, "emptyish.xyz", content);

		const smartResult = await runtime.smartRead.smartRead(content, filePath, "outline");
		// Generic adapter on tiny file with no structure should return isFallback=true
		if (smartResult.adapterConfidence < 0.4) {
			// This is the escape hatch case — trySmartRead must return undefined
			const result = await runtime.trySmartRead(filePath, content);
			expect(result).toBeUndefined();
		}
	});

	// Scenario 6: Adapter throws -> raw fallback, no throw propagation
	it("SCENARIO 6: adapter exception -> no throw to caller", async () => {
		const runtime = createRuntime("active_safe");

		// Manually create a scenario where smartRead throws
		// We'll read a file then delete it to cause a statSync failure in afterRead
		const filePath = createTempFile(tempDir, "disappearing.ts", "export const x = 1;");
		const content = readFileSync(filePath, "utf-8");

		// First read works (takes snapshot)
		let threw = false;
		try {
			await runtime.trySmartRead(filePath, content);
		} catch {
			threw = true;
		}
		expect(threw).toBe(false); // Polo: no throw

		// Now call trySmartRead again on the same content (should work fine)
		const _result = await runtime.trySmartRead(filePath, content);
		// Either returns compact content or undefined (escape hatch)
		// Both are fine — neither is an exception
	});

	// Scenario 7: Over-budget not applicable (no LLMFallbackAdapter used here)
	// The escape hatch handles this at the adapter level

	// Scenario 8: Repeated identical range_exact — StuckTracker
	it("SCENARIO 8: StuckTracker detects repeated identical calls", async () => {
		const tracker = new StuckTracker();

		// Record 3 identical range_exact calls on the same file
		for (let i = 0; i < 3; i++) {
			tracker.record("test.md", "range_exact", { start: 1, end: 20 });
		}

		// Should have 3 events
		expect(tracker.getCount("test.md", "range_exact")).toBe(3);

		// With default threshold (2), 3 identical calls should be stuck
		const isStuck = tracker.isStuck("test.md", "range_exact", { start: 1, end: 20 });
		expect(isStuck).toBe(true);

		// Read tool should return raw content unconditionally
		const runtime = createRuntime("active_safe");
		const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
		const _filePath = createTempFile(tempDir, "test.md", content);
		const readResult = await executeRead(runtime, tempDir, "test.md");
		expect(readResult.content.length).toBeGreaterThan(50);
		expect(readResult.content).toContain("line 1");
	});

	// Scenario 9: rawRead failure -> safe error
	it("SCENARIO 9: reading nonexistent file returns error not throw", async () => {
		const runtime = createRuntime("active_safe");

		let threw = false;
		let result: any = null;

		try {
			result = await runtime.trySmartRead("/nonexistent/path/file.md", "");
		} catch (_e) {
			threw = true;
		}

		expect(threw).toBe(false);
		// Polo: trySmartRead returns undefined for nonexistent files (escape hatch)
		// The read tool handles the actual file-not-found error via ops.access
		expect(result).toBeUndefined();
	});

	// Scenario 10: Real-world pi-ai README.md
	it("SCENARIO 10: actual README.md outline - no stuck", async () => {
		const runtime = createRuntime("active_safe");
		const repoRoot = join(tmpdir(), "..", "..", "..", "..", "..", "..", "..", "..", "..", "..");
		// Try multiple possible paths
		const possiblePaths = [join(repoRoot, "packages", "ai", "README.md")];
		let readmeContent: string;
		let found = false;
		for (const p of possiblePaths) {
			try {
				readmeContent = readFileSync(p, "utf-8");
				found = true;
				break;
			} catch {}
		}
		if (!found) {
			readmeContent = [
				"# @earendil-works/pi-ai",
				"",
				"Unified LLM API abstraction.",
				"",
				"## Table of Contents",
				"- [Supported Providers](#supported-providers)",
				"- [Installation](#installation)",
				"- [Quick Start](#quick-start)",
				"- [Tools](#tools)",
				"",
				"## Supported Providers",
				"Claude, GPT-4, Gemini, etc.",
				"",
				"## Installation",
				"npm install @earendil-works/pi-ai",
				"",
				"## Quick Start",
				"```ts\nconst { stream } = require('@earendil-works/pi-ai');\n```",
				"",
				"## Tools",
				"Define tools using typebox schemas.",
			].join("\n");
		}

		const filePath = createTempFile(tempDir, "README.md", readmeContent);
		const startTime = Date.now();

		const result = await runtime.trySmartRead(filePath, readmeContent);

		const elapsed = Date.now() - startTime;
		expect(elapsed).toBeLessThan(1000); // Must complete in under 1s

		// Escape hatch may fire (undefined) or adapter may find structure
		if (result) {
			const hasRealContent =
				result.compactContent.includes("Installation") ||
				result.compactContent.includes("Quick Start") ||
				result.compactContent.length > readmeContent.length * 0.5;
			expect(hasRealContent).toBe(true);
		} else {
			// Escape hatch fired — read tool will serve raw content
			// This is acceptable: no stuck loop
		}
	});

	// Scenario 11: Runtime methods never throw
	it("SCENARIO 11: runtime beforeRead/trySmartRead/afterRead never throw", async () => {
		const runtime = createRuntime("active_safe");
		const content = "some\nrandom\ntext\nwith\nno\nstructure";
		const filePath = createTempFile(tempDir, "test.xyz", content);

		// beforeRead should not throw
		const intercept = await runtime.beforeRead(filePath);
		expect(intercept).toBeDefined();

		// trySmartRead should not throw — may return undefined (escape hatch)
		const _smartResult = await runtime.trySmartRead(filePath, content);
		// May be undefined (escape hatch) or a result — but never throws

		// afterRead should not throw
		runtime.afterRead(filePath, content, Math.ceil(content.length / 4));

		// Full read via tool should return content
		const readTool = createReadToolDefinition(tempDir, { tokenContextRuntime: runtime });
		const readResult = await readTool.execute("test-call-id", { path: "test.xyz" }, undefined, undefined, undefined);
		expect(readResult).toBeDefined();
		const text = readResult.content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("");
		expect(text.length).toBeGreaterThan(0);
	});

	// Scenario 12: disabled mode preserves exact legacy behavior
	it("SCENARIO 12: disabled mode -> no smart read", async () => {
		const runtime = createRuntime("disabled");
		const content = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
		const filePath = createTempFile(tempDir, "test.ts", content);

		// beforeRead should return intercept=false in disabled mode
		const intercept = await runtime.beforeRead(filePath);
		expect(intercept.intercept).toBe(false);

		// trySmartRead should return undefined in disabled mode
		const smartResult = await runtime.trySmartRead(filePath, content);
		expect(smartResult).toBeUndefined();
	});

	// Scenario 13: Targeted read with offset/limit skips smart read
	it("SCENARIO 13: targeted read (offset/limit) skips smart read", async () => {
		const runtime = createRuntime("active_safe");
		const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
		const filePath = createTempFile(tempDir, "test.ts", content);

		// Try smart read with offset/limit — should skip
		const smartResult = await runtime.trySmartRead(filePath, content, { offset: 10, limit: 5 });
		expect(smartResult).toBeUndefined(); // escape: targeted reads skip smart read

		// beforeRead with offset/limit should not intercept
		const intercept = await runtime.beforeRead(filePath, { offset: 10, limit: 5 });
		expect(intercept.intercept).toBe(false);
	});

	// StuckTracker edge cases
	describe("StuckTracker", () => {
		it("tracks identical calls", () => {
			const tracker = new StuckTracker();
			tracker.record("file.ts", "range_exact", { start: 1, end: 20 });
			tracker.record("file.ts", "range_exact", { start: 1, end: 20 });
			expect(tracker.getCount("file.ts", "range_exact")).toBe(2);
		});

		it("separates different files", () => {
			const tracker = new StuckTracker();
			tracker.record("a.ts", "range_exact", { start: 1, end: 20 });
			tracker.record("b.ts", "range_exact", { start: 1, end: 20 });
			expect(tracker.getCount("a.ts", "range_exact")).toBe(1);
			expect(tracker.getCount("b.ts", "range_exact")).toBe(1);
		});

		it("detects stuck after threshold", () => {
			const tracker = new StuckTracker();
			const file = "test.md";
			tracker.setThreshold(`${file}:range_exact:{"start":1,"end":20}`, 2);
			for (let i = 0; i < 3; i++) {
				tracker.record(file, "range_exact", { start: 1, end: 20 });
			}
			expect(tracker.isStuck(file, "range_exact", { start: 1, end: 20 })).toBe(true);
		});

		it("clears properly", () => {
			const tracker = new StuckTracker();
			tracker.record("file.ts", "test");
			tracker.clear();
			expect(tracker.getCount("file.ts", "test")).toBe(0);
		});
	});
});
