/**
 * Debugger Worker — Root Cause Analyzer — 25.I
 *
 * Analyzes structured evidence from the EvidenceSummarizer to identify
 * root causes of failures. Produces actionable RootCauseAnalysis results
 * with evidence chains, confidence scoring, and remediation suggestions.
 *
 * Key design:
 * - Evidence patterns are matched against known failure signatures.
 * - Each root cause is linked to specific evidence items (evidence chain).
 * - Remediation steps are derived from the identified root cause.
 * - All findings carry confidence scores for diagnostic filtering.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import type { EvidenceItem, EvidenceSummary, EvidenceType } from "./evidence-summarizer.js";

// ---------------------------------------------------------------------------
// Root Cause Types
// ---------------------------------------------------------------------------

/**
 * Category of a root cause finding.
 */
export type RootCauseCategory =
	| "dependency_failure"
	| "configuration_error"
	| "runtime_error"
	| "resource_exhaustion"
	| "logic_error"
	| "external_service"
	| "permission_denied"
	| "timeout"
	| "unknown";

/**
 * All valid RootCauseCategory values for runtime validation.
 */
export const ALL_ROOT_CAUSE_CATEGORIES: readonly RootCauseCategory[] = [
	"dependency_failure",
	"configuration_error",
	"runtime_error",
	"resource_exhaustion",
	"logic_error",
	"external_service",
	"permission_denied",
	"timeout",
	"unknown",
] as const;

/**
 * Human-readable labels for each root cause category.
 */
export const ROOT_CAUSE_CATEGORY_LABELS: Record<RootCauseCategory, string> = {
	dependency_failure: "Dependency Failure",
	configuration_error: "Configuration Error",
	runtime_error: "Runtime Error",
	resource_exhaustion: "Resource Exhaustion",
	logic_error: "Logic Error",
	external_service: "External Service",
	permission_denied: "Permission Denied",
	timeout: "Timeout",
	unknown: "Unknown",
};

/**
 * Suggested remediation for each root cause category.
 */
export const ROOT_CAUSE_REMEDIATIONS: Record<RootCauseCategory, string[]> = {
	dependency_failure: [
		"Check if all required dependencies are installed and accessible",
		"Verify version compatibility between dependent components",
		"Check network connectivity to dependency sources",
		"Ensure dependency service is running and healthy",
	],
	configuration_error: [
		"Review configuration file for syntax errors or missing fields",
		"Verify environment variables are set correctly",
		"Check configuration against documented schema",
		"Ensure configuration changes are properly applied",
	],
	runtime_error: [
		"Examine stack trace for specific error location",
		"Check for null/undefined values at the point of failure",
		"Verify input data types and formats",
		"Add defensive checks around the failing operation",
	],
	resource_exhaustion: [
		"Check available memory, disk space, and CPU usage",
		"Review token budget and cycle limits",
		"Consider increasing resource limits or reducing workload",
		"Check for resource leaks (file handles, connections, memory)",
	],
	logic_error: [
		"Review algorithm or business logic for edge cases",
		"Check conditional branches and loop termination conditions",
		"Verify data transformation and state management",
		"Add unit tests covering the failing scenario",
	],
	external_service: [
		"Verify API credentials and authentication tokens",
		"Check external service status page for outages",
		"Review API rate limits and quota usage",
		"Implement retry with exponential backoff",
	],
	permission_denied: [
		"Check file and directory permissions",
		"Verify user/role has required access rights",
		"Review security policy configuration",
		"Check credential validity and expiry",
	],
	timeout: [
		"Increase operation timeout limits if appropriate",
		"Optimize slow operations or queries",
		"Check for deadlock or long-running transactions",
		"Consider splitting large operations into smaller batches",
	],
	unknown: [
		"Collect additional evidence (logs, state snapshots, diagnostics)",
		"Review recent changes that may have introduced the issue",
		"Enable verbose logging and reproduce the failure",
		"Escalate to a more specialized diagnostic tool",
	],
};

// ---------------------------------------------------------------------------
// Root Cause Finding
// ---------------------------------------------------------------------------

/**
 * A single root cause finding with evidence chain and remediation.
 */
export interface RootCauseFinding {
	/** Unique finding identifier */
	id: string;

	/** Category of this root cause */
	category: RootCauseCategory;

	/** Human-readable summary of the finding */
	title: string;

	/** Detailed description of the root cause */
	description: string;

