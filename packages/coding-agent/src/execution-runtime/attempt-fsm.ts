import type { AttemptState } from "./types.js";

const DEADLINE_POLICY: Record<
	Exclude<AttemptState, "SUCCEEDED" | "FAILED_FINAL" | "FAILED_RETRYABLE" | "CANCELLED">,
	number
> = {
	PENDING: 15 * 60_000,
	READY: 10 * 60_000,
	RUNNING: 20 * 60_000,
	BLOCKED: 30 * 60_000,
	HANDOFF_REQUIRED: 60 * 60_000,
	FINAL_VALIDATION: 15 * 60_000,
};

const LEGAL_TRANSITIONS: Record<AttemptState, AttemptState[]> = {
	PENDING: ["READY", "RUNNING", "CANCELLED"],
	READY: ["RUNNING", "BLOCKED", "CANCELLED"],
	RUNNING: [
		"BLOCKED",
		"HANDOFF_REQUIRED",
		"FINAL_VALIDATION",
		"SUCCEEDED",
		"FAILED_RETRYABLE",
		"FAILED_FINAL",
		"CANCELLED",
	],
	BLOCKED: ["READY", "RUNNING", "HANDOFF_REQUIRED", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLED"],
	HANDOFF_REQUIRED: ["FINAL_VALIDATION", "FAILED_FINAL", "CANCELLED"],
	FINAL_VALIDATION: ["SUCCEEDED", "FAILED_FINAL", "FAILED_RETRYABLE", "CANCELLED"],
	SUCCEEDED: [],
	FAILED_FINAL: [],
	FAILED_RETRYABLE: ["READY", "RUNNING", "CANCELLED"],
	CANCELLED: [],
};

export function getDeadlinePolicy(state: AttemptState): number | null {
	return state in DEADLINE_POLICY ? DEADLINE_POLICY[state as keyof typeof DEADLINE_POLICY] : null;
}

export function assertLegalTransition(from: AttemptState, to: AttemptState): void {
	if (from === to) return;
	if (!LEGAL_TRANSITIONS[from].includes(to)) {
		throw new Error(`Illegal attempt transition: ${from} -> ${to}`);
	}
}

export function assertRetryAllowed(state: AttemptState): void {
	if (state !== "FAILED_RETRYABLE") {
		throw new Error(`Retry before terminal rejected: ${state}`);
	}
}
