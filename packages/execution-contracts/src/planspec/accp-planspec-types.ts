/**
 * ACCP v2.0 PlanSpec Authority Boundary Types
 *
 * These types extend the PlanSpec v5 alpha2 schema with ACCP v2.0
 * authority, report, and mode policy fields. They live in execution-contracts
 * so they are available to the compiler, runtime, coding-agent, and TUI
 * without circular dependencies.
 *
 * ## Authority Design
 *
 * PlanSpec v5 declares ACCP authority boundaries but does NOT choose
 * the next ACCP mode or route. Key decisions:
 *
 * - `accp.modePolicy` — allowed modes (off, warn, required) and initial default
 * - `accp.compileRequired` — whether ACCP compilation is mandatory for this plan
 * - `accp.allowedInitialReports` — which report types may be the first ACCP output
 * - `accp.routeSignalsAreAdvisory` — route signals recommend; runtime authorizes
 * - `accp.runtimeAuthorityRequired` — runtime must check PlanSpec before acting on route signals
 * - `reports.protocol` — "ACCP" when ACCP reports are used
 * - `reports.version` — "2.0.0" for ACCP v2.0
 * - `reports.required` — list of report types that must be present before completion
 *
 * @packageDocumentation
 */

// NOTE: AccpMode is duplicated here for workspace independence (P49.02 defines
// PlanSpec authority boundary types independently of P49.03's type system).
// When both are committed, P49.03's accp-types.ts will become the canonical source.

/** ACCP mode: off, warn, required (P49.02 local definition). */
export type AccpMode = "off" | "warn" | "required";

/**
 * Configuration for ACCP mode policy in a plan.
 */
export interface AccpModePolicy {
	/** Default mode when the plan is loaded. */
	default: AccpMode;
	/** All modes allowed by this plan. */
	allowed: AccpMode[];
	/** Conditions under which mode may be promoted to 'required'. */
	promotionToRequiredRequires: string[];
}

/**
 * ACCP report protocol descriptor.
 */
export interface AccpReportProtocol {
	/** Protocol name: "ACCP" when ACCP reports are in use. */
	protocol: "ACCP" | string;
	/** Protocol version (e.g. "2.0.0"). */
	version: string;
	/** Source format (e.g. "ACCP-YAML"). */
	sourceFormat: string;
}

/**
 * PlanSpec ACCP requirement declaration.
 *
 * PlanSpec declares what ACCP reports and authority boundaries apply
 * to a plan. It does NOT choose the next ACCP route — that is driven
 * by compiled route-signal.json from the prior report.
 */
export interface PlanSpecAccpRequirements {
	/** Protocol descriptor. */
	protocol: AccpReportProtocol;
	/** Mode policy for this plan. */
	modePolicy: AccpModePolicy;
	/** Whether ACCP compilation is required for this plan's workspaces. */
	compileRequired: boolean;
	/** Report types that may be the first ACCP output for a workspace. */
	allowedInitialReports: string[];
	/** Whether route signals are advisory only. Default: true. */
	routeSignalsAreAdvisory: boolean;
	/** Whether runtime must check PlanSpec authority before acting on a route signal. */
	runtimeAuthorityRequired: boolean;
}

/**
 * PlanSpec ACCP report requirements.
 *
 * Declares which ACCP report types must be present before a workspace
 * or plan can complete, and at what severity level.
 */
export interface PlanSpecReportRequirements {
	/** Protocol descriptor (e.g. ACCP). */
	protocol: AccpReportProtocol;
	/** Report types that are required. */
	required: string[];
	/** Report types that are optional. */
	optional?: string[];
	/** Whether missing required reports block completion. */
	blocksCompletion: boolean;
}

/**
 * Complete ACCP extension for PlanSpec v5 alpha2.
 *
 * This is the aggregate of all ACCP-related fields that may appear
 * in a PlanSpec document. PlanSpec does not choose the next ACCP mode
 * or route; it only declares authority boundaries and requirements.
 */
export interface PlanSpecAccpExtension {
	/** ACCP protocol and mode policy. */
	accp: PlanSpecAccpRequirements;
	/** Report requirements (including ACCP protocol declaration). */
	reports: PlanSpecReportRequirements;
	/** Additional enforcement mechanisms enabled by ACCP. */
	accpMechanisms?: string[];
	/** Diagnostic code families from ACCP compiler. */
	accpDiagnosticFamilies?: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default ACCP mode policy for P49. */
export const DEFAULT_ACCP_MODE_POLICY: AccpModePolicy = {
	default: "warn",
	allowed: ["off", "warn", "required"],
	promotionToRequiredRequires: ["all_waves_passed", "e2e_gauntlets_passed", "operator_approval"],
};

/** Default ACCP report protocol descriptor. */
export const DEFAULT_ACCP_PROTOCOL: AccpReportProtocol = {
	protocol: "ACCP",
	version: "2.0.0",
	sourceFormat: "ACCP-YAML",
};

/** Default ACCP requirements for a PlanSpec that uses ACCP. */
export const DEFAULT_ACCP_REQUIREMENTS: PlanSpecAccpRequirements = {
	protocol: DEFAULT_ACCP_PROTOCOL,
	modePolicy: DEFAULT_ACCP_MODE_POLICY,
	compileRequired: false,
	allowedInitialReports: ["FCR", "TVR", "IPR", "BSR"],
	routeSignalsAreAdvisory: true,
	runtimeAuthorityRequired: true,
};

/** Default report requirements. */
export const DEFAULT_REPORT_REQUIREMENTS: PlanSpecReportRequirements = {
	protocol: DEFAULT_ACCP_PROTOCOL,
	required: [],
	optional: ["IPR", "TVR"],
	blocksCompletion: false,
};

/** Default ACCP extension (applied when PlanSpec does not declare ACCP). */
export const DEFAULT_ACCP_EXTENSION: PlanSpecAccpExtension = {
	accp: DEFAULT_ACCP_REQUIREMENTS,
	reports: DEFAULT_REPORT_REQUIREMENTS,
	accpMechanisms: ["accp_v2_yaml_parser", "accp_common_schema_validator", "accp_route_signal_compiler"],
	accpDiagnosticFamilies: [
		"ACCP_PARSE",
		"ACCP_SCHEMA",
		"ACCP_ID",
		"ACCP_REF",
		"ACCP_SEMANTIC",
		"ACCP_EVIDENCE",
		"ACCP_LINEAGE",
		"ACCP_ROUTE",
		"ACCP_GATE",
		"ACCP_AUTHORITY",
	],
};
