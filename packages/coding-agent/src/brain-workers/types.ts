/**
 * Brain Worker Domain Model — 25.C
 *
 * Defines the core data structures for brain worker contracts, roles,
 * manifests, lifecycle states, budget/cooldown/dedup/stop-condition
 * handling for autonomous operation.
 *
 * Every worker requires a manifest with role contract and budget.
 * Lifecycle states track workers from dormant through active to retired
 * or failed, with explicit diagnostics on failures.
 *
 * File scope: This is the single source of truth for all brain worker types
 * used by the Contract System (25.C.contracts) and Lifecycle Engine
 * (25.C.lifecycle).
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Worker Role
// ---------------------------------------------------------------------------

/**
 * The role a brain worker fulfills within the brain cognitive OS.
 *
 * Each role has distinct responsibilities, resource profiles, and
 * lifecycle expectations:
 * - observer:         Monitors execution, queues, and integrations for signals
 * - analyst:          Analyzes observations to detect patterns and synthesize signals
 * - proposer:         Generates actionable proposals from signals and memory
 * - reflector:        Runs scheduled reflection cycles over memory and outcomes
 * - diagnostician:    Deep-dive diagnostics on failures, hotspots, and anomalies
 * - archivist:        Manages memory lifecycle — expiry, conflict detection, compaction
 * - coordinator:      Orchestrates multi-worker workflows and dependency resolution
 * - auditor:          Audits decisions, policy compliance, and provenance chains
 */
export type WorkerRole =
	| "observer"
	| "analyst"
	| "proposer"
	| "reflector"
	| "diagnostician"
	| "archivist"
	| "coordinator"
	| "auditor";

/**
 * All valid WorkerRole values for runtime validation.
 */
export const ALL_WORKER_ROLES: readonly WorkerRole[] = [
	"observer",
	"analyst",
	"proposer",
	"reflector",
	"diagnostician",
	"archivist",
	"coordinator",
	"auditor",
] as const;

/**
 * Human-readable labels for each worker role.
 */
export const WORKER_ROLE_LABELS: Record<WorkerRole, string> = {
	observer: "Observer",
	analyst: "Analyst",
	proposer: "Proposer",
	reflector: "Reflector",
	diagnostician: "Diagnostician",
	archivist: "Archivist",
	coordinator: "Coordinator",
	auditor: "Auditor",
};

/**
 * Default resource budget profiles for each worker role.
 */
export const DEFAULT_ROLE_BUDGETS: Record<WorkerRole, WorkerBudget> = {
	observer: {
		maxTokensPerCycle: 50_000,
		maxConsecutiveFailures: 5,
		cooldownMs: 60_000,
		maxRuntimeMs: 300_000,
	},
	analyst: {
		maxTokensPerCycle: 100_000,
		maxConsecutiveFailures: 3,
		cooldownMs: 120_000,
		maxRuntimeMs: 600_000,
	},
	proposer: {
		maxTokensPerCycle: 150_000,
		maxConsecutiveFailures: 3,
		cooldownMs: 180_000,
		maxRuntimeMs: 900_000,
	},
	reflector: {
		maxTokensPerCycle: 200_000,
		maxConsecutiveFailures: 3,
		cooldownMs: 300_000,
		maxRuntimeMs: 1_200_000,
	},
	diagnostician: {
		maxTokensPerCycle: 150_000,
		maxConsecutiveFailures: 2,
		cooldownMs: 120_000,
		maxRuntimeMs: 600_000,
	},
	archivist: {
		maxTokensPerCycle: 100_000,
		maxConsecutiveFailures: 4,
		cooldownMs: 60_000,
		maxRuntimeMs: 300_000,
	},
	coordinator: {
		maxTokensPerCycle: 80_000,
		maxConsecutiveFailures: 3,
		cooldownMs: 60_000,
		maxRuntimeMs: 600_000,
	},
	auditor: {
		maxTokensPerCycle: 100_000,
		maxConsecutiveFailures: 2,
		cooldownMs: 180_000,
		maxRuntimeMs: 600_000,
	},
};

// ---------------------------------------------------------------------------
// Worker Lifecycle State
// ---------------------------------------------------------------------------

/**
 * Lifecycle state of a brain worker instance.
 *
 * States and transitions:
 * - dormant:      Registered but not yet eligible for activation
 * - standby:      Eligible and waiting for dispatch
 * - active:       Currently executing a work cycle
 * - busy:         At capacity, cannot accept additional work
 * - cooling:      Post-execution cooldown period
 * - paused:       Suspended by user or policy, retains configuration
 * - retired:      Permanently decommissioned (no further activation)
 * - failed:       Unrecoverable failure with diagnostics attached
 */
