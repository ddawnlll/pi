/**
 * Execution Archive / Plan Vault — P5 Workstream 5.A
 *
 * Creates a durable execution archive for every plan run under
 * `.pi/executions/{planExecId}/`, containing all plan, contract,
 * safety, workspace, log, diff, test, and summary artifacts.
 *
 * Archive layout:
 *   .pi/executions/{planExecId}/
 *     original-plan.md
 *     parsed-contract.json
 *     doctor-report.json
 *     dry-run-report.json    (when available)
 *     workspace-dag.json
 *     safety-policy.json
 *     commits.json
 *     workspaces/
 *       {workspaceId}/
 *         packet.md
 *         raw.log
 *         structured.ndjson
 *         tool-calls.ndjson
 *         events.ndjson
 *         decisions.ndjson
 *         narrative.ndjson
 *         audit.ndjson
 *         files-touched.json
 *         test-results/
 *         reviewer-verdict.md
 *         diff.patch          (when available)
 */

import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { SafetyReport, WorkspaceQueue } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Artifact to be written as part of the plan-level archive.
 */
export interface PlanArchiveArtifact {
	/** Relative filename within the execution directory (e.g. "original-plan.md") */
	name: string;
	/** Content to write */
	content: string;
}

/**
 * Artifact to be written as part of a workspace-level archive.
 */
export interface WorkspaceArchiveArtifact {
	/** Relative filename within the workspace directory (e.g. "packet.md") */
	name: string;
	/** Content to write (for file writes) */
	content?: string;
	/** Lines to append (for ndjson / log files) */
	appendLines?: string[];
}

/**
 * Commit entry stored in commits.json.
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
 * DAG node representing a workspace in the workspace DAG.
 */
export interface DAGNode {
	/** Workspace ID */
	id: string;
	/** Workspace IDs this workspace depends on */
	dependencies: string[];
}

/**
 * Safety policy snapshot stored in safety-policy.json.
 */
export interface SafetyPolicySnapshot {
	/** Safety profile name (strict / balanced / full_auto) */
	profile: string;
	/** Whether git push is allowed (always false in P5) */
	allowGitPush: boolean;
	/** Whether destructive commands are allowed (always false in P5) */
	allowDestructiveCommands: boolean;
	/** Whether auto-commit is allowed */
	allowAutoCommit: boolean;
	/** Whether dependency install is allowed */
	allowDependencyInstall: boolean;
	/** Whether queue auto-run is allowed */
	allowQueueAutoRun: boolean;
	/** Timestamp of when this policy was captured */
	capturedAt: string;
}

/**
 * Files touched entry for a workspace.
 */
export interface FilesTouchedEntry {
	/** File path relative to workspace root */
	path: string;
	/** Type of change */
	change: "created" | "modified" | "deleted";
}

/**
 * Reviewer verdict for a workspace.
 */
export interface ReviewerVerdict {
	/** Workspace ID */
	workspaceId: string;
	/** Verdict: COMPLETE / BLOCKED / FAILED */
	verdict: "COMPLETE" | "BLOCKED" | "FAILED";
	/** Summary */
	summary: string;
	/** ISO timestamp */
	timestamp: string;
}

/**
 * Result of initializing an execution archive.
 */
export interface ArchiveInitResult {
	/** Whether initialization succeeded */
	success: boolean;
	/** Path to the execution archive root */
	archiveDir: string;
	/** Errors encountered during initialization */
	errors: string[];
}

