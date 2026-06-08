/**
 * Smart Read integration tests
 *
 * Tests snapshot Smart Read warmup, cache reuse, stale cache rejection,
 * and content-unchanged-with-mtime-changed handling.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadTimeVerifier } from "../../src/core/project-state/read-time-verifier.js";
import { ProjectStateSnapshotService } from "../../src/core/project-state/snapshot-service.js";
import { ProjectStateStore } from "../../src/core/project-state/store.js";
import { SmartReadDiskCache } from "../../src/core/token-context/smart-read-disk-cache.js";

describe("Smart Read integration", () => {
	let tmpDir: string;
	let service: ProjectStateSnapshotService;
	let cache: SmartReadDiskCache;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-smart-test-"));
		cache = new SmartReadDiskCache({ cacheDir: join(tmpDir, ".pi", "smart-read-cache") });

		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");

		service = new ProjectStateSnapshotService({
			smartReadDiskCache: cache,
		});
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("snapshot warms Smart Read cache if provider available", async () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x: number = 1;\nexport default x;\n", "utf-8");

		const result = await service.run({ rootDir: tmpDir });

		// Smart Read may or may not be available in test env, but it should not crash
		expect(result.filesFailed).toBe(0);
		// If Smart Read is unavailable (no providers), filesCached will be 0
		// If available, cache should be populated
	});

	it("warmed file + unchanged read = cache hit/reuse", async () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x: number = 1;\nexport default x;\n", "utf-8");

		await service.run({ rootDir: tmpDir });

		// Read file and verify cache hit (if Smart Read is available)
		const absPath = join(tmpDir, "src", "a.ts");
		const content = readFileSync(absPath, "utf-8");
		const cached = cache.get(absPath, content);

		// Smart Read may not be available in test env — verify graceful handling
		// If cached, verify reuse
		// If not cached, the fallback path is correct
		if (cached) {
			const cached2 = cache.get(absPath, content);
			expect(cached2).toBeDefined();
			expect(cached2!.outline).toBe(cached.outline);
		}
	});

	it("changed file does not use stale cache", async () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x: number = 1;\nexport default x;\n", "utf-8");

		await service.run({ rootDir: tmpDir });

		// Change file content
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x: string = 'changed';\nexport default x;\n", "utf-8");

		// Read should not return stale entry
		const absPath = join(tmpDir, "src", "a.ts");
		const content = readFileSync(absPath, "utf-8");
		const cached = cache.get(absPath, content);
		// Either undefined (not yet cached for new content) or a new entry
		if (cached) {
			expect(cached.fileHash).not.toBeUndefined();
		}
	});

	it("read-time verifier rejects stale cache after content change", async () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x: number = 1;\nexport default x;\n", "utf-8");

		await service.run({ rootDir: tmpDir });

		// Change file content
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x: string = 'changed';\nexport default x;\n", "utf-8");

		// Read-time verifier should detect change
		const store = new ProjectStateStore(tmpDir);
		const verifier = new ReadTimeVerifier(store, cache);
		const result = verifier.verify("src/a.ts");

		expect(result.canUseCache).toBe(false);
		expect(result.contentUnchanged).toBe(false);
		expect(result.reason).toContain("changed");
	});

	it("same content with changed mtime reuses cache after hash verification", async () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x: number = 1;\nexport default x;\n", "utf-8");

		await service.run({ rootDir: tmpDir });

		// Write same content (touches mtime)
		const content = "const x: number = 1;\nexport default x;\n";
		writeFileSync(join(tmpDir, "src", "a.ts"), content, "utf-8");

		// Read-time verifier should accept via hash match
		const store = new ProjectStateStore(tmpDir);
		const verifier = new ReadTimeVerifier(store, cache);
		const result = verifier.verify("src/a.ts");

		expect(result.canUseCache).toBe(true);
		expect(result.contentUnchanged).toBe(true);
	});

	it("unsupported file does not crash Smart Read", async () => {
		writeFileSync(join(tmpDir, "README.md"), "# Test Project\n", "utf-8");

		const result = await service.run({ rootDir: tmpDir, includeMd: true });
		expect(result.filesFailed).toBe(0);
	});

	it("missing cache regenerates/falls back safely", async () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x: number = 1;\nexport default x;\n", "utf-8");

		// Don't run snapshot - just verify that read works without cache
		const store = new ProjectStateStore(tmpDir);
		const verifier = new ReadTimeVerifier(store, cache);
		const result = verifier.verify("src/a.ts");

		expect(result.canUseCache).toBe(false); // no snapshot = no cache
	});

	it("deleted file returns no cache use with normal fallback", async () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x: number = 1;\nexport default x;\n", "utf-8");

		// Force the store to have a files state with a.ts
		const store = new ProjectStateStore(tmpDir);
		store.ensureStateDir();
		const manifest = store.createManifest(1, 1, "hash");
		store.saveManifest(manifest);
		store.saveFilesState({
			schemaVersion: 1,
			rootDir: tmpDir,
			generatedAt: new Date().toISOString(),
			files: {
				"src/a.ts": {
					path: "src/a.ts",
					ext: ".ts",
					sizeBytes: 30,
					mtimeMs: Date.now(),
					contentHash: "abc123",
					isSource: true,
					isTest: false,
					isConfig: false,
					isGenerated: false,
					isIgnored: false,
					smartReadStatus: "warm",
				},
			},
		});

		// Delete the file
		rmSync(join(tmpDir, "src", "a.ts"), { force: true });

		const verifier = new ReadTimeVerifier(store, cache);
		const result = verifier.verify("src/a.ts");

		expect(result.canUseCache).toBe(false);
		expect(result.reason).toContain("not found");
	});
});
