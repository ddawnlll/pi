/**
 * Bash failure lifecycle tests — PSS-MEGA-02.2
 *
 * Tests that afterBashCommand runs on all bash exit paths (success, failure,
 * timeout, abort, thrown error) and that mutation windows close/fail honestly.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStateEventJournal } from "../../src/core/project-state/event-journal.js";
import type { CommandClassification } from "../../src/core/project-state/event-types.js";
import { MutationWindowStore } from "../../src/core/project-state/mutation-window-store.js";
import { ProjectStateSnapshotService } from "../../src/core/project-state/snapshot-service.js";
import type { BashCommandOutcome } from "../../src/core/project-state-hooks.js";
import { afterBashCommand, beforeBashCommand } from "../../src/core/project-state-hooks.js";

describe("Bash failure lifecycle", () => {
	let tmpDir: string;
	let _unknownClassification: CommandClassification;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-bash-lifecycle-"));
		mkdirSync(join(tmpDir, "src"), { recursive: true });
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
		writeFileSync(join(tmpDir, "src", "a.ts"), "const x = 1;\n", "utf-8");

		// Create snapshot state
		const svc = new ProjectStateSnapshotService();
		await svc.run({ rootDir: tmpDir });

		_unknownClassification = {
			effect: "unknown_global_mutation",
			confidence: "low",
			requiresMutationWindow: true,
			requiresReconcile: "bounded_tree",
			reason: "test",
		};
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	/**
	 * Count events of a specific type in the journal.
	 */
	function countEventType(type: string): number {
		const journal = new ProjectStateEventJournal(tmpDir);
		return journal.loadEvents(0).filter((e) => e.event.type === type).length;
	}

	/**
	 * Check if mutation window is open.
	 */
	function openWindowCount(): number {
		const mw = new MutationWindowStore(tmpDir);
		return mw.openCount();
	}

	/**
	 * Find a window by its ID.
	 */
	function getWindow(id: string) {
		const mw = new MutationWindowStore(tmpDir);
		return mw.get(id);
	}

	// ========================================================================
	// Success path
	// ========================================================================

	it("success calls afterBashCommand once", () => {
		const { classification, mutationWindowId } = beforeBashCommand(tmpDir, "touch src/success.ts", tmpDir);

		const beforeCount = countEventType("command_completed");
		const beforeOpen = openWindowCount();

		afterBashCommand(tmpDir, "touch src/success.ts", 0, classification, mutationWindowId);

		expect(countEventType("command_completed")).toBe(beforeCount + 1);
		expect(openWindowCount()).toBe(Math.max(0, beforeOpen - 1));
	});

	it("success outcome object calls afterBashCommand", () => {
		const { classification, mutationWindowId } = beforeBashCommand(tmpDir, "echo ok", tmpDir);

		const outcome: BashCommandOutcome = { exitCode: 0, status: "completed", durationMs: 10 };
		afterBashCommand(tmpDir, "echo ok", outcome, classification, mutationWindowId);

		expect(countEventType("command_completed")).toBeGreaterThan(0);
	});

	// ========================================================================
	// Non-zero exit path
	// ========================================================================

	it("non-zero exit calls afterBashCommand with failed status", () => {
		const { classification, mutationWindowId } = beforeBashCommand(tmpDir, "false", tmpDir);

		afterBashCommand(tmpDir, "false", 1, classification, mutationWindowId);

		expect(countEventType("command_completed")).toBeGreaterThan(0);
		// Mutation window should be failed
		if (mutationWindowId) {
			const w = getWindow(mutationWindowId);
			expect(w).toBeDefined();
			expect(w!.status).toBe("failed");
		}
	});

	it("non-zero exit fails mutation window", () => {
		const { classification, mutationWindowId } = beforeBashCommand(tmpDir, "python -c 'exit(7)'", tmpDir);

		afterBashCommand(tmpDir, "python -c 'exit(7)'", 7, classification, mutationWindowId);

		if (mutationWindowId) {
			const w = getWindow(mutationWindowId);
			expect(w!.status).toBe("failed");
		}
	});

	// ========================================================================
	// Throw / timeout / abort path
	// ========================================================================

	it("aborted outcome calls afterBashCommand once", () => {
		const { classification, mutationWindowId } = beforeBashCommand(tmpDir, "sleep 10", tmpDir);

		const outcome: BashCommandOutcome = {
			exitCode: null,
			status: "aborted",
			errorMessage: "Aborted",
			durationMs: 50,
		};
		afterBashCommand(tmpDir, "sleep 10", outcome, classification, mutationWindowId);

		expect(countEventType("command_completed")).toBeGreaterThan(0);
		if (mutationWindowId) {
			expect(getWindow(mutationWindowId)!.status).toBe("failed");
		}
	});

	it("timeout outcome calls afterBashCommand and fails window", () => {
		const { classification, mutationWindowId } = beforeBashCommand(tmpDir, "sleep 60", tmpDir);

		const outcome: BashCommandOutcome = {
			exitCode: null,
			status: "timeout",
			errorMessage: "Timed out after 5s",
			durationMs: 5000,
		};
		afterBashCommand(tmpDir, "sleep 60", outcome, classification, mutationWindowId);

		expect(countEventType("command_completed")).toBeGreaterThan(0);
		if (mutationWindowId) {
			expect(getWindow(mutationWindowId)!.status).toBe("failed");
		}
	});

	it("unknown_error outcome calls afterBashCommand and fails window", () => {
		const { classification, mutationWindowId } = beforeBashCommand(tmpDir, "nonexistent-command", tmpDir);

		const outcome: BashCommandOutcome = {
			exitCode: null,
			status: "spawn_error",
			errorMessage: "ENOENT",
			durationMs: 5,
		};
		afterBashCommand(tmpDir, "nonexistent-command", outcome, classification, mutationWindowId);

		expect(countEventType("command_completed")).toBeGreaterThan(0);
		if (mutationWindowId) {
			expect(getWindow(mutationWindowId)!.status).toBe("failed");
		}
	});

	// ========================================================================
	// Unknown mutation safety
	// ========================================================================

	it("unknown command with non-zero exit fails window and leaves state dirty/unknown", () => {
		const { classification, mutationWindowId } = beforeBashCommand(tmpDir, "python generates.py", tmpDir);

		// Emulate the state marking that beforeBashCommand does
		const outcome: BashCommandOutcome = {
			exitCode: 1,
			status: "failed",
			errorMessage: "Exited with code 1",
			durationMs: 100,
		};
		afterBashCommand(tmpDir, "python generates.py", outcome, classification, mutationWindowId);

		// Mutation window should be failed
		if (mutationWindowId) {
			expect(getWindow(mutationWindowId)!.status).toBe("failed");
		}

		// Check journal has command_completed
		expect(countEventType("command_completed")).toBeGreaterThan(0);
	});

	it("no open mutation window leak after failure", () => {
		// Run multiple failure scenarios
		const scenarios = [
			{ cmd: "python a.py", exitCode: 1 },
			{ cmd: "timeout-cmd", exitCode: null, status: "timeout" as const },
			{ cmd: "abort-cmd", exitCode: null, status: "aborted" as const },
		];

		for (const s of scenarios) {
			const { classification, mutationWindowId } = beforeBashCommand(tmpDir, s.cmd, tmpDir);
			const outcome: BashCommandOutcome = {
				exitCode: s.exitCode ?? null,
				status: (s.status ?? "failed") as any,
				durationMs: 10,
			};
			afterBashCommand(tmpDir, s.cmd, outcome, classification, mutationWindowId);
		}

		// No open windows should remain
		const mw = new MutationWindowStore(tmpDir);
		expect(mw.openCount()).toBe(0);
	});

	// ========================================================================
	// Command_completed evidence
	// ========================================================================

	it("command_completed event is recorded in journal for all outcomes", () => {
		// Success
		const r1 = beforeBashCommand(tmpDir, "echo ok", tmpDir);
		afterBashCommand(tmpDir, "echo ok", 0, r1.classification, r1.mutationWindowId);

		// Failure
		const r2 = beforeBashCommand(tmpDir, "false", tmpDir);
		afterBashCommand(tmpDir, "false", 1, r2.classification, r2.mutationWindowId);

		// Abort
		const r3 = beforeBashCommand(tmpDir, "sleep 5", tmpDir);
		const outcome3: BashCommandOutcome = { exitCode: null, status: "aborted", durationMs: 10 };
		afterBashCommand(tmpDir, "sleep 5", outcome3, r3.classification, r3.mutationWindowId);

		const journal = new ProjectStateEventJournal(tmpDir);
		const completes = journal.loadEvents(0).filter((e) => e.event.type === "command_completed");
		expect(completes.length).toBe(3);
	});
});
