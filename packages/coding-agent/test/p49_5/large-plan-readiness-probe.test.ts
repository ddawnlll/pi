import path from "node:path";
import { describe, expect, it } from "vitest";
import { runLargePlanReadinessProbe } from "../../src/core/p49_5/large-plan-readiness-probe.js";

// Repo root is 2 levels up from packages/coding-agent
const repoRoot = path.resolve(process.cwd(), "../..");

describe("LargePlanReadinessProbe", () => {
	it("runs probe against repo root", async () => {
		const result = await runLargePlanReadinessProbe(repoRoot, 10);
		expect(result.schemaVersion).toBe("1.0.0");
		expect(["large_plan_guarded_allowed", "large_plan_fixture_only", "large_plan_blocked"]).toContain(result.verdict);
	});

	it("produces all profiles", async () => {
		const result = await runLargePlanReadinessProbe(repoRoot, 10);
		expect(result.profiles.accpCompilerThroughput).toBeDefined();
		expect(result.profiles.artifactStoreCapacity).toBeDefined();
		expect(result.profiles.eventJournalBackpressure).toBeDefined();
		expect(result.profiles.dashboardVisibility).toBeDefined();
		expect(result.profiles.routeGraphSize).toBeDefined();
	});
});
