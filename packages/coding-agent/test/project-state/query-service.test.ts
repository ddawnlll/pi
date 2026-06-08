/**
 * Query service tests — PSS-MEGA-02
 *
 * ls compact caps, rg-files summary, pagination, dirty/unknown safety.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStateDir, SCHEMA_VERSION } from "../../src/core/project-state/paths.js";
import { QueryService } from "../../src/core/project-state/query-service.js";
import { ProjectStateStore } from "../../src/core/project-state/store.js";

function createEmptyState(tmpDir: string): { store: ProjectStateStore } {
	const store = new ProjectStateStore(tmpDir);
	store.ensureStateDir();
	const manifest = store.createManifest(0, 0, "hash");
	store.saveManifest(manifest);
	return { store };
}

function setFilesValid(store: ProjectStateStore): void {
	const m = store.loadManifest();
	if (m) {
		m.validity.files = "valid";
		m.validity.tree = "valid";
		m.validity.packages = "valid";
		m.validity.git = "valid";
		store.saveManifest(m);
	}
}

function addFilesState(store: ProjectStateStore, files: string[]): void {
	const entries: Record<string, any> = {};
	for (const f of files) {
		entries[f] = {
			path: f,
			ext: f.includes(".") ? "." + f.split(".").pop() : "",
			sizeBytes: 10,
			mtimeMs: Date.now(),
			isSource: true,
			isTest: false,
			isConfig: false,
			isGenerated: false,
			isIgnored: false,
		};
	}
	store.saveFilesState({
		schemaVersion: SCHEMA_VERSION,
		rootDir: store.getRootDir(),
		generatedAt: new Date().toISOString(),
		files: entries,
	});
}

describe("QueryService", () => {
	let tmpDir: string;
	let store: ProjectStateStore;
	let query: QueryService;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-query-test-"));
		mkdirSync(getStateDir(tmpDir), { recursive: true });
		const { store: s } = createEmptyState(tmpDir);
		store = s;
		query = new QueryService(store);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("ls returns empty for empty state", () => {
		const result = query.ls(".");
		expect(result.source).toBe("project_state_cache");
		expect(result.items).toEqual([]);
	});

	it("ls caps at 100 entries by default", () => {
		const files: string[] = [];
		for (let i = 0; i < 150; i++) {
			files.push(`file${i}.ts`);
		}
		addFilesState(store, files);
		setFilesValid(store);

		const result = query.ls(".");
		expect(result.truncated).toBe(true);
		expect(result.items!.length).toBeLessThanOrEqual(100);
		expect(result.totalItems).toBe(150);
	});

	it("ls returns all with mode=full", () => {
		const files: string[] = [];
		for (let i = 0; i < 150; i++) {
			files.push(`file${i}.ts`);
		}
		addFilesState(store, files);
		setFilesValid(store);

		const result = query.ls(".", { mode: "full" });
		expect(result.truncated).toBe(false);
		expect(result.items!.length).toBe(150);
	});

	it("rg-files returns summary with capped paths", () => {
		const files: string[] = [];
		for (let i = 0; i < 300; i++) {
			files.push(`src/file${i}.ts`);
		}
		addFilesState(store, files);
		setFilesValid(store);

		const result = query.rgFiles();
		expect(result.truncated).toBe(true);
		expect(result.items!.length).toBeLessThanOrEqual(120);
		expect(result.totalItems).toBe(300);
		expect(result.summary).toContain("src:");
	});

	it("rg-files returns cursor when truncated", () => {
		const files: string[] = [];
		for (let i = 0; i < 200; i++) {
			files.push(`src/file${i}.ts`);
		}
		addFilesState(store, files);
		setFilesValid(store);

		const result = query.rgFiles();
		expect(result.truncated).toBe(true);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	it("rg-files with mode=full returns all", () => {
		const files: string[] = [];
		for (let i = 0; i < 200; i++) {
			files.push(`file${i}.ts`);
		}
		addFilesState(store, files);
		setFilesValid(store);

		const result = query.rgFiles(undefined, { mode: "full" });
		expect(result.truncated).toBe(false);
		expect(result.items!.length).toBe(200);
	});

	it("dirty state blocks rg-files with warnings", () => {
		addFilesState(store, ["a.ts"]);
		setFilesValid(store);
		const manifest = store.loadManifest()!;
		manifest.validity.files = "dirty";
		store.saveManifest(manifest);

		const result = query.rgFiles();
		expect(result.source).toBe("unavailable");
		expect(result.validity).toBe("dirty");
	});

	it("unknown tree state with files still works but reports source", () => {
		addFilesState(store, ["a.ts"]);
		setFilesValid(store);
		const manifest = store.loadManifest()!;
		manifest.validity.tree = "unknown";
		store.saveManifest(manifest);

		const result = query.ls(".");
		expect(result.source).toBe("project_state_cache");
		expect(result.items).toBeDefined();
	});

	it("packages returns package manager info", () => {
		setFilesValid(store);
		store.savePackageState({
			schemaVersion: SCHEMA_VERSION,
			generatedAt: new Date().toISOString(),
			packageManager: "npm",
			packageFiles: {
				"package.json": {
					path: "package.json",
					name: "test",
					scripts: {},
					packageHash: "hash1",
				},
			},
			lockfiles: [],
			testFrameworkHints: ["vitest"],
			configFiles: [],
			validity: "valid",
		});

		const result = query.packages();
		expect(result.summary).toContain("npm");
		expect(result.summary).toContain("vitest");
	});

	it("git returns compact status", () => {
		setFilesValid(store);
		store.saveGitState({
			schemaVersion: SCHEMA_VERSION,
			isGitRepo: true,
			branch: "main",
			headSha: "abc123def456",
			dirtyFiles: ["src/a.ts"],
			untrackedFiles: ["new.ts"],
			stagedFiles: [],
			lastCheckedAt: new Date().toISOString(),
			validity: "dirty",
		});

		const result = query.git();
		expect(result.summary).toContain("main");
		expect(result.summary).toContain("abc123");
		expect(result.summary).toContain("a.ts");
	});

	it("git returns not a repo message", () => {
		setFilesValid(store);
		store.saveGitState({
			schemaVersion: SCHEMA_VERSION,
			isGitRepo: false,
			lastCheckedAt: new Date().toISOString(),
			validity: "unknown",
			dirtyFiles: [],
			untrackedFiles: [],
			stagedFiles: [],
		});

		const result = query.git();
		expect(result.summary).toContain("Not a git");
	});
});
