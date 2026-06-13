import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAccpCapabilityProbe } from "../../src/core/p49_5/accp-capability-probe.js";

// Repo root is 2 levels up from packages/coding-agent
const repoRoot = path.resolve(process.cwd(), "../..");

describe("AccpCapabilityProbe", () => {
	it("runs probe against repo root", async () => {
		const result = await runAccpCapabilityProbe(repoRoot);
		expect(result.schemaVersion).toBe("1.0.0");
		// The route signal compiler should be found
		expect(result.routeSignalAvailable).toBe(true);
		// The gate stage runner should be found
		expect(result.gateVerdictAvailable).toBe(true);
		// The artifact store should be found
		expect(result.artifactWriterAvailable).toBe(true);
	});

	it("reports details for each probe", async () => {
		const result = await runAccpCapabilityProbe(repoRoot);
		expect(result.details.length).toBeGreaterThan(0);
	});

	it("marks raw YAML and Markdown as non-authoritative", async () => {
		const result = await runAccpCapabilityProbe(repoRoot);
		expect(result.rawYamlNotAuthoritative).toBe(true);
		expect(result.markdownNotAuthoritative).toBe(true);
	});
});
