#!/usr/bin/env node
// P0.1 — Onefile Evidence Generator
//
// Aggregates all P0.1 evidence into a single canonical JSON file.
// Does NOT re-run any commands — it reads existing artifacts and hashes them.
// The centralized runner (scripts/p0-gate-sanity.mjs) runs this last, after
// all probes and validation commands have completed.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(REPO_ROOT, "reports/accp/gate-sanity/P0_1/evidence/onefile.evidence.json");

function sha256OfFile(path) {
	const abs = resolve(REPO_ROOT, path);
	if (!existsSync(abs)) return { status: "missing", path };
	const content = readFileSync(abs, "utf-8");
	const sha = createHash("sha256").update(content).digest("hex");
	const st = statSync(abs);
	return { status: "ok", path, sha256: sha, size: st.size, content };
}

const writegateResult = sha256OfFile("reports/tmp/gate-sanity/P0_1/writegate/probe-result.json");
const tuiSmoke = sha256OfFile("reports/tmp/gate-sanity/P0_1/tui/smoke-result.json");
const tuiScreen = sha256OfFile("reports/tmp/gate-sanity/P0_1/tui/tui-screen-capture.txt");
const tuiTrace = sha256OfFile("reports/tmp/gate-sanity/P0_1/tui/tui-event-trace.json");
const scorecard = sha256OfFile("reports/accp/gate-sanity/P0/scorecard.json");

const scorecardData = scorecard.status === "ok" ? JSON.parse(scorecard.content) : null;
const controls = scorecardData
	? scorecardData.negative_controls.map((nc) => ({
			id: nc.id,
			blocked: nc.blocked,
			harnessGap: nc.harnessGap,
			promotionReady: nc.verdict.promotionReady,
			valid: nc.verdict.valid,
		}))
	: [];

const writegateData = writegateResult.status === "ok" ? JSON.parse(writegateResult.content) : null;
const tuiSmokeData = tuiSmoke.status === "ok" ? JSON.parse(tuiSmoke.content) : null;

