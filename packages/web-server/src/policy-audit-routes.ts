/**
 * Policy & Audit Routes — P11.R
 *
 * Policy decisions, protected systems, and audit timeline backend routes.
 *
 * Endpoints:
 *   GET  /api/policy-audit/events  — List audit events
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";

export function registerPolicyAuditRoutes(fastify: FastifyInstance): void {
	function getDataDir(): string {
		const dir = resolve(process.cwd(), ".pi", "audit");
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		return dir;
	}

	function getEventsPath(): string {
		return join(getDataDir(), "events.json");
	}

	function loadEvents() {
		const path = getEventsPath();
		if (!existsSync(path)) return [];
		try {
			return JSON.parse(readFileSync(path, "utf-8"));
		} catch {
			return [];
		}
	}

	function getSummary() {
		const events = loadEvents() as Array<{ outcome: string }>;
		const approved = events.filter((e) => e.outcome === "approved" || e.outcome === "allowed").length;
		const denied = events.filter((e) => e.outcome === "denied" || e.outcome === "rejected").length;
		const pending = events.filter((e) => e.outcome === "pending_approval").length;
		return {
			totalEvents: events.length,
			totalApproved: approved,
			totalDenied: denied,
			totalPending: pending,
			activeApprovals: pending,
			protectedSystems: [
				"Executor",
				"Validator",
				"Policy Engine",
				"Queue Manager",
				"Planner",
				"Orchestrator Runtime",
			],
		};
	}

	// GET /api/policy-audit/events
	fastify.get("/api/policy-audit/events", async (request) => {
		const query = request.query as Record<string, string>;
		const limit = parseInt(query.limit ?? "100", 10);
		let events = loadEvents() as any[];
		if (query.category) events = events.filter((e: any) => e.category === query.category);
		if (query.outcome) events = events.filter((e: any) => e.outcome === query.outcome);
		return { events: events.slice(0, limit), summary: getSummary() };
	});
}
