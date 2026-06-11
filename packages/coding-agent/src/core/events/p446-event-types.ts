/**
 * P44.6.25 — P44.6 Event Types
 *
 * New event kinds additive to the existing event schema.
 * Required event kinds: ModeInspected, ModeCompiled, GateVerdictEmitted,
 * RouteSignalCompiled, MutationPlanned, EvidenceBound.
 *
 * All new events are additive — no removal or field narrowing of
 * existing event types.
 *
 * Contract Schema: 4.1.1
 */

// ---------------------------------------------------------------------------
// Event Kinds
// ---------------------------------------------------------------------------

export type P446EventKind =
	| "ModeInspected"
	| "ModeCompiled"
	| "GateVerdictEmitted"
	| "RouteSignalCompiled"
	| "MutationPlanned"
	| "EvidenceBound";

// ---------------------------------------------------------------------------
// Event Payloads
// ---------------------------------------------------------------------------

export interface ModeInspectedPayload {
	rawPrompt: string;
	inferredIntent: string | null;
	detectedAmbiguities: string[];
	targetPaths: string[];
}

export interface ModeCompiledPayload {
	mode: string;
	success: boolean;
	diagnosticCodes: string[];
}

export interface GateVerdictEmittedPayload {
	gateName: string;
	verdict: "pass" | "fail" | "warning";
	blockingDiagnosticCount: number;
}

export interface RouteSignalCompiledPayload {
	signal: string;
	schema: string;
}

export interface MutationPlannedPayload {
	phase: string;
	mutationCount: number;
	readyForPatch: boolean;
}

export interface EvidenceBoundPayload {
	bindingCount: number;
	targetIds: string[];
	evidenceKind: string;
}

// ---------------------------------------------------------------------------
// Event Envelope
// ---------------------------------------------------------------------------

export interface P446Event {
	id: string;
	kind: P446EventKind;
	timestamp: number;
	payload:
		| ModeInspectedPayload
		| ModeCompiledPayload
		| GateVerdictEmittedPayload
		| RouteSignalCompiledPayload
		| MutationPlannedPayload
		| EvidenceBoundPayload;
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

export function createEvent<K extends P446EventKind>(kind: K, payload: P446Event["payload"]): P446Event {
	return {
		id: crypto.randomUUID(),
		kind,
		timestamp: Date.now(),
		payload,
	};
}
