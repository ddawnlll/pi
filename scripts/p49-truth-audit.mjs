#!/usr/bin/env node
// P49.31 FIX-010: P49 truth audit rerun.
//
// Re-runs the strict runtime verification (npm run p49:strict-runtime-verification)
// and produces the P49 truth audit scorecard. The audit enforces evidence
// caps per FIX-008 and only counts a runtime wiring requirement as
// `implemented_with_live_or_runtime_evidence` when the strict harness
// reports PASS for the corresponding gate.
//
// Exit code 0 only when:
//   - all strict gates pass
//   - runtime_verified_percent >= 60
//   - critical_blockers == 0

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = resolve(REPO_ROOT, "reports/accp/P49_31_strict_runtime_wiring_repair");
const EVIDENCE_DIR = resolve(OUTPUT_DIR, "evidence");
mkdirSync(EVIDENCE_DIR, { recursive: true });

// 1) Run the strict harness
let strictSummary = null;
try {
	execSync("node scripts/p49-strict-runtime-verification.mjs", {
		cwd: REPO_ROOT,
		stdio: "inherit",
		timeout: 600_000,
	});
} catch (e) {
	// strict harness failed; fall through and produce a HOLD scorecard.
	process.stderr.write(`strict runtime verification failed (exit=${e.status ?? 1})\n`);
}

const strictPath = resolve(EVIDENCE_DIR, "strict-runtime-verification.json");
if (existsSync(strictPath)) {
	strictSummary = JSON.parse(readFileSync(strictPath, "utf-8"));
}

// 2) Compute the truth audit scorecard with evidence caps applied.
const GATE_TO_REQUIREMENT = {
	"GATE-001": "P49.31-R001-AccpGateInStageOrder",
	"GATE-002": "P49.31-R002-RunAccpGateStageRegistered",
	"GATE-003": "P49.31-R003-PlanCompletionPredicateAccpAware",
	"GATE-004": "P49.31-R004-WorkerAdapterAccpAndEvidence",
	"GATE-005": "P49.31-R005-TuiTabOpensAccpPicker",
	"GATE-006": "P49.31-R006-InitialRouteAndEnvelopeEmitted",
	"GATE-007": "P49.31-R007-FilePickerReassigned",
	"GATE-008": "P49.31-R008-RouteBusProductionInstantiated",
	"GATE-009": "P49.31-R009-ArtifactStoreProductionReaderWriter",
	"GATE-010": "P49.31-R010-EvidenceEngineCapRules",
	"GATE-011": "P49.31-R011-PlanSpecOwnershipAmended",
	"GATE-012": "P49.31-R012-P0RemainsPass",
	"GATE-013": "P49.31-R013-BuildCheckPass",
	"GATE-014": "P49.31-R014-TruthAuditRerun",
};

const EVIDENCE_CAP = {
	source: 0.25,
	unit_test: 0.5,
	integration_test: 0.75,
	runtime_live: 1.0,
};

const requirements = [];
let weightedGranted = 0;
let totalWeight = 0;
let criticalBlockers = 0;
let runtimeVerifiedPercent = 0;

if (strictSummary) {
	for (const g of strictSummary.gates) {
		const weight = 10;
		const requested = 1.0;
		// FIX-008 cap rules: all P49.31 requirements are runtime-affecting,
		// so static evidence (source-only) is capped at 0.5. The strict
		// harness IS the runtime/live evidence; passing a gate is the
		// runtime_call_site/live_tui confirmation.
		const evidenceClass = g.ok ? "runtime_live" : "source";
		const cap = EVIDENCE_CAP[evidenceClass];
		const granted = g.ok ? Math.min(requested, cap) : 0;
		const status = g.ok ? "implemented_with_live_or_runtime_evidence" : "source_present_unwired";
		if (!g.ok) criticalBlockers += 1;
		requirements.push({
			id: GATE_TO_REQUIREMENT[g.id] ?? g.id,
			title: g.message,
			weight,
			evidenceClass,
			cap,
			granted,
			weightedScore: granted * weight,
			status,
		});
		weightedGranted += granted * weight;
		totalWeight += weight;
	}
	runtimeVerifiedPercent = totalWeight > 0 ? (weightedGranted / totalWeight) * 100 : 0;
}

const overallVerdict = criticalBlockers === 0 && runtimeVerifiedPercent >= 60 ? "PASS" : "FAIL";

const scorecard = {
	audit_id: "P49_31_TRUTH_AUDIT_RERUN",
	generated_at: new Date().toISOString(),
	repo: strictSummary?.repo,
	strict_runtime_verification: strictSummary
		? {
				overall_verdict: strictSummary.overall_verdict,
				passed: strictSummary.passed,
				failed: strictSummary.failed,
				total_gates: strictSummary.total_gates,
			}
		: null,
	requirements,
	runtime_verified_percent: Number(runtimeVerifiedPercent.toFixed(2)),
	weighted_percent: Number(runtimeVerifiedPercent.toFixed(2)),
	critical_blockers: criticalBlockers,
	promotion_allowed: false,
	p50_start_allowed: false,
	overall_verdict: overallVerdict,
};

const scorecardPath = resolve(OUTPUT_DIR, "scorecard.json");
writeFileSync(scorecardPath, JSON.stringify(scorecard, null, 2));
process.stdout.write(`\nP49.31 truth audit rerun: ${overallVerdict}\n`);
process.stdout.write(`  runtime_verified_percent: ${scorecard.runtime_verified_percent}\n`);
process.stdout.write(`  critical_blockers: ${scorecard.critical_blockers}\n`);

if (overallVerdict !== "PASS") process.exit(1);
process.exit(0);
