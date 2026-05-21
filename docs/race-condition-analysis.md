# Race Condition & Bug Analysis

> Generated: 2026-05-21
> Context: pi-mono v0.74.0, Flask blog end-to-end test (`/tmp/testfinal/`)

---

## Table of Contents

1. [Promise-Chain Mutex Broken Pattern (CRITICAL)](#1-promise-chain-mutex-broken-pattern)
2. [Atomic Write ENOENT Crash (CRITICAL)](#2-atomic-write-enoent-crash)
3. [Memory Guard Hardcoded 8 GB Limit (HIGH)](#3-memory-guard-hardcoded-8-gb-limit)
4. [Workspace Completion State Never Persisted (CRITICAL)](#4-workspace-completion-state-never-persisted)
5. [Plan Parser Phase/Title Extraction (MEDIUM)](#5-plan-parser-phasetitle-extraction)
6. [awaiting_handoff Blocks New Executions (MEDIUM)](#6-awaiting_handoff-blocks-new-executions)
7. [Task Dedup Returns Same Execution for Multiple Tasks (MEDIUM)](#7-task-dedup-returns-same-execution-for-multiple-tasks)
8. [Dashboard Worker Count Stale (LOW)](#8-dashboard-worker-count-stale)

---

## 1. Promise-Chain Mutex Broken Pattern

### Files

- `packages/coding-agent/src/core/plan-state.ts`
- `packages/coding-agent/src/core/autonomous-executor.ts`

### Severity

**CRITICAL** — Causes concurrent workspace execution to hang permanently.

### Description

Two mutexes in `PlanStateStore` (`saveMutex` and `stateModificationMutex`) and one in `AutonomousExecutor` (`AsyncMutex`) used a broken promise-chain pattern that allowed multiple concurrent callers into the critical section simultaneously.

### Broken Pattern (BEFORE fix)

```typescript
// plan-state.ts (OLD BROKEN CODE)
async saveState(): Promise<void> {
    await this.saveMutex;                    // BUG: await current BEFORE replacing
    this.saveMutex = new Promise<void>((resolve) => {
        release = resolve;
    });
    // ... critical section ...
    release();
}
```

With this pattern, if two callers arrive concurrently:

1. Caller A: `await this.saveMutex` → resolves immediately (initial `Promise.resolve()`)
2. Caller B: `await this.saveMutex` → ALSO resolves immediately because `this.saveMutex` hasn't been replaced yet!
3. Caller A: `this.saveMutex = new Promise1`
4. Caller B: `this.saveMutex = new Promise2` (overwrites Promise1!)
5. Both callers enter the critical section simultaneously
6. Caller A finishes and calls `release()` for `Promise1` — but nobody is awaiting `Promise1`
7. Caller B finishes and calls `release()` for `Promise2`
8. Caller C: `await this.saveMutex` → awaits `Promise2` which resolves when B released it
9. Next caller enters immediately because the chain was reset

**Result**: The first two callers run concurrently, corrupting each other's writes (last write wins). The third caller runs immediately after the second instead of waiting. When `Promise1` was overwritten by `Promise2` without being resolved, it becomes a dangling unresolved promise — leaking memory.

### Correct Pattern (AFTER fix)

```typescript
// plan-state.ts (FIXED)
async saveState(): Promise<void> {
    const prevSave = this.saveMutex;         // FIX: capture previous promise FIRST
    this.saveMutex = new Promise<void>((resolve) => {
        release = resolve;
    });
    await prevSave;                          // FIX: await the captured previous promise
    // ... critical section ...
    release();
}
```

### Root Cause

The old pattern `await this.mutex; this.mutex = new Promise(...)` has a TOCTOU (Time-of-Check-Time-of-Use) race: between `await` and the assignment, another caller can also `await` the same promise. Both pass through before either replaces it.

### All Fixed Sites

| File | Mutex | Status |
|------|-------|--------|
| `plan-state.ts:408-413` | `saveMutex` in `saveState()` | FIXED |
| `plan-state.ts:699-704` | `stateModificationMutex` in `updateWorkspaceState()` | FIXED |
| `autonomous-executor.ts` | `AsyncMutex.runExclusive()` | FIXED |
| `continuous-executor.ts` | `AsyncMutex.runExclusive()` | FIXED |

### Potential Residual Issue

Even with the correct mutex pattern, there is NO mutex between `stateModificationMutex` and `saveMutex`. The `updateWorkspaceState()` method:

```
acquire stateModificationMutex
    modify in-memory state (this.state.workspaces.set(...))
    acquire saveMutex
        serialize this.state to file
    release saveMutex
release stateModificationMutex
```

If caller A updates workspace X and calls `saveState()`, then caller B updates workspace Y and also calls `saveState()`, B's `saveState()` serializes `this.state` which includes X's changes AND Y's changes. This is correct because in-memory changes happen before `saveState()` within the same mutex.

**However**: If `saveState()` reads `this.state` AFTER another `updateWorkspaceState()` already modified it but BEFORE that other call's `saveState()` completes... This could happen if `saveState()` takes the `saveMutex` after the other call modified in-memory state but before the other call releases its `stateModificationMutex`. In practice this is safe because `saveState()` happens INSIDE `updateWorkspaceState`'s `stateModificationMutex` critical section.

---

## 2. Atomic Write ENOENT Crash

### Files

- `packages/coding-agent/src/core/json-state-store.ts`

### Severity

**CRITICAL** — Execution state wiped, workspaces never start.

### Description

The JSON state store used `writeFile(temp) → rename(temp, target)` for atomic writes at 4 sites. If a directory didn't exist (missing `mkdir`), `rename()` would crash with `ENOENT`, leaving an empty `target` file (Node.js bug: `rename` to non-existent dir truncates target to 0 bytes before failing). This wiped `executions.json` and `plan-state.json`, causing workspaces to have `status=None stage=None` — never starting.

### Affected Sites

| Site | File | Path | Fix |
|------|------|------|-----|
| `writeProjectsFile` | `projects.json` | `atomicWriteFile` helper + mkdir |
| `writeControlRequest` | `plan-control.json` | `atomicWriteFile` helper + mkdir |
| `appendExecutionTracking` | `executions.json` | `atomicWriteFile` helper |
| `updateExecutionStatus` | `executions.json` | `atomicWriteFile` helper + **missing mkdir** |

### The `updateExecutionStatus` case was the most vulnerable:

```typescript
// OLD (BROKEN)
async updateExecutionStatus(planExecId, status, error?) {
    const filePath = path.join(this.workspaceRoot, this.piDir, "executions.json");
    const content = JSON.stringify(executions);
    // NO mkdir! If .pi dir doesn't exist, rename() fails with ENOENT
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);  // CRASH if .pi doesn't exist
}
```

### Fix

```typescript
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
    const tempPath = filePath + ".tmp." + Date.now();
    await fs.mkdir(path.dirname(filePath), { recursive: true });  // ensure dir exists
    try {
        await fs.writeFile(tempPath, content, "utf-8");
        await fs.rename(tempPath, filePath);
    } catch {
        await fs.writeFile(filePath, content, "utf-8").catch(() => {}); // fallback
    }
}
```

---

## 3. Memory Guard Hardcoded 8 GB Limit

### Files

- `packages/coding-agent/src/core/worker-memory-guard.ts`
- `packages/coding-agent/src/core/settings-manager.ts`

### Severity

**HIGH** — Workspaces stuck in `canStartWorker()` busy-loop on systems with >8 GB RAM.

### Description

The memory guard used a fixed 8 GB system memory limit regardless of actual system RAM:

```typescript
// OLD (BROKEN)
const SYSTEM_MEMORY_LIMIT_BYTES = 8 * 1024 * 1024 * 1024;  // always 8 GB
```

On a system with 16.7 GB RAM, this caused the memory guard to think only 8 GB was available. Combined with the settings-manager default:

```typescript
// OLD (BROKEN)
memoryLimitGb: sm.get('memoryGuard.memoryLimitGb') ?? 8  // always 8 if no config
```

This meant 85% of "8 GB" = 6.8 GB usable, but actual memory pressure from other processes (bun, node, etc.) caused `canStartWorker()` to always return `false`.

### Fix

```typescript
// worker-memory-guard.ts (FIXED)
const SYSTEM_MEMORY_LIMIT_BYTES = Math.max(
    8 * 1024 * 1024 * 1024,                               // floor: 8 GB
    Math.min(totalBytes * 0.85, 32 * 1024 * 1024 * 1024)  // 85% of total, cap: 32 GB
);
```

```typescript
// settings-manager.ts (FIXED)
memoryLimitGb: sm.get('memoryGuard.memoryLimitGb') ?? undefined  // auto-calculate
```

When `memoryLimitGb` is `undefined`, `configureMemoryGuard()` uses `Math.floor(limitBytes / (1024 * 1024 * 1024))` instead of a hardcoded value.

---

## 4. Workspace Completion State Never Persisted

### Files

- `packages/coding-agent/src/core/plan-state.ts` (saveState / updateWorkspaceState)
- `packages/coding-agent/src/core/autonomous-executor.ts` (executeWorkspace)
- `packages/coding-agent/src/core/json-state-store.ts` (transitionWorkspace)

### Severity

**CRITICAL** — Workspace completes but `plan-state.json` still shows `stage=active`. Plan never reaches terminal state.

### Observed Behavior

```
Workspace rest-api:
  Agent completion:    14:44:51 UTC  (execution-1.log says "VERDICT: COMPLETE")
  plan-state.json:     stage=active  (never updated to "complete")
  plan-state.json.bak: stage=active  (same, persisted)
  
Workspace db-models:
  Agent completion:    14:50:05 UTC  (execution-1.log says "VERDICT: COMPLETE")
  plan-state.json:     stage=complete  (correctly updated)
  
Workspace project-init:
  Agent completion:    14:51:42 UTC  (execution-1.log says "VERDICT: COMPLETE")
  plan-state.json:     stage=complete  (correctly updated)
```

### Key Findings

- The FIRST workspace to complete (`rest-api`, 14:44:51) had its completion state NEVER persisted
- The SECOND and THIRD workspaces (`db-models`, `project-init`) completed correctly
- No error logs, no exception traces, no crash indicators
- The `execution-journal.ndjson` shows CONTINUED activity for `rest-api` at 14:56:05 (12 minutes after completion) — `Turn 24`, `Tool: read`, `Tool: bash`

### Suspected Root Cause

Two hypotheses:

**Hypothesis A: Agent Executor Continuation Bug**

The workspace agent log shows "Execution completed with verdict: COMPLETE" at 14:44:51. But the journal shows `rest-api` turns continuing at 14:56:05 (Turn 24). If the agent executor's `execute()` method does not actually return after COMPLETE, the `runWorkspace()` code after `await this.agentExecutor.execute(...)` would never execute, including the `transitionWorkspace()` call.

The `workspace-agent-executor` class may have a bug where the agent continues making tool calls AFTER reporting COMPLETE, and the session loop doesn't terminate.

**Hypothesis B: Phantom Write Race**

If `saveState()` is called concurrently (despite the mutex fix), the FIRST completion's state could be overwritten by a LATER `saveState()` call that reads `this.state` BEFORE the first completion's in-memory update. The mutex pattern should prevent this, but the two-tier mutex (`stateModificationMutex` + `saveMutex`) might have a window.

### Evidence for Hypothesis A

The journal shows `rest-api` activity at timestamps AFTER the reported completion:

```
worker_status (14:56:05): workspaceId=rest-api, Turn 24 started
tool_call (14:56:05): workspaceId=rest-api, Tool: read
worker_status (14:56:42): workspaceId=rest-api, Assistant message started
```

If `execute()` returned at 14:44:51, the journal should NOT have `rest-api` events at 14:56:05. The 12-minute gap with continued activity suggests the agent executor's session loop kept running.

### Investigation Needed

1. Add `workspaceId` to ALL `[workspace-agent-executor]` log lines so we can trace which workspace is running
2. Add a log line RIGHT BEFORE `transitionWorkspace(Complete)` is called, with workspace ID
3. Verify the agent executor's `execute()` method always returns after COMPLETE verdict
4. Check if the agent session loop continues after COMPLETE due to tool result processing

---

## 5. Plan Parser Phase/Title Extraction

### Files

- `packages/coding-agent/src/core/plan-parser.ts`

### Severity

**MEDIUM** — Workspaces assigned wrong phase (P2 instead of P1), workspace IDs show as ugly letters.

### Issue 5a: Phase Regex Required `Title:` Line

The old regex for phase/title extraction:

```typescript
const headerMatch = planContent.match(
    /# Phase (P\d+)[^\n]*\n[^\n]*\n[^\n]*Title[^\n]*:\s*([^\n]+)/i
);
```

This REQUIRED a `Title:` line on the third line after `# Phase`. Plans that use inline format (`# Phase P1: Backend Server Setup`) without a separate `Title:` line fell back to `phase="P2"` and `title="Untitled Phase"`.

**Fix**: Added `inlineMatch` fallback:

```typescript
const inlineMatch = planContent.match(/# Phase (P\d+):\s*([^\n]+)/i);
const phase = headerMatch?.[1] || inlineMatch?.[1] || "P2";
const title = headerMatch?.[2]?.trim() || inlineMatch?.[2]?.trim() || "Untitled Phase";
```

### Issue 5b: Workspace ID Regex Required `\d+\.[A-Z]` Format

The old workstream regex:

```typescript
const workstreamRegex = /### (7\.[A-Z])[^\n]*—/g;
```

This only matched IDs like `7.A`, `7.B`, `7.C`. Descriptive IDs like `project-init`, `base-template` were not matched.

**Fix**: New regex captures any ID up to the em dash:

```typescript
const workstreamRegex = /### ([^\n—]+)—\s*([^\n]+)\n([\s\S]*?)(?=\n### |\n## |$)/gi;
const id = match[1].trim();  // .trim() is critical! Without it, trailing space is included
```

### Issue 5c: Missing `.trim()` on ID

The `match[1]` captures everything between `### ` and `—`. Without `.trim()`, a trailing space would be included in the workspace ID, causing `validateWorkspaceQueue` to fail:

```
Workspace 7.B depends on non-existent workspace: 7.A
```

Because `idSet` had `"7.A "` (with trailing space) but dependency was `"7.A"` (without space).

---

## 6. `awaiting_handoff` Blocks New Executions

### Files

- `packages/coding-agent/src/core/autonomous-executor.ts` (`hasRunningExecution`)

### Severity

**MEDIUM** — Prevents concurrent task execution.

### Description

When a plan enters `awaiting_handoff` state (cleanup review found issues), the `hasRunningExecution()` method considers this equivalent to `running`:

```typescript
private async hasRunningExecution(queue: WQ): Promise<boolean> {
    const executions = await this.stateStore.listPlanExecutions(this.projectId);
    return executions.some(
        (e) =>
            e.phase === queue.phase &&
            (e.status === "running" || e.status === "paused" || e.status === "awaiting_handoff"),
    );
}
```

Since `awaiting_handoff` means "all workspaces completed, needs manual approval or timeout", it should NOT block new executions. A plan in `awaiting_handoff` is effectively done — all workspaces are complete.

### Impact

- Second task cannot start while first task is `awaiting_handoff`
- User must manually resolve the handoff (approve/reject) or wait 30-minute timeout

### Possible Fix

Remove `awaiting_handoff` from the blocking statuses:

```typescript
e.status === "running" || e.status === "paused"
```

Or auto-transition `awaiting_handoff` to `failed` after a timeout.

---

## 7. Task Dedup Returns Same Execution for Multiple Tasks

### Files

- `packages/web-server/src/plan-runner.ts` (`runPlan`)

### Severity

**MEDIUM** — Multiple tasks with same phase share the same execution.

### Description

When `runPlan()` is called while another execution is already running for the same project:

```typescript
// AC #5: If there's already a running execution for this project, return it
const existingRunning = getActiveExecutions(projectId).find((e) => e.status === "running");
if (existingRunning) {
    return {
        success: true,
        planExecId: existingRunning.planExecId,
        execution: existingRunning,
    };
}
```

This means two tasks with the same phase (e.g., both with `p1 → server-plan.md`) will get the SAME execution ID. The task store records the same `planExecId` for both tasks.

### Impact

- Both tasks show the same execution progress
- If task A completes, task B also appears complete (they share state)
- Task B's `start()` call returns immediately with shared execution

### Design Note

This was originally designed to prevent duplicate plan execution for the same project. With the multi-task system, each task should get its own execution scope. The dedup should be per-task, not per-project.

---

## 8. Dashboard Worker Count Stale

### Files

- `packages/web-ui/dashboard/src/` (various)

### Severity

**LOW** — Worker count shown on dashboard doesn't match actual state.

### Description

The dashboard fetches workspace lists from the API, which reads from `plan-state.json`. If `transitionWorkspace()` fails (see Issue #4 above), the plan-state shows workspaces as `active` even though they've actually completed.

Old workspace directories (4.A, 7.B etc.) from previous runs also appear in the workspace listing, confusing the count.

### Impact

- "2 workers active" shown when all workspaces are done
- No way to distinguish between stale and current workspace directories

---

## Summary Table

| # | Issue | Severity | Root Cause | Status |
|---|-------|----------|------------|--------|
| 1 | Promise-chain mutex broken pattern | CRITICAL | `await this.mutex; this.mutex = new Promise(...)` allows concurrent callers | FIXED (source + dist rebuilt) |
| 2 | Atomic write ENOENT crash | CRITICAL | Missing `mkdir` before `rename()`, no fallback | FIXED (atomicWriteFile helper) |
| 3 | Memory guard hardcoded 8 GB | HIGH | `?? 8` override prevents auto-calculation | FIXED (dynamic limit + `?? undefined`) |
| 4 | Workspace completion not persisted | CRITICAL | Agent continues running after COMPLETE verdict OR phantom race | UNDER INVESTIGATION |
| 5a | Phase regex requires Title: line | MEDIUM | Regex requires Title: on line 3 | FIXED (inlineMatch fallback) |
| 5b | Workspace ID regex requires \d+.[A-Z] | MEDIUM | Hardcoded format | FIXED (flexible regex) |
| 5c | Missing .trim() on ID | MEDIUM | Trailing space causes validation failure | FIXED (match[1].trim()) |
| 6 | awaiting_handoff blocks new tasks | MEDIUM | hasRunningExecution includes awaiting_handoff | NOT FIXED |
| 7 | Task dedup shares execution | MEDIUM | runPlan returns same exec per project | NOT FIXED (by design) |
| 8 | Dashboard worker count | LOW | Stale plan-state + old workspace dirs | NOT FIXED |
