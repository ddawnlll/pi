/**
 * Brain Domain Model — Core types for Pi V2 second-brain cognitive OS.
 *
 * This module defines the foundational observation, signal, and timeline
 * event types used by the Brain Core vertical slice (P13).
 *
 * Every observation requires provenance with source references.
 * All types include JSON-serialization helpers for persistence.
 */

import { randomUUID } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────
// Enums / Union Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Types of signals that the brain can detect and track.
 */
export type SignalType =
	| "retry_hotspot"
	| "failure_pattern"
	| "queue_blocked"
	| "integration_dirty"
	| "validation_failure"
	| "validation_repeat"
	| "memory_conflict"
	| "decision_impact"
	| "goal_drift"
	| "proposal_generated";

/**
 * Severity levels for observations, signals, and timeline events.
 */
export type Severity = "info" | "warning" | "critical";

/**
 * The system component that originated an observation.
 */
export type EventSource = "queue" | "execution" | "integration" | "validation" | "user" | "system";

/**
 * Valid timeline event types that appear in the brain timeline.
 */
export type TimelineEventType =
	| "observation"
	| "signal"
	| "reflection"
	| "daemon_heartbeat"
	| "daemon_start"
	| "daemon_stop"
	| "daemon_error";

/**
 * Types of source references that can back an observation.
 */
export type SourceRefType = "file" | "journal" | "queue" | "memory" | "proposal" | "plan" | "workspace";

// ─────────────────────────────────────────────────────────────────────
// Core Interfaces
// ─────────────────────────────────────────────────────────────────────

/**
 * A reference to a source artifact that supports an observation.
 *
 * At minimum, `type` and `path` must be provided.
 */
export interface SourceRef {
	type: SourceRefType;
	path: string;
	lineStart?: number;
	lineEnd?: number;
	commit?: string;
	timestamp?: string;
	id?: string;
}

/**
 * Provenance information attached to every observation.
 *
 * Tracks where the observation came from, how it was derived,
 * and how confident the system is in its accuracy.
 */
export interface ProvenanceInfo {
	/** Source references that directly produced this observation. */
	observationSources: SourceRef[];
	/** Chain of derivation (observations → signals → memory). */
	derivationChain: SourceRef[];
	/** Confidence score between 0 and 1. */
	confidence: number;
	/** Who validated this observation: "system", "user", or an LLM identifier. */
	validatedBy: string;
}

/**
 * A single observation recorded by the brain.
 *
 * Observations are the atomic unit of the brain's perception.
 * They represent a fact about the project or execution state
 * at a specific point in time.
 */
export interface BrainObservation {
	/** Unique identifier (UUID v4). */
	id: string;
	/** ISO 8601 timestamp of when the observation was made. */
	timestamp: string;
	/** The system component that produced this observation. */
	source: EventSource;
	/** The type of signal this observation relates to. */
	signalType: SignalType;
	/** Severity level. */
	severity: Severity;
	/** Short human-readable title. */
	title: string;
	/** Longer human-readable description. */
	description: string;
	/** Source artifacts that back this observation. */
	evidence: SourceRef[];
	/** Provenance metadata. */
	provenance: ProvenanceInfo;
	/** Arbitrary additional metadata. */
	metadata: Record<string, unknown>;
}

/**
 * A synthesized signal derived from one or more observations.
 *
 * Signals represent patterns or insights that the brain has
 * detected across multiple observations.
 */
export interface BrainSignal {
	/** Unique identifier (UUID v4). */
	id: string;
	/** IDs of observations that contributed to this signal. */
	observationIds: string[];
	/** A machine-readable pattern label (e.g., "retry_hotspot:workspace:3+"). */
	pattern: string;
	/** Human-readable summary of what this signal means. */
	summary: string;
	/** Confidence score between 0 and 1. */
	confidence: number;
	/** Severity level derived from contributing observations. */
	severity: Severity;
	/** ISO 8601 timestamp of when the signal was created. */
	createdAt: string;
	/** ISO 8601 timestamp of when the signal was resolved, if applicable. */
	resolvedAt?: string;
	/** Arbitrary additional metadata. */
	metadata: Record<string, unknown>;
}

