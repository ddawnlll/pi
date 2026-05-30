/**
 * Tests for PatchArtifact schema and validation.
 *
 * P37.02 Acceptance Criteria:
 * 1. Patch without baseSha, writeSet, or diff/file operations is invalid.
 * 2. Store writes and reads artifact without data loss.
 * 3. Artifact paths are scoped to .pi/patches/.
 *
 * This file tests AC1 (schema and validation).
 */

import { describe, expect, it } from "vitest";
import type { PatchArtifact } from "../../src/core/execution/patch/patch-artifact.js";
import {
	createPatchArtifact,
	createPatchFileOperation,
	createPatchWriteSet,
} from "../../src/core/execution/patch/patch-artifact.js";
import type { PatchStatus } from "../../src/core/execution/patch/patch-status.js";
import { validatePatchArtifact } from "../../src/core/execution/patch/patch-validation-plan.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validArtifact(): PatchArtifact {
	return {
		id: "test-artifact-1",
		planExecId: "plan-1",
		workspaceId: "ws-1",
		baseSha: "abcdef1234567890abcdef1234567890abcdef12",
		writeSet: { files: ["src/main.ts"] },
		fileOperations: [
			{
				filePath: "src/main.ts",
				operation: "edit",
				oldText: "console.log('old')",
				newText: "console.log('new')",
			},
		],
		status: "pending" as PatchStatus,
		createdAt: "2025-01-01T00:00:00.000Z",
		updatedAt: "2025-01-01T00:00:00.000Z",
	};
}

// ---------------------------------------------------------------------------
// AC1: Validation
// ---------------------------------------------------------------------------

describe("AC1: Patch without baseSha, writeSet, or file operations is invalid", () => {
	describe("valid patch", () => {
		it("should pass validation for a complete patch artifact", () => {
			const artifact = validArtifact();
			const result = validatePatchArtifact(artifact);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});
	});

	describe("baseSha validation", () => {
		it("should fail validation when baseSha is undefined", () => {
			const artifact = validArtifact();
			artifact.baseSha = undefined as unknown as string;
			const result = validatePatchArtifact(artifact);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === "MISSING_BASE_SHA")).toBe(true);
		});

		it("should fail validation when baseSha is empty string", () => {
			const artifact = validArtifact();
			artifact.baseSha = "";
			const result = validatePatchArtifact(artifact);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === "MISSING_BASE_SHA")).toBe(true);
		});

		it("should fail validation when baseSha is whitespace", () => {
			const artifact = validArtifact();
			artifact.baseSha = "   ";
			const result = validatePatchArtifact(artifact);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === "MISSING_BASE_SHA")).toBe(true);
		});
	});

	describe("writeSet validation", () => {
		it("should fail validation when writeSet is undefined", () => {
			const artifact = validArtifact();
			artifact.writeSet = undefined as unknown as { files: string[]; patterns?: string[] };
			const result = validatePatchArtifact(artifact);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === "MISSING_WRITE_SET")).toBe(true);
		});

		it("should fail validation when writeSet.files is undefined", () => {
			const artifact = validArtifact();
			artifact.writeSet = { files: undefined as unknown as string[] };
			const result = validatePatchArtifact(artifact);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === "MISSING_WRITE_SET_FILES")).toBe(true);
		});

		it("should fail validation when writeSet.files is empty", () => {
			const artifact = validArtifact();
			artifact.writeSet = { files: [] };
			const result = validatePatchArtifact(artifact);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === "MISSING_WRITE_SET_FILES")).toBe(true);
		});
	});

	describe("fileOperations validation", () => {
		it("should fail validation when fileOperations is undefined", () => {
			const artifact = validArtifact();
			artifact.fileOperations = undefined as unknown as Array<{
				filePath: string;
				operation: "edit" | "create" | "delete";
				oldText?: string;
				newText?: string;
				diff?: string;
				description?: string;
			}>;
			const result = validatePatchArtifact(artifact);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === "MISSING_FILE_OPERATIONS")).toBe(true);
		});

		it("should fail validation when fileOperations is empty array", () => {
			const artifact = validArtifact();
			artifact.fileOperations = [];
			const result = validatePatchArtifact(artifact);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.code === "EMPTY_FILE_OPERATIONS")).toBe(true);
		});
	});

	describe("createPatchArtifact helper", () => {
		it("should create a valid artifact with the factory function", () => {
			const artifact = createPatchArtifact({
				planExecId: "plan-1",
				workspaceId: "ws-1",
				baseSha: "abc123",
				writeSet: createPatchWriteSet(["src/main.ts"]),
				fileOperations: [createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" })],
				description: "test patch",
			});

			expect(artifact.id).toBeTruthy();
			expect(artifact.baseSha).toBe("abc123");
			expect(artifact.writeSet.files).toEqual(["src/main.ts"]);
			expect(artifact.fileOperations).toHaveLength(1);
			expect(artifact.status).toBe("pending");
			expect(artifact.description).toBe("test patch");
		});

		it("should throw when creating an artifact without baseSha", () => {
			expect(() =>
				createPatchArtifact({
					planExecId: "plan-1",
					workspaceId: "ws-1",
					baseSha: "",
					writeSet: createPatchWriteSet(["src/main.ts"]),
					fileOperations: [createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" })],
				}),
			).toThrow("Invalid PatchArtifact");
		});

		it("should throw when creating an artifact without writeSet files", () => {
			expect(() =>
				createPatchArtifact({
					planExecId: "plan-1",
					workspaceId: "ws-1",
					baseSha: "abc123",
					writeSet: createPatchWriteSet([]),
					fileOperations: [createPatchFileOperation("src/main.ts", "edit", { oldText: "a", newText: "b" })],
				}),
			).toThrow("Invalid PatchArtifact");
		});

		it("should throw when creating an artifact without file operations", () => {
			expect(() =>
				createPatchArtifact({
					planExecId: "plan-1",
					workspaceId: "ws-1",
					baseSha: "abc123",
					writeSet: createPatchWriteSet(["src/main.ts"]),
					fileOperations: [],
				}),
			).toThrow("Invalid PatchArtifact");
		});
	});
});
