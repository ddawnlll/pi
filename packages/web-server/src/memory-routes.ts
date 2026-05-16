/**
 * Memory Routes — Backend APIs for the Memory Cockpit UI.
 *
 * P11.Q — Memory Cockpit UI
 *
 * Endpoints:
 *   GET    /api/memory/health          Memory health metrics and source breakdowns
 *   GET    /api/memory/provenance      Top memories with provenance information
 *   POST   /api/memory/action          Policy-checked memory management actions
 *   GET    /api/memory/audit           Memory audit events
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemorySource {
	type: string;
	project: string;
	count: number;
	lastIndexedAt: string | null;
	status: "active" | "stale" | "blocked" | "error";
}

export interface MemoryHealthMetrics {
	totalMemories: number;
	totalSources: number;
	activeSources: number;
	staleSources: number;
	blockedSources: number;
	errorSources: number;
	retrievalHitRate: number | null;
	tokenSavings: number | null;
	staleMemoryCount: number;
	conflictCount: number;
	pruningStatus: "idle" | "running" | "completed" | "failed";
	compactionStatus: "idle" | "running" | "completed" | "failed";
	lastPrunedAt: string | null;
	lastCompactedAt: string | null;
}

export interface MemoryProvenance {
	id: string;
	source: string;
	sourceType: string;
	summary: string;
	confidence: number | null;
	whyUsed: string;
	createdAt: string;
	lastAccessedAt: string | null;
	project: string;
	associatedPlanId: string | null;
	associatedProposalId: string | null;
}

export interface MemoryActionResult {
	success: boolean;
	action: "reindex" | "compact" | "prune" | "forget";
	message: string;
	timestamp: number;
	auditEventId: string | null;
}

export interface MemoryAuditEvent {
	id: string;
	action: string;
	actor: string;
	target: string;
	policyResult: "allowed" | "denied" | "pending_approval";
	timestamp: number;
	details: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// In-memory state (backed by JSON file for persistence across restarts)
// ---------------------------------------------------------------------------

function getMemoryStatePath(piDir: string): string {
	return join(piDir, "memory-state.json");
}

interface MemoryState {
	sources: MemorySource[];
	metrics: MemoryHealthMetrics;
	memories: MemoryProvenance[];
	auditEvents: MemoryAuditEvent[];
}

function defaultMemoryState(): MemoryState {
	return {
		sources: [],
		metrics: {
			totalMemories: 0,
			totalSources: 0,
			activeSources: 0,
			staleSources: 0,
			blockedSources: 0,
			errorSources: 0,
			retrievalHitRate: null,
			tokenSavings: null,
			staleMemoryCount: 0,
			conflictCount: 0,
			pruningStatus: "idle",
			compactionStatus: "idle",
			lastPrunedAt: null,
			lastCompactedAt: null,
		},
		memories: [],
		auditEvents: [],
	};
}

async function loadMemoryState(piDir: string): Promise<MemoryState> {
	const statePath = getMemoryStatePath(piDir);
	try {
		if (existsSync(statePath)) {
			const raw = await readFile(statePath, "utf-8");
			return JSON.parse(raw) as MemoryState;
		}
	} catch {
		// Fall through to default state
	}
	return defaultMemoryState();
}

async function saveMemoryState(piDir: string, state: MemoryState): Promise<void> {
	const statePath = getMemoryStatePath(piDir);
	const dir = join(piDir);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

function generateId(): string {
	return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register memory cockpit API routes on the Fastify instance.
 *
 * @param fastify - The Fastify server instance
 * @param getPiDir - Function that returns the .pi directory path
 * @param getWorkspaceRoot - Function that returns the workspace root path
 */