// ---------------------------------------------------------------------------
// Forbidden file patterns — the archive writer must never copy these
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS: RegExp[] = [
	/^.*[/.]env.*$/i, // .env, .env.bak, .env.local, etc.
	/^.*[.](pem|key)$/i, // *.pem, *.key
	/^(.*[/])?.ssh[/].*$/i, // .ssh directory (with or without leading path)
	/^(.*[/])?.gnupg[/].*$/i, // .gnupg directory (with or without leading path)
	/^.*[/]credentials.*$/i, // credentials files
	/^.*[/]secrets?[.].*$/i, // secret/secret files
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
// Core archive operations
// ---------------------------------------------------------------------------

/**
 * Initialize an execution archive directory for a plan run.
 *
 * Creates `.pi/executions/{planExecId}/` and its `workspaces/` subdirectory.
 * This should be called at plan start, before any workspaces execute.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @returns Result indicating success and the archive directory path
 */
export async function initExecutionArchive(workspaceRoot: string, planExecId: string): Promise<ArchiveInitResult> {
	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
	const errors: string[] = [];

	try {
		await mkdir(archiveDir, { recursive: true });
		await mkdir(join(archiveDir, "workspaces"), { recursive: true });
		return { success: true, archiveDir, errors: [] };
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		errors.push(`Failed to create archive directory: ${msg}`);
		return { success: false, archiveDir, errors };
	}
}

/**
 * Write the original plan content to the archive.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param planContent - Original plan markdown content
 */
export async function archiveOriginalPlan(
	workspaceRoot: string,
	planExecId: string,
	planContent: string,
): Promise<void> {
	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
	await ensureDir(archiveDir);
	await writeFile(join(archiveDir, "original-plan.md"), planContent, "utf-8");
}

/**
 * Archive the parsed contract (workspace queue) as JSON.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param queue - Parsed workspace queue
 */
export async function archiveParsedContract(
	workspaceRoot: string,
	planExecId: string,
	queue: WorkspaceQueue,
): Promise<void> {
	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
	await ensureDir(archiveDir);
	await writeFile(join(archiveDir, "parsed-contract.json"), JSON.stringify(queue, null, 2), "utf-8");
}

/**
 * Archive the safety doctor report.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param report - Safety doctor report
 */
export async function archiveDoctorReport(
	workspaceRoot: string,
	planExecId: string,
	report: SafetyReport,
): Promise<void> {
	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
	await ensureDir(archiveDir);
	await writeFile(join(archiveDir, "doctor-report.json"), JSON.stringify(report, null, 2), "utf-8");
}

/**
 * Archive the dry-run report, when available.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param dryRunReport - Dry-run report data (any serializable structure)
 */
export async function archiveDryRunReport(
	workspaceRoot: string,
	planExecId: string,
	dryRunReport: unknown,
): Promise<void> {
	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
	await ensureDir(archiveDir);
	await writeFile(join(archiveDir, "dry-run-report.json"), JSON.stringify(dryRunReport, null, 2), "utf-8");
}

/**
 * Archive the workspace DAG extracted from the parsed contract.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param queue - Parsed workspace queue (DAG is derived from workspaces + dependencies)
 */
export async function archiveWorkspaceDAG(
	workspaceRoot: string,
	planExecId: string,
	queue: WorkspaceQueue,
): Promise<void> {
	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
	await ensureDir(archiveDir);

	const dag: DAGNode[] = queue.workspaces.map((ws) => ({
		id: ws.id,
		dependencies: [...ws.dependencies],
	}));

	await writeFile(join(archiveDir, "workspace-dag.json"), JSON.stringify(dag, null, 2), "utf-8");
}

/**
 * Archive the safety policy snapshot.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param policy - Safety policy snapshot
 */
export async function archiveSafetyPolicy(
	workspaceRoot: string,
	planExecId: string,
	policy: SafetyPolicySnapshot,
): Promise<void> {
	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
	await ensureDir(archiveDir);
	await writeFile(join(archiveDir, "safety-policy.json"), JSON.stringify(policy, null, 2), "utf-8");
}

/**
 * Archive the commit map produced during execution.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param commits - Array of commit entries
 */
export async function archiveCommitMap(
	workspaceRoot: string,
	planExecId: string,
	commits: CommitEntry[],
): Promise<void> {
	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
	await ensureDir(archiveDir);
	await writeFile(join(archiveDir, "commits.json"), JSON.stringify(commits, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Workspace-level archive operations
// ---------------------------------------------------------------------------

/**
 * Initialize a workspace archive directory.
 *
 * Creates `.pi/executions/{planExecId}/workspaces/{workspaceId}/`
 * and any necessary subdirectories.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID (e.g., "5.A")
 * @returns Path to the workspace archive directory
 */
export async function initWorkspaceArchive(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
): Promise<string> {
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await mkdir(wsDir, { recursive: true });
	await mkdir(join(wsDir, "test-results"), { recursive: true });
	return wsDir;
}

/**
 * Archive the workspace packet (context/briefing given to the agent).
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param packetContent - Packet markdown content
 */
export async function archiveWorkspacePacket(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	packetContent: string,
): Promise<void> {
	if (isForbiddenPath(packetContent)) return;
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await ensureDir(wsDir);
	await writeFile(join(wsDir, "packet.md"), packetContent, "utf-8");
}

/**
 * Append a tool call event to the workspace's tool-calls.ndjson.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param event - Tool call event (will be JSON-serialized)
 */
export async function appendToolCallEvent(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	event: unknown,
): Promise<void> {
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await ensureDir(wsDir);
	await appendFile(join(wsDir, "tool-calls.ndjson"), `${JSON.stringify(event)}\n`, "utf-8");
}

/**
 * Append an event to the workspace's events.ndjson.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param event - Event data (will be JSON-serialized)
 */
export async function appendWorkspaceEvent(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	event: unknown,
): Promise<void> {
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await ensureDir(wsDir);
	await appendFile(join(wsDir, "events.ndjson"), `${JSON.stringify(event)}\n`, "utf-8");
}

/**
 * Append a decision entry to the workspace's decisions.ndjson.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param decision - Decision data (will be JSON-serialized)
 */
export async function appendDecision(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	decision: unknown,
): Promise<void> {
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await ensureDir(wsDir);
	await appendFile(join(wsDir, "decisions.ndjson"), `${JSON.stringify(decision)}\n`, "utf-8");
}

/**
 * Append an audit entry to the workspace's audit.ndjson.
 *
 * Audit entries record control actions, safety changes, queue reorder
 * events, and other significant operational actions.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param entry - Audit entry data (will be JSON-serialized)
 */
export async function appendAuditEntry(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	entry: unknown,
): Promise<void> {
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await ensureDir(wsDir);
	await appendFile(join(wsDir, "audit.ndjson"), `${JSON.stringify(entry)}\n`, "utf-8");
}

/**
 * Append a narrative entry to the workspace's narrative.ndjson.
 *
 * Narrative entries provide human-readable summaries of worker activity,
 * including completion summaries and progress reports.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param entry - Narrative entry data (will be JSON-serialized)
 */
export async function appendNarrativeEntry(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	entry: unknown,
): Promise<void> {
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await ensureDir(wsDir);
	await appendFile(join(wsDir, "narrative.ndjson"), `${JSON.stringify(entry)}\n`, "utf-8");
}

/**
 * Append a structured log entry to the workspace's structured.ndjson.
 *
 * Structured entries contain JSON-formatted log data with typed categories.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param entry - Structured log entry data (will be JSON-serialized)
 */
export async function appendStructuredEntry(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	entry: unknown,
): Promise<void> {
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await ensureDir(wsDir);
	await appendFile(join(wsDir, "structured.ndjson"), `${JSON.stringify(entry)}\n`, "utf-8");
}

/**
 * Append a raw text line to the workspace's raw.log.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param line - Raw text line
 */
export async function appendRawLogLine(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	line: string,
): Promise<void> {
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await ensureDir(wsDir);
	await appendFile(join(wsDir, "raw.log"), `${line}\n`, "utf-8");
}

/**
 * Archive the list of files touched by a workspace.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param filesTouched - Array of file change entries
 */
export async function archiveFilesTouched(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	filesTouched: FilesTouchedEntry[],
): Promise<void> {
	// Filter out any forbidden file paths before archiving
	const safe = filesTouched.filter((entry) => !isForbiddenPath(entry.path));
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await ensureDir(wsDir);
	await writeFile(join(wsDir, "files-touched.json"), JSON.stringify(safe, null, 2), "utf-8");
}

/**
 * Archive the reviewer verdict for a workspace.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param verdict - Reviewer verdict object
 */
export async function archiveReviewerVerdict(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	verdict: ReviewerVerdict,
): Promise<void> {
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await ensureDir(wsDir);
	const lines = [
		`# Workspace ${verdict.workspaceId} - Verdict: ${verdict.verdict}`,
		"",
		verdict.summary,
		"",
		`_Resolved at ${verdict.timestamp}_`,
		"",
	];
	await writeFile(join(wsDir, "reviewer-verdict.md"), lines.join("\n"), "utf-8");
}

/**
 * Archive the diff patch for a workspace, when available.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param workspaceId - Workspace ID
 * @param diffPatch - Unified diff patch content
 */
export async function archiveDiffPatch(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	diffPatch: string,
): Promise<void> {
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	await ensureDir(wsDir);
	await writeFile(join(wsDir, "diff.patch"), diffPatch, "utf-8");
}

// ---------------------------------------------------------------------------
// Read/archive helpers
// ---------------------------------------------------------------------------

/**
 * List all execution archive directories under .pi/executions/.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @returns Array of planExecIds that have archive directories
 */
export async function listExecutionArchives(workspaceRoot: string): Promise<string[]> {
	const execDir = join(workspaceRoot, ".pi", "executions");
	if (!existsSync(execDir)) {
		return [];
	}
	try {
		const entries = await readdir(execDir, { withFileTypes: true });
		return entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return [];
	}
}

/**
 * List all workspace archive directories for an execution.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @returns Array of workspace IDs with archive directories
 */
export async function listWorkspaceArchives(workspaceRoot: string, planExecId: string): Promise<string[]> {
	const wsDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces");
	if (!existsSync(wsDir)) {
		return [];
	}
	try {
		const entries = await readdir(wsDir, { withFileTypes: true });
		return entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return [];
	}
}

/**
 * Read an artifact from the execution archive.
 *
 * Ensures forbidden paths are never read through the archive system.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param artifactPath - Relative path within the execution directory
 * @returns File content as string, or null if not found or forbidden
 */
export async function readArchiveArtifact(
	workspaceRoot: string,
	planExecId: string,
	artifactPath: string,
): Promise<string | null> {
	// Never read forbidden files
	if (isForbiddenPath(artifactPath)) {
		return null;
	}

	// Prevent path traversal: the artifact path must not escape the archive dir
	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
	const fullPath = join(archiveDir, artifactPath);

	// Verify the resolved path is still within the archive
	const fullResolved = resolve(fullPath);
	const archiveResolved = resolve(archiveDir);
	if (!fullResolved.startsWith(`${archiveResolved}/`) && fullResolved !== archiveResolved) {
		return null;
	}

	try {
		return await readFile(fullPath, "utf-8");
	} catch {
		return null;
	}
}

/**
 * Copy a file into the archive, ensuring the source is not a forbidden file.
 *
 * This is the safe copy operation used when archiving files from the
 * workspace into the execution archive. It rejects any source file
 * that matches forbidden patterns.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param destRelPath - Destination relative path within the archive
 * @param sourcePath - Absolute source file path to copy from
 */
export async function copyFileToArchive(
	workspaceRoot: string,
	planExecId: string,
	destRelPath: string,
	sourcePath: string,
): Promise<void> {
	// Reject forbidden source paths
	if (isForbiddenPath(sourcePath)) {
		return;
	}
	// Reject forbidden destination paths
	if (isForbiddenPath(destRelPath)) {
		return;
	}

	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId);
	const destPath = join(archiveDir, destRelPath);

	// Verify no path traversal
	const destResolved = resolve(destPath);
	const archiveResolved = resolve(archiveDir);
	if (!destResolved.startsWith(`${archiveResolved}/`) && destResolved !== archiveResolved) {
		return;
	}

	try {
		const content = await readFile(sourcePath, "utf-8");
		await ensureDir(dirname(destPath));
		await writeFile(destPath, content, "utf-8");
	} catch {
		// Source doesn't exist or is unreadable -- skip silently
	}
}

// ---------------------------------------------------------------------------
// Convenience: archive plan-level artifacts in one call
// ---------------------------------------------------------------------------

/**
 * Archive all plan-level artifacts at once.
 *
 * Convenience function that writes original plan, parsed contract,
 * doctor report, workspace DAG, and safety policy in a single call.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param params - All plan-level archive data
 */
export async function archivePlanArtifacts(
	workspaceRoot: string,
	planExecId: string,
	params: {
		planContent: string;
		queue: WorkspaceQueue;
		doctorReport: SafetyReport;
		dryRunReport?: unknown;
		safetyPolicy: SafetyPolicySnapshot;
	},
): Promise<void> {
	await initExecutionArchive(workspaceRoot, planExecId);
	await archiveOriginalPlan(workspaceRoot, planExecId, params.planContent);
	await archiveParsedContract(workspaceRoot, planExecId, params.queue);
	await archiveDoctorReport(workspaceRoot, planExecId, params.doctorReport);
	await archiveWorkspaceDAG(workspaceRoot, planExecId, params.queue);
	await archiveSafetyPolicy(workspaceRoot, planExecId, params.safetyPolicy);
	if (params.dryRunReport !== undefined) {
		await archiveDryRunReport(workspaceRoot, planExecId, params.dryRunReport);
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a directory exists (recursive mkdir).
 */
async function ensureDir(dir: string): Promise<void> {
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
	}
}
