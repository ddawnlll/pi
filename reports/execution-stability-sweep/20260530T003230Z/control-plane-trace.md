# Control Plane Trace

## Stop button trace

1. Dashboard calls `sendControlCommand("stop", planExecId)` in `packages/web-ui/dashboard/src/App.tsx`.
2. Endpoint: `POST /api/executions/:planExecId/control` in `packages/web-server/src/index.ts`.
3. Stop path now:
   - writes PostgreSQL plan state to stopped,
   - writes a stop control request,
   - signals the execution bus with `stop`.
4. Runner path in `executePlanInBackground()` reloads DB state each loop.
5. If DB status is stopped/cancelled, PostgreSQL wins over active registry.
6. Runner emits `active_registry_db_mismatch` when registry status differs.
7. Runner emits `runner_stopped_by_db_state`.
8. Runner calls `executor.drainActiveWorkspacesForStop()`.
9. Executor sets `isStopping`, aborts active workspace executors, waits for in-flight promises, kills plan-scoped processes, releases locks, terminalizes Active workspaces to Failed, and emits stop/drain events.

## Continue button trace

1. Dashboard opens rerun dialog for failed/stopped/cancelled plans.
2. Dashboard calls `POST /api/projects/:projectId/plans/:planExecId/rerun`.
3. Route loads authoritative state from PostgreSQL.
4. Route rejects non-terminal status.
5. Route checks resettable workspaces and queue/meta recoverability.
6. Route emits `continue_requested` or a specific failure event.
7. Route calls `continuePlanExecution()`.
8. `continuePlanExecution()` calls `recoverSingleExecution(... allowTerminal: true)`.
9. `recoverSingleExecution()` loads queue snapshot or reconstructs from meta/plan file.
10. `AutonomousExecutor.adoptExistingExecution()` terminalizes stranded Active workspaces before resetting to Pending and resumes the plan.

## Rerun/recover trace

- Crash recovery without `allowTerminal` skips complete/failed/stopped/cancelled plans.
- Failed/stopped/cancelled plans are now preserved for manual Continue; their queue/meta snapshots are not deleted.
- Manual Continue with `allowTerminal` accepts failed/stopped/cancelled plans, preserves Complete workspaces, resets Failed/Blocked/stranded Active work safely, and starts a new background loop.

## State transition trace

- Active -> Failed during Stop drain is allowed and records terminalization.
- Failed/Blocked -> Pending during manual Continue uses the supported reset path.
- Complete remains Complete.
- Pending -> Complete/Succeeded remains illegal.
- The executor now checks DB truth before a completion transition and returns early when DB stage is not Active.

## Old executor stale completion trace

1. Old worker starts while workspace is Active.
2. Stop/Continue changes DB state and can reset the workspace to Pending.
3. Old worker later returns COMPLETE.
4. Executor calls `isAttemptStale()` before completion transition.
5. `isAttemptStale()` reloads plan state from stateStore/PostgreSQL.
6. DB workspace stage is Pending, Failed, Blocked, Complete, or plan is stopped/cancelled.
7. Executor logs `stale_attempt_completion_ignored` and `illegal_transition_prevented_before_router`.
8. Executor releases owned locks and does not call TransitionRouter for completion.

## DB vs cache truth comparison

- PostgreSQL/runtime state is source of truth.
- `currentPlanState` remains a scheduling cache only.
- Stale guards reload via `stateStore.loadState(planExecutionId)`.
- Runner reloads state each iteration before scheduling.
- Active registry cannot override DB stopped/cancelled state; divergence is journaled.

## RCA answers

1. Stop UI path: Topbar/App control button -> `handleControl("stop")`.
2. Continue UI path: rerun dialog -> `handleRerun()`.
3. Stop endpoint: `POST /api/executions/:planExecId/control`; Continue endpoint: `POST /api/projects/:projectId/plans/:planExecId/rerun`.
4. Stop writes DB state and a control request.
5. Stop updates active execution state when runner observes terminal DB state.
6. Stop now drains active workspace promises through `drainActiveWorkspacesForStop()`.
7. Stop now aborts active `WorkspaceAgentExecutor` instances.
8. Stop kills plan-scoped child processes and tracked detached children best-effort.
9. Continue calls `continuePlanExecution()` -> `recoverSingleExecution()` -> `adoptExistingExecution()`.
10. Continue uses `allowTerminal=true` for failed/stopped/cancelled plans.
11. Continue resets failed/blocked/stranded active workspaces safely, preserving complete workspaces.
12. Continue terminalizes Active before reset; stale old completions are ignored.
13. Stale COMPLETE became a transition in `executeWorkspace()` completion paths before full DB-truth guard coverage.
14. Stale guard now reads DB/runtime truth, not just cache.
15. Router saw Pending because Continue reset DB while old executor still believed it owned Active completion.
16. Dashboard now shows backend-derived state and journal diagnostics.
17. Dashboard now shows connected/reconnecting/stale stream status.
18. Counts are derived from the selected execution detail/workspace list used by the run view.
