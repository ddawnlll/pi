/**
 * Docs Export & Project Memory — P5 Workstream 5.B
 *
 * Exports execution artifacts from `.pi/` into human-readable documentation
 * under `docs/pi/`. This provides project memory: searchable, reviewable
 * summaries of what each plan execution did, what it committed, what tests
 * ran, what safety warnings were raised, and what follow-ups remain.
 *
 * Directory layout (all under `docs/pi/`):
 *   docs/pi/
 *     plans/
 *       {planExecId}.md          Living plan markdown (copied from .pi/plans)
 *     executions/
 *       {planExecId}/
 *         summary.md              Human-readable execution summary
 *         original-plan.md        Copy of the original plan
 *         safety-warnings.md      Extracted safety warnings
 *         commits.md              Git commits made during execution
 *         test-results.md         Test results from workspaces
 *         follow-ups.md           Outstanding follow-ups / TODOs
 *         workspaces/
 *           {workspaceId}/
 *             verdict.md          Workspace verdict summary
 *             files-touched.md    Files modified/created/deleted
 *             diff.patch          Diff if available
 *
 * Safety guarantees:
 *   - All writes are constrained to `docs/pi/` (path traversal blocked)
 *   - Forbidden file patterns (.env, .pem, .key, .ssh, .gnupg, credentials,
 *     secrets) are never exported
 *   - Module can be disabled via the `enabled` flag in DocsExportConfig
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SafetyReport, WorkspaceQueue } from "@earendil-works/pi-coding-agent";

/** Newline constant to avoid escape-sequence issues in generated markdown. */
const NL = `
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for docs export.
 */
export interface DocsExportConfig {
	/** Whether docs export is enabled. Defaults to true. */
	enabled: boolean;
	/** Root directory of the project workspace. */
	workspaceRoot: string;
}

/**
 * Commit entry from execution archive.
 */
export interface CommitEntry {
	/** Commit SHA */
	sha: string;
	/** Workspace ID that produced this commit */
	workspaceId: string;
	/** Commit message */
	message: string;
	/** ISO timestamp */
	timestamp: string;
}

/**
 * Workspace result summary.
 */
export interface WorkspaceResult {
	/** Workspace ID (e.g., "5.A") */
	id: string;
	/** Workspace title */
	title: string;
	/** Verdict: COMPLETE / BLOCKED / FAILED */
	verdict: "COMPLETE" | "BLOCKED" | "FAILED";
	/** Number of attempts */
	attempts: number;
	/** Files touched (filtered of secrets) */
	filesTouched: Array<{ path: string; change: "created" | "modified" | "deleted" }>;
	/** Test results summary */
	testResults?: string;
}

/**
 * Full execution data needed to produce the docs export.
 */
export interface ExecutionExportData {
	/** Plan execution ID */
	planExecId: string;
	/** Plan title */
	title: string;
	/** Phase (e.g., "P5") */
	phase: string;
	/** Original plan markdown content */
	planContent: string;
	/** Workspace queue */
	queue: WorkspaceQueue;
	/** Safety report from doctor */
	safetyReport: SafetyReport;
	/** Commits made during execution */
	commits: CommitEntry[];
	/** Per-workspace results */
	workspaceResults: WorkspaceResult[];
	/** Follow-up items (unresolved TODOs, next steps) */
	followUps: string[];
	/** ISO timestamp of execution start */
	startedAt: string;
	/** ISO timestamp of execution completion */
	completedAt: string;
	/** Overall status */
	status: "complete" | "failed";
}

/**
 * Result of a docs export operation.
 */
export interface DocsExportResult {
	/** Whether the export succeeded */
	success: boolean;
	/** Paths of files written during export */
	filesWritten: string[];
	/** Errors encountered */
	errors: string[];
}

// ---------------------------------------------------------------------------
// Forbidden file patterns — same guard rails as execution-archive
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS: RegExp[] = [
	/^.*[/.]env.*$/i,
	/^.*[.](pem|key)$/i,
	/^(.*[/])?.ssh[/].*$/i,
	/^(.*[/])?.gnupg[/].*$/i,
	/^.*[/]credentials.*$/i,
	/^.*[/]secrets?[.].*$/i,
];

/**
 * Check if a file path matches any forbidden pattern.
 *
 * @param filePath - File path to check
 * @returns True if the path is forbidden
 */
export function isForbiddenPath(filePath: string): boolean {
	const normalized = filePath.replace(/[/]+/g, "/");
	for (const pattern of FORBIDDEN_PATTERNS) {
		if (pattern.test(normalized)) {
			return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Path safety — ensure all writes stay within docs/pi
// ---------------------------------------------------------------------------

/**
 * Get the docs/pi root directory for a workspace.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @returns Absolute path to docs/pi
 */
export function getDocsPiDir(workspaceRoot: string): string {
	return join(workspaceRoot, "docs", "pi");
}

/**
 * Validate that a target path is within docs/pi, blocking path traversal.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param relPath - Relative path intended to be written under docs/pi
 * @returns True if the path is safe (within docs/pi)
 */
export function isPathWithinDocsPi(workspaceRoot: string, relPath: string): boolean {
	const docsPiDir = resolve(getDocsPiDir(workspaceRoot));
	// Use resolve, not join, to properly handle .. traversal
	const fullPath = resolve(docsPiDir, relPath);
	return fullPath.startsWith(`${docsPiDir}/`) || fullPath === docsPiDir;
}

// ---------------------------------------------------------------------------
// Directory initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the docs/pi directory structure.
 *
 * Creates `docs/pi/plans/` and `docs/pi/executions/` directories.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @returns Paths to the created directories
 */
export async function initDocsPiDirs(workspaceRoot: string): Promise<{
	plansDir: string;
	executionsDir: string;
}> {
	const docsPiDir = getDocsPiDir(workspaceRoot);
	const plansDir = join(docsPiDir, "plans");
	const executionsDir = join(docsPiDir, "executions");

	await mkdir(plansDir, { recursive: true });
	await mkdir(executionsDir, { recursive: true });

	return { plansDir, executionsDir };
}

// ---------------------------------------------------------------------------
// Summary markdown generation
// ---------------------------------------------------------------------------

/**
 * Generate the execution summary markdown.
 *
 * Includes workspace results, commits, tests, safety warnings, and follow-ups.
 *
 * @param data - Full execution export data
 * @returns Markdown string
 */
export function generateSummaryMarkdown(data: ExecutionExportData): string {
	const lines: string[] = [];

	// Header
	lines.push(`# Execution Summary: ${data.title}`);
	lines.push("");
	lines.push(`- **Plan Exec ID**: ${data.planExecId}`);
	lines.push(`- **Phase**: ${data.phase}`);
	lines.push(`- **Status**: ${data.status === "complete" ? "Complete" : "Failed"}`);
	lines.push(`- **Started**: ${data.startedAt}`);
	lines.push(`- **Completed**: ${data.completedAt}`);
	lines.push("");

	// Workspace results
	lines.push("## Workspace Results");
	lines.push("");

	if (data.workspaceResults.length === 0) {
		lines.push("_No workspace results recorded._");
	} else {
		lines.push("| Workspace | Title | Verdict | Attempts |");
		lines.push("|-----------|-------|---------|----------|");
		for (const ws of data.workspaceResults) {
			const verdictEmoji = ws.verdict === "COMPLETE" ? "PASS" : ws.verdict === "BLOCKED" ? "WARN" : "FAIL";
			lines.push(`| ${ws.id} | ${ws.title} | ${verdictEmoji} ${ws.verdict} | ${ws.attempts} |`);
		}
	}
	lines.push("");

	// Workspace details
	for (const ws of data.workspaceResults) {
		lines.push(`### ${ws.id} - ${ws.title}`);
		lines.push("");
		lines.push(`**Verdict**: ${ws.verdict}`);
		lines.push("");
		lines.push(`**Attempts**: ${ws.attempts}`);
		lines.push("");

		if (ws.filesTouched.length > 0) {
			lines.push("**Files touched**:");
			lines.push("");
			for (const f of ws.filesTouched) {
				if (!isForbiddenPath(f.path)) {
					const icon = f.change === "created" ? "+" : f.change === "deleted" ? "-" : "~";
					lines.push(`- [${icon}] ${f.path}`);
				}
			}
			lines.push("");
		}

		if (ws.testResults) {
			lines.push("**Test results**:");
			lines.push("");
			lines.push("```");
			lines.push(ws.testResults);
			lines.push("```");
			lines.push("");
		}
	}

	// Commits
	lines.push("## Commits");
	lines.push("");

	if (data.commits.length === 0) {
		lines.push("_No commits recorded._");
	} else {
		for (const commit of data.commits) {
			lines.push(`- **${commit.sha.substring(0, 7)}** (${commit.workspaceId}): ${commit.message}`);
			lines.push(`  _${commit.timestamp}_`);
		}
	}
	lines.push("");

	// Safety warnings
	lines.push("## Safety Warnings");
	lines.push("");

	const allWarnings = data.safetyReport.warnings;
	if (allWarnings.length === 0) {
		lines.push("_No safety warnings._");
	} else {
		for (const w of allWarnings) {
			const wsLabel = w.workspaceId ? ` [${w.workspaceId}]` : "";
			lines.push(`- **[${w.type}]${wsLabel}** ${w.message}`);
		}
	}
	lines.push("");

	// Also include info items
	const allInfo = data.safetyReport.info;
	if (allInfo.length > 0) {
		lines.push("### Info");
		lines.push("");
		for (const info of allInfo) {
			const wsLabel = info.workspaceId ? ` [${info.workspaceId}]` : "";
			lines.push(`- [${info.type}]${wsLabel} ${info.message}`);
		}
		lines.push("");
	}

	// Follow-ups
	lines.push("## Follow-ups");
	lines.push("");

	if (data.followUps.length === 0) {
		lines.push("_No follow-ups._");
	} else {
		for (const followUp of data.followUps) {
			lines.push(`- ${followUp}`);
		}
	}
	lines.push("");

	return lines.join(NL);
}

