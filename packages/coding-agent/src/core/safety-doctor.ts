/**
 * Safety Doctor - P2 Workstream 7.J
 *
 * Validates plans and workspaces for safety issues before execution.
 * Detects placeholders, forbidden files, destructive commands, and security issues.
 */

import { validateWorkerConcurrency, type WorkerConcurrencySettings } from "@earendil-works/pi-execution-contracts";
import { computeBatchPlan } from "./dag-analyzer.js";
import { ExecutionSimulator } from "./execution-simulator.js";
import type { RetryPolicy } from "./retry-handler.js";
import { checkCommand, getEffectivePermissions, type SafetyProfileName } from "./safety-profile.js";
import { SkillRegistry } from "./skill-registry.js";
import { WorkspaceScheduler } from "./workspace-scheduler.js";
import type { Workspace, WorkspaceQueue } from "./workspace-schema.js";
import { validateWorkspaceQueue } from "./workspace-schema.js";

/**
 * Safety issue severity
 */
export enum SafetyIssueSeverity {
	/** Critical issue - must block execution */
	Critical = "critical",
	/** Warning - should be reviewed but may proceed */
	Warning = "warning",
	/** Info - for awareness only */
	Info = "info",
}

/**
 * Safety issue type
 */
export enum SafetyIssueType {
	/** Unresolved placeholder in plan */
	Placeholder = "placeholder",
	/** Forbidden file access attempt */
	ForbiddenFile = "forbidden_file",
	/** Destructive command detected */
	DestructiveCommand = "destructive_command",
	/** Secret/credential access attempt */
	SecretAccess = "secret_access",
	/** Budget violation */
	BudgetViolation = "budget_violation",
	/** Same-file parallelism violation */
	FileConflict = "file_conflict",
	/** Security/RBAC ambiguity */
	SecurityAmbiguity = "security_ambiguity",
	/** Dependency cycle */
	DependencyCycle = "dependency_cycle",
	/** Invalid workspace configuration */
	InvalidConfig = "invalid_config",
	/** Required skill missing from workspace */
	MissingSkill = "missing_skill",
	/** Safety profile conflict with plan requirements */
	ProfileConflict = "profile_conflict",
	/** Experimental worker mode enabled (4-6 workers) */
	ExperimentalWorkers = "experimental_workers",
	/** Preflight review required before execution */
	PreflightRequired = "preflight_required",
	/** Effective parallelism is below requested parallelism */
	LowEffectiveParallelism = "low_effective_parallelism",
	/** Dry-run forbidden mutation detected */
	DryRunForbiddenMutation = "dry_run_forbidden_mutation",
	/** P26.A: Autonomous execution requested during repair mode */
	AutonomousExecutionDuringRepair = "autonomous_execution_during_repair",

	/** P26.A: Promotion gate failed or missing for requested scale mode */
	PromotionGateFailedOrMissing = "promotion_gate_failed_or_missing",

	/** P26.A: Experimental/stable_6 requested before promotion gates pass */
	ScaleModeBlockedByPromotionGates = "scale_mode_blocked_by_promotion_gates",

	/** P26.I: Validation lane saturated, scheduler deferring workspaces */
	ValidationLaneSaturated = "validation_lane_saturated",

	/** P26.M: Fully serialized DAG — no parallelism possible */
	FullySerializedDag = "fully_serialized_dag",

	/** P26.M: Long serialized tail in DAG */
	LongSerializedTail = "long_serialized_tail",

	/** P26.M: Broad conflict scope detected */
	BroadConflictScope = "broad_conflict_scope",
}

/**
 * Safety issue
 */
export interface SafetyIssue {
	/** Issue type */
	type: SafetyIssueType;
	/** Severity level */
	severity: SafetyIssueSeverity;
	/** Issue description */
	message: string;
	/** Workspace ID (if applicable) */
	workspaceId?: string;
	/** Additional context */
	context?: Record<string, unknown>;
}

/**
 * Parallelism diagnostics reported by the safety doctor.
 */
export interface ParallelismDiagnostics {
	/** Effective parallelism (max width across topological batches, DAG only) */
	effectiveParallelism: number;
	/** Critical path length (number of topological batches) */
	criticalPathLength: number;
	/** Number of consecutive single-width batches at the end */
	serializedTailLength: number;
	/** Requested parallelism (from queue maxParallelWorkspaces) */
	requestedParallelism: number;
	/** Delta between requested and effective parallelism */
	parallelismDelta: number;

	/** P26.M: Safe effective parallelism after conflict/dependency resolution */
	safeEffectiveParallelism?: number;
}

/**
 * P26.M: Anti-stall diagnostics for plan-intake analysis.
 * Flags conditions that could stall execution despite passing the DAG check.
 */
export interface AntiStallDiagnostics {
	/** Whether the graph is fully serialized (all batches width=1) */
	fullySerialized: boolean;
	/** Length of the serialized tail (consecutive width-1 batches at end) */
	serializedTailLength: number;
	/** Whether the serialized tail exceeds the threshold */
	serializedTailExceedsThreshold: boolean;
	/** Threshold for serialized tail warning */
	serializedTailThreshold: number;
	/** Number of workspaces with broad conflict scopes */
	broadConflictScopeCount: number;
	/** Whether validation lane bottlenecks are expected */
	validationBottleneckExpected: boolean;
	/** Recommended actions */
	recommendations: string[];
}

/**
 * Safety report
 */
export interface SafetyReport {
	/** Whether plan is safe to execute */
	safe: boolean;
	/** Critical issues (must be fixed) */
	critical: SafetyIssue[];
	/** Warnings (should be reviewed) */
	warnings: SafetyIssue[];
	/** Info messages */
	info: SafetyIssue[];
	/** Total issue count */
	totalIssues: number;
	/** Parallelism diagnostics (computed from DAG analysis) */
	parallelism?: ParallelismDiagnostics;
}

/**
 * Destructive command patterns
 */
