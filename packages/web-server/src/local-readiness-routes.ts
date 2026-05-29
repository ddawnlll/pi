/**
 * Local Readiness Routes — Dashboard endpoints for the Local Production
 * Readiness Doctor (Workspace 25.T).
 *
 * Endpoints:
 *   GET  /api/local-readiness/check
 *       Runs the local production readiness doctor and returns the full report.
 *
 *   GET  /api/local-readiness/status
 *       Returns a lightweight status summary (verdict + pass/warn/fail counts).
 *
 * The doctor checks:
 *   - Environment (Node.js, npm, TypeScript)
 *   - Git working tree cleanliness
 *   - Build health
 *   - Dependency health
 *   - Configuration files (CI/CD, .env.example, etc.)
 *   - Linting/formatting setup
 *   - Test framework configuration
 *   - Brain-worker budget controls, cooldowns, and loop prevention (25.R)
 */

import { join } from "node:path";
import type { SettingsManager, Workspace, WorkspaceQueue } from "@earendil-works/pi-coding-agent";
import { ProductionReadinessDoctor as LocalProductionReadinessDoctor } from "@earendil-works/pi-coding-agent";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Lightweight status summary for the dashboard panel.
 */
export interface LocalReadinessStatus {
	/** Overall verdict: PASS / WARN / FAIL */
	verdict: "PASS" | "WARN" | "FAIL";
	/** Number of passed checks */
	passCount: number;
	/** Number of warnings */
	warnCount: number;
	/** Number of failures */
	failCount: number;
	/** Whether the environment is ready for production execution */
	autoRunReady: boolean;
	/** Timestamp of the last check (ISO 8601) */
	timestamp: string;
	/** Evidence-backed diagnostics summary */
	diagnostics: string[];
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

/**
 * Register local readiness doctor API routes.
 *
 * @param fastify - Fastify instance
 * @param getPiDir - Function that returns the pi agent config directory path
 * @param getWorkspaceRoot - Function that returns the workspace root path
 * @param getSettingsManager - Function that returns the settings manager
 */
export async function registerLocalReadinessRoutes(
	fastify: FastifyInstance,
	getPiDir: () => string,
	getWorkspaceRoot: () => string,
	_getSettingsManager: () => SettingsManager,
): Promise<void> {
	// -----------------------------------------------------------------------
	// GET /api/local-readiness/check — Full doctor report
	// -----------------------------------------------------------------------

	fastify.get("/api/local-readiness/check", async (_request, reply) => {
		try {
			const workspaceRoot = getWorkspaceRoot();
			const piDir = getPiDir();

			const doctor = new LocalProductionReadinessDoctor();
			const dummyQueue: WorkspaceQueue = {
				phase: "local",
				title: "Local Readiness Check",
				maxParallelWorkspaces: 1,
				workspaces: [],
			};
			const report = await doctor.run(
				dummyQueue,
				workspaceRoot,
				piDir,
				{ skipGitCheck: false },
			);

			return report;
		} catch (error) {
			fastify.log.error({ error }, "Failed to run local production readiness doctor");
			return reply.code(500).send({
				error: "Failed to run local production readiness check",
				message: String(error),
			});
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/local-readiness/status — Lightweight status summary
	// -----------------------------------------------------------------------

	fastify.get("/api/local-readiness/status", async (_request, reply) => {
		try {
			const workspaceRoot = getWorkspaceRoot();

			const doctor = new LocalProductionReadinessDoctor();
			const dummyQueue = {
				phase: "local",
				title: "Local Readiness Check",
				maxParallelWorkspaces: 1,
				workspaces: [] as Workspace[],
			} satisfies WorkspaceQueue;
			const report = await doctor.run(
				dummyQueue,
				workspaceRoot,
				"",
				{ skipGitCheck: false },
			);

			const status: LocalReadinessStatus = {
				verdict: report.verdict,
				passCount: report.passCount,
				warnCount: report.warnCount,
				failCount: report.failCount,
				autoRunReady: report.autoRunReady,
				timestamp: report.timestamp,
				diagnostics: report.checks
					.filter((c) => c.status === "FAIL" || c.status === "WARN")
					.map((c) => `[${c.status}] ${c.message}`),
			};

			return status;
		} catch (error) {
			fastify.log.error({ error }, "Failed to get local readiness status");
			return reply.code(500).send({
				verdict: "FAIL",
				passCount: 0,
				warnCount: 0,
				failCount: 1,
				autoRunReady: false,
				timestamp: new Date().toISOString(),
				diagnostics: [`Doctor execution failed: ${String(error)}`],
			});
		}
	});
}
