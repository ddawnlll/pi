/**
 * P44.6.21 — SmartEdit Audit Finding Contract
 *
 * Stable types for smart edit audit findings. Each finding has a unique
 * ID, severity (blocker|warning), file reference, optional line range,
 * confidence level, and required patch evidence.
 *
 * Audit findings are stable types — not prose strings — so patch scope
 * compilation (P44.6.22) can reference them by ID.
 *
 * Contract Schema: 4.1.1
 */

import type { DiagnosticCollection } from "../mode/mode-diagnostic.js";

// ---------------------------------------------------------------------------
// Finding Types
// ---------------------------------------------------------------------------

export type AuditFindingSeverity = "blocker" | "warning";
export type AuditFindingConfidence = "high" | "medium" | "low";

export interface SmartEditAuditFinding {
	/** Unique finding identifier. */
	id: string;
	/** Severity level. */
	severity: AuditFindingSeverity;
	/** The file this finding references. */
	fileRef: string;
	/** Optional line range within the file. */
	lineRange?: { start: number; end: number };
	/** Confidence in this finding. */
	confidence: AuditFindingConfidence;
	/** Description of the finding. */
	description: string;
	/** Required evidence that the patch resolved this finding. */
	requiredPatchEvidence: string;
	/** Suggested fix or resolution strategy. */
	suggestedFix?: string;
}

export interface AuditFindingCollection extends DiagnosticCollection {
	findings: SmartEditAuditFinding[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createFinding(
	id: string,
	severity: AuditFindingSeverity,
	fileRef: string,
	description: string,
	requiredPatchEvidence: string,
	confidence: AuditFindingConfidence = "medium",
): SmartEditAuditFinding {
	return {
		id,
		severity,
		fileRef,
		description,
		requiredPatchEvidence,
		confidence,
	};
}

export function hasBlockerFindings(collection: AuditFindingCollection): boolean {
	return collection.findings.some((f) => f.severity === "blocker");
}

export function getFindingsByFile(collection: AuditFindingCollection, fileRef: string): SmartEditAuditFinding[] {
	return collection.findings.filter((f) => f.fileRef === fileRef);
}
