/**
 * Replay Tests — P38.1
 *
 * Verifies:
 * - Replay file can reproduce failed scenario
 * - Replay file validation works
 * - Save and load round-trips correctly
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadReplay, saveReplay, validateReplay } from "../../src/core/execution-gauntlet/replay.js";
import { buildG1HelloSuccess } from "../../src/core/execution-gauntlet/synthetic-plan-builder.js";

describe("Replay functions", () => {
	let testDir: string;

	beforeAll(async () => {
		testDir = path.join(os.tmpdir(), `pi-replay-test-${Date.now()}`);
		await fs.mkdir(testDir, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	describe("save and load round-trip", () => {
		it("saves a replay file and loads it back", async () => {
			const plan = buildG1HelloSuccess();
			const replayPath = path.join(testDir, "test-replay.json");

			await saveReplay(replayPath, {
				runId: "test-run-1",
				plan,
				seed: 42,
				failureReason: "Test failure",
				context: { foo: "bar" },
			});

			const loaded = await loadReplay(replayPath);

			expect(loaded.version).toBe(1);
			expect(loaded.runId).toBe("test-run-1");
			expect(loaded.planId).toBe("G1");
			expect(loaded.name).toBe("hello_success");
			expect(loaded.executionMode).toBe("stable_3");
			expect(loaded.seed).toBe(42);
			expect(loaded.failureReason).toBe("Test failure");
			expect(loaded.context).toEqual({ foo: "bar" });
			expect(loaded.plan.id).toBe("G1");
			expect(loaded.capturedAt).toBeDefined();
		});
	});

	describe("validation", () => {
		it("validates a correct replay file", () => {
			const replay = {
				version: 1,
				runId: "test",
				planId: "G1",
				name: "test",
				executionMode: "stable_3",
				seed: 1,
				plan: { id: "G1", name: "test", workspaces: [] },
				failureReason: "test",
				context: {},
				capturedAt: new Date().toISOString(),
			};

			const result = validateReplay(replay);
			expect(result.valid).toBe(true);
		});

		it("rejects non-object replay data", () => {
			const result = validateReplay(null);
			expect(result.valid).toBe(false);
		});

		it("rejects wrong version", () => {
			const result = validateReplay({ version: 2 });
			expect(result.valid).toBe(false);
			expect(result.error).toContain("version");
		});

		it("rejects missing planId", () => {
			const result = validateReplay({ version: 1 });
			expect(result.valid).toBe(false);
			expect(result.error).toContain("planId");
		});

		it("rejects missing executionMode", () => {
			const result = validateReplay({ version: 1, planId: "G1" });
			expect(result.valid).toBe(false);
			expect(result.error).toContain("executionMode");
		});

		it("rejects missing seed", () => {
			const result = validateReplay({
				version: 1,
				planId: "G1",
				executionMode: "stable_3",
			});
			expect(result.valid).toBe(false);
			expect(result.error).toContain("seed");
		});

		it("rejects missing plan definition", () => {
			const result = validateReplay({
				version: 1,
				planId: "G1",
				executionMode: "stable_3",
				seed: 1,
			});
			expect(result.valid).toBe(false);
			expect(result.error).toContain("plan");
		});
	});
});
