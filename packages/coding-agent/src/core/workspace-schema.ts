/**
 * Workspace Schema & Validation - P2 Workstream 7.B
 *
 * Defines normalized workspace schema, validation logic, and state machine.
 * Contract Schema v2.2.0: adds parallelGroup, dependencyReason on Workspace;
 *   planExecution.interactiveParallelismReview and parallelismReview on WorkspaceQueue.
 * Contract Schema v2.3.0: adds planExecution.scale, planExecution.worktree,
 *   planExecution.integrationQueue, planExecution.validation;
 *   supports experimental_6 mode (maxParallelWorkspaces up to 6).
 */

import type { TokenRole } from "@earendil-works/pi-agent-core";
import type { BlastRadiusConfig } from "./budget-enforcer.js";
import type { RetryPolicy } from "./retry-handler.js";

// ---------------------------------------------------------------------------
// Contract Schema Version Constants
// ---------------------------------------------------------------------------

/**
 * Maximum maxParallelWorkspaces for pre-v2.3.0 schema versions.
 */
const MAX_PARALLEL_LEGACY = 3;

/**
 * Maximum maxParallelWorkspaces for v2.3.0+ when using experimental_6 mode.
 */
const MAX_PARALLEL_EXPERIMENTAL = 6;

// ---------------------------------------------------------------------------
// Contract Schema Version
// ---------------------------------------------------------------------------

/**
 * Supported contract schema versions.
 *
 * - 2.0.0: Original schema (phase, title, workspaces, maxParallelWorkspaces)
 * - 2.1.0: Added postPlanHandoff, workspace retryPolicy, riskLevel, capabilities
 * - 2.2.0: Added parallelGroup, dependencyReason on Workspace;
 *          planExecution.interactiveParallelismReview on WorkspaceQueue;
 *          parallelismReview on WorkspaceQueue
 * - 2.3.0: Added planExecution.scale, planExecution.worktree,
 *          planExecution.integrationQueue, planExecution.validation;
 *          supports experimental_6 mode (maxParallelWorkspaces up to 6).
 * - 2.3.1: Added queuePriority, queueOptimization to workspace/plan execution.
 * - 2.3.2: Default scale mode changed to experimental_6, worktree isolation enabled by default.
 */
export const CONTRACT_SCHEMA_VERSION = "2.3.2" as const;

/**
 * Set of all contract schema versions that this parser accepts.
 * Plans declaring any of these versions will be accepted.
 *
 * Maintained as an explicit set for forward/backward compat.
 * When bumping the schema version, add the new version here and
 * update CONTRACT_SCHEMA_VERSION above. The tests will fail if
 * CONTRACT_SCHEMA_VERSION is not in ACCEPTED_SCHEMA_VERSIONS.
 */
export const ACCEPTED_SCHEMA_VERSIONS: ReadonlySet<string> = new Set([
	"2.0.0",
	"2.1.0",
	"2.2.0",
	"2.3.0",
	"2.3.1",
	"2.3.2",
	"2.4.0",
	"2.5.0",
]);

/**
 * Check whether a given version string is an accepted contract schema version.
 *
 * @param version - Version string to check (e.g., "2.2.0")
 * @returns True if the version is accepted
 */
export function isAcceptedSchemaVersion(version: string): boolean {
	return ACCEPTED_SCHEMA_VERSIONS.has(version);
}

// ---------------------------------------------------------------------------
// Parallelism Review
// ---------------------------------------------------------------------------

/**
 * Configuration for the parallelism review gate.
 *
 * When present in planExecution, the execution engine pauses before
 * launching parallel workspaces so that a human (or automated reviewer)
 * can review and approve/reject the proposed parallelism grouping.
 */
