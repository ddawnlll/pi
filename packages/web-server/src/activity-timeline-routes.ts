/**
 * Activity Timeline Routes
 *
 * Aggregates recent activities from across the system into a unified
 * timeline feed for the Activity Timeline dashboard widget.
 *
 * Endpoints:
 *   GET /api/activity-timeline  — Returns recent activity events
 */

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityEvent {
	id: string;
	type: "plan_started" | "plan_completed" | "plan_failed" | "plan_paused" | "plan_stopped";
	timestamp: number;
	message: string;
	source: string;
	severity: "info" | "warn" | "error";
	projectId?: string;
	projectName?: string;
	planExecutionId?: string;
	data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Activity collection
// ---------------------------------------------------------------------------

/**
 * Collect recent activity events from available data sources.
 * Falls back to a reasonable set of default/generated entries when
 * full data sources are unavailable (e.g. no audit ledger).
 */
async function collectActivities(getStateStore: () => any): Promise<ActivityEvent[]> {
	const events: ActivityEvent[] = [];

	try {
		const stateStore = getStateStore();
		if (!stateStore) return buildFallbackEvents();

		// Collect plan execution events across all projects
		const projects = await stateStore.listProjects().catch(() => [] as any[]);

		for (const project of projects) {
			const plans = await stateStore.listPlanExecutions(project.id).catch(() => [] as any[]);

			for (const plan of plans) {
				const ts = plan.startedAt ? new Date(plan.startedAt).getTime() : Date.now();

				let type: ActivityEvent["type"];
				let severity: ActivityEvent["severity"] = "info";
				let message: string;

				switch (plan.status) {
					case "running":
					case "active":
						type = "plan_started";
						message = `Plan "${plan.title || plan.phase}" started`;
						break;
					case "complete":
						type = "plan_completed";
						message = `Plan "${plan.title || plan.phase}" completed`;
						break;
					case "failed":
						type = "plan_failed";
						severity = "error";
						message = `Plan "${plan.title || plan.phase}" failed`;
						break;
					case "paused":
						type = "plan_paused";
						severity = "warn";
						message = `Plan "${plan.title || plan.phase}" paused`;
						break;
					case "stopped":
					case "cancelled":
						type = "plan_stopped";
						severity = "warn";
						message = `Plan "${plan.title || plan.phase}" stopped`;
						break;
					default:
						continue; // skip unknown statuses
				}

				events.push({
					id: `plan-${plan.id}`,
					type,
					timestamp: ts,
					message,
					source: "plan_execution",
					severity,
					projectId: project.id,
					projectName: project.name,
					planExecutionId: plan.id,
					data: {
						phase: plan.phase,
						status: plan.status,
						completedAt: plan.completedAt,
					},
				});
			}
		}
	} catch {
		// If state store is unavailable, return fallback events
		return buildFallbackEvents();
	}

	// Sort by timestamp descending (newest first)
	events.sort((a, b) => b.timestamp - a.timestamp);

	// Limit to 50 most recent events
	return events.slice(0, 50);
}

/**
 * Build a small set of fallback events when the state store is unavailable.
 */
function buildFallbackEvents(): ActivityEvent[] {
	const now = Date.now();
	return [
		{
			id: "fallback-1",
			type: "plan_completed",
			timestamp: now - 60000,
			message: "No activity data sources available. The activity timeline requires a project with plan executions.",
			source: "system",
			severity: "info",
		},
	];
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerActivityTimelineRoutes(fastify: FastifyInstance, getStateStore: () => any): void {
	// GET /api/activity-timeline
	fastify.get("/api/activity-timeline", async (_request, _reply) => {
		const activities = await collectActivities(getStateStore);
		return { activities };
	});
}
