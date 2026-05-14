/**
 * Execution Archive (Coding-Agent) — P7 Workstream D
 *
 * Thin archive helpers for persisting dry-run forecast artifacts under
 * `.pi/executions/{planExecId}/`.  These are used during `pi plan dry-run`
 * to produce durable forecast artifacts without side effects (no git
 * commits, queue mutations, or repo mutations).
 *
 * Archive layout:
 *   .pi/executions/{planExecId}/
 *     dry-run-report.json         (simulation forecast)
 *     original-plan.md            (copy of the plan file)
 *     parsed-contract.json        (workspace queue)
 *     workspace-dag.json          (DAG from the queue)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SafetyReport } from "./safety-doctor.js";
import type { WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * DAG node in the serialized workspace DAG.
 */
export interface DAGNode {
	id: string;
	dependencies: string[];
}

/**
 * Result of initializing an execution archive.
 */
export interface ArchiveInitResult {
	success: boolean;
	archiveDir: string;
	errors: string[];
}

// ---------------------------------------------------------------------------
// Archive helpers
// ---------------------------------------------------------------------------

/**
 * Initialize an execution archive directory for a plan run.
 *
 * Creates `.pi/executions/{planExecId}/` and its `workspaces/` subdirectory.
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
		return { success: true, archiveDir, errors: [] };
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		errors.push(`Failed to create archive directory: ${msg}`);
		return { success: false, archiveDir, errors };
	}
}

/**
 * Ensure a directory exists.
 *
 * @param dir - Directory path
 */
async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

/**
 * Write the original plan content to the archive.
 *
 * @param workspaceRoot - Root directory of the project workspace
 * @param planExecId - Plan execution ID
 * @param planContent - Original plan content
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
 * Archive the dry-run report (simulation forecast).
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