const DESTRUCTIVE_COMMANDS = [
	"rm -rf",
	"rm -fr",
	"git push",
	"git reset --hard",
	"git clean -fd",
	"git force",
	"npm publish",
	"yarn publish",
	"docker rm",
	"kubectl delete",
	"terraform destroy",
	"aws s3 rm",
	"gcloud delete",
	"heroku destroy",
	"vercel --prod",
	"netlify deploy --prod",
];

/**
 * Secret/credential file patterns
 */
const SECRET_PATTERNS = [
	"*.pem",
	"**/*.pem",
	"*.key",
	"**/*.key",
	"*.p12",
	"**/*.p12",
	"*.pfx",
	"**/*.pfx",
	"**/secrets/**",
	"**/credentials/**",
	".env",
	".env.*",
	"**/.env",
	"**/.env.*",
	"**/id_rsa",
	"**/id_dsa",
	"**/*.secret",
	"**/*.credential",
	"**/*.env",
];

/**
 * Placeholder patterns
 */
const PLACEHOLDER_PATTERNS = [
	/\[TODO\]/gi,
	/\[FIXME\]/gi,
	/\[PLACEHOLDER\]/gi,
	/\[TBD\]/gi,
	/\[FILL.*IN\]/gi,
	/\[REPLACE.*WITH\]/gi,
	/\{\{.*\}\}/g, // Template variables
	/<.*>/g, // Angle bracket placeholders (but not HTML tags in markdown)
];

/**
 * Safety doctor
 *
 * Validates plans and workspaces for safety issues:
 * - Detects unresolved placeholders
 * - Detects forbidden file edits
 * - Detects destructive commands
 * - Detects secret/credential access
 * - Detects budget violations
 * - Detects file conflicts
 * - Detects security ambiguities
 */
export class SafetyDoctor {
	private scheduler: WorkspaceScheduler;
	private workerConcurrency?: WorkerConcurrencySettings;

	constructor(maxWorkers = 3, workerConcurrency?: WorkerConcurrencySettings) {
		this.scheduler = new WorkspaceScheduler(maxWorkers);
		this.workerConcurrency = workerConcurrency;
	}

	/**
	 * Validate workspace queue for safety issues
	 *
	 * @param queue - Workspace queue to validate
	 * @param profileName - Optional safety profile to check against for profile conflicts
	 * @returns Safety report
	 */
	validateQueue(queue: WorkspaceQueue, profileName?: SafetyProfileName): SafetyReport {
		const issues: SafetyIssue[] = [];

		// Validate workspace schema
		const schemaValidation = validateWorkspaceQueue(queue);
		if (!schemaValidation.valid) {
			for (const error of schemaValidation.errors) {
				issues.push({
					type: SafetyIssueType.InvalidConfig,
					severity: SafetyIssueSeverity.Critical,
					message: error.message,
					workspaceId: error.workspaceId,
					context: error.context,
				});
			}
		}

		// Check for dependency cycles (already caught by schema validation, but double-check)
		const schedulingValidation = this.scheduler.validateScheduling(queue.workspaces);
		if (!schedulingValidation.valid) {
			for (const error of schedulingValidation.errors) {
				if (error.includes("cycle")) {
					issues.push({
						type: SafetyIssueType.DependencyCycle,
						severity: SafetyIssueSeverity.Critical,
						message: error,
					});
				} else if (error.includes("deadlock")) {
					issues.push({
						type: SafetyIssueType.FileConflict,
						severity: SafetyIssueSeverity.Critical,
						message: error,
					});
				}
			}
		}

		// Validate each workspace
		for (const workspace of queue.workspaces) {
			issues.push(...this.validateWorkspace(workspace));
		}

		// Check for profile conflicts if a profile is specified
		if (profileName) {
			issues.push(...this.detectProfileConflicts(queue, profileName));
		}

		// Check for experimental worker mode warnings
		if (this.workerConcurrency) {
			issues.push(...this.detectExperimentalWorkerIssues(this.workerConcurrency));
		}
		issues.push(...this.validateDerivedIntentProfile(queue));

		// P26.A: Detect repair mode / promotion gate issues
		issues.push(...this.detectRepairModeIssues(queue, queue.maxParallelWorkspaces));

		return this.buildReport(issues);
	}

