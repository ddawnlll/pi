/**
 * ACCP v2.0 Type System
 *
 * Core type definitions for the ACCP v2.0 protocol. These types are shared
 * across the compiler, runtime, coding-agent, TUI, web-server, and dashboard.
 *
 * ## Design
 *
 * All new types are additive. The legacy `WorkerRunResult.report: string`
 * field remains mandatory; the new `accp` field is optional.
 *
 * ## Authority Invariant
 *
 * ACCP types represent evidence and control flow. They do NOT authorize
 * execution, mutation, or workspace transitions. Route signals are advisory;
 * gate verdicts are diagnostic; reports are evidence-only.
 *
 * @packageDocumentation
 */

// =============================================================================
// Report types (24-type registry matching accp_v2_0_package/registry/)
// =============================================================================

/** All 24 ACCP report type identifiers. */
export type AccpReportType =
	// Core (8)
	| "RIR"
	| "PIR"
	| "IPR"
	| "TVR"
	| "HIR"
	| "RAR"
	| "PRR"
	| "CAR"
	// Bugfix (5)
	| "BSR"
	| "BRR"
	| "RCA"
	| "FPR"
	| "FVR"
	// Feature (5)
	| "FER"
	| "FDR"
	| "FCR"
	| "FIR"
	| "FGR"
	// Writing (4)
	| "WBR"
	| "WDR"
	| "WER"
	| "WQR"
	// Coordination (2)
	| "ECR"
	| "DCR";

/** Report family grouping. */
export type AccpReportFamily = "core" | "bugfix" | "feature" | "writing" | "coordination";

/** ACCP support level (from accp_v2_0_package/registry/support_matrix.json). */
export type AccpSupportLevel = "known" | "template_available" | "schema_lite" | "schema_strict" | "gate_blocking";

// =============================================================================
// ACCP mode
// =============================================================================

/**
 * ACCP operational mode.
 * - off: ACCP is completely disabled (no compilation, injection, or gating)
 * - warn: ACCP runs in diagnostic mode; findings are surfaced but non-blocking
 * - required: ACCP gates must pass for workspace transitions
 */
export type AccpMode = "off" | "warn" | "required";

// =============================================================================
// Compile status
// =============================================================================

export type AccpCompileStatus = "not_compiled" | "compiled" | "compiled_with_warnings" | "failed";

// =============================================================================
// Diagnostic
// =============================================================================

/** A single diagnostic from the ACCP compiler or validator. */
export interface AccpDiagnostic {
	/** Diagnostic code (e.g. "ACCP_PARSE_YAML_INVALID"). */
	code: string;
	/** Human-readable message. */
	message: string;
	/** Severity. */
	severity: "error" | "warning" | "info";
	/** Whether this finding blocks gate passage. */
	fatal: boolean;
	/** Optional source file path. */
	sourcePath?: string;
	/** Optional report ID the diagnostic relates to. */
	reportId?: string;
}

// =============================================================================
// Compile result
// =============================================================================

/** Result of compiling an ACCP YAML source document. */
export interface AccpCompileResult {
	/** Overall status. */
	status: AccpCompileStatus;
	/** Report ID of the compiled source. */
	reportId: string;
	/** Report type. */
	reportType: AccpReportType;
	/** All diagnostics from compilation. */
	diagnostics: AccpDiagnostic[];
	/** Compiled JSON path (relative to reports/accp/{plan_id}/compiled/). */
	compiledPath?: string;
	/** IR path. */
	irPath?: string;
	/** Whether compilation produced a severe enough error to block gates. */
	hasBlockingFindings: boolean;
}

// =============================================================================
// Route signal
// =============================================================================

/**
 * ACCP route signal — compiled from an ACCP report.
 *
 * ## Authority
 *
 * Route signals are advisory. They recommend a next route target but do NOT
 * authorize execution, mutation, or workspace transition. Runtime must check
 * PlanSpec authority, write gate, and command policy before acting on a
 * route signal.
 */
export interface AccpRouteSignal {
	/** Report ID that produced this route signal. */
	sourceReportId: string;
	/** Report type that produced this route signal. */
	sourceReportType: AccpReportType;
	/** Recommended next report type / action. */
	recommendedNextAction: string;
	/** Recommended next route target (report type, agent role, or command class). */
	recommendedNextRoute: string;
	/** Confidence level in the recommendation. */
	confidence: "high" | "medium" | "low";
	/** Whether this is advisory (always true by design). */
	isAdvisory: boolean;
	/** Whether mutation policy is needed for this route. */
	mutationPolicyNeeded: "none" | "read_only" | "validation_only" | "mutation_allowed";
	/** Whether the route target was resolved. */
	targetResolved: boolean;
	/** Unresolved target refs (if any). */
	unresolvedRefs?: string[];
}

// =============================================================================
// Gate verdict
// =============================================================================

