/**
 * P44.07 — Post-Implementation Auditor
 *
 * Audits a workspace execution after implementation completes. The auditor
 * evaluates evidence coverage, worker report integrity, write set compliance,
 * and completion gate results, producing a structured audit report with
 * categorized findings.
 *
 * This module sits between the completion gate (P44.03) and the workspace
 * commit gate (P44.08), providing a final verification layer before changes
 * are committed.
 *
 * Related:
 * - AcceptanceCriteriaRegistry (P44.01) for criterion evidence tracking
 * - EvidenceLedger (P44.02) for evidence storage and retrieval
 * - WorkerReportContract (P44.06) for worker report validation
 * - WorkspaceWriteSet (P44.08) for write set compliance
 * - WorkspaceCommitGate (P44.08) for commit gate enforcement
 */

import type { AcceptanceCriteriaReport } from "./acceptance-criteria.js";
import type { WorkspaceCompletionResult } from "./completion-gate-result.js";
import type { EvidenceLedgerEntry, EvidenceSummary } from "./evidence-types.js";
import { computeEvidenceSummary } from "./evidence-types.js";
import type { WorkerReport } from "./worker-report-contract.js";
import { isReportSuccessful } from "./worker-report-contract.js";
import type { WriteSetComparisonResult } from "./workspace-write-set.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for post-implementation audit reports.
 */
export const POST_IMPLEMENTATION_AUDIT_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Severity level for an audit finding.
 */
export type AuditFindingSeverity = "error" | "warning" | "info";

/**
 * Category of an audit finding.
 */
export type AuditFindingCategory =
	/** Evidence-related findings (coverage, quality, confidence) */
	| "evidence"
	/** Worker report findings (missing, inconsistent, failed) */
	| "worker_report"
	/** Write set compliance findings (unexpected files, unused patterns) */
	| "write_set"
	/** Completion gate findings (blocking reasons, failed checks) */
	| "completion_gate"
	/** Integrity findings (hash mismatches, tampering) */
	| "integrity"
	/** General audit findings */
	| "general";

/**
 * A single audit finding with severity, category, and actionable message.
 */
export interface AuditFinding {
	/** Unique finding identifier (e.g., "AF-P4407-001") */
	id: string;
	/** Severity level */
	severity: AuditFindingSeverity;
	/** Finding category */
	category: AuditFindingCategory;
	/** Human-readable description of the finding */
	message: string;
	/** Optional detailed explanation or remediation guidance */
	detail?: string;
	/** Optional reference to the specific item that triggered the finding */
	reference?: string;
	/** Whether this finding is blocking (requires action before commit) */
	blocking: boolean;
}

/**
 * Summary of evidence quality and coverage.
 */
export interface AuditEvidenceSummary {
	/** Total evidence entries examined */
	totalEvidence: number;
	/** Evidence entries grouped by verdict */
	byVerdict: Record<string, number>;
	/** Evidence entries grouped by confidence */
	byConfidence: Record<string, number>;
	/** Overall pass rate (pass / total) */
	passRate: number;
	/** Number of criteria that lack any evidence */
	criteriaWithoutEvidence: number;
	/** Total criteria evaluated */
	totalCriteria: number;
}

/**
 * Worker report audit assessment.
 */
export interface AuditWorkerReportSummary {
	/** Whether a worker report was provided */
	reportPresent: boolean;
	/** Whether the worker report indicates success */
	reportSuccessful: boolean;
	/** The worker verdict if available */
	workerVerdict?: string;
	/** Number of criteria the worker reported */
	criteriaCount: number;
	/** Number of mutations the worker reported */
	mutationCount: number;
}

/**
 * Write set audit assessment.
 */
export interface AuditWriteSetSummary {
	/** Number of files that matched declared patterns */
	matchedFiles: number;
	/** Number of files changed outside declared write set */
	unexpectedFiles: number;
	/** Number of declared patterns that had no changes */
	unusedPatterns: number;
	/** Whether all changes are within the declared write set */
	fullyCovered: boolean;
}

