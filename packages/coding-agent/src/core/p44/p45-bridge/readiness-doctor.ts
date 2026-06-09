/**
 * P45 Bridge — Assembler-Only Candidate Discovery and Readiness Doctor
 *
 * Assesses whether a set of workspaces are ready for P45 bridge (assembler-only)
 * execution. A workspace is "assembler-only" when it is configured with
 * `p45Bridge.implementationAllowed: false`, meaning it can only read/assemble
 * existing code but cannot implement (write/modify) files.
 *
 * The doctor performs two phases:
 * 1. Candidate Discovery — finds workspaces configured for P45 bridge execution
 * 2. Readiness Assessment — runs checks on each candidate to determine if it
 *    is properly configured and ready for execution
 *
 * Contract Schema: 4.1.1
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";
import type { PlanSpecP45Bridge } from "../../planspec-v5-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for the P45 readiness report.
 */
export const P45_READINESS_SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Severity level for a readiness check result.
 */
export type ReadinessSeverity = "pass" | "warn" | "fail" | "error";

/**
 * A single readiness check result.
 */
export interface ReadinessCheck {
	/** Unique check identifier */
	id: string;
	/** Human-readable check name */
	name: string;
	/** Check severity */
	severity: ReadinessSeverity;
	/** Human-readable message */
	message: string;
	/** Optional detailed explanation */
	details?: string;
	/** Optional recommendation to fix the issue */
	recommendation?: string;
}

/**
 * Summary of a single workspace readiness assessment.
 */
export interface WorkspaceReadinessEntry {
	/** Workspace identifier */
	workspaceId: string;
	/** Workspace title */
	title: string;
	/** Overall readiness verdict for this workspace */
	verdict: "ready" | "not_ready" | "not_applicable";
	/** Individual readiness checks */
	checks: ReadinessCheck[];
}

/**
 * Full P45 bridge readiness report.
 */
export interface P45ReadinessReport {
	/** Report identifier */
	reportId: string;
	/** Schema version */
	schemaVersion: string;
	/** When the assessment was performed (epoch ms) */
	timestamp: number;
	/** Overall readiness verdict */
	overallVerdict: "ready" | "not_ready" | "no_candidates";
	/** Per-workspace readiness entries */
	workspaces: WorkspaceReadinessEntry[];
	/** Summary counts */
	summary: {
		totalWorkspaces: number;
		candidatesFound: number;
		readyCount: number;
		notReadyCount: number;
		notApplicableCount: number;
		passChecks: number;
		warnChecks: number;
		failChecks: number;
		errorChecks: number;
	};
}

// ---------------------------------------------------------------------------
// Check IDs
// ---------------------------------------------------------------------------