export interface ParallelismReview {
	/** Whether the parallelism review gate is enabled */
	enabled: boolean;
	/**
	 * Maximum number of workspaces that can run in parallel without review.
	 * If null or undefined, any parallelism triggers review.
	 */
	threshold?: number | null;
	/**
	 * Human-readable description of what the reviewer should check.
	 */
	description?: string;
	/**
	 * Additional metadata for the review gate.
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Plan execution configuration.
 *
 * Top-level execution controls that govern how the plan is run.
 */
export interface PlanExecutionConfig {
	/**
	 * Whether to require an interactive parallelism review before
	 * launching workspaces that share a parallelGroup.
	 *
	 * When true, the execution engine presents the proposed parallel
	 * workspace schedule and asks for explicit approval before proceeding.
	 */
	interactiveParallelismReview?: boolean;

	/**
	 * Scaling configuration.
	 *
	 * Contract Schema v2.3.0 field.
	 */
	scale?: PlanExecutionScale;

	/**
	 * Worktree configuration.
	 *
	 * When enabled, each workspace runs in its own worktree.
	 * Required for experimental_6 mode.
	 *
	 * Contract Schema v2.3.0 field.
	 */
	worktree?: { enabled: boolean };

	/**
	 * Integration queue configuration.
	 *
	 * When enabled, serializes integration-related workspaces.
	 * Required for experimental_6 mode.
	 *
	 * Contract Schema v2.3.0 field.
	 */
	integrationQueue?: { enabled: boolean };

	/**
	 * Validation configuration.
	 *
	 * Contract Schema v2.3.0 field.
	 */
	validation?: PlanExecutionValidation;

	/**
	 * Budget and blast-radius controls for plan execution.
	 *
	 * Defines default limits on token usage, file modifications, path
	 * restrictions, and approval expiry for all workspaces in the plan.
	 * Individual workspace blastRadius overrides these defaults.
	 *
	 * P9.E field.
	 */
	blastRadius?: BlastRadiusConfig;
}

/**
 * Scaling configuration for plan execution.
 *
 * Contract Schema v2.3.0.
 */
export interface PlanExecutionScale {
	/**
	 * Selected scaling mode.
	 * - "standard": Legacy parallelism (maxParallelWorkspaces <= 3)
	 * - "experimental_6": Expanded parallelism (maxParallelWorkspaces <= 6)
	 */
	selectedMode: "standard" | "experimental_6";
}

/**
 * Validation configuration for plan execution.
 *
 * Contract Schema v2.3.0.
 */
export interface PlanExecutionValidation {
	/**
	 * Whether global validation lock is required before validation runs.
	 * Required for experimental_6 mode.
	 */
	globalValidationLockRequired?: boolean;
}

/**
 * Workspace execution stage (state machine)
 */
export enum WorkspaceStage {
	/** Workspace is waiting for dependencies */
	Pending = "pending",
	/** Workspace is currently being executed */
	Active = "active",
	/** Workspace completed successfully */
	Complete = "complete",
	/** Workspace is blocked (dependencies failed or file conflicts) */
	Blocked = "blocked",
	/** Workspace execution failed */
	Failed = "failed",
}

/**
 * Workspace dependency specification
 *
 * Describes a single dependency of one workspace on another,
 * including whether it is a hard (blocking) or soft (ordering hint)
 * dependency, and an optional reason.
 *
 * Contract Schema v2.4.0 field.
 */
export interface WorkspaceDependency {
	/** The workspace ID this dependency targets */
	id: string;
	/**
	 * Dependency type:
	 * - "hard": This workspace cannot start until the target completes.
	 * - "soft": Ordering hint only; execution is not blocked if the
	 *   target has not completed.
	 */
	type: "hard" | "soft";
	/** Human-readable reason for this dependency */
	reason?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Workspace capability manifest
 *
 * Defines file boundaries for workspace execution to prevent
 * unintended modifications and enable safe parallelism.
 */
export interface WorkspaceCapabilityManifest {
	/** Files this workspace can read and edit */
	canEdit: string[];
	/** Files this workspace must not edit (read-only or forbidden) */
	cannotEdit?: string[];
	/** Commands this workspace can run */
	canRun: string[];
	/** Commands this workspace must not run */
	cannotRun?: string[];
	/**
	 * Validation weight/profile for the workspace.
	 * Used by execution simulation to predict contention.
	 * - "light": minimal validation overhead
	 * - "heavy": significant validation time, may cause contention
	 * - "full": exhaustive validation, blocks other validation in same batch
	 */
	validation?: "light" | "heavy" | "full";
}

/**
 * Normalized workspace specification
 *
 * This is the canonical workspace format used throughout P2 execution.
 */
export interface Workspace {
	/** Unique workspace identifier (e.g., "7.A") */
	id: string;
	/** Human-readable title */
	title: string;
	/** Workspace IDs this workspace depends on */
	dependencies: string[];
	/** Role budget for this workspace */
	roleBudget: TokenRole;
	/** Maximum retry attempts for failures */
	maxRetries: number;
	/** Retry policy with escalation thresholds (overrides defaults) */
	retryPolicy?: RetryPolicy;
	/** Risk level (affects parallelism decisions) */
	riskLevel?: "low" | "medium" | "high";
	/** Capability manifest (file/command boundaries) */
	capabilities?: WorkspaceCapabilityManifest;
	/** Acceptance criteria (optional, for validation) */
	acceptanceCriteria?: string[];
	/** Target command to run after completion (optional) */
	targetCommand?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
	/**
	 * Auto-commit on completion.
	 * If false, no git commits are made for this workspace.
	 * Defaults to true if unspecified.
	 */
	autoCommit?: boolean;

