/**
 * Worker Transcript Capture — P41.04
 *
 * Canonical types and contracts for capturing worker execution transcripts.
 *
 * A worker transcript is a sanitized, UI-safe sequence of events emitted by
 * a worker agent during workspace execution. Transcript events are derived
 * from the raw journal but with private chain-of-thought stripped and human-
 * readable summaries attached.
 *
 * Consumption path:
 *   Worker → JournalEvent → createWorkerTranscriptEvent() →
 *   IWorkerTranscriptStore.appendTranscriptEvent() → transcript.ndjson
 *   UI reads via SSE endpoint → WorkerTranscriptEvent[]
 *
 * DEPENDENCY NOTE:
 *   This module MUST NOT import from @earendil-works/pi-coding-agent.
 *   It is a platform contract consumed by both the coding-agent runtime
 *   and the web-ui dashboard.
 */

// ---------------------------------------------------------------------------
// Journal Event — source format for transcript derivation
// ---------------------------------------------------------------------------

/**
 * Minimal journal event shape consumed by transcript derivation.
 * This mirrors the journal event structure emitted by state stores
 * without importing the coding-agent's full JournalEvent type.
 */
export interface JournalEvent {
	type: string;
	timestamp: number;
	workspaceId?: string;
	data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Worker Transcript Event Types
// ---------------------------------------------------------------------------

/**
 * All known worker transcript event types.
 * These are sanitized, UI-safe event discriminants that describe what
 * happened during worker execution.
 */
export type WorkerTranscriptEventType =
	| "worker_status"
	| "worker_decision_summary"
	| "validation"
	| "blocker"
	| "tool_call"
	| "workspace_start"
	| "workspace_complete"
	| "workspace_failed"
	| "workspace_blocked"
	| "retry_attempt"
	| "plan_summary";

/**
 * Worker transcript event — a sanitized, UI-safe event emitted by the worker
 * during execution. Unlike raw chain-of-thought (which is never emitted),
 * these events are safe for dashboard rendering and archival.
 *
 * Archived to .pi/executions/{planExecId}/workspaces/{workspaceId}/transcript.ndjson
 */
export interface WorkerTranscriptEvent {
	/** Event type */
	type: WorkerTranscriptEventType;
	/** Timestamp (ms since epoch) */
	timestamp: number;
	/** Workspace ID the event belongs to */
	workspaceId: string;
	/** Human-readable summary (no private chain-of-thought) */
	summary: string;
	/** Event data (sanitized — no raw thinking/chain-of-thought content) */
	data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * Keys that are stripped from transcript event data to prevent leaking
 * private chain-of-thought content to the UI or archived transcripts.
 */
export const PRIVATE_DATA_KEYS: ReadonlySet<string> = new Set([
	"thinking",
	"thinkingContent",
	"chainOfThought",
	"rawThinking",
	"privateReasoning",
	"internalMonologue",
	"reasoning",
]);

/**
 * Sanitize event data for safe emission — strips private chain-of-thought fields.
 *
 * Recursively processes nested objects; arrays and primitives are preserved
 * as-is. Returns undefined when all fields are stripped.
 *
 * @param data - Raw event data
 * @returns Sanitized data safe for transcript archival and UI rendering
 */
export function sanitizeTranscriptData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (!data) return undefined;
	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (PRIVATE_DATA_KEYS.has(key)) continue;
		// Recursively sanitize nested objects
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			sanitized[key] = sanitizeTranscriptData(value as Record<string, unknown>);
		} else {
			sanitized[key] = value;
		}
	}
	return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

// ---------------------------------------------------------------------------
// Transcript event factory
// ---------------------------------------------------------------------------

/**
 * Create a worker transcript event from a journal event, adding sanitization
 * and a human-readable summary.
 *
 * @param event - Source journal event
 * @param summary - Human-readable summary of the event (use buildTranscriptSummary)
 * @returns Sanitized transcript event, or null if the event should not be recorded
 *          (e.g., no workspace ID, or it's a private thinking event)
 */
