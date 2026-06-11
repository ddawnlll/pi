/**
 * ACCP Support Level Matrix
 *
 * Defines support levels and which report types belong to each level.
 * Derived from accp_v2_0_package/registry/support_matrix.json.
 *
 * ## Support Levels
 *
 * - known: Type is registered and known but may have no schema or template
 * - template_available: Type has a prompt contract template
 * - schema_lite: Type has a minimal validation schema
 * - schema_strict: Type has a full validation schema (gate-critical)
 * - gate_blocking: Type is both strict and blocks completion on failure
 *
 * @packageDocumentation
 */

import type { AccpReportType, AccpSupportLevel } from "@earendil-works/pi-execution-contracts";

/** Support level metadata. */
export interface AccpSupportLevelInfo {
	level: AccpSupportLevel;
	description: string;
	hasSchema: boolean;
	hasTemplate: boolean;
	isGateBlocking: boolean;
}

/** All support levels with metadata. */
export const ACCP_SUPPORT_LEVELS: AccpSupportLevelInfo[] = [
	{
		level: "known",
		description: "Type is registered but has no schema or template",
		hasSchema: false,
		hasTemplate: false,
		isGateBlocking: false,
	},
	{
		level: "template_available",
		description: "Type has a prompt contract template but no strict schema",
		hasSchema: false,
		hasTemplate: true,
		isGateBlocking: false,
	},
	{
		level: "schema_lite",
		description: "Type has a minimal validation schema",
		hasSchema: true,
		hasTemplate: false,
		isGateBlocking: false,
	},
	{
		level: "schema_strict",
		description: "Type has a full validation schema",
		hasSchema: true,
		hasTemplate: false,
		isGateBlocking: false,
	},
	{
		level: "gate_blocking",
		description: "Type has a strict schema and gate-critical",
		hasSchema: true,
		hasTemplate: false,
		isGateBlocking: true,
	},
];

// Gate-critical report types (p46_gate_critical from support_matrix.json)
export const ACCP_GATE_CRITICAL_TYPES: AccpReportType[] = ["BSR", "FPR", "TVR", "PRR", "HIR", "CAR"];

// Schema-lite report types (p46_schema_lite from support_matrix.json)
export const ACCP_SCHEMA_LITE_TYPES: AccpReportType[] = ["RIR", "PIR", "IPR", "ECR", "DCR"];

// Template-only report types (p46_template_only from support_matrix.json)
export const ACCP_TEMPLATE_ONLY_TYPES: AccpReportType[] = [
	"BRR",
	"RCA",
	"FVR",
	"FER",
	"FDR",
	"FCR",
	"FIR",
	"FGR",
	"WBR",
	"WDR",
	"WER",
	"WQR",
];

/**
 * Get the support level for a specific report type.
 * Returns undefined for unknown types.
 */
export function getSupportLevel(type: AccpReportType): AccpSupportLevel | undefined {
	if (ACCP_GATE_CRITICAL_TYPES.includes(type)) return "schema_strict";
	if (ACCP_SCHEMA_LITE_TYPES.includes(type)) return "schema_lite";
	if (ACCP_TEMPLATE_ONLY_TYPES.includes(type)) return "template_available";
	return undefined;
}
