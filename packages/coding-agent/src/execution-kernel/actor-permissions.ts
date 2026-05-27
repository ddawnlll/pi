/**
 * Actor permissions for v4 ExecutionKernel.
 *
 * Defines which runtime roles may mutate state, emit events, or read state.
 * Implementations MUST enforce these through module boundaries,
 * StateAuthority token checks, and tests.
 */

// =========================================================================
// Permission flags
// =========================================================================

export interface ActorPermissionSet {
	/** Actor may directly mutate attempt state (e.g., via transition API). */
	readonly mayMutateAttemptState: boolean;
	/** Actor may create a new retry attempt directly. */
	readonly mayCreateRetryAttempt: boolean;
	/** Actor may mutate plan lifecycle state (e.g., mark plan complete). */
	readonly mayMutatePlanState: boolean;
	/** Actor may reserve scheduler slot tokens. */
	readonly mayReserveSchedulerSlots: boolean;
	/** Actor may emit events. */
	readonly mayEmitEvents: boolean;
	/** Actor may propose actions (advisory only). */
	readonly mayProposeAction: boolean;
	/** Actor may emit diagnosis/evidence packets. */
	readonly mayEmitDiagnosis: boolean;
	/** Actor may suggest retry (advisory only, not create). */
	readonly maySuggestRetry: boolean;
	/** Human actor is allowed to do anything. */
	readonly isHuman: boolean;
}

// =========================================================================
// Actor identifiers
// =========================================================================

export type ActorId =
	| "workspace_attempt_controller"
	| "plan_supervisor"
	| "executor_actor"
	| "validation_actor"
	| "git_runner"
	| "worktree_actor"
	| "lease_actor"
	| "integration_actor"
	| "retry_policy"
	| "deadline_watchdog"
	| "cleanup_actor"
	| "brain_worker"
	| "diagnostics"
	| "admission_gate"
	| "legacy_adapter"
	| "human";

// =========================================================================
// Permission registry
// =========================================================================

const ACTOR_PERMISSIONS: Record<ActorId, ActorPermissionSet> = {
	workspace_attempt_controller: {
		mayMutateAttemptState: true,
		mayCreateRetryAttempt: true,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	plan_supervisor: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: true,
		mayReserveSchedulerSlots: true,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	executor_actor: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	validation_actor: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	git_runner: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	worktree_actor: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	lease_actor: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	integration_actor: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	retry_policy: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: true,
		isHuman: false,
	},
	deadline_watchdog: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	cleanup_actor: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	brain_worker: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: true,
		mayEmitDiagnosis: true,
		maySuggestRetry: true,
		isHuman: false,
	},
	diagnostics: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: true,
		maySuggestRetry: false,
		isHuman: false,
	},
	admission_gate: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	legacy_adapter: {
		mayMutateAttemptState: false,
		mayCreateRetryAttempt: false,
		mayMutatePlanState: false,
		mayReserveSchedulerSlots: false,
		mayEmitEvents: true,
		mayProposeAction: false,
		mayEmitDiagnosis: false,
		maySuggestRetry: false,
		isHuman: false,
	},
	human: {
		mayMutateAttemptState: true,
		mayCreateRetryAttempt: true,
		mayMutatePlanState: true,
		mayReserveSchedulerSlots: true,
		mayEmitEvents: true,
		mayProposeAction: true,
		mayEmitDiagnosis: true,
		maySuggestRetry: true,
		isHuman: true,
	},
};

// =========================================================================
// Permission helpers
// =========================================================================

/**
 * Get the permission set for a given actor.
 */
export function getActorPermissions(actorId: ActorId): ActorPermissionSet {
	const perms = ACTOR_PERMISSIONS[actorId];
	if (!perms) {
		throw new Error(`Unknown actor: ${actorId}`);
	}
	return perms;
}

/**
 * Check whether an actor is allowed to mutate attempt state.
 */
export function mayMutateAttemptState(actorId: ActorId): boolean {
	return getActorPermissions(actorId).mayMutateAttemptState;
}

/**
 * Assert that an actor is allowed to mutate attempt state.
 * Throws a v4 hard stop error if not permitted.
 */
export function assertMayMutateAttemptState(actorId: ActorId): void {
	if (!mayMutateAttemptState(actorId)) {
		throw new Error(
			`direct_attempt_state_mutation_detected: actor ${actorId} is not permitted to mutate attempt state`,
		);
	}
}

/**
 * Check whether an actor is allowed to mutate plan state.
 */
export function mayMutatePlanState(actorId: ActorId): boolean {
	return getActorPermissions(actorId).mayMutatePlanState;
}

/**
 * Assert that an actor is allowed to mutate plan state.
 */
export function assertMayMutatePlanState(actorId: ActorId): void {
	if (!mayMutatePlanState(actorId)) {
		throw new Error(`plan_state_mutation_outside_supervisor: actor ${actorId} is not permitted to mutate plan state`);
	}
}
