#!/usr/bin/env node
/**
 * JSON -> PostgreSQL Migration Tool
 *
 * Reads project/execution data from .pi/ directory and migrates to PostgreSQL.
 * Creates a timestamped backup of .pi/ before migration and verifies integrity afterward.
 *
 * Usage:
 *   node dist/migrate-from-json.js <workspace-root> [--dry-run] [--force]
 *
 * Options:
 *   --dry-run      Preview what would be migrated without writing
 *   --force        Skip confirmation prompts
 *   --skip-backup  Skip creating .pi backup
 */

import { createHash, randomUUID } from "node:crypto";
import { access, cp, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { argv, exit, stdin, stdout } from "node:process";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlanStateFile {
	title: string;
	phase: string;
	status: "running" | "paused" | "stopped" | "completed" | "failed";
	elapsed: number;
	queue: {
		pending: number;
		active: number;
		blocked: number;
		complete: number;
		failed: number;
	};
	workers: Array<{
		id: string;
		stage: string;
		attempt: number;
		retries: number;
		snapshotPath?: string;
		reportPath?: string;
	}>;
	startedAt?: string;
}

interface ProjectEntry {
	id: string;
	name: string;
	description: string | null;
	rootPath: string | null;
	createdAt: string;
}

interface ExecutionEntry {
	id: string;
	projectId: string;
	phase: string;
	title: string;
	status: string;
	startedAt: string;
	completedAt: string | null;
}

interface MigrationResult {
	projectId: string | null;
	projectName: string | null;
	executionId: string | null;
	workspacesMigrated: number;
	journalEventsMigrated: number;
	backupPath: string | null;
	checksum: string;
	errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function genId(): string {
	return randomUUID();
}

function nowISO(): string {
	return new Date().toISOString();
}

function sha256(content: string): string {
	return createHash("sha256").update(content, "utf-8").digest("hex");
}

async function promptConfirm(message: string): Promise<boolean> {
	const rl = createInterface({ input: stdin, output: stdout });
	return new Promise((resolve) => {
		rl.question(`${message} (y/N) `, (answer: string) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

async function createBackup(piDir: string): Promise<string> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backupDir = join(dirname(piDir), `.pi-backup-${timestamp}`);

	console.log(`[migrate] Creating backup: ${backupDir}`);

	await cp(piDir, backupDir, { recursive: true });

	const manifest = {
		createdAt: nowISO(),
		sourceDir: piDir,
		files: await listFiles(piDir),
	};
	await writeFile(join(backupDir, "backup-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

	console.log(`[migrate] Backup created at ${backupDir}`);
	return backupDir;
}

async function listFiles(dir: string): Promise<string[]> {
	const files: string[] = [];
	async function walk(d: string) {
		try {
			const entries = await readdir(d, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = join(d, entry.name);
				if (entry.isDirectory()) {
					await walk(fullPath);
				} else {
					files.push(relative(dir, fullPath));
				}
			}
		} catch {
			// Directory may not exist
		}
	}
	await walk(dir);
	return files;
}

// ---------------------------------------------------------------------------
// Read JSON state
// ---------------------------------------------------------------------------

async function readJsonFile<T>(filePath: string): Promise<T | null> {
	try {
		const content = await readFile(filePath, "utf-8");
		return JSON.parse(content) as T;
	} catch (error: unknown) {
		const err = error as { code?: string };
		if (err.code === "ENOENT") {
			return null;
		}
		console.warn(`[migrate] Warning: Could not read ${filePath}:`, error);
		return null;
	}
}

async function readNdJsonFile(filePath: string): Promise<string[]> {
	try {
		const content = await readFile(filePath, "utf-8");
		return content.trim().split("\n").filter(Boolean);
	} catch (error: unknown) {
		const err = error as { code?: string };
		if (err.code === "ENOENT") {
			return [];
		}
		console.warn(`[migrate] Warning: Could not read ${filePath}:`, error);
		return [];
	}
}

// ---------------------------------------------------------------------------
// Migration logic
// ---------------------------------------------------------------------------

async function migrateFromJson(
	workspaceRoot: string,
	dryRun: boolean,
	skipBackup: boolean,
	skipConfirm: boolean,
): Promise<MigrationResult> {
	const piDir = join(workspaceRoot, ".pi");
	const result: MigrationResult = {
		projectId: null,
		projectName: null,
		executionId: null,
		workspacesMigrated: 0,
		journalEventsMigrated: 0,
		backupPath: null,
		checksum: "",
		errors: [],
	};

	console.log(`[migrate] Scanning .pi directory: ${piDir}`);

	// Create backup (unless skipped)
	if (!skipBackup) {
		try {
			result.backupPath = await createBackup(piDir);
		} catch (error) {
			const msg = `Failed to create backup: ${error}`;
			console.error(`[migrate] ${msg}`);
			result.errors.push(msg);
			if (!skipConfirm) {
				const proceed = await promptConfirm("Backup failed. Continue without backup?");
				if (!proceed) {
					console.log("[migrate] Aborted by user");
					exit(1);
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Read projects.json
	// -----------------------------------------------------------------------
	const projectsPath = join(piDir, "projects.json");
	const projects = (await readJsonFile<ProjectEntry[]>(projectsPath)) ?? [];

	// Create a default project if none exist
	if (projects.length === 0) {
		const defaultProject: ProjectEntry = {
			id: `project-${genId()}`,
			name: basename(workspaceRoot),
			description: "Migrated from JSON state",
			rootPath: workspaceRoot,
			createdAt: nowISO(),
		};
		projects.push(defaultProject);
		console.log(`[migrate] Created default project: ${defaultProject.name}`);
	}

	result.projectId = projects[0].id;
	result.projectName = projects[0].name;

	// -----------------------------------------------------------------------
	// Read plan-state.json (current execution)
	// -----------------------------------------------------------------------
	const planStatePath = join(piDir, "plan-state.json");
	const planState = await readJsonFile<PlanStateFile>(planStatePath);

	// -----------------------------------------------------------------------
	// Read executions.json (execution tracking)
	// -----------------------------------------------------------------------
	const executionsPath = join(piDir, "executions.json");
	const executions = (await readJsonFile<ExecutionEntry[]>(executionsPath)) ?? [];

	// -----------------------------------------------------------------------
	// Read execution-journal.ndjson
	// -----------------------------------------------------------------------
	const journalPath = join(piDir, "execution-journal.ndjson");
	const journalLines = await readNdJsonFile(journalPath);

	// -----------------------------------------------------------------------
	// Read current-execution.json
	// -----------------------------------------------------------------------
	const currentExecPath = join(piDir, "current-execution.json");
	const currentExec = await readJsonFile<{ planExecutionId: string }>(currentExecPath);

	// -----------------------------------------------------------------------
	// Summary
	// -----------------------------------------------------------------------
	console.log("\n[migrate] === Migration Summary ===");
	console.log(`[migrate]   Projects:        ${projects.length}`);
	console.log(`[migrate]   Plan state:      ${planState ? "present" : "none"}`);
	console.log(`[migrate]   Execution tracking entries: ${executions.length}`);
	console.log(`[migrate]   Journal events:  ${journalLines.length}`);
	console.log(`[migrate]   Workers:         ${planState?.workers.length ?? 0}`);

	// Compute checksum over the raw data
	const dataToChecksum = JSON.stringify({
		projects,
		planState,
		executions,
		journalLines,
	});
	result.checksum = sha256(dataToChecksum);

	if (dryRun) {
		console.log("\n[migrate] DRY RUN -- no data written");
		console.log(`[migrate] Checksum: ${result.checksum}`);
		return result;
	}

	if (!skipConfirm) {
		const proceed = await promptConfirm("\nProceed with migration to PostgreSQL?");
		if (!proceed) {
			console.log("[migrate] Aborted by user");
			exit(1);
		}
	}

	// -----------------------------------------------------------------------
	// Execute migration
	// -----------------------------------------------------------------------
	console.log("\n[migrate] Running schema migrations...");
	const { getKysely, closeKysely } = await import("./kysely.js");
	const { runMigrations } = await import("./migrations/index.js");
	const { ProjectRepository } = await import("./repositories/project.js");
	const { PlanExecutionRepository } = await import("./repositories/plan-execution.js");
	const { WorkspaceExecutionRepository } = await import("./repositories/workspace-execution.js");
	const { JournalEventRepository } = await import("./repositories/journal.js");
	const { generateId } = await import("./helpers.js");

	const db = getKysely();

	try {
		// 1. Run schema migration
		await runMigrations(db);
		console.log("[migrate] Schema migrations applied");

		const projectRepo = new ProjectRepository(db);
		const planExecRepo = new PlanExecutionRepository(db);
		const wsExecRepo = new WorkspaceExecutionRepository(db);
		const journalRepo = new JournalEventRepository(db);

		// 2. Migrate projects
		for (const project of projects) {
			const existing = await projectRepo.findByName(project.name);
			if (!existing) {
				await projectRepo.create({
					id: project.id,
					name: project.name,
					description: project.description ?? "",
					root_path: project.rootPath ?? workspaceRoot,
					created_at: project.createdAt,
				});
				console.log(`[migrate] Created project: ${project.name}`);
			} else {
				console.log(`[migrate] Project already exists: ${project.name} (${existing.id})`);
				result.projectId = existing.id;
			}
		}

		// 3. Migrate plan executions (from tracking file)
		for (const exec of executions) {
			const status = exec.status as "running" | "complete" | "failed" | "paused" | "stopped" | "cancelled";

			await planExecRepo.create({
				id: exec.id,
				project_id: exec.projectId,
				phase: exec.phase,
				title: exec.title,
				status,
				started_at: exec.startedAt,
				completed_at: exec.completedAt,
			});
			result.executionId = exec.id;
			console.log(`[migrate] Migrated execution: ${exec.title} (${exec.id})`);
		}

		// 4. If no tracking file but plan state exists, create an execution entry
		if (executions.length === 0 && planState) {
			const execId = currentExec?.planExecutionId ?? generateId();
			await planExecRepo.create({
				id: execId,
				project_id: result.projectId!,
				phase: planState.phase,
				title: planState.title,
				status: planState.status,
				started_at: planState.startedAt ?? nowISO(),
				completed_at: null,
			});
			result.executionId = execId;
			console.log(`[migrate] Created execution from plan-state: ${execId}`);

			// 5. Migrate workers to workspace executions
			for (const worker of planState.workers) {
				const wsExecId = generateId();
				const stage = mapStage(worker.stage);
				await wsExecRepo.create({
					id: wsExecId,
					plan_execution_id: execId,
					workspace_id: worker.id,
					title: worker.id,
					stage,
					attempts: worker.attempt,
					error_message: null,
					started_at: null,
					completed_at: null,
					metadata: {
						retries: worker.retries,
						snapshotPath: worker.snapshotPath ?? null,
						reportPath: worker.reportPath ?? null,
					},
				});
				result.workspacesMigrated++;
			}
			console.log(`[migrate] Migrated ${result.workspacesMigrated} workspaces`);
		}

		// 6. Migrate journal events
		let journalCount = 0;
		for (const line of journalLines) {
			try {
				const event = JSON.parse(line);
				await journalRepo.create({
					id: generateId(),
					plan_execution_id: result.executionId!,
					workspace_execution_id: null,
					event_type: event.type ?? "unknown",
					timestamp: event.timestamp ?? nowISO(),
					data: (event.data ?? event.message) ? { message: event.message } : null,
				});
				journalCount++;
			} catch (parseError) {
				console.warn(`[migrate] Warning: Could not parse journal line: ${parseError}`);
			}
		}
		result.journalEventsMigrated = journalCount;
		console.log(`[migrate] Migrated ${journalCount} journal events`);

		console.log("\n[migrate] === Migration Complete ===");
		console.log(`[migrate]   Project:          ${result.projectName}`);
		console.log(`[migrate]   Execution ID:     ${result.executionId}`);
		console.log(`[migrate]   Workspaces:       ${result.workspacesMigrated}`);
		console.log(`[migrate]   Journal events:   ${result.journalEventsMigrated}`);
		console.log(`[migrate]   Checksum:         ${result.checksum}`);

		if (result.backupPath) {
			console.log(`[migrate]   Backup:           ${result.backupPath}`);
			console.log(`[migrate]   Rollback:         cp -r ${result.backupPath} ${piDir}`);
		}
	} catch (error) {
		const msg = `Migration error: ${error}`;
		console.error(`[migrate] ${msg}`);
		result.errors.push(msg);
		throw error;
	} finally {
		await closeKysely();
	}

	return result;
}

function mapStage(stage: string): string {
	switch (stage) {
		case "pending":
			return "pending";
		case "active":
			return "active";
		case "blocked":
			return "blocked";
		case "complete":
			return "complete";
		case "failed":
			return "failed";
		default:
			return "pending";
	}
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
	const args = argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const skipBackup = args.includes("--skip-backup");
	const force = args.includes("--force");
	const workspaceRoot = args.find((a: string) => !a.startsWith("--"));

	if (!workspaceRoot) {
		console.error(`
Usage: node dist/migrate-from-json.js <workspace-root> [options]

Options:
  --dry-run      Preview migration without writing
  --force        Skip confirmation prompts
  --skip-backup  Skip creating .pi backup

Examples:
  node dist/migrate-from-json.js /path/to/workspace
  node dist/migrate-from-json.js /path/to/workspace --dry-run
  node dist/migrate-from-json.js . --force
`);
		exit(1);
	}

	const resolvedRoot = resolve(workspaceRoot);

	// Check if .pi directory exists
	const piDir = join(resolvedRoot, ".pi");
	try {
		await access(piDir);
	} catch {
		console.error(`[migrate] Error: No .pi directory found at ${piDir}`);
		console.error("[migrate] This tool must be run from a workspace with existing .pi state");
		exit(1);
	}

	try {
		await migrateFromJson(resolvedRoot, dryRun, skipBackup, force);
	} catch (error) {
		console.error("[migrate] Fatal error:", error);
		exit(1);
	}
}

main();