	/** Confidence in this finding (0.0 - 1.0) */
	confidence: number;

	/** Evidence item IDs that support this finding */
	evidenceIds: string[];

	/** Suggested remediation steps */
	remediation: string[];

	/** Pattern or heuristic that triggered this finding */
	matchedPattern: string;

	/** Whether this finding is definitive or requires more evidence */
	definitive: boolean;
}

// ---------------------------------------------------------------------------
// Root Cause Analysis Result
// ---------------------------------------------------------------------------

/**
 * Complete root cause analysis result.
 */
export interface RootCauseAnalysis {
	/** Unique analysis identifier */
	id: string;

	/** ISO 8601 timestamp of analysis creation */
	createdAt: string;

	/** Session / correlation ID from the evidence summary */
	sessionId: string;

	/** Evidence summary ID that this analysis is based on */
	evidenceSummaryId: string;

	/** All root cause findings, sorted by confidence descending */
	findings: RootCauseFinding[];

	/** Primary root cause (highest confidence finding) */
	primaryCause: RootCauseFinding | null;

	/** Overall confidence in the analysis (average of top 3 findings) */
	overallConfidence: number;

	/** Whether the analysis is considered actionable */
	actionable: boolean;

	/** Reasons the analysis may not be actionable */
	limitations: string[];

	/** Evidence types that were analyzed but yielded no findings */
	unusedEvidenceTypes: EvidenceType[];
}

// ---------------------------------------------------------------------------
// Analysis Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the RootCauseAnalyzer.
 */
export interface RootCauseAnalyzerConfig {
	/**
	 * Minimum confidence threshold for a finding to be included.
	 * Default: 0.3
	 */
	minConfidence: number;

	/**
	 * Maximum number of findings to produce.
	 * Default: 10
	 */
	maxFindings: number;

	/**
	 * Confidence threshold below which a finding is considered speculative.
	 * Default: 0.5
	 */
	speculativeThreshold: number;

	/**
	 * Whether to enable pattern matching against known failure signatures.
	 * Default: true
	 */
	enablePatternMatching: boolean;
}

/**
 * Default configuration for the RootCauseAnalyzer.
 */
export const DEFAULT_ROOT_CAUSE_ANALYZER_CONFIG: RootCauseAnalyzerConfig = {
	minConfidence: 0.3,
	maxFindings: 10,
	speculativeThreshold: 0.5,
	enablePatternMatching: true,
};

// ---------------------------------------------------------------------------
// Root Cause Analyzer
// ---------------------------------------------------------------------------

/**
 * Analyzes evidence to identify root causes of failures.
 *
 * Uses pattern matching on error messages, stack traces, diagnostics,
 * and execution logs to categorize failures and produce actionable
 * findings with evidence chains.
 */
export class RootCauseAnalyzer {
	private config: RootCauseAnalyzerConfig;

