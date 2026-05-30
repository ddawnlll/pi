# P37.RCA-CONTINUE-FAILED-PLAN — Root Cause Analysis

## Overview

The Continue button does not resume a failed P37 plan back to running, and stale worker completion causes: `Illegal attempt transition: PENDING -> SUCCEEDED`.

## Exact UI/API Path for Continue Button

1. **Dashboard `App.tsx:105`** calls `sendRerunCommand(projectId, planExecId)`
2. **`sendRerunCommand`** (`App.tsx:99-106`) sends `POST /api/projects/:projectId/plans/:planExecId/rerun`
3. **Server route** (`index.ts:2222`) checks effective status is `failed`/`stopped`/`cancelled`, then calls `continuePlanExecution(workspaceRoot, projectId, planExecId)`
4. **`continuePlanExecution`** (`plan-runner.ts:2137`) calls `recoverSingleExecution(workspaceRoot, projectId, planExecId, { allowTerminal: true })`
5. **`recoverSingleExecution`** (`plan-runner.ts:1924`) creates a *new* `AutonomousExecutor` and calls `adoptExistingExecution(planExecId, queue, { allowTerminal: true })`
6. **`adoptExistingExecution`** (`autonomous-executor.ts:200`):
   - Loads state from DB
   - Resets `Failed`/`Blocked` workspaces to `Pending` via `stateStore.transitionWorkspace` (direct, bypassing router)
   - Calls `stateStore.resumePlan(planExecId)` to set plan = `running`
   - Reloads state cache
7. **Background loop starts** (`executePlanInBackground`) with the new executor

The Continue path **is architecturally correct** — it calls `recoverSingleExecution` with `allowTerminal:true`, creates a fresh executor, resets workspaces, and resumes the plan. However, it has a critical race condition with stale old-executor promises.

---

## Root Cause 1: Stale Worker Completion After Continue (H1 confirmed)

### Exact code path for `Illegal attempt transition: PENDING -> SUCCEEDED`

**Error source:**
- `attempt-fsm.ts:28` — `assertLegalTransition("PENDING", "SUCCEEDED")` throws
- Called from `transition-router.ts:313` — `routeStageTransition` default case (catch-all FSM validation)
- `transition-router.ts:242` — `KernelTransitionRouter.transitionWorkspace()` reads workspace stage **fresh from DB** via `stateStore.getWorkspaceState()`

### The Race (step by step)

1. **Old executor starts workspace ws-A**: `Pending → Active` via TransitionRouter. In-memory cache: `ws-A = Active`, plan = `running`
2. **User clicks Stop**: API calls `stateStore.stopPlan()` — plan = `stopped` in DB. The old executor's cache is NOT updated.
3. **User clicks Continue**: `adoptExistingExecution` resets ws-A to `Pending` in DB (via direct `stateStore.transitionWorkspace`, bypassing router). Old executor's cache still shows `Active`.
4. **Old executor's agent completes** (COMPLETE verdict) — the `executeWorkspace()` promise from the old executor was never cancelled; the LLM call completed normally.
5. **Old executor's stale attempt guard** (`autonomous-executor.ts:389`):
   - `this.isStopping` = `false` (never set — the API stop path bypasses `drainAndTerminalizeActiveWorkspaces`)
   - `isAttemptStale()` checks `this.currentPlanState` (stale in-memory cache):
     - plan = `running` (not `stopped` — cache is stale)
     - ws-A = `Active` (not `Pending` — cache is stale)
     - attempt number matches `inFlightAttemptNos`
   - Returns `{ stale: false }` — **STALE GUARD DOES NOT CATCH IT**
6. **Old executor proceeds to transition**: calls `transitionRouter.transitionWorkspace(planExecId, ws-A, WorkspaceStage.Complete)`
7. **Router reads FRESH from DB** (`KernelTransitionRouter.transitionWorkspace` line 242): ws-A stage = `Pending` (set by Continue)
8. `routeStageTransition(Pending, Complete)` hits the default case:
   ```typescript
   const fromState = mapStageToAttemptState(currentStage); // PENDING
   const toState = mapStageToAttemptState(newStage);       // SUCCEEDED
   assertLegalTransition(fromState, toState);              // throws!
   ```
9. Error logged: `Illegal attempt transition: PENDING -> SUCCEEDED`

### Why the stale guard fails — root cause

`isAttemptStale()` (`autonomous-executor.ts:341-363`) uses the executor's `this.currentPlanState` — which is the **in-memory cache**, not the database. The cache was loaded when the executor was initialized (before stop/continue) and was never reloaded.

| Check | Source | Value (stale cache) | DB reality |
|-------|--------|---------------------|------------|
| Plan status | `this.currentPlanState.status` | `running` | `stopped` then `running` (continue resumed) |
| Workspace stage | `this.currentPlanState.workspaces.get(id).stage` | `Active` | `Pending` (reset by continue) |
| Attempt number | `this.currentPlanState.workspaces.get(id).attempts` | matches | matches (attempt not incremented by reset) |

**All three checks use stale data. The guard is ineffective for old-executor promises.**

