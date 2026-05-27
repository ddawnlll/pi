import type { AttemptEventJournal } from "./attempt-event-journal.js";
import type { AttemptEventType } from "./types.js";

/**
 * Legacy write adapter mode.
 *
 * @deprecated Since TransitionRouter now routes all lifecycle mutations through
 *   WorkspaceAttemptController (execution-kernel/transition-router.ts).
 *   The AutonomousExecutor no longer performs direct state store writes —
 *   all lifecycle transitions go through TransitionRouter.
 *
 *   This adapter is retained for:
 *   - migration-path compatibility during the v3→v4 cutover
 *   - debug/audit logging of any remaining direct state store writes
 *
 * - `observe`: Execute the legacy write and emit a shadow event (default, migration-only)
 * - `route`: Execute the legacy write, emit a shadow event, and route through kernel controller
 * - `enforce`: Reject the legacy write, requiring kernel controller instead (not yet viable)
 */
export type LegacyWriteMode = "observe" | "route" | "enforce";

/**
 * Result of routing a legacy state write.
 */
export interface LegacyWriteResult {
	/** The action taken */
	action: "executed" | "rejected";
	/** The legacy write signal */
	signal: "legacy_state_write_detected" | "controller_event_routed" | "legacy_state_write_rejected";
	/** If the shadow event was emitted */
	shadowEmitted: boolean;
}

/**
 * Emit a shadow event through the journal.
 */
async function emitShadowEvent(
	journal: AttemptEventJournal,
	shadowParams: {
		attemptId: string;
		planExecutionId: string;
		workspaceExecutionId: string;
		eventType: AttemptEventType;
		version: number;
		payload?: Record<string, unknown> | null;
	},
): Promise<void> {
	await journal.append({
		eventId: `shadow:${shadowParams.attemptId}:${shadowParams.version}:${shadowParams.eventType}`,
		attemptId: shadowParams.attemptId,
		planExecutionId: shadowParams.planExecutionId,
		workspaceExecutionId: shadowParams.workspaceExecutionId,
		eventType: shadowParams.eventType,
		eventVersion: shadowParams.version,
		payload: {
			...(shadowParams.payload ?? {}),
			_shadow: true,
			_shadow_source: "legacy_state_store",
		},
	});
}

/**
 * Route a legacy state write according to the current mode.
 *
 * In `observe` mode: Execute the mutation and emit a shadow event.
 * In `route` mode: Execute the mutation, emit a shadow event, and signal routing.
 * In `enforce` mode: Reject the mutation and emit a rejection event when possible.
 *
 * @param mode - The legacy write adapter mode
 * @param mutate - The legacy mutation function
 * @param journal - Optional AttemptEventJournal for shadow event emission
 * @param shadowParams - Parameters for shadow event emission (required if journal is provided)
 * @returns Result of the routing
 */
export async function routeLegacyStateWrite(
	mode: LegacyWriteMode,
	mutate: () => void | Promise<void>,
	journal?: AttemptEventJournal,
	shadowParams?: {
		attemptId: string;
		planExecutionId: string;
		workspaceExecutionId: string;
		eventType: AttemptEventType;
		version: number;
		payload?: Record<string, unknown> | null;
	},
): Promise<LegacyWriteResult> {
	switch (mode) {
		case "enforce":
			if (journal && shadowParams) {
				await emitShadowEvent(journal, {
					...shadowParams,
					eventType: "legacy_state_write_rejected",
				});
			}
			return {
				action: "rejected",
				signal: "legacy_state_write_rejected",
				shadowEmitted: !!journal,
			};

		default:
			await mutate();
			if (journal && shadowParams) {
				await emitShadowEvent(journal, shadowParams);
			}
			return {
				action: "executed",
				signal: mode === "route" ? "controller_event_routed" : "legacy_state_write_detected",
				shadowEmitted: !!journal,
			};
	}
}
