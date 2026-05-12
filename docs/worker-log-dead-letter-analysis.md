# Worker Log Dead-Letter Analysis

## Problem Statement

When running a plan through the web dashboard, the WebSocket log stream sends `{"type":"ready"}` but **never sends any `{"type":"log"}` messages**. No worker logs are visible in the dashboard UI, despite workers presumably executing in the background.

This document traces the full log pipeline from worker execution to WebSocket delivery, identifies all failure points, and ranks them by likelihood.

---

## 1. Log Pipeline Architecture

```
Worker (WorkspaceAgentExecutor)
  │  log() → console.log() + stateStore.appendWorkspaceLog()
  ▼
State Store (JsonStateStore / DatabaseStateStore)
  │  In-memory buffer (Map<string, string[]>) per-instance
  │  File (JSON) / workspace_logs table (PostgreSQL) persistence
  ▼
WebSocket Endpoint (fastify)
  │  On connect: send buffer logs + "ready"
  │  Polling: send buffer delta every 1s
  ▼
Frontend (useWorkspaceLogStream)
  │  onmessage: JSON parse → render log lines
```

---

## 2. Root Cause #1 (PRIMARY): State Store Instance Isolation

**Likelihood: CRITICAL — almost certainly the primary bug.**

### The Problem

Two *different* `IStateStore` instances exist simultaneously in the same Node.js process:

| Instance | Created in | Used by |
|----------|-----------|---------|
| `stateStore` (local) | `plan-runner.ts:195` — `runPlan()` | `AutonomousExecutor` → `WorkspaceAgentExecutor.execute()` |
| `globalStateStore` (singleton) | `index.ts:77-105` — `getStateStore()` | All REST endpoints + WebSocket handlers |

Both store instances are created by calling `createStateStore()` independently. Neither references the other. They have **separate in-memory log buffers** (`logBuffers: Map<string, string[]>` is an instance field in both `JsonStateStore` and `DatabaseStateStore`).

### Consequence

1. **`WorkspaceAgentExecutor.log()`** calls `stateStore.appendWorkspaceLog()` on the *executor's* instance → log line goes into that instance's buffer + persistence layer (file/DB).

2. **WebSocket initial connection**: calls `getStateStore().getRecentWorkspaceLogs()` on the *web-server's* instance → returns empty array (different buffer). Falls back to `loadWorkspaceLog()` which reads from file/DB → may find **old** persisted logs (but not newly generated ones if execution hasn't written many yet).

3. **WebSocket polling (1s interval)**: calls `getStateStore().getRecentWorkspaceLogs()` again → always returns empty array because the web-server's buffer never receives entries. **No fallback to file/DB in polling.** So `lastSentCount` stays at 0, no new logs are ever sent.

4. **Result**: Client receives `{"type":"ready"}` (from the initial connection handler) but never a single `{"type":"log"}` message.

### Why This Escaped Detection

- For the JSON backend, the initial connection *does* load persisted logs from file (if any exist from a previous run). So a developer might see old logs on reconnect and assume streaming works.
- The polling code path is completely separate from the initial-load code path and has no file/DB fallback.
- Both instances point at the same filesystem/DB, so no error surfaces — data just silently goes to the wrong buffer.

### Fix

Either:
- **Make `plan-runner.ts` use the global state store singleton** (`getStateStore()` imported from `index.ts`), or
- **Make `getStateStore()` exportable** and import it in `plan-runner.ts`, or
- **Pass the existing state store into `runPlan()`** from the API handler, so the executor shares the web-server's instance, or
- **Add a file/DB fallback to the polling path** so it reads newly persisted log lines even when the buffer is empty.

---

## 3. Root Cause #2: WebSocket Polling Has No Persistence Fallback

**Likelihood: HIGH — exacerbates #1, and is a vulnerability in any case.**

The initial connection handler has this fallback chain:

```typescript
// Initial connection — has fallback
let recentLogs: string[] = [];
if ("getRecentWorkspaceLogs" in stateStore) {
    recentLogs = fn.call(stateStore, planExecId, workspaceId, 100);
}
if (recentLogs.length === 0 && "loadWorkspaceLog" in stateStore) {
    const logContent = await fn.call(stateStore, planExecId, workspaceId);
    if (logContent) {
        recentLogs = logContent.split("\n").filter(Boolean).slice(-100);
    }
}
```

But the polling logic has **no** fallback:

```typescript
// Polling — only checks buffer, no file/DB fallback
const pollInterval = setInterval(async () => {
    const stateStore = getStateStore();
    if ("getRecentWorkspaceLogs" in stateStore) {
        const recentLogs = fn.call(stateStore, planExecId, workspaceId, 1000);
        if (recentLogs.length > lastSentCount) {
            // send delta
        }
    }
}, 1000);
```

