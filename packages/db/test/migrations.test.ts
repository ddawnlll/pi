/**
 * Migration integration tests.
 *
 * These tests require a running PostgreSQL instance.
 * Set PGDATABASE=pi_test to use a test database.
 *
 * Run: npx tsx --test packages/db/test/migrations.test.ts
 */

import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { closeKysely, getKysely } from "../src/kysely.js";
import { getAppliedMigrations, rollbackMigrations, runMigrations } from "../src/migrations/index.js";

const isIntegration = process.env.PGDATABASE === "pi_test";

describe("Migrations", { skip: !isIntegration }, () => {
	let db = null as any;

	before(async () => {
		db = getKysely();
	});

	after(async () => {
		await closeKysely();
	});

	it("runs all pending migrations", async () => {
		await runMigrations(db);
		const applied = await getAppliedMigrations(db);
		assert.ok(applied.length >= 2);
	});

	it("migrations create expected tables", async () => {
		// Verify tables exist by querying pg_catalog
		const tables = await db.introspection.getTables();
		const tableNames = tables.map((t: any) => t.name);

		assert.ok(tableNames.includes("projects"), "projects table exists");
		assert.ok(tableNames.includes("plan_executions"), "plan_executions table exists");
		assert.ok(tableNames.includes("workspace_executions"), "workspace_executions table exists");
		assert.ok(tableNames.includes("journal_events"), "journal_events table exists");
		assert.ok(tableNames.includes("workspace_logs"), "workspace_logs table exists");
	});

	it("rolls back migrations", async () => {
		await rollbackMigrations(db, 1);
		const applied = await getAppliedMigrations(db);
		assert.ok(applied.length >= 1);
	});

	it("can re-run migrations after rollback", async () => {
		await runMigrations(db);
		const applied = await getAppliedMigrations(db);
		assert.ok(applied.length >= 2);
	});
});