	/**
	 * Parallel group identifier.
	 *
	 * Workspaces sharing the same parallelGroup value may be executed
	 * concurrently by the scheduler. Workspaces with no parallelGroup
	 * follow the default dependency-based scheduling.
	 *
	 * Contract Schema v2.2.0 field.
	 */
	parallelGroup?: string;

	/**
	 * Human-readable reason explaining why this workspace depends on
	 * its listed dependencies.
	 *
	 * Useful for parallelism review and execution traceability.
	 *
	 * Contract Schema v2.2.0 field.
	 */
	dependencyReason?: Record<string, string>;

	/**
	 * Whether this workspace requires pre-flight review approval
	 * before execution can proceed.
	 *
	 * When true, the execution engine blocks this workspace in
	 * Pending state until a human or automated reviewer explicitly
	 * approves it. Used for high-risk or security-sensitive workspaces.
	 *
	 * Contract Schema v2.2.0 field.
	 */
	preflightRequired?: boolean;

	/**
	 * Budget and blast-radius controls for this workspace.
	 *
	 * Defines limits on token usage, file modifications, path restrictions,
	 * and approval expiry. When set, these override any defaults from the
	 * plan execution configuration.
	 *
	 * P9.E field.
	 */
	blastRadius?: BlastRadiusConfig;

	/**
	 * Hard dependency IDs — workspaces that must complete before this
	 * workspace can start.
	 *
	 * When set, these augment or clarify the hard-blocking subset of
	 * `dependencies`. The DAG computation uses `dependencies` for
	 * topological ordering; this field provides explicit labeling of
	 * which deps are hard-blocking.
	 *
	 * Contract Schema v2.4.0 field.
	 */
	hardDeps?: string[];

	/**
	 * Soft dependency IDs — workspaces that should complete before this
	 * workspace starts, but are not required. Used for ordering hints
	 * that do not block execution.
	 *
	 * Contract Schema v2.4.0 field.
	 */
	softDeps?: string[];

	/**
	 * Set of file paths this workspace reads (but does not write).
	 *
	 * Used by the DAG optimizer and scheduler to detect read/write
	 * conflicts that could prevent safe parallel execution.
	 *
	 * Contract Schema v2.4.0 field.
	 */
	readSet?: string[];

	/**
	 * Set of file paths this workspace writes (creates or modifies).
	 *
	 * Used by the DAG optimizer and scheduler to detect write/write and
	 * read/write conflicts that could prevent safe parallel execution.
	 *
	 * Contract Schema v2.4.0 field.
	 */
	writeSet?: string[];

