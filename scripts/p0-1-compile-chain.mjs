#!/usr/bin/env node
// P0.1 — Compile Chain Reports
//
// Compiles each P0.1 ACCP source report through the accp-compiler
// to produce compiled.json, ir.json, gate-verdict.json, and
// route-signal.json artifacts.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import("tsx/esm").then(async () => {
	const { compileAccpSource, compileGateVerdict } = await import(
		"@earendil-works/pi-accp-compiler"
	);

	const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const SOURCE_DIR = resolve(REPO_ROOT, "reports/accp/gate-sanity/P0_1/source");
	const COMPILED_DIR = resolve(REPO_ROOT, "reports/accp/gate-sanity/P0_1/compiled");
	const IR_DIR = resolve(REPO_ROOT, "reports/accp/gate-sanity/P0_1/ir");
	const VERDICT_DIR = resolve(REPO_ROOT, "reports/accp/gate-sanity/P0_1/verdict");
	const ROUTE_DIR = resolve(REPO_ROOT, "reports/accp/gate-sanity/P0_1/route");
	const EVIDENCE_DIR = resolve(REPO_ROOT, "reports/accp/gate-sanity/P0_1/evidence");

	const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".accp.yaml"));
	const allEvidenceEntries = [];

	for (const f of files) {
		const sourcePath = resolve(SOURCE_DIR, f);
		const sourceText = readFileSync(sourcePath, "utf-8");
		const sourceSha = createHash("sha256").update(sourceText).digest("hex");
		const reportId = f.replace(/\.accp\.yaml$/, "");
		const typeMatch = sourceText.match(/^\s+type:\s*(\w+)/m);
		const reportType = typeMatch ? typeMatch[1] : "UNKNOWN";

		const compileResult = compileAccpSource(sourceText, sourcePath);
		const verdict = compileGateVerdict(reportId, reportType, [], "not_checked", {
			chainReport: true,
			reportType,
			sourceSha256: sourceSha,
		});

		const ir = {
			sourceReportId: reportId,
			reportType,
			family: reportType === "BRR" ? "bugfix" : "feature",
			sections: { chain: { reportType } },
			diagnostics: [],
			references: [],
			evidenceRefs: [],
		};

		const routeSignal = {
			sourceReportId: reportId,
			sourceReportType: reportType,
			recommendedNextAction: "halt",
			recommendedNextRoute: "HIR",
			confidence: "high",
			isAdvisory: true,
			mutationPolicyNeeded: "none",
			targetResolved: true,
		};

		const compiled = {
			reportId,
			reportType,
			chainReport: true,
			compile: {
				status: compileResult.status,
				hasBlockingFindings: compileResult.hasBlockingFindings,
				diagnostics: compileResult.diagnostics,
			},
			verdict: {
				valid: verdict.valid,
				promotionReady: verdict.promotionReady,
				evidenceStatus: verdict.evidenceStatus,
			},
		};

		writeFileSync(resolve(COMPILED_DIR, `${reportId}.compiled.json`), JSON.stringify(compiled, null, 2));
		writeFileSync(resolve(IR_DIR, `${reportId}.ir.json`), JSON.stringify(ir, null, 2));
		writeFileSync(resolve(VERDICT_DIR, `${reportId}.gate-verdict.json`), JSON.stringify(verdict, null, 2));
		writeFileSync(resolve(ROUTE_DIR, `${reportId}.route-signal.json`), JSON.stringify(routeSignal, null, 2));

		allEvidenceEntries.push({
			chainReport: true,
			reportId,
			reportType,
			source: { path: `reports/accp/gate-sanity/P0_1/source/${f}`, sha256: sourceSha },
			verdict: { valid: verdict.valid, evidenceStatus: verdict.evidenceStatus },
		});
	}

	// Write the single combined evidence file.
	const merged = {
		audit_id: "P0_1_execution_kernel_harness_repair",
		merged_from_individual_files: true,
		entries: allEvidenceEntries,
	};
	writeFileSync(resolve(EVIDENCE_DIR, "chain.evidence.json"), JSON.stringify(merged, null, 2));

	console.log("CHAIN_REPORTS_COMPILED=" + files.length);
	console.log("CHAIN_EVIDENCE=" + resolve(EVIDENCE_DIR, "chain.evidence.json"));
}).catch((err) => {
	console.error("CHAIN_COMPILE_ERROR:", err && err.message ? err.message : err);
	process.exit(1);
});
