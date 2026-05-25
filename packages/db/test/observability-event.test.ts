/**
 * Observability Event Repository tests (25.A).
 *
 * Tests for the ObservabilityEventRepository with trace/span/correlation
 * model support. These tests require a running PostgreSQL instance with
 * PGDATABASE=pi_test.
 */

import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { generateId, now } from "../src/helpers.js";
import { closeKysely, getKysely } from "../src/kysely.js";
import { rollbackMigrations, runMigrations } from "../src/migrations/index.js";
import { ObservabilityEventRepository } from "../src/repositories/observability-event.js";

// ---------------------------------------------------------------------------
// These tests are skipped unless PGDATABASE=pi_test is set
// ---------------------------------------------------------------------------

const isIntegration = process.env.PGDATABASE === "pi_test";

describe("ObservabilityEventRepository", { skip: !isIntegration }, () => {
	let db: ReturnType<typeof getKysely>;
	let repo: ObservabilityEventRepository;

	before(async () => {
		db = getKysely();
		await runMigrations(db);
		repo = new ObservabilityEventRepository(db);
	});

	after(async () => {
		await rollbackMigrations(db, 11);
		await closeKysely();
	});

	it("creates and finds an observability event", async () => {
		const traceId = generateId();
		const spanId = generateId();

		const created = await repo.create({
			trace_id: traceId,
			span_id: spanId,
			parent_span_id: null,
			correlation_id: null,
			event_type: "test",
			source: "test-suite",
			severity: "info",
			status: "ok",
			name: "test-event",
			message: "Observability event test",
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: { key: "value" },
			error: null,
			timestamp: now(),
		});

		assert.ok(created);
		assert.strictEqual(created.trace_id, traceId);
		assert.strictEqual(created.span_id, spanId);
		assert.strictEqual(created.event_type, "test");
		assert.strictEqual(created.severity, "info");
		assert.strictEqual(created.status, "ok");
		assert.strictEqual(created.name, "test-event");
		assert.strictEqual(created.message, "Observability event test");
		assert.deepStrictEqual(created.data, { key: "value" });

		// Find by ID
		const found = await repo.findById(created.id);
		assert.ok(found);
		assert.strictEqual(found.id, created.id);
	});

	it("creates a span tree with parent-child relationships", async () => {
		const traceId = generateId();
		const rootSpanId = generateId();
		const childSpanId = generateId();

		// Create root span
		const root = await repo.create({
			trace_id: traceId,
			span_id: rootSpanId,
			parent_span_id: null,
			correlation_id: "test-corr",
			event_type: "trace_start",
			source: "test-suite",
			severity: "info",
			status: "running",
			name: "root-span",
			message: "Root span",
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: null,
			timestamp: now(),
		});

		// Create child span
		const t1 = now();
		const child = await repo.create({
			trace_id: traceId,
			span_id: childSpanId,
			parent_span_id: rootSpanId,
			correlation_id: "test-corr",
			event_type: "span_start",
			source: "test-suite",
			severity: "info",
			status: "running",
			name: "child-span",
			message: "Child span",
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: null,
			timestamp: t1,
		});

		// Update child as complete
		await db!
			.updateTable("observability_events")
			.set({ status: "ok", duration_ms: 150, data: { result: "done" } })
			.where("id", "=", child.id)
			.execute();

		// Update root as complete
		await db!
			.updateTable("observability_events")
			.set({ status: "ok", duration_ms: 200 })
			.where("id", "=", root.id)
			.execute();

		// Get span tree
		const tree = await repo.getSpanTree(traceId);
		assert.strictEqual(tree.length, 1, "should have one root span");
		assert.strictEqual(tree[0].event.span_id, rootSpanId);
		assert.strictEqual(tree[0].children.length, 1, "root should have one child");
		assert.strictEqual(tree[0].children[0].event.span_id, childSpanId);
	});

	it("queries events by trace ID", async () => {
		const traceId = generateId();
		const spanId1 = generateId();
		const spanId2 = generateId();

		await repo.create({
			trace_id: traceId,
			span_id: spanId1,
			parent_span_id: null,
			correlation_id: null,
			event_type: "test",
			source: "test-suite",
			severity: "info",
			status: "running",
			name: "span-1",
			message: null,
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: null,
			timestamp: now(),
		});

		await repo.create({
			trace_id: traceId,
			span_id: spanId2,
			parent_span_id: spanId1,
			correlation_id: null,
			event_type: "test",
			source: "test-suite",
			severity: "info",
			status: "ok",
			name: "span-2",
			message: null,
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: 100,
			data: { result: "ok" },
			error: null,
			timestamp: now(),
		});

		const trace = await repo.getTrace(traceId);
		assert.strictEqual(trace.length, 2);
	});

	it("queries events by correlation ID", async () => {
		const corrId = `user-req-${generateId().slice(0, 8)}`;

		await repo.create({
			trace_id: generateId(),
			span_id: generateId(),
			parent_span_id: null,
			correlation_id: corrId,
			event_type: "test",
			source: "test-suite",
			severity: "info",
			status: "ok",
			name: "correlated-event",
			message: null,
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: null,
			timestamp: now(),
		});

		const results = await repo.getByCorrelation(corrId);
		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].correlation_id, corrId);
	});

	it("queries events by project/plan/workspace execution", async () => {
		const projectId = generateId();
		const planExecId = generateId();
		const wsExecId = generateId();

		await repo.create({
			trace_id: generateId(),
			span_id: generateId(),
			parent_span_id: null,
			correlation_id: null,
			event_type: "test",
			source: "test-suite",
			severity: "info",
			status: "ok",
			name: "hierarchical-event",
			message: null,
			project_id: projectId,
			plan_execution_id: planExecId,
			workspace_execution_id: wsExecId,
			duration_ms: null,
			data: {},
			error: null,
			timestamp: now(),
		});

		const byProject = await repo.getByProject(projectId);
		assert.strictEqual(byProject.length, 1);
		assert.strictEqual(byProject[0].project_id, projectId);

		const byPlan = await repo.getByPlanExecution(planExecId);
		assert.strictEqual(byPlan.length, 1);
		assert.strictEqual(byPlan[0].plan_execution_id, planExecId);

		const byWs = await repo.getByWorkspaceExecution(wsExecId);
		assert.strictEqual(byWs.length, 1);
		assert.strictEqual(byWs[0].workspace_execution_id, wsExecId);
	});

	it("finds root span for a trace", async () => {
		const traceId = generateId();
		const rootSpanId = generateId();
		const childSpanId = generateId();

		await repo.create({
			trace_id: traceId,
			span_id: rootSpanId,
			parent_span_id: null,
			correlation_id: null,
			event_type: "trace_start",
			source: "test-suite",
			severity: "info",
			status: "running",
			name: "root",
			message: null,
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: null,
			timestamp: now(),
		});

		await repo.create({
			trace_id: traceId,
			span_id: childSpanId,
			parent_span_id: rootSpanId,
			correlation_id: null,
			event_type: "span_start",
			source: "test-suite",
			severity: "info",
			status: "running",
			name: "child",
			message: null,
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: null,
			timestamp: now(),
		});

		const root = await repo.getRootSpan(traceId);
		assert.ok(root);
		assert.strictEqual(root.span_id, rootSpanId);
		assert.strictEqual(root.parent_span_id, null);
	});

	it("counts events with filter", async () => {
		const traceId = generateId();

		await repo.create({
			trace_id: traceId,
			span_id: generateId(),
			parent_span_id: null,
			correlation_id: null,
			event_type: "test",
			source: "test-suite",
			severity: "info",
			status: "ok",
			name: "count-test",
			message: null,
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: null,
			timestamp: now(),
		});

		await repo.create({
			trace_id: traceId,
			span_id: generateId(),
			parent_span_id: null,
			correlation_id: null,
			event_type: "test",
			source: "test-suite",
			severity: "error",
			status: "error",
			name: "error-event",
			message: "Something failed",
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: "Test error",
			timestamp: now(),
		});

		const allCount = await repo.count({ traceId });
		assert.strictEqual(allCount, 2);

		const errorCount = await repo.count({ traceId, severity: "error" });
		assert.strictEqual(errorCount, 1);
	});

	it("gets latest errors", async () => {
		await repo.create({
			trace_id: generateId(),
			span_id: generateId(),
			parent_span_id: null,
			correlation_id: null,
			event_type: "error",
			source: "test-suite",
			severity: "critical",
			status: "error",
			name: "critical-error",
			message: "Critical failure",
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: "Out of memory",
			timestamp: now(),
		});

		const errors = await repo.getLatestErrors(10);
		assert.ok(errors.length >= 1);
		assert.ok(errors.some((e) => e.name === "critical-error"));
	});

	it("deletes a trace", async () => {
		const traceId = generateId();
		const spanId = generateId();

		const created = await repo.create({
			trace_id: traceId,
			span_id: spanId,
			parent_span_id: null,
			correlation_id: null,
			event_type: "test",
			source: "test-suite",
			severity: "info",
			status: "ok",
			name: "delete-me",
			message: null,
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: null,
			timestamp: now(),
		});

		const deleted = await repo.delete(created.id);
		assert.strictEqual(deleted, true);

		const found = await repo.findById(created.id);
		assert.strictEqual(found, undefined);
	});

	it("deletes all events for a trace", async () => {
		const traceId = generateId();

		await repo.create({
			trace_id: traceId,
			span_id: generateId(),
			parent_span_id: null,
			correlation_id: null,
			event_type: "test",
			source: "test-suite",
			severity: "info",
			status: "ok",
			name: "trace-event-1",
			message: null,
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: null,
			timestamp: now(),
		});

		await repo.create({
			trace_id: traceId,
			span_id: generateId(),
			parent_span_id: null,
			correlation_id: null,
			event_type: "test",
			source: "test-suite",
			severity: "info",
			status: "ok",
			name: "trace-event-2",
			message: null,
			project_id: null,
			plan_execution_id: null,
			workspace_execution_id: null,
			duration_ms: null,
			data: {},
			error: null,
			timestamp: now(),
		});

		const deletedCount = await repo.deleteTrace(traceId);
		assert.strictEqual(deletedCount, 2);
	});
});
