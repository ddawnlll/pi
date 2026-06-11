/**
 * P45.11 — Minimal Two-Namespace ACCP-Native Async Assembly Smoke Harness
 *
 * End-to-end smoke test that exercises:
 * - Two namespaces producing artifact manifests with ACCP refs
 * - Artifact acceptance gate (P44 + ACCP compile + manifest validity)
 * - Deterministic assembler merging namespace outputs
 * - Idempotency verification
 *
 * Run via: npx tsx scripts/run-p45-minimal-async-assembly-smoke.ts --output reports/p45-smoke/minimal.json
 */

import { buildArtifactManifest, type WorkerArtifact, type AccpArtifactRef } from "../core/assembly/artifact-manifest.js";
import { evaluateArtifactAcceptance } from "../core/assembly/artifact-acceptance-gate.js";
import { DeterministicAssembler } from "../core/assembly/deterministic-assembler.js";
import { writeFileSync, mkdirSync } from "node:fs";

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const outputIdx = args.indexOf("--output");
	const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : "reports/p45-smoke/minimal.json";

	const startTime = Date.now();
	const results: string[] = [];

	// Create two namespace manifests
	const ns1Artifact: WorkerArtifact = {
		file: "ns-0/output.ts",
		contentHash: "hash-ns0-output",
		kind: "full",
		content: "export const ns0 = 1;",
		modifiedAt: new Date().toISOString(),
	};

	const ns2Artifact: WorkerArtifact = {
		file: "ns-1/output.ts",
		contentHash: "hash-ns1-output",
		kind: "full",
		content: "export const ns1 = 1;",
		modifiedAt: new Date().toISOString(),
	};

	const accpRef: AccpArtifactRef = {
		reportId: "ipr-smoke",
		reportType: "IPR",
		compiledPath: "reports/accp/P45/compiled/ipr-smoke.compiled.json",
		compiledHash: "smoke-hash",
		gateVerdict: "passed",
		compiled: true,
	};

	const manifest1 = buildArtifactManifest({
		namespace: "ns-0",
		workspaceId: "smoke-ws-0",
		artifacts: [ns1Artifact],
		accpRefs: [accpRef, { ...accpRef, reportId: "tvr-smoke-0", reportType: "TVR" }],
		p44CompletionVerdict: "passed",
		accpCompiled: true,
	});

	const manifest2 = buildArtifactManifest({
		namespace: "ns-1",
		workspaceId: "smoke-ws-1",
		artifacts: [ns2Artifact],
		accpRefs: [{ ...accpRef, reportId: "ipr-smoke-1", reportType: "IPR" }, { ...accpRef, reportId: "tvr-smoke-1", reportType: "TVR" }],
		p44CompletionVerdict: "passed",
		accpCompiled: true,
	});

	// Step 1: Acceptance gate
	const acceptance1 = evaluateArtifactAcceptance(manifest1);
	const acceptance2 = evaluateArtifactAcceptance(manifest2);
	results.push(`ns-0 acceptance: ${acceptance1.decision}`);
	results.push(`ns-1 acceptance: ${acceptance2.decision}`);

	if (!acceptance1.accepted || !acceptance2.accepted) {
		results.push("FAIL: Artifact acceptance gate rejected manifests");
		const report = { success: false, results, errors: [...acceptance1.reasons, ...acceptance2.reasons] };
		writeOutput(outputPath, report);
		process.exit(1);
	}

	// Step 2: Deterministic assembly
	const assembler = new DeterministicAssembler();
	const assembly = assembler.assemble([manifest1, manifest2]);

	if (!assembly.success) {
		results.push("FAIL: Assembly errors: " + assembly.errors.join("; "));
		const report = { success: false, results, errors: assembly.errors };
		writeOutput(outputPath, report);
		process.exit(1);
	}

	results.push(`Assembly: ${assembly.files.size} files produced`);
	results.push(`Journal: ${assembly.journal.length} entries`);

	// Step 3: Idempotency check
	const idemResult = assembler.verifyIdempotency([manifest1, manifest2]);
	results.push(`Idempotent: ${idemResult.idempotent}`);

	if (!idemResult.idempotent) {
		results.push("FAIL: Assembler is not idempotent");
		const report = { success: false, results };
		writeOutput(outputPath, report);
		process.exit(1);
	}

	const elapsed = Date.now() - startTime;
	results.push(`Elapsed: ${elapsed}ms`);

	const report = {
		success: true,
		results,
		assembly: {
			fileCount: assembly.files.size,
			journalLength: assembly.journal.length,
			outputHash: assembly.outputHash,
		},
		elapsedMs: elapsed,
	};

	writeOutput(outputPath, report);
	console.log(`Smoke test PASSED: 2 namespaces, ${assembly.files.size} files assembled`);
}

function writeOutput(path: string, data: unknown): void {
	mkdirSync(path.substring(0, path.lastIndexOf("/")), { recursive: true });
	writeFileSync(path, JSON.stringify(data, null, 2));
}

main().catch((err) => {
	console.error("Smoke test failed:", err);
	process.exit(1);
});
