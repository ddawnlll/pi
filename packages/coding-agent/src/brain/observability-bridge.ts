/**
 * Observability-to-Brain Bridge — P41.1-HOTFIX
 *
 * Bridges the execution observability system (ObservabilityEvent with TraceContext)
 * into the brain activity timeline (BrainTimelineEvent in InMemoryBrainTimelineStore).
 *
 * Every execution observability event that carries a traceId, workspaceId, or
 * planExecId is mapped to a BrainTimelineEvent and appended to the brain store.
 * This ensures that execution lifecycle events (workspace start, completion, failure)
 * appear in the Brain Activity dashboard.
 */

import { randomUUID } from "node:crypto";
import { getBrainStore } from "./api.js";
import type { Severity, TimelineEventType } from "./types.js";

// ---------------------------------------------------------------------------
// Bridge configuration
// ---------------------------------------------------------------------------

export interface ObservabilityBridgeConfig {
	/** If true, bridge is disabled. Events are not forwarded to brain store. */
	disabled?: boolean;
	/** Minimum severity to bridge. Events below this are skipped. */
	minSeverity?: "debug" | "info" | "warning" | "error" | "critical";
}

// ---------------------------------------------------------------------------
// ObservabilityEvent shape (imported from observability/types.ts but defined
// here for loose coupling — avoids circular dependency)
// ---------------------------------------------------------------------------

interface BridgeSourceEvent {
	id: string;
	timestamp: string;
	eventType: string;
	source: string;
	severity: "debug" | "info" | "warning" | "error" | "critical";
	status: "ok" | "error" | "running" | "unknown";
	name: string;
	message: string | null;
	traceId: string;
	planExecutionId: string | null;
	workspaceExecutionId: string | null;
	projectId: string | null;
	durationMs: number | null;
	data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

const SEVERITY_MAP: Record<string, Severity> = {
	debug: "info",
	info: "info",
	warning: "warning",
	error: "critical",
	critical: "critical",
};

function mapSeverity(obsSeverity: string): Severity {
	return SEVERITY_MAP[obsSeverity] ?? "info";
}

// ---------------------------------------------------------------------------
// Event type mapping
// ---------------------------------------------------------------------------

function mapEventType(eventType: string): TimelineEventType {
	// Map observability event types to brain timeline event types
	if (eventType.includes("workspace")) return "observation";
	if (eventType.includes("plan")) return "observation";
	if (eventType.includes("daemon")) return "daemon_heartbeat";
	if (eventType.includes("memory")) return "observation";
	if (eventType.includes("proposal")) return "signal";
	return "observation";
}

// ---------------------------------------------------------------------------
// Bridge class
// ---------------------------------------------------------------------------

export class ObservabilityBridge {
	private config: Required<ObservabilityBridgeConfig>;
	private enabled = true;

	constructor(config: ObservabilityBridgeConfig = {}) {
		this.config = {
			disabled: config.disabled ?? false,
			minSeverity: config.minSeverity ?? "info",
		};
		if (this.config.disabled) {
			this.enabled = false;
		}
	}

	/** Enable the bridge. */
	enable(): void {
		this.enabled = !this.config.disabled;
	}

	/** Disable the bridge (no brain events forwarded). */
	disable(): void {
		this.enabled = false;
	}

	/** Check if bridge is active. */
	isEnabled(): boolean {
		return this.enabled;
	}

	/** Get the brain store this bridge writes to (for tests). */
	getStore() {
		return getBrainStore();
	}

	/**
	 * Bridge an execution observability event into the brain timeline store.
	 *
	 * Preserves traceId, maps planExecutionId -> planExecId,
	 * maps workspaceExecutionId -> workspaceId, and maps event type/status/severity.
	 *
	 * @returns The ID of the created brain timeline event, or null if skipped.
	 */
	async bridgeEvent(sourceEvent: BridgeSourceEvent, runId?: string, phase?: string): Promise<string | null> {
		if (!this.enabled) return null;

		const minLevels: Record<string, number> = { debug: 0, info: 1, warning: 2, error: 3, critical: 4 };
		const eventLevel = minLevels[sourceEvent.severity] ?? 1;
		const minLevel = minLevels[this.config.minSeverity] ?? 0;
		if (eventLevel < minLevel) return null;

		// Extract identity from event
		const planExecId = sourceEvent.planExecutionId ?? runId ?? "unknown-plan";
		const workspaceId = sourceEvent.workspaceExecutionId ?? "unknown-workspace";
		const traceId = sourceEvent.traceId ?? randomUUID();
		const effectiveRunId = runId ?? sourceEvent.planExecutionId ?? "unknown-run";
		const effectivePhase = phase ?? "unknown";

		const store = getBrainStore();
		const eventType: TimelineEventType = mapEventType(sourceEvent.eventType);
		const severity: Severity = mapSeverity(sourceEvent.severity);

		const eventId = randomUUID();

		const data: Record<string, unknown> = {
			// P41.1-HOTFIX: Identity preserved from observability event
			runId: effectiveRunId,
			workspaceId,
			planExecId,
			traceId,
			phase: effectivePhase,
			type: eventType,
			status: sourceEvent.status === "ok" ? "completed" : sourceEvent.status === "error" ? "failed" : "progress",
			title: sourceEvent.name,
			description: sourceEvent.message ?? "",
			source: sourceEvent.source,
			durationMs: sourceEvent.durationMs,
			// Original event data preserved
			observabilityEventId: sourceEvent.id,
			observabilityEventType: sourceEvent.eventType,
			observabilityStatus: sourceEvent.status,
		};

		await store.append({
			id: eventId,
			eventType,
			timestamp: sourceEvent.timestamp,
			data,
			workspaceId,
			planExecId,
			severity,
		});

		return eventId;
	}
}

/** Singleton instance for the bridge. */
let _bridge: ObservabilityBridge | null = null;

export function getObservabilityBridge(): ObservabilityBridge {
	if (!_bridge) _bridge = new ObservabilityBridge({ disabled: false });
	return _bridge;
}

export function setObservabilityBridge(bridge: ObservabilityBridge): void {
	_bridge = bridge;
}
