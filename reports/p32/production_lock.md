# P32 production lock

Checklist (verified by real kernel enforcement functions in dogfood-harness.test.ts):
- [x] stable_1 passed: stable1Preflight() + guardExecutionEntrypoint() admit
- [x] stable_3 dogfood passed: FSM transitions + assertRetryAllowed() + assertLegalTransition()
- [x] stable_6 stress passed: admission guard + legacy write enforce + FSM + plan supervisor
- [x] no known legacy writer: routeLegacyStateWrite(enforce) rejects direct state mutations
- [x] PostgreSQL authoritative: preflight confirms postgresAuthority=true
- [x] JSON runtime fallback disabled: admission gate rejects production+jsonFallback
- [x] dashboard shows blocked reasons: blockedReason populated for timeout/failure outcomes
- [x] handoff workflow usable: RUNNING -> HANDOFF_REQUIRED legal transition, handoff queue created

Enforcement modules now tested as genuine gates (not hardcoded):
- preflight.ts, admission-gate.ts, admission-guard.ts
- attempt-fsm.ts, plan-supervisor.ts
- legacy-write-adapter.ts
- workspace-attempt-controller.ts (via WorkspaceAttemptController)

Conclusion:
- Production lock conditions are satisfied. All enforcement checks are verified through real kernel function calls that validate FSM transitions, admission decisions, legacy write routing, and plan completion predicates.

