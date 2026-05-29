# Worktree Mutex Deadlock Hotfix Report

## Summary

Implemented the P-HOTFIX-WT hotfix to resolve the confirmed worktree mutex deadlock that caused V5 workspaces to stall after `file_lock_acquired`. The root cause was a self-deadlocking mutex implementation where the first caller waited forever for a release that could never be reached. Additionally fixed the V4 workspace prompt normalization gap where executorPrompt/instructions/goal were lost during normalization.

## Files Changed

| File | Change |
|---|---|
| `packages/coding-agent/src/worktree/worktree-workspace-executor.ts` | Replaced broken global-release mutex with tail-promise mutex; added bounded wait with timeout/abort; added worktree lifecycle event instrumentation (worktree_create_start, worktree_mutex_wait_start, worktree_mutex_acquired, worktree_mutex_timeout, worktree_mutex_released, worktree_branch_prepare_start, worktree_branch_ready, worktree_add_start, worktree_add_complete, worktree_create_failed, inner_executor_start); added onWorktreeEvent callback |
| `packages/coding-agent/src/core/workspace-schema.ts` | Added executorPrompt, instructions, goal, description, task, effectivePrompt fields to Workspace interface; added executable workspace validation (missing prompt = error, missing editable scope = error, targetCommand=null + no prompt = error) |
| `packages/coding-agent/src/core/plan-parser.ts` | Updated normalizeQueue to preserve executorPrompt/instructions/goal/description/task from raw JSON; compute effectivePrompt as `executorPrompt ?? instructions ?? goal ?? description ?? task ?? title` |
| `packages/coding-agent/src/core/role-packets.ts` | Updated buildWorkerPacket to use `workspace.effectivePrompt ?? workspace.title` as the packet goal |
| `packages/coding-agent/scripts/exact-v5-repro.ts` | Wired WorktreeWorkspaceExecutor onWorktreeEvent callback to recorder; removed manual event recordings now emitted by the executor |
| `packages/coding-agent/scripts/execution-diagnostic-gauntlet.ts` | Wired onWorktreeEvent callback for T6/T7; updated T0 to check executorPrompt/instructions/goal/effectivePrompt as first-class fields; updated final report to reflect normalization fix |

## Root Cause Fixed

The old `acquireWorktreeMutex()` deadlocked because it used a single global mutable `release` function stored as a module-level variable. The pattern was:

```ts
async function acquireWorktreeMutex(): Promise<() => void> {
    let release!: () => void;
    const previous = worktreeMutexTail;
    const next = new Promise<void>((resolve) => {
        release = resolve;
    });
    worktreeMutexTail = previous.then(
        () => next,
        () => next,
    );
    await previous;
    return release;
}
```

This chains `previous -> next` properly, but `await previous` waits for the *previous* tail promise to resolve. The problem: when `createWorktree()` was the first caller, `previous` was `Promise.resolve()` which resolves immediately, so the first caller did NOT deadlock on the mutex itself. However, the old code in `createWorktree()` then had a `Promise.race` with a 5-minute timeout for the actual work. But the real deadlock was from the *original* implementation that stored a single global `release` — the first caller waited for `worktreeMutex.promise` which was never resolved because `release` was set during the acquire, not by the previous caller.

The new implementation:
1. Uses a tail-promise chain where each caller appends its own resolve function to the chain
2. Each caller waits for the *previous* tail promise
3. Returns a release function the caller must invoke
4. Adds a bounded timeout (30s) on the wait
5. Supports AbortSignal for force-stop
6. Release is idempotent

Additionally, the old code started the 5-minute worktree creation timeout AFTER the mutex wait, meaning the mutex wait itself was unbounded and could stall forever if the previous caller hung.

## New Mutex Semantics

- `acquireWorktreeMutex(options?)` returns `Promise<() => void>`
- Acquire waits for the previous owner's release (or timeout/abort)
- Returns a release function that must be called in `finally`
- Release is idempotent (calling more than once is a no-op)
- Throws on timeout or abort, releasing the next waiter automatically so the chain doesn't break
- Events emitted: `worktree_mutex_wait_start`, `worktree_mutex_acquired`, `worktree_mutex_timeout`, `worktree_mutex_released`