	/**
	 * Create a new RootCauseAnalyzer.
	 *
	 * @param config - Optional partial configuration overrides.
	 */
	constructor(config?: Partial<RootCauseAnalyzerConfig>) {
		this.config = {
			minConfidence: config?.minConfidence ?? DEFAULT_ROOT_CAUSE_ANALYZER_CONFIG.minConfidence,
			maxFindings: config?.maxFindings ?? DEFAULT_ROOT_CAUSE_ANALYZER_CONFIG.maxFindings,
			speculativeThreshold: config?.speculativeThreshold ?? DEFAULT_ROOT_CAUSE_ANALYZER_CONFIG.speculativeThreshold,
			enablePatternMatching:
				config?.enablePatternMatching ?? DEFAULT_ROOT_CAUSE_ANALYZER_CONFIG.enablePatternMatching,
		};
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the analyzer configuration.
	 */
	setConfig(config: Partial<RootCauseAnalyzerConfig>): void {
		if (config.minConfidence !== undefined) this.config.minConfidence = config.minConfidence;
		if (config.maxFindings !== undefined) this.config.maxFindings = config.maxFindings;
		if (config.speculativeThreshold !== undefined) this.config.speculativeThreshold = config.speculativeThreshold;
		if (config.enablePatternMatching !== undefined) this.config.enablePatternMatching = config.enablePatternMatching;
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): RootCauseAnalyzerConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Main Analysis
	// -----------------------------------------------------------------------

	/**
	 * Perform root cause analysis on an EvidenceSummary.
	 *
	 * Examines all evidence, matches against failure patterns, and produces
	 * ranked root cause findings with evidence chains and remediation.
	 *
	 * @param summary - The EvidenceSummary to analyze.
	 * @returns A RootCauseAnalysis result.
	 */
	analyze(summary: EvidenceSummary): RootCauseAnalysis {
		const sessionId = summary.sessionId;
		const allEvidence = this.collectAllEvidence(summary);

		// Run pattern matchers to produce candidate findings
		const candidates: RootCauseFinding[] = [];

		if (this.config.enablePatternMatching) {
			candidates.push(...this.matchErrorPatterns(allEvidence));
			candidates.push(...this.matchStackTracePatterns(allEvidence));
			candidates.push(...this.matchDiagnosticPatterns(allEvidence));
			candidates.push(...this.matchExecutionLogPatterns(allEvidence));
			candidates.push(...this.matchCoverageGaps(summary));
		}

		// Sort by confidence descending, deduplicate by category+title
		const deduped = this.deduplicateFindings(candidates);

		// Filter by minimum confidence and limit
		const findings = deduped
			.filter((f) => f.confidence >= this.config.minConfidence)
			.slice(0, this.config.maxFindings);

		// Determine primary cause
		const primaryCause = findings.length > 0 ? findings[0] : null;

		// Calculate overall confidence (average of top 3)
		const topN = findings.slice(0, 3);
		const overallConfidence = topN.length > 0 ? topN.reduce((sum, f) => sum + f.confidence, 0) / topN.length : 0;

		// Determine actionability
		const limitations = this.identifyLimitations(findings, summary);
		const actionable = limitations.length === 0 && findings.length > 0;

		// Identify unused evidence types
		const unusedEvidenceTypes = this.findUnusedEvidenceTypes(findings, summary);

		return {
			id: randomUUID(),
			createdAt: new Date().toISOString(),
			sessionId,
			evidenceSummaryId: summary.id,
			findings,
			primaryCause,
			overallConfidence,
			actionable,
			limitations,
			unusedEvidenceTypes,
		};
	}

	// -----------------------------------------------------------------------
	// Evidence Collection
	// -----------------------------------------------------------------------

	/**
	 * Collect all evidence items from a summary into a flat list.
	 */
	private collectAllEvidence(summary: EvidenceSummary): EvidenceItem[] {
		const all: EvidenceItem[] = [];
		for (const items of Object.values(summary.evidenceByType)) {
			if (items) {
				all.push(...items);
			}
		}
		return all;
	}

	// -----------------------------------------------------------------------
	// Pattern Matchers
	// -----------------------------------------------------------------------

	/**
	 * Match error message patterns to identify root cause categories.
	 */
	private matchErrorPatterns(evidence: EvidenceItem[]): RootCauseFinding[] {
		const findings: RootCauseFinding[] = [];
		const errorMessages = evidence.filter((e) => e.type === "error_message");

		if (errorMessages.length === 0) {
			return findings;
		}

		// Concatenate all error content for pattern matching
		const combinedText = errorMessages
			.map((e) => e.content)
			.join("\n")
			.toLowerCase();

		// Dependency failure patterns
		if (/module not found|cannot find module|import error|missing dependency|npm err/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"dependency_failure",
					"Missing or unavailable dependency detected",
					"One or more required modules or dependencies could not be resolved. This may be caused by missing packages, incorrect import paths, or network issues preventing package installation.",
					0.85,
					errorMessages.slice(0, 3).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.dependency_failure,
					"error_message_contains_dependency_failure_keywords",
				),
			);
		}

		if (
			/enoent|eacces|eperm|eexist|eisdir|enotdir|econnrefused|econnreset|etimedout|eaddrinuse/i.test(combinedText)
		) {
			findings.push(
				this.createFinding(
					"runtime_error",
					"File or network system error occurred",
					"A system-level error (ENOENT, EACCES, ECONNREFUSED, etc.) was raised, indicating a missing file, permission issue, or network connectivity problem.",
					0.75,
					errorMessages.slice(0, 3).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.runtime_error,
					"error_message_contains_system_error_code",
				),
			);
		}

