# P32 stable_1 gate

Status: passed

Checks (exercised via real kernel enforcement functions):
- one autonomous workspace: verified via FSM transitions (PENDING -> READY -> RUNNING -> SUCCEEDED)
- controller active: stable1Preflight() confirms controller_active=true
- watchdog active: stable1Preflight() confirms watchdog_active=true
- postgres authority: stable1Preflight() confirms postgresAuthority=true
- admission gate active: guardExecutionEntrypoint() admits cli_plan_run entrypoint
- no legacy direct write: stable1Preflight() confirms legacyDirectWritesDisabled=true

Enforcement modules exercised:
- preflight.ts: stable1Preflight()
- admission-guard.ts: guardExecutionEntrypoint(), listAdmissionDecisions()
- admission-gate.ts: admitExecution()

Conclusion:
- stable_1 gate conditions are satisfied. All enforcement preconditions are verified through real kernel functions, not hardcoded values.

