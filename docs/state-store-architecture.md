# State Store Architecture Analysis

## Overview

Pi has two state store backends implementing the `IStateStore` interface
(`packages/coding-agent/src/core/state-store.ts`):

- **JSON** (`JsonStateStore`) — file-based, legacy, uses `.pi/` directory
- **PostgreSQL** (`DatabaseStateStore`) — relational, uses `packages/db`

Both backends share the same interface but differ fundamentally in
concurrency, isolation, and query capabilities.

---

## 1. IStateStore Interface

**File:** `packages/coding-agent/src/core/state-store.ts` (650+ lines)

The interface defines all operations a backend must support:

### Data Model (conceptual)

```
Project (id, name, rootPath)
  └── PlanExecution (id, projectId, phase, title, status, startedAt, completedAt)
        ├── WorkspaceExecution (id, planExecId, workspaceId, title, stage, attempts, ...)
        │     └── WorkspaceLog (id, wsExecId, stream, lineNumber, content, timestamp)
        └── JournalEvent (id, planExecId, wsExecId, eventType, data, timestamp)
```

### Key Operations

| Category | Methods |
|----------|---------|
| Project | `listProjects()`, `findOrCreateProject()`, `updateProject()` |
| Plan Exec | `initializeState()`, `loadState()`, `saveState()`, `listPlanExecutions()` |
| Workspace | `updateWorkspaceState()`, `transitionWorkspace()`, `incrementRetryAttempt()` |
| Locks | `acquireFileLocks()`, `releaseFileLocks()` |
| Lifecycle | `completePlan()`, `failPlan()`, `pausePlan()`, `stopPlan()`, `cancelPlan()`, `resumePlan()` |
| Handoff | `setAwaitingHandoff()`, `handoffCommit()`, `handoffKeepEditing()`, `handoffDiscard()` |
| Journal | `appendJournal()`, `appendJournalEvent()`, `readJournal()` |
| Logs | `saveExecutionLog()`, `loadExecutionLog()`, `appendWorkspaceLog()`, `loadWorkspaceLog()` |
| Stats | `getStatistics()`, `getWorkspaceAttempts()` |
| Transcript | `appendWorkerTranscriptEvent()`, `readWorkerTranscriptEvents()`, `emitWorkerStatus()` |

---

## 2. JSON Backend (`JsonStateStore`)

**File:** `packages/coding-agent/src/core/json-state-store.ts` (~600 lines)

### Architecture

Wraps `PlanStateStore` (`plan-state.ts`) — the original in-memory+filesystem
engine. Maintains flat JSON files in `.pi/` directory:

```
.pi/
  plan-state.json           ← Current execution state (SINGLE, global)
  plan-state-{execId}.json  ← Per-execution snapshots (best-effort mirror)
  executions.json           ← Flat list of all executions (ALL projects)
  projects.json             ← Project registry
  plan-control.json         ← Control request (pause/stop/cancel)
  current-execution.json    ← Current execution ID reference
  execution-journal.ndjson  ← Append-only journal log
  execution-{execId}.log    ← Execution log file
  workspace-{execId}-{wsId}.log  ← Per-workspace log file
```

### How It Works

1. **PlanStateStore** (`plan-state.ts`) is the core engine:
   - In-memory `PlanState` (phase, title, status, workspaces Map)
   - Mutations go through mutex-synchronized methods
   - `saveState()` serializes to `plan-state.json`
   - `PlanStateStore` manages its own journal NDJSON file, transcript files,
     workspace execution logs

2. **JsonStateStore** wraps PlanStateStore to implement IStateStore:
   - Most methods delegate directly to `this.store.*`
   - Adds project tracking via `projects.json`
   - Maintains execution tracking via `executions.json`
   - In-memory log buffer for WebSocket streaming
   - Simple mutex for `updateExecutionStatus()` writes

### Known Problems

**A. Single global `plan-state.json`**
- Only ONE execution state exists at a time
- If project A runs P11 then project B runs P13, `plan-state.json` now shows P13
  but P11's state is lost (unless per-exec snapshots are working)
- Per-exec snapshot (`plan-state-{execId}.json`) was a late addition and
  is best-effort only — written via `afterSave` callback which may not fire
  during crash recovery

**B. `executions.json` is a flat array**
- All projects' executions in one file
- No indexing, O(n) scan for listing
- Retention limited by array size in memory
- Atomic write race: read-modify-write pattern can lose entries
  under concurrent access (partially fixed with mutex + .bak)

**C. No concurrency control**
- Mutex pattern in `PlanStateStore` was broken for months (see
  `docs/race-condition-analysis.md`)
- Even with correct promise-chain mutex, file-level atomicity is weak:
  `writeFile(tmp) + rename(tmp, target)` can still fail (ENOENT on directory
  missing, disk full, etc.)
