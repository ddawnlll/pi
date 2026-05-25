/**
 * Brain Digest Routes — 24.G — Overnight morning report to digest wiring
 *
 * Provides GET /digest which aggregates data from brain subsystems
 * (state, signals, observations, proposals, goals, reflections, overnight)
 * into the MorningDigest format consumed by the dashboard's DigestPage.
 *
 * Routes use relative paths so they can be registered under any prefix:
 * - Global: prefix "/api/brain" → /api/brain/digest
 * - Per-project: prefix "/api/projects/:projectId/brain" → /api/projects/:projectId/brain/digest
 *
 * Error handling: returns an empty digest with ok:false on failure,
 * never throws.
 */

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Types matching the dashboard's MorningDigest shape.
// Defined locally to avoid direct dependency on the coding-agent or web-ui.
// ---------------------------------------------------------------------------

type DaemonState = "running" | "stopped" | "paused" | "error";
type GoalStatus = "active" | "paused" | "complete" | "review";
type GoalPriority = "critical" | "high" | "normal" | "low";

interface BrainSignalDigest {
	id: string;
	type: string;
	title: string;
	severity: string;
	timestamp: string;
	resolved: boolean;
	resolvedAt?: string;
	details?: string;
}

interface BrainObservationDigest {
	id: string;
	title: string;
	description: string;
	severity: string;
	source: string;
	timestamp: string;
	resolved: boolean;
	tags?: string[];
}

interface ProposalDigest {
	id: string;
	title: string;
	description: string;
	score: number;
	riskLevel: string;
	status: string;
	evidence: {
		memories: number;
		observations: number;
	};
	createdAt: string;
	updatedAt?: string;
	rejectionReason?: string;
}

interface GoalProgressDigest {
	id: string;
	title: string;
	progress: number;
	status: GoalStatus;
	priority: GoalPriority;
}

interface ReflectionCountsDigest {
	total: number;
	today: number;
	newMemories: number;
}

interface MorningDigest {
	summary: {
		daemonState: DaemonState;
		daemonUptime: string;
		totalObservations: number;
		criticalObservations: number;
		activeSignals: number;
		pendingProposals: number;
		lastUpdated: string;
	};
	topSignals: BrainSignalDigest[];
	recentObservations: BrainObservationDigest[];
	pendingProposals: ProposalDigest[];
	goalProgress: GoalProgressDigest[];
	reflectionCounts: ReflectionCountsDigest;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapSeverity(s: string): string {
	if (s === "warning" || s === "warn") return "warning";
	if (s === "critical" || s === "error") return "critical";
	return "info";
}

function emptyDigest(): MorningDigest {
	return {
		summary: {
			daemonState: "stopped",
			daemonUptime: "0s",
			totalObservations: 0,
			criticalObservations: 0,
			activeSignals: 0,
			pendingProposals: 0,
			lastUpdated: new Date().toISOString(),
		},
		topSignals: [],
		recentObservations: [],
		pendingProposals: [],
		goalProgress: [],
		reflectionCounts: { total: 0, today: 0, newMemories: 0 },
	};
}

// ---------------------------------------------------------------------------
// Record-based helpers for duck-typed module access
// ---------------------------------------------------------------------------

function safeGet<T>(obj: Record<string, unknown> | undefined, key: string, fallback: T): T {
	if (!obj) return fallback;
	const val = obj[key];
	return (val as T) ?? fallback;
}

function safeGetNum(obj: Record<string, unknown> | undefined, key: string, fallback: number): number {
	if (!obj) return fallback;
	const val = obj[key];
	return typeof val === "number" ? val : fallback;
}

function safeGetStr(obj: Record<string, unknown> | undefined, key: string, fallback: string): string {
	if (!obj) return fallback;
	const val = obj[key];
	return typeof val === "string" ? val : fallback;
}

async function tryFn<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
	try {
		return await fn();
	} catch {
		return fallback;
	}
}

// ---------------------------------------------------------------------------
// Type-safe wrapper for the coding-agent module
// ---------------------------------------------------------------------------

/**
 * Safely extract named exports from the coding-agent module.
 * We duck-type the result for type safety without needing a type cast.
 */
