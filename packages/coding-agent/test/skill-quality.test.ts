/**
 * Tests for Skill Quality Metadata - P11.E
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	formatSkillQualityTable,
	type SkillQualityRecord,
	SkillQualityStore,
	type SkillTestRun,
	scoreToRating,
} from "../src/core/skill-quality.js";

describe("skill-quality", () => {
	describe("scoreToRating", () => {
		it("should return unknown for undefined score", () => {
			expect(scoreToRating(undefined)).toBe("unknown");
		});

		it("should return excellent for score >= 0.9", () => {
			expect(scoreToRating(0.95)).toBe("excellent");
			expect(scoreToRating(1.0)).toBe("excellent");
		});

		it("should return high for score >= 0.7", () => {
			expect(scoreToRating(0.85)).toBe("high");
			expect(scoreToRating(0.7)).toBe("high");
		});

		it("should return medium for score >= 0.4", () => {
			expect(scoreToRating(0.6)).toBe("medium");
			expect(scoreToRating(0.4)).toBe("medium");
		});

		it("should return low for score < 0.4", () => {
			expect(scoreToRating(0.2)).toBe("low");
			expect(scoreToRating(0)).toBe("low");
		});
	});

	describe("SkillQualityStore", () => {
		let agentDir: string;
		let store: SkillQualityStore;

		beforeEach(() => {
			agentDir = join(tmpdir(), `pi-skill-quality-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
			mkdirSync(agentDir, { recursive: true });
			store = new SkillQualityStore(agentDir);
		});

		afterEach(() => {
			if (agentDir) {
				rmSync(agentDir, { recursive: true, force: true });
			}
		});

		it("should start with empty records", () => {
			expect(store.getAll()).toHaveLength(0);
		});

		it("should store and retrieve a quality record", () => {
			const record: SkillQualityRecord = {
				skillName: "test-skill",
				version: "1.0.0",
				reliabilityScore: 0.85,
				reliabilityRating: "high",
				usageStats: {
					invocationCount: 10,
					successCount: 9,
					failureCount: 1,
					lastUsed: new Date().toISOString(),
				},
				lastUpdated: new Date().toISOString(),
				verified: true,
			};
			store.set(record);
			expect(store.get("test-skill")).toBeDefined();
			expect(store.get("test-skill")!.reliabilityScore).toBe(0.85);
		});

		it("should record a test run and update metrics", () => {
			const testRun: SkillTestRun = {
				skillName: "test-skill",
				passed: 8,
				failed: 2,
				total: 10,
				tests: [
					{ name: "test1", passed: true, timestamp: new Date().toISOString() },
					{ name: "test2", passed: false, error: "Failed", timestamp: new Date().toISOString() },
				],
				timestamp: new Date().toISOString(),
			};
			store.recordTestRun(testRun, "1.0.0");
			const record = store.get("test-skill");
			expect(record).toBeDefined();
			expect(record!.lastTestRun).toBeDefined();
			expect(record!.lastTestRun!.passed).toBe(8);
			expect(record!.lastTestRun!.failed).toBe(2);
		});

		it("should record invocations and track usage stats", () => {
			store.recordInvocation("test-skill", "1.0.0", true, 100);
			store.recordInvocation("test-skill", "1.0.0", true, 200);
			store.recordInvocation("test-skill", "1.0.0", false, 50);

			const record = store.get("test-skill");
			expect(record).toBeDefined();
			expect(record!.usageStats.invocationCount).toBe(3);
			expect(record!.usageStats.successCount).toBe(2);
			expect(record!.usageStats.failureCount).toBe(1);
			expect(record!.usageStats.avgDurationMs).toBeCloseTo(116.67, 0); // (100+200+50)/3
		});

		it("should compute reliability score from test and usage data", () => {
			// First record a test run with 80% pass rate
			store.recordTestRun(
				{
					skillName: "test-skill",
					passed: 8,
					failed: 2,
					total: 10,
					tests: [],
					timestamp: new Date().toISOString(),
				},
				"1.0.0",
			);

			// Then record some invocations with 100% success
			store.recordInvocation("test-skill", "1.0.0", true, 100);
			store.recordInvocation("test-skill", "1.0.0", true, 100);

			const record = store.get("test-skill");
			// 60% weight on tests (0.8 * 0.6) + 40% weight on usage (1.0 * 0.4) = 0.48 + 0.40 = 0.88
			expect(record!.reliabilityScore).toBeCloseTo(0.88, 1);
			expect(record!.reliabilityRating).toBe("high");
		});

		it("should export data for API", () => {
			store.recordInvocation("skill-a", "1.0.0", true, 100);
			store.recordInvocation("skill-b", "2.0.0", true, 200);

			const apiData = store.exportForApi();
			expect(apiData.skills).toHaveLength(2);
			expect(apiData.summary.totalSkills).toBe(2);
			expect(apiData.summary.totalInvocations).toBe(2);
		});

		it("should persist and reload data", () => {
			store.recordInvocation("persist-skill", "1.0.0", true, 100);
			store.save();

			// Create a new store instance pointing to the same dir
			const store2 = new SkillQualityStore(agentDir);
			expect(store2.get("persist-skill")).toBeDefined();
			expect(store2.get("persist-skill")!.usageStats.invocationCount).toBe(1);
		});

		it("should delete a quality record", () => {
			store.recordInvocation("delete-skill", "1.0.0", true, 100);
			expect(store.get("delete-skill")).toBeDefined();
			store.delete("delete-skill");
			expect(store.get("delete-skill")).toBeUndefined();
		});
	});

	describe("formatSkillQualityTable", () => {
		it("should return message for empty records", () => {
			const result = formatSkillQualityTable([]);
			expect(result).toContain("No skill quality data available");
		});

		it("should format records as a table", () => {
			const records: SkillQualityRecord[] = [
				{
					skillName: "test-skill",
					version: "1.0.0",
					reliabilityScore: 0.85,
					reliabilityRating: "high",
					usageStats: { invocationCount: 10, successCount: 9, failureCount: 1 },
					lastUpdated: new Date().toISOString(),
					verified: true,
				},
			];
			const result = formatSkillQualityTable(records);
			expect(result).toContain("test-skill");
			expect(result).toContain("85%");
			expect(result).toContain("1.0.0");
		});
	});
});
