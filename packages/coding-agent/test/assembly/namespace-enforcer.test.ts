import { describe, expect, it } from "vitest";
import { createNamespaceEnforcer, enforceManifestNamespace, validateWorkerManifest } from "../../src/core/assembly/namespace-enforcer.js";
import { buildArtifactManifest } from "../../src/core/assembly/artifact-manifest.js";
import { buildOwnershipManifest } from "../../src/core/assembly/ownership-manifest.js";

function makeManifest(ns: string, files: string[]) {
	return buildArtifactManifest({
		namespace: ns, workspaceId: "w1",
		artifacts: files.map((f) => ({ file: f, contentHash: "h", kind: "full" as const, content: "x", modifiedAt: new Date().toISOString() })),
		accpRefs: [], p44CompletionVerdict: "passed", accpCompiled: true,
	});
}

describe("NamespaceEnforcer", () => {
	it("worker can edit own namespace files", () => {
		const manifest = buildOwnershipManifest(
			[{ namespace: "ns-0", files: ["a.ts"], contracts: [] }],
			[],
			[],
		);
		const enforcer = createNamespaceEnforcer(manifest);
		const result = enforcer.canEdit("a.ts", "ns-0");
		expect(result.allowed).toBe(true);
	});

	it("worker cannot edit another namespace's files", () => {
		const manifest = buildOwnershipManifest(
			[{ namespace: "ns-0", files: ["a.ts"], contracts: [] }],
			[],
			[],
		);
		const enforcer = createNamespaceEnforcer(manifest);
		const result = enforcer.canEdit("a.ts", "ns-1");
		expect(result.allowed).toBe(false);
	});

	it("enforceManifestNamespace validates all artifacts", () => {
		const manifest = buildOwnershipManifest(
			[{ namespace: "ns-0", files: ["a.ts"], contracts: [] }],
			[],
			[],
		);
		const enforcer = createNamespaceEnforcer(manifest);
		const m = makeManifest("ns-0", ["a.ts"]);
		const result = enforceManifestNamespace(m, enforcer);
		expect(result.valid).toBe(true);
	});

	it("enforceManifestNamespace catches cross-namespace edits", () => {
		const manifest = buildOwnershipManifest(
			[{ namespace: "ns-0", files: ["a.ts"], contracts: [] }],
			[],
			[],
		);
		const enforcer = createNamespaceEnforcer(manifest);
		const m = makeManifest("ns-1", ["a.ts"]);
		const result = enforceManifestNamespace(m, enforcer);
		expect(result.valid).toBe(false);
		expect(result.violations.length).toBe(1);
	});

	it("validateWorkerManifest catches assembler-only file edits", () => {
		const manifest = buildOwnershipManifest(
			[{ namespace: "ns-0", files: ["a.ts", "assembler.ts"], contracts: [] }],
			[],
			["assembler.ts"],
		);
		const m = buildArtifactManifest({
			namespace: "ns-0", workspaceId: "w1",
			artifacts: [{ file: "assembler.ts", contentHash: "h", kind: "full", content: "x", modifiedAt: new Date().toISOString() }],
			accpRefs: [], p44CompletionVerdict: "passed", accpCompiled: true,
		});
		const result = validateWorkerManifest(m, manifest);
		expect(result.valid).toBe(false);
	});
});
