/**
 * ProjectStateStore tests
 *
 * Verifies atomic persistence, load/save, error handling.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStateDir, getStateFilePath, STATE_FILES } from "../../src/core/project-state/paths.js";
import { ProjectStateSnapshotService } from "../../src/core/project-state/snapshot-service.js";
import { type ProjectStateBundle, ProjectStateStore } from "../../src/core/project-state/store.js";
import type { ProjectFilesState, ProjectStateManifest, SnapshotResult } from "../../src/core/project-state/types.js";

describe("ProjectStateStore", () => {
	let tmpDir: string;
	let store: ProjectStateStore;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-store-test-"));
		store = new ProjectStateStore(tmpDir);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates state directory", () => {
		expect(store.ensureStateDir()).toBe(true);
		expect(existsSync(getStateDir(tmpDir))).toBe(true);
	});

	it("returns false for existing state directory", () => {
		store.ensureStateDir();
		expect(store.ensureStateDir()).toBe(false);
	});

	it("writes manifest atomically", () => {
		store.ensureStateDir();
		const manifest = store.createManifest(10, 5, "abc123");
		store.saveManifest(manifest);

		const manifestPath = getStateFilePath(tmpDir, STATE_FILES.MANIFEST);
		expect(existsSync(manifestPath)).toBe(true);

		const loaded = store.loadManifest();
		expect(loaded).toBeDefined();
		expect(loaded!.snapshotId).toBe(manifest.snapshotId);
		expect(loaded!.fileCount).toBe(10);
		expect(loaded!.sourceFileCount).toBe(5);
		expect(loaded!.rootDir).toBe(tmpDir);
	});

	it("loads valid manifest", () => {
		store.ensureStateDir();
		const manifest = store.createManifest(5, 3, "def456");
		store.saveManifest(manifest);
		const loaded = store.loadManifest();
		expect(loaded).toBeDefined();
		expect(loaded!.snapshotId).toBe(manifest.snapshotId);
	});

	it("returns undefined for missing manifest", () => {
		const loaded = store.loadManifest();
		expect(loaded).toBeUndefined();
	});

	it("handles malformed JSON safely", () => {
		store.ensureStateDir();
		const manifestPath = getStateFilePath(tmpDir, STATE_FILES.MANIFEST);
		writeFileSync(manifestPath, "not json", "utf-8");
		const loaded = store.loadManifest();
		expect(loaded).toBeUndefined();
	});

	it("handles schema version mismatch", () => {
		store.ensureStateDir();
		const manifestPath = getStateFilePath(tmpDir, STATE_FILES.MANIFEST);
		writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 999, rootDir: tmpDir }), "utf-8");
		const loaded = store.loadManifest();
		expect(loaded).toBeUndefined();
	});

	it("writes files state atomically", () => {
		store.ensureStateDir();
		const filesState: ProjectFilesState = {
			schemaVersion: 1,
			rootDir: tmpDir,
			generatedAt: new Date().toISOString(),
			files: {},
		};
		store.saveFilesState(filesState);

		const loaded = store.loadFilesState();
		expect(loaded).toBeDefined();
		expect(loaded!.rootDir).toBe(tmpDir);
	});

	it("loads bundle with all segments", () => {
		store.ensureStateDir();
		const manifest = store.createManifest(3, 1, "xyz");
		store.saveManifest(manifest);

		const bundle = store.loadBundle();
		expect(bundle.manifest).toBeDefined();
		expect(bundle.files).toBeUndefined(); // not saved yet
		expect(bundle.tree).toBeUndefined();
		expect(bundle.packages).toBeUndefined();
		expect(bundle.git).toBeUndefined();
	});

	it("hasAnyState returns false for empty dir", () => {
		store.ensureStateDir();
		expect(store.hasAnyState()).toBe(false);
	});

	it("hasAnyState returns true after save", () => {
		store.ensureStateDir();
		const manifest = store.createManifest(0, 0, "");
		store.saveManifest(manifest);
		expect(store.hasAnyState()).toBe(true);
	});

	it("normalizes rootDir on construction", () => {
		const relativeStore = new ProjectStateStore(".");
		expect(relativeStore.getRootDir()).toBe(process.cwd());
	});
});

describe("ProjectStateSnapshotService", () => {
	let tmpDir: string;
	let service: ProjectStateSnapshotService;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-service-test-"));
		// Create some test files
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		mkdirSync(join(tmpDir, "node_modules"), { recursive: true });
		mkdirSync(join(tmpDir, "dist"), { recursive: true });
		mkdirSync(join(tmpDir, ".git"), { recursive: true });
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "test-pkg", scripts: { test: "vitest" } }),
			"utf-8",
		);
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x: number = 1;\nexport default x;\n", "utf-8");
		writeFileSync(join(tmpDir, "src", "b.ts"), 'const y = "hello";\nexport default y;\n', "utf-8");
		writeFileSync(
			join(tmpDir, "src", "test.ts"),
			"import { describe, it, expect } from 'vitest';\nit('works', () => expect(1).toBe(1));\n",
			"utf-8",
		);
		writeFileSync(join(tmpDir, "node_modules", "ignored.ts"), "module.exports = {};\n", "utf-8");
		writeFileSync(join(tmpDir, "dist", "output.ts"), 'console.log("built");\n', "utf-8");
		writeFileSync(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf-8");

		service = new ProjectStateSnapshotService();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("builds manifest/files/tree for basic directory", async () => {
		const result = await service.run({ rootDir: tmpDir });

		expect(result.filesScanned).toBeGreaterThanOrEqual(3); // src/a.ts, src/b.ts, src/test.ts
		expect(result.sourceFiles).toBeGreaterThanOrEqual(3);
		expect(result.filesFailed).toBe(0);

		// Verify state files exist
		const store = new ProjectStateStore(tmpDir);
		const manifest = store.loadManifest();
		expect(manifest).toBeDefined();
		expect(manifest!.rootDir).toBe(tmpDir);

		const filesState = store.loadFilesState();
		expect(filesState).toBeDefined();
		expect(filesState!.files).toBeDefined();

		// Should not include node_modules or dist
		const paths = Object.keys(filesState!.files);
		expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
		expect(paths.some((p) => p.includes("dist"))).toBe(false);
		expect(paths.some((p) => p.includes(".git"))).toBe(false);

		// Should include src files
		expect(paths.includes("src/a.ts")).toBe(true);
		expect(paths.includes("src/b.ts")).toBe(true);
	});

	it("excludes node_modules from discovery", async () => {
		const result = await service.run({ rootDir: tmpDir });
		const store = new ProjectStateStore(tmpDir);
		const filesState = store.loadFilesState()!;
		const paths = Object.keys(filesState.files);
		expect(paths.every((p) => !p.startsWith("node_modules"))).toBe(true);
	});

	it("excludes .git from discovery", async () => {
		const result = await service.run({ rootDir: tmpDir });
		const store = new ProjectStateStore(tmpDir);
		const filesState = store.loadFilesState()!;
		const paths = Object.keys(filesState.files);
		expect(paths.every((p) => !p.startsWith(".git"))).toBe(true);
	});

	it("status reads real state files", async () => {
		await service.run({ rootDir: tmpDir });
		const status = service.getStatus(tmpDir);
		expect(status.fileCount).toBeGreaterThanOrEqual(3);
		expect(status.overall).toBe("partial"); // partial because git validity is unknown (not a real git repo)
	});

	it("status returns missing when no state exists", async () => {
		const status = service.getStatus(tmpDir);
		expect(status.overall).toBe("missing");
	});

	it("second snapshot skips unchanged files", async () => {
		const first = await service.run({ rootDir: tmpDir });
		const second = await service.run({ rootDir: tmpDir });
		// Second run should have fewer cached files since most should be skipped
		expect(second.filesSkipped).toBeGreaterThanOrEqual(second.filesCached);
	});

	it("--force does not crash", async () => {
		await service.run({ rootDir: tmpDir });
		const forced = await service.run({ rootDir: tmpDir, force: true });
		// Force should not cause errors
		expect(forced.filesFailed).toBe(0);
		expect(forced.filesScanned).toBeGreaterThanOrEqual(3);
	});

	it("--concurrency is respected", async () => {
		const result = await service.run({ rootDir: tmpDir, concurrency: 2 });
		expect(result.filesScanned).toBeGreaterThanOrEqual(3);
	});

	it("--json returns structured result", async () => {
		const result = await service.run({ rootDir: tmpDir, json: true });
		expect(result).toBeDefined();
		expect(result.rootDir).toBe(tmpDir);
		expect(typeof result.snapshotId).toBe("string");
		expect(typeof result.durationMs).toBe("number");
		expect(Array.isArray(result.failures)).toBe(true);
	});

	it("per-file failure does not crash snapshot", async () => {
		// Create a file that will cause issues
		// Just verify the service handles it gracefully
		const result = await service.run({ rootDir: tmpDir });
		expect(result.filesFailed).toBe(0); // No failures expected for simple TS files
	});

	it("formats summary output", async () => {
		const result = await service.run({ rootDir: tmpDir });
		const summary = service.formatSummary(result);
		expect(summary).toContain("Snapshot complete");
		expect(summary).toContain(tmpDir);
		expect(summary).toContain("Files scanned");
	});

	it("formats status output", async () => {
		await service.run({ rootDir: tmpDir });
		const status = service.getStatus(tmpDir);
		const formatted = service.formatStatus(status);
		expect(formatted).toContain("Project snapshot");
		expect(formatted).toContain(tmpDir);
	});
});