### Why the transition router catches it (correctly)

`KernelTransitionRouter.transitionWorkspace()` (`transition-router.ts:236-249`) calls `stateStore.getWorkspaceState()` which reads **fresh from the database**. The workspace was already reset to `Pending` by `adoptExistingExecution`, so the router sees `Pending` and the FSM correctly rejects `PENDING -> SUCCEEDED`.

**The FSM is correct. The guard is broken.**

---

## Root Cause 2: Stop Does Not Drain In-Flight Work (H2 confirmed)

### The stop API endpoint (`index.ts:3806`)

```typescript
case "stop":
    await stateStore.stopPlan(planExecId, "Stopped by user");
    signalExecutionEvent(planExecId, "stop");
    break;
```

**What it does NOT do:**
- Does NOT call `stateStore.writeControlRequest()` — so `checkControlRequest()` returns `null`
- Does NOT set `isStopping = true` — so the stale guard's `this.isStopping` check always passes
- Does NOT call `drainAndTerminalizeActiveWorkspaces()` — so executors aren't aborted, workspaces aren't terminalized
- Does NOT call `stopAllActiveWorkspaces()` — so in-flight promises aren't awaited
- Does NOT call `updateExecutionStatus()` — so `exec.status` in the plan-runner remains `running`

### Plan-runner stop detection gap

The plan-runner's while loop checks:
```typescript
let exec = activeExecutions.get(planExecId);
if (!exec || exec.status === "stopped" || exec.status === "cancelled") { ... }
```
But `exec.status` is only updated via `updateExecutionStatus()`, which the API does NOT call. So the plan-runner does NOT detect the stop via this check.

The plan-runner also does NOT check the plan status (from `loadState()`) for `stopped` at the top of the loop. It only checks `paused`:
```typescript
const planStateCheck = executor.getState();
if (planStateCheck && planStateCheck.status === "paused") { ... }
```
No equivalent check for `stopped` or `cancelled`.

**Result**: The stop signal only takes effect when:
- The plan-runner happens to be waiting on `completionBus.nextCompletion()` (stop signal wakes it), OR
- `getNextWorkspaces()` returns `[]` because the executor's (reloaded) cache shows `stopped`

Both paths are too late if `Promise.allSettled` is already executing workspaces.

---

## Root Cause 3: Plan Gets Stuck — `exec.status` Never Updated

After the stop:
1. Plan-runner loop exits via one of the delayed detection paths
2. Completion verification runs, tries to complete/fail the plan
3. The plan-runner calls `executor.completePlan()` or `executor.failPlan()`, potentially overriding the "stopped" status set by the API
4. When user clicks Continue, `continuePlanExecution` calls `recoverSingleExecution`
5. If the queue snapshot was deleted (by `updateExecutionStatus` called elsewhere), `loadWorkspaceQueue` returns null
6. `recoverSingleExecution` returns `false`
7. API returns: "Execution could not be continued. It may be complete or missing its queue snapshot/plan metadata."

---

## Summary

| Cause | Description | Files | Fix |
|-------|-------------|-------|-----|
| **RC1: Stale completion race** | Old executor's stale guard uses in-memory cache; router reads fresh DB. Cache says Active, DB says Pending | `autonomous-executor.ts:341-363`, `transition-router.ts:242` | `isAttemptStale` must read from DB, not cache |
| **RC2: Stop doesn't drain** | API stop bypasses drain/terminalize, doesn't set `isStopping`, doesn't write control request | `index.ts:3806-3810` | Stop API must write control request + call drain |
| **RC3: Queue snapshot deleted** | `updateExecutionStatus` deletes queue before Continue can use it | `plan-runner.ts` | Delay snapshot deletion; support fallback |
| **RC4: `exec.status` not synced** | API updates DB but not in-memory exec.status | `index.ts`, `plan-runner.ts` | Add DB-based stop check to while loop |

---

## Fix Plan

### A. Fix `isAttemptStale` to read from DB (most critical fix)

**File:** `packages/coding-agent/src/core/autonomous-executor.ts`

Replace cache-based checks with DB reads:
- Use `stateStore.loadState(planExecutionId)` instead of `this.currentPlanState`
- Only allow Active->Complete transitions; Pending workspace = stale completion
- Check attempt number against DB state

### B. Fix stop API to write control request

**File:** `packages/web-server/src/index.ts`

After `stateStore.stopPlan()`, also call `stateStore.writeControlRequest()` so `checkControlRequest()` detects it. This ensures `drainAndTerminalizeActiveWorkspaces` is called, which sets `isStopping = true` and terminalizes workspaces properly.

### C. Fix plan-runner to check DB plan status for stop

**File:** `packages/web-server/src/plan-runner.ts`

After `loadState()` at the top of each while iteration, add a check:
```typescript
if (planStateCheck && (planStateCheck.status === "stopped" || planStateCheck.status === "cancelled")) {
    // stop/cancel handling
}
```

### D. Add diagnostic logging

Add structured logs for key events.

### E. Tests

Add `continue-failed-plan.test.ts` and `stale-attempt-completion.test.ts`.