	/**
	 * Set of symbols (function names, type names, variable names) that
	 * this workspace claims or introduces.
	 *
	 * Used by the DAG optimizer to detect symbol-level conflicts and
	 * to suggest safe reorderings or splits.
	 *
	 * Contract Schema v2.4.0 field.
	 */
	symbolClaims?: string[];

	/**
	 * Estimated execution duration in milliseconds.
	 *
	 * Used by the scheduler and DAG optimizer to compute expected
	 * wall-clock time and to detect load imbalance.
	 *
	 * Contract Schema v2.4.0 field.
	 */
	estimatedDurationMs?: number;

	/**
	 * Whether this workspace is a candidate for splitting into smaller
	 * sub-workspaces.
	 *
	 * When true, the DAG optimizer may propose splitting this workspace
	 * to improve parallelism or reduce serialized tail length.
	 *
	 * Contract Schema v2.4.0 field.
	 */
	splitCandidate?: boolean;
}

// ---------------------------------------------------------------------------
// Topological Batch & Approved Preview Metadata
// ---------------------------------------------------------------------------

/**
 * A topological batch of workspaces that can execute in parallel.
 *
 * Batches are computed from the approved dependency graph via Kahn's algorithm.
 * Workspaces in the same batch have all dependencies satisfied by earlier batches.
 */
export interface TopologicalBatch {
	/** 1-based batch index */
	batchIndex: number;
	/** Workspace IDs in this batch */
	workspaceIds: string[];
	/** Number of workspaces in this batch */
	width: number;
}

/**
 * Approved preview metadata persisted alongside execution.
 *
 * Records the dependency graph and batch plan that were approved
 * before execution started, ensuring the executor uses the approved
 * dependency graph rather than stale parser output.
 */
export interface ApprovedPreviewMetadata {
	/** Batch assignments (workspace ID -> 1-based batch index) */
	batchAssignment: Record<string, number>;
	/** Topological batches */
	batches: TopologicalBatch[];
	/** Effective parallelism from approved graph */
	effectiveParallelism: number;
	/** Whether dependency patches were applied during preview */
	patchesApplied: boolean;
	/** Timestamp when preview was approved */
	approvedAt: number;
}

/**
 * Workspace queue (collection of workspaces)
 */
export interface WorkspaceQueue {
	/** Phase identifier (e.g., "P2") */
	phase: string;
	/** Phase title */
	title: string;
	/** Maximum parallel workspaces */
	maxParallelWorkspaces: number;
	/** Workspaces in execution order */
	workspaces: Workspace[];
	/**
	 * Enable post-plan handoff dialog.
	 * When true (default), plan enters awaiting_handoff state after all workspaces complete
	 * and waits for user to commit, keep editing, or discard.
	 * When false, plan auto-commits without handoff dialog.
	 */
	postPlanHandoff?: boolean;

	/**
	 * Contract schema version.
	 *
	 * Identifies which version of the plan contract schema this queue
	 * adheres to. When absent, defaults to the latest accepted version.
	 *
	 * Contract Schema v2.2.0 field.
	 */
	contractVersion?: string;

	/**
	 * Plan execution configuration.
	 *
	 * Top-level controls for how the plan is executed, including
	 * parallelism review gates.
	 *
	 * Contract Schema v2.2.0 field.
	 */
	planExecution?: PlanExecutionConfig;

	/**
	 * Parallelism review configuration.
	 *
	 * When present, the execution engine may pause before launching
	 * parallel workspaces so that a reviewer can approve the grouping.
	 *
	 * Contract Schema v2.2.0 field.
	 */
	parallelismReview?: ParallelismReview;

	/**
	 * Whether this queue represents a draft plan (non-executable until approved).
	 *
	 * Draft plans are generated from approved proposals but remain
	 * non-executable until they pass normal plan approval gates.
	 * The lead agent that created the draft cannot enqueue or execute it.
	 *
	 * P8.E field.
	 */
	isDraft?: boolean;

