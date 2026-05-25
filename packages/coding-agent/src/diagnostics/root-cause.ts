/**
 * Root Cause Analysis - Workspace 25.E
 *
 * Root cause analysis types and utilities for diagnosing failures
 * within the diagnostic packet system.
 *
 * Provides structured root cause identification with confidence scoring,
 * supporting evidence-backed diagnostic conclusion generation.
 */

import { createEvidenceEntry, type EvidenceEntry, type EvidenceGroup } from "../core/diagnostic-packet.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Root cause category classification.
 */
export type RootCauseCategory =
	| "merge_conflict"
	| "test_failure"
	| "lint_failure"
	| "type_error"
	| "build_failure"
	| "runtime_error"
	| "timeout"
	| "network_error"
	| "permission_error"
	| "budget_exceeded"
	| "resource_exhaustion"
	| "dependency_blocked"
	| "configuration_error"
	| "unknown";

/**
 * Root cause analysis result for a diagnostic packet.
 */
export interface RootCause {
	/** Identified root cause category */
	category: RootCauseCategory;
	/** Confidence score (0.0 to 1.0) */
	confidence: number;
	/** Human-readable description */
	description: string;
	/** Supporting evidence entry IDs */
	supportingEvidenceIds: string[];
	/** Underlying cause explanation */
	rootCauseExplanation?: string;
	/** Suggested remediation steps */
	suggestedSteps?: string[];
}

/**
 * Root cause analysis result containing all identified causes.
 */
export interface RootCauseAnalysis {
	/** Workspace ID the analysis applies to */
	workspaceId: string;
	/** Primary root cause (highest confidence) */
	primaryCause: RootCause;
	/** All identified root causes, sorted by confidence descending */
	allCauses: RootCause[];
	/** Overall confidence in the analysis */
	overallConfidence: number;
	/** Whether a definitive root cause was identified */
	definitive: boolean;
}

// ---------------------------------------------------------------------------
// Root cause analysis
// ---------------------------------------------------------------------------

/**
 * Analyze evidence entries and identify root causes.
 *
 * @param workspaceId - Workspace ID
 * @param evidenceGroups - Evidence groups to analyze
 * @returns Root cause analysis result
 */
export function analyzeRootCause(workspaceId: string, evidenceGroups: EvidenceGroup[]): RootCauseAnalysis {
	const causes: RootCause[] = [];

	// Collect all evidence entries with their group labels
	const allEntries = evidenceGroups.flatMap((g) => g.entries.map((e) => ({ ...e, groupLabel: g.label })));

	// Look for failure_classification evidence
	const classificationEntries = allEntries.filter((e) => e.category === "failure_classification" && e.failureData);

	for (const entry of classificationEntries) {
		const fd = entry.failureData!;
		const category = mapFailureCategoryToRootCause(fd.category);
		causes.push({
			category,
			confidence: fd.confidence,
			description: fd.details ?? `Failure classified as ${fd.category}`,
			supportingEvidenceIds: [entry.id],
			rootCauseExplanation: fd.details,
		});
	}

	// Look for error evidence
	const errorEntries = allEntries.filter((e) => e.category === "error_message" && e.errorData);

	for (const entry of errorEntries) {
		const ed = entry.errorData!;
		causes.push({
			category: inferCategoryFromError(ed.message),
			confidence: 0.7,
			description: ed.message.substring(0, 200),
			supportingEvidenceIds: [entry.id],
			rootCauseExplanation: ed.errorType
				? `${ed.errorType}: ${ed.message.substring(0, 300)}`
				: ed.message.substring(0, 300),
		});
	}

	// Look for scheduling decision evidence (dependency blocks)
	const schedulingEntries = allEntries.filter(
		(e) => e.category === "scheduling_decision" && e.schedulingData?.decision === "skipped",
	);

	for (const entry of schedulingEntries) {
		causes.push({
			category: "dependency_blocked",
			confidence: 0.85,
			description: entry.description,
			supportingEvidenceIds: [entry.id],
			rootCauseExplanation: entry.schedulingData?.skipReason?.reason,
		});
	}

	// Sort by confidence descending
	causes.sort((a, b) => b.confidence - a.confidence);

	// Deduplicate by category (keep highest confidence for each category)
	const seenCategories = new Set<RootCauseCategory>();
	const dedupedCauses: RootCause[] = [];
	for (const cause of causes) {
		if (!seenCategories.has(cause.category)) {
			seenCategories.add(cause.category);
			dedupedCauses.push(cause);
		}
	}

	const primaryCause = dedupedCauses[0] ?? {
		category: "unknown" as RootCauseCategory,
		confidence: 0.3,
		description: "No root cause could be identified from available evidence",
		supportingEvidenceIds: [] as string[],
	};

	const overallConfidence =
		dedupedCauses.length > 0 ? dedupedCauses.reduce((acc, c) => acc + c.confidence, 0) / dedupedCauses.length : 0.3;

	return {
		workspaceId,
		primaryCause,
		allCauses: dedupedCauses,
		overallConfidence,
		definitive: primaryCause.confidence >= 0.8,
	};
}

/**
 * Create an evidence entry from a root cause analysis.
 *
 * @param analysis - Root cause analysis result
 * @returns Evidence entry
 */
export function createEvidenceFromRootCauseAnalysis(analysis: RootCauseAnalysis): EvidenceEntry {
	return createEvidenceEntry({
		category: "failure_classification",
		description: `Root cause analysis: ${analysis.primaryCause.category} (confidence: ${analysis.primaryCause.confidence})`,
		source: "root-cause-analyzer",
		failureData: {
			category: analysis.primaryCause.category,
			confidence: analysis.primaryCause.confidence,
			recoverable: !analysis.definitive,
			details: analysis.primaryCause.rootCauseExplanation,
		},
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a failure category string to a root cause category.
 */
function mapFailureCategoryToRootCause(category: string): RootCauseCategory {
	const lower = category.toLowerCase();
	if (lower.includes("merge")) return "merge_conflict";
	if (lower.includes("test")) return "test_failure";
	if (lower.includes("lint")) return "lint_failure";
	if (lower.includes("type")) return "type_error";
	if (lower.includes("build") || lower.includes("compile")) return "build_failure";
	if (lower.includes("runtime")) return "runtime_error";
	if (lower.includes("timeout")) return "timeout";
	if (lower.includes("network")) return "network_error";
	if (lower.includes("permission")) return "permission_error";
	if (lower.includes("budget")) return "budget_exceeded";
	if (lower.includes("resource")) return "resource_exhaustion";
	if (lower.includes("dependency")) return "dependency_blocked";
	if (lower.includes("config")) return "configuration_error";
	return "unknown";
}

/**
 * Infer a root cause category from an error message.
 */
function inferCategoryFromError(message: string): RootCauseCategory {
	const lower = message.toLowerCase();
	if (lower.includes("typeerror") || lower.includes("referenceerror")) return "runtime_error";
	if (lower.includes("merge conflict") || lower.includes("<<<<<<")) return "merge_conflict";
	if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
	if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("enotfound"))
		return "network_error";
	if (lower.includes("permission") || lower.includes("eacces") || lower.includes("eperm")) return "permission_error";
	if (lower.includes("build") || lower.includes("compile") || lower.includes("tsc")) return "build_failure";
	if (lower.includes("assertion") || lower.includes("fail")) return "test_failure";
	return "unknown";
}