/**
 * An event in the brain timeline.
 *
 * The timeline is an append-only log of everything the brain does:
 * observations recorded, signals generated, reflections produced,
 * and daemon lifecycle events.
 */
export interface BrainTimelineEvent {
	/** Unique identifier (UUID v4). */
	id: string;
	/** The type of event. */
	eventType: TimelineEventType;
	/** ISO 8601 timestamp of when the event occurred. */
	timestamp: string;
	/** Arbitrary event payload data. */
	data: Record<string, unknown>;
	/** Optional workspace context. */
	workspaceId?: string;
	/** Optional plan execution context. */
	planExecId?: string;
	/** Severity level. */
	severity: Severity;
}

// ─────────────────────────────────────────────────────────────────────
// Helper: All signal types list
// ─────────────────────────────────────────────────────────────────────

/** Array of all valid SignalType values for runtime validation. */
export const ALL_SIGNAL_TYPES: SignalType[] = [
	"retry_hotspot",
	"failure_pattern",
	"queue_blocked",
	"integration_dirty",
	"validation_failure",
	"validation_repeat",
	"memory_conflict",
	"decision_impact",
	"goal_drift",
	"proposal_generated",
];

/** Array of all valid Severity values for runtime validation. */
export const ALL_SEVERITIES: Severity[] = ["info", "warning", "critical"];

/** Array of all valid EventSource values for runtime validation. */
export const ALL_EVENT_SOURCES: EventSource[] = ["queue", "execution", "integration", "validation", "user", "system"];

/** Array of all valid TimelineEventType values for runtime validation. */
export const ALL_TIMELINE_EVENT_TYPES: TimelineEventType[] = [
	"observation",
	"signal",
	"reflection",
	"daemon_heartbeat",
	"daemon_start",
	"daemon_stop",
	"daemon_error",
];

/** Array of all valid SourceRefType values for runtime validation. */
export const ALL_SOURCE_REF_TYPES: SourceRefType[] = [
	"file",
	"journal",
	"queue",
	"memory",
	"proposal",
	"plan",
	"workspace",
];

// ─────────────────────────────────────────────────────────────────────
// Factory functions
// ─────────────────────────────────────────────────────────────────────

/** Create a new BrainObservation with defaults applied. */
export function createBrainObservation(
	overrides: Partial<Omit<BrainObservation, "id" | "timestamp">> & {
		source: EventSource;
		signalType: SignalType;
		severity: Severity;
		title: string;
		description: string;
		provenance: ProvenanceInfo;
	},
): BrainObservation {
	return {
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		evidence: [],
		metadata: {},
		...overrides,
	};
}

/** Create a new BrainSignal with defaults applied. */
export function createBrainSignal(
	overrides: Partial<Omit<BrainSignal, "id" | "createdAt">> & {
		observationIds: string[];
		pattern: string;
		summary: string;
		confidence: number;
		severity: Severity;
	},
): BrainSignal {
	return {
		id: randomUUID(),
		createdAt: new Date().toISOString(),
		metadata: {},
		...overrides,
	};
}

/** Create a new BrainTimelineEvent with defaults applied. */
export function createBrainTimelineEvent(
	overrides: Partial<Omit<BrainTimelineEvent, "id" | "timestamp">> & {
		eventType: TimelineEventType;
		severity: Severity;
		data?: Record<string, unknown>;
	},
): BrainTimelineEvent {
	return {
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		data: {},
		...overrides,
	};
}

// ─────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────

/** Result of a type validation check. */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Validate a string is a non-empty ISO 8601 timestamp.
 */