/**
 * Completion gate audit assessment.
 */
export interface AuditCompletionGateSummary {
	/** Whether completion was evaluated */
	evaluated: boolean;
	/** Whether completion passed */
	passed: boolean;
	/** Blocking reasons from the completion gate */
	blockReasons: string[];
}

/**
 * Comprehensive report produced by the post-implementation auditor.
 */
export interface PostImplementationAuditReport {
	/** Schema version */
	schemaVersion: string;
	/** When the audit was performed (epoch ms) */
	timestamp: number;
	/** Workspace identifier being audited */
	workspaceId: string;
	/** Plan execution identifier */
	planExecId?: string;
	/** Overall audit verdict */
	verdict: AuditVerdict;
	/** All findings discovered during the audit */
	findings: AuditFinding[];
	/** Count of findings by severity */
	severityCounts: Record<AuditFindingSeverity, number>;
	/** Evidence-specific summary */
	evidenceSummary?: AuditEvidenceSummary;
	/** Worker report-specific summary */
	workerReportSummary?: AuditWorkerReportSummary;
	/** Write set-specific summary */
	writeSetSummary?: AuditWriteSetSummary;
	/** Completion gate-specific summary */
	completionGateSummary?: AuditCompletionGateSummary;
	/** Summary of the audit */
	summary: string;
	/** Recommended actions based on findings */
	recommendations: string[];
}

/**
 * Overall audit verdict.
 */
export type AuditVerdict = "pass" | "pass_with_warnings" | "fail";

// ---------------------------------------------------------------------------
// Audit Finding Sequence
// ---------------------------------------------------------------------------

let _findingSequence = 0;

/**
 * Reset the finding sequence counter (for testing).
 */
export function resetFindingSequence(): void {
	_findingSequence = 0;
}

/**
 * Generate the next audit finding ID.
 *
 * @param scopeId - Scope identifier (e.g., "P4407")
 * @returns Formatted finding ID (e.g., "AF-P4407-001")
 */
