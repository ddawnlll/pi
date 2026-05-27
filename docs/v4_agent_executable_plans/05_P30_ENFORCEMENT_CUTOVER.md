# P30 — Enforcement Cutover

## Purpose

Turn ExecutionKernel from shadow/routing mode into authoritative enforcement mode.

## Agent mode

The agent may edit files and run scoped tests. Do not run stable_3/stable_6 until gates pass.

## Scope

```text
- direct mutation API disabled
- StateAuthority required
- AdmissionGate mandatory for all entrypoints
- JSON runtime fallback disabled in production
- legacy compatibility adapter in enforce mode
- PlanSupervisor becomes plan lifecycle authority
```

## Workspaces

### P30.A — StateAuthority enforcement

Acceptance:

```text
- all attempt state writes require StateAuthorityToken;
- unauthorized legacy writes fail loudly;
- legacy_state_write_rejected event emitted.
```

### P30.B — AdmissionGate mandatory entrypoints

Cover:

```text
cli_plan_run
dashboard_run
api_plan_run
retry_endpoint
cleanup_rerun_endpoint
brain_worker_trigger
overnight_runner
proposal_executor
```

Acceptance:

```text
- no entrypoint starts execution without gate decision;
- gate decision persisted in admission_decisions or equivalent.
```

### P30.C — JSON fallback production kill switch

Acceptance:

```text
- production mode refuses JSON authoritative fallback;
- DB unavailable => BLOCKED_WITH_REASON / postgres_unavailable;
- JSON allowed only for import/export/debug/test adapter.
```

### P30.D — Completion and handoff enforcement

Acceptance:

```text
- unresolved handoff prevents plan completion;
- final validation failure prevents completion;
- required failed workspace fails plan.
```

### P30.E — stable_1 preflight

Acceptance:

```text
- one autonomous workspace can run only after gates:
  - controller active
  - watchdog active
  - postgres authority
  - admission gate
  - no legacy direct writes
```

## Validation

```bash
pnpm --filter coding-agent test -- execution-kernel admission state-authority completion json-state-store
pnpm --filter coding-agent typecheck
```

## Done when

```text
[ ] direct state writes rejected
[ ] all entrypoints gated
[ ] JSON runtime fallback forbidden in production
[ ] stable_1 preflight passes
```
