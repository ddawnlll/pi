# P29 — Actor Migration to Event-Only

## Purpose

Convert critical runtime actors so they no longer mutate attempt state directly.

## Agent mode

The agent may edit files and run scoped tests. Do not run Pi autonomous plan execution until gates pass.

## Migration order

```text
1. RetryRouter
2. ValidationRunner / bash validation path
3. LeaseMonitor
4. CleanupReview
5. Brain workers / diagnostics
6. ExecutorActor / workspace-agent-executor paths
```

## Required rule

```text
Actors emit events.
AttemptController mutates state.
RetryPolicy suggests retry; it never creates attempts directly.
```

## Workspaces

### P29.A — RetryRouter event-only

Acceptance:

```text
- retry router emits retry_requested;
- controller rejects retry unless current attempt terminal;
- no direct creation of retry attempt outside controller.
```

### P29.B — ValidationActor event-only

Acceptance:

```text
- validation starts emit validation_started;
- pass/fail/timeout emit validation_passed/failed/timed_out;
- no direct status write;
- managed runner still kills process tree on timeout.
```

### P29.C — LeaseActor event-only

Acceptance:

```text
- stale lease emits lease_stale_detected;
- quarantine emits lease_quarantine_requested;
- controller decides attempt state.
```

### P29.D — CleanupReview event-only

Acceptance:

```text
- cleanup completion emits cleanup_completed;
- cleanup failure emits cleanup_failed;
- rerun cleanup passes AdmissionGate.
```

### P29.E — Brain/diagnostics proposal-only

Acceptance:

```text
- brain workers emit proposal/evidence;
- no direct start/stop/retry/fail/complete;
- ProposalInbox validates before controller action.
```

### P29.F — ExecutorActor event-only

Acceptance:

```text
- workspace started/running/tool events emitted;
- LLM timeout emits llm_timeout;
- executor does not write final state directly.
```

## Validation

```bash
pnpm --filter coding-agent test -- retry validation lease cleanup brain diagnostics workspace-agent-executor
pnpm --filter coding-agent typecheck
```

## Done when

```text
[ ] no converted actor imports direct mutation API
[ ] all converted actor state effects visible as events
[ ] retry-before-terminal test passes
[ ] shadow replay matches expected converted state
```
