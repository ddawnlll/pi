# P37.HOTFIX-STOP-CONTINUE-RACE — Stop/Continue Attempt Lifecycle Race Fix

## Root Cause

When a plan stop was requested, the executor immediately reset active workspaces from **Active → Pending** while the outer `executeWorkspace()` function was still executing post-agent logic (completion gate evaluation, workspace transitions). The race sequence:

1. User requests stop via `checkControlRequest()` (or external API)
2. `abortAndResetActiveWorkspaces()` calls `stopAllActiveWorkspaces()`:
   - Aborts executors and waits for **inner** in-flight execution promises to settle
   - The inner promises are the agent execution promises, **not** the full `executeWorkspace()` function
   - After the inner promises settle, the IIFE in `executeWorkspace()` has completed, **but the outer function continues** past `await executionPromise` to evaluate the completion gate and call `transitionWorkspace()`
3. `abortAndResetActiveWorkspaces()` then transitions active workspaces **directly to Pending** via `stateStore.transitionWorkspace()`
4. The outer `executeWorkspace()` continues and calls `transitionRouter.transitionWorkspace()` to go to Complete/Succeeded
5. The workspace is now in Pending state, but the code tries Pending → Complete/Succeeded
6. **Result**: `Illegal attempt transition: PENDING -> SUCCEEDED`

The `inFlightExecutions` map tracked only the inner agent execution promise (the IIFE), not the entire `executeWorkspace()` function. After `Promise.allSettled()` returned on the inner promises, the outer function was still running and could race with the state transition to Pending.

## What Changed

### 1. `autonomous-executor.ts` — Core race fix

**New fields:**
- `isStopping` — Boolean flag preventing the scheduler from starting new work during drain
- `inFlightAttemptNos` — Map of `workspaceId → attemptNo` for stale attempt identity tracking
- `stopMutex` — Serializes stop operations for idempotency
- `stopDrainTimeoutMs` — Hard timeout (default 30s) for drain phase

**New methods:**
- `isAttemptStale(planExecutionId, workspaceId, expectedAttemptNo?)` — Checks if a workspace execution result should be treated as stale by verifying:
  - Plan status is not stopped/cancelled
  - Workspace stage is still Active or Pending
  - Attempt number matches (when provided)
- `drainAndTerminalizeActiveWorkspaces(planExecutionId, options)` — Replaces `abortAndResetActiveWorkspaces()`:
  1. Sets `isStopping = true` (prevents new scheduling)
  2. Aborts all executors
  3. Waits for in-flight execution promises to settle with hard timeout
  4. Force-kills processes on timeout (logs `workspace_inflight_kill_timeout`)
  5. **Terminalizes** each active workspace to **Failed** (not Pending) with stop reason
  6. Releases file locks and cleans up executor tracking
  7. Uses `stopMutex` for idempotency

**Updated `checkControlRequest()`:**
- Stop action now calls `drainAndTerminalizeActiveWorkspaces()` instead of `abortAndResetActiveWorkspaces()`
- Adds diagnostics logs: `plan_stop_requested`, `plan_stop_draining_started`
- Clears `isStopping` after stop completes
- Idempotency check: skips second stop request if already stopping and plan is stopped

**Updated `getNextWorkspaces()`:**
- Returns empty immediately when `isStopping` is true (prevents scheduler from starting new work during drain)

**Updated `stopAllActiveWorkspaces()`:**
- Clears `inFlightAttemptNos`
- Calls `killPlanProcesses()` instead of global `killTrackedDetachedChildren()` for scope-aware cleanup

**Stale attempt protection in `executeWorkspace()`:**
- Captures `currentAttemptNo` after `incrementRetryAttempt()` and stores in `inFlightAttemptNos`
- Before the completion gate transition: checks `isAttemptStale()` — if stale, logs `stale_attempt_completion_ignored` and returns without transitioning
- In the catch block: checks `isAttemptStale()` before retry/fail transitions — if stale or plan is stopping, returns cleanly
- Additional `isStopping` check before retry transition to prevent retry during stop

**Updated `adoptExistingExecution()`:**
- Active workspaces are first **terminalized** to Failed (via TransitionRouter), then reset to Pending
- Direct Active → Pending is no longer used (was the race vector)
- Failed/Blocked workspaces can still be reset to Pending directly

### 2. `workspace-scheduler.ts` — No changes needed

The `isStopping` check in `getNextWorkspaces()` in the executor handles prevention of new scheduling. The scheduler interface was not modified.

### 3. `transition-router.ts` — No changes needed

The existing FSM rejection in `routeStageTransition()` catches illegal transitions (PENDING → SUCCEEDED). The stale attempt guard in `AutonomousExecutor` prevents reaching this state by checking identity before calling `transitionWorkspace()`.

## Test Results

| Test Suite | Tests | Result |
|---|---|---|
| `stop-continue-race.test.ts` | 15 | **PASSED** |
| `completion-gate.test.ts` (existing) | 83 | **PASSED** (no regression) |
| `completion-gate-equivalent-command.test.ts` | 19 | **PASSED** (no regression) |
| `npm run check` (biome + tsgo) | — | **PASSED** |

### Test Cases

