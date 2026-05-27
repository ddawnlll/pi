/**
 * Plan Synthesizer Worker — 25.N
 *
 * Synthesizes execution plans from goals, proposals, and context,
 * producing DAG-structured plans with tasks, dependencies, milestones,
 * resource estimates, and template-rendered descriptions.
 *
 * Key design:
 * - Each synthesis session is a self-contained unit with goal
 *   decomposition, DAG building, template rendering, and resource
 *   estimation phases.
 * - Budget limits (tokens, runtime, consecutive failures) are enforced
 *   per session.
 * - Deduplication prevents re-synthesizing the same goal signature
 *   within the dedup window.
 * - All failures surface evidence-backed diagnostics rather than
 *   silent errors.
 * - The worker can be paused, resumed, or retired via the lifecycle
 *   engine.
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from "node:crypto";
import type {
	WorkerContract,
	WorkerDedupConfig,
	WorkerDiagnostic,
	WorkerManifest,
	WorkerStopCondition,
} from "../types.js";
import { createWorkerDiagnostic, createWorkerManifest } from "../types.js";
import { createDagBuilder, type DagBuilder, type PlanTask, type PlanTaskPriority } from "./dag-builder.js";
import {
	createTemplateRenderer,
	type PlanTemplate,
	type TemplateContext,
	type TemplateRenderer,
	type TemplateRenderResult,
} from "./template-renderer.js";

// ---------------------------------------------------------------------------
// Synthesized Plan
// ---------------------------------------------------------------------------

/**
 * Status of a synthesized plan.
 */
export type SynthesizedPlanStatus =
	| "draft" // Initial draft state
	| "validated" // DAG validated, ready for execution
	| "in_progress" // Execution in progress
	| "completed" // All tasks completed
	| "failed" // Plan synthesis failed with diagnostic
	| "cancelled"; // Plan was cancelled

/**
 * All valid SynthesizedPlanStatus values for runtime validation.
 */
export const ALL_SYNTHESIZED_PLAN_STATUSES: readonly SynthesizedPlanStatus[] = [
	"draft",
	"validated",
	"in_progress",
	"completed",
	"failed",
	"cancelled",
] as const;

/**
 * A milestone within a synthesized plan.
 */
export interface PlanMilestone {
	/** Unique identifier (UUID v4) */
	id: string;
	/** Human-readable name */
	name: string;
	/** Description of what this milestone represents */
	description: string;
	/** IDs of tasks that must be completed for this milestone */
	taskIds: string[];
	/** Target date or sequence number */
	target: string;
	/** ISO 8601 timestamp */
	createdAt: string;
}

/**
 * Resource estimates for a synthesized plan.
 */
export interface PlanResourceEstimate {
	/** Estimated total effort (arbitrary units) */
	totalEffort: number;
	/** Estimated duration description */
	estimatedDuration: string;
	/** Required/available capabilities */
	requiredCapabilities: string[];
	/** Estimated token cost for LLM-assisted tasks */
	estimatedTokenCost: number;
	/** Arbitrary metadata */
	metadata: Record<string, unknown>;
}

/**
 * A fully synthesized execution plan.
 *
 * Combines a DAG of tasks with milestones, resource estimates,
 * a rendered description, and diagnostics about the synthesis process.
 */
export interface SynthesizedPlan {
	/** Unique identifier (UUID v4) */
	id: string;
	/** Human-readable name/title */
	name: string;
	/** Status of this plan */
	status: SynthesizedPlanStatus;
	/** High-level goals this plan addresses */
	goals: string[];
	/** Tasks in DAG structure */
	tasks: PlanTask[];
	/** Milestones marking progress */
	milestones: PlanMilestone[];
	/** Resource estimates */
	resourceEstimate: PlanResourceEstimate;
	/** Template-rendered description output */
	renderedDescription: string;
	/** Template ID used for rendering, if any */
	templateId: string | null;
	/** DAG validation result */
	validation: {
		valid: boolean;
		errors: string[];
		warnings: string[];
		topologicalOrder: string[];
		criticalPath: string[];
	};
	/** ISO 8601 timestamp of creation */
	createdAt: string;
	/** ISO 8601 timestamp of last update */
	updatedAt: string;
	/** Diagnostic on failure, if any */
	diagnostic: WorkerDiagnostic | null;
	/** Error message if synthesis failed */
	error: string | null;
	/** Arbitrary metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Goal / Proposal / Context Input Types
// ---------------------------------------------------------------------------

/**
 * A high-level goal provided as input for plan synthesis.
 */
export interface GoalInput {
	/** Unique identifier */
	id: string;
	/** Goal title */
	title: string;
	/** Detailed description */
	description: string;
	/** Priority level */
	priority: "critical" | "high" | "medium" | "low";
	/** Optional tags */
	tags: string[];
}

/**
 * A proposal that can be incorporated into a plan.
 */
export interface ProposalInput {
	/** Unique identifier */
	id: string;
	/** Proposal title */
	title: string;
	/** Proposal description */
	description: string;
	/** Suggested tasks (free-form) */
	suggestedTasks: string[];
	/** Related goals, if any */
	relatedGoalIds: string[];
}

/**
 * Execution context constraints for plan synthesis.
 */
export interface ExecutionContext {
	/** Available worker roles that can execute tasks */
	availableWorkers: string[];
	/** Maximum effort budget for the overall plan */
	maxTotalEffort?: number;
	/** Maximum number of tasks per plan */
	maxTasks?: number;
	/** Deadline or time constraint description */
	deadline?: string;
	/** Additional constraints */
	constraints: string[];
}

// ---------------------------------------------------------------------------
// Session Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a plan synthesis session.
 *
 * Includes both the original goal-decomposition statuses and
 * the newer analysis/generation/validation statuses.
 */
export type SynthesisSessionStatus =
	| "idle" // Session created, awaiting input
	| "analyzing" // Analyzing proposals (new API)
	| "generating" // Generating workstreams (new API)
	| "validating" // Validating the plan (new API)
	| "decomposing" // Decomposing goals into tasks (old API)
	| "building_dag" // Building DAG from tasks (old API)
	| "rendering" // Rendering plan description (old API)
	| "estimating" // Estimating resources (old API)
	| "completed" // Synthesis completed with outputs
	| "failed" // Session failed with diagnostic
	| "cancelled"; // Session was cancelled

/**
 * All valid SynthesisSessionStatus values for runtime validation.
 */
export const ALL_SYNTHESIS_SESSION_STATUSES: readonly SynthesisSessionStatus[] = [
	"idle",
	"analyzing",
	"generating",
	"validating",
	"decomposing",
	"building_dag",
	"rendering",
	"estimating",
	"completed",
	"failed",
	"cancelled",
] as const;

// ---------------------------------------------------------------------------
// Workstream / Batch / Contract / Output Types (new API)
// ---------------------------------------------------------------------------

/**
 * A workstream within a plan — a unit of work derived from a proposal or idea.
 */
export interface Workstream {
	/** Workstream ID (e.g., "P1.A") */
	id: string;
	/** Human-readable title */
	title: string;
	/** High-level goal this workstream addresses */
	goal: string;
	/** Acceptance criteria */
	acceptanceCriteria: string[];
	/** IDs of workstreams this depends on */
	dependencies: string[];
	/** Files or modules this workstream affects */
	fileScope: string[];
	/** Notes about isolation requirements */
	isolationNotes: string;
	/** Queue priority */
	queuePriority: "critical" | "high" | "normal" | "low";
	/** Risk level */
	riskLevel: "low" | "medium" | "high";
}

/**
 * A batch of workstreams that can be executed in parallel.
 */
export interface Batch {
	/** Batch index (1-based) */
	index: number;
	/** IDs of workstreams in this batch */
	workstreamIds: string[];
}

/**
 * A dependency link between two workstreams.
 */
export interface DependencyLink {
	/** Source workstream ID */
	from: string;
	/** Target workstream ID (depends on source) */
	to: string;
	/** Type of dependency */
	type: "blocking" | "soft";
}

/**
 * Plan contract — the formal output of a synthesis session.
 */
export interface PlanContract {
	/** Contract version string */
	contractVersion: string;
	/** Phase this contract applies to */
	phase: { id: string; title: string };
	/** Workstream definitions */
	workstreams: Workstream[];
	/** Dependency links between workstreams */
	dependencies: DependencyLink[];
	/** Batch layout for execution ordering */
	batches: Batch[];
	/** Scaling mode for worktree allocation */
	scaleMode: string;
	/** Whether integration queue is needed */
	integrationQueue: boolean;
	/** Whether worktree isolation is needed */
	worktreeIsolation: boolean;
	/** Arbitrary metadata */
	metadata: Record<string, unknown>;
}

/**
 * The output of a plan generation phase.
 */
export interface PlanPlanOutput {
	/** Phase ID (e.g., "P1", "P2") */
	phaseId: string;
	/** Phase title */
	phaseTitle: string;
	/** Plan contract with full structure */
	contract: PlanContract;
	/** Generated workstreams */
	workstreams: Workstream[];
	/** Batches for execution ordering */
	batches: Batch[];
	/** ISO 8601 timestamp of generation */
	generatedAt: string;
	/** Confidence score (0-1) based on evidence quality */
	confidence: number;
	/** Validation results */
	validation: PlanValidationResult[];
	/** Number of proposals consumed */
	proposalsConsumed: number;
	/** Number of ideas incorporated */
	ideasIncorporated: number;
	/** Summary description */
	summary: string;
}

/**
 * A validation result from the PlanValidator.
 */
export interface PlanValidationResult {
	/** Severity type */
	type: "error" | "warning" | "info";
	/** Component being validated */
	component: string;
	/** Validation message */
	message: string;
}

/**
 * Validates plan outputs for structural integrity.
 */
export class PlanValidator {
	/**
	 * Validate a plan output for structural issues.
	 *
	 * @param output - The plan output to validate.
	 * @returns Array of validation results.
	 */
	validate(output: PlanPlanOutput): PlanValidationResult[] {
		const results: PlanValidationResult[] = [];

		if (!output.contract.workstreams || output.contract.workstreams.length === 0) {
			results.push({ type: "error", component: "contract", message: "Contract has no workstreams" });
		}
		if (!output.workstreams || output.workstreams.length === 0) {
			results.push({ type: "error", component: "workstream", message: "No workstreams generated" });
		}

		const wsIds = output.workstreams.map((ws) => ws.id);
		const uniqueWsIds = new Set(wsIds);
		if (uniqueWsIds.size !== wsIds.length) {
			results.push({ type: "error", component: "workstream", message: "Duplicate workstream IDs detected" });
		}

		const validWsIds = new Set(output.workstreams.map((ws) => ws.id));
		for (const dep of output.contract.dependencies) {
			if (!validWsIds.has(dep.from)) {
				results.push({
					type: "error",
					component: "dependency",
					message: `Dependency references non-existent source workstream "${dep.from}"`,
				});
			}
			if (!validWsIds.has(dep.to)) {
				results.push({
					type: "error",
					component: "dependency",
					message: `Dependency references non-existent target workstream "${dep.to}"`,
				});
			}
		}

		const depMap = new Map<string, string[]>();
		for (const dep of output.contract.dependencies) {
			const deps = depMap.get(dep.to) ?? [];
			deps.push(dep.from);
			depMap.set(dep.to, deps);
		}
		for (const ws of output.workstreams) {
			const contractDeps = depMap.get(ws.id) ?? [];
			for (const wsDep of ws.dependencies) {
				if (!contractDeps.includes(wsDep)) {
					results.push({
						type: "warning",
						component: "dependency",
						message: `Workstream "${ws.id}" declares dependency on "${wsDep}" but contract has no matching dependency link`,
					});
				}
			}
		}

		const batchedIds = new Set<string>();
		for (const batch of output.batches) {
			if (!batch.workstreamIds || batch.workstreamIds.length === 0) {
				results.push({
					type: "warning",
					component: "batch",
					message: `Batch ${batch.index} is empty`,
				});
			}
			for (const wsId of batch.workstreamIds) {
				if (batchedIds.has(wsId)) {
					results.push({
						type: "error",
						component: "batch",
						message: `Workstream "${wsId}" appears in multiple batches`,
					});
				}
				batchedIds.add(wsId);
			}
		}

		for (const ws of output.workstreams) {
			if (!batchedIds.has(ws.id)) {
				results.push({
					type: "warning",
					component: "batch",
					message: `Workstream "${ws.id}" is not assigned to any batch`,
				});
			}
		}

		if (!output.contract.contractVersion) {
			results.push({ type: "error", component: "contract", message: "Contract version is empty" });
		}

		return results;
	}