export function generateFindingId(scopeId: string): string {
	_findingSequence++;
	const normalized = scopeId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
	return `AF-${normalized}-${String(_findingSequence).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Helper: Severity Counting
// ---------------------------------------------------------------------------

/**
 * Initialize a severity counts map with zero values.
 */
export function createSeverityCounts(): Record<AuditFindingSeverity, number> {
	return { error: 0, warning: 0, info: 0 };
}

/**
 * Increment severity count for a finding.
 *
 * @param counts - Severity counts map (mutated in place)
 * @param severity - Severity to increment
 */
export function incrementSeverityCount(
	counts: Record<AuditFindingSeverity, number>,
	severity: AuditFindingSeverity,
): void {
	counts[severity] = (counts[severity] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Evidence Audit
// ---------------------------------------------------------------------------

/**
 * Options for auditing evidence.
 */
export interface EvidenceAuditOptions {
	/** Minimum evidence confidence required (default: "low") */
	minConfidence?: import("./evidence-types.js").EvidenceConfidence;
	/** Whether each criterion must have at least one evidence entry (default: true) */
	requireEvidencePerCriterion?: boolean;
	/** Minimum acceptable pass rate (0-1). Findings below this trigger warnings (default: 0.8) */
	minPassRate?: number;
}

/**
 * Default evidence audit options.
 */
export const DEFAULT_EVIDENCE_AUDIT_OPTIONS: EvidenceAuditOptions = {
	minConfidence: "low",
	requireEvidencePerCriterion: true,
	minPassRate: 0.8,
};

/**
 * Audit evidence entries for an acceptance criteria report.
 *
 * Checks:
 * - Overall evidence quality (pass rate, confidence)
 * - Criteria without any evidence
 *
 * @param evidenceEntries - All evidence ledger entries
 * @param criteriaReport - Acceptance criteria report
 * @param options - Evidence audit options
 * @param scopeId - Scope identifier for finding IDs
 * @returns Object containing findings and evidence summary
 */
export function auditEvidence(
	evidenceEntries: EvidenceLedgerEntry[],
	criteriaReport: AcceptanceCriteriaReport,
	options?: EvidenceAuditOptions,
	scopeId: string = "P4407",
): { findings: AuditFinding[]; summary: AuditEvidenceSummary } {
	const opts = { ...DEFAULT_EVIDENCE_AUDIT_OPTIONS, ...options };
	const findings: AuditFinding[] = [];
	const summary = computeEvidenceSummary(evidenceEntries) as EvidenceSummary;

	// Track criteria that lack evidence
	const criteriaWithEvidence = new Set<string>();
	for (const entry of evidenceEntries) {
		for (const cid of entry.criterionIds) {
			criteriaWithEvidence.add(cid);
		}
	}

	const criteriaIds = criteriaReport.criteria.map((c) => c.id);
	const criteriaWithoutEvidence = criteriaIds.filter((cid) => !criteriaWithEvidence.has(cid));

	// Check pass rate
	const passRate = summary.passRate;
	if (passRate < opts.minPassRate!) {
		findings.push({
			id: generateFindingId(scopeId),
			severity: "warning",
			category: "evidence",
			message: `Evidence pass rate (${(passRate * 100).toFixed(1)}%) is below minimum threshold (${(opts.minPassRate! * 100).toFixed(1)}%)`,
			detail: `Of ${summary.total} total evidence entries, ${summary.byVerdict.pass ?? 0} passed and ${summary.byVerdict.fail ?? 0} failed. Review failed evidence for corrective action.`,
			blocking: false,
		});
	}

	// Check for failed evidence
	const failedCount = summary.byVerdict.fail ?? 0;
	if (failedCount > 0) {
		findings.push({
			id: generateFindingId(scopeId),
			severity: "error",
			category: "evidence",
			message: `${failedCount} evidence entr${failedCount === 1 ? "y has" : "ies have"} a "fail" verdict`,
			detail: `Failed evidence entries require investigation and resolution before commit.`,
			blocking: true,
		});
	}

	// Check for criteria without evidence
	if (opts.requireEvidencePerCriterion && criteriaWithoutEvidence.length > 0) {
		findings.push({
			id: generateFindingId(scopeId),
			severity: "warning",
			category: "evidence",
			message: `${criteriaWithoutEvidence.length} acceptance cr${criteriaWithoutEvidence.length === 1 ? "iterion has" : "iteria have"} no evidence`,
			detail: `Criteria without evidence: ${criteriaWithoutEvidence.map((id) => id.slice(0, 20)).join(", ")}`,
			reference: criteriaWithoutEvidence.join(", "),
			blocking: false,
		});
	}

	// Check for low confidence evidence
	const lowConfidenceCount = (summary.byConfidence.low ?? 0) + (summary.byConfidence.unknown ?? 0);
	if (lowConfidenceCount > 0 && summary.total > 0) {
		findings.push({
			id: generateFindingId(scopeId),
			severity: "info",
			category: "evidence",
			message: `${lowConfidenceCount} evidence entr${lowConfidenceCount === 1 ? "y has" : "ies have"} low or unknown confidence`,
			detail: `Consider gathering higher-confidence evidence for critical criteria.`,
			blocking: false,
		});
	}

	return {
		findings,
		summary: {
			totalEvidence: summary.total,
			byVerdict: summary.byVerdict,
			byConfidence: summary.byConfidence,
			passRate,
			criteriaWithoutEvidence: criteriaWithoutEvidence.length,
			totalCriteria: criteriaIds.length,
		},
	};
}

// ---------------------------------------------------------------------------
// Worker Report Audit
// ---------------------------------------------------------------------------

/**
 * Options for auditing worker reports.
 */
export interface WorkerReportAuditOptions {
	/** Whether a worker report is required (default: true) */
	requireWorkerReport?: boolean;
	/** Whether the worker report must indicate success (default: true) */
	requireSuccessfulVerdict?: boolean;
}

/**
 * Default worker report audit options.
 */
export const DEFAULT_WORKER_REPORT_AUDIT_OPTIONS: WorkerReportAuditOptions = {
	requireWorkerReport: true,
	requireSuccessfulVerdict: true,
};

/**
 * Audit a worker report for integrity and completeness.
 *
 * Checks:
 * - Worker report presence
 * - Worker report success status
 * - Criteria and mutation counts
 *
 * @param workerReport - Optional worker report
 * @param options - Worker report audit options
 * @param scopeId - Scope identifier for finding IDs
 * @returns Object containing findings and worker report summary
 */
export function auditWorkerReport(
	workerReport: WorkerReport | undefined | null,
	options?: WorkerReportAuditOptions,
	scopeId: string = "P4407",
): { findings: AuditFinding[]; summary: AuditWorkerReportSummary } {
	const opts = { ...DEFAULT_WORKER_REPORT_AUDIT_OPTIONS, ...options };
	const findings: AuditFinding[] = [];

	if (!workerReport) {
		if (opts.requireWorkerReport) {
			findings.push({
				id: generateFindingId(scopeId),
				severity: "error",
				category: "worker_report",
				message: "Worker report is missing",
				detail: "A worker report is required to confirm that the workspace execution completed as expected.",
				blocking: true,
			});
		}

		return {
			findings,
			summary: {
				reportPresent: false,
				reportSuccessful: false,
				criteriaCount: 0,
				mutationCount: 0,
			},
		};
	}

	const reportSuccessful = isReportSuccessful(workerReport);

	if (!reportSuccessful && opts.requireSuccessfulVerdict) {
		findings.push({
			id: generateFindingId(scopeId),
			severity: "error",
			category: "worker_report",
			message: `Worker report indicates failure (verdict: ${workerReport.verdict})`,
			detail: `The worker reported a ${workerReport.verdict} verdict. Resolve the reported issues before committing.`,
			reference: workerReport.verdict,
			blocking: true,
		});
	}

	const criteriaCount = workerReport.criteriaStatus?.length ?? 0;
	const mutationCount = workerReport.mutations
		? workerReport.mutations.created.length +
			workerReport.mutations.modified.length +
			workerReport.mutations.deleted.length
		: 0;

	return {
		findings,
		summary: {
			reportPresent: true,
			reportSuccessful,
			workerVerdict: workerReport.verdict,
			criteriaCount,
			mutationCount,
		},
	};
}

// ---------------------------------------------------------------------------
// Write Set Audit
// ---------------------------------------------------------------------------

/**
 * Options for auditing write set compliance.
 */
export interface WriteSetAuditOptions {
	/** Whether unexpected files are blocking (default: true) */
	blockOnUnexpectedFiles?: boolean;
	/** Maximum number of unexpected files allowed before warning (default: 0) */
	maxUnexpectedFiles?: number;
}

/**
 * Default write set audit options.
 */
export const DEFAULT_WRITE_SET_AUDIT_OPTIONS: WriteSetAuditOptions = {
	blockOnUnexpectedFiles: true,
	maxUnexpectedFiles: 0,
};

/**
 * Audit write set compliance.
 *
 * Checks:
 * - Unexpected files (changed outside declared write set)
 * - Unused declared patterns (declared but no files changed)
 *
 * @param writeSetComparison - Write set comparison result
 * @param options - Write set audit options
 * @param scopeId - Scope identifier for finding IDs
 * @returns Object containing findings and write set summary
 */
export function auditWriteSet(
	writeSetComparison: WriteSetComparisonResult | undefined | null,
	options?: WriteSetAuditOptions,
	scopeId: string = "P4407",
): { findings: AuditFinding[]; summary: AuditWriteSetSummary } {
	const opts = { ...DEFAULT_WRITE_SET_AUDIT_OPTIONS, ...options };
	const findings: AuditFinding[] = [];

	if (!writeSetComparison) {
		findings.push({
			id: generateFindingId(scopeId),
			severity: "warning",
			category: "write_set",
			message: "Write set comparison result is missing",
			detail: "Without a write set comparison, unauthorized file changes cannot be detected.",
			blocking: false,
		});

		return {
			findings,
			summary: {
				matchedFiles: 0,
				unexpectedFiles: 0,
				unusedPatterns: 0,
				fullyCovered: false,
			},
		};
	}

	// Check for unexpected files
	if (writeSetComparison.unexpected.length > (opts.maxUnexpectedFiles ?? 0)) {
		const severity: AuditFindingSeverity = opts.blockOnUnexpectedFiles ? "error" : "warning";
		findings.push({
			id: generateFindingId(scopeId),
			severity,
			category: "write_set",
			message: `${writeSetComparison.unexpected.length} file(s) changed outside the declared write set`,
			detail: `Unexpected files: ${writeSetComparison.unexpected.map((e) => e.path).join(", ")}`,
			reference: writeSetComparison.unexpected.map((e) => e.path).join(", "),
			blocking: opts.blockOnUnexpectedFiles ?? true,
		});
	}

	// Check for unused patterns
	if (writeSetComparison.unused.length > 0) {
		findings.push({
			id: generateFindingId(scopeId),
			severity: "info",
			category: "write_set",
			message: `${writeSetComparison.unused.length} declared pattern(s) had no file changes`,
			detail: `Unused patterns: ${writeSetComparison.unused.map((e) => e.path).join(", ")}`,
			reference: writeSetComparison.unused.map((e) => e.path).join(", "),
			blocking: false,
		});
	}

	return {
		findings,
		summary: {
			matchedFiles: writeSetComparison.matched.length,
			unexpectedFiles: writeSetComparison.unexpected.length,
			unusedPatterns: writeSetComparison.unused.length,
			fullyCovered: writeSetComparison.covered,
		},
	};
}

// ---------------------------------------------------------------------------
// Completion Gate Audit
// ---------------------------------------------------------------------------

/**
 * Options for auditing completion gate results.
 */
export interface CompletionGateAuditOptions {
	/** Whether a completion gate result is required (default: true) */
	requireCompletionResult?: boolean;
	/** Whether the completion gate must have passed (default: true) */
	requirePassed?: boolean;
}

/**
 * Default completion gate audit options.
 */
export const DEFAULT_COMPLETION_GATE_AUDIT_OPTIONS: CompletionGateAuditOptions = {
	requireCompletionResult: true,
	requirePassed: true,
};

/**
 * Audit the completion gate result.
 *
 * Checks:
 * - Completion gate result presence
 * - Completion gate pass/fail status
 * - Blocking reasons
 *
 * @param completionResult - Optional completion gate result
 * @param options - Completion gate audit options
 * @param scopeId - Scope identifier for finding IDs
 * @returns Object containing findings and completion gate summary
 */
export function auditCompletionGate(
	completionResult: WorkspaceCompletionResult | undefined | null,
	options?: CompletionGateAuditOptions,
	scopeId: string = "P4407",
): { findings: AuditFinding[]; summary: AuditCompletionGateSummary } {
	const opts = { ...DEFAULT_COMPLETION_GATE_AUDIT_OPTIONS, ...options };
	const findings: AuditFinding[] = [];

	if (!completionResult) {
		if (opts.requireCompletionResult) {
			findings.push({
				id: generateFindingId(scopeId),
				severity: "error",
				category: "completion_gate",
				message: "Completion gate result is missing",
				detail: "A completion gate result is required to verify that the workspace passed all completion checks.",
				blocking: true,
			});
		}

		return {
			findings,
			summary: {
				evaluated: false,
				passed: false,
				blockReasons: [],
			},
		};
	}

	if (!completionResult.canComplete && opts.requirePassed) {
		findings.push({
			id: generateFindingId(scopeId),
			severity: "error",
			category: "completion_gate",
			message: "Workspace completion gate check failed",
			detail: `Blocking reasons:\n${completionResult.blockReasons.map((r) => `  - ${r}`).join("\n")}`,
			reference: completionResult.blockReasons.join("; "),
			blocking: true,
		});
	}

	return {
		findings,
		summary: {
			evaluated: true,
			passed: completionResult.canComplete,
			blockReasons: completionResult.blockReasons,
		},
	};
}

// ---------------------------------------------------------------------------
// Main Auditor
// ---------------------------------------------------------------------------

/**
 * Options for the full post-implementation audit.
 */
export interface PostImplementationAuditOptions {
	/** Workspace identifier */
	workspaceId: string;
	/** Optional plan execution identifier */
	planExecId?: string;
	/** Scope identifier for finding IDs */
	scopeId?: string;
	/** Evidence audit options */
	evidenceOptions?: EvidenceAuditOptions;
	/** Worker report audit options */
	workerReportOptions?: WorkerReportAuditOptions;
	/** Write set audit options */
	writeSetOptions?: WriteSetAuditOptions;
	/** Completion gate audit options */
	completionGateOptions?: CompletionGateAuditOptions;
}

/**
 * Perform a full post-implementation audit.
 *
 * Evaluates all aspects of a workspace execution:
 * 1. Evidence quality and coverage
 * 2. Worker report integrity
 * 3. Write set compliance
 * 4. Completion gate result
 *
 * @param evidenceEntries - All evidence ledger entries from the execution
 * @param criteriaReport - Acceptance criteria report
 * @param workerReport - Optional worker report
 * @param writeSetComparison - Optional write set comparison result
 * @param completionResult - Optional completion gate result
 * @param options - Audit options
 * @returns Complete audit report
 */
export function performPostImplementationAudit(
	evidenceEntries: EvidenceLedgerEntry[],
	criteriaReport: AcceptanceCriteriaReport,
	workerReport?: WorkerReport | null,
	writeSetComparison?: WriteSetComparisonResult | null,
	completionResult?: WorkspaceCompletionResult | null,
	options?: PostImplementationAuditOptions,
): PostImplementationAuditReport {
	const scopeId = options?.scopeId ?? "P4407";
	resetFindingSequence();

	const allFindings: AuditFinding[] = [];
	const severityCounts = createSeverityCounts();

	// 1. Audit evidence
	const evidenceAudit = auditEvidence(evidenceEntries, criteriaReport, options?.evidenceOptions, scopeId);
	allFindings.push(...evidenceAudit.findings);

	// 2. Audit worker report
	const workerReportAudit = auditWorkerReport(workerReport ?? null, options?.workerReportOptions, scopeId);
	allFindings.push(...workerReportAudit.findings);

	// 3. Audit write set
	const writeSetAudit = auditWriteSet(writeSetComparison ?? null, options?.writeSetOptions, scopeId);
	allFindings.push(...writeSetAudit.findings);

	// 4. Audit completion gate
	const completionGateAudit = auditCompletionGate(completionResult ?? null, options?.completionGateOptions, scopeId);
	allFindings.push(...completionGateAudit.findings);

	// Count severities
	for (const finding of allFindings) {
		incrementSeverityCount(severityCounts, finding.severity);
	}

	// Determine overall verdict
	const hasErrors = severityCounts.error > 0;
	const hasWarnings = severityCounts.warning > 0;
	const verdict: AuditVerdict = hasErrors ? "fail" : hasWarnings ? "pass_with_warnings" : "pass";

	// Build recommendations
	const recommendations = buildRecommendations(allFindings);

	// Build summary
	const summary = buildAuditSummary(verdict, allFindings, severityCounts, {
		workspaceId: options?.workspaceId ?? "unknown",
	});

	return {
		schemaVersion: POST_IMPLEMENTATION_AUDIT_SCHEMA_VERSION,
		timestamp: Date.now(),
		workspaceId: options?.workspaceId ?? "unknown",
		planExecId: options?.planExecId,
		verdict,
		findings: allFindings,
		severityCounts,
		evidenceSummary: evidenceAudit.summary,
		workerReportSummary: workerReportAudit.summary,
		writeSetSummary: writeSetAudit.summary,
		completionGateSummary: completionGateAudit.summary,
		summary,
		recommendations,
	};
}

// ---------------------------------------------------------------------------
// Reporting Helpers
// ---------------------------------------------------------------------------

/**
 * Build recommendations based on audit findings.
 *
 * @param findings - All audit findings
 * @returns Array of recommendation strings
 */
export function buildRecommendations(findings: AuditFinding[]): string[] {
	const recommendations: string[] = [];
	const errorFindings = findings.filter((f) => f.severity === "error");

	if (errorFindings.length > 0) {
		recommendations.push(`Resolve all ${errorFindings.length} error(s) before committing`);
		for (const f of errorFindings) {
			recommendations.push(`  - [${f.category}] ${f.message}`);
		}
	}

	const blockingFindings = findings.filter((f) => f.blocking);
	if (blockingFindings.length > errorFindings.length) {
		recommendations.push(`Address all ${blockingFindings.length} blocking finding(s) before committing`);
	}

	const warningFindings = findings.filter((f) => f.severity === "warning");
	if (warningFindings.length > 0) {
		recommendations.push(`Review ${warningFindings.length} warning(s) and address as needed`);
	}

	if (findings.length === 0) {
		recommendations.push("No issues found. Proceed with commit.");
	}

	return recommendations;
}

/**
 * Build a human-readable summary of the audit.
 *
 * @param verdict - Overall audit verdict
 * @param findings - All audit findings
 * @param severityCounts - Counts by severity
 * @param config - Summary configuration
 * @returns Summary string
 */
export function buildAuditSummary(
	verdict: AuditVerdict,
	findings: AuditFinding[],
	severityCounts: Record<AuditFindingSeverity, number>,
	config: { workspaceId: string },
): string {
	const totalFindings = findings.length;
	const parts: string[] = [];

	parts.push(`Post-implementation audit for workspace "${config.workspaceId}": ${verdict.toUpperCase()}`);

	if (totalFindings === 0) {
		parts.push("No issues found. All checks passed.");
		return parts.join("\n");
	}

	parts.push(`Total findings: ${totalFindings}`);
	parts.push(`  Errors:   ${severityCounts.error}`);
	parts.push(`  Warnings: ${severityCounts.warning}`);
	parts.push(`  Info:     ${severityCounts.info}`);

	const blockingCount = findings.filter((f) => f.blocking).length;
	if (blockingCount > 0) {
		parts.push(`  Blocking: ${blockingCount}`);
	}

	return parts.join("\n");
}

/**
 * Format an audit report as a human-readable string.
 *
 * @param report - The audit report to format
 * @returns Formatted string
 */
export function formatAuditReport(report: PostImplementationAuditReport): string {
	const lines: string[] = [];

	lines.push("=".repeat(60));
	lines.push("POST-IMPLEMENTATION AUDIT REPORT");
	lines.push("=".repeat(60));
	lines.push("");
	lines.push(`Schema Version: ${report.schemaVersion}`);
	lines.push(`Timestamp:      ${new Date(report.timestamp).toISOString()}`);
	lines.push(`Workspace:      ${report.workspaceId}`);
	if (report.planExecId) {
		lines.push(`Plan Exec:     ${report.planExecId}`);
	}
	lines.push(`Verdict:        ${report.verdict.toUpperCase()}`);
	lines.push("");
	lines.push("-".repeat(60));
	lines.push("SEVERITY BREAKDOWN");
	lines.push("-".repeat(60));
	lines.push(`  Errors:   ${report.severityCounts.error}`);
	lines.push(`  Warnings: ${report.severityCounts.warning}`);
	lines.push(`  Info:     ${report.severityCounts.info}`);
	lines.push("");
	lines.push("-".repeat(60));
	lines.push("FINDINGS");
	lines.push("-".repeat(60));

	if (report.findings.length === 0) {
		lines.push("  No findings.");
	} else {
		for (const finding of report.findings) {
			const flag = finding.blocking ? " [BLOCKING]" : "";
			lines.push(`  [${finding.severity.toUpperCase()}]${flag} ${finding.message}`);
			lines.push(`         Category: ${finding.category}`);
			lines.push(`         ID:       ${finding.id}`);
			if (finding.detail) {
				const detailLines = finding.detail.split("\n");
				for (const dl of detailLines) {
					lines.push(`         ${dl}`);
				}
			}
			if (finding.reference) {
				lines.push(`         Ref:      ${finding.reference}`);
			}
			lines.push("");
		}
	}

	if (report.evidenceSummary) {
		lines.push("-".repeat(60));
		lines.push("EVIDENCE SUMMARY");
		lines.push("-".repeat(60));
		lines.push(`  Total Evidence:     ${report.evidenceSummary.totalEvidence}`);
		lines.push(`  Pass Rate:          ${(report.evidenceSummary.passRate * 100).toFixed(1)}%`);
		lines.push(`  Criteria Total:     ${report.evidenceSummary.totalCriteria}`);
		lines.push(`  Without Evidence:   ${report.evidenceSummary.criteriaWithoutEvidence}`);
		lines.push("");
	}

	if (report.workerReportSummary) {
		lines.push("-".repeat(60));
		lines.push("WORKER REPORT SUMMARY");
		lines.push("-".repeat(60));
		lines.push(`  Present:            ${report.workerReportSummary.reportPresent}`);
		lines.push(`  Successful:         ${report.workerReportSummary.reportSuccessful}`);
		if (report.workerReportSummary.workerVerdict) {
			lines.push(`  Verdict:            ${report.workerReportSummary.workerVerdict}`);
		}
		lines.push(`  Criteria Reported:  ${report.workerReportSummary.criteriaCount}`);
		lines.push(`  Mutations:          ${report.workerReportSummary.mutationCount}`);
		lines.push("");
	}

	if (report.writeSetSummary) {
		lines.push("-".repeat(60));
		lines.push("WRITE SET SUMMARY");
		lines.push("-".repeat(60));
		lines.push(`  Matched Files:      ${report.writeSetSummary.matchedFiles}`);
		lines.push(`  Unexpected Files:   ${report.writeSetSummary.unexpectedFiles}`);
		lines.push(`  Unused Patterns:    ${report.writeSetSummary.unusedPatterns}`);
		lines.push(`  Fully Covered:      ${report.writeSetSummary.fullyCovered}`);
		lines.push("");
	}

	if (report.completionGateSummary) {
		lines.push("-".repeat(60));
		lines.push("COMPLETION GATE SUMMARY");
		lines.push("-".repeat(60));
		lines.push(`  Evaluated:          ${report.completionGateSummary.evaluated}`);
		lines.push(`  Passed:             ${report.completionGateSummary.passed}`);
		if (report.completionGateSummary.blockReasons.length > 0) {
			lines.push("  Block Reasons:");
			for (const reason of report.completionGateSummary.blockReasons) {
				lines.push(`    - ${reason}`);
			}
		}
		lines.push("");
	}

	if (report.summary) {
		lines.push("-".repeat(60));
		lines.push("SUMMARY");
		lines.push("-".repeat(60));
		lines.push(`  ${report.summary}`);
		lines.push("");
	}

	if (report.recommendations.length > 0) {
		lines.push("-".repeat(60));
		lines.push("RECOMMENDATIONS");
		lines.push("-".repeat(60));
		for (const rec of report.recommendations) {
			lines.push(`  ${rec}`);
		}
		lines.push("");
	}

	lines.push("=".repeat(60));

	return lines.join("\n");
}
