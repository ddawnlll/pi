import { describe, expect, it } from "vitest";
import { DeterministicAssembler } from "../../src/core/assembly/deterministic-assembler.js";
import { buildArtifactManifest } from "../../src/core/assembly/artifact-manifest.js";

function makeManifest(ns: string, ws: string, files: string[]) {
	return buildArtifactManifest({
		namespace: ns,
		workspaceId: ws,
		artifacts: files.map((f) => ({
			file: f,
			contentHash: `hash-${f}`,
			kind: "full" as const,
			content: `content of ${f} from ${ns}`,
			modifiedAt: new Date().toISOString(),
		})),
		accpRefs: [],
		p44CompletionVerdict: "passed",
		accpCompiled: true,
	});
}

describe("DeterministicAssembler — positive", () => {
	it("assembles single manifest", () => {
		const assembler = new DeterministicAssembler();
		const manifest = makeManifest("ns-0", "ws-0", ["a.ts", "b.ts"]);
		const result = assembler.assemble([manifest]);
		expect(result.success).toBe(true);
		expect(result.files.size).toBe(2);
		expect(result.files.get("a.ts")).toBe("content of a.ts from ns-0");
	});

	it("assembles two non-overlapping manifests", () => {
		const assembler = new DeterministicAssembler();
		const m1 = makeManifest("ns-0", "ws-0", ["a.ts"]);
		const m2 = makeManifest("ns-1", "ws-1", ["b.ts"]);
		const result = assembler.assemble([m1, m2]);
		expect(result.success).toBe(true);
		expect(result.files.size).toBe(2);
	});

	it("is deterministic — same input, same output hash", () => {
		const assembler = new DeterministicAssembler();
		const m1 = makeManifest("ns-0", "ws-0", ["a.ts"]);
		const r1 = assembler.assemble([m1]);
		const r2 = assembler.assemble([m1]);
		expect(r1.outputHash).toBe(r2.outputHash);
	});

	it("is idempotent", () => {
		const assembler = new DeterministicAssembler();
		const m1 = makeManifest("ns-0", "ws-0", ["a.ts"]);
		const result = assembler.verifyIdempotency([m1]);
		expect(result.idempotent).toBe(true);
		expect(result.hash1).toBe(result.hash2);
	});

	it("produces journal entries", () => {
		const assembler = new DeterministicAssembler();
		const m1 = makeManifest("ns-0", "ws-0", ["a.ts", "b.ts"]);
		const result = assembler.assemble([m1]);
		expect(result.journal.length).toBeGreaterThanOrEqual(2);
	});

	it("journal has increasing sequence numbers", () => {
		const assembler = new DeterministicAssembler();
		const m1 = makeManifest("ns-0", "ws-0", ["a.ts"]);
		const m2 = makeManifest("ns-1", "ws-1", ["b.ts"]);
		assembler.assemble([m1]);
		assembler.assemble([m2]);
		const journal = assembler.getJournal();
		const seqs = journal.map((j) => j.sequence);
		for (let i = 1; i < seqs.length; i++) {
			expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
		}
	});
});

describe("DeterministicAssembler — negative", () => {
	it("detects namespace write overlap", () => {
		const assembler = new DeterministicAssembler();
		const m1 = makeManifest("ns-0", "ws-0", ["shared.ts"]);
		const m2 = makeManifest("ns-1", "ws-1", ["shared.ts"]);
		const result = assembler.assemble([m1, m2]);
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.includes("overlap"))).toBe(true);
	});

	it("reset clears journal", () => {
		const assembler = new DeterministicAssembler();
		const m1 = makeManifest("ns-0", "ws-0", ["a.ts"]);
		assembler.assemble([m1]);
		assembler.reset();
		expect(assembler.getJournal()).toHaveLength(0);
	});

	it("deterministic sort order: manifests sorted by namespace then id", () => {
		const assembler = new DeterministicAssembler();
		const mB = buildArtifactManifest({
			namespace: "ns-b",
			workspaceId: "w1",
			artifacts: [{ file: "b.ts", contentHash: "h", kind: "full", content: "b", modifiedAt: new Date().toISOString() }],
			accpRefs: [], p44CompletionVerdict: "passed", accpCompiled: true,
		});
		const mA = buildArtifactManifest({
			namespace: "ns-a",
			workspaceId: "w1",
			artifacts: [{ file: "a.ts", contentHash: "h", kind: "full", content: "a", modifiedAt: new Date().toISOString() }],
			accpRefs: [], p44CompletionVerdict: "passed", accpCompiled: true,
		});
		// Input in reverse order, assembler should sort ns-a before ns-b
		const result = assembler.assemble([mB, mA]);
		expect(result.success).toBe(true);
		const journal = result.journal;
		expect(journal[0].namespace).toBe("ns-a");
	});
});
