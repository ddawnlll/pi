import { describe, expect, it } from "vitest";
import { batchAcceptManifests, evaluateArtifactAcceptance } from "../../src/core/assembly/artifact-acceptance-gate.js";
import { buildArtifactManifest } from "../../src/core/assembly/artifact-manifest.js";

function makeManifest(params: Partial<Parameters<typeof buildArtifactManifest>[0]> = {}) {
	return buildArtifactManifest({
		namespace: "ns-0",
		workspaceId: "ws-1",
		artifacts: [
			{ file: "a.ts", contentHash: "h1", kind: "full", content: "x", modifiedAt: new Date().toISOString() },
		],
		accpRefs: [
			{
				reportId: "ipr-1",
				reportType: "IPR",
				compiledPath: "p.json",
				compiledHash: "h",
				gateVerdict: "passed",
				compiled: true,
			},
			{
				reportId: "tvr-1",
				reportType: "TVR",
				compiledPath: "p.json",
				compiledHash: "h",
				gateVerdict: "passed",
				compiled: true,
			},
		],
		p44CompletionVerdict: "passed",
		accpCompiled: true,
		...params,
	});
}

describe("ArtifactAcceptanceGate — positive", () => {
	it("accepts fully valid manifest", () => {
		const manifest = makeManifest();
		const result = evaluateArtifactAcceptance(manifest);
		expect(result.decision).toBe("accepted");
		expect(result.accepted).toBe(true);
	});

	it("batch accepts multiple valid manifests", () => {
		const m1 = makeManifest({ namespace: "ns-0" });
		const m2 = makeManifest({ namespace: "ns-1" });
		const { accepted, rejected } = batchAcceptManifests([m1, m2]);
		expect(accepted).toHaveLength(2);
		expect(rejected).toHaveLength(0);
	});
});

describe("ArtifactAcceptanceGate — negative", () => {
	it("rejects manifest with P44 failed", () => {
		const manifest = makeManifest({ p44CompletionVerdict: "failed" });
		const result = evaluateArtifactAcceptance(manifest);
		expect(result.decision).toBe("rejected");
		expect(result.accepted).toBe(false);
	});

	it("holds manifest with no ACCP compile", () => {
		const manifest = makeManifest({ accpCompiled: false });
		const result = evaluateArtifactAcceptance(manifest);
		expect(result.decision).toBe("held");
		expect(result.accepted).toBe(false);
	});

	it("rejects manifest with blocked ACCP gate verdict", () => {
		const manifest = makeManifest({
			accpRefs: [
				{
					reportId: "ipr-1",
					reportType: "IPR",
					compiledPath: "p",
					compiledHash: "h",
					gateVerdict: "blocked",
					compiled: true,
				},
			],
		});
		const result = evaluateArtifactAcceptance(manifest);
		expect(result.decision).toBe("rejected");
	});

	it("batch reports rejected manifests with reasons", () => {
		const valid = makeManifest({ namespace: "ns-0" });
		const invalid = makeManifest({ namespace: "ns-1", p44CompletionVerdict: "failed" });
		const { accepted, rejected } = batchAcceptManifests([valid, invalid]);
		expect(accepted).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0].reasons.length).toBeGreaterThan(0);
	});

	it("checks include P44, ACCP, and Manifest checks", () => {
		const manifest = makeManifest();
		const result = evaluateArtifactAcceptance(manifest);
		expect(result.checks.map((c) => c.name)).toContain("P44 Completion Gate");
		expect(result.checks.map((c) => c.name)).toContain("ACCP Compile + Gate Verdict");
		expect(result.checks.map((c) => c.name)).toContain("Manifest Validity");
	});
});
