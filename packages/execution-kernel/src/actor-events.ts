export type ActorEventType =
	| "retry_requested"
	| "validation_started"
	| "validation_passed"
	| "validation_failed"
	| "validation_timed_out"
	| "lease_stale_detected"
	| "lease_quarantine_requested"
	| "cleanup_completed"
	| "cleanup_failed"
	| "proposal_submitted"
	| "proposal_evidence_recorded"
	| "workspace_started"
	| "workspace_running"
	| "tool_event"
	| "llm_timeout";

export interface ActorEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
	type: ActorEventType;
	timestamp: number;
	payload: TPayload;
}

export interface ActorEventSink {
	emit(event: ActorEvent): void | Promise<void>;
}

export class InMemoryActorEventSink implements ActorEventSink {
	readonly events: ActorEvent[] = [];

	emit(event: ActorEvent): void {
		this.events.push(event);
	}
}