export function isValidTimestamp(value: unknown): value is string {
	if (typeof value !== "string") return false;
	if (value.length === 0) return false;
	// Basic ISO 8601 check: must contain a 'T' and end with 'Z' or timezone offset
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
}

/**
 * Validate that a confidence value is between 0 and 1.
 */
export function isValidConfidence(value: unknown): value is number {
	return typeof value === "number" && value >= 0 && value <= 1;
}

/**
 * Validate a BrainObservation object.
 * Returns a ValidationResult with any errors found.
 */
export function validateBrainObservation(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const obs = value as Record<string, unknown>;

	if (typeof obs.id !== "string" || obs.id.length === 0) {
		errors.push("id must be a non-empty string");
	}
	if (!isValidTimestamp(obs.timestamp)) {
		errors.push("timestamp must be a valid ISO 8601 string");
	}
	if (!ALL_EVENT_SOURCES.includes(obs.source as EventSource)) {
		errors.push(`source must be one of: ${ALL_EVENT_SOURCES.join(", ")}`);
	}
	if (!ALL_SIGNAL_TYPES.includes(obs.signalType as SignalType)) {
		errors.push(`signalType must be one of: ${ALL_SIGNAL_TYPES.join(", ")}`);
	}
	if (!ALL_SEVERITIES.includes(obs.severity as Severity)) {
		errors.push(`severity must be one of: ${ALL_SEVERITIES.join(", ")}`);
	}
	if (typeof obs.title !== "string" || obs.title.length === 0) {
		errors.push("title must be a non-empty string");
	}
	if (typeof obs.description !== "string") {
		errors.push("description must be a string");
	}
	if (!Array.isArray(obs.evidence)) {
		errors.push("evidence must be an array");
	}
	if (!obs.provenance || typeof obs.provenance !== "object") {
		errors.push("provenance must be a non-null object");
	} else {
		const prov = obs.provenance as Record<string, unknown>;
		if (!Array.isArray(prov.observationSources)) {
			errors.push("provenance.observationSources must be an array");
		}
		if (!Array.isArray(prov.derivationChain)) {
			errors.push("provenance.derivationChain must be an array");
		}
		if (!isValidConfidence(prov.confidence)) {
			errors.push("provenance.confidence must be a number between 0 and 1");
		}
		if (typeof prov.validatedBy !== "string" || prov.validatedBy.length === 0) {
			errors.push("provenance.validatedBy must be a non-empty string");
		}
	}
	if (obs.metadata !== undefined && (typeof obs.metadata !== "object" || obs.metadata === null)) {
		errors.push("metadata must be a non-null object");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a BrainSignal object.
 * Returns a ValidationResult with any errors found.
 */
export function validateBrainSignal(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const sig = value as Record<string, unknown>;

	if (typeof sig.id !== "string" || sig.id.length === 0) {
		errors.push("id must be a non-empty string");
	}
	if (!Array.isArray(sig.observationIds) || sig.observationIds.length === 0) {
		errors.push("observationIds must be a non-empty array");
	}
	if (typeof sig.pattern !== "string" || sig.pattern.length === 0) {
		errors.push("pattern must be a non-empty string");
	}
	if (typeof sig.summary !== "string" || sig.summary.length === 0) {
		errors.push("summary must be a non-empty string");
	}
	if (!isValidConfidence(sig.confidence)) {
		errors.push("confidence must be a number between 0 and 1");
	}
	if (!ALL_SEVERITIES.includes(sig.severity as Severity)) {
		errors.push(`severity must be one of: ${ALL_SEVERITIES.join(", ")}`);
	}
	if (!isValidTimestamp(sig.createdAt)) {
		errors.push("createdAt must be a valid ISO 8601 string");
	}
	if (sig.resolvedAt !== undefined && sig.resolvedAt !== null && !isValidTimestamp(sig.resolvedAt)) {
		errors.push("resolvedAt must be a valid ISO 8601 string when provided");
	}
	if (sig.metadata !== undefined && (typeof sig.metadata !== "object" || sig.metadata === null)) {
		errors.push("metadata must be a non-null object");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate a BrainTimelineEvent object.
 * Returns a ValidationResult with any errors found.
 */
export function validateBrainTimelineEvent(value: unknown): ValidationResult {
	const errors: string[] = [];

	if (!value || typeof value !== "object") {
		return { valid: false, errors: ["Value must be a non-null object"] };
	}

	const event = value as Record<string, unknown>;

	if (typeof event.id !== "string" || event.id.length === 0) {
		errors.push("id must be a non-empty string");
	}
	if (!ALL_TIMELINE_EVENT_TYPES.includes(event.eventType as TimelineEventType)) {
		errors.push(`eventType must be one of: ${ALL_TIMELINE_EVENT_TYPES.join(", ")}`);
	}
	if (!isValidTimestamp(event.timestamp)) {
		errors.push("timestamp must be a valid ISO 8601 string");
	}
	if (event.data !== undefined && (typeof event.data !== "object" || event.data === null)) {
		errors.push("data must be a non-null object");
	}
	if (!ALL_SEVERITIES.includes(event.severity as Severity)) {
		errors.push(`severity must be one of: ${ALL_SEVERITIES.join(", ")}`);
	}
	if (event.workspaceId !== undefined && (typeof event.workspaceId !== "string" || event.workspaceId.length === 0)) {
		errors.push("workspaceId must be a non-empty string when provided");
	}
	if (event.planExecId !== undefined && (typeof event.planExecId !== "string" || event.planExecId.length === 0)) {
		errors.push("planExecId must be a non-empty string when provided");
	}

	return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────
// Serialization helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Serialize a BrainObservation to a JSON string.
 */
export function serializeBrainObservation(obs: BrainObservation): string {
	return JSON.stringify(obs, null, 2);
}

/**
 * Deserialize a JSON string to a BrainObservation with validation.
 * Returns the parsed object if valid, or throws if invalid.
 */
export function deserializeBrainObservation(json: string): BrainObservation {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(`Failed to parse BrainObservation JSON: ${(e as Error).message}`);
	}

	const result = validateBrainObservation(parsed);
	if (!result.valid) {
		throw new Error(`Invalid BrainObservation: ${result.errors.join("; ")}`);
	}

	return parsed as BrainObservation;
}

/**
 * Serialize a BrainSignal to a JSON string.
 */
export function serializeBrainSignal(signal: BrainSignal): string {
	return JSON.stringify(signal, null, 2);
}

/**
 * Deserialize a JSON string to a BrainSignal with validation.
 * Returns the parsed object if valid, or throws if invalid.
 */
export function deserializeBrainSignal(json: string): BrainSignal {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(`Failed to parse BrainSignal JSON: ${(e as Error).message}`);
	}

	const result = validateBrainSignal(parsed);
	if (!result.valid) {
		throw new Error(`Invalid BrainSignal: ${result.errors.join("; ")}`);
	}

	return parsed as BrainSignal;
}

/**
 * Serialize a BrainTimelineEvent to a JSON string.
 */
export function serializeBrainTimelineEvent(event: BrainTimelineEvent): string {
	return JSON.stringify(event);
}

/**
 * Deserialize a JSON string to a BrainTimelineEvent with validation.
 * Returns the parsed object if valid, or throws if invalid.
 */
export function deserializeBrainTimelineEvent(json: string): BrainTimelineEvent {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		throw new Error(`Failed to parse BrainTimelineEvent JSON: ${(e as Error).message}`);
	}

	const result = validateBrainTimelineEvent(parsed);
	if (!result.valid) {
		throw new Error(`Invalid BrainTimelineEvent: ${result.errors.join("; ")}`);
	}

	return parsed as BrainTimelineEvent;
}