		if (/permission denied|not authorized|forbidden|access denied|unauthorized/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"permission_denied",
					"Permission denied or authorization failure",
					"The operation was rejected due to insufficient permissions or invalid credentials. This may affect file access, API calls, or resource creation.",
					0.8,
					errorMessages.slice(0, 3).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.permission_denied,
					"error_message_contains_permission_denied_keywords",
				),
			);
		}

		if (/out of memory|memory limit|heap allocation|allocation failure|cannot allocate/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"resource_exhaustion",
					"Memory allocation failure",
					"The application ran out of memory during execution. This may be caused by memory leaks, excessive data processing, or insufficient heap allocation.",
					0.85,
					errorMessages.slice(0, 3).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.resource_exhaustion,
					"error_message_contains_memory_failure_keywords",
				),
			);
		}

		if (/timeout|timed out|request timed out|operation timed out/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"timeout",
					"Operation timed out",
					"An operation exceeded its allowed execution time. This may indicate slow dependencies, network latency, or under-resourced operations.",
					0.75,
					errorMessages.slice(0, 3).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.timeout,
					"error_message_contains_timeout_keywords",
				),
			);
		}

		if (
			/api.*(error|fail|unavailable)|service.*(unavailable|down|error)|5\d{2}|internal server error/i.test(
				combinedText,
			)
		) {
			findings.push(
				this.createFinding(
					"external_service",
					"External API or service error",
					"An external service returned an error or is unavailable. This may be a transient outage, rate limiting, or an API contract mismatch.",
					0.7,
					errorMessages.slice(0, 3).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.external_service,
					"error_message_contains_external_service_error",
				),
			);
		}

		if (
			/configuration|config.*(invalid|missing|error)|env.*not (set|found)|missing.*(env|config)/i.test(combinedText)
		) {
			findings.push(
				this.createFinding(
					"configuration_error",
					"Configuration or environment variable error",
					"A configuration file or environment variable is missing, invalid, or misconfigured. This prevents the application from initializing correctly.",
					0.8,
					errorMessages.slice(0, 3).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.configuration_error,
					"error_message_contains_configuration_keywords",
				),
			);
		}

		// If no specific pattern was matched, add a generic runtime error finding
		if (findings.length === 0) {
			const highConfidenceErrors = errorMessages.filter((e) => e.confidence === "high" || e.confidence === "medium");
			if (highConfidenceErrors.length > 0) {
				findings.push(
					this.createFinding(
						"runtime_error",
						"Unclassified runtime error detected",
						`${highConfidenceErrors.length} high/medium confidence error messages were found but did not match known patterns. Manual investigation is recommended.`,
						0.4,
						highConfidenceErrors.slice(0, 3).map((e) => e.id),
						ROOT_CAUSE_REMEDIATIONS.runtime_error,
						"error_message_no_pattern_match",
					),
				);
			}
		}

		return findings;
	}

	/**
	 * Match stack trace patterns to identify root cause categories.
	 */
	private matchStackTracePatterns(evidence: EvidenceItem[]): RootCauseFinding[] {
		const findings: RootCauseFinding[] = [];
		const stackTraces = evidence.filter((e) => e.type === "stack_trace");

		if (stackTraces.length === 0) {
			return findings;
		}

		const combinedText = stackTraces
			.map((e) => e.content)
			.join("\n")
			.toLowerCase();

		// TypeError patterns
		if (
			/typeerror|cannot read properties of undefined|cannot read property|is not a function|is not defined/i.test(
				combinedText,
			)
		) {
			findings.push(
				this.createFinding(
					"logic_error",
					"TypeError or undefined reference in code",
					"A TypeError was thrown, typically caused by accessing a property on an undefined value, calling a non-function, or referencing an undefined variable.",
					0.8,
					stackTraces.slice(0, 2).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.logic_error,
					"stack_trace_contains_typeerror",
				),
			);
		}

		// Null reference patterns
		if (/null.*reference|nullpointer|cannot read.*null|cannot access.*null/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"logic_error",
					"Null reference error",
					"A null reference was accessed, causing a runtime exception. This typically indicates a missing null check or uninitialized variable.",
					0.8,
					stackTraces.slice(0, 2).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.logic_error,
					"stack_trace_contains_null_reference",
				),
			);
		}

		// Assertion failure patterns
		if (/(assertion|assert) failed|failed assertion/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"logic_error",
					"Assertion failure",
					"An assertion in the code failed, indicating that a precondition, invariant, or expected condition was not met.",
					0.75,
					stackTraces.slice(0, 2).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.logic_error,
					"stack_trace_contains_assertion_failure",
				),
			);
		}

		// Range/Index errors
		if (/rangeerror|index.*out of bounds|out of range|array.*bound/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"logic_error",
					"Index or range error",
					"An index was out of bounds or a value was outside the expected range. This typically indicates incorrect array indexing or boundary condition handling.",
					0.75,
					stackTraces.slice(0, 2).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.logic_error,
					"stack_trace_contains_range_error",
				),
			);
		}

		return findings;
	}

	/**
	 * Match worker diagnostic patterns to identify root cause categories.
	 */
	private matchDiagnosticPatterns(evidence: EvidenceItem[]): RootCauseFinding[] {
		const findings: RootCauseFinding[] = [];
		const diagnostics = evidence.filter((e) => e.type === "worker_diagnostic");

		if (diagnostics.length === 0) {
			return findings;
		}

		const combinedText = diagnostics
			.map((e) => e.content)
			.join("\n")
			.toLowerCase();

		// Token budget exhaustion
		if (/token.*(budget|limit|exhausted|exceeded)|max.*token/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"resource_exhaustion",
					"Token budget exhausted",
					"The worker exceeded its allocated token budget for the current cycle. Consider increasing the budget or optimizing the work to use fewer tokens.",
					0.85,
					diagnostics.slice(0, 2).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.resource_exhaustion,
					"diagnostic_contains_token_budget_exhaustion",
				),
			);
		}

		// Runtime budget exhaustion
		if (/runtime.*(limit|exceeded|timeout|budget)|max.*runtime/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"timeout",
					"Runtime budget exceeded",
					"The worker exceeded its maximum allowed runtime. The work cycle may be too complex or the runtime budget may be too low.",
					0.8,
					diagnostics.slice(0, 2).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.timeout,
					"diagnostic_contains_runtime_budget_exceeded",
				),
			);
		}

		// Consecutive failures
		if (/consecutive.*(failure|error)|max.*failure/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"runtime_error",
					"Consecutive worker failures",
					"The worker has experienced multiple consecutive failures, indicating a persistent problem that should be investigated before retrying.",
					0.8,
					diagnostics.slice(0, 2).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.runtime_error,
					"diagnostic_contains_consecutive_failures",
				),
			);
		}

		// Dependency unavailable
		if (/dependency.*(unavailable|missing|not found)|unavailable.*dependency/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"dependency_failure",
					"Required dependency unavailable",
					"A required dependency was not available when the worker tried to use it. This may be a transient issue or a configuration problem.",
					0.85,
					diagnostics.slice(0, 2).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.dependency_failure,
					"diagnostic_contains_dependency_unavailable",
				),
			);
		}

		// Policy blocked
		if (/policy.*(blocked|denied|rejected)|blocked.*(policy|rule)/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"permission_denied",
					"Policy blocked the operation",
					"A policy rule blocked the worker from performing the requested operation. Review policy configuration and the operation's compliance.",
					0.85,
					diagnostics.slice(0, 2).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.permission_denied,
					"diagnostic_contains_policy_blocked",
				),
			);
		}

		return findings;
	}

	/**
	 * Match execution log patterns to identify root cause categories.
	 */
	private matchExecutionLogPatterns(evidence: EvidenceItem[]): RootCauseFinding[] {
		const findings: RootCauseFinding[] = [];
		const logs = evidence.filter((e) => e.type === "execution_log");

		if (logs.length === 0) {
			return findings;
		}

		const combinedText = logs
			.map((e) => e.content)
			.join("\n")
			.toLowerCase();

		// Warning clusters indicating issues
		const _warningCount = (combinedText.match(/warning|warn/gi) ?? []).length;
		const errorCount = (combinedText.match(/\berror\b/gi) ?? []).length;
		const failCount = (combinedText.match(/\bfail(ed|ure)?\b/gi) ?? []).length;

		if (errorCount > 5 || failCount > 3) {
			findings.push(
				this.createFinding(
					"runtime_error",
					"Multiple errors detected in execution logs",
					`Execution logs contain ${errorCount} error and ${failCount} failure entries, indicating a recurring problem during execution.`,
					0.65,
					logs.slice(0, 3).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.runtime_error,
					"execution_log_high_error_rate",
				),
			);
		}

		// Configuration-related log entries
		if (/config|setting|environment/i.test(combinedText) && /(invalid|missing|wrong|bad)/i.test(combinedText)) {
			findings.push(
				this.createFinding(
					"configuration_error",
					"Configuration issues present in execution logs",
					"Execution logs contain entries indicating invalid or missing configuration values. Review log entries for specific configuration errors.",
					0.6,
					logs.slice(0, 2).map((e) => e.id),
					ROOT_CAUSE_REMEDIATIONS.configuration_error,
					"execution_log_configuration_issues",
				),
			);
		}

		return findings;
	}

	/**
	 * Match coverage gaps to identify missing evidence types.
	 */
	private matchCoverageGaps(summary: EvidenceSummary): RootCauseFinding[] {
		const findings: RootCauseFinding[] = [];

		if (summary.gaps.length > 2) {
			findings.push(
				this.createFinding(
					"unknown",
					"Multiple evidence types are missing",
					`${summary.gaps.length} expected evidence types are missing from the summary. The analysis may be incomplete.`,
					0.3,
					[],
					ROOT_CAUSE_REMEDIATIONS.unknown,
					"coverage_gap_multiple_missing_types",
				),
			);
		}

		return findings;
	}

	// -----------------------------------------------------------------------
	// Finding Helpers
	// -----------------------------------------------------------------------

	/**
	 * Create a RootCauseFinding with standard fields.
	 */
	private createFinding(
		category: RootCauseCategory,
		title: string,
		description: string,
		confidence: number,
		evidenceIds: string[],
		remediation: string[],
		matchedPattern: string,
		definitive: boolean = confidence >= this.config.speculativeThreshold,
	): RootCauseFinding {
		return {
			id: randomUUID(),
			category,
			title,
			description,
			confidence,
			evidenceIds,
			remediation,
			matchedPattern,
			definitive,
		};
	}

	/**
	 * Deduplicate findings by category+title, keeping the highest confidence.
	 */
	private deduplicateFindings(findings: RootCauseFinding[]): RootCauseFinding[] {
		const seen = new Map<string, RootCauseFinding>();

		for (const finding of findings) {
			const key = `${finding.category}:${finding.title}`;
			const existing = seen.get(key);
			if (!existing || finding.confidence > existing.confidence) {
				// Merge evidence IDs
				if (existing) {
					finding.evidenceIds = [...new Set([...existing.evidenceIds, ...finding.evidenceIds])];
				}
				seen.set(key, finding);
			} else {
				// Merge evidence IDs into existing
				existing.evidenceIds = [...new Set([...existing.evidenceIds, ...finding.evidenceIds])];
			}
		}

		return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
	}

	/**
	 * Identify limitations that affect analysis actionability.
	 */
	private identifyLimitations(findings: RootCauseFinding[], summary: EvidenceSummary): string[] {
		const limitations: string[] = [];

		if (findings.length === 0) {
			limitations.push("No root cause findings were generated from the available evidence");
		}

		if (summary.evidenceCount === 0) {
			limitations.push("No evidence was collected for analysis");
		}

		const highConfFindings = findings.filter((f) => f.confidence >= 0.7);
		if (highConfFindings.length === 0 && findings.length > 0) {
			limitations.push("All findings have low confidence (< 0.7); further evidence may be needed");
		}

		if (summary.gaps.length > 0) {
			limitations.push(`Evidence gaps detected: ${summary.gaps.join("; ")}`);
		}

		return limitations;
	}

	/**
	 * Identify evidence types that were collected but didn't contribute to any finding.
	 */
	private findUnusedEvidenceTypes(findings: RootCauseFinding[], summary: EvidenceSummary): EvidenceType[] {
		const usedTypeSet = new Set<EvidenceType>();

		// Collect evidence items referenced by findings
		const allEvidence = this.collectAllEvidence(summary);
		const evidenceMap = new Map(allEvidence.map((e) => [e.id, e]));

		for (const finding of findings) {
			for (const evidenceId of finding.evidenceIds) {
				const item = evidenceMap.get(evidenceId);
				if (item) {
					usedTypeSet.add(item.type);
				}
			}
		}

		// Types with evidence but no findings using them
		return Object.entries(summary.coverage)
			.filter(([type, count]) => count > 0 && !usedTypeSet.has(type as EvidenceType))
			.map(([type]) => type as EvidenceType);
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a RootCauseAnalyzer with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new RootCauseAnalyzer instance.
 */
export function createRootCauseAnalyzer(config?: Partial<RootCauseAnalyzerConfig>): RootCauseAnalyzer {
	return new RootCauseAnalyzer(config);
}
