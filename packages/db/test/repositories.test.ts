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
import { AuditEventRepository } from "../src/repositories/audit-event.js";
import { JournalEventRepository } from "../src/repositories/journal.js";
import { PlanExecutionRepository } from "../src/repositories/plan-execution.js";
import { PlanRevisionRepository } from "../src/repositories/plan-revision.js";
import { ProjectRepository } from "../src/repositories/project.js";
import { ProposalRepository } from "../src/repositories/proposal.js";
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

describe("ProposalRepository (P9.G2 recording)", { skip: !isIntegration }, () => {
	let db = null as any;
	let projectRepo: ProjectRepository;
	let proposalRepo: ProposalRepository;
	let projectId: string;
	let proposalId: string;

	before(async () => {
		db = getKysely();
		await runMigrations(db);
		projectRepo = new ProjectRepository(db);
		proposalRepo = new ProposalRepository(db);

		projectId = generateId();
		await projectRepo.create({
			id: projectId,
			name: "test-proposal-recording",
			description: null,
			root_path: null,
			created_at: now(),
		});

		// Create a proposal for testing
		const proposal = await proposalRepo.create({
			project_id: projectId,
			proposal_key: `prop-test-${generateId()}`,
			title: "Test Proposal for Recording",
			phase: "remediation",
			status: "pending",
			evidence: { source: "P8 analysis" },
			audit_trail: [],
			source_artifacts: [],
			source_recorded_at: null,
			submitted_at: now(),
			actioned_at: null,
			rejection_reason: null,
			metadata: null,
		});
		proposalId = proposal.id;
	});

	after(async () => {
		await rollbackMigrations(db, 10);
		await closeKysely();
	});

	it("records source artifacts for a proposal (AC 1)", async () => {
		const artifacts = [
			{
				path: "reports/p9h-remediation/01-remediation-plan.md",
				label: "Remediation Plan",
				type: "remediation-plan",
				size: 2048,
				hash: "abc123",
				recorded_at: now(),
			},
			{
				path: "reports/p9h-remediation/02-optimized-dag.md",
				label: "Optimized DAG",
				type: "dag",
				size: 1024,
				recorded_at: now(),
			},
		];

		const updated = await proposalRepo.recordSourceArtifacts(proposalId, artifacts);
		assert.ok(updated);
		assert.ok(updated.source_recorded_at, "source_recorded_at should be set");
		assert.ok(Array.isArray(updated.source_artifacts));
		assert.strictEqual(updated.source_artifacts.length, 2);
		assert.strictEqual(updated.source_artifacts[0].path, "reports/p9h-remediation/01-remediation-plan.md");
	});

	it("retrieves source artifacts from a proposal", async () => {
		const artifacts = await proposalRepo.getSourceArtifacts(proposalId);
		assert.ok(artifacts);
		assert.strictEqual(artifacts.length, 2);
	});

	it("checks if source artifacts have been recorded", async () => {
		const hasArtifacts = await proposalRepo.hasSourceArtifacts(proposalId);
		assert.strictEqual(hasArtifacts, true);

		// A proposal without source artifacts should return false
		const emptyProposal = await proposalRepo.create({
			project_id: projectId,
			proposal_key: `prop-empty-${generateId()}`,
			title: "Empty Proposal",
			phase: "remediation",
			status: "pending",
			evidence: {},
			audit_trail: [],
			source_artifacts: [],
			source_recorded_at: null,
			submitted_at: now(),
			actioned_at: null,
			rejection_reason: null,
			metadata: null,
		});
		const hasSource = await proposalRepo.hasSourceArtifacts(emptyProposal.id);
		assert.strictEqual(hasSource, false);
	});
});