	hasErrors(results: PlanValidationResult[]): boolean {
		return results.some((r) => r.type === "error");
	}

	hasWarnings(results: PlanValidationResult[]): boolean {
		return results.some((r) => r.type === "warning");
	}
}

// ---------------------------------------------------------------------------
// Synthesis Session
// ---------------------------------------------------------------------------

/**
 * A single plan synthesis session.
 *
 * Each session ingests goals, proposals, and execution context,
 * decomposes them into tasks, builds a DAG, renders templates,
 * and produces a SynthesizedPlan with full diagnostics.
 */
export interface SynthesisSession {
	/** Unique session identifier (UUID v4) */
	id: string;
	/** Session status */
	status: SynthesisSessionStatus;
	/** Human-readable label for this session */
	label: string;
	/** ISO 8601 timestamp of session creation */
	createdAt: string;
	/** ISO 8601 timestamp of last activity */
	updatedAt: string;
	/** Token consumption for this session */
	tokensConsumed: number;
	/** Runtime in milliseconds for this session */
	runtimeMs: number;

	/** Goals provided as input (old API) */
	inputGoals: GoalInput[];
	/** Proposals provided as input (old API) */
	inputProposals: ProposalInput[];
	/** Execution context (old API) */
	inputContext: ExecutionContext | null;

	/** Combined input for new API */
	input: {
		proposals: NewProposalInput[];
		ideas: IdeaInput[];
		goals: string[];
		phaseIdOverride?: string;
		phaseTitleOverride?: string;
		metadata: Record<string, unknown>;
	};

	/** The synthesized plan (old API) */
	plan: SynthesizedPlan | null;
	/** The generated plan output (new API) */
	output: PlanPlanOutput | null;

	/** Diagnostic on failure, if any */
	diagnostic: WorkerDiagnostic | null;
	/** Error message if the session failed */
	error: string | null;

