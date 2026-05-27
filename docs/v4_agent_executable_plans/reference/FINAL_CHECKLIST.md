# Final v4 Checklist

## Runtime truth

```text
[ ] PostgreSQL authoritative runtime state
[ ] JSON runtime fallback disabled in production
[ ] AttemptEventJournal in PostgreSQL
[ ] event replay reproduces current attempt state
```

## State authority

```text
[ ] only WorkspaceAttemptController writes attempt state
[ ] StateAuthority token required
[ ] actors cannot import mutation API
[ ] legacy write detector exists
[ ] compatibility adapter has observe/route/enforce modes
```

## Retry safety

```text
[ ] retry before terminal rejected by FSM
[ ] retry before terminal rejected by controller
[ ] retry router emits proposal/event only
```

## Liveness

```text
[ ] every non-terminal state has deadline
[ ] DeadlineWatchdog supervised
[ ] expired attempt emits deadline_exceeded
[ ] deadline_exceeded leads to terminal/handoff/quarantine path
```

## Leadership

```text
[ ] controller leadership uses Postgres advisory lock or lease
[ ] transition update uses expectedVersion
[ ] version conflicts rejected and logged
```

## Handoff and completion

```text
[ ] HANDOFF_REQUIRED creates handoff_queue row
[ ] unresolved handoff prevents plan completion
[ ] PlanSupervisor completion predicate tested
```

## Admission

```text
[ ] CLI plan run gated
[ ] dashboard run gated
[ ] API plan run gated
[ ] retry endpoint gated
[ ] cleanup rerun gated
[ ] brain/proposal trigger gated
[ ] overnight runner gated
```

## Dogfood

```text
[ ] stable_1 gate passed
[ ] stable_3 dogfood passed
[ ] stable_6 stress passed
[ ] production lock report created
```