describe("PlanExecutionRepository (P9.G2 proposal linking)", { skip: !isIntegration }, () => {
	let db = null as any;
	let projectRepo: ProjectRepository;
	let proposalRepo: ProposalRepository;
	let planExecRepo: PlanExecutionRepository;
	let projectId: string;
	let proposalId: string;
	let planExecId: string;

	before(async () => {
		db = getKysely();
		await runMigrations(db);
		projectRepo = new ProjectRepository(db);
		proposalRepo = new ProposalRepository(db);
		planExecRepo = new PlanExecutionRepository(db);

		projectId = generateId();
		await projectRepo.create({
			id: projectId,
			name: "test-plan-proposal-linking",
			description: null,
			root_path: null,
			created_at: now(),
		});

		// Create a proposal
		const proposal = await proposalRepo.create({
			project_id: projectId,
			proposal_key: `prop-link-${generateId()}`,
			title: "Proposal for Plan Linking",
			phase: "remediation",
			status: "approved",
			evidence: {},
			audit_trail: [],
			source_artifacts: [],
			source_recorded_at: null,
			submitted_at: now(),
			actioned_at: now(),
			rejection_reason: null,
			metadata: null,
		});
		proposalId = proposal.id;

		// Create a plan execution linked to the proposal (AC 2)
		planExecId = generateId();
		await planExecRepo.create({
			id: planExecId,
			project_id: projectId,
			proposal_id: proposalId,
			phase: "remediation-execution",
			title: "Generated Remediation Plan",
			status: "running",
			started_at: now(),
			completed_at: null,
		});
	});

	after(async () => {
		await rollbackMigrations(db, 10);
		await closeKysely();
	});

	it("creates plan execution with proposal link", async () => {
		const found = await planExecRepo.findById(planExecId);
		assert.ok(found);
		assert.strictEqual(found.proposal_id, proposalId);
	});

	it("lists plan executions by proposal (AC 2)", async () => {
		const executions = await planExecRepo.listByProposal(proposalId);
		assert.ok(executions.length >= 1);
		assert.strictEqual(executions[0].proposal_id, proposalId);
	});

	it("finds plan execution by proposal and phase", async () => {
		const found = await planExecRepo.findByProposalAndPhase(proposalId, "remediation-execution");
		assert.ok(found);
		assert.strictEqual(found.phase, "remediation-execution");
	});
});

