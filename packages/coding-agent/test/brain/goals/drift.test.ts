/**
 * GoalDriftDetector Tests — P15.E
 *
 * Comprehensive tests for the GoalDriftDetector class.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GoalDriftDetector } from "../../../src/brain/goals/drift.js";
import { GoalStore } from "../../../src/brain/goals/store.js";
import { createPreferenceRecord, type GoalRecord, type PreferenceRecord } from "../../../src/brain/goals/types.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), ".pi-test", `drift-${Date.now()}`);

function makeStore(basePath?: string): GoalStore {
	return new GoalStore({
		basePath: basePath ?? path.join(TEST_DIR, "brain", "goals"),
		maxFileSizeBytes: 1024 * 1024,
	});
}

/**
 * Create a valid GoalRecord with controllable id and fields.
 *
 * We construct the object manually instead of using createGoalRecord()
 * because createGoalRecord always generates a random UUID for the id
 * field and does not accept an id override.
 */
function makeGoal(id: string, overrides?: Partial<GoalRecord>): GoalRecord {
	const now = new Date().toISOString();
	return {
		id,
		title: "Test Goal",
		description: "A test goal for drift detection",
		priority: "high",
		status: "active",
		category: "general",
		milestones: [],
		createdAt: now,
		updatedAt: now,
		relatedMemoryIds: [],
		metadata: {},
		...overrides,
	};
}

function validPreference(overrides?: Partial<PreferenceRecord>): PreferenceRecord {
	return createPreferenceRecord({
		category: "execution",
		key: "priority-focus",
		value: "high priority work",
		...overrides,
	});
}

