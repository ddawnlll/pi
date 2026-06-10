/**
 * P44.01 — Traceability Schema
 *
 * Defines the formal schema for traceability links between acceptance
 * criteria and evidence artifacts. Each link describes the nature of
 * the relationship between a criterion and the evidence that supports,
 * proves, or contradicts it.
 *
 * This module provides the core types and functions for establishing
 * and reporting on traceability. It is consumed by the acceptance
 * criteria system (acceptance-criteria.ts) and the evidence ledger.
 *
 * Schema: 4.1.2
 */

import type { EvidenceLedgerEntry } from "./evidence-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for traceability definitions.
 */
export const TRACEABILITY_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The nature of the relationship between a criterion and an evidence entry.
 * - `proves`: Evidence directly proves the criterion is satisfied
 * - `supports`: Evidence partially supports the criterion
 * - `contradicts`: Evidence contradicts the criterion (indicates failure)
 * - `references`: Evidence is contextually related but not directly proving
 */
export type TraceabilityRelationship = "proves" | "supports" | "contradicts" | "references";

/**
 * A traceability link between a criterion and an evidence entry.
 *
 * Links form the core of the traceability schema, connecting acceptance
 * criteria to the evidence artifacts that verify them.
 */
export interface TraceabilityLink {
	/** Criterion ID the link originates from */
	criterionId: string;
	/** Evidence entry ID the link targets */
	evidenceId: string;
	/** The nature of the relationship */
	relationship: TraceabilityRelationship;
	/** Optional explanation of why the link exists */
	explanation: string;
	/** When the link was established (epoch ms) */
	createdAt: number;
}

/**
 * Partial link input for creating links with minimal fields.
 * `createdAt` defaults to the current time when not provided.
 */
export interface TraceabilityLinkInput {
	/** Criterion ID */
	criterionId: string;
	/** Evidence entry ID */
	evidenceId: string;
	/** The nature of the relationship (default: "proves") */
	relationship?: TraceabilityRelationship;
	/** Optional explanation */
	explanation?: string;
}

/**
 * A traceability report summarizing the links between criteria and evidence.
 */
export interface TraceabilityReport {
	/** Scope identifier */
	scopeId: string;
	/** Schema version used for this report */
	schemaVersion: string;
	/** Total number of criteria */
	totalCriteria: number;
	/** Total number of evidence entries referenced */
	totalEvidence: number;
	/** Total number of traceability links */
	totalLinks: number;
	/** Breakdown of links by relationship type */
	byRelationship: Record<TraceabilityRelationship, number>;
	/** Timestamp when the report was generated (epoch ms) */
	generatedAt: number;
	/** All traceability links in the report */
	links: TraceabilityLink[];
}

// ---------------------------------------------------------------------------
// Link Creation
// ---------------------------------------------------------------------------

/**
 * Create a traceability link from a partial input.
 *
 * @param input - Partial link input
 * @returns A fully populated TraceabilityLink
 */
export function createLink(input: TraceabilityLinkInput): TraceabilityLink {
	return {
		criterionId: input.criterionId,
		evidenceId: input.evidenceId,
		relationship: input.relationship ?? "proves",
		explanation: input.explanation ?? "",
		createdAt: Date.now(),
	};
}

/**
 * Create a traceability link with explicit parameters.
 *
 * @param criterionId - Criterion ID
 * @param evidenceId - Evidence entry ID
 * @param relationship - Nature of the link (default: "proves")
 * @param explanation - Optional explanation
 * @returns A fully populated TraceabilityLink
 */
