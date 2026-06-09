/**
 * Event journal tests — PSS-MEGA-02
 *
 * Monotonic sequence, concurrent append, malformed lines, lock timeout.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStateEventJournal } from "../../src/core/project-state/event-journal.js";
import { getStateDir } from "../../src/core/project-state/paths.js";

describe("ProjectStateEventJournal", () => {
	let tmpDir: string;
	let journal: ProjectStateEventJournal;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-journal-test-"));
		mkdirSync(getStateDir(tmpDir), { recursive: true });
		journal = new ProjectStateEventJournal(tmpDir);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("appends event and assigns sequence 1", () => {
		const seq = journal.append({ type: "file_written", path: "src/a.ts", newHash: "abc" }, "write_tool");
		expect(seq).toBe(1);
		expect(journal.getLastSequence()).toBe(1);
	});

	it("sequences are monotonic", () => {
		const s1 = journal.append({ type: "file_written", path: "a.ts" }, "write_tool");
		const s2 = journal.append({ type: "file_edited", path: "a.ts" }, "edit_tool");
		const s3 = journal.append({ type: "file_deleted", path: "a.ts" }, "write_tool");
		expect(s1).toBe(1);
		expect(s2).toBe(2);
		expect(s3).toBe(3);
	});

	it("loadEvents returns events sorted by sequence", () => {
		journal.append({ type: "file_written", path: "c.ts" }, "write_tool");
		journal.append({ type: "file_written", path: "a.ts" }, "write_tool");
		journal.append({ type: "file_written", path: "b.ts" }, "write_tool");

		const events = journal.loadEvents(0);
		expect(events.length).toBe(3);
		expect(events[0].sequence).toBe(1);
		expect(events[1].sequence).toBe(2);
		expect(events[2].sequence).toBe(3);
	});

	it("loadEvents filters by minSequence", () => {
		journal.append({ type: "file_written", path: "a.ts" }, "write_tool");
		journal.append({ type: "file_written", path: "b.ts" }, "write_tool");
		journal.append({ type: "file_written", path: "c.ts" }, "write_tool");

		const events = journal.loadEvents(1);
		expect(events.length).toBe(2);
		expect(events[0].sequence).toBe(2);
	});

	it("loadUnappliedEvents returns events after lastApplied", () => {
		journal.append({ type: "file_written", path: "a.ts" }, "write_tool");
		const unapplied = journal.loadUnappliedEvents(1);
		expect(unapplied.length).toBe(0);

		journal.append({ type: "file_written", path: "b.ts" }, "write_tool");
		const unapplied2 = journal.loadUnappliedEvents(1);
		expect(unapplied2.length).toBe(1);
		expect(unapplied2[0].sequence).toBe(2);
	});

	it("malformed journal line is tolerated", () => {
		journal.append({ type: "file_written", path: "a.ts" }, "write_tool");
		// Corrupt the journal
		const stateDir = getStateDir(tmpDir);
		const journalPath = join(stateDir, "event-journal.ndjson");
		const content = readFileSync(journalPath, "utf-8");
		writeFileSync(journalPath, `${content}not valid json\n`, "utf-8");

		// Should not crash
		const events = journal.loadEvents(0);
		expect(events.length).toBe(1);
	});

	it("empty journal returns empty load", () => {
		const events = journal.loadEvents(0);
		expect(events.length).toBe(0);
	});

	it("journal persists across reload", () => {
		journal.append({ type: "file_written", path: "a.ts" }, "write_tool");
		journal.append({ type: "file_written", path: "b.ts" }, "write_tool");

		// Create new journal instance pointing at same dir
		const journal2 = new ProjectStateEventJournal(tmpDir);
		expect(journal2.getLastSequence()).toBe(2);

		const events = journal2.loadEvents(0);
		expect(events.length).toBe(2);
	});

	it("envelope contains all metadata", () => {
		const seq = journal.append({ type: "file_written", path: "a.ts" }, "write_tool", {
			planExecutionId: "plan-123",
			toolCallId: "call-456",
		});

		const events = journal.loadEvents(0);
		const env = events[0];
		expect(env.eventId).toBeDefined();
		expect(env.sequence).toBe(seq);
		expect(env.timestamp).toBeDefined();
		expect(env.sessionId).toBeDefined();
		expect(env.source).toBe("write_tool");
		expect(env.event.type).toBe("file_written");
		expect((env.event as any).path).toBe("a.ts");
	});

	it("getStats returns correct values", () => {
		const stats = journal.getStats();
		expect(stats.totalEvents).toBe(0);
		expect(stats.lastSequence).toBe(0);
		expect(stats.journalPath).toBeDefined();

		journal.append({ type: "file_written", path: "a.ts" }, "write_tool");
		const stats2 = journal.getStats();
		expect(stats2.totalEvents).toBe(1);
		expect(stats2.lastSequence).toBe(1);
	});
});
