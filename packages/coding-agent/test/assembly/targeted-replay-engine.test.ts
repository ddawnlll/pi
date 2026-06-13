import { describe, expect, it } from "vitest";
import { buildArtifactManifest } from "../../src/core/assembly/artifact-manifest.js";
import type { DriftReport } from "../../src/core/assembly/spec-drift-detector.js";
import { TargetedReplayEngine } from "../../src/core/assembly/targeted-replay-engine.js";

function emptyDriftReport(): DriftReport {
	return {
		totalDrifts: 0,
		bySeverity: { none: [], compatible: [], breaking: [] },
		hasBreakingDrifts: false,
		specVersionChanged: false,
	};
}

function breakingDriftReport(): DriftReport {
	return {
		totalDrifts: 1,
		bySeverity: {
			none: [],
			compatible: [],
			breaking: [
				{
					contract: "a.ts",
					severity: "breaking",
					predicted: "matched",
					actual: "breaking",
					description: "broke",
					previouslyDetected: false,
				},
			],
		},
		hasBreakingDrifts: true,
		specVersionChanged: false,
	};
}

describe("TargetedReplayEngine — positive", () => {
	it("builds replay plan from drift report", () => {
		const engine = new TargetedReplayEngine();
		const manifests = [
			buildArtifactManifest({
				namespace: "ns-0",
				workspaceId: "w0",
				artifacts: [
					{ file: "a.ts", contentHash: "h", kind: "full", content: "a", modifiedAt: new Date().toISOString() },
				],
				accpRefs: [],
				p44CompletionVerdict: "passed",
				accpCompiled: true,
			}),
		];
		const plan = engine.buildReplayPlan(breakingDriftReport(), manifests);
		expect(plan.targets.length).toBeGreaterThan(0);
	});

	it("empty drift report yields no replay targets", () => {
		const engine = new TargetedReplayEngine();
		const plan = engine.buildReplayPlan(emptyDriftReport(), []);
		expect(plan.targets).toHaveLength(0);
	});

	it("allows replay within limits", () => {
		const engine = new TargetedReplayEngine();
		expect(engine.canReplay("ns-0").allowed).toBe(true);
	});

	it("records replays and tracks counts", () => {
		const engine = new TargetedReplayEngine();
		engine.recordReplay("ns-0");
		expect(engine.getStats().totalReplays).toBe(1);
		expect(engine.getStats().perNamespace.get("ns-0")).toBe(1);
	});

	it("resets cascade depth", () => {
		const engine = new TargetedReplayEngine();
		engine.recordReplay("ns-0");
		engine.recordReplay("ns-0");
		engine.resetCascadeDepth();
		expect(engine.getStats().cascadeDepth).toBe(0);
	});
});

describe("TargetedReplayEngine — negative", () => {
	it("blocks replay when per-namespace limit exceeded", () => {
		const engine = new TargetedReplayEngine({ maxReplaysPerNamespace: 2 });
		engine.recordReplay("ns-0");
		engine.recordReplay("ns-0");
		expect(engine.canReplay("ns-0").allowed).toBe(false);
	});

	it("blocks replay when total limit exceeded", () => {
		const engine = new TargetedReplayEngine({ maxTotalReplays: 2 });
		engine.recordReplay("ns-0");
		engine.recordReplay("ns-1");
		expect(engine.canReplay("ns-2").allowed).toBe(false);
	});

	it("blocks replay when cascade depth exceeded", () => {
		const engine = new TargetedReplayEngine({ maxCascadeDepth: 2 });
		engine.recordReplay("ns-0");
		engine.recordReplay("ns-1");
		expect(engine.canReplay("ns-1").allowed).toBe(false);
	});

	it("reset clears all replay state", () => {
		const engine = new TargetedReplayEngine();
		engine.recordReplay("ns-0");
		engine.reset();
		expect(engine.getStats().totalReplays).toBe(0);
	});
});
