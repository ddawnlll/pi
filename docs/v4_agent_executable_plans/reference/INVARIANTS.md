# ExecutionKernel Invariants

```text
I1   PostgreSQL is authoritative for structured runtime state.
I2   JSON runtime fallback is forbidden in production.
I3   Only WorkspaceAttemptController mutates attempt state.
I4   Only PlanSupervisor mutates plan lifecycle.
I5   Actors emit events only.
I6   Retry can only happen after previous attempt reaches terminal state.
I7   Every non-terminal state has a deadline.
I8   DeadlineWatchdog emits events only; it does not mutate state.
I9   No lock may be held across external await.
I10  Nested resource locks are forbidden.
I11  Git repo-wide mutation only happens through GitRunner queue.
I12  Validation uses lanes; no unrelated process killing.
I13  HANDOFF_REQUIRED creates a handoff queue item.
I14  All execution entrypoints pass AdmissionGate.
I15  Event journal replay reproduces state.
I16  Controller transition writes require expectedVersion.
I17  Brain and diagnostics are proposal/evidence-only.
```