/**
 * ACCP gate verdict — compiled from an ACCP report's gate evaluation.
 *
 * Gate verdicts are diagnostic only. They record whether a report's
 * evidence and findings indicate gate passage or blocking. The runtime
 * (CompletionGateV2, TransitionRouter) uses these as inputs, not as
 * authoritative decisions.
 */
export interface AccpGateVerdict {
	/** Report ID this verdict applies to. */
	reportId: string;
	/** Report type. */
	reportType: AccpReportType;
	/** Whether the report gate passes. */
	valid: boolean;
	/** Fatal errors that prevent gate passage. */
	fatalErrors: string[];
	/** Warnings that do not block gate passage. */
	warnings: string[];
	/** Blocking findings (fatal items with structured detail). */
	blockingFindings: string[];
	/** Number of findings. */
	findingCount: number;
	/** Whether the report is promotion-ready. */
	promotionReady: boolean;
	/** Evidence status that produced this verdict. */
	evidenceStatus: "complete" | "partial" | "missing" | "not_checked";
	/** Additional context. */
	details?: Record<string, unknown>;
}

// =============================================================================
// Finding
// =============================================================================

/** A structured finding from ACCP validation or gate evaluation. */
export interface AccpFinding {
	/** Finding ID. */
	id: string;
	/** Severity. */
	severity: "blocking" | "warning" | "info";
	/** Finding category code. */
	category: string;
	/** Human-readable message. */
	message: string;
	/** Report type this finding relates to. */
	reportType?: AccpReportType;
	/** Optional source reference. */
	sourceRef?: string;
}

// =============================================================================
// Worker ACCP output
// =============================================================================

/**
 * Optional ACCP output attached to a WorkerRunResult.
 *
 * This is an additive extension. The legacy `report: string` field remains
 * mandatory. When ACCP mode is active, workers may also populate this
 * structured ACCP output.
 */
export interface AccpWorkerOutput {
	/** Report type emitted by the worker. */
	reportType: AccpReportType;
	/** Report ID. */
	reportId: string;
	/** Raw ACCP YAML source produced by the worker. */
	sourceYaml?: string;
	/** Compiled JSON artifact path (set after compilation). */
	compiledArtifactPath?: string;
	/** Route signal emitted (if any). */
	routeSignal?: AccpRouteSignal;
	/** Gate verdict (if evaluated). */
	gateVerdict?: AccpGateVerdict;
	/** Diagnostics from compilation. */
	diagnostics?: AccpDiagnostic[];
	/** Whether compilation should be attempted. */
	shouldCompile: boolean;
	/** Repair prompt generated by the repair loop (if compilation had blocking findings). */
	repairPrompt?: string;
}

// =============================================================================
// Intermediate representation
// =============================================================================

/** ACCP intermediate representation (IR) — structured data between parsed YAML and compiled output. */
export interface AccpIntermediateRepresentation {
	/** Source report ID. */
	sourceReportId: string;
	/** Report type. */
	reportType: AccpReportType;
	/** Report family. */
	family: AccpReportFamily;
	/** Parsed sections keyed by section name. */
	sections: Record<string, unknown>;
	/** Diagnostics collected during parsing/validation. */
	diagnostics: AccpDiagnostic[];
	/** References to other reports. */
	references: string[];
	/** Lineage info. */
	lineage?: {
		parentReport?: string;
		supersedes?: string;
	};
}

// =============================================================================
// Artifact reference
// =============================================================================

/** Reference to a compiled ACCP artifact on disk. */
export interface AccpArtifactRef {
	/** Artifact type. */
	type: "compiled" | "ir" | "verdict" | "route" | "rendered" | "graph" | "index";
	/** Relative path from reports/accp/{plan_id}/. */
	path: string;
	/** Content hash (sha256). */
	hash?: string;
	/** Report ID this artifact belongs to. */
	reportId?: string;
}

// =============================================================================
// Task envelope (bridge from user intent to compiled routing)
// =============================================================================

/**
 * Initial route indicator — produced by TUI mode picker selection.
 *
 * Bridges free-form user intent into the compiled route signal pipeline.
 * Does NOT authorize execution.
 */
export interface InitialRouteIndicator {
	/** User-selected initial report type / action. */
	initialAction: string;
	/** Confidence from selection (always "high" for user-selected). */
	confidence: "high";
	/** Whether runtime authority check is required before this route executes. */
	runtimeAuthorityRequired: boolean;
	/** Whether this is advisory (false — user selection is explicit intent). */
	isAdvisory: false;
}

/**
 * ACCP task envelope — structured input to the route bus.
 */
export interface AccpTaskEnvelope {
	/** Task ID. */
	taskId: string;
	/** Initial route indicator (from TUI or deterministic). */
	initialRoute: InitialRouteIndicator;
	/** Report types to produce. */
	targetReportTypes: AccpReportType[];
	/** Workspace context. */
	workspaceContext?: Record<string, unknown>;
}