	/**
	 * The agent ID of the lead agent that created this draft plan.
	 *
	 * When set, this lead agent cannot enqueue or execute the draft.
	 * Only set when isDraft is true.
	 *
	 * P8.E field.
	 */
	leadAgentId?: string;
}

/**
 * Validation error
 */
export interface ValidationError {
	/** Error type */
	type:
		| "duplicate_id"
		| "invalid_dependency"
		| "cycle"
		| "invalid_role"
		| "missing_field"
		| "invalid_contract_version"
		| "invalid_parallelism_review"
		| "invalid_dependency_reason";
	/** Error message */
	message: string;
	/** Workspace ID (if applicable) */
	workspaceId?: string;
	/** Additional context */
	context?: Record<string, unknown>;
}

/**
 * Validation result
 */
export interface ValidationResult {
	/** Whether validation passed */
	valid: boolean;
	/** Validation errors (if any) */
	errors: ValidationError[];
	/** Warnings (non-fatal issues) */
	warnings: ValidationError[];
}

/**
 * Validate workspace queue
 *
 * Checks for:
 * - Duplicate workspace IDs
 * - Invalid dependency references
 * - Dependency cycles
 * - Invalid role budgets
 * - Missing required fields
 *
 * @param queue - Workspace queue to validate
 * @returns Validation result
 */
export function validateWorkspaceQueue(queue: WorkspaceQueue): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationError[] = [];

	// Check for duplicate IDs
	const idSet = new Set<string>();
	for (const workspace of queue.workspaces) {
		if (idSet.has(workspace.id)) {
			errors.push({
				type: "duplicate_id",
				message: `Duplicate workspace ID: ${workspace.id}`,
				workspaceId: workspace.id,
			});
		}
		idSet.add(workspace.id);
	}

	// Check for invalid dependencies
	for (const workspace of queue.workspaces) {
		for (const dep of workspace.dependencies) {
			if (!idSet.has(dep)) {
				errors.push({
					type: "invalid_dependency",
					message: `Workspace ${workspace.id} depends on non-existent workspace: ${dep}`,
					workspaceId: workspace.id,
					context: { dependency: dep },
				});
			}
		}
	}

	// Check for cycles
	const cycleResult = detectCycles(queue.workspaces);
	if (cycleResult.hasCycle) {
		errors.push({
			type: "cycle",
			message: `Dependency cycle detected: ${cycleResult.cycle?.join(" → ")}`,
			context: { cycle: cycleResult.cycle },
		});
	}

	// Check for invalid role budgets
	const validRoles: TokenRole[] = ["flash", "worker", "lead", "reviewer", "debug", "unknown"];
	for (const workspace of queue.workspaces) {
		if (!validRoles.includes(workspace.roleBudget)) {
			errors.push({
				type: "invalid_role",
				message: `Workspace ${workspace.id} has invalid role budget: ${workspace.roleBudget}`,
				workspaceId: workspace.id,
				context: { role: workspace.roleBudget },
			});
		}
	}

	// Check for missing required fields
	for (const workspace of queue.workspaces) {
		if (!workspace.id) {
			errors.push({
				type: "missing_field",
				message: "Workspace missing required field: id",
				context: { workspace },
			});
		}
		if (!workspace.title) {
			errors.push({
				type: "missing_field",
				message: `Workspace ${workspace.id} missing required field: title`,
				workspaceId: workspace.id,
			});
		}
	}

	// Warnings for high-risk workspaces
	for (const workspace of queue.workspaces) {
		if (workspace.riskLevel === "high" && workspace.dependencies.length === 0) {
			warnings.push({
				type: "invalid_dependency",
				message: `High-risk workspace ${workspace.id} has no dependencies (may want to serialize)`,
				workspaceId: workspace.id,
			});
		}
	}

	// v2.2.0+: Validate contract version if declared
	if (queue.contractVersion !== undefined && !isAcceptedSchemaVersion(queue.contractVersion)) {
		errors.push({
			type: "invalid_contract_version",
			message: `Unsupported contract version: ${queue.contractVersion}. Accepted versions: ${Array.from(ACCEPTED_SCHEMA_VERSIONS).join(", ")}`,
			context: { contractVersion: queue.contractVersion },
		});
	}