If buffer returns empty, no log lines are sent even if new lines exist in the persisted storage.

---

## 4. Root Cause #3: `planExecutionId` Initialization Order in `AutonomousExecutor`

**Likelihood: MEDIUM — works correctly in the happy path but is fragile.**

In `AutonomousExecutor` constructor:

```typescript
constructor(stateStore, config) {
    if (this.enableRealExecution) {
        this.agentExecutor = new WorkspaceAgentExecutor({
            planExecutionId: this.planExecutionId ?? undefined,  // null at this point!
        });
    }
}
```

At construction time, `this.planExecutionId` is `null` because `initialize()` hasn't been called yet. The `WorkspaceAgentExecutor` gets `planExecutionId: undefined`.

Then `initialize()` recreates the executor:

```typescript
async initialize(queue) {
    this.planExecutionId = planExecutionId;
    this.updateAgentExecutorContext();  // recreates agentExecutor with correct id
}
```

`updateAgentExecutorContext()`:

```typescript
private updateAgentExecutorContext(): void {
    if (this.agentExecutor && this.planExecutionId) {
        this.agentExecutor = new WorkspaceAgentExecutor({
            model: (this.agentExecutor as any).model,       // accesses private field!
            maxTurns: (this.agentExecutor as any).maxTurns, // accesses private field!
            planExecutionId: this.planExecutionId,           // now correct
        });
    }
}
```

### Risks

1. **If `initialize()` is never called** (e.g., error before initialization), the executor silently has `planExecutionId: undefined` and `appendWorkspaceLog()` is skipped entirely.
2. **`as any` cast** accesses private fields (`model`, `maxTurns`). If these fields are renamed, it silently fails (returns `undefined`), and the new executor gets `undefined` model → crashes at `buildPromptFromPacket` with a confusing error.
3. **Memory churn**: Two `WorkspaceAgentExecutor` instances are created per execution.

---

## 5. Root Cause #4: `appendWorkspaceLog` Guard Silently Skips Logging

**Likelihood: LOW-medium — would only trigger if #3 goes wrong.**

In `WorkspaceAgentExecutor.execute()`:

```typescript
const log = async (message: string) => {
    logs.push(logLine);
    console.log(`[workspace-agent-executor] ${logLine}`);
    if (this.stateStore && this.planExecutionId) {          // ← guard
        await this.stateStore.appendWorkspaceLog?.(
            this.planExecutionId, workspaceId, logLine
        );
    }
};
```

