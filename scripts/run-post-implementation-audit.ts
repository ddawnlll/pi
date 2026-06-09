#!/usr/bin/env tsx
/**
 * Post-Implementation Audit Runner
 *
 * A CLI script that demonstrates the post-implementation auditor by running
 * it against synthetic data or, optionally, reading real audit data from
 * evidence files, worker reports, and write set comparisons.
 *
 * Usage:
 *   npx tsx scripts/run-post-implementation-audit.ts [--verbose]
 *
 * Options:
 *   --verbose   Print detailed finding information
 *   --fail      Simulate a failing audit (for testing)
 *   --warnings  Simulate a pass-with-warnings audit (for testing)
 */

import {
	performPostImplementationAudit,
	formatAuditReport,
} from "../packages/coding-agent/src/core/completion/post-implementation-auditor.js";
import type { EvidenceLedgerEntry } from "../packages/coding-agent/src/core/completion/evidence-types.js";
import type { AcceptanceCriteriaReport } from "../packages/coding-agent/src/core/completion/acceptance-criteria.js";
import type { WorkerReport } from "../packages/coding-agent/src/core/completion/worker-report-contract.js";
import type { WriteSetComparisonResult } from "../packages/coding-agent/src/core/completion/workspace-write-set.js";
import type { WorkspaceCompletionResult } from "../packages/coding-agent/src/core/completion/completion-gate-result.js";
import { WorkspaceStage } from "../packages/coding-agent/src/core/workspace-schema.js";

function parseArgs(): { verbose: boolean; simulateFail: boolean; simulateWarnings: boolean } {
	const args = process.argv.slice(2);
	return {
		verbose: args.includes("--verbose"),
		simulateFail: args.includes("--fail"),
		simulateWarnings: args.includes("--warnings"),
	};
}

function buildEvidenceEntries(): EvidenceLedgerEntry[] {
	return [
		{
			id: "EV-P4407-001",
			type: "test_run",
			description: "Unit tests pass for core module",
			source: "npm test -- --run",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "high",
			content: "All 42 tests passed",
			criterionIds: ["AC-P4407-001"],
			producedBy: "worker-1",
		},
		{
			id: "EV-P4407-002",
			type: "static_analysis",
			description: "TypeScript type check passes",
			source: "npm run check",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "high",
			content: "No type errors found",
			criterionIds: ["AC-P4407-002"],
			producedBy: "worker-1",
		},
		{
			id: "EV-P4407-003",
			type: "build_output",
			description: "Build succeeds",
			source: "npm run build",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "medium",
			content: "Build completed successfully",
			criterionIds: ["AC-P4407-003"],
			producedBy: "worker-1",
		},
	];
}

function buildCriteriaReport(): AcceptanceCriteriaReport {
	return {
		scopeId: "ws-demo-001",
		schemaVersion: "1.0.0",
		total: 3,
		satisfied: 3,
		failed: 0,
		unverified: 0,
		inProgress: 0,
		skipped: 0,
		blocking: 0,
		aggregateStatus: "satisfied",
		complete: true,
		criteria: [
			{
				id: "AC-P4407-001",
				description: "All unit tests pass",
				level: "required",
				category: "functional",
				verificationStatus: "satisfied",
				evidenceRequired: true,
				evidenceIds: ["EV-P4407-001"],
				verifierNotes: "Tests pass",
				verifiedAt: Date.now(),
				verifiedBy: "auditor-script",
				metadata: {},
			},
			{
				id: "AC-P4407-002",
				description: "TypeScript type check passes",
				level: "required",
				category: "quality",
				verificationStatus: "satisfied",
				evidenceRequired: true,
				evidenceIds: ["EV-P4407-002"],
				verifierNotes: "No errors",
				verifiedAt: Date.now(),
				verifiedBy: "auditor-script",
				metadata: {},
			},
			{
				id: "AC-P4407-003",
				description: "Build succeeds",
				level: "required",
				category: "quality",
				verificationStatus: "satisfied",
				evidenceRequired: true,
				evidenceIds: ["EV-P4407-003"],
				verifierNotes: "Build OK",
				verifiedAt: Date.now(),
				verifiedBy: "auditor-script",
				metadata: {},
			},
		],
		traceabilityLinks: [],
	};
}

function buildWorkerReport(): WorkerReport {
	return {
		schemaVersion: "1.0.0",
		reportId: "WR-DEMO-001",
		workerId: "demo-worker",
		workspaceId: "ws-demo-001",
		planId: "plan-demo-001",
		verdict: "pass",
		criteriaStatus: [
			{ id: "AC-P4407-001", description: "All unit tests pass", status: "satisfied", evidenceIds: ["EV-P4407-001"], notes: "All 42 tests passed" },
			{ id: "AC-P4407-002", description: "TypeScript type check passes", status: "satisfied", evidenceIds: ["EV-P4407-002"], notes: "No type errors" },
			{ id: "AC-P4407-003", description: "Build succeeds", status: "satisfied", evidenceIds: ["EV-P4407-003"], notes: "Build successful" },
		],
		mutations: {
			created: ["src/core/new-feature.ts"],
			modified: ["src/core/existing.ts"],
			deleted: [],
			commandsExecuted: ["npm run build", "npm test -- --run"],
			editCount: 12,
		},
		startedAt: Date.now() - 30000,
		completedAt: Date.now(),
		evidenceSummary: {
			total: 3,
			passed: 3,
			failed: 0,
		},
		summary: "Workspace completed successfully",
	};
}