describe("PlanRevisionRepository (P9.G2 revision history)", { skip: !isIntegration }, () => {
	let db = null as any;
	let projectRepo: ProjectRepository;
	let proposalRepo: ProposalRepository;
	let planExecRepo: PlanExecutionRepository;
	let planRevisionRepo: PlanRevisionRepository;
	let projectId: string;
	let planExecId: string;

	before(async () => {
		db = getKysely();
		await runMigrations(db);
		projectRepo = new ProjectRepository(db);
		proposalRepo = new ProposalRepository(db);
		planExecRepo = new PlanExecutionRepository(db);
		planRevisionRepo = new PlanRevisionRepository(db);

		projectId = generateId();
		await projectRepo.create({
			id: projectId,
			name: "test-plan-revisions",
			description: null,
			root_path: null,
			created_at: now(),
		});

		// Create a proposal
		const proposal = await proposalRepo.create({
			project_id: projectId,
			proposal_key: `prop-rev-${generateId()}`,
			title: "Proposal for Revisions",
			phase: "remediation",
			status: "approved",
			evidence: {},
			audit_trail: [],
			source_artifacts: [],
			source_recorded_at: null,
			submitted_at: now(),
			actioned_at: now(),
			rejection_reason: null,
			metadata: null,
		});

		// Create a plan execution
		planExecId = generateId();
		await planExecRepo.create({
			id: planExecId,
			project_id: projectId,
			proposal_id: proposal.id,
			phase: "remediation-execution",
			title: "Plan for Revisions Test",
			status: "running",
			started_at: now(),
			completed_at: null,
		});
	});

	after(async () => {
		await rollbackMigrations(db, 10);
		await closeKysely();
	});

	it("creates plan revisions with auto-incrementing version (AC 3)", async () => {
		// First revision
		const rev1 = await planRevisionRepo.create({
			plan_execution_id: planExecId,
			title: "Initial Remediation Plan",
			content: { steps: ["analyze", "fix", "verify"] },
			status: "draft",
			diff_summary: null,
			created_by: "test-user",
		});
		assert.ok(rev1);
		assert.strictEqual(rev1.version_number, 1);
		assert.strictEqual(rev1.title, "Initial Remediation Plan");

		// Second revision (auto-incremented)
		const rev2 = await planRevisionRepo.create({
			plan_execution_id: planExecId,
			title: "Updated Remediation Plan",
			content: { steps: ["analyze", "fix", "verify", "validate"] },
			status: "review",
			diff_summary: "Added validation step after verification",
			created_by: "test-user",
		});
		assert.ok(rev2);
		assert.strictEqual(rev2.version_number, 2);
		assert.strictEqual(rev2.diff_summary, "Added validation step after verification");
	});

	it("lists revisions by plan execution ordered by version desc", async () => {
		const revisions = await planRevisionRepo.listByPlanExecution(planExecId);
		assert.ok(revisions.length >= 2);
		// Should be ordered by version descending
		assert.strictEqual(revisions[0].version_number, 2);
		assert.strictEqual(revisions[1].version_number, 1);
	});

	it("gets the latest revision for a plan execution", async () => {
		const latest = await planRevisionRepo.getLatestByPlanExecution(planExecId);
		assert.ok(latest);
		assert.strictEqual(latest.version_number, 2);
		assert.strictEqual(latest.title, "Updated Remediation Plan");
	});

	it("filters revisions by status", async () => {
		const drafts = await planRevisionRepo.listByPlanExecution(planExecId, { status: "draft" });
		assert.ok(drafts.length >= 1);
		for (const rev of drafts) {
			assert.strictEqual(rev.status, "draft");
		}

		const reviews = await planRevisionRepo.listByPlanExecution(planExecId, { status: "review" });
		assert.ok(reviews.length >= 1);
	});

	it("counts revisions for a plan execution", async () => {
		const count = await planRevisionRepo.countByPlanExecution(planExecId);
		assert.strictEqual(count, 2);
	});

	it("updates revision status", async () => {
		const latest = await planRevisionRepo.getLatestByPlanExecution(planExecId);
		assert.ok(latest);

		const updated = await planRevisionRepo.updateStatus(latest.id, "approved");
		assert.ok(updated);
		assert.strictEqual(updated.status, "approved");
	});

	it("supports explicit version_number", async () => {
		const rev = await planRevisionRepo.create({
			plan_execution_id: planExecId,
			version_number: 10,
			title: "Explicit Version",
			content: { note: "explicit version test" },
			status: "draft",
			diff_summary: null,
			created_by: "test",
		});
		assert.strictEqual(rev.version_number, 10);
	});
});