export type WorkerLifecycleState =
	| "dormant"
	| "standby"
	| "active"
	| "busy"
	| "cooling"
	| "paused"
	| "retired"
	| "failed";

/**
 * All valid WorkerLifecycleState values for runtime validation.
 */
export const ALL_WORKER_LIFECYCLE_STATES: readonly WorkerLifecycleState[] = [
	"dormant",
	"standby",
	"active",
	"busy",
	"cooling",
	"paused",
	"retired",
	"failed",
] as const;

/**
 * Human-readable labels for each lifecycle state.
 */
export const WORKER_LIFECYCLE_STATE_LABELS: Record<WorkerLifecycleState, string> = {
	dormant: "Dormant",
	standby: "Standby",
	active: "Active",
	busy: "Busy",
	cooling: "Cooling",
	paused: "Paused",
	retired: "Retired",
	failed: "Failed",
};

/**
 * States where a worker is considered operational (can do work).
 */
export const OPERATIONAL_STATES: readonly WorkerLifecycleState[] = [
	"standby",
	"active",
	"busy",
] as const;

/**
 * States where a worker is not operational and requires intervention.
 */
export const NON_OPERATIONAL_STATES: readonly WorkerLifecycleState[] = [
	"dormant",
	"cooling",
	"paused",
	"retired",
	"failed",
] as const;

// ---------------------------------------------------------------------------
// Worker Budget
// ---------------------------------------------------------------------------

/**
 * Resource budget constraints for autonomous worker operation.
 *
 * Every worker cycle consumes from these budgets. Exceeding any limit
 * triggers a stop condition and transitions the worker to cooling or
 * failed state with diagnostics attached.
 */
export interface WorkerBudget {
	/**
	 * Maximum tokens this worker can consume per cycle.
	 * Range: 0 (no token budget, only non-LLM work) to 500_000+
	 * Defaults per role in DEFAULT_ROLE_BUDGETS.
	 */
	maxTokensPerCycle: number;

	/**
	 * Maximum consecutive failures before the worker is transitioned
	 * to failed state. A failure is any execution that throws or
	 * returns a non-success outcome.
	 * Range: 1-20, default 3.
	 */
	maxConsecutiveFailures: number;

	/**
	 * Cooldown period in milliseconds after a work cycle completes.
	 * During cooldown, the worker is in "cooling" state and will not
	 * accept new work.
	 * Default varies by role (60s-300s).
	 */
	cooldownMs: number;

	/**
	 * Maximum wall-clock runtime in milliseconds for a single work cycle.
	 * If the worker exceeds this, it is force-stopped and transitioned
	 * to cooling with a "timeout" stop condition.
	 * Range: 30_000 (30s) to 3_600_000 (1h), default by role.
	 */
	maxRuntimeMs: number;
}

// ---------------------------------------------------------------------------
// Worker Cooldown
// ---------------------------------------------------------------------------

/**
 * Cooldown state tracking for a worker instance.
 */
export interface WorkerCooldown {
	/** ISO 8601 timestamp when cooldown started, null if not cooling */
	startedAt: string | null;
	/** ISO 8601 timestamp when cooldown ends, null if not cooling */
	endsAt: string | null;
	/** Reason for the current cooldown */
	reason: string;
	/** Number of cooldown events since last full reset */
	count: number;
}

// ---------------------------------------------------------------------------
// Worker Stop Condition
// ---------------------------------------------------------------------------

/**
 * Condition that caused a worker to stop its current cycle.
 */
export type WorkerStopCondition =
	| "completed" // Work cycle completed normally
	| "timeout" // Exceeded maxRuntimeMs
	| "token_budget_exhausted" // Exceeded maxTokensPerCycle
	| "consecutive_failures_exceeded" // Exceeded maxConsecutiveFailures
	| "user_interrupt" // User requested stop
	| "policy_blocked" // Policy engine blocked the operation
	| "dependency_unavailable" // Required dependency not available
	| "system_shutdown" // System is shutting down
	| "unknown_error"; // Unclassified error occurred

/**
 * All valid WorkerStopCondition values for runtime validation.
 */
export const ALL_WORKER_STOP_CONDITIONS: readonly WorkerStopCondition[] = [
	"completed",
	"timeout",
	"token_budget_exhausted",
	"consecutive_failures_exceeded",
	"user_interrupt",
	"policy_blocked",
	"dependency_unavailable",
	"system_shutdown",
	"unknown_error",
] as const;

/**
 * Evidence-backed diagnostic for a worker failure or stop event.
 */
