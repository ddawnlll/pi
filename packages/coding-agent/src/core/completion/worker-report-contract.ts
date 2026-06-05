/**
 * P44.06 — Worker Report Contract
 *
 * Defines the schema and builder for worker completion reports.
 * A WorkerReport is the output a worker produces after completing
 * a workspace. It includes:
 * - Worker identity and workspace reference
 * - Acceptance criteria status (satisfied/failed/unverified)
 * - Evidence references (from EvidenceLedger)
 * - Mutation summary (files changed, commands run)
 * - Timestamps and verdict
 *
 * The report is consumed by:
 * - CompletionGate (P44.03) for gate evaluation
 * - TerminalVerdictReconciler (P44.04) for final verdict
 * - WorkspaceCommitGate (P44.08) for commit gate
 *
 * Contract Schema: 4.1.1
 */

import type { AcceptanceCriterion, CriterionVerificationStatus } from "./acceptance-criteria.js";
import type { EvidenceLedgerEntry } from "./evidence-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for worker reports.
 */
export const WORKER_REPORT_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Overall verdict of a worker's workspace execution.
 */
export type WorkerVerdict =
	| "pass"
	| "fail"
	| "inconclusive"
	| "not_started"
	| "in_progress";

/**
 * Summary of mutations performed by the worker.
 */
export interface MutationSummary {
	/** Files that were created */
	created: string[];
	/** Files that were modified */
	modified: string[];
	/** Files that were deleted */
	deleted: string[];
	/** Commands that were executed */
	commandsExecuted: string[];
	/** Total number of edits applied */
	editCount: number;
}

/**
 * Status of an individual acceptance criterion as reported by the worker.
 */
export interface CriterionReportItem {
	/** Criterion ID */
	id: string;
	/** Human-readable description */
	description: string;
	/** Verification status reported by the worker */
	status: CriterionVerificationStatus;
	/** Evidence entry IDs that support this criterion */
	evidenceIds: string[];
	/** Optional notes from the worker */
	notes: string;
}

/**
 * A worker completion report for a single workspace execution.
 */
export interface WorkerReport {
	/** Unique report identifier */
	reportId: string;
	/** Schema version */
	schemaVersion: string;
	/** Worker identity (agent or system identifier) */
	workerId: string;
	/** Workspace identifier that was executed */
	workspaceId: string;
	/** Plan or phase identifier */
	planId: string;
	/** When the workspace was started (epoch ms) */
	startedAt: number;
	/** When the workspace was completed (epoch ms) */
	completedAt: number;
	/** Overall verdict */
	verdict: WorkerVerdict;
	/** Status of each acceptance criterion */
	criteriaStatus: CriterionReportItem[];
	/** Summary of mutations performed */
	mutations: MutationSummary;
	/** Summary of evidence collected */
	evidenceSummary: {
		total: number;
		passed: number;
		failed: number;
	};
	/** Human-readable summary message */
	summary: string;
	/** Optional structured metadata */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// WorkerReportBuilder
// ---------------------------------------------------------------------------

/**
 * Builder for constructing a WorkerReport incrementally.
 *
 * Usage:
 * ```typescript
 * const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
 *   .withSummary("All criteria satisfied")
 *   .withCriterionStatus({ id: "AC-P4401-001", description: "...", status: "satisfied", evidenceIds: [], notes: "" })
 *   .withMutation({ created: ["file.ts"], modified: [], deleted: [], commandsExecuted: ["npm test"], editCount: 1 })
 *   .build();
 * ```
 */
export class WorkerReportBuilder {
	private report: WorkerReport;

	/**
	 * @param workerId - Worker identity
	 * @param workspaceId - Workspace that was executed
	 * @param planId - Plan or phase identifier
	 */
	constructor(workerId: string, workspaceId: string, planId: string) {
		this.report = {
			reportId: generateReportId(workspaceId),
			schemaVersion: WORKER_REPORT_SCHEMA_VERSION,
			workerId,
			workspaceId,
			planId,
			startedAt: Date.now(),
			completedAt: Date.now(),
			verdict: "in_progress",
			criteriaStatus: [],
			mutations: {
				created: [],
				modified: [],
				deleted: [],
				commandsExecuted: [],
				editCount: 0,
			},
			evidenceSummary: {
				total: 0,
				passed: 0,
				failed: 0,
			},
			summary: "",
		};
	}

	/**
	 * Set the workspace start timestamp.
	 */
	withStartedAt(timestamp: number): this {
		this.report.startedAt = timestamp;
		return this;
	}

	/**
	 * Set the workspace completion timestamp.
	 */
	withCompletedAt(timestamp: number): this {
		this.report.completedAt = timestamp;
		return this;
	}

	/**
	 * Set the overall verdict.
	 */
	withVerdict(verdict: WorkerVerdict): this {
		this.report.verdict = verdict;
		return this;
	}

