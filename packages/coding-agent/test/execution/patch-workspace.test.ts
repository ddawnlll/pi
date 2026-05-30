/**
 * Tests for PatchWorkspace orchestration.
 *
 * P37.04 Acceptance Criteria:
 * 1. PatchWorkspace creates overlay, generates diffs, detects direct mutations
 * 2. Tests pass
 */

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PatchWorkspace } from "../../src/core/execution/patch/patch-workspace.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "patch-workspace-test-"));
});

/**
 * Create a minimal workspace structure for testing.
 */
async function createTestWorkspace(root: string): Promise<void> {
	await mkdir(join(root, "src"), { recursive: true });
	await writeFile(join(root, "src", "main.ts"), "console.log('hello');\n", "utf-8");
	await writeFile(join(root, "src", "utils.ts"), "export const add = (a: number, b: number) => a + b;\n", "utf-8");
	await writeFile(join(root, "README.md"), "# Test Workspace\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Direct mode tests
// ---------------------------------------------------------------------------

describe("PatchWorkspace - direct mode", () => {
	it("should return the original workspace root as effective root in direct mode", () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "direct",
		});

		expect(pw.currentMode).toBe("direct");
		expect(pw.getEffectiveWorkspaceRoot()).toBe(tempDir);
	});

	it("should allow all file writes in direct mode", () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "direct",
		});

		const result = pw.checkFileWrite(join(tempDir, "src", "main.ts"));
		expect(result.allowed).toBe(true);
	});

	it("should return empty diffs in direct mode", async () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "direct",
		});

		const diffs = await pw.generateDiffs();
		expect(diffs).toEqual([]);
	});

	it("should not create artifact in direct mode", () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "direct",
		});

		const artifact = pw.createPatchArtifact("abc123", []);
		expect(artifact).toBeUndefined();
	});

	it("should initialize overlay without error in direct mode", async () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "direct",
		});

		// Should be a no-op
		await pw.initializeOverlay();
		expect(pw.overlayPath).toBeTruthy();
	});

	it("should execute without overlay artifacts in direct mode", async () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "direct",
		});

		const result = await pw.execute("abc123");
		expect(result.success).toBe(true);
		expect(result.diffs).toEqual([]);
		expect(result.artifact).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Overlay mode tests
// ---------------------------------------------------------------------------