	// v2.3.0+: Validate maxParallelWorkspaces limits and prerequisites
	// v2.3.1 inherits all v2.3.0 validation rules
	const contractVer = queue.contractVersion ?? "2.0.0";
	const isV230Plus = contractVer === "2.3.0" || contractVer === "2.3.1" || contractVer === "2.3.2" || contractVer === "2.4.0" || contractVer === "2.5.0";

	if (queue.maxParallelWorkspaces < 1) {
		errors.push({
			type: "invalid_parallelism_review",
			message: `maxParallelWorkspaces must be at least 1, got ${queue.maxParallelWorkspaces}`,
			context: { maxParallelWorkspaces: queue.maxParallelWorkspaces },
		});
	} else if (isV230Plus) {
		const selectedMode = queue.planExecution?.scale?.selectedMode;
		const isExperimental6 = selectedMode === "experimental_6";

		if (isExperimental6 && queue.maxParallelWorkspaces > MAX_PARALLEL_EXPERIMENTAL) {
			errors.push({
				type: "invalid_parallelism_review",
				message: `maxParallelWorkspaces ${queue.maxParallelWorkspaces} exceeds experimental_6 limit of ${MAX_PARALLEL_EXPERIMENTAL}`,
				context: { maxParallelWorkspaces: queue.maxParallelWorkspaces, limit: MAX_PARALLEL_EXPERIMENTAL },
			});
		} else if (!isExperimental6 && queue.maxParallelWorkspaces > MAX_PARALLEL_LEGACY) {
			errors.push({
				type: "invalid_parallelism_review",
				message: `maxParallelWorkspaces ${queue.maxParallelWorkspaces} exceeds standard limit of ${MAX_PARALLEL_LEGACY}. Set planExecution.scale.selectedMode to "experimental_6" to allow up to ${MAX_PARALLEL_EXPERIMENTAL}.`,
				context: { maxParallelWorkspaces: queue.maxParallelWorkspaces, limit: MAX_PARALLEL_LEGACY },
			});
		}

		// Experimental_6 prerequisites check
		if (isExperimental6 && queue.maxParallelWorkspaces > MAX_PARALLEL_LEGACY) {
			const planExec = queue.planExecution;
			if (!planExec?.worktree?.enabled) {
				errors.push({
					type: "missing_field",
					message: "Experimental_6 mode requires planExecution.worktree.enabled to be true",
					context: { requiredField: "planExecution.worktree" },
				});
			}
			if (!planExec?.integrationQueue?.enabled) {
				errors.push({
					type: "missing_field",
					message: "Experimental_6 mode requires planExecution.integrationQueue.enabled to be true",
					context: { requiredField: "planExecution.integrationQueue" },
				});
			}
			if (!planExec?.validation?.globalValidationLockRequired) {
				errors.push({
					type: "missing_field",
					message: "Experimental_6 mode requires planExecution.validation.globalValidationLockRequired to be true",
					context: { requiredField: "planExecution.validation.globalValidationLockRequired" },
				});
			}
		}
	} else if (queue.maxParallelWorkspaces > MAX_PARALLEL_LEGACY) {
		// Pre-v2.3.0: enforce the legacy 1-3 limit
		errors.push({
			type: "invalid_parallelism_review",
			message: `maxParallelWorkspaces must be between 1 and ${MAX_PARALLEL_LEGACY} for contract version ${contractVer}, got ${queue.maxParallelWorkspaces}`,
			context: {
				maxParallelWorkspaces: queue.maxParallelWorkspaces,
				limit: MAX_PARALLEL_LEGACY,
				contractVersion: contractVer,
			},
		});
	}