export const CHECKS = {
	BRIDGE_CONFIGURED: "P45-CHECK-001",
	ALLOWED_FILES_SPECIFIED: "P45-CHECK-002",
	FORBIDDEN_PATHS_SPECIFIED: "P45-CHECK-003",
	ALLOWED_FILES_EXIST: "P45-CHECK-004",
	ALLOWED_FORBIDDEN_NO_OVERLAP: "P45-CHECK-005",
	IMPLEMENTATION_DISABLED: "P45-CHECK-006",
	WRITE_SCOPE_RESTRICTED: "P45-CHECK-007",
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a path matches any of the given glob-like forbidden patterns.
 * Supports simple wildcard patterns (e.g., "node_modules/**", "*.secret").
 */
function matchesForbiddenPattern(filePath: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		// Convert glob-like pattern to regex
		const regexStr = pattern
			.replace(/\./g, "\\.")
			.replace(/\*\*/g, "___DOUBLESTAR___")
			.replace(/\*/g, "[^/]*")
			.replace(/___DOUBLESTAR___/g, ".*");
		try {
			const re = new RegExp(`^${regexStr}$`);
			if (re.test(filePath)) {
				return true;
			}
		} catch {
			// If pattern is invalid, check exact match
			if (filePath === pattern) {
				return true;
			}
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// P45 Readiness Doctor
// ---------------------------------------------------------------------------

/**
 * Configuration options for the P45 Readiness Doctor.
 */
export interface P45ReadinessDoctorOptions {
	/** Project root directory for resolving file existence checks */
	projectRoot?: string;
	/** Whether to skip file existence checks (useful in CI without full checkout) */
	skipFileExistenceChecks?: boolean;
	/** Custom label for the report */
	reportLabel?: string;
}

/**
 * A workspace candidate descriptor provided to the doctor.
 * This mirrors the relevant fields from PlanSpecWorkspace.
 */
export interface P45WorkspaceCandidate {
	id: string;
	title: string;
	p45Bridge?: PlanSpecP45Bridge;
	allowedFiles?: string[];
	forbiddenFiles?: string[];
	writeSet?: string[];
	readSet?: string[];
}

/**
 * P45 Bridge Readiness Doctor.
 *
 * Discovers assembler-only workspace candidates and assesses their readiness
 * for P45 bridge execution.
 */
export class P45ReadinessDoctor {
	private options: Required<P45ReadinessDoctorOptions>;

	constructor(options?: P45ReadinessDoctorOptions) {
		this.options = {
			projectRoot: options?.projectRoot ?? process.cwd(),
			skipFileExistenceChecks: options?.skipFileExistenceChecks ?? false,
			reportLabel: options?.reportLabel ?? "P45 Bridge Readiness Assessment",
		};
	}

	/**
	 * Run the full readiness assessment on a set of workspace candidates.
	 *
	 * @param workspaces - Set of workspace candidates to assess
	 * @returns Complete readiness report
	 */
	assess(workspaces: P45WorkspaceCandidate[]): P45ReadinessReport {
		const candidates = this.discoverCandidates(workspaces);
		const entries: WorkspaceReadinessEntry[] = [];

		for (const workspace of workspaces) {
			const isCandidate = candidates.some((c) => c.id === workspace.id);
			if (isCandidate) {
				entries.push(this.assessWorkspace(workspace));
			} else {
				entries.push({
					workspaceId: workspace.id,
					title: workspace.title,
					verdict: "not_applicable",
					checks: [
						{
							id: CHECKS.BRIDGE_CONFIGURED,
							name: "P45 Bridge Configured",
							severity: "pass",
							message: "Workspace is not configured for P45 bridge execution — skipped",
						},
					],
				});
			}
		}

		const readyCount = entries.filter((e) => e.verdict === "ready").length;
		const notReadyCount = entries.filter((e) => e.verdict === "not_ready").length;
		const notApplicableCount = entries.filter((e) => e.verdict === "not_applicable").length;

		let passChecks = 0;
		let warnChecks = 0;
		let failChecks = 0;
		let errorChecks = 0;
		for (const entry of entries) {
			for (const check of entry.checks) {
				switch (check.severity) {
					case "pass":
						passChecks++;
						break;
					case "warn":
						warnChecks++;
						break;
					case "fail":
						failChecks++;
						break;
					case "error":
						errorChecks++;
						break;
				}
			}
		}

		let overallVerdict: P45ReadinessReport["overallVerdict"];
		if (candidates.length === 0) {
			overallVerdict = "no_candidates";
		} else if (notReadyCount > 0) {
			overallVerdict = "not_ready";
		} else {
			overallVerdict = "ready";
		}

		return {
			reportId: `P45-READINESS-${Date.now()}`,
			schemaVersion: P45_READINESS_SCHEMA_VERSION,
			timestamp: Date.now(),
			overallVerdict,
			workspaces: entries,
			summary: {
				totalWorkspaces: workspaces.length,
				candidatesFound: candidates.length,
				readyCount,
				notReadyCount,
				notApplicableCount,
				passChecks,
				warnChecks,
				failChecks,
				errorChecks,
			},
		};
	}

	/**
	 * Discover P45 bridge candidates from a set of workspaces.
	 * Candidates are workspaces that have p45Bridge configured.
	 *
	 * @param workspaces - Workspace candidates to evaluate
	 * @returns Workspaces that are P45 bridge candidates
	 */
	discoverCandidates(workspaces: P45WorkspaceCandidate[]): P45WorkspaceCandidate[] {
		return workspaces.filter((ws) => ws.p45Bridge !== undefined);
	}

	/**
	 * Assess a single workspace's readiness for P45 bridge execution.
	 *
	 * @param workspace - Workspace candidate to assess
	 * @returns Readiness entry with individual check results
	 */
	private assessWorkspace(workspace: P45WorkspaceCandidate): WorkspaceReadinessEntry {
		const checks: ReadinessCheck[] = [];
		const bridge = workspace.p45Bridge;

		// ------------------------------------------------------------------
		// Check 1: P45 bridge is configured
		// ------------------------------------------------------------------
		if (!bridge) {
			return {
				workspaceId: workspace.id,
				title: workspace.title,
				verdict: "not_applicable",
				checks: [
					{
						id: CHECKS.BRIDGE_CONFIGURED,
						name: "P45 Bridge Configured",
						severity: "pass",
						message: "No P45 bridge configuration found — workspace is not an assembler-only candidate",
					},
				],
			};
		}

		// ------------------------------------------------------------------
		// Check 2: implementationAllowed must be false
		// ------------------------------------------------------------------
		if (bridge.implementationAllowed !== false) {
			checks.push({
				id: CHECKS.IMPLEMENTATION_DISABLED,
				name: "Implementation Disabled",
				severity: "fail",
				message: `implementationAllowed is not set to false; P45 bridge requires implementationAllowed: false`,
				recommendation: "Set p45Bridge.implementationAllowed to false in the workspace plan-spec configuration",
			});
		} else {
			checks.push({
				id: CHECKS.IMPLEMENTATION_DISABLED,
				name: "Implementation Disabled",
				severity: "pass",
				message: "implementationAllowed is correctly set to false",
			});
		}

		// ------------------------------------------------------------------
		// Check 3: Allowed files are specified
		// ------------------------------------------------------------------
		const allowedFiles = bridge.allowedFiles ?? workspace.allowedFiles ?? [];
		if (allowedFiles.length === 0) {
			checks.push({
				id: CHECKS.ALLOWED_FILES_SPECIFIED,
				name: "Allowed Files Specified",
				severity: "fail",
				message: "No allowed files specified; assembler-only workspaces must declare which files they can access",
				recommendation:
					"Add allowedFiles to the p45Bridge configuration listing the files the workspace may read/assemble",
			});
		} else {
			checks.push({
				id: CHECKS.ALLOWED_FILES_SPECIFIED,
				name: "Allowed Files Specified",
				severity: "pass",
				message: `${allowedFiles.length} allowed file(s) specified`,
				details: allowedFiles.join(", "),
			});
		}

		// ------------------------------------------------------------------
		// Check 4: Forbidden paths are specified
		// ------------------------------------------------------------------
		const forbiddenPaths = bridge.forbiddenPaths ?? workspace.forbiddenFiles ?? [];
		if (forbiddenPaths.length === 0) {
			checks.push({
				id: CHECKS.FORBIDDEN_PATHS_SPECIFIED,
				name: "Forbidden Paths Specified",
				severity: "warn",
				message: "No forbidden paths specified; recommended for additional safety in assembler-only mode",
				recommendation:
					"Consider adding forbiddenPaths to prevent access to sensitive directories (e.g., node_modules, .env)",
			});
		} else {
			checks.push({
				id: CHECKS.FORBIDDEN_PATHS_SPECIFIED,
				name: "Forbidden Paths Specified",
				severity: "pass",
				message: `${forbiddenPaths.length} forbidden path pattern(s) specified`,
				details: forbiddenPaths.join(", "),
			});
		}

		// ------------------------------------------------------------------
		// Check 5: Allowed files exist on disk (if not skipped)
		// ------------------------------------------------------------------
		if (!this.options.skipFileExistenceChecks && allowedFiles.length > 0) {
			const missingFiles: string[] = [];
			for (const file of allowedFiles) {
				const resolvedPath = resolve(this.options.projectRoot, file);
				try {
					statSync(resolvedPath);
				} catch {
					missingFiles.push(file);
				}
			}
			if (missingFiles.length > 0) {
				checks.push({
					id: CHECKS.ALLOWED_FILES_EXIST,
					name: "Allowed Files Exist on Disk",
					severity: "fail",
					message: `${missingFiles.length} allowed file(s) do not exist on disk`,
					details: missingFiles.join(", "),
					recommendation: "Verify the allowedFiles paths are correct relative to the project root",
				});
			} else {
				checks.push({
					id: CHECKS.ALLOWED_FILES_EXIST,
					name: "Allowed Files Exist on Disk",
					severity: "pass",
					message: `All ${allowedFiles.length} allowed file(s) exist on disk`,
				});
			}
		} else if (this.options.skipFileExistenceChecks) {
			checks.push({
				id: CHECKS.ALLOWED_FILES_EXIST,
				name: "Allowed Files Exist on Disk",
				severity: "pass",
				message: "File existence check skipped per configuration",
			});
		}

		// ------------------------------------------------------------------
		// Check 6: No overlap between allowed files and forbidden paths
		// ------------------------------------------------------------------
		if (allowedFiles.length > 0 && forbiddenPaths.length > 0) {
			const overlappingFiles = allowedFiles.filter((f) => matchesForbiddenPattern(f, forbiddenPaths));
			if (overlappingFiles.length > 0) {
				checks.push({
					id: CHECKS.ALLOWED_FORBIDDEN_NO_OVERLAP,
					name: "Allowed/Forbidden Path Overlap",
					severity: "fail",
					message: `${overlappingFiles.length} allowed file(s) match forbidden path patterns`,
					details: overlappingFiles.join(", "),
					recommendation:
						"Remove overlapping entries from allowedFiles or adjust forbiddenPaths to resolve conflicts",
				});
			} else {
				checks.push({
					id: CHECKS.ALLOWED_FORBIDDEN_NO_OVERLAP,
					name: "Allowed/Forbidden Path Overlap",
					severity: "pass",
					message: "No overlap between allowed files and forbidden paths",
				});
			}
		} else {
			checks.push({
				id: CHECKS.ALLOWED_FORBIDDEN_NO_OVERLAP,
				name: "Allowed/Forbidden Path Overlap",
				severity: "pass",
				message: "No overlap check needed (allowed files or forbidden paths empty)",
			});
		}

		// ------------------------------------------------------------------
		// Check 7: Write scope is restricted (P45 bridge workspaces should not write)
		// ------------------------------------------------------------------
		const writeSet = workspace.writeSet ?? [];
		if (writeSet.length > 0) {
			checks.push({
				id: CHECKS.WRITE_SCOPE_RESTRICTED,
				name: "Write Scope Restricted",
				severity: "warn",
				message: `Workspace has ${writeSet.length} write-scope file(s) defined; assembler-only workspaces should not write files`,
				details: writeSet.join(", "),
				recommendation:
					"Remove writeSet entries for assembler-only workspaces, or ensure the write scope is explicitly needed for the assembly task",
			});
		} else {
			checks.push({
				id: CHECKS.WRITE_SCOPE_RESTRICTED,
				name: "Write Scope Restricted",
				severity: "pass",
				message: "No write scope defined — appropriate for assembler-only operation",
			});
		}

		// ------------------------------------------------------------------
		// Determine workspace verdict
		// ------------------------------------------------------------------
		const failCount = checks.filter((c) => c.severity === "fail" || c.severity === "error").length;
		const verdict = failCount > 0 ? "not_ready" : "ready";

		return {
			workspaceId: workspace.id,
			title: workspace.title,
			verdict,
			checks,
		};
	}
}

// ---------------------------------------------------------------------------
// Report Formatting
// ---------------------------------------------------------------------------

/**
 * Format a P45 readiness report as a human-readable Markdown string.
 *
 * @param report - The readiness report to format
 * @returns Markdown-formatted report string
 */
export function formatP45ReadinessReport(report: P45ReadinessReport): string {
	const lines: string[] = [];

	lines.push("# P45 Bridge Readiness Report");
	lines.push("");
	lines.push(`**Report ID:** ${report.reportId}`);
	lines.push(`**Schema Version:** ${report.schemaVersion}`);
	lines.push(`**Timestamp:** ${new Date(report.timestamp).toISOString()}`);
	lines.push(`**Overall Verdict:** ${formatVerdictBadge(report.overallVerdict)}`);
	lines.push("");
	lines.push("## Summary");
	lines.push("");
	lines.push(`| Metric | Value |`);
	lines.push(`|--------|-------|`);
	lines.push(`| Total Workspaces | ${report.summary.totalWorkspaces} |`);
	lines.push(`| P45 Bridge Candidates Found | ${report.summary.candidatesFound} |`);
	lines.push(`| Ready | ${report.summary.readyCount} |`);
	lines.push(`| Not Ready | ${report.summary.notReadyCount} |`);
	lines.push(`| Not Applicable | ${report.summary.notApplicableCount} |`);
	lines.push(`| Pass Checks | ${report.summary.passChecks} |`);
	lines.push(`| Warning Checks | ${report.summary.warnChecks} |`);
	lines.push(`| Failed Checks | ${report.summary.failChecks} |`);
	lines.push(`| Error Checks | ${report.summary.errorChecks} |`);
	lines.push("");

	for (const entry of report.workspaces) {
		lines.push(`## Workspace: ${entry.workspaceId} — ${entry.title}`);
		lines.push("");
		lines.push(`**Verdict:** ${formatVerdictBadge(entry.verdict)}`);
		lines.push("");
		lines.push("### Checks");
		lines.push("");
		lines.push("| ID | Check | Severity | Message |");
		lines.push("|----|-------|----------|---------|");
		for (const check of entry.checks) {
			const severityLabel = formatSeverityLabel(check.severity);
			lines.push(`| ${check.id} | ${check.name} | ${severityLabel} | ${check.message} |`);
		}
		lines.push("");

		// Detailed sections for failing/warning checks
		const hasDetails = entry.checks.some((c) => c.details || c.recommendation);
		if (hasDetails) {
			lines.push("### Details & Recommendations");
			lines.push("");
			for (const check of entry.checks) {
				if (check.details || check.recommendation) {
					lines.push(`#### ${check.id}: ${check.name}`);
					lines.push("");
					if (check.details) {
						lines.push(`**Details:** ${check.details}`);
						lines.push("");
					}
					if (check.recommendation) {
						lines.push(`**Recommendation:** ${check.recommendation}`);
						lines.push("");
					}
				}
			}
		}
	}

	return lines.join("\n");
}

/**
 * Format a severity level as a badge-like label.
 */
function formatSeverityLabel(severity: ReadinessSeverity): string {
	switch (severity) {
		case "pass":
			return "PASS";
		case "warn":
			return "WARN";
		case "fail":
			return "FAIL";
		case "error":
			return "ERROR";
	}
}

/**
 * Format a verdict as a badge-like label.
 */
function formatVerdictBadge(
	verdict: P45ReadinessReport["overallVerdict"] | WorkspaceReadinessEntry["verdict"],
): string {
	switch (verdict) {
		case "ready":
			return "READY";
		case "not_ready":
			return "NOT_READY";
		case "not_applicable":
			return "N/A";
		case "no_candidates":
			return "NO_CANDIDATES";
	}
}

/**
 * Create an empty P45 readiness report with no workspaces assessed.
 *
 * @returns An empty readiness report
 */
export function createEmptyP45ReadinessReport(): P45ReadinessReport {
	return {
		reportId: `P45-READINESS-${Date.now()}`,
		schemaVersion: P45_READINESS_SCHEMA_VERSION,
		timestamp: Date.now(),
		overallVerdict: "no_candidates",
		workspaces: [],
		summary: {
			totalWorkspaces: 0,
			candidatesFound: 0,
			readyCount: 0,
			notReadyCount: 0,
			notApplicableCount: 0,
			passChecks: 0,
			warnChecks: 0,
			failChecks: 0,
			errorChecks: 0,
		},
	};
}
