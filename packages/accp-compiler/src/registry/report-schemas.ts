import type { AccpReportType, AccpSupportLevel } from "@earendil-works/pi-execution-contracts";

/**
 * Report schema metadata for each ACCP report type.
 * Defines which sections are required for each type.
 */
export interface ReportSchemaDef {
	type: AccpReportType;
	supportLevel: AccpSupportLevel;
	requiredSections: string[];
	description: string;
}

/**
 * Schema definitions for all report types.
 * Gate-critical types (BSR, FPR, TVR, PRR, HIR, CAR) have
 * strict sections defined. Other types have minimal or no requirements.
 */
export const ACCP_REPORT_SCHEMAS: ReportSchemaDef[] = [
	// Gate-critical / strict
	{
		type: "TVR",
		supportLevel: "schema_strict",
		requiredSections: ["validation_summary", "command_results"],
		description: "Test Validation Report",
	},
	{
		type: "PRR",
		supportLevel: "schema_strict",
		requiredSections: ["promotion_decision"],
		description: "Promotion Readiness Report",
	},
	{ type: "BSR", supportLevel: "schema_strict", requiredSections: ["bug_findings"], description: "Bug Search Report" },
	{ type: "FPR", supportLevel: "schema_strict", requiredSections: ["fix_actions"], description: "Fix Patch Report" },
	{
		type: "HIR",
		supportLevel: "schema_strict",
		requiredSections: ["intervention_details"],
		description: "Handoff / Intervention Report",
	},
	{
		type: "CAR",
		supportLevel: "schema_strict",
		requiredSections: ["correction_actions"],
		description: "Correction / Amendment Report",
	},
	// Schema-lite
	{ type: "RIR", supportLevel: "schema_lite", requiredSections: [], description: "Repo Inspection Report" },
	{ type: "PIR", supportLevel: "schema_lite", requiredSections: [], description: "Plan Inspection Report" },
	{
		type: "IPR",
		supportLevel: "schema_lite",
		requiredSections: ["implementation_summary", "changes"],
		description: "Implementation Patch Report",
	},
	{
		type: "ECR",
		supportLevel: "schema_lite",
		requiredSections: ["evidence_items"],
		description: "Evidence Capsule Report",
	},
	{
		type: "DCR",
		supportLevel: "schema_lite",
		requiredSections: ["decision"],
		description: "Decision / Conflict Report",
	},
	// Template-only (minimal sections)
	{ type: "FER", supportLevel: "template_available", requiredSections: [], description: "Feature Exploration Report" },
	{ type: "FDR", supportLevel: "template_available", requiredSections: [], description: "Feature Design Report" },
	{ type: "FCR", supportLevel: "template_available", requiredSections: [], description: "Feature Contract Report" },
	{
		type: "FIR",
		supportLevel: "template_available",
		requiredSections: [],
		description: "Feature Implementation Report",
	},
	{ type: "FGR", supportLevel: "template_available", requiredSections: [], description: "Feature Gate Report" },
	{ type: "WBR", supportLevel: "template_available", requiredSections: [], description: "Writing Brief Report" },
	{ type: "WDR", supportLevel: "template_available", requiredSections: [], description: "Writing Draft Report" },
	{ type: "WER", supportLevel: "template_available", requiredSections: [], description: "Writing Edit Report" },
	{
		type: "WQR",
		supportLevel: "template_available",
		requiredSections: [],
		description: "Writing Quality Review Report",
	},
	{ type: "BRR", supportLevel: "template_available", requiredSections: [], description: "Bug Reproduction Report" },
	{ type: "RCA", supportLevel: "template_available", requiredSections: [], description: "Root Cause Analysis Report" },
	{ type: "FVR", supportLevel: "template_available", requiredSections: [], description: "Fix Validation Report" },
];

/** Map from report type to its schema definition. */
export const ACCP_REPORT_SCHEMAS_BY_TYPE: ReadonlyMap<string, ReportSchemaDef> = new Map(
	ACCP_REPORT_SCHEMAS.map((def) => [def.type, def]),
);

/**
 * Get the schema definition for a given report type.
 */
export function getReportSchema(type: AccpReportType): ReportSchemaDef | undefined {
	return ACCP_REPORT_SCHEMAS_BY_TYPE.get(type);
}

/**
 * Check if a report type has a known schema.
 */
export function hasKnownSchema(type: string): boolean {
	return ACCP_REPORT_SCHEMAS_BY_TYPE.has(type);
}
