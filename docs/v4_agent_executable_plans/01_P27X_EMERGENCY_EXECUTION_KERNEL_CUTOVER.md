# P27X — Emergency ExecutionKernel Cutover

## Purpose

Implement the minimum v4 runtime foundation tonight so Pi cannot silently stick in RUNNING, retry before terminal state, or use JSON as authoritative runtime truth.

This is an execution-capable patch plan. The agent may edit files and run scoped tests.

## Scope

Implement:

```text
- PostgreSQL schema for attempts/events/transitions/controller inbox/leases/handoff queue
- Attempt FSM
- WorkspaceAttemptController
- StateAuthority token
- EventJournal repository
- controller leadership with PostgreSQL advisory lock or equivalent
- optimistic expectedVersion transition writes
- DeadlineWatchdog
- minimal HandoffQueue
- minimal PlanSupervisor completion predicate
- AdmissionGate skeleton
- legacy state write detector / compatibility adapter
```

## Non-goals

```text
- stable_6 claim
- full dashboard polish
- cloud sandbox
- rewriting all actors
- running Pi autonomous execution
```

## Workspaces

### P27X.A — PostgreSQL schema and repositories

Target files likely include:

```text
packages/db/src/migrations/*
packages/db/src/repositories/*
packages/db/src/types.ts
packages/coding-agent/src/execution-kernel/types.ts
```

Required:

```text
attempts
attempt_events
attempt_transitions
controller_inbox
controller_leases
handoff_queue
```

Acceptance:

```text
- migration creates all tables;
- attempt_events has BIGSERIAL seq and event_id unique;
- attempts has version and current_deadline_at;
- handoff_queue references attempt;
- repository skeletons exist.
```

### P27X.B — Attempt FSM

Target files:

```text
packages/coding-agent/src/execution-kernel/attempt-fsm.ts
packages/coding-agent/test/execution-kernel/attempt-fsm.test.ts
```

Acceptance:

```text
- legal transitions pass;
- illegal transitions reject;
- retry before terminal rejects;
- terminal states are immutable except controlled metadata updates;
- every non-terminal state has a deadline policy.
```

### P27X.C — EventJournal

Target files:

```text
packages/coding-agent/src/execution-kernel/attempt-event-journal.ts
packages/coding-agent/test/execution-kernel/attempt-event-journal.test.ts
```

Acceptance:

```text
- append event;
- idempotent append by event_id;
- list by attempt;
- replay returns ordered seq;
- event_version present.
```

### P27X.D — StateAuthority token and StateStore writer

Target files:

```text
packages/coding-agent/src/execution-kernel/state-authority.ts
packages/coding-agent/src/execution-kernel/state-writer.ts
packages/coding-agent/test/execution-kernel/state-authority.test.ts
```

Acceptance:

```text
- transition API requires StateAuthorityToken;
- token only created inside controller module;
- actors cannot import mutation primitive directly;
- tests prove write without token fails.
```

### P27X.E — WorkspaceAttemptController

Target files:

```text
packages/coding-agent/src/execution-kernel/workspace-attempt-controller.ts
packages/coding-agent/test/execution-kernel/workspace-attempt-controller.test.ts
```

Acceptance:

```text
- handleEvent loads attempt;
- reduces event through FSM;
- appends event;
- writes transition with expectedVersion;
- rejects version conflict;
- creates handoff_queue row for HANDOFF_REQUIRED;
- rejects retry before terminal.
```

### P27X.F — Controller leadership

Target files:

```text
packages/coding-agent/src/execution-kernel/controller-leadership.ts
packages/coding-agent/test/execution-kernel/controller-leadership.test.ts
```

Acceptance:

```text
- pg advisory lock or controller_leases based lock exists;
- only one controller can process an attempt transition at a time;
- version conflict emits controller_conflict;
- lock not held across external work, only transition transaction.
```

### P27X.G — DeadlineWatchdog

Target files:

```text
packages/coding-agent/src/execution-kernel/deadline-watchdog.ts
packages/coding-agent/test/execution-kernel/deadline-watchdog.test.ts
```

Acceptance:

```text
- scans expired non-terminal attempts;
- emits deadline_exceeded into controller_inbox;
- does not mutate attempt state directly;
- watchdog job can be started/stopped safely;
- duplicate deadline events are idempotent.
```

### P27X.H — HandoffQueue and completion predicate

Target files:

```text
packages/coding-agent/src/execution-kernel/handoff-queue.ts
packages/coding-agent/src/execution-kernel/plan-supervisor.ts
packages/coding-agent/test/execution-kernel/plan-supervisor.test.ts
```

Acceptance:

```text
- HANDOFF_REQUIRED creates handoff queue item;
- plan becomes AWAITING_HANDOFF if required workspace handoff exists;
- plan becomes FAILED_FINAL if required workspace failed final;
- plan enters FINAL_VALIDATION only when all required workspaces succeeded;
- plan cannot complete with unresolved handoff.
```

### P27X.I — AdmissionGate

Target files:

```text
packages/coding-agent/src/execution-kernel/admission-gate.ts
packages/coding-agent/test/execution-kernel/admission-gate.test.ts
```

Acceptance:

```text
- rejects postgres_unavailable;
- rejects json_runtime_fallback in production;
- rejects repair/autonomous mismatch;
- rejects missing promotion gates;
- exposes a single API for plan-run/retry/cleanup/brain triggers.
```

### P27X.J — Legacy write detector / compatibility adapter

Target files:

```text
packages/coding-agent/src/execution-kernel/legacy-write-adapter.ts
packages/coding-agent/test/execution-kernel/legacy-write-adapter.test.ts
```

Acceptance:

```text
- old mutation call can be routed to controller event;
- legacy_state_write_detected event/audit exists;
- no dual authoritative write;
- feature flag allows observe-only then enforce mode.
```

## Manual validation commands

Run scoped commands appropriate for the repository. Suggested:

```bash
pnpm --filter db test
pnpm --filter coding-agent test -- execution-kernel
pnpm --filter coding-agent typecheck
```

## Rollback

```text
- revert execution-kernel files;
- revert DB migration only before applying to shared DB;
- disable feature flags;
- restore legacy state writer only if no execution is active;
- preserve attempt_events/controller_inbox logs for analysis.
```

## Done when

```text
[ ] retry-before-terminal impossible at FSM/controller layer
[ ] expired RUNNING attempt produces deadline_exceeded event
[ ] attempt transition requires expectedVersion
[ ] no JSON authoritative fallback in production mode
[ ] handoff queue row created for HANDOFF_REQUIRED
[ ] plan completion predicate tested
```
