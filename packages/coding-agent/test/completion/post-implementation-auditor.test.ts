/**
 * Unit tests for Post-Implementation Auditor (P44.07).
 *
 * These tests cover the core types, audit functions, and the full
 * performPostImplementationAudit pipeline.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { AcceptanceCriteriaReport } from "../../src/core/completion/acceptance-criteria.js";
import type { WorkspaceCompletionResult } from "../../src/core/completion/completion-gate-result.js";
import type { EvidenceLedgerEntry } from "../../src/core/completion/evidence-types.js";
import type {
	AuditFinding,
	PostImplementationAuditReport,
} from "../../src/core/completion/post-implementation-auditor.js";
import {
	auditCompletionGate,
	auditEvidence,
	auditWorkerReport,
	auditWriteSet,
	buildAuditSummary,
	buildRecommendations,
	createSeverityCounts,
	formatAuditReport,
	generateFindingId,
	incrementSeverityCount,
	POST_IMPLEMENTATION_AUDIT_SCHEMA_VERSION,
	performPostImplementationAudit,
	resetFindingSequence,
} from "../../src/core/completion/post-implementation-auditor.js";
import type { WorkerReport } from "../../src/core/completion/worker-report-contract.js";
import type { WriteSetComparisonResult } from "../../src/core/completion/workspace-write-set.js";
import { WorkspaceStage } from "../../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidenceEntry(overrides?: Partial<EvidenceLedgerEntry>): EvidenceLedgerEntry {
	return {
		id: "EV-TEST-001",
		type: "test_run",
		description: "Test evidence entry",
		source: "test",
		timestamp: Date.now(),
		verdict: "pass",
		confidence: "high",
		content: "test output",
		criterionIds: ["AC-TEST-001"],
		...overrides,
	};
}

function makeCriteriaReport(overrides?: Partial<AcceptanceCriteriaReport>): AcceptanceCriteriaReport {
	return {
		scopeId: "ws-test",
		schemaVersion: "1.0.0",
		total: 2,
		satisfied: 2,
		failed: 0,
		unverified: 0,
		inProgress: 0,
		skipped: 0,
		blocking: 0,
		aggregateStatus: "satisfied",
		complete: true,
		criteria: [
			{
				id: "AC-TEST-001",
				description: "Test criterion 1",
				level: "required",
				category: "functional",
				verificationStatus: "satisfied",
				evidenceRequired: true,
				evidenceIds: [],
				verifierNotes: "",
				verifiedAt: Date.now(),
				verifiedBy: "test",
				metadata: {},
			},
			{
				id: "AC-TEST-002",
				description: "Test criterion 2",
				level: "required",
				category: "functional",
				verificationStatus: "satisfied",
				evidenceRequired: true,
				evidenceIds: [],
				verifierNotes: "",
				verifiedAt: Date.now(),
				verifiedBy: "test",
				metadata: {},
			},
		],
		traceabilityLinks: [],
		...overrides,
	};
}

function makeWorkerReport(overrides?: Partial<WorkerReport>): WorkerReport {
	return {
		schemaVersion: "1.0.0",
		reportId: "WR-TEST-001",
		workerId: "test-worker",
		workspaceId: "ws-test",
		planId: "plan-test",
		verdict: "pass",
		criteriaStatus: [
			{ id: "AC-TEST-001", description: "", status: "satisfied", evidenceIds: [], notes: "All good" },
			{ id: "AC-TEST-002", description: "", status: "satisfied", evidenceIds: [], notes: "All good" },
		],
		mutations: {
			created: ["src/new-file.ts"],
			modified: ["src/existing-file.ts"],
			deleted: [],
			commandsExecuted: ["npm run build"],
			editCount: 5,
		},
		startedAt: Date.now() - 5000,
		completedAt: Date.now(),
		evidenceSummary: {
			total: 2,
			passed: 2,
			failed: 0,
		},
		summary: "Workspace completed successfully",
		...overrides,
	};
}

function makeWriteSetComparison(overrides?: Partial<WriteSetComparisonResult>): WriteSetComparisonResult {
	return {
		matched: [{ path: "src/new-file.ts", status: "created", size: 100, declared: true }],
		unexpected: [],
		unused: [],
		covered: true,
		summary: "All changes are within the declared write set",
		...overrides,
	};
}

function makeCompletionResult(overrides?: Partial<WorkspaceCompletionResult>): WorkspaceCompletionResult {
	return {
		canComplete: true,
		blockReasons: [],
		recommendedState: WorkspaceStage.Complete,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Schema Constants
// ---------------------------------------------------------------------------

describe("Schema Constants", () => {
	it("should export schema version constant", () => {
		expect(POST_IMPLEMENTATION_AUDIT_SCHEMA_VERSION).toBe("1.0.0");
	});
});

// ---------------------------------------------------------------------------
// Finding ID Generation
// ---------------------------------------------------------------------------

describe("generateFindingId", () => {
	beforeEach(() => {
		resetFindingSequence();
	});

	it("should generate IDs with AF prefix and zero-padded sequence", () => {
		expect(generateFindingId("P4407")).toBe("AF-P4407-001");
		expect(generateFindingId("P4407")).toBe("AF-P4407-002");
		expect(generateFindingId("P4407")).toBe("AF-P4407-003");
	});

	it("should normalize non-alphanumeric characters", () => {
		resetFindingSequence();
		expect(generateFindingId("P44.07")).toBe("AF-P4407-001");
	});

	it("should uppercase the prefix", () => {
		resetFindingSequence();
		expect(generateFindingId("p44.07")).toBe("AF-P4407-001");
	});

	it("should handle sequence reset between calls", () => {
		resetFindingSequence();
		expect(generateFindingId("P4407")).toBe("AF-P4407-001");
		expect(generateFindingId("TEST")).toBe("AF-TEST-002");
	});
});

// ---------------------------------------------------------------------------
// Severity Counting
// ---------------------------------------------------------------------------

describe("createSeverityCounts", () => {
	it("should create zero-initialized counts", () => {
		const counts = createSeverityCounts();
		expect(counts).toEqual({ error: 0, warning: 0, info: 0 });
	});
});

describe("incrementSeverityCount", () => {
	it("should increment the specified severity", () => {
		const counts = createSeverityCounts();
		incrementSeverityCount(counts, "error");
		expect(counts.error).toBe(1);
		expect(counts.warning).toBe(0);
		expect(counts.info).toBe(0);
	});

	it("should handle multiple increments", () => {
		const counts = createSeverityCounts();
		incrementSeverityCount(counts, "warning");
		incrementSeverityCount(counts, "warning");
		expect(counts.warning).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// auditEvidence
// ---------------------------------------------------------------------------

describe("auditEvidence", () => {
	beforeEach(() => {
		resetFindingSequence();
	});

	it("should return no findings for perfect evidence", () => {
		const entries = [
			makeEvidenceEntry({ id: "EV-TEST-001", criterionIds: ["AC-TEST-001"] }),
			makeEvidenceEntry({ id: "EV-TEST-002", criterionIds: ["AC-TEST-002"] }),
		];
		const report = makeCriteriaReport();
		const result = auditEvidence(entries, report, undefined, "P4407");
		expect(result.findings).toHaveLength(0);
		expect(result.summary.totalEvidence).toBe(2);
		expect(result.summary.passRate).toBe(1);
	});

	it("should find warning when pass rate is below threshold", () => {
		const entries = [
			makeEvidenceEntry({ id: "EV-TEST-001", verdict: "pass", criterionIds: ["AC-TEST-001"] }),
			makeEvidenceEntry({ id: "EV-TEST-002", verdict: "pass", criterionIds: ["AC-TEST-002"] }),
			makeEvidenceEntry({ id: "EV-TEST-003", verdict: "fail", criterionIds: ["AC-TEST-001"] }),
			makeEvidenceEntry({ id: "EV-TEST-004", verdict: "fail", criterionIds: ["AC-TEST-002"] }),
		];
		const report = makeCriteriaReport();
		const result = auditEvidence(entries, report, { minPassRate: 0.8 }, "P4407");
		const passRateFindings = result.findings.filter((f) => f.message.includes("pass rate"));
		expect(passRateFindings.length).toBeGreaterThan(0);
	});

	it("should find error for failed evidence", () => {
		const entries = [makeEvidenceEntry({ id: "EV-TEST-001", verdict: "fail", criterionIds: ["AC-TEST-001"] })];
		const report = makeCriteriaReport();
		const result = auditEvidence(entries, report, undefined, "P4407");
		const failedFindings = result.findings.filter((f) => f.message.includes("fail"));
		expect(failedFindings.length).toBeGreaterThan(0);
		expect(failedFindings[0].severity).toBe("error");
		expect(failedFindings[0].blocking).toBe(true);
	});

	it("should find warning for criteria without evidence", () => {
		const entries = [makeEvidenceEntry({ id: "EV-TEST-001", criterionIds: ["AC-TEST-001"] })];
		const report = makeCriteriaReport();
		const result = auditEvidence(entries, report, undefined, "P4407");
		const noEvidenceFindings = result.findings.filter((f) => f.message.includes("no evidence"));
		expect(noEvidenceFindings.length).toBeGreaterThan(0);
		expect(noEvidenceFindings[0].severity).toBe("warning");
	});

	it("should find info for low confidence evidence", () => {
		const entries = [
			makeEvidenceEntry({ id: "EV-TEST-001", confidence: "low", criterionIds: ["AC-TEST-001"] }),
			makeEvidenceEntry({ id: "EV-TEST-002", confidence: "unknown", criterionIds: ["AC-TEST-002"] }),
		];
		const report = makeCriteriaReport();
		const result = auditEvidence(entries, report, undefined, "P4407");
		const lowConfFindings = result.findings.filter((f) => f.message.includes("low or unknown confidence"));
		expect(lowConfFindings.length).toBeGreaterThan(0);
		expect(lowConfFindings[0].severity).toBe("info");
	});
});

// ---------------------------------------------------------------------------
// auditWorkerReport
// ---------------------------------------------------------------------------

describe("auditWorkerReport", () => {
	beforeEach(() => {
		resetFindingSequence();
	});

	it("should return no findings for a successful worker report", () => {
		const report = makeWorkerReport();
		const result = auditWorkerReport(report, undefined, "P4407");
		expect(result.findings).toHaveLength(0);
		expect(result.summary.reportPresent).toBe(true);
		expect(result.summary.reportSuccessful).toBe(true);
	});

	it("should find error for missing worker report", () => {
		const result = auditWorkerReport(null, undefined, "P4407");
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0].severity).toBe("error");
		expect(result.findings[0].blocking).toBe(true);
		expect(result.findings[0].message).toContain("missing");
	});

	it("should not error on missing report when not required", () => {
		const result = auditWorkerReport(null, { requireWorkerReport: false }, "P4407");
		expect(result.findings).toHaveLength(0);
	});

	it("should find error for failed worker report", () => {
		const report = makeWorkerReport({ verdict: "fail" });
		const result = auditWorkerReport(report, undefined, "P4407");
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0].severity).toBe("error");
		expect(result.findings[0].blocking).toBe(true);
		expect(result.findings[0].message).toContain("fail");
	});

	it("should not error on failed report when not required to be successful", () => {
		const report = makeWorkerReport({ verdict: "fail" });
		const result = auditWorkerReport(report, { requireSuccessfulVerdict: false }, "P4407");
		expect(result.findings).toHaveLength(0);
	});

	it("should report criteria and mutation counts", () => {
		const report = makeWorkerReport({
			criteriaStatus: [
				{ id: "AC-TEST-001", description: "", status: "satisfied", evidenceIds: [], notes: "" },
				{ id: "AC-TEST-002", description: "", status: "satisfied", evidenceIds: [], notes: "" },
				{ id: "AC-TEST-003", description: "", status: "satisfied", evidenceIds: [], notes: "" },
			],
			mutations: {
				created: ["a.ts"],
				modified: ["b.ts"],
				deleted: ["c.ts"],
				commandsExecuted: [],
				editCount: 3,
			},
		});
		const result = auditWorkerReport(report, undefined, "P4407");
		expect(result.summary.criteriaCount).toBe(3);
		expect(result.summary.mutationCount).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// auditWriteSet
// ---------------------------------------------------------------------------

describe("auditWriteSet", () => {
	beforeEach(() => {
		resetFindingSequence();
	});

	it("should return no findings for a fully covered write set", () => {
		const comparison = makeWriteSetComparison();
		const result = auditWriteSet(comparison, undefined, "P4407");
		expect(result.findings).toHaveLength(0);
		expect(result.summary.fullyCovered).toBe(true);
	});

	it("should find warning for missing write set comparison", () => {
		const result = auditWriteSet(null, undefined, "P4407");
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0].severity).toBe("warning");
		expect(result.findings[0].message).toContain("missing");
	});

	it("should find error for unexpected files", () => {
		const comparison = makeWriteSetComparison({
			unexpected: [{ path: "unexpected.ts", status: "created", size: 100, declared: false }],
			covered: false,
			summary: "1 file changed outside declared write set",
		});
		const result = auditWriteSet(comparison, undefined, "P4407");
		const unexpectedFindings = result.findings.filter((f) => f.message.includes("outside"));
		expect(unexpectedFindings.length).toBeGreaterThan(0);
		expect(unexpectedFindings[0].severity).toBe("error");
		expect(unexpectedFindings[0].blocking).toBe(true);
	});

	it("should find info for unused patterns", () => {
		const comparison = makeWriteSetComparison({
			unused: [{ path: "src/legacy/*.ts", status: "unchanged", size: 0, declared: true }],
		});
		const result = auditWriteSet(comparison, undefined, "P4407");
		const unusedFindings = result.findings.filter((f) => f.message.includes("had no file changes"));
		expect(unusedFindings.length).toBeGreaterThan(0);
		expect(unusedFindings[0].severity).toBe("info");
	});
});

// ---------------------------------------------------------------------------
// auditCompletionGate
// ---------------------------------------------------------------------------

describe("auditCompletionGate", () => {
	beforeEach(() => {
		resetFindingSequence();
	});

	it("should return no findings for a passing completion gate", () => {
		const result = auditCompletionGate(makeCompletionResult(), undefined, "P4407");
		expect(result.findings).toHaveLength(0);
		expect(result.summary.passed).toBe(true);
	});

	it("should find error for missing completion result", () => {
		const result = auditCompletionGate(null, undefined, "P4407");
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0].severity).toBe("error");
		expect(result.findings[0].blocking).toBe(true);
		expect(result.findings[0].message).toContain("missing");
	});

	it("should find error for failed completion gate", () => {
		const result = auditCompletionGate(
			makeCompletionResult({ canComplete: false, blockReasons: ["Evidence not satisfied"] }),
			undefined,
			"P4407",
		);
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0].severity).toBe("error");
		expect(result.findings[0].blocking).toBe(true);
		expect(result.findings[0].message).toContain("failed");
	});
});

// ---------------------------------------------------------------------------
// performPostImplementationAudit — Full Pipeline
// ---------------------------------------------------------------------------

describe("performPostImplementationAudit", () => {
	beforeEach(() => {
		resetFindingSequence();
	});

	it("should produce a passing audit for clean inputs", () => {
		const entries = [
			makeEvidenceEntry({ id: "EV-TEST-001", criterionIds: ["AC-TEST-001"] }),
			makeEvidenceEntry({ id: "EV-TEST-002", criterionIds: ["AC-TEST-002"] }),
		];
		const criteriaReport = makeCriteriaReport();
		const workerReport = makeWorkerReport();
		const writeSetComparison = makeWriteSetComparison();
		const completionResult = makeCompletionResult();

		const report = performPostImplementationAudit(
			entries,
			criteriaReport,
			workerReport,
			writeSetComparison,
			completionResult,
			{ workspaceId: "ws-test", scopeId: "P4407" },
		);

		expect(report.schemaVersion).toBe("1.0.0");
		expect(report.workspaceId).toBe("ws-test");
		expect(report.verdict).toBe("pass");
		expect(report.findings).toHaveLength(0);
		expect(report.severityCounts.error).toBe(0);
		expect(report.severityCounts.warning).toBe(0);
		expect(report.severityCounts.info).toBe(0);
	});

	it("should produce a failing audit when errors exist", () => {
		const entries: EvidenceLedgerEntry[] = [];
		const criteriaReport = makeCriteriaReport();
		const workerReport = makeWorkerReport({ verdict: "fail" });
		const writeSetComparison = makeWriteSetComparison({
			unexpected: [{ path: "rogue.ts", status: "created", size: 100, declared: false }],
			covered: false,
			summary: "1 unexpected file",
		});
		const completionResult = makeCompletionResult({ canComplete: false, blockReasons: ["Blocked"] });

		const report = performPostImplementationAudit(
			entries,
			criteriaReport,
			workerReport,
			writeSetComparison,
			completionResult,
			{ workspaceId: "ws-test", scopeId: "P4407" },
		);

		expect(report.verdict).toBe("fail");
		expect(report.severityCounts.error).toBeGreaterThanOrEqual(1);
		expect(report.findings.some((f) => f.severity === "error")).toBe(true);
	});

	it("should produce a pass_with_warnings audit when only warnings exist", () => {
		const entries: EvidenceLedgerEntry[] = [];
		const criteriaReport = makeCriteriaReport();
		const workerReport = makeWorkerReport();
		const writeSetComparison = makeWriteSetComparison();
		const completionResult = makeCompletionResult();

		const report = performPostImplementationAudit(
			entries,
			criteriaReport,
			workerReport,
			writeSetComparison,
			completionResult,
			{ workspaceId: "ws-test", scopeId: "P4407" },
		);

		expect(report.verdict).toBe("pass_with_warnings");
		expect(report.severityCounts.warning).toBeGreaterThanOrEqual(1);
		expect(report.severityCounts.error).toBe(0);
	});

	it("should include evidence summary in the report", () => {
		const entries = [makeEvidenceEntry({ id: "EV-TEST-001", criterionIds: ["AC-TEST-001"] })];
		const criteriaReport = makeCriteriaReport();
		const workerReport = makeWorkerReport();
		const writeSetComparison = makeWriteSetComparison();
		const completionResult = makeCompletionResult();

		const report = performPostImplementationAudit(
			entries,
			criteriaReport,
			workerReport,
			writeSetComparison,
			completionResult,
			{ workspaceId: "ws-test", scopeId: "P4407" },
		);

		expect(report.evidenceSummary).toBeDefined();
		expect(report.evidenceSummary!.totalEvidence).toBe(1);
		expect(report.evidenceSummary!.passRate).toBe(1);
	});

	it("should include worker report summary in the report", () => {
		const entries: EvidenceLedgerEntry[] = [];
		const criteriaReport = makeCriteriaReport();
		const workerReport = makeWorkerReport();
		const writeSetComparison = makeWriteSetComparison();
		const completionResult = makeCompletionResult();

		const report = performPostImplementationAudit(
			entries,
			criteriaReport,
			workerReport,
			writeSetComparison,
			completionResult,
			{ workspaceId: "ws-test", scopeId: "P4407" },
		);

		expect(report.workerReportSummary).toBeDefined();
		expect(report.workerReportSummary!.reportPresent).toBe(true);
		expect(report.workerReportSummary!.reportSuccessful).toBe(true);
	});

	it("should include write set summary in the report", () => {
		const entries: EvidenceLedgerEntry[] = [];
		const criteriaReport = makeCriteriaReport();
		const workerReport = makeWorkerReport();
		const writeSetComparison = makeWriteSetComparison();
		const completionResult = makeCompletionResult();

		const report = performPostImplementationAudit(
			entries,
			criteriaReport,
			workerReport,
			writeSetComparison,
			completionResult,
			{ workspaceId: "ws-test", scopeId: "P4407" },
		);

		expect(report.writeSetSummary).toBeDefined();
		expect(report.writeSetSummary!.fullyCovered).toBe(true);
	});

	it("should include completion gate summary in the report", () => {
		const entries: EvidenceLedgerEntry[] = [];
		const criteriaReport = makeCriteriaReport();
		const workerReport = makeWorkerReport();
		const writeSetComparison = makeWriteSetComparison();
		const completionResult = makeCompletionResult();

		const report = performPostImplementationAudit(
			entries,
			criteriaReport,
			workerReport,
			writeSetComparison,
			completionResult,
			{ workspaceId: "ws-test", scopeId: "P4407" },
		);

		expect(report.completionGateSummary).toBeDefined();
		expect(report.completionGateSummary!.evaluated).toBe(true);
		expect(report.completionGateSummary!.passed).toBe(true);
	});

	it("should handle null/undefined optional parameters", () => {
		const entries: EvidenceLedgerEntry[] = [];
		const criteriaReport = makeCriteriaReport();

		const report = performPostImplementationAudit(entries, criteriaReport, null, null, null, {
			workspaceId: "ws-test",
			scopeId: "P4407",
		});

		expect(report.verdict).toBe("fail");
		expect(report.severityCounts.error).toBeGreaterThanOrEqual(1);
		expect(report.workerReportSummary!.reportPresent).toBe(false);
		expect(report.writeSetSummary).toBeDefined();
		expect(report.completionGateSummary!.evaluated).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// buildRecommendations
// ---------------------------------------------------------------------------

describe("buildRecommendations", () => {
	it("should recommend resolving errors when errors exist", () => {
		const findings: AuditFinding[] = [
			{
				id: "AF-TEST-001",
				severity: "error",
				category: "evidence",
				message: "Evidence failed",
				detail: "Detail",
				blocking: true,
			},
		];
		const recs = buildRecommendations(findings);
		expect(recs.some((r) => r.includes("error"))).toBe(true);
	});

	it("should recommend addressing blocking findings", () => {
		const findings: AuditFinding[] = [
			{
				id: "AF-TEST-001",
				severity: "warning",
				category: "evidence",
				message: "Warning but blocking",
				detail: "",
				blocking: true,
			},
		];
		const recs = buildRecommendations(findings);
		expect(recs.some((r) => r.includes("blocking"))).toBe(true);
	});

	it("should recommend reviewing warnings", () => {
		const findings: AuditFinding[] = [
			{
				id: "AF-TEST-001",
				severity: "warning",
				category: "evidence",
				message: "Warning",
				detail: "",
				blocking: false,
			},
		];
		const recs = buildRecommendations(findings);
		expect(recs.some((r) => r.includes("warning"))).toBe(true);
	});

	it("should suggest proceeding when no findings", () => {
		const recs = buildRecommendations([]);
		expect(recs.some((r) => r.includes("No issues found"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// buildAuditSummary
// ---------------------------------------------------------------------------

describe("buildAuditSummary", () => {
	it("should indicate pass when no findings", () => {
		const summary = buildAuditSummary("pass", [], { error: 0, warning: 0, info: 0 }, { workspaceId: "ws-test" });
		expect(summary).toContain("PASS");
		expect(summary).toContain("No issues found");
	});

	it("should include finding counts", () => {
		const findings: AuditFinding[] = [
			{
				id: "AF-TEST-001",
				severity: "error",
				category: "evidence",
				message: "Test",
				detail: "",
				blocking: true,
			},
		];
		const summary = buildAuditSummary(
			"fail",
			findings,
			{ error: 1, warning: 0, info: 0 },
			{ workspaceId: "ws-test" },
		);
		expect(summary).toContain("FAIL");
		expect(summary).toContain("Errors:");
	});
});

// ---------------------------------------------------------------------------
// formatAuditReport
// ---------------------------------------------------------------------------

describe("formatAuditReport", () => {
	it("should format a complete audit report", () => {
		const report: PostImplementationAuditReport = {
			schemaVersion: "1.0.0",
			timestamp: 1000000,
			workspaceId: "ws-test",
			planExecId: "plan-001",
			verdict: "pass",
			findings: [
				{
					id: "AF-TEST-001",
					severity: "info",
					category: "evidence",
					message: "Info finding",
					detail: "Detail text",
					blocking: false,
				},
			],
			severityCounts: { error: 0, warning: 0, info: 1 },
			evidenceSummary: {
				totalEvidence: 3,
				byVerdict: { pass: 2, fail: 1 },
				byConfidence: { high: 3 },
				passRate: 0.667,
				criteriaWithoutEvidence: 0,
				totalCriteria: 2,
			},
			workerReportSummary: {
				reportPresent: true,
				reportSuccessful: true,
				workerVerdict: "pass",
				criteriaCount: 2,
				mutationCount: 3,
			},
			writeSetSummary: {
				matchedFiles: 2,
				unexpectedFiles: 0,
				unusedPatterns: 1,
				fullyCovered: true,
			},
			completionGateSummary: {
				evaluated: true,
				passed: true,
				blockReasons: [],
			},
			summary: "Audit passed",
			recommendations: ["No issues found. Proceed with commit."],
		};

		const formatted = formatAuditReport(report);
		expect(formatted).toContain("POST-IMPLEMENTATION AUDIT REPORT");
		expect(formatted).toContain("PASS");
		expect(formatted).toContain("EVIDENCE SUMMARY");
		expect(formatted).toContain("WORKER REPORT SUMMARY");
		expect(formatted).toContain("WRITE SET SUMMARY");
		expect(formatted).toContain("COMPLETION GATE SUMMARY");
		expect(formatted).toContain("RECOMMENDATIONS");
	});

	it("should handle empty findings", () => {
		const report: PostImplementationAuditReport = {
			schemaVersion: "1.0.0",
			timestamp: 1000000,
			workspaceId: "ws-test",
			verdict: "pass",
			findings: [],
			severityCounts: { error: 0, warning: 0, info: 0 },
			summary: "All good",
			recommendations: [],
		};

		const formatted = formatAuditReport(report);
		expect(formatted).toContain("No findings");
	});

	it("should handle partial summaries", () => {
		const report: PostImplementationAuditReport = {
			schemaVersion: "1.0.0",
			timestamp: 1000000,
			workspaceId: "ws-test",
			verdict: "pass",
			findings: [],
			severityCounts: { error: 0, warning: 0, info: 0 },
			summary: "Good",
			recommendations: [],
		};

		const formatted = formatAuditReport(report);
		expect(formatted).toBeTruthy();
		expect(formatted).toContain("PASS");
	});
});
