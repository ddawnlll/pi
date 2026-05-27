# P28 — Runtime Audit and Shadow Mode

## Purpose

Map all implicit state mutation in the current runtime and run ExecutionKernel in shadow mode without changing behavior yet.

## Agent mode

The agent may edit repository files and run scoped tests. Do not start autonomous Pi execution.

## Workspaces

### P28.A — Mutation inventory

Search for all direct state mutation paths:

```text
workspace status writes
plan status writes
retry attempt creation
cleanup finalize/rerun mutation
brain-triggered mutation
lease monitor mutation
validation result mutation
JSON state writes
dashboard/API mutation endpoints
```

Output artifact:

```text
reports/p28/mutation-inventory.md
```

Required table:

```text
file | function | current mutation | target event | migration risk
```

### P28.B — Shadow EventJournal

Add shadow event emission for legacy state changes.

Acceptance:

```text
- legacy state writes emit shadow events;
- no behavior changes;
- old state and kernel replay comparison report exists.
```

### P28.C — Compatibility adapter observe mode

Implement:

```text
legacy_state_write_detected
legacy write -> optional controller event
mode: observe | route | enforce
```

Acceptance:

```text
- observe mode default;
- no dual authoritative write;
- audit logs show old writers.
```

### P28.D — Old state vs kernel replay comparator

Acceptance:

```text
- compares current legacy state with replayed attempt state;
- reports divergence;
- does not mutate state.
```

## Validation

```bash
pnpm --filter coding-agent test -- execution-kernel legacy-write shadow
pnpm --filter coding-agent typecheck
```

## Done when

```text
[ ] mutation inventory complete
[ ] shadow events emitted
[ ] replay comparator exists
[ ] no enforcement yet unless explicitly enabled
```