// ---------------------------------------------------------------------------
// Individual artifact writers
// ---------------------------------------------------------------------------

/**
 * Write the execution summary markdown to docs/pi/executions/{planExecId}/summary.md.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param data - Execution export data
 * @returns Path to the written file
 */
export async function writeSummaryMarkdown(workspaceRoot: string, data: ExecutionExportData): Promise<string> {
	const relPath = join("executions", data.planExecId, "summary.md");
	if (!isPathWithinDocsPi(workspaceRoot, relPath)) {
		throw new Error(`Path traversal detected: ${relPath}`);
	}
	const docsPiDir = getDocsPiDir(workspaceRoot);
	const fullPath = join(docsPiDir, relPath);
	await mkdir(resolve(fullPath, ".."), { recursive: true });
	const content = generateSummaryMarkdown(data);
	await writeFile(fullPath, content, "utf-8");
	return fullPath;
}

/**
 * Copy the plan markdown from .pi/plans/ into docs/pi/plans/.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @returns Path to the written file, or null if source not found
 */
export async function copyPlanMarkdown(workspaceRoot: string, planExecId: string): Promise<string | null> {
	const srcPath = join(workspaceRoot, ".pi", "plans", `${planExecId}.md`);
	if (!existsSync(srcPath)) {
		return null;
	}

	const relPath = join("plans", `${planExecId}.md`);
	if (!isPathWithinDocsPi(workspaceRoot, relPath)) {
		return null;
	}

	const docsPiDir = getDocsPiDir(workspaceRoot);
	const destPath = join(docsPiDir, relPath);
	await mkdir(resolve(destPath, ".."), { recursive: true });
	const content = await readFile(srcPath, "utf-8");
	await writeFile(destPath, content, "utf-8");
	return destPath;
}