export function createTraceabilityLink(
	criterionId: string,
	evidenceId: string,
	relationship: TraceabilityRelationship = "proves",
	explanation: string = "",
): TraceabilityLink {
	return {
		criterionId,
		evidenceId,
		relationship,
		explanation,
		createdAt: Date.now(),
	};
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a traceability link.
 *
 * @param link - The link to validate
 * @returns An array of validation error messages (empty if valid)
 */
export function validateLink(link: TraceabilityLink): string[] {
	const errors: string[] = [];

	if (!link.criterionId || link.criterionId.trim().length === 0) {
		errors.push("criterionId is required");
	}
	if (!link.evidenceId || link.evidenceId.trim().length === 0) {
		errors.push("evidenceId is required");
	}
	const validRelationships: TraceabilityRelationship[] = ["proves", "supports", "contradicts", "references"];
	if (!validRelationships.includes(link.relationship)) {
		errors.push(`relationship must be one of: ${validRelationships.join(", ")}`);
	}
	if (!link.createdAt || link.createdAt <= 0) {
		errors.push("createdAt must be a positive timestamp");
	}

	return errors;
}

/**
 * Check whether a traceability link is valid.
 *
 * @param link - The link to check
 * @returns True if the link passes all validation rules
 */
export function isValidLink(link: TraceabilityLink): boolean {
	return validateLink(link).length === 0;
}

// ---------------------------------------------------------------------------
// Queries & Analysis
// ---------------------------------------------------------------------------

/**
 * Filter links that match a given relationship type.
 *
 * @param links - Array of traceability links
 * @param relationship - Relationship type to filter by
 * @returns Filtered array of links
 */
export function filterLinksByRelationship(
	links: TraceabilityLink[],
	relationship: TraceabilityRelationship,
): TraceabilityLink[] {
	return links.filter((l) => l.relationship === relationship);
}

/**
 * Get links for a specific criterion.
 *
 * @param links - Array of traceability links
 * @param criterionId - Criterion ID to filter by
 * @returns Links targeting the given criterion
 */
export function getLinksForCriterion(links: TraceabilityLink[], criterionId: string): TraceabilityLink[] {
	return links.filter((l) => l.criterionId === criterionId);
}

/**
 * Get links that reference a specific evidence entry.
 *
 * @param links - Array of traceability links
 * @param evidenceId - Evidence entry ID to filter by
 * @returns Links referencing the given evidence
 */
export function getLinksForEvidence(links: TraceabilityLink[], evidenceId: string): TraceabilityLink[] {
	return links.filter((l) => l.evidenceId === evidenceId);
}

/**
 * Build a map of criterion IDs to their traceability links.
 *
 * @param links - Array of traceability links
 * @returns Map keyed by criterion ID
 */
export function buildCriterionLinkMap(links: TraceabilityLink[]): Map<string, TraceabilityLink[]> {
	const map = new Map<string, TraceabilityLink[]>();
	for (const link of links) {
		const existing = map.get(link.criterionId);
		if (existing) {
			existing.push(link);
		} else {
			map.set(link.criterionId, [link]);
		}
	}
	return map;
}

/**
 * Build a map of evidence IDs to their traceability links.
 *
 * @param links - Array of traceability links
 * @returns Map keyed by evidence ID
 */
export function buildEvidenceLinkMap(links: TraceabilityLink[]): Map<string, TraceabilityLink[]> {
	const map = new Map<string, TraceabilityLink[]>();
	for (const link of links) {
		const existing = map.get(link.evidenceId);
		if (existing) {
			existing.push(link);
		} else {
			map.set(link.evidenceId, [link]);
		}
	}
	return map;
}

/**
 * Count links by relationship type.
 *
 * @param links - Array of traceability links
 * @returns Record mapping each relationship type to its count
 */
export function countLinksByRelationship(links: TraceabilityLink[]): Record<TraceabilityRelationship, number> {
	const counts: Record<TraceabilityRelationship, number> = {
		proves: 0,
		supports: 0,
		contradicts: 0,
		references: 0,
	};
	for (const link of links) {
		counts[link.relationship]++;
	}
	return counts;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Build a traceability report from criteria and evidence.
 *
 * @param scopeId - Scope identifier
 * @param links - Array of traceability links
 * @returns A formatted TraceabilityReport
 */
export function buildReport(scopeId: string, links: TraceabilityLink[]): TraceabilityReport {
	const byRelationship = countLinksByRelationship(links);
	const evidenceIds = new Set(links.map((l) => l.evidenceId));
	const criterionIds = new Set(links.map((l) => l.criterionId));

	return {
		scopeId,
		schemaVersion: TRACEABILITY_SCHEMA_VERSION,
		totalCriteria: criterionIds.size,
		totalEvidence: evidenceIds.size,
		totalLinks: links.length,
		byRelationship,
		generatedAt: Date.now(),
		links: [...links],
	};
}

/**
 * Build a human-readable traceability report string.
 * Renders links organized by criterion with their associated evidence.
 *
 * @param links - Array of traceability links
 * @param evidenceEntries - Array of evidence ledger entries (for descriptions)
 * @returns A formatted multi-line string report
 */
export function buildTraceabilityReport(
	links: TraceabilityLink[],
	evidenceEntries: EvidenceLedgerEntry[] = [],
): string {
	const evidenceMap = new Map(evidenceEntries.map((e) => [e.id, e]));
	const byCriterion = buildCriterionLinkMap(links);
	const lines: string[] = [];

	lines.push("# Traceability Report");
	lines.push(`Schema: ${TRACEABILITY_SCHEMA_VERSION}`);
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push(`Total Links: ${links.length}, Distinct Criteria: ${byCriterion.size}`);
	lines.push("");

	if (byCriterion.size === 0) {
		lines.push("No traceability links established.");
		lines.push("");
		return lines.join("\n");
	}

	for (const [criterionId, criterionLinks] of byCriterion) {
		lines.push(`## ${criterionId}`);
		for (const link of criterionLinks) {
			const evidence = evidenceMap.get(link.evidenceId);
			const evidenceDesc = evidence ? `"${evidence.description}"` : "(unknown evidence)";
			lines.push(`  - [${link.relationship}] ${link.evidenceId}: ${evidenceDesc}`);
			if (link.explanation) {
				lines.push(`    - ${link.explanation}`);
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}