export function createWorkerTranscriptEvent(event: JournalEvent, summary: string): WorkerTranscriptEvent | null {
	if (!event.workspaceId) return null;
	// Never turn private-thinking events into transcript events
	if (event.type === "thinking" || event.type === "chain_of_thought") {
		return null;
	}
	return {
		type: event.type as WorkerTranscriptEventType,
		timestamp: event.timestamp,
		workspaceId: event.workspaceId,
		summary,
		data: sanitizeTranscriptData(event.data),
	};
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary string for a journal event.
 *
 * @param event - Journal event to summarize
 * @returns Readable summary string
 */
export function buildTranscriptSummary(event: JournalEvent): string {
	const ws = event.workspaceId ?? "unknown";
	switch (event.type) {
		case "worker_status":
			return `Worker ${ws}: ${(event.data?.status as string) ?? "unknown"}${event.data?.message ? ` \u2014 ${event.data.message}` : ""}`;
		case "worker_decision_summary":
			return `Worker ${ws} decision: ${(event.data?.summary as string) ?? "no summary"}`;
		case "validation": {
			const passed = event.data?.passed as boolean | undefined;
			const criterion = (event.data?.criterion as string) ?? "unknown";
			return `Worker ${ws} validation ${passed ? "passed" : "failed"}: ${criterion}`;
		}
		case "blocker":
			return `Worker ${ws} blocker: ${(event.data?.reason as string) ?? "unknown blocker"}`;
		case "tool_call":
			return `Worker ${ws} tool call: ${(event.data?.toolName as string) ?? "unknown"}`;
		case "workspace_start":
			return `Worker ${ws} started`;
		case "workspace_complete":
			return `Worker ${ws} completed`;
		case "workspace_failed":
			return `Worker ${ws} failed: ${(event.data?.error as string) ?? "unknown error"}`;
		case "workspace_blocked":
			return `Worker ${ws} blocked: ${(event.data?.reason as string) ?? "unknown"}`;
		case "retry_attempt":
			return `Worker ${ws} retry attempt ${(event.data?.attempt as number) ?? "?"}`;
		case "plan_summary":
			return `Plan summary: ${(event.data?.summary as string) ?? "no summary"}`;
		case "cleanup_workspace":
			return `Cleanup: ${(event.data?.message as string) ?? "running"}`;
		default:
			return `Worker ${ws} ${event.type}`;
	}
}

// ---------------------------------------------------------------------------
// IWorkerTranscriptStore — transcript persistence contract
// ---------------------------------------------------------------------------

/**
 * Transcript store contract for persisting and querying worker transcript events.
 *
 * Implementations may back to ndjson files (local), database tables (server),
 * or in-memory storage (testing).
 */
export interface IWorkerTranscriptStore {
	/**
	 * Append a single transcript event for a workspace.
	 *
	 * @param planExecutionId - Plan execution the workspace belongs to
	 * @param workspaceId - Workspace the event is scoped to
	 * @param event - The sanitized WorkerTranscriptEvent to persist
	 */
	appendTranscriptEvent(planExecutionId: string, workspaceId: string, event: WorkerTranscriptEvent): Promise<void>;

	/**
	 * Read all transcript events for a workspace in insertion order (oldest first).
	 *
	 * @param planExecutionId - Plan execution the workspace belongs to
	 * @param workspaceId - Workspace to read events for
	 * @returns Array of transcript events, empty if none exist
	 */
	readTranscriptEvents(planExecutionId: string, workspaceId: string): Promise<WorkerTranscriptEvent[]>;

	/**
	 * List workspace IDs that have at least one transcript event for a given plan execution.
	 *
	 * @param planExecutionId - Plan execution to query
	 * @returns Array of workspace IDs with transcript events
	 */
	listWorkspacesWithTranscript(planExecutionId: string): Promise<string[]>;

	/**
	 * Delete all transcript events for a given plan execution (used during cleanup).
	 *
	 * @param planExecutionId - Plan execution to clear
	 */
	deleteTranscriptEvents(planExecutionId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// InMemoryWorkerTranscriptStore — ephemeral transcript store for testing
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of IWorkerTranscriptStore.
 *
 * Transcript events are stored in a tri-level map:
 *   planExecutionId → workspaceId → WorkerTranscriptEvent[]
 *
 * All operations are async but synchronous in practice (JavaScript single-threaded).
 */
export class InMemoryWorkerTranscriptStore implements IWorkerTranscriptStore {
	/**
	 * planExecutionId → workspaceId → WorkerTranscriptEvent[]
	 */
	private readonly store: Map<string, Map<string, WorkerTranscriptEvent[]>> = new Map();

	async appendTranscriptEvent(
		planExecutionId: string,
		workspaceId: string,
		event: WorkerTranscriptEvent,
	): Promise<void> {
		if (!planExecutionId) {
			throw new Error("planExecutionId is required");
		}
		if (!workspaceId) {
			throw new Error("workspaceId is required");
		}

		let planStore = this.store.get(planExecutionId);
		if (!planStore) {
			planStore = new Map();
			this.store.set(planExecutionId, planStore);
		}

		let wsEvents = planStore.get(workspaceId);
		if (!wsEvents) {
			wsEvents = [];
			planStore.set(workspaceId, wsEvents);
		}

		wsEvents.push(event);
	}

	async readTranscriptEvents(planExecutionId: string, workspaceId: string): Promise<WorkerTranscriptEvent[]> {
		const planStore = this.store.get(planExecutionId);
		if (!planStore) return [];
		return planStore.get(workspaceId) ?? [];
	}

	async listWorkspacesWithTranscript(planExecutionId: string): Promise<string[]> {
		const planStore = this.store.get(planExecutionId);
		if (!planStore) return [];
		return Array.from(planStore.keys());
	}

	async deleteTranscriptEvents(planExecutionId: string): Promise<void> {
		this.store.delete(planExecutionId);
	}

	/**
	 * Clear all stored transcript events (primarily for testing).
	 */
	async clear(): Promise<void> {
		this.store.clear();
	}
}