function buildWriteSetComparison(): WriteSetComparisonResult {
	return {
		matched: [
			{ path: "src/core/new-feature.ts", status: "created", size: 2048, declared: true },
			{ path: "src/core/existing.ts", status: "modified", size: 4096, declared: true },
		],
		unexpected: [],
		unused: ["src/legacy/**"],
		covered: true,
		summary: "All 2 changed files are within the declared write set",
	};
}

function buildCompletionResult(): WorkspaceCompletionResult {
	return {
		canComplete: true,
		blockReasons: [],
		recommendedState: WorkspaceStage.Complete,
	};
}

function buildFailingEvidenceEntries(): EvidenceLedgerEntry[] {
	return [
		{
			id: "EV-P4407-001",
			type: "test_run",
			description: "Unit tests pass for core module",
			source: "npm test -- --run",
			timestamp: Date.now(),
			verdict: "fail",
			confidence: "high",
			content: "3 tests failed",
			criterionIds: ["AC-P4407-001"],
			producedBy: "worker-1",
		},
	];
}

function buildFailingWorkerReport(): WorkerReport {
	return {
		schemaVersion: "1.0.0",
		reportId: "WR-DEMO-002",
		workerId: "demo-worker",
		workspaceId: "ws-demo-001",
		planId: "plan-demo-001",
		verdict: "fail",
		criteriaStatus: [
			{ id: "AC-P4407-001", description: "Tests pass", status: "failed", evidenceIds: [], notes: "Tests failed" },
		],
		mutations: {
			created: ["src/core/new-feature.ts"],
			modified: [],
			deleted: [],
			commandsExecuted: [],
			editCount: 3,
		},
		startedAt: Date.now() - 30000,
		completedAt: Date.now(),
		evidenceSummary: {
			total: 1,
			passed: 0,
			failed: 1,
		},
		summary: "Workspace execution failed",
	};
}

function buildFailingWriteSetComparison(): WriteSetComparisonResult {
	return {
		matched: [],
		unexpected: [
			{ path: "rogue-file.ts", status: "created", size: 500, declared: false },
		],
		unused: [],
		covered: false,
		summary: "1 file changed outside declared write set",
	};
}

function buildFailingCompletionResult(): WorkspaceCompletionResult {
	return {
		canComplete: false,
		blockReasons: ["Evidence not satisfied: 1 AC failed"],
		recommendedState: WorkspaceStage.Blocked,
	};
}

function main(): void {
	const { verbose, simulateFail, simulateWarnings } = parseArgs();

	let evidenceEntries: EvidenceLedgerEntry[];
	let criteriaReport: AcceptanceCriteriaReport;
	let workerReport: WorkerReport;
	let writeSetComparison: WriteSetComparisonResult;
	let completionResult: WorkspaceCompletionResult;

	if (simulateFail) {
		console.log("\n=== SIMULATING FAILING AUDIT ===\n");
		evidenceEntries = buildFailingEvidenceEntries();
		criteriaReport = buildCriteriaReport();
		workerReport = buildFailingWorkerReport();
		writeSetComparison = buildFailingWriteSetComparison();
		completionResult = buildFailingCompletionResult();
	} else if (simulateWarnings) {
		console.log("\n=== SIMULATING AUDIT WITH WARNINGS ===\n");
		evidenceEntries = [];
		criteriaReport = buildCriteriaReport();
		workerReport = buildWorkerReport();
		writeSetComparison = buildWriteSetComparison();
		completionResult = buildCompletionResult();
	} else {
		console.log("\n=== RUNNING STANDARD POST-IMPLEMENTATION AUDIT ===\n");
		evidenceEntries = buildEvidenceEntries();
		criteriaReport = buildCriteriaReport();
		workerReport = buildWorkerReport();
		writeSetComparison = buildWriteSetComparison();
		completionResult = buildCompletionResult();
	}

	const report = performPostImplementationAudit(
		evidenceEntries,
		criteriaReport,
		workerReport,
		writeSetComparison,
		completionResult,
		{
			workspaceId: "ws-demo-001",
			planExecId: "plan-exec-demo-001",
			scopeId: "P4407",
		},
	);

	const formatted = formatAuditReport(report);
	console.log(formatted);

	if (verbose) {
		console.log("\nRAW FINDINGS:");
		console.log(JSON.stringify(report.findings, null, 2));
	}

	// Exit with appropriate code
	if (report.verdict === "fail") {
		console.log("\nAudit FAILED. Resolve errors before committing.");
		process.exit(1);
	} else if (report.verdict === "pass_with_warnings") {
		console.log("\nAudit PASSED with warnings. Review warnings before committing.");
		process.exit(0);
	} else {
		console.log("\nAudit PASSED. All checks clear.");
		process.exit(0);
	}
}

main();
