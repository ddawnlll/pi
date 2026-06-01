/**
 * Read Model Adapter — P42.01 Read Model Integration
 *
 * Bridges the web-server's IStateStore to the ExecutionReadModel from
 * execution-service. The adapter converts the state store's JournalEvent
 * format to the JournalEventEnvelope format expected by the read model.
 *
 * Usage:
 *   import { createReadModelAdapter } from "./read-model-adapter.js";
 *   import { createExecutionReadModel } from "@earendil-works/pi-execution-service";
 *
 *   const stateStore = getStateStore();
 *   const adapter = createReadModelAdapter(stateStore);
 *   const readModel = createExecutionReadModel(adapter);
 *
 *   const planSummary = await readModel.getPlanSummary("exec-1");
 */

import type { JournalEventEnvelope } from "@earendil-works/pi-execution-core";
import type { IStateStore } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Read model adapter — a state store wrapper that provides the methods
 * expected by createExecutionReadModel().
 *
 * This wraps the IStateStore from the coding-agent and converts its
 * readJournal() output to JournalEventEnvelope[] format, while also
 * delegating workspace state and plan execution summary methods.
 */
export interface ReadModelAdapter {
	getPlanExecutionSummary?(planExecutionId: string): Promise<{
		id: string;
		projectId: string;
		phase: string;
		title: string;
		status: string;
		startedAt: string;
		completedAt: string | null;
	} | null>;
	getWorkspaceState?(
		planExecutionId: string,
		workspaceId: string,
	): Promise<{
		stage: string;
		attempts: number;
		startedAt?: number;
		completedAt?: number;
		error?: string;
		reportPath?: string;
	} | null>;
	getJournalEvents?(
		planExecutionId: string,
		options?: {
			limit?: number;
			offset?: number;
			eventType?: string;
			workspaceId?: string;
		},
	): Promise<JournalEventEnvelope[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a read model adapter from an IStateStore instance.
 *
 * The adapter provides:
 *   - getJournalEvents() — converts readJournal() JournalEvent[] to JournalEventEnvelope[]
 *     with planExecutionId, eventType, payload, createdAt mapping
 *   - getWorkspaceState() — delegates directly to state store
 *   - getPlanExecutionSummary() — extracts from loadState() result
 *
 * @param stateStore - The IStateStore instance from getStateStore()
 * @param workspaceRoot - Optional workspace root path (for archive access in the future)
 * @returns A ReadModelAdapter suitable for createExecutionReadModel()
 */
export function createReadModelAdapter(
	stateStore: IStateStore,
	_workspaceRoot?: string,
): ReadModelAdapter {
	let seqCounter = 0;

	return {
		/**
		 * Get plan execution summary from the state store.
		 * Extracts phase, title, status, timestamps from loadState().
		 */
		async getPlanExecutionSummary(planExecutionId: string) {
			try {
				const state = await stateStore.loadState(planExecutionId);
				if (!state) return null;

				return {
					id: planExecutionId,
					projectId: (state as any).projectId ?? "default",
					phase: (state as any).phase ?? "unknown",
					title: (state as any).title ?? "Unknown Plan",
					status: (state as any).status ?? "unknown",
					startedAt: (state as any).startedAt
						? new Date((state as any).startedAt).toISOString()
						: new Date().toISOString(),
					completedAt: (state as any).completedAt
						? new Date((state as any).completedAt).toISOString()
						: null,
				};
			} catch {
				return null;
			}
		},

		/**
		 * Get workspace state from the state store.
		 */
		async getWorkspaceState(planExecutionId: string, workspaceId: string) {
			try {
				const ws = await stateStore.getWorkspaceState(planExecutionId, workspaceId);
				if (!ws) return null;

				return {
					stage: (ws as any).stage ?? "unknown",
					attempts: (ws as any).attempts ?? 0,
					startedAt: (ws as any).startedAt ?? undefined,
					completedAt: (ws as any).completedAt ?? undefined,
					error: (ws as any).error ?? undefined,
					reportPath: (ws as any).reportPath ?? undefined,
				};
			} catch {
				return null;
			}
		},

		/**
		 * Get journal events from the state store, converting to JournalEventEnvelope format.
		 *
		 * Applies optional filters (workspaceId, eventType, limit, offset) after reading
		 * all events since the state store's readJournal() doesn't support filtering.
		 */
		async getJournalEvents(
			planExecutionId: string,
			options?: {
				limit?: number;
				offset?: number;
				eventType?: string;
				workspaceId?: string;
			},
		) {
			try {
				const rawEvents = await stateStore.readJournal(planExecutionId);
				if (!rawEvents || !Array.isArray(rawEvents)) return [];

				// Convert to JournalEventEnvelope format
				let envelopes: JournalEventEnvelope[] = rawEvents.map((event, idx) => ({
					seq: String(++seqCounter),
					eventId: `event-${planExecutionId}-${idx}`,
					planExecutionId,
					workspaceId: event.workspaceId,
					eventType: event.type,
					payload: (event.data as Record<string, unknown>) ?? null,
					createdAt: new Date(event.timestamp).toISOString(),
				}));

				// Apply filters
				if (options?.workspaceId) {
					envelopes = envelopes.filter((e) => e.workspaceId === options.workspaceId);
				}
				if (options?.eventType) {
					envelopes = envelopes.filter((e) => e.eventType === options.eventType);
				}

				// Apply pagination after filtering
				const offset = options?.offset ?? 0;
				const limit = options?.limit ?? envelopes.length;
				envelopes = envelopes.slice(offset, offset + limit);

				return envelopes;
			} catch {
				return [];
			}
		},
	};
}
