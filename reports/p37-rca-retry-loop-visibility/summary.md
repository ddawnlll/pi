# P37.RCA — Retry Loop / No Visibility Root Cause Analysis

## Summary

Two workspaces (P37.03 and P37.04) are stuck in infinite retry loops with no
dashboard visibility into why they fail. The underlying issues are:

1. **Completion gate is never wired to command execution** — the bash tool and
   agent executor don't record commands, so `commandHistory` stays empty and
   `targetCommandPassed` is never set.

2. **Attempt cache skips `attempt_started` on retry** — the `createAndStartAttempt`
   method returns early when the attempt is already cached, never transitioning
   the attempt back to RUNNING. Completion fires `attempt_succeeded` on a
   non-RUNNING attempt, and the FSM rejects the transition.

3. **Dashboard shows no error detail** — the execution log only shows workspace
   verdict, not the underlying error message or what the agent actually did.

---

## 1. Completion Gate Wiring Gap (P37.03 — 12 retries)

### Data from DB

| Field | Value |
|-------|-------|
| Workspace | P37.03 |
| Stage | pending |
| Attempts | **12** |
| Error message | `Completion gate blocked: Target command has not been executed: npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts` |
| Attempt rows | **1** (counter shows 12 but only one attempt row exists) |

### Why the gate blocks

The completion gate checks `targetCommandPassed` — this is `null` because no
code ever sets it:

```text
autonomous-executor.ts:
  - markImplementationFinished() → sets implementationFinished flag
  - recordEquivalentCommand() → scans agent text report for command strings
  - BUT: no bash tool or agent executor calls recordCommand() or
    recordCompletion() on the completion gate

completion-gate.ts evaluateWorkspace():
  - targetCommandPassed === null → falls through to isEquivalentValidationSatisfied()
  - commandHistory is empty → no equivalent commands found
  - Returns blocked: "Target command has not been executed"
```

### Why the command runs but isn't recorded

The agent runs `npm test -- packages/coding-agent/test/execution/patch-coordinator.test.ts`
via the bash tool (or exec tool). The command exits 0 because:

- Monorepo root `npm test` runs `npm run test --workspaces --if-present`
- Each package's vitest receives the filter `packages/coding-agent/test/execution/...`
- `packages/coding-agent`'s vitest runs from cwd `packages/coding-agent/` with
  include pattern `test/**/*.test.ts`
- The filter path `packages/coding-agent/test/execution/...` doesn't match
  `test/execution/...` (relative to the package cwd)
- Result: "No test files found, exiting with code 0"

The bash tool does NOT call `completionGate.recordCommand()` or
`completionGate.recordCompletion()`, so the completion gate never knows the
command was executed.

### Fix

Wire the bash/exec tools to call `completionGate.recordCommand(command)` when a
command is run and `completionGate.recordCompletion(exitCode, isTargetCommand, command)`
when it completes. The workspace-agent-executor should pass the completion gate
to the tool handlers.

Alternatively, record all bash commands in a global command log that the
completion gate can query at evaluation time.

---

## 2. Attempt Cache FSM Bypass (P37.04 — 12 retries)

### Data from DB

| Field | Value |
|-------|-------|
| Workspace | P37.04 |
| Stage | pending |
| Attempts | **12** |
| Error message | `Illegal attempt transition: SUCCEEDED -> RUNNING` |

### Root cause

In `KernelTransitionRouter.createAndStartAttempt()` (transition-router.ts:257):

```typescript
if (this.attemptCache.has(workspaceId)) {
    this.log.info(`Attempt already exists, skipping creation`);
    return;  // ← Never fires attempt_started!
}
```

On retry, the cached attempt stays in `SUCCEEDED` state from the previous
completion. When `completeAttempt` fires `attempt_succeeded`, the FSM sees
`SUCCEEDED -> RUNNING` (from the controller's `handleEvent("attempt_started")`
on the next iteration) and rejects it.

### Fix Already Applied

Fixed in this session: the cache short-circuit now fires `attempt_started` before
returning, transitioning the attempt back to RUNNING:

```typescript
const cachedEntry = this.attemptCache.get(workspaceId);
if (cachedEntry) {
    await this.controller.handleEvent(cachedEntry.attemptId, "attempt_started", { ...data, workspaceId });
    cachedEntry.currentState = "RUNNING";
    cachedEntry.version++;
    return;
}
```

This fix is in the codebase but the server hasn't been restarted with it yet.

---

## 3. Dashboard Visibility Gap

### Current state

The dashboard shows:
- Attempts list with status per attempt
- Workspace logs (execution log)
- Statistics (pending/active/complete/failed counts)

The dashboard does NOT show:
- **Why** a workspace failed (the error message from the workspace execution)
- What commands the agent ran
- What the agent's last output was before failure
- The completion gate diagnostic (which criteria blocked)

### Data that exists but isn't shown

| Data | Stored in | Visible in dashboard? |
|------|-----------|----------------------|
| Error message | `workspace_executions.error_message` | **No** |
| Attempt state | `attempts.current_state` | **No** |
| Execution log | `plan_executions.execution_log` | Yes (but truncated) |
| Command history | `completionGate.workspaceStates` (in-memory) | **No** |
| Governed ledger | `completionGate.governanceLedger` (in-memory) | **No** |
| Agent report | Text log (workspace output) | Partially |

### Fix Suggestion

1. Add `error_message` to the workspace details API response
2. Show the error message in the workspace card/detail view in the dashboard
3. Log completion gate diagnostics to the execution log (already partially done
   but not surfaced)
4. Add a "retry count" column to the attempts table in the dashboard

---

## 4. Additional Issues Found

### Stale control request (new executor immediately stops)

Fixed: `adoptExistingExecution` now clears control requests from the database
state store in addition to the file-based control manager.

### Queue snapshot deleted on stop

Fixed: `updateExecutionStatus` only deletes snapshots on `complete`, not on
`stopped`/`failed`/`cancelled`.

### Plan file fallback picks wrong file

Fixed: `recoverSingleExecution` now tries `{planExecId}.md` before the generic
scan when the meta file is missing.

### Pre-check misses plan file fallback

Fixed: The rerun API handler now also checks for `{planExecId}.md` when the
queue snapshot and meta file are missing.

---

## Files That Need Changes (Completion Gate Wiring)

1. **`packages/coding-agent/src/core/tools/bash.ts`** (or equivalent):
   - After running the command, call `completionGate.recordCommand(planExecId, workspaceId, command)`
   - On completion, call `completionGate.recordCompletion(planExecId, workspaceId, exitCode, isTargetCommand, command)`

2. **`packages/coding-agent/src/core/workspace-agent-executor.ts`**:
   - Pass completion gate instance to tool handlers
   - Alternatively, use a middleware/hook that captures all command executions

3. **Dashboard** (optional but high value):
   - Show `error_message` in workspace detail view
   - Show completion gate block reasons in execution log