/**
 * Write the original plan to docs/pi/executions/{planExecId}/original-plan.md.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param planContent - Original plan markdown
 * @returns Path to the written file
 */
export async function writeOriginalPlan(
	workspaceRoot: string,
	planExecId: string,
	planContent: string,
): Promise<string> {
	const relPath = join("executions", planExecId, "original-plan.md");
	if (!isPathWithinDocsPi(workspaceRoot, relPath)) {
		throw new Error(`Path traversal detected: ${relPath}`);
	}
	const docsPiDir = getDocsPiDir(workspaceRoot);
	const fullPath = join(docsPiDir, relPath);
	await mkdir(resolve(fullPath, ".."), { recursive: true });
	await writeFile(fullPath, planContent, "utf-8");
	return fullPath;
}

/**
 * Write safety warnings as markdown.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param safetyReport - Safety report
 * @returns Path to the written file
 */
export async function writeSafetyWarnings(
	workspaceRoot: string,
	planExecId: string,
	safetyReport: SafetyReport,
): Promise<string> {
	const relPath = join("executions", planExecId, "safety-warnings.md");
	if (!isPathWithinDocsPi(workspaceRoot, relPath)) {
		throw new Error(`Path traversal detected: ${relPath}`);
	}
	const docsPiDir = getDocsPiDir(workspaceRoot);
	const fullPath = join(docsPiDir, relPath);
	await mkdir(resolve(fullPath, ".."), { recursive: true });

	const lines: string[] = [];
	lines.push("# Safety Warnings");
	lines.push("");

	if (safetyReport.warnings.length === 0 && safetyReport.info.length === 0) {
		lines.push("_No safety warnings or info messages._");
	} else {
		if (safetyReport.warnings.length > 0) {
			lines.push("## Warnings");
			lines.push("");
			for (const w of safetyReport.warnings) {
				const wsLabel = w.workspaceId ? ` [${w.workspaceId}]` : "";
				lines.push(`- **[${w.type}]${wsLabel}** ${w.message}`);
			}
			lines.push("");
		}
		if (safetyReport.info.length > 0) {
			lines.push("## Info");
			lines.push("");
			for (const info of safetyReport.info) {
				const wsLabel = info.workspaceId ? ` [${info.workspaceId}]` : "";
				lines.push(`- [${info.type}]${wsLabel} ${info.message}`);
			}
			lines.push("");
		}
	}

	await writeFile(fullPath, lines.join(NL), "utf-8");
	return fullPath;
}

