import { existsSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { parsePlan } from "../../src/core/plan-parser.js";
import { admitExecution } from "../../src/execution-kernel/admission-gate.js";

// Find the plan file relative to the repo root
const POSSIBLE_PATHS = [
	"../../docs/p25-local-observability-brain-worker-swarm-plan-v4.md",
	"../docs/p25-local-observability-brain-worker-swarm-plan-v4.md",
	"/home/erfolg/src/pi/docs/p25-local-observability-brain-worker-swarm-plan-v4.md",
];
const V4_PLAN_PATH = POSSIBLE_PATHS.find((p) => existsSync(p)) ?? POSSIBLE_PATHS[0];

describe("v4 template parser", () => {
	const content = readFileSync(V4_PLAN_PATH, "utf-8");
	const result = parsePlan(content);

	it("parses the v4 plan successfully", () => {
		expect(result.success).toBe(true);
	});

	it("recognizes contractVersion 4.0.0", () => {
		expect(result.queue?.contractVersion).toBe("4.0.0");
	});

	it("has 21 workspaces", () => {
		expect(result.queue?.workspaces?.length).toBe(21);
	});

	it("has intent", () => {
		expect(result.queue?.intent).toBeDefined();
		expect(result.queue?.intent?.parallelism).toBe(6);
	});

	it("has derived profile", () => {
		expect(result.queue?.derivedProfile).toBeDefined();
	});

	it("derived profile indicates worktree required for parallelism 6", () => {
		expect(result.queue?.derivedProfile?.worktreeRequired).toBe(true);
	});

	it("derived profile indicates integration queue required", () => {
		expect(result.queue?.derivedProfile?.integrationQueueRequired).toBe(true);
	});

	it("has no errors", () => {
		expect(result.errors).toEqual([]);
	});
});

describe("v3 template still parses", () => {
	it("detects contractVersion from a v3-style plan", () => {
		const v3Content = `# Phase P25 — Test Plan

# Part 3 — Machine-Readable Execution Contract

\`\`\`json
{
  "contractVersion": "3.0.0",
  "executionClass": "repair",
  "workspaces": [
    { "id": "7.A", "title": "Test Workspace" }
  ]
}
\`\`\``;
		const result = parsePlan(v3Content, { validate: false });
		expect(result.success).toBe(true);
		expect(result.queue?.contractVersion).toBe("3.0.0");
		expect(result.queue?.workspaces?.length).toBe(1);
	});
});

describe("v4 derived profile for parallelism 6 strict/high", () => {
	it("produces worktree, integration, validation lanes", () => {
		const content6StrictHigh = `# Phase — Test

# Part 3 — Machine-Readable Execution Contract

\`\`\`json
{
  "contractVersion": "4.0.0",
  "intent": {
    "parallelism": 6,
    "safetyLevel": "strict",
    "conflictRisk": "high",
    "executionEnvironment": { "mode": "local_sandbox" },
    "deadlines": {}
  },
  "workspaces": [
    { "id": "7.A", "title": "Test", "dependencies": [] }
  ]
}
\`\`\``;
		const result = parsePlan(content6StrictHigh, { validate: false });
		expect(result.success).toBe(true);
		const derived = result.queue?.derivedProfile;
		expect(derived?.worktreeRequired).toBe(true);
		expect(derived?.integrationQueueRequired).toBe(true);
		expect(derived?.validationLaneRequired).toBe(true);
	});
});

describe("JSON runtime fallback rejection", () => {
	it("admission gate rejects JSON fallback in production", () => {
		const decision = admitExecution({
			postgresAvailable: true,
			production: true,
			jsonFallback: true,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(decision).toBe("reject");
	});

	it("admission gate allows without JSON fallback in non-repair mode", () => {
		const decision = admitExecution({
			postgresAvailable: true,
			production: true,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(decision).toBe("allow");
	});

	it("admission gate rejects when postgres unavailable", () => {
		const decision = admitExecution({
			postgresAvailable: false,
			production: true,
			jsonFallback: false,
			repairMode: false,
			autonomousMode: false,
			promotionGateSatisfied: true,
		});
		expect(decision).toBe("reject");
	});
});
