# P27 — ExecutionKernel Foundation

Use this plan if P27X was too large and must be continued in clean workspaces.

## Goal

Build the stable, testable ExecutionKernel foundation without yet migrating all legacy actors.

## Workspaces

```text
P27.A  Attempt types and FSM
P27.B  PostgreSQL migration and repositories
P27.C  EventJournal and replay
P27.D  StateAuthority token and StateWriter
P27.E  WorkspaceAttemptController
P27.F  Controller leadership / optimistic versioning
P27.G  DeadlineWatchdog
P27.H  HandoffQueue and PlanSupervisor predicate
P27.I  AdmissionGate skeleton
P27.J  Kernel index exports and docs
```

## Constraints

```text
- agent may edit files and run scoped tests;
- do not run Pi autonomous plan execution;
- do not convert all old actors here;
- keep changes behind feature flags if needed;
- no dual authoritative state writes.
```

## Acceptance

```text
- Unit tests cover all FSM transitions.
- EventJournal replay is deterministic.
- Controller transition write is atomic.
- StateAuthority is required for mutation.
- DeadlineWatchdog emits events only.
- HandoffQueue exists.
- AdmissionGate API exists.
```

## Suggested file layout

```text
packages/coding-agent/src/execution-kernel/
  admission-gate.ts
  attempt-event-journal.ts
  attempt-fsm.ts
  controller-leadership.ts
  deadline-watchdog.ts
  handoff-queue.ts
  legacy-write-adapter.ts
  plan-supervisor.ts
  state-authority.ts
  state-writer.ts
  types.ts
  workspace-attempt-controller.ts
  index.ts

packages/coding-agent/test/execution-kernel/
  *.test.ts
```