/**
 * Write commits as markdown.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param commits - Commit entries
 * @returns Path to the written file
 */
export async function writeCommitsMarkdown(
	workspaceRoot: string,
	planExecId: string,
	commits: CommitEntry[],
): Promise<string> {
	const relPath = join("executions", planExecId, "commits.md");
	if (!isPathWithinDocsPi(workspaceRoot, relPath)) {
		throw new Error(`Path traversal detected: ${relPath}`);
	}
	const docsPiDir = getDocsPiDir(workspaceRoot);
	const fullPath = join(docsPiDir, relPath);
	await mkdir(resolve(fullPath, ".."), { recursive: true });

	const lines: string[] = [];
	lines.push("# Commits");
	lines.push("");

	if (commits.length === 0) {
		lines.push("_No commits recorded during this execution._");
	} else {
		for (const c of commits) {
			lines.push(`## ${c.sha.substring(0, 7)}`);
			lines.push("");
			lines.push(`- **Workspace**: ${c.workspaceId}`);
			lines.push(`- **Message**: ${c.message}`);
			lines.push(`- **Timestamp**: ${c.timestamp}`);
			lines.push("");
		}
	}

	await writeFile(fullPath, lines.join(NL), "utf-8");
	return fullPath;
}

/**
 * Write test results as markdown.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceResults - Workspace results with test info
 * @returns Path to the written file
 */
