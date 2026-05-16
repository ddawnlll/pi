/**
 * Orchestrator Types - P11.B
 *
 * Core type definitions for the always-on orchestrator daemon:
 * lifecycle states, scan configuration, scheduler records, health status,
 * and policy event reporting.
 *
 * No platform enums or types should be redefined here — import from
 * the canonical platform module instead.
 *
 * @packageDocumentation
 */

import type { AuditLevel, PlatformComponent } from "../platform/types.js";

// ---------------------------------------------------------------------------
// Orchestrator Lifecycle
// ---------------------------------------------------------------------------

/**
 * Lifecycle state of the orchestrator daemon.
 */
export type OrchestratorState =
	| "stopped" // Not running
	| "starting" // Transitioning to running
	| "running" // Actively scanning and monitoring
	| "pausing" // Transitioning to paused (graceful stop of active scans)
	| "paused" // Suspended — no scans, but retained configuration
	| "stopping" // Transitioning to stopped
	| "failed"; // Unrecoverable error

/**
 * Human-readable labels for each orchestrator state.
 */
export const ORCHESTRATOR_STATE_LABELS: Record<OrchestratorState, string> = {
	stopped: "Stopped",
	starting: "Starting",
	running: "Running",
	pausing: "Pausing",
	paused: "Paused",
	stopping: "Stopping",
	failed: "Failed",
};

// ---------------------------------------------------------------------------
// Orchestrator Status
// ---------------------------------------------------------------------------

/**
 * Full orchestrator status snapshot for API/state-store consumption.
 */
export interface OrchestratorStatus {
	/** Current lifecycle state */
	state: OrchestratorState;
	/** ISO-8601 timestamp when orchestrator started */
	startedAt: string | null;
	/** ISO-8601 timestamp of last state change */
	lastStateChangeAt: string | null;
	/** ISO-8601 timestamp of last completed scan cycle */
	lastScanCycleAt: string | null;
	/** Number of scan cycles completed since start */
	scanCycleCount: number;
	/** Total number of scan errors since start */
	totalScanErrors: number;
	/** Whether the orchestrator is healthy */
	healthy: boolean;
	/** Current health check detail */
	healthDetail: string;
	/** Scan scheduler snapshot */
	scheduler: SchedulerSnapshot;
	/** Mutation guard snapshot */
	mutationGuard: MutationGuardSnapshot;
	/** Version of the orchestrator */
	version: string;
	/** Component identifier */
	component: PlatformComponent;
}

// ---------------------------------------------------------------------------
// Scan Configuration
// ---------------------------------------------------------------------------

/**
 * Type of scan the orchestrator can perform.
 */
export type ScanType =
	| "repo_health" // Scan repository health signals
	| "run_history" // Scan recent plan run history
	| "queue" // Scan plan queue depth and state
	| "dashboard_metrics" // Collect dashboard metric snapshots
	| "proposal_refresh"; // Refresh stale proposals

/**
 * Human-readable labels for each scan type.
 */
export const SCAN_TYPE_LABELS: Record<ScanType, string> = {
	repo_health: "Repository Health",
	run_history: "Run History",
	queue: "Queue",
	dashboard_metrics: "Dashboard Metrics",
	proposal_refresh: "Proposal Refresh",
};

/**
 * Cadence configuration for a single scan type.
 */
export interface ScanCadence {
	/** Interval in milliseconds between scans */
	intervalMs: number;
	/** Whether this scan type is enabled */
	enabled: boolean;
	/** Maximum number of consecutive failures before disabling */
	maxConsecutiveFailures: number;
	/** Base delay for exponential backoff on failure (ms) */
	backoffBaseMs: number;
	/** Maximum backoff delay (ms) */
	backoffMaxMs: number;
}

/**
 * Full scan configuration for the orchestrator.
 */
export interface ScanConfig {
	/** Cadence for each scan type */
	cadences: Record<ScanType, ScanCadence>;
	/** Rate limit: max scans per minute across all types */
	maxScansPerMinute: number;
	/** Token budget: max token cost per scan cycle */
	maxTokensPerCycle: number;
	/** Default project scan cadence override (ms) */
	defaultProjectCadenceMs?: number;
}

// ---------------------------------------------------------------------------
// Scan Record (Scheduler)
// ---------------------------------------------------------------------------

