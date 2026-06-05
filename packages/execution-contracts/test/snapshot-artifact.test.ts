/**
 * Snapshot Artifact tests — P41.07
 *
 * Tests covering:
 * - createFileSnapshot: content hash, size, language detection, binary flag
 * - createWorkspaceSnapshot: aggregation, sorting, metadata
 * - computeSnapshotDiff: added/deleted/modified/identical files
 * - computeSnapshotSummary: aggregate statistics
 * - createSnapshotArtifact: complete artifact assembly
 * - InMemorySnapshotArtifactStore: CRUD operations
 * - computeContentHash: deterministic hashing
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
	computeContentHash,
	computeSnapshotDiff,
	computeSnapshotSummary,
	createFileSnapshot,
	createSnapshotArtifact,
	createWorkspaceSnapshot,
	InMemorySnapshotArtifactStore,
	type ISnapshotArtifactStore,
	type SnapshotSource,
	type WorkspaceSnapshot,
} from "../src/snapshot-artifact.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_PLAN_EXEC_ID = "plan-exec-123";
const TEST_WORKSPACE_ID = "ws-1";

/**
 * Create a minimal WorkspaceSnapshot for testing.
 */
function makeWorkspaceSnapshot(options: {
	source?: SnapshotSource;
	attemptNumber?: number;
	planExecutionId?: string;
	workspaceId?: string;
	files: Array<{ path: string; content: string | null }>;
}): WorkspaceSnapshot {
	return createWorkspaceSnapshot(
		options.planExecutionId ?? TEST_PLAN_EXEC_ID,
		options.workspaceId ?? TEST_WORKSPACE_ID,
		options.source ?? "pre",
		options.attemptNumber ?? 0,
		options.files,
	);
}

// ---------------------------------------------------------------------------
// computeContentHash
// ---------------------------------------------------------------------------

describe("computeContentHash", () => {
	it("should produce a deterministic SHA-256 hex hash", () => {
		const hash1 = computeContentHash("hello world");
		const hash2 = computeContentHash("hello world");
		expect(hash1).toBe(hash2);
		expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
	});

	it("should produce different hashes for different content", () => {
		const hash1 = computeContentHash("hello");
		const hash2 = computeContentHash("world");
		expect(hash1).not.toBe(hash2);
	});

	it("should handle empty string", () => {
		const hash = computeContentHash("");
		expect(hash).toHaveLength(64);
	});
});

// ---------------------------------------------------------------------------
// createFileSnapshot
// ---------------------------------------------------------------------------

describe("createFileSnapshot", () => {
	it("should create a file snapshot with correct metadata for a text file", () => {
		const snapshot = createFileSnapshot("src/main.ts", "console.log('hello');\n");

		expect(snapshot.path).toBe("src/main.ts");
		expect(snapshot.content).toBe("console.log('hello');\n");
		expect(snapshot.isBinary).toBe(false);
		expect(snapshot.size).toBe(22); // "console.log('hello');\n".length in bytes
		expect(snapshot.language).toBe("TypeScript");
		expect(snapshot.hash).toHaveLength(64);
		expect(snapshot.mtime).toBeGreaterThan(0);
	});

	it("should detect language from extension", () => {
		expect(createFileSnapshot("file.ts", "").language).toBe("TypeScript");
		expect(createFileSnapshot("file.tsx", "").language).toBe("TypeScript React");
		expect(createFileSnapshot("file.js", "").language).toBe("JavaScript");
		expect(createFileSnapshot("file.py", "").language).toBe("Python");
		expect(createFileSnapshot("file.go", "").language).toBe("Go");
		expect(createFileSnapshot("file.rs", "").language).toBe("Rust");
		expect(createFileSnapshot("file.json", "").language).toBe("JSON");
		expect(createFileSnapshot("file.md", "").language).toBe("Markdown");
	});

	it("should return undefined language for unknown extensions", () => {
		const snapshot = createFileSnapshot("file.xyz", "content");
		expect(snapshot.language).toBeUndefined();
	});

	it("should mark files with null content as binary", () => {
		const snapshot = createFileSnapshot("image.png", null);
		expect(snapshot.isBinary).toBe(true);
		expect(snapshot.content).toBeNull();
		expect(snapshot.size).toBe(0);
	});

	it("should include base64 content for binary files", () => {
		const snapshot = createFileSnapshot("image.png", null, undefined, "iVBORw0KGgo=");
		expect(snapshot.isBinary).toBe(true);
		expect(snapshot.base64Content).toBe("iVBORw0KGgo=");
	});

	it("should use provided mtime", () => {
		const mtime = 1234567890;
		const snapshot = createFileSnapshot("file.ts", "content", mtime);
		expect(snapshot.mtime).toBe(mtime);
	});

	it("should compute consistent hash for same content", () => {
		const a = createFileSnapshot("a.ts", "same content");
		const b = createFileSnapshot("b.ts", "same content");
		expect(a.hash).toBe(b.hash);
	});
});

