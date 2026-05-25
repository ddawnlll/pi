/**
 * Brain API — web-server-facing functions for all brain endpoints.
 *
 * Each function is a convenience wrapper that can work with a module-level
 * injected store or return sensible defaults. The web-server routes import
 * these via dynamic `import("@earendil-works/pi-coding-agent")`.
 */

import type { AuditEntry } from "./audit/ledger.js";
import { createAuditLedger } from "./audit/ledger.js";
import type { GoalStore } from "./goals/store.js";
import { GoalStore as GoalStoreClass } from "./goals/store.js";
import type { MemoryRecord } from "./memory/types.js";
import { InMemoryBrainTimelineStore } from "./timeline-store.js";
import type { BrainObservation, BrainSignal, BrainTimelineEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _brainStore: InMemoryBrainTimelineStore | null = null;
let _goalStore: GoalStore | null = null;
let _auditLedger: ReturnType<typeof createAuditLedger> | null = null;

// Per-project brain stores keyed by projectId
const _projectBrainStores = new Map<string, InMemoryBrainTimelineStore>();

/** Injected (or default-initialised) stores  */

export function getBrainStore(projectId?: string | null): InMemoryBrainTimelineStore {
	if (projectId) {
		let store = _projectBrainStores.get(projectId);
		if (!store) {
			store = new InMemoryBrainTimelineStore();
			_projectBrainStores.set(projectId, store);
		}
		return store;
	}
	if (!_brainStore) _brainStore = new InMemoryBrainTimelineStore();
	return _brainStore;
}
export function setBrainStore(s: InMemoryBrainTimelineStore, projectId?: string | null): void {
	if (projectId) {
		_projectBrainStores.set(projectId, s);
	} else {
		_brainStore = s;
	}
}

export function getGoalStore(): GoalStore {
	if (!_goalStore) _goalStore = new GoalStoreClass();
	return _goalStore;
}
export function setGoalStore(s: GoalStore): void {
	_goalStore = s;
}

function getAuditLedger() {
	if (!_auditLedger) _auditLedger = createAuditLedger();
	return _auditLedger;
}

// ---------------------------------------------------------------------------
// Types for web-server routes
// ---------------------------------------------------------------------------

export interface AuditEntriesResult {
	entries: AuditEntry[];
	total: number;
}
export interface AuditStatsResult {
	total: number;
	today: number;
	byAction: Record<string, number>;
	approvalRate: number;
}
export interface AutonomyProfileResult {
	level: number;
	levelLabel: string;
	emergencyStop: boolean;
	approvedActions: number;
	blockedActions: number;
	lastUpdated: string;
}
export interface MemoryListResult {
	memories: MemoryRecord[];
	total: number;
}
export interface MemoryStatsResult {
	total: number;
	byType: Record<string, number>;
	byLifecycle: Record<string, number>;
	averageConfidence: number;
}
export interface EmergencyStatusResult {
	stopped: boolean;
}
export interface PolicyRuleListResult {
	rules: unknown[];
	total: number;
}
export interface PolicyEvaluateResult {
	decision: string;
	explanation: string;
}

// ---------------------------------------------------------------------------
// Brain state API (moved here from brain/index.ts to avoid circular deps)
// ---------------------------------------------------------------------------

/** Aggregate daemon and observation/signal statistics. */
export interface BrainState {
	daemon: {
		state: string;
		uptime: string;
		observationCount: number;
	};
	observationStats: {
		total: number;
		bySeverity: Record<string, number>;
	};
	signalStats: {
		total: number;
		active: number;
		resolved: number;
		byType: Record<string, number>;
	};
}

/** Query options shared by observations, signals, and timeline list endpoints. */
export interface BrainQueryOptions {
	limit?: number;
	offset?: number;
	severity?: string;
	resolved?: boolean;
}

/** Query observations from the brain store. */
export interface BrainObservationsResult {
	observations: BrainObservation[];
	total: number;
}

/** Query signals from the brain store. */
export interface BrainSignalsResult {
	signals: BrainSignal[];
	total: number;
}

/** Query timeline events from the brain store. */
export interface BrainTimelineResult {
	events: BrainTimelineEvent[];
	total: number;
}

/**
 * Try to load orchestrator daemon health from the .pi/orchestrator/health.json file.
 */
async function tryLoadOrchestratorHealth(piDir: string): Promise<{
	state: "running" | "stopped" | "error";
	uptime: string;
	startedAt: string | null;
} | null> {
	try {
		const { readFile, existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		const healthPath = join(piDir, "orchestrator", "health.json");
		if (!existsSync(healthPath)) return null;

		const content = await new Promise<string>((resolve, reject) => {
			readFile(healthPath, "utf-8", (err, data) => {
				if (err) reject(err);
				else resolve(data);
			});
		});
		const health = JSON.parse(content);

		const daemonStatus = health.status as string;
		let state: "running" | "stopped" | "error" = "stopped";
		if (daemonStatus === "running") state = "running";
		else if (daemonStatus === "paused") state = "running"; // treat paused as running for display
		else if (daemonStatus === "error" || daemonStatus === "failed") state = "error";

		const startedAt: string | null = health.startedAt
			? new Date(health.startedAt).toISOString()
			: null;

		// Compute uptime
		let uptime = "0s";
		if (startedAt) {
			const startMs = new Date(startedAt).getTime();
			const elapsed = Date.now() - startMs;
			const hours = Math.floor(elapsed / 3600000);
			const mins = Math.floor((elapsed % 3600000) / 60000);
			const secs = Math.floor((elapsed % 60000) / 1000);
			if (hours > 0) uptime = `${hours}h ${mins}m`;
			else if (mins > 0) uptime = `${mins}m ${secs}s`;
			else uptime = `${secs}s`;
		}

		return { state, uptime, startedAt };
	} catch {
		return null;
	}
}

/**
 * Return the current brain daemon status and aggregate stats.
 *
 * If `piDir` is provided, attempts to read the orchestrator daemon health
 * file for real daemon state and uptime. Falls back to store-based inference.
 *
 * @param projectId - Optional project ID for per-project brain state
 * @param piDir - Optional .pi directory path for reading orchestrator health
 */
export async function getBrainState(projectId?: string | null, piDir?: string | null): Promise<BrainState> {
	const store = getBrainStore(projectId);
	const events = await store.list({ limit: 10000 });

	let observationCount = 0;
	let signalCount = 0;
	const bySeverity: Record<string, number> = {};
	const byType: Record<string, number> = {};

	let daemonStatus: "running" | "stopped" | "error" = "stopped";
	let uptime = "0s";

	// Try to get real daemon status from orchestrator health file
	let daemonStartedAt: string | null = null;
	if (piDir) {
		const orchHealth = await tryLoadOrchestratorHealth(piDir);
		if (orchHealth) {
			daemonStatus = orchHealth.state;
			uptime = orchHealth.uptime;
			daemonStartedAt = orchHealth.startedAt;
		}
	}

	// Fall back to store-based inference if no health file
	if (!daemonStartedAt) {
		for (const e of events) {
			if (e.eventType === "daemon_start") {
				daemonStatus = "running";
				if (!daemonStartedAt || e.timestamp < daemonStartedAt) {
					daemonStartedAt = e.timestamp;
				}
			}
			if (e.eventType === "daemon_stop") daemonStatus = "stopped";
			if (e.eventType === "daemon_error") daemonStatus = "error";
			if (e.eventType === "daemon_heartbeat") daemonStatus = "running";
		}

		if (daemonStartedAt) {
			const startMs = new Date(daemonStartedAt).getTime();
			const elapsed = Date.now() - startMs;
			const hours = Math.floor(elapsed / 3600000);
			const mins = Math.floor((elapsed % 3600000) / 60000);
			const secs = Math.floor((elapsed % 60000) / 1000);
			if (hours > 0) uptime = `${hours}h ${mins}m`;
			else if (mins > 0) uptime = `${mins}m ${secs}s`;
			else uptime = `${secs}s`;
		}
	}

	for (const e of events) {
		bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
		if (e.eventType === "observation") {
			observationCount++;
			const sigType = (e.data as Record<string, unknown> | undefined)?.signalType as string | undefined;
			if (sigType) byType[sigType] = (byType[sigType] ?? 0) + 1;
		}
		if (e.eventType === "signal") {
			signalCount++;
		}
	}

	return {
		daemon: { state: daemonStatus, uptime, observationCount },
		observationStats: { total: observationCount, bySeverity },
		signalStats: { total: signalCount, active: signalCount, resolved: 0, byType },
	};
}

/**
 * Return observations matching the given filters.
 * Observations are timeline events with eventType === "observation".
 *
 * @param options - Query options
 * @param projectId - Optional project ID for per-project observations
 */
export async function getObservations(
	options?: BrainQueryOptions,
	projectId?: string | null,
): Promise<BrainObservationsResult> {
	const store = getBrainStore(projectId);
	const events = await store.list({
		eventTypes: ["observation"],
		limit: options?.limit ?? 50,
		offset: options?.offset ?? 0,
	});

	const total = await store.count({
		eventTypes: ["observation"],
	});

	const observations: BrainObservation[] = events.map((e) => {
		const data = e.data as Record<string, unknown> | undefined;
		return {
			id: e.id,
			timestamp: e.timestamp,
			source: (data?.source as string) ?? "system",
			signalType: (data?.signalType as string) ?? "queue_blocked",
			severity: e.severity,
			title: (data?.title as string) ?? "",
			description: (data?.description as string) ?? "",
			evidence: [],
			provenance: {
				observationSources: [],
				derivationChain: [],
				confidence: 0,
				validatedBy: "system",
			},
			metadata: {},
		} as unknown as BrainObservation;
	});

	return { observations, total };
}

/**
 * Return signals matching the given filters.
 * Signals are timeline events with eventType === "signal".
 *
 * @param options - Query options
 * @param projectId - Optional project ID for per-project signals
 */
export async function getSignals(options?: BrainQueryOptions, projectId?: string | null): Promise<BrainSignalsResult> {
	const store = getBrainStore(projectId);
	const events = await store.list({
		eventTypes: ["signal"],
		limit: options?.limit ?? 50,
		offset: options?.offset ?? 0,
	});

	const total = await store.count({
		eventTypes: ["signal"],
	});

	const signals: BrainSignal[] = events.map((e) => {
		const data = e.data as Record<string, unknown> | undefined;
		return {
			id: e.id,
			observationIds: [],
			pattern: (data?.pattern as string) ?? "",
			summary: (data?.summary as string) ?? "",
			confidence: (data?.confidence as number) ?? 0,
			severity: e.severity,
			createdAt: e.timestamp,
			metadata: {},
		} as unknown as BrainSignal;
	});

	return { signals, total };
}

/**
 * Return timeline events matching the given filters.
 *
 * @param options - Query options
 * @param projectId - Optional project ID for per-project timeline
 */
export async function getTimeline(
	options?: BrainQueryOptions,
	projectId?: string | null,
): Promise<BrainTimelineResult> {
	const store = getBrainStore(projectId);
	const events = await store.list({
		limit: options?.limit ?? 50,
		offset: options?.offset ?? 0,
	});

	const total = await store.count();

	return { events, total };
}

// ---------------------------------------------------------------------------
// Audit API
// ---------------------------------------------------------------------------

export async function getAuditEntries(
	options?: {
		limit?: number;
		offset?: number;
		action?: string;
	},
	_projectId?: string | null,
): Promise<AuditEntriesResult> {
	try {
		const ledger = getAuditLedger();
		const query = options?.action ? { action: options.action } : {};
		const entries = await ledger.query(query);
		return {
			entries: entries.slice(options?.offset ?? 0, (options?.offset ?? 0) + (options?.limit ?? 50)),
			total: entries.length,
		};
	} catch {
		return { entries: [], total: 0 };
	}
}

export async function getAuditStats(_projectId?: string | null): Promise<AuditStatsResult> {
	try {
		const ledger = getAuditLedger();
		const stats = await ledger.getStats();
		const today = new Date().toISOString().slice(0, 10);
		return {
			total: stats.totalEntries,
			today: stats.byDate[today] ?? 0,
			byAction: stats.byActor,
			approvalRate: stats.totalEntries > 0 ? (stats.byDecision.allow ?? 0) / stats.totalEntries : 1,
		};
	} catch {
		return { total: 0, today: 0, byAction: {}, approvalRate: 1 };
	}
}

export async function getProvenance(
	targetId: string,
	_projectId?: string | null,
): Promise<{ targetId: string; chain: unknown[] } | null> {
	try {
		const ledger = getAuditLedger();
		const entries = await ledger.query({});
		const related = entries.filter(
			(e) =>
				e.id === targetId ||
				(e as unknown as Record<string, unknown>).proposalId === targetId ||
				(e as unknown as Record<string, unknown>).planExecId === targetId,
		);
		return { targetId, chain: related };
	} catch {
		return null;
	}
}

export async function explainDecision(targetId: string, _projectId?: string | null): Promise<string> {
	try {
		const provenance = await getProvenance(targetId);
		if (!provenance) return "No decision found for the given target.";
		return `Decision for ${targetId}: ${provenance.chain.length} related audit entr${provenance.chain.length === 1 ? "y" : "ies"} found.`;
	} catch {
		return "Unable to explain decision.";
	}
}

// ---------------------------------------------------------------------------
// Autonomy API
// ---------------------------------------------------------------------------

let _emergencyStop = false;

export async function getAutonomyProfile(_projectId?: string | null): Promise<AutonomyProfileResult> {
	return {
		level: 3,
		levelLabel: "Operator",
		emergencyStop: _emergencyStop,
		approvedActions: 0,
		blockedActions: 0,
		lastUpdated: new Date().toISOString(),
	};
}

export async function updateAutonomyProfile(
	_updates: Record<string, unknown>,
	_projectId?: string | null,
): Promise<AutonomyProfileResult> {
	return getAutonomyProfile();
}

export async function emergencyStop(_projectId?: string | null): Promise<void> {
	_emergencyStop = true;
}

export async function releaseStop(_projectId?: string | null): Promise<void> {
	_emergencyStop = false;
}

export async function getEmergencyStatus(_projectId?: string | null): Promise<EmergencyStatusResult> {
	return { stopped: _emergencyStop };
}

// ---------------------------------------------------------------------------
// Memory API
// ---------------------------------------------------------------------------

export async function getMemories(
	_options?: {
		limit?: number;
		offset?: number;
		search?: string;
		type?: string;
		lifecycle?: string;
		tags?: string[];
	},
	_projectId?: string | null,
): Promise<MemoryListResult> {
	return { memories: [], total: 0 };
}

export async function getMemoryStats(_projectId?: string | null): Promise<MemoryStatsResult> {
	return { total: 0, byType: {}, byLifecycle: {}, averageConfidence: 0 };
}

export async function getMemory(_id: string, _projectId?: string | null): Promise<MemoryRecord | null> {
	return null;
}

export async function createMemory(
	_input: {
		title: string;
		content: string;
		type?: string;
		tags?: string[];
		confidence?: number;
	},
	_projectId?: string | null,
): Promise<MemoryRecord> {
	throw new Error("Memory store not configured");
}

export async function updateMemory(
	_id: string,
	_updates: Record<string, unknown>,
	_projectId?: string | null,
): Promise<MemoryRecord> {
	throw new Error("Memory store not configured");
}

export async function deleteMemory(_id: string, _projectId?: string | null): Promise<void> {
	// no-op
}

export async function rejectMemory(id: string, _projectId?: string | null): Promise<{ id: string; status: string }> {
	return { id, status: "rejected" };
}

export async function activateMemory(id: string, _projectId?: string | null): Promise<{ id: string; status: string }> {
	return { id, status: "active" };
}

// ---------------------------------------------------------------------------
// Overnight API
// ---------------------------------------------------------------------------

export async function getOvernightHistory(_projectId?: string | null): Promise<unknown[]> {
	return [];
}

export async function cancelOvernight(_sessionId: string, _projectId?: string | null): Promise<{ success: boolean }> {
	return { success: true };
}

// ---------------------------------------------------------------------------
// Policy API
// ---------------------------------------------------------------------------

export async function getPolicyRules(_projectId?: string | null): Promise<PolicyRuleListResult> {
	return { rules: [], total: 0 };
}

export async function toggleRule(id: string, _projectId?: string | null): Promise<{ id: string; enabled: boolean }> {
	return { id, enabled: false };
}

export async function evaluateAction(
	action: string,
	_context?: Record<string, unknown>,
	_projectId?: string | null,
): Promise<PolicyEvaluateResult> {
	return { decision: "deny", explanation: `No policy engine configured. Action "${action}" denied by default.` };
}
