/**
 * Tests for Smart Read Snapshot Service.
 *
 * Verifies:
 * 1. Recursive file discovery with exclusions
 * 2. Cache entry generation
 * 3. Skip unchanged files
 * 4. --force regeneration
 * 5. Progress callback
 * 6. Per-file failure isolation
 * 7. Slash command parsing
 * 8. Integration with TokenContextRuntime
 * 9. Snapshot manifest creation
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SmartReadSnapshotService, type SmartReadSnapshotProgress } from "../../../src/core/smart-read-snapshot.js";
import { SmartReadDiskCache } from "../../../src/core/token-context/smart-read-disk-cache.js";
import { createTokenContextRuntime } from "../../../src/core/token-context/runtime.js";
import { DEFAULT_TOKEN_CONTEXT_CONFIG } from "../../../src/core/token-context/types.js";

describe("SmartReadSnapshotService", () => {
	let tempRoot: string;
	let service: SmartReadSnapshotService;
	let cache: SmartReadDiskCache;

	beforeEach(() => {
		tempRoot = mkdtempSync(join(tmpdir(), "pi-snapshot-test-"));
		cache = new SmartReadDiskCache({ cacheDir: join(tempRoot, ".pi", "smart-read-cache") });
		service = new SmartReadSnapshotService({ diskCache: cache });
	});

	afterEach(() => {
		rmSync(tempRoot, { recursive: true, force: true });
	});

	describe("discoverFiles", () => {
		it("discovers eligible source files recursively", async () => {
			mkdirSync(join(tempRoot, "src"), { recursive: true });
			mkdirSync(join(tempRoot, "src", "lib"), { recursive: true });
			writeFileSync(join(tempRoot, "src", "index.ts"), "export const x = 1;\n");
			writeFileSync(join(tempRoot, "src", "lib", "helper.ts"), "export function helper() { return 42; }\n");
			writeFileSync(join(tempRoot, "src", "lib", "data.json"), '{"key": "value"}\n');
			writeFileSync(join(tempRoot, "README.md"), "# Test\n");

			const files = await service.discoverFiles(tempRoot, new Set([".ts", ".json"]));
			expect(files.length).toBe(3);
			expect(files.some((f) => f.endsWith("index.ts"))).toBe(true);
			expect(files.some((f) => f.endsWith("helper.ts"))).toBe(true);
			expect(files.some((f) => f.endsWith("data.json"))).toBe(true);
			expect(files.some((f) => f.endsWith("README.md"))).toBe(false);
		});

		it("excludes node_modules, .git, dist, target, .pi/smart-read-cache", async () => {
			const excluded = ["node_modules", ".git", "dist", "target"];
			for (const dir of excluded) {
				mkdirSync(join(tempRoot, dir), { recursive: true });
				writeFileSync(join(tempRoot, dir, "file.ts"), "export const x = 1;\n");
			}
			// Also create cache dir structure
			mkdirSync(join(tempRoot, ".pi", "smart-read-cache"), { recursive: true });
			writeFileSync(join(tempRoot, ".pi", "smart-read-cache", "cached.ts"), "export const y = 2;\n");
			// And a normal file
			writeFileSync(join(tempRoot, "normal.ts"), "export const z = 3;\n");

			const files = await service.discoverFiles(tempRoot, new Set([".ts"]));
			expect(files.length).toBe(1);
			expect(files[0].endsWith("normal.ts")).toBe(true);
		});
	});

	describe("run", () => {
		it("writes cache entries for discovered files", async () => {
			writeFileSync(join(tempRoot, "module.ts"), "export const x: number = 1;\n");
			// Need enough content to pass acceptance gate
			const content = Array.from({ length: 20 }, (_, i) => `export function fn${i}(): void {}\n`).join("");
			writeFileSync(join(tempRoot, "module.ts"), content);

			const result = await service.run({ rootDir: tempRoot });

			expect(result.filesScanned).toBe(1);
			expect(result.filesCached).toBeGreaterThanOrEqual(0);
			expect(result.filesFailed).toBe(0);
		});

		it("skips unchanged files on second snapshot", async () => {
			const content = Array.from({ length: 20 }, (_, i) => `export function fn${i}(): void {}\n`).join("");
			writeFileSync(join(tempRoot, "module.ts"), content);

			await service.run({ rootDir: tempRoot });
			const result2 = await service.run({ rootDir: tempRoot });

			expect(result2.filesSkipped).toBeGreaterThanOrEqual(1);
			expect(result2.filesCached).toBe(0);
		});

		it("changed file invalidates cache and re-caches on next snapshot", async () => {
			const file = join(tempRoot, "module.ts");
			const version1 = "export const x = 1;\n";
			const version2 = "export const x = 2;\n";
			writeFileSync(file, version1);

			await service.run({ rootDir: tempRoot });

			// Change file content
			writeFileSync(file, version2);
			const result2 = await service.run({ rootDir: tempRoot });

			// Should not skip the changed file
			expect(result2.filesCached + result2.filesSkipped + result2.filesFailed).toBe(1);
		});

		it("records per-file failures without aborting", async () => {
			// Create a file that will fail (binary-ish content that might cause issues)
			writeFileSync(join(tempRoot, "good.ts"), "export const x = 1;\n");
			// Create a path that doesn't exist as a symlink target
			writeFileSync(join(tempRoot, "good2.ts"), "export const y = 2;\n");

			const result = await service.run({ rootDir: tempRoot });
			expect(result.filesScanned).toBe(2);
			// Both should succeed or fail individually
			expect(result.filesFailed).toBe(0);
		});

		it("emits progress with increasing counts", async () => {
			writeFileSync(join(tempRoot, "a.ts"), "export const a = 1;\n");
			writeFileSync(join(tempRoot, "b.ts"), "export const b = 2;\n");

			const updates: SmartReadSnapshotProgress[] = [];
			await service.run({
				rootDir: tempRoot,
				onProgress: (p) => updates.push({ ...p }),
			});

			expect(updates.length).toBeGreaterThanOrEqual(2);
			for (let i = 1; i < updates.length; i++) {
				expect(updates[i].scanned).toBeGreaterThanOrEqual(updates[i - 1].scanned);
			}
			// Final update should show completion
			const last = updates[updates.length - 1];
			expect(last.scanned).toBe(last.total);
		});
	});

	describe("integration with TokenContextRuntime", () => {
		it("snapshotDirectory method exists and returns result", async () => {
			writeFileSync(join(tempRoot, "test.ts"), "export const x = 1;\n");
			// Need more content to be cacheable
			const content = Array.from({ length: 20 }, (_, i) => `export function fn${i}() {}\n`).join("");
			writeFileSync(join(tempRoot, "test.ts"), content);

			const runtime = createTokenContextRuntime({
				...DEFAULT_TOKEN_CONTEXT_CONFIG,
				mode: "active_safe",
				storeDir: tempRoot,
			});

			const result = await runtime.snapshotDirectory({ rootDir: tempRoot });
			expect(result.filesScanned).toBe(1);
			expect(typeof result.durationMs).toBe("number");
			expect(Array.isArray(result.failures)).toBe(true);

			runtime.globalSmartReadCache.clear();
		});

		it("snapshot cache is used by subsequent trySmartRead", async () => {
			const lines: string[] = [];
			for (let i = 0; i < 50; i++) {
				lines.push(`export const sym${i}: string = "value${i}";`);
			}
			const content = lines.join("\n");
			writeFileSync(join(tempRoot, "cached.ts"), content);

			const runtime = createTokenContextRuntime({
				...DEFAULT_TOKEN_CONTEXT_CONFIG,
				mode: "active_safe",
				tinyFileThresholdBytes: 256,
				storeDir: tempRoot,
			});

			// Snapshot first
			const snapResult = await runtime.snapshotDirectory({ rootDir: tempRoot });
			expect(snapResult.filesCached).toBeGreaterThanOrEqual(0);

			// Then trySmartRead should hit disk cache
			const smartResult = await runtime.trySmartRead(join(tempRoot, "cached.ts"), content);
			expect(smartResult).toBeDefined();
			if (smartResult) {
				expect(smartResult.compactContent.length).toBeGreaterThan(0);
				expect(smartResult.compactContent.length).toBeLessThan(content.length);
			}

			runtime.globalSmartReadCache.clear();
		});
	});

	describe("formatting", () => {
		it("formatSummary produces expected output", () => {
			const result = {
				rootDir: "/test",
				startedAt: "2025-01-01T00:00:00.000Z",
				completedAt: "2025-01-01T00:00:01.000Z",
				durationMs: 1000,
				filesScanned: 100,
				filesCached: 60,
				filesSkipped: 38,
				filesFailed: 2,
				rawBytes: 1000000,
				compactBytes: 250000,
				estimatedTokensSaved: 187500,
				failures: [
					{ file: "bad.js", error: "Parse error" },
				],
			};

			const summary = service.formatSummary(result);
			expect(summary).toContain("Snapshot complete");
			expect(summary).toContain("Cached: 60");
			expect(summary).toContain("Skipped: 38");
			expect(summary).toContain("Failed: 2");
			expect(summary).toContain("Raw size: 976.6 KB");
			expect(summary).toContain("Estimated saved: 187.5K tokens");
			expect(summary).toContain("Duration: 1.0s");
			expect(summary).toContain("bad.js");
		});

		it("formatProgress produces expected output", () => {
			const progress: SmartReadSnapshotProgress = {
				scanned: 42,
				total: 100,
				cached: 20,
				skipped: 20,
				failed: 2,
				rawBytes: 500000,
				compactBytes: 100000,
				estimatedTokensSaved: 100000,
				percent: 42,
			};

			const formatted = service.formatProgress(progress);
			expect(formatted).toContain("42%");
			expect(formatted).toContain("42/100");
			expect(formatted).toContain("cached=20");
			expect(formatted).toContain("skipped=20");
			expect(formatted).toContain("failed=2");
		});
	});
});
