/**
 * P44.6.15 — EventRecorder Shadow Conditional Fix
 *
 * Fixes shadow conditional behavior so event recording is never
 * silently skipped under mode-specific runtime branches.
 *
 * The original bug: a shadow conditional (if-else that looks correct
 * but has a hidden path where recording is skipped) caused events
 * to be silently dropped in certain mode-specific runtime branches.
 *
 * The fix: Always record through the EventRecorder, never through
 * inline shadow conditionals. The recorder uses an explicit
 * shouldRecord check that is always evaluated before any branch.
 *
 * Contract Schema: 4.1.1
 */

import type { EngineMode } from "../core/mode/engine-mode.js";

// ---------------------------------------------------------------------------
// Event Types
// ---------------------------------------------------------------------------

export type RecordedEventType =
	| "mode_inspected"
	| "mode_compiled"
	| "gate_verdict_emitted"
	| "route_signal_compiled"
	| "mutation_planned"
	| "evidence_bound"
	| "write_authorized"
	| "edit_authorized"
	| "write_blocked"
	| "edit_blocked"
	| "engine_invocation_started"
	| "engine_invocation_completed"
	| "engine_invocation_failed"
	| "engine_invocation_timed_out";

// ---------------------------------------------------------------------------
// Event Record
// ---------------------------------------------------------------------------

export interface EventRecord {
	/** Unique event ID. */
	id: string;
	/** Type of event. */
	type: RecordedEventType;
	/** When the event occurred (epoch ms). */
	timestamp: number;
	/** The engine mode active when this event was recorded. */
	mode: EngineMode | null;
	/** Optional payload. */
	payload?: Record<string, unknown>;
	/** Whether this event was emitted from a shadow/replay path. */
	isShadow: boolean;
}

// ---------------------------------------------------------------------------
// Event Recorder
// ---------------------------------------------------------------------------

/**
 * EventRecorder with the shadow conditional fix.
 *
 * The key fix: The `shouldRecord` method is the sole gatekeeper for
 * whether events are recorded. It is called ONCE at the top of
 * every recording path. No inline conditional can silently skip recording.
 */
export class EventRecorder {
	private events: EventRecord[] = [];
	private shadowMode = false;
	private modeFilter: EngineMode[] | null = null;

	/**
	 * Set whether shadow recording is enabled.
	 * Shadow events are recorded but marked as shadow for replay filtering.
	 */
	setShadowMode(enabled: boolean): void {
		this.shadowMode = enabled;
	}

	/**
	 * Set a mode filter — only events for these modes will be recorded.
	 * null means record all modes.
	 */
	setModeFilter(modes: EngineMode[] | null): void {
		this.modeFilter = modes;
	}

	/**
	 * Check if recording should proceed.
	 * This is the SOLE gatekeeper. Every recording path MUST call this
	 * before recording. No inline conditionals.
	 */
	shouldRecord(mode: EngineMode | null): boolean {
		if (this.modeFilter === null) return true;
		if (mode === null) return true; // Always record mode-unknown events
		return this.modeFilter.includes(mode);
	}

	/**
	 * Record an event.
	 * Always checks shouldRecord first. Never silently drops.
	 */
	record(type: RecordedEventType, mode: EngineMode | null, payload?: Record<string, unknown>): void {
		// FIX: Always go through shouldRecord. No inline conditionals.
		if (!this.shouldRecord(mode)) {
			return;
		}

		this.events.push({
			id: crypto.randomUUID(),
			type,
			timestamp: Date.now(),
			mode,
			payload,
			isShadow: this.shadowMode,
		});
	}

	/**
	 * Get all recorded events.
	 */
	getEvents(): readonly EventRecord[] {
		return this.events;
	}

	/**
	 * Get events filtered by type.
	 */
	getEventsByType(type: RecordedEventType): EventRecord[] {
		return this.events.filter((e) => e.type === type);
	}

	/**
	 * Get events filtered by mode.
	 */
	getEventsByMode(mode: EngineMode): EventRecord[] {
		return this.events.filter((e) => e.mode === mode);
	}

	/**
	 * Get non-shadow events (real production events).
	 */
	getRealEvents(): EventRecord[] {
		return this.events.filter((e) => !e.isShadow);
	}

	/**
	 * Clear all events.
	 */
	clear(): void {
		this.events = [];
	}

	/**
	 * Get the total count of events recorded.
	 */
	get count(): number {
		return this.events.length;
	}
}