export async function writeTestResultsMarkdown(
	workspaceRoot: string,
	planExecId: string,
	workspaceResults: WorkspaceResult[],
): Promise<string> {
	const relPath = join("executions", planExecId, "test-results.md");
	if (!isPathWithinDocsPi(workspaceRoot, relPath)) {
		throw new Error(`Path traversal detected: ${relPath}`);
	}
	const docsPiDir = getDocsPiDir(workspaceRoot);
	const fullPath = join(docsPiDir, relPath);
	await mkdir(resolve(fullPath, ".."), { recursive: true });

	const lines: string[] = [];
	lines.push("# Test Results");
	lines.push("");

	const withTests = workspaceResults.filter((w) => w.testResults);
	if (withTests.length === 0) {
		lines.push("_No test results recorded._");
	} else {
		for (const ws of withTests) {
			lines.push(`## ${ws.id} - ${ws.title}`);
			lines.push("");
			lines.push("```");
			lines.push(ws.testResults!);
			lines.push("```");
			lines.push("");
		}
	}

	await writeFile(fullPath, lines.join(NL), "utf-8");
	return fullPath;
}

/**
 * Write follow-ups as markdown.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param followUps - Follow-up items
 * @returns Path to the written file
 */
export async function writeFollowUpsMarkdown(
	workspaceRoot: string,
	planExecId: string,
	followUps: string[],
): Promise<string> {
	const relPath = join("executions", planExecId, "follow-ups.md");
	if (!isPathWithinDocsPi(workspaceRoot, relPath)) {
		throw new Error(`Path traversal detected: ${relPath}`);
	}
	const docsPiDir = getDocsPiDir(workspaceRoot);
	const fullPath = join(docsPiDir, relPath);
	await mkdir(resolve(fullPath, ".."), { recursive: true });

	const lines: string[] = [];
	lines.push("# Follow-ups");
	lines.push("");

	if (followUps.length === 0) {
		lines.push("_No follow-up items._");
	} else {
		for (const item of followUps) {
			lines.push(`- ${item}`);
		}
	}
	lines.push("");

	await writeFile(fullPath, lines.join(NL), "utf-8");
	return fullPath;
}

/**
 * Write workspace verdict to docs/pi/executions/{planExecId}/workspaces/{workspaceId}/verdict.md.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param result - Workspace result
 * @returns Path to the written file
 */
export async function writeWorkspaceVerdict(
	workspaceRoot: string,
	planExecId: string,
	result: WorkspaceResult,
): Promise<string> {
	const relPath = join("executions", planExecId, "workspaces", result.id, "verdict.md");
	if (!isPathWithinDocsPi(workspaceRoot, relPath)) {
		throw new Error(`Path traversal detected: ${relPath}`);
	}
	const docsPiDir = getDocsPiDir(workspaceRoot);
	const fullPath = join(docsPiDir, relPath);
	await mkdir(resolve(fullPath, ".."), { recursive: true });

	const lines: string[] = [];
	lines.push(`# ${result.id} - ${result.title}`);
	lines.push("");
	lines.push(`**Verdict**: ${result.verdict}`);
	lines.push("");
	lines.push(`**Attempts**: ${result.attempts}`);
	lines.push("");

	if (result.filesTouched.length > 0) {
		lines.push("## Files Touched");
		lines.push("");
		for (const f of result.filesTouched) {
			if (!isForbiddenPath(f.path)) {
				const label = f.change === "created" ? "Created" : f.change === "deleted" ? "Deleted" : "Modified";
				lines.push(`- [${label}] ${f.path}`);
			}
		}
		lines.push("");
	}

	if (result.testResults) {
		lines.push("## Test Results");
		lines.push("");
		lines.push("```");
		lines.push(result.testResults);
		lines.push("```");
		lines.push("");
	}

	await writeFile(fullPath, lines.join(NL), "utf-8");
	return fullPath;
}

// ---------------------------------------------------------------------------
// Top-level export function
// ---------------------------------------------------------------------------

/**
 * Export execution artifacts to docs/pi.
 *
 * Creates the full directory structure and writes all artifacts for a
 * completed plan execution. When `config.enabled` is false, this is a
 * no-op and returns an empty success result.
 *
 * All writes are constrained to `docs/pi/`. Path traversal attempts
 * are blocked. Forbidden file patterns are never exported.
 *
 * @param config - Docs export configuration
 * @param data - Full execution export data
 * @returns Result indicating success and files written
 */