/**
 * Outcome of a single scan execution.
 */
export type ScanOutcome = "success" | "skipped" | "failed" | "over_rate_limit" | "over_budget";

/**
 * A single scan record kept by the scheduler.
 */
export interface ScanRecord {
	/** Scan type */
	type: ScanType;
	/** When the scan was started (ISO-8601) */
	startedAt: string;
	/** When the scan completed (ISO-8601, null if still running) */
	completedAt: string | null;
	/** Duration in milliseconds */
	durationMs: number | null;
	/** Outcome of the scan */
	outcome: ScanOutcome;
	/** Human-readable skip/fail reason */
	reason?: string;
	/** Error message if failed */
	error?: string;
	/** Token cost of the scan (if tracked) */
	tokenCost?: number;
}

// ---------------------------------------------------------------------------
// Scheduler State
// ---------------------------------------------------------------------------

/**
 * Snapshot of the scan scheduler state.
 */
export interface SchedulerSnapshot {
	/** Last scan start time per type (ISO-8601 or null) */
	lastScan: Record<ScanType, string | null>;
	/** Next scheduled scan time per type (ISO-8601 or null) */
	nextScan: Record<ScanType, string | null>;
	/** Recent scan records (most recent first, max 100) */
	recentScans: ScanRecord[];
	/** Consecutive failure count per type */
	consecutiveFailures: Record<ScanType, number>;
	/** Current backoff delay per type (ms) */
	backoffDelays: Record<ScanType, number>;
	/** Total scans completed per type */
	totalScans: Record<ScanType, number>;
	/** Total failures per type */
	totalFailures: Record<ScanType, number>;
	/** Total skips per type */
	totalSkips: Record<ScanType, number>;
}

// ---------------------------------------------------------------------------
// Mutation Guard
// ---------------------------------------------------------------------------

/**
 * Category of blocked mutation.
 */
export type MutationCategory =
	| "code_write"
	| "code_delete"
	| "queue_mutate"
	| "state_mutate"
	| "protected_system"
	| "execution_graph";

/**
 * A policy event recorded when a mutation is blocked.
 */
export interface PolicyEvent {
	/** Unique event ID */
	id: string;
	/** ISO-8601 timestamp */
	timestamp: string;
	/** Category of the blocked mutation */
	category: MutationCategory;
	/** What was attempted */
	attempt: string;
	/** Target path or resource */
	target: string;
	/** Source component that attempted the mutation */
	source: string;
	/** Severity level */
	severity: AuditLevel;
	/** Human-readable detail */
	detail: string;
}

// ---------------------------------------------------------------------------
// Orchestrator Proposal Records (P11.H)
// ---------------------------------------------------------------------------

/**
 * Source type that generated an orchestrator proposal.
 */
export type ProposalSourceType = "repo_health" | "detection" | "dashboard_metrics" | "run_history" | "queue_analysis";

/**
 * Policy classification for an orchestrator proposal.
 */
export type PolicyClassification =
	| "code_quality"
	| "dependency"
	| "safety"
	| "performance"
	| "security"
	| "test_coverage"
	| "documentation"
	| "self_modification"
	| "configuration"
	| "suggestion";

/**
 * Suggested next action for an orchestrator proposal.
 */
export type SuggestedNextAction =
	| "create_workspace"
	| "modify_configuration"
	| "schedule_scan"
	| "generate_report"
	| "flag_for_review"
	| "apply_auto_fix"
	| "no_action_required";

/**
 * A single evidence link connecting a proposal to its source finding.
 */
export interface ProposalEvidenceLink {
	/** Reference to the source finding (e.g., signal ID, detection ID) */
	sourceId: string;
	/** Source type */
	sourceType: ProposalSourceType;
	/** Human-readable description of the evidence */
	description: string;
	/** File path the evidence relates to (if applicable) */
	filePath?: string;
	/** Line number range (if applicable) */
	lineRange?: { start: number; end: number };
	/** Snippet of the evidence data */
	snippet?: string;
}

/**
 * An orchestrator proposal record generated from scan findings.
 *
 * Each proposal represents an actionable recommendation derived from
 * an orchestrator scan, such as a repo health signal or detection.
 * Proposals include evidence links, confidence, risk, policy
 * classification, and a suggested next action.
 */