- Two concurrent HTTP requests to write different projects' state
  can race on the same `executions.json`

**D. Crash recovery is fragile**
- `resumeStrandedExecutions()` reads queue snapshots, re-creates executor,
  and calls `adoptExistingExecution()` which modifies state
- Recovery can fail if plan-state.json was corrupted during the crash
- No transaction boundaries — partial writes leave inconsistent state

**E. Query limitations**
- No filtering by project + status, phase, date range
- No pagination
- Stats are computed by reading all log files and counting chars/4
- `getStatistics()` re-reads ALL workspace log files on every call

**F. File system assumptions**
- Assumes `.pi/` directory exists and is writable
- Hardcoded to `workspaceRoot/.pi/` path
- No support for network filesystems or concurrent processes

---

## 3. PostgreSQL Backend (`DatabaseStateStore`)

**File:** `packages/coding-agent/src/core/database-state-store.ts` (~650 lines)

### Architecture

Translates between IStateStore operations and relational tables via
Kysely ORM and repository pattern:

```
Tables (from migration 001_initial):
  projects              (id, name, description, root_path, created_at, updated_at)
  plan_executions       (id, project_id, phase, title, status, started_at, 
                          completed_at, execution_log, created_at, updated_at)
  workspace_executions  (id, plan_execution_id, workspace_id, title, stage, 
                          attempts, error_message, started_at, completed_at, 
                          metadata, created_at, updated_at)
  journal_events        (id, plan_execution_id, workspace_execution_id, 
                          event_type, timestamp, data, created_at)
  workspace_logs        (id, workspace_execution_id, stream, line_number, 
                          content, timestamp, created_at)
```

Plus additional tables from migrations 004–008:
- `chat_messages`, `proposals`, `plan_revisions`, `memory_vectors`, `audit_events`

### Repository Layer (`packages/db/src/repositories/`)

Each table has a repository class:
- `ProjectRepository` — `findOrCreate()`, `listAll()`, `update()`
- `PlanExecutionRepository` — `create()`, `findById()`, `listByProject()`, `updateStatus()`, `update()`
- `WorkspaceExecutionRepository` — `create()`, `listByPlanExecution()`, `updateStage()`, `incrementAttempts()`, `update()`
- `JournalEventRepository` — `create()`, `query()` (with filtering)
- `WorkspaceLogRepository` — `create()`, `getByWorkspaceExecution()`, `getMaxLineNumber()`

### How It Works

1. **`initializeState()`** — wraps `plan_executions` + `workspace_executions` +
   `journal_events` inserts in a **database transaction**
2. **`transitionWorkspace()`** — single `UPDATE` on `workspace_executions` row
3. **`getStatistics()`** — reads from cache (in-memory `Map<string, PlanCacheEntry>`),
   estimates tokens from workspace duration heuristics
4. **Workspace logs** — stored in `workspace_logs` table with line numbers per stream
5. **Journal events** — stored in `journal_events` with `event_type` index
6. **In-memory cache** — `DatabaseStateStore` maintains a `Map<planExecId, PlanCacheEntry>`
   for workspace state lookups (no DB read on every transition)

### Known Problems

**A. Cached workspace state is not reloaded from DB**
- `getWsEntry()` reads from `this.cache.get(planExecutionId)` — if the cache
  entry is stale (e.g., another process updated the DB), it returns outdated data
- No cache invalidation mechanism
- After crash recovery, the cache is empty, and `loadState()` must be called
  to re-hydrate it

**B. `saveState()` is a no-op**
- `async saveState(_planExecutionId: string): Promise<void> { /* no-op */ }`
- State is persisted eagerly on every mutation, but there's no explicit
  flush/checkpoint
- If a mutation succeeds in memory cache but the DB write fails,
  the cache is now inconsistent

**C. Worker transcript is in-memory only**
- `appendWorkerTranscriptEvent()` writes to `this.logBuffers` Map
- No DB table for transcript events
- `readWorkerTranscriptEvents()` reads from the buffer — lost on restart
- Journal events have transcript data but no dedicated format

**D. No `awaiting_handoff` support in schema**
- `PlanExecutionRow.status` type does not include `"awaiting_handoff"`
- `setAwaitingHandoff()` writes status to DB but the Kysely type
  doesn't validate it
- `isAwaitingHandoff()` reads from cache only, not DB

**E. Telemetry is estimated, not measured**
- `getStatistics()` uses duration-based token estimation heuristic
  (`durationMs * 0.1 chars → chars/4 tokens`)
- No actual token counters in the schema
- Cache hit rate computed from `cache_usage` journal events (which are
  rarely emitted)