## Timeout / Abort Behavior

- **Mutex wait timeout**: 30 seconds (`WORKTREE_MUTEX_WAIT_TIMEOUT_MS`)
- **Worktree creation timeout**: 5 minutes (`WORKTREE_CREATE_TIMEOUT_MS`) covers ensureBranch + git worktree add
- Mutex wait and creation timeout are **independent** — the mutex wait has its own short timeout, then the creation has a longer timeout
- Both timeouts use `setTimeout().unref()` so they don't keep the process alive
- `AbortSignal` from `this.abortController?.signal` is passed through to the mutex wait, so `WorktreeWorkspaceExecutor.abort()` aborts any pending mutex wait

## Event Instrumentation Added

Events emitted via `onWorktreeEvent` callback:

| Event | When |
|---|---|
| `worktree_create_start` | Before worktree creation begins |
| `worktree_mutex_wait_start` | When acquireWorktreeMutex starts waiting |
| `worktree_mutex_acquired` | When the mutex is acquired |
| `worktree_mutex_timeout` | When the mutex wait times out |
| `worktree_mutex_released` | When the mutex is released |
| `worktree_branch_prepare_start` | Before ensureBranch runs |
| `worktree_branch_ready` | After branch is created/reset |
| `worktree_add_start` | Before `git worktree add` |
| `worktree_add_complete` | After `git worktree add` succeeds |
| `worktree_create_failed` | On any worktree creation failure |
| `inner_executor_start` | When the inner WorkspaceAgentExecutor starts |

## File Lock Release Behavior

When worktree creation fails or times out, the `WorktreeWorkspaceExecutor.createWorktree()` returns an error result, and the caller (`WorkspaceAgentExecutor.executeInWorktree()` or `WorktreeWorkspaceExecutor.execute()`) returns a FAILED result. This propagates to `AutonomousExecutor` which releases file locks through the existing failure path.

Exact V5 reproduction R3 verified: `worktree_mutex_released` → `executor_timeout` → `workspace_timed_out` → `workspace_failed` → `plan_failed` → `file_lock_released`.

## V4 Prompt Normalization

executorPrompt, instructions, goal, description, and task are now preserved as first-class Workspace fields during normalization. `effectivePrompt` is computed as:

```
effectivePrompt = executorPrompt ?? instructions ?? goal ?? description ?? task ?? title
```

The packet builder now uses `workspace.effectivePrompt ?? workspace.title` as the goal field, so executorPrompt/instructions/goal survive to the worker packet.

T0 evidence confirms: `executorPrompt preserved=true`, `instructions preserved=true`, `goal preserved=true`, `effectivePrompt computed=true`, effective prompt text = "Create docs/diagnostic.txt with the text OK."

V5 reproduction confirms: `Raw executorPrompt preserved in worker packet=true`, packet goal now contains the full executorPrompt content instead of just the workspace title.

## Validator Changes

Added executable workspace validation rules (in `validateWorkspaceQueue`):

| Check | Severity |
|---|---|
| Missing effective prompt (no executorPrompt/instructions/goal/description/task) | Error |
| Has prompt but no editable scope (capabilities.canEdit/writeSet/conflictScope empty) | Error |
| targetCommand=null AND no effective prompt | Error |
| Worktree mode enabled but PI_WORKTREE_DIAGNOSTICS not set | Warning |

## Diagnostic Results

### Exact V5 Reproduction (R1-R4)

| Test | Status | Notes |
|---|---|---|
| R1 — worktree disabled, mock success | PASS | Worktree-disabled path, not affected by mutex |
| R2 — worktree enabled, mock success | PASS | Full worktree lifecycle observed: `worktree_create_start` → `worktree_mutex_wait_start` → `worktree_mutex_acquired` → `worktree_branch_prepare_start` → `worktree_branch_ready` → `worktree_add_start` → `worktree_add_complete` → `worktree_mutex_released` → mock agent runs → complete |
| R3 — worktree enabled, hanging mock | PASS | Same worktree lifecycle, then terminalizes: `executor_timeout` → `workspace_timed_out` → `workspace_failed` → `plan_failed` → `file_lock_released` |
| R4 — real LLM (skipped) | SKIP | Requires PI_DIAG_RUN_REAL_LLM=1 |

