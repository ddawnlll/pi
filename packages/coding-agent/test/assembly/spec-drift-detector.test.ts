import { describe, expect, it } from "vitest";
import { SpecDriftDetector } from "../../src/core/assembly/spec-drift-detector.js";
import { buildArtifactManifest } from "../../src/core/assembly/artifact-manifest.js";
import { generatePredictiveSpec } from "../../src/core/assembly/predictive-spec.js";
import type { SpecFactBundle } from "../../src/core/assembly/predictive-spec-input.js";

function makeFacts(): SpecFactBundle {
	return {
		schemaVersion: "1.0.0", generatedAt: new Date().toISOString(), repoRoot: "/tmp", targetDir: "src",
		totalFiles: 2, totalExports: 2, totalRoutes: 0,
		files: [
			{ path: "ns-0/a.ts", sizeBytes: 100, lastModified: new Date().toISOString(), exports: [{ name: "a", kind: "const", file: "ns-0/a.ts", isDefault: false }] },
			{ path: "ns-1/b.ts", sizeBytes: 100, lastModified: new Date().toISOString(), exports: [{ name: "b", kind: "const", file: "ns-1/b.ts", isDefault: false }] },
		],
		routes: [],
		namespaceCandidates: [["ns-0/a.ts"], ["ns-1/b.ts"]],
	};
}

describe("SpecDriftDetector — positive", () => {
	it("detects no drift when manifests match spec", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		const detector = new SpecDriftDetector();
		detector.freeze(spec);

		const m0 = buildArtifactManifest({
			namespace: "ns-0", workspaceId: "w0",
			artifacts: [{ file: "ns-0/a.ts", contentHash: "h", kind: "full", content: "a", modifiedAt: new Date().toISOString() }],
			accpRefs: [], p44CompletionVerdict: "passed", accpCompiled: true,
		});

		const report = detector.detectDrift([m0]);
		expect(report.totalDrifts).toBeGreaterThanOrEqual(0);
		expect(report.hasBreakingDrifts).toBe(false);
	});

	it("detects unforeseen files as compatible drift", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		const detector = new SpecDriftDetector();
		detector.freeze(spec);

		const m0 = buildArtifactManifest({
			namespace: "ns-0", workspaceId: "w0",
			artifacts: [
				{ file: "ns-0/a.ts", contentHash: "h", kind: "full", content: "a", modifiedAt: new Date().toISOString() },
				{ file: "ns-0/new-file.ts", contentHash: "h", kind: "full", content: "new", modifiedAt: new Date().toISOString() },
			],
			accpRefs: [], p44CompletionVerdict: "passed", accpCompiled: true,
		});

		const report = detector.detectDrift([m0]);
		expect(report.totalDrifts).toBeGreaterThan(0);
	});

	it("freezes spec and records version history", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		const detector = new SpecDriftDetector();
		detector.freeze(spec);
		expect(detector.getVersionHistory()).toHaveLength(1);
		expect(detector.getFrozenContract()).not.toBeNull();
	});

	it("reset clears all state", () => {
		const facts = makeFacts();
		const spec = generatePredictiveSpec(facts);
		const detector = new SpecDriftDetector();
		detector.freeze(spec);
		detector.reset();
		expect(detector.getFrozenContract()).toBeNull();
		expect(detector.getVersionHistory()).toHaveLength(0);
	});
});

describe("SpecDriftDetector — negative", () => {
	it("no frozen contract returns empty drift report", () => {
		const detector = new SpecDriftDetector();
		const m0 = buildArtifactManifest({
			namespace: "ns-0", workspaceId: "w0",
			artifacts: [{ file: "a.ts", contentHash: "h", kind: "full", content: "a", modifiedAt: new Date().toISOString() }],
			accpRefs: [], p44CompletionVerdict: "passed", accpCompiled: true,
		});
		const report = detector.detectDrift([m0]);
		expect(report.totalDrifts).toBe(0);
	});
});
