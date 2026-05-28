/**
 * Brain V5 — Mutation Guard.
 *
 * Enforces the V4 ExecutionKernel doctrine at the V5 boundary:
 * brain modules must not mutate execution state directly.
 *
 * This guard validates every event that a V5 module tries to emit
 * against the current V5 mode and the allowed/forbidden event type sets.
 * It is the single choke point through which all V5-sourced events pass.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import type { ActorEventSink } from "../../execution-kernel/actor-events.js";
import type { BrainTimelineStore } from "../timeline-store.js";
import { canV5EmitEvents, canV5Push } from "./config.js";
import type { BrainV5Config, V5AllowedEvent, V5EmitResult, V5RejectCode } from "./types.js";
import { V5_ALLOWED_ACTOR_EVENT_TYPES } from "./types.js";

// =========================================================================
// V5MutationGuard
// =========================================================================

/**
 * Mutation guard for V5 brain modules.
 *
 * Every event emission from a V5 module must go through this guard.
 * The guard validates:
 * 1. That V5 mode allows event emission (not OFF or READ_ONLY)
 * 2. That the event type is in the V5 allowed set
 * 3. That push operations are only allowed in DRAFTING+ modes
 *
 * Following V4 doctrine, this guard NEVER directly mutates execution
 * state. It validates and forwards events to the appropriate sinks
 * (timeline store for observation/signal events, actor event sink
 * for execution-kernel-bound events).
 */
export class V5MutationGuard {
	private readonly _timelineStore: BrainTimelineStore;
	private readonly _actorSink: ActorEventSink;
	private _config: BrainV5Config;

	constructor(config: BrainV5Config, timelineStore: BrainTimelineStore, actorSink: ActorEventSink) {
		this._config = config;
		this._timelineStore = timelineStore;
		this._actorSink = actorSink;
	}

	/** Update the config (called when settings change at runtime). */
	updateConfig(config: BrainV5Config): void {
		this._config = config;
	}

	/** Get the current V5 config. */
	get config(): BrainV5Config {
		return this._config;
	}

	// -------------------------------------------------------------------
	// Event Emission
	// -------------------------------------------------------------------

	/**
	 * Emit a V5 event through the guard.
	 *
	 * This is the single entry point for all V5 event emission.
	 * The guard validates against the current mode and allowed types,
	 * then forwards to the appropriate sink.
	 *
	 * @param event - The event to emit
	 * @returns V5EmitResult indicating success or rejection
	 */
	async emit(event: V5AllowedEvent): Promise<V5EmitResult> {
		// Step 1: Check if V5 can emit events at all
		if (!canV5EmitEvents(this._config)) {
			const code: V5RejectCode = this._config.mode === "OFF" ? "MODE_OFF" : "MODE_READ_ONLY";
			return {
				ok: false,
				error: `V5 cannot emit events in mode ${this._config.mode}`,
				code,
			};
		}

		switch (event.kind) {
			case "timeline": {
				// Timeline events (observations, signals) are always allowed
				// in ADVISORY+ modes — they are purely informational.
				const eventId = event.event.id;
				await this._timelineStore.append(event.event);
				return { ok: true, eventId };
			}

			case "actor": {
				// Actor events must be in the V5 allowed set
				if (!V5_ALLOWED_ACTOR_EVENT_TYPES.has(event.event.type)) {
					return {
						ok: false,
						error: `Actor event type "${event.event.type}" is not in the V5 allowed set`,
						code: "FORBIDDEN_EVENT_TYPE",
					};
				}

				// Push-capable events (proposal_submitted, etc.) require DRAFTING+
				if (!canV5Push(this._config)) {
					return {
						ok: false,
						error: `V5 cannot push actor events in mode ${this._config.mode}; DRAFTING+ required`,
						code: "MODE_NO_PUSH",
					};
				}

				// Forward to the actor event sink (execution kernel)
				await this._actorSink.emit(event.event);
				const eventId = randomUUID();
				return { ok: true, eventId };
			}
		}
	}

	// -------------------------------------------------------------------
	// Validation (no side effects)
	// -------------------------------------------------------------------

	/**
	 * Validate whether an event would be accepted, without emitting it.
	 * This is a pure validation (read-only) with no side effects.
	 */
	validate(event: V5AllowedEvent): V5EmitResult {
		if (!canV5EmitEvents(this._config)) {
			const code: V5RejectCode = this._config.mode === "OFF" ? "MODE_OFF" : "MODE_READ_ONLY";
			return {
				ok: false,
				error: `V5 cannot emit events in mode ${this._config.mode}`,
				code,
			};
		}

		switch (event.kind) {
			case "timeline":
				return { ok: true, eventId: event.event.id };
			case "actor": {
				if (!V5_ALLOWED_ACTOR_EVENT_TYPES.has(event.event.type)) {
					return {
						ok: false,
						error: `Actor event type "${event.event.type}" is not in the V5 allowed set`,
						code: "FORBIDDEN_EVENT_TYPE",
					};
				}
				if (!canV5Push(this._config)) {
					return {
						ok: false,
						error: `V5 cannot push actor events in mode ${this._config.mode}`,
						code: "MODE_NO_PUSH",
					};
				}
				return { ok: true, eventId: randomUUID() };
			}
		}
	}

	/**
	 * Check if a specific execution state mutation is allowed.
	 *
	 * V5 never directly mutates execution state — this always returns
	 * false with a FORBIDDEN_EVENT_TYPE code.
	 *
	 * Following the V4 ExecutionKernel doctrine: brain code must not
	 * mutate execution state directly; actors emit events only.
	 */
	checkDirectMutation(_target: string, _action: string): V5EmitResult {
		return {
			ok: false,
			error: "V5 brain modules must not mutate execution state directly (V4 doctrine). Use event emission instead.",
			code: "FORBIDDEN_EVENT_TYPE",
		};
	}
}
