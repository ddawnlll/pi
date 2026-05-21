/**
 * Morning Report Generator — P20.B Tests
 *
 * Covers:
 * - Report generation from a RunSession
 * - Report generation from raw data
 * - Markdown rendering
 * - JSON rendering
 * - Summary and title generation
 * - Artifact links
 * - Integration with optional dependencies (memory store, audit ledger)
 * - Edge cases (empty sessions, all failed, stopped sessions)
 */

import { describe, expect, test, vi } from "vitest";
import {
	type MorningReportAuditLedger,
	MorningReportGenerator,
	type MorningReportMemoryStore,
	type MorningReportReflectionEngine,
	type RunSession,
	type WhatStoppedEntry,
} from "../../../src/brain/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock memory store for testing. */
function createMockMemoryStore(): MorningReportMemoryStore {
	return {
		getMemoryStats: vi.fn().mockResolvedValue({ total: 5, byType: { execution_memory: 3, decision_memory: 2 } }),
		countMemoriesSince: vi.fn().mockResolvedValue(5),
	};
}

/** Create a mock audit ledger for testing. */
function createMockAuditLedger(): MorningReportAuditLedger {
	return {
		countEvents: vi
			.fn()
			.mockImplementation((filter?: { category?: string; outcome?: string; fromTimestamp?: string }) => {
				if (filter?.category === "policy") return Promise.resolve(2);
				if (filter?.category === "orchestrator" && filter?.outcome === "pending_approval")
					return Promise.resolve(1);
				if (filter?.outcome === "denied") return Promise.resolve(1);
				return Promise.resolve(10);
			}),
		queryEvents: vi.fn().mockResolvedValue([
			{ id: "evt-1", timestamp: "2026-01-01T01:00:00.000Z", message: "Proposal: refactor queue", target: "queue" },
			{ id: "evt-2", timestamp: "2026-01-01T02:00:00.000Z", message: "Plan exec-1 completed", target: "plan" },
		]),
	};
}

/** Create a mock reflection engine for testing. */
function createMockReflectionEngine(): MorningReportReflectionEngine {
	return {
		countReflectionsSince: vi.fn().mockResolvedValue(3),
	};
}