async function cleanTestDir(): Promise<void> {
	try {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	} catch {
		// Ignore
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GoalDriftDetector", () => {
	let store: GoalStore;
	let detector: GoalDriftDetector;

	beforeEach(async () => {
		await cleanTestDir();
		store = makeStore();
		await store.initialize();
		detector = new GoalDriftDetector(store);
		await detector.initialize();
	});

	afterEach(async () => {
		await cleanTestDir();
	});

	// -----------------------------------------------------------------------
	// Initialization
	// -----------------------------------------------------------------------

	describe("initialization", () => {
		it("should initialize without error", async () => {
			const d = new GoalDriftDetector(store);
			await expect(d.initialize()).resolves.toBeUndefined();
		});

		it("should be idempotent when calling initialize multiple times", async () => {
			await detector.initialize();
			await detector.initialize(); // Should not throw
		});

		it("should have default config values", () => {
			const config = detector.getConfig();
			expect(config.rejectionThreshold).toBe(3);
			expect(config.windowDays).toBe(7);
			expect(config.mismatchThreshold).toBe(0.5);
			expect(config.checkIntervalHours).toBe(24);
		});

		it("should accept custom config values", async () => {
			const d = new GoalDriftDetector(store, {
				rejectionThreshold: 5,
				windowDays: 14,
				mismatchThreshold: 0.3,
				checkIntervalHours: 12,
			});
			await d.initialize();

			const config = d.getConfig();
			expect(config.rejectionThreshold).toBe(5);
			expect(config.windowDays).toBe(14);
			expect(config.mismatchThreshold).toBe(0.3);
			expect(config.checkIntervalHours).toBe(12);
		});

		it("should start with empty state", () => {
			const state = detector.getState();
			expect(state.lastCheck).toBe("");
			expect(state.lastDriftIds).toEqual([]);
			expect(state.rejectionCount).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	describe("configuration", () => {
		it("should update config via setConfig", () => {
			detector.setConfig({ rejectionThreshold: 10, windowDays: 30 });
			const config = detector.getConfig();
			expect(config.rejectionThreshold).toBe(10);
			expect(config.windowDays).toBe(30);
		});

		it("should preserve unset config fields when updating", () => {
			detector.setConfig({ rejectionThreshold: 5 });
			const config = detector.getConfig();
			expect(config.rejectionThreshold).toBe(5);
			expect(config.windowDays).toBe(7); // default preserved
			expect(config.mismatchThreshold).toBe(0.5); // default preserved
			expect(config.checkIntervalHours).toBe(24); // default preserved
		});
	});

	// -----------------------------------------------------------------------
	// checkDrift — Rejection Pattern Detection
	// -----------------------------------------------------------------------

	describe("checkDrift", () => {
		it("should not detect drift when rejection threshold not reached", async () => {
			const goal = makeGoal("goal-1", { title: "Test Goal" });
			await store.createGoal(goal);

			const reports = await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "prop-1", title: "Proposal 1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-2", title: "Proposal 2" }, goalIds: ["goal-1"] },
				],
			);

			expect(reports).toHaveLength(0);
		});

		it("should detect drift when rejection threshold is reached", async () => {
			const goal = makeGoal("goal-1", { title: "Test Goal" });
			await store.createGoal(goal);

			const reports = await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "prop-1", title: "Proposal 1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-2", title: "Proposal 2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-3", title: "Proposal 3" }, goalIds: ["goal-1"] },
				],
			);

			expect(reports).toHaveLength(1);
			expect(reports[0].goalId).toBe("goal-1");
			expect(reports[0].goalTitle).toBe("Test Goal");
			expect(reports[0].indicators.length).toBeGreaterThanOrEqual(1);
			expect(reports[0].indicators.some((i) => i.type === "rejection_pattern")).toBe(true);
		});

		it("should create drift report with evidence", async () => {
			const goal = makeGoal("goal-1", { title: "Test Goal" });
			await store.createGoal(goal);

			const reports = await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "prop-1", title: "Proposal 1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-2", title: "Proposal 2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-3", title: "Proposal 3" }, goalIds: ["goal-1"] },
				],
			);

			expect(reports).toHaveLength(1);
			const rejectionIndicator = reports[0].indicators.find((i) => i.type === "rejection_pattern");
			expect(rejectionIndicator).toBeDefined();
			expect(rejectionIndicator!.evidence.length).toBeGreaterThan(0);
		});

		it("should persist drift reports to the store", async () => {
			const goal = makeGoal("goal-1", { title: "Test Goal" });
			await store.createGoal(goal);

			await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "prop-1", title: "Proposal 1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-2", title: "Proposal 2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-3", title: "Proposal 3" }, goalIds: ["goal-1"] },
				],
			);

			const reports = await store.listDriftReports("goal-1");
			expect(reports).toHaveLength(1);
		});

		it("should handle multiple goals and rejections to different goals", async () => {
			const goal1 = makeGoal("goal-1", { title: "Goal 1" });
			const goal2 = makeGoal("goal-2", { title: "Goal 2" });
			await store.createGoal(goal1);
			await store.createGoal(goal2);

			const reports = await detector.checkDrift(
				[goal1, goal2],
				[
					// goal-1 gets 3 rejections -> drift
					{ proposal: { id: "prop-1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-3" }, goalIds: ["goal-1"] },
					// goal-2 gets 1 rejection -> no drift
					{ proposal: { id: "prop-4" }, goalIds: ["goal-2"] },
				],
			);

			expect(reports).toHaveLength(1);
			expect(reports[0].goalId).toBe("goal-1");
		});

		it("should not auto-correct goals", async () => {
			const goal = makeGoal("goal-1", { title: "Test Goal" });
			await store.createGoal(goal);

			await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "prop-1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-3" }, goalIds: ["goal-1"] },
				],
			);

			const storedGoal = await store.getGoal("goal-1");
			expect(storedGoal).not.toBeNull();
			expect(storedGoal!.status).toBe("active"); // unchanged
			expect(storedGoal!.title).toBe("Test Goal"); // unchanged
		});

		it("should update state after check", async () => {
			const goal = makeGoal("goal-1");
			await store.createGoal(goal);

			await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "prop-1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-3" }, goalIds: ["goal-1"] },
				],
			);

			const state = detector.getState();
			expect(state.lastCheck).not.toBe("");
			expect(state.lastDriftIds).toHaveLength(1);
			expect(state.rejectionCount).toBe(3);
		});

		it("should detect proposal_mismatch when rejections cite alignment issues", async () => {
			const goal = makeGoal("goal-1", { title: "Test Goal" });
			await store.createGoal(goal);

			const reports = await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "prop-1", reason: "not aligned with current goals" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-2", reason: "irrelevant to our focus" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-3", reason: "off-topic proposal" }, goalIds: ["goal-1"] },
				],
			);

			expect(reports).toHaveLength(1);
			const mismatchIndicator = reports[0].indicators.find((i) => i.type === "proposal_mismatch");
			expect(mismatchIndicator).toBeDefined();
			expect(mismatchIndicator!.details).toContain("alignment");
		});

		it("should not detect mismatch when rejections do not cite alignment", async () => {
			const goal = makeGoal("goal-1", { title: "Test Goal" });
			await store.createGoal(goal);

			const reports = await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "prop-1", reason: "too expensive" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-2", reason: "wrong timing" }, goalIds: ["goal-1"] },
					{ proposal: { id: "prop-3", reason: "prefer different approach" }, goalIds: ["goal-1"] },
				],
			);

			// Should still detect rejection pattern
			expect(reports).toHaveLength(1);
			const mismatchIndicator = reports[0].indicators.find((i) => i.type === "proposal_mismatch");
			expect(mismatchIndicator).toBeUndefined();
		});
	});

	// -----------------------------------------------------------------------
	// analyzeGoalDrift — Per-goal Analysis
	// -----------------------------------------------------------------------

	describe("analyzeGoalDrift", () => {
		it("should return null when no drift indicators are present", async () => {
			const goal = makeGoal("goal-1");
			const result = await detector.analyzeGoalDrift(goal, []);
			expect(result).toBeNull();
		});

		it("should detect drift from rejection pattern", async () => {
			const goal = makeGoal("goal-1", { title: "Test Goal" });

			const result = await detector.analyzeGoalDrift(goal, [
				{ proposal: { id: "p1" } },
				{ proposal: { id: "p2" } },
				{ proposal: { id: "p3" } },
			]);

			expect(result).not.toBeNull();
			expect(result!.goalId).toBe("goal-1");
			expect(result!.indicators.some((i) => i.type === "rejection_pattern")).toBe(true);
		});

		it("should detect staleness for old goals", async () => {
			const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
			const goal = makeGoal("goal-1", { title: "Old Goal", updatedAt: oldDate, createdAt: oldDate });

			const result = await detector.analyzeGoalDrift(goal, []);

			expect(result).not.toBeNull();
			const staleIndicator = result!.indicators.find((i) => i.type === "stale_goal");
			expect(staleIndicator).toBeDefined();
			expect(staleIndicator!.details).toContain("updated");
		});

		it("should not detect staleness for recently updated goals", async () => {
			const goal = makeGoal("goal-1", { updatedAt: new Date().toISOString() });

			const result = await detector.analyzeGoalDrift(goal, []);
			expect(result).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// createDriftProposal
	// -----------------------------------------------------------------------

	describe("createDriftProposal", () => {
		it("should store a drift report and return a proposal ID", async () => {
			const goal = makeGoal("goal-1", { title: "Test" });
			await store.createGoal(goal);

			const reports = await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "p1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p3" }, goalIds: ["goal-1"] },
				],
			);

			expect(reports).toHaveLength(1);
			const result = await detector.createDriftProposal(reports[0]);
			expect(result.drift).toBeDefined();
			expect(result.drift.id).toBe(reports[0].id);
			expect(result.proposalId).toBe(`drift-review-${reports[0].id}`);
		});
	});

	// -----------------------------------------------------------------------
	// runScheduledCheck
	// -----------------------------------------------------------------------

	describe("runScheduledCheck", () => {
		it("should skip check if interval has not elapsed", async () => {
			const goal = makeGoal("goal-1", { title: "Test Goal" });
			await store.createGoal(goal);

			// Record some rejections and get drift report
			await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "p1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p3" }, goalIds: ["goal-1"] },
				],
			);

			// Scheduled check right after should be skipped (within 24h interval)
			const reports = await detector.runScheduledCheck();
			expect(reports).toHaveLength(0);
		});

		it("should not create duplicate unresolved reports for the same goal", async () => {
			const goal = makeGoal("goal-1", { title: "Test Goal" });
			await store.createGoal(goal);

			// Do an initial checkDrift to trigger detection
			const reports1 = await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "p1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p3" }, goalIds: ["goal-1"] },
				],
			);
			expect(reports1).toHaveLength(1);

			// checkDrift doesn't check for existing unresolved reports
			// So it will create another one with more rejections
			const reports2 = await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "p4" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p5" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p6" }, goalIds: ["goal-1"] },
				],
			);
			expect(reports2).toHaveLength(1);
		});
	});

	// -----------------------------------------------------------------------
	// Priority Shift Detection
	// -----------------------------------------------------------------------

	describe("priority shift detection", () => {
		it("should detect priority shift when preferences deprioritize goal", async () => {
			const goal = makeGoal("goal-1", { title: "Critical Goal", priority: "critical" });
			await store.createGoal(goal);

			// Add a preference that deprioritizes critical work
			const pref = validPreference({
				id: "pref-1",
				category: "execution",
				key: "priority-focus",
				value: "low priority",
			});
			await store.createPreference(pref);

			// Trigger with some rejections too
			const reports = await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "p1", reason: "not needed" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p2", reason: "not needed" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p3", reason: "not needed" }, goalIds: ["goal-1"] },
				],
			);

			expect(reports).toHaveLength(1);
			const priorityIndicator = reports[0].indicators.find((i) => i.type === "priority_shift");
			expect(priorityIndicator).toBeDefined();
		});

		it("should not detect priority shift without relevant preferences", async () => {
			const goal = makeGoal("goal-1", { title: "Goal", priority: "normal" });
			await store.createGoal(goal);

			// No preferences set
			const reports = await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "p1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p3" }, goalIds: ["goal-1"] },
				],
			);

			expect(reports).toHaveLength(1);
			const priorityIndicator = reports[0].indicators.find((i) => i.type === "priority_shift");
			expect(priorityIndicator).toBeUndefined();
		});
	});

	// -----------------------------------------------------------------------
	// Rejection Log Persistence
	// -----------------------------------------------------------------------

	describe("rejection log persistence", () => {
		it("should persist and reload rejection log", async () => {
			const goal = makeGoal("goal-1", { title: "Persistent Goal" });
			await store.createGoal(goal);

			await detector.checkDrift(
				[goal],
				[
					{ proposal: { id: "p1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p3" }, goalIds: ["goal-1"] },
				],
			);

			// Create a new detector instance and initialize it
			const detector2 = new GoalDriftDetector(store);
			await detector2.initialize();

			const state = detector2.getState();
			expect(state.rejectionCount).toBe(3);

			const log = detector2.getRejectionLog();
			expect(log["goal-1"]).toHaveLength(3);
		});
	});

	// -----------------------------------------------------------------------
	// Edge Cases
	// -----------------------------------------------------------------------

	describe("edge cases", () => {
		it("should handle empty active goals array", async () => {
			const reports = await detector.checkDrift([], []);
			expect(reports).toHaveLength(0);
		});

		it("should handle empty rejections array", async () => {
			const goal = makeGoal("goal-1", { title: "Goal" });
			await store.createGoal(goal);

			const reports = await detector.checkDrift([goal], []);
			expect(reports).toHaveLength(0);
		});

		it("should handle rejections with empty goalIds", async () => {
			const goal = makeGoal("goal-1", { title: "Goal" });
			await store.createGoal(goal);

			const reports = await detector.checkDrift([goal], [{ proposal: { id: "p1" }, goalIds: [] }]);
			expect(reports).toHaveLength(0);
		});

		it("should handle rejections without proposal metadata", async () => {
			const goal = makeGoal("goal-1", { title: "Goal" });
			await store.createGoal(goal);

			const reports = await detector.checkDrift(
				[goal],
				[
					{ proposal: {}, goalIds: ["goal-1"] },
					{ proposal: {}, goalIds: ["goal-1"] },
					{ proposal: {}, goalIds: ["goal-1"] },
				],
			);

			expect(reports).toHaveLength(1);
			expect(reports[0].indicators.some((i) => i.type === "rejection_pattern")).toBe(true);
		});

		it("should handle rejection threshold of 1", async () => {
			const d = new GoalDriftDetector(store, { rejectionThreshold: 1 });
			await d.initialize();

			const goal = makeGoal("goal-1");
			await store.createGoal(goal);

			const reports = await d.checkDrift([goal], [{ proposal: { id: "p1" }, goalIds: ["goal-1"] }]);

			expect(reports).toHaveLength(1);
		});

		it("should handle short time windows", async () => {
			const d = new GoalDriftDetector(store, { windowDays: 0.001 }); // ~1.4 minutes
			await d.initialize();

			const goal = makeGoal("goal-1");
			await store.createGoal(goal);

			const reports = await d.checkDrift(
				[goal],
				[
					{ proposal: { id: "p1" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p2" }, goalIds: ["goal-1"] },
					{ proposal: { id: "p3" }, goalIds: ["goal-1"] },
				],
			);

			expect(reports).toHaveLength(1);
		});
	});

	// -----------------------------------------------------------------------
	// State Inspection
	// -----------------------------------------------------------------------

	describe("state inspection", () => {
		it("should return current state via getState", () => {
			const state = detector.getState();
			expect(state).toHaveProperty("lastCheck");
			expect(state).toHaveProperty("lastDriftIds");
			expect(state).toHaveProperty("rejectionCount");
		});

		it("should return current config via getConfig", () => {
			const config = detector.getConfig();
			expect(config).toHaveProperty("rejectionThreshold");
			expect(config).toHaveProperty("windowDays");
			expect(config).toHaveProperty("mismatchThreshold");
			expect(config).toHaveProperty("checkIntervalHours");
		});

		it("should return rejection log via getRejectionLog", async () => {
			const log = detector.getRejectionLog();
			expect(typeof log).toBe("object");
		});
	});
});
