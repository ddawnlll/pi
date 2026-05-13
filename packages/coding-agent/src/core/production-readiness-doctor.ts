/**
 * Production Readiness Doctor - Workstream 5.I
 *
 * Validates a workspace queue for production readiness before auto-run.
 * Performs comprehensive checks across safety, skill availability,
 * file scope hygiene, and git working-tree cleanliness.
 *
 * Checks:
 *   1. SafetyDoctor criticals - FAIL
 *   2. Missing required skills - FAIL
 *   3. Broad file scopes (catch-all wildcard patterns) - WARN
 *   4. Dirty git working tree - FAIL (blocks queue auto-run readiness)
 *
 * The doctor report is archived as doctor-report.json in the
 * execution archive and rendered in the dashboard.
 */

import { execSync } from "node:child_process";
import { SafetyDoctor, type SafetyIssue } from "./safety-doctor.js";
import { SkillRegistry } from "./skill-registry.js";
import type { WorkspaceCapabilityManifest, WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Overall production readiness verdict.
 */
export type ProductionReadinessVerdict = "PASS" | "WARN" | "FAIL";

/**
 * Category of a production readiness check.
 */
export type ProductionReadinessCategory = "safety" | "skills" | "file_scope" | "git_tree" | "schema";

/**
 * A single production readiness check result.
 */
export interface ProductionReadinessCheck {
	/** Unique check name */
	name: string;
	/** Category this check belongs to */
	category: ProductionReadinessCategory;
	/** PASS / WARN / FAIL */
	status: ProductionReadinessVerdict;
	/** Human-readable summary */
	message: string;
	/** Optional additional details */
	details?: string;
	/** Workspace ID this check relates to (if applicable) */
	workspaceId?: string;
}

/**
 * Full production readiness doctor report.
 */
export interface ProductionReadinessReport {
	/** Overall verdict: PASS if no FAILs, WARN if no FAIL but at least one WARN, FAIL otherwise */
	verdict: ProductionReadinessVerdict;
	/** All individual checks */
	checks: ProductionReadinessCheck[];
	/** Quick-access grouped by category */
	byCategory: Record<ProductionReadinessCategory, ProductionReadinessCheck[]>;
	/** Count of PASS checks */
	passCount: number;
	/** Count of WARN checks */
	warnCount: number;
	/** Count of FAIL checks */
	failCount: number;
	/** Whether the queue is ready for auto-run (PASS or WARN with no dirty-tree FAIL) */
	autoRunReady: boolean;
	/** Timestamp (ISO 8601) */
	timestamp: string;
}

// ---------------------------------------------------------------------------
// Broad-scope patterns
// ---------------------------------------------------------------------------

/**
 * Patterns considered "broad" (too permissive for production).
 * A workspace that can edit catch-all patterns
 * risks cross-workspace file conflicts in parallel execution.
 */
const BROAD_SCOPE_PATTERNS: RegExp[] = [
	/^[*]*$/, // "*" or "**"
	/^[*]+[/][*]*$/, // "*/" catch-all etc.
	/^[.]?[*]+$/, // ".*"  (hidden files wildcard)
	/^[/]?[*]+$/, // "/*"
];

/**
 * Determine whether a file-scope pattern is "broad" (overly permissive).
 *
 * @param pattern - Glob pattern from canEdit / canRun
 * @returns True if the pattern is considered broad
 */
export function isBroadScope(pattern: string): boolean {
	const trimmed = pattern.trim();
	if (trimmed === "") return false;
	for (const re of BROAD_SCOPE_PATTERNS) {
		if (re.test(trimmed)) return true;
	}
	// Also flag patterns that are root catch-all
	if (trimmed === "." || trimmed === "./" || trimmed === "/") return true;
	return false;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the git working tree has uncommitted changes.
 *
 * @param cwd - Working directory (repository root)
 * @returns True if there are uncommitted changes, false if clean or not a git repo
 */
export function isGitDirty(cwd: string): boolean {
	try {
		const result = execSync("git status --porcelain", {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 5000,
		});
		return result.trim().length > 0;
	} catch {
		// Not a git repo or git not available - treat as clean
		return false;
	}
}

/**
 * Check whether the directory is inside a git repository.
 *
 * @param cwd - Working directory
 * @returns True if inside a git repo
 */
export function isGitRepo(cwd: string): boolean {
	try {
		execSync("git rev-parse --is-inside-work-tree", {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 5000,
		});
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Production Readiness Doctor
// ---------------------------------------------------------------------------

/**
 * Production Readiness Doctor
 *
 * Validates a workspace queue is ready for production auto-run.
 * Checks safety, skills, file scopes, and git working-tree cleanliness.
 */
export class ProductionReadinessDoctor {
	private safetyDoctor: SafetyDoctor;

	constructor() {
		this.safetyDoctor = new SafetyDoctor();
	}

	/**
	 * Run all production readiness checks against a workspace queue.
	 *
	 * @param queue - Workspace queue to validate
	 * @param cwd - Project root working directory
	 * @param agentDir - Agent configuration directory
	 * @param options - Optional overrides
	 * @param options.skillPaths - Additional skill paths to search
	 * @param options.includeDefaultSkills - Whether to include default skill directories (default true)
	 * @param options.skipGitCheck - Skip the git dirty-tree check (useful in CI)
	 * @returns Full production readiness report
	 */
	run(
		queue: WorkspaceQueue,
		cwd: string,
		agentDir: string,
		options?: {
			skillPaths?: string[];
			includeDefaultSkills?: boolean;
			skipGitCheck?: boolean;
		},
	): ProductionReadinessReport {
		const checks: ProductionReadinessCheck[] = [];

		// 1. Safety checks
		checks.push(...this.checkSafety(queue));

		// 2. Skill availability
		checks.push(...this.checkSkills(cwd, agentDir, options));

		// 3. File scope hygiene
		checks.push(...this.checkFileScopes(queue));

		// 4. Git working-tree cleanliness
		if (!options?.skipGitCheck) {
			checks.push(...this.checkGitTree(cwd));
		}

		// 5. Schema / structure sanity
		checks.push(...this.checkSchema(queue));

		return this.buildReport(checks);
	}

	/**
	 * Run safety checks by delegating to SafetyDoctor.
	 *
	 * Critical safety issues map to FAIL, warnings to WARN,
	 * and an overall-clean safety state to PASS.
	 *
	 * @param queue - Workspace queue
	 * @returns Production readiness checks from safety validation
	 */
	checkSafety(queue: WorkspaceQueue): ProductionReadinessCheck[] {
		const checks: ProductionReadinessCheck[] = [];

		const report = this.safetyDoctor.validateQueue(queue);

		if (report.critical.length > 0) {
			checks.push({
				name: "Safety Critical Issues",
				category: "safety",
				status: "FAIL",
				message: `${report.critical.length} critical safety issue(s) found`,
				details: report.critical.map((i: SafetyIssue) => `[${i.type}] ${i.message}`).join("; "),
			});
		} else {
			checks.push({
				name: "Safety Critical Issues",
				category: "safety",
				status: "PASS",
				message: "No critical safety issues",
			});
		}

		if (report.warnings.length > 0) {
			checks.push({
				name: "Safety Warnings",
				category: "safety",
				status: "WARN",
				message: `${report.warnings.length} safety warning(s) found`,
				details: report.warnings.map((i: SafetyIssue) => `[${i.type}] ${i.message}`).join("; "),
			});
		} else {
			checks.push({
				name: "Safety Warnings",
				category: "safety",
				status: "PASS",
				message: "No safety warnings",
			});
		}

		return checks;
	}

	/**
	 * Check that all required skills are available.
	 *
	 * Missing required skills produce a FAIL since the queue
	 * cannot be executed without them.
	 *
	 * @param cwd - Working directory
	 * @param agentDir - Agent config directory
	 * @param options - Skill loading options
	 * @returns Production readiness checks for skill availability
	 */
	checkSkills(
		cwd: string,
		agentDir: string,
		options?: { skillPaths?: string[]; includeDefaultSkills?: boolean },
	): ProductionReadinessCheck[] {
		const checks: ProductionReadinessCheck[] = [];

		try {
			const registry = new SkillRegistry(cwd, agentDir);
			const validation = registry.validate({
				skillPaths: options?.skillPaths,
				includeDefaults: options?.includeDefaultSkills ?? true,
			});

			if (validation.missingRequired.length > 0) {
				const names = validation.missingRequired.map((m) => `"${m.entry.name}"`).join(", ");
				checks.push({
					name: "Required Skills Available",
					category: "skills",
					status: "FAIL",
					message: `${validation.missingRequired.length} required skill(s) missing: ${names}`,
					details: validation.missingRequired.map((m) => m.reason).join("; "),
				});
			} else {
				checks.push({
					name: "Required Skills Available",
					category: "skills",
					status: "PASS",
					message: "All required skills are available",
				});
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			checks.push({
				name: "Required Skills Available",
				category: "skills",
				status: "FAIL",
				message: `Skill registry error: ${msg}`,
			});
		}

		return checks;
	}

	/**
	 * Check file scopes for broad/overly-permissive patterns.
	 *
	 * Workspaces that declare canEdit catch-all patterns
	 * risk cross-workspace file conflicts in parallel execution.
	 * These produce WARN (not FAIL) since they may be intentional.
	 *
	 * @param queue - Workspace queue
	 * @returns Production readiness checks for file scope hygiene
	 */
	checkFileScopes(queue: WorkspaceQueue): ProductionReadinessCheck[] {
		const checks: ProductionReadinessCheck[] = [];
		const broadScopes: Array<{ workspaceId: string; patterns: string[] }> = [];

		for (const workspace of queue.workspaces) {
			if (!workspace.capabilities) continue;

			const broad = this.findBroadPatterns(workspace.id, workspace.capabilities);
			if (broad.length > 0) {
				broadScopes.push({ workspaceId: workspace.id, patterns: broad });
			}
		}

		if (broadScopes.length > 0) {
			const details = broadScopes.map((b) => `${b.workspaceId}: ${b.patterns.join(", ")}`).join("; ");
			checks.push({
				name: "File Scope Hygiene",
				category: "file_scope",
				status: "WARN",
				message: `${broadScopes.length} workspace(s) have broad file scopes`,
				details: `Broad patterns found: ${details}`,
			});
		} else {
			checks.push({
				name: "File Scope Hygiene",
				category: "file_scope",
				status: "PASS",
				message: "All file scopes are appropriately scoped",
			});
		}

		return checks;
	}

	/**
	 * Check git working-tree cleanliness.
	 *
	 * A dirty working tree (uncommitted changes) FAILs queue
	 * auto-run readiness because auto-run may auto-commit and
	 * the uncommitted changes could conflict or be lost.
	 *
	 * @param cwd - Project root directory
	 * @returns Production readiness check for git tree status
	 */
	checkGitTree(cwd: string): ProductionReadinessCheck[] {
		const checks: ProductionReadinessCheck[] = [];

		if (!isGitRepo(cwd)) {
			checks.push({
				name: "Git Working Tree",
				category: "git_tree",
				status: "PASS",
				message: "Not a git repository - tree check skipped",
			});
			return checks;
		}

		if (isGitDirty(cwd)) {
			checks.push({
				name: "Git Working Tree",
				category: "git_tree",
				status: "FAIL",
				message: "Dirty working tree - uncommitted changes detected",
				details:
					"Auto-run cannot safely proceed with uncommitted changes. " +
					"Commit or stash your changes before running the queue.",
			});
		} else {
			checks.push({
				name: "Git Working Tree",
				category: "git_tree",
				status: "PASS",
				message: "Working tree is clean",
			});
		}

		return checks;
	}

	/**
	 * Basic schema/structure sanity checks for the queue.
	 *
	 * Checks:
	 * - Every workspace has a title
	 * - Every workspace has at least one acceptance criterion (WARN if missing)
	 *
	 * @param queue - Workspace queue
	 * @returns Production readiness checks for schema validity
	 */
	checkSchema(queue: WorkspaceQueue): ProductionReadinessCheck[] {
		const checks: ProductionReadinessCheck[] = [];

		// Workspace title presence
		const missingTitles = queue.workspaces.filter((w) => !w.title || w.title.trim() === "");
		if (missingTitles.length > 0) {
			const ids = missingTitles.map((w) => w.id).join(", ");
			checks.push({
				name: "Workspace Titles",
				category: "schema",
				status: "FAIL",
				message: `${missingTitles.length} workspace(s) missing title: ${ids}`,
			});
		} else {
			checks.push({
				name: "Workspace Titles",
				category: "schema",
				status: "PASS",
				message: "All workspaces have titles",
			});
		}

		// Acceptance criteria presence
		const missingCriteria = queue.workspaces.filter(
			(w) => !w.acceptanceCriteria || w.acceptanceCriteria.length === 0,
		);
		if (missingCriteria.length > 0) {
			const ids = missingCriteria.map((w) => w.id).join(", ");
			checks.push({
				name: "Acceptance Criteria",
				category: "schema",
				status: "WARN",
				message: `${missingCriteria.length} workspace(s) lack acceptance criteria: ${ids}`,
				details: "Acceptance criteria help validate workspace completion",
			});
		} else {
			checks.push({
				name: "Acceptance Criteria",
				category: "schema",
				status: "PASS",
				message: "All workspaces have acceptance criteria",
			});
		}

		return checks;
	}

	/**
	 * Build the final report from all checks.
	 *
	 * @param checks - All production readiness checks
	 * @returns Complete production readiness report
	 */
	private buildReport(checks: ProductionReadinessCheck[]): ProductionReadinessReport {
		const passCount = checks.filter((c) => c.status === "PASS").length;
		const warnCount = checks.filter((c) => c.status === "WARN").length;
		const failCount = checks.filter((c) => c.status === "FAIL").length;

		// Overall verdict
		let verdict: ProductionReadinessVerdict;
		if (failCount > 0) {
			verdict = "FAIL";
		} else if (warnCount > 0) {
			verdict = "WARN";
		} else {
			verdict = "PASS";
		}

		// Group by category
		const categories: ProductionReadinessCategory[] = ["safety", "skills", "file_scope", "git_tree", "schema"];
		const byCategory = {} as Record<ProductionReadinessCategory, ProductionReadinessCheck[]>;
		for (const cat of categories) {
			byCategory[cat] = checks.filter((c) => c.category === cat);
		}

		// Auto-run readiness: PASS or WARN overall, AND no dirty-tree FAIL
		const hasDirtyTreeFail = checks.some((c) => c.category === "git_tree" && c.status === "FAIL");
		const autoRunReady = verdict !== "FAIL" && !hasDirtyTreeFail;

		return {
			verdict,
			checks,
			byCategory,
			passCount,
			warnCount,
			failCount,
			autoRunReady,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Find broad patterns in a workspace's capabilities.
	 *
	 * @param _workspaceId - Workspace ID (for logging)
	 * @param capabilities - Workspace capability manifest
	 * @returns Array of broad pattern strings
	 */
	private findBroadPatterns(_workspaceId: string, capabilities: WorkspaceCapabilityManifest): string[] {
		const broad: string[] = [];
		for (const pattern of capabilities.canEdit) {
			if (isBroadScope(pattern)) {
				broad.push(pattern);
			}
		}
		return broad;
	}
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a production readiness report for CLI / human-readable output.
 *
 * @param report - The report to format
 * @returns Multi-line formatted string
 */
export function formatProductionReadinessReport(report: ProductionReadinessReport): string {
	const lines: string[] = [];

	lines.push("=== Production Readiness Doctor ===");
	lines.push("");

	// Overall verdict
	const verdictIcon = report.verdict === "PASS" ? "PASS" : report.verdict === "WARN" ? "WARN" : "FAIL";
	lines.push(`Verdict: ${verdictIcon}`);
	lines.push(`  Passed: ${report.passCount} | Warnings: ${report.warnCount} | Failed: ${report.failCount}`);
	lines.push(`  Auto-run ready: ${report.autoRunReady ? "YES" : "NO"}`);
	lines.push("");

	// Checks by category
	for (const [category, categoryChecks] of Object.entries(report.byCategory)) {
		if (categoryChecks.length === 0) continue;

		lines.push(`${category.toUpperCase().replace(/_/g, " ")}:`);
		for (const check of categoryChecks) {
			const icon = check.status === "PASS" ? "[PASS]" : check.status === "WARN" ? "[WARN]" : "[FAIL]";
			lines.push(`  ${icon} ${check.name}: ${check.message}`);
			if (check.details) {
				lines.push(`     ${check.details}`);
			}
		}
		lines.push("");
	}

	// Recommendations
	if (report.failCount > 0) {
		lines.push("RECOMMENDATIONS:");
		lines.push("  - Fix all FAIL issues before running the queue in production");
		if (!report.autoRunReady) {
			lines.push("  - Auto-run is blocked - resolve issues above to enable it");
		}
		lines.push("");
	} else if (report.warnCount > 0) {
		lines.push("RECOMMENDATIONS:");
		lines.push("  - Review WARN issues before running the queue in production");
		lines.push("");
	}

	return lines.join("      ");
}

/**
 * Create a ProductionReadinessDoctor instance.
 *
 * @returns A new production readiness doctor
 */
export function createProductionReadinessDoctor(): ProductionReadinessDoctor {
	return new ProductionReadinessDoctor();
}