	/**
	 * Validate workspace queue for safety issues with parallelism diagnostics.
	 *
	 * Extends validateQueue with DAG-based parallelism analysis:
	 * - Computes effectiveParallelism, criticalPathLength, serializedTailLength
	 * - Warns when effective parallelism < requested parallelism
	 * - Checks for preflightRequired workspaces
	 * - Fails dependency cycles and invalid workspace references
	 *
	 * @param queue - Workspace queue to validate
	 * @param profileName - Optional safety profile to check against for profile conflicts
	 * @returns Safety report with parallelism diagnostics
	 */
	validateQueueWithParallelism(queue: WorkspaceQueue, profileName?: SafetyProfileName): SafetyReport {
		const issues: SafetyIssue[] = [];

		// Validate workspace schema
		const schemaValidation = validateWorkspaceQueue(queue);
		if (!schemaValidation.valid) {
			for (const error of schemaValidation.errors) {
				issues.push({
					type: SafetyIssueType.InvalidConfig,
					severity: SafetyIssueSeverity.Critical,
					message: error.message,
					workspaceId: error.workspaceId,
					context: error.context,
				});
			}
		}

		// Check for dependency cycles (already caught by schema validation, but double-check)
		const schedulingValidation = this.scheduler.validateScheduling(queue.workspaces);
		if (!schedulingValidation.valid) {
			for (const error of schedulingValidation.errors) {
				if (error.includes("cycle")) {
					issues.push({
						type: SafetyIssueType.DependencyCycle,
						severity: SafetyIssueSeverity.Critical,
						message: error,
					});
				} else if (error.includes("deadlock")) {
					issues.push({
						type: SafetyIssueType.FileConflict,
						severity: SafetyIssueSeverity.Critical,
						message: error,
					});
				}
			}
		}

		// Validate each workspace
		for (const workspace of queue.workspaces) {
			issues.push(...this.validateWorkspace(workspace));
		}

		// Check for profile conflicts if a profile is specified
		if (profileName) {
			issues.push(...this.detectProfileConflicts(queue, profileName));
		}

		// Check for experimental worker mode warnings
		if (this.workerConcurrency) {
			issues.push(...this.detectExperimentalWorkerIssues(this.workerConcurrency));
		}

		// Check for preflightRequired workspaces
		for (const workspace of queue.workspaces) {
			if (workspace.preflightRequired) {
				issues.push({
					type: SafetyIssueType.PreflightRequired,
					severity: SafetyIssueSeverity.Critical,
					message: `Workspace ${workspace.id} requires preflight review approval before execution`,
					workspaceId: workspace.id,
				});
			}
		}
		issues.push(...this.validateDerivedIntentProfile(queue));

		// P26.A: Detect repair mode / promotion gate issues
		issues.push(...this.detectRepairModeIssues(queue, queue.maxParallelWorkspaces));

		// Compute parallelism diagnostics from DAG analysis
		let parallelism: ParallelismDiagnostics | undefined;
		const batchPlanResult = computeBatchPlan(queue);
		if (batchPlanResult.errors.length === 0) {
			parallelism = {
				effectiveParallelism: batchPlanResult.effectiveParallelism,
				criticalPathLength: batchPlanResult.criticalPathLength,
				serializedTailLength: batchPlanResult.serializedTailLength,
				requestedParallelism: batchPlanResult.requestedParallelism,
				parallelismDelta: batchPlanResult.parallelismDelta,
			};

			// Simulate file-lock serialization per batch.
			// Workspaces in the same topological batch that share canEdit files
			// cannot truly run in parallel; the scheduler will serialize them.
			// Compute the lock-constrained effective parallelism and warn if
			// it's lower than the DAG's theoretical batch width.
			const lockConstrained = simulateBatchFileLocks(queue.workspaces, batchPlanResult.batches);
			if (lockConstrained.serializedBatches.length > 0) {
				// Collect all serialized workspace pairs for the message
				const serializedDetails = lockConstrained.serializedBatches.map(
					(b) =>
						`Batch ${b.batchIndex} (width ${b.dagWidth}): workspaces ${b.workspaceIds.join(", ")} share ${b.sharedFiles.slice(0, 3).join(", ")}${b.sharedFiles.length > 3 ? "..." : ""} — will run with effective width ${b.effectiveWidth}`,
				);
				issues.push({
					type: SafetyIssueType.FileConflict,
					severity: SafetyIssueSeverity.Warning,
					message:
						`File-lock analysis: ${lockConstrained.serializedBatches.length} batch(es) will be serialized due to shared canEdit files. ` +
						`Lock-constrained effective parallelism: ${lockConstrained.lockConstrainedParallelism} (DAG says ${batchPlanResult.effectiveParallelism}). ` +
						serializedDetails.join("; "),
					context: {
						serializedBatches: lockConstrained.serializedBatches,
						lockConstrainedParallelism: lockConstrained.lockConstrainedParallelism,
					},
				});

				// Update effective parallelism to reflect lock constraints
				parallelism = {
					...parallelism,
					effectiveParallelism: lockConstrained.lockConstrainedParallelism,
				};
			}

			// Warn when effective parallelism is below requested parallelism
			if (
				batchPlanResult.effectiveParallelism < batchPlanResult.requestedParallelism &&
				batchPlanResult.effectiveParallelism > 0
			) {
				issues.push({
					type: SafetyIssueType.LowEffectiveParallelism,
					severity: SafetyIssueSeverity.Warning,
					message: `Effective parallelism (${batchPlanResult.effectiveParallelism}) is below requested (${batchPlanResult.requestedParallelism}). Some worker capacity will be unused.`,
					context: {
						effectiveParallelism: batchPlanResult.effectiveParallelism,
						requestedParallelism: batchPlanResult.requestedParallelism,
						parallelismDelta: batchPlanResult.parallelismDelta,
					},
				});
			}
		} else {
			// Report batch plan errors as critical issues (dependency cycles, missing deps)
			for (const error of batchPlanResult.errors) {
				if (error.type === "cycle") {
					// Only add if not already present from schema validation
					const alreadyHasCycle = issues.some((i) => i.type === SafetyIssueType.DependencyCycle);
					if (!alreadyHasCycle) {
						issues.push({
							type: SafetyIssueType.DependencyCycle,
							severity: SafetyIssueSeverity.Critical,
							message: error.message,
							workspaceId: error.workspaceIds?.[0],
						});
					}
				}
				if (error.type === "missing_dependency") {
					issues.push({
						type: SafetyIssueType.InvalidConfig,
						severity: SafetyIssueSeverity.Critical,
						message: error.message,
						workspaceId: error.workspaceIds?.[0],
					});
				}
			}

			// Promote file overlap warnings to CRITICAL errors — same-batch workspaces
			// that share canEdit files cannot actually run concurrently, making the
			// effective parallelism lower than the batch width implies.
			for (const warning of batchPlanResult.warnings) {
				if (warning.type === "file_overlap") {
					issues.push({
						type: SafetyIssueType.FileConflict,
						severity: SafetyIssueSeverity.Critical,
						message: warning.message,
						workspaceId: warning.workspaceIds?.[0],
						context: {
							batchIndex: warning.batchIndex,
							workspaceIds: warning.workspaceIds,
						},
					});
				}
			}
		}

		return this.buildReport(issues, parallelism);
	}

	/**
	 * Validate required skills for a workspace queue.
	 *
	 * Checks all required skills declared in the skill manifest
	 * are available in the local skill directories.
	 *
	 * @param cwd - Working directory
	 * @param agentDir - Agent config directory
	 * @param options - Options for skill loading
	 * @returns Safety report focusing on missing skills
	 */
	validateSkills(
		cwd: string,
		agentDir: string,
		options?: { skillPaths?: string[]; includeDefaults?: boolean },
	): SafetyReport {
		const issues = this.validateRequiredSkills(cwd, agentDir, options);
		return this.buildReport(issues);
	}

