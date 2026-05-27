# Vision — Pi v4 ExecutionKernel Final State

## One-line goal

Pi becomes an event-sourced, PostgreSQL-authoritative, single-state-authority execution system where parallel actors do work, but only the ExecutionKernel decides state.

## Final mental model

```text
Human / CLI / Dashboard / API
        |
        v
ExecutionAdmissionGate
        |
        v
PlanSupervisor
  - owns plan lifecycle
  - owns scheduler slots
  - evaluates completion predicate
        |
        v
ControllerLeadership
  - PostgreSQL advisory lock / lease
  - optimistic expectedVersion transition writes
        |
        v
WorkspaceAttemptController
  - owns attempt FSM
  - only writer of attempt state
  - rejects retry before terminal state
        |
        +--> AttemptEventJournal in PostgreSQL
        +--> StateStoreWriter with StateAuthority token
        +--> HandoffQueue for HANDOFF_REQUIRED
        +--> DeadlineWatchdog feeds deadline_exceeded events

Actors emit events only:
  ExecutorActor
  ValidationActor
  GitRunner / WorktreeActor
  LeaseActor
  IntegrationActor
  Brain / Diagnostics / RootCause
```

## Non-negotiable final invariants

```text
I1   PostgreSQL is authoritative for structured runtime state.
I2   JSON runtime fallback is forbidden in production.
I3   Only WorkspaceAttemptController mutates attempt state.
I4   Only PlanSupervisor mutates plan lifecycle state.
I5   Actors emit events only.
I6   Retry can only happen after previous attempt reaches a terminal state.
I7   Every non-terminal attempt state has a deadline.
I8   DeadlineWatchdog must convert expired deadlines into controller events.
I9   No lock may be held across LLM/tool/validation/git/human-await.
I10  Git repo-wide mutation only happens through GitRunner queue.
I11  Validation uses lanes: heavy max 1, targeted max 3 by default.
I12  HANDOFF_REQUIRED creates a handoff_queue record.
I13  All execution entrypoints pass ExecutionAdmissionGate.
I14  AttemptEventJournal replay reproduces current state.
I15  Brain/diagnostics are proposal/evidence-only, not state writers.
I16  Controller transition writes require expectedVersion.
I17  Version conflict rejects the transition and emits controller_conflict.
```

## What “done” means

Pi is not “done” when code compiles. Pi is done when:

```text
- no workspace can remain RUNNING forever silently;
- no retry can start before the previous attempt terminalizes;
- no non-controller code can mutate attempt state;
- no JSON file is authoritative runtime state;
- no execution entrypoint bypasses admission;
- stable_3 dogfood passes;
- stable_6 stress passes before 6-worker automation is trusted.
```

## What stays file-based

```text
Filesystem / artifact storage:
  stdout/stderr logs
  raw tool output
  patches
  debug bundles
  exported replay files
  human-readable handoff markdown

PostgreSQL:
  all authoritative runtime state
  event journal
  attempt transitions
  leases
  controller inbox
  validation run records
  handoff queue metadata
  promotion gates
```
