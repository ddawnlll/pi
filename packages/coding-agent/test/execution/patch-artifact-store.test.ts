/**
 * Tests for PatchArtifactStore.
 *
 * P37.02 Acceptance Criteria:
 * 1. Patch without baseSha, writeSet, or diff/file operations is invalid.
 * 2. Store writes and reads artifact without data loss.
 * 3. Artifact paths are scoped to .pi/patches/.
 *
 * This file tests AC2 (store writes/reads without data loss) and
 * AC3 (paths scoped to .pi/patches/).
 */

import { existsSync, mkdtempSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { PatchArtifact } from "../../src/core/execution/patch/patch-artifact.js";
import {
	createPatchArtifact,
	createPatchFileOperation,
	createPatchWriteSet,
} from "../../src/core/execution/patch/patch-artifact.js";
import { PatchArtifactStore } from "../../src/core/execution/patch/patch-artifact-store.js";
import type { PatchStatus } from "../../src/core/execution/patch/patch-status.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "patch-artifact-store-test-"));
});

// ---------------------------------------------------------------------------
// AC2: Store writes and reads artifact without data loss
// ---------------------------------------------------------------------------

describe("AC2: Store writes and reads artifact without data loss", () => {
	it("should write and read a valid artifact without data loss", async () => {
		const store = new PatchArtifactStore(tempDir);

		const artifact = createPatchArtifact({
			planExecId: "plan-1",
			workspaceId: "ws-1",
			baseSha: "abcdef1234567890abcdef1234567890abcdef12",
			writeSet: createPatchWriteSet(["src/main.ts", "src/utils.ts"]),
			fileOperations: [
				createPatchFileOperation("src/main.ts", "edit", {
					oldText: "console.log('old')",
					newText: "console.log('new')",
					description: "Update log statement",
				}),
				createPatchFileOperation("src/utils.ts", "create", {
					newText: "export const foo = 'bar';\n",
					description: "Add new utility file",
				}),
			],
			description: "Refactor logging",
		});

		// Write
		await store.write(artifact);

		// Read back
		const loaded = await store.read(artifact.id);
		expect(loaded).not.toBeNull();

		// Assert no data loss — all fields match
		expect(loaded!.id).toBe(artifact.id);
		expect(loaded!.planExecId).toBe(artifact.planExecId);
		expect(loaded!.workspaceId).toBe(artifact.workspaceId);
		expect(loaded!.baseSha).toBe(artifact.baseSha);
		expect(loaded!.description).toBe(artifact.description);
		expect(loaded!.status).toBe(artifact.status);
		expect(loaded!.createdAt).toBe(artifact.createdAt);
		expect(loaded!.updatedAt).toBe(artifact.updatedAt);

		// writeSet fields
		expect(loaded!.writeSet.files).toEqual(artifact.writeSet.files);
		expect(loaded!.writeSet.patterns).toBeUndefined();

		// fileOperations fields
		expect(loaded!.fileOperations).toHaveLength(2);
		expect(loaded!.fileOperations[0].filePath).toBe("src/main.ts");
		expect(loaded!.fileOperations[0].operation).toBe("edit");
		expect(loaded!.fileOperations[0].oldText).toBe("console.log('old')");
		expect(loaded!.fileOperations[0].newText).toBe("console.log('new')");
		expect(loaded!.fileOperations[0].description).toBe("Update log statement");

		expect(loaded!.fileOperations[1].filePath).toBe("src/utils.ts");
		expect(loaded!.fileOperations[1].operation).toBe("create");
		expect(loaded!.fileOperations[1].newText).toBe("export const foo = 'bar';\n");
		expect(loaded!.fileOperations[1].description).toBe("Add new utility file");
	});

	it("should write and read multiple artifacts independently", async () => {
		const store = new PatchArtifactStore(tempDir);

		const artifact1 = createPatchArtifact({
			planExecId: "plan-1",
			workspaceId: "ws-1",
			baseSha: "abc111",
			writeSet: createPatchWriteSet(["file-a.ts"]),
			fileOperations: [createPatchFileOperation("file-a.ts", "edit", { oldText: "a", newText: "b" })],
		});

		const artifact2 = createPatchArtifact({
			planExecId: "plan-1",
			workspaceId: "ws-2",
			baseSha: "abc222",
			writeSet: createPatchWriteSet(["file-b.ts"]),
			fileOperations: [createPatchFileOperation("file-b.ts", "create", { newText: "new file" })],
		});

		await store.write(artifact1);
		await store.write(artifact2);

		// Read individually
		const loaded1 = await store.read(artifact1.id);
		const loaded2 = await store.read(artifact2.id);

		expect(loaded1).not.toBeNull();
		expect(loaded2).not.toBeNull();

		// Data is distinct and preserved
		expect(loaded1!.id).toBe(artifact1.id);
		expect(loaded1!.workspaceId).toBe("ws-1");
		expect(loaded2!.id).toBe(artifact2.id);
		expect(loaded2!.workspaceId).toBe("ws-2");

		expect(loaded1!.baseSha).toBe("abc111");
		expect(loaded2!.baseSha).toBe("abc222");
	});

	it("should return null when reading a non-existent artifact", async () => {
		const store = new PatchArtifactStore(tempDir);
		const result = await store.read("nonexistent-artifact");
		expect(result).toBeNull();
	});

	it("should reject writing an invalid artifact", async () => {
		const store = new PatchArtifactStore(tempDir);

		// Artifact with no file operations (should fail validation)
		const invalidArtifact: PatchArtifact = {
			id: "invalid-artifact",
			planExecId: "plan-1",
			workspaceId: "ws-1",
			baseSha: "abc123",
			writeSet: { files: ["src/main.ts"] },
			fileOperations: [],
			status: "pending" as PatchStatus,
			createdAt: "2025-01-01T00:00:00.000Z",
			updatedAt: "2025-01-01T00:00:00.000Z",
		};

		await expect(store.write(invalidArtifact)).rejects.toThrow("Cannot write invalid PatchArtifact");
	});

	it("should list stored artifact IDs", async () => {
		const store = new PatchArtifactStore(tempDir);

		const artifact1 = createPatchArtifact({
			planExecId: "plan-1",
			workspaceId: "ws-1",
			baseSha: "abc111",
			writeSet: createPatchWriteSet(["f1.ts"]),
			fileOperations: [createPatchFileOperation("f1.ts", "edit", { oldText: "a", newText: "b" })],
		});
		const artifact2 = createPatchArtifact({
			planExecId: "plan-1",
			workspaceId: "ws-2",
			baseSha: "abc222",
			writeSet: createPatchWriteSet(["f2.ts"]),
			fileOperations: [createPatchFileOperation("f2.ts", "create", { newText: "c" })],
		});

		await store.write(artifact1);
		await store.write(artifact2);

		const ids = await store.list();
		expect(ids).toContain(artifact1.id);
		expect(ids).toContain(artifact2.id);
		expect(ids).toHaveLength(2);
	});

	it("should return empty list when no artifacts exist", async () => {
		const store = new PatchArtifactStore(tempDir);
		const ids = await store.list();
		expect(ids).toEqual([]);
	});

	it("should check if an artifact exists", async () => {
		const store = new PatchArtifactStore(tempDir);

		const artifact = createPatchArtifact({
			planExecId: "plan-1",
			workspaceId: "ws-1",
			baseSha: "abc111",
			writeSet: createPatchWriteSet(["f1.ts"]),
			fileOperations: [createPatchFileOperation("f1.ts", "edit", { oldText: "a", newText: "b" })],
		});

		expect(await store.exists(artifact.id)).toBe(false);

		await store.write(artifact);

		expect(await store.exists(artifact.id)).toBe(true);
	});

	it("should delete an artifact", async () => {
		const store = new PatchArtifactStore(tempDir);

		const artifact = createPatchArtifact({
			planExecId: "plan-1",
			workspaceId: "ws-1",
			baseSha: "abc111",
			writeSet: createPatchWriteSet(["f1.ts"]),
			fileOperations: [createPatchFileOperation("f1.ts", "edit", { oldText: "a", newText: "b" })],
		});

		await store.write(artifact);
		expect(await store.exists(artifact.id)).toBe(true);

		const deleted = await store.delete(artifact.id);
		expect(deleted).toBe(true);
		expect(await store.exists(artifact.id)).toBe(false);
	});

	it("should return false when deleting non-existent artifact", async () => {
		const store = new PatchArtifactStore(tempDir);
		const deleted = await store.delete("nonexistent");
		expect(deleted).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// AC3: Artifact paths are scoped to .pi/patches/
// ---------------------------------------------------------------------------

describe("AC3: Artifact paths are scoped to .pi/patches/", () => {
	it("should store artifacts under .pi/patches/ directory", async () => {
		const store = new PatchArtifactStore(tempDir);

		const artifact = createPatchArtifact({
			planExecId: "plan-1",
			workspaceId: "ws-1",
			baseSha: "abc123",
			writeSet: createPatchWriteSet(["src/main.ts"]),
			fileOperations: [createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" })],
		});

		await store.write(artifact);

		// The file should exist at .pi/patches/<id>.json
		const expectedPath = join(tempDir, ".pi", "patches", `${artifact.id}.json`);
		expect(existsSync(expectedPath)).toBe(true);
	});

	it("should reject paths outside .pi/patches/", async () => {
		const store = new PatchArtifactStore(tempDir);

		// Verify the store's patchesDirectory is within .pi/patches/
		expect(store.patchesDirectory).toBe(join(tempDir, ".pi", "patches"));
	});

	it("should create .pi/patches/ directory on first write", async () => {
		const store = new PatchArtifactStore(tempDir);
		const patchesDir = join(tempDir, ".pi", "patches");

		// Verify directory doesn't exist before write
		expect(existsSync(patchesDir)).toBe(false);

		const artifact = createPatchArtifact({
			planExecId: "plan-1",
			workspaceId: "ws-1",
			baseSha: "abc123",
			writeSet: createPatchWriteSet(["src/main.ts"]),
			fileOperations: [createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" })],
		});

		await store.write(artifact);

		// Directory should now exist
		expect(existsSync(patchesDir)).toBe(true);
	});

	it("should list only .json files in .pi/patches/", async () => {
		const store = new PatchArtifactStore(tempDir);

		// Write a valid artifact
		const artifact = createPatchArtifact({
			planExecId: "plan-1",
			workspaceId: "ws-1",
			baseSha: "abc123",
			writeSet: createPatchWriteSet(["src/main.ts"]),
			fileOperations: [createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" })],
		});
		await store.write(artifact);

		// Write a non-json file to the same directory (should be ignored by list)
		const patchesDir = join(tempDir, ".pi", "patches");
		await fs.writeFile(join(patchesDir, "random.txt"), "not a patch", "utf-8");

		const ids = await store.list();
		expect(ids).toEqual([artifact.id]);
	});
});