	/**
	 * Add a criterion status entry.
	 */
	withCriterionStatus(item: CriterionReportItem): this {
		this.report.criteriaStatus.push(item);
		return this;
	}

	/**
	 * Add multiple criterion status entries.
	 */
	withCriteriaStatuses(items: CriterionReportItem[]): this {
		this.report.criteriaStatus.push(...items);
		return this;
	}

	/**
	 * Set the mutation summary.
	 */
	withMutation(summary: MutationSummary): this {
		this.report.mutations = summary;
		return this;
	}

	/**
	 * Add a created file to the mutation summary.
	 */
	withCreatedFile(filePath: string): this {
		this.report.mutations.created.push(filePath);
		return this;
	}

	/**
	 * Add a modified file to the mutation summary.
	 */
	withModifiedFile(filePath: string): this {
		this.report.mutations.modified.push(filePath);
		return this;
	}

	/**
	 * Add a deleted file to the mutation summary.
	 */
	withDeletedFile(filePath: string): this {
		this.report.mutations.deleted.push(filePath);
		return this;
	}

	/**
	 * Add an executed command to the mutation summary.
	 */
	withExecutedCommand(command: string): this {
		this.report.mutations.commandsExecuted.push(command);
		return this;
	}

	/**
	 * Set the edit count.
	 */
	withEditCount(count: number): this {
		this.report.mutations.editCount = count;
		return this;
	}

	/**
	 * Build evidence summary from an array of evidence entries.
	 */
	withEvidenceFromEntries(entries: EvidenceLedgerEntry[]): this {
		const total = entries.length;
		const passed = entries.filter((e) => e.verdict === "pass").length;
		const failed = entries.filter((e) => e.verdict === "fail").length;
		this.report.evidenceSummary = { total, passed, failed };
		return this;
	}

	/**
	 * Set evidence summary directly.
	 */
	withEvidenceSummary(total: number, passed: number, failed: number): this {
		this.report.evidenceSummary = { total, passed, failed };
		return this;
	}

	/**
	 * Set the human-readable summary message.
	 */
	withSummary(summary: string): this {
		this.report.summary = summary;
		return this;
	}

	/**
	 * Set custom metadata.
	 */
	withMetadata(metadata: Record<string, unknown>): this {
		this.report.metadata = metadata;
		return this;
	}

