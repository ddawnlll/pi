# P32 stable_3 dogfood

Status: passed

Scenario (exercised via real kernel FSM and enforcement functions):
- ws-success: PENDING -> READY -> RUNNING -> SUCCEEDED (normal completion)
- ws-validation-timeout: PENDING -> READY -> RUNNING -> FAILED_RETRYABLE -> READY -> RUNNING -> FAILED_FINAL (validation timeout, retry exhausted)
- ws-llm-timeout: PENDING -> READY -> RUNNING -> (retry rejected while RUNNING) -> FAILED_RETRYABLE -> READY -> RUNNING -> HANDOFF_REQUIRED (LLM timeout, handoff required)

Invariants verified through real kernel execution:
- no infinite RUNNING state: all outcomes terminal or HANDOFF_REQUIRED
- retry only after terminal: assertRetryAllowed() rejects retry from RUNNING, accepts from FAILED_RETRYABLE
- retry during RUNNING rejected: assertRetryAllowed("RUNNING") throws
- deadline exceeded emitted: RUNNING -> FAILED_RETRYABLE via assertLegalTransition()
- handoff queue created: RUNNING -> HANDOFF_REQUIRED via assertLegalTransition()
- blocked reasons populated: validation_timeout, llm_timeout
- replay matches state: all outcomes have replayMatchesState=true
- no JSON authoritative state: enforced by legacy-write-adapter (enforce mode)
- no attempt running without deadline: getDeadlinePolicy("RUNNING") returns non-null
- every terminal transition has journal evidence: events linked to workspace IDs

Enforcement modules exercised:
- attempt-fsm.ts: assertLegalTransition(), assertRetryAllowed(), getDeadlinePolicy()
- plan-supervisor.ts: planCompletionPredicate()
- legacy-write-adapter.ts: routeLegacyStateWrite()

Conclusion:
- stable_3 dogfood conditions are satisfied. All invariants are verified through real FSM transitions and enforcement checks.

