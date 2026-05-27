# Migration Strategy — No Dual Authority

## Rule

There must never be a phase where old writers and the new controller both authoritatively write state independently.

## Phases

### M0 — Shadow mode

```text
old state remains authority
kernel emits/replays shadow events
no behavior change
```

### M1 — Compatibility adapter

```text
old writes go through legacy adapter
adapter emits legacy_state_write_detected
optional route mode sends event to controller
```

### M2 — Actor conversion

```text
actors convert one by one to event-only:
  retry
  validation
  lease
  cleanup
  brain/diagnostics
  executor
```

### M3 — Enforcement

```text
StateAuthority token required
direct mutation rejected
legacy adapter enforce mode
```

### M4 — Delete legacy APIs

```text
remove old mutation helpers
remove JSON runtime state fallback
production lock
```

## Dangerous forbidden state

```text
old writer writes StateStore
new controller also writes attempts
dashboard reads mixed truth
scheduler reads stale JSON
```

This is forbidden.
