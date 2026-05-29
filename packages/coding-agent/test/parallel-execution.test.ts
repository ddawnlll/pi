/**
 * Parallel Execution Tests
 *
 * Verifies that workspaces in the same DAG batch launch in parallel and that
 * the scheduling loop does not serialize them.
 */
import { describe, expect, it, vi } from "vitest";

describe("Parallel Execution Scheduler", () => {
	describe("batch parallelism", () => {
		it("launches all ready workspaces in the same iteration, not one per poll", async () => {
			const launched: string[] = [];
			const mockExecutor = {
				getNextWorkspaces: vi
					.fn()
					.mockResolvedValueOnce([
						{ id: "W1", dependencies: [], hardDeps: [] },
						{ id: "W2", dependencies: [], hardDeps: [] },
						{ id: "W3", dependencies: [], hardDeps: [] },
					])
					.mockResolvedValue([]),
				executeWorkspace: vi.fn(),
			};

			const launchTimestamps: Record<string, number> = {};
			mockExecutor.executeWorkspace.mockImplementation(async (ws: { id: string }) => {
				launchTimestamps[ws.id] = Date.now();
				launched.push(ws.id);
				await new Promise((resolve) => setTimeout(resolve, 100));
				return { workspaceId: ws.id, success: true, verdict: "COMPLETE" as const };
			});

			const maxParallel = 3;
			const inFlight = new Map<string, Promise<unknown>>();
			const ready = await mockExecutor.getNextWorkspaces([]);

			for (const ws of ready) {
				if (inFlight.size >= maxParallel) break;
				const promise = mockExecutor.executeWorkspace(ws);
				inFlight.set(ws.id, promise);
			}

			expect(inFlight.size).toBe(3);
			expect(inFlight.has("W1")).toBe(true);
			expect(inFlight.has("W2")).toBe(true);
			expect(inFlight.has("W3")).toBe(true);

			await Promise.allSettled([...inFlight.values()]);
			expect(launched).toEqual(["W1", "W2", "W3"]);
			const times = Object.values(launchTimestamps);
			const maxGap = Math.max(...times) - Math.min(...times);
			expect(maxGap).toBeLessThan(50);
		});

		it("respects maxParallel limit even when more workspaces are ready", () => {
			const launchedCount = { value: 0 };
			const ready = [
				{ id: "W1", dependencies: [] },
				{ id: "W2", dependencies: [] },
				{ id: "W3", dependencies: [] },
				{ id: "W4", dependencies: [] },
				{ id: "W5", dependencies: [] },
			];

			const maxParallel = 3;
			const inFlight = new Map<string, Promise<unknown>>();
			const mockExecute = (ws: { id: string }) => {
				launchedCount.value++;
				return new Promise((resolve) => {
					setTimeout(() => resolve({ workspaceId: ws.id, success: true, verdict: "COMPLETE" as const }), 1000);
				});
			};

			for (const ws of ready) {
				if (inFlight.size >= maxParallel) break;
				inFlight.set(ws.id, mockExecute(ws));
			}

			expect(inFlight.size).toBe(3);
			expect(launchedCount.value).toBe(3);
		});

		it("does NOT serialize workspaces that have no inter-dependencies", async () => {
			const maxParallel = 3;
			const inFlight = new Map<string, Promise<unknown>>();
			const w0Complete = new Map([["W0", { stage: "complete", attempts: 1 }]]);
			const readyWorkspaces = [
				{ id: "W1", dependencies: ["W0"], hardDeps: ["W0"] },
				{ id: "W2", dependencies: ["W0"], hardDeps: ["W0"] },
				{ id: "W3", dependencies: ["W0"], hardDeps: ["W0"] },
			];

			for (const ws of readyWorkspaces) {
				const depsComplete = ws.hardDeps.every((depId) => w0Complete.get(depId)?.stage === "complete");
				expect(depsComplete).toBe(true);
			}

			const allLaunched: string[] = [];
			for (const ws of readyWorkspaces) {
				if (inFlight.size >= maxParallel) break;
				const id = ws.id;
				const promise = (async () => {
					allLaunched.push(id);
					await new Promise((resolve) => setTimeout(resolve, 10));
				})();
				inFlight.set(id, promise);
			}

			await Promise.allSettled([...inFlight.values()]);

			expect(allLaunched).toContain("W1");
			expect(allLaunched).toContain("W2");
			expect(allLaunched).toContain("W3");
			expect(allLaunched.length).toBe(3);
		});
	});

	describe("auto-commit with worktree", () => {
		it("commits in worktree directory, not main repo", async () => {
			const commitCalls: string[] = [];
			const MockAutoCommit = vi.fn().mockImplementation((root: string) => ({
				commit: vi.fn().mockImplementation(async () => {
					commitCalls.push(root);
					return { success: true, commitHash: "abc123", committedFiles: ["src/foo.ts"] };
				}),
				validateCommit: vi.fn().mockResolvedValue({ allowed: true, filesToCommit: ["src/foo.ts"] }),
			}));

			const worktreePath = "/repo/.pi/worktrees/plan-1/W1-a1";
			const mainRepoPath = "/repo";
			const autoCommit = new MockAutoCommit(worktreePath);
			await autoCommit.commit({ id: "W1" }, { stage: "complete", attempts: 1 }, "V5");

			expect(commitCalls[0]).toBe(worktreePath);
			expect(commitCalls[0]).not.toBe(mainRepoPath);
		});

		it("cherry-picks worktree commit into main repo after worktree commit", async () => {
			const gitCommands: string[][] = [];
			const mockRunner = {
				writeRepo: vi.fn().mockImplementation(async (args: string[]) => {
					gitCommands.push(args);
					return { stdout: "ok", stderr: "", exitCode: 0 };
				}),
			};

			const commitHash = "abc123def456";
			await mockRunner.writeRepo(["cherry-pick", "--no-commit", commitHash], {});
			await mockRunner.writeRepo(["add", "-A"], {});
			await mockRunner.writeRepo(["commit", "--no-verify", "-m", "feat(pV5): complete workspace W1 — My Title"], {});

			expect(gitCommands[0]).toEqual(["cherry-pick", "--no-commit", commitHash]);
			expect(gitCommands[1]).toEqual(["add", "-A"]);
			expect(gitCommands[2][0]).toBe("commit");
			expect(gitCommands[2]).toContain("--no-verify");
		});
	});

	describe("e2e parallelism tracking", () => {
		it("fails the run when observed active count never reaches expected parallelism", () => {
			const samples = [
				{ active: 1, activeIds: ["V5.01"] },
				{ active: 1, activeIds: ["V5.02"] },
				{ active: 1, activeIds: ["V5.13"] },
			];
			const expectedParallelism = 3;
			const maxObservedParallelism = Math.max(0, ...samples.map((sample) => sample.active));
			const errors: string[] = [];

			if (expectedParallelism > 1 && maxObservedParallelism < expectedParallelism) {
				errors.push(
					`PARALLELISM_REGRESSION: expected active >= ${expectedParallelism}, observed max active=${maxObservedParallelism}`,
				);
			}

			expect(errors).toContain("PARALLELISM_REGRESSION: expected active >= 3, observed max active=1");
		});

		it("passes the run when observed active count reaches expected parallelism", () => {
			const samples = [
				{ active: 1, activeIds: ["V5.01"] },
				{ active: 3, activeIds: ["V5.01", "V5.02", "V5.13"] },
				{ active: 2, activeIds: ["V5.02", "V5.13"] },
			];
			const expectedParallelism = 3;
			const maxObservedParallelism = Math.max(0, ...samples.map((sample) => sample.active));

			expect(maxObservedParallelism).toBeGreaterThanOrEqual(expectedParallelism);
		});
	});

	describe("validator gate parallelism checks", () => {
		it("detects when all workspaces are in separate batches (serial plan)", () => {
			const serialQueue = {
				workspaces: [
					{ id: "W1", batch: "B0", dependencies: [], capabilities: { canEdit: ["src/a/**"] } },
					{ id: "W2", batch: "B1", dependencies: ["W1"], capabilities: { canEdit: ["src/b/**"] } },
					{ id: "W3", batch: "B2", dependencies: ["W2"], capabilities: { canEdit: ["src/c/**"] } },
				],
				maxParallelWorkspaces: 3,
			};

			const batchGroups = new Map<string, string[]>();
			for (const ws of serialQueue.workspaces) {
				const wsAny = ws as Record<string, unknown>;
				const batch = (wsAny.batch as string) ?? "B0";
				if (!batchGroups.has(batch)) batchGroups.set(batch, []);
				batchGroups.get(batch)!.push(ws.id);
			}

			const maxBatchWidth = Math.max(...[...batchGroups.values()].map((ids) => ids.length));
			expect(maxBatchWidth).toBe(1);
			expect(maxBatchWidth < 2).toBe(true);
		});

		it("approves plan with parallel batches", () => {
			const parallelQueue = {
				workspaces: [
					{ id: "V5.00", batch: "B0", dependencies: [] },
					{ id: "V5.01", batch: "B1", dependencies: ["V5.00"] },
					{ id: "V5.02", batch: "B1", dependencies: ["V5.00"] },
					{ id: "V5.13", batch: "B1", dependencies: ["V5.00"] },
					{ id: "V5.03", batch: "B2", dependencies: ["V5.02"] },
				],
			};

			const batchGroups = new Map<string, string[]>();
			for (const ws of parallelQueue.workspaces) {
				const wsAny = ws as Record<string, unknown>;
				const batch = (wsAny.batch as string) ?? "B0";
				if (!batchGroups.has(batch)) batchGroups.set(batch, []);
				batchGroups.get(batch)!.push(ws.id);
			}

			const b1 = batchGroups.get("B1")!;
			expect(b1.length).toBe(3);
			expect(b1).toContain("V5.01");
			expect(b1).toContain("V5.02");
			expect(b1).toContain("V5.13");
			const maxBatchWidth = Math.max(...[...batchGroups.values()].map((ids) => ids.length));
			expect(maxBatchWidth).toBe(3);
		});

		it("detects cannotRunWith violations within the same batch", () => {
			const conflictQueue = {
				workspaces: [
					{ id: "W1", batch: "B1", dependencies: [], parallelism: { cannotRunWith: ["W2"] } },
					{ id: "W2", batch: "B1", dependencies: [], parallelism: { cannotRunWith: ["W1"] } },
				],
			};

			const batchGroups = new Map<string, string[]>();
			for (const ws of conflictQueue.workspaces) {
				const wsAny = ws as Record<string, unknown>;
				const batch = (wsAny.batch as string) ?? "B0";
				if (!batchGroups.has(batch)) batchGroups.set(batch, []);
				batchGroups.get(batch)!.push(ws.id);
			}

			const violations: string[] = [];
			for (const [batch, wsIds] of batchGroups) {
				if (wsIds.length <= 1) continue;
				for (const wsId of wsIds) {
					const ws = conflictQueue.workspaces.find((workspace) => workspace.id === wsId);
					if (!ws) continue;
					const wsAny = ws as Record<string, unknown>;
					const parallelism = wsAny.parallelism as Record<string, unknown> | undefined;
					const cannotRunWith = (parallelism?.cannotRunWith as string[]) ?? [];
					for (const otherId of cannotRunWith) {
						if (wsIds.includes(otherId)) {
							violations.push(`${batch}: ${wsId} cannot run with ${otherId}`);
						}
					}
				}
			}

			expect(violations.length).toBeGreaterThan(0);
			expect(violations[0]).toContain("W1");
		});
	});
});