// ---------------------------------------------------------------------------
// createWorkspaceSnapshot
// ---------------------------------------------------------------------------

describe("createWorkspaceSnapshot", () => {
	it("should create a workspace snapshot with correct metadata", () => {
		const snapshot = createWorkspaceSnapshot(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, "pre", 0, [
			{ path: "src/index.ts", content: "const x = 1;" },
		]);

		expect(snapshot.planExecutionId).toBe(TEST_PLAN_EXEC_ID);
		expect(snapshot.workspaceId).toBe(TEST_WORKSPACE_ID);
		expect(snapshot.source).toBe("pre");
		expect(snapshot.attemptNumber).toBe(0);
		expect(snapshot.files).toHaveLength(1);
		expect(snapshot.capturedAt).toBeGreaterThan(0);
	});

	it("should sort files by path", () => {
		const snapshot = createWorkspaceSnapshot(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, "pre", 0, [
			{ path: "z.ts", content: "z" },
			{ path: "a.ts", content: "a" },
			{ path: "m.ts", content: "m" },
		]);

		expect(snapshot.files[0].path).toBe("a.ts");
		expect(snapshot.files[1].path).toBe("m.ts");
		expect(snapshot.files[2].path).toBe("z.ts");
	});

	it("should handle empty file array", () => {
		const snapshot = createWorkspaceSnapshot(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, "post", 1, []);
		expect(snapshot.files).toEqual([]);
	});

	it("should handle binary files in the list", () => {
		const snapshot = createWorkspaceSnapshot(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, "post", 0, [
			{ path: "image.png", content: null },
			{ path: "readme.md", content: "# Hello" },
		]);

		expect(snapshot.files).toHaveLength(2);
		const imageFile = snapshot.files.find((f) => f.path === "image.png")!;
		expect(imageFile.isBinary).toBe(true);
		const readme = snapshot.files.find((f) => f.path === "readme.md")!;
		expect(readme.isBinary).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// computeSnapshotDiff
// ---------------------------------------------------------------------------

describe("computeSnapshotDiff", () => {
	it("should detect added files", () => {
		const pre = makeWorkspaceSnapshot({
			files: [{ path: "existing.ts", content: "old" }],
		});
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [
				{ path: "existing.ts", content: "old" },
				{ path: "new.ts", content: "new file" },
			],
		});

		const diffs = computeSnapshotDiff(pre, post);

		expect(diffs).toHaveLength(1);
		expect(diffs[0].status).toBe("added");
		expect(diffs[0].path).toBe("new.ts");
		expect(diffs[0].preSnapshot).toBeNull();
		expect(diffs[0].postSnapshot).not.toBeNull();
		expect(diffs[0].additions).toBeGreaterThan(0);
	});

	it("should detect deleted files", () => {
		const pre = makeWorkspaceSnapshot({
			files: [
				{ path: "keep.ts", content: "keep" },
				{ path: "remove.ts", content: "remove" },
			],
		});
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [{ path: "keep.ts", content: "keep" }],
		});

		const diffs = computeSnapshotDiff(pre, post);

		expect(diffs).toHaveLength(1);
		expect(diffs[0].status).toBe("deleted");
		expect(diffs[0].path).toBe("remove.ts");
		expect(diffs[0].preSnapshot).not.toBeNull();
		expect(diffs[0].postSnapshot).toBeNull();
	});

	it("should detect modified files with different content", () => {
		const pre = makeWorkspaceSnapshot({
			files: [{ path: "file.ts", content: "const x = 1;" }],
		});
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [{ path: "file.ts", content: "const x = 2;" }],
		});

		const diffs = computeSnapshotDiff(pre, post);

		expect(diffs).toHaveLength(1);
		expect(diffs[0].status).toBe("modified");
		expect(diffs[0].path).toBe("file.ts");
		expect(diffs[0].additions).toBeGreaterThan(0);
		expect(diffs[0].deletions).toBeGreaterThan(0);
	});

	it("should skip identical files (same content hash)", () => {
		const pre = makeWorkspaceSnapshot({
			files: [
				{ path: "a.ts", content: "same" },
				{ path: "b.ts", content: "will change" },
			],
		});
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [
				{ path: "a.ts", content: "same" },
				{ path: "b.ts", content: "changed" },
			],
		});

		const diffs = computeSnapshotDiff(pre, post);

		expect(diffs).toHaveLength(1);
		expect(diffs[0].path).toBe("b.ts");
	});

	it("should handle all changes simultaneously (add, modify, delete)", () => {
		const pre = makeWorkspaceSnapshot({
			files: [
				{ path: "keep.ts", content: "keep" },
				{ path: "modify.ts", content: "old" },
				{ path: "delete.ts", content: "gone" },
			],
		});
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [
				{ path: "keep.ts", content: "keep" },
				{ path: "modify.ts", content: "new" },
				{ path: "add.ts", content: "added" },
			],
		});

		const diffs = computeSnapshotDiff(pre, post);

		expect(diffs).toHaveLength(3);
		expect(diffs.map((d) => d.status)).toEqual(expect.arrayContaining(["added", "modified", "deleted"]));
	});

	it("should sort diffs by path", () => {
		const pre = makeWorkspaceSnapshot({
			files: [
				{ path: "z.ts", content: "z" },
				{ path: "a.ts", content: "a" },
			],
		});
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [
				{ path: "z.ts", content: "changed z" },
				{ path: "a.ts", content: "changed a" },
			],
		});

		const diffs = computeSnapshotDiff(pre, post);

		expect(diffs).toHaveLength(2);
		expect(diffs[0].path).toBe("a.ts");
		expect(diffs[1].path).toBe("z.ts");
	});

	it("should generate unified diff for modified files", () => {
		const pre = makeWorkspaceSnapshot({
			files: [{ path: "hello.ts", content: "const greeting = 'hello';\nconsole.log(greeting);\n" }],
		});
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [{ path: "hello.ts", content: "const greeting = 'hi';\nconsole.log(greeting);\n" }],
		});

		const diffs = computeSnapshotDiff(pre, post);

		expect(diffs).toHaveLength(1);
		expect(diffs[0].diff).toContain("--- a/hello.ts");
		expect(diffs[0].diff).toContain("+++ b/hello.ts");
		expect(diffs[0].diff).toContain("-const greeting = 'hello';");
		expect(diffs[0].diff).toContain("+const greeting = 'hi';");
	});

	it("should generate proper diff for added files", () => {
		const pre = makeWorkspaceSnapshot({
			files: [],
		});
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [{ path: "new.txt", content: "line1\nline2\n" }],
		});

		const diffs = computeSnapshotDiff(pre, post);

		expect(diffs).toHaveLength(1);
		expect(diffs[0].diff).toContain("--- /dev/null");
		expect(diffs[0].diff).toContain("+++ b/new.txt");
		expect(diffs[0].diff).toContain("+line1");
		expect(diffs[0].diff).toContain("+line2");
	});

	it("should generate proper diff for deleted files", () => {
		const pre = makeWorkspaceSnapshot({
			files: [{ path: "old.txt", content: "gone\n" }],
		});
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [],
		});

		const diffs = computeSnapshotDiff(pre, post);

		expect(diffs).toHaveLength(1);
		expect(diffs[0].diff).toContain("--- a/old.txt");
		expect(diffs[0].diff).toContain("+++ /dev/null");
		expect(diffs[0].diff).toContain("-gone");
	});

	it("should handle empty snapshots (no files in either)", () => {
		const pre = makeWorkspaceSnapshot({ files: [] });
		const post = makeWorkspaceSnapshot({ source: "post", files: [] });

		const diffs = computeSnapshotDiff(pre, post);

		expect(diffs).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// computeSnapshotSummary
// ---------------------------------------------------------------------------

describe("computeSnapshotSummary", () => {
	it("should return zeroed summary for empty diffs", () => {
		const summary = computeSnapshotSummary([]);
		expect(summary).toEqual({
			totalFiles: 0,
			addedFiles: 0,
			modifiedFiles: 0,
			deletedFiles: 0,
			totalAdditions: 0,
			totalDeletions: 0,
		});
	});

	it("should aggregate statistics from diffs", () => {
		const pre = makeWorkspaceSnapshot({
			files: [
				{ path: "mod.ts", content: "old line" },
				{ path: "del.ts", content: "delete line" },
			],
		});
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [
				{ path: "mod.ts", content: "new line" },
				{ path: "add.ts", content: "added line" },
			],
		});

		const diffs = computeSnapshotDiff(pre, post);
		const summary = computeSnapshotSummary(diffs, post.files.length);

		expect(summary.addedFiles).toBe(1);
		expect(summary.modifiedFiles).toBe(1);
		expect(summary.deletedFiles).toBe(1);
		expect(summary.totalFiles).toBe(2); // post-snapshot file count
		expect(summary.totalAdditions).toBeGreaterThan(0);
		expect(summary.totalDeletions).toBeGreaterThan(0);
	});

	it("should use postFiles override for totalFiles", () => {
		const diffs: any[] = [];
		const summary = computeSnapshotSummary(diffs, 42);
		expect(summary.totalFiles).toBe(42);
	});
});

