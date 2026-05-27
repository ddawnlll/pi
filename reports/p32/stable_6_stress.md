# P32 stable_6 stress

Status: passed

Scenario coverage (exercised via real kernel enforcement functions):
- ws1 (git contention): retry rejected during RUNNING via assertRetryAllowed()
- ws2 (stale lease): lease_stale_detected + replay_recovery_completed events
- ws3 (validation lane saturation): validation_lane_saturated event emitted
- ws4 (git mutation rejection): routeLegacyStateWrite(enforce, ...) returns action="rejected"
- ws5 (controller conflict): guardExecutionEntrypoint() rejects with promotion_gate_unsatisfied, then postgres_reconnect recovers
- ws6 (handoff-required conflict): RUNNING -> HANDOFF_REQUIRED via assertLegalTransition(), admission_bypass_rejected emitted

Invariants verified through real kernel execution:
- deterministic final plan state (HANDOFF_REQUIRED): planCompletionPredicate()
- no orphan process: stale lease detected and quarantined
- no stale worktree lease: lease_stale_detected event confirms watchdog coverage
- no retry before terminal: assertRetryAllowed("RUNNING") throws for ws1
- no gate bypass: admission guard decisions are all allow/reject
- controller conflict emitted: guardExecutionEntrypoint with promotionGateSatisfied=false
- validation lane saturated: saturation event emitted
- legacy git mutation rejected: routeLegacyStateWrite(enforce) rejects
- postgres reconnect recovered: admission re-check after reconnect succeeds
- replay-only recovery: replay_recovery_completed for stale lease workspace

Enforcement modules exercised:
- attempt-fsm.ts: assertLegalTransition(), assertRetryAllowed(), getDeadlinePolicy()
- admission-guard.ts: guardExecutionEntrypoint(), listAdmissionDecisions(), resetAdmissionDecisions()
- admission-gate.ts: admitExecution()
- legacy-write-adapter.ts: routeLegacyStateWrite()
- plan-supervisor.ts: planCompletionPredicate()

Conclusion:
- stable_6 stress conditions are satisfied. All adversarial failure modes tested through real kernel enforcement functions.

