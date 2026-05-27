# P32 — Dogfood and Production Lock

## Purpose

Prove the v4 ExecutionKernel through real dogfood and stress gates before trusting parallel automation.

## Agent mode

The agent may edit tests, dogfood harnesses, reports, and bugfixes. It may run scoped dogfood commands if explicitly configured for local test execution. Do not git push.

## Gates

### stable_1 gate

```text
- one autonomous workspace
- controller active
- watchdog active
- postgres authority
- admission gate active
- no legacy direct write
```

### stable_3 dogfood

Scenario:

```text
3 workspaces:
  - one normal success
  - one validation timeout
  - one LLM/tool timeout or simulated stale executor
```

Expected:

```text
- no infinite RUNNING
- all attempts terminal/handoff
- retry only after terminal
- event journal replay matches state
- no JSON authoritative state
```

### stable_6 stress

Scenario:

```text
6 workspaces:
  - git contention
  - validation heavy lane saturation
  - abort mid-run
  - retry after terminal failure
  - stale lease
  - handoff-required conflict
```

Expected:

```text
- deterministic final plan state
- no orphan process
- no stale worktree lease
- no retry before terminal
- no gate bypass
```

## Reports

Create:

```text
reports/p32/stable_1_gate.md
reports/p32/stable_3_dogfood.md
reports/p32/stable_6_stress.md
reports/p32/production_lock.md
```

## Production lock checklist

```text
[ ] stable_1 passed
[ ] stable_3 dogfood passed
[ ] stable_6 stress passed
[ ] no known legacy writer
[ ] PostgreSQL authoritative
[ ] JSON runtime fallback disabled
[ ] dashboard shows blocked reasons
[ ] handoff workflow usable
```
