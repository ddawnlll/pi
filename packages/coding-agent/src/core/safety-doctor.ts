/**
 * Safety Doctor - P2 Workstream 7.J
 *
 * Validates plans and workspaces for safety issues before execution.
 * Detects placeholders, forbidden files, destructive commands, and security issues.
 */

import { computeBatchPlan } from "./dag-analyzer.js";
import { ExecutionSimulator } from "./execution-simulator.js";
import type { RetryPolicy } from "./retry-handler.js";
import { checkCommand, getEffectivePermissions, type SafetyProfileName } from "./safety-profile.js";
import { SkillRegistry } from "./skill-registry.js";
import { validateWorkerConcurrency, type WorkerConcurrencySettings } from "./worker-concurrency.js";
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
	/** Effective parallelism (max width across topological batches) */
	effectiveParallelism: number;
	/** Critical path length (number of topological batches) */
	criticalPathLength: number;
	/** Number of consecutive single-width batches at the end */
	serializedTailLength: number;
	/** Requested parallelism (from queue maxParallelWorkspaces) */
	requestedParallelism: number;
	/** Delta between requested and effective parallelism */
	parallelismDelta: number;
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
	 * Build safety report from issues
	 *
	 * @param issues - Array of safety issues
	 * @returns Safety report
	 */
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
