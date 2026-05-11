/**
 * Repository integration tests.
 *
 * These tests require a running PostgreSQL instance.
 * Set PGDATABASE=pi_test to use a test database.
 *
 * Run: npx tsx --test packages/db/test/repositories.test.ts
 */

import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { generateId, now } from "../src/helpers.js";
import { closeKysely, getKysely } from "../src/kysely.js";
import { rollbackMigrations, runMigrations } from "../src/migrations/index.js";
import { JournalEventRepository } from "../src/repositories/journal.js";
import { PlanExecutionRepository } from "../src/repositories/plan-execution.js";
import { ProjectRepository } from "../src/repositories/project.js";
import { WorkspaceExecutionRepository } from "../src/repositories/workspace-execution.js";

// ---------------------------------------------------------------------------
// These tests are skipped unless PGDATABASE=pi_test is set
// ---------------------------------------------------------------------------

const isIntegration = process.env.PGDATABASE === "pi_test";

describe("ProjectRepository", { skip: !isIntegration }, () => {
	let db = null as any;
	let repo: ProjectRepository;

	before(async () => {
		db = getKysely();
		await runMigrations(db);
		repo = new ProjectRepository(db);
	});

	after(async () => {
		await rollbackMigrations(db, 10);
		await closeKysely();
	});

	it("creates and finds a project", async () => {
		const id = generateId();
		await repo.create({
			id,
			name: "test-project",
			description: "Test project",
			root_path: "/tmp/test",
			created_at: now(),
		});

		const found = await repo.findById(id);
		assert.ok(found);
		assert.strictEqual(found.name, "test-project");
	});

	it("finds or creates a project by name", async () => {
		const created = await repo.findOrCreate("unique-project", "/tmp/unique");
		assert.ok(created);
		assert.strictEqual(created.name, "unique-project");

		// Second call should return existing
		const existing = await repo.findOrCreate("unique-project", "/tmp/other");
		assert.strictEqual(existing.id, created.id);
	});

	it("lists all projects", async () => {
		const projects = await repo.listAll();
		assert.ok(Array.isArray(projects));
		assert.ok(projects.length > 0);
	});
});

describe("PlanExecutionRepository", { skip: !isIntegration }, () => {
	let db = null as any;
	let projectRepo: ProjectRepository;
	let planExecRepo: PlanExecutionRepository;
	let projectId: string;

	before(async () => {
		db = getKysely();
		await runMigrations(db);
		projectRepo = new ProjectRepository(db);
		planExecRepo = new PlanExecutionRepository(db);

		projectId = generateId();
		await projectRepo.create({
			id: projectId,
			name: "test-exec-project",
			description: null,
			root_path: null,
			created_at: now(),
		});
	});

	after(async () => {
		await rollbackMigrations(db, 10);
		await closeKysely();
	});

	it("creates and retrieves plan execution", async () => {
		const id = generateId();
		await planExecRepo.create({
			id,
			project_id: projectId,
			phase: "test-phase",
			title: "Test Execution",
			status: "running",
			started_at: now(),
			completed_at: null,
			metadata: null,
		});

		const found = await planExecRepo.findById(id);
		assert.ok(found);
		assert.strictEqual(found.title, "Test Execution");
		assert.strictEqual(found.status, "running");
	});

	it("updates execution status", async () => {
		const id = generateId();
		await planExecRepo.create({
			id,
			project_id: projectId,
			phase: "status-test",
			title: "Status Test",
			status: "running",
			started_at: now(),
			completed_at: null,
			metadata: null,
		});

		await planExecRepo.updateStatus(id, "complete");
		const updated = await planExecRepo.findById(id);
		assert.strictEqual(updated?.status, "complete");
	});

	it("lists executions by project", async () => {
		const executions = await planExecRepo.listByProject(projectId);
		assert.ok(Array.isArray(executions));
		assert.ok(executions.length > 0);
	});
});

describe("WorkspaceExecutionRepository", { skip: !isIntegration }, () => {
	let db = null as any;
	let projectRepo: ProjectRepository;
	let planExecRepo: PlanExecutionRepository;
	let wsExecRepo: WorkspaceExecutionRepository;
	let planExecId: string;

	before(async () => {
		db = getKysely();
		await runMigrations(db);
		projectRepo = new ProjectRepository(db);
		planExecRepo = new PlanExecutionRepository(db);
		wsExecRepo = new WorkspaceExecutionRepository(db);

		const projectId = generateId();
		await projectRepo.create({
			id: projectId,
			name: "test-ws-project",
			description: null,
			root_path: null,
			created_at: now(),
		});

		planExecId = generateId();
		await planExecRepo.create({
			id: planExecId,
			project_id: projectId,
			phase: "ws-test",
			title: "WS Test",
			status: "running",
			started_at: now(),
			completed_at: null,
			metadata: null,
		});
	});

	after(async () => {
		await rollbackMigrations(db, 10);
		await closeKysely();
	});

	it("creates workspace execution", async () => {
		const id = generateId();
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
		assert.ok(list.length > 0);
		assert.strictEqual(list[0].workspace_id, "ws-1");
	});

	it("updates workspace stage", async () => {
		const id = generateId();
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
		assert.ok(found);
		assert.strictEqual(found.stage, "active");
	});

	it("increments attempt counter", async () => {
		const id = generateId();
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
		assert.strictEqual(found?.attempts, 2);
	});
});

describe("JournalEventRepository", { skip: !isIntegration }, () => {
	let db = null as any;
	let journalRepo: JournalEventRepository;
	let planExecId: string;

	before(async () => {
		db = getKysely();
		await runMigrations(db);
		journalRepo = new JournalEventRepository(db);

		// Create a project + plan execution for FK
		const projectRepo = new ProjectRepository(db);
		const planExecRepo = new PlanExecutionRepository(db);
		const projectId = generateId();
		await projectRepo.create({
			id: projectId,
			name: "test-journal-project",
			description: null,
			root_path: null,
			created_at: now(),
		});
		planExecId = generateId();
		await planExecRepo.create({
			id: planExecId,
			project_id: projectId,
			phase: "journal-test",
			title: "Journal Test",
			status: "running",
			started_at: now(),
			completed_at: null,
			metadata: null,
		});
	});

	after(async () => {
		await rollbackMigrations(db, 10);
		await closeKysely();
	});

	it("creates and queries journal events", async () => {
		await journalRepo.create({
			id: generateId(),
			plan_execution_id: planExecId,
			workspace_execution_id: null,
			event_type: "plan_start",
			timestamp: now(),
			data: { phase: "test" },
		});

		await journalRepo.create({
			id: generateId(),
			plan_execution_id: planExecId,
			workspace_execution_id: null,
			event_type: "workspace_complete",
			timestamp: now(),
			data: { workspaceId: "ws-1" },
		});

		const events = await journalRepo.query({
			planExecutionId: planExecId,
			limit: 10,
		});

		assert.ok(events.length >= 2);
		assert.strictEqual(events[0].event_type, "plan_start");
	});

	it("filters journal events by type", async () => {
		const filtered = await journalRepo.query({
			planExecutionId: planExecId,
			eventTypes: ["plan_start"],
			limit: 10,
		});

		assert.ok(filtered.length > 0);
		for (const event of filtered) {
			assert.strictEqual(event.event_type, "plan_start");
		}
	});

	it("paginates journal events", async () => {
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

		assert.ok(page1.length <= 1);
		assert.ok(page2.length <= 1);
	});
});