const evidence = {
	audit_id: "P0_1_execution_kernel_harness_repair",
	generated_at: new Date().toISOString(),
	repo: {
		commit: (scorecardData?.repo?.commit ?? "unknown"),
		branch: (scorecardData?.repo?.branch ?? "unknown"),
		dirty: (scorecardData?.repo?.git_status_short ?? "unknown").length > 0 ? "dirty" : "clean",
	},
	write_gate_probe: {
		status: writegateData?.status ?? "not_run",
		real_agent_context_used: writegateData?.real_agent_context_used ?? false,
		attempted_path: writegateData?.attempted_path ?? "unknown",
		blocked_before_file_creation: writegateData?.filesystem?.blocked_before_file_creation ?? false,
		file_exists_after: writegateData?.filesystem?.file_exists_after ?? false,
		policy_reason: writegateData?.policy_reason ?? "unknown",
		evidence_refs: ["reports/tmp/gate-sanity/P0_1/writegate/probe-result.json"],
		sha256: writegateResult.sha256 ?? "unknown",
	},
	tui_smoke: {
		status: tuiSmokeData?.status ?? "not_run",
		live_tui_context_used: tuiSmokeData?.live_tui_context_used ?? false,
		entrypoint: tuiSmokeData?.entrypoint ?? "unknown",
		input_sequence: tuiSmokeData?.input_sequence ?? [],
		captured_artifacts: tuiSmokeData?.captured_artifacts ?? [],
		result_summary: tuiSmokeData?.result_summary ?? "unknown",
		sha256: tuiSmoke.sha256 ?? "unknown",
	},
	p0_rerun: {
		scorecard_path: "reports/accp/gate-sanity/P0/scorecard.json",
		verdict: scorecardData?.kernel_sanity?.verdict ?? "unknown",
		promotion_allowed: scorecardData?.promotion_allowed ?? false,
		all_negative_controls_blocked: scorecardData?.kernel_sanity?.all_negative_controls_blocked ?? false,
		false_positive_failures_count: (scorecardData?.false_positive_failures ?? []).length,
		harness_gap_count: controls.filter((c) => c.harnessGap).length,
		controls,
	},
	hashes: [
		{ path: "scripts/p0-writegate-probe.mjs", sha256: sha256OfFile("scripts/p0-writegate-probe.mjs").sha256 ?? "unknown" },
		{ path: "scripts/p0-tui-smoke.mjs", sha256: sha256OfFile("scripts/p0-tui-smoke.mjs").sha256 ?? "unknown" },
		{ path: "scripts/p0-gate-sanity.mjs", sha256: sha256OfFile("scripts/p0-gate-sanity.mjs").sha256 ?? "unknown" },
		{ path: "scripts/p0-1-compile-chain.mjs", sha256: sha256OfFile("scripts/p0-1-compile-chain.mjs").sha256 ?? "unknown" },
		{ path: "scripts/p0-1-generate-onefile-evidence.mjs", sha256: sha256OfFile("scripts/p0-1-generate-onefile-evidence.mjs").sha256 ?? "unknown" },
		{ path: "reports/tmp/gate-sanity/P0_1/writegate/probe-result.json", sha256: writegateResult.sha256 ?? "unknown" },
		{ path: "reports/tmp/gate-sanity/P0_1/tui/smoke-result.json", sha256: tuiSmoke.sha256 ?? "unknown" },
		{ path: "reports/tmp/gate-sanity/P0_1/tui/tui-screen-capture.txt", sha256: tuiScreen.sha256 ?? "unknown" },
		{ path: "reports/tmp/gate-sanity/P0_1/tui/tui-event-trace.json", sha256: tuiTrace.sha256 ?? "unknown" },
		{ path: "reports/accp/gate-sanity/P0/scorecard.json", sha256: scorecard.sha256 ?? "unknown" },
	],
	artifacts: {
		accp_reports: [
			"reports/accp/gate-sanity/P0_1/source/P0_1_RIR_HARNESS_INVENTORY.accp.yaml",
			"reports/accp/gate-sanity/P0_1/source/P0_1_IPR_HARNESS_REPAIR.accp.yaml",
			"reports/accp/gate-sanity/P0_1/source/P0_1_TVR_VALIDATION.accp.yaml",
			"reports/accp/gate-sanity/P0_1/source/P0_1_ECR_ONEFILE_EVIDENCE.accp.yaml",
			"reports/accp/gate-sanity/P0_1/source/P0_1_PRR_KERNEL_READY.accp.yaml",
		],
		compiled: [
			"reports/accp/gate-sanity/P0_1/compiled/P0_1_RIR_HARNESS_INVENTORY.compiled.json",
			"reports/accp/gate-sanity/P0_1/compiled/P0_1_IPR_HARNESS_REPAIR.compiled.json",
			"reports/accp/gate-sanity/P0_1/compiled/P0_1_TVR_VALIDATION.compiled.json",
			"reports/accp/gate-sanity/P0_1/compiled/P0_1_ECR_ONEFILE_EVIDENCE.compiled.json",
			"reports/accp/gate-sanity/P0_1/compiled/P0_1_PRR_KERNEL_READY.compiled.json",
		],
		gate_verdicts: [
			"reports/accp/gate-sanity/P0_1/verdict/P0_1_RIR_HARNESS_INVENTORY.gate-verdict.json",
			"reports/accp/gate-sanity/P0_1/verdict/P0_1_IPR_HARNESS_REPAIR.gate-verdict.json",
			"reports/accp/gate-sanity/P0_1/verdict/P0_1_TVR_VALIDATION.gate-verdict.json",
			"reports/accp/gate-sanity/P0_1/verdict/P0_1_ECR_ONEFILE_EVIDENCE.gate-verdict.json",
			"reports/accp/gate-sanity/P0_1/verdict/P0_1_PRR_KERNEL_READY.gate-verdict.json",
		],
		route_signals: [
			"reports/accp/gate-sanity/P0_1/route/P0_1_RIR_HARNESS_INVENTORY.route-signal.json",
			"reports/accp/gate-sanity/P0_1/route/P0_1_IPR_HARNESS_REPAIR.route-signal.json",
			"reports/accp/gate-sanity/P0_1/route/P0_1_TVR_VALIDATION.route-signal.json",
			"reports/accp/gate-sanity/P0_1/route/P0_1_ECR_ONEFILE_EVIDENCE.route-signal.json",
			"reports/accp/gate-sanity/P0_1/route/P0_1_PRR_KERNEL_READY.route-signal.json",
		],
		scorecards: ["reports/accp/gate-sanity/P0/scorecard.json"],
	},
};

writeFileSync(OUTPUT, JSON.stringify(evidence, null, 2));
console.log("ONEFILE_EVIDENCE_PATH=" + OUTPUT);
console.log("ONEFILE_EVIDENCE_SHA256=" + sha256OfFile(OUTPUT).sha256);
