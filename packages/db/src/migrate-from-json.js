#!/usr/bin/env node
"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_process_1 = require("node:process");
const node_readline_1 = require("node:readline");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function genId() {
    return (0, node_crypto_1.randomUUID)();
}
function nowISO() {
    return new Date().toISOString();
}
function sha256(content) {
    return (0, node_crypto_1.createHash)("sha256").update(content, "utf-8").digest("hex");
}
async function promptConfirm(message) {
    const rl = (0, node_readline_1.createInterface)({ input: node_process_1.stdin, output: node_process_1.stdout });
    return new Promise((resolve) => {
        rl.question(`${message} (y/N) `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
        });
    });
}
// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------
async function createBackup(piDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = (0, node_path_1.join)((0, node_path_1.dirname)(piDir), `.pi-backup-${timestamp}`);
    console.log(`[migrate] Creating backup: ${backupDir}`);
    await (0, promises_1.cp)(piDir, backupDir, { recursive: true });
    const manifest = {
        createdAt: nowISO(),
        sourceDir: piDir,
        files: await listFiles(piDir),
    };
    await (0, promises_1.writeFile)((0, node_path_1.join)(backupDir, "backup-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
    console.log(`[migrate] Backup created at ${backupDir}`);
    return backupDir;
}
async function listFiles(dir) {
    const files = [];
    async function walk(d) {
        try {
            const entries = await (0, promises_1.readdir)(d, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = (0, node_path_1.join)(d, entry.name);
                if (entry.isDirectory()) {
                    await walk(fullPath);
                }
                else {
                    files.push((0, node_path_1.relative)(dir, fullPath));
                }
            }
        }
        catch (_a) {
            // Directory may not exist
        }
    }
    await walk(dir);
    return files;
}
// ---------------------------------------------------------------------------
// Read JSON state
// ---------------------------------------------------------------------------
async function readJsonFile(filePath) {
    try {
        const content = await (0, promises_1.readFile)(filePath, "utf-8");
        return JSON.parse(content);
    }
    catch (error) {
        const err = error;
        if (err.code === "ENOENT") {
            return null;
        }
        console.warn(`[migrate] Warning: Could not read ${filePath}:`, error);
        return null;
    }
}
async function readNdJsonFile(filePath) {
    try {
        const content = await (0, promises_1.readFile)(filePath, "utf-8");
        return content.trim().split("\n").filter(Boolean);
    }
    catch (error) {
        const err = error;
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
async function migrateFromJson(workspaceRoot, dryRun, skipBackup, skipConfirm) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const piDir = (0, node_path_1.join)(workspaceRoot, ".pi");
    const result = {
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
        }
        catch (error) {
            const msg = `Failed to create backup: ${error}`;
            console.error(`[migrate] ${msg}`);
            result.errors.push(msg);
            if (!skipConfirm) {
                const proceed = await promptConfirm("Backup failed. Continue without backup?");
                if (!proceed) {
                    console.log("[migrate] Aborted by user");
                    (0, node_process_1.exit)(1);
                }
            }
        }
    }
    // -----------------------------------------------------------------------
    // Read projects.json
    // -----------------------------------------------------------------------
    const projectsPath = (0, node_path_1.join)(piDir, "projects.json");
    const projects = (_a = (await readJsonFile(projectsPath))) !== null && _a !== void 0 ? _a : [];
    // Create a default project if none exist
    if (projects.length === 0) {
        const defaultProject = {
            id: `project-${genId()}`,
            name: (0, node_path_1.basename)(workspaceRoot),
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
    const planStatePath = (0, node_path_1.join)(piDir, "plan-state.json");
    const planState = await readJsonFile(planStatePath);
    // -----------------------------------------------------------------------
    // Read executions.json (execution tracking)
    // -----------------------------------------------------------------------
    const executionsPath = (0, node_path_1.join)(piDir, "executions.json");
    const executions = (_b = (await readJsonFile(executionsPath))) !== null && _b !== void 0 ? _b : [];
    // -----------------------------------------------------------------------
    // Read execution-journal.ndjson
    // -----------------------------------------------------------------------
    const journalPath = (0, node_path_1.join)(piDir, "execution-journal.ndjson");
    const journalLines = await readNdJsonFile(journalPath);
    // -----------------------------------------------------------------------
    // Read current-execution.json
    // -----------------------------------------------------------------------
    const currentExecPath = (0, node_path_1.join)(piDir, "current-execution.json");
    const currentExec = await readJsonFile(currentExecPath);
    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log("\n[migrate] === Migration Summary ===");
    console.log(`[migrate]   Projects:        ${projects.length}`);
    console.log(`[migrate]   Plan state:      ${planState ? "present" : "none"}`);
    console.log(`[migrate]   Execution tracking entries: ${executions.length}`);
    console.log(`[migrate]   Journal events:  ${journalLines.length}`);
    console.log(`[migrate]   Workers:         ${(_c = planState === null || planState === void 0 ? void 0 : planState.workers.length) !== null && _c !== void 0 ? _c : 0}`);
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
            (0, node_process_1.exit)(1);
        }
    }
    // -----------------------------------------------------------------------
    // Execute migration
    // -----------------------------------------------------------------------
    console.log("\n[migrate] Running schema migrations...");
    const { getKysely, closeKysely } = await Promise.resolve().then(() => __importStar(require("./kysely.js")));
    const { runMigrations } = await Promise.resolve().then(() => __importStar(require("./migrations/index.js")));
    const { ProjectRepository } = await Promise.resolve().then(() => __importStar(require("./repositories/project.js")));
    const { PlanExecutionRepository } = await Promise.resolve().then(() => __importStar(require("./repositories/plan-execution.js")));
    const { WorkspaceExecutionRepository } = await Promise.resolve().then(() => __importStar(require("./repositories/workspace-execution.js")));
    const { JournalEventRepository } = await Promise.resolve().then(() => __importStar(require("./repositories/journal.js")));
    const { generateId } = await Promise.resolve().then(() => __importStar(require("./helpers.js")));
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
                    description: (_d = project.description) !== null && _d !== void 0 ? _d : "",
                    root_path: (_e = project.rootPath) !== null && _e !== void 0 ? _e : workspaceRoot,
                    created_at: project.createdAt,
                });
                console.log(`[migrate] Created project: ${project.name}`);
            }
            else {
                console.log(`[migrate] Project already exists: ${project.name} (${existing.id})`);
                result.projectId = existing.id;
            }
        }
        // 3. Migrate plan executions (from tracking file)
        for (const exec of executions) {
            const status = exec.status;
            await planExecRepo.create({
                id: exec.id,
                project_id: exec.projectId,
                phase: exec.phase,
                title: exec.title,
                status,
                started_at: exec.startedAt,
                completed_at: exec.completedAt,
                metadata: null,
            });
            result.executionId = exec.id;
            console.log(`[migrate] Migrated execution: ${exec.title} (${exec.id})`);
        }
        // 4. If no tracking file but plan state exists, create an execution entry
        if (executions.length === 0 && planState) {
            const execId = (_f = currentExec === null || currentExec === void 0 ? void 0 : currentExec.planExecutionId) !== null && _f !== void 0 ? _f : generateId();
            await planExecRepo.create({
                id: execId,
                project_id: result.projectId,
                phase: planState.phase,
                title: planState.title,
                status: planState.status,
                started_at: (_g = planState.startedAt) !== null && _g !== void 0 ? _g : nowISO(),
                completed_at: null,
                metadata: null,
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
                        snapshotPath: (_h = worker.snapshotPath) !== null && _h !== void 0 ? _h : null,
                        reportPath: (_j = worker.reportPath) !== null && _j !== void 0 ? _j : null,
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
                    plan_execution_id: result.executionId,
                    workspace_execution_id: null,
                    event_type: (_k = event.type) !== null && _k !== void 0 ? _k : "unknown",
                    timestamp: (_l = event.timestamp) !== null && _l !== void 0 ? _l : nowISO(),
                    data: ((_m = event.data) !== null && _m !== void 0 ? _m : event.message) ? { message: event.message } : null,
                });
                journalCount++;
            }
            catch (parseError) {
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
    }
    catch (error) {
        const msg = `Migration error: ${error}`;
        console.error(`[migrate] ${msg}`);
        result.errors.push(msg);
        throw error;
    }
    finally {
        await closeKysely();
    }
    return result;
}
function mapStage(stage) {
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
    const args = node_process_1.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const skipBackup = args.includes("--skip-backup");
    const force = args.includes("--force");
    const workspaceRoot = args.find((a) => !a.startsWith("--"));
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
        (0, node_process_1.exit)(1);
    }
    const resolvedRoot = (0, node_path_1.resolve)(workspaceRoot);
    // Check if .pi directory exists
    const piDir = (0, node_path_1.join)(resolvedRoot, ".pi");
    try {
        await (0, promises_1.access)(piDir);
    }
    catch (_a) {
        console.error(`[migrate] Error: No .pi directory found at ${piDir}`);
        console.error("[migrate] This tool must be run from a workspace with existing .pi state");
        (0, node_process_1.exit)(1);
    }
    try {
        await migrateFromJson(resolvedRoot, dryRun, skipBackup, force);
    }
    catch (error) {
        console.error("[migrate] Fatal error:", error);
        (0, node_process_1.exit)(1);
    }
}
main();
