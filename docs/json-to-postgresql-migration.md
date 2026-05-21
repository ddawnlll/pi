# JSON → PostgreSQL Migration Plan

> Status: **ON HOLD** — try once more with JSON backend, migrate if still broken
> Created: 2026-05-21

## Why Migrate

The JSON state store (`JsonStateStore` + `PlanStateStore`) has fundamental race condition issues:

| Issue | Description | Root Cause |
|-------|-------------|------------|
| `transitionWorkspace()` silently fails | Workspace completes but `plan-state.json` never updated | File-based atomic writes + concurrent access |
| No ACID guarantees | Concurrent `saveState()` calls can corrupt state | No transaction isolation |
| No row-level locking | Mutex pattern only works in-process | Single process only |
| Crash = partial write | Process kill mid-write leaves corrupted `.json` file | No WAL/transaction log |
| `awaiting_handoff` race | State transitions can interleave | No atomic read-modify-write |
| Memory guard race | `canStartWorker()` uses stale memory data | No atomic counter |

PostgreSQL fixes all of these: ACID transactions, row-level locking, WAL, concurrent access from multiple processes.

## Current Infrastructure

Already fully implemented:

| Component | File | Status |
|-----------|------|--------|
| `DatabaseStateStore` | `packages/coding-agent/src/core/database-state-store.ts` | 1300+ lines, full `IStateStore` impl |
| DB Schema | `packages/db/src/migrations/001_initial.ts` through `008_audit_events.ts` | 8 migrations |
| Repositories | `packages/db/src/repositories/` (6 repos) | All CRUD operations |
| Migration CLI | `packages/db/src/migrate-from-json.ts` | Reads `.pi/` files → PostgreSQL |
| Auto-detect | `state-store.ts:detectStateStoreBackend()` | Checks `PI_STATE_STORE_BACKEND` / `DATABASE_URL` / PG env vars |
| Auto-migrate | `web-server/src/index.ts:4591` | Runs schema migrations at startup if `postgres` backend |

## Current PostgreSQL State

- Database: `pi` on localhost:5432
- 8/8 migrations applied
- Tables: `projects`, `plan_executions`, `workspace_executions`, `workspace_logs`, `journal_events`, `_migrations`, `chat_messages`, `proposals`, `memory_vectors`, `audit_events`
- Existing data from old test run (1 project "test2", 8 executions, 32 workspaces)
- **Current execution `bfb2e66b` NOT in DB** — only in JSON files

## Migration Steps

### 1. Set Environment Variables

```bash
export PGDATABASE=pi
export PGUSER=erfolg
export PGHOST=localhost
# Optional: set backend explicitly
export PI_STATE_STORE_BACKEND=postgres
```

### 2. Run JSON → PostgreSQL Migration

```bash
cd packages/db
node dist/migrate-from-json.js /home/erfolg/src/pi --force
```

This migrates:
- `projects.json` → `projects` table
- `executions.json` → `plan_executions` table
- `plan-state.json` → `plan_executions` + `workspace_executions`
- `execution-journal.ndjson` → `journal_events` table
- Creates backup at `.pi-backup-<timestamp>/`

### 3. Restart Web Server

```bash
# Kill old server, restart with PG backend
```

Server startup will:
1. Detect `postgres` backend (via env var)
2. Verify DB connection (health check)
3. Run pending migrations (already at v8)
4. Resume stranded executions from DB

### 4. Verify Migration

```bash
# Check projects migrated
psql -d pi -c "SELECT id, name FROM projects"

# Check current execution
psql -d pi -c "SELECT id, phase, status FROM plan_executions ORDER BY started_at DESC LIMIT 5"
```

## Data to Migrate (Current)

From `/home/erfolg/src/pi/.pi/`:

| File | Content | Target Table |
|------|---------|--------------|
| `projects.json` | 2 projects (testfinal-blog, test-project) | `projects` |
| `executions.json` | 8 execution entries | `plan_executions` |
| `plan-state.json` | 3 workspaces (project-init, db-models, rest-api) | `workspace_executions` |
| `execution-journal.ndjson` | ~2483 journal events | `journal_events` |
| `current-execution.json` | Active execution `bfb2e66b` | `plan_executions` |

## Rollback Plan

If migration fails:

```bash
# Restore from backup
cp -r /home/erfolg/src/pi/.pi-backup-<timestamp>/* /home/erfolg/src/pi/.pi/

# Switch back to JSON
export PI_STATE_STORE_BACKEND=json
```

## Files That Stay on Disk

These are NOT migrated to DB (filesystem-specific):

| Directory | Purpose | Reason |
|-----------|---------|--------|
| `.pi/workspaces/<id>/execution-*.log` | Workspace execution logs | Binary/log content |
| `.pi/workspaces/<id>/snapshot-*/` | Workspace snapshots | File system state |
| `.pi/sessions/<id>/` | Agent session files | Per-workspace data |
| `.pi/plans/*.md` | Plan markdown files | Read from disk |
| Project source files | User code | Project root |

These stay on filesystem. Only execution state migrates to DB.

## When to Migrate

1. Try current task with JSON backend one more time
2. If `transitionWorkspace()` STILL silently fails for any workspace
3. **Migrate to PostgreSQL immediately**

## Expected Benefits After Migration

- `transitionWorkspace()` uses `UPDATE ... SET stage = complete WHERE id = ... AND stage = active` — atomic, no race
- All state mutations inside DB transactions
- Concurrent workspace updates via row-level locking
- Journal events are INSERT-only, no file corruption
- No mutex primitives needed in application code
- Multiple server processes can share state
- Crash recovery via WAL
