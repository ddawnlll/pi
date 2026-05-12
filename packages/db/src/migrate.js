#!/usr/bin/env node
"use strict";
/**
 * CLI migration tool.
 *
 * Provides CLI commands for running, rolling back, and checking migrations.
 *
 * Usage:
 *   node dist/migrate.js up        # Run pending migrations
 *   node dist/migrate.js down [N]  # Rollback N migrations (default: 1)
 *   node dist/migrate.js status    # Show migration status
 */
Object.defineProperty(exports, "__esModule", { value: true });
const kysely_js_1 = require("./kysely.js");
const index_js_1 = require("./migrations/index.js");
async function main() {
    var _a;
    const command = (_a = process.argv[2]) !== null && _a !== void 0 ? _a : "up";
    const db = (0, kysely_js_1.getKysely)();
    try {
        switch (command) {
            case "up":
                console.log("[migrate] Running pending migrations...");
                await (0, index_js_1.runMigrations)(db);
                console.log("[migrate] All migrations applied");
                break;
            case "down": {
                const steps = process.argv[3] ? Number.parseInt(process.argv[3], 10) : 1;
                console.log(`[migrate] Rolling back ${steps} migration(s)...`);
                await (0, index_js_1.rollbackMigrations)(db, steps);
                console.log("[migrate] Rollback complete");
                break;
            }
            case "status": {
                const applied = await (0, index_js_1.getAppliedMigrations)(db);
                if (applied.length === 0) {
                    console.log("[migrate] No migrations have been applied");
                }
                else {
                    console.log("[migrate] Applied migrations:");
                    for (const m of applied) {
                        console.log(`  ${m.version}: ${m.name} (${m.appliedAt})`);
                    }
                }
                break;
            }
            default:
                console.error(`[migrate] Unknown command: ${command}`);
                console.error("Usage: migrate {up|down [N]|status}");
                process.exit(1);
        }
    }
    finally {
        await (0, kysely_js_1.closeKysely)();
    }
}
main().catch((err) => {
    console.error("[migrate] Fatal error:", err);
    process.exit(1);
});