	/** Session metadata for extensibility */
	metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// New API Input Types
// ---------------------------------------------------------------------------

/**
 * A proposal that can be incorporated into a plan (new API).
 */
export interface NewProposalInput {
	/** Unique identifier */
	id: string;
	/** Proposal title */
	title: string;
	/** Proposal description */
	description: string;
	/** Priority level */
	priority: "critical" | "high" | "normal" | "low";
	/** Risk level */
	risk: "low" | "medium" | "high";
	/** Evidence IDs supporting this proposal */
	evidenceIds: string[];
}

/**
 * An idea that can be incorporated into a plan (new API).
 */
export interface IdeaInput {
	/** Unique identifier */
	id: string;
	/** Idea title */
	title: string;
	/** Idea description */
	description: string;
	/** Priority level */
	priority: "critical" | "high" | "medium" | "low";
	/** Tags for categorization */
	tags: string[];
}

// ---------------------------------------------------------------------------
// Plan Synthesizer Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Plan Synthesizer Worker.
 */
export interface PlanSynthesizerWorkerConfig {
	/** Maximum tokens per synthesis session. Default: 200_000 */
	maxTokensPerSession: number;
	/** Maximum runtime per synthesis session in milliseconds. Default: 900_000 */
	maxRuntimeMsPerSession: number;
	/** Maximum consecutive failures before the worker stops. Default: 3 */
	maxConsecutiveFailures: number;
	/** Cooldown period after a session in milliseconds. Default: 180_000 */
	cooldownMs: number;
	/** Dedup window in milliseconds. Default: 300_000 */
	dedupWindowMs: number;
	/** Whether deduplication is enabled. Default: true */
	dedupEnabled: boolean;
	/** Maximum number of tasks per plan. Default: 50 */
	maxTasksPerPlan: number;
	/** Maximum number of milestones per plan. Default: 10 */
	maxMilestonesPerPlan: number;
	/** Default template ID to use for rendering if none specified. Default: "standard-execution" */
	defaultTemplateId: string;
	/** Whether template rendering is enabled. Default: true */
	templateRenderingEnabled: boolean;
	/** Whether resource estimation is enabled. Default: true */
	resourceEstimationEnabled: boolean;
	/** Maximum number of workstreams per plan. Default: 8 */
	maxWorkstreams: number;
	/** Maximum number of proposals to consume per session. Default: 5 */
	maxProposals: number;
	/** Maximum number of ideas to incorporate per session. Default: 10 */
	maxIdeas: number;
	/** Contract version string for generated contracts. Default: "2.5.1" */
	contractVersion: string;
	/** Whether to validate output after generation. Default: true */
	validateOutput: boolean;
	/** Minimum risk level for review. Default: "medium" */
	minReviewRisk: string;
	/** Whether autonomous operation is allowed. Default: false */
	allowAutonomous: boolean;
}

/**
 * Default configuration for the Plan Synthesizer Worker.
 */
export const DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG: PlanSynthesizerWorkerConfig = {
	maxTokensPerSession: 200_000,
	maxRuntimeMsPerSession: 900_000,
	maxConsecutiveFailures: 3,
	cooldownMs: 180_000,
	dedupWindowMs: 300_000,
	dedupEnabled: true,
	maxTasksPerPlan: 50,
	maxMilestonesPerPlan: 10,
	defaultTemplateId: "standard-execution",
	templateRenderingEnabled: true,
	resourceEstimationEnabled: true,
	maxWorkstreams: 8,
	maxProposals: 5,
	maxIdeas: 10,
	contractVersion: "2.5.1",
	validateOutput: true,
	minReviewRisk: "medium",
	allowAutonomous: false,
};

/**
 * Default dedup config for the Plan Synthesizer Worker.
 */
export const DEFAULT_PLAN_SYNTHESIZER_DEDUP_CONFIG: WorkerDedupConfig = {
	enabled: true,
	windowMs: 300_000,
	useSimilarity: true,
	similarityThreshold: 0.85,
};

/**
 * Default budget values matching the planSynthesizer role.
 */
export const DEFAULT_PLAN_SYNTHESIZER_BUDGET = {
	maxTokensPerCycle: 200_000,
	maxConsecutiveFailures: 3,
	cooldownMs: 180_000,
	maxRuntimeMs: 900_000,
};

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/**
 * Standard contract for the plan synthesizer worker role.
 */
export function createPlanSynthesizerContract(version: string = "1.0.0"): WorkerContract {
	return {
		id: `brain-worker.plan-synthesizer.v${version}`,
		name: "Plan Synthesizer Worker Contract",
		description:
			"Synthesizes execution plans from goals, proposals, and context, producing DAG-structured plans with tasks, dependencies, milestones, and resource estimates.",
		version,
		capabilities: [
			"dag_building",
			"plan_synthesis",
			"goal_decomposition",
			"dependency_resolution",
			"template_rendering",
			"resource_estimation",
		],
		inputs: [
			{
				name: "goals",
				description: "High-level goals to decompose into plans",
				type: "Goal[]",
				required: true,
				sources: ["goal-store", "proposal-inbox"],
			},
			{
				name: "proposals",
				description: "Actionable proposals to incorporate into plans",
				type: "Proposal[]",
				required: false,
				sources: ["proposal-generator", "idea-scout"],
			},
			{
				name: "context",
				description: "Execution context including constraints, available workers, and current state",
				type: "ExecutionContext",
				required: false,
				sources: ["supervisor", "worker-lifecycle"],
			},
		],
		outputs: [
			{
				name: "synthesized_plans",
				description: "DAG-structured execution plans with tasks, dependencies, milestones, and resource estimates",
				type: "SynthesizedPlan[]",
				destinations: ["plan-executor", "supervisor", "proposal-inbox"],
			},
			{
				name: "plan_diagnostics",
				description:
					"Diagnostics about the plan synthesis process including validation failures and resource constraints",
				type: "WorkerDiagnostic[]",
				destinations: ["brain-timeline", "brain-audit"],
			},
		],
		errors: [
			{
				code: "NO_GOALS_PROVIDED",
				description: "No goals were provided for plan synthesis",
				severity: "critical",
				remediation: "Provide at least one goal before starting a plan synthesis session",
			},
			{
				code: "GOAL_DECOMPOSITION_FAILED",
				description: "Failed to decompose a goal into component tasks",
				severity: "warning",
				remediation: "Check goal specificity and re-submit with more granular goal definitions",
			},
			{
				code: "DAG_CYCLE_DETECTED",
				description: "Circular dependency detected in plan DAG",
				severity: "critical",
				remediation: "Review task dependencies and eliminate circular references",
			},
			{
				code: "TEMPLATE_RENDER_FAILED",
				description: "Failed to render a plan template",
				severity: "warning",
				remediation: "Check template syntax and variable availability",
			},
			{
				code: "RESOURCE_ESTIMATION_FAILED",
				description: "Failed to estimate resource requirements for the plan",
				severity: "info",
				remediation: "Provide additional resource context for more accurate estimates",
			},
			{
				code: "BUDGET_EXCEEDED",
				description: "Token or runtime budget was exceeded during plan synthesis",
				severity: "warning",
				remediation: "Consider increasing the synthesis budget or reducing plan scope",
			},
		],
		dependencies: ["brain-worker.proposer", "brain-worker.coordinator"],
		supportsStreaming: false,
		supportsCancellation: true,
		readonlyAccess: true,
	};
}

// ---------------------------------------------------------------------------
// Plan Synthesizer Worker Stats
// ---------------------------------------------------------------------------

/**
 * Runtime statistics for the PlanSynthesizerWorker.
 */
export interface PlanSynthesizerWorkerStats {
	totalSessions: number;
	completed: number;
	failed: number;
	cancelled: number;
	pending: number;
	consecutiveFailures: number;
	maxConsecutiveFailures: number;
	totalSessionsCompleted: number;
	totalSessionsFailed: number;
	totalTokensConsumed: number;
	totalPlansSynthesized: number;
	totalTasksGenerated: number;
	totalMilestonesGenerated: number;
	healthStatus: "healthy" | "degraded" | "unhealthy";
	dedupHistorySize: number;
	totalPlansGenerated: number;
	totalWorkstreamsGenerated: number;
	totalProposalsConsumed: number;
	totalIdeasIncorporated: number;
}

// ---------------------------------------------------------------------------
// Plan Synthesizer Worker
// ---------------------------------------------------------------------------

/**
 * Orchestrates plan synthesis sessions: goal decomposition, DAG building,
 * template rendering, and resource estimation (old API), plus proposal
 * analysis, workstream generation, and contract output (new API).
 */
export class PlanSynthesizerWorker {
	private config: PlanSynthesizerWorkerConfig;
	private sessions: Map<string, SynthesisSession>;
	private dedupHistory: Map<string, number>;
	private consecutiveFailures: number;
	private totalSessionsCompleted: number;
	private totalSessionsFailed: number;
	private totalTokensConsumed: number;
	private totalPlansSynthesized: number;
	private totalTasksGenerated: number;
	private totalMilestonesGenerated: number;
	private totalPlansGenerated: number;
	private totalWorkstreamsGenerated: number;
	private totalProposalsConsumed: number;
	private totalIdeasIncorporated: number;
	private templateRenderer: TemplateRenderer;
	private validator: PlanValidator;
	private phaseCounter: number;
	private isCoolingDown: boolean;
	private cooldownEndsAt: string | null;

