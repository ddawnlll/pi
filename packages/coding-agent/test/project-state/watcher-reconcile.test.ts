/**
 * Watcher/Reconcile tests — PSS-MEGA-02
 *
 * External file edit detection, reconcile correctness, bounded tree scan cap.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStateDir, SCHEMA_VERSION } from "../../src/core/project-state/paths.js";
import { DEFAULT_BOUNDED_TREE_STAT_LIMIT, ReconcileScanner } from "../../src/core/project-state/reconcile-scanner.js";
import { ProjectStateStore } from "../../src/core/project-state/store.js";
import type { ProjectFilesState } from "../../src/core/project-state/types.js";

function makeFilesState(
	rootDir: string,
	files: Record<string, { size: number; mtime: number; hash?: string }>,
): ProjectFilesState {
	const entries: any = {};
	for (const [path, meta] of Object.entries(files)) {
		entries[path] = {
			path,
			ext: path.includes(".") ? "." + path.split(".").pop() : "",
			sizeBytes: meta.size,
			mtimeMs: meta.mtime,
			contentHash: meta.hash,
			isSource: true,
			isTest: false,
			isConfig: false,
			isGenerated: false,
			isIgnored: false,
		};
	}
	return {
		schemaVersion: SCHEMA_VERSION,
		rootDir,
		generatedAt: new Date().toISOString(),
		files: entries,
	};
}

describe("ReconcileScanner", () => {
	let tmpDir: string;
	let store: ProjectStateStore;
	let scanner: ReconcileScanner;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-reconcile-test-"));
		mkdirSync(getStateDir(tmpDir), { recursive: true });
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		store = new ProjectStateStore(tmpDir);
		store.ensureStateDir();

		const manifest = store.createManifest(0, 0, "initial");
		store.saveManifest(manifest);

		scanner = new ReconcileScanner(store);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects changed file", () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		const stat = require("node:fs").statSync(join(tmpDir, "src", "a.ts"));
		store.saveFilesState(
			makeFilesState(tmpDir, {
				"src/a.ts": { size: stat.size, mtime: stat.mtimeMs - 1000, hash: "oldhash" },
			}),
		);

		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 2;\n", "utf-8");

		const result = scanner.reconcile({
			rootDir: tmpDir,
			candidatePaths: ["src/a.ts"],
			level: "path",
		});

		expect(result.statCalls).toBeGreaterThan(0);
		const hasEdit = result.events.some((e) => e.event.type === "file_edited");
		const hasTouch = result.events.some((e) => e.event.type === "file_touched");
		expect(hasEdit || hasTouch).toBe(true);
	});

	it("detects created file", () => {
		writeFileSync(join(tmpDir, "src", "new.ts"), "const y = 2;\n", "utf-8");
		store.saveFilesState(makeFilesState(tmpDir, {}));

		const result = scanner.reconcile({
			rootDir: tmpDir,
			candidatePaths: ["src/new.ts"],
			level: "path",
		});

		expect(result.events.some((e) => e.event.type === "file_written")).toBe(true);
	});

	it("detects deleted file", () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		const stat = require("node:fs").statSync(join(tmpDir, "src", "a.ts"));
		store.saveFilesState(
			makeFilesState(tmpDir, {
				"src/a.ts": { size: stat.size, mtime: stat.mtimeMs, hash: "hash1" },
			}),
		);

		rmSync(join(tmpDir, "src", "a.ts"), { force: true });

		const result = scanner.reconcile({
			rootDir: tmpDir,
			candidatePaths: ["src/a.ts"],
			level: "path",
		});

		expect(result.events.some((e) => e.event.type === "file_deleted")).toBe(true);
	});

	it("quickCheck returns unchanged for same file", () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		const stat = require("node:fs").statSync(join(tmpDir, "src", "a.ts"));
		store.saveFilesState(
			makeFilesState(tmpDir, {
				"src/a.ts": { size: stat.size, mtime: stat.mtimeMs, hash: "hash1" },
			}),
		);

		const check = scanner.quickCheck("src/a.ts");
		expect(check).toBe("unchanged");
	});

	it("quickCheck returns changed for modified file", () => {
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		store.saveFilesState(
			makeFilesState(tmpDir, {
				"src/a.ts": { size: 14, mtime: Date.now() - 10000, hash: "oldhash" },
			}),
		);
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 2;\n", "utf-8");

		const check = scanner.quickCheck("src/a.ts");
		expect(check).toBe("changed");
	});

	it("quickCheck returns missing for unknown path", () => {
		const check = scanner.quickCheck("nonexistent.ts");
		expect(check).toBe("missing");
	});

	it("reconcile handles rename as delete+create", () => {
		writeFileSync(join(tmpDir, "old.ts"), "const x = 1;\n", "utf-8");
		const stat = require("node:fs").statSync(join(tmpDir, "old.ts"));
		store.saveFilesState(
			makeFilesState(tmpDir, {
				"old.ts": { size: stat.size, mtime: stat.mtimeMs, hash: "hash1" },
			}),
		);

		rmSync(join(tmpDir, "old.ts"), { force: true });
		writeFileSync(join(tmpDir, "new.ts"), "const x = 1;\n", "utf-8");

		const result = scanner.reconcile({
			rootDir: tmpDir,
			candidatePaths: ["old.ts", "new.ts"],
			level: "path",
		});

		const hasDelete = result.events.some(
			(e) => e.event.type === "file_deleted" && (e.event as any).path === "old.ts",
		);
		const hasCreate = result.events.some(
			(e) => e.event.type === "file_written" && (e.event as any).path === "new.ts",
		);
		expect(hasDelete).toBe(true);
		expect(hasCreate).toBe(true);
	});

	it("stat limit does not cause crash", () => {
		const result = scanner.reconcile({
			rootDir: tmpDir,
			candidatePaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
			level: "path",
			statLimit: 1,
		});
		expect(result.statCalls).toBeGreaterThanOrEqual(0);
	});
});
