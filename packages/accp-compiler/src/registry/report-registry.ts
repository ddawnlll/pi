/**
 * ACCP Report Registry — 24-Type Matrix
 *
 * Canonical registry of all 24 ACCP v2.0 report types with metadata.
 * Derived from accp_v2_0_package/registry/report_registry.json.
 *
 * ## Authority Note
 *
 * Registry entries describe report types. They do NOT authorize
 * execution, mutation, or workspace transitions. Support levels
 * indicate schema strictness, not gate authority.
 *
 * @packageDocumentation
 */

import type { AccpReportFamily, AccpReportType, AccpSupportLevel } from "@earendil-works/pi-execution-contracts";

// =============================================================================
// Registry entry
// =============================================================================

/** A single entry in the ACCP report registry. */
export interface AccpReportRegistryEntry {
	/** Report type code (e.g. "BSR", "TVR", "PRR"). */
	type: AccpReportType;
	/** Report family. */
	family: AccpReportFamily;
	/** Human-readable name. */
	name: string;
	/** Support level for this type. */
	supportLevel: AccpSupportLevel;
	/** Whether this type is gate-critical (blocks completion when failing). */
	gateCritical: boolean;
	/** Whether this type has a strict schema. */
	hasStrictSchema: boolean;
}

// =============================================================================
// Registry definition
// =============================================================================

/**
 * Complete ACCP v2.0 report registry with all 24 types.
 * Ordered by family: core, bugfix, feature, writing, coordination.
 */
export const ACCP_REPORT_REGISTRY: AccpReportRegistryEntry[] = [
	// Core (8)
	{
		type: "RIR",
		family: "core",
		name: "Repo Inspection Report",
		supportLevel: "schema_lite",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "PIR",
		family: "core",
		name: "Plan Inspection Report",
		supportLevel: "schema_lite",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "IPR",
		family: "core",
		name: "Implementation Patch Report",
		supportLevel: "schema_strict",
		gateCritical: false,
		hasStrictSchema: true,
	},
	{
		type: "TVR",
		family: "core",
		name: "Test Validation Report",
		supportLevel: "schema_strict",
		gateCritical: true,
		hasStrictSchema: true,
	},
	{
		type: "HIR",
		family: "core",
		name: "Handoff / Intervention Report",
		supportLevel: "schema_strict",
		gateCritical: true,
		hasStrictSchema: true,
	},
	{
		type: "RAR",
		family: "core",
		name: "Regression Analysis Report",
		supportLevel: "schema_lite",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "PRR",
		family: "core",
		name: "Promotion Readiness Report",
		supportLevel: "schema_strict",
		gateCritical: true,
		hasStrictSchema: true,
	},
	{
		type: "CAR",
		family: "core",
		name: "Correction / Amendment Report",
		supportLevel: "schema_strict",
		gateCritical: true,
		hasStrictSchema: true,
	},
	// Bugfix (5)
	{
		type: "BSR",
		family: "bugfix",
		name: "Bug Search Report",
		supportLevel: "schema_strict",
		gateCritical: true,
		hasStrictSchema: true,
	},
	{
		type: "BRR",
		family: "bugfix",
		name: "Bug Reproduction Report",
		supportLevel: "schema_lite",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "RCA",
		family: "bugfix",
		name: "Root Cause Analysis Report",
		supportLevel: "schema_lite",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "FPR",
		family: "bugfix",
		name: "Fix Patch Report",
		supportLevel: "schema_strict",
		gateCritical: true,
		hasStrictSchema: true,
	},
	{
		type: "FVR",
		family: "bugfix",
		name: "Fix Validation Report",
		supportLevel: "schema_lite",
		gateCritical: false,
		hasStrictSchema: false,
	},
	// Feature (5)
	{
		type: "FER",
		family: "feature",
		name: "Feature Exploration Report",
		supportLevel: "template_available",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "FDR",
		family: "feature",
		name: "Feature Design Report",
		supportLevel: "template_available",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "FCR",
		family: "feature",
		name: "Feature Contract Report",
		supportLevel: "template_available",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "FIR",
		family: "feature",
		name: "Feature Implementation Report",
		supportLevel: "template_available",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "FGR",
		family: "feature",
		name: "Feature Gate Report",
		supportLevel: "template_available",
		gateCritical: false,
		hasStrictSchema: false,
	},
	// Writing (4)
	{
		type: "WBR",
		family: "writing",
		name: "Writing Brief Report",
		supportLevel: "template_available",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "WDR",
		family: "writing",
		name: "Writing Draft Report",
		supportLevel: "template_available",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "WER",
		family: "writing",
		name: "Writing Edit Report",
		supportLevel: "template_available",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "WQR",
		family: "writing",
		name: "Writing Quality Review Report",
		supportLevel: "template_available",
		gateCritical: false,
		hasStrictSchema: false,
	},
	// Coordination (2)
	{
		type: "ECR",
		family: "coordination",
		name: "Evidence Capsule Report",
		supportLevel: "schema_lite",
		gateCritical: false,
		hasStrictSchema: false,
	},
	{
		type: "DCR",
		family: "coordination",
		name: "Decision / Conflict Report",
		supportLevel: "schema_lite",
		gateCritical: false,
		hasStrictSchema: false,
	},
];

// =============================================================================
// Lookup helpers
// =============================================================================

/** Map from report type code to registry entry. */
export const ACCP_REPORT_REGISTRY_BY_TYPE: ReadonlyMap<AccpReportType, AccpReportRegistryEntry> = new Map(
	ACCP_REPORT_REGISTRY.map((entry) => [entry.type, entry]),
);

/**
 * Look up a report type in the registry.
 * Returns undefined for unknown types.
 */
export function lookupReportType(type: string): AccpReportRegistryEntry | undefined {
	return ACCP_REPORT_REGISTRY_BY_TYPE.get(type as AccpReportType);
}

/**
 * Get all report types in a given family.
 */
export function getReportTypesByFamily(family: AccpReportFamily): AccpReportRegistryEntry[] {
	return ACCP_REPORT_REGISTRY.filter((entry) => entry.family === family);
}

/**
 * Get all gate-critical report types.
 */
export function getGateCriticalReportTypes(): AccpReportRegistryEntry[] {
	return ACCP_REPORT_REGISTRY.filter((entry) => entry.gateCritical);
}

/**
 * Get all report types with a specific support level.
 */
export function getReportTypesBySupportLevel(level: AccpSupportLevel): AccpReportRegistryEntry[] {
	return ACCP_REPORT_REGISTRY.filter((entry) => entry.supportLevel === level);
}

/**
 * Validate that a report type code is known.
 */
export function isKnownReportType(type: string): type is AccpReportType {
	return ACCP_REPORT_REGISTRY_BY_TYPE.has(type as AccpReportType);
}