	constructor(config?: Partial<PlanSynthesizerWorkerConfig>, customTemplates?: PlanTemplate[]) {
		this.config = {
			maxTokensPerSession: config?.maxTokensPerSession ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.maxTokensPerSession,
			maxRuntimeMsPerSession:
				config?.maxRuntimeMsPerSession ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.maxRuntimeMsPerSession,
			maxConsecutiveFailures:
				config?.maxConsecutiveFailures ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.maxConsecutiveFailures,
			cooldownMs: config?.cooldownMs ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.cooldownMs,
			dedupWindowMs: config?.dedupWindowMs ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.dedupWindowMs,
			dedupEnabled: config?.dedupEnabled ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.dedupEnabled,
			maxTasksPerPlan: config?.maxTasksPerPlan ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.maxTasksPerPlan,
			maxMilestonesPerPlan:
				config?.maxMilestonesPerPlan ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.maxMilestonesPerPlan,
			defaultTemplateId: config?.defaultTemplateId ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.defaultTemplateId,
			templateRenderingEnabled:
				config?.templateRenderingEnabled ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.templateRenderingEnabled,
			resourceEstimationEnabled:
				config?.resourceEstimationEnabled ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.resourceEstimationEnabled,
			maxWorkstreams: config?.maxWorkstreams ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.maxWorkstreams,
			maxProposals: config?.maxProposals ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.maxProposals,
			maxIdeas: config?.maxIdeas ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.maxIdeas,
			contractVersion: config?.contractVersion ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.contractVersion,
			validateOutput: config?.validateOutput ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.validateOutput,
			minReviewRisk: config?.minReviewRisk ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.minReviewRisk,
			allowAutonomous: config?.allowAutonomous ?? DEFAULT_PLAN_SYNTHESIZER_WORKER_CONFIG.allowAutonomous,
		};

		this.sessions = new Map();
		this.dedupHistory = new Map();
		this.consecutiveFailures = 0;
		this.totalSessionsCompleted = 0;
		this.totalSessionsFailed = 0;
		this.totalTokensConsumed = 0;
		this.totalPlansSynthesized = 0;
		this.totalTasksGenerated = 0;
		this.totalMilestonesGenerated = 0;
		this.totalPlansGenerated = 0;
		this.totalWorkstreamsGenerated = 0;
		this.totalProposalsConsumed = 0;
		this.totalIdeasIncorporated = 0;
		this.templateRenderer = createTemplateRenderer(customTemplates);
		this.validator = new PlanValidator();
		this.phaseCounter = 0;
		this.isCoolingDown = false;
		this.cooldownEndsAt = null;
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	setConfig(config: Partial<PlanSynthesizerWorkerConfig>): void {
		if (config.maxTokensPerSession !== undefined) this.config.maxTokensPerSession = config.maxTokensPerSession;
		if (config.maxRuntimeMsPerSession !== undefined)
			this.config.maxRuntimeMsPerSession = config.maxRuntimeMsPerSession;
		if (config.maxConsecutiveFailures !== undefined)
			this.config.maxConsecutiveFailures = config.maxConsecutiveFailures;
		if (config.cooldownMs !== undefined) this.config.cooldownMs = config.cooldownMs;
		if (config.dedupWindowMs !== undefined) this.config.dedupWindowMs = config.dedupWindowMs;
		if (config.dedupEnabled !== undefined) this.config.dedupEnabled = config.dedupEnabled;
		if (config.maxTasksPerPlan !== undefined) this.config.maxTasksPerPlan = config.maxTasksPerPlan;
		if (config.maxMilestonesPerPlan !== undefined) this.config.maxMilestonesPerPlan = config.maxMilestonesPerPlan;
		if (config.defaultTemplateId !== undefined) this.config.defaultTemplateId = config.defaultTemplateId;
		if (config.templateRenderingEnabled !== undefined)
			this.config.templateRenderingEnabled = config.templateRenderingEnabled;
		if (config.resourceEstimationEnabled !== undefined)
			this.config.resourceEstimationEnabled = config.resourceEstimationEnabled;
		if (config.maxWorkstreams !== undefined) this.config.maxWorkstreams = config.maxWorkstreams;
		if (config.maxProposals !== undefined) this.config.maxProposals = config.maxProposals;
		if (config.maxIdeas !== undefined) this.config.maxIdeas = config.maxIdeas;
		if (config.contractVersion !== undefined) this.config.contractVersion = config.contractVersion;
		if (config.validateOutput !== undefined) this.config.validateOutput = config.validateOutput;
		if (config.minReviewRisk !== undefined) this.config.minReviewRisk = config.minReviewRisk;
		if (config.allowAutonomous !== undefined) this.config.allowAutonomous = config.allowAutonomous;
	}

	getConfig(): PlanSynthesizerWorkerConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Manifest Generation
	// -----------------------------------------------------------------------

	generateManifest(
		name: string,
		description: string,
		overrides?: Partial<
			Omit<WorkerManifest, "id" | "role" | "name" | "description" | "contract" | "budget" | "dedupConfig">
		>,
	): WorkerManifest {
		return createWorkerManifest({
			role: "planSynthesizer",
			name,
			description,
			contract: createPlanSynthesizerContract(),
			...overrides,
		});
	}

	// -----------------------------------------------------------------------
	// Session Lifecycle — Old API (goal-based)
	// -----------------------------------------------------------------------

	createSession(
		label: string,
		inputGoals: GoalInput[] = [],
		inputProposals: ProposalInput[] = [],
		inputContext: ExecutionContext | null = null,
		metadata?: Record<string, unknown>,
		taskHash?: string,
	): SynthesisSession | null {
		if (inputGoals.length === 0) {
			// Dedup check before returning null for no goals
			if (this.config.dedupEnabled && taskHash) {
				const existingTimestamp = this.dedupHistory.get(taskHash);
				if (existingTimestamp !== undefined) {
					const age = Date.now() - existingTimestamp;
					if (age < this.config.dedupWindowMs) {
						return null;
					}
				}
			}
			return null;
		}

		if (this.config.dedupEnabled && taskHash) {
			const existingTimestamp = this.dedupHistory.get(taskHash);
			if (existingTimestamp !== undefined) {
				const age = Date.now() - existingTimestamp;
				if (age < this.config.dedupWindowMs) {
					return null;
				}
			}
		}

		const now = new Date().toISOString();
		const nowMs = Date.now();

		const session: SynthesisSession = {
			id: randomUUID(),
			status: "idle",
			label,
			createdAt: now,
			updatedAt: now,
			tokensConsumed: 0,
			runtimeMs: 0,
			inputGoals: Array.isArray(inputGoals) ? [...inputGoals] : [],
			inputProposals: Array.isArray(inputProposals) ? [...inputProposals] : [],
			inputContext: inputContext ? { ...inputContext } : null,
			input: {
				proposals: [],
				ideas: [],
				goals: [],
				metadata: {},
			},
			plan: null,
			output: null,
			diagnostic: null,
			error: null,
			metadata: metadata ?? {},
		};

		this.sessions.set(session.id, session);

		if (taskHash) {
			this.dedupHistory.set(taskHash, nowMs);
		}

		return session;
	}

	/**
	 * Create a session using the new API (proposal/idea/goal-based input).
	 *
	 * @param label - Human-readable label.
	 * @param input - Structured input with proposals, ideas, goals, etc.
	 * @param _opts - Optional additional options (unused, kept for API compatibility).
	 * @param taskHash - Optional content hash for deduplication.
	 * @returns The created SynthesisSession, or null if deduped.
	 */
	createSessionFromInput(
		label: string,
		input: {
			proposals: NewProposalInput[];
			ideas: IdeaInput[];
			goals: string[];
			phaseIdOverride?: string;
			phaseTitleOverride?: string;
			metadata: Record<string, unknown>;
		},
		_opts?: Record<string, unknown>,
		taskHash?: string,
	): SynthesisSession | null {
		if (this.config.dedupEnabled && taskHash) {
			const existingTimestamp = this.dedupHistory.get(taskHash);
			if (existingTimestamp !== undefined) {
				const age = Date.now() - existingTimestamp;
				if (age < this.config.dedupWindowMs) {
					return null;
				}
			}
		}

		const now = new Date().toISOString();
		const nowMs = Date.now();

		const session: SynthesisSession = {
			id: randomUUID(),
			status: "idle",
			label,
			createdAt: now,
			updatedAt: now,
			tokensConsumed: 0,
			runtimeMs: 0,
			inputGoals: [],
			inputProposals: [],
			inputContext: null,
			input: {
				proposals: Array.isArray(input.proposals) ? [...input.proposals] : [],
				ideas: Array.isArray(input.ideas) ? [...input.ideas] : [],
				goals: Array.isArray(input.goals) ? [...input.goals] : [],
				phaseIdOverride: input.phaseIdOverride,
				phaseTitleOverride: input.phaseTitleOverride,
				metadata: input.metadata ?? {},
			},
			plan: null,
			output: null,
			diagnostic: null,
			error: null,
			metadata: {},
		};

		this.sessions.set(session.id, session);

		if (taskHash) {
			this.dedupHistory.set(taskHash, nowMs);
		}

		return session;
	}

	/**
	 * Start analysis on a session (new API).
	 * Transitions from idle to analyzing.
	 */
	startAnalysis(sessionId: string): SynthesisSession | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "idle") return null;
		session.status = "analyzing";
		session.updatedAt = new Date().toISOString();
		return session;
	}

	/**
	 * Generate a plan from analyzed proposals and ideas (new API).
	 */
	generate(sessionId: string, tokensConsumed: number = 0): PlanPlanOutput | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "analyzing") return null;

		session.tokensConsumed += tokensConsumed;
		this.totalTokensConsumed += tokensConsumed;

		if (session.tokensConsumed > this.config.maxTokensPerSession) {
			this.failSessionWithDiagnostic(
				sessionId,
				"Token budget exceeded",
				"token_budget_exhausted",
				{
					sessionId,
					tokensConsumed: session.tokensConsumed,
					maxTokensPerSession: this.config.maxTokensPerSession,
				},
				[`plan-synthesizer://sessions/${sessionId}`],
			);
			return null;
		}

