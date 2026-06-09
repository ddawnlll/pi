/**
 * P45.B3 — Evidence Ledger and Mutation Report Export
 *
 * P44-to-P45 Bridge Artifact: Exports evidence ledger snapshots and mutation
 * reports from the P44 completion subsystem for consumption by the P45 async
 * assembly runtime.
 *
 * This module provides:
 * - EvidenceLedgerExport type — a serializable snapshot of the EvidenceLedger
 *   containing all evidence entries, summary statistics, and schema metadata
 * - MutationReportExport type — a serializable collection of MutationReport
 *   objects with aggregate summary statistics
 * - JSON/Markdown report generation for both artifacts
 *
 * Contract Schema: 4.1.1
 *
 * Used by:
 * - P45.B2 (Assembler-Only Candidate Discovery)
 * - P45.B4 (Bridge Integration and Wiring)
 * - P45 Deterministic Assembler for evidence-based verification
 */

import type { EvidenceLedgerSnapshot } from "../../completion/evidence-ledger.js";
import type { EvidenceLedgerEntry, EvidenceSummary } from "../../completion/evidence-types.js";
import type { MutationReport } from "../../mutation/mutation-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for P45 bridge evidence and mutation artifacts.
 */
export const P45_EVIDENCE_MUTATION_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Default output path for evidence ledger exports (relative to repo root).
 */
export const DEFAULT_EVIDENCE_LEDGER_PATH = "reports/p44-verified-completion/evidence-ledger-export.json";

/**
 * Default output path for mutation report exports (relative to repo root).
 */
export const DEFAULT_MUTATION_REPORT_PATH = "reports/p44-verified-completion/mutation-report.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A serializable snapshot of the EvidenceLedger for bridge export.
 *
 * This is the primary evidence bridge artifact: it provides the P45 runtime
 * with a complete view of all evidence collected during P44 verified completion,
 * enabling downstream verification, audit, and assembly-time checks.
 */
