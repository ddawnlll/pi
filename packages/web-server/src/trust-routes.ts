/**
 * Trust Dashboard Routes — P11.T (Trust Dashboard UI)
 *
 * Trust metrics, policy stops, safety interventions, approval requests,
 * and audit summary data for the Trust Dashboard UI.
 *
 * Endpoints:
 *   GET  /api/trust/metrics     — Trust metric summary
 *   GET  /api/trust/events      — Recent trust-relevant audit events
 */

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// In-memory default data (used when no audit ledger is available)
// ---------------------------------------------------------------------------

const DEFAULT_TRUST_METRICS = {
	totalAuditEntries: 0,
	policyStops: 0,
	approvalRequests: 0,
	safetyInterventions: 0,
	totalApproved: 0,
	totalDenied: 0,
	totalPending: 0,
	eventsByCategory: {} as Record<string, number>,
	eventsByOutcome: {} as Record<string, number>,
	eventsBySeverity: {} as Record<string, number>,
	topActors: [] as Array<{ actor: string; count: number }>,
	protectedSystems: [
		"Executor",
		"Validator",
		"Policy Engine",
		"Queue Manager",
		"Planner",
		"Orchestrator Runtime",
	],
	trustScore: 100,
	trustScoreHistory: [] as Array<{ date: string; score: number }>,
};

function getDefaultData() {
	return JSON.parse(JSON.stringify(DEFAULT_TRUST_METRICS));
}

// ---------------------------------------------------------------------------
// Try to load data from the PlatformAuditLedger (in-process singleton)
// ---------------------------------------------------------------------------

function getPlatformAuditLedger() {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require("@earendil-works/pi-coding-agent");
		return mod.getPlatformAuditLedger?.() ?? null;
	} catch {
		return null;
	}
}

function loadTrustMetrics(): typeof DEFAULT_TRUST_METRICS {
	try {
		const ledger = getPlatformAuditLedger();
		if (!ledger) return getDefaultData();

		const summary = ledger.getSummary();
		const allEvents = ledger.getAllEvents();

		// Count trust-relevant events
		const policyStops = allEvents.filter(
			(e: any) => e.category === "policy" || e.outcome === "denied",
		).length;
		const approvalRequests = allEvents.filter(
			(e: any) => e.outcome === "pending_approval",
		).length;
		const safetyInterventions = allEvents.filter(
			(e: any) =>
				e.severity === "critical" ||
				e.severity === "error" ||
				e.outcome === "denied",
		).length;

		// Calculate trust score (0-100)
		const total = summary.totalEvents || 1;
		const deniedOrFailed =
			(summary.eventsByOutcome.denied ?? 0) +
			(summary.eventsByOutcome.rejected ?? 0) +
			(summary.eventsByOutcome.failed ?? 0);
		const approvedOrAllowed =
			(summary.eventsByOutcome.approved ?? 0) +
			(summary.eventsByOutcome.allowed ?? 0);

		const trustScore = Math.round(
			Math.max(0, Math.min(100, ((total - deniedOrFailed) / total) * 100)),
		);

		return {
			totalAuditEntries: summary.totalEvents,
			policyStops,
			approvalRequests,
			safetyInterventions,
			totalApproved: approvedOrAllowed,
			totalDenied: deniedOrFailed,
			totalPending: approvalRequests,
			eventsByCategory: summary.eventsByCategory,
			eventsByOutcome: summary.eventsByOutcome,
			eventsBySeverity: summary.eventsBySeverity,
			topActors: summary.topActors,
			protectedSystems: [
				"Executor",
				"Validator",
				"Policy Engine",
				"Queue Manager",
				"Planner",
				"Orchestrator Runtime",
			],
			trustScore,
			trustScoreHistory: [],
		};
	} catch {
		return getDefaultData();
	}
}

function loadTrustEvents(limit: number) {
	try {
		const ledger = getPlatformAuditLedger();
		if (!ledger) return [];

		return ledger
			.getAllEvents()
			.slice(0, limit)
			.map((e: any) => ({
				id: e.id,
				category: e.category,
				severity: e.severity,
				outcome: e.outcome,
				timestamp: e.timestamp,
				actor: e.actor,
				target: e.target,
				message: e.message,
			}));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerTrustRoutes(fastify: FastifyInstance): void {
	// GET /api/trust/metrics
	fastify.get("/api/trust/metrics", async () => {
		return loadTrustMetrics();
	});

	// GET /api/trust/events
	fastify.get("/api/trust/events", async (request) => {
		const query = request.query as Record<string, string>;
		const limit = parseInt(query.limit ?? "50", 10);
		const events = loadTrustEvents(limit);
		return { events };
	});
}