export interface WorkerDiagnostic {
	/** ISO 8601 timestamp of when the diagnostic was recorded */
	timestamp: string;
	/** The stop condition that triggered this diagnostic */
	stopCondition: WorkerStopCondition;
	/** Human-readable description of what happened */
	message: string;
	/** Stack trace or error detail, if applicable */
	errorDetail?: string;
	/** Relevant context at time of stop (e.g., token usage, runtime) */
	context: Record<string, unknown>;
	/** References to source artifacts that support this diagnostic */
	evidenceRefs: string[];
}

// ---------------------------------------------------------------------------
// Worker Dedup Config
// ---------------------------------------------------------------------------

/**
 * Deduplication configuration for preventing redundant worker cycles.
 *
 * Workers should not perform the same analysis/generation twice within
 * the dedup window unless new evidence is available.
 */
export interface WorkerDedupConfig {
	/**
	 * Whether deduplication is enabled for this worker.
	 * Default: true
	 */
	enabled: boolean;

	/**
	 * Time window in milliseconds within which duplicate work is suppressed.
	 * Default: 300_000 (5 minutes)
	 */
	windowMs: number;

	/**
	 * If true, identical task hashes within the window are suppressed.
	 * If false, only exact content matches are suppressed.
	 * Default: true
	 */
	useSimilarity: boolean;

	/**
	 * Similarity threshold (0-1) for fuzzy dedup when useSimilarity is true.
	 * Default: 0.85
	 */
	similarityThreshold: number;
}

/**
 * Default dedup configuration.
 */
export const DEFAULT_WORKER_DEDUP_CONFIG: WorkerDedupConfig = {
	enabled: true,
	windowMs: 300_000,
	useSimilarity: true,
	similarityThreshold: 0.85,
};

// ---------------------------------------------------------------------------
// Worker Manifest
// ---------------------------------------------------------------------------

/**
 * A worker manifest — metadata identifying and describing a brain worker instance.
 *
 * The manifest is the identity document for a worker. It includes the
 * worker's role, contract version, capabilities, and registration
 * metadata. Manifests are immutable once registered; changes require
 * a new manifest version.
 */