	// v2.2.0: Validate parallelismReview if declared
	if (queue.parallelismReview !== undefined) {
		if (typeof queue.parallelismReview.enabled !== "boolean") {
			errors.push({
				type: "invalid_parallelism_review",
				message: "parallelismReview.enabled must be a boolean",
				context: { parallelismReview: queue.parallelismReview },
			});
		}
		if (
			queue.parallelismReview.threshold !== undefined &&
			queue.parallelismReview.threshold !== null &&
			typeof queue.parallelismReview.threshold !== "number"
		) {
			errors.push({
				type: "invalid_parallelism_review",
				message: "parallelismReview.threshold must be a number or null",
				context: { parallelismReview: queue.parallelismReview },
			});
		}
		if (typeof queue.parallelismReview.threshold === "number" && queue.parallelismReview.threshold < 0) {
			errors.push({
				type: "invalid_parallelism_review",
				message: "parallelismReview.threshold must be non-negative",
				context: { parallelismReview: queue.parallelismReview },
			});
		}
	}

	// v2.2.0: Validate dependencyReason keys reference valid dependencies
	for (const workspace of queue.workspaces) {
		if (workspace.dependencyReason) {
			for (const depId of Object.keys(workspace.dependencyReason)) {
				if (!workspace.dependencies.includes(depId)) {
					warnings.push({
						type: "invalid_dependency_reason",
						message: `Workspace ${workspace.id} has dependencyReason for "${depId}" which is not listed in dependencies`,
						workspaceId: workspace.id,
						context: { dependencyReason: workspace.dependencyReason, invalidKey: depId },
					});
				}
			}
		}
	}

	// P9.E: Validate blast-radius configuration
	const planExec = queue.planExecution;
	if (planExec?.blastRadius) {
		const br = planExec.blastRadius;
		if (br.maxFiles !== undefined && br.maxFiles < 1) {
			errors.push({
				type: "missing_field",
				message: `blastRadius.maxFiles must be at least 1, got ${br.maxFiles}`,
				context: { maxFiles: br.maxFiles },
			});
		}
		if (br.maxLines !== undefined && br.maxLines < 1) {
			errors.push({
				type: "missing_field",
				message: `blastRadius.maxLines must be at least 1, got ${br.maxLines}`,
				context: { maxLines: br.maxLines },
			});
		}
		if (br.approvalExpiry !== undefined && br.approvalExpiry !== null && br.approvalExpiry < 0) {
			errors.push({
				type: "missing_field",
				message: `blastRadius.approvalExpiry must be non-negative or null, got ${br.approvalExpiry}`,
				context: { approvalExpiry: br.approvalExpiry },
			});
		}
	}

