# P28.A — Mutation Inventory

All direct state mutation paths in the current runtime identified and documented.

## Overview

The legacy runtime mutates state through two backend implementations of `IStateStore`:
- `DatabaseStateStore` (PostgreSQL) — primary production backend
- `JsonStateStore` (JSON file) — legacy/fallback backend

Both implement the same `IStateStore` interface. Mutation paths documented below focus on the PostgreSQL backend since that is the production path.

---

## Plan Status Writes

These mutate the `plan_executions` table directly via `PlanExecutionRepository`.

| file | function | current mutation | target event | migration risk |
|------|----------|-----------------|--------------|---------------|
| `database-state-store.ts:560` | `completePlan()` | `planExecutionRepo.updateStatus(id, "complete")` | `attempt_succeeded` (plan-level) | Low — terminal plan state |
| `database-state-store.ts:570` | `failPlan()` | `planExecutionRepo.updateStatus(id, "failed")` | `attempt_failed` (plan-level) | Low — terminal plan state |
| `database-state-store.ts:581` | `pausePlan()` | `planExecutionRepo.updateStatus(id, "paused")` | `attempt_blocked` | Low — reversible |
| `database-state-store.ts:591` | `stopPlan()` | `planExecutionRepo.updateStatus(id, "stopped")` | `attempt_failed` | Low — terminal |
| `database-state-store.ts:616` | `cancelPlan()` | `planExecutionRepo.updateStatus(id, "cancelled")` | `CANCELLED` | Low — terminal |
| `database-state-store.ts:627` | `resumePlan()` | `planExecutionRepo.updateStatus(id, "running")` | `attempt_progressed` | Low — reversible |
| `database-state-store.ts:642` | `setAwaitingHandoff()` | `updateTable("plan_executions").set({status: "awaiting_handoff"})` | `handoff_required` | Medium — dual state tracking needed |
| `database-state-store.ts:655` | `handoffCommit()` | `planExecutionRepo.updateStatus(id, "complete")` | `attempt_succeeded` | Low |
| `database-state-store.ts:665` | `handoffKeepEditing()` | `planExecutionRepo.updateStatus(id, "running")` | `attempt_progressed` | Low |
| `database-state-store.ts:687` | `handoffDiscard()` | `planExecutionRepo.updateStatus(id, "failed")` | `attempt_failed` | Low |
| `database-state-store.ts:341` | `saveState()` | `planExecutionRepo.update(id, {status, completed_at, handoff_started_at})` | mixed | High — bulk flush of cached state |

---

## Workspace Status Writes

These mutate the `workspace_executions` table via `WorkspaceExecutionRepository`.

| file | function | current mutation | target event | migration risk |
|------|----------|-----------------|--------------|---------------|
| `database-state-store.ts:372` | `updateWorkspaceState()` | `workspaceExecutionRepo.update(id, {stage, attempts, error_message, started_at, completed_at})` | `attempt_progressed` | High — per-workspace granularity |
| `database-state-store.ts:395` | `transitionWorkspace()` | `workspaceExecutionRepo.updateStage(id, newStage)` | `attempt_progressed` or `attempt_succeeded` | High — stage mapping to attempt state |
| `database-state-store.ts:425` | `incrementRetryAttempt()` | `workspaceExecutionRepo.incrementAttempts(id)` | `attempt_started` (retry) | Medium — maps to retry cycle |
| `database-state-store.ts:345` | `saveState()` (workspace loop) | `workspaceExecutionRepo.update(ws.id, {...})` each ws | mixed | High — bulk flush |

---

## Control Request Writes

These write directly to the `control_requests` table (bypassing repositories).

| file | function | current mutation | target event | migration risk |
|------|----------|-----------------|--------------|---------------|
| `database-state-store.ts:732` | `writeControlRequest()` | `updateTable("control_requests").set({...}).execute()` then `insertInto("control_requests").values({...}).execute()` | `attempt_blocked` | Medium — external control path |
| `database-state-store.ts:780` | `clearControlRequest()` | `updateTable("control_requests").set({acknowledged: true})` | no direct event | Low — ack is internal |
| `database-state-store.ts:1065` | `saveExecutionLog()` | `updateTable("plan_executions").set({execution_log: ...})` | N/A (log, not state) | None |

---

## Project Writes

| file | function | current mutation | target event | migration risk |
|------|----------|-----------------|--------------|---------------|
| `database-state-store.ts:171` | `updateProject()` | `projectRepo.update(id, {...})` | N/A (project metadata) | None |

---

## Transcript / Journal / Log Writes

These are append-only events, not state mutations per se, but still represent side-effect state changes.

| file | function | current mutation | target event | migration risk |
|------|----------|-----------------|--------------|---------------|
| `database-state-store.ts:863` | `appendJournal()` | `journalEventRepo.create({...})` | N/A (journal) | None |
| `database-state-store.ts:396` | `appendJournalEvent()` | `journalEventRepo.create({...})` | N/A (journal) | None |
| `database-state-store.ts:689` | `appendWorkerTranscriptEvent()` | `insertInto("transcript_events").values({...})` | N/A (transcript) | None |

---

## JSON State Writes (Legacy)

| file | function | current mutation | target event | migration risk |
|------|----------|-----------------|--------------|---------------|
| `json-state-store.ts:126` | `atomicWrite()` | Writes `plan-state.json` to disk | varies by caller | High — direct file mutation bypasses DB |
| `json-state-store.ts:298` | `updateWorkspaceState()` | Delegates to `PlanStateStore.updateWorkspaceState()` then `save()` | same as DB variant | High |
| `json-state-store.ts:306` | `transitionWorkspace()` | Delegates then `save()` | same as DB variant | High |
| `json-state-store.ts:400` | `completePlan()` | `updateExecutionStatus("complete")` then `save()` | `attempt_succeeded` | High |
| `json-state-store.ts:403` | `failPlan()` | `updateExecutionStatus("failed")` then `save()` | `attempt_failed` | High |
| `json-state-store.ts:418` | `cancelPlan()` | `updateExecutionStatus("cancelled")` then `save()` | `CANCELLED` | High |

---

## Summary

32 mutation paths identified across 3 state store implementations.

**High risk** (need careful migration):
- `saveState()` bulk flush in both DB and JSON stores — mixes plan + workspace updates
- `transitionWorkspace()` — core workspace lifecycle mutation
- `updateWorkspaceState()` — per-workspace partial updates
- JSON file writes — bypass any DB-level control

**Medium risk**:
- Handoff-related mutations — complex orchestration
- Control request writes — external actor coordination

**Low risk**:
- Terminal status updates (complete/failed/cancelled)
- Pause/resume lifecycle methods
- Log/journal appends