// ---------------------------------------------------------------------------
// createSnapshotArtifact
// ---------------------------------------------------------------------------

describe("createSnapshotArtifact", () => {
	it("should create a complete artifact with diffs", () => {
		const pre = makeWorkspaceSnapshot({
			files: [{ path: "file.ts", content: "old" }],
		});
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [{ path: "file.ts", content: "new" }],
		});

		const artifact = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0, pre, post);

		expect(artifact.planExecutionId).toBe(TEST_PLAN_EXEC_ID);
		expect(artifact.workspaceId).toBe(TEST_WORKSPACE_ID);
		expect(artifact.attemptNumber).toBe(0);
		expect(artifact.preSnapshot).toBe(pre);
		expect(artifact.postSnapshot).toBe(post);
		expect(artifact.diffs).toHaveLength(1);
		expect(artifact.summary.modifiedFiles).toBe(1);
		expect(artifact.generatedAt).toBeGreaterThan(0);
	});

	it("should produce empty diffs when preSnapshot is null", () => {
		const post = makeWorkspaceSnapshot({
			source: "post",
			files: [{ path: "file.ts", content: "content" }],
		});

		const artifact = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0, null, post);

		expect(artifact.diffs).toEqual([]);
		expect(artifact.summary.totalFiles).toBe(1);
	});

	it("should produce empty diffs when postSnapshot is null", () => {
		const pre = makeWorkspaceSnapshot({
			files: [{ path: "file.ts", content: "content" }],
		});

		const artifact = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0, pre, null);

		expect(artifact.diffs).toEqual([]);
		expect(artifact.summary.totalAdditions).toBe(0);
	});

	it("should produce empty diffs when both snapshots are null", () => {
		const artifact = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0, null, null);

		expect(artifact.diffs).toEqual([]);
		expect(artifact.summary.totalFiles).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// InMemorySnapshotArtifactStore
// ---------------------------------------------------------------------------

describe("InMemorySnapshotArtifactStore", () => {
	let store: ISnapshotArtifactStore;

	beforeEach(() => {
		store = new InMemorySnapshotArtifactStore();
	});

	it("should save and retrieve an artifact", async () => {
		const artifact = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0, null, null);

		await store.save(artifact);
		const retrieved = await store.get(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0);

		expect(retrieved).not.toBeNull();
		expect(retrieved!.planExecutionId).toBe(TEST_PLAN_EXEC_ID);
		expect(retrieved!.workspaceId).toBe(TEST_WORKSPACE_ID);
		expect(retrieved!.attemptNumber).toBe(0);
	});

	it("should return null for missing artifact", async () => {
		const result = await store.get("nonexistent", "ws-99", 0);
		expect(result).toBeNull();
	});

	it("should list artifacts by plan execution", async () => {
		const a1 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, "ws-1", 0, null, null);
		const a2 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, "ws-2", 0, null, null);
		const a3 = createSnapshotArtifact("other-plan", "ws-3", 0, null, null);

		await store.save(a1);
		await store.save(a2);
		await store.save(a3);

		const list = await store.list(TEST_PLAN_EXEC_ID);
		expect(list).toHaveLength(2);
		expect(list.map((e) => e.workspaceId)).toEqual(expect.arrayContaining(["ws-1", "ws-2"]));
	});

	it("should list multiple attempts for the same workspace", async () => {
		const a1 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0, null, null);
		const a2 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 1, null, null);

		await store.save(a1);
		await store.save(a2);

		const list = await store.list(TEST_PLAN_EXEC_ID);
		expect(list).toHaveLength(2);
	});

	it("should delete all artifacts for a plan execution", async () => {
		const a1 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, "ws-1", 0, null, null);
		const a2 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, "ws-2", 0, null, null);

		await store.save(a1);
		await store.save(a2);
		await store.delete(TEST_PLAN_EXEC_ID);

		const list = await store.list(TEST_PLAN_EXEC_ID);
		expect(list).toEqual([]);
	});

	it("should delete artifacts for a specific workspace only", async () => {
		const a1 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, "ws-1", 0, null, null);
		const a2 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, "ws-2", 0, null, null);

		await store.save(a1);
		await store.save(a2);
		await store.delete(TEST_PLAN_EXEC_ID, "ws-1");

		const list = await store.list(TEST_PLAN_EXEC_ID);
		expect(list).toHaveLength(1);
		expect(list[0].workspaceId).toBe("ws-2");
	});

	it("should support clearing all data", async () => {
		const store2 = store as InMemorySnapshotArtifactStore;
		const artifact = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0, null, null);
		await store.save(artifact);
		await store2.clear();

		const result = await store.get(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0);
		expect(result).toBeNull();
	});

	it("should throw on invalid input", async () => {
		const artifact = createSnapshotArtifact("", TEST_WORKSPACE_ID, 0, null, null);
		await expect(store.save(artifact)).rejects.toThrow("planExecutionId is required");

		const artifact2 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, "", 0, null, null);
		await expect(store.save(artifact2)).rejects.toThrow("workspaceId is required");

		const artifact3 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, -1, null, null);
		await expect(store.save(artifact3)).rejects.toThrow("attemptNumber must be >= 0");
	});

	it("should overwrite existing artifact on same key", async () => {
		const a1 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0, null, null);
		const a2 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0, null, null);

		await store.save(a1);
		await store.save(a2);

		const list = await store.list(TEST_PLAN_EXEC_ID);
		expect(list).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Integration: end-to-end snapshot artifact lifecycle
