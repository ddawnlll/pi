"use strict";
/**
 * Repository integration tests.
 *
 * These tests require a running PostgreSQL instance.
 * Set PGDATABASE=pi_test to use a test database.
 *
 * Run: npx tsx --test packages/db/test/repositories.test.ts
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const helpers_js_1 = require("../src/helpers.js");
const kysely_js_1 = require("../src/kysely.js");
const index_js_1 = require("../src/migrations/index.js");
const journal_js_1 = require("../src/repositories/journal.js");
const plan_execution_js_1 = require("../src/repositories/plan-execution.js");
const project_js_1 = require("../src/repositories/project.js");
const workspace_execution_js_1 = require("../src/repositories/workspace-execution.js");
// ---------------------------------------------------------------------------
// These tests are skipped unless PGDATABASE=pi_test is set
// ---------------------------------------------------------------------------
const isIntegration = process.env.PGDATABASE === "pi_test";
(0, node_test_1.describe)("ProjectRepository", { skip: !isIntegration }, () => {
    let db = null;
    let repo;
    (0, node_test_1.before)(async () => {
        db = (0, kysely_js_1.getKysely)();
        await (0, index_js_1.runMigrations)(db);
        repo = new project_js_1.ProjectRepository(db);
    });
    (0, node_test_1.after)(async () => {
        await (0, index_js_1.rollbackMigrations)(db, 10);
        await (0, kysely_js_1.closeKysely)();
    });
    (0, node_test_1.it)("creates and finds a project", async () => {
        const id = (0, helpers_js_1.generateId)();
        await repo.create({
            id,
            name: "test-project",
            description: "Test project",
            root_path: "/tmp/test",
            created_at: (0, helpers_js_1.now)(),
        });
        const found = await repo.findById(id);
        node_assert_1.default.ok(found);
        node_assert_1.default.strictEqual(found.name, "test-project");
    });
    (0, node_test_1.it)("finds or creates a project by name", async () => {
        const created = await repo.findOrCreate("unique-project", "/tmp/unique");
        node_assert_1.default.ok(created);
        node_assert_1.default.strictEqual(created.name, "unique-project");
        // Second call should return existing
        const existing = await repo.findOrCreate("unique-project", "/tmp/other");
        node_assert_1.default.strictEqual(existing.id, created.id);
    });
    (0, node_test_1.it)("lists all projects", async () => {
        const projects = await repo.listAll();
        node_assert_1.default.ok(Array.isArray(projects));
        node_assert_1.default.ok(projects.length > 0);
    });
});
(0, node_test_1.describe)("PlanExecutionRepository", { skip: !isIntegration }, () => {
    let db = null;
    let projectRepo;
    let planExecRepo;
    let projectId;
    (0, node_test_1.before)(async () => {
        db = (0, kysely_js_1.getKysely)();
        await (0, index_js_1.runMigrations)(db);
        projectRepo = new project_js_1.ProjectRepository(db);
        planExecRepo = new plan_execution_js_1.PlanExecutionRepository(db);
        projectId = (0, helpers_js_1.generateId)();
        await projectRepo.create({
            id: projectId,
            name: "test-exec-project",
            description: null,
            root_path: null,
            created_at: (0, helpers_js_1.now)(),
        });
    });
    (0, node_test_1.after)(async () => {
        await (0, index_js_1.rollbackMigrations)(db, 10);
        await (0, kysely_js_1.closeKysely)();
    });
    (0, node_test_1.it)("creates and retrieves plan execution", async () => {
        const id = (0, helpers_js_1.generateId)();
        await planExecRepo.create({
            id,
            project_id: projectId,
            phase: "test-phase",
            title: "Test Execution",
            status: "running",
            started_at: (0, helpers_js_1.now)(),
            completed_at: null,
            metadata: null,
        });
        const found = await planExecRepo.findById(id);
        node_assert_1.default.ok(found);
        node_assert_1.default.strictEqual(found.title, "Test Execution");
        node_assert_1.default.strictEqual(found.status, "running");
    });
    (0, node_test_1.it)("updates execution status", async () => {
        const id = (0, helpers_js_1.generateId)();
        await planExecRepo.create({
            id,
            project_id: projectId,
            phase: "status-test",
            title: "Status Test",
            status: "running",
            started_at: (0, helpers_js_1.now)(),
            completed_at: null,
            metadata: null,
        });
        await planExecRepo.updateStatus(id, "complete");
        const updated = await planExecRepo.findById(id);
        node_assert_1.default.strictEqual(updated === null || updated === void 0 ? void 0 : updated.status, "complete");
    });
    (0, node_test_1.it)("lists executions by project", async () => {
        const executions = await planExecRepo.listByProject(projectId);
        node_assert_1.default.ok(Array.isArray(executions));
        node_assert_1.default.ok(executions.length > 0);
    });
});
(0, node_test_1.describe)("WorkspaceExecutionRepository", { skip: !isIntegration }, () => {
    let db = null;
    let projectRepo;
    let planExecRepo;
    let wsExecRepo;
    let planExecId;
    (0, node_test_1.before)(async () => {
        db = (0, kysely_js_1.getKysely)();
        await (0, index_js_1.runMigrations)(db);
        projectRepo = new project_js_1.ProjectRepository(db);
        planExecRepo = new plan_execution_js_1.PlanExecutionRepository(db);
        wsExecRepo = new workspace_execution_js_1.WorkspaceExecutionRepository(db);
        const projectId = (0, helpers_js_1.generateId)();
        await projectRepo.create({
            id: projectId,
            name: "test-ws-project",
            description: null,
            root_path: null,
            created_at: (0, helpers_js_1.now)(),
        });
        planExecId = (0, helpers_js_1.generateId)();
        await planExecRepo.create({
            id: planExecId,
            project_id: projectId,
            phase: "ws-test",
            title: "WS Test",
            status: "running",
            started_at: (0, helpers_js_1.now)(),
            completed_at: null,
            metadata: null,
        });
    });
    (0, node_test_1.after)(async () => {
        await (0, index_js_1.rollbackMigrations)(db, 10);
        await (0, kysely_js_1.closeKysely)();
    });
    (0, node_test_1.it)("creates workspace execution", async () => {
        const id = (0, helpers_js_1.generateId)();
        await wsExecRepo.create({
            id,
            plan_execution_id: planExecId,
            workspace_id: "ws-1",
            title: "Workspace 1",
            stage: "pending",
            attempts: 0,
            error_message: null,
            started_at: null,
            completed_at: null,
            metadata: null,
        });
        const list = await wsExecRepo.listByPlanExecution(planExecId);
        node_assert_1.default.ok(list.length > 0);
        node_assert_1.default.strictEqual(list[0].workspace_id, "ws-1");
    });
    (0, node_test_1.it)("updates workspace stage", async () => {
        const id = (0, helpers_js_1.generateId)();
        await wsExecRepo.create({
            id,
            plan_execution_id: planExecId,
            workspace_id: "ws-stage-test",
            title: "Stage Test",
            stage: "pending",
            attempts: 0,
            error_message: null,
            started_at: null,
            completed_at: null,
            metadata: null,
        });
        await wsExecRepo.updateStage(id, "active");
        const list = await wsExecRepo.listByPlanExecution(planExecId);
        const found = list.find((w) => w.workspace_id === "ws-stage-test");
        node_assert_1.default.ok(found);
        node_assert_1.default.strictEqual(found.stage, "active");
    });
    (0, node_test_1.it)("increments attempt counter", async () => {
        const id = (0, helpers_js_1.generateId)();
        await wsExecRepo.create({
            id,
            plan_execution_id: planExecId,
            workspace_id: "ws-attempt-test",
            title: "Attempt Test",
            stage: "pending",
            attempts: 1,
            error_message: null,
            started_at: null,
            completed_at: null,
            metadata: null,
        });
        await wsExecRepo.incrementAttempts(id);
        const list = await wsExecRepo.listByPlanExecution(planExecId);
        const found = list.find((w) => w.workspace_id === "ws-attempt-test");
        node_assert_1.default.strictEqual(found === null || found === void 0 ? void 0 : found.attempts, 2);
    });
});
(0, node_test_1.describe)("JournalEventRepository", { skip: !isIntegration }, () => {
    let db = null;
    let journalRepo;
    let planExecId;
    (0, node_test_1.before)(async () => {
        db = (0, kysely_js_1.getKysely)();
        await (0, index_js_1.runMigrations)(db);
        journalRepo = new journal_js_1.JournalEventRepository(db);
        // Create a project + plan execution for FK
        const projectRepo = new project_js_1.ProjectRepository(db);
        const planExecRepo = new plan_execution_js_1.PlanExecutionRepository(db);
        const projectId = (0, helpers_js_1.generateId)();
        await projectRepo.create({
            id: projectId,
            name: "test-journal-project",
            description: null,
            root_path: null,
            created_at: (0, helpers_js_1.now)(),
        });
        planExecId = (0, helpers_js_1.generateId)();
        await planExecRepo.create({
            id: planExecId,
            project_id: projectId,
            phase: "journal-test",
            title: "Journal Test",
            status: "running",
            started_at: (0, helpers_js_1.now)(),
            completed_at: null,
            metadata: null,
        });
    });
    (0, node_test_1.after)(async () => {
        await (0, index_js_1.rollbackMigrations)(db, 10);
        await (0, kysely_js_1.closeKysely)();
    });
    (0, node_test_1.it)("creates and queries journal events", async () => {
        await journalRepo.create({
            id: (0, helpers_js_1.generateId)(),
            plan_execution_id: planExecId,
            workspace_execution_id: null,
            event_type: "plan_start",
            timestamp: (0, helpers_js_1.now)(),
            data: { phase: "test" },
        });
        await journalRepo.create({
            id: (0, helpers_js_1.generateId)(),
            plan_execution_id: planExecId,
            workspace_execution_id: null,
            event_type: "workspace_complete",
            timestamp: (0, helpers_js_1.now)(),
            data: { workspaceId: "ws-1" },
        });
        const events = await journalRepo.query({
            planExecutionId: planExecId,
            limit: 10,
        });
        node_assert_1.default.ok(events.length >= 2);
        node_assert_1.default.strictEqual(events[0].event_type, "plan_start");
    });
    (0, node_test_1.it)("filters journal events by type", async () => {
        const filtered = await journalRepo.query({
            planExecutionId: planExecId,
            eventTypes: ["plan_start"],
            limit: 10,
        });
        node_assert_1.default.ok(filtered.length > 0);
        for (const event of filtered) {
            node_assert_1.default.strictEqual(event.event_type, "plan_start");
        }
    });
    (0, node_test_1.it)("paginates journal events", async () => {
        const page1 = await journalRepo.query({
            planExecutionId: planExecId,
            limit: 1,
            offset: 0,
        });
        const page2 = await journalRepo.query({
            planExecutionId: planExecId,
            limit: 1,
            offset: 1,
        });
        node_assert_1.default.ok(page1.length <= 1);
        node_assert_1.default.ok(page2.length <= 1);
    });
});
