import { describe, expect, it } from "vitest";
import { parsePlan } from "../src/core/plan-parser.js";

describe("P31 v4 plan parser", () => {
	it("parses v4 intent contract and derives authoritative profile", () => {
		const plan = [
			"# Part 3",
			"",
			"```json",
			"{",
			'  "contractVersion": "4.0.0",',
			'  "phase": "P31",',
			'  "title": "Intent Test",',
			'  "intent": {',
			'    "parallelism": 6,',
			'    "safetyLevel": "strict",',
			'    "conflictRisk": "high",',
			'    "executionEnvironment": { "mode": "trusted_local" },',
			'    "deadlines": {}',
			"  },",
			'  "workspaces": []',
			"}",
			"```",
		].join("\n");
		const result = parsePlan(plan, { markdownFallback: false });
		expect(result.success).toBe(true);
		expect(result.queue?.intent?.parallelism).toBe(6);
		expect(result.queue?.derivedProfile?.worktreeRequired).toBe(true);
		expect(result.queue?.planExecution?.integrationQueue?.enabled).toBe(true);
	});

	it("normalizes legacy mechanism flags and warns", () => {
		const plan = [
			"# Part 3",
			"",
			"```json",
			"{",
			'  "contractVersion": "2.6.0",',
			'  "phase": "P31",',
			'  "title": "Legacy Test",',
			'  "maxParallelWorkspaces": 3,',
			'  "worktreeRequired": true,',
			'  "integrationQueueRequired": true,',
			'  "workspaces": []',
			"}",
			"```",
		].join("\n");
		const result = parsePlan(plan, { markdownFallback: false });
		expect(result.success).toBe(true);
		expect(result.queue?.intent?.parallelism).toBe(3);
		expect(result.warnings.some((w) => w.includes("deprecated"))).toBe(true);
	});
});