	/**
	 * Validate plan against safety profile for conflicts.
	 *
	 * Checks that workspace capabilities don't conflict with the
	 * effective permissions of the currently configured safety profile.
	 * For example, if a workspace requires running "git push" but the
	 * profile blocks it, this produces a ProfileConflict warning.
	 *
	 * @param queue - Workspace queue to validate
	 * @param profileName - Safety profile name to validate against
	 * @returns Safety report highlighting profile conflicts
	 */
	validateProfileConflicts(queue: WorkspaceQueue, profileName: SafetyProfileName = "strict"): SafetyReport {
		const issues = this.detectProfileConflicts(queue, profileName);
		return this.buildReport(issues);
	}

	/**
	 * Detect conflicts between plan workspace capabilities and safety profile.
	 *
	 * For each workspace that declares canRun capabilities, checks each
	 * command against the safety profile. If the command is blocked or
	 * requires confirmation, a ProfileConflict issue is raised.
	 *
	 * @param queue - Workspace queue
	 * @param profileName - Safety profile name
	 * @returns Array of safety issues for profile conflicts
	 */
	detectProfileConflicts(queue: WorkspaceQueue, profileName: SafetyProfileName = "strict"): SafetyIssue[] {
		const issues: SafetyIssue[] = [];
		const permissions = getEffectivePermissions(profileName);

		for (const workspace of queue.workspaces) {
			if (!workspace.capabilities) continue;

			// Check each declared canRun command against the profile
			for (const command of workspace.capabilities.canRun) {
				const result = checkCommand(command, profileName);
				if (result.level === "blocked") {
					issues.push({
						type: SafetyIssueType.ProfileConflict,
						severity: SafetyIssueSeverity.Warning,
						message: `Command "${command}" in workspace "${workspace.title}" is blocked by safety profile "${profileName}"`,
						workspaceId: workspace.id,
						context: { command, profile: profileName, level: result.level, reason: result.reason },
					});
				} else if (result.level === "confirm") {
					issues.push({
						type: SafetyIssueType.ProfileConflict,
						severity: SafetyIssueSeverity.Info,
						message: `Command "${command}" in workspace "${workspace.title}" requires confirmation under safety profile "${profileName}"`,
						workspaceId: workspace.id,
						context: { command, profile: profileName, level: result.level, reason: result.reason },
					});
				}
			}

			// Check that parallel workspace count doesn't exceed profile maximum
			if (
				permissions.maxParallelWorkspaces > 0 &&
				queue.workspaces.length > permissions.maxParallelWorkspaces &&
				profileName === "strict"
			) {
				issues.push({
					type: SafetyIssueType.ProfileConflict,
					severity: SafetyIssueSeverity.Warning,
					message: `Plan has ${queue.workspaces.length} workspaces but safety profile "${profileName}" allows maximum ${permissions.maxParallelWorkspaces} parallel workspaces`,
					context: {
						workspaceCount: queue.workspaces.length,
						maxParallel: permissions.maxParallelWorkspaces,
						profile: profileName,
					},
				});
			}

			// Only check parallel limit once, break after first workspace with capabilities
			break;
		}

		return issues;
	}

	/**
	 * Detect issues with experimental worker concurrency settings.
	 *
	 * Warns when experimental mode (4-6 workers) is enabled.
	 * Produces critical errors if prerequisites (archive, stop-on-failure)
	 * are not met for experimental mode.
	 *
	 * @param settings - Worker concurrency settings
	 * @returns Array of safety issues
	 */
	detectExperimentalWorkerIssues(settings: WorkerConcurrencySettings): SafetyIssue[] {
		const issues: SafetyIssue[] = [];
		const validation = validateWorkerConcurrency(settings);

		// Report validation errors as critical issues
		for (const error of validation.errors) {
			issues.push({
				type: SafetyIssueType.ExperimentalWorkers,
				severity: SafetyIssueSeverity.Critical,
				message: error,
				context: {
					maxWorkers: settings.maxWorkers,
					experimentalModeEnabled: settings.experimentalModeEnabled,
				},
			});
		}

		// Report validation warnings
		for (const warning of validation.warnings) {
			issues.push({
				type: SafetyIssueType.ExperimentalWorkers,
				severity: SafetyIssueSeverity.Warning,
				message: warning,
				context: {
					maxWorkers: settings.maxWorkers,
					experimentalModeEnabled: settings.experimentalModeEnabled,
					effectiveWorkers: validation.effectiveWorkers,
				},
			});
		}

		return issues;
	}

	/**
	 * Validate a workspace queue for dry-run safety.
	 *
	 * Checks that the dry-run simulation would not attempt forbidden mutations
	 * such as git commits, pushes, resets, or destructive commands.
	 *
	 * @param queue - Workspace queue to validate for dry-run
	 * @returns Safety report focused on dry-run mutation issues
	 */
	validateDryRun(queue: WorkspaceQueue): SafetyReport {
		const issues: SafetyIssue[] = [];
		const simulator = new ExecutionSimulator();
		const mutationResult = simulator.checkForbiddenMutations(queue);

		if (mutationResult.forbiddenMutationDetected) {
			for (const mutation of mutationResult.forbiddenMutations) {
				issues.push({
					type: SafetyIssueType.DryRunForbiddenMutation,
					severity: SafetyIssueSeverity.Critical,
					message: mutation,
				});
			}
		}

		return this.buildReport(issues);
	}