**F. `plan_executions` has no `metadata` column for control requests**
- `writeControlRequest()` stores control data in `plan_executions.metadata`
- But `PlanExecutionTable` type doesn't have a `metadata` column
- Uses `as any` casts to bypass TypeScript — fragile

**G. Missing `proposal_id` on `plan_executions` table**
- `PlanExecutionTable` has `proposal_id: string | null`
- But migration 001 doesn't add this column, and the type has it
- Probably added manually or via later migration — but not visible in 004–008

---

## 4. Comparison Matrix

| Feature | JSON Backend | PostgreSQL Backend |
|---------|-------------|-------------------|
| **Data isolation** | Single global file | Per-project rows with FK |
| **Concurrency** | File-based mutex | DB row-level locking |
| **Atomicity** | Temp+rename (best-effort) | Transactions |
| **Crash safety** | .bak copies (manual) | WAL + transactions |
| **Queries** | O(n) scan of flat files | Indexed queries |
| **Pagination** | None | Via LIMIT/OFFSET |
| **Real-time logs** | In-memory buffer + file append | In-memory buffer + DB rows |
| **Stats** | Re-reads all log files | Cache + DB query |
| **Migration path** | N/A | Requires env vars + migrate CLI |
| **Dependencies** | Filesystem only | PostgreSQL 15+ |
| **Complexity** | ~600 lines adapter + ~1200 lines PlanStateStore | ~650 lines |

---

## 5. Key Architectural Issues for Redesign

### 5.1. Global State vs. Multi-Project Execution

**Current:** Both backends assume one "current" execution context.
`JsonStateStore` has `currentPlanExecutionId`, `DatabaseStateStore` caches
a single plan per call. The API routes assume one execution at a time.

**Needed:** True multi-project, multi-execution support:
- Each project can have multiple phases running concurrently
- Historical executions are always queryable
- No "current" — all state is addressed by (projectId, execId)

### 5.2. PlanState Data Model Leaks

The `PlanState` interface (`plan-state.ts`) is central to both backends but
was designed for JSON:
```typescript
interface PlanState {
  phase: string;
  title: string;
  status: PlanStatus;
  startedAt: number;
  completedAt?: number;
  handoffStartedAt?: number;
  workspaces: Map<string, WorkspaceState>;
}
```

This flat structure maps poorly to relational:
- `workspaces` as a Map → separate `workspace_executions` rows
- `handoffStartedAt` → needs a column or metadata field
- Status enum mismatch: JSON has `"awaiting_handoff"`, PG type doesn't

### 5.3. Journal and Transcript Divergence

- JSON: journal events → NDJSON file, transcript → per-workspace NDJSON file
- PG: journal events → DB table, transcript → in-memory buffer only
- Transcript should be persisted in PG too

### 5.4. Control Request Path

- JSON: `plan-control.json` file (with crash-recovery `.bak`)
- PG: `plan_executions.metadata.control` (as any cast)
- Should be its own table or dedicated column

### 5.5. No `project_id` on `workspace_logs`

- Logs are tied to `workspace_execution_id` which chains to
  `plan_execution_id` which chains to `project_id`
- Querying all logs for a project requires a 3-table join
- Should have direct `project_id` for efficient filtering

---

## 6. Current Deployment

- The server auto-detects backend: `DATABASE_URL` / `PGHOST` → postgres,
  otherwise → json
- Default: JSON backend
- Database name defaults to `pi_executor`, user `pi`, no password
- All 8 migrations are applied in packages/db
- `DatabaseStateStore` is fully implemented but NOT the default
- JSON backend has been the only one used in production (test sessions)

---

## 7. Files Referenced

| File | Purpose |
|------|---------|
| `packages/coding-agent/src/core/state-store.ts` | IStateStore interface + createStateStore() |
| `packages/coding-agent/src/core/json-state-store.ts` | JSON backend implementation |
| `packages/coding-agent/src/core/database-state-store.ts` | PostgreSQL backend implementation |
| `packages/coding-agent/src/core/plan-state.ts` | PlanStateStore (core JSON engine) |
| `packages/coding-agent/src/core/worker-memory-guard.ts` | Memory guard utility |
| `packages/web-server/src/state-store-provider.ts` | Singleton provider |
| `packages/web-server/src/index.ts` | API routes (plan detail, etc.) |
| `packages/db/src/config.ts` | DB configuration |
| `packages/db/src/connection.ts` | Connection pool |
| `packages/db/src/kysely.ts` | Kysely ORM setup |
| `packages/db/src/types.ts` | Kysely table definitions |
| `packages/db/src/migrations/001_initial.ts` | Core tables schema |
| `packages/db/src/migrations/002-008.ts` | Additional tables |
| `packages/db/src/repositories/` | Repository classes |
| `docs/race-condition-analysis.md` | Previous bug analysis |
| `docs/json-to-postgresql-migration.md` | Previous migration plan |
