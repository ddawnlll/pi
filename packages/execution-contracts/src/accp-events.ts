/**
 * ACCP v2.0 Lifecycle Events
 *
 * Event types for the ACCP compile, gate, finding, and route lifecycle.
 * These events are additive to the existing event journal schema
 * (see packages/execution-runtime/src/event-schema.ts).
 *
 * ## Design
 *
 * Each event kind carries minimal, structured payload. Event producers
 * may emit these events during ACCP compilation, validation, gate
 * evaluation, and route signal emission.
 *
 * ## Authority
 *
 * Events are records of what happened. They do not authorize future
 * actions. Runtime authority remains with PlanSpec, write gate,
 * command policy, and completion gate.
 *
 * @packageDocumentation
 */

import type {
	AccpCompileResult,
	AccpDiagnostic,
	AccpGateVerdict,
	AccpReportType,
	AccpRouteSignal,
} from "./accp-types.js";

// =============================================================================
// Event kinds
// =============================================================================

/** All ACCP lifecycle event kinds. */
export type AccpEventKind =
	| "accp_compile_started"
	| "accp_compile_completed"
	| "accp_gate_verdict_emitted"
	| "accp_finding_recorded"
	| "accp_route_signal_emitted";

// =============================================================================
// Base event
// =============================================================================

/** Base ACCP lifecycle event with common fields. */
export interface AccpBaseEvent {
	kind: AccpEventKind;
	/** ISO timestamp. */
	timestamp: string;
	/** Report ID this event relates to. */
	reportId: string;
	/** Report type. */
	reportType: AccpReportType;
	/** Workspace/execution context. */
	workspaceId?: string;
}

// =============================================================================
// Specific events
// =============================================================================

/** ACCP compilation has started for a source report. */
export interface AccpCompileStartedEvent extends AccpBaseEvent {
	kind: "accp_compile_started";
	/** Source YAML path. */
	sourcePath: string;
}

/** ACCP compilation has completed. */
export interface AccpCompileCompletedEvent extends AccpBaseEvent {
	kind: "accp_compile_completed";
	/** Compilation result. */
	result: AccpCompileResult;
	/** Duration in milliseconds. */
	durationMs: number;
}

/** A gate verdict has been emitted for a report. */
export interface AccpGateVerdictEmittedEvent extends AccpBaseEvent {
	kind: "accp_gate_verdict_emitted";
	/** Gate verdict. */
	verdict: AccpGateVerdict;
}

/** A finding has been recorded during compilation or validation. */
export interface AccpFindingRecordedEvent extends AccpBaseEvent {
	kind: "accp_finding_recorded";
	/** The finding diagnostic. */
	diagnostic: AccpDiagnostic;
}

/** A route signal has been emitted from a compiled report. */
export interface AccpRouteSignalEmittedEvent extends AccpBaseEvent {
	kind: "accp_route_signal_emitted";
	/** Route signal. */
	routeSignal: AccpRouteSignal;
}

// =============================================================================
// Union type
// =============================================================================

/** Union of all ACCP lifecycle events. */
export type AccpLifecycleEvent =
	| AccpCompileStartedEvent
	| AccpCompileCompletedEvent
	| AccpGateVerdictEmittedEvent
	| AccpFindingRecordedEvent
	| AccpRouteSignalEmittedEvent;