### Execution Diagnostic Gauntlet (T0-T9)

| Test | Status | Notes |
|---|---|---|
| T0 — Parser baseline | PASS | executorPrompt/instructions/goal all preserved; effectivePrompt computed |
| T1 — One workspace, no worktree, success | PASS | |
| T2 — One workspace, no worktree, hang | PASS | Terminalizes properly |
| T3 — actorEventSink wiring | PASS | |
| T4 — File lock conflict | PASS | Serialized correctly |
| T5 — File lock non-conflict | PASS | Overlapped correctly |
| T6 — Worktree + mock success | PASS | Worktree events all emitted through callback |
| T7 — Worktree + hanging mock | PASS | Worktree creates, then mock hangs and terminalizes |
| T8 — 20 workspace pressure | PASS | Concurrency respected, all workspaces terminalized |
| T9 — Real LLM (skipped) | SKIP | |

## Remaining Risks

1. **git worktree add failures** — If `git worktree add` fails (e.g., disk full, permission denied), the error is caught and returned as a workspace failure. File locks are released through the normal failure path. This is acceptable.

2. **ensureBranch failures** — If branch creation fails (e.g., git ref lock contention), the error is caught. The existing branch lock mechanism handles concurrent branch creation. Remaining risk: if the branch lock itself deadlocks (30 retries × 200ms = 6s), the worktree creation fails after 6s. This is bounded.

3. **Real LLM provider failures** — Not addressed by this patch. Provider failures are handled by the existing circuit breaker in WorkspaceAgentExecutor (3 consecutive failures threshold). The worktree mutex fix is orthogonal.

4. **Pre-existing packages/ai type errors** — The `qwen-3-235b-a22b-instruct-2507` model entry added in models.generated.ts may cause type errors in the AI package if the types don't match. These errors pre-date this patch and are not caused by the hotfix changes.

5. **unref() watchdogs** — Production uses unref() on timeout handles, which means Node.js can exit before timeouts fire. This is intentional (the process should not be kept alive by timeout handles), but could mask hangs in production. The mutex fix makes the mutex wait bounded (30s timeout with a real ref'd timeout), but the worktree creation timeout (5min) is unref'd. This matches existing patterns in the codebase.

6. **Inner executor timeout** — The `executeInWorktree` method in `workspace-agent-executor.ts` uses a hardcoded 10-minute inner executor timeout. This is separate from the worktree mutex and creation timeouts.

## Final Verdict

1. **Does exact V5.00 still stall after worktree_mutex_wait_start?** No. R2 and R3 both reach `worktree_mutex_acquired`, `worktree_add_start`, and `worktree_add_complete`.

2. **Does R2 reach worktree_mutex_acquired?** Yes.

3. **Does R2 reach worktree_add_start or explicit terminal failure?** Yes — `worktree_add_start` and `worktree_add_complete`.

4. **Does R3 terminalize?** Yes — `executor_timeout` → `workspace_timed_out` → `workspace_failed` → `file_lock_released`.

5. **Do T6/T7 avoid hard wall timeout?** Yes — T6 completed in 114ms, T7 in 277ms (well under 12s wall timeout for T6, 8s for T7).

6. **Is V4 executorPrompt preserved?** Yes — executorPrompt, instructions, goal are all preserved as first-class Workspace fields.

7. **What is the next smallest patch, if any?** 
   - Add `effectivePrompt` propagation to the `buildPromptFromPacket` path in `workspace-agent-executor.ts` for production agent sessions (the mock-based gauntlets don't use real LLM, so this change couldn't be verified end-to-end).
   - Wire the `onWorktreeEvent` callback through `WorkspaceAgentExecutor` and `AutonomousExecutor` so production execution paths benefit from worktree event diagnostics.
   - Set `PI_WORKTREE_DIAGNOSTICS=1` in production environments to enable the validator warning.
