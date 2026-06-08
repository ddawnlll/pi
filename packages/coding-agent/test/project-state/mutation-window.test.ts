/**
 * Mutation window tests — PSS-MEGA-02
 *
 * Open/close/reconcile lifecycle, dirty marking, status reporting.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MutationWindowStore } from "../../src/core/project-state/mutation-window-store.js";
import { getStateDir } from "../../src/core/project-state/paths.js";

describe("MutationWindowStore", () => {
	let tmpDir: string;
	let store: MutationWindowStore;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-mw-test-"));
		mkdirSync(getStateDir(tmpDir), { recursive: true });
		store = new MutationWindowStore(tmpDir);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("opens a mutation window", () => {
		const w = store.open("bash_unknown", "Unknown command", "python script.py");
		expect(w.id).toBeDefined();
		expect(w.status).toBe("open");
		expect(w.source).toBe("bash_unknown");
		expect(w.command).toBe("python script.py");
	});

	it("closes a mutation window", () => {
		const w = store.open("bash_unknown", "test");
		expect(store.openCount()).toBe(1);

		const closed = store.close(w.id);
		expect(closed).toBe(true);
		expect(store.openCount()).toBe(0);

		const loaded = store.get(w.id);
		expect(loaded!.status).toBe("closed");
		expect(loaded!.completedAt).toBeDefined();
	});

	it("fails a mutation window", () => {
		const w = store.open("bash_unknown", "test");
		store.fail(w.id);

		const loaded = store.get(w.id);
		expect(loaded!.status).toBe("failed");
	});

	it("setReconciling marks window as reconciling", () => {
		const w = store.open("bash_unknown", "test");
		store.setReconciling(w.id);

		const loaded = store.get(w.id);
		expect(loaded!.status).toBe("reconciling");
	});

	it("getOpenWindows returns only open/reconciling windows", () => {
		const w1 = store.open("bash_unknown", "cmd1");
		const w2 = store.open("git_operation", "checkout");
		store.close(w1.id);

		const open = store.getOpenWindows();
		expect(open.length).toBe(1);
		expect(open[0].id).toBe(w2.id);
	});

	it("openCount after close returns 0", () => {
		store.open("bash_unknown", "test");
		expect(store.openCount()).toBe(1);

		for (const w of store.getOpenWindows()) {
			store.close(w.id);
		}
		expect(store.openCount()).toBe(0);
	});

	it("persists across store reload", () => {
		store.open("bash_unknown", "persist-test");

		const store2 = new MutationWindowStore(tmpDir);
		expect(store2.openCount()).toBe(1);
	});

	it("prunes old completed windows", () => {
		store.open("bash_unknown", "old");
		for (const w of store.getOpenWindows()) {
			store.close(w.id);
		}

		// Use -1 to force all windows to be older than maxAge
		store.prune(-1);
		expect(store.getAll().length).toBe(0);
	});

	it("prune keeps recent windows", () => {
		store.open("bash_unknown", "recent");
		for (const w of store.getOpenWindows()) {
			store.close(w.id);
		}

		store.prune(3600_000);
		expect(store.getAll().length).toBe(1);
	});

	it("unknown command increments collected watcher events", () => {
		const w = store.open("bash_unknown", "cmd");
		expect(w.collectedWatcherEvents).toBe(0);

		store.incrementCollected(w.id);
		expect(store.get(w.id)!.collectedWatcherEvents).toBe(1);
	});
});