// ---------------------------------------------------------------------------

describe("Snapshot artifact lifecycle (integration)", () => {
	it("should capture pre snapshot, execute, capture post, and compute artifact", async () => {
		// Simulate pre-execution file state
		const preFiles = [
			{ path: "src/main.ts", content: "const x = 1;\n" },
			{ path: "src/utils.ts", content: "export function add(a: number, b: number) { return a + b; }\n" },
			{ path: "README.md", content: "# Project\nOld docs\n" },
		];

		// Simulate post-execution file state (added, modified, deleted)
		const postFiles = [
			{ path: "src/main.ts", content: "const x = 2;\n" }, // modified
			{ path: "src/utils.ts", content: "export function add(a: number, b: number) { return a + b; }\n" }, // unchanged
			{ path: "src/new.ts", content: "const y = 3;\n" }, // added
			// README.md deleted
		];

		// Compile: create pre/post snapshots
		const pre = createWorkspaceSnapshot(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, "pre", 0, preFiles);
		const post = createWorkspaceSnapshot(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, "post", 0, postFiles);

		// Compute the artifact
		const artifact = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0, pre, post);

		// Verify artifact structure
		expect(artifact.preSnapshot).toBe(pre);
		expect(artifact.postSnapshot).toBe(post);
		expect(artifact.attemptNumber).toBe(0);

		// Verify diffs
		expect(artifact.diffs).toHaveLength(3);
		const modifiedDiffs = artifact.diffs.filter((d) => d.status === "modified");
		const addedDiffs = artifact.diffs.filter((d) => d.status === "added");
		const deletedDiffs = artifact.diffs.filter((d) => d.status === "deleted");

		expect(modifiedDiffs).toHaveLength(1);
		expect(modifiedDiffs[0].path).toBe("src/main.ts");

		expect(addedDiffs).toHaveLength(1);
		expect(addedDiffs[0].path).toBe("src/new.ts");

		expect(deletedDiffs).toHaveLength(1);
		expect(deletedDiffs[0].path).toBe("README.md");

		// Verify summary
		expect(artifact.summary).toEqual({
			totalFiles: 3, // post files
			addedFiles: 1,
			modifiedFiles: 1,
			deletedFiles: 1,
			totalAdditions: expect.any(Number),
			totalDeletions: expect.any(Number),
		});

		// Verify diff content
		const mainDiff = modifiedDiffs[0].diff;
		expect(mainDiff).toContain("-const x = 1;");
		expect(mainDiff).toContain("+const x = 2;");
		expect(mainDiff).toContain("--- a/src/main.ts");
		expect(mainDiff).toContain("+++ b/src/main.ts");

		const addDiff = addedDiffs[0].diff;
		expect(addDiff).toContain("--- /dev/null");
		expect(addDiff).toContain("+++ b/src/new.ts");
		expect(addDiff).toContain("+const y = 3;");

		const delDiff = deletedDiffs[0].diff;
		expect(delDiff).toContain("--- a/README.md");
		expect(delDiff).toContain("+++ /dev/null");
		expect(delDiff).toContain("-# Project");
		expect(delDiff).toContain("-Old docs");

		// Verify unchanged file is NOT in diffs
		expect(artifact.diffs.find((d) => d.path === "src/utils.ts")).toBeUndefined();

		// Store and retrieve
		const store = new InMemorySnapshotArtifactStore();
		await store.save(artifact);

		const retrieved = await store.get(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0);
		expect(retrieved).not.toBeNull();
		expect(retrieved!.diffs).toHaveLength(3);
	});

	it("should handle retries with multiple attempts", async () => {
		const store = new InMemorySnapshotArtifactStore();

		// Attempt 0
		const pre0 = makeWorkspaceSnapshot({
			files: [{ path: "file.ts", content: "v0" }],
		});
		const post0 = makeWorkspaceSnapshot({
			source: "post",
			attemptNumber: 0,
			files: [{ path: "file.ts", content: "v1" }],
		});
		const artifact0 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0, pre0, post0);

		// Attempt 1 (retry)
		const pre1 = makeWorkspaceSnapshot({
			attemptNumber: 1,
			files: [{ path: "file.ts", content: "v1" }],
		});
		const post1 = makeWorkspaceSnapshot({
			source: "post",
			attemptNumber: 1,
			files: [{ path: "file.ts", content: "v2" }],
		});
		const artifact1 = createSnapshotArtifact(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 1, pre1, post1);

		await store.save(artifact0);
		await store.save(artifact1);

		// Both attempts should be independently retrievable
		const r0 = await store.get(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 0);
		expect(r0).not.toBeNull();
		expect(r0!.attemptNumber).toBe(0);
		expect(r0!.diffs).toHaveLength(1);

		const r1 = await store.get(TEST_PLAN_EXEC_ID, TEST_WORKSPACE_ID, 1);
		expect(r1).not.toBeNull();
		expect(r1!.attemptNumber).toBe(1);
		expect(r1!.diffs).toHaveLength(1);

		const list = await store.list(TEST_PLAN_EXEC_ID);
		expect(list).toHaveLength(2);
	});
});
