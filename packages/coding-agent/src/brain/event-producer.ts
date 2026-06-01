/**
 * Brain Activity Event Producer — P41.1-HOTFIX
 *
 * Deterministic event production for brain activity observability.
 * Provides both production-like seeding and deterministic test scenarios.
 *
 * This module is the runtime spine for Brain Activity: it writes
 * well-formed BrainActivityEvent records into the InMemoryBrainTimelineStore
 * so that the brain API read model and dashboard can consume them.
 */

import { randomUUID } from "node:crypto";
import { getBrainStore } from "./api.js";
import type { BrainActivityStatus, Severity, TimelineEventType } from "./types.js";

// ---------------------------------------------------------------------------
// Event producer configuration
// ---------------------------------------------------------------------------

export interface BrainEventProducerConfig {
	/** Default run identity applied to all events. */
	runId: string;
	/** Default workspace identity applied to all events. */
	workspaceId: string;
	/** Default plan execution identity. */
	planExecId: string;
	/** Trace identifier for the session. */
	traceId: string;
	/** Execution phase. */
	phase: string;
	/** Optional brain session ID. */
	brainSessionId?: string;
	/** Time delay between events in ms for simulated time progression. */
	stepDelayMs?: number;
}

/** Valid timeline event types that map to observation-style events. */
const _OBSERVATION_TYPES: TimelineEventType[] = ["observation", "signal", "reflection"];

/** Valid timeline event types for daemon lifecycle. */
const _DAEMON_TYPES: TimelineEventType[] = ["daemon_heartbeat", "daemon_start", "daemon_stop", "daemon_error"];

/**
 * Deterministic brain activity event producer.
 *
 * Writes BrainActivityEvent records into the InMemoryBrainTimelineStore
 * as legacy BrainTimelineEvent entries (with identity stored in data).
 * The getBrainState/getObservations/getSignals/getTimeline API functions
 * read from this same store, so seeded events are immediately visible.
 */
export class BrainEventProducer {
	private config: BrainEventProducerConfig;
	private eventIndex = 0;

	constructor(config: BrainEventProducerConfig) {
		this.config = config;
	}

	/** Return a fresh sequential trace ID for this producer. */
	private nextTraceId(): string {
		this.eventIndex++;
		return `${this.config.traceId}-${String(this.eventIndex).padStart(4, "0")}`;
	}

	/**
	 * Emit a brain activity event into the store.
	 * Writes as a BrainTimelineEvent with identity in data for backward compatibility
	 * with the existing timeline store and API.
	 */
	async emit(
		eventType: TimelineEventType,
		severity: Severity,
		title: string,
		description: string,
		status: BrainActivityStatus = "completed",
		payloadOverride?: Record<string, unknown>,
	): Promise<string> {
		const store = getBrainStore();
		const id = randomUUID();
		const traceId = this.nextTraceId();
		const timestamp = new Date(Date.now() + this.eventIndex).toISOString();

		const data: Record<string, unknown> = {
			// P41.1-HOTFIX: Required identity fields stored in data for API filtering
			runId: this.config.runId,
			workspaceId: this.config.workspaceId,
			planExecId: this.config.planExecId,
			traceId,
			brainSessionId: this.config.brainSessionId ?? null,
			type: eventType,
			phase: this.config.phase,
			status,
			title,
			description,
			source: "system" as const,
			...payloadOverride,
		};

		await store.append({
			id,
			eventType,
			timestamp,
			data,
			workspaceId: this.config.workspaceId,
			planExecId: this.config.planExecId,
			severity,
		});

		return id;
	}

	/**
	 * Emit a daemon lifecycle event.
	 */
	async emitDaemon(eventType: "daemon_start" | "daemon_stop" | "daemon_error" | "daemon_heartbeat"): Promise<string> {
		const severityMap: Record<string, Severity> = {
			daemon_start: "info",
			daemon_stop: "info",
			daemon_error: "critical",
			daemon_heartbeat: "info",
		};
		return this.emit(
			eventType,
			severityMap[eventType] ?? "info",
			`daemon ${eventType}`,
			`Daemon event: ${eventType}`,
			"completed",
		);
	}

	/**
	 * Emit a deterministic brain activity scenario suitable for E2E gauntlet testing.
	 *
	 * Produces a known sequence of events covering:
	 * - daemon lifecycle
	 * - observations (repo scan, memory, signal)
	 * - signals (queue blocked, failure pattern)
	 * - reflections
	 *
	 * Returns the list of event IDs in order for assertion purposes.
	 */
	async seedDeterministicScenario(): Promise<string[]> {
		const ids: string[] = [];

		// Daemon lifecycle
		ids.push(await this.emitDaemon("daemon_start"));
		ids.push(await this.emitDaemon("daemon_heartbeat"));

		// Observations
		ids.push(
			await this.emit(
				"observation",
				"info",
				"Repository scan started",
				"Scanning repository for changes",
				"started",
				{ signalType: "queue_blocked" },
			),
		);
		ids.push(
			await this.emit("observation", "info", "Repository scan completed", "Found 3 modified files", "completed", {
				signalType: "queue_blocked",
				fileCount: 3,
			}),
		);
		ids.push(
			await this.emit("observation", "warning", "Memory pressure detected", "Heap usage at 85%", "progress", {
				signalType: "failure_pattern",
				heapUsage: 85,
			}),
		);
		ids.push(
			await this.emit("observation", "info", "Workspace execution started", "Workspace W01 executing", "started", {
				signalType: "queue_blocked",
			}),
		);
		ids.push(
			await this.emit(
				"observation",
				"info",
				"Workspace execution completed",
				"Workspace W01 completed successfully",
				"completed",
				{ signalType: "queue_blocked" },
			),
		);

		// Signals
		ids.push(
			await this.emit(
				"signal",
				"warning",
				"Queue blocked detected",
				"3 workspaces blocked in integration queue",
				"progress",
				{ pattern: "queue_blocked:workspace:3", confidence: 0.8 },
			),
		);
		ids.push(
			await this.emit(
				"signal",
				"critical",
				"Retry hotspot detected",
				"Workspace retrying 3+ times with same failure",
				"progress",
				{ pattern: "retry_hotspot:workspace:W02", confidence: 0.95 },
			),
		);

		// Reflections
		ids.push(
			await this.emit(
				"reflection",
				"info",
				"Post-execution reflection",
				"Plan completed: 12/14 workspaces passed. 2 required manual intervention.",
				"completed",
				{ planSuccessRate: 0.857 },
			),
		);

		// Final heartbeat
		ids.push(await this.emitDaemon("daemon_heartbeat"));

		return ids;
	}

	/**
	 * Emit a minimal scenario (daemon start + one observation) for quick tests.
	 */
	async seedMinimalScenario(): Promise<string[]> {
		const ids: string[] = [];
		ids.push(await this.emitDaemon("daemon_start"));
		ids.push(
			await this.emit(
				"observation",
				"info",
				"Minimal test observation",
				"A single observation for testing",
				"completed",
			),
		);
		return ids;
	}
}

/**
 * Create a BrainEventProducer with the given config and seed a
 * deterministic scenario. Convenience for gauntlet setup.
 */
export async function createAndSeedProducer(
	config: BrainEventProducerConfig,
	scenario: "deterministic" | "minimal" = "deterministic",
): Promise<{ producer: BrainEventProducer; eventIds: string[] }> {
	const producer = new BrainEventProducer(config);
	const eventIds =
		scenario === "minimal" ? await producer.seedMinimalScenario() : await producer.seedDeterministicScenario();
	return { producer, eventIds };
}