	// P9.E: Validate per-workspace blast-radius configuration
	for (const workspace of queue.workspaces) {
		if (workspace.blastRadius) {
			const br = workspace.blastRadius;
			if (br.maxFiles !== undefined && br.maxFiles < 1) {
				errors.push({
					type: "missing_field",
					message: `Workspace ${workspace.id} blastRadius.maxFiles must be at least 1, got ${br.maxFiles}`,
					workspaceId: workspace.id,
					context: { maxFiles: br.maxFiles },
				});
			}
			if (br.maxLines !== undefined && br.maxLines < 1) {
				errors.push({
					type: "missing_field",
					message: `Workspace ${workspace.id} blastRadius.maxLines must be at least 1, got ${br.maxLines}`,
					workspaceId: workspace.id,
					context: { maxLines: br.maxLines },
				});
			}
			if (br.approvalExpiry !== undefined && br.approvalExpiry !== null && br.approvalExpiry < 0) {
				errors.push({
					type: "missing_field",
					message: `Workspace ${workspace.id} blastRadius.approvalExpiry must be non-negative or null, got ${br.approvalExpiry}`,
					workspaceId: workspace.id,
					context: { approvalExpiry: br.approvalExpiry },
				});
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Detect cycles in workspace dependencies
 *
 * Uses depth-first search to detect cycles in the dependency graph.
 *
 * @param workspaces - Workspaces to check
 * @returns Cycle detection result
 */
export function detectCycles(workspaces: Workspace[]): { hasCycle: boolean; cycle?: string[] } {
	const graph = new Map<string, string[]>();
	for (const workspace of workspaces) {
		graph.set(workspace.id, workspace.dependencies);
	}

	const visited = new Set<string>();
	const recursionStack = new Set<string>();
	const path: string[] = [];

	function dfs(nodeId: string): boolean {
		visited.add(nodeId);
		recursionStack.add(nodeId);
		path.push(nodeId);

		const neighbors = graph.get(nodeId) || [];
		for (const neighbor of neighbors) {
			if (!visited.has(neighbor)) {
				if (dfs(neighbor)) {
					return true;
				}
			} else if (recursionStack.has(neighbor)) {
				// Cycle detected
				const cycleStart = path.indexOf(neighbor);
				const cycle = path.slice(cycleStart);
				cycle.push(neighbor); // Complete the cycle
				return true;
			}
		}

		recursionStack.delete(nodeId);
		path.pop();
		return false;
	}

	for (const workspace of workspaces) {
		if (!visited.has(workspace.id)) {
			if (dfs(workspace.id)) {
				return { hasCycle: true, cycle: path.slice() };
			}
		}
	}

	return { hasCycle: false };
}

/**
 * Build dependency graph
 *
 * Creates an adjacency list representation of workspace dependencies.
 *
 * @param workspaces - Workspaces to build graph from
 * @returns Dependency graph (workspace ID -> dependent workspace IDs)
 */
export function buildDependencyGraph(workspaces: Workspace[]): Map<string, string[]> {
	const graph = new Map<string, string[]>();

	// Initialize graph
	for (const workspace of workspaces) {
		graph.set(workspace.id, []);
	}

	// Build reverse dependency graph (who depends on me?)
	for (const workspace of workspaces) {
		for (const dep of workspace.dependencies) {
			const dependents = graph.get(dep);
			if (dependents) {
				dependents.push(workspace.id);
			}
		}
	}

	return graph;
}

/**
 * Get workspaces with no dependencies (entry points)
 *
 * @param workspaces - Workspaces to check
 * @returns Workspaces with no dependencies
 */
export function getEntryWorkspaces(workspaces: Workspace[]): Workspace[] {
	return workspaces.filter((w) => w.dependencies.length === 0);
}

/**
 * Check if workspace capabilities allow editing a file
 *
 * @param capabilities - Workspace capabilities
 * @param filePath - File path to check
 * @returns True if workspace can edit the file
 */
export function canEditFile(capabilities: WorkspaceCapabilityManifest | undefined, filePath: string): boolean {
	if (!capabilities) {
		return true; // No restrictions
	}

	// Check if explicitly forbidden
	if ((capabilities.cannotEdit ?? []).some((pattern) => matchesPattern(filePath, pattern))) {
		return false;
	}

	// Check if explicitly allowed
	if (capabilities.canEdit.length > 0) {
		return capabilities.canEdit.some((pattern) => matchesPattern(filePath, pattern));
	}

	// No explicit restrictions
	return true;
}

/**
 * Check if workspace capabilities allow running a command
 *
 * @param capabilities - Workspace capabilities
 * @param command - Command to check
 * @returns True if workspace can run the command
 */
export function canRunCommand(capabilities: WorkspaceCapabilityManifest | undefined, command: string): boolean {
	if (!capabilities) {
		return true; // No restrictions
	}

	// Check if explicitly forbidden
	if ((capabilities.cannotRun ?? []).some((pattern) => matchesPattern(command, pattern))) {
		return false;
	}

	// Check if explicitly allowed
	if (capabilities.canRun.length > 0) {
		return capabilities.canRun.some((pattern) => matchesPattern(command, pattern));
	}

	// No explicit restrictions
	return true;
}

/**
 * Simple pattern matching (supports wildcards)
 *
 * @param value - Value to match
 * @param pattern - Pattern (supports * wildcard)
 * @returns True if value matches pattern
 */
function matchesPattern(value: string, pattern: string): boolean {
	// Convert glob pattern to regex
	const regexPattern = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
		.replace(/\*/g, ".*"); // Convert * to .*

	const regex = new RegExp(`^${regexPattern}$`);
	return regex.test(value);
}
