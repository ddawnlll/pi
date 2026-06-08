/**
 * Projector tests — PSS-MEGA-02
 *
 * Idempotent event application, invalidation rules, file create/delete/move.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStateEventJournal } from "../../src/core/project-state/event-journal.js";
import { getStateDir, SCHEMA_VERSION } from "../../src/core/project-state/paths.js";
import { ProjectStateProjector } from "../../src/core/project-state/projector.js";
import { ProjectStateStore } from "../../src/core/project-state/store.js";

describe("ProjectStateProjector", () => {
	let tmpDir: string;
	let store: ProjectStateStore;
	let journal: ProjectStateEventJournal;
	let projector: ProjectStateProjector;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-projector-test-"));
		mkdirSync(getStateDir(tmpDir), { recursive: true });
		store = new ProjectStateStore(tmpDir);
		journal = new ProjectStateEventJournal(tmpDir);
		projector = new ProjectStateProjector(store, journal);

		store.ensureStateDir();
		const manifest = store.createManifest(0, 0, "initial");
		store.saveManifest(manifest);
		store.saveFilesState({
			schemaVersion: SCHEMA_VERSION,
			rootDir: tmpDir,
			generatedAt: new Date().toISOString(),
			files: {},
		});
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("applies file edit in sequence", () => {
		journal.append({ type: "file_edited", path: "src/a.ts", newHash: "abc123" }, "edit_tool");
		const result = projector.applyAll();
		expect(result.appliedCount).toBe(1);

		const manifest = store.loadManifest()!;
		expect(manifest.lastAppliedSequence).toBe(1);

		const files = store.loadFilesState()!;
		expect(files.files["src/a.ts"]).toBeDefined();
	});

	it("file edit updates contentHash and marks smartRead stale", () => {
		store.saveFilesState({
			schemaVersion: SCHEMA_VERSION,
			rootDir: tmpDir,
			generatedAt: new Date().toISOString(),
			files: {
				"src/a.ts": {
					path: "src/a.ts",
					ext: ".ts",
					sizeBytes: 10,
					mtimeMs: Date.now(),
					contentHash: "oldhash",
					isSource: true,
					isTest: false,
					isConfig: false,
					isGenerated: false,
					isIgnored: false,
					smartReadStatus: "warm",
				},
			},
		});

		journal.append({ type: "file_edited", path: "src/a.ts", newHash: "newhash" }, "edit_tool");
		projector.applyAll();

		const files = store.loadFilesState()!;
		expect(files.files["src/a.ts"]!.contentHash).toBe("newhash");
		expect(files.files["src/a.ts"]!.smartReadStatus).toBe("stale");
	});

	it("file create adds entry and updates lastChangedSequence", () => {
		journal.append({ type: "file_written", path: "src/new.ts", newHash: "hash1" }, "write_tool");
		projector.applyAll();

		const files = store.loadFilesState()!;
		expect(files.files["src/new.ts"]).toBeDefined();
		expect(files.files["src/new.ts"]!.lastChangedSequence).toBe(1);
	});

	it("file delete removes entry", () => {
		store.saveFilesState({
			schemaVersion: SCHEMA_VERSION,
			rootDir: tmpDir,
			generatedAt: new Date().toISOString(),
			files: {
				"src/a.ts": {
					path: "src/a.ts",
					ext: ".ts",
					sizeBytes: 10,
					mtimeMs: Date.now(),
					isSource: true,
					isTest: false,
					isConfig: false,
					isGenerated: false,
					isIgnored: false,
				},
			},
		});

		journal.append({ type: "file_deleted", path: "src/a.ts", oldHash: "oldhash" }, "write_tool");
		projector.applyAll();

		const files = store.loadFilesState()!;
		expect(files.files["src/a.ts"]).toBeUndefined();
	});

	it("file move preserves metadata", () => {
		store.saveFilesState({
			schemaVersion: SCHEMA_VERSION,
			rootDir: tmpDir,
			generatedAt: new Date().toISOString(),
			files: {
				"src/a.ts": {
					path: "src/a.ts",
					ext: ".ts",
					sizeBytes: 10,
					mtimeMs: Date.now(),
					contentHash: "hash1",
					isSource: true,
					isTest: false,
					isConfig: false,
					isGenerated: false,
					isIgnored: false,
					smartReadStatus: "warm",
				},
			},
		});

		journal.append(
			{ type: "file_moved", from: "src/a.ts", to: "src/b.ts", oldHash: "hash1", newHash: "hash1" },
			"write_tool",
		);
		projector.applyAll();

		const files = store.loadFilesState()!;
		expect(files.files["src/a.ts"]).toBeUndefined();
		expect(files.files["src/b.ts"]).toBeDefined();
		expect(files.files["src/b.ts"]!.contentHash).toBe("hash1");
		expect(files.files["src/b.ts"]!.smartReadStatus).toBe("missing");
	});

	it("package manifest change marks package validity dirty", () => {
		journal.append({ type: "package_manifest_changed", path: "package.json" }, "watcher");
		projector.applyAll();

		const manifest = store.loadManifest()!;
		expect(manifest.validity.packages).toBe("dirty");
	});

	it("git head change marks broad dirty/unknown", () => {
		journal.append({ type: "git_head_changed", newHead: "abc123" }, "git_detector");
		projector.applyAll();

		const manifest = store.loadManifest()!;
		expect(manifest.validity.git).toBe("dirty");
		expect(manifest.validity.tree).toBe("dirty");
		expect(manifest.validity.files).toBe("dirty");
	});

	it("same event is idempotent", () => {
		journal.append({ type: "file_written", path: "a.ts", newHash: "hash1" }, "write_tool");
		journal.append({ type: "file_written", path: "a.ts", newHash: "hash1" }, "write_tool");

		projector.applyAll();

		const files = store.loadFilesState()!;
		expect(files.files["a.ts"]).toBeDefined();
	});

	it("state_marked_dirty updates validity", () => {
		journal.append({ type: "state_marked_dirty", reason: "test", scope: ["tree", "packages"] }, "external");
		projector.applyAll();

		const manifest = store.loadManifest()!;
		expect(manifest.validity.tree).toBe("dirty");
		expect(manifest.validity.packages).toBe("dirty");
	});

	it("projector resumes from lastAppliedSequence", () => {
		journal.append({ type: "file_written", path: "a.ts" }, "write_tool");
		journal.append({ type: "file_written", path: "b.ts" }, "write_tool");
		projector.applyAll();
		expect(projector.getLastAppliedSequence()).toBe(2);

		journal.append({ type: "file_written", path: "c.ts" }, "write_tool");
		const result = projector.applyAll();
		expect(result.appliedCount).toBe(1);
		expect(projector.getLastAppliedSequence()).toBe(3);
	});

	it("getPendingCount returns correct count", () => {
		expect(projector.getPendingCount()).toBe(0);

		journal.append({ type: "file_written", path: "a.ts" }, "write_tool");
		expect(projector.getPendingCount()).toBe(1);

		projector.applyAll();
		expect(projector.getPendingCount()).toBe(0);
	});
});