export interface EvidenceLedgerExport {
	/** Schema version of this artifact */
	schemaVersion: string;
	/** Scope identifier from the source ledger */
	scopeId: string;
	/** When this export was generated (epoch ms) */
	generatedAt: number;
	/** Total number of evidence entries */
	total: number;
	/** Summary statistics */
	summary: EvidenceSummary;
	/** All evidence entries */
	entries: EvidenceLedgerEntry[];
	/** Optional structured metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Summary statistics for a mutation report export.
 */
export interface MutationReportStatistics {
	/** Total number of mutation reports */
	totalMutations: number;
	/** Number of blocked mutations */
	blockedCount: number;
	/** Number of rolled-back mutations */
	rolledBackCount: number;
	/** Number of mutations that passed (not blocked, not rolled back) */
	passedCount: number;
	/** Count of mutations by mode */
	byMode: Record<string, number>;
	/** Count of mutations by safety level */
	bySafetyLevel: Record<string, number>;
}

/**
 * A serializable collection of MutationReport objects for bridge export.
 *
 * This artifact provides the P45 runtime with a record of all mutations
 * performed during P44 execution, including write-set compliance, safety
 * levels, and rollback status.
 */
export interface MutationReportExport {
	/** Schema version of this artifact */
	schemaVersion: string;
	/** When this export was generated (epoch ms) */
	generatedAt: number;
	/** Total number of mutation reports */
	totalMutations: number;
	/** Aggregate summary statistics */
	summary: MutationReportStatistics;
	/** Individual mutation reports */
	reports: MutationReport[];
	/** Workspace or plan execution identifier */
	planExecId?: string;
	/** Optional structured metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Options for building an EvidenceLedgerExport.
 */
export interface EvidenceLedgerExportOptions {
	/** Optional override for the generation timestamp (default: Date.now()) */
	generatedAt?: number;
	/** Optional metadata to attach */
	metadata?: Record<string, unknown>;
}

/**
 * Options for building a MutationReportExport.
 */
export interface MutationReportExportOptions {
	/** Optional override for the generation timestamp (default: Date.now()) */
	generatedAt?: number;
	/** Optional plan execution identifier */
	planExecId?: string;
	/** Optional metadata to attach */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Build an EvidenceLedgerExport from an EvidenceLedgerSnapshot.
 *
 * Converts the in-memory ledger snapshot into a bridge artifact suitable
 * for JSON serialization and downstream consumption.
 *
 * @param snapshot - The EvidenceLedgerSnapshot from EvidenceLedger.toJSON()
 * @param options - Optional build options
 * @returns An EvidenceLedgerExport artifact
 */
export function buildEvidenceLedgerExport(
	snapshot: EvidenceLedgerSnapshot,
	options?: EvidenceLedgerExportOptions,
): EvidenceLedgerExport {
	return {
		schemaVersion: P45_EVIDENCE_MUTATION_SCHEMA_VERSION,
		scopeId: snapshot.scopeId,
		generatedAt: options?.generatedAt ?? snapshot.generatedAt,
		total: snapshot.total,
		summary: { ...snapshot.summary },
		entries: snapshot.entries.map((entry) => ({ ...entry })),
		metadata: options?.metadata,
	};
}

/**
 * Build a MutationReportExport from an array of MutationReport objects.
 *
 * Aggregates mutation reports and computes summary statistics for
 * downstream consumption by the P45 runtime.
 *
 * @param reports - Array of MutationReport objects
 * @param options - Optional build options
 * @returns A MutationReportExport artifact
 */
export function buildMutationReportExport(
	reports: MutationReport[],
	options?: MutationReportExportOptions,
): MutationReportExport {
	const byMode: Record<string, number> = {};
	const bySafetyLevel: Record<string, number> = {};
	let blockedCount = 0;
	let rolledBackCount = 0;

	for (const report of reports) {
		// Count by mode
		byMode[report.mode] = (byMode[report.mode] ?? 0) + 1;
		// Count by safety level
		bySafetyLevel[report.safetyLevel] = (bySafetyLevel[report.safetyLevel] ?? 0) + 1;
		// Count blocked
		if (report.blocked) {
			blockedCount++;
		}
		// Count rolled back
		if (report.rolledBack) {
			rolledBackCount++;
		}
	}

	const passedCount = reports.length - blockedCount - rolledBackCount;

	return {
		schemaVersion: P45_EVIDENCE_MUTATION_SCHEMA_VERSION,
		generatedAt: options?.generatedAt ?? Date.now(),
		totalMutations: reports.length,
		summary: {
			totalMutations: reports.length,
			blockedCount,
			rolledBackCount,
			passedCount,
			byMode,
			bySafetyLevel,
		},
		reports: reports.map((r) => ({ ...r })),
		planExecId: options?.planExecId,
		metadata: options?.metadata,
	};
}

// ---------------------------------------------------------------------------
// Report Generation (Markdown)
// ---------------------------------------------------------------------------

/**
 * Format an EvidenceLedgerExport as a human-readable Markdown report.
 *
 * @param exportData - The evidence ledger export artifact
 * @returns A Markdown-formatted report string
 */
export function formatEvidenceLedgerReport(exportData: EvidenceLedgerExport): string {
	const lines: string[] = [
		`# Evidence Ledger Export`,
		``,
		`**Scope:** ${exportData.scopeId}`,
		`**Generated:** ${new Date(exportData.generatedAt).toISOString()}`,
		`**Schema Version:** ${exportData.schemaVersion}`,
		``,
		`## Summary`,
		``,
		`| Metric | Value |`,
		`|--------|-------|`,
		`| Total Entries | ${exportData.total} |`,
		`| Pass Rate | ${(exportData.summary.passRate * 100).toFixed(1)}% |`,
		``,
		`### By Type`,
		``,
	];

	const typeKeys = Object.keys(exportData.summary.byType);
	if (typeKeys.length === 0) {
		lines.push(`_No evidence types._`, ``);
	} else {
		for (const type of typeKeys.sort()) {
			lines.push(`- **${type}**: ${exportData.summary.byType[type]}`);
		}
		lines.push(``);
	}

	lines.push(`### By Verdict`, ``);
	const verdictKeys = Object.keys(exportData.summary.byVerdict);
	if (verdictKeys.length === 0) {
		lines.push(`_No verdicts._`, ``);
	} else {
		for (const verdict of verdictKeys.sort()) {
			lines.push(`- **${verdict}**: ${exportData.summary.byVerdict[verdict]}`);
		}
		lines.push(``);
	}

	lines.push(`### By Confidence`, ``);
	const confidenceKeys = Object.keys(exportData.summary.byConfidence);
	if (confidenceKeys.length === 0) {
		lines.push(`_No confidence levels._`, ``);
	} else {
		for (const confidence of confidenceKeys.sort()) {
			lines.push(`- **${confidence}**: ${exportData.summary.byConfidence[confidence]}`);
		}
		lines.push(``);
	}

	lines.push(`## Entries (${exportData.entries.length})`, ``);
	if (exportData.entries.length === 0) {
		lines.push(`_No evidence entries._`, ``);
	} else {
		for (const entry of exportData.entries) {
			lines.push(`### ${entry.id} — ${entry.description}`);
			lines.push(`- **Type:** ${entry.type}`);
			lines.push(`- **Source:** ${entry.source}`);
			lines.push(`- **Verdict:** ${entry.verdict}`);
			lines.push(`- **Confidence:** ${entry.confidence}`);
			if (entry.producedBy) {
				lines.push(`- **Produced By:** ${entry.producedBy}`);
			}
			if (entry.criterionIds.length > 0) {
				lines.push(`- **Criteria:** ${entry.criterionIds.join(", ")}`);
			}
			lines.push(``);
		}
	}

	return lines.join("\n");
}

/**
 * Format a MutationReportExport as a human-readable Markdown report.
 *
 * @param exportData - The mutation report export artifact
 * @returns A Markdown-formatted report string
 */
export function formatMutationReportReport(exportData: MutationReportExport): string {
	const lines: string[] = [
		`# Mutation Report Export`,
		``,
		`**Generated:** ${new Date(exportData.generatedAt).toISOString()}`,
		`**Schema Version:** ${exportData.schemaVersion}`,
		``,
	];

	if (exportData.planExecId) {
		lines.push(`**Plan Execution:** ${exportData.planExecId}`, ``);
	}

	lines.push(
		`## Summary`,
		``,
		`| Metric | Value |`,
		`|--------|-------|`,
		`| Total Mutations | ${exportData.summary.totalMutations} |`,
		`| Passed | ${exportData.summary.passedCount} |`,
		`| Blocked | ${exportData.summary.blockedCount} |`,
		`| Rolled Back | ${exportData.summary.rolledBackCount} |`,
		``,
	);

	if (Object.keys(exportData.summary.byMode).length > 0) {
		lines.push(`### By Mode`, ``);
		for (const [mode, count] of Object.entries(exportData.summary.byMode).sort()) {
			lines.push(`- **${mode}**: ${count}`);
		}
		lines.push(``);
	}

	if (Object.keys(exportData.summary.bySafetyLevel).length > 0) {
		lines.push(`### By Safety Level`, ``);
		for (const [level, count] of Object.entries(exportData.summary.bySafetyLevel).sort()) {
			lines.push(`- **${level}**: ${count}`);
		}
		lines.push(``);
	}

	lines.push(`## Reports (${exportData.reports.length})`, ``);
	if (exportData.reports.length === 0) {
		lines.push(`_No mutation reports._`, ``);
	} else {
		for (const report of exportData.reports) {
			lines.push(`### ${report.path}`);
			lines.push(`- **Mode:** ${report.mode}`);
			lines.push(`- **Safety Level:** ${report.safetyLevel}`);
			lines.push(`- **Blocked:** ${report.blocked}`);
			if (report.blockReason) {
				lines.push(`- **Block Reason:** ${report.blockReason}`);
			}
			lines.push(`- **Rolled Back:** ${report.rolledBack}`);
			if (report.rollbackReason) {
				lines.push(`- **Rollback Reason:** ${report.rollbackReason}`);
			}
			if (report.editRecoveryStrategy) {
				lines.push(`- **Edit Recovery:** ${report.editRecoveryStrategy}`);
			}
			lines.push(`- **Parser OK:** ${report.parserOk ?? "n/a"}`);
			lines.push(`- **WriteSet OK:** ${report.writeSetOk ?? "n/a"}`);
			lines.push(`- **Timestamp:** ${report.timestamp}`);
			lines.push(``);
		}
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON Conversion
// ---------------------------------------------------------------------------

/**
 * Generate a JSON-serializable EvidenceLedgerExport object.
 *
 * @param exportData - The evidence ledger export artifact
 * @returns JSON-ready object
 */
export function toEvidenceLedgerJSON(exportData: EvidenceLedgerExport): Record<string, unknown> {
	return {
		schemaVersion: exportData.schemaVersion,
		scopeId: exportData.scopeId,
		generatedAt: exportData.generatedAt,
		total: exportData.total,
		summary: {
			total: exportData.summary.total,
			byType: exportData.summary.byType,
			byVerdict: exportData.summary.byVerdict,
			byConfidence: exportData.summary.byConfidence,
			passRate: exportData.summary.passRate,
		},
		entries: exportData.entries.map((entry) => ({
			id: entry.id,
			type: entry.type,
			description: entry.description,
			source: entry.source,
			timestamp: entry.timestamp,
			verdict: entry.verdict,
			confidence: entry.confidence,
			content: entry.content,
			...(entry.metadata ? { metadata: entry.metadata } : {}),
			...(entry.producedBy ? { producedBy: entry.producedBy } : {}),
			criterionIds: entry.criterionIds,
			...(entry.planLockHash ? { planLockHash: entry.planLockHash } : {}),
			...(entry.workspaceLockHash ? { workspaceLockHash: entry.workspaceLockHash } : {}),
		})),
		...(exportData.metadata ? { metadata: exportData.metadata } : {}),
	};
}

/**
 * Generate a JSON-serializable MutationReportExport object.
 *
 * @param exportData - The mutation report export artifact
 * @returns JSON-ready object
 */
export function toMutationReportJSON(exportData: MutationReportExport): Record<string, unknown> {
	return {
		schemaVersion: exportData.schemaVersion,
		generatedAt: exportData.generatedAt,
		totalMutations: exportData.totalMutations,
		summary: {
			totalMutations: exportData.summary.totalMutations,
			blockedCount: exportData.summary.blockedCount,
			rolledBackCount: exportData.summary.rolledBackCount,
			passedCount: exportData.summary.passedCount,
			byMode: exportData.summary.byMode,
			bySafetyLevel: exportData.summary.bySafetyLevel,
		},
		reports: exportData.reports.map((r) => ({
			path: r.path,
			mode: r.mode,
			safetyLevel: r.safetyLevel,
			preHash: r.preHash,
			postHash: r.postHash,
			blocked: r.blocked,
			blockReason: r.blockReason,
			rolledBack: r.rolledBack,
			rollbackReason: r.rollbackReason,
			editRecoveryStrategy: r.editRecoveryStrategy,
			parserOk: r.parserOk,
			parserName: r.parserName,
			writeSetOk: r.writeSetOk,
			timestamp: r.timestamp,
		})),
		...(exportData.planExecId ? { planExecId: exportData.planExecId } : {}),
		...(exportData.metadata ? { metadata: exportData.metadata } : {}),
	};
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize an EvidenceLedgerExport as a formatted JSON string.
 *
 * @param exportData - The evidence ledger export artifact
 * @returns Pretty-printed JSON string
 */
export function serializeEvidenceLedgerExport(exportData: EvidenceLedgerExport): string {
	return `${JSON.stringify(toEvidenceLedgerJSON(exportData), null, 2)}\n`;
}

/**
 * Serialize a MutationReportExport as a formatted JSON string.
 *
 * @param exportData - The mutation report export artifact
 * @returns Pretty-printed JSON string
 */
export function serializeMutationReportExport(exportData: MutationReportExport): string {
	return `${JSON.stringify(toMutationReportJSON(exportData), null, 2)}\n`;
}