	/**
	 * Validate individual workspace
	 *
	 * @param workspace - Workspace to validate
	 * @returns Array of safety issues
	 */
	validateWorkspace(workspace: Workspace): SafetyIssue[] {
		const issues: SafetyIssue[] = [];

		// Check for placeholders in title
		for (const pattern of PLACEHOLDER_PATTERNS) {
			if (pattern.test(workspace.title)) {
				issues.push({
					type: SafetyIssueType.Placeholder,
					severity: SafetyIssueSeverity.Critical,
					message: `Unresolved placeholder in workspace title: "${workspace.title}"`,
					workspaceId: workspace.id,
				});
			}
		}

		// Check for placeholders in acceptance criteria
		if (workspace.acceptanceCriteria) {
			for (const criterion of workspace.acceptanceCriteria) {
				for (const pattern of PLACEHOLDER_PATTERNS) {
					if (pattern.test(criterion)) {
						issues.push({
							type: SafetyIssueType.Placeholder,
							severity: SafetyIssueSeverity.Critical,
							message: `Unresolved placeholder in acceptance criteria: "${criterion}"`,
							workspaceId: workspace.id,
						});
					}
				}
			}
		}

		// Check capabilities if present
		if (workspace.capabilities) {
			// Check for destructive commands
			for (const command of workspace.capabilities.canRun) {
				for (const destructive of DESTRUCTIVE_COMMANDS) {
					if (command.toLowerCase().includes(destructive.toLowerCase())) {
						issues.push({
							type: SafetyIssueType.DestructiveCommand,
							severity: SafetyIssueSeverity.Critical,
							message: `Destructive command detected: "${command}"`,
							workspaceId: workspace.id,
							context: { command },
						});
					}
				}
			}

			// Check for secret file access
			for (const file of workspace.capabilities.canEdit) {
				for (const secretPattern of SECRET_PATTERNS) {
					if (this.matchesPattern(file, secretPattern)) {
						issues.push({
							type: SafetyIssueType.SecretAccess,
							severity: SafetyIssueSeverity.Critical,
							message: `Secret/credential file access detected: "${file}"`,
							workspaceId: workspace.id,
							context: { file },
						});
					}
				}
			}
		}

		// Check for security/RBAC keywords requiring reviewer gate
		const securityKeywords = ["auth", "security", "rbac", "permission", "credential", "token", "password"];
		const titleLower = workspace.title.toLowerCase();

		for (const keyword of securityKeywords) {
			if (titleLower.includes(keyword)) {
				// Check if workspace has reviewer role or high risk level
				if (workspace.roleBudget !== "reviewer" && workspace.riskLevel !== "high") {
					issues.push({
						type: SafetyIssueType.SecurityAmbiguity,
						severity: SafetyIssueSeverity.Warning,
						message: `Security-related workspace "${workspace.title}" should use reviewer role or high risk level`,
						workspaceId: workspace.id,
						context: { keyword },
					});
				}
			}
		}

		// Validate retry policy if present
		if (workspace.retryPolicy) {
			issues.push(...this.validateRetryPolicy(workspace.retryPolicy, workspace.id));
		}

		return issues;
	}

	/**
	 * P26.A: Detect issues related to repair-mode execution.
	 *
	 * Checks whether the queue has executionAutomation.autonomousExecutionEnabled
	 * set to false, which means the plan is a repair plan and must not be run
	 * through the autonomous executor. Also checks that no unsafe scale mode is
	 * requested when promotion gates are pending.
	 *
	 * @param queue - Workspace queue to check
	 * @param requestedWorkerCount - The worker count being validated (optional)
	 * @returns Array of safety issues
	 */
	detectRepairModeIssues(queue: WorkspaceQueue, requestedWorkerCount?: number): SafetyIssue[] {
		const issues: SafetyIssue[] = [];

		const executionAutomation = queue.executionAutomation;
		const repairMode = queue.repairMode;
		const promotionGates = queue.promotionGates;

		// Check 1: Autonomous execution requested during repair mode
		if (executionAutomation?.autonomousExecutionEnabled === false) {
			issues.push({
				type: SafetyIssueType.AutonomousExecutionDuringRepair,
				severity: SafetyIssueSeverity.Critical,
				message:
					"Autonomous execution is disabled for this repair-mode plan. " +
					"Repair plans must not be launched with `pi plan run` or the " +
					"autonomous executor. Manual patch application is required. " +
					"(autonomous_execution_requested_during_repair_mode)",
				context: {
					executionAutomation,
					repairMode: repairMode?.selectedMode ?? "unknown",
				},
			});
		}

		// Check 2: Promotion gates — are any required gates pending/failed
		// for the requested worker count or scale mode?
		if (promotionGates && promotionGates.gates.length > 0) {
			// Determine which scale mode applies
			const targetMode = promotionGates.targetMode ?? "stable_6";

			// If requested worker count is given, compute required mode
			let requiredMode: string | undefined;
			if (requestedWorkerCount !== undefined) {
				if (requestedWorkerCount >= 6) {
					requiredMode = "stable_6";
				} else if (requestedWorkerCount >= 4) {
					requiredMode = "stable_6"; // experimental_6 requires stable_6
				} else if (requestedWorkerCount >= 2) {
					requiredMode = "stable_3";
				} else {
					requiredMode = "stable_1";
				}
			} else {
				requiredMode = targetMode;
			}

			// Find gates required for the target/required mode
			const pendingOrFailedGates = promotionGates.gates.filter(
				(gate) => gate.requiredFor.includes(requiredMode ?? "") && gate.status !== "passed",
			);

			if (pendingOrFailedGates.length > 0) {
				issues.push({
					type: SafetyIssueType.PromotionGateFailedOrMissing,
					severity: SafetyIssueSeverity.Critical,
					message:
						`Scale mode "${requiredMode ?? "unknown"}" requires promotion gates that ` +
						`have not passed: ${pendingOrFailedGates.map((g) => `${g.id} (${g.status})`).join(", ")}. ` +
						"Execution is blocked until all required gates pass. " +
						"(promotion_gate_failed_or_missing)",
					context: {
						requiredMode,
						requestedWorkerCount,
						pendingOrFailedGates: pendingOrFailedGates.map((g) => ({
							id: g.id,
							status: g.status,
						})),
					},
				});
			}

			// Check 3: Scale mode blocked — target mode requires gates
			if (requiredMode === "stable_6") {
				const stable6Gates = promotionGates.gates.filter(
					(g) => g.requiredFor.includes("stable_6") && g.status !== "passed",
				);
				if (stable6Gates.length > 0) {
					issues.push({
						type: SafetyIssueType.ScaleModeBlockedByPromotionGates,
						severity: SafetyIssueSeverity.Critical,
						message:
							`stable_6/experimental_6 cannot be selected while required promotion gates are pending: ` +
							`${stable6Gates.map((g) => `${g.id} (${g.status})`).join(", ")}. ` +
							"Complete all required promotion gates before enabling stable_6.",
						context: {
							blockedMode: "stable_6",
							pendingGates: stable6Gates.map((g) => ({
								id: g.id,
								status: g.status,
							})),
						},
					});
				}
			}
		}

		return issues;
	}

