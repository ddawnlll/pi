/**
 * Runtime wiring tests — PSS-MEGA-02.1
 *
 * Tests that the ToolEventEmitter is actually called from real write/edit/bash paths,
 * and that events flow through journal → projector → persisted state correctly.
 *
 * Uses the real hook functions in a controlled temp directory.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStateEventJournal } from "../../src/core/project-state/event-journal.js";
import { MutationWindowStore } from "../../src/core/project-state/mutation-window-store.js";
import { getStateDir, SCHEMA_VERSION, STATE_FILES } from "../../src/core/project-state/paths.js";
import { ProjectStateProjector } from "../../src/core/project-state/projector.js";
import { ProjectStateSnapshotService } from "../../src/core/project-state/snapshot-service.js";
import { ProjectStateStore } from "../../src/core/project-state/store.js";
import {
	afterBashCommand,
	afterFileEdit,
	afterFileWrite,
	beforeBashCommand,
} from "../../src/core/project-state-hooks.js";

describe("Runtime wiring — write hooks", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-runtime-write-"));
		mkdirSync(join(tmpDir, "src"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("afterFileWrite emits file_written and projector applies to files.json", async () => {
		// Create snapshot state first
		const svc = new ProjectStateSnapshotService();
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		await svc.run({ rootDir: tmpDir });

		// Now simulate a file write via the hook
		afterFileWrite(tmpDir, "src/new.ts", "const y = 2;\n");

		// Check journal has the file_written event (the latest event added)
		const journal = new ProjectStateEventJournal(tmpDir);
		const events = journal.loadEvents(0);
		const writeEvents = events.filter((e) => e.event.type === "file_written");
		expect(writeEvents.length).toBeGreaterThan(0);
		const lastWriteEvent = writeEvents[writeEvents.length - 1];
		expect((lastWriteEvent.event as any).path).toBe("src/new.ts");

		// Check that projector has applied — files.json has the new file
		const store = new ProjectStateStore(tmpDir);
		const filesState = store.loadFilesState();
		expect(filesState?.files["src/new.ts"]).toBeDefined();
	});

	it("afterFileWrite works without pre-existing snapshot state (graceful skip)", () => {
		// No snapshot exists
		expect(() => afterFileWrite(tmpDir, "src/new.ts", "content")).not.toThrow();
	});

	it("afterFileEdit emits file_edited and marks smartRead stale", async () => {
		const svc = new ProjectStateSnapshotService();
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		await svc.run({ rootDir: tmpDir });

		// Edit the file via hook
		afterFileEdit(tmpDir, "src/a.ts", "const x = 2;\n", "const x = 1;\n");

		// Check journal
		const journal = new ProjectStateEventJournal(tmpDir);
		const events = journal.loadEvents(0);
		const editEvents = events.filter((e) => e.event.type === "file_edited");
		expect(editEvents.length).toBeGreaterThan(0);

		// Check files state — should have stale smartRead
		const store = new ProjectStateStore(tmpDir);
		const filesState = store.loadFilesState();
		expect(filesState?.files["src/a.ts"]).toBeDefined();
		expect(filesState?.files["src/a.ts"]?.smartReadStatus).toBe("stale");
	});

	it("beforeBashCommand classifies command and opens mutation window for unknown", async () => {
		const svc = new ProjectStateSnapshotService();
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		await svc.run({ rootDir: tmpDir });

		const result = beforeBashCommand(tmpDir, "python script.py", tmpDir);
		expect(result.classification.effect).toBe("unknown_global_mutation");
		expect(result.mutationWindowId).toBeDefined();
	});

	it("beforeBashCommand does not open window for read-only commands", () => {
		const r2 = beforeBashCommand(tmpDir, "ls -la", tmpDir);
		expect(r2.classification.effect).toBe("no_state_change");
		expect(r2.mutationWindowId).toBeUndefined();
	});

	it("afterBashCommand closes mutation window on success", async () => {
		const svc = new ProjectStateSnapshotService();
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		await svc.run({ rootDir: tmpDir });

		// Open window
		const before = beforeBashCommand(tmpDir, "python script.py", tmpDir);
		expect(before.mutationWindowId).toBeDefined();

		// Close it
		afterBashCommand(tmpDir, "python script.py", 0, before.classification, before.mutationWindowId);

		// Verify window is closed
		const mws = new MutationWindowStore(tmpDir);
		const window = mws.get(before.mutationWindowId!);
		expect(window).toBeDefined();
		expect(window!.status === "closed" || window!.status === "reconciling").toBe(true);
	});

	it("afterBashCommand fails mutation window on error", async () => {
		const svc = new ProjectStateSnapshotService();
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		await svc.run({ rootDir: tmpDir });

		const before = beforeBashCommand(tmpDir, "python script.py", tmpDir);
		afterBashCommand(tmpDir, "python script.py", 1, before.classification, before.mutationWindowId);

		const mws = new MutationWindowStore(tmpDir);
		const window = mws.get(before.mutationWindowId!);
		expect(window).toBeDefined();
		expect(window!.status).toBe("failed");
	});

	it("command_started and command_completed events are journaled", async () => {
		const svc = new ProjectStateSnapshotService();
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");
		await svc.run({ rootDir: tmpDir });

		const before = beforeBashCommand(tmpDir, "echo hello", tmpDir);
		afterBashCommand(tmpDir, "echo hello", 0, before.classification, undefined);

		const journal = new ProjectStateEventJournal(tmpDir);
		const events = journal.loadEvents(0);
		const startedEvents = events.filter((e) => e.event.type === "command_started");
		const completedEvents = events.filter((e) => e.event.type === "command_completed");
		expect(startedEvents.length).toBeGreaterThan(0);
		expect(completedEvents.length).toBeGreaterThan(0);
	});
});