| Test | Scenario | Verified |
|---|---|---|
| T1 | Stop sets `isStopping` flag preventing new work | ✓ |
| T1 | `getNextWorkspaces` returns empty when stopping | ✓ |
| T1 | Active workspaces are terminalized to Failed (not Pending) | ✓ |
| T2 | `isAttemptStale` detects workspace terminalized by stop | ✓ |
| T2 | `isAttemptStale` does NOT flag current active workspaces | ✓ |
| T2 | `isAttemptStale` detects stale when plan is stopped | ✓ |
| T3 | `isAttemptStale` returns stale for Complete (terminal) stage | ✓ |
| T3 | `isAttemptStale` returns stale for Blocked stage | ✓ |
| T4 | `adoptExistingExecution` terminalizes active before resetting | ✓ |
| T4 | Completed workspaces remain complete after adopt | ✓ |
| T5 | `isStopping` flag prevents duplicate drain | ✓ |
| T5 | `stopMutex` prevents concurrent drain | ✓ |
| T6 | `drainAndTerminalizeActiveWorkspaces` releases file locks | ✓ |
| T7 | `stopAllActiveWorkspaces` calls `killPlanProcesses` | ✓ |
| T7 | `stopAllActiveWorkspaces` clears `inFlightAttemptNos` | ✓ |

## Acceptance Criteria

| Criterion | Status |
|---|---|
| Stop prevents new workspace scheduling immediately | ✓ `isStopping` checked before `getNextWorkspaces` schedules |
| Stop drains or terminalizes active in-flight work before any reset | ✓ `drainAndTerminalizeActiveWorkspaces` terminalizes to Failed |
| Late worker success after stop is ignored as stale | ✓ `isAttemptStale()` guards in executeWorkspace |
| No PENDING → SUCCEEDED transition is attempted by executor | ✓ Stale guard returns before any transition |
| Continue/rerun only resets terminal workspaces | ✓ `adoptExistingExecution` first terminalizes Active, then resets |
| Stop is idempotent | ✓ `stopMutex` + `isStopping` flag + early return |
| File locks are released safely | ✓ Released in `drainAndTerminalizeActiveWorkspaces` |
| Process scopes are cleaned up | ✓ `killPlanProcesses` instead of global kill |
| Tests for stop/continue race pass | ✓ 15 test cases |
| Existing completion gate equivalent-command tests still pass | ✓ 19 test cases |
| Existing stable execution behavior is preserved | ✓ 83 existing completion gate tests |

## Diagnostics Events Added

- `plan_stop_requested` — logged when stop action is detected in `checkControlRequest`
- `plan_stop_draining_started` — logged with number of active workspaces during drain
- `workspace_inflight_kill_timeout` — logged when drain timeout fires
- `stale_attempt_completion_ignored` — logged when stale attempt is detected in executeWorkspace (both success and failure paths)
- `workspace_reset_after_terminal_only` — logged in `adoptExistingExecution` when resetting after terminalization

## Remaining Limitations

1. **PlanRunner pause flow** — The `executePlanInBackground()` function in `plan-runner.ts` also has its own pause/stop handling that directly manipulates workspace state. This was not modified because the task scope was limited to executor-level race fixes. The plan runner should ideally use the executor's `drainAndTerminalizeActiveWorkspaces()` method instead of directly stopping workspaces.

2. **Attempt identity persistence** — The `inFlightAttemptNos` map is in-memory only and is not persisted across crash recovery. On recovery, `adoptExistingExecution` terminalizes stranded Active workspaces as a mitigation.

3. **TransitionRouter fallback** — In `drainAndTerminalizeActiveWorkspaces`, if the FSM rejects the Active → Failed transition (e.g., because the attempt is already in an unexpected state), a direct `stateStore.transitionWorkspace()` is used as safety net. This bypasses FSM enforcement.

4. **KernelTransitionRouter cache** — The `KernelTransitionRouter` has an in-memory `attemptCache` that may contain stale entries if the attempt was terminalized by a different path. This could cause the FSM to use stale state for verification.

## Recovery Instructions

To recover from a current P37 run that hit the `Illegal attempt transition: PENDING -> SUCCEEDED` error:

1. If an executor/server process is still running, stop it
2. Restart the server so the hotfix code is loaded
3. Use the continue/rerun API:
   - For workspaces stuck in `Failed` state due to the illegal transition, use `rerunExecution()` to reset them to Pending
   - For workspaces stuck in `Pending` state with no failures, they will be re-scheduled automatically
   - Completed workspaces are preserved
4. Do NOT manually mutate database state — the `rerunExecution()` method handles terminal workspace reset properly

## Files Modified

- `packages/coding-agent/src/core/autonomous-executor.ts` — Core race fix:
  - Added `isStopping`, `inFlightAttemptNos`, `stopMutex`, `stopDrainTimeoutMs` fields
  - Added `isAttemptStale()` stale attempt identity check
  - Added `drainAndTerminalizeActiveWorkspaces()` replacing `abortAndResetActiveWorkspaces()`
  - Updated `checkControlRequest()` for stop to use drain flow
  - Updated `getNextWorkspaces()` with `isStopping` check
  - Updated `stopAllActiveWorkspaces()` with scope-aware cleanup and attempt tracking cleanup
  - Updated `executeWorkspace()` with stale attempt guards before transitions
  - Updated `adoptExistingExecution()` to terminalize Active before resetting
  - Added `stopDrainTimeoutMs` to `AutonomousExecutorConfig`

## Files Created

- `packages/coding-agent/test/execution/stop-continue-race.test.ts` — 15 test cases
- `reports/p37-hotfix-stop-continue-race/2026-05-30T03-10-00Z/summary.md` — this report