export interface WorkerManifest {
	/** Unique worker identifier (UUID v4) */
	id: string;
	/** Worker role */
	role: WorkerRole;
	/** Human-readable name for this worker instance */
	name: string;
	/** Version string (semver) for this worker's manifest/contract */
	version: string;
	/** ISO 8601 timestamp of when this manifest was created */
	createdAt: string;
	/** Human-readable description of what this worker does */
	description: string;
	/** The contract this worker fulfills */
	contract: WorkerContract;
	/** Resource budget for this worker */
	budget: WorkerBudget;
	/** Deduplication configuration */
	dedupConfig: WorkerDedupConfig;
	/** Tags for categorization and querying */
	tags: string[];
	/** Arbitrary metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Worker Contract
// ---------------------------------------------------------------------------

/**
 * Input specification for a worker contract.
 *
 * Defines the data types and sources a worker consumes as input.
 */
export interface ContractInput {
	/** Unique name for this input */
	name: string;
	/** Description of what this input provides */
	description: string;
	/** The schema type of this input (e.g., "BrainObservation[]", "Signal[]") */
	type: string;
	/** Whether this input is required or optional */
	required: boolean;
	/** Source components that produce this input */
	sources: string[];
}

/**
 * Output specification for a worker contract.
 *
 * Defines the data types and destinations a worker produces as output.
 */
export interface ContractOutput {
	/** Unique name for this output */
	name: string;
	/** Description of what this output provides */
	description: string;
	/** The schema type of this output */
	type: string;
	/** Destination components that consume this output */
	destinations: string[];
}

/**
 * Error specification for a worker contract.
 *
 * Documents known error modes a worker can encounter and how they
 * manifest as diagnostics.
 */
export interface ContractError {
	/** Error code (e.g., "INPUT_VALIDATION_FAILED") */
	code: string;
	/** Description of when this error occurs */
	description: string;
	/** Severity level of this error */
	severity: "info" | "warning" | "critical";
	/** Suggested remediation */
	remediation?: string;
}

/**
 * A worker contract — the formal specification of what a worker does.
 *
 * Contracts define the input/output boundaries, capabilities, and
 * error modes of a brain worker. They are the basis for dependency
 * resolution, capability matching, and validation.
 */
export interface WorkerContract {
	/** Contract identifier (e.g., "brain-worker.observer.v1") */
	id: string;
	/** Human-readable name */
	name: string;
	/** Detailed description of the contract */
	description: string;
	/** Contract version (semver) */
	version: string;
	/** Capabilities this worker provides (free-form strings for matching) */
	capabilities: string[];
	/** Input specifications */
	inputs: ContractInput[];
	/** Output specifications */
	outputs: ContractOutput[];
	/** Documented error modes */
	errors: ContractError[];
	/** Dependencies on other worker roles or contracts */
	dependencies: string[];
	/** Whether this contract supports streaming output */
	supportsStreaming: boolean;
	/** Whether this contract supports cancellation mid-cycle */
	supportsCancellation: boolean;
}

// ---------------------------------------------------------------------------
// Worker Status
// ---------------------------------------------------------------------------

/**
 * Full status snapshot of a brain worker instance.
 *
 * Includes current lifecycle state, budget consumption, recent
 * diagnostics, and dedup state for monitoring and observability.
 */
export interface WorkerStatus {
	/** Worker instance ID (matches manifest.id) */
	workerId: string;
	/** Current lifecycle state */
	state: WorkerLifecycleState;
	/** Current role */
	role: WorkerRole;
	/** ISO 8601 timestamp of when this status was computed */
	timestamp: string;
	/** Current budget consumption snapshot */
	budgetConsumption: {
		/** Tokens consumed in the current cycle */
		currentCycleTokens: number;
		/** Total tokens consumed across all cycles */
		totalTokens: number;
		/** Current cycle runtime in ms */
		currentCycleRuntimeMs: number;
		/** Consecutive failure count */
		consecutiveFailures: number;
	};
	/** Current cooldown state */
	cooldown: WorkerCooldown;
	/** Recent diagnostics (most recent first, max 20) */
	recentDiagnostics: WorkerDiagnostic[];
	/** Number of completed work cycles */
	totalCyclesCompleted: number;
	/** Number of failed work cycles */
	totalCyclesFailed: number;
	/** ISO 8601 timestamp of last work cycle start, null if never started */
	lastCycleStartedAt: string | null;
	/** ISO 8601 timestamp of last work cycle completion, null if never completed */
	lastCycleCompletedAt: string | null;
	/** Number of deduped (suppressed) cycles */
	totalDeduped: number;
	/** Whether the worker is healthy */
	healthy: boolean;
	/** Health detail message */
	healthDetail: string;
	/** Arbitrary metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Contract Validation Result
// ---------------------------------------------------------------------------

/**
 * Result of validating a contract against requirements.
 */
export interface ContractValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

// ---------------------------------------------------------------------------
// Manifest Factory
// ---------------------------------------------------------------------------

/**
 * Create a new WorkerManifest with defaults applied.
 *
 * Only `role`, `name`, and `description` are required; everything else
 * gets sensible defaults from the role's budget profile and contract
 * template.
 */
export function createWorkerManifest(
	overrides: Pick<WorkerManifest, "name" | "description"> & {
		role: WorkerRole;
		contract: WorkerContract;
	} & Partial<Omit<WorkerManifest, "id" | "createdAt" | "contract" | "budget" | "dedupConfig">>,
): WorkerManifest {
	return {
		id: randomUUID(),
		createdAt: new Date().toISOString(),
		budget: { ...DEFAULT_ROLE_BUDGETS[overrides.role] },
		dedupConfig: { ...DEFAULT_WORKER_DEDUP_CONFIG },
		tags: [],
		metadata: {},
		version: "1.0.0",
		...overrides,
	};
}

/**
 * Create a new empty WorkerCooldown (not cooling).
 */
export function createWorkerCooldown(): WorkerCooldown {
	return {
		startedAt: null,
		endsAt: null,
		reason: "",
		count: 0,
	};
}

/**
 * Create a WorkerDiagnostic from a stop condition.
 */
export function createWorkerDiagnostic(
	stopCondition: WorkerStopCondition,
	message: string,
	context: Record<string, unknown> = {},
	evidenceRefs: string[] = [],
	errorDetail?: string,
): WorkerDiagnostic {
	return {
		timestamp: new Date().toISOString(),
		stopCondition,
		message,
		errorDetail,
		context,
		evidenceRefs,
	};
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Result of a type validation check.
 */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Validate a WorkerManifest object.
 */
export function validateWorkerManifest(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const m = value as Record<string, unknown>;

	if (typeof m.id !== "string" || m.id.length === 0) {
		errors.push("id must be a non-empty string");
	}
	if (!ALL_WORKER_ROLES.includes(m.role as WorkerRole)) {
		errors.push(`role must be one of: ${ALL_WORKER_ROLES.join(", ")}`);
	}
	if (typeof m.name !== "string" || m.name.length === 0) {
		errors.push("name must be a non-empty string");
	}
	if (typeof m.version !== "string" || m.version.length === 0) {
		errors.push("version must be a non-empty string");
	}
	if (typeof m.description !== "string") {
		errors.push("description must be a string");
	}
	if (!m.contract || typeof m.contract !== "object") {
		errors.push("contract must be a non-null object");
	}
	if (!m.budget || typeof m.budget !== "object") {
		errors.push("budget must be a non-null object");
	}
	if (m.tags !== undefined && !Array.isArray(m.tags)) {
		errors.push("tags must be an array");
	}
	if (m.metadata !== undefined && (typeof m.metadata !== "object" || m.metadata === null)) {
		errors.push("metadata must be a non-null object");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a WorkerContract object.
 */
export function validateWorkerContract(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const c = value as Record<string, unknown>;

	if (typeof c.id !== "string" || c.id.length === 0) {
		errors.push("id must be a non-empty string");
	}
	if (typeof c.name !== "string" || c.name.length === 0) {
		errors.push("name must be a non-empty string");
	}
	if (typeof c.description !== "string") {
		errors.push("description must be a string");
	}
	if (typeof c.version !== "string" || c.version.length === 0) {
		errors.push("version must be a non-empty string");
	}
	if (!Array.isArray(c.capabilities)) {
		errors.push("capabilities must be an array");
	}
	if (!Array.isArray(c.inputs)) {
		errors.push("inputs must be an array");
	}
	if (!Array.isArray(c.outputs)) {
		errors.push("outputs must be an array");
	}
	if (!Array.isArray(c.errors)) {
		errors.push("errors must be an array");
	}
	if (!Array.isArray(c.dependencies)) {
		errors.push("dependencies must be an array");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a WorkerBudget object.
 */
export function validateWorkerBudget(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const b = value as Record<string, unknown>;

	if (typeof b.maxTokensPerCycle !== "number" || b.maxTokensPerCycle < 0) {
		errors.push("maxTokensPerCycle must be a non-negative number");
	}
	if (typeof b.maxConsecutiveFailures !== "number" || b.maxConsecutiveFailures < 1) {
		errors.push("maxConsecutiveFailures must be a number >= 1");
	}
	if (typeof b.cooldownMs !== "number" || b.cooldownMs < 0) {
		errors.push("cooldownMs must be a non-negative number");
	}
	if (typeof b.maxRuntimeMs !== "number" || b.maxRuntimeMs < 0) {
		errors.push("maxRuntimeMs must be a non-negative number");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a WorkerStatus object.
 */
export function validateWorkerStatus(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const s = value as Record<string, unknown>;

	if (typeof s.workerId !== "string" || s.workerId.length === 0) {
		errors.push("workerId must be a non-empty string");
	}
	if (!ALL_WORKER_LIFECYCLE_STATES.includes(s.state as WorkerLifecycleState)) {
		errors.push(`state must be one of: ${ALL_WORKER_LIFECYCLE_STATES.join(", ")}`);
	}
	if (!ALL_WORKER_ROLES.includes(s.role as WorkerRole)) {
		errors.push(`role must be one of: ${ALL_WORKER_ROLES.join(", ")}`);
	}
	if (typeof s.healthy !== "boolean") {
		errors.push("healthy must be a boolean");
	}

	return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Serialization Helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a WorkerManifest to a JSON string.
 */
export function serializeWorkerManifest(manifest: WorkerManifest): string {
	return JSON.stringify(manifest, null, 2);
}

/**
 * Deserialize a JSON string to a WorkerManifest with validation.
 * Returns the parsed object if valid, or throws if invalid.
 */
export function deserializeWorkerManifest(json: string): WorkerManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(`Failed to parse WorkerManifest JSON: ${(e as Error).message}`);
	}

	const result = validateWorkerManifest(parsed);
	if (!result.valid) {
		throw new Error(`Invalid WorkerManifest: ${result.errors.join("; ")}`);
	}

	return parsed as WorkerManifest;
}

/**
 * Serialize a WorkerStatus to a JSON string.
 */
export function serializeWorkerStatus(status: WorkerStatus): string {
	return JSON.stringify(status, null, 2);
}

/**
 * Deserialize a JSON string to a WorkerStatus with validation.
 * Returns the parsed object if valid, or throws if invalid.
 */
export function deserializeWorkerStatus(json: string): WorkerStatus {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(`Failed to parse WorkerStatus JSON: ${(e as Error).message}`);
	}

	const result = validateWorkerStatus(parsed);
	if (!result.valid) {
		throw new Error(`Invalid WorkerStatus: ${result.errors.join("; ")}`);
	}

	return parsed as WorkerStatus;
}
