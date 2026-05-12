"use strict";
/**
 * Migration integration tests.
 *
 * These tests require a running PostgreSQL instance.
 * Set PGDATABASE=pi_test to use a test database.
 *
 * Run: npx tsx --test packages/db/test/migrations.test.ts
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const kysely_js_1 = require("../src/kysely.js");
const index_js_1 = require("../src/migrations/index.js");
const isIntegration = process.env.PGDATABASE === "pi_test";
(0, node_test_1.describe)("Migrations", { skip: !isIntegration }, () => {
    let db = null;
    (0, node_test_1.before)(async () => {
        db = (0, kysely_js_1.getKysely)();
    });
    (0, node_test_1.after)(async () => {
        await (0, kysely_js_1.closeKysely)();
    });
    (0, node_test_1.it)("runs all pending migrations", async () => {
        await (0, index_js_1.runMigrations)(db);
        const applied = await (0, index_js_1.getAppliedMigrations)(db);
        node_assert_1.default.ok(applied.length >= 2);
    });
    (0, node_test_1.it)("migrations create expected tables", async () => {
        // Verify tables exist by querying pg_catalog
        const tables = await db.introspection.getTables();
        const tableNames = tables.map((t) => t.name);
        node_assert_1.default.ok(tableNames.includes("projects"), "projects table exists");
        node_assert_1.default.ok(tableNames.includes("plan_executions"), "plan_executions table exists");
        node_assert_1.default.ok(tableNames.includes("workspace_executions"), "workspace_executions table exists");
        node_assert_1.default.ok(tableNames.includes("journal_events"), "journal_events table exists");
        node_assert_1.default.ok(tableNames.includes("workspace_logs"), "workspace_logs table exists");
    });
    (0, node_test_1.it)("rolls back migrations", async () => {
        await (0, index_js_1.rollbackMigrations)(db, 1);
        const applied = await (0, index_js_1.getAppliedMigrations)(db);
        node_assert_1.default.ok(applied.length >= 1);
    });
    (0, node_test_1.it)("can re-run migrations after rollback", async () => {
        await (0, index_js_1.runMigrations)(db);
        const applied = await (0, index_js_1.getAppliedMigrations)(db);
        node_assert_1.default.ok(applied.length >= 2);
    });
});
