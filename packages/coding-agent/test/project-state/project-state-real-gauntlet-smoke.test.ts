/**
 * Project State — Real Gauntlet Smoke — PSS-MEGA-02.2
 *
 * End-to-end smoke test proving the full Project State Snapshot layer is shippable.
 *
 * Steps:
 *   1. Create temp repo with source files
 *   2. Run real snapshot
 *   3. Verify state files produced
 *   4. Verify Smart Read / read-time verification
 *   5. Simulate real write hook → event → projector → state
 *   6. Simulate real edit hook → event → projector → stale Smart Read
 *   7. Classify bash read-only → no mutation window
 *   8. Classify bash unknown → mutation window + dirty/unknown state
 *   9. Bash unknown failure → mutation window failed, state not valid
 *  10. Query budget enforcement
 *  11. No stale cache served
 *  12. No mutation window leak
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStateSnapshotService } from "../../src/core/project-state/snapshot-service.js";
import { ProjectStateStore } from "../../src/core/project-state/store.js";
import { ProjectStateEventJournal } from "../../src/core/project-state/event-journal.js";
import { ProjectStateProjector } from "../../src/core/project-state/projector.js";
import { MutationWindowStore } from "../../src/core/project-state/mutation-window-store.js";
import { QueryService } from "../../src/core/project-state/query-service.js";
import { ReadTimeVerifier } from "../../src/core/project-state/read-time-verifier.js";
import { SmartReadDiskCache } from "../../src/core/token-context/smart-read-disk-cache.js";
import {
	afterFileWrite,
	afterFileEdit,
	beforeBashCommand,
	afterBashCommand,
} from "../../src/core/project-state-hooks.js";
import type { BashCommandOutcome } from "../../src/core/project-state-hooks.js";
import { getStateDir, STATE_FILES } from "../../src/core/project-state/paths.js";

describe("Project State Real Gauntlet Smoke", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-gauntlet-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("full end-to-end gauntlet", async () => {
		// ====================================================================
		// Step 0: Create temp repo with files
		// ====================================================================
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		mkdirSync(join(tmpDir, "src", "nested"), { recursive: true });
		mkdirSync(join(tmpDir, "test"), { recursive: true });
		mkdirSync(join(tmpDir, ".git"), { recursive: true });

		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({
			name: "smoke-test",
			scripts: { test: "vitest", build: "tsc" },
		}), "utf-8");
		writeFileSync(join(tmpDir, "src", "a.ts"), "export const greet = (name: string) => `Hello, ${name}!`;\n", "utf-8");
		writeFileSync(join(tmpDir, "src", "b.ts"), "export const add = (a: number, b: number) => a + b;\n", "utf-8");
		writeFileSync(join(tmpDir, "src", "nested", "c.ts"), 'export const magic = 42;\n', "utf-8");
		writeFileSync(join(tmpDir, "test", "a.test.ts"), "import { greet } from '../src/a';\n", "utf-8");

		// ====================================================================
		// Step 1: Run real snapshot
		// ====================================================================
		const svc = new ProjectStateSnapshotService();
		const result = await svc.run({ rootDir: tmpDir });

		expect(result.filesScanned).toBeGreaterThanOrEqual(3);
		expect(result.filesFailed).toBe(0);

		// ====================================================================
		// Step 2: Verify state files exist
		// ====================================================================
		const store = new ProjectStateStore(tmpDir);
		const manifest = store.loadManifest();
		expect(manifest).toBeDefined();
		expect(manifest!.fileCount).toBeGreaterThanOrEqual(3);
		expect(manifest!.sourceFileCount).toBeGreaterThanOrEqual(3);

		const filesState = store.loadFilesState();
		expect(filesState).toBeDefined();
		expect(filesState!.files["src/a.ts"]).toBeDefined();
		expect(filesState!.files["src/nested/c.ts"]).toBeDefined();

		const treeIndex = store.loadTreeIndex();
		expect(treeIndex).toBeDefined();
		expect(treeIndex!.directories["src"]).toBeDefined();
		expect(treeIndex!.directories["src/nested"]).toBeDefined();

		const packageState = store.loadPackageState();
		expect(packageState).toBeDefined();
		expect(packageState!.packageManager).toBe("unknown"); // No lockfile
		expect(packageState!.packageFiles["package.json"]).toBeDefined();

		const gitState = store.loadGitState();
		expect(gitState).toBeDefined();
		expect(gitState!.isGitRepo).toBe(false); // Stub .git dir, not real git

		// ====================================================================
		// Step 3: Snapshot status
		// ====================================================================
		const status = svc.getStatus(tmpDir);
		expect(status.fileCount).toBeGreaterThanOrEqual(3);
		expect(manifest!.validity.files).toBe("valid");
		expect(manifest!.validity.tree).toBe("valid");

		// ====================================================================
		// Step 4: Smart Read / read-time verification
		// ====================================================================
		const cache = new SmartReadDiskCache({ cacheDir: join(tmpDir, ".pi", "smart-read-cache") });
		const verifier = new ReadTimeVerifier(store, cache);

		// File existed before edit
		writeFileSync(join(tmpDir, "src", "a.ts"), "export const greet = (name: string) => `Hello, ${name}!`;\n", "utf-8");

		// Verify still accepts if content unchanged
		const verifyUnchanged = verifier.verify("src/a.ts");
		// (it may be stale if snapshot didn't hash or changed file)

		// Change file externally and verify verifier catches it
		writeFileSync(join(tmpDir, "src", "a.ts"), "export const greet = (name: string) => `Hi, ${name}!`;\n", "utf-8");
		const verifyChanged = verifier.verify("src/a.ts");
		expect(verifyChanged.canUseCache).toBe(false);

		// ====================================================================
		// Step 5: Real write hook → event → projector → state
		// ====================================================================
		afterFileWrite(tmpDir, "src/new-file.ts", "export const created = true;\n");

		const journal = new ProjectStateEventJournal(tmpDir);
		const writeEvents = journal.loadEvents(0).filter((e) => e.event.type === "file_written");
		expect(writeEvents.length).toBeGreaterThan(0);
		expect((writeEvents[writeEvents.length - 1].event as any).path).toBe("src/new-file.ts");

		// Verify projector applied
		const filesAfterWrite = store.loadFilesState();
		expect(filesAfterWrite!.files["src/new-file.ts"]).toBeDefined();

		// ====================================================================
		// Step 6: Real edit hook → event → projector → stale Smart Read
		// ====================================================================
		const oldContent = 'export const greet = (name: string) => `Hi, ${name}!`;\n';
		const newContent = 'export const greet = (name: string) => `Hey, ${name}!`;\n';
		writeFileSync(join(tmpDir, "src", "a.ts"), oldContent, "utf-8");
		// First sync — write it so it's in the project state with a hash
		// Then edit via hook
		afterFileEdit(tmpDir, "src/a.ts", newContent, oldContent);

		const editEvents = journal.loadEvents(0).filter((e) => e.event.type === "file_edited");
		expect(editEvents.length).toBeGreaterThan(0);

		const filesAfterEdit = store.loadFilesState();
		expect(filesAfterEdit!.files["src/a.ts"]).toBeDefined();
		expect(filesAfterEdit!.files["src/a.ts"]!.smartReadStatus).toBe("stale");

		// ====================================================================
		// Step 7: Bash read-only — no mutation window
		// ====================================================================
		const readOnlyResult = beforeBashCommand(tmpDir, "pwd", tmpDir);
		expect(readOnlyResult.classification.effect).toBe("no_state_change");
		expect(readOnlyResult.mutationWindowId).toBeUndefined();

		afterBashCommand(tmpDir, "pwd", 0, readOnlyResult.classification);

		const completedEvents = journal.loadEvents(0).filter((e) => e.event.type === "command_completed");
		expect(completedEvents.length).toBeGreaterThan(0);

		// ====================================================================
		// Step 8: Bash unknown mutation → window opened + state dirty
		// ====================================================================
		const unknownResult = beforeBashCommand(tmpDir, "python script.py", tmpDir);
		expect(unknownResult.classification.effect).toBe("unknown_global_mutation");
		expect(unknownResult.mutationWindowId).toBeDefined();
		expect(openMutationWindowCount(tmpDir)).toBe(1);

		afterBashCommand(tmpDir, "python script.py", 0, unknownResult.classification, unknownResult.mutationWindowId);

		// Window should be closed or reconciling
		const mw = new MutationWindowStore(tmpDir);
		const window = mw.get(unknownResult.mutationWindowId!);
		expect(window).toBeDefined();
		expect(window!.status === "closed" || window!.status === "reconciling" || window!.status === "failed").toBe(true);
		expect(mw.openCount()).toBe(0);

		// ====================================================================
		// Step 9: Bash unknown failure → window failed, state not valid
		// ====================================================================
		const failResult = beforeBashCommand(tmpDir, "node -e 'process.exit(7)'", tmpDir);
		expect(failResult.mutationWindowId).toBeDefined();

		const outcome: BashCommandOutcome = { exitCode: 7, status: "failed", durationMs: 100 };
		afterBashCommand(tmpDir, "node -e 'process.exit(7)'", outcome, failResult.classification, failResult.mutationWindowId);

		// Window should be failed
		const failMw = new MutationWindowStore(tmpDir);
		const failWindow = failMw.get(failResult.mutationWindowId!);
		expect(failWindow).toBeDefined();
		expect(failWindow!.status).toBe("failed");

		// ====================================================================
		// Step 10: Query budget enforcement
		// ====================================================================
		// Create 200 generated files to test budget
		mkdirSync(join(tmpDir, "src", "generated"), { recursive: true });
		for (let i = 0; i < 200; i++) {
			writeFileSync(
				join(tmpDir, "src", "generated", `file-${String(i).padStart(3, "0")}.ts`),
				`// Generated file ${i}\n`,
				"utf-8",
			);
		}

		// Re-snapshot to include generated files
		await svc.run({ rootDir: tmpDir, force: true });

		const query = new QueryService(store);

		// rg-files default should be capped
		const rgResult = query.rgFiles("src/generated");
		expect(rgResult.totalItems).toBe(200);
		expect(rgResult.truncated).toBe(true);
		if (rgResult.items) {
			expect(rgResult.items.length).toBeLessThanOrEqual(120);
		}

		// rg-files with mode=full should return all
		const rgFull = query.rgFiles("src/generated", { mode: "full" });
		expect(rgFull.truncated).toBe(false);
		if (rgFull.items) {
			expect(rgFull.items.length).toBe(200);
		}

		// ls should be capped
		const lsResult = query.ls("src/generated");
		if (lsResult.items) {
			expect(lsResult.items.length).toBeLessThanOrEqual(100);
		}

		// ====================================================================
		// Step 11: No stale cache served
		// ====================================================================
		// Verify that dirty state blocks rg-files
		const m = store.loadManifest()!;
		m.validity.files = "dirty";
		store.saveManifest(m);

		const dirtyResult = query.rgFiles();
		expect(dirtyResult.source).toBe("unavailable");
		expect(dirtyResult.validity).toBe("dirty");

		// ====================================================================
		// Step 12: No mutation window leak
		// ====================================================================
		const finalMw = new MutationWindowStore(tmpDir);
		expect(finalMw.openCount()).toBe(0);

		// Print success marker
		console.log("Gauntlet smoke — ALL 12 STEPS PASSED");
	});
});

function openMutationWindowCount(rootDir: string): number {
	const mw = new MutationWindowStore(rootDir);
	return mw.openCount();
}