function buildBrainApi(mod: Record<string, unknown>) {
	const api = {
		getBrainState: mod.getBrainState as
			| ((projectId?: string | null, piDir?: string | null) => Promise<Record<string, unknown>>)
			| undefined,
		getSignals: mod.getSignals as
			| ((options?: Record<string, unknown>, projectId?: string | null) => Promise<Record<string, unknown>>)
			| undefined,
		getObservations: mod.getObservations as
			| ((options?: Record<string, unknown>, projectId?: string | null) => Promise<Record<string, unknown>>)
			| undefined,
		getBrainStore: mod.getBrainStore as
			| ((projectId?: string | null) => {
					list: (opts?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
					count: (opts?: Record<string, unknown>) => Promise<number>;
			  })
			| undefined,
		getGoalStore: mod.getGoalStore as
			| (() => {
					initialize?: () => Promise<void>;
					list: (opts?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
			  })
			| undefined,
		SessionStore: mod.SessionStore as
			| (new () => {
					getAll: (limit?: number) => Array<Record<string, unknown>>;
			  })
			| undefined,
		MorningReportGenerator: mod.MorningReportGenerator as
			| (new (...args: unknown[]) => {
					generate: (session: Record<string, unknown>) => Promise<Record<string, unknown>>;
			  })
			| undefined,
	};
	return api;
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export async function registerBrainDigestRoutes(fastify: FastifyInstance): Promise<void> {
	// GET /digest — Full morning digest combining brain subsystems
	fastify.get("/digest", async (_request, reply) => {
		try {
			const { projectId } = _request.params as { projectId?: string };

			// Load brain API via dynamic import
			const mod = (await import("@earendil-works/pi-coding-agent")) as Record<string, unknown>;
			const api = buildBrainApi(mod);

			// 1. Get brain state (daemon, observations, signals)
			let brainState: Record<string, unknown> | undefined;
			if (api.getBrainState) {
				brainState = await tryFn(() => api.getBrainState!(projectId, null), undefined);
			}

			// 2. Get top signals (most recent, unresolved first)
			let signals: Array<Record<string, unknown>> = [];
			if (api.getSignals) {
				const result = await tryFn(
					() => api.getSignals!({ limit: 10, resolved: false }, projectId),
					{} as Record<string, unknown>,
				);
				signals = (result.signals as Array<Record<string, unknown>>) ?? [];
			}

			// 3. Get recent observations
			let observations: Array<Record<string, unknown>> = [];
			if (api.getObservations) {
				const result = await tryFn(
					() => api.getObservations!({ limit: 10 }, projectId),
					{} as Record<string, unknown>,
				);
				observations = (result.observations as Array<Record<string, unknown>>) ?? [];
			}

			// 4. Get pending proposals from the brain store
			let pendingProposals: ProposalDigest[] = [];
			if (api.getBrainStore) {
				try {
					const store = api.getBrainStore(projectId);
					const proposalEvents = await store.list({
						limit: 50,
						eventTypes: ["proposal"],
					});
					pendingProposals = proposalEvents
						.filter((e) => {
							const data = safeGet(e, "data", undefined) as Record<string, unknown> | undefined;
							const status = safeGetStr(data, "status", "pending");
							return status === "pending";
						})
						.slice(0, 10)
						.map((e) => {
							const data = (safeGet(e, "data", {}) as Record<string, unknown>) ?? {};
							return {
								id: safeGetStr(e, "id", ""),
								title: safeGetStr(data, "title", "Untitled Proposal"),
								description: safeGetStr(data, "description", ""),
								score: safeGetNum(data, "score", 50),
								riskLevel: safeGetStr(data, "riskLevel", "medium"),
								status: safeGetStr(data, "status", "pending"),
								evidence: {
									memories: safeGetNum(data, "evidenceMemories", 0),
									observations: safeGetNum(data, "evidenceObservations", 0),
								},
								createdAt: safeGetStr(e, "timestamp", new Date().toISOString()),
							};
						});
				} catch {
					// Non-fatal
				}
			}

			// 5. Get goals for goal progress
			let goalProgress: GoalProgressDigest[] = [];
			if (api.getGoalStore) {
				try {
					const goalStore = api.getGoalStore();
					if (goalStore.initialize) await tryFn(() => goalStore.initialize!(), undefined);
					const goals = await tryFn(() => goalStore.list(), []);
					goalProgress = (goals as Array<Record<string, unknown>>).slice(0, 10).map((g) => ({
						id: safeGetStr(g, "id", ""),
						title: safeGetStr(g, "title", ""),
						progress: safeGetNum(g, "progress", 0),
						status: (safeGetStr(g, "status", "active") as GoalStatus),
						priority: (safeGetStr(g, "priority", "normal") as GoalPriority),
					}));
				} catch {
					// Non-fatal
				}
			}

			// 6. Get overnight session data to fill in reflection counts
			let reflectionCounts: ReflectionCountsDigest = { total: 0, today: 0, newMemories: 0 };
			if (api.SessionStore && api.MorningReportGenerator) {
				try {
					const sessionStore = new api.SessionStore();
					const sessions = sessionStore.getAll(1);
					if (sessions.length > 0) {
						const lastSession = sessions[0];
						const generator = new api.MorningReportGenerator();
						const report = await generator.generate(lastSession);
						reflectionCounts = {
							total: (safeGetNum(report, "newReflectionsGenerated", 0) +
								safeGetNum(report, "plansCompleted", 0)),
							today: safeGetNum(report, "newReflectionsGenerated", 0),
							newMemories: safeGetNum(report, "newMemoriesCreated", 0),
						};
					}
				} catch {
					// Non-fatal
				}
			}

			// If no session data, try getting reflection counts from the brain store directly
			if (reflectionCounts.total === 0 && api.getBrainStore) {
				try {
					const store = api.getBrainStore(projectId);
					const todayEvents = await store.list({ eventTypes: ["reflection"] });
					const today = new Date().toISOString().slice(0, 10);
					const todaysReflections = todayEvents.filter(
						(e) => safeGetStr(e, "timestamp", "").slice(0, 10) === today,
					);
					reflectionCounts = {
						total: todayEvents.length,
						today: todaysReflections.length,
						newMemories: 0,
					};
				} catch {
					// Use defaults
				}
			}

			// 7. Extract daemon state from brain state
			const daemon = (safeGet(brainState, "daemon", {}) as Record<string, unknown>) ?? {};
			const daemonStateRaw = safeGetStr(daemon, "state", "stopped");
			const daemonState: DaemonState = daemonStateRaw === "running"
				? "running"
				: daemonStateRaw === "paused"
					? "paused"
					: daemonStateRaw === "error"
						? "error"
						: "stopped";

			const observationStats = (safeGet(brainState, "observationStats", {}) as Record<string, unknown>) ?? {};
			const bySeverity = (safeGet(observationStats, "bySeverity", {}) as Record<string, number>) ?? {};
			const signalStats = (safeGet(brainState, "signalStats", {}) as Record<string, unknown>) ?? {};

			// 8. Build the digest
			const digest: MorningDigest = {
				summary: {
					daemonState,
					daemonUptime: safeGetStr(daemon, "uptime", "0s"),
					totalObservations: safeGetNum(observationStats, "total", 0),
					criticalObservations: (safeGetNum(bySeverity, "critical", 0) +
						safeGetNum(bySeverity, "error", 0)),
					activeSignals: safeGetNum(signalStats, "active", signals.length),
					pendingProposals: pendingProposals.length,
					lastUpdated: new Date().toISOString(),
				},
				topSignals: signals.map((s) => ({
					id: safeGetStr(s, "id", ""),
					type: safeGetStr(s, "type", safeGetStr(s, "signalType", "other")),
					title: safeGetStr(s, "title", safeGetStr(s, "summary", "Unknown signal")),
					severity: mapSeverity(safeGetStr(s, "severity", "info")),
					timestamp: safeGetStr(s, "createdAt", safeGetStr(s, "timestamp", new Date().toISOString())),
					resolved: (s.resolved as boolean) ?? false,
					resolvedAt: (s.resolvedAt as string | undefined) ??
						(s.resolved_at as string | undefined),
					details: (s.details as string | undefined) ??
						(s.description as string | undefined),
				})),
				recentObservations: observations.map((o) => ({
					id: safeGetStr(o, "id", ""),
					title: safeGetStr(o, "title", "Unknown observation"),
					description: safeGetStr(o, "description", ""),
					severity: mapSeverity(safeGetStr(o, "severity", "info")),
					source: safeGetStr(o, "source", "system"),
					timestamp: safeGetStr(o, "timestamp", safeGetStr(o, "createdAt", new Date().toISOString())),
					resolved: (o.resolved as boolean) ?? false,
					tags: (o.tags as string[] | undefined) ?? undefined,
				})),
				pendingProposals,
				goalProgress,
				reflectionCounts,
			};

			return reply.send(digest);
		} catch (error) {
			fastify.log.error({ error }, "Failed to build morning digest");
			return reply.code(500).send({
				...emptyDigest(),
				_error: error instanceof Error ? error.message : "Unknown error",
				_ok: false,
			});
		}
	});
}
