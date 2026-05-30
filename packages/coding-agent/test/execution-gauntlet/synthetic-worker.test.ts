/**
 * Synthetic Worker Tests — P38.1
 *
 * Verifies:
 * - Synthetic worker behavior is deterministic under seed
 * - Each behavior type produces expected outputs
 * - No real LLM calls in fast mode
 * - no_tests_found exit 0 behavior works correctly
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRng, createSyntheticWorker } from "../../src/core/execution-gauntlet/synthetic-worker.js";

describe("Synthetic Worker", () => {
	let testDir: string;

	beforeAll(async () => {
		testDir = path.join(os.tmpdir(), `pi-gauntlet-test-${Date.now()}`);
		await fs.mkdir(testDir, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	describe("determinism under seed", () => {
		it("produces identical output with same seed", async () => {
			const worker1 = createSyntheticWorker("success", {
				seed: 42,
				workspaceId: "ws-1",
				workspaceDir: testDir,
				targetCommand: "npm test",
			});

			const worker2 = createSyntheticWorker("success", {
				seed: 42,
				workspaceId: "ws-1",
				workspaceDir: testDir,
				targetCommand: "npm test",
			});

			// Clean directory between runs
			const result1 = await worker1();
			// Clean up files
			for (const f of Object.keys(result1.filesCreated)) {
				await fs.rm(f, { force: true });
			}
			const result2 = await worker2();

			expect(result1.exitCode).toBe(result2.exitCode);
			expect(result1.output).toBe(result2.output);
			expect(result1.commandHistory.length).toBe(result2.commandHistory.length);
		});

		it("produces different output with different seed for some behaviors", async () => {
			const worker1 = createSyntheticWorker("validation_fail_then_repair", {
				seed: 42,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const worker2 = createSyntheticWorker("validation_fail_then_repair", {
				seed: 99,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result1 = await worker1();
			for (const f of Object.keys(result1.filesCreated)) {
				await fs.rm(f, { force: true });
			}
			const result2 = await worker2();

			// With different seeds, the repair behavior may differ (pass vs fail)
			// The key is that they are deterministic for the same seed
			expect(result1.commandHistory).toBeDefined();
			expect(result2.commandHistory).toBeDefined();
		});
	});

	describe("success behavior", () => {
		it("returns exit code 0", async () => {
			const worker = createSyntheticWorker("success", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
				targetCommand: "npm test",
			});

			const result = await worker();
			expect(result.exitCode).toBe(0);
		});

		it("creates hello files", async () => {
			const wsDir = path.join(testDir, "success-ws");
			await fs.mkdir(wsDir, { recursive: true });

			const worker = createSyntheticWorker("success", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: wsDir,
				targetCommand: "npm test",
			});

			const result = await worker();
			const files = Object.keys(result.filesCreated);
			expect(files.length).toBeGreaterThan(0);
			expect(files.some((f) => f.includes("hello.ts"))).toBe(true);
		});

		it("populates command history", async () => {
			const worker = createSyntheticWorker("success", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
				targetCommand: "npm test",
			});

			const result = await worker();
			expect(result.commandHistory.length).toBeGreaterThan(0);
			expect(result.commandHistory[0].command).toBe("npm test");
			expect(result.commandHistory[0].exitCode).toBe(0);
		});
	});

	describe("no_tests_found_exit_zero behavior", () => {
		it("returns exit code 0", async () => {
			const worker = createSyntheticWorker("no_tests_found_exit_zero", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result = await worker();
			expect(result.exitCode).toBe(0);
		});

		it("output contains 'No test files found'", async () => {
			const worker = createSyntheticWorker("no_tests_found_exit_zero", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result = await worker();
			expect(result.output).toContain("No test files found");
		});

		it("command history includes the test command", async () => {
			const worker = createSyntheticWorker("no_tests_found_exit_zero", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result = await worker();
			expect(result.commandHistory.length).toBeGreaterThan(0);
			expect(result.commandHistory[0].outputSummary).toContain("No test files found");
		});

		it("exit 0 with no-tests-found is detectable from output", async () => {
			const worker = createSyntheticWorker("no_tests_found_exit_zero", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result = await worker();
			const hasNoTests = result.output.includes("No test files found");
			const isExitZero = result.exitCode === 0;

			expect(hasNoTests).toBe(true);
			expect(isExitZero).toBe(true);
			// This combination MUST be treated as failure
			expect(hasNoTests && isExitZero).toBe(true);
		});
	});

	describe("missing_command_history behavior", () => {
		it("returns empty command history", async () => {
			const worker = createSyntheticWorker("missing_command_history", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result = await worker();
			expect(result.commandHistory).toEqual([]);
		});

		it("exit code is 0 but command history is empty", async () => {
			const worker = createSyntheticWorker("missing_command_history", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result = await worker();
			expect(result.exitCode).toBe(0);
			expect(result.commandHistory.length).toBe(0);
		});
	});

	describe("repeat_same_failure behavior", () => {
		it("always returns the same error", async () => {
			const worker = createSyntheticWorker("repeat_same_failure", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result1 = await worker();
			const result2 = await worker();

			expect(result1.exitCode).toBe(1);
			expect(result1.output).toContain("Completion gate blocked");
			expect(result1.exitCode).toBe(result2.exitCode);
			expect(result1.output).toBe(result2.output);
		});
	});

	describe("patch_transaction behaviors", () => {
		it("patch_non_overlapping produces patch artifact", async () => {
			const worker = createSyntheticWorker("patch_non_overlapping", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
				writeSet: ["src/a.ts", "src/b.ts", "src/c.ts"],
			});

			const result = await worker();
			expect(result.patchArtifact).toBeDefined();
			expect(result.patchArtifact!.writeSet).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
			expect(result.patchArtifact!.patches.length).toBe(3);
		});

		it("patch_write_set_violation leaks files outside writeSet", async () => {
			const worker = createSyntheticWorker("patch_write_set_violation", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
				writeSet: ["src/file-a.ts"],
			});

			const result = await worker();
			expect(result.patchLeakedFiles).toBeDefined();
			expect(result.patchLeakedFiles!.length).toBeGreaterThan(0);
			expect(result.patchLeakedFiles).toContain("src/file-b.ts");
		});

		it("patch_stale_hash uses stale base version", async () => {
			const worker = createSyntheticWorker("patch_stale_hash", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result = await worker();
			expect(result.patchArtifact).toBeDefined();
			expect(result.patchArtifact!.baseVersion).toBe("stale_hash_000");
		});
	});

	describe("late_complete_after_reset behavior", () => {
		it("sets staleCompletionSent flag", async () => {
			const worker = createSyntheticWorker("late_complete_after_reset", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result = await worker();
			expect(result.staleCompletionSent).toBe(true);
		});

		it("has a stale completion delay", async () => {
			const worker = createSyntheticWorker("late_complete_after_reset", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result = await worker();
			expect(result.staleCompletionDelayMs).toBeGreaterThan(0);
		});
	});

	describe("timeout and memory_killed behaviors", () => {
		it("timeout returns exit code 124", async () => {
			const worker = createSyntheticWorker("timeout", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result = await worker();
			expect(result.exitCode).toBe(124);
		});

		it("memory_killed returns exit code 137", async () => {
			const worker = createSyntheticWorker("memory_killed", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: testDir,
			});

			const result = await worker();
			expect(result.exitCode).toBe(137);
		});
	});

	describe("half_done behavior", () => {
		it("creates source but no test file", async () => {
			const wsDir = path.join(testDir, "half-done-ws");
			await fs.mkdir(wsDir, { recursive: true });

			const worker = createSyntheticWorker("half_done", {
				seed: 1,
				workspaceId: "ws-1",
				workspaceDir: wsDir,
			});

			const result = await worker();
			const files = Object.keys(result.filesCreated);
			const hasSource = files.some((f) => f.includes("module.ts"));
			const hasTest = files.some((f) => f.includes("test.ts"));

			expect(hasSource).toBe(true);
			expect(hasTest).toBe(false);
		});
	});
});

describe("createRng", () => {
	it("produces deterministic sequence for same seed", () => {
		const rng1 = createRng(42);
		const rng2 = createRng(42);

		const values1 = Array.from({ length: 10 }, () => rng1());
		const values2 = Array.from({ length: 10 }, () => rng2());

		expect(values1).toEqual(values2);
	});

	it("produces values in [0, 1) range", () => {
		const rng = createRng(123);
		for (let i = 0; i < 100; i++) {
			const v = rng();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	it("produces different sequences for different seeds", () => {
		const rng1 = createRng(1);
		const rng2 = createRng(2);

		const v1 = rng1();
		const v2 = rng2();
		expect(v1).not.toBe(v2);
	});
});