export interface OrchestratorProposal {
	/** Unique proposal identifier (deterministic from content hash) */
	id: string;
	/** Human-readable title */
	title: string;
	/** Detailed description */
	description: string;
	/** Source type that generated this proposal */
	sourceType: ProposalSourceType;
	/** Evidence links to source findings */
	evidenceLinks: ProposalEvidenceLink[];
	/** Confidence level (low/medium/high) */
	confidence: "low" | "medium" | "high";
	/** Risk level (low/medium/high) */
	risk: "low" | "medium" | "high";
	/** Policy classification */
	policyClassification: PolicyClassification;
	/** Suggested next action */
	suggestedNextAction: SuggestedNextAction;
	/** Whether this proposal involves self-modification (requires enhanced approval) */
	isSelfModification: boolean;
	/** Human-readable reason why this is flagged as self-modification */
	selfModificationReason?: string;
	/** Content hash used for duplicate detection */
	contentHash: string;
	/** ISO-8601 timestamp when the proposal was generated */
	generatedAt: string;
	/** File paths that would be affected by acting on this proposal */
	affectedPaths: string[];
	/** Whether this proposal can be automated */
	autoFixable: boolean;
	/** Estimated effort */
	effort: "trivial" | "small" | "medium" | "large";
	/** Optional metadata for extensibility */
	metadata?: Record<string, unknown>;
}

/**
 * Result of generating proposals from scan findings.
 */
export interface ProposalGenerationResult {
	/** The generated proposals */
	proposals: OrchestratorProposal[];
	/** Number of new proposals (not duplicates) */
	newCount: number;
	/** Number of duplicate proposals skipped */
	duplicateCount: number;
	/** Any errors encountered during generation */
	errors: string[];
}

// ---------------------------------------------------------------------------
// Mutation Guard
// ---------------------------------------------------------------------------

/**
 * Snapshot of the mutation guard state.
 */
export interface MutationGuardSnapshot {
	/** Total blocked mutations since start */
	totalBlocked: number;
	/** Count by category */
	byCategory: Record<MutationCategory, number>;
	/** Recent policy events (most recent first, max 50) */
	recentEvents: PolicyEvent[];
	/** Whether mutation blocking is active */
	blockingActive: boolean;
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

/**
 * Default scan cadence configuration.
 */
export const DEFAULT_SCAN_CADENCES: Record<ScanType, ScanCadence> = {
	repo_health: {
		intervalMs: 5 * 60 * 1000, // 5 minutes
		enabled: true,
		maxConsecutiveFailures: 3,
		backoffBaseMs: 30_000, // 30 seconds
		backoffMaxMs: 30 * 60 * 1000, // 30 minutes
	},
	run_history: {
		intervalMs: 10 * 60 * 1000, // 10 minutes
		enabled: true,
		maxConsecutiveFailures: 3,
		backoffBaseMs: 60_000, // 1 minute
		backoffMaxMs: 30 * 60 * 1000, // 30 minutes
	},
	queue: {
		intervalMs: 2 * 60 * 1000, // 2 minutes
		enabled: true,
		maxConsecutiveFailures: 5,
		backoffBaseMs: 30_000, // 30 seconds
		backoffMaxMs: 15 * 60 * 1000, // 15 minutes
	},
	dashboard_metrics: {
		intervalMs: 15 * 60 * 1000, // 15 minutes
		enabled: true,
		maxConsecutiveFailures: 3,
		backoffBaseMs: 60_000, // 1 minute
		backoffMaxMs: 30 * 60 * 1000, // 30 minutes
	},
	proposal_refresh: {
		intervalMs: 30 * 60 * 1000, // 30 minutes
		enabled: true,
		maxConsecutiveFailures: 3,
		backoffBaseMs: 60_000, // 1 minute
		backoffMaxMs: 60 * 60 * 1000, // 60 minutes
	},
};

/**
 * Default scan configuration.
 */
export const DEFAULT_SCAN_CONFIG: ScanConfig = {
	cadences: DEFAULT_SCAN_CADENCES,
	maxScansPerMinute: 20,
	maxTokensPerCycle: 100_000,
	defaultProjectCadenceMs: 15 * 60 * 1000, // 15 minutes
};