If `this.planExecutionId` is `undefined` (due to #3 or #4), the guard silently skips `appendWorkspaceLog`. The line is still in the local `logs[]` array and printed to `console.log`, but it never reaches the state store buffer or persistence.

---

## 6. Root Cause #5: PostgreSQL `writeControlRequest` Uses Non-Existent Column

**Likelihood: MEDIUM — only affects PostgreSQL backend, not related to logs directly but can silently corrupt state.**

```typescript
// DatabaseStateStore.writeControlRequest()
await this.planExecutionRepo.update(planExecutionId, {
    metadata: { control: controlData } as unknown as Record<string, unknown>,
} as any);
```

The `plan_executions` table has **no `metadata` column** — only `id, project_id, phase, title, status, started_at, completed_at, execution_log, created_at, updated_at`. The `as any` cast bypasses TypeScript checking, and Kysely will attempt an SQL `UPDATE` on a non-existent column, which will throw a PostgreSQL error.

**This would cause control requests (pause/stop/resume) to fail silently** on the PostgreSQL backend.

---

## 7. Root Cause #6: WebSocket Log Polling vs File Watching Inconsistency

**Likelihood: LOW — architectural observation only.**

The legacy SSE endpoint (`GET /api/events`) uses `fs.watch()` to detect file changes in real time. But the new WebSocket endpoint uses **polling (1s interval)** on the in-memory buffer.

There is no mechanism (e.g., `fs.watch` in JSON backend, `LISTEN/NOTIFY` in PostgreSQL backend) to proactively notify the WebSocket handler when new log lines arrive. This means:

- Worst-case latency: 1 second
- If the buffer is the wrong instance (see #1), logs are **never** delivered regardless of polling frequency.

---

## 8. Root Cause #7: No Logs If Execution Is Simulated

**Likelihood: LOW — user confirmed `enableRealExecution: true`.**

In `AutonomousExecutor.executeWorkspace()`:

```typescript
if (this.enableRealExecution && this.agentExecutor) {
    const agentResult = await this.agentExecutor.execute(packet, workspace.id);
} else {
    // Simulate — no logs generated
}
```

If `enableRealExecution` is `false` (the default in `createAutonomousExecutor`), the agent executor is never created, `appendWorkspaceLog` is never called, and no logs are ever produced. The plan-runner correctly sets `enableRealExecution: true`, but if someone uses the legacy `createAutonomousExecutor` factory, logs would be absent.

---

## 9. Impact Summary

| # | Issue | Impact | Affects JSON | Affects PG |
|---|-------|--------|:---:|:---:|
| 1 | State store instance isolation — separate buffers | **No logs delivered via WebSocket** | YES | YES |
| 2 | WebSocket polling has no persistence fallback | **Polling never finds new logs** | YES | YES |
| 3 | `planExecutionId` init order — fragile | Silent log skip if path diverges | YES | YES |
| 4 | `appendWorkspaceLog` guard on null id | Silent log skip | YES | YES |
| 5 | Control uses non-existent `metadata` column | Control requests fail silently | — | YES |
| 6 | No push-based log notification | 1s latency, no recovery for wrong buffer | YES | YES |
| 7 | Simulated execution produces no logs | No logs at all | YES | YES |

---

## 10. Recommended Fix Order

### Fix 1 (CRITICAL) — Share the state store instance

Pass the global state store from the API handler into `runPlan()`, or export `getStateStore()` and use it from `plan-runner.ts`, or refactor `runPlan()` to accept an existing `IStateStore` instance.

**Quickest fix**: In `index.ts`, pass `getStateStore()` into `runPlan()` options.

### Fix 2 (CRITICAL) — Add persistence fallback to WebSocket polling

In the polling interval, if the buffer returns no new logs, fall back to `loadWorkspaceLog()` to read newly persisted log lines from file/DB.

### Fix 3 (MEDIUM) — Stabilize `updateAgentExecutorContext`

Instead of re-creating the `WorkspaceAgentExecutor` with private field access via `as any`, add a public setter method like `setPlanExecutionId(id: string)` on `WorkspaceAgentExecutor` that updates the `planExecutionId` reference. Or construct the executor lazily just before first use in `executeWorkspace()`.

### Fix 4 (LOW for JSON, MEDIUM for PG) — Fix control request persistence

Add a `metadata` column to `plan_executions`, or store control requests in a separate table (as done for JSON backend with `plan-control.json`).

---

## 11. Appendix: Log Path Trace

```
POST /api/projects/:projectId/plans/run          — index.ts:915
  └─ runPlan({planContent, projectId, ...})      — plan-runner.ts:195
       └─ createStateStore({backend, workspaceRoot})  — creates INSTANCE A
       └─ new AutonomousExecutor(INSTANCE A, ...)
            └─ constructor: new WorkspaceAgentExecutor({planExecutionId: null})
            └─ initialize(queue)
                 └─ updateAgentExecutorContext()
                      └─ new WorkspaceAgentExecutor({planExecutionId: "xxx"})
       └─ executePlanInBackground(executor, queue, "xxx")
            └─ executor.executeWorkspace(workspace)
                 └─ agentExecutor.execute(packet, workspaceId)
                      └─ log("Starting execution...")
                           └─ INSTANCE A.appendWorkspaceLog("xxx", "ws-1", ...)
                                └─ INSTANCE A.logBuffers ← line appended
                                └─ file/DB ← line appended

WebSocket connect: ws://.../api/ws/logs/xxx/ws-1  — index.ts:770
  └─ getStateStore() → INSTANCE B (singleton)
  └─ INSTANCE B.getRecentWorkspaceLogs("xxx", "ws-1")
       └─ INSTANCE B.logBuffers → [] (empty, different instance)
  └─ INSTANCE B.loadWorkspaceLog("xxx", "ws-1")
       └─ reads from file/DB → may find persisted logs
       └─ sends found logs + {"type":"ready"}

WebSocket polling (every 1s):
  └─ getStateStore() → INSTANCE B
  └─ INSTANCE B.getRecentWorkspaceLogs("xxx", "ws-1")
       └─ INSTANCE B.logBuffers → [] (always empty, never receives entries)
  └─ no fallback to file/DB
  └─ no new log messages sent
```

---

## 12. Verification Checklist

After applying fixes, verify each of these:

- [ ] WebSocket sends `{"type":"log","data":"..."}` messages after `{"type":"ready"}`
- [ ] Initial connection shows recent persisted logs
- [ ] New log lines appear within 1 second of being generated
- [ ] JSON backend: log file `.pi/workspace-{planExecId}-{workspaceId}.log` contains all lines
- [ ] PostgreSQL backend: `workspace_logs` table contains all log rows
- [ ] Disconnect/reconnect shows both old and new logs
- [ ] Multiple workspaces stream logs independently
- [ ] Control requests (pause/stop) work on PostgreSQL backend
