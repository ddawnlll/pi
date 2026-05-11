#!/usr/bin/env node
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

import { closeKysely, getKysely } from "./kysely.js";
import { getAppliedMigrations, rollbackMigrations, runMigrations } from "./migrations/index.js";

async function main() {
	const command = process.argv[2] ?? "up";
	const db = getKysely();

	try {
		switch (command) {
			case "up":
				console.log("[migrate] Running pending migrations...");
				await runMigrations(db);
				console.log("[migrate] All migrations applied");
				break;

			case "down": {
				const steps = process.argv[3] ? Number.parseInt(process.argv[3], 10) : 1;
				console.log(`[migrate] Rolling back ${steps} migration(s)...`);
				await rollbackMigrations(db, steps);
				console.log("[migrate] Rollback complete");
				break;
			}

			case "status": {
				const applied = await getAppliedMigrations(db);
				if (applied.length === 0) {
					console.log("[migrate] No migrations have been applied");
				} else {
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
	} finally {
		await closeKysely();
	}
}

main().catch((err) => {
	console.error("[migrate] Fatal error:", err);
	process.exit(1);
});