	/**
	 * Build the final WorkerReport.
	 *
	 * Automatically determines verdict from criteria status if verdict
	 * is still "in_progress".
	 */
	build(): WorkerReport {
		// Auto-determine verdict if not explicitly set
		if (this.report.verdict === "in_progress" || this.report.verdict === "not_started") {
			this.report.verdict = determineVerdict(this.report.criteriaStatus);
		}

		// Ensure completedAt is set
		if (this.report.completedAt === this.report.startedAt) {
			this.report.completedAt = Date.now();
		}

		return { ...this.report };
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic report ID from a workspace ID.
 *
 * @param workspaceId - Workspace identifier
 * @returns Formatted report ID (e.g., "WR-P4401-1712345678901")
 */
export function generateReportId(workspaceId: string): string {
	const normalized = workspaceId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
	return `WR-${normalized}-${Date.now()}`;
}

/**
 * Determine the overall verdict from a list of criterion status items.
 *
 * Rules:
 * - If any criterion has status "failed" → "fail"
 * - If all criteria have status "satisfied" or "skipped" → "pass"
 * - If any criterion has status "in_progress" → "inconclusive"
 * - If any criterion has status "unverified" → "inconclusive"
 * - If no criteria → "inconclusive"
 *
 * @param items - Criterion status items
 * @returns The determined verdict
 */
export function determineVerdict(items: CriterionReportItem[]): WorkerVerdict {
	if (items.length === 0) return "inconclusive";

	let hasFailure = false;
	let hasUnverified = false;
	let hasInProgress = false;
	let allSatisfiedOrSkipped = true;

	for (const item of items) {
		switch (item.status) {
			case "failed":
				hasFailure = true;
				allSatisfiedOrSkipped = false;
				break;
			case "unverified":
				hasUnverified = true;
				allSatisfiedOrSkipped = false;
				break;
			case "in_progress":
				hasInProgress = true;
				allSatisfiedOrSkipped = false;
				break;
			case "satisfied":
			case "skipped":
				break;
			default:
				hasUnverified = true;
				allSatisfiedOrSkipped = false;
		}
	}

	if (hasFailure) return "fail";
	if (allSatisfiedOrSkipped) return "pass";
	if (hasInProgress) return "inconclusive";
	if (hasUnverified) return "inconclusive";

	return "inconclusive";
}

/**
 * Build a WorkerReport from acceptance criteria and evidence ledger entries.
 *
 * This is a convenience factory that combines:
 * - An AcceptanceCriteriaRegistry's criteria state
 * - An EvidenceLedger's entries
 * - A worker identity and workspace context
 *
 * @param workerId - Worker identity
 * @param workspaceId - Workspace identifier
 * @param planId - Plan identifier
 * @param criteria - Array of acceptance criteria
 * @param evidenceEntries - Array of evidence ledger entries
 * @param mutations - Mutation summary
 * @param summary - Human-readable summary message
 * @returns A fully constructed WorkerReport
 */
export function buildReportFromCriteria(
	workerId: string,
	workspaceId: string,
	planId: string,
	criteria: AcceptanceCriterion[],
	evidenceEntries: EvidenceLedgerEntry[],
	mutations: MutationSummary,
	summary: string,
): WorkerReport {
	const evidenceMap = new Map(evidenceEntries.map((e) => [e.id, e]));

	const criteriaStatus: CriterionReportItem[] = criteria.map((c) => ({
		id: c.id,
		description: c.description,
		status: c.verificationStatus,
		evidenceIds: c.evidenceIds.filter((eid) => evidenceMap.has(eid)),
		notes: c.verifierNotes,
	}));

	const total = evidenceEntries.length;
	const passed = evidenceEntries.filter((e) => e.verdict === "pass").length;
	const failed = evidenceEntries.filter((e) => e.verdict === "fail").length;

	return new WorkerReportBuilder(workerId, workspaceId, planId)
		.withCriteriaStatuses(criteriaStatus)
		.withMutation(mutations)
		.withEvidenceSummary(total, passed, failed)
		.withSummary(summary)
		.build();
}

/**
 * Format a WorkerReport as a human-readable string.
 *
 * @param report - The worker report to format
 * @returns Formatted string representation
 */
export function formatReport(report: WorkerReport): string {
	const lines: string[] = [];

	lines.push("# Worker Completion Report");
	lines.push(`Report ID: ${report.reportId}`);
	lines.push(`Schema: ${report.schemaVersion}`);
	lines.push(`Worker: ${report.workerId}`);
	lines.push(`Workspace: ${report.workspaceId}`);
	lines.push(`Plan: ${report.planId}`);
	lines.push("");
	lines.push(`Started: ${new Date(report.startedAt).toISOString()}`);
	lines.push(`Completed: ${new Date(report.completedAt).toISOString()}`);
	lines.push(`Duration: ${report.completedAt - report.startedAt}ms`);
	lines.push("");
	lines.push(`Verdict: ${report.verdict.toUpperCase()}`);
	lines.push(`Summary: ${report.summary}`);
	lines.push("");

	lines.push("## Criteria Status");
	for (const cs of report.criteriaStatus) {
		const evidenceStr = cs.evidenceIds.length > 0 ? ` [evidence: ${cs.evidenceIds.join(", ")}]` : "";
		const notesStr = cs.notes ? ` — ${cs.notes}` : "";
		lines.push(`- [${cs.status.toUpperCase()}] ${cs.id}: ${cs.description}${evidenceStr}${notesStr}`);
	}
	lines.push("");

	lines.push("## Mutations");
	lines.push(`- Created: ${report.mutations.created.length} files`);
	lines.push(`- Modified: ${report.mutations.modified.length} files`);
	lines.push(`- Deleted: ${report.mutations.deleted.length} files`);
	lines.push(`- Commands: ${report.mutations.commandsExecuted.length}`);
	lines.push(`- Edits: ${report.mutations.editCount}`);
	lines.push("");

	lines.push("## Evidence Summary");
	lines.push(`- Total: ${report.evidenceSummary.total}`);
	lines.push(`- Passed: ${report.evidenceSummary.passed}`);
	lines.push(`- Failed: ${report.evidenceSummary.failed}`);

	return lines.join("\n");
}

/**
 * Check whether a worker report indicates successful completion.
 *
 * @param report - The worker report to check
 * @returns True if the verdict is "pass"
 */
export function isReportSuccessful(report: WorkerReport): boolean {
	return report.verdict === "pass";
}

/**
 * Get blocking reasons from a worker report for failed workspaces.
 *
 * @param report - The worker report to analyze
 * @returns Array of human-readable blocking reason strings
 */
export function getReportBlockingReasons(report: WorkerReport): string[] {
	const reasons: string[] = [];

	if (report.verdict === "fail") {
		reasons.push(`Workspace ${report.workspaceId} failed`);
	}

	for (const cs of report.criteriaStatus) {
		if (cs.status === "failed") {
			reasons.push(`Criterion ${cs.id} failed: ${cs.description}${cs.notes ? ` (${cs.notes})` : ""}`);
		}
		if (cs.status === "unverified") {
			reasons.push(`Criterion ${cs.id} unverified: ${cs.description}`);
		}
	}

	return reasons;
}