/** Create a valid RunSession for testing. */
function createSession(overrides?: Partial<RunSession>): RunSession {
	return {
		id: "session-test-1",
		planExecIds: ["exec-1", "exec-2", "exec-3"],
		status: "completed",
		startedAt: "2026-01-01T00:00:00.000Z",
		completedAt: "2026-01-01T06:00:00.000Z",
		progress: { completed: 2, total: 3, failed: 1 },
		createdAt: "2026-01-01T00:00:00.000Z",
		config: {
			planExecIds: ["exec-1", "exec-2", "exec-3"],
			autonomyLevel: 3,
			stopConditions: ["max_duration_reached"],
			maxDurationHours: 8,
			notificationEnabled: true,
			generateMorningReport: true,
		},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MorningReportGenerator", () => {
	// ─────────────────────────────────────────────────────────────
	// Report Generation from Session
	// ─────────────────────────────────────────────────────────────

	describe("generate (from session)", () => {
		test("generates a complete report from a valid session", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession();
			const report = await generator.generate(session);

			expect(report).toBeDefined();
			expect(report.id).toBeDefined();
			expect(report.sessionId).toBe("session-test-1");
			expect(report.date).toBeDefined();
			expect(report.generatedAt).toBeDefined();
			expect(report.reportVersion).toBe("1.0.0");
			expect(report.generatedBy).toBe("MorningReportGenerator");
		});

		test("sets plan counts from session progress", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession();
			const report = await generator.generate(session);

			expect(report.plansAttempted).toBe(3);
			expect(report.plansCompleted).toBe(2);
			expect(report.plansFailed).toBe(1);
		});

		test("calculates duration from session timestamps", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({
				startedAt: "2026-01-01T00:00:00.000Z",
				completedAt: "2026-01-01T02:30:00.000Z",
			});
			const report = await generator.generate(session);

			expect(report.duration).toBe("2h 30m");
		});

		test("generates whatRan entries for each plan", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession();
			const report = await generator.generate(session);

			expect(report.whatRan).toHaveLength(3);
			for (const entry of report.whatRan) {
				expect(entry.planId).toBeDefined();
				expect(entry.planTitle).toBeDefined();
				expect(["completed", "failed", "stopped"]).toContain(entry.status);
			}
		});

		test("populates whatWorked when plans complete", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession();
			const report = await generator.generate(session);

			expect(report.whatWorked.length).toBeGreaterThan(0);
			expect(report.whatWorked[0]).toContain("completed successfully");
		});

		test("populates whatFailed when plans fail", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession();
			const report = await generator.generate(session);

			expect(report.whatFailed.length).toBeGreaterThan(0);
			expect(report.whatFailed[0]).toContain("failed");
		});

		test("populates whatStopped when session is stopped", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({
				status: "stopped",
				stopReason: "integration_queue_dirty",
				completedAt: "2026-01-01T03:00:00.000Z",
			});
			const report = await generator.generate(session);

			expect(report.whatStopped).toHaveLength(1);
			expect(report.whatStopped[0].reason).toBe("integration_queue_dirty");
		});

		test("enriches with memory store data when provided", async () => {
			const memoryStore = createMockMemoryStore();
			const generator = new MorningReportGenerator(memoryStore);
			const session = createSession();
			const report = await generator.generate(session);

			expect(report.newMemoriesCreated).toBe(5);
			expect(report.memoryTypesCreated.length).toBeGreaterThan(0);
			expect(memoryStore.countMemoriesSince).toHaveBeenCalled();
			expect(memoryStore.getMemoryStats).toHaveBeenCalled();
		});

		test("enriches with reflection engine data when provided", async () => {
			const reflectionEngine = createMockReflectionEngine();
			const generator = new MorningReportGenerator(undefined, reflectionEngine);
			const session = createSession();
			const report = await generator.generate(session);

			expect(report.newReflectionsGenerated).toBe(3);
			expect(reflectionEngine.countReflectionsSince).toHaveBeenCalled();
		});

		test("enriches with audit ledger data when provided", async () => {
			const auditLedger = createMockAuditLedger();
			const generator = new MorningReportGenerator(undefined, undefined, auditLedger);
			const session = createSession();
			const report = await generator.generate(session);

			expect(report.totalAuditEntries).toBe(10);
			expect(report.policyStops).toBe(2);
			expect(report.approvalRequests).toBe(1);
			expect(report.safetyInterventions).toBe(1);
			expect(auditLedger.countEvents).toHaveBeenCalled();
		});

		test("includes artifact links when dependencies are provided", async () => {
			const memoryStore = createMockMemoryStore();
			const auditLedger = createMockAuditLedger();
			const generator = new MorningReportGenerator(memoryStore, undefined, auditLedger);
			const session = createSession();
			const report = await generator.generate(session);

			const types = report.artifactLinks.map((l) => l.type);
			expect(types).toContain("report");
			expect(types).toContain("memory");
			expect(types).toContain("audit");
		});

		test("handles a failed session gracefully", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({
				status: "failed",
				progress: { completed: 0, total: 2, failed: 2 },
			});
			const report = await generator.generate(session);

			expect(report.plansCompleted).toBe(0);
			expect(report.plansFailed).toBe(2);
			expect(report.whatFailed.length).toBeGreaterThan(0);
		});

		test("handles a stopped session gracefully", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({
				status: "stopped",
				stopReason: "user_intervention",
				progress: { completed: 1, total: 3, failed: 0 },
			});
			const report = await generator.generate(session);

			expect(report.whatStopped).toHaveLength(1);
			expect(report.whatStopped[0].reason).toBe("user_intervention");
		});
	});

	// ─────────────────────────────────────────────────────────────
	// Report Generation from Data
	// ─────────────────────────────────────────────────────────────

	describe("generateFromData", () => {
		test("generates a complete report from raw data", async () => {
			const generator = new MorningReportGenerator();
			const data = {
				sessionId: "session-data-1",
				date: "2026-01-15",
				whatRan: [
					{
						planId: "exec-1",
						planTitle: "Plan A",
						status: "completed" as const,
						workspacesCompleted: 3,
						workspacesFailed: 0,
						duration: "30m",
					},
					{
						planId: "exec-2",
						planTitle: "Plan B",
						status: "failed" as const,
						workspacesCompleted: 0,
						workspacesFailed: 1,
						duration: "15m",
					},
				],
				whatWorked: ["Plan A completed"],
				whatFailed: ["Plan B failed"],
				whatStopped: [] as WhatStoppedEntry[],
				newMemoriesCreated: 10,
				memoryTypesCreated: ["execution_memory", "decision_memory"],
				newReflectionsGenerated: 2,
				proposalsGenerated: 3,
				proposalsAccepted: 1,
				policyStops: 0,
				approvalRequests: 1,
				safetyInterventions: 0,
				topProposals: [],
				suggestedNextActions: ["Review Plan B failure"],
				recommendedGoalUpdates: [],
				artifactLinks: [],
			};

			const report = await generator.generateFromData(data);

			expect(report).toBeDefined();
			expect(report.id).toBeDefined();
			expect(report.sessionId).toBe("session-data-1");
			expect(report.date).toBe("2026-01-15");
			expect(report.plansAttempted).toBe(2);
			expect(report.plansCompleted).toBe(1);
			expect(report.plansFailed).toBe(1);
			expect(report.newMemoriesCreated).toBe(10);
		});

		test("generates title and summary from data", async () => {
			const generator = new MorningReportGenerator();
			const data = {
				sessionId: "session-data-2",
				date: "2026-01-15",
				whatRan: [
					{
						planId: "exec-1",
						planTitle: "Plan A",
						status: "completed" as const,
						workspacesCompleted: 2,
						workspacesFailed: 0,
						duration: "20m",
					},
				],
				whatWorked: ["All good"],
				whatFailed: [],
				whatStopped: [] as WhatStoppedEntry[],
				newMemoriesCreated: 0,
				memoryTypesCreated: [],
				newReflectionsGenerated: 0,
				proposalsGenerated: 0,
				proposalsAccepted: 0,
				policyStops: 0,
				approvalRequests: 0,
				safetyInterventions: 0,
				topProposals: [],
				suggestedNextActions: [],
				recommendedGoalUpdates: [],
				artifactLinks: [],
			};

			const report = await generator.generateFromData(data);

			expect(report.title).toContain("All 1 Plans Completed");
			expect(report.summary).toContain("completed successfully");
		});
	});

	// ─────────────────────────────────────────────────────────────
	// Title Generation
	// ─────────────────────────────────────────────────────────────

	describe("title generation", () => {
		test("title shows all completed when all succeed", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({ progress: { completed: 3, total: 3, failed: 0 } });
			const report = await generator.generate(session);

			expect(report.title).toContain("All 3 Plans Completed");
		});

		test("title shows failures when some plans fail", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({ progress: { completed: 1, total: 3, failed: 2 } });
			const report = await generator.generate(session);

			expect(report.title).toContain("2/3 Plans Failed");
		});

		test("title shows placeholder for empty session", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({ planExecIds: [], progress: { completed: 0, total: 0, failed: 0 } });
			const report = await generator.generate(session);

			expect(report.title).toContain("No Plans Executed");
		});
	});

	// ─────────────────────────────────────────────────────────────
	// Markdown Rendering
	// ─────────────────────────────────────────────────────────────

	describe("renderMarkdown", () => {
		test("renders a valid markdown string with all sections", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession();
			const report = await generator.generate(session);
			const md = await generator.renderMarkdown(report);

			expect(md).toContain("# Morning Report");
			expect(md).toContain("## Executive Summary");
			expect(md).toContain("## Plan Summary");
			expect(md).toContain("## What Ran");
			expect(md).toContain("## Analysis");
			expect(md).toContain("## Changes");
			expect(md).toContain("## Trust & Safety");
			expect(md).toContain("## Next Steps");
		});

		test("includes artifact links section when artifacts exist", async () => {
			const auditLedger = createMockAuditLedger();
			const generator = new MorningReportGenerator(undefined, undefined, auditLedger);
			const session = createSession();
			const report = await generator.generate(session);
			const md = await generator.renderMarkdown(report);

			expect(md).toContain("## Artifacts");
		});

		test("includes what stopped in markdown", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({
				status: "stopped",
				stopReason: "policy_violation",
			});
			const report = await generator.generate(session);
			const md = await generator.renderMarkdown(report);

			expect(md).toContain("### What Stopped");
		});
	});

	// ─────────────────────────────────────────────────────────────
	// JSON Rendering
	// ─────────────────────────────────────────────────────────────

	describe("renderJson", () => {
		test("renders valid JSON", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession();
			const report = await generator.generate(session);
			const json = await generator.renderJson(report);

			const parsed = JSON.parse(json);
			expect(parsed.id).toBe(report.id);
			expect(parsed.sessionId).toBe("session-test-1");
			expect(parsed.whatRan).toHaveLength(3);
		});
	});

	// ─────────────────────────────────────────────────────────────
	// Save Report
	// ─────────────────────────────────────────────────────────────

	describe("saveReport", () => {
		test("saves report to disk and returns path", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession();
			const report = await generator.generate(session);

			// Use a temp directory
			const { tmpdir } = await import("node:os");
			const { join } = await import("node:path");
			const { mkdtempSync } = await import("node:fs");
			const baseDir = mkdtempSync(join(tmpdir(), "morning-report-test-"));
			const path = await generator.saveReport(report, baseDir);

			expect(path).toBeDefined();
			expect(path).toContain(".md");
			expect(path).toContain(baseDir);

			// Verify the file was written
			const { readFile } = await import("node:fs/promises");
			const content = await readFile(path, "utf-8");
			expect(content).toContain("# Morning Report");
		});
	});

	// ─────────────────────────────────────────────────────────────
	// Edge Cases
	// ─────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		test("handles empty session with no plans", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({
				planExecIds: [],
				progress: { completed: 0, total: 0, failed: 0 },
			});
			const report = await generator.generate(session);

			expect(report.whatRan).toHaveLength(0);
		});

		test("handles missing timestamps gracefully", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({
				startedAt: undefined,
				completedAt: undefined,
			});
			const report = await generator.generate(session);

			expect(report.duration).toBeDefined();
			expect(report.generatedAt).toBeDefined();
		});

		test("handles error from memory store gracefully", async () => {
			const badMemoryStore: MorningReportMemoryStore = {
				getMemoryStats: vi.fn().mockRejectedValue(new Error("Store unavailable")),
				countMemoriesSince: vi.fn().mockRejectedValue(new Error("Store unavailable")),
			};
			const generator = new MorningReportGenerator(badMemoryStore);
			const session = createSession();
			const report = await generator.generate(session);

			// Should not throw — memory store errors are non-fatal
			expect(report.newMemoriesCreated).toBe(0);
			expect(report.memoryTypesCreated).toEqual([]);
		});

		test("handles error from audit ledger gracefully", async () => {
			const badAuditLedger: MorningReportAuditLedger = {
				countEvents: vi.fn().mockRejectedValue(new Error("Audit unavailable")),
				queryEvents: vi.fn().mockRejectedValue(new Error("Audit unavailable")),
			};
			const generator = new MorningReportGenerator(undefined, undefined, badAuditLedger);
			const session = createSession();
			const report = await generator.generate(session);

			// Should not throw — audit ledger errors are non-fatal
			expect(report.totalAuditEntries).toBe(0);
			expect(report.policyStops).toBe(0);
		});

		test("handles all plans failing", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({
				status: "failed",
				progress: { completed: 0, total: 2, failed: 2 },
			});
			const report = await generator.generate(session);

			expect(report.plansCompleted).toBe(0);
			expect(report.plansFailed).toBe(2);
			expect(report.title).toContain("Failed");
		});

		test("handles long-running sessions", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession({
				startedAt: "2026-01-01T00:00:00.000Z",
				completedAt: "2026-01-01T07:45:00.000Z",
			});
			const report = await generator.generate(session);

			expect(report.duration).toBe("7h 45m");
		});
	});

	// ─────────────────────────────────────────────────────────────
	// sendReport (placeholder)
	// ─────────────────────────────────────────────────────────────

	describe("sendReport", () => {
		test("does not throw when called with no channels", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession();
			const report = await generator.generate(session);

			await expect(generator.sendReport(report)).resolves.toBeUndefined();
		});

		test("does not throw when called with channels", async () => {
			const generator = new MorningReportGenerator();
			const session = createSession();
			const report = await generator.generate(session);

			await expect(generator.sendReport(report, ["desktop", "email"])).resolves.toBeUndefined();
		});
	});
});