		if (session.input.proposals.length === 0) {
			this.failSessionWithDiagnostic(
				sessionId,
				"No approved proposals to synthesize",
				"policy_blocked",
				{
					sessionId,
					proposalCount: 0,
					ideaCount: session.input.ideas.length,
				},
				[`plan-synthesizer://sessions/${sessionId}`],
			);
			return null;
		}

		session.status = "generating";
		session.updatedAt = new Date().toISOString();

		try {
			let phaseId: string;
			if (session.input.phaseIdOverride) {
				phaseId = session.input.phaseIdOverride;
			} else {
				this.phaseCounter++;
				phaseId = `P${this.phaseCounter}`;
			}

			const phaseTitle = session.input.phaseTitleOverride ?? `Phase ${phaseId}: ${session.label}`;
			const now = new Date().toISOString();

			const cappedProposals = session.input.proposals.slice(0, this.config.maxProposals);
			const cappedIdeas = session.input.ideas.slice(0, this.config.maxIdeas);

			const workstreams: Workstream[] = [];
			const dependencies: DependencyLink[] = [];

			let wsCounter = 0;
			let prevWsId: string | null = null;

			for (const proposal of cappedProposals) {
				if (workstreams.length >= this.config.maxWorkstreams) break;
				const letter = String.fromCharCode(65 + wsCounter);
				wsCounter++;
				const wsId = `${phaseId}.${letter}`;

				const deps: string[] = [];
				if (prevWsId) {
					deps.push(prevWsId);
					dependencies.push({ from: prevWsId, to: wsId, type: "blocking" });
				}

				workstreams.push({
					id: wsId,
					title: proposal.title,
					goal: proposal.description,
					acceptanceCriteria: [`Implement: ${proposal.title}`, `Verify: ${proposal.description}`],
					dependencies: deps,
					fileScope: [],
					isolationNotes: "",
					queuePriority: proposal.priority as "critical" | "high" | "normal" | "low",
					riskLevel: proposal.risk,
				});

				prevWsId = wsId;
			}

			for (const idea of cappedIdeas) {
				if (workstreams.length >= this.config.maxWorkstreams) break;
				const letter = String.fromCharCode(65 + wsCounter);
				wsCounter++;
				const wsId = `${phaseId}.${letter}`;

				const deps: string[] = [];
				if (prevWsId) {
					deps.push(prevWsId);
				}

				workstreams.push({
					id: wsId,
					title: idea.title,
					goal: idea.description,
					acceptanceCriteria: [`Implement: ${idea.title}`],
					dependencies: deps,
					fileScope: [],
					isolationNotes: "",
					queuePriority: "normal",
					riskLevel: "low",
				});

				prevWsId = wsId;
			}

			const batches = this.computeBatches(workstreams, dependencies);
			const confidence = this.calculateConfidence(cappedProposals);

			const contract: PlanContract = {
				contractVersion: this.config.contractVersion,
				phase: { id: phaseId, title: phaseTitle },
				workstreams,
				dependencies,
				batches,
				scaleMode: "standard",
				integrationQueue: false,
				worktreeIsolation: false,
				metadata: {},
			};

			const output: PlanPlanOutput = {
				phaseId,
				phaseTitle,
				contract,
				workstreams,
				batches,
				generatedAt: now,
				confidence,
				validation: [],
				proposalsConsumed: cappedProposals.length,
				ideasIncorporated: cappedIdeas.length,
				summary: `Synthesized ${workstreams.length} workstreams from ${cappedProposals.length} proposals and ${cappedIdeas.length} ideas`,
			};

			if (this.config.validateOutput) {
				output.validation = this.validator.validate(output);
			}

			session.status = "completed";
			session.output = output;
			session.updatedAt = now;

			this.totalSessionsCompleted++;
			this.totalPlansGenerated++;
			this.totalWorkstreamsGenerated += workstreams.length;
			this.totalProposalsConsumed += cappedProposals.length;
			this.totalIdeasIncorporated += cappedIdeas.length;
			this.consecutiveFailures = 0;

			return output;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.failSessionWithDiagnostic(
				sessionId,
				`Generation failed: ${errorMessage}`,
				"unknown_error",
				{
					sessionId,
					proposalCount: session.input.proposals.length,
					ideaCount: session.input.ideas.length,
				},
				[`plan-synthesizer://sessions/${sessionId}`],
				errorMessage,
			);
			return null;
		}
	}

	/**
	 * Get the PlanValidator instance.
	 */
	getValidator(): PlanValidator {
		return this.validator;
	}

	// -----------------------------------------------------------------------
	// Old API — Decompose / Build / Render / Estimate / Synthesize
	// -----------------------------------------------------------------------

	decomposeGoals(sessionId: string): DagBuilder | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "idle") return null;

		session.status = "decomposing";
		session.updatedAt = new Date().toISOString();

		try {
			const dagBuilder = createDagBuilder();
			this.totalTasksGenerated = 0;

			for (const goal of session.inputGoals) {
				const tasks = this.decomposeGoalToTasks(goal, session.inputContext);
				for (const task of tasks) {
					dagBuilder.addPrebuiltTask(task);
					this.totalTasksGenerated++;
				}
			}

			for (const proposal of session.inputProposals) {
				const task = this.proposalToTask(proposal);
				if (task) {
					dagBuilder.addPrebuiltTask(task);
					this.totalTasksGenerated++;
				}
			}

			session.updatedAt = new Date().toISOString();
			return dagBuilder;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const diagnostic = createWorkerDiagnostic(
				"unknown_error",
				`Goal decomposition failed: ${errorMessage}`,
				{ sessionId, goalCount: session.inputGoals.length },
				[`plan-synthesizer://sessions/${sessionId}`],
				errorMessage,
			);
			this.failSession(sessionId, errorMessage, diagnostic);
			return null;
		}
	}

	buildDag(sessionId: string, dagBuilder: DagBuilder): SynthesizedPlan | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "decomposing") return null;

		session.status = "building_dag";
		session.updatedAt = new Date().toISOString();

		try {
			const validationResult = dagBuilder.validate();

			// Fail session if DAG validation fails (empty DAG, cycles, unresolved deps)
			if (!validationResult.valid) {
				const diag = createWorkerDiagnostic(
					"dag_validation_failed",
					`DAG validation failed: ${validationResult.errors.join("; ")}`,
					{ sessionId, taskCount: dagBuilder.size, errors: validationResult.errors },
					[`plan-synthesizer://sessions/${sessionId}`],
				);
				return this.failSession(sessionId, `DAG validation failed: ${validationResult.errors.join("; ")}`, diag);
			}

			const tasks = dagBuilder.getAllTasks();
			const criticalPath = dagBuilder.getCriticalPath();
			const milestones = this.generateMilestones(tasks, session.inputGoals);

			const now = new Date().toISOString();
			const plan: SynthesizedPlan = {
				id: randomUUID(),
				name: `Plan: ${session.label}`,
				status: "draft",
				goals: session.inputGoals.map((g) => g.title),
				tasks,
				milestones,
				resourceEstimate: {
					totalEffort: dagBuilder.getTotalEffort(),
					estimatedDuration: this.estimateDuration(dagBuilder.getTotalEffort()),
					requiredCapabilities: this.collectRequiredCapabilities(tasks),
					estimatedTokenCost: this.estimateTokenCost(dagBuilder.getTotalEffort()),
					metadata: {},
				},
				renderedDescription: "",
				templateId: null,
				validation: {
					valid: true,
					errors: [],
					warnings: validationResult.warnings,
					topologicalOrder: validationResult.topologicalOrder,
					criticalPath,
				},
				createdAt: now,
				updatedAt: now,
				diagnostic: null,
				error: null,
				metadata: {},
			};

			session.plan = plan;
			session.updatedAt = now;
			return plan;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const diagnostic = createWorkerDiagnostic(
				"unknown_error",
				`DAG building failed: ${errorMessage}`,
				{ sessionId, taskCount: dagBuilder.size },
				[`plan-synthesizer://sessions/${sessionId}`],
				errorMessage,
			);
			this.failSession(sessionId, errorMessage, diagnostic);
			return null;
		}
	}

	renderPlan(sessionId: string, templateId?: string, templateContext?: TemplateContext): string | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status !== "building_dag") return null;
		if (!session.plan) return null;

		if (!this.config.templateRenderingEnabled) {
			session.status = "rendering";
			const basic = this.generateBasicDescription(session.plan);
			session.plan.renderedDescription = basic;
			session.plan.templateId = null;
			session.updatedAt = new Date().toISOString();
			return basic;
		}

		session.status = "rendering";
		session.updatedAt = new Date().toISOString();

		try {
			const tid = templateId ?? this.config.defaultTemplateId;
			const context = this.buildTemplateContext(session.plan, session.inputContext, templateContext);
			const result: TemplateRenderResult = this.templateRenderer.render(tid, context);

			if (!result.success) {
				const diagnostic = createWorkerDiagnostic(
					"unknown_error",
					`Template render had issues: ${result.errors.map((e) => e.message).join("; ")}`,
					{ sessionId, templateId: tid, errorCount: result.errors.length },
					[`plan-synthesizer://sessions/${sessionId}`],
				);
				session.diagnostic = diagnostic;
				session.plan.renderedDescription = result.output || "[Template render failed]";
			} else {
				session.plan.renderedDescription = result.output;
			}

			session.plan.templateId = tid;
			session.updatedAt = new Date().toISOString();
			return session.plan.renderedDescription;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const diagnostic = createWorkerDiagnostic(
				"unknown_error",
				`Template rendering failed: ${errorMessage}`,
				{ sessionId, templateId: templateId ?? this.config.defaultTemplateId },
				[`plan-synthesizer://sessions/${sessionId}`],
				errorMessage,
			);
			this.failSession(sessionId, errorMessage, diagnostic);
			return null;
		}
	}

	estimateResources(sessionId: string, tokensConsumed: number = 0, runtimeMs: number = 0): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) return false;
		if (session.status !== "rendering") return false;

		session.tokensConsumed += tokensConsumed;
		if (session.tokensConsumed > this.config.maxTokensPerSession) {
			this.failSession(
				sessionId,
				"Token budget exceeded",
				createWorkerDiagnostic(
					"token_budget_exhausted",
					`Plan synthesizer session exceeded token budget: ${session.tokensConsumed} > ${this.config.maxTokensPerSession}`,
					{
						sessionId,
						tokensConsumed: session.tokensConsumed,
						maxTokensPerSession: this.config.maxTokensPerSession,
					},
					[`plan-synthesizer://sessions/${sessionId}`],
				),
			);
			return false;
		}

		session.runtimeMs += runtimeMs;
		if (session.runtimeMs > this.config.maxRuntimeMsPerSession) {
			this.failSession(
				sessionId,
				"Runtime budget exceeded",
				createWorkerDiagnostic(
					"timeout",
					`Plan synthesizer session exceeded runtime budget: ${session.runtimeMs}ms > ${this.config.maxRuntimeMsPerSession}ms`,
					{ sessionId, runtimeMs: session.runtimeMs, maxRuntimeMsPerSession: this.config.maxRuntimeMsPerSession },
					[`plan-synthesizer://sessions/${sessionId}`],
				),
			);
			return false;
		}

		session.status = "estimating";
		session.updatedAt = new Date().toISOString();

		try {
			if (!session.plan) {
				this.failSession(
					sessionId,
					"No plan to estimate",
					createWorkerDiagnostic(
						"unknown_error",
						"Cannot estimate resources: plan was not yet built",
						{ sessionId },
						[`plan-synthesizer://sessions/${sessionId}`],
					),
				);
				return false;
			}

			if (this.config.resourceEstimationEnabled) {
				const totalEffort = session.plan.tasks.reduce((sum, t) => sum + t.estimatedEffort, 0);
				const requiredCaps = this.collectRequiredCapabilities(session.plan.tasks);

				session.plan.resourceEstimate = {
					totalEffort,
					estimatedDuration: this.estimateDuration(totalEffort, session.inputContext),
					requiredCapabilities: requiredCaps,
					estimatedTokenCost: this.estimateTokenCost(totalEffort),
					metadata: {
						taskCount: session.plan.tasks.length,
						milestoneCount: session.plan.milestones.length,
						deadline: session.inputContext?.deadline ?? null,
						constraints: session.inputContext?.constraints ?? [],
					},
				};
			}

			session.status = "completed";
			session.plan.status = "validated";
			session.plan.updatedAt = new Date().toISOString();
			session.updatedAt = new Date().toISOString();

			this.totalSessionsCompleted++;
			this.totalPlansSynthesized++;
			this.totalTasksGenerated += session.plan.tasks.length;
			this.totalMilestonesGenerated += session.plan.milestones.length;
			this.consecutiveFailures = 0;

			return true;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const diagnostic = createWorkerDiagnostic(
				"unknown_error",
				`Resource estimation failed: ${errorMessage}`,
				{ sessionId, tokensConsumed: session.tokensConsumed, runtimeMs: session.runtimeMs },
				[`plan-synthesizer://sessions/${sessionId}`],
				errorMessage,
			);
			this.failSession(sessionId, errorMessage, diagnostic);
			return false;
		}
	}

	synthesize(
		sessionId: string,
		templateId?: string,
		templateContext?: TemplateContext,
		tokensConsumed: number = 0,
		runtimeMs: number = 0,
	): SynthesizedPlan | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;

		session.tokensConsumed += tokensConsumed;
		if (session.tokensConsumed > this.config.maxTokensPerSession) {
			this.failSessionBlocking(
				sessionId,
				"Token budget exceeded",
				createWorkerDiagnostic(
					"token_budget_exhausted",
					`Plan synthesizer session exceeded token budget: ${session.tokensConsumed} > ${this.config.maxTokensPerSession}`,
					{
						sessionId,
						tokensConsumed: session.tokensConsumed,
						maxTokensPerSession: this.config.maxTokensPerSession,
					},
					[`plan-synthesizer://sessions/${sessionId}`],
				),
			);
			return null;
		}

		session.runtimeMs += runtimeMs;
		if (session.runtimeMs > this.config.maxRuntimeMsPerSession) {
			this.failSessionBlocking(
				sessionId,
				"Runtime budget exceeded",
				createWorkerDiagnostic(
					"timeout",
					`Plan synthesizer session exceeded runtime budget: ${session.runtimeMs}ms > ${this.config.maxRuntimeMsPerSession}ms`,
					{ sessionId, runtimeMs: session.runtimeMs, maxRuntimeMsPerSession: this.config.maxRuntimeMsPerSession },
					[`plan-synthesizer://sessions/${sessionId}`],
				),
			);
			return null;
		}

		const dagBuilder = this.decomposeGoals(sessionId);
		if (!dagBuilder) return null;

		const plan = this.buildDag(sessionId, dagBuilder);
		if (!plan) return null;

		const rendered = this.renderPlan(sessionId, templateId, templateContext);
		if (rendered === null) return null;

		const estimated = this.estimateResources(sessionId, 0, 0);
		if (!estimated) return null;

		return session.plan;
	}

	// -----------------------------------------------------------------------
	// Session Management
	// -----------------------------------------------------------------------

	cancelSession(sessionId: string, reason: string): SynthesisSession | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") {
			return null;
		}
		session.status = "cancelled";
		session.error = reason;
		session.updatedAt = new Date().toISOString();
		return session;
	}

	getSession(sessionId: string): SynthesisSession | undefined {
		return this.sessions.get(sessionId);
	}

	getAllSessions(): SynthesisSession[] {
		return Array.from(this.sessions.values());
	}

	getSessionsByStatus(status: SynthesisSessionStatus): SynthesisSession[] {
		return Array.from(this.sessions.values())
			.filter((s) => s.status === status)
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	}

	clear(): void {
		this.sessions.clear();
		this.dedupHistory.clear();
		this.consecutiveFailures = 0;
		this.totalSessionsCompleted = 0;
		this.totalSessionsFailed = 0;
		this.totalTokensConsumed = 0;
		this.totalPlansSynthesized = 0;
		this.totalTasksGenerated = 0;
		this.totalMilestonesGenerated = 0;
		this.totalPlansGenerated = 0;
		this.totalWorkstreamsGenerated = 0;
		this.totalProposalsConsumed = 0;
		this.totalIdeasIncorporated = 0;
		this.phaseCounter = 0;
		this.isCoolingDown = false;
		this.cooldownEndsAt = null;
	}

	// -----------------------------------------------------------------------
	// Cooldown
	// -----------------------------------------------------------------------

	/**
	 * Check if the worker is currently in cooldown.
	 */
	isInCooldown(): boolean {
		if (!this.isCoolingDown || !this.cooldownEndsAt) return false;
		return Date.now() < new Date(this.cooldownEndsAt).getTime();
	}

	/**
	 * Get cooldown status.
	 */
	getCooldownStatus(): { cooling: boolean; endsAt: string | null; remainingMs: number } {
		if (!this.isCoolingDown || !this.cooldownEndsAt) {
			return { cooling: false, endsAt: null, remainingMs: 0 };
		}
		const remaining = Math.max(0, new Date(this.cooldownEndsAt).getTime() - Date.now());
		return { cooling: true, endsAt: this.cooldownEndsAt, remainingMs: remaining };
	}

	/**
	 * Start a cooldown period.
	 *
	 * @param durationMs - Duration in milliseconds. Defaults to configured cooldownMs.
	 */
	startCooldown(durationMs?: number): void {
		const cooldownMs = durationMs ?? this.config.cooldownMs;
		this.isCoolingDown = true;
		this.cooldownEndsAt = new Date(Date.now() + cooldownMs).toISOString();
	}

	/**
	 * End the cooldown period early.
	 */
	endCooldown(): void {
		this.isCoolingDown = false;
		this.cooldownEndsAt = null;
	}

	// -----------------------------------------------------------------------
	// Stop Conditions
	// -----------------------------------------------------------------------

	/**
	 * Check if the worker should stop based on budget/consecutive failures.
	 *
	 * @returns A stop condition if the worker should stop, or null if it should continue.
	 */
	checkStopCondition(): WorkerStopCondition | null {
		if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
			return "consecutive_failures_exceeded";
		}
		return null;
	}

	// -----------------------------------------------------------------------
	// Dedup Management
	// -----------------------------------------------------------------------

	computeTaskHash(goalSignature: string): string {
		return createHash("sha256").update(goalSignature).digest("hex");
	}

	isDuplicate(taskHash: string): boolean {
		if (!this.config.dedupEnabled) return false;
		const timestamp = this.dedupHistory.get(taskHash);
		if (timestamp === undefined) return false;
		return Date.now() - timestamp < this.config.dedupWindowMs;
	}

	pruneDedupHistory(): void {
		const now = Date.now();
		for (const [hash, timestamp] of this.dedupHistory) {
			if (now - timestamp >= this.config.dedupWindowMs) {
				this.dedupHistory.delete(hash);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Health & Stats
	// -----------------------------------------------------------------------

	checkHealth(): WorkerDiagnostic | null {
		if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
			return createWorkerDiagnostic(
				"consecutive_failures_exceeded",
				`Plan synthesizer worker has ${this.consecutiveFailures} consecutive failures (max: ${this.config.maxConsecutiveFailures})`,
				{
					consecutiveFailures: this.consecutiveFailures,
					maxConsecutiveFailures: this.config.maxConsecutiveFailures,
					totalSessionsCompleted: this.totalSessionsCompleted,
					totalSessionsFailed: this.totalSessionsFailed,
				},
				["plan-synthesizer://health"],
			);
		}
		return null;
	}

	getHealthStatus(): "healthy" | "degraded" | "unhealthy" {
		if (this.consecutiveFailures === 0) return "healthy";
		if (this.consecutiveFailures < this.config.maxConsecutiveFailures) return "degraded";
		return "unhealthy";
	}

	getStats(): PlanSynthesizerWorkerStats {
		const allSessions = Array.from(this.sessions.values());
		const completed = allSessions.filter((s) => s.status === "completed");
		const failed = allSessions.filter((s) => s.status === "failed");
		const cancelled = allSessions.filter((s) => s.status === "cancelled");
		const pending = allSessions.filter(
			(s) =>
				s.status === "idle" ||
				s.status === "decomposing" ||
				s.status === "building_dag" ||
				s.status === "rendering" ||
				s.status === "estimating" ||
				s.status === "analyzing" ||
				s.status === "generating" ||
				s.status === "validating",
		);

		return {
			totalSessions: allSessions.length,
			completed: completed.length,
			failed: failed.length,
			cancelled: cancelled.length,
			pending: pending.length,
			consecutiveFailures: this.consecutiveFailures,
			maxConsecutiveFailures: this.config.maxConsecutiveFailures,
			totalSessionsCompleted: this.totalSessionsCompleted,
			totalSessionsFailed: this.totalSessionsFailed,
			totalTokensConsumed: this.totalTokensConsumed,
			totalPlansSynthesized: this.totalPlansSynthesized,
			totalTasksGenerated: this.totalTasksGenerated,
			totalMilestonesGenerated: this.totalMilestonesGenerated,
			healthStatus: this.getHealthStatus(),
			dedupHistorySize: this.dedupHistory.size,
			totalPlansGenerated: this.totalPlansGenerated,
			totalWorkstreamsGenerated: this.totalWorkstreamsGenerated,
			totalProposalsConsumed: this.totalProposalsConsumed,
			totalIdeasIncorporated: this.totalIdeasIncorporated,
		};
	}

	getTemplateRenderer(): TemplateRenderer {
		return this.templateRenderer;
	}

	// -----------------------------------------------------------------------
	// Private Helpers — Goal Decomposition
	// -----------------------------------------------------------------------

	private decomposeGoalToTasks(goal: GoalInput, context: ExecutionContext | null): PlanTask[] {
		const tasks: PlanTask[] = [];
		const maxTasks = context?.maxTasks ?? this.config.maxTasksPerPlan;
		const goalEffort = this.inferGoalEffort(goal.priority);
		const taskPriority = this.mapGoalPriorityToTaskPriority(goal.priority);

		const researchTaskId = randomUUID();
		tasks.push({
			id: researchTaskId,
			title: `Analyze: ${goal.title}`,
			description: `Research and analyze the requirements for: ${goal.description}`,
			status: "pending",
			priority: taskPriority,
			estimatedEffort: Math.ceil(goalEffort * 0.2),
			dependencyIds: [],
			tags: ["analysis", ...goal.tags],
			metadata: { goalId: goal.id, phase: "analysis" },
			createdAt: new Date().toISOString(),
		});

		const designTaskId = randomUUID();
		tasks.push({
			id: designTaskId,
			title: `Plan: ${goal.title}`,
			description: `Design and plan the implementation approach for: ${goal.title}`,
			status: "pending",
			priority: taskPriority,
			estimatedEffort: Math.ceil(goalEffort * 0.15),
			dependencyIds: [researchTaskId],
			tags: ["planning", ...goal.tags],
			metadata: { goalId: goal.id, phase: "planning" },
			createdAt: new Date().toISOString(),
		});

		const implChunks = Math.min(Math.max(1, Math.ceil(goalEffort * 0.4)), maxTasks - 2);
		const prevDependencyIds: string[] = [designTaskId];

		for (let i = 0; i < implChunks; i++) {
			if (tasks.length >= maxTasks) break;
			const implTaskId = randomUUID();
			tasks.push({
				id: implTaskId,
				title: `Implement part ${i + 1}: ${goal.title}`,
				description: `Implementation chunk ${i + 1} for: ${goal.description}`,
				status: "pending",
				priority: taskPriority,
				estimatedEffort: Math.ceil((goalEffort * 0.4) / implChunks),
				dependencyIds: [...prevDependencyIds],
				tags: ["implementation", ...goal.tags],
				metadata: { goalId: goal.id, phase: "implementation", chunk: i + 1, totalChunks: implChunks },
				createdAt: new Date().toISOString(),
			});
			prevDependencyIds.length = 0;
			prevDependencyIds.push(implTaskId);
		}

		if (tasks.length < maxTasks) {
			const verifyTaskId = randomUUID();
			tasks.push({
				id: verifyTaskId,
				title: `Verify: ${goal.title}`,
				description: `Verify that the implementation satisfies: ${goal.description}`,
				status: "pending",
				priority: taskPriority,
				estimatedEffort: Math.ceil(goalEffort * 0.15),
				dependencyIds: [...prevDependencyIds],
				tags: ["verification", "testing", ...goal.tags],
				metadata: { goalId: goal.id, phase: "verification" },
				createdAt: new Date().toISOString(),
			});
		}

		return tasks;
	}

	private proposalToTask(proposal: ProposalInput): PlanTask | null {
		if (!proposal.title && proposal.suggestedTasks.length === 0) return null;
		return {
			id: randomUUID(),
			title: `Proposal: ${proposal.title}`,
			description: proposal.description || proposal.suggestedTasks.join("; "),
			status: "pending",
			priority: "medium",
			estimatedEffort: proposal.suggestedTasks.length * 2,
			dependencyIds: [],
			tags: ["proposal", ...proposal.relatedGoalIds.map((gid) => `rel:${gid}`)],
			metadata: { proposalId: proposal.id, relatedGoalIds: proposal.relatedGoalIds },
			createdAt: new Date().toISOString(),
		};
	}

	private generateMilestones(tasks: PlanTask[], goals: GoalInput[]): PlanMilestone[] {
		const milestones: PlanMilestone[] = [];
		const maxMilestones = this.config.maxMilestonesPerPlan;

		for (const goal of goals) {
			if (milestones.length >= maxMilestones) break;
			const goalTasks = tasks.filter((t) => (t.metadata as Record<string, unknown>).goalId === goal.id);
			milestones.push({
				id: randomUUID(),
				name: `Goal: ${goal.title}`,
				description: goal.description,
				taskIds: goalTasks.map((t) => t.id),
				target: "pending",
				createdAt: new Date().toISOString(),
			});
		}
		return milestones;
	}

	private buildTemplateContext(
		plan: SynthesizedPlan,
		_context: ExecutionContext | null,
		extra?: TemplateContext,
	): TemplateContext {
		const tasks = plan.tasks.map((t) => ({
			title: t.title,
			description: t.description,
			priority: t.priority,
			effort: t.estimatedEffort,
			dependencies: t.dependencyIds.length > 0 ? t.dependencyIds.join(", ") : "None",
			status: t.status,
		}));

		const goals = plan.goals;
		const milestones = plan.milestones.map((m) => ({
			name: m.name,
			description: m.description,
			target: m.target,
		}));

		const risks = plan.validation.warnings.map((w) => ({
			name: "DAG Warning",
			description: w,
			severity: "info",
		}));

		return {
			planName: plan.name,
			description: `Synthesized plan with ${plan.tasks.length} tasks, ${plan.milestones.length} milestones, and ${plan.validation.topologicalOrder.length} topologically sorted nodes.`,
			goals,
			tasks,
			milestones,
			totalEffort: plan.resourceEstimate.totalEffort,
			estimatedDuration: plan.resourceEstimate.estimatedDuration,
			capabilities: plan.resourceEstimate.requiredCapabilities.join(", "),
			risks,
			taskCount: plan.tasks.length,
			milestoneCount: plan.milestones.length,
			...(extra ?? {}),
		};
	}

	private generateBasicDescription(plan: SynthesizedPlan): string {
		const lines: string[] = [
			`Plan: ${plan.name}`,
			`Tasks: ${plan.tasks.length}`,
			`Milestones: ${plan.milestones.length}`,
			`Total Effort: ${plan.resourceEstimate.totalEffort} units`,
			`Estimated Duration: ${plan.resourceEstimate.estimatedDuration}`,
			``,
			`Goals:`,
			...plan.goals.map((g) => `  - ${g}`),
			``,
			`Tasks (topological order):`,
			...plan.validation.topologicalOrder.map((taskId) => {
				const task = plan.tasks.find((t) => t.id === taskId);
				return task ? `  - [${task.priority}] ${task.title} (${task.estimatedEffort} units)` : `  - ${taskId}`;
			}),
			``,
			`Milestones:`,
			...plan.milestones.map((m) => `  - ${m.name}: ${m.description}`),
			``,
			`Critical Path: ${plan.validation.criticalPath.length} tasks`,
		];

		if (plan.validation.warnings.length > 0) {
			lines.push(``, `Warnings:`, ...plan.validation.warnings.map((w) => `  - ${w}`));
		}

		return lines.join("\n");
	}

	// -----------------------------------------------------------------------
	// Private Helpers — Resource Estimation
	// -----------------------------------------------------------------------

	private estimateDuration(totalEffort: number, context?: ExecutionContext | null): string {
		if (context?.deadline) return `Target: ${context.deadline}`;
		const hours = Math.ceil(totalEffort * 1.5);
		if (hours <= 8) return `${hours} hours`;
		if (hours <= 40) return `${Math.ceil(hours / 8)} days`;
		if (hours <= 160) return `${Math.ceil(hours / 40)} weeks`;
		return `${Math.ceil(hours / 160)} months`;
	}

	private estimateTokenCost(totalEffort: number): number {
		return totalEffort * 1000;
	}

	private collectRequiredCapabilities(tasks: PlanTask[]): string[] {
		const capabilities = new Set<string>();
		for (const task of tasks) {
			const phase = (task.metadata as Record<string, unknown>).phase as string | undefined;
			if (phase) capabilities.add(phase);
			for (const tag of task.tags) {
				if (["analysis", "planning", "implementation", "verification", "testing"].includes(tag)) {
					capabilities.add(tag);
				}
			}
		}
		return Array.from(capabilities);
	}

	private mapGoalPriorityToTaskPriority(goalPriority: string): PlanTaskPriority {
		switch (goalPriority) {
			case "critical":
				return "critical";
			case "high":
				return "high";
			case "medium":
				return "medium";
			case "low":
				return "low";
			default:
				return "medium";
		}
	}

	private inferGoalEffort(priority: string): number {
		switch (priority) {
			case "critical":
				return 20;
			case "high":
				return 13;
			case "medium":
				return 8;
			case "low":
				return 5;
			default:
				return 8;
		}
	}

	// -----------------------------------------------------------------------
	// Private Helpers — Failure Handling
	// -----------------------------------------------------------------------

	private failSession(sessionId: string, error: string, diagnostic: WorkerDiagnostic): null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		session.status = "failed";
		session.error = error;
		session.diagnostic = diagnostic;
		session.updatedAt = new Date().toISOString();
		this.consecutiveFailures++;
		this.totalSessionsFailed++;
		return null;
	}

	private failSessionBlocking(sessionId: string, error: string, diagnostic: WorkerDiagnostic): null {
		const result = this.failSession(sessionId, error, diagnostic);
		const session = this.sessions.get(sessionId);
		if (session?.plan) {
			session.plan.status = "failed";
			session.plan.diagnostic = diagnostic;
			session.plan.error = error;
			session.plan.updatedAt = new Date().toISOString();
		}
		return result;
	}

	private failSessionWithDiagnostic(
		sessionId: string,
		error: string,
		stopCondition: WorkerStopCondition,
		context: Record<string, unknown> = {},
		evidenceRefs: string[] = [],
		errorDetail?: string,
	): null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		session.status = "failed";
		session.error = error;
		session.diagnostic = createWorkerDiagnostic(stopCondition, error, context, evidenceRefs, errorDetail);
		session.updatedAt = new Date().toISOString();
		this.consecutiveFailures++;
		this.totalSessionsFailed++;
		return null;
	}

	// -----------------------------------------------------------------------
	// Private Helpers — Batch Computation / Confidence
	// -----------------------------------------------------------------------

	private computeBatches(workstreams: Workstream[], dependencies: DependencyLink[]): Batch[] {
		if (workstreams.length === 0) return [];

		const inDegree = new Map<string, number>();
		const adj = new Map<string, string[]>();

		for (const ws of workstreams) {
			inDegree.set(ws.id, 0);
			adj.set(ws.id, []);
		}

		for (const dep of dependencies) {
			const neighbors = adj.get(dep.from) ?? [];
			neighbors.push(dep.to);
			adj.set(dep.from, neighbors);
			inDegree.set(dep.to, (inDegree.get(dep.to) ?? 0) + 1);
		}

		const batches: Batch[] = [];
		let batchIndex = 1;

		let currentBatch: string[] = [];
		for (const [wsId, degree] of inDegree) {
			if (degree === 0) currentBatch.push(wsId);
		}

		while (currentBatch.length > 0) {
			batches.push({ index: batchIndex, workstreamIds: [...currentBatch] });
			batchIndex++;

			const nextBatch: string[] = [];
			for (const wsId of currentBatch) {
				const neighbors = adj.get(wsId) ?? [];
				for (const neighborId of neighbors) {
					const newDegree = (inDegree.get(neighborId) ?? 1) - 1;
					inDegree.set(neighborId, newDegree);
					if (newDegree === 0) nextBatch.push(neighborId);
				}
			}
			currentBatch = nextBatch;
		}

		return batches;
	}

	private calculateConfidence(proposals: NewProposalInput[]): number {
		if (proposals.length === 0) return 0;
		let totalEvidenceScore = 0;
		for (const proposal of proposals) {
			totalEvidenceScore += Math.min(proposal.evidenceIds.length * 0.2, 1.0);
		}
		return Math.min(totalEvidenceScore / proposals.length, 1.0);
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPlanSynthesizerWorker(
	config?: Partial<PlanSynthesizerWorkerConfig>,
	customTemplates?: PlanTemplate[],
): PlanSynthesizerWorker {
	return new PlanSynthesizerWorker(config, customTemplates);
}