	/**
	 * P26.I: Detect validation lane saturation issues.
	 *
	 * Uses the ValidationLaneTracker's current state to determine if
	 * the scheduler is deferring workspaces due to heavy validation lane
	 * saturation. The dashboard/doctor uses this to explain why workspaces
	 * are blocked.
	 *
	 * @param laneState - Current lane state snapshot
	 * @returns Safety issues
	 */
	detectValidationLaneIssues(laneState: {
		heavyCount: number;
		maxHeavy: number;
		targetedCount: number;
		maxTargeted: number;
	}): SafetyIssue[] {
		const issues: SafetyIssue[] = [];

		if (laneState.heavyCount >= laneState.maxHeavy) {
			issues.push({
				type: SafetyIssueType.ValidationLaneSaturated,
				severity: SafetyIssueSeverity.Warning,
				message:
					`Heavy validation lane is saturated (${laneState.heavyCount}/${laneState.maxHeavy}). ` +
					`Scheduler is deferring heavy-validation workspaces until a slot opens. ` +
					`(validation_lane_saturated_blocking_scheduler)`,
				context: laneState,
			});
		}

		return issues;
	}

	/**
	 * P26.M: Detect anti-stall conditions in a plan's DAG.
	 *
	 * Flags fully serialized graphs, long serialized tails, broad conflict
	 * scopes, and validation lane bottlenecks — conditions that could stall
	 * execution despite passing the basic DAG/conflict check.
	 *
	 * @param diagnostics - Anti-stall diagnostics
	 * @returns Safety issues (warnings/info)
	 */
	detectAntiStallIssues(diagnostics: AntiStallDiagnostics): SafetyIssue[] {
		const issues: SafetyIssue[] = [];

		if (diagnostics.fullySerialized) {
			issues.push({
				type: SafetyIssueType.FullySerializedDag,
				severity: SafetyIssueSeverity.Warning,
				message:
					`DAG is fully serialized: all ${diagnostics.serializedTailLength} batches have width 1. ` +
					`No parallelism is possible regardless of concurrency setting. ` +
					`(fully_serialized_dag)`,
				context: diagnostics as unknown as Record<string, unknown>,
			});
		}

		if (diagnostics.serializedTailExceedsThreshold) {
			issues.push({
				type: SafetyIssueType.LongSerializedTail,
				severity: SafetyIssueSeverity.Warning,
				message:
					`Long serialized tail detected: ${diagnostics.serializedTailLength} consecutive ` +
					`single-width batches at the end of the DAG. This reduces effective parallelism ` +
					`as most workers finish early. (long_serialized_tail)`,
				context: diagnostics as unknown as Record<string, unknown>,
			});
		}

		if (diagnostics.broadConflictScopeCount > 0) {
			issues.push({
				type: SafetyIssueType.BroadConflictScope,
				severity: SafetyIssueSeverity.Info,
				message:
					`${diagnostics.broadConflictScopeCount} workspaces have broad conflict scopes ` +
					`that may prevent safe parallel execution. Consider narrowing file patterns ` +
					`in canEdit/writeSet to improve parallelism. (broad_conflict_scope)`,
				context: diagnostics as unknown as Record<string, unknown>,
			});
		}

		if (diagnostics.validationBottleneckExpected) {
			issues.push({
				type: SafetyIssueType.ValidationLaneSaturated,
				severity: SafetyIssueSeverity.Info,
				message:
					`Validation lane bottleneck expected: heavy validation commands may saturate ` +
					`the heavy validation slot, causing the scheduler to defer workspaces. ` +
					`Consider reducing heavy validation commands or enabling targeted-only mode. ` +
					`(validation_lane_bottleneck_expected)`,
				context: diagnostics as unknown as Record<string, unknown>,
			});
		}

		// Add recommendations if present
		if (diagnostics.recommendations.length > 0) {
			issues.push({
				type: SafetyIssueType.Placeholder,
				severity: SafetyIssueSeverity.Info,
				message: `Plan optimization recommendations:\n${diagnostics.recommendations.map((r) => `  - ${r}`).join("\n")}`,
				context: diagnostics as unknown as Record<string, unknown>,
			});
		}

		return issues;
	}

	/**
	 * Build safety report from issues
	 *
	 * @param issues - Array of safety issues
	 * @returns Safety report
	 */
	private validateDerivedIntentProfile(queue: WorkspaceQueue): SafetyIssue[] {
		const issues: SafetyIssue[] = [];
		for (const hint of queue.deprecatedMechanismHints ?? []) {
			issues.push({
				type: SafetyIssueType.InvalidConfig,
				severity: SafetyIssueSeverity.Warning,
				message: hint,
			});
		}
		if (queue.intent?.safetyLevel === "relaxed" && queue.intent.parallelism > 1) {
			issues.push({
				type: SafetyIssueType.InvalidConfig,
				severity: SafetyIssueSeverity.Critical,
				message: "Impossible intent: relaxed safetyLevel requires parallelism <= 1",
			});
		}
		if (queue.derivedProfile?.worktreeRequired && !queue.planExecution?.worktree?.enabled) {
			issues.push({
				type: SafetyIssueType.InvalidConfig,
				severity: SafetyIssueSeverity.Critical,
				message: "Derived profile requires worktree isolation but planExecution.worktree.enabled is not true",
			});
		}
		return issues;
	}

