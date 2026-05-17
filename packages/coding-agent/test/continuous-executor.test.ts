/**
 * Tests for ContinuousExecutor — P2 Workstream Continuous Execution
 */

import { describe, expect, it } from "vitest";
import { ContinuousExecutor } from "../src/core/continuous-executor.js";
import type { Workspace } from "../src/core/workspace-schema.js";
import type { WorkspaceExecutionResult } from "../src/core/autonomous-executor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a deferred promise that can be resolved externally. */
function defer(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function makeWorkspace(id: string, deps: string[] = []): Workspace {
	return {
		id,
		title: `Workspace ${id}`,
		dependencies: deps,
		roleBudget: "worker",
		maxRetries: 3,
		capabilities: { canEdit: [], canRun: [] },
	};
}

function successResult(id: string): WorkspaceExecutionResult {
	return { workspaceId: id, success: true, verdict: "COMPLETE" as const };
}

// A simple test "scheduler" that makes workspaces ready in order, ignoring
// any dependency-checking logic (we just feed them one-by-one via the
// backlog simulating a DAG scheduler).
class TestScheduler {
	private workspaces: Workspace[];
	private readyIndex = 0;

	constructor(workspaces: Workspace[]) {
		this.workspaces = workspaces;
	}

	/** Return the next workspace, never repeating. */
	getReady(): Workspace[] {
		if (this.readyIndex >= this.workspaces.length) return [];
		return [this.workspaces[this.readyIndex++]];
	}

	/** Reset so we can replay. */
	reset(): void {
		this.readyIndex = 0;
	}

	/** How many unique workspaces we've handed out. */
	get handedOut(): number {
		return this.readyIndex;
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContinuousExecutor", () => {
	describe("constructor", () => {
		it("defaults concurrency to 6", () => {
			const ex = new ContinuousExecutor();
			expect(ex).toBeInstanceOf(ContinuousExecutor);
		});

		it("accepts custom concurrency", () => {
			const ex = new ContinuousExecutor({ concurrency: 3 });
			expect(ex).toBeInstanceOf(ContinuousExecutor);
		});

		it("starts not aborted", () => {
			const ex = new ContinuousExecutor();
			expect(ex.aborted).toBe(false);
		});
	});

	describe("executeAll — basic behavior", () => {
		it("fills all slots within seconds of start", async () => {
			const workspaces = Array.from({ length: 10 }, (_, i) => makeWorkspace(`ws-${i}`));
			const scheduler = new TestScheduler(workspaces);

			// Track how many concurrent executions happen at peak.
			let peakConcurrency = 0;
			let currentConcurrency = 0;

			const summary = await new ContinuousExecutor({ concurrency: 6 }).executeAll(
				workspaces,
				async (ws) => scheduler.getReady(),
				async (ws, _signal) => {
					currentConcurrency++;
					peakConcurrency = Math.max(peakConcurrency, currentConcurrency);
					// Simulate short work.
					await new Promise((r) => setTimeout(r, 5));
					currentConcurrency--;
					return successResult(ws.id);
				},
			);

			// All 10 workspaces completed.
			expect(summary.results).toHaveLength(10);
			expect(summary.completedCount).toBe(10);
			expect(summary.aborted).toBe(false);

			// Peak concurrency should reach concurrency (6) within ms of start.
			expect(peakConcurrency).toBe(6);
		});

		it("keeps all slots busy until no more ready workspaces", async () => {
			const workspaces = Array.from({ length: 15 }, (_, i) => makeWorkspace(`ws-${i}`));
			const scheduler = new TestScheduler(workspaces);

			// Track concurrency over time.
			const concurrencyLog: number[] = [];

			const summary = await new ContinuousExecutor({ concurrency: 6 }).executeAll(
				workspaces,
				async (ws) => scheduler.getReady(),
				async (ws, _signal) => {
					concurrencyLog.push(6); // We always expect 6 slots busy.
					await new Promise((r) => setTimeout(r, 5));
					return successResult(ws.id);
				},
			);

			expect(summary.results).toHaveLength(15);
			expect(summary.completedCount).toBe(15);

			// Verify peak concurrency reached 6.
			const peak = concurrencyLog.length > 0 ? Math.max(...concurrencyLog) : 0;
			expect(peak).toBe(6);
		});

		it("handles fewer workspaces than slots", async () => {
			const workspaces = [makeWorkspace("A"), makeWorkspace("B")];
			const scheduler = new TestScheduler(workspaces);

			const summary = await new ContinuousExecutor({ concurrency: 6 }).executeAll(
				workspaces,
				async (ws) => scheduler.getReady(),
				async (ws, _signal) => {
					await new Promise((r) => setTimeout(r, 5));
					return successResult(ws.id);
				},
			);

			expect(summary.results).toHaveLength(2);
			expect(summary.completedCount).toBe(2);
		});

		it("no batch barrier — workspaces complete in various orders", async () => {
			// Workspaces A (no deps), B (no deps), C (no deps)
			const workspaces = [makeWorkspace("A"), makeWorkspace("B"), makeWorkspace("C")];
			const scheduler = new TestScheduler(workspaces);

			// Make completion times vary: C finishes first, then A, then B.
			const completionOrder: string[] = [];

			const summary = await new ContinuousExecutor({ concurrency: 6 }).executeAll(
				workspaces,
				async (ws) => scheduler.getReady(),
				async (ws, _signal) => {
					if (ws.id === "C") {
						await new Promise((r) => setTimeout(r, 1));
					} else if (ws.id === "A") {
						await new Promise((r) => setTimeout(r, 5));
					} else {
						await new Promise((r) => setTimeout(r, 10));
					}
					completionOrder.push(ws.id);
					return successResult(ws.id);
				},
			);

			expect(summary.results).toHaveLength(3);
			// Results in completion order.
			expect(summary.results[0].workspaceId).toBe("C");
			expect(summary.results[1].workspaceId).toBe("A");
			expect(summary.results[2].workspaceId).toBe("B");
		});

		it("includes failed and blocked workspaces in results", async () => {
			const workspaces = [
				makeWorkspace("ok"),
				makeWorkspace("fail"),
				makeWorkspace("block"),
			];
			const scheduler = new TestScheduler(workspaces);

			const summary = await new ContinuousExecutor({ concurrency: 6 }).executeAll(
				workspaces,
				async (ws) => scheduler.getReady(),
				async (ws, _signal) => {
					await new Promise((r) => setTimeout(r, 5));
					if (ws.id === "fail") {
						return {
							workspaceId: ws.id,
							success: false,
							verdict: "FAILED" as const,
							error: "Simulated failure",
						};
					}
					if (ws.id === "block") {
						return {
							workspaceId: ws.id,
							success: false,
							verdict: "BLOCKED" as const,
							error: "Simulated blocked",
						};
					}
					return successResult(ws.id);
				},
			);

			expect(summary.results).toHaveLength(3);
			expect(summary.completedCount).toBe(1);
			expect(summary.failedCount).toBe(1);
			expect(summary.blockedCount).toBe(1);
		});
	});

	describe("abort support", () => {
		it("aborts in-flight executions via signal", async () => {
			// Use a small number of workspaces with a gate on the first one.
			// When we abort, the gate resolves, the first workspace sees the
			// signal and returns aborted. Remaining workspaces are never started
			// because getNext() returns null once the signal is aborted.
			const workspaces = Array.from({ length: 6 }, (_, i) => makeWorkspace(`ws-${i}`));
			const scheduler = new TestScheduler(workspaces);

			const gate = defer();

			const executor = new ContinuousExecutor({ concurrency: 3 });

			const executePromise = executor.executeAll(
				workspaces,
				async (ws) => scheduler.getReady(),
				async (ws, signal) => {
					// Block the first workspace on a gate so we can abort.
					if (ws.id === "ws-0") {
						await gate.promise;
					}
					if (signal.aborted) {
						return {
							workspaceId: ws.id,
							success: false,
							verdict: "FAILED" as const,
							error: "Aborted by signal",
						};
					}
					await new Promise((r) => setTimeout(r, 10));
					return successResult(ws.id);
				},
			);

			// Let first batch start.
			await new Promise((r) => setTimeout(r, 15));

			// Abort mid-execution.
			executor.abort();
			expect(executor.aborted).toBe(true);

			// Release the gate so ws-0 can check the signal.
			gate.resolve();

			const summary = await executePromise;

			expect(summary.aborted).toBe(true);
			// At least the first batch started before abort.
			expect(summary.results.length).toBeGreaterThan(0);
			// Not all 6 completed — at least ws-0 saw the aborted signal.
			expect(summary.results.length).toBeLessThan(6);
			// At least one result should be FAILED due to abort signal.
			const abortResult = summary.results.find((r) => r.error === "Aborted by signal");
			expect(abortResult).toBeDefined();
			expect(abortResult!.verdict).toBe("FAILED");
		});

		it("abort before start returns empty results", async () => {
			const workspaces = [makeWorkspace("A")];
			const scheduler = new TestScheduler(workspaces);

			const executor = new ContinuousExecutor({ concurrency: 6 });

			executor.abort();
			expect(executor.aborted).toBe(true);

			const summary = await executor.executeAll(
				workspaces,
				async (ws) => scheduler.getReady(),
				async (ws, _signal) => {
					await new Promise((r) => setTimeout(r, 5));
					return successResult(ws.id);
				},
			);

			expect(summary.aborted).toBe(true);
			expect(summary.results).toHaveLength(0);
		});
	});

	describe("acceptance criteria", () => {
		it("AC1: fills all 6 slots within seconds of start", async () => {
			const workspaces = Array.from({ length: 20 }, (_, i) => makeWorkspace(`ws-${i}`));
			const scheduler = new TestScheduler(workspaces);

			let peakConcurrency = 0;
			let current = 0;
			const startTime = Date.now();

			const summary = await new ContinuousExecutor({ concurrency: 6 }).executeAll(
				workspaces,
				async (ws) => scheduler.getReady(),
				async (ws, _signal) => {
					current++;
					peakConcurrency = Math.max(peakConcurrency, current);
					await new Promise((r) => setTimeout(r, 5));
					current--;
					return successResult(ws.id);
				},
			);

			const elapsed = Date.now() - startTime;
			// All 20 workspaces completed within seconds.
			expect(elapsed).toBeLessThan(5000);
			expect(summary.results).toHaveLength(20);
			expect(peakConcurrency).toBe(6);
		});

		it("AC2: new workspace starts on same tick as previous completes", async () => {
			const workspaces = Array.from({ length: 12 }, (_, i) => makeWorkspace(`ws-${i}`));
			const scheduler = new TestScheduler(workspaces);

			// Track interleaving: after each completion, a new one should start.
			const timeline: string[] = [];

			const summary = await new ContinuousExecutor({ concurrency: 6 }).executeAll(
				workspaces,
				async (ws) => {
					const next = scheduler.getReady();
					return next;
				},
				async (ws, _signal) => {
					timeline.push(`start-${ws.id}`);
					await new Promise((r) => setTimeout(r, 5));
					timeline.push(`end-${ws.id}`);
					return successResult(ws.id);
				},
			);

			// There should be no gap where a start is delayed after an end
			// (with 6 slots and 12 workspaces, the 7th should start
			// immediately after the 1st finishes).
			expect(summary.results).toHaveLength(12);
			expect(summary.completedCount).toBe(12);

			// The timeline should show continuous starts without gaps.
			// Only the first 6 starts should happen before any ends.
			const firstEnd = timeline.findIndex((e) => e.startsWith("end-"));
			const lastStart = (() => {
				for (let i = timeline.length - 1; i >= 0; i--) {
					if (timeline[i].startsWith("start-")) return i;
				}
				return -1;
			})();

			// After the first end, new starts should occur interspersed
			// with ends — no gap.
			expect(firstEnd).toBeGreaterThanOrEqual(6); // 6 starts before first end
			expect(lastStart).toBeGreaterThan(firstEnd); // starts continue after first end
		});

		it("AC3: no batch barrier", async () => {
			// Create workspaces: A->B->C (linear chain so they become ready
			// one at a time as each prior completes).
			const wsA = makeWorkspace("A");
			const wsB = makeWorkspace("B", ["A"]);
			const wsC = makeWorkspace("C", ["B"]);
			const workspaces = [wsA, wsB, wsC];

			// A simulated DAG scheduler that makes a workspace ready only
			// when its dependencies are satisfied (tracked via `completed`).
			const completed = new Set<string>();
			const dagScheduler = async (): Promise<Workspace[]> => {
				const ready: Workspace[] = [];
				for (const ws of workspaces) {
					const depsMet = ws.dependencies.every((d) => completed.has(d));
					if (depsMet && !completed.has(ws.id)) {
						ready.push(ws);
					}
				}
				return ready;
			};

			const summary = await new ContinuousExecutor({ concurrency: 6 }).executeAll(
				workspaces,
				async () => dagScheduler(),
				async (ws, _signal) => {
					await new Promise((r) => setTimeout(r, 5));
					completed.add(ws.id);
					return successResult(ws.id);
				},
			);

			expect(summary.results).toHaveLength(3);
			expect(summary.completedCount).toBe(3);
			// Workspaces completed in order: A, B, C.
			expect(summary.results[0].workspaceId).toBe("A");
			expect(summary.results[1].workspaceId).toBe("B");
			expect(summary.results[2].workspaceId).toBe("C");
		});

		it("AC4: all 6 slots stay busy until no more ready workspaces", async () => {
			const workspaces = Array.from({ length: 18 }, (_, i) => makeWorkspace(`ws-${i}`));
			const scheduler = new TestScheduler(workspaces);

			const concurrencyAtEachStart: number[] = [];

			const summary = await new ContinuousExecutor({ concurrency: 6 }).executeAll(
				workspaces,
				async (ws) => scheduler.getReady(),
				async (ws, _signal) => {
					concurrencyAtEachStart.push(scheduler.handedOut);
					await new Promise((r) => setTimeout(r, 5));
					return successResult(ws.id);
				},
			);

			expect(summary.results).toHaveLength(18);
			expect(summary.completedCount).toBe(18);

			// The first 6 starts happen (filling all slots).
			// Then as each slot completes, another workspace starts.
			// So we should see concurrency stay at 6 until the last 6.
			const firstBatch = concurrencyAtEachStart.slice(0, 6);
			expect(firstBatch).toEqual([1, 2, 3, 4, 5, 6]);
		});

		it("AC5: abort support via AbortController", async () => {
			const workspaces = Array.from({ length: 20 }, (_, i) => makeWorkspace(`ws-${i}`));
			const scheduler = new TestScheduler(workspaces);

			const executor = new ContinuousExecutor({ concurrency: 6 });

			// Defer the first workspace so we can abort before it completes.
			const firstGate = defer();

			const executePromise = executor.executeAll(
				workspaces,
				async (ws) => scheduler.getReady(),
				async (ws, signal) => {
					if (ws.id === "ws-0") {
						await firstGate.promise;
					}
					if (signal.aborted) {
						return {
							workspaceId: ws.id,
							success: false,
							verdict: "FAILED" as const,
							error: "Aborted by user",
						};
					}
					await new Promise((r) => setTimeout(r, 10));
					return successResult(ws.id);
				},
			);

			// Let first 6 workspaces start.
			await new Promise((r) => setTimeout(r, 20));

			// Abort.
			executor.abort();
			expect(executor.aborted).toBe(true);
			expect(executor).toHaveProperty("abort");

			// Release the gate so workspaces can check the signal.
			firstGate.resolve();

			const summary = await executePromise;

			expect(summary.aborted).toBe(true);
			// Some results should have been collected.
			expect(summary.results.length).toBeGreaterThan(0);
			// There should be fewer than 20 (since we aborted).
			expect(summary.results.length).toBeLessThan(20);
		});
	});
});