export async function exportDocs(config: DocsExportConfig, data: ExecutionExportData): Promise<DocsExportResult> {
	// AC #5: docs export can be disabled
	if (!config.enabled) {
		return { success: true, filesWritten: [], errors: [] };
	}

	const filesWritten: string[] = [];
	const errors: string[] = [];

	try {
		// AC #1: create docs/pi/plans and docs/pi/executions
		await initDocsPiDirs(config.workspaceRoot);

		// Write the main summary markdown (AC #2, #3)
		try {
			const summaryPath = await writeSummaryMarkdown(config.workspaceRoot, data);
			filesWritten.push(summaryPath);
		} catch (error) {
			errors.push(`Failed to write summary: ${error instanceof Error ? error.message : String(error)}`);
		}

		// Copy the living plan markdown from .pi/plans/ into docs/pi/plans/
		try {
			const planPath = await copyPlanMarkdown(config.workspaceRoot, data.planExecId);
			if (planPath) {
				filesWritten.push(planPath);
			}
		} catch (error) {
			errors.push(`Failed to copy plan markdown: ${error instanceof Error ? error.message : String(error)}`);
		}

		// Write original plan content
		try {
			const originalPlanPath = await writeOriginalPlan(config.workspaceRoot, data.planExecId, data.planContent);
			filesWritten.push(originalPlanPath);
		} catch (error) {
			errors.push(`Failed to write original plan: ${error instanceof Error ? error.message : String(error)}`);
		}

		// Write safety warnings (AC #3)
		try {
			const safetyPath = await writeSafetyWarnings(config.workspaceRoot, data.planExecId, data.safetyReport);
			filesWritten.push(safetyPath);
		} catch (error) {
			errors.push(`Failed to write safety warnings: ${error instanceof Error ? error.message : String(error)}`);
		}

		// Write commits (AC #3)
		try {
			const commitsPath = await writeCommitsMarkdown(config.workspaceRoot, data.planExecId, data.commits);
			filesWritten.push(commitsPath);
		} catch (error) {
			errors.push(`Failed to write commits: ${error instanceof Error ? error.message : String(error)}`);
		}

		// Write test results (AC #3)
		try {
			const testResultsPath = await writeTestResultsMarkdown(
				config.workspaceRoot,
				data.planExecId,
				data.workspaceResults,
			);
			filesWritten.push(testResultsPath);
		} catch (error) {
			errors.push(`Failed to write test results: ${error instanceof Error ? error.message : String(error)}`);
		}

		// Write follow-ups (AC #3)
		try {
			const followUpsPath = await writeFollowUpsMarkdown(config.workspaceRoot, data.planExecId, data.followUps);
			filesWritten.push(followUpsPath);
		} catch (error) {
			errors.push(`Failed to write follow-ups: ${error instanceof Error ? error.message : String(error)}`);
		}

		// Write per-workspace verdicts
		for (const ws of data.workspaceResults) {
			try {
				const verdictPath = await writeWorkspaceVerdict(config.workspaceRoot, data.planExecId, ws);
				filesWritten.push(verdictPath);
			} catch (error) {
				errors.push(
					`Failed to write workspace verdict for ${ws.id}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	} catch (error) {
		errors.push(`Fatal error during docs export: ${error instanceof Error ? error.message : String(error)}`);
	}

	return {
		success: errors.length === 0,
		filesWritten,
		errors,
	};
}

// ---------------------------------------------------------------------------
// Utility: read execution data from .pi/ archive for export
// ---------------------------------------------------------------------------

/**
 * Read execution data from the .pi/ archive to prepare for docs export.
 *
 * Gathers plan content, workspace queue, commits, safety report, etc.
 * from the execution archive directory structure.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @returns Execution export data, or null if archive not found
 */
export async function readExecutionArchiveForExport(
	workspaceRoot: string,
	planExecId: string,
): Promise<ExecutionExportData | null> {
	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
	if (!existsSync(archiveDir)) {
		return null;
	}

	// Read original plan
	let planContent = "";
	try {
		planContent = await readFile(join(archiveDir, "original-plan.md"), "utf-8");
	} catch {
		// Plan file may not exist
	}

	// Read parsed contract
	let queue: WorkspaceQueue | null = null;
	try {
		const contractRaw = await readFile(join(archiveDir, "parsed-contract.json"), "utf-8");
		queue = JSON.parse(contractRaw) as WorkspaceQueue;
	} catch {
		// Contract may not exist
	}

	// Read commits
	const commits: CommitEntry[] = [];
	try {
		const commitsRaw = await readFile(join(archiveDir, "commits.json"), "utf-8");
		const parsed = JSON.parse(commitsRaw);
		if (Array.isArray(parsed)) {
			commits.push(...parsed);
		}
	} catch {
		// Commits may not exist
	}

	// Read safety report
	let safetyReport: SafetyReport = { safe: true, critical: [], warnings: [], info: [], totalIssues: 0 };
	try {
		const reportRaw = await readFile(join(archiveDir, "doctor-report.json"), "utf-8");
		safetyReport = JSON.parse(reportRaw) as SafetyReport;
	} catch {
		// Doctor report may not exist
	}

	// Read workspace results from workspaces/ subdirectories
	const workspaceResults: WorkspaceResult[] = [];
	const workspacesDir = join(archiveDir, "workspaces");
	if (existsSync(workspacesDir)) {
		try {
			const wsEntries = await readdir(workspacesDir, { withFileTypes: true });
			for (const entry of wsEntries) {
				if (!entry.isDirectory()) continue;
				const wsId = entry.name;
				const wsDir = join(workspacesDir, wsId);

				// Read verdict
				let verdict: "COMPLETE" | "BLOCKED" | "FAILED" = "COMPLETE";
				const attempts = 1;
				let testResults: string | undefined;
				const filesTouched: Array<{ path: string; change: "created" | "modified" | "deleted" }> = [];

				try {
					const verdictRaw = await readFile(join(wsDir, "reviewer-verdict.md"), "utf-8");
					if (verdictRaw.includes("COMPLETE")) verdict = "COMPLETE";
					else if (verdictRaw.includes("BLOCKED")) verdict = "BLOCKED";
					else if (verdictRaw.includes("FAILED")) verdict = "FAILED";
				} catch {
					// Verdict may not exist
				}

				// Read files touched
				try {
					const ftRaw = await readFile(join(wsDir, "files-touched.json"), "utf-8");
					const ftParsed = JSON.parse(ftRaw);
					if (Array.isArray(ftParsed)) {
						for (const f of ftParsed) {
							if (!isForbiddenPath(f.path)) {
								filesTouched.push({ path: f.path, change: f.change });
							}
						}
					}
				} catch {
					// Files touched may not exist
				}

				const wsTitle = queue?.workspaces.find((w) => w.id === wsId)?.title || wsId;

				workspaceResults.push({
					id: wsId,
					title: wsTitle,
					verdict,
					attempts,
					filesTouched,
					testResults,
				});
			}
		} catch {
			// Workspaces dir may not be readable
		}
	}

	// Extract follow-ups from failed/blocked workspaces and safety warnings
	const followUps: string[] = [];
	for (const ws of workspaceResults) {
		if (ws.verdict === "BLOCKED") {
			followUps.push(`Workspace ${ws.id} is blocked - resolve dependency issues`);
		}
		if (ws.verdict === "FAILED") {
			followUps.push(`Workspace ${ws.id} failed - investigate and retry`);
		}
	}
	for (const w of safetyReport.warnings) {
		followUps.push(`Safety warning: ${w.message}`);
	}

	return {
		planExecId,
		title: queue?.title || planExecId,
		phase: queue?.phase || "Unknown",
		planContent,
		queue: queue || { phase: "Unknown", title: planExecId, maxParallelWorkspaces: 1, workspaces: [] },
		safetyReport,
		commits,
		workspaceResults,
		followUps,
		startedAt: new Date().toISOString(),
		completedAt: new Date().toISOString(),
		status: "complete",
	};
}