	private buildReport(issues: SafetyIssue[], parallelism?: ParallelismDiagnostics): SafetyReport {
		const critical = issues.filter((i) => i.severity === SafetyIssueSeverity.Critical);
		const warnings = issues.filter((i) => i.severity === SafetyIssueSeverity.Warning);
		const info = issues.filter((i) => i.severity === SafetyIssueSeverity.Info);

		return {
			safe: critical.length === 0,
			critical,
			warnings,
			info,
			totalIssues: issues.length,
			parallelism,
		};
	}

	/**
	 * Validate that all required skills are present for a workspace.
	 *
	 * Uses the SkillRegistry to check the manifest and local skills,
	 * and produces safety issues for any missing required skills.
	 *
	 * @param cwd - Working directory
	 * @param agentDir - Agent config directory
	 * @param options - Options for skill loading
	 * @returns Array of safety issues for missing required skills
	 */
	validateRequiredSkills(
		cwd: string,
		agentDir: string,
		options?: { skillPaths?: string[]; includeDefaults?: boolean },
	): SafetyIssue[] {
		const issues: SafetyIssue[] = [];
		const registry = new SkillRegistry(cwd, agentDir);
		const validation = registry.validate(options);

		for (const missing of validation.missingRequired) {
			issues.push({
				type: SafetyIssueType.MissingSkill,
				severity: SafetyIssueSeverity.Critical,
				message: missing.reason,
				context: { skillName: missing.entry.name, skillSource: missing.entry.source },
			});
		}

		return issues;
	}

	/**
	 * Validate retry policy thresholds
	 *
	 * Checks that flash escalation threshold is less than reviewer threshold.
	 *
	 * @param policy - Retry policy to validate
	 * @param workspaceId - Workspace ID for context
	 * @returns Array of safety issues
	 */
	private validateRetryPolicy(policy: RetryPolicy, workspaceId?: string): SafetyIssue[] {
		const issues: SafetyIssue[] = [];

		const flash = policy.escalationThresholds.flash;
		const reviewer = policy.escalationThresholds.reviewer;

		if (flash >= reviewer) {
			issues.push({
				type: SafetyIssueType.InvalidConfig,
				severity: SafetyIssueSeverity.Critical,
				message: `Retry policy: flashEscalationAttempt (${flash}) must be less than reviewerEscalationAttempt (${reviewer})`,
				workspaceId,
				context: { flashEscalationAttempt: flash, reviewerEscalationAttempt: reviewer },
			});
		}

		if (policy.escalationThresholds.final <= reviewer) {
			issues.push({
				type: SafetyIssueType.InvalidConfig,
				severity: SafetyIssueSeverity.Warning,
				message: `Retry policy: finalEscalationAttempt (${policy.escalationThresholds.final}) should be greater than reviewerEscalationAttempt (${reviewer})`,
				workspaceId,
				context: policy.escalationThresholds,
			});
		}

		return issues;
	}

	/**
	 * Match file path against pattern (supports wildcards)
	 *
	 * @param filePath - File path to match
	 * @param pattern - Pattern (supports * and ** wildcards)
	 * @returns True if file matches pattern
	 */
	private matchesPattern(filePath: string, pattern: string): boolean {
		// Normalize paths to use forward slashes
		const normalizedPath = filePath.replace(/\\/g, "/");
		const normalizedPattern = pattern.replace(/\\/g, "/");

		// Convert glob pattern to regex
		const regexPattern = normalizedPattern
			.replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
			.replace(/\*\*/g, "___DOUBLESTAR___") // Temporarily replace **
			.replace(/\*/g, "[^/]*") // Convert * to match anything except /
			.replace(/___DOUBLESTAR___/g, ".*"); // Convert ** to match anything including /

		const regex = new RegExp(`^${regexPattern}$`);
		return regex.test(normalizedPath);
	}

	/**
	 * Format safety report for display
	 *
	 * @param report - Safety report
	 * @returns Formatted string
	 */
	formatReport(report: SafetyReport): string {
		const lines: string[] = [];

		lines.push("=== Safety Doctor Report ===");
		lines.push("");

		if (report.safe) {
			lines.push("✅ Plan is SAFE to execute");
		} else {
			lines.push("❌ Plan has CRITICAL safety issues");
		}

		lines.push("");
		lines.push(`Total issues: ${report.totalIssues}`);
		lines.push(`  Critical: ${report.critical.length}`);
		lines.push(`  Warnings: ${report.warnings.length}`);
		lines.push(`  Info: ${report.info.length}`);

		if (report.critical.length > 0) {
			lines.push("");
			lines.push("CRITICAL ISSUES:");
			for (const issue of report.critical) {
				lines.push(`  ❌ [${issue.type}] ${issue.message}`);
				if (issue.workspaceId) {
					lines.push(`     Workspace: ${issue.workspaceId}`);
				}
			}
		}

		if (report.warnings.length > 0) {
			lines.push("");
			lines.push("WARNINGS:");
			for (const issue of report.warnings) {
				lines.push(`  ⚠️  [${issue.type}] ${issue.message}`);
				if (issue.workspaceId) {
					lines.push(`     Workspace: ${issue.workspaceId}`);
				}
			}
		}

		if (report.info.length > 0) {
			lines.push("");
			lines.push("INFO:");
			for (const issue of report.info) {
				lines.push(`  ℹ️  [${issue.type}] ${issue.message}`);
			}
		}

		if (report.parallelism) {
			lines.push("");
			lines.push("PARALLELISM DIAGNOSTICS:");
			lines.push(`  Effective parallelism: ${report.parallelism.effectiveParallelism}`);
			lines.push(`  Requested parallelism: ${report.parallelism.requestedParallelism}`);
			lines.push(`  Critical path length:  ${report.parallelism.criticalPathLength}`);
			lines.push(`  Serialized tail length: ${report.parallelism.serializedTailLength}`);
			const delta = report.parallelism.parallelismDelta;
			lines.push(`  Parallelism delta:     ${delta > 0 ? `+${delta}` : String(delta)}`);
		}

		return lines.join("\n");
	}
}