describe("PatchWorkspace - overlay mode", () => {
	it("should return the overlay path as effective root in overlay mode", () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
		});

		expect(pw.currentMode).toBe("overlay");
		expect(pw.getEffectiveWorkspaceRoot()).toBe(pw.overlayPath);
	});

	it("should initialize overlay directory", async () => {
		await createTestWorkspace(tempDir);

		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
		});

		await pw.initializeOverlay();

		// Overlay directory should exist
		expect(existsSync(pw.overlayPath)).toBe(true);

		// Files should be copied
		expect(existsSync(join(pw.overlayPath, "src", "main.ts"))).toBe(true);
		expect(existsSync(join(pw.overlayPath, "src", "utils.ts"))).toBe(true);
		expect(existsSync(join(pw.overlayPath, "README.md"))).toBe(true);
	});

	it("should block writes to main repo in overlay mode", async () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
		});

		// Write to main repo should be blocked
		const result = pw.checkFileWrite(join(tempDir, "src", "main.ts"));
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("DIRECT MUTATION DETECTED");
	});

	it("should allow writes to overlay path in overlay mode", async () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
		});

		// Write to overlay path should be allowed
		const result = pw.checkFileWrite(join(pw.overlayPath, "src", "main.ts"));
		expect(result.allowed).toBe(true);
	});

	it("should allow writes outside main repo in overlay mode", async () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
		});

		// Write to /tmp should be allowed
		const result = pw.checkFileWrite(join(tmpdir(), "some-file.ts"));
		expect(result.allowed).toBe(true);
	});

	it("should generate diffs for modified files in overlay", async () => {
		await createTestWorkspace(tempDir);

		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
		});

		// Initialize overlay (copy workspace files)
		await pw.initializeOverlay();

		// Modify a file in the overlay
		writeFileSync(join(pw.overlayPath, "src", "main.ts"), "console.log('modified');\n");

		// Generate diffs
		const diffs = await pw.generateDiffs();
		expect(diffs.length).toBeGreaterThan(0);

		const mainDiff = diffs.find((d) => d.filePath === "src/main.ts");
		expect(mainDiff).toBeDefined();
		expect(mainDiff!.type).toBe("modified");
		expect(mainDiff!.diff).toContain("console.log('hello');");
		expect(mainDiff!.diff).toContain("console.log('modified');");
	});

	it("should generate diffs for created files in overlay", async () => {
		await createTestWorkspace(tempDir);

		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
		});

		await pw.initializeOverlay();

		// Create a new file in the overlay
		writeFileSync(join(pw.overlayPath, "src", "new-file.ts"), "export const newFeature = true;\n");

		const diffs = await pw.generateDiffs();
		const newFileDiff = diffs.find((d) => d.filePath === "src/new-file.ts");
		expect(newFileDiff).toBeDefined();
		expect(newFileDiff!.type).toBe("created");
	});

	it("should create a patch artifact from diffs", async () => {
		await createTestWorkspace(tempDir);

		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
		});

		await pw.initializeOverlay();

		// Modify a file
		writeFileSync(join(pw.overlayPath, "src", "main.ts"), "console.log('modified');\n");

		const diffs = await pw.generateDiffs();
		const artifact = pw.createPatchArtifact("abc123def456", diffs);

		expect(artifact).toBeDefined();
		expect(artifact!.baseSha).toBe("abc123def456");
		expect(artifact!.planExecId).toBe("plan-1");
		expect(artifact!.workspaceId).toBe("ws-1");
		expect(artifact!.fileOperations.length).toBeGreaterThan(0);
		expect(artifact!.writeSet.files).toContain("src/main.ts");
	});

	it("should execute full overlay workflow", async () => {
		await createTestWorkspace(tempDir);

		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
		});

		// Modify files in overlay directly (simulating worker writes)
		await pw.initializeOverlay();
		writeFileSync(join(pw.overlayPath, "src", "main.ts"), "console.log('modified');\n");
		writeFileSync(join(pw.overlayPath, "src", "new-file.ts"), "export const foo = 'bar';\n");

		const result = await pw.execute("abc123");

		expect(result.success).toBe(true);
		expect(result.diffs).toBeDefined();
		expect(result.diffs!.length).toBeGreaterThan(0);
		expect(result.artifact).toBeDefined();
		expect(result.overlayPath).toBe(pw.overlayPath);

		// Overlay should be cleaned up
		expect(existsSync(pw.overlayPath)).toBe(false);
	});

	it("should preserve overlay when preserveOverlay is set", async () => {
		await createTestWorkspace(tempDir);

		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
			preserveOverlay: true,
		});

		await pw.initializeOverlay();
		writeFileSync(join(pw.overlayPath, "src", "main.ts"), "console.log('modified');\n");

		const result = await pw.execute("abc123");

		expect(result.success).toBe(true);

		// Overlay should still exist (preserved for debugging)
		expect(existsSync(pw.overlayPath)).toBe(true);
	});

	it("should handle execute errors gracefully", async () => {
		// Create a PatchWorkspace pointing to a non-existent directory
		const pw = new PatchWorkspace({
			workspaceRoot: "/nonexistent/path/that/does/not/exist",
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
		});

		const result = await pw.execute("abc123");
		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Worktree mode tests
// ---------------------------------------------------------------------------

describe("PatchWorkspace - worktree mode", () => {
	it("should return workspace root as effective root in worktree mode", () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "worktree",
		});

		expect(pw.currentMode).toBe("worktree");
		expect(pw.getEffectiveWorkspaceRoot()).toBe(tempDir);
	});

	it("should allow all file writes in worktree mode", () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "worktree",
		});

		const result = pw.checkFileWrite(join(tempDir, "src", "main.ts"));
		expect(result.allowed).toBe(true);
	});

	it("should return empty diffs in worktree mode", async () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "worktree",
		});

		const diffs = await pw.generateDiffs();
		expect(diffs).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// DirectMutationDetector tests
// ---------------------------------------------------------------------------

describe("PatchWorkspace - direct mutation detector integration", () => {
	it("should expose the direct mutation detector in overlay mode", () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "overlay",
		});

		const detector = pw.directMutationDetector;
		expect(detector).toBeDefined();
		expect(detector.isEnabled).toBe(true);
	});

	it("should expose disabled detector in direct mode", () => {
		const pw = new PatchWorkspace({
			workspaceRoot: tempDir,
			planExecId: "plan-1",
			workspaceId: "ws-1",
			mode: "direct",
		});

		const detector = pw.directMutationDetector;
		expect(detector).toBeDefined();
		expect(detector.isEnabled).toBe(false);
	});
});
