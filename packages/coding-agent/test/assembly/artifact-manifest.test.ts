import { describe, expect, it } from "vitest";
import { buildAccpRefIndex, validateAccpRefCoverage } from "../../src/core/assembly/accp-artifact-refs.js";
import {
	type AccpArtifactRef,
	buildArtifactManifest,
	hasRequiredAccpRefs,
	validateArtifactManifest,
	verifyManifestIntegrity,
	type WorkerArtifact,
} from "../../src/core/assembly/artifact-manifest.js";

// =============================================================================
// Helpers
// =============================================================================

function makeArtifact(file: string): WorkerArtifact {
	return {
		file,
		contentHash: `hash-${file}`,
		kind: "full",
		content: `content of ${file}`,
		modifiedAt: new Date().toISOString(),
	};
}

function makeAccpRef(overrides?: Partial<AccpArtifactRef>): AccpArtifactRef {
	return {
		reportId: `ipr-ns-1`,
		reportType: "IPR",
		compiledPath: `reports/accp/P45/compiled/ipr-ns-1.compiled.json`,
		compiledHash: `hash-ipr-ns-1`,
		gateVerdict: "passed",
		compiled: true,
		...overrides,
	};
}

// =============================================================================
// Artifact Manifest Tests
// =============================================================================

describe("ArtifactManifest — positive path", () => {
	it("builds valid manifest with required fields", () => {
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [makeArtifact("a.ts")],
		});
		expect(manifest.namespace).toBe("ns-0");
		expect(manifest.artifacts).toHaveLength(1);
		expect(manifest.manifestHash).toBeTruthy();
	});

	it("builds manifest with ACCP refs", () => {
		const accpRef = makeAccpRef();
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [makeArtifact("a.ts")],
			accpRefs: [accpRef],
		});
		expect(manifest.accpRefs).toHaveLength(1);
	});

	it("valid manifest passes validation", () => {
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [makeArtifact("a.ts")],
			accpRefs: [makeAccpRef(), { ...makeAccpRef(), reportId: "tvr-ns-1", reportType: "TVR" }],
			p44CompletionVerdict: "passed",
			accpCompiled: true,
		});
		const result = validateArtifactManifest(manifest);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("manifest hash verifies correctly", () => {
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [makeArtifact("a.ts")],
		});
		expect(verifyManifestIntegrity(manifest)).toBe(true);
	});

	it("hasRequiredAccpRefs checks IPR and TVR", () => {
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [makeArtifact("a.ts")],
			accpRefs: [makeAccpRef({ reportType: "IPR" }), { ...makeAccpRef(), reportId: "tvr-1", reportType: "TVR" }],
		});
		expect(hasRequiredAccpRefs(manifest)).toBe(true);
	});
});

// =============================================================================
// Negative Path Tests
// =============================================================================

describe("ArtifactManifest — negative path", () => {
	it("empty artifacts fail validation", () => {
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [],
		});
		const result = validateArtifactManifest(manifest);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("no artifacts") || e.includes("No artifacts"))).toBe(true);
	});

	it("P44 failed blocks acceptance", () => {
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [makeArtifact("a.ts")],
			p44CompletionVerdict: "failed",
		});
		const result = validateArtifactManifest(manifest);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("P44"))).toBe(true);
	});

	it("uncompiled ACCP ref produces warning", () => {
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [makeArtifact("a.ts")],
			accpRefs: [makeAccpRef({ compiled: false, compiledHash: "some-hash" })],
			p44CompletionVerdict: "passed",
			accpCompiled: true,
		});
		const result = validateArtifactManifest(manifest);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	it("missing compiledHash on ACCP ref is error", () => {
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [makeArtifact("a.ts")],
			accpRefs: [makeAccpRef({ compiledHash: "" })],
			p44CompletionVerdict: "passed",
			accpCompiled: true,
		});
		const result = validateArtifactManifest(manifest);
		expect(result.errors.some((e) => e.includes("compiledHash"))).toBe(true);
	});

	it("tampered manifest hash fails verification", () => {
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [makeArtifact("a.ts")],
		});
		manifest.manifestHash = "tampered";
		expect(verifyManifestIntegrity(manifest)).toBe(false);
	});

	it("missing required IPR ref detected", () => {
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [makeArtifact("a.ts")],
			accpRefs: [{ ...makeAccpRef(), reportType: "TVR" }],
		});
		expect(hasRequiredAccpRefs(manifest)).toBe(false);
	});

	it("artifact with empty content hash errors", () => {
		const manifest = buildArtifactManifest({
			namespace: "ns-0",
			workspaceId: "ws-1",
			artifacts: [
				{ file: "a.ts", contentHash: "", kind: "full", content: "x", modifiedAt: new Date().toISOString() },
			],
			p44CompletionVerdict: "passed",
			accpCompiled: true,
		});
		const result = validateArtifactManifest(manifest);
		expect(result.errors.some((e) => e.includes("contentHash"))).toBe(true);
	});
});

// =============================================================================
// ACCP Artifact Refs Tests
// =============================================================================

describe("AccpArtifactRefs", () => {
	it("builds index from refs", () => {
		const refs: AccpArtifactRef[] = [
			makeAccpRef(),
			{ ...makeAccpRef(), reportId: "tvr-1", reportType: "TVR" as const },
		];
		const index = buildAccpRefIndex(refs);
		expect(index.byId.size).toBe(2);
		expect(index.byType.get("IPR")).toHaveLength(1);
		expect(index.byType.get("TVR")).toHaveLength(1);
	});

	it("tracks compiled counts", () => {
		const refs: AccpArtifactRef[] = [
			makeAccpRef({ compiled: true }),
			{ ...makeAccpRef(), reportId: "r2", compiled: false, compiledHash: "h", reportType: "IPR" as const },
		];
		const index = buildAccpRefIndex(refs);
		expect(index.compiledCount).toBe(1);
		expect(index.uncompiledCount).toBe(1);
	});

	it("validates ref coverage for required types", () => {
		const refs = [makeAccpRef({ reportType: "IPR" })];
		const result = validateAccpRefCoverage(refs, ["IPR", "TVR"]);
		expect(result.covered).toBe(false);
		expect(result.missing).toContain("TVR");
	});

	it("validates uncompiled refs", () => {
		const refs: AccpArtifactRef[] = [
			makeAccpRef({ reportType: "IPR" as const, compiled: false, compiledHash: "h" }),
			{ ...makeAccpRef(), reportId: "tvr-1", reportType: "TVR" as const },
		];
		const result = validateAccpRefCoverage(refs);
		expect(result.uncompiled).toHaveLength(1);
	});
});
