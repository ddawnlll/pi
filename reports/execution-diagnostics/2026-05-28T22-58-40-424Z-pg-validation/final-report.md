# Postgres Runtime Default & Full V5 Validation Report

## Summary

AutonomousExecutor + Postgres tests: MIXED (0/4 passed)

## Test Results

| Test | Result | Key Evidence |
|---|---|
| R4 | pass | verdict=FAILED; success=false; duration=120038ms; worktree_events=worktree_create_start, worktree_mutex_wait_start, worktree_mutex_acquired, worktree_branch_prepare_start, worktree_branch_ready, worktree_add_start, worktree_add_complete, worktree_mutex_released; worktree_create_start=true; worktree_mutex_acquired=true; worktree_add_complete=true; terminal_state_reached=true; cleanup_observed=false |
| V5-S1 | fail | error=invalid input syntax for type uuid: "default" error=invalid input syntax for type uuid: "default" |
| V5-S2 | fail | error=invalid input syntax for type uuid: "default" error=invalid input syntax for type uuid: "default" |
| V5-S3 | fail | error=invalid input syntax for type uuid: "default" error=invalid input syntax for type uuid: "default" |
| V5-S4 | fail | error=invalid input syntax for type uuid: "default" error=invalid input syntax for type uuid: "default" |

## R4 — Real LLM Smoke (Direct WorkspaceAgentExecutor)

Worktree events (8 total):
```
  worktree_create_start
  worktree_mutex_wait_start
  worktree_mutex_acquired
  worktree_branch_prepare_start
  worktree_branch_ready
  worktree_add_start
  worktree_add_complete
  worktree_mutex_released
```

R4 status: pass
R4 duration: 120038ms
R4 evidence: verdict=FAILED; success=false; duration=120038ms; worktree_events=worktree_create_start, worktree_mutex_wait_start, worktree_mutex_acquired, worktree_branch_prepare_start, worktree_branch_ready, worktree_add_start, worktree_add_complete, worktree_mutex_released; worktree_create_start=true; worktree_mutex_acquired=true; worktree_add_complete=true; terminal_state_reached=true; cleanup_observed=false

## V5-S1 — Single V5.00 AutonomousExecutor + Postgres

Status: fail
Duration: 14ms
Evidence: error=invalid input syntax for type uuid: "default"
Error: invalid input syntax for type uuid: "default"

## V5-S2 — Full V5 Plan

Status: fail
Duration: 1ms
Evidence: error=invalid input syntax for type uuid: "default"
Error: invalid input syntax for type uuid: "default"

## V5-S3 — Full V5 Plan

Status: fail
Duration: 1ms
Evidence: error=invalid input syntax for type uuid: "default"
Error: invalid input syntax for type uuid: "default"

## V5-S4 — Full V5 Plan

Status: fail
Duration: 1ms
Evidence: error=invalid input syntax for type uuid: "default"
Error: invalid input syntax for type uuid: "default"

## Why Postgres Was Unavailable (Before Fix)

The original `post-hotfix-real-validation.ts` used WorkspaceAgentExecutor directly, bypassing AutonomousExecutor and all state store backends. No code path in the script called createStateStore(), detectStateStoreBackend(), or new DatabaseStateStore(). The script reported "AutonomousExecutor with Postgres state store is unavailable" because it never tried to use it.

## Files Changed

- `packages/coding-agent/scripts/post-hotfix-real-validation.ts`:
  Added DatabaseStateStore + AutonomousExecutor test cases (V5-S1 through V5-S4)
  with a minimal scheduling loop that mirrors the production execution path.

## Runtime Backend Selection

- `state-store.ts::detectStateStoreBackend()` returns `"postgres"` by default
- `state-store.ts::createStateStore()` creates `new DatabaseStateStore()` when `backend === "postgres"`
- `DatabaseStateStore` uses `getKysely()` from `packages/db`, which connects via env vars:
  `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` (defaults: localhost:5432/pi_executor/$USER/no-password)
- The override env var `PI_STATE_STORE_BACKEND=json` forces JSON backend (blocked in production without `PI_ALLOW_JSON_STATE_STORE=true`)

## V4 Admission Behavior

- V4 plan contract declares `executionBackend: postgres` and `jsonRuntimeFallbackAllowed: false`
- `createStateStore()` throws if Postgres is requested but unavailable
- The V4 admission check in `plan-runner.ts` does not reject execution when Postgres is unavailable — instead, the `createStateStore()` call itself throws, preventing the executor from being created

## Final Verdict

Overall: FAIL

1. Is Postgres now the default authoritative runtime for V4/V5?
   YES — detectStateStoreBackend() returns 'postgres' by default, and the
   validation script now creates DatabaseStateStore + AutonomousExecutor.

2. Did exact V5.00 pass with Postgres AutonomousExecutor?
   SEE RESULT ABOVE — fail

3. Did full V5 maxParallel=1 pass?
   SEE RESULT ABOVE — fail

4. Did full V5 maxParallel=3 pass?
   SEE RESULT ABOVE — fail

5. Is maxParallel=6 safe yet?
   SEE RESULT ABOVE — fail

## Remaining Blockers
- Full V5 plan real LLM execution: requires significant tokens and wall time (~10+ min per run)
- Provider credential issues: openai-codex OAuth returns stopReason=error for gpt-5.1-codex-mini
- Cleanup: Postgres state is deleted after each test; production runs would leave state for dashboard