/**
 * GoalStore Tests — P15.B
 *
 * Comprehensive tests for the GoalStore class.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GoalStore } from "../../../src/brain/goals/store.js";
import {
	ALL_GOAL_PRIORITIES,
	ALL_GOAL_STATUSES,
	ALL_PREFERENCE_CATEGORIES,
	createAutonomyProfile,
	createGoalDriftReport,
	createGoalRecord,
	createPreferenceRecord,
	type AutonomyProfile,
	type GoalDriftReport,
	type GoalRecord,
	type PreferenceRecord,
} from "../../../src/brain/goals/types.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), ".pi-test", `goals-store-${Date.now()}`);

function makeGoalStore(basePath?: string): GoalStore {
	return new GoalStore({
		basePath: basePath ?? path.join(TEST_DIR, "brain", "goals"),
		maxFileSizeBytes: 1024 * 1024,
	});
}

function validGoal(overrides?: Partial<GoalRecord>): GoalRecord {
	return createGoalRecord({ title: "test-goal", description: "A test goal", ...overrides });
}

function validPreference(overrides?: Partial<PreferenceRecord>): PreferenceRecord {
	return createPreferenceRecord({
		category: "execution",
		key: "test-key",
		value: "test-value",
		...overrides,
	});
}

function validDriftReport(overrides?: Partial<GoalDriftReport>): GoalDriftReport {
	const report = createGoalDriftReport();
	return { ...report, goalId: "goal-1", goalTitle: "Test Goal", ...overrides };
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

describe("GoalStore", () => {
	let store: GoalStore;

	beforeEach(async () => {
		await cleanTestDir();
		store = makeGoalStore();
		await store.initialize();
	});

	afterEach(async () => {
		await cleanTestDir();
	});

	// -----------------------------------------------------------------------
	// Initialization
	// -----------------------------------------------------------------------

	describe("initialization", () => {
		it("should create directories on initialize", async () => {
			const basePath = path.join(TEST_DIR, "brain", "goals");
			await fs.rm(basePath, { recursive: true, force: true });

			const s = makeGoalStore(basePath);
			expect(s.getConfig().basePath).toBe(basePath);

			await s.initialize();

			// Check directories exist
			const driftDir = path.join(basePath, "drift");
			await expect(fs.access(basePath)).resolves.toBeUndefined();
			await expect(fs.access(driftDir)).resolves.toBeUndefined();
		});

		it("should be idempotent when calling initialize multiple times", async () => {
			await store.initialize();
			await store.initialize(); // Should not throw
		});
	});

	// -----------------------------------------------------------------------
	// Uninitialized Guard
	// -----------------------------------------------------------------------

	describe("uninitialized guard", () => {
		it("should throw on operations before initialize", async () => {
			const fresh = makeGoalStore();
			const goal = validGoal();

			await expect(fresh.createGoal(goal)).rejects.toThrow("not initialized");
			await expect(fresh.getGoal("x")).rejects.toThrow("not initialized");
			await expect(fresh.updateGoal("x", {})).rejects.toThrow("not initialized");
			await expect(fresh.deleteGoal("x")).rejects.toThrow("not initialized");
			await expect(fresh.listGoals()).rejects.toThrow("not initialized");
			await expect(fresh.createPreference(validPreference())).rejects.toThrow("not initialized");
			await expect(fresh.getPreference("x")).rejects.toThrow("not initialized");
			await expect(fresh.updatePreference("x", {})).rejects.toThrow("not initialized");
			await expect(fresh.deletePreference("x")).rejects.toThrow("not initialized");
			await expect(fresh.listPreferences()).rejects.toThrow("not initialized");
			await expect(fresh.saveProfile(createAutonomyProfile(2))).rejects.toThrow("not initialized");
			await expect(fresh.getProfile("x")).rejects.toThrow("not initialized");
			await expect(fresh.deleteProfile("x")).rejects.toThrow("not initialized");
			await expect(fresh.createDriftReport(validDriftReport())).rejects.toThrow("not initialized");
			await expect(fresh.getDriftReport("x")).rejects.toThrow("not initialized");
			await expect(fresh.listDriftReports()).rejects.toThrow("not initialized");
			await expect(fresh.getStats()).rejects.toThrow("not initialized");
			await expect(fresh.rebuildIndex()).rejects.toThrow("not initialized");
		});
	});

	// -----------------------------------------------------------------------
	// Goals CRUD
	// -----------------------------------------------------------------------

	describe("goals CRUD", () => {
		it("should create a goal", async () => {
			const goal = validGoal();
			const created = await store.createGoal(goal);

			expect(created.id).toBe(goal.id);
			expect(created.title).toBe("test-goal");
			expect(created.status).toBe("active");
		});

		it("should reject invalid goal records", async () => {
			const invalid = { id: "", title: "" } as unknown as GoalRecord;
			await expect(store.createGoal(invalid)).rejects.toThrow("Invalid GoalRecord");
		});

		it("should get a goal by id", async () => {
			const goal = validGoal();
			await store.createGoal(goal);

			const retrieved = await store.getGoal(goal.id);
			expect(retrieved).not.toBeNull();
			expect(retrieved!.id).toBe(goal.id);
			expect(retrieved!.title).toBe("test-goal");
		});

		it("should return null for non-existent goal", async () => {
			const retrieved = await store.getGoal("non-existent");
			expect(retrieved).toBeNull();
		});

		it("should update a goal", async () => {
			const goal = validGoal();
			await store.createGoal(goal);

			const updated = await store.updateGoal(goal.id, { title: "updated-title", priority: "high" });
			expect(updated.title).toBe("updated-title");
			expect(updated.priority).toBe("high");
			expect(updated.updatedAt).not.toBe(goal.updatedAt);
		});

		it("should throw when updating non-existent goal", async () => {
			await expect(store.updateGoal("non-existent", { title: "new" })).rejects.toThrow("not found");
		});

		it("should delete a goal", async () => {
			const goal = validGoal();
			await store.createGoal(goal);

			await store.deleteGoal(goal.id);
			const retrieved = await store.getGoal(goal.id);
			expect(retrieved).toBeNull();
		});

		it("should throw when deleting non-existent goal", async () => {
			await expect(store.deleteGoal("non-existent")).rejects.toThrow("not found");
		});

		it("should list all goals", async () => {
			const g1 = validGoal({ title: "goal-1" });
			const g2 = validGoal({ title: "goal-2" });
			await store.createGoal(g1);
			await store.createGoal(g2);

			const goals = await store.listGoals();
			expect(goals).toHaveLength(2);
		});

		it("should filter goals by status", async () => {
			const g1 = validGoal({ title: "active-goal", status: "active" });
			const g2 = validGoal({ title: "completed-goal", status: "completed" });
			await store.createGoal(g1);
			await store.createGoal(g2);

			const active = await store.listGoals({ status: "active" });
			expect(active).toHaveLength(1);
			expect(active[0].id).toBe(g1.id);
		});

		it("should filter goals by priority", async () => {
			const g1 = validGoal({ title: "critical-goal", priority: "critical" });
			const g2 = validGoal({ title: "normal-goal", priority: "normal" });
			await store.createGoal(g1);
			await store.createGoal(g2);

			const critical = await store.listGoals({ priority: "critical" });
			expect(critical).toHaveLength(1);
			expect(critical[0].id).toBe(g1.id);
		});

		it("should filter goals by category", async () => {
			const g1 = validGoal({ title: "project-goal", category: "project" });
			const g2 = validGoal({ title: "learning-goal", category: "learning" });
			await store.createGoal(g1);
			await store.createGoal(g2);

			const project = await store.listGoals({ category: "project" });
			expect(project).toHaveLength(1);
			expect(project[0].id).toBe(g1.id);
		});

		it("should combine multiple filters", async () => {
			const g1 = validGoal({ title: "critical-active-project", status: "active", priority: "critical", category: "project" });
			const g2 = validGoal({ title: "normal-active-project", status: "active", priority: "normal", category: "project" });
			await store.createGoal(g1);
			await store.createGoal(g2);

			const filtered = await store.listGoals({ status: "active", priority: "critical" });
			expect(filtered).toHaveLength(1);
			expect(filtered[0].id).toBe(g1.id);
		});

		it("should sort goals by createdAt descending", async () => {
			const g1 = validGoal({ title: "first" });
			const g2 = validGoal({ title: "second" });
			await store.createGoal(g1);
			await store.createGoal(g2);

			const goals = await store.listGoals();
			expect(goals).toHaveLength(2);
			// Most recent first
			expect(goals[0].title).toBe("second");
			expect(goals[1].title).toBe("first");
		});
	});

	// -----------------------------------------------------------------------
	// Preferences CRUD
	// -----------------------------------------------------------------------

	describe("preferences CRUD", () => {
		it("should create a preference", async () => {
			const pref = validPreference();
			const created = await store.createPreference(pref);

			expect(created.id).toBe(pref.id);
			expect(created.key).toBe("test-key");
			expect(created.value).toBe("test-value");
		});

		it("should reject invalid preference records", async () => {
			const invalid = { id: "" } as unknown as PreferenceRecord;
			await expect(store.createPreference(invalid)).rejects.toThrow("Invalid PreferenceRecord");
		});

		it("should get a preference by id", async () => {
			const pref = validPreference();
			await store.createPreference(pref);

			const retrieved = await store.getPreference(pref.id);
			expect(retrieved).not.toBeNull();
			expect(retrieved!.id).toBe(pref.id);
		});

		it("should return null for non-existent preference", async () => {
			const retrieved = await store.getPreference("non-existent");
			expect(retrieved).toBeNull();
		});

		it("should update a preference", async () => {
			const pref = validPreference();
			await store.createPreference(pref);

			const updated = await store.updatePreference(pref.id, { value: "new-value" });
			expect(updated.value).toBe("new-value");
			expect(updated.updatedAt).not.toBe(pref.updatedAt);
		});

		it("should throw when updating non-existent preference", async () => {
			await expect(store.updatePreference("non-existent", { value: "x" })).rejects.toThrow("not found");
		});

		it("should delete a preference", async () => {
			const pref = validPreference();
			await store.createPreference(pref);

			await store.deletePreference(pref.id);
			const retrieved = await store.getPreference(pref.id);
			expect(retrieved).toBeNull();
		});

		it("should throw when deleting non-existent preference", async () => {
			await expect(store.deletePreference("non-existent")).rejects.toThrow("not found");
		});

		it("should list preferences", async () => {
			const p1 = validPreference({ key: "key-1" });
			const p2 = validPreference({ key: "key-2" });
			await store.createPreference(p1);
			await store.createPreference(p2);

			const prefs = await store.listPreferences();
			expect(prefs).toHaveLength(2);
		});

		it("should filter preferences by category", async () => {
			const p1 = validPreference({ key: "exec-key", category: "execution" });
			const p2 = validPreference({ key: "plan-key", category: "planning" });
			await store.createPreference(p1);
			await store.createPreference(p2);

			const execPrefs = await store.listPreferences("execution");
			expect(execPrefs).toHaveLength(1);
			expect(execPrefs[0].id).toBe(p1.id);
		});
	});

	// -----------------------------------------------------------------------
	// Autonomy Profiles CRUD
	// -----------------------------------------------------------------------

	describe("autonomy profiles CRUD", () => {
		it("should save a profile", async () => {
			const profile = createAutonomyProfile(2);
			const saved = await store.saveProfile(profile);

			expect(saved.userId).toBe("default");
			expect(saved.level).toBe(2);
		});

		it("should get a profile by user id", async () => {
			const profile = createAutonomyProfile(3);
			await store.saveProfile(profile);

			const retrieved = await store.getProfile("default");
			expect(retrieved).not.toBeNull();
			expect(retrieved!.level).toBe(3);
		});

		it("should return null for non-existent profile", async () => {
			const retrieved = await store.getProfile("unknown-user");
			expect(retrieved).toBeNull();
		});

		it("should overwrite existing profile on save", async () => {
			const profile1 = createAutonomyProfile(1);
			await store.saveProfile(profile1);

			const profile2 = createAutonomyProfile(4);
			profile2.userId = "default";
			await store.saveProfile(profile2);

			const retrieved = await store.getProfile("default");
			expect(retrieved!.level).toBe(4);
		});

		it("should delete a profile", async () => {
			const profile = createAutonomyProfile(2);
			await store.saveProfile(profile);

			await store.deleteProfile("default");
			const retrieved = await store.getProfile("default");
			expect(retrieved).toBeNull();
		});

		it("should not throw when deleting non-existent profile", async () => {
			await expect(store.deleteProfile("non-existent")).resolves.toBeUndefined();
		});
	});

	// -----------------------------------------------------------------------
	// Drift Reports CRUD
	// -----------------------------------------------------------------------

	describe("drift reports CRUD", () => {
		it("should create a drift report", async () => {
			const report = validDriftReport();
			const created = await store.createDriftReport(report);

			expect(created.id).toBe(report.id);
			expect(created.goalId).toBe("goal-1");
		});

		it("should reject invalid drift reports", async () => {
			const invalid = { id: "" } as unknown as GoalDriftReport;
			await expect(store.createDriftReport(invalid)).rejects.toThrow("Invalid GoalDriftReport");
		});

		it("should get a drift report by id", async () => {
			const report = validDriftReport();
			await store.createDriftReport(report);

			const retrieved = await store.getDriftReport(report.id);
			expect(retrieved).not.toBeNull();
			expect(retrieved!.id).toBe(report.id);
		});

		it("should return null for non-existent drift report", async () => {
			const retrieved = await store.getDriftReport("non-existent");
			expect(retrieved).toBeNull();
		});

		it("should list drift reports", async () => {
			const r1 = validDriftReport({ goalId: "goal-1", goalTitle: "Goal 1" });
			const r2 = validDriftReport({ goalId: "goal-2", goalTitle: "Goal 2" });
			await store.createDriftReport(r1);
			await store.createDriftReport(r2);

			const reports = await store.listDriftReports();
			expect(reports).toHaveLength(2);
		});

		it("should filter drift reports by goalId", async () => {
			const r1 = validDriftReport({ goalId: "goal-1", goalTitle: "Goal 1" });
			const r2 = validDriftReport({ goalId: "goal-2", goalTitle: "Goal 2" });
			await store.createDriftReport(r1);
			await store.createDriftReport(r2);

			const filtered = await store.listDriftReports("goal-1");
			expect(filtered).toHaveLength(1);
			expect(filtered[0].id).toBe(r1.id);
		});

		it("should sort drift reports by generatedAt descending", async () => {
			const r1 = validDriftReport({ goalId: "goal-1", goalTitle: "Goal 1" });
			const r2 = validDriftReport({ goalId: "goal-1", goalTitle: "Goal 1" });
			// Ensure different timestamps
			await new Promise((r) => setTimeout(r, 10));
			await store.createDriftReport(r1);
			await new Promise((r) => setTimeout(r, 10));
			await store.createDriftReport(r2);

			const reports = await store.listDriftReports("goal-1");
			expect(reports).toHaveLength(2);
			expect(reports[0].id).toBe(r2.id);
			expect(reports[1].id).toBe(r1.id);
		});
	});

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	describe("stats", () => {
		it("should return empty stats when no data exists", async () => {
			const stats = await store.getStats();
			expect(stats.totalGoals).toBe(0);
			expect(stats.activeGoals).toBe(0);
			expect(stats.completedGoals).toBe(0);
			expect(stats.driftReports).toBe(0);
			expect(stats.openDriftReports).toBe(0);
		});

		it("should compute correct stats from goals", async () => {
			const g1 = validGoal({ title: "g1", status: "active" });
			const g2 = validGoal({ title: "g2", status: "active" });
			const g3 = validGoal({ title: "g3", status: "completed" });
			await store.createGoal(g1);
			await store.createGoal(g2);
			await store.createGoal(g3);

			const stats = await store.getStats();
			expect(stats.totalGoals).toBe(3);
			expect(stats.activeGoals).toBe(2);
			expect(stats.completedGoals).toBe(1);
			expect(stats.byStatus.active).toBe(2);
			expect(stats.byStatus.completed).toBe(1);
		});

		it("should include drift reports in stats", async () => {
			const goal = validGoal({ title: "g1" });
			await store.createGoal(goal);

			const r1 = validDriftReport({ goalId: goal.id, goalTitle: goal.title });
			const r2 = validDriftReport({ goalId: goal.id, goalTitle: goal.title });
			await store.createDriftReport(r1);
			await store.createDriftReport(r2);

			const stats = await store.getStats();
			expect(stats.driftReports).toBe(2);
			expect(stats.openDriftReports).toBe(2);
		});
	});

	// -----------------------------------------------------------------------
	// Index Management
	// -----------------------------------------------------------------------

	describe("index management", () => {
		it("should rebuild index from on-disk files", async () => {
			const g1 = validGoal({ title: "g1", status: "active" });
			const g2 = validGoal({ title: "g2", status: "completed" });
			await store.createGoal(g1);
			await store.createGoal(g2);

			// Corrupt the index by deleting it
			const indexPath = store.getConfig().indexPath;
			await fs.unlink(indexPath);

			// Rebuild
			await store.rebuildIndex();

			// Verify lookups work after rebuild
			const goals = await store.listGoals();
			expect(goals).toHaveLength(2);

			const active = await store.listGoals({ status: "active" });
			expect(active).toHaveLength(1);
		});

		it("should rebuild index including preferences and drift reports", async () => {
			const pref = validPreference();
			await store.createPreference(pref);

			const report = validDriftReport();
			await store.createDriftReport(report);

			// Delete the index
			const indexPath = store.getConfig().indexPath;
			await fs.unlink(indexPath);

			// Rebuild
			await store.rebuildIndex();

			// Verify data is still accessible
			const prefs = await store.listPreferences();
			expect(prefs).toHaveLength(1);

			const reports = await store.listDriftReports();
			expect(reports).toHaveLength(1);
		});
	});

	// -----------------------------------------------------------------------
	// Persistence
	// -----------------------------------------------------------------------

	describe("persistence", () => {
		it("should persist goals across store instances", async () => {
			const basePath = path.join(TEST_DIR, "persist-test");
			const s1 = makeGoalStore(basePath);
			await s1.initialize();

			const goal = validGoal();
			await s1.createGoal(goal);

			// Create a new store instance pointing to the same path
			const s2 = makeGoalStore(basePath);
			await s2.initialize();

			const retrieved = await s2.getGoal(goal.id);
			expect(retrieved).not.toBeNull();
			expect(retrieved!.title).toBe(goal.title);
		});
	});

	// -----------------------------------------------------------------------
	// Atomicity & Safety
	// -----------------------------------------------------------------------

	describe("atomic write safety", () => {
		it("should not leave temp files behind after writes", async () => {
			const goal = validGoal();
			await store.createGoal(goal);

			const files = await fs.readdir(store.getConfig().basePath);
			const tmpFiles = files.filter((f) => f.includes(".tmp."));
			expect(tmpFiles).toHaveLength(0);
		});

		it("should enforce max file size limit", async () => {
			const tinyStore = new GoalStore({
				basePath: path.join(TEST_DIR, "tiny-max"),
				maxFileSizeBytes: 10, // Tiny limit
			});
			await tinyStore.initialize();

			const goal = validGoal();
			await expect(tinyStore.createGoal(goal)).rejects.toThrow("exceeds maximum");
		});
	});

	// -----------------------------------------------------------------------
	// Edge Cases: Empty Strings and Boundaries
	// -----------------------------------------------------------------------

	describe("edge cases", () => {
		it("should handle boolean preference values", async () => {
			const pref = validPreference({ key: "bool-key", value: true });
			const created = await store.createPreference(pref);
			expect(created.value).toBe(true);
		});

		it("should handle number preference values", async () => {
			const pref = validPreference({ key: "num-key", value: 42 });
			const created = await store.createPreference(pref);
			expect(created.value).toBe(42);
		});

		it("should update goal with status changes and reflect in filtered queries", async () => {
			const goal = validGoal({ title: "change-status", status: "active" });
			await store.createGoal(goal);

			await store.updateGoal(goal.id, { status: "completed" });

			const active = await store.listGoals({ status: "active" });
			expect(active).toHaveLength(0);

			const completed = await store.listGoals({ status: "completed" });
			expect(completed).toHaveLength(1);
			expect(completed[0].id).toBe(goal.id);
		});

		it("should handle many goals for index performance", async () => {
			const count = 50;
			const goals: GoalRecord[] = [];
			for (let i = 0; i < count; i++) {
				const status = i % 3 === 0 ? "completed" : i % 3 === 1 ? "paused" : "active";
				const goal = validGoal({ title: `bulk-${i}`, status: status as GoalRecord["status"] });
				goals.push(goal);
			}

			for (const g of goals) {
				await store.createGoal(g);
			}

			const all = await store.listGoals();
			expect(all).toHaveLength(count);

			const active = await store.listGoals({ status: "active" });
			expect(active.length).toBeGreaterThan(0);
		});
	});
});