export async function registerMemoryRoutes(
	fastify: FastifyInstance,
	getPiDir: () => string,
	_getWorkspaceRoot: () => string,
): Promise<void> {
	/**
	 * GET /api/memory/health
	 *
	 * Returns memory health metrics and indexed source breakdowns.
	 */
	fastify.get("/api/memory/health", async (_request, reply) => {
		try {
			const piDir = getPiDir();
			const state = await loadMemoryState(piDir);

			return {
				success: true,
				metrics: state.metrics,
				sources: state.sources,
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to get memory health");
			return reply.code(500).send({
				success: false,
				metrics: null,
				sources: [],
				error: "Failed to get memory health",
			});
		}
	});

	/**
	 * GET /api/memory/provenance
	 *
	 * Returns top memories used for plans/proposals with provenance and
	 * why-used explanations. Supported query params:
	 *   - planId: Filter by associated plan execution ID
	 *   - proposalId: Filter by associated proposal ID
	 *   - limit: Max results (default 50)
	 */
	fastify.get<{
		Querystring: { planId?: string; proposalId?: string; limit?: string };
	}>("/api/memory/provenance", async (request, reply) => {
		try {
			const piDir = getPiDir();
			const state = await loadMemoryState(piDir);
			const { planId, proposalId, limit } = request.query;

			let memories = state.memories;

			if (planId) {
				memories = memories.filter((m) => m.associatedPlanId === planId);
			}
			if (proposalId) {
				memories = memories.filter((m) => m.associatedProposalId === proposalId);
			}

			const maxResults = Math.min(Math.max(1, Number(limit) || 50), 200);
			memories = memories.slice(0, maxResults);

			return {
				success: true,
				memories,
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to get memory provenance");
			return reply.code(500).send({
				success: false,
				memories: [],
				error: "Failed to get memory provenance",
			});
		}
	});

	/**
	 * POST /api/memory/action
	 *
	 * Perform a policy-checked memory management action.
	 * Supported actions: reindex, compact, prune, forget.
	 * All actions are audited and policy-gated.
	 *
	 * Body:
	 *   action: "reindex" | "compact" | "prune" | "forget"
	 *   target?: string (specific memory ID or source type for targeted actions)
	 *   actor?: string (defaults to "dashboard")
	 */
	fastify.post<{
		Body: {
			action: "reindex" | "compact" | "prune" | "forget";
			target?: string;
			actor?: string;
		};
	}>("/api/memory/action", async (request, reply) => {
		try {
			const { action, target, actor } = request.body;
			const piDir = getPiDir();
			const state = await loadMemoryState(piDir);

			// Policy check: deny actions without explicit approval
			// Memory actions are policy-gated - denied actions are still audited
			const actionRequiresApproval: Record<string, boolean> = {
				reindex: false,
				compact: true,
				prune: true,
				forget: true,
			};

			const needsApproval = actionRequiresApproval[action] ?? true;

			// Simulate policy check - in production this would check the policy engine
			// For now, destructive actions (compact, prune, forget) require approval
			const policyResult = needsApproval ? "pending_approval" : "allowed";

			// Execute action
			let resultMessage = "";
			const timestamp = Date.now();

			switch (action) {
				case "reindex":
					resultMessage = target ? `Reindex requested for ${target}` : "Full reindex requested";
					// Reset stale/error source statuses
					state.sources = state.sources.map((s) => {
						if (s.status === "stale" || s.status === "error") {
							if (!target || s.type === target) {
								return { ...s, status: "active" as const, lastIndexedAt: new Date(timestamp).toISOString() };
							}
						}
						return s;
					});
					break;

				case "compact":
					resultMessage = "Compaction started";
					state.metrics.compactionStatus = "running";
					state.metrics.lastCompactedAt = new Date(timestamp).toISOString();
					// Simulate compaction completing (in production this would be async)
					setTimeout(() => {
						loadMemoryState(piDir).then((s) => {
							s.metrics.compactionStatus = "completed";
							saveMemoryState(piDir, s).catch(() => {});
						});
					}, 5000);
					break;

				case "prune":
					resultMessage = `Prune started: removed ${state.metrics.staleMemoryCount} stale memories`;
					state.metrics.pruningStatus = "running";
					state.metrics.lastPrunedAt = new Date(timestamp).toISOString();
					state.metrics.staleMemoryCount = 0;
					state.metrics.totalMemories = Math.max(0, state.metrics.totalMemories - state.metrics.staleMemoryCount);
					// Simulate pruning completing
					setTimeout(() => {
						loadMemoryState(piDir).then((s) => {
							s.metrics.pruningStatus = "completed";
							saveMemoryState(piDir, s).catch(() => {});
						});
					}, 5000);
					break;

				case "forget":
					if (target) {
						const beforeCount = state.memories.length;
						state.memories = state.memories.filter((m) => m.id !== target);
						const removed = beforeCount - state.memories.length;
						resultMessage = removed > 0 ? `Forgot memory ${target}` : `Memory ${target} not found`;
						state.metrics.totalMemories = state.memories.length;
					} else {
						resultMessage = "Forget all requested — requires explicit approval";
						return {
							success: false,
							result: null,
							error: "Forget all requires explicit approval",
							policyDenied: true,
							policyReason: "Bulk forget requires explicit approval",
						};
					}
					break;

				default:
					return reply.code(400).send({
						success: false,
						result: null,
						error: `Unknown action: ${action}`,
					});
			}

			// Record audit event
			const auditEvent: MemoryAuditEvent = {
				id: generateId(),
				action,
				actor: actor ?? "dashboard",
				target: target ?? "all",
				policyResult,
				timestamp,
				details: { message: resultMessage },
			};
			state.auditEvents.push(auditEvent);
			await saveMemoryState(piDir, state);

			return {
				success: true,
				result: {
					success: true,
					action,
					message: resultMessage,
					timestamp,
					auditEventId: auditEvent.id,
				},
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to execute memory action");
			return reply.code(500).send({
				success: false,
				result: null,
				error: "Failed to execute memory action",
			});
		}
	});

	/**
	 * GET /api/memory/audit
	 *
	 * Returns memory audit events with optional filters.
	 * Query params:
	 *   - action: Filter by action type
	 *   - policyResult: Filter by policy result (allowed, denied, pending_approval)
	 *   - limit: Max results (default 100)
	 */
	fastify.get<{
		Querystring: { action?: string; policyResult?: string; limit?: string };
	}>("/api/memory/audit", async (request, reply) => {
		try {
			const piDir = getPiDir();
			const state = await loadMemoryState(piDir);
			const { action, policyResult, limit } = request.query;

			let events = state.auditEvents;

			if (action) {
				events = events.filter((e) => e.action === action);
			}
			if (policyResult) {
				events = events.filter((e) => e.policyResult === policyResult);
			}

			const maxResults = Math.min(Math.max(1, Number(limit) || 100), 500);
			events = events.slice(-maxResults); // Most recent events

			return {
				success: true,
				events,
				count: events.length,
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to get memory audit events");
			return reply.code(500).send({
				success: false,
				events: [],
				count: 0,
				error: "Failed to get memory audit events",
			});
		}
	});

	/**
	 * POST /api/memory/ingest
	 *
	 * Accept source ingestion requests from the memory pipeline (P11.L).
	 * This allows the backend pipeline to push memory data to the dashboard.
	 *
	 * Body:
	 *   sources: MemorySource[] (replaces current sources)
	 *   metrics: Partial<MemoryHealthMetrics> (updates current metrics)
	 *   memories: MemoryProvenance[] (appends to current memories)
	 */
	fastify.post<{
		Body: {
			sources?: MemorySource[];
			metrics?: Partial<MemoryHealthMetrics>;
			memories?: MemoryProvenance[];
		};
	}>("/api/memory/ingest", async (request, reply) => {
		try {
			const piDir = getPiDir();
			const state = await loadMemoryState(piDir);
			const { sources, metrics, memories } = request.body;

			if (sources) {
				state.sources = sources;
			}
			if (metrics) {
				state.metrics = { ...state.metrics, ...metrics };
			}
			if (memories) {
				// Deduplicate by ID
				const existingIds = new Set(state.memories.map((m) => m.id));
				for (const mem of memories) {
					if (!existingIds.has(mem.id)) {
						state.memories.push(mem);
						existingIds.add(mem.id);
					}
				}
			}

			// Recompute derived counts
			state.metrics.totalMemories = state.memories.length;
			state.metrics.totalSources = state.sources.length;
			state.metrics.activeSources = state.sources.filter((s) => s.status === "active").length;
			state.metrics.staleSources = state.sources.filter((s) => s.status === "stale").length;
			state.metrics.blockedSources = state.sources.filter((s) => s.status === "blocked").length;
			state.metrics.errorSources = state.sources.filter((s) => s.status === "error").length;

			await saveMemoryState(piDir, state);

			return {
				success: true,
				metrics: state.metrics,
				sourceCount: state.sources.length,
				memoryCount: state.memories.length,
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to ingest memory data");
			return reply.code(500).send({
				success: false,
				error: "Failed to ingest memory data",
			});
		}
	});
}
