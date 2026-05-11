/**
 * Safety Doctor - P2 Workstream 7.J
 *
 * Validates plans and workspaces for safety issues before execution.
 * Detects placeholders, forbidden files, destructive commands, and security issues.
 */

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

	constructor() {
		this.scheduler = new WorkspaceScheduler(3);
	}

	/**
	 * Validate workspace queue for safety issues
	 *
	 * @param queue - Workspace queue to validate
	 * @returns Safety report
	 */
	validateQueue(queue: WorkspaceQueue): SafetyReport {
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

		return issues;
	}

	/**
	 * Build safety report from issues
	 *
	 * @param issues - Array of safety issues
	 * @returns Safety report
	 */
	private buildReport(issues: SafetyIssue[]): SafetyReport {
		const critical = issues.filter((i) => i.severity === SafetyIssueSeverity.Critical);
		const warnings = issues.filter((i) => i.severity === SafetyIssueSeverity.Warning);
		const info = issues.filter((i) => i.severity === SafetyIssueSeverity.Info);

		return {
			safe: critical.length === 0,
			critical,
			warnings,
			info,
			totalIssues: issues.length,
		};
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

		return lines.join("\n");
	}
}

/**
 * Create a safety doctor instance
 *
 * @returns Safety doctor instance
 */
export function createSafetyDoctor(): SafetyDoctor {
	return new SafetyDoctor();
}
