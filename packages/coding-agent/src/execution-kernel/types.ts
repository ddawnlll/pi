export type AttemptState =
	| "PENDING"
	| "READY"
	| "RUNNING"
	| "BLOCKED"
	| "HANDOFF_REQUIRED"
	| "FINAL_VALIDATION"
	| "SUCCEEDED"
	| "FAILED_FINAL"
	| "FAILED_RETRYABLE"
	| "CANCELLED";

export type AttemptEventType =
	| "attempt_started"
	| "attempt_progressed"
	| "attempt_blocked"
	| "handoff_required"
	| "deadline_exceeded"
	| "attempt_succeeded"
	| "attempt_failed"
	| "legacy_state_write_detected";

export interface StateAuthorityToken {
	readonly attemptId: string;
	readonly controllerId: string;
	readonly issuedAt: number;
}

export interface AttemptRow {
	id: string;
	workspace_execution_id: string;
	plan_execution_id: string;
	project_id: string;
	current_state: AttemptState;
	version: number;
	current_deadline_at: string | null;
	metadata: Record<string, unknown> | null;
	created_at: string;
	updated_at: string;
}

export interface AttemptEventRow {
	seq: string;
	event_id: string;
	attempt_id: string;
	plan_execution_id: string;
	workspace_execution_id: string;
	event_type: AttemptEventType;
	event_version: number;
	payload: Record<string, unknown> | null;
	created_at: string;
}

export interface AttemptTransitionRow {
	id: string;
	attempt_id: string;
	from_state: AttemptState;
	to_state: AttemptState;
	expected_version: number;
	next_version: number;
	event_id: string;
	metadata: Record<string, unknown> | null;
	created_at: string;
}

export interface ControllerInboxRow {
	id: string;
	attempt_id: string;
	plan_execution_id: string;
	workspace_execution_id: string;
	message_type: string;
	payload: Record<string, unknown> | null;
	dedupe_key: string;
	processed_at: string | null;
	created_at: string;
}

export interface ControllerLeaseRow {
	id: string;
	attempt_id: string;
	controller_id: string;
	lease_expires_at: string;
	created_at: string;
	updated_at: string;
}

export interface HandoffQueueRow {
	id: string;
	attempt_id: string;
	plan_execution_id: string;
	workspace_execution_id: string;
	status: string;
	reason: string | null;
	required: boolean;
	created_at: string;
	updated_at: string;
}

export interface AttemptTransitionResult {
	state: AttemptState;
	version: number;
	deadlineAt: string | null;
}