describe("AuditEventRepository (P11.M)", { skip: !isIntegration }, () => {
	let db = null as any;
	let repo: AuditEventRepository;
	let projectRepo: ProjectRepository;
	let projectId: string;

	before(async () => {
		db = getKysely();
		await runMigrations(db);
		repo = new AuditEventRepository(db);
		projectRepo = new ProjectRepository(db);

		projectId = generateId();
		await projectRepo.create({
			id: projectId,
			name: "audit-test-project",
			description: "Project for audit event tests",
			root_path: "/tmp/audit-test",
			created_at: now(),
		});
	});

	after(async () => {
		await rollbackMigrations(db, 10);
		await closeKysely();
	});

	it("creates an audit event with allowed status", async () => {
		const event = await repo.create({
			action: "register_tool",
			status: "allowed",
			domain: "extension",
			actor: "test-extension",
			project_id: projectId,
			capability: "register_tool",
			workspace_id: null,
			proposal_id: null,
			extension_id: "my-extension",
			skill_id: null,
			memory_source: null,
			reason: "Extension may register tools for agent use",
			data: { toolName: "my-tool", version: "1.0.0" },
			timestamp: now(),
		});
		assert.ok(event);
		assert.strictEqual(event.action, "register_tool");
		assert.strictEqual(event.status, "allowed");
		assert.strictEqual(event.domain, "extension");
		assert.strictEqual(event.actor, "test-extension");
		assert.strictEqual(event.project_id, projectId);
		assert.strictEqual(event.extension_id, "my-extension");
		assert.strictEqual(event.reason, "Extension may register tools for agent use");
		assert.deepStrictEqual(event.data, { toolName: "my-tool", version: "1.0.0" });
	});

	it("creates an audit event with denied status", async () => {
		const event = await repo.create({
			action: "network_access",
			status: "denied",
			domain: "extension",
			actor: "malicious-extension",
			project_id: projectId,
			capability: "network_access",
			workspace_id: null,
			proposal_id: null,
			extension_id: "bad-extension",
			skill_id: null,
			memory_source: null,
			reason: "Network access is blocked by default",
			data: { attemptedHost: "evil.com" },
			timestamp: now(),
		});
		assert.ok(event);
		assert.strictEqual(event.status, "denied");
		assert.strictEqual(event.extension_id, "bad-extension");
	});

	it("creates an audit event with pending-approval status", async () => {
		const event = await repo.create({
			action: "modify_settings",
			status: "pending-approval",
			domain: "extension",
			actor: "config-extension",
			project_id: projectId,
			capability: "modify_settings",
			workspace_id: null,
			proposal_id: null,
			extension_id: "config-ext",
			skill_id: null,
			memory_source: null,
			reason: "Requires explicit approval to modify settings",
			data: { setting: "theme", newValue: "dark" },
			timestamp: now(),
		});
		assert.ok(event);
		assert.strictEqual(event.status, "pending-approval");
	});

	it("creates an audit event with approved status", async () => {
		const event = await repo.create({
			action: "modify_settings",
			status: "approved",
			domain: "extension",
			actor: "admin-user",
			project_id: projectId,
			capability: "modify_settings",
			workspace_id: null,
			proposal_id: null,
			extension_id: "config-ext",
			skill_id: null,
			memory_source: null,
			reason: "Approved by admin",
			data: { approvedBy: "admin@example.com" },
			timestamp: now(),
		});
		assert.ok(event);
		assert.strictEqual(event.status, "approved");
	});

	it("creates an audit event with rejected status", async () => {
		const event = await repo.create({
			action: "access_secrets",
			status: "rejected",
			domain: "extension",
			actor: "admin-user",
			project_id: projectId,
			capability: "access_secrets",
			workspace_id: null,
			proposal_id: null,
			extension_id: "secret-ext",
			skill_id: null,
			memory_source: null,
			reason: "Secret access request denied by policy",
			data: { reason: "insufficient_privilege" },
			timestamp: now(),
		});
		assert.ok(event);
		assert.strictEqual(event.status, "rejected");
	});

	it("creates an audit event with rollback status", async () => {
		const event = await repo.create({
			action: "apply_proposal",
			status: "rollback",
			domain: "optimizer",
			actor: "system",
			project_id: projectId,
			capability: "apply_proposal",
			workspace_id: "workspace-1",
			proposal_id: null,
			extension_id: null,
			skill_id: null,
			memory_source: null,
			reason: "Rollback due to validation failure",
			data: { originalProposal: "prop-123" },
			timestamp: now(),
		});
		assert.ok(event);
		assert.strictEqual(event.status, "rollback");
	});

	it("filters audit events by project", async () => {
		const events = await repo.getByProject(projectId);
		assert.ok(events.length >= 5); // At least the 5 events we created above
	});

	it("filters audit events by capability (scoped to project)", async () => {
		const events = await repo.query({ capability: "register_tool", projectId });
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].action, "register_tool");
	});

	it("filters audit events by workspace", async () => {
		const events = await repo.query({ workspaceId: "workspace-1", projectId });
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].status, "rollback");
	});

	it("filters audit events by extension", async () => {
		const events = await repo.query({ extensionId: "my-extension", projectId });
		assert.strictEqual(events.length, 1);
	});

	it("filters audit events by skill", async () => {
		const event = await repo.create({
			action: "activate",
			status: "allowed",
			domain: "skill",
			actor: "test-agent",
			project_id: projectId,
			capability: "activate",
			workspace_id: null,
			proposal_id: null,
			extension_id: null,
			skill_id: "code-review-skill",
			memory_source: null,
			reason: "Skill activation permitted",
			data: { skillVersion: "2.0.0" },
			timestamp: now(),
		});
		assert.ok(event);

		const events = await repo.query({ skillId: "code-review-skill", projectId });
		assert.strictEqual(events.length, 1);
	});

	it("filters audit events by memory source", async () => {
		const event = await repo.create({
			action: "read_memory",
			status: "allowed",
			domain: "memory",
			actor: "test-agent",
			project_id: projectId,
			capability: "read_memory",
			workspace_id: null,
			proposal_id: null,
			extension_id: null,
			skill_id: null,
			memory_source: "execution-memory",
			reason: "Memory read permitted",
			data: { memoryKey: "prior-runs" },
			timestamp: now(),
		});
		assert.ok(event);

		const events = await repo.query({ memorySource: "execution-memory", projectId });
		assert.strictEqual(events.length, 1);
	});

	it("filters audit events by status (scoped to project)", async () => {
		const events = await repo.query({ status: "denied", projectId });
		assert.ok(events.length >= 1);
		for (const ev of events) {
			assert.strictEqual(ev.status, "denied");
		}
	});

	it("filters audit events by domain (scoped to project)", async () => {
		const events = await repo.query({ domain: "memory", projectId });
		assert.ok(events.length >= 1);
		for (const ev of events) {
			assert.strictEqual(ev.domain, "memory");
		}
	});

	it("filters audit events by action (scoped to project)", async () => {
		const events = await repo.query({ action: "register_tool", projectId });
		assert.strictEqual(events.length, 1);
	});

	it("filters audit events by proposal", async () => {
		// Create a proposal first to satisfy FK constraint
		const proposalRepo = new ProposalRepository(db);
		const proposal = await proposalRepo.create({
			project_id: projectId,
			proposal_key: `audit-test-prop-${generateId().slice(0, 8)}`,
			title: "Audit Test Proposal",
			phase: "remediation",
			status: "pending",
			evidence: JSON.stringify({ findings: [] }) as any,
			audit_trail: JSON.stringify([]) as any,
			source_artifacts: JSON.stringify([]) as any,
			submitted_at: now(),
		});

		const event = await repo.create({
			action: "approve_proposal",
			status: "approved",
			domain: "optimizer",
			actor: "reviewer",
			project_id: projectId,
			capability: "approve_proposal",
			workspace_id: null,
			proposal_id: proposal.id,
			extension_id: null,
			skill_id: null,
			memory_source: null,
			reason: "Proposal approved after review",
			data: { reviewNotes: "Looks good" },
			timestamp: now(),
		});
		assert.ok(event);

		const events = await repo.query({ proposalId: proposal.id, projectId });
		assert.strictEqual(events.length, 1);
	});

	it("supports time-range filtering", async () => {
		const past = new Date(Date.now() - 86400000).toISOString();
		const future = new Date(Date.now() + 86400000).toISOString();

		const events = await repo.query({ since: past, until: future });
		assert.ok(events.length >= 5);
	});

	it("supports pagination (limit/offset)", async () => {
		const first = await repo.query({ limit: 2, offset: 0 });
		assert.ok(first.length <= 2);

		const second = await repo.query({ limit: 2, offset: 2 });
		assert.ok(second.length <= 2);

		// Ensure ordering is consistent
		if (first.length === 2 && second.length > 0) {
			assert.notDeepStrictEqual(first, second);
		}
	});

	it("count audit events", async () => {
		const count = await repo.count({ projectId });
		assert.ok(count >= 5);
	});

	it("finds audit event by ID", async () => {
		// Create an event so we can find it by ID
		const created = await repo.create({
			action: "read_memory",
			status: "denied",
			domain: "memory",
			actor: "unauthorized-agent",
			project_id: projectId,
			capability: "read_memory",
			workspace_id: null,
			proposal_id: null,
			extension_id: null,
			skill_id: null,
			memory_source: null,
			reason: "Not authorized",
			data: {},
			timestamp: now(),
		});

		const found = await repo.findById(created.id);
		assert.ok(found);
		assert.strictEqual(found.id, created.id);
		assert.strictEqual(found.status, "denied");
	});

	it("deletes an audit event", async () => {
		const created = await repo.create({
			action: "deactivate",
			status: "allowed",
			domain: "skill",
			actor: "cleanup-agent",
			project_id: projectId,
			capability: "deactivate",
			workspace_id: null,
			proposal_id: null,
			extension_id: null,
			skill_id: null,
			memory_source: null,
			reason: "Cleanup deactivation",
			data: {},
			timestamp: now(),
		});

		const deleted = await repo.delete(created.id);
		assert.strictEqual(deleted, true);

		const found = await repo.findById(created.id);
		assert.strictEqual(found, undefined);
	});

	it("stores flexible JSONB data for enterprise export", async () => {
		const enterpriseMetadata = {
			eventId: "audit-123",
			complianceTags: ["soc2", "hipaa"],
			environment: "production",
			region: "us-east-1",
			correlationId: "corr-456",
			auditSource: "capability-policy-engine",
			sourceVersion: "1.0.0",
			additionalContext: {
				userAgent: "pi-cli/2.0",
				requestId: "req-789",
			},
		};

		const event = await repo.create({
			action: "register_command",
			status: "allowed",
			domain: "extension",
			actor: "enterprise-extension",
			project_id: projectId,
			capability: "register_command",
			workspace_id: null,
			proposal_id: null,
			extension_id: "enterprise-ext",
			skill_id: null,
			memory_source: null,
			reason: "Enterprise extension registered commands",
			data: enterpriseMetadata,
			timestamp: now(),
		});

		assert.ok(event);
		const d = event.data as Record<string, unknown>;
		const tags = d.complianceTags as string[];
		assert.strictEqual(tags[0], "soc2");
		assert.strictEqual(d.correlationId, "corr-456");
		const ctx = d.additionalContext as Record<string, unknown>;
		assert.strictEqual(ctx.requestId, "req-789");
	});

	it("returns correct event ordering", async () => {
		// Create 3 events with distinct timestamps
		const past = new Date(Date.now() - 10000).toISOString();
		const mid = new Date(Date.now() - 5000).toISOString();
		const recent = now();

		await repo.create({
			action: "activate",
			status: "allowed",
			domain: "skill",
			actor: "order-test",
			project_id: projectId,
			capability: "activate",
			workspace_id: null,
			proposal_id: null,
			extension_id: null,
			skill_id: "order-skill",
			memory_source: null,
			reason: "Order test 1",
			data: {},
			timestamp: past,
		});
		await repo.create({
			action: "activate",
			status: "allowed",
			domain: "skill",
			actor: "order-test",
			project_id: projectId,
			capability: "activate",
			workspace_id: null,
			proposal_id: null,
			extension_id: null,
			skill_id: "order-skill",
			memory_source: null,
			reason: "Order test 2",
			data: {},
			timestamp: mid,
		});
		await repo.create({
			action: "activate",
			status: "allowed",
			domain: "skill",
			actor: "order-test",
			project_id: projectId,
			capability: "activate",
			workspace_id: null,
			proposal_id: null,
			extension_id: null,
			skill_id: "order-skill",
			memory_source: null,
			reason: "Order test 3",
			data: {},
			timestamp: recent,
		});

		// Default is desc (most recent first)
		const desc = await repo.query({
			skillId: "order-skill",
			limit: 10,
		});
		assert.ok(desc.length >= 3);
		// Most recent should be first
		assert.strictEqual(desc[0].reason, "Order test 3");

		// Ascending order
		const asc = await repo.query({
			skillId: "order-skill",
			limit: 10,
			order: "asc",
		});
		assert.ok(asc.length >= 3);
		// Oldest should be first
		assert.strictEqual(asc[0].reason, "Order test 1");
	});
});