/**
 * Create a safety doctor instance
 *
 * @param maxWorkers - Maximum worker count (default: 3)
 * @param workerConcurrency - Optional worker concurrency settings for experimental mode warnings
 * @returns Safety doctor instance
 */
export function createSafetyDoctor(maxWorkers = 3, workerConcurrency?: WorkerConcurrencySettings): SafetyDoctor {
	return new SafetyDoctor(maxWorkers, workerConcurrency);
}

// ---------------------------------------------------------------------------
// File-lock serialization simulation for validator warnings
// ---------------------------------------------------------------------------

/**
 * Result of simulating file-lock constraints on topological batches.
 */
interface LockSerializationResult {
	lockConstrainedParallelism: number;
	serializedBatches: Array<{
		batchIndex: number;
		dagWidth: number;
		effectiveWidth: number;
		workspaceIds: string[];
		sharedFiles: string[];
	}>;
}

/**
 * Simulate file-lock serialization within each topological batch.
 *
 * Workspaces in the same batch that share canEdit files cannot
 * truly run in parallel — the scheduler will serialize them.
 * This simulation computes the lock-constrained effective parallelism
 * and lists which batches will be serialized and why.
 *
 * @param workspaces - All workspace definitions
 * @param batches - Topological batches from DAG analysis
 * @returns Lock-constrained parallelism and serialization details
 */
function simulateBatchFileLocks(
	workspaces: Workspace[],
	batches: { batchIndex: number; workspaceIds: string[]; width: number }[],
): LockSerializationResult {
	const wsMap = new Map(workspaces.map((w) => [w.id, w]));
	const serializedBatches: LockSerializationResult["serializedBatches"] = [];

	// Max effective width across all batches
	let maxEffectiveBatchWidth = 0;

	for (const batch of batches) {
		const batchWorkspaces = batch.workspaceIds.map((id) => wsMap.get(id)).filter(Boolean) as Workspace[];
		if (batchWorkspaces.length <= 1) {
			// Single-workspace batch, no contention possible
			maxEffectiveBatchWidth = Math.max(maxEffectiveBatchWidth, batchWorkspaces.length);
			continue;
		}

		// Build file → workspace ID mapping for canEdit files
		const fileToWorkspaces = new Map<string, string[]>();
		for (const ws of batchWorkspaces) {
			const canEdit = ws.capabilities?.canEdit ?? [];
			for (const file of canEdit) {
				const owners = fileToWorkspaces.get(file) ?? [];
				owners.push(ws.id);
				fileToWorkspaces.set(file, owners);
			}
		}

		// Shared files: files claimed by more than one workspace in this batch
		const sharedFiles = Array.from(fileToWorkspaces.entries())
			.filter(([, ids]) => ids.length > 1)
			.map(([file]) => file);

		if (sharedFiles.length === 0) {
			// No shared locks — all workspaces can run in parallel
			maxEffectiveBatchWidth = Math.max(maxEffectiveBatchWidth, batchWorkspaces.length);
			continue;
		}

		// Build a lock-conflict graph: two workspaces are connected if they
		// share at least one canEdit file. The scheduler will serialize all
		// connected workspaces, so the effective parallelism is the number
		// of connected components.
		const components = stronglyConnectedLockComponents(batchWorkspaces, fileToWorkspaces);
		const effectiveWidth = components.length;

		if (effectiveWidth < batchWorkspaces.length) {
			serializedBatches.push({
				batchIndex: batch.batchIndex,
				dagWidth: batch.width,
				effectiveWidth,
				workspaceIds: batch.workspaceIds,
				sharedFiles,
			});
		}

		maxEffectiveBatchWidth = Math.max(maxEffectiveBatchWidth, effectiveWidth);
	}

	return {
		lockConstrainedParallelism: maxEffectiveBatchWidth,
		serializedBatches,
	};
}

/**
 * Partition workspaces into strongly connected components based on
 * shared file locks. Two workspaces are in the same component if
 * they can reach each other through a chain of shared files.
 */
function stronglyConnectedLockComponents(
	workspaceList: Workspace[],
	fileToWorkspaces: Map<string, string[]>,
): Workspace[][] {
	// Build adjacency: two workspaces connected if they share any file
	const adjacency = new Map<string, Set<string>>();
	for (const ws of workspaceList) {
		adjacency.set(ws.id, new Set());
	}

	for (const [, owners] of fileToWorkspaces) {
		for (let i = 0; i < owners.length; i++) {
			for (let j = i + 1; j < owners.length; j++) {
				adjacency.get(owners[i])?.add(owners[j]);
				adjacency.get(owners[j])?.add(owners[i]);
			}
		}
	}

	// Flood-fill connected components
	const visited = new Set<string>();
	const components: Workspace[][] = [];
	const wsMap = new Map(workspaceList.map((w) => [w.id, w]));

	for (const ws of workspaceList) {
		if (visited.has(ws.id)) continue;
		const component: Workspace[] = [];
		const queue = [ws.id];
		visited.add(ws.id);

		while (queue.length > 0) {
			const current = queue.shift()!;
			const currentWs = wsMap.get(current);
			if (currentWs) component.push(currentWs);

			for (const neighbor of adjacency.get(current) ?? []) {
				if (!visited.has(neighbor)) {
					visited.add(neighbor);
					queue.push(neighbor);
				}
			}
		}

		components.push(component);
	}

	return components;
}
