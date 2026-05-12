"use strict";
/**
 * Migration runner.
 *
 * Manages schema migrations with ordered execution and rollback support.
 * Tracks applied migrations in a `_migrations` table.
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
exports.migrations = void 0;
exports.runMigrations = runMigrations;
exports.rollbackMigrations = rollbackMigrations;
exports.getAppliedMigrations = getAppliedMigrations;
// Import migrations
const m001 = __importStar(require("./001_initial.js"));
const m002 = __importStar(require("./002_listen_notify.js"));
const m003 = __importStar(require("./003_add_execution_log.js"));
/**
 * All registered migrations in version order.
 */
const migrations = [
    { version: 1, name: "initial", up: m001.up, down: m001.down },
    { version: 2, name: "listen_notify", up: m002.up, down: m002.down },
    { version: 3, name: "add_execution_log", up: m003.up, down: m003.down },
];
exports.migrations = migrations;
/**
 * Run all pending migrations.
 *
 * @param db - Kysely database instance
 */
async function runMigrations(db) {
    // Ensure migrations tracking table exists
    await db.schema
        .createTable("_migrations")
        .ifNotExists()
        .addColumn("version", "integer", (col) => col.primaryKey())
        .addColumn("name", "varchar(255)", (col) => col.notNull())
        .addColumn("applied_at", "timestamptz", (col) => col.notNull().defaultTo(db.fn("now")))
        .execute();
    // Get applied versions
    const applied = await db.selectFrom("_migrations").select("version").execute();
    const appliedVersions = new Set(applied.map((r) => r.version));
    // Run pending migrations in order
    for (const migration of migrations) {
        if (!appliedVersions.has(migration.version)) {
            console.log(`[db] Running migration ${migration.version}: ${migration.name}`);
            await migration.up(db);
            await db.insertInto("_migrations").values({ version: migration.version, name: migration.name }).execute();
            console.log(`[db] Migration ${migration.version} applied`);
        }
    }
}
/**
 * Rollback the last N migrations.
 *
 * @param db - Kysely database instance
 * @param steps - Number of migrations to rollback (default: 1)
 */
async function rollbackMigrations(db, steps = 1) {
    const applied = await db.selectFrom("_migrations").selectAll().orderBy("version", "desc").limit(steps).execute();
    for (const row of applied.reverse()) {
        const migration = migrations.find((m) => m.version === row.version);
        if (!migration) {
            console.warn(`[db] Unknown migration version ${row.version}, skipping rollback`);
            continue;
        }
        console.log(`[db] Rolling back migration ${migration.version}: ${migration.name}`);
        await migration.down(db);
        await db.deleteFrom("_migrations").where("version", "=", row.version).execute();
        console.log(`[db] Migration ${migration.version} rolled back`);
    }
}
/**
 * Get the list of applied migrations.
 *
 * @param db - Kysely database instance
 * @returns Array of applied migration info
 */
async function getAppliedMigrations(db) {
    try {
        return await db
            .selectFrom("_migrations")
            .select(["version", "name", "applied_at as appliedAt"])
            .orderBy("version", "asc")
            .execute();
    }
    catch (_a) {
        return [];
    }
}
