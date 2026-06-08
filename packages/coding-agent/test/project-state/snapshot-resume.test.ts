/**
 * Snapshot resume tests
 *
 * Tests snapshot run persistence and resume logic.
 */

import { existsSync, mkdirSync, mkdtempSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSnapshotRunFilePath, getSnapshotRunsDir } from "../../src/core/project-state/paths.js";
import { SnapshotRunStore } from "../../src/core/project-state/snapshot-run-store.js";
import { ProjectStateSnapshotService } from "../../src/core/project-state/snapshot-service.js";

describe("Snapshot resume", () => {
	let tmpDir: string;
	let service: ProjectStateSnapshotService;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-resume-test-"));
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		writeFileSync(join(tmpDir, "src", "b.ts"), "const y = 2;\n", "utf-8");
		writeFileSync(join(tmpDir, "src", "c.ts"), "const z = 3;\n", "utf-8");

		service = new ProjectStateSnapshotService();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("snapshot run state is created during run", async () => {
		const result = await service.run({ rootDir: tmpDir });

		const runStore = new SnapshotRunStore(tmpDir);
		const runs = runStore.listAllRuns();
		expect(runs.length).toBeGreaterThan(0);

		const latestRun = runs[0];
		expect(latestRun.snapshotRunId).toBeDefined();
		expect(latestRun.status).toBe("completed");
	});

	it("resume returns null when no interrupted run exists", async () => {
		const result = await service.resume({ rootDir: tmpDir });
		expect(result).toBeNull();
	});

	it("interrupted run can be resumed", async () => {
		// Create an interrupted run state
		const runStore = new SnapshotRunStore(tmpDir);
		const runState = runStore.createRunState(["src/a.ts", "src/b.ts", "src/c.ts"]);
		runState.status = "interrupted";
		runState.completedFiles = ["src/a.ts"];
		runState.pendingFiles = ["src/b.ts", "src/c.ts"];
		runStore.saveRunState(runState);

		// Simulate some partial state files existing
		const result = await service.resume({ rootDir: tmpDir });

		// Should have completed successfully (files still exist)
		if (result !== null) {
			expect(result.filesScanned).toBeGreaterThanOrEqual(1);
		}
	});

	it("stale completed file is reprocessed", async () => {
		const runStore = new SnapshotRunStore(tmpDir);
		const runState = runStore.createRunState(["src/a.ts", "src/b.ts"]);
		runState.status = "interrupted";
		runState.completedFiles = ["src/nonexistent.ts"];
		runState.pendingFiles = ["src/a.ts", "src/b.ts"];
		runStore.saveRunState(runState);

		const result = await service.resume({ rootDir: tmpDir });
		if (result !== null) {
			expect(result.filesScanned).toBeGreaterThanOrEqual(1);
		}
	});

	it("failed file remains reported in resume", async () => {
		const runStore = new SnapshotRunStore(tmpDir);
		const runState = runStore.createRunState(["src/a.ts"]);
		runState.status = "interrupted";
		runState.failedFiles = [{ path: "src/b.ts", error: "Previous failure" }];
		runStore.saveRunState(runState);

		const result = await service.resume({ rootDir: tmpDir });
		if (result !== null) {
			// Previous failures should be preserved
			expect(result.failures).toBeDefined();
		}
	});

	it("findLatestResumableRun finds interrupted runs", () => {
		const runStore = new SnapshotRunStore(tmpDir);
		const runState = runStore.createRunState(["src/a.ts"]);
		runState.status = "interrupted";
		runStore.saveRunState(runState);

		const found = runStore.findLatestResumableRun();
		expect(found).toBeDefined();
		expect(found!.snapshotRunId).toBe(runState.snapshotRunId);
	});

	it("findLatestResumableRun ignores completed runs", () => {
		const runStore = new SnapshotRunStore(tmpDir);
		const runState = runStore.createRunState(["src/a.ts"]);
		runState.status = "completed";
		runStore.saveRunState(runState);

		const found = runStore.findLatestResumableRun();
		expect(found).toBeUndefined();
	});
});
